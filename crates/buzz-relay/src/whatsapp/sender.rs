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
use buzz_db::whatsapp::{
    FollowUpDraftOutcome, NewOutboundMessage, WhatsappAccountFailure, WhatsappContact,
    WhatsappMessage, WhatsappSendSafety, SEND_REQUEST_IDEMPOTENCY_PREFIX,
};

use super::connect::{note_token_expired, open_secrets, refresh_phone_info, sync_templates};
use super::graph::{GraphError, SendRequest};
use super::inbound::{load_lead_phone_lookup, LeadPhoneLookup, LeadPhoneMatch};
use super::policy::{
    account_retry_error_codes, classify_failure_code, decide_new_chat, decide_owner_send_now, e164,
    normalize_wa_id, render_template, row_gap, sast_day_start, window_open, FailureKind,
    NewChatDecision,
};
use super::{channel, Access};
use crate::state::AppState;

const TICK: StdDuration = StdDuration::from_secs(5);
const LEASE_SECS: i64 = 120;
const SENDABLE_PER_TICK: i64 = 25;
const CONTACT_LEAD_LINKS_PER_TICK: i64 = 25;
const UNPOSTED_PER_TICK: i64 = 25;
const CONTACT_LEAD_LINK_RETRY: Duration = Duration::hours(1);
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
    /// A relay-owned follow-up draft. These intentionally bypass the ordinary one-message
    /// guard, but retain every pause, suppression, window and send-time fence.
    pub is_follow_up: bool,
    /// A durable direct or business-scoped safety fence for this recipient.
    pub safety: Option<&'a WhatsappSendSafety>,
}

/// Plain refusal text for an active durable safety fence.
pub fn safety_refusal(safety: &WhatsappSendSafety) -> String {
    match safety.scope.as_str() {
        "never_contact" => format!("never-contact entry: {}", safety.reason),
        "business_stop" => "outreach stopped for the whole business: ".to_string() + &safety.reason,
        "opt_out" => format!("contact opted out: {}", safety.reason),
        _ => format!("outreach safety hold: {}", safety.reason),
    }
}

/// The only business-stop exception: an owner or admin may answer a customer who replied,
/// with free text, while that customer's 24-hour service window is still open. The contact,
/// company and one-message fences below still run after this predicate.
fn inbound_reply_stop_allows_owner_text(
    ctx: &SendContext<'_>,
    safety: &WhatsappSendSafety,
) -> bool {
    !ctx.is_follow_up
        && ctx.is_owner_admin
        && !ctx.is_template
        && safety.is_inbound_reply_business_stop()
        && window_open(
            ctx.contact.and_then(|contact| contact.last_inbound_at),
            ctx.now,
        )
}

/// The rules for one send. Returns the plain reason when the send is refused.
pub fn check_send(ctx: &SendContext<'_>) -> Result<SendPlan, String> {
    if ctx.send_paused {
        return Err(format!(
            "sending is paused: {}",
            ctx.pause_reason.unwrap_or("see the status")
        ));
    }
    if let Some(safety) = ctx.safety {
        if !inbound_reply_stop_allows_owner_text(ctx, safety) {
            return Err(safety_refusal(safety));
        }
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
        if !ctx.is_follow_up && (contact.outbound_since_inbound >= 1 || ctx.pending_outbound > 0) {
            return Err("one message at a time: wait for a reply before sending another".into());
        }
    } else if !ctx.is_follow_up && ctx.pending_outbound > 0 {
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
    if new_chat && !ctx.is_owner_admin && !ctx.is_follow_up {
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

/// Result of preparing the single owner-review draft for a durable follow-up item.
#[derive(Debug, PartialEq, Eq)]
pub enum FollowUpEnqueued {
    /// The item now has one new owner-review draft.
    Draft(Uuid),
    /// A previous request already owns this item's draft.
    Duplicate(Uuid),
    /// The sequence remains safely held with this visible reason.
    Held(String),
    /// The scheduled time has not arrived.
    NotDue,
    /// A reply, opt-out or other terminal safety rule ended it.
    Stopped(String),
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
        .whatsapp_ensure_contact(community, &wa_id, None)
        .await
        .map_err(|error| error.to_string())?;
    let mut lead_lookup = None;
    let contact = link_contact_for_sender(state, tenant, contact, &mut lead_lookup).await?;
    let pending = state
        .db
        .whatsapp_count_pending_outbound(community, &wa_id)
        .await
        .map_err(|error| error.to_string())?;
    let safety = state
        .db
        .whatsapp_send_safety(community, &wa_id, contact.lead_id.as_deref())
        .await
        .map_err(|error| error.to_string())?;
    let plan = check_send(&SendContext {
        contact: Some(&contact),
        send_paused: settings.send_paused,
        pause_reason: settings.pause_reason.as_deref(),
        pending_outbound: pending,
        now,
        is_owner_admin: access.is_owner_admin(),
        is_template: command.template.is_some(),
        is_follow_up: false,
        safety: safety.as_ref(),
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
        idempotency_key: format!("{SEND_REQUEST_IDEMPOTENCY_PREFIX}{}", command.request_id),
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

/// Prepare the only allowed owner-review draft for a due follow-up. This deliberately does not
/// call [`initial_state`]: even an owner requesting a follow-up gets a draft, never an automatic
/// queue entry. The database locks and rechecks the due item immediately before insertion.
pub async fn enqueue_follow_up_send(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    sender: &[u8],
    due_id: Uuid,
    command: &SendCommand,
) -> Result<FollowUpEnqueued, String> {
    let community = tenant.community();
    let now = Utc::now();
    if command.text.is_some() == command.template.is_some() {
        return Err("send exactly one of text or template".into());
    }
    if command.to.is_some() == command.thread_root.is_some() {
        return Err("name exactly one of to or threadRoot".into());
    }
    let due = state
        .db
        .whatsapp_get_follow_up_due(community, due_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "no such follow-up".to_string())?;
    let requested_wa_id = match (&command.to, &command.thread_root) {
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
    if requested_wa_id != due.wa_id {
        return Err("followUpId belongs to a different WhatsApp recipient".into());
    }
    if state
        .db
        .whatsapp_get_connection(community)
        .await
        .map_err(|error| error.to_string())?
        .is_none()
    {
        let reason = "no WhatsApp number is connected";
        let held = state
            .db
            .whatsapp_hold_follow_up(community, due_id, reason)
            .await
            .map_err(|error| error.to_string())?;
        return Ok(FollowUpEnqueued::Held(
            held.and_then(|item| item.reason)
                .unwrap_or_else(|| reason.to_string()),
        ));
    }
    let contact = state
        .db
        .whatsapp_get_contact(community, &due.wa_id)
        .await
        .map_err(|error| error.to_string())?;
    let Some(contact) = contact else {
        let reason = "the follow-up contact no longer exists";
        let held = state
            .db
            .whatsapp_hold_follow_up(community, due_id, reason)
            .await
            .map_err(|error| error.to_string())?;
        return Ok(FollowUpEnqueued::Held(
            held.and_then(|item| item.reason)
                .unwrap_or_else(|| reason.to_string()),
        ));
    };
    let open = window_open(contact.last_inbound_at, now);
    let (kind, body, template_name, template_language, params) =
        match (&command.text, &command.template) {
            (Some(text), None) => {
                let text = text.trim();
                if text.is_empty() || text.chars().count() > MAX_TEXT_CHARS {
                    return Err(format!(
                        "text must be 1 through {MAX_TEXT_CHARS} characters"
                    ));
                }
                if !open {
                    let reason = "the 24 hour window is closed; choose an approved template";
                    let held = state
                        .db
                        .whatsapp_hold_follow_up(community, due_id, reason)
                        .await
                        .map_err(|error| error.to_string())?;
                    return Ok(FollowUpEnqueued::Held(
                        held.and_then(|item| item.reason)
                            .unwrap_or_else(|| reason.to_string()),
                    ));
                }
                ("text", text.to_string(), None, None, serde_json::json!([]))
            }
            (None, Some(template)) => {
                let stored = state
                    .db
                    .whatsapp_find_template(community, &template.name, &template.language)
                    .await
                    .map_err(|error| error.to_string())?;
                let Some(stored) =
                    stored.filter(|template| template.status.eq_ignore_ascii_case("APPROVED"))
                else {
                    let reason = "an approved WhatsApp template is required for this follow-up";
                    let held = state
                        .db
                        .whatsapp_hold_follow_up(community, due_id, reason)
                        .await
                        .map_err(|error| error.to_string())?;
                    return Ok(FollowUpEnqueued::Held(
                        held.and_then(|item| item.reason)
                            .unwrap_or_else(|| reason.to_string()),
                    ));
                };
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
    let message = NewOutboundMessage {
        id: Uuid::new_v4(),
        wa_id: due.wa_id.clone(),
        kind: kind.to_string(),
        body,
        template_name,
        template_language,
        params,
        state: "draft".to_string(),
        // The due-row lock makes one live draft authoritative. Retried work after an owner has
        // deliberately superseded a held draft needs a fresh row, so the request id remains in
        // the database uniqueness key rather than reusing the retired draft's key.
        idempotency_key: format!("follow-up:{due_id}:{}", command.request_id),
        batch_id: None,
        batch_idx: None,
        new_chat: !open,
        sender_pubkey: sender.to_vec(),
    };
    match state
        .db
        .whatsapp_prepare_follow_up_draft(community, due_id, &message, now)
        .await
        .map_err(|error| error.to_string())?
    {
        FollowUpDraftOutcome::Prepared(id) => {
            let settings = state
                .db
                .whatsapp_ensure_settings(community)
                .await
                .map_err(|error| error.to_string())?;
            if let (Some(channel_id), Ok(Some(stored))) = (
                settings.outreach_channel_id,
                state.db.whatsapp_get_message(community, id).await,
            ) {
                if let Err(error) =
                    channel::post_for_message(state, tenant, channel_id, &contact, &stored).await
                {
                    tracing::warn!(%community, "whatsapp follow-up draft post failed, will retry: {error}");
                }
            }
            Ok(FollowUpEnqueued::Draft(id))
        }
        FollowUpDraftOutcome::Existing(id) => Ok(FollowUpEnqueued::Duplicate(id)),
        FollowUpDraftOutcome::NotFound => Err("no such follow-up".into()),
        FollowUpDraftOutcome::NotDue => Ok(FollowUpEnqueued::NotDue),
        FollowUpDraftOutcome::Held(reason) => Ok(FollowUpEnqueued::Held(reason)),
        FollowUpDraftOutcome::Stopped(reason) => Ok(FollowUpEnqueued::Stopped(reason)),
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

/// Link an unlinked contact from one already-loaded authoritative phone snapshot.
///
/// The conditional write and reload make a concurrent first writer authoritative. The helper
/// never changes the WhatsApp profile name or an existing business link.
async fn link_contact_from_lookup(
    state: &Arc<AppState>,
    community: CommunityId,
    contact: WhatsappContact,
    lookup: &LeadPhoneLookup,
) -> Result<WhatsappContact, String> {
    let LeadPhoneMatch::Unique(lead_id) = lookup.find_lead_by_phone(&contact.wa_id) else {
        return Ok(contact);
    };
    if contact.lead_id.is_some() {
        return Ok(contact);
    }
    state
        .db
        .whatsapp_set_lead(community, &contact.wa_id, &lead_id)
        .await
        .map_err(|error| format!("contact lead link failed: {error}"))?;
    state
        .db
        .whatsapp_get_contact(community, &contact.wa_id)
        .await
        .map_err(|error| format!("linked contact reload failed: {error}"))?
        .ok_or_else(|| "linked WhatsApp contact vanished".to_string())
}

/// Resolve an unlinked contact while lazily sharing one bounded snapshot through a sender pass.
async fn link_contact_for_sender(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    contact: WhatsappContact,
    lookup: &mut Option<LeadPhoneLookup>,
) -> Result<WhatsappContact, String> {
    if contact.lead_id.is_some() {
        return Ok(contact);
    }
    if lookup.is_none() {
        *lookup = Some(load_lead_phone_lookup(state, tenant).await?);
    }
    let Some(lookup) = lookup.as_ref() else {
        return Err("contact lead lookup was not initialized".into());
    };
    link_contact_from_lookup(state, tenant.community(), contact, lookup).await
}

/// Advance one bounded durable page of legacy contacts that were created without a lead id.
///
/// No-match and ambiguous rows receive a retry timestamp. A resolver or database failure
/// propagates before the current row is acknowledged, so it stays due after a restart.
async fn backfill_contact_leads(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    now: DateTime<Utc>,
) -> Result<Option<LeadPhoneLookup>, String> {
    let community = tenant.community();
    let wa_ids = state
        .db
        .whatsapp_list_contacts_needing_lead_link(
            community,
            now - CONTACT_LEAD_LINK_RETRY,
            CONTACT_LEAD_LINKS_PER_TICK,
        )
        .await
        .map_err(|error| format!("contact lead backfill lookup failed: {error}"))?;
    if wa_ids.is_empty() {
        return Ok(None);
    }

    let lookup = load_lead_phone_lookup(state, tenant).await?;
    let mut linked = 0usize;
    let mut unmatched = 0usize;
    let mut ambiguous = 0usize;
    for wa_id in &wa_ids {
        match lookup.find_lead_by_phone(wa_id) {
            LeadPhoneMatch::Unique(lead_id) => {
                if state
                    .db
                    .whatsapp_set_lead(community, wa_id, &lead_id)
                    .await
                    .map_err(|error| format!("contact lead backfill write failed: {error}"))?
                {
                    linked += 1;
                }
            }
            LeadPhoneMatch::None => {
                if state
                    .db
                    .whatsapp_mark_lead_link_checked(community, wa_id, now)
                    .await
                    .map_err(|error| {
                        format!("contact lead backfill acknowledgement failed: {error}")
                    })?
                {
                    unmatched += 1;
                }
            }
            LeadPhoneMatch::Ambiguous => {
                if state
                    .db
                    .whatsapp_mark_lead_link_checked(community, wa_id, now)
                    .await
                    .map_err(|error| {
                        format!("contact lead backfill acknowledgement failed: {error}")
                    })?
                {
                    ambiguous += 1;
                }
            }
        }
    }
    tracing::info!(
        %community,
        checked = wa_ids.len(),
        linked,
        unmatched,
        ambiguous,
        "whatsapp contact lead backfill completed"
    );
    Ok(Some(lookup))
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

    repair_unposted(state, &tenant, settings.outreach_channel_id, now).await;
    // Inbound pictures, stickers and voice notes whose first download did not finish, and the
    // link for messages that were posted before their file arrived. Receiving never waits on
    // the send pause, so this runs before the pause check below.
    super::media::repair(
        state,
        &tenant,
        &connection,
        settings.outreach_channel_id,
        now,
    )
    .await;

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
    if let Err(error) = state
        .db
        .whatsapp_release_due_contact_retries(community, "131049", now)
        .await
    {
        tracing::warn!(%community, "whatsapp delayed-contact retry release failed: {error}");
    }
    let mut lead_lookup = backfill_contact_leads(state, &tenant, now).await?;
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
    // New conversations and follow-ups share the capped, time-windowed outreach lane. Normal
    // replies retain their existing immediate path, while `whatsapp_list_sendable` ensures due
    // follow-ups are considered before new conversations.
    let mut paced_outreach_blocked = false;
    for message in sendable {
        let is_follow_up = state
            .db
            .whatsapp_follow_up_due_for_message(community, message.id)
            .await
            .map_err(|error| error.to_string())?
            .is_some();
        let Some(contact) = state
            .db
            .whatsapp_get_contact(community, &message.wa_id)
            .await
            .map_err(|error| error.to_string())?
        else {
            continue;
        };
        let contact = link_contact_for_sender(state, &tenant, contact, &mut lead_lookup).await?;
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
        let safety = state
            .db
            .whatsapp_send_safety(community, &message.wa_id, contact.lead_id.as_deref())
            .await
            .map_err(|error| error.to_string())?;
        if let Some(safety) = safety.as_ref() {
            // The P0 owner-reply exception is deliberately unavailable to relay-owned follow-ups.
            // Their durable due-item claim independently treats every business stop as terminal.
            let eligible_owner_reply = !is_follow_up
                && safety.is_inbound_reply_business_stop()
                && state
                    .db
                    .whatsapp_is_open_owner_reply(community, message.id, now)
                    .await
                    .map_err(|error| error.to_string())?;
            if !eligible_owner_reply {
                skip(state, community, &message, &safety_refusal(safety)).await;
                continue;
            }
        }
        if is_follow_up && message.kind == "text" && !window_open(contact.last_inbound_at, now) {
            // Do this before the paced-window check. A free-text proposal that just became
            // ineligible must become a visible owner hold now, not wait until tomorrow's send
            // window merely because no Graph call could happen tonight.
            skip(
                state,
                community,
                &message,
                "the 24 hour window closed before the follow-up was sent",
            )
            .await;
            continue;
        }
        if is_follow_up && message.kind == "template" {
            let template_is_approved = match (
                message.template_name.as_deref(),
                message.template_language.as_deref(),
            ) {
                (Some(name), Some(language)) => state
                    .db
                    .whatsapp_get_template(community, name, language)
                    .await
                    .map_err(|error| error.to_string())?
                    .is_some_and(|template| template.status.eq_ignore_ascii_case("APPROVED")),
                _ => false,
            };
            if !template_is_approved {
                skip(
                    state,
                    community,
                    &message,
                    "the follow-up template is no longer approved",
                )
                .await;
                continue;
            }
        }
        if message.new_chat || is_follow_up {
            // A row the owner released with `send_now` skips the window and the gap, so an
            // earlier paced send in this pass must not hold it back. Follow-ups always keep the
            // normal window and pace, even when their contact still has an open service window.
            let released = message.new_chat && message.send_after.is_some();
            if paced_outreach_blocked && !released {
                continue;
            }
            let sent_today = state
                .db
                .whatsapp_count_paced_outreach_since(community, sast_day_start(now))
                .await
                .map_err(|error| error.to_string())?;
            let last = state
                .db
                .whatsapp_last_paced_outreach_at(community)
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
                    paced_outreach_blocked = true;
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
                if message.new_chat || is_follow_up {
                    paced_outreach_blocked = true;
                }
            }
            Err(GraphError::Rejected {
                code,
                message: text,
                ..
            }) => {
                let code_text = code.map(|c| c.to_string()).unwrap_or_default();
                let kind = code
                    .map(classify_failure_code)
                    .unwrap_or(FailureKind::Other);
                if let FailureKind::Account(failure) = kind {
                    match state
                        .db
                        .whatsapp_fail_send_and_pause_account(
                            community,
                            &WhatsappAccountFailure {
                                message_id: message.id,
                                lease_token: lease,
                                error_code: &code_text,
                                error_text: &text,
                                pause_reason: failure.health_title(),
                                at: now,
                            },
                        )
                        .await
                    {
                        Ok(outcome) if outcome.became_unhealthy => {
                            let account_codes = account_retry_error_codes();
                            let waiting = state
                                .db
                                .whatsapp_count_account_health_waiting(community, &account_codes)
                                .await
                                .unwrap_or(0);
                            channel::post_owner_notice(
                                state,
                                &tenant,
                                "account_sending_paused",
                                &failure.health_banner(waiting),
                            )
                            .await;
                        }
                        Ok(_) => {}
                        Err(error) => {
                            tracing::error!(%community, "whatsapp account failure record failed: {error}");
                        }
                    }
                    // Meta says this sender cannot make business sends. Stop this pass even if
                    // recording the fence failed, rather than intentionally burning the queue.
                    break;
                }
                if let Err(error) = state
                    .db
                    .whatsapp_fail_send(community, message.id, lease, &code_text, &text)
                    .await
                {
                    tracing::error!(%community, "whatsapp failure record failed: {error}");
                }
                handle_failure(state, &tenant, &message, code, &text).await;
                if matches!(kind, FailureKind::TokenExpired) {
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
        FailureKind::Account(_) => {
            // The sender and webhook paths persist the account fence atomically with the failed
            // message. Keeping this arm explicit prevents a future caller from treating it as a
            // contact pause or generic notice.
        }
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

/// Retry the Colony posts that failed after the message was stored or sent. A row that fails
/// again backs off (5 s doubling to 1 h) and is dropped from the loop after
/// `POST_MAX_ATTEMPTS` (24) failures, so one permanent refusal cannot starve the rows behind it
/// or retry for ever. The message stays in the database and in the thread API either way.
pub async fn repair_unposted(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    channel_id: Option<Uuid>,
    now: DateTime<Utc>,
) {
    let Some(channel_id) = channel_id else {
        return;
    };
    let community = tenant.community();
    let drafts = match state
        .db
        .whatsapp_list_unposted_drafts(community, UNPOSTED_PER_TICK, now)
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
            note_post_failure(state, community, &message, now).await;
        }
    }
    let pending = match state
        .db
        .whatsapp_list_unposted(community, UNPOSTED_PER_TICK, now)
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
            note_post_failure(state, community, &message, now).await;
        }
    }
}

/// Schedule the next retry of a failed Colony post, or give up after the last attempt. A
/// failure to record is logged and the row is simply tried again on the next pass.
async fn note_post_failure(
    state: &Arc<AppState>,
    community: CommunityId,
    message: &WhatsappMessage,
    now: DateTime<Utc>,
) {
    match state
        .db
        .whatsapp_note_post_failure(community, message.id, now)
        .await
    {
        Ok((attempts, true)) => {
            tracing::error!(%community, message = %message.id, attempts, "whatsapp post gave up: the message stays in the thread API but has no Colony message");
        }
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(%community, message = %message.id, "whatsapp post failure record failed: {error}");
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
            retry_after: None,
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
            is_follow_up: false,
            safety: None,
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
    fn a_business_or_never_contact_safety_hold_refuses_every_send_shape() {
        let c = contact();
        for safety in [
            WhatsappSendSafety {
                scope: "never_contact".into(),
                reason: "owner requested no contact".into(),
                matched_rule: None,
                business_id: None,
            },
            WhatsappSendSafety {
                scope: "business_stop".into(),
                reason: "inbound reply received".into(),
                matched_rule: None,
                business_id: Some("business-1".into()),
            },
        ] {
            let mut context = ctx(Some(&c), true, true);
            context.safety = Some(&safety);
            assert!(
                check_send(&context).is_err(),
                "{} must prevent this send",
                safety.scope
            );
        }
    }

    #[test]
    fn inbound_reply_stop_allows_only_an_owner_in_window_free_text_reply() {
        let mut open = contact();
        open.last_inbound_at = Some(now() - Duration::hours(1));
        let inbound_reply_stop = WhatsappSendSafety {
            scope: "business_stop".into(),
            reason: "inbound reply received".into(),
            matched_rule: None,
            business_id: Some("business-1".into()),
        };

        let mut owner_text = ctx(Some(&open), false, true);
        owner_text.safety = Some(&inbound_reply_stop);
        assert_eq!(
            check_send(&owner_text),
            Ok(SendPlan {
                kind: "text",
                new_chat: false,
            })
        );

        // A relay-owned follow-up must not inherit the P0 owner-reply exception. Its own
        // durable scheduling and send-time predicates treat every business reply as a stop.
        let mut follow_up_owner_text = ctx(Some(&open), false, true);
        follow_up_owner_text.is_follow_up = true;
        follow_up_owner_text.safety = Some(&inbound_reply_stop);
        assert!(check_send(&follow_up_owner_text).is_err());

        let mut owner_template = ctx(Some(&open), true, true);
        owner_template.safety = Some(&inbound_reply_stop);
        assert!(check_send(&owner_template).is_err());

        let mut agent_text = ctx(Some(&open), false, false);
        agent_text.safety = Some(&inbound_reply_stop);
        assert!(check_send(&agent_text).is_err());

        let mut closed = contact();
        closed.last_inbound_at = Some(now() - Duration::hours(25));
        let mut closed_owner_text = ctx(Some(&closed), false, true);
        closed_owner_text.safety = Some(&inbound_reply_stop);
        assert!(check_send(&closed_owner_text).is_err());

        let opt_out_stop = WhatsappSendSafety {
            scope: "business_stop".into(),
            reason: "contact opted out".into(),
            matched_rule: Some("en_stop".into()),
            business_id: Some("business-1".into()),
        };
        let mut owner_after_opt_out = ctx(Some(&open), false, true);
        owner_after_opt_out.safety = Some(&opt_out_stop);
        assert!(check_send(&owner_after_opt_out).is_err());

        let never_contact = WhatsappSendSafety {
            scope: "never_contact".into(),
            reason: "owner request".into(),
            matched_rule: None,
            business_id: None,
        };
        let mut owner_never_contact = ctx(Some(&open), false, true);
        owner_never_contact.safety = Some(&never_contact);
        assert!(check_send(&owner_never_contact).is_err());
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
    fn relay_follow_up_bypasses_only_the_old_outbound_counter() {
        let mut c = contact();
        c.last_inbound_at = Some(now() - Duration::hours(1));
        c.outbound_since_inbound = 1;
        let mut follow_up = ctx(Some(&c), false, false);
        follow_up.is_follow_up = true;
        assert_eq!(
            check_send(&follow_up),
            Ok(SendPlan {
                kind: "text",
                new_chat: false,
            })
        );

        // The exception is narrowly scoped: a sender pause still wins over the durable item.
        follow_up.send_paused = true;
        assert!(check_send(&follow_up)
            .unwrap_err()
            .contains("sending is paused"));
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
