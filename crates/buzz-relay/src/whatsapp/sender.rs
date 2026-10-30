//! Sending: the rules for one send, the durable queue, and the worker that calls Graph.
//!
//! Safety properties (AGENTS.md rules 1 and 5):
//! * one idempotency key is at most one row, and one row is at most one Graph send;
//! * a row is leased (`sending`) BEFORE Graph is called. A crash between the Graph call and
//!   the record leaves the lease to expire into `unconfirmed`, and an unconfirmed row is
//!   never sent again by the relay;
//! * a pending batch is `held` and the worker only ever reads `queued` and `ready` rows;
//! * a failed Colony post after a successful send is retried from the database, not lost.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::whatsapp::{NewOutboundMessage, WhatsappContact, WhatsappMessage};

use super::connect::{note_token_expired, open_secrets, refresh_phone_info, sync_templates};
use super::graph::{GraphError, SendRequest};
use super::policy::{
    classify_failure_code, decide_new_chat, decide_owner_send_now, e164, normalize_wa_id,
    render_template, row_gap, sast_day_start, window_open, FailureKind, NewChatDecision,
};
use super::{channel, Access};
use crate::state::AppState;

const TICK: StdDuration = StdDuration::from_secs(5);
const LEASE_SECS: i64 = 120;
const SENDABLE_PER_TICK: i64 = 25;
const UNPOSTED_PER_TICK: i64 = 25;
const PHONE_REFRESH_EVERY: Duration = Duration::minutes(30);
const TEMPLATE_RESYNC_EVERY: Duration = Duration::hours(6);
const MAX_TEXT_CHARS: usize = 4096;

/// What a send turned out to be.
#[derive(Debug, PartialEq, Eq)]
pub struct SendPlan {
    /// `text` or `template`.
    pub kind: &'static str,
    /// Counts to the daily cap.
    pub new_chat: bool,
}

/// Facts the send rules look at.
pub struct SendContext<'a> {
    /// The contact, if we have ever seen them.
    pub contact: Option<&'a WhatsappContact>,
    /// All sending is stopped for the company.
    pub send_paused: bool,
    /// Why.
    pub pause_reason: Option<&'a str>,
    /// Messages to this contact already queued or being sent.
    pub pending_outbound: i64,
    /// Now.
    pub now: DateTime<Utc>,
    /// The sender is an owner or admin.
    pub is_owner_admin: bool,
    /// The message is a template (otherwise free text).
    pub is_template: bool,
}

/// The rules for one send. Returns the plain reason when the send is refused.
pub fn check_send(ctx: &SendContext<'_>) -> Result<SendPlan, String> {
    if ctx.send_paused {
        return Err(format!(
            "sending is paused: {}",
            ctx.pause_reason.unwrap_or("see the status")
        ));
    }
    if let Some(contact) = ctx.contact {
        if let Some(at) = contact.opted_out_at {
            return Err(format!("contact opted out on {}", at.format("%Y-%m-%d")));
        }
        if contact.paused_at.is_some() {
            return Err(format!(
                "contact is paused: {}",
                contact.pause_reason.as_deref().unwrap_or("blocked by Meta")
            ));
        }
        if contact.outbound_since_inbound >= 1 || ctx.pending_outbound > 0 {
            return Err("one message at a time: wait for a reply before sending another".into());
        }
    } else if ctx.pending_outbound > 0 {
        return Err("one message at a time: wait for a reply before sending another".into());
    }
    let open = window_open(ctx.contact.and_then(|c| c.last_inbound_at), ctx.now);
    if !ctx.is_template {
        if !open {
            return Err("outside the 24 hour window: only a template can be sent".into());
        }
        return Ok(SendPlan {
            kind: "text",
            new_chat: false,
        });
    }
    let new_chat = !open;
    if new_chat && !ctx.is_owner_admin {
        return Err("new chats need an approved batch".into());
    }
    Ok(SendPlan {
        kind: "template",
        new_chat,
    })
}

/// Template reference of a send request.
#[derive(Debug, Clone)]
pub struct TemplateRef {
    /// Template name.
    pub name: String,
    /// Language code.
    pub language: String,
    /// Body parameters.
    pub params: Vec<String>,
}

/// A validated `47050` command.
#[derive(Debug, Clone)]
pub struct SendCommand {
    /// Idempotency key chosen by the sender.
    pub request_id: Uuid,
    /// Recipient number.
    pub to: Option<String>,
    /// Or the contact's thread root (hex event id).
    pub thread_root: Option<String>,
    /// Free text.
    pub text: Option<String>,
    /// Or a template.
    pub template: Option<TemplateRef>,
}

/// Outcome of a queued send.
#[derive(Debug, PartialEq, Eq)]
pub enum Enqueued {
    /// Queued with this message id: the sender was an owner or admin, who is the approval.
    Queued(Uuid),
    /// An agent's message. It is a draft that never reaches Graph until an owner or admin
    /// approves it.
    Draft(Uuid),
    /// The same `requestId` was already queued: nothing new was created.
    Duplicate,
}

/// Validate a send request and queue it durably. The worker sends it.
pub async fn enqueue_send(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    access: Access,
    sender: &[u8],
    command: &SendCommand,
) -> Result<Enqueued, String> {
    let community = tenant.community();
    let now = Utc::now();
    if command.text.is_some() == command.template.is_some() {
        return Err("send exactly one of text or template".into());
    }
    if command.to.is_some() == command.thread_root.is_some() {
        return Err("name exactly one of to or threadRoot".into());
    }
    if state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| error.to_string())?
        .is_none()
    {
        return Err("no WhatsApp number is connected".into());
    }
    let wa_id = match (&command.to, &command.thread_root) {
        (Some(to), _) => {
            normalize_wa_id(to).ok_or_else(|| "that is not a phone number".to_string())?
        }
        (None, Some(root)) => {
            let root_bytes =
                hex::decode(root).map_err(|_| "threadRoot must be a hex event id".to_string())?;
            state
                .db
                .whatsapp_get_contact_by_thread(community, &root_bytes)
                .await
                .map_err(|error| error.to_string())?
                .map(|contact| contact.wa_id)
                .ok_or_else(|| "that thread is not a WhatsApp contact".to_string())?
        }
        (None, None) => return Err("name exactly one of to or threadRoot".into()),
    };
    let settings = state
        .db
        .whatsapp_ensure_settings(community)
        .await
        .map_err(|error| error.to_string())?;
    let contact = state
        .db
        .whatsapp_get_contact(community, &wa_id)
        .await
        .map_err(|error| error.to_string())?;
    let pending = state
        .db
        .whatsapp_count_pending_outbound(community, &wa_id)
        .await
        .map_err(|error| error.to_string())?;
    let plan = check_send(&SendContext {
        contact: contact.as_ref(),
        send_paused: settings.send_paused,
        pause_reason: settings.pause_reason.as_deref(),
        pending_outbound: pending,
        now,
        is_owner_admin: access.is_owner_admin(),
        is_template: command.template.is_some(),
    })?;

    let (kind, body, template_name, template_language, params) =
        match (&command.text, &command.template) {
            (Some(text), None) => {
                let text = text.trim();
                if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
                    return Err(format!(
                        "text must be 1 through {MAX_TEXT_CHARS} characters"
                    ));
                }
                ("text", text.to_string(), None, None, serde_json::json!([]))
            }
            (None, Some(template)) => {
                let stored = state
                    .db
                    .whatsapp_find_template(community, &template.name, &template.language)
                    .await
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| {
                        format!(
                            "template {} ({}) is not approved",
                            template.name, template.language
                        )
                    })?;
                let body = render_template(&stored.body, &template.params)?;
                (
                    "template",
                    body,
                    Some(stored.name.clone()),
                    Some(stored.language.clone()),
                    serde_json::json!(template.params),
                )
            }
            _ => return Err("send exactly one of text or template".into()),
        };

    state
        .db
        .whatsapp_ensure_contact(community, &wa_id, None)
        .await
        .map_err(|error| error.to_string())?;
    state
        .db
        .whatsapp_set_owner_if_unowned(community, &wa_id, sender)
        .await
        .map_err(|error| error.to_string())?;
    let message = NewOutboundMessage {
        id: Uuid::new_v4(),
        wa_id,
        kind: kind.to_string(),
        body,
        template_name,
        template_language,
        params,
        state: initial_state(access).to_string(),
        idempotency_key: format!("req:{}", command.request_id),
        batch_id: None,
        batch_idx: None,
        new_chat: plan.new_chat,
        sender_pubkey: sender.to_vec(),
    };
    match state
        .db
        .whatsapp_insert_outbound(community, &message)
        .await
        .map_err(|error| error.to_string())?
    {
        Some(id) if message.state == "draft" => {
            // Show the draft in the contact's thread so the owner can decide it there. A
            // failed post is retried by `repair_unposted`; the draft itself is already durable.
            if let (Some(channel_id), Ok(Some(stored)), Ok(Some(contact))) = (
                settings.outreach_channel_id,
                state.db.whatsapp_get_message(community, id).await,
                state
                    .db
                    .whatsapp_get_contact(community, &message.wa_id)
                    .await,
            ) {
                if let Err(error) =
                    channel::post_for_message(state, tenant, channel_id, &contact, &stored).await
                {
                    tracing::warn!(%community, "whatsapp draft post failed, will retry: {error}");
                }
            }
            Ok(Enqueued::Draft(id))
        }
        Some(id) => Ok(Enqueued::Queued(id)),
        None => Ok(Enqueued::Duplicate),
    }
}

/// Initial state of a send request. An owner or admin typing in Colony is the approval, so
/// their message is queued at once. Every agent message is a draft: the sender only reads
/// `queued` and `ready` rows, so a draft never reaches Graph before an owner decides it.
pub fn initial_state(access: Access) -> &'static str {
    if access.is_owner_admin() {
        "queued"
    } else {
        "draft"
    }
}

/// Graph request for one stored outbound message.
pub fn build_request(message: &WhatsappMessage) -> Result<SendRequest, String> {
    if message.kind == "template" {
        let name = message
            .template_name
            .clone()
            .ok_or_else(|| "template message has no template name".to_string())?;
        let language = message
            .template_language
            .clone()
            .ok_or_else(|| "template message has no language".to_string())?;
        let params = message
            .params
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|item| item.as_str().unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default();
        Ok(SendRequest::Template {
            to: message.wa_id.clone(),
            name,
            language,
            params,
        })
    } else {
        Ok(SendRequest::Text {
            to: message.wa_id.clone(),
            body: message.body.clone(),
        })
    }
}

/// Run the sender forever.
pub async fn run(state: Arc<AppState>) {
    let mut last_phone_refresh: HashMap<CommunityId, DateTime<Utc>> = HashMap::new();
    let mut last_template_sync: HashMap<CommunityId, DateTime<Utc>> = HashMap::new();
    tracing::info!("WhatsApp sender started");
    loop {
        if let Err(error) = tick(
            &state,
            Utc::now(),
            &mut last_phone_refresh,
            &mut last_template_sync,
        )
        .await
        {
            tracing::error!("whatsapp sender tick failed: {error}");
        }
        tokio::time::sleep(TICK).await;
    }
}

/// One pass over every connected company.
pub async fn tick(
    state: &Arc<AppState>,
    now: DateTime<Utc>,
    last_phone_refresh: &mut HashMap<CommunityId, DateTime<Utc>>,
    last_template_sync: &mut HashMap<CommunityId, DateTime<Utc>>,
) -> Result<(), String> {
    let expired = state
        .db
        .whatsapp_expire_leases(now)
        .await
        .map_err(|error| format!("lease expiry failed: {error}"))?;
    for (community, message) in expired {
        if let Ok(Some(host)) = state.db.lookup_community_host(community).await {
            let tenant = TenantContext::resolved(community, host);
            channel::post_notice(
                state,
                &tenant,
                "unconfirmed",
                &format!(
                    "The send to {} was not confirmed and will NOT be sent again. Check the phone before retrying.",
                    e164(&message.wa_id)
                ),
            )
            .await;
        }
    }
    let communities = state
        .db
        .whatsapp_list_connected_communities()
        .await
        .map_err(|error| format!("connection list failed: {error}"))?;
    for community in communities {
        if let Err(error) = process_community(state, community, now).await {
            tracing::warn!(%community, "whatsapp company pass failed: {error}");
        }
        let Ok(Some(host)) = state.db.lookup_community_host(community).await else {
            continue;
        };
        let tenant = TenantContext::resolved(community, host);
        if last_phone_refresh
            .get(&community)
            .is_none_or(|last| now - *last >= PHONE_REFRESH_EVERY)
        {
            last_phone_refresh.insert(community, now);
            if let Err(error) = refresh_phone_info(state, &tenant).await {
                tracing::warn!(%community, "whatsapp phone refresh failed: {error}");
            }
        }
        if last_template_sync
            .get(&community)
            .is_none_or(|last| now - *last >= TEMPLATE_RESYNC_EVERY)
        {
            last_template_sync.insert(community, now);
            if let Err(error) = sync_templates(state, &tenant).await {
                tracing::warn!(%community, "whatsapp template resync failed: {error}");
            }
        }
    }
    Ok(())
}

/// Send what is due for one company.
pub async fn process_community(
    state: &Arc<AppState>,
    community: CommunityId,
    now: DateTime<Utc>,
) -> Result<(), String> {
    let host = state
        .db
        .lookup_community_host(community)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "community is gone".to_string())?;
    let tenant = TenantContext::resolved(community, host);
    let settings = state
        .db
        .whatsapp_ensure_settings(community)
        .await
        .map_err(|error| error.to_string())?;
    let Some(connection) = state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };

    repair_unposted(state, &tenant, settings.outreach_channel_id).await;

    for batch_id in state
        .db
        .whatsapp_complete_finished_batches(community)
        .await
        .map_err(|error| error.to_string())?
    {
        channel::post_notice(
            state,
            &tenant,
            "batch_completed",
            &format!("Batch {batch_id} is finished."),
        )
        .await;
    }
    if settings.send_paused {
        return Ok(());
    }
    let Some(kek) = state.config.accounts.account_kek() else {
        return Ok(());
    };
    let (token, _) = open_secrets(kek, *community.as_uuid(), &connection)?;

    let sendable = state
        .db
        .whatsapp_list_sendable(community, SENDABLE_PER_TICK)
        .await
        .map_err(|error| error.to_string())?;
    let mut new_chat_blocked = false;
    for message in sendable {
        let Some(contact) = state
            .db
            .whatsapp_get_contact(community, &message.wa_id)
            .await
            .map_err(|error| error.to_string())?
        else {
            continue;
        };
        if let Some(at) = contact.opted_out_at {
            skip(
                state,
                community,
                &message,
                &format!("contact opted out on {}", at.format("%Y-%m-%d")),
            )
            .await;
            continue;
        }
        if contact.paused_at.is_some() {
            skip(state, community, &message, "contact is paused").await;
            continue;
        }
        if message.new_chat {
            // A row the owner released with `send_now` skips the window and the gap, so an
            // earlier paced send in this pass must not hold it back.
            let released = false;
            if new_chat_blocked && !released {
                continue;
            }
            let sent_today = state
                .db
                .whatsapp_count_new_chats_since(community, sast_day_start(now))
                .await
                .map_err(|error| error.to_string())?;
            let last = state
                .db
                .whatsapp_last_new_chat_at(community)
                .await
                .map_err(|error| error.to_string())?;
            let decision = if released {
                decide_owner_send_now(now, sent_today, settings.daily_new_chat_cap)
            } else {
                decide_new_chat(
                    now,
                    last,
                    sent_today,
                    settings.daily_new_chat_cap,
                    row_gap(&message.id),
                )
            };
            match decision {
                NewChatDecision::SendNow => {}
                NewChatDecision::WaitUntil(_) | NewChatDecision::CapReached { .. } => {
                    new_chat_blocked = true;
                    continue;
                }
            }
        } else if message.kind == "text" && !window_open(contact.last_inbound_at, now) {
            skip(
                state,
                community,
                &message,
                "the 24 hour window closed before the message was sent",
            )
            .await;
            continue;
        }

        let request = match build_request(&message) {
            Ok(request) => request,
            Err(reason) => {
                skip(state, community, &message, &reason).await;
                continue;
            }
        };
        let lease = Uuid::new_v4();
        let claimed = state
            .db
            .whatsapp_claim_message(
                community,
                message.id,
                lease,
                now + Duration::seconds(LEASE_SECS),
                now,
            )
            .await
            .map_err(|error| error.to_string())?;
        if !claimed {
            continue;
        }
        match state
            .whatsapp_graph
            .send(&token, &connection.phone_number_id, &request)
            .await
        {
            Ok(wamid) => {
                match state
                    .db
                    .whatsapp_complete_send(community, &message, lease, &wamid, now)
                    .await
                {
                    Ok(true) => {}
                    Ok(false) => {
                        tracing::error!(%community, message = %message.id, "whatsapp send record lost its lease")
                    }
                    // The lease stays; it expires into `unconfirmed` and is never resent.
                    Err(error) => {
                        tracing::error!(%community, message = %message.id, "whatsapp send record failed: {error}")
                    }
                }
                if message.new_chat {
                    new_chat_blocked = true;
                }
            }
            Err(GraphError::Rejected {
                code,
                message: text,
                ..
            }) => {
                let code_text = code.map(|c| c.to_string()).unwrap_or_default();
                if let Err(error) = state
                    .db
                    .whatsapp_fail_send(community, message.id, lease, &code_text, &text)
                    .await
                {
                    tracing::error!(%community, "whatsapp failure record failed: {error}");
                }
                handle_failure(state, &tenant, &message, code, &text).await;
                if matches!(
                    code.map(classify_failure_code),
                    Some(FailureKind::TokenExpired)
                ) {
                    break;
                }
            }
            Err(GraphError::Unavailable(reason)) => {
                // Outcome unknown: the lease expires into `unconfirmed`. Stop this pass.
                tracing::warn!(%community, message = %message.id, "whatsapp send outcome unknown: {reason}");
                break;
            }
        }
    }
    Ok(())
}

async fn skip(
    state: &Arc<AppState>,
    community: CommunityId,
    message: &WhatsappMessage,
    reason: &str,
) {
    if let Err(error) = state
        .db
        .whatsapp_skip_message(community, message.id, reason)
        .await
    {
        tracing::warn!(%community, "whatsapp skip record failed: {error}");
    }
}

/// React to a Meta refusal of a send.
pub async fn handle_failure(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    message: &WhatsappMessage,
    code: Option<i64>,
    text: &str,
) {
    let community = tenant.community();
    let kind = code
        .map(classify_failure_code)
        .unwrap_or(FailureKind::Other);
    match kind {
        FailureKind::TokenExpired => note_token_expired(state, tenant).await,
        FailureKind::ContactBlocked => {
            let newly = state
                .db
                .whatsapp_pause_contact(
                    community,
                    &message.wa_id,
                    &format!("Meta error {}", code.unwrap_or_default()),
                    Utc::now(),
                )
                .await
                .unwrap_or(false);
            if newly {
                channel::post_notice(
                    state,
                    tenant,
                    "contact_paused",
                    &format!(
                        "Meta blocked a send to {} (error {}). The contact is paused and nothing more will be sent to them.",
                        e164(&message.wa_id),
                        code.unwrap_or_default()
                    ),
                )
                .await;
            }
        }
        FailureKind::TemplateUnavailable => {
            let name = message.template_name.clone().unwrap_or_default();
            let _ = state
                .db
                .whatsapp_set_issue(
                    community,
                    "template_paused",
                    &format!("Template {name} is paused or disabled."),
                    Utc::now(),
                )
                .await;
            channel::post_notice(
                state,
                tenant,
                "template_paused",
                &format!("Template {name} is paused or disabled by Meta."),
            )
            .await;
        }
        FailureKind::NumberDisconnected => {
            let _ = state
                .db
                .whatsapp_set_issue(
                    community,
                    "number_disconnected",
                    "Meta reports the number is not connected.",
                    Utc::now(),
                )
                .await;
            channel::post_notice(
                state,
                tenant,
                "number_disconnected",
                "Meta reports the number is not connected.",
            )
            .await;
        }
        FailureKind::Other => {
            channel::post_notice(
                state,
                tenant,
                "send_failed",
                &format!(
                    "A send to {} failed: {}",
                    e164(&message.wa_id),
                    text.chars().take(200).collect::<String>()
                ),
            )
            .await;
        }
    }
}

/// Retry the Colony posts that failed after the message was stored or sent.
pub async fn repair_unposted(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    channel_id: Option<Uuid>,
) {
    let Some(channel_id) = channel_id else {
        return;
    };
    let community = tenant.community();
    let drafts = match state
        .db
        .whatsapp_list_unposted_drafts(community, UNPOSTED_PER_TICK)
        .await
    {
        Ok(drafts) => drafts,
        Err(error) => {
            tracing::warn!(%community, "whatsapp unposted draft lookup failed: {error}");
            Vec::new()
        }
    };
    for message in drafts {
        let Ok(Some(contact)) = state
            .db
            .whatsapp_get_contact(community, &message.wa_id)
            .await
        else {
            continue;
        };
        if let Err(error) =
            channel::post_for_message(state, tenant, channel_id, &contact, &message).await
        {
            tracing::warn!(%community, message = %message.id, "whatsapp draft post retry failed: {error}");
        }
    }
    let pending = match state
        .db
        .whatsapp_list_unposted(community, UNPOSTED_PER_TICK)
        .await
    {
        Ok(pending) => pending,
        Err(error) => {
            tracing::warn!(%community, "whatsapp unposted lookup failed: {error}");
            return;
        }
    };
    for message in pending {
        let Ok(Some(contact)) = state
            .db
            .whatsapp_get_contact(community, &message.wa_id)
            .await
        else {
            continue;
        };
        if let Err(error) =
            channel::post_for_message(state, tenant, channel_id, &contact, &message).await
        {
            tracing::warn!(%community, message = %message.id, "whatsapp post retry failed: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 29, 10, 0, 0)
            .single()
            .expect("time")
    }

    fn contact() -> WhatsappContact {
        WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: "Thabo".into(),
            lead_id: None,
            owner_pubkey: None,
            thread_root_event_id: None,
            last_inbound_at: None,
            last_outbound_at: None,
            outbound_since_inbound: 0,
            opted_out_at: None,
            opt_out_reason: None,
            paused_at: None,
            pause_reason: None,
            created_at: now() - Duration::days(3),
        }
    }

    fn ctx<'a>(
        contact: Option<&'a WhatsappContact>,
        is_template: bool,
        is_owner_admin: bool,
    ) -> SendContext<'a> {
        SendContext {
            contact,
            send_paused: false,
            pause_reason: None,
            pending_outbound: 0,
            now: now(),
            is_owner_admin,
            is_template,
        }
    }

    #[test]
    fn free_text_needs_an_open_window() {
        let mut c = contact();
        assert!(check_send(&ctx(Some(&c), false, true))
            .unwrap_err()
            .contains("24 hour window"));
        assert!(check_send(&ctx(None, false, true)).is_err());
        c.last_inbound_at = Some(now() - Duration::hours(23));
        assert_eq!(
            check_send(&ctx(Some(&c), false, false)),
            Ok(SendPlan {
                kind: "text",
                new_chat: false
            })
        );
        c.last_inbound_at = Some(now() - Duration::hours(25));
        assert!(check_send(&ctx(Some(&c), false, true)).is_err());
    }

    #[test]
    fn templates_to_new_chats_need_a_batch_unless_owner_or_admin() {
        let c = contact();
        assert_eq!(
            check_send(&ctx(Some(&c), true, false)).unwrap_err(),
            "new chats need an approved batch"
        );
        assert_eq!(
            check_send(&ctx(Some(&c), true, true)),
            Ok(SendPlan {
                kind: "template",
                new_chat: true
            })
        );
        let mut open = contact();
        open.last_inbound_at = Some(now() - Duration::hours(1));
        assert_eq!(
            check_send(&ctx(Some(&open), true, false)),
            Ok(SendPlan {
                kind: "template",
                new_chat: false
            })
        );
    }

    #[test]
    fn opted_out_and_paused_contacts_are_refused_with_the_reason() {
        let mut c = contact();
        c.opted_out_at = Some(now() - Duration::days(1));
        let refusal = check_send(&ctx(Some(&c), true, true)).unwrap_err();
        assert!(
            refusal.starts_with("contact opted out on 2026-10-28"),
            "{refusal}"
        );
        let mut paused = contact();
        paused.paused_at = Some(now());
        paused.pause_reason = Some("Meta error 131049".into());
        assert!(check_send(&ctx(Some(&paused), true, true))
            .unwrap_err()
            .contains("131049"));
    }

    #[test]
    fn never_two_messages_in_a_row_without_a_reply() {
        let mut c = contact();
        c.last_inbound_at = Some(now() - Duration::hours(1));
        c.outbound_since_inbound = 1;
        assert!(check_send(&ctx(Some(&c), false, true))
            .unwrap_err()
            .contains("one message at a time"));
        c.outbound_since_inbound = 0;
        let mut queued = ctx(Some(&c), false, true);
        queued.pending_outbound = 1;
        assert!(check_send(&queued)
            .unwrap_err()
            .contains("one message at a time"));
    }

    #[test]
    fn only_an_owner_or_admin_message_is_queued_at_once() {
        // GUARD: every agent message starts as a draft the sender never reads.
        assert_eq!(initial_state(Access::OwnerAdmin), "queued");
        assert_eq!(initial_state(Access::Outreach), "draft");
        assert_eq!(initial_state(Access::Member), "draft");
    }

    #[test]
    fn a_paused_company_sends_nothing() {
        let c = contact();
        let mut paused = ctx(Some(&c), true, true);
        paused.send_paused = true;
        paused.pause_reason = Some("Quality rating is RED. Sending stopped.");
        assert!(check_send(&paused)
            .unwrap_err()
            .contains("Quality rating is RED"));
    }

    #[test]
    fn graph_requests_are_built_from_stored_messages() {
        let mut message = WhatsappMessage {
            id: Uuid::nil(),
            wa_id: "27821234567".into(),
            direction: "out".into(),
            kind: "template".into(),
            body: "Hi Thabo".into(),
            template_name: Some("intro".into()),
            template_language: Some("en".into()),
            params: serde_json::json!(["Thabo"]),
            state: "ready".into(),
            skip_reason: None,
            wamid: None,
            error_code: None,
            error_text: None,
            event_id: None,
            batch_id: None,
            batch_idx: None,
            new_chat: true,
            send_after: None,
            sender_pubkey: None,
            sent_at: None,
            created_at: now(),
        };
        assert_eq!(
            build_request(&message),
            Ok(SendRequest::Template {
                to: "27821234567".into(),
                name: "intro".into(),
                language: "en".into(),
                params: vec!["Thabo".into()],
            })
        );
        message.kind = "text".into();
        assert_eq!(
            build_request(&message),
            Ok(SendRequest::Text {
                to: "27821234567".into(),
                body: "Hi Thabo".into()
            })
        );
        message.kind = "template".into();
        message.template_name = None;
        assert!(build_request(&message).is_err());
    }
}
