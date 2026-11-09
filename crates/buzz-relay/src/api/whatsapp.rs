//! WhatsApp outreach HTTP surface: secret intake, role filtered reads, and Meta's webhook.
//!
//! HTTP is used only where an event cannot work: the access token and app secret must not
//! travel as a stored event, and phone numbers plus opt-out state are private to the owner,
//! admins and the Outreach channel, so reads are filtered by role instead of fanned out.
//! Contract: `docs/whatsapp-outreach.md`.

use std::collections::HashSet;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use buzz_db::whatsapp::{
    OutreachFlags, WhatsappBatch, WhatsappBusinessStop, WhatsappContact, WhatsappFollowUpDue,
    WhatsappFollowUpSequence, WhatsappMedia, WhatsappMessage, WhatsappSuppression,
    WhatsappTemplate,
};

use super::{api_error, api_error_with_code, gifs, internal_error};
use crate::state::AppState;
use crate::whatsapp::connect::{self, ConnectError};
use crate::whatsapp::desk;
use crate::whatsapp::inbound::process_payload;
use crate::whatsapp::policy::{
    contact_label, e164, failure_can_retry, failure_summary_for_code, is_contact_engagement_limit,
    next_window_start, normalize_wa_id, retry_scope_for_error_code, verify_signature,
    verify_token_matches, window_closes_at, window_open, MAX_WEBHOOK_BODY_BYTES,
};
use crate::whatsapp::{access_for, Access};

/// Route of the connect endpoint.
pub(crate) const CONNECT_PATH: &str = "/api/whatsapp/connect";
/// Route of the disconnect endpoint.
pub(crate) const DISCONNECT_PATH: &str = "/api/whatsapp/disconnect";
/// Route of the read endpoint.
pub(crate) const QUERY_PATH: &str = "/api/whatsapp/query";

const DEFAULT_LIST_LIMIT: i64 = 50;
const MAX_SAFETY_CHECK_IDENTITIES: usize = 500;
const SIGNATURE_HEADER: &str = "x-hub-signature-256";
/// A desktop that knows the `queued` contact-stage enum sends this marker on every query.
/// Its absence means the relay must project the legacy-safe `none` stage.
pub(crate) const QUEUED_STAGE_CAPABILITY: &str = "whatsapp-outreach-stage-queued";

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectRequest {
    access_token: String,
    phone_number_id: String,
    waba_id: String,
    app_secret: String,
}

fn connect_error(error: ConnectError) -> (StatusCode, Json<Value>) {
    let status = match &error {
        ConnectError::NotConfigured => StatusCode::SERVICE_UNAVAILABLE,
        ConnectError::Invalid(_) => StatusCode::BAD_REQUEST,
        ConnectError::AlreadyConnected => StatusCode::CONFLICT,
        ConnectError::TokenRejected | ConnectError::GraphUnavailable => StatusCode::BAD_GATEWAY,
        ConnectError::Internal(reason) => {
            tracing::error!("whatsapp connect failed: {reason}");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    api_error_with_code(status, &error.message(), error.code())
}

async fn require_owner_admin(
    state: &Arc<AppState>,
    tenant: &buzz_core::TenantContext,
    pubkey: &nostr::PublicKey,
) -> Result<(), (StatusCode, Json<Value>)> {
    let access = access_for(state, tenant, pubkey)
        .await
        .map_err(|reason| internal_error(&reason))?;
    if access.is_owner_admin() {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::FORBIDDEN,
            "only the owner or an admin can do this",
        ))
    }
}

/// `POST /api/whatsapp/connect`: owner or admin connects the company's number.
pub async fn connect_number(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, CONNECT_PATH, &body).await?;
    require_owner_admin(&state, &tenant, &pubkey).await?;
    let request: ConnectRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid WhatsApp connect JSON"))?;
    let input = connect::validate_input(
        &request.access_token,
        &request.phone_number_id,
        &request.waba_id,
        &request.app_secret,
    )
    .map_err(connect_error)?;
    let status = connect::connect(&state, &tenant, &pubkey, input)
        .await
        .map_err(connect_error)?;
    tracing::info!(community = %tenant.community(), "whatsapp number connected");
    Ok(Json(status))
}

/// `POST /api/whatsapp/disconnect`: owner or admin removes the number and its secrets.
pub async fn disconnect_number(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, DISCONNECT_PATH, &body).await?;
    require_owner_admin(&state, &tenant, &pubkey).await?;
    let status = connect::disconnect(&state, &tenant)
        .await
        .map_err(connect_error)?;
    tracing::info!(community = %tenant.community(), "whatsapp number disconnected");
    Ok(Json(status))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequest {
    what: String,
    #[serde(default)]
    refresh: bool,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    batch_id: Option<String>,
    #[serde(default)]
    wa_id: Option<String>,
    #[serde(default)]
    limit: Option<i64>,
    /// Opt in to rows still waiting for a batch approval. Apps that do not send it never
    /// see a held row, so an older app cannot label one as approved.
    #[serde(default)]
    include_held: bool,
    /// New clients opt in to enum values introduced after desktop-v3.0.37. This is additive so
    /// older clients simply omit it and receive the legacy-safe projection.
    #[serde(default)]
    capabilities: Vec<String>,
    /// Caller-provided candidate identities for a privacy-preserving safety preflight. The
    /// response only echoes candidates that are currently suppressed, never the whole ledger.
    #[serde(default)]
    identities: Vec<SafetyCheckIdentity>,
}

/// One prospective identity submitted by Discovery or a list builder. The persistent ledger is
/// broader than WhatsApp, so these names intentionally remain channel-neutral.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SafetyCheckIdentity {
    kind: String,
    value: String,
}

fn supports_queued_stage(request: &QueryRequest) -> bool {
    request
        .capabilities
        .iter()
        .any(|capability| capability == QUEUED_STAGE_CAPABILITY)
}

fn normalize_suppression_identity(
    kind: &str,
    value: &str,
) -> Result<(String, String), &'static str> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "phone" => normalize_wa_id(value)
            .map(|value| ("phone".to_string(), value))
            .ok_or("phone value must be a phone number"),
        "email" => {
            let value = value.trim().to_ascii_lowercase();
            if value.is_empty()
                || value.len() > 320
                || value.contains(char::is_whitespace)
                || value.matches('@').count() != 1
            {
                return Err("email value must be a valid email address");
            }
            Ok(("email".to_string(), value))
        }
        "domain" => {
            let value = value.trim().trim_end_matches('.').to_ascii_lowercase();
            if value.is_empty()
                || value.len() > 320
                || value.contains(char::is_whitespace)
                || value.contains('/')
                || !value.contains('.')
            {
                return Err("domain value must be a hostname");
            }
            Ok(("domain".to_string(), value))
        }
        _ => Err("identity kind must be phone, email or domain"),
    }
}

fn suppression_view(suppression: &WhatsappSuppression) -> Value {
    json!({
        "id": suppression.id.to_string(),
        "identityKind": suppression.identity_kind,
        "identityValue": suppression.identity_value,
        "scope": suppression.scope,
        "reason": suppression.reason,
        "matchedRule": suppression.matched_rule,
        "source": suppression.source,
        "createdAt": suppression.created_at.to_rfc3339(),
        "undoneAt": suppression.undone_at.map(|at| at.to_rfc3339()),
    })
}

fn business_stop_view(stop: &WhatsappBusinessStop) -> Value {
    json!({
        "businessId": stop.business_id,
        "sourceWaId": stop.source_wa_id,
        "reason": stop.reason,
        "matchedRule": stop.matched_rule,
        "createdAt": stop.created_at.to_rfc3339(),
    })
}

fn template_view(template: &WhatsappTemplate) -> Value {
    connect::template_json(template)
}

/// Follow-up timing is relay state, not a client timer. The view stays additive and uses only
/// stable strings, allowing one- and two-version-old desktops to ignore this new query.
fn follow_up_sequence_view(sequence: &WhatsappFollowUpSequence) -> Value {
    json!({
        "scope": {
            "kind": sequence.scope.kind,
            "id": sequence.scope.id.to_string(),
        },
        "enabled": sequence.enabled,
        "steps": sequence.steps.iter().map(|step| json!({
            "step": step.step,
            "delayDays": step.delay_days,
        })).collect::<Vec<_>>(),
    })
}

fn follow_up_due_view(due: &WhatsappFollowUpDue) -> Value {
    json!({
        "id": due.id.to_string(),
        "scope": {
            "kind": due.scope.kind,
            "id": due.scope.id.to_string(),
        },
        "waId": due.wa_id,
        "businessId": due.business_id,
        "step": due.step,
        "predecessorMessageId": due.predecessor_message_id.to_string(),
        "draftMessageId": due.draft_message_id.map(|id| id.to_string()),
        "dueAt": due.due_at.to_rfc3339(),
        "state": due.state,
        "reason": due.reason,
        "createdAt": due.created_at.to_rfc3339(),
        "updatedAt": due.updated_at.to_rfc3339(),
    })
}

/// One word for where the contact stands, so a contact whose only row still waits for a
/// batch approval is never reported as sent.
fn outreach_status(contact: &WhatsappContact, flags: &OutreachFlags) -> &'static str {
    if contact.opted_out_at.is_some() {
        "opted_out"
    } else if contact.last_inbound_at.is_some() {
        "replied"
    } else if flags.sent {
        "sent"
    } else if flags.queued {
        "queued"
    } else if flags.awaiting_approval {
        "waiting_for_approval"
    } else {
        "none"
    }
}

fn contact_view(
    contact: &WhatsappContact,
    now: chrono::DateTime<Utc>,
    flags: &OutreachFlags,
) -> Value {
    let open = window_open(contact.last_inbound_at, now);
    json!({
        "waId": contact.wa_id,
        "e164": e164(&contact.wa_id),
        "outreachStatus": outreach_status(contact, flags),
        "awaitingApproval": flags.awaiting_approval,
        "hasSentOutbound": flags.sent,
        // A contact with no usable name yet (outbound only, no profile name, or a name such as
        // ".") shows its number rather than an empty string or punctuation.
        "displayName": contact_label(&contact.display_name, &contact.wa_id),
        "leadId": contact.lead_id,
        "ownerPubkey": contact.owner_pubkey.as_ref().map(hex::encode),
        "threadRootEventId": contact.thread_root_event_id.as_ref().map(hex::encode),
        "lastInboundAt": contact.last_inbound_at.map(|at| at.to_rfc3339()),
        "windowOpen": open,
        "windowClosesAt": window_closes_at(contact.last_inbound_at).map(|at| at.to_rfc3339()),
        "optedOut": contact.opted_out_at.is_some(),
        "paused": contact.paused_at.is_some(),
        "pauseReason": contact.pause_reason,
        "unanswered": contact.last_inbound_at.is_some_and(|inbound| {
            contact.opted_out_at.is_none()
                && contact.last_outbound_at.is_none_or(|outbound| outbound < inbound)
        }),
    })
}

/// Additive safety fields for a linked business hold. Older desktops ignore the fields while
/// the desktop safety slice can make the whole-business stop visible in the existing chat row.
fn with_business_stop(mut view: Value, business_stop: Option<&WhatsappBusinessStop>) -> Value {
    if let Some(object) = view.as_object_mut() {
        object.insert(
            "businessOutreachStopped".to_string(),
            json!(business_stop.is_some()),
        );
        object.insert(
            "businessStopReason".to_string(),
            business_stop
                .map(|stop| json!(stop.reason))
                .unwrap_or(Value::Null),
        );
    }
    view
}

/// Add the Outreach desk fields (stage, label, business ...) to a contact view. Additive:
/// older apps ignore them; `displayName` is the owner's label when one is set.
fn with_desk(
    mut view: Value,
    contact: &WhatsappContact,
    desk: &desk::DeskData,
    supports_queued_stage: bool,
) -> Value {
    let facts = desk.facts.get(&contact.wa_id).cloned().unwrap_or_default();
    let lead_id = contact.lead_id.as_deref();
    let fields = desk::desk_fields_for_capability(
        contact,
        &facts,
        lead_id.and_then(|id| desk.leads.get(id)),
        lead_id.and_then(|id| desk.records.get(id)),
        supports_queued_stage,
    );
    if let Some(object) = view.as_object_mut() {
        object.extend(fields);
    }
    view
}

/// The delivery state the app understands. Rows of a pending batch are `held` and approved
/// rows waiting for the send window are `ready`; both read as queued (the app has no other
/// word for "will go out"), with `awaitingApproval` telling them apart. A `skipped` row is a
/// failure with its reason.
fn client_state(state: &str) -> &str {
    match state {
        "held" | "ready" => "queued",
        "skipped" => "failed",
        // The released app has no `received` state and rejects the whole thread for it. An
        // inbound message has been seen by definition, which is what `read` means there.
        "received" => "read",
        other => other,
    }
}

/// When an approved (`ready`) row is expected to go out, so the app can say so. A row the
/// owner released with `send_now` reports that moment; any other new chat waits for the next
/// send window (the pacing gap and the daily cap can still delay it a little); a row that is
/// not a new chat goes out at the next sender pass. `None` for every other state.
fn sends_at(message: &WhatsappMessage, now: chrono::DateTime<Utc>) -> Option<String> {
    if message.state != "ready" {
        return None;
    }
    let at = match message.send_after {
        Some(released) => released,
        None if message.new_chat => next_window_start(now),
        None => now,
    };
    Some(at.to_rfc3339())
}

fn message_view(message: &WhatsappMessage, now: chrono::DateTime<Utc>) -> Value {
    let error_text = message.error_text.clone().or_else(|| {
        message
            .skip_reason
            .clone()
            .filter(|_| message.state == "skipped")
    });
    let state = client_state(&message.state);
    let retry_scope = (state == "failed")
        .then(|| retry_scope_for_error_code(message.error_code.as_deref()).wire())
        .flatten();
    let failure_summary = (state == "failed")
        .then(|| failure_summary_for_code(message.error_code.as_deref()))
        .flatten();
    json!({
        "id": message.id.to_string(),
        "direction": message.direction,
        "kind": message.kind,
        "text": message.body,
        "templateName": message.template_name,
        "state": state,
        "awaitingApproval": message.state == "held",
        "errorCode": message.error_code,
        "errorText": error_text,
        "failureSummary": failure_summary,
        "retryScope": retry_scope,
        "canRetry": state == "failed" && failure_can_retry(message.error_code.as_deref()),
        "canRetryLater": state == "failed" && is_contact_engagement_limit(message.error_code.as_deref()),
        "eventId": message.event_id.as_ref().map(hex::encode),
        "senderPubkey": message.sender_pubkey.as_ref().map(hex::encode),
        "waId": message.wa_id,
        "createdAt": message.created_at.to_rfc3339(),
        "sendsAt": sends_at(message, now),
    })
}

/// How the app and agents see the media of an inbound message. `url` is set once the file is
/// stored (it is served from the community's media host and needs the member's media
/// authorization like any other file). `state` is `stored`, `pending`, `failed`, `gone` or
/// `none` (a location or contact card has nothing to download). `canRetry` is true when the
/// owner may press Retry.
pub(crate) fn media_view(media: &WhatsappMedia, base: &str) -> Value {
    let text = |key: &str| media.media.get(key).and_then(Value::as_str);
    let stored = media.stored.as_ref();
    let stored_text = |key: &str| stored.and_then(|s| s.get(key)).and_then(Value::as_str);
    let state = media.state.as_deref().unwrap_or("none");
    let label = crate::whatsapp::channel::media_label(media);
    let caption = text("caption");
    let description = match caption {
        Some(caption) => format!("Customer sent a {label} with the caption: {caption}"),
        None => format!("Customer sent a {label}"),
    };
    let mut view = json!({
        "type": crate::whatsapp::channel::media_kind(media),
        "state": state,
        "url": crate::whatsapp::channel::media_link(media, base),
        "mime": stored_text("mime").or_else(|| text("mime")),
        "size": stored.and_then(|s| s.get("size")).and_then(Value::as_u64),
        "opaque": stored
            .and_then(|s| s.get("opaque"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        "caption": caption,
        "filename": text("filename"),
        "animated": media.media.get("animated").and_then(Value::as_bool).unwrap_or(false),
        "error": media.error,
        "canRetry": state == "failed" && media.error.as_deref() != Some("too_large")
            && media.error.as_deref() != Some("no_media_id"),
        "description": description,
    });
    if let Some(object) = view.as_object_mut() {
        for key in ["latitude", "longitude", "name", "address", "contacts"] {
            if let Some(value) = media.media.get(key) {
                object.insert(key.to_owned(), value.clone());
            }
        }
    }
    view
}

/// The `contacts` and `inbox` answer: each contact with its outreach status.
#[allow(dead_code)] // Test-only Nostr handlers use the conservative default projection.
pub(crate) async fn contacts_view(
    state: &Arc<AppState>,
    community: buzz_core::tenant::CommunityId,
    contacts: &[WhatsappContact],
    now: chrono::DateTime<Utc>,
) -> Result<Value, (StatusCode, Json<Value>)> {
    // Non-HTTP callers do not carry desktop capability markers. Keep their projection safe for
    // a strict older parser rather than assuming the current desktop is installed everywhere.
    contacts_view_for_capability(state, community, contacts, now, false).await
}

/// Contact view with an explicit wire-compatibility projection. HTTP callers use this rather
/// than the internal default so an installed desktop only sees enum values it advertised.
async fn contacts_view_for_capability(
    state: &Arc<AppState>,
    community: buzz_core::tenant::CommunityId,
    contacts: &[WhatsappContact],
    now: chrono::DateTime<Utc>,
    supports_queued_stage: bool,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let ids: Vec<String> = contacts.iter().map(|c| c.wa_id.clone()).collect();
    let flags = state
        .db
        .whatsapp_outreach_flags(community, &ids)
        .await
        .map_err(|error| internal_error(&format!("whatsapp query: {error}")))?;
    let business_stops = state
        .db
        .whatsapp_business_stops_for_contacts(community, &ids)
        .await
        .map_err(|error| internal_error(&format!("whatsapp query: {error}")))?;
    let desk = desk::load(state, community, contacts)
        .await
        .map_err(|reason| internal_error(&reason))?;
    Ok(json!({
        "contacts": contacts
            .iter()
            .map(|c| {
                let flags = flags.get(&c.wa_id).copied().unwrap_or_default();
                with_desk(
                    with_business_stop(contact_view(c, now, &flags), business_stops.get(&c.wa_id)),
                    c,
                    &desk,
                    supports_queued_stage,
                )
            })
            .collect::<Vec<_>>(),
    }))
}

/// The `thread` answer: the contact and every message of the conversation, oldest first,
/// including rows still waiting for a batch approval.
#[allow(dead_code)] // Test-only Nostr handlers use the conservative default projection.
pub(crate) async fn thread_view(
    state: &Arc<AppState>,
    community: buzz_core::tenant::CommunityId,
    wa_id: &str,
    limit: i64,
    include_held: bool,
    now: chrono::DateTime<Utc>,
) -> Result<Value, (StatusCode, Json<Value>)> {
    // See `contacts_view`: callers without a capability marker must get legacy-safe stages.
    thread_view_for_capability(state, community, wa_id, limit, include_held, now, false).await
}

/// Thread view with the caller's explicitly advertised enum support.
pub(crate) async fn thread_view_for_capability(
    state: &Arc<AppState>,
    community: buzz_core::tenant::CommunityId,
    wa_id: &str,
    limit: i64,
    include_held: bool,
    now: chrono::DateTime<Utc>,
    supports_queued_stage: bool,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let db_error = |error: buzz_db::DbError| internal_error(&format!("whatsapp query: {error}"));
    let contact = state
        .db
        .whatsapp_get_contact(community, wa_id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "no such contact"))?;
    let mut messages = state
        .db
        .whatsapp_list_thread(community, wa_id, limit)
        .await
        .map_err(db_error)?;
    if !include_held {
        messages.retain(|message| message.state != "held");
    }
    messages.reverse();
    let flags = state
        .db
        .whatsapp_outreach_flags(community, std::slice::from_ref(&contact.wa_id))
        .await
        .map_err(db_error)?;
    let flags = flags.get(&contact.wa_id).copied().unwrap_or_default();
    let business_stops = state
        .db
        .whatsapp_business_stops_for_contacts(community, std::slice::from_ref(&contact.wa_id))
        .await
        .map_err(db_error)?;
    let desk = desk::load(state, community, std::slice::from_ref(&contact))
        .await
        .map_err(|reason| internal_error(&reason))?;
    let ids: Vec<Uuid> = messages.iter().map(|message| message.id).collect();
    let media = state
        .db
        .whatsapp_media_for_messages(community, &ids)
        .await
        .map_err(db_error)?;
    let media_base = if media.is_empty() {
        String::new()
    } else {
        let host = state
            .db
            .lookup_community_host(community)
            .await
            .map_err(db_error)?
            .unwrap_or_default();
        crate::api::media::media_base_url_for_tenant(&state.config.relay_url, &host)
    };
    Ok(json!({
        "contact": with_desk(
            with_business_stop(
                contact_view(&contact, now, &flags),
                business_stops.get(&contact.wa_id),
            ),
            &contact,
            &desk,
            supports_queued_stage,
        ),
        "messages": messages
            .iter()
            .map(|message| {
                let mut view = message_view(message, now);
                if let (Some(media), Some(object)) = (media.get(&message.id), view.as_object_mut()) {
                    object.insert("media".to_owned(), media_view(media, &media_base));
                }
                view
            })
            .collect::<Vec<_>>(),
    }))
}

fn row_counts(rows: &[WhatsappMessage]) -> Value {
    let count = |states: &[&str]| {
        rows.iter()
            .filter(|row| states.contains(&row.state.as_str()))
            .count()
    };
    json!({
        "total": rows.len(),
        "ready": count(&["held", "ready", "queued", "sending"]),
        "sent": count(&["sent", "delivered", "read"]),
        "failed": count(&["failed", "unconfirmed", "skipped"]),
        "dropped": count(&["dropped"]),
    })
}

fn batch_view(batch: &WhatsappBatch, rows: &[WhatsappMessage]) -> Value {
    json!({
        "batchId": batch.id.to_string(),
        "status": batch.status,
        "createdBy": hex::encode(&batch.created_by),
        "template": batch.template_name,
        "language": batch.language,
        "note": batch.note,
        "materialLinks": batch.material_links,
        "decidedBy": batch.decided_by.as_ref().map(hex::encode),
        "decidedAt": batch.decided_at.map(|at| at.to_rfc3339()),
        "rows": row_counts(rows),
        "createdAt": batch.created_at.to_rfc3339(),
    })
}

fn limit_of(request: &QueryRequest) -> i64 {
    request.limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, 200)
}

/// `POST /api/whatsapp/query`: role filtered reads. See the contract for each `what`.
pub async fn query(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, QUERY_PATH, &body).await?;
    let request: QueryRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid WhatsApp query JSON"))?;
    let access = access_for(&state, &tenant, &pubkey)
        .await
        .map_err(|reason| internal_error(&reason))?;
    let community = tenant.community();
    let db_error = |error: buzz_db::DbError| internal_error(&format!("whatsapp query: {error}"));
    let now = Utc::now();
    let queued_stage_supported = supports_queued_stage(&request);

    let private = |access: Access| -> Result<(), (StatusCode, Json<Value>)> {
        if access.can_read_private() {
            Ok(())
        } else {
            Err(api_error(
                StatusCode::FORBIDDEN,
                "only the owner, admins, their agents and Outreach members can read this",
            ))
        }
    };

    match request.what.as_str() {
        "status" => {
            let mut status = connect::status_view(&state, &tenant)
                .await
                .map_err(|reason| internal_error(&reason))?;
            // Account-health recovery is an owner/admin affordance. Older and plain-member
            // desktops tolerate omitted optional fields, while owners retain the full status.
            if !access.is_owner_admin() {
                if let Some(object) = status.as_object_mut() {
                    object.remove("accountRetryCount");
                    object.remove("sendHealth");
                    object.remove("healthSummary");
                }
            }
            Ok(Json(status))
        }
        "templates" => {
            if request.refresh {
                if !access.is_owner_admin() {
                    return Err(api_error(
                        StatusCode::FORBIDDEN,
                        "only the owner or an admin can refresh templates",
                    ));
                }
                connect::sync_templates(&state, &tenant)
                    .await
                    .map_err(|reason| {
                        api_error_with_code(
                            StatusCode::BAD_GATEWAY,
                            &reason,
                            "whatsapp_template_sync",
                        )
                    })?;
            }
            let templates = state
                .db
                .whatsapp_list_templates(community)
                .await
                .map_err(db_error)?;
            Ok(Json(
                json!({ "templates": templates.iter().map(template_view).collect::<Vec<_>>() }),
            ))
        }
        "batches" => {
            private(access)?;
            let batches = state
                .db
                .whatsapp_list_batches(community, request.state.as_deref(), limit_of(&request))
                .await
                .map_err(db_error)?;
            let mut out = Vec::with_capacity(batches.len());
            for batch in &batches {
                let rows = state
                    .db
                    .whatsapp_list_batch_rows(community, batch.id)
                    .await
                    .map_err(db_error)?;
                out.push(batch_view(batch, &rows));
            }
            Ok(Json(json!({ "batches": out })))
        }
        "batch" => {
            private(access)?;
            let batch_id = request
                .batch_id
                .as_deref()
                .and_then(|id| Uuid::parse_str(id.trim()).ok())
                .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "batchId must be a UUID"))?;
            let batch = state
                .db
                .whatsapp_get_batch(community, batch_id)
                .await
                .map_err(db_error)?
                .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "no such batch"))?;
            let rows = state
                .db
                .whatsapp_list_batch_rows(community, batch_id)
                .await
                .map_err(db_error)?;
            let mut detail = batch_view(&batch, &rows);
            let mut row_views = Vec::with_capacity(rows.len());
            for row in &rows {
                let lead = state
                    .db
                    .whatsapp_get_contact(community, &row.wa_id)
                    .await
                    .map_err(db_error)?
                    .and_then(|contact| contact.lead_id);
                row_views.push(json!({
                    "idx": row.batch_idx,
                    "to": e164(&row.wa_id),
                    "leadId": lead,
                    "params": row.params,
                    "preview": row.body,
                    "state": row.state,
                    "skipReason": row.skip_reason,
                    "sendsAt": sends_at(row, now),
                }));
            }
            detail["rows"] = Value::Array(row_views);
            detail["counts"] = row_counts(&rows);
            Ok(Json(detail))
        }
        "drafts" => {
            private(access)?;
            let drafts = state
                .db
                .whatsapp_list_drafts(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            Ok(Json(json!({
                "drafts": drafts
                    .iter()
                    .map(|draft| {
                        let mut view = message_view(draft, now);
                        view["to"] = json!(e164(&draft.wa_id));
                        view["params"] = draft.params.clone();
                        view
                    })
                .collect::<Vec<_>>(),
            })))
        }
        "follow_ups" => {
            private(access)?;
            let sequences = state
                .db
                .whatsapp_list_follow_up_sequences(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            let due = state
                .db
                .whatsapp_list_follow_up_due(community, now, limit_of(&request))
                .await
                .map_err(db_error)?;
            Ok(Json(json!({
                "sequences": sequences.iter().map(follow_up_sequence_view).collect::<Vec<_>>(),
                "due": due.iter().map(follow_up_due_view).collect::<Vec<_>>(),
            })))
        }
        "safety_check" => {
            // Discovery agents may use this while saving candidates, even when they are not
            // Outreach members. The projection below only returns values the caller supplied,
            // with no reason or source, so it cannot disclose the wider suppression ledger.
            if request.identities.len() > MAX_SAFETY_CHECK_IDENTITIES {
                return Err(api_error(
                    StatusCode::BAD_REQUEST,
                    "identities has at most 500 entries",
                ));
            }
            let mut requested = Vec::with_capacity(request.identities.len());
            for identity in &request.identities {
                let (kind, value) = normalize_suppression_identity(&identity.kind, &identity.value)
                    .map_err(|reason| api_error(StatusCode::BAD_REQUEST, reason))?;
                requested.push((identity.kind.trim().to_ascii_lowercase(), identity.value.trim().to_owned(), kind, value));
            }
            let canonical: Vec<(String, String)> = requested
                .iter()
                .map(|(_, _, kind, value)| (kind.clone(), value.clone()))
                .collect();
            let active = state
                .db
                .whatsapp_match_active_suppressions(community, &canonical)
                .await
                .map_err(db_error)?;
            let active: HashSet<(String, String)> = active
                .into_iter()
                .map(|row| (row.identity_kind, row.identity_value))
                .collect();
            let matches = requested
                .into_iter()
                .filter(|(_, _, kind, value)| active.contains(&(kind.clone(), value.clone())))
                .map(|(kind, value, _, _)| json!({ "kind": kind, "value": value }))
                .collect::<Vec<_>>();
            Ok(Json(json!({ "matches": matches })))
        }
        "suppressions" => {
            if !access.is_owner_admin() {
                return Err(api_error(
                    StatusCode::FORBIDDEN,
                    "only the owner or an admin can read WhatsApp safety entries",
                ));
            }
            let suppressions = state
                .db
                .whatsapp_list_active_suppressions(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            let business_stops = state
                .db
                .whatsapp_list_business_stops(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            Ok(Json(json!({
                "suppressions": suppressions.iter().map(suppression_view).collect::<Vec<_>>(),
                "businessStops": business_stops.iter().map(business_stop_view).collect::<Vec<_>>(),
            })))
        }
        "unknown_sends" => {
            if !access.is_owner_admin() {
                return Err(api_error(
                    StatusCode::FORBIDDEN,
                    "only the owner or an admin can read unknown WhatsApp sends",
                ));
            }
            let messages = state
                .db
                .whatsapp_list_unknown_sends(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            Ok(Json(json!({
                "unknownSends": messages.iter().map(|message| message_view(message, now)).collect::<Vec<_>>(),
            })))
        }
        "contacts" => {
            private(access)?;
            let contacts = state
                .db
                .whatsapp_list_contacts(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            Ok(Json(
                contacts_view_for_capability(
                    &state,
                    community,
                    &contacts,
                    now,
                    queued_stage_supported,
                )
                .await?,
            ))
        }
        "inbox" => {
            private(access)?;
            let contacts = state
                .db
                .whatsapp_list_inbox(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            Ok(Json(
                contacts_view_for_capability(
                    &state,
                    community,
                    &contacts,
                    now,
                    queued_stage_supported,
                )
                .await?,
            ))
        }
        "thread" => {
            private(access)?;
            let wa_id = request
                .wa_id
                .as_deref()
                .and_then(normalize_wa_id)
                .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "waId must be a phone number"))?;
            Ok(Json(
                thread_view_for_capability(
                    &state,
                    community,
                    &wa_id,
                    limit_of(&request),
                    request.include_held,
                    now,
                    queued_stage_supported,
                )
                .await?,
            ))
        }
        _ => Err(api_error(
            StatusCode::BAD_REQUEST,
            "unknown query: use status, templates, batches, batch, drafts, follow_ups, safety_check, suppressions, unknown_sends, contacts, inbox or thread",
        )),
    }
}

/// Query string of Meta's subscription verification request.
#[derive(Deserialize)]
pub struct VerifyQuery {
    #[serde(rename = "hub.mode")]
    mode: Option<String>,
    #[serde(rename = "hub.verify_token")]
    verify_token: Option<String>,
    #[serde(rename = "hub.challenge")]
    challenge: Option<String>,
}

fn not_found() -> (StatusCode, Json<Value>) {
    api_error(StatusCode::NOT_FOUND, "not found")
}

async fn bind_connection(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    id_str: &str,
) -> Result<
    (
        buzz_core::TenantContext,
        buzz_db::whatsapp::WhatsappConnection,
    ),
    (StatusCode, Json<Value>),
> {
    let connection_id = Uuid::parse_str(id_str).map_err(|_| not_found())?;
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    // The host, not the URL, decides the company: another company's connection id is a 404.
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| not_found())?;
    let connection = state
        .db
        .whatsapp_get_connection_by_id(tenant.community(), connection_id)
        .await
        .map_err(|_| not_found())?
        .ok_or_else(not_found)?;
    Ok((tenant, connection))
}

/// `GET /hooks/whatsapp/{id}`: Meta's subscription verification.
pub async fn webhook_verify(
    State(state): State<Arc<AppState>>,
    Path(id_str): Path<String>,
    Query(query): Query<VerifyQuery>,
    headers: HeaderMap,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let (_, connection) = bind_connection(&state, &headers, &id_str).await?;
    let token_ok = query
        .verify_token
        .as_deref()
        .is_some_and(|token| verify_token_matches(token, &connection.verify_token_hash));
    match (query.mode.as_deref(), token_ok, query.challenge) {
        (Some("subscribe"), true, Some(challenge)) if challenge.len() <= 256 => Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            challenge,
        )
            .into_response()),
        _ => Err(api_error(StatusCode::FORBIDDEN, "verification failed")),
    }
}

/// `POST /hooks/whatsapp/{id}`: messages and delivery statuses from Meta.
pub async fn webhook_receive(
    State(state): State<Arc<AppState>>,
    Path(id_str): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, connection) = bind_connection(&state, &headers, &id_str).await?;
    if body.len() > MAX_WEBHOOK_BODY_BYTES {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "webhook body too large",
        ));
    }
    let Some(kek) = state.config.accounts.account_kek() else {
        return Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "whatsapp is not configured",
        ));
    };
    let app_secret = connect::open_app_secret(kek, *tenant.community().as_uuid(), &connection)
        .map_err(|reason| {
            tracing::error!("whatsapp webhook could not open the app secret: {reason}");
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        })?;
    let signature = headers
        .get(SIGNATURE_HEADER)
        .and_then(|value| value.to_str().ok());
    if !verify_signature(app_secret.as_bytes(), &body, signature) {
        tracing::warn!(community = %tenant.community(), "whatsapp webhook signature rejected");
        return Err(api_error(StatusCode::UNAUTHORIZED, "authentication failed"));
    }
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid JSON body"))?;
    match process_payload(&state, &tenant, &connection, &payload).await {
        Ok(()) => Ok(Json(json!({ "ok": true }))),
        Err(reason) => {
            // 500 makes Meta redeliver; deduplication by message id keeps that safe.
            tracing::error!(community = %tenant.community(), "whatsapp webhook processing failed: {reason}");
            Err(api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "processing failed, will be retried",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_stage_capability_defaults_to_the_legacy_projection() {
        // GUARD: desktop-v3.0.37 sends no capability marker and rejects `stage: queued`.
        // This is the request seam that feeds `desk_fields_for_capability` for contacts,
        // inboxes and threads.
        let legacy: QueryRequest = serde_json::from_value(serde_json::json!({
            "what": "contacts"
        }))
        .expect("legacy query parses");
        assert!(!supports_queued_stage(&legacy));

        let current: QueryRequest = serde_json::from_value(serde_json::json!({
            "what": "contacts",
            "capabilities": [QUEUED_STAGE_CAPABILITY]
        }))
        .expect("current query parses");
        assert!(supports_queued_stage(&current));
    }

    #[test]
    fn every_stored_state_reads_as_a_state_the_app_parses() {
        // The app's parser accepts exactly these; anything else turns the whole thread into an error.
        const APP_STATES: [&str; 9] = [
            "draft",
            "rejected",
            "queued",
            "sending",
            "sent",
            "delivered",
            "read",
            "failed",
            "unconfirmed",
        ];
        for stored in [
            "held",
            "ready",
            "skipped",
            "draft",
            "rejected",
            "queued",
            "sending",
            "sent",
            "delivered",
            "read",
            "failed",
            "unconfirmed",
            // GUARD: an inbound reply is stored as `received`; the released 3.0.18 app throws
            // "invalid WhatsApp message state" for the whole thread unless it reads as `read`.
            "received",
        ] {
            assert!(
                APP_STATES.contains(&client_state(stored)),
                "{stored} -> {}",
                client_state(stored)
            );
        }
        assert_eq!(client_state("held"), "queued");
        assert_eq!(client_state("skipped"), "failed");
        assert_eq!(client_state("received"), "read");
    }

    #[test]
    fn a_dot_profile_name_shows_the_number_in_the_contact_view() {
        // GUARD: `contact_view` uses `contact_label`, so a name with no letter or digit is
        // shown as the number.
        let mut contact = WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: ".".into(),
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
            created_at: Utc::now(),
        };
        let view = contact_view(&contact, Utc::now(), &OutreachFlags::default());
        assert_eq!(view["displayName"], "+27821234567");
        contact.display_name = "Thabo".into();
        let view = contact_view(&contact, Utc::now(), &OutreachFlags::default());
        assert_eq!(view["displayName"], "Thabo");
    }

    fn message(state: &str, idx: i32) -> WhatsappMessage {
        WhatsappMessage {
            id: Uuid::new_v4(),
            wa_id: "27821234567".into(),
            direction: "out".into(),
            kind: "template".into(),
            body: "Hi".into(),
            template_name: Some("intro".into()),
            template_language: Some("en".into()),
            params: json!(["x"]),
            state: state.into(),
            skip_reason: None,
            wamid: None,
            error_code: None,
            error_text: None,
            event_id: None,
            batch_id: None,
            batch_idx: Some(idx),
            new_chat: true,
            send_after: None,
            sender_pubkey: None,
            sent_at: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn only_ready_rows_say_when_they_go_out() {
        use chrono::TimeZone;
        // 03:00 UTC is 05:00 in Johannesburg: the next window opens at 06:00 UTC.
        let night = Utc
            .with_ymd_and_hms(2026, 10, 29, 3, 0, 0)
            .single()
            .expect("time");
        let mut ready = message("ready", 0);
        assert_eq!(
            sends_at(&ready, night).as_deref(),
            Some("2026-10-29T06:00:00+00:00")
        );
        ready.new_chat = false;
        assert_eq!(
            sends_at(&ready, night).as_deref(),
            Some("2026-10-29T03:00:00+00:00")
        );
        // Released by the owner: the release moment, not the window.
        ready.new_chat = true;
        ready.send_after = Some(night + chrono::Duration::minutes(1));
        assert_eq!(
            sends_at(&ready, night).as_deref(),
            Some("2026-10-29T03:01:00+00:00")
        );
        for state in ["held", "queued", "sending", "sent", "failed", "draft"] {
            assert_eq!(sends_at(&message(state, 1), night), None, "{state}");
        }
    }

    #[test]
    fn batch_row_counts_group_the_states() {
        let rows = vec![
            message("held", 0),
            message("ready", 1),
            message("sent", 2),
            message("read", 3),
            message("failed", 4),
            message("unconfirmed", 5),
            message("dropped", 6),
        ];
        let counts = row_counts(&rows);
        assert_eq!(counts["total"], 7);
        assert_eq!(counts["ready"], 2);
        assert_eq!(counts["sent"], 2);
        assert_eq!(counts["failed"], 2);
        assert_eq!(counts["dropped"], 1);
    }

    #[test]
    fn a_contact_whose_only_row_waits_for_approval_is_not_sent() {
        let contact = WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: String::new(),
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
            created_at: Utc::now(),
        };
        let waiting = OutreachFlags {
            awaiting_approval: true,
            ..OutreachFlags::default()
        };
        assert_eq!(outreach_status(&contact, &waiting), "waiting_for_approval");
        let queued = OutreachFlags {
            queued: true,
            ..OutreachFlags::default()
        };
        assert_eq!(outreach_status(&contact, &queued), "queued");
        let sent = OutreachFlags {
            sent: true,
            ..OutreachFlags::default()
        };
        assert_eq!(outreach_status(&contact, &sent), "sent");
        assert_eq!(outreach_status(&contact, &OutreachFlags::default()), "none");
        let replied = WhatsappContact {
            last_inbound_at: Some(Utc::now()),
            ..contact.clone()
        };
        assert_eq!(outreach_status(&replied, &waiting), "replied");
        let opted_out = WhatsappContact {
            opted_out_at: Some(Utc::now()),
            ..contact
        };
        assert_eq!(outreach_status(&opted_out, &sent), "opted_out");
    }

    #[test]
    fn contact_view_never_exposes_more_than_the_contract() {
        let contact = WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: "Thabo".into(),
            lead_id: Some("lead".into()),
            owner_pubkey: Some(vec![1; 32]),
            thread_root_event_id: None,
            last_inbound_at: Some(Utc::now()),
            last_outbound_at: None,
            outbound_since_inbound: 0,
            opted_out_at: None,
            opt_out_reason: None,
            paused_at: None,
            pause_reason: None,
            retry_after: None,
            created_at: Utc::now(),
        };
        let view = contact_view(&contact, Utc::now(), &OutreachFlags::default());
        assert_eq!(view["e164"], "+27821234567");
        assert_eq!(view["windowOpen"], true);
        assert_eq!(view["unanswered"], true);
        assert_eq!(view["optedOut"], false);
    }

    #[test]
    fn a_business_stop_is_an_additive_contact_field() {
        let contact = WhatsappContact {
            wa_id: "27821234567".into(),
            display_name: "Thabo".into(),
            lead_id: Some("business-1".into()),
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
            created_at: Utc::now(),
        };
        let stop = WhatsappBusinessStop {
            business_id: "business-1".into(),
            source_wa_id: "27821230000".into(),
            reason: "inbound reply received".into(),
            matched_rule: None,
            created_at: Utc::now(),
        };
        let stopped = with_business_stop(
            contact_view(&contact, Utc::now(), &OutreachFlags::default()),
            Some(&stop),
        );
        assert_eq!(stopped["businessOutreachStopped"], true);
        assert_eq!(stopped["businessStopReason"], "inbound reply received");

        let clear = with_business_stop(
            contact_view(&contact, Utc::now(), &OutreachFlags::default()),
            None,
        );
        assert_eq!(clear["businessOutreachStopped"], false);
        assert!(clear["businessStopReason"].is_null());
    }

    #[test]
    fn safety_check_identities_are_canonical_and_strict() {
        assert_eq!(
            normalize_suppression_identity(" phone ", "+27 82 123 4567"),
            Ok(("phone".into(), "27821234567".into()))
        );
        assert_eq!(
            normalize_suppression_identity("email", "  OWNER@Example.COM "),
            Ok(("email".into(), "owner@example.com".into()))
        );
        assert_eq!(
            normalize_suppression_identity("domain", "Example.COM."),
            Ok(("domain".into(), "example.com".into()))
        );
        for (kind, value) in [
            ("phone", "not-a-phone"),
            ("email", "no-at-sign"),
            ("domain", "localhost"),
            ("domain", "bad host.example"),
            ("address", "x"),
        ] {
            assert!(
                normalize_suppression_identity(kind, value).is_err(),
                "{kind}:{value}"
            );
        }
    }

    #[test]
    fn connect_requests_never_print_secrets_in_errors() {
        for error in [
            ConnectError::NotConfigured,
            ConnectError::TokenRejected,
            ConnectError::GraphUnavailable,
            ConnectError::Internal("secret-looking-detail".into()),
        ] {
            assert!(!error.message().contains("secret-looking-detail"));
        }
    }

    fn media_record(
        kind: &str,
        state: Option<&str>,
        stored: Option<Value>,
        error: Option<&str>,
    ) -> WhatsappMedia {
        WhatsappMedia {
            message_id: Uuid::nil(),
            wa_id: "27821234567".into(),
            media: json!({"type": kind, "caption": "look"}),
            state: state.map(str::to_owned),
            stored,
            attempts: 0,
            retry_at: None,
            error: error.map(str::to_owned),
            linked: false,
            event_id: None,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn a_stored_sticker_is_served_with_its_url_for_the_app_and_agents() {
        let sha = "ab".repeat(32);
        let media = media_record(
            "sticker",
            Some("stored"),
            Some(
                json!({"sha256": sha, "ext": "webp", "mime": "image/webp", "size": 900, "opaque": false}),
            ),
            None,
        );
        let view = media_view(&media, "https://acme.example/media");
        assert_eq!(view["type"], "sticker");
        assert_eq!(view["state"], "stored");
        assert_eq!(
            view["url"],
            format!("https://acme.example/media/{sha}.webp")
        );
        assert_eq!(view["mime"], "image/webp");
        assert_eq!(view["canRetry"], false);
        assert_eq!(
            view["description"],
            "Customer sent a sticker with the caption: look"
        );
    }

    #[test]
    fn a_failed_download_offers_retry_unless_retrying_cannot_help() {
        let retryable = media_record("image", Some("failed"), None, Some("timeout"));
        let view = media_view(&retryable, "https://acme.example/media");
        assert_eq!(
            (view["state"].as_str(), view["url"].is_null()),
            (Some("failed"), true)
        );
        assert_eq!(view["canRetry"], true);
        for (state, error) in [
            ("failed", "too_large"),
            ("failed", "no_media_id"),
            ("gone", "not_found"),
            ("pending", "timeout"),
        ] {
            let view = media_view(&media_record("image", Some(state), None, Some(error)), "b");
            assert_eq!(view["canRetry"], false, "{state} {error}");
        }
    }

    #[test]
    fn a_location_has_no_download_state_and_keeps_its_coordinates() {
        let mut place = media_record("location", None, None, None);
        place.media = json!({"type": "location", "latitude": -26.2, "longitude": 28.04, "name": "Guest House"});
        let view = media_view(&place, "b");
        assert_eq!(view["state"], "none");
        assert_eq!(view["latitude"], -26.2);
        assert_eq!(view["name"], "Guest House");
        assert!(view["url"].is_null());
    }
}
