//! The durable job runner for payment link cards.
//!
//! Approval queues work; this runner carries it out and survives a crash at any step. Every
//! job is leased, retried with a bounded backoff, and ends either done or in a visible failed
//! state on the card (review-proven rule 1: a caught failure leaves a durable retry record or
//! propagates). Jobs: `create` the link through an approved recipe, `send` the one approved
//! message, `evidence` record the payment, `expire` the link, `grant` close the browser window.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use uuid::Uuid;

use buzz_core::money_rails::link::{LinkHead, LinkState, SystemOp};
use buzz_core::money_rails::{RecipientChannel, Route, NOTICE_KEEP_DAYS};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::money_rails::MoneyJob;

use super::evidence::{record_payment, EvidencePayload, EvidenceResult};
use super::provider::ProviderHttp;
use super::runner::{run_create, RunFailure};
use super::{derived_uuid, load_connection};
use crate::handlers::money_pay_links::{apply_system_op, read_link};
use crate::state::AppState;
use crate::whatsapp::sender::{enqueue_send, Enqueued, SendCommand};
use crate::whatsapp::Access;

const TICK: Duration = Duration::from_secs(5);
const LEASE_SECS: i64 = 120;
const BATCH: i64 = 20;
/// Tries of a create job before the card fails (each try backs off).
const MAX_ATTEMPTS: i32 = 6;
/// Polls of a queued message before the card fails (10 seconds apart).
const MAX_SEND_POLLS: i32 = 150;
/// Tries of an evidence write before the runner stops retrying (15 minutes apart).
const MAX_EVIDENCE_ATTEMPTS: i32 = 100;
/// Seconds between ticks that reduce old notice bodies.
const REDUCE_EVERY_TICKS: u32 = 120;

/// Seconds to wait before try number `attempts`: 15, 30, 60 ... at most 15 minutes.
pub fn backoff_secs(attempts: i32) -> i64 {
    let exponent = u32::try_from(attempts.saturating_sub(1))
        .unwrap_or(0)
        .min(6);
    (15i64 << exponent).min(900)
}

/// Run the job runner forever.
pub async fn run(state: Arc<AppState>) {
    tracing::info!("money rails job runner started");
    let http = Arc::clone(&state.money_http);
    let mut ticks: u32 = 0;
    loop {
        if let Err(error) = tick(&state, http.as_ref()).await {
            tracing::error!("money rails tick failed: {error}");
        }
        ticks = ticks.wrapping_add(1);
        if ticks % REDUCE_EVERY_TICKS == 0 {
            match state
                .db
                .money_reduce_old_notices(NOTICE_KEEP_DAYS, 500)
                .await
            {
                Ok(count) if count > 0 => {
                    tracing::info!(count, "money rails reduced old notice bodies");
                }
                Ok(_) => {}
                Err(error) => tracing::warn!("money rails notice reduction failed: {error}"),
            }
        }
        tokio::time::sleep(TICK).await;
    }
}

/// One pass: lease the due jobs and process them.
pub async fn tick(state: &Arc<AppState>, http: &dyn ProviderHttp) -> Result<usize, String> {
    let jobs = state
        .db
        .money_claim_due_jobs(BATCH, LEASE_SECS)
        .await
        .map_err(|error| format!("job claim failed: {error}"))?;
    let count = jobs.len();
    for job in jobs {
        process_job(state, http, &job).await;
    }
    Ok(count)
}

/// Process one named job now, if it is open and not leased by another worker.
pub async fn process_now(
    state: &Arc<AppState>,
    http: &dyn ProviderHttp,
    tenant: &TenantContext,
    link_id: Uuid,
    kind: &str,
) {
    match state
        .db
        .money_claim_job(tenant.community(), link_id, kind, LEASE_SECS)
        .await
    {
        Ok(Some(job)) => process_job(state, http, &job).await,
        Ok(None) => {}
        Err(error) => tracing::warn!("money rails could not claim a job: {error}"),
    }
}

async fn tenant_of(state: &Arc<AppState>, community: Uuid) -> Option<TenantContext> {
    let id = CommunityId::from_uuid(community);
    match state.db.lookup_community_host(id).await {
        Ok(Some(host)) => Some(TenantContext::resolved(id, host)),
        _ => None,
    }
}

/// Process one leased job. Never panics and never loses the job: a failure either schedules a
/// retry or moves the card to a visible failed state.
pub async fn process_job(state: &Arc<AppState>, http: &dyn ProviderHttp, job: &MoneyJob) {
    let Some(tenant) = tenant_of(state, job.community_id).await else {
        // The community is gone; nothing can use this job.
        let community = CommunityId::from_uuid(job.community_id);
        let _ = state
            .db
            .money_complete_job(community, job.link_id, &job.kind)
            .await;
        return;
    };
    let result = match job.kind.as_str() {
        "create" => do_create(state, http, &tenant, job).await,
        "send" => do_send(state, &tenant, job).await,
        "evidence" => do_evidence(state, &tenant, job).await,
        "expire" => do_system(state, &tenant, job, SystemOp::Expire).await,
        "grant" => do_system(state, &tenant, job, SystemOp::GrantExpired).await,
        other => Err(format!("unknown job kind {other}")),
    };
    if let Err(error) = result {
        tracing::warn!(
            community = %tenant.community(),
            kind = %job.kind,
            "money rails job step failed, will retry: {error}"
        );
        if let Err(db_error) = state
            .db
            .money_retry_job_later(
                tenant.community(),
                job.link_id,
                &job.kind,
                &error,
                backoff_secs(job.attempts),
            )
            .await
        {
            tracing::error!("money rails could not reschedule a job: {db_error}");
        }
    }
}

async fn complete(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
) -> Result<(), String> {
    state
        .db
        .money_complete_job(tenant.community(), job.link_id, &job.kind)
        .await
        .map_err(|error| format!("could not finish a job: {error}"))
}

async fn retry_later(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
    reason: &str,
    delay_secs: i64,
) -> Result<(), String> {
    state
        .db
        .money_retry_job_later(
            tenant.community(),
            job.link_id,
            &job.kind,
            reason,
            delay_secs,
        )
        .await
        .map_err(|error| format!("could not reschedule a job: {error}"))
}

async fn current_head(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    link_id: Uuid,
) -> Result<Option<LinkHead>, String> {
    read_link(state, tenant.community(), link_id)
        .await
        .map(|found| found.map(|(_, head)| head))
        .map_err(|error| format!("could not read the card: {error:?}"))
}

async fn apply(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    link_id: Uuid,
    op: SystemOp,
) -> Result<(), String> {
    apply_system_op(tenant, state, link_id, op)
        .await
        .map(|_| ())
        .map_err(|error| format!("could not update the card: {error:?}"))
}

async fn do_system(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
    op: SystemOp,
) -> Result<(), String> {
    apply(state, tenant, job.link_id, op).await?;
    complete(state, tenant, job).await
}

/// The result of the provider call, kept so a crash after the call never repeats it.
fn created_to_json(created: &super::runner::CreatedByProvider) -> Value {
    json!({
        "url": created.url,
        "reference": created.provider_reference,
        "amountMinor": created.amount_minor,
        "currency": created.currency,
    })
}

async fn fail_or_retry(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
    failure: RunFailure,
) -> Result<(), String> {
    if failure.retryable && job.attempts < MAX_ATTEMPTS {
        return retry_later(
            state,
            tenant,
            job,
            &failure.reason,
            backoff_secs(job.attempts),
        )
        .await;
    }
    apply(
        state,
        tenant,
        job.link_id,
        SystemOp::Fail {
            code: failure.code,
            reason: failure.reason,
            retryable: failure.retryable,
        },
    )
    .await?;
    complete(state, tenant, job).await
}

async fn do_create(
    state: &Arc<AppState>,
    http: &dyn ProviderHttp,
    tenant: &TenantContext,
    job: &MoneyJob,
) -> Result<(), String> {
    let community = tenant.community();
    let Some(head) = current_head(state, tenant, job.link_id).await? else {
        return complete(state, tenant, job).await;
    };
    if head.state != LinkState::CreatingLink || head.route != Route::Api || head.link_exists() {
        return complete(state, tenant, job).await;
    }
    let created = match &job.result {
        Some(saved) => serde_json::from_value::<SavedCreate>(saved.clone())
            .map_err(|error| format!("saved create result is unreadable: {error}"))?,
        None => {
            let Some(loaded) = load_connection(state, community, head.connection_id).await? else {
                return fail_or_retry(
                    state,
                    tenant,
                    job,
                    RunFailure::new(
                        "connection_missing",
                        "The payment provider connection was removed.",
                        false,
                    ),
                )
                .await;
            };
            match run_create(state, http, community, &head, &loaded, None).await {
                Ok(created) => {
                    let saved = created_to_json(&created);
                    state
                        .db
                        .money_save_job_result(community, job.link_id, "create", &saved)
                        .await
                        .map_err(|error| format!("could not save the create result: {error}"))?;
                    SavedCreate {
                        url: created.url,
                        reference: created.provider_reference,
                        amount_minor: created.amount_minor,
                        currency: created.currency,
                    }
                }
                Err(failure) => return fail_or_retry(state, tenant, job, failure).await,
            }
        }
    };
    apply(
        state,
        tenant,
        job.link_id,
        SystemOp::LinkCreated {
            url: created.url,
            provider_reference: created.reference,
            shown_amount_minor: created.amount_minor,
            shown_currency: created.currency,
        },
    )
    .await?;
    complete(state, tenant, job).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedCreate {
    url: String,
    reference: Option<String>,
    amount_minor: i64,
    currency: String,
}

fn message_text(head: &LinkHead) -> String {
    let url = head
        .link
        .as_ref()
        .map(|link| link.url.as_str())
        .unwrap_or_default();
    head.message.replace("{link}", url)
}

async fn delivery_failed(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
    code: &str,
    reason: &str,
    retryable: bool,
) -> Result<(), String> {
    apply(
        state,
        tenant,
        job.link_id,
        SystemOp::DeliveryFailed {
            code: code.to_owned(),
            reason: reason.to_owned(),
            retryable,
        },
    )
    .await?;
    complete(state, tenant, job).await
}

async fn do_send(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
) -> Result<(), String> {
    let community = tenant.community();
    let Some(head) = current_head(state, tenant, job.link_id).await? else {
        return complete(state, tenant, job).await;
    };
    if head.state != LinkState::CreatingLink || !head.link_exists() {
        return complete(state, tenant, job).await;
    }
    if !head.approval_is_valid() {
        return delivery_failed(
            state,
            tenant,
            job,
            "card_not_approved",
            "The card no longer matches its approval, so nothing was sent.",
            false,
        )
        .await;
    }
    let recipient = state
        .db
        .money_get_recipient(community, head.recipient_ref)
        .await
        .map_err(|error| format!("could not read the recipient: {error}"))?;
    let Some(recipient) = recipient else {
        return delivery_failed(
            state,
            tenant,
            job,
            "message_failed",
            "The recipient of this card could not be found.",
            false,
        )
        .await;
    };
    match head.recipient_channel {
        RecipientChannel::Whatsapp => {
            send_whatsapp(state, tenant, job, &head, &recipient.address).await
        }
        RecipientChannel::Email => send_email(state, tenant, job, &head, &recipient.address).await,
    }
}

async fn send_whatsapp(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
    head: &LinkHead,
    address: &str,
) -> Result<(), String> {
    let community = tenant.community();
    let request_id = derived_uuid("send", head.link_id);
    let key = format!("req:{request_id}");
    let mut message_id = state
        .db
        .money_find_whatsapp_message(community, &key)
        .await
        .map_err(|error| format!("could not look for the queued message: {error}"))?
        .map(|(id, _)| id);
    if message_id.is_none() {
        let actor = job
            .payload
            .get("actor")
            .and_then(Value::as_str)
            .and_then(|hex| nostr::PublicKey::from_hex(hex).ok());
        let Some(actor) = actor else {
            return delivery_failed(
                state,
                tenant,
                job,
                "message_failed",
                "The approver of this card could not be found.",
                false,
            )
            .await;
        };
        let command = SendCommand {
            request_id,
            to: Some(address.to_owned()),
            thread_root: None,
            text: Some(message_text(head)),
            template: None,
        };
        match enqueue_send(
            state,
            tenant,
            Access::OwnerAdmin,
            &actor.to_bytes(),
            &command,
        )
        .await
        {
            Ok(Enqueued::Queued(id)) | Ok(Enqueued::Draft(id)) => message_id = Some(id),
            Ok(Enqueued::Duplicate) => {
                message_id = state
                    .db
                    .money_find_whatsapp_message(community, &key)
                    .await
                    .map_err(|error| format!("could not look for the queued message: {error}"))?
                    .map(|(id, _)| id);
            }
            Err(reason) => {
                let window = reason.to_ascii_lowercase().contains("window")
                    || reason.to_ascii_lowercase().contains("template");
                let code = if window {
                    "message_window_closed"
                } else {
                    "message_failed"
                };
                let text = format!(
                    "WhatsApp would not send it: {reason}. The link was created, so you can send it by hand and mark it sent."
                );
                return delivery_failed(state, tenant, job, code, &text, false).await;
            }
        }
    }
    let Some(message_id) = message_id else {
        return Err("the queued WhatsApp message could not be found yet".to_owned());
    };
    let state_name = state
        .db
        .money_whatsapp_message_state(community, message_id)
        .await
        .map_err(|error| format!("could not read the message state: {error}"))?
        .unwrap_or_default();
    match state_name.as_str() {
        "sent" | "delivered" | "read" => {
            apply(state, tenant, job.link_id, SystemOp::Delivered).await?;
            complete(state, tenant, job).await
        }
        "failed" | "rejected" | "dropped" | "skipped" => {
            delivery_failed(
                state,
                tenant,
                job,
                "message_failed",
                "WhatsApp did not send the message. The link was created, so you can send it by hand and mark it sent.",
                false,
            )
            .await
        }
        "unconfirmed" => {
            delivery_failed(
                state,
                tenant,
                job,
                "message_failed",
                "The send was not confirmed and will NOT be sent again. Check the phone, then mark it sent if it went out.",
                false,
            )
            .await
        }
        _ if job.attempts >= MAX_SEND_POLLS => {
            delivery_failed(
                state,
                tenant,
                job,
                "message_failed",
                "The message is still waiting to be sent. Check WhatsApp, or send the link by hand and mark it sent.",
                true,
            )
            .await
        }
        _ => retry_later(state, tenant, job, "message not sent yet", 10).await,
    }
}

async fn send_email(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
    head: &LinkHead,
    address: &str,
) -> Result<(), String> {
    let (Some(api_key), Some(from)) = (
        state.config.accounts.resend_api_key(),
        state.config.accounts.mail_from(),
    ) else {
        return delivery_failed(
            state,
            tenant,
            job,
            "message_failed",
            "Email sending is not switched on for this relay. Copy the message and send it yourself, then mark it sent.",
            false,
        )
        .await;
    };
    let body = json!({
        "from": from,
        "to": [address],
        "subject": format!("Payment request {}", head.invoice_number),
        "text": message_text(head),
    });
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "could not build the mail client".to_owned())?;
    let response = client
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key)
        .header("Idempotency-Key", format!("paylink-{}", head.link_id))
        .json(&body)
        .send()
        .await;
    match response {
        Ok(response) if response.status().is_success() => {
            apply(state, tenant, job.link_id, SystemOp::Delivered).await?;
            complete(state, tenant, job).await
        }
        Ok(response) if response.status().is_client_error() && response.status().as_u16() != 429 => {
            delivery_failed(
                state,
                tenant,
                job,
                "message_failed",
                "The mail service refused the message. Copy it and send it yourself, then mark it sent.",
                false,
            )
            .await
        }
        _ if job.attempts >= MAX_ATTEMPTS => {
            delivery_failed(
                state,
                tenant,
                job,
                "message_failed",
                "The mail service could not be reached. Copy the message and send it yourself, then mark it sent.",
                true,
            )
            .await
        }
        _ => Err("the mail service did not accept the message yet".to_owned()),
    }
}

async fn do_evidence(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    job: &MoneyJob,
) -> Result<(), String> {
    let Some(head) = current_head(state, tenant, job.link_id).await? else {
        return complete(state, tenant, job).await;
    };
    if head.state == LinkState::Paid {
        return complete(state, tenant, job).await;
    }
    let payload = serde_json::from_value::<EvidencePayload>(job.payload.clone())
        .map_err(|error| format!("evidence job payload is unreadable: {error}"))?;
    match record_payment(state, tenant, &head, &payload).await {
        EvidenceResult::Recorded {
            payment_id,
            event_id,
        } => {
            apply(
                state,
                tenant,
                job.link_id,
                SystemOp::EvidenceRecorded {
                    payment_id,
                    evidence_event_id: event_id,
                },
            )
            .await?;
            complete(state, tenant, job).await
        }
        EvidenceResult::Failed { reason, retryable } => {
            // Leave the reason on the card so the owner sees why, and keep trying (slowly)
            // while that can help.
            apply(
                state,
                tenant,
                job.link_id,
                SystemOp::EvidencePending {
                    reason: reason.clone(),
                },
            )
            .await?;
            if retryable && job.attempts < MAX_EVIDENCE_ATTEMPTS {
                retry_later(state, tenant, job, &reason, backoff_secs(job.attempts)).await
            } else {
                complete(state, tenant, job).await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_from_fifteen_seconds_and_stops_at_fifteen_minutes() {
        assert_eq!(backoff_secs(1), 15);
        assert_eq!(backoff_secs(2), 30);
        assert_eq!(backoff_secs(3), 60);
        assert_eq!(backoff_secs(6), 480);
        assert_eq!(backoff_secs(7), 900);
        assert_eq!(backoff_secs(50), 900);
        assert_eq!(backoff_secs(0), 15);
    }
}
