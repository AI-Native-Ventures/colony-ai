//! WhatsApp outreach HTTP surface: secret intake, role filtered reads, and Meta's webhook.
//!
//! HTTP is used only where an event cannot work: the access token and app secret must not
//! travel as a stored event, and phone numbers plus opt-out state are private to the owner,
//! admins and the Outreach channel, so reads are filtered by role instead of fanned out.
//! Contract: `docs/whatsapp-outreach.md`.

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

use buzz_db::whatsapp::{WhatsappBatch, WhatsappContact, WhatsappMessage, WhatsappTemplate};

use super::{api_error, api_error_with_code, gifs, internal_error};
use crate::state::AppState;
use crate::whatsapp::connect::{self, ConnectError};
use crate::whatsapp::inbound::process_payload;
use crate::whatsapp::policy::{
    e164, normalize_wa_id, verify_signature, verify_token_matches, window_closes_at, window_open,
    MAX_WEBHOOK_BODY_BYTES,
};
use crate::whatsapp::{access_for, Access};

/// Route of the connect endpoint.
pub(crate) const CONNECT_PATH: &str = "/api/whatsapp/connect";
/// Route of the disconnect endpoint.
pub(crate) const DISCONNECT_PATH: &str = "/api/whatsapp/disconnect";
/// Route of the read endpoint.
pub(crate) const QUERY_PATH: &str = "/api/whatsapp/query";

const DEFAULT_LIST_LIMIT: i64 = 50;
const SIGNATURE_HEADER: &str = "x-hub-signature-256";

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
}

fn template_view(template: &WhatsappTemplate) -> Value {
    connect::template_json(template)
}

fn contact_view(contact: &WhatsappContact, now: chrono::DateTime<Utc>) -> Value {
    let open = window_open(contact.last_inbound_at, now);
    json!({
        "waId": contact.wa_id,
        "e164": e164(&contact.wa_id),
        "displayName": contact.display_name,
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

fn message_view(message: &WhatsappMessage) -> Value {
    json!({
        "id": message.id.to_string(),
        "direction": message.direction,
        "kind": message.kind,
        "text": message.body,
        "templateName": message.template_name,
        "state": message.state,
        "errorCode": message.error_code,
        "errorText": message.error_text,
        "eventId": message.event_id.as_ref().map(hex::encode),
        "createdAt": message.created_at.to_rfc3339(),
    })
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

    let private = |access: Access| -> Result<(), (StatusCode, Json<Value>)> {
        if access.can_read_private() {
            Ok(())
        } else {
            Err(api_error(
                StatusCode::FORBIDDEN,
                "only the owner, admins and Outreach members can read this",
            ))
        }
    };

    match request.what.as_str() {
        "status" => connect::status_view(&state, &tenant)
            .await
            .map(Json)
            .map_err(|reason| internal_error(&reason)),
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
                }));
            }
            detail["rows"] = Value::Array(row_views);
            detail["counts"] = row_counts(&rows);
            Ok(Json(detail))
        }
        "contacts" => {
            private(access)?;
            let contacts = state
                .db
                .whatsapp_list_contacts(community, limit_of(&request))
                .await
                .map_err(db_error)?;
            Ok(Json(
                json!({ "contacts": contacts.iter().map(|c| contact_view(c, now)).collect::<Vec<_>>() }),
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
                json!({ "contacts": contacts.iter().map(|c| contact_view(c, now)).collect::<Vec<_>>() }),
            ))
        }
        "thread" => {
            private(access)?;
            let wa_id = request
                .wa_id
                .as_deref()
                .and_then(normalize_wa_id)
                .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "waId must be a phone number"))?;
            let contact = state
                .db
                .whatsapp_get_contact(community, &wa_id)
                .await
                .map_err(db_error)?
                .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "no such contact"))?;
            let mut messages = state
                .db
                .whatsapp_list_thread(community, &wa_id, limit_of(&request))
                .await
                .map_err(db_error)?;
            messages.reverse();
            Ok(Json(json!({
                "contact": contact_view(&contact, now),
                "messages": messages.iter().map(message_view).collect::<Vec<_>>(),
            })))
        }
        _ => Err(api_error(
            StatusCode::BAD_REQUEST,
            "unknown query: use status, templates, batches, batch, contacts, inbox or thread",
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
    let (_token, app_secret) =
        connect::open_secrets(kek, *tenant.community().as_uuid(), &connection).map_err(
            |reason| {
                tracing::error!("whatsapp webhook could not open the app secret: {reason}");
                api_error(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
            },
        )?;
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
            sender_pubkey: None,
            sent_at: None,
            created_at: Utc::now(),
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
            created_at: Utc::now(),
        };
        let view = contact_view(&contact, Utc::now());
        assert_eq!(view["e164"], "+27821234567");
        assert_eq!(view["windowOpen"], true);
        assert_eq!(view["unanswered"], true);
        assert_eq!(view["optedOut"], false);
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
}
