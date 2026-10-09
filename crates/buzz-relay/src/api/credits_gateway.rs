//! Colony-only, authenticated managed-session inference. Not a public AI API.

use std::{sync::Arc, time::Duration};

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use buzz_core::TenantContext;
use buzz_db::credits_gateway::Admission;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    api_error, bridge,
    credits_gateway_upstream::{CompletionFailure, ManagedRequest, Upstream, MAX_BODY},
    relay_members,
};
use crate::state::AppState;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

#[derive(Clone)]
struct Gateway {
    relay: Arc<AppState>,
    upstream: Option<Arc<Upstream>>,
    enabled: bool,
}

/// Mount the private session routes. OFF unless both flag and server key exist.
/// The durable worker runs even when inference is disabled so switching the
/// flag off cannot strand previously admitted spending.
pub fn router(relay: Arc<AppState>) -> Router {
    let upstream = Upstream::from_env().map(Arc::new);
    let enabled =
        std::env::var("COLONY_CREDITS_GATEWAY").ok().as_deref() == Some("1") && upstream.is_some();
    let gateway = Gateway {
        relay,
        upstream,
        enabled,
    };
    let worker = gateway.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            if recover_due(&worker).await.is_err() {
                // Records and next retry remain durable; never claim recovery.
                tracing::error!("Colony credit usage recovery deferred; durable journal retained");
            }
        }
    });
    routes(gateway)
}

fn routes(gateway: Gateway) -> Router {
    Router::new()
        .route("/capabilities", get(capabilities))
        .route("/sessions", post(create_session))
        .route("/sessions/revoke", post(revoke_session))
        .route("/managed-inference", post(inference))
        .route("/reconcile", post(reconcile))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(MAX_BODY))
        .with_state(gateway)
}

async fn capabilities(State(gateway): State<Gateway>) -> Json<Value> {
    Json(
        json!({"enabled":gateway.enabled,"runtime":"colony","model":gateway.upstream.as_ref().map(|u| &u.model),"marginPercent":20}),
    )
}

fn unavailable() -> (StatusCode, Json<Value>) {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Colony credits are unavailable. Try again later.",
    )
}
fn recovering() -> (StatusCode, Json<Value>) {
    api_error(
        StatusCode::CONFLICT,
        "Usage is being recovered automatically. Try again shortly.",
    )
}
fn database_error(error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    match error {
        buzz_db::DbError::NotFound(_) => api_error(
            StatusCode::FORBIDDEN,
            "Managed session expired or unauthorized. Restart your Colony Agent.",
        ),
        buzz_db::DbError::InvalidData(_) => api_error(
            StatusCode::CONFLICT,
            "Managed request conflicts with its authorization.",
        ),
        _ => unavailable(),
    }
}

async fn authenticate(
    gateway: &Gateway,
    headers: &HeaderMap,
    path: &str,
    body: &[u8],
) -> Result<(TenantContext, nostr::PublicKey), (StatusCode, Json<Value>)> {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&gateway.relay.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "not_found"))?;
    let url = bridge::nip98_expected_url(&gateway.relay.config.relay_url, &tenant, path);
    let auth =
        bridge::verify_bridge_auth_with_options(headers, "POST", &url, Some(body), true, true)?;
    bridge::check_nip98_replay(&gateway.relay, &tenant, auth.event_id_bytes).await?;
    relay_members::enforce_relay_membership(
        &gateway.relay,
        tenant.community(),
        auth.pubkey.as_bytes(),
        relay_members::extract_auth_tag_header(headers),
        auth.signed_created_at,
    )
    .await?;
    bridge::enforce_http_admission(&gateway.relay, &tenant, &auth.pubkey).await?;
    Ok((tenant, auth.pubkey))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionRequest {
    agent_pubkey: String,
}

async fn create_session(
    State(gateway): State<Gateway>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    if !gateway.enabled {
        return Err(unavailable());
    }
    let (tenant, owner) =
        authenticate(&gateway, &headers, "/api/credits-gateway/sessions", &body).await?;
    let request: SessionRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid managed session."))?;
    let agent = nostr::PublicKey::from_hex(&request.agent_pubkey)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid managed agent."))?;
    let session = gateway
        .relay
        .db
        .create_credit_ai_session(&owner.to_hex(), tenant.community(), agent.as_bytes())
        .await
        .map_err(database_error)?;
    Ok(Json(
        json!({"sessionId":session,"expiresInSeconds":7200,"model":gateway.upstream.as_ref().map(|u| &u.model)}),
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RevokeRequest {
    session_id: Uuid,
}

async fn revoke_session(
    State(gateway): State<Gateway>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult {
    let (_, owner) = authenticate(
        &gateway,
        &headers,
        "/api/credits-gateway/sessions/revoke",
        &body,
    )
    .await?;
    let request: RevokeRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid managed session."))?;
    gateway
        .relay
        .db
        .revoke_credit_ai_session(&owner.to_hex(), request.session_id)
        .await
        .map_err(database_error)?;
    Ok(Json(json!({"revoked":true})))
}

async fn inference(State(gateway): State<Gateway>, headers: HeaderMap, body: Bytes) -> ApiResult {
    if !gateway.enabled {
        return Err(unavailable());
    }
    let upstream = gateway.upstream.as_ref().ok_or_else(unavailable)?;
    let (tenant, agent) = authenticate(
        &gateway,
        &headers,
        "/api/credits-gateway/managed-inference",
        &body,
    )
    .await?;
    let request: ManagedRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid Colony Agent request."))?;
    let (mut upstream_body, reserve) = upstream.request(&request).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "Unsupported Colony Agent request or context too large.",
        )
    })?;
    let digest = hex::encode(Sha256::digest(&body));
    let account_id = match gateway
        .relay
        .db
        .admit_credit_ai_request(
            &upstream.fingerprint,
            tenant.community(),
            agent.as_bytes(),
            request.session_id,
            request.request_id,
            &digest,
            reserve,
        )
        .await
        .map_err(database_error)?
    {
        Admission::New { account_id } => account_id,
        Admission::Insufficient => {
            return Err(api_error(
                StatusCode::PAYMENT_REQUIRED,
                "Out of credits. Top up to keep your Colony Agent working.",
            ))
        }
        Admission::Busy => {
            return Err(api_error(
                StatusCode::TOO_MANY_REQUESTS,
                "Your Colony Agents are busy. Try again shortly.",
            ))
        }
        Admission::Pending => return Err(recovering()),
        Admission::Completed {
            charged,
            provisional,
        } => {
            return Err((
                StatusCode::CONFLICT,
                Json(
                    json!({"error":"already_completed","message":"This request was already charged. Start a new conversation turn.","chargedNanousd":charged.to_string(),"provisional":provisional}),
                ),
            ))
        }
    };
    upstream
        .attribute_customer(&mut upstream_body, account_id)
        .map_err(|_| unavailable())?;
    // No inference retry. Cancellation and every error leave the committed hold
    // to the durable worker, including cancellation before the send starts.
    let bytes = match upstream.complete(&upstream_body).await {
        Ok(bytes) => bytes,
        Err(CompletionFailure::Rejected) => {
            gateway
                .relay
                .db
                .reject_credit_ai_request(request.request_id)
                .await
                .map_err(database_error)?;
            return Err(unavailable());
        }
        Err(CompletionFailure::Ambiguous) => return Err(recovering()),
    };
    let observed = upstream.observe(&bytes).map_err(|_| recovering())?;
    // Store only billing evidence, never prompts or completion content.
    gateway
        .relay
        .db
        .observe_credit_ai_usage(
            request.request_id,
            &observed.generation,
            observed.charged,
            &billing_usage(&observed.usage),
        )
        .await
        .map_err(database_error)?;
    let charged = observed
        .charged
        .filter(|cost| *cost <= reserve)
        .ok_or_else(recovering)?;
    gateway
        .relay
        .db
        .settle_credit_ai_request(request.request_id, charged, false)
        .await
        .map_err(database_error)?;
    if !observed.response["choices"].is_array() || observed.response.get("error").is_some() {
        return Err(recovering());
    }
    let mut response = observed.response;
    response["id"] = json!(format!("colony-{}", request.request_id));
    response["choices"] =
        super::credits_gateway_policy::choices(&response["choices"]).map_err(|_| recovering())?;
    response["usage"] = billing_usage(&response["usage"]);
    response["chargedNanousd"] = json!(charged.to_string());
    Ok(Json(response))
}

fn billing_usage(usage: &Value) -> Value {
    let mut result = json!({});
    for key in ["prompt_tokens", "completion_tokens", "total_tokens"] {
        if let Some(value) = usage.get(key).and_then(Value::as_u64) {
            result[key] = json!(value);
        }
    }
    for key in [
        "costUsd",
        "model",
        "costSource",
        "inputPriceNanousdPerMillion",
        "outputPriceNanousdPerMillion",
    ] {
        if let Some(value) = usage.get(key).and_then(Value::as_str) {
            result[key] = json!(value);
        }
    }
    // Returned decimal and margin-inclusive integer are both durable.
    result
}

async fn recover_due(gateway: &Gateway) -> Result<(), buzz_db::DbError> {
    let records = gateway.relay.db.claim_credit_ai_recovery().await?;
    // Bound worker latency across sixteen records; do not serialize 90-second
    // requests and strand later records beyond the recovery deadline.
    use futures_util::{stream, StreamExt};
    let results = stream::iter(records).map(|record| async move {
        let age = chrono::Utc::now().signed_duration_since(record.created_at);
        let mut actual = record.observed.filter(|cost| *cost <= record.reserved);
        if actual.is_none() && age < chrono::Duration::minutes(15) {
            if let (Some(upstream), Some(generation)) = (&gateway.upstream, &record.generation_id) {
                if upstream.fingerprint == record.upstream_id {
                actual = tokio::time::timeout(Duration::from_secs(10), upstream.generation_cost(generation)).await.ok().and_then(Result::ok).filter(|cost| *cost <= record.reserved);
                }
            }
        }
        if let Some(charged) = actual {
            gateway.relay.db.settle_credit_ai_request(record.id, charged, false).await?;
        } else if age >= chrono::Duration::minutes(15) {
            gateway.relay.db.settle_credit_ai_request(record.id, record.reserved, true).await?;
            tracing::warn!(request_id = %record.id, "Colony credit usage provisionally settled at reserved maximum; operator review required");
        }
        Ok::<(), buzz_db::DbError>(())
    }).buffer_unordered(4).collect::<Vec<_>>().await;
    for result in results {
        result?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReconcileRequest {
    request_id: Uuid,
    generation_id: String,
}

async fn reconcile(State(gateway): State<Gateway>, headers: HeaderMap, body: Bytes) -> ApiResult {
    let (_, operator) =
        authenticate(&gateway, &headers, "/api/credits-gateway/reconcile", &body).await?;
    // Deployment-config operators only. A community owner cannot assign spend
    // from another account or invent a lower generation cost.
    if !gateway
        .relay
        .config
        .relay_operator_pubkeys
        .contains(&operator.to_hex())
    {
        return Err(api_error(StatusCode::FORBIDDEN, "Relay operator required."));
    }
    let upstream = gateway.upstream.as_ref().ok_or_else(unavailable)?;
    let request: ReconcileRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "Invalid reconciliation request."))?;
    let record = gateway
        .relay
        .db
        .credit_ai_recovery_request(request.request_id)
        .await
        .map_err(database_error)?;
    if record.upstream_id != upstream.fingerprint
        || record
            .generation_id
            .as_ref()
            .is_some_and(|id| id != &request.generation_id)
        || request.generation_id.is_empty()
        || request.generation_id.len() > 200
    {
        return Err(api_error(
            StatusCode::CONFLICT,
            "Generation attribution conflicts with the original request.",
        ));
    }
    let charged = upstream
        .generation_cost(&request.generation_id)
        .await
        .map_err(|_| recovering())?;
    gateway
        .relay
        .db
        .observe_credit_ai_usage(
            record.id,
            &request.generation_id,
            Some(charged),
            &json!({"source":"operator_generation_lookup"}),
        )
        .await
        .map_err(database_error)?;
    gateway
        .relay
        .db
        .settle_credit_ai_request(record.id, charged, false)
        .await
        .map_err(database_error)?;
    Ok(Json(
        json!({"requestId":record.id,"chargedNanousd":charged.to_string(),"corrected":true}),
    ))
}

#[cfg(test)]
mod postgres_tests;
