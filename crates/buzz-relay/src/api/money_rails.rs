//! Money rails (payment links) HTTP surface: secret intake, role filtered reads, the browser
//! step check, recipe runs, and the payment notice inbox.
//!
//! HTTP is used only where an event cannot work: provider keys and signing secrets must not
//! travel as a stored event, full recipients and raw notices are private to the owner and
//! admins, and a provider posts notices over plain HTTP. Contract:
//! `docs/money-rails-pay-contract.md`.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;
use zeroize::Zeroizing;

use buzz_core::kind::KIND_PAYMENT_LINK_HEAD;
use buzz_core::money_rails::connection::{AuthScheme, ConnectionConfig};
use buzz_core::money_rails::link::{LinkHead, LinkState};
use buzz_core::money_rails::notice::SignatureConfig;
use buzz_core::money_rails::recipe::{scrub_str, RecipePurpose};
use buzz_core::money_rails::{ActorRole, Route};
use buzz_core::tenant::TenantContext;

use super::{api_error, api_error_with_code, gifs, internal_error};
use crate::handlers::money_connections::{
    create_connection, disconnect_connection, replace_secret, ConnectError, ConnectInput,
};
use crate::handlers::money_pay_links::{read_link, use_browser_grant};
use crate::money_rails::notices::{receive, NoticeError};
use crate::money_rails::{
    access_for, community_host, jobs, load_connection, notice_address, parse_connection, runner,
};
use crate::state::AppState;

/// Route of the connect endpoint.
pub(crate) const CONNECT_PATH: &str = "/api/money-rails/connect";
/// Route of the secret replacement endpoint.
pub(crate) const SECRET_PATH: &str = "/api/money-rails/secret";
/// Route of the disconnect endpoint.
pub(crate) const DISCONNECT_PATH: &str = "/api/money-rails/disconnect";
/// Route of the read endpoint.
pub(crate) const QUERY_PATH: &str = "/api/money-rails/query";
/// Route of the recipe run endpoint.
pub(crate) const RUN_PATH: &str = "/api/money-rails/run";
/// Route of the browser step check.
pub(crate) const STEP_PATH: &str = "/api/money-rails/browser-step";

const DEFAULT_LIST_LIMIT: usize = 50;
const MAX_LIST_LIMIT: usize = 200;
const EXCERPT_BYTES: usize = 512;

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn connect_error(error: ConnectError) -> (StatusCode, Json<Value>) {
    let status = match &error {
        ConnectError::NotConfigured => StatusCode::SERVICE_UNAVAILABLE,
        ConnectError::Invalid(_) | ConnectError::HostNotAllowed(_) => StatusCode::BAD_REQUEST,
        ConnectError::AlreadyConnected => StatusCode::CONFLICT,
        ConnectError::NotFound => StatusCode::NOT_FOUND,
        ConnectError::Internal(reason) => {
            tracing::error!("money rails connection failed: {reason}");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    };
    api_error_with_code(status, &error.message(), error.code())
}

async fn role_of(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    pubkey: &nostr::PublicKey,
) -> Result<ActorRole, (StatusCode, Json<Value>)> {
    access_for(state, tenant, pubkey)
        .await
        .map_err(|reason| internal_error(&reason))
}

fn forbidden(message: &str) -> (StatusCode, Json<Value>) {
    api_error_with_code(StatusCode::FORBIDDEN, message, "money_forbidden")
}

fn require_owner_admin(role: ActorRole) -> Result<(), (StatusCode, Json<Value>)> {
    if role.is_owner_admin() {
        Ok(())
    } else {
        Err(forbidden("only the owner or an admin can do this"))
    }
}

fn require_prepare(role: ActorRole) -> Result<(), (StatusCode, Json<Value>)> {
    if role.may_prepare() {
        Ok(())
    } else {
        Err(forbidden(
            "only the owner, an admin or their agent can do this",
        ))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectRequest {
    provider: String,
    label: String,
    route: Route,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    api_hosts: Vec<String>,
    #[serde(default)]
    auth_scheme: Option<String>,
    #[serde(default)]
    browser_hosts: Vec<String>,
    #[serde(default)]
    signing_secret: Option<String>,
    #[serde(default)]
    signature: Option<SignatureConfig>,
}

/// `POST /api/money-rails/connect`: owner or admin connects a payment provider.
pub async fn connect(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, CONNECT_PATH, &body).await?;
    require_owner_admin(role_of(&state, &tenant, &pubkey).await?)?;
    let request: ConnectRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid money rails connect JSON"))?;
    let auth_scheme = request
        .auth_scheme
        .as_deref()
        .map(AuthScheme::parse)
        .transpose()
        .map_err(|error| {
            api_error_with_code(StatusCode::BAD_REQUEST, &error.message, error.code)
        })?;
    let input = ConnectInput {
        provider: request.provider,
        label: request.label,
        route: request.route,
        api_key: request.api_key.map(Zeroizing::new),
        api_hosts: request.api_hosts,
        auth_scheme,
        browser_hosts: request.browser_hosts,
        signing_secret: request.signing_secret.map(Zeroizing::new),
        signature: request.signature,
    };
    let (config, notice_id) = create_connection(&tenant, &state, &pubkey, input)
        .await
        .map_err(connect_error)?;
    tracing::info!(community = %tenant.community(), "money rails connection created");
    let host = community_host(&state, tenant.community())
        .await
        .map_err(|reason| internal_error(&reason))?;
    Ok(Json(private_view(&config, notice_id, &host)))
}

fn private_view(config: &ConnectionConfig, notice_id: Uuid, host: &str) -> Value {
    let head = config.to_head(&crate::money_rails::derived_event_id(
        "connection",
        config.connection_id,
        config.version,
    ));
    json!({
        "connection": head,
        "noticeAddress": notice_address(host, notice_id),
        "signature": config.signature,
        "noticeMap": config.notice_map,
    })
}

fn public_view(config: &ConnectionConfig) -> Value {
    let head = config.to_head(&crate::money_rails::derived_event_id(
        "connection",
        config.connection_id,
        config.version,
    ));
    json!({ "connection": head })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretRequest {
    connection_id: Uuid,
    field: String,
    value: String,
}

/// `POST /api/money-rails/secret`: owner or admin replaces one sealed secret.
pub async fn secret(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, SECRET_PATH, &body).await?;
    require_owner_admin(role_of(&state, &tenant, &pubkey).await?)?;
    let request: SecretRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid money rails secret JSON"))?;
    let value = Zeroizing::new(request.value);
    let config = replace_secret(
        &tenant,
        &state,
        request.connection_id,
        &request.field,
        &value,
    )
    .await
    .map_err(connect_error)?;
    Ok(Json(public_view(&config)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisconnectRequest {
    connection_id: Uuid,
}

/// `POST /api/money-rails/disconnect`: owner or admin removes a provider and its secrets.
pub async fn disconnect(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, DISCONNECT_PATH, &body).await?;
    require_owner_admin(role_of(&state, &tenant, &pubkey).await?)?;
    let request: DisconnectRequest = serde_json::from_slice(&body).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid money rails disconnect JSON",
        )
    })?;
    let config = disconnect_connection(&tenant, &state, request.connection_id)
        .await
        .map_err(connect_error)?;
    tracing::info!(community = %tenant.community(), "money rails connection disconnected");
    Ok(Json(public_view(&config)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryRequest {
    what: String,
    #[serde(default)]
    connection_id: Option<Uuid>,
    #[serde(default)]
    link_id: Option<Uuid>,
    #[serde(default)]
    party_id: Option<String>,
    #[serde(default)]
    invoice_id: Option<Uuid>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    unmatched: bool,
    #[serde(default)]
    limit: Option<usize>,
}

fn excerpt(body: Option<&Vec<u8>>, secrets: &[&str]) -> Value {
    let Some(body) = body else {
        return Value::Null;
    };
    let text = String::from_utf8_lossy(body);
    let mut cut = String::new();
    for ch in text.chars() {
        if cut.len() + ch.len_utf8() > EXCERPT_BYTES {
            break;
        }
        cut.push(ch);
    }
    json!(scrub_str(&cut, secrets))
}

/// `POST /api/money-rails/query`: role filtered reads.
pub async fn query(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, QUERY_PATH, &body).await?;
    let request: QueryRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid money rails query JSON"))?;
    let role = role_of(&state, &tenant, &pubkey).await?;
    let community = tenant.community();
    let db_error = |error: buzz_db::DbError| internal_error(&format!("money rails query: {error}"));
    let limit = request
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT);

    match request.what.as_str() {
        "connections" => {
            require_prepare(role)?;
            let rows = state
                .db
                .money_list_connections(community)
                .await
                .map_err(db_error)?;
            let host = community_host(&state, community)
                .await
                .map_err(|reason| internal_error(&reason))?;
            let mut views = Vec::with_capacity(rows.len());
            for row in rows {
                let notice_id = row.notice_id;
                let loaded = parse_connection(row).map_err(|reason| internal_error(&reason))?;
                let mut view = if role.may_prepare() {
                    private_view(&loaded.config, notice_id, &host)
                } else {
                    public_view(&loaded.config)
                };
                view["headEventId"] = json!(
                    connection_head_event_id(&state, community, loaded.config.connection_id).await
                );
                views.push(view);
            }
            Ok(Json(json!({ "connections": views })))
        }
        "connection" => {
            require_owner_admin(role)?;
            let id = request
                .connection_id
                .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "connectionId is required"))?;
            let loaded = load_connection(&state, community, id)
                .await
                .map_err(|reason| internal_error(&reason))?
                .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "not found"))?;
            let host = community_host(&state, community)
                .await
                .map_err(|reason| internal_error(&reason))?;
            let mut view = private_view(&loaded.config, loaded.row.notice_id, &host);
            view["recipes"] = json!(loaded.config.recipes);
            view["headEventId"] = json!(connection_head_event_id(&state, community, id).await);
            Ok(Json(view))
        }
        "links" => {
            require_prepare(role)?;
            let mut heads = card_heads(&state, community).await?;
            heads.retain(|(_, head)| {
                request.link_id.is_none_or(|wanted| head.link_id == wanted)
                    && request
                        .state
                        .as_deref()
                        .is_none_or(|wanted| head.state.as_str() == wanted)
                    && request
                        .party_id
                        .as_deref()
                        .is_none_or(|wanted| head.party_id == wanted)
                    && request
                        .invoice_id
                        .is_none_or(|wanted| head.invoice_id == wanted)
            });
            heads.sort_by_key(|(_, head)| std::cmp::Reverse(head.updated_at));
            heads.truncate(limit);
            let links: Vec<Value> = heads
                .into_iter()
                .map(|(head_event_id, head)| json!({ "headEventId": head_event_id, "link": head }))
                .collect();
            Ok(Json(json!({ "links": links })))
        }
        "link" => {
            require_owner_admin(role)?;
            let id = request
                .link_id
                .ok_or_else(|| api_error(StatusCode::BAD_REQUEST, "linkId is required"))?;
            let (stored, head) = read_link(&state, community, id)
                .await
                .map_err(|error| internal_error(&format!("{error:?}")))?
                .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "not found"))?;
            let recipient = state
                .db
                .money_get_recipient(community, head.recipient_ref)
                .await
                .map_err(db_error)?;
            let notices = state
                .db
                .money_list_notices(community, None, Some(id), false, 20)
                .await
                .map_err(db_error)?;
            let notices: Vec<Value> = notices
                .iter()
                .map(|notice| {
                    json!({
                        "id": notice.id,
                        "receivedAt": notice.received_at.timestamp(),
                        "signature": notice.signature_state,
                        "reference": notice.reference,
                        "amountMinor": notice.amount_minor,
                        "currency": notice.currency,
                        "judgement": notice.judgement,
                        "excerpt": excerpt(notice.body.as_ref(), &[]),
                    })
                })
                .collect();
            Ok(Json(json!({
                "headEventId": stored.event.id.to_hex(),
                "link": head,
                "recipient": recipient.map(|recipient| json!({
                    "channel": recipient.channel,
                    "address": recipient.address,
                    "name": recipient.name,
                })),
                "notices": notices,
            })))
        }
        "notices" => {
            require_owner_admin(role)?;
            let rows = state
                .db
                .money_list_notices(
                    community,
                    request.connection_id,
                    request.link_id,
                    request.unmatched,
                    limit as i64,
                )
                .await
                .map_err(db_error)?;
            let notices: Vec<Value> = rows
                .iter()
                .map(|notice| {
                    json!({
                        "id": notice.id,
                        "connectionId": notice.connection_id,
                        "receivedAt": notice.received_at.timestamp(),
                        "signature": notice.signature_state,
                        "reference": notice.reference,
                        "amountMinor": notice.amount_minor,
                        "currency": notice.currency,
                        "matchedLinkId": notice.link_id,
                        "judgement": notice.judgement,
                        "excerpt": excerpt(notice.body.as_ref(), &[]),
                    })
                })
                .collect();
            Ok(Json(json!({ "notices": notices })))
        }
        _ => Err(api_error(
            StatusCode::BAD_REQUEST,
            "unknown query: use connections, connection, links, link or notices",
        )),
    }
}

async fn connection_head_event_id(
    state: &Arc<AppState>,
    community: buzz_core::tenant::CommunityId,
    connection_id: Uuid,
) -> Option<String> {
    crate::handlers::company_initiative::load_head(
        state,
        community,
        buzz_core::kind::KIND_MONEY_CONNECTION_HEAD,
        &buzz_core::money_rails::connection_d_tag(connection_id),
    )
    .await
    .ok()
    .flatten()
    .map(|stored| stored.event.id.to_hex())
}

async fn card_heads(
    state: &Arc<AppState>,
    community: buzz_core::tenant::CommunityId,
) -> Result<Vec<(String, LinkHead)>, (StatusCode, Json<Value>)> {
    let stored = crate::numbers_inputs::read_events(
        state,
        community,
        KIND_PAYMENT_LINK_HEAD,
        true,
        None,
        None,
    )
    .await
    .map_err(|reason| internal_error(&reason))?;
    Ok(stored
        .iter()
        .filter_map(|stored| {
            serde_json::from_str::<LinkHead>(&stored.event.content)
                .ok()
                .map(|head| (stored.event.id.to_hex(), head))
        })
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    link_id: Uuid,
    recipe_id: String,
    #[serde(default)]
    provider_reference: Option<String>,
}

/// `POST /api/money-rails/run`: run an approved recipe for a card. A create recipe runs the
/// card's durable create job now and answers with where the card is; a lookup recipe is read
/// only and answers with what the provider says. Nothing raw from the provider is returned.
pub async fn run(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, RUN_PATH, &body).await?;
    require_prepare(role_of(&state, &tenant, &pubkey).await?)?;
    let request: RunRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid money rails run JSON"))?;
    let community = tenant.community();
    let (_, head) = read_link(&state, community, request.link_id)
        .await
        .map_err(|error| internal_error(&format!("{error:?}")))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "not found"))?;
    let loaded = load_connection(&state, community, head.connection_id)
        .await
        .map_err(|reason| internal_error(&reason))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "not found"))?;
    let stored = loaded
        .config
        .approved_recipe_by_id(&request.recipe_id)
        .ok_or_else(|| {
            api_error_with_code(
                StatusCode::CONFLICT,
                "there is no approved recipe with that id",
                "recipe_missing",
            )
        })?;
    match stored.recipe.purpose {
        RecipePurpose::CreateLink => {
            if head.state == LinkState::CreatingLink && head.route == Route::Api {
                jobs::process_now(
                    &state,
                    state.money_http.as_ref(),
                    &tenant,
                    request.link_id,
                    "create",
                )
                .await;
            }
            let (_, now) = read_link(&state, community, request.link_id)
                .await
                .map_err(|error| internal_error(&format!("{error:?}")))?
                .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "not found"))?;
            Ok(Json(json!({
                "ok": now.failure.is_none(),
                "state": now.state,
                "link": now.link,
                "failure": now.failure,
            })))
        }
        RecipePurpose::LookupPayment => {
            let reference = request
                .provider_reference
                .clone()
                .or_else(|| {
                    head.link
                        .as_ref()
                        .and_then(|link| link.provider_reference.clone())
                })
                .ok_or_else(|| {
                    api_error(StatusCode::BAD_REQUEST, "providerReference is required")
                })?;
            match runner::run_lookup(
                &state,
                state.money_http.as_ref(),
                community,
                &head,
                &loaded,
                &reference,
            )
            .await
            {
                Ok(result) => Ok(Json(json!({
                    "ok": true,
                    "reference": result.reference,
                    "amountMinor": result.amount_minor,
                    "currency": result.currency,
                    "paid": result.paid,
                }))),
                Err(failure) => Ok(Json(json!({
                    "ok": false,
                    "code": failure.code,
                    "reason": failure.reason,
                    "retryable": failure.retryable,
                }))),
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StepRequest {
    link_id: Uuid,
    host: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    label: String,
    kind: String,
}

/// `POST /api/money-rails/browser-step`: may this browser step run without the on-screen
/// confirmation? Allows exactly one Create on the card's provider host inside its window.
pub async fn browser_step(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, STEP_PATH, &body).await?;
    require_prepare(role_of(&state, &tenant, &pubkey).await?)?;
    let request: StepRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid money rails step JSON"))?;
    let decision = use_browser_grant(
        &tenant,
        &state,
        request.link_id,
        &request.host,
        &request.kind,
        &request.label,
        &request.url,
    )
    .await
    .map_err(|error| internal_error(&format!("{error:?}")))?;
    Ok(Json(json!({
        "allow": decision.allow,
        "code": decision.code,
        "reason": decision.reason,
        "consumed": decision.allow,
        "until": decision.until,
    })))
}

/// `POST /hooks/pay/{id}`: a payment notice for one connection. The host decides the business
/// and the random id decides the connection. Always answers `200` for a stored notice, so a
/// provider does not retry a forged one forever; nothing here marks anything Paid by itself.
pub async fn notice_receive(
    State(state): State<Arc<AppState>>,
    Path(id_str): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> ApiResult {
    let not_found = || api_error(StatusCode::NOT_FOUND, "not found");
    let notice_id = Uuid::parse_str(&id_str).map_err(|_| not_found())?;
    let raw_host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| not_found())?;
    let lookup = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
    };
    match receive(
        &state,
        state.money_http.as_ref(),
        &tenant,
        notice_id,
        &lookup,
        &body,
    )
    .await
    {
        Ok(outcome) => Ok(Json(json!({ "ok": true, "duplicate": outcome.duplicate }))),
        Err(NoticeError::NotFound) => Err(not_found()),
        Err(NoticeError::TooLarge) => Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "notice body too large",
        )),
        Err(NoticeError::RateLimited) => Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "too many notices, slow down",
        )),
        Err(NoticeError::Internal(reason)) => {
            // 500 makes the provider redeliver; the dedupe row keeps that safe.
            tracing::error!(community = %tenant.community(), "money rails notice failed: {reason}");
            Err(api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "processing failed, will be retried",
            ))
        }
    }
}
