//! Broker for payment link cards (kind 47070, relay-signed head kind 30680).
//!
//! Contract: `docs/money-rails-pay-contract.md`. The relay resolves who the caller is and reads
//! the invoice and the connection; `buzz_core::money_rails::link` owns every rule (atomic
//! approve, void on edit, the only ways a card reaches Paid). This module stores the result
//! together with the side effects (recipient row, durable jobs) in one transaction.
//!
//! The relay's own transitions (link created, delivered, expired, payment verified) go through
//! [`apply_system_op`] under the same head lock, so a member command and a job never race.

use std::sync::Arc;

use chrono::{DateTime, Utc};
use nostr::Event;
use serde_json::json;
use uuid::Uuid;

use buzz_core::kind::{KIND_PAYMENT_LINK_ACTION, KIND_PAYMENT_LINK_HEAD};
use buzz_core::money_rails::link::{
    apply_link_action, apply_system, LinkAction, LinkActor, LinkChange, LinkContext, LinkEffect,
    LinkHead, LinkOp, LinkState, SystemOp,
};
use buzz_core::money_rails::refusal::check_step;
use buzz_core::money_rails::{link_d_tag, ErrorKind, MoneyError, RecipientChannel, Route};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, duplicate_result, forbidden, internal, invalid,
};
use super::company_initiative::{commit_head, load_head, lock_current_head, HeadWrite};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::money_rails::{derived_event_id, read_invoice, resolve_connection};
use crate::state::AppState;

/// Name of the advisory lock family for card heads.
const LOCK_NAME: &str = "money-pay-link";

/// Maps a money rails refusal to the relay's rejection text, keeping the stable code visible.
pub(crate) fn map_money_error(error: MoneyError) -> IngestError {
    let text = format!("{} [{}]", error.message, error.code);
    match error.kind {
        ErrorKind::Invalid => invalid(text),
        ErrorKind::Forbidden => forbidden(text),
        ErrorKind::Conflict => conflict(text),
    }
}

fn channel_str(channel: RecipientChannel) -> &'static str {
    match channel {
        RecipientChannel::Whatsapp => "whatsapp",
        RecipientChannel::Email => "email",
    }
}

fn at(secs: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(secs, 0).unwrap_or_else(Utc::now)
}

/// Reads a card head by id.
pub(crate) async fn read_link(
    state: &AppState,
    community: CommunityId,
    link_id: Uuid,
) -> Result<Option<(StoredEvent, LinkHead)>, IngestError> {
    let stored = load_head(
        state,
        community,
        KIND_PAYMENT_LINK_HEAD,
        &link_d_tag(link_id),
    )
    .await?;
    stored
        .map(|stored| {
            serde_json::from_str::<LinkHead>(&stored.event.content)
                .map(|head| (stored, head))
                .map_err(|error| internal(format!("stored payment link head is invalid: {error}")))
        })
        .transpose()
}

/// Handles a payment link command (kind 47070).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_PAYMENT_LINK_ACTION {
        return Err(invalid("payment link action has the wrong event kind"));
    }
    let action = serde_json::from_str::<LinkAction>(&event.content)
        .map_err(|error| invalid(format!("payment link action: {error}")))?;
    action.validate().map_err(map_money_error)?;
    if event.verify().is_err() {
        return Err(invalid("payment link action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write payment links",
        ));
    }
    let d_tag = command_d_tag(&event, "payment link")?;
    if d_tag != action.d_tag() {
        return Err(invalid("payment link command d tag must match its card"));
    }
    apply(tenant, state, &event, auth.pubkey(), action, d_tag).await
}

async fn apply(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
    actor: &nostr::PublicKey,
    action: LinkAction,
    d_tag: String,
) -> Result<IngestResult, IngestError> {
    let community = tenant.community();
    let role = crate::money_rails::access_for(state, tenant, actor)
        .await
        .map_err(internal)?;

    // Facts the rules need, read before the lock. The head is re-read under the lock below, and
    // approve re-checks every fact against it.
    let unlocked = read_link(state, community, action.link_id).await?;
    let invoice_id = action
        .invoice_id
        .or_else(|| unlocked.as_ref().map(|(_, head)| head.invoice_id));
    let connection_id = action
        .connection_id
        .or_else(|| unlocked.as_ref().map(|(_, head)| head.connection_id));
    let invoice = match invoice_id {
        Some(id) => read_invoice(state, community, id)
            .await
            .map_err(internal)?
            .map(|read| read.facts),
        None => None,
    };
    let connection = resolve_connection(state, community, connection_id)
        .await
        .map_err(internal)?
        .map(|loaded| loaded.facts());

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    let already_stored = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community.as_uuid())
    .bind(event.id.to_bytes().as_slice())
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    if already_stored {
        return Ok(duplicate_result(event));
    }
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_PAYMENT_LINK_HEAD,
        &d_tag,
        LOCK_NAME,
    )
    .await?;
    if action.op != LinkOp::Draft {
        check_expected_head(
            "payment link",
            action.expected_head_event_id.as_deref(),
            current_head_id.as_deref(),
        )?;
    }
    let current = current_stored.as_ref().map(parse_head).transpose()?;
    let now = Utc::now().timestamp();
    let context = LinkContext {
        now,
        actor: LinkActor {
            pubkey: actor.to_hex(),
            role,
        },
        invoice,
        connection,
        action_event_id: event.id.to_hex(),
        new_recipient_ref: Uuid::new_v4(),
    };
    let change = apply_link_action(current.as_ref(), &action, &context).map_err(map_money_error)?;
    let outcome = match change {
        LinkChange::Unchanged(message) => {
            return Ok(IngestResult {
                event_id: event.id.to_hex(),
                accepted: true,
                message: message.into(),
            });
        }
        LinkChange::Changed(outcome) => *outcome,
    };
    apply_effects_tx(
        &mut tx,
        community,
        action.link_id,
        &outcome.head,
        &outcome.effects,
        &actor.to_hex(),
    )
    .await?;
    let head_json = serde_json::to_string(&outcome.head).map_err(internal)?;
    commit_head(
        tenant,
        state,
        tx,
        event,
        &actor.to_hex(),
        HeadWrite {
            head_kind: KIND_PAYMENT_LINK_HEAD,
            action_kind: KIND_PAYMENT_LINK_ACTION,
            d_tag: &d_tag,
            head_json,
            current_head_id,
            current_stored,
            label: "payment link",
        },
    )
    .await
}

fn parse_head(stored: &StoredEvent) -> Result<LinkHead, IngestError> {
    serde_json::from_str::<LinkHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored payment link head is invalid: {error}")))
}

/// Carries out the side effects of a head change inside the same transaction.
pub(crate) async fn apply_effects_tx(
    tx: &mut sqlx::Transaction<'static, sqlx::Postgres>,
    community: CommunityId,
    link_id: Uuid,
    head: &LinkHead,
    effects: &[LinkEffect],
    actor_pubkey: &str,
) -> Result<(), IngestError> {
    use buzz_db::money_rails::{
        money_cancel_jobs_tx, money_enqueue_job_tx, money_insert_recipient_tx,
    };
    let now = Utc::now();
    for effect in effects {
        match effect {
            LinkEffect::PutRecipient {
                recipient_ref,
                channel,
                address,
                name,
            } => {
                money_insert_recipient_tx(
                    &mut **tx,
                    community,
                    *recipient_ref,
                    link_id,
                    channel_str(*channel),
                    address,
                    name,
                )
                .await
                .map_err(internal)?;
            }
            LinkEffect::QueueCreate => {
                money_enqueue_job_tx(&mut **tx, community, link_id, "create", &json!({}), now)
                    .await
                    .map_err(internal)?;
                enqueue_expiry(tx, community, link_id, head).await?;
            }
            LinkEffect::WakeBrowser => {
                if let Some(grant) = &head.browser_grant {
                    money_enqueue_job_tx(
                        &mut **tx,
                        community,
                        link_id,
                        "grant",
                        &json!({}),
                        at(grant.until),
                    )
                    .await
                    .map_err(internal)?;
                }
                enqueue_expiry(tx, community, link_id, head).await?;
            }
            LinkEffect::QueueSend => {
                money_enqueue_job_tx(
                    &mut **tx,
                    community,
                    link_id,
                    "send",
                    &json!({ "actor": approver_of(head, actor_pubkey) }),
                    now,
                )
                .await
                .map_err(internal)?;
            }
            LinkEffect::CancelJobs => {
                money_cancel_jobs_tx(&mut **tx, community, link_id)
                    .await
                    .map_err(internal)?;
            }
            LinkEffect::WriteEvidence {
                source,
                reference,
                amount_minor,
                currency,
                at: paid_at,
                notice_id,
            } => {
                let payload = json!({
                    "actor": approver_of(head, actor_pubkey),
                    "source": source,
                    "reference": reference,
                    "amountMinor": amount_minor,
                    "currency": currency,
                    "at": paid_at,
                    "noticeId": notice_id,
                });
                money_enqueue_job_tx(&mut **tx, community, link_id, "evidence", &payload, now)
                    .await
                    .map_err(internal)?;
            }
        }
    }
    Ok(())
}

/// The person whose authority backs relay-made writes for this card: whoever approved it,
/// else the person who acted.
fn approver_of(head: &LinkHead, actor_pubkey: &str) -> String {
    head.approval
        .as_ref()
        .map(|approval| approval.approved_by.clone())
        .unwrap_or_else(|| actor_pubkey.to_owned())
}

async fn enqueue_expiry(
    tx: &mut sqlx::Transaction<'static, sqlx::Postgres>,
    community: CommunityId,
    link_id: Uuid,
    head: &LinkHead,
) -> Result<(), IngestError> {
    if let Some(expires_at) = head.expires_at {
        buzz_db::money_rails::money_enqueue_job_tx(
            &mut **tx,
            community,
            link_id,
            "expire",
            &json!({}),
            at(expires_at),
        )
        .await
        .map_err(internal)?;
    }
    Ok(())
}

/// What a relay transition did.
pub(crate) enum SystemApplied {
    /// Nothing changed.
    Unchanged,
    /// The new head.
    Changed(Box<LinkHead>),
}

/// Applies a relay transition to a card under the head lock and stores the new head with its
/// side effects. Idempotent: a repeat finds the card already moved on and changes nothing.
pub(crate) async fn apply_system_op(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    link_id: Uuid,
    op: SystemOp,
) -> Result<SystemApplied, IngestError> {
    let community = tenant.community();
    let d_tag = link_d_tag(link_id);
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_PAYMENT_LINK_HEAD,
        &d_tag,
        LOCK_NAME,
    )
    .await?;
    let Some(stored) = current_stored.as_ref() else {
        return Err(conflict("there is no payment link card with this id"));
    };
    let current = parse_head(stored)?;
    let now = Utc::now().timestamp();
    let source_id = derived_event_id("system", link_id, current.version.saturating_add(1));
    let change = apply_system(&current, &op, now, &source_id).map_err(map_money_error)?;
    let outcome = match change {
        LinkChange::Unchanged(_) => return Ok(SystemApplied::Unchanged),
        LinkChange::Changed(outcome) => *outcome,
    };
    let actor = outcome
        .head
        .approval
        .as_ref()
        .map(|approval| approval.approved_by.clone())
        .unwrap_or_else(|| outcome.head.drafted_by.clone());
    apply_effects_tx(
        &mut tx,
        community,
        link_id,
        &outcome.head,
        &outcome.effects,
        &actor,
    )
    .await?;
    commit_head_only(
        tenant,
        state,
        tx,
        HeadOnly {
            head_kind: KIND_PAYMENT_LINK_HEAD,
            d_tag: &d_tag,
            head_json: serde_json::to_string(&outcome.head).map_err(internal)?,
            current_head_id,
            current_stored,
        },
    )
    .await?;
    Ok(SystemApplied::Changed(Box::new(outcome.head)))
}

/// A head to replace without a member action (a relay transition).
pub(crate) struct HeadOnly<'a> {
    /// Kind of the relay-signed head.
    pub head_kind: u32,
    /// The record's d-tag.
    pub d_tag: &'a str,
    /// The new head as JSON.
    pub head_json: String,
    /// The current head event id, `None` while no head exists.
    pub current_head_id: Option<Vec<u8>>,
    /// The current head event, if any.
    pub current_stored: Option<StoredEvent>,
}

/// Replaces the head and commits, with no member action to store (a relay transition).
pub(crate) async fn commit_head_only(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    mut tx: sqlx::Transaction<'static, sqlx::Postgres>,
    write: HeadOnly<'_>,
) -> Result<(), IngestError> {
    let community = tenant.community();
    let head_event = super::company_cofounder::relay_head_event(
        state,
        write.head_kind,
        write.d_tag,
        write.head_json,
        write.current_stored.as_ref(),
    )?;
    let precondition = write.current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community,
            &head_event,
            write.d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict(
            "the record changed before the transition could commit; it will be retried",
        ));
    }
    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        write.head_kind,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(())
}

/// What the browser step check decided.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GrantDecision {
    /// May the step run without the on-screen confirmation.
    pub allow: bool,
    /// Stable code.
    pub code: &'static str,
    /// Plain words.
    pub reason: String,
    /// When the grant ends.
    pub until: Option<i64>,
}

impl GrantDecision {
    fn deny(code: &'static str, reason: &str, until: Option<i64>) -> Self {
        Self {
            allow: false,
            code,
            reason: reason.to_owned(),
            until,
        }
    }
}

/// Decides one browser step for an approved card and, when it allows, stamps the grant used in
/// the same transaction (compare and set), so a second call is refused.
pub(crate) async fn use_browser_grant(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    link_id: Uuid,
    host: &str,
    kind: &str,
    label: &str,
    url: &str,
) -> Result<GrantDecision, IngestError> {
    let community = tenant.community();
    let d_tag = link_d_tag(link_id);
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    let (current_head_id, current_stored) = lock_current_head(
        state,
        &mut tx,
        community,
        KIND_PAYMENT_LINK_HEAD,
        &d_tag,
        LOCK_NAME,
    )
    .await?;
    let Some(stored) = current_stored.as_ref() else {
        return Ok(GrantDecision::deny(
            "card_not_approved",
            "There is no such card.",
            None,
        ));
    };
    let head = parse_head(stored)?;
    let now = Utc::now().timestamp();
    let until = head.browser_grant.as_ref().map(|grant| grant.until);
    if head.state != LinkState::CreatingLink
        || head.route != Route::Browser
        || !head.approval_is_valid()
    {
        return Ok(GrantDecision::deny(
            "card_not_approved",
            "The card is not approved for a browser step.",
            until,
        ));
    }
    let Some(grant) = head.browser_grant.clone() else {
        return Ok(GrantDecision::deny(
            "no_grant",
            "This card has no browser permission.",
            None,
        ));
    };
    if grant.used_at.is_some() {
        return Ok(GrantDecision::deny(
            "grant_used",
            "The one Create step this card allowed was already used.",
            until,
        ));
    }
    if now >= grant.until {
        return Ok(GrantDecision::deny(
            "grant_expired",
            "The 15 minute window for this card ran out.",
            until,
        ));
    }
    if host != grant.host {
        return Ok(GrantDecision::deny(
            "host_mismatch",
            "This card only allows its provider's dashboard.",
            until,
        ));
    }
    if kind != "create" {
        return Ok(GrantDecision::deny(
            "kind_not_allowed",
            "Only the Create step is allowed without a confirmation.",
            until,
        ));
    }
    if let Err(refusal) = check_step(label, url) {
        return Ok(GrantDecision {
            allow: false,
            code: refusal.code,
            reason: refusal.into_error().message,
            until,
        });
    }
    let mut next = head.clone();
    if let Some(next_grant) = next.browser_grant.as_mut() {
        next_grant.used_at = Some(now);
    }
    next.version = next.version.saturating_add(1);
    next.updated_at = now;
    next.source_event_id = derived_event_id("grant", link_id, next.version);
    commit_head_only(
        tenant,
        state,
        tx,
        HeadOnly {
            head_kind: KIND_PAYMENT_LINK_HEAD,
            d_tag: &d_tag,
            head_json: serde_json::to_string(&next).map_err(internal)?,
            current_head_id,
            current_stored,
        },
    )
    .await?;
    Ok(GrantDecision {
        allow: true,
        code: "allowed",
        reason: "One Create step is allowed on this provider.".to_owned(),
        until,
    })
}
