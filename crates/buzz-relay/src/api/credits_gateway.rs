//! Colony-only, authenticated managed-session inference. Not a public AI API.

use std::{sync::Arc, time::Duration};

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use buzz_core::TenantContext;
use buzz_db::credits_gateway::{Admission, GatewayPolicy};
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
use keepalive::Keepalive;
use outcome::{Finished, Outcome};

mod keepalive;
mod outcome;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

#[derive(Clone)]
struct Gateway {
    relay: Arc<AppState>,
    upstream: Option<Arc<Upstream>>,
    enabled: bool,
    policy: Arc<GatewayPolicy>,
    keepalive: Keepalive,
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
        policy: Arc::new(super::credits_gateway_limits::policy_from_env()),
        keepalive: Keepalive::PRODUCTION,
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

/// Every route but inference takes a few hundred bytes of JSON.
const SMALL_BODY: usize = 64 * 1024;

fn routes(gateway: Gateway) -> Router {
    // Only a conversation is large: it carries the agent's prompt, its tool
    // definitions and its history. See `MAX_BODY`.
    let small = Router::new()
        .route("/capabilities", get(capabilities))
        .route("/access", get(access))
        .route("/sessions", post(create_session))
        .route("/sessions/revoke", post(revoke_session))
        .route("/reconcile", post(reconcile))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(SMALL_BODY));
    let conversation = Router::new()
        .route("/managed-inference", post(inference))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(MAX_BODY));
    small
        .merge(conversation)
        .layer(axum::middleware::from_fn(log_body_limit))
        .with_state(gateway)
}

/// The limit layer refuses an oversized body before any handler runs, so name
/// that refusal here. Like every other refusal, it logs the rule and never the
/// request.
async fn log_body_limit(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let response = next.run(request).await;
    if response.status() == StatusCode::PAYLOAD_TOO_LARGE {
        tracing::warn!(
            check = "body_over_limit",
            status = 413,
            "Colony gateway refused a request body over the route limit"
        );
    }
    response
}

async fn capabilities(State(gateway): State<Gateway>) -> Json<Value> {
    Json(
        json!({"enabled":gateway.enabled,"runtime":"colony","model":gateway.upstream.as_ref().map(|u| &u.model),"marginPercent":20,"freeAiConfigured":!gateway.policy.free_ai_accounts.is_empty()}),
    )
}

/// Whether the signed-in owner's account uses the gateway without credits. The
/// answer is about the caller's own account only and names no email or list.
///
/// Signer-only on purpose: a returning device asks this before it opens any
/// business, so the host is the root one, where the owner is not a member. The
/// reply reveals nothing but the caller's own status, like the payments reads.
/// Opening a session and spending stay behind community membership.
async fn access(State(gateway): State<Gateway>, headers: HeaderMap) -> ApiResult {
    let (tenant, owner, _) = authenticate_signer(
        &gateway,
        &headers,
        "GET",
        "/api/credits-gateway/access",
        None,
    )
    .await?;
    bridge::enforce_http_admission(&gateway.relay, &tenant, &owner).await?;
    let free_ai = gateway.enabled
        && gateway
            .relay
            .db
            .credit_ai_account_is_free(&owner.to_hex(), &gateway.policy)
            .await
            .map_err(database_error)?;
    Ok(Json(json!({"freeAi":free_ai})))
}

fn unavailable() -> (StatusCode, Json<Value>) {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Colony credits are unavailable. Try again later.",
    )
}
/// A 400 that also names the check that refused it in the relay log. The log
/// carries the rule, never the request's content, a key or a value, so an
/// operator can tell why a client was refused without reading anyone's prompt.
fn refuse(check: &'static str, reason: &'static str) -> (StatusCode, Json<Value>) {
    tracing::warn!(
        check,
        status = 400,
        reason,
        "Colony gateway refused a request"
    );
    api_error(StatusCode::BAD_REQUEST, reason)
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
    authenticate_as(gateway, headers, "POST", path, Some(body)).await
}

async fn authenticate_as(
    gateway: &Gateway,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<(TenantContext, nostr::PublicKey), (StatusCode, Json<Value>)> {
    let (tenant, pubkey, signed_created_at) =
        authenticate_signer(gateway, headers, method, path, body).await?;
    relay_members::enforce_relay_membership(
        &gateway.relay,
        tenant.community(),
        pubkey.as_bytes(),
        relay_members::extract_auth_tag_header(headers),
        signed_created_at,
    )
    .await?;
    bridge::enforce_http_admission(&gateway.relay, &tenant, &pubkey).await?;
    Ok((tenant, pubkey))
}

/// Host-bound NIP-98 signer check with replay protection, without community
/// membership. Account-level reads that reveal only the caller's own status
/// (like payments) use this, because a signed-in person on a new device may
/// not yet belong to the community that the host resolves to.
async fn authenticate_signer(
    gateway: &Gateway,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<(TenantContext, nostr::PublicKey, Option<u64>), (StatusCode, Json<Value>)> {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&gateway.relay.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "not_found"))?;
    let url = bridge::nip98_expected_url(&gateway.relay.config.relay_url, &tenant, path);
    let auth =
        bridge::verify_bridge_auth_with_options(headers, method, &url, body, true, body.is_some())?;
    bridge::check_nip98_replay(&gateway.relay, &tenant, auth.event_id_bytes).await?;
    Ok((tenant, auth.pubkey, auth.signed_created_at))
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
        .map_err(|_| refuse("session_body", "Invalid managed session."))?;
    let agent = nostr::PublicKey::from_hex(&request.agent_pubkey)
        .map_err(|_| refuse("agent_pubkey", "Invalid managed agent."))?;
    let session = gateway
        .relay
        .db
        .create_credit_ai_session_with_policy(
            &owner.to_hex(),
            tenant.community(),
            agent.as_bytes(),
            &gateway.policy,
        )
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
        .map_err(|_| refuse("revoke_body", "Invalid managed session."))?;
    gateway
        .relay
        .db
        .revoke_credit_ai_session(&owner.to_hex(), request.session_id)
        .await
        .map_err(database_error)?;
    Ok(Json(json!({"revoked":true})))
}

/// A slow request is kept alive by `keepalive::respond`; a quick one, and every
/// refusal before the provider is called, answers with its own status.
async fn inference(State(gateway): State<Gateway>, headers: HeaderMap, body: Bytes) -> Response {
    match start_inference(&gateway, &headers, &body).await {
        Ok(job) => keepalive::respond(job, Keepalive { after: Duration::from_secs(3600), ..gateway.keepalive }).await,
        Err(refusal) => refusal.into_response(),
    }
}

/// Everything up to the provider call: sign-in, parsing, the hold. A refusal here
/// is the answer. Otherwise the provider call and its settlement are started on
/// their own task and returned.
async fn start_inference(
    gateway: &Gateway,
    headers: &HeaderMap,
    body: &Bytes,
) -> Result<tokio::task::JoinHandle<ApiResult>, (StatusCode, Json<Value>)> {
    let started = tokio::time::Instant::now();
    if !gateway.enabled {
        return Err(unavailable());
    }
    let upstream = gateway.upstream.as_ref().ok_or_else(unavailable)?;
    let (tenant, agent) = authenticate(
        gateway,
        headers,
        "/api/credits-gateway/managed-inference",
        body,
    )
    .await?;
    let request: ManagedRequest = serde_json::from_slice(body).map_err(|error| {
        tracing::warn!(
            check = "request_parse",
            category = ?error.classify(),
            body_bytes = body.len(),
            status = 400,
            "Colony gateway refused a managed inference request"
        );
        api_error(StatusCode::BAD_REQUEST, "Invalid Colony Agent request.")
    })?;
    let (mut upstream_body, reserve) = upstream.request(&request).map_err(|check| {
        tracing::warn!(
            check,
            body_bytes = body.len(),
            messages = request.messages.len(),
            tools = request.tools.len(),
            status = 400,
            "Colony gateway refused a managed inference request"
        );
        api_error(
            StatusCode::BAD_REQUEST,
            "Unsupported Colony Agent request or context too large.",
        )
    })?;
    let digest = hex::encode(Sha256::digest(body));
    // A refusal at the door ends the request, so it is logged like any other end.
    let refused = |outcome: Outcome, response: (StatusCode, Json<Value>)| {
        let _unlogged = Finished {
            outcome,
            status: response.0.as_u16(),
            request_id: request.request_id,
            primary_model: &upstream.model,
            answered_by: None,
            elapsed: started.elapsed(),
            streamed: false,
        };
        response
    };
    let account_id = match gateway
        .relay
        .db
        .admit_credit_ai_request_with_policy(
            &upstream.fingerprint,
            tenant.community(),
            agent.as_bytes(),
            request.session_id,
            request.request_id,
            &digest,
            reserve,
            &gateway.policy,
        )
        .await
        .map_err(|error| refused(Outcome::DatabaseError, database_error(error)))?
    {
        Admission::New { account_id } => account_id,
        Admission::Insufficient => {
            return Err(refused(
                Outcome::AdmissionInsufficient,
                api_error(
                    StatusCode::PAYMENT_REQUIRED,
                    "Out of credits. Top up to keep your Colony Agent working.",
                ),
            ))
        }
        Admission::Busy => {
            return Err(refused(
                Outcome::AdmissionBusy,
                api_error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "Your Colony Agents are busy. Try again shortly.",
                ),
            ))
        }
        Admission::DailyLimit => {
            return Err(refused(
                Outcome::AdmissionDailyLimit,
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(
                        json!({"error":"Colony AI has reached its daily limit. Try again tomorrow.","code":"daily_limit"}),
                    ),
                ),
            ))
        }
        Admission::Pending => return Err(refused(Outcome::AdmissionPending, recovering())),
        Admission::Completed {
            charged,
            provisional,
        } => {
            return Err(refused(
                Outcome::AdmissionCompleted,
                (
                    StatusCode::CONFLICT,
                    Json(
                        json!({"error":"already_completed","message":"This request was already charged. Start a new conversation turn.","chargedNanousd":charged.to_string(),"provisional":provisional}),
                    ),
                ),
            ))
        }
    };
    upstream
        .attribute_customer(&mut upstream_body, account_id)
        .map_err(|_| unavailable())?;
    // The hold is committed. Everything from here to the settlement runs on its
    // own task, so a client that goes away (an app quit or killed mid-request)
    // cannot drop the work halfway and strand the hold: it would otherwise sit
    // pending for the 15 minute recovery window and then settle at the reserved
    // maximum. The handler only waits for the task to answer.
    Ok(tokio::spawn(complete_and_settle(
        gateway.clone(),
        upstream.clone(),
        request.request_id,
        upstream_body,
        reserve,
        started,
    )))
}

/// Why a request that was admitted did not end in an answer: the path, for the
/// log, and the response the client is given.
struct Failure {
    outcome: Outcome,
    response: (StatusCode, Json<Value>),
}

fn failed(outcome: Outcome, response: (StatusCode, Json<Value>)) -> Failure {
    Failure { outcome, response }
}

fn database_failure(error: buzz_db::DbError) -> Failure {
    failed(Outcome::DatabaseError, database_error(error))
}

/// One admitted request, from the provider call to the settlement, and the one
/// log line that says how it ended. The only retries are inside `complete`: a
/// provider 429, which the provider declines before it generates so it costs
/// nothing and cannot bill twice, and a move to the next model of the chain when
/// one is gone or limited. The charge and the stored usage name the model that
/// answered. A failure that is not a clear refusal leaves the committed hold to
/// the durable worker, which also covers the relay itself going away mid-request.
async fn complete_and_settle(
    gateway: Gateway,
    upstream: Arc<Upstream>,
    request_id: Uuid,
    upstream_body: Value,
    reserve: i64,
    started: tokio::time::Instant,
) -> ApiResult {
    let result = settle_request(&gateway, &upstream, request_id, upstream_body, reserve).await;
    let elapsed = started.elapsed();
    let streamed = elapsed >= gateway.keepalive.after;
    match result {
        Ok((response, answered_by)) => {
            outcome::log(Finished {
                outcome: Outcome::Ok,
                status: 200,
                request_id,
                primary_model: &upstream.model,
                answered_by: Some(&answered_by),
                elapsed,
                streamed,
            });
            Ok(response)
        }
        Err(failure) => {
            outcome::log(Finished {
                outcome: failure.outcome,
                status: failure.response.0.as_u16(),
                request_id,
                primary_model: &upstream.model,
                answered_by: None,
                elapsed,
                streamed,
            });
            Err(failure.response)
        }
    }
}

/// The provider call and the settlement. Returns the response and the model
/// that answered.
async fn settle_request(
    gateway: &Gateway,
    upstream: &Upstream,
    request_id: Uuid,
    upstream_body: Value,
    reserve: i64,
) -> Result<(Json<Value>, String), Failure> {
    let answer = match upstream.complete(&upstream_body).await {
        Ok(answer) => answer,
        Err(CompletionFailure::Rejected) => {
            gateway
                .relay
                .db
                .reject_credit_ai_request(request_id)
                .await
                .map_err(database_failure)?;
            return Err(failed(Outcome::UpstreamRejected, unavailable()));
        }
        Err(CompletionFailure::Ambiguous) => {
            return Err(failed(Outcome::UpstreamUnclear, recovering()))
        }
    };
    let observed = upstream
        .observe(&answer)
        .map_err(|_| failed(Outcome::AnswerUnreadable, recovering()))?;
    // Store only billing evidence, never prompts or completion content.
    gateway
        .relay
        .db
        .observe_credit_ai_usage(
            request_id,
            &observed.generation,
            observed.charged,
            &billing_usage(&observed.usage),
        )
        .await
        .map_err(database_failure)?;
    let charged = observed
        .charged
        .filter(|cost| *cost <= reserve)
        .ok_or_else(|| failed(Outcome::CostUnusable, recovering()))?;
    gateway
        .relay
        .db
        .settle_credit_ai_request(request_id, charged, false)
        .await
        .map_err(database_failure)?;
    if !observed.response["choices"].is_array() || observed.response.get("error").is_some() {
        return Err(failed(Outcome::ReplyRefused, recovering()));
    }
    let answered_by = observed.response["model"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let mut response = observed.response;
    response["id"] = json!(format!("colony-{request_id}"));
    response["choices"] = super::credits_gateway_policy::choices(&response["choices"])
        .map_err(|_| failed(Outcome::ReplyRefused, recovering()))?;
    response["usage"] = billing_usage(&response["usage"]);
    response["chargedNanousd"] = json!(charged.to_string());
    Ok((Json(response), answered_by))
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
        .map_err(|_| refuse("reconcile_body", "Invalid reconciliation request."))?;
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
