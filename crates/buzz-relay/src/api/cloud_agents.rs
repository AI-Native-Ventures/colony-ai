//! Cloud agents HTTP surface. Everything that moves an agent is a Nostr event;
//! only what has to carry a secret is HTTP:
//!
//! - `GET  /api/cloud-agents/capabilities`  what this account may do (NIP-98, owner)
//! - `PUT  /api/cloud-agents/{agent}/bundle` the agent's key and runnable config (NIP-98, owner)
//! - `POST /api/cloud-agents/boot`           a machine trades its boot token for its environment
//! - `DELETE /api/cloud-agents/{agent}`      the owner removes the agent's cloud copy (NIP-98, owner)
//! - `POST /api/cloud-agents/{agent}/free-route-refused`  a machine on the OpenCode free route says
//!   OpenCode refused it (bearer = its home token), so the next boot uses the OpenRouter free route
//!
//! The bundle body holds the agent's secret key. It is never logged, the key is
//! sealed with the deployment key before it is stored, and it is cleared from
//! memory as soon as the request is done.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    routing::{delete, get, post, put},
    Json, Router,
};
use buzz_core::agent_placement::{validate_config_snapshot, CloudConfigSnapshot};
use buzz_core::tenant::TenantContext;
use buzz_db::cloud_agents::{BundleRow, FreeRouteSwitch, UpsertOutcome};
use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::{api_error, bridge, relay_members};
use crate::cloud_agents::boot::{self, BootError};
use crate::state::AppState;

type ApiError = (StatusCode, Json<Value>);
type ApiResult = Result<Json<Value>, ApiError>;

/// Largest bundle body: a key, an auth tag and a config snapshot.
const BUNDLE_BODY_LIMIT: usize = 256 * 1024;
/// The other routes carry no body worth reading.
const SMALL_BODY_LIMIT: usize = 4 * 1024;
/// Longest NIP-OA auth tag a bundle may carry, in bytes.
const MAX_AUTH_TAG_BYTES: usize = 2048;

/// Mounts the cloud agents routes at `/api/cloud-agents`.
pub fn router(state: Arc<AppState>) -> Router {
    let small = Router::new()
        .route("/capabilities", get(capabilities))
        .route("/boot", post(boot_machine))
        .route("/{agent}", delete(remove_agent))
        .route("/{agent}/free-route-refused", post(free_route_refused))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            SMALL_BODY_LIMIT,
        ));
    let bundle = Router::new()
        .route("/{agent}/bundle", put(put_bundle))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            BUNDLE_BODY_LIMIT,
        ));
    small.merge(bundle).with_state(state)
}

fn unavailable() -> ApiError {
    api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "Cloud agents are unavailable. Try again later.",
    )
}

fn database_error(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(error = %error, "cloud agents database error");
    unavailable()
}

/// Host-bound NIP-98 signer check with replay protection, no membership.
/// Used by the read that a device makes before it has opened any business.
async fn authenticate_signer(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<(TenantContext, nostr::PublicKey, Option<u64>), ApiError> {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "not_found"))?;
    let url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, path);
    let auth =
        bridge::verify_bridge_auth_with_options(headers, method, &url, body, true, body.is_some())?;
    bridge::check_nip98_replay(state, &tenant, auth.event_id_bytes).await?;
    Ok((tenant, auth.pubkey, auth.signed_created_at))
}

/// The signer check plus community membership and the per-principal rate limit.
async fn authenticate_member(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<(TenantContext, nostr::PublicKey), ApiError> {
    let (tenant, pubkey, signed_created_at) =
        authenticate_signer(state, headers, method, path, body).await?;
    relay_members::enforce_relay_membership(
        state,
        tenant.community(),
        pubkey.as_bytes(),
        relay_members::extract_auth_tag_header(headers),
        signed_created_at,
    )
    .await?;
    bridge::enforce_http_admission(state, &tenant, &pubkey).await?;
    Ok((tenant, pubkey))
}

async fn verified_email(state: &AppState, owner_hex: &str) -> Result<Option<String>, ApiError> {
    state
        .db
        .owner_account_email(owner_hex)
        .await
        .map_err(database_error)
}

async fn capabilities(State(state): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult {
    let (tenant, owner, _) = authenticate_signer(
        &state,
        &headers,
        "GET",
        "/api/cloud-agents/capabilities",
        None,
    )
    .await?;
    bridge::enforce_http_admission(&state, &tenant, &owner).await?;
    let email = verified_email(&state, &owner.to_hex()).await?;
    let config = &state.config.cloud_agents;
    Ok(Json(json!({
        "enabled": config.mode != crate::cloud_agents::config::CloudMode::Off,
        "allowed": config.allows_account(email.as_deref()),
        "maxPerAccount": config.max_per_account,
        "models": config.selectable_models(),
        "defaultModel": config.default_model,
    })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BundleBody {
    nsec: String,
    #[serde(default)]
    auth_tag: Option<String>,
    config: Value,
    config_version: u64,
}

async fn put_bundle(
    State(state): State<Arc<AppState>>,
    Path(agent): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let path = format!("/api/cloud-agents/{agent}/bundle");
    let (tenant, owner) = authenticate_member(&state, &headers, "PUT", &path, Some(&body)).await?;
    let community = tenant.community();
    let invalid = |message: &str| api_error(StatusCode::BAD_REQUEST, message);

    let agent_pubkey = nostr::PublicKey::from_hex(&agent)
        .ok()
        .filter(|key| key.to_hex() == agent)
        .ok_or_else(|| invalid("The agent is not a public key."))?;
    let parsed: BundleBody =
        serde_json::from_slice(&body).map_err(|_| invalid("The bundle is not valid."))?;
    // The key is the one secret in the request: keep it in zeroizing memory.
    let nsec = Zeroizing::new(parsed.nsec);

    // Do not store a key for an account that cannot use the cloud yet.
    let email = verified_email(&state, &owner.to_hex()).await?;
    if !state.config.cloud_agents.allows_account(email.as_deref()) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Cloud agents are not available for this account.",
        ));
    }

    // Only the agent's owner may upload its key.
    let recorded_owner = state
        .db
        .get_agent_channel_policy(community, agent_pubkey.as_bytes())
        .await
        .map_err(database_error)?
        .and_then(|(_, owner)| owner);
    if recorded_owner.as_deref() != Some(owner.as_bytes().as_slice()) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "Only the agent's owner can make it cloud-ready.",
        ));
    }

    let snapshot: CloudConfigSnapshot = serde_json::from_value(parsed.config)
        .map_err(|_| invalid("The agent's settings are not valid."))?;
    validate_config_snapshot(&snapshot).map_err(|error| invalid(&error.to_string()))?;
    if let Some(tag) = &parsed.auth_tag {
        let well_formed = tag.len() <= MAX_AUTH_TAG_BYTES
            && serde_json::from_str::<Vec<String>>(tag).is_ok_and(|parts| !parts.is_empty());
        if !well_formed {
            return Err(invalid("The agent's delegation tag is not valid."));
        }
    }
    let keys = nostr::Keys::parse(nsec.as_str())
        .map_err(|_| invalid("The key is not a valid secret key."))?;
    if keys.public_key() != agent_pubkey {
        return Err(invalid("The key does not belong to this agent."));
    }
    let config_version = i64::try_from(parsed.config_version)
        .map_err(|_| invalid("The config version is out of range."))?;
    let kek = state
        .config
        .accounts
        .account_kek()
        .ok_or_else(unavailable)?;
    let envelope = crate::api::accounts::crypto::seal_nsec(kek, &agent, nsec.as_str())
        .map_err(|_| unavailable())?;

    let outcome = state
        .db
        .upsert_cloud_bundle(&BundleRow {
            community,
            agent_pubkey: agent_pubkey.to_bytes().to_vec(),
            owner_pubkey: owner.to_bytes().to_vec(),
            wrapped_dek: envelope.wrapped_dek,
            sealed_nsec: envelope.sealed_nsec,
            nonce: envelope.nonce.to_vec(),
            kek_id: envelope.kek_id,
            auth_tag: parsed.auth_tag,
            config: serde_json::to_value(&snapshot).map_err(database_error)?,
            config_version,
        })
        .await
        .map_err(database_error)?;
    if let UpsertOutcome::Stale { current } = outcome {
        return Err((
            StatusCode::CONFLICT,
            Json(
                json!({"error": "A newer config is already stored.", "currentConfigVersion": current}),
            ),
        ));
    }

    // The head tells every device the agent is cloud-ready. A failure here is
    // surfaced, not swallowed: the upload is idempotent, so the desktop's retry
    // stores the same bundle again and refreshes the head.
    crate::handlers::agent_placement::refresh_head(&state, &tenant, agent_pubkey.as_bytes())
        .await
        .map_err(|error| {
            tracing::error!(
                ?error,
                "placement head refresh failed after a bundle upload"
            );
            unavailable()
        })?;
    Ok(StatusCode::NO_CONTENT)
}

/// The owner removes an agent's cloud copy: the machine is destroyed and the
/// sealed key deleted once the host confirms. Another account's agent, and an
/// agent that never had a cloud copy, are both `404`.
async fn remove_agent(
    State(state): State<Arc<AppState>>,
    Path(agent): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let path = format!("/api/cloud-agents/{agent}");
    let (tenant, owner) = authenticate_member(&state, &headers, "DELETE", &path, None).await?;
    let not_found = || api_error(StatusCode::NOT_FOUND, "No cloud copy of this agent.");
    let agent_pubkey = nostr::PublicKey::from_hex(&agent)
        .ok()
        .filter(|key| key.to_hex() == agent)
        .ok_or_else(not_found)?;
    let removed = state
        .db
        .begin_cloud_teardown(
            owner.as_bytes(),
            tenant.community(),
            agent_pubkey.as_bytes(),
        )
        .await
        .map_err(database_error)?;
    if !removed {
        return Err(not_found());
    }
    // The agent is on the Mac now: tell every device. The journal destroys the
    // machine whether or not this succeeds.
    crate::cloud_agents::refresh_head_for(&state, tenant.community(), agent_pubkey.as_bytes())
        .await;
    crate::cloud_agents::disconnect_agent_connections(
        &state,
        &tenant,
        agent_pubkey.as_bytes(),
        &"0".repeat(64),
    );
    Ok(StatusCode::NO_CONTENT)
}

/// A machine on the OpenCode free route reports that OpenCode refused it. The
/// relay records the switch to the OpenRouter free route (six hours) and queues
/// the next start a few seconds out, once per wake: a report while a switch is
/// already in force changes nothing. The caller proves it is the agent's current
/// machine with its home token, so nobody else can move an agent's route.
async fn free_route_refused(
    State(state): State<Arc<AppState>>,
    Path(agent): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let unauthorized = || api_error(StatusCode::UNAUTHORIZED, "Home token not accepted.");
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty() && token.len() <= 256)
        .ok_or_else(unauthorized)?;
    let agent_pubkey = nostr::PublicKey::from_hex(&agent)
        .ok()
        .filter(|key| key.to_hex() == agent)
        .ok_or_else(unauthorized)?;
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "not_found"))?;
    let outcome = state
        .db
        .switch_cloud_free_route(
            tenant.community(),
            agent_pubkey.as_bytes(),
            &crate::cloud_agents::token_hash(token),
            boot::FREE_ROUTE_SWITCH_HOURS,
            boot::FREE_ROUTE_START_DELAY_SECS,
        )
        .await
        .map_err(database_error)?;
    match outcome {
        FreeRouteSwitch::Switched { generation } => {
            tracing::info!(generation, "cloud agent moved to the OpenRouter free route");
            // The agent shows "waking" while the next machine starts.
            crate::cloud_agents::refresh_head_for(
                &state,
                tenant.community(),
                agent_pubkey.as_bytes(),
            )
            .await;
            Ok(StatusCode::NO_CONTENT)
        }
        FreeRouteSwitch::AlreadySwitched => Ok(StatusCode::NO_CONTENT),
        FreeRouteSwitch::NotCurrent => Err(unauthorized()),
    }
}

async fn boot_machine(State(state): State<Arc<AppState>>, headers: HeaderMap) -> ApiResult {
    let unauthorized = || api_error(StatusCode::UNAUTHORIZED, "Boot token not accepted.");
    let token = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty() && token.len() <= 256)
        .ok_or_else(unauthorized)?;
    match boot::redeem(&state, token).await {
        Ok(env) => {
            let env: serde_json::Map<String, Value> = env
                .iter()
                .map(|(key, value)| (key.clone(), Value::String(value.to_string())))
                .collect();
            Ok(Json(json!({ "env": env })))
        }
        Err(BootError::Unauthorized) => Err(unauthorized()),
        Err(BootError::Unavailable(reason)) => {
            // The reason names a step, never a secret.
            tracing::error!(%reason, "cloud machine boot failed");
            Err(unavailable())
        }
    }
}

#[cfg(test)]
mod postgres_tests {
    use std::sync::OnceLock;

    use axum::{
        body::{to_bytes, Body},
        http::{header, Request},
    };
    use base64::Engine;
    use buzz_core::agent_placement::{Home, PlacementHead};
    use buzz_core::tenant::CommunityId;
    use nostr::{EventBuilder, Keys, Kind, Tag, ToBech32};
    use sha2::{Digest, Sha256};
    use tokio::sync::Mutex;
    use tower::ServiceExt;
    use uuid::Uuid;

    use super::*;
    use crate::cloud_agents::config::{CloudAgentsConfig, CloudMode};
    use crate::handlers::company_initiative::load_head;

    static CLOUD_API_DB_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    const KEK: [u8; 32] = [7; 32];

    struct Fixture {
        state: Arc<AppState>,
        pool: sqlx::PgPool,
        host: String,
        community: CommunityId,
        owner: Keys,
        agent: Keys,
        _serial_guard: tokio::sync::MutexGuard<'static, ()>,
    }

    fn config(mode: CloudMode) -> CloudAgentsConfig {
        CloudAgentsConfig {
            mode,
            allowed_models: vec!["free/a".to_string()],
            default_model: Some("free/a".to_string()),
            ..CloudAgentsConfig::default()
        }
    }

    async fn fixture(cloud: CloudAgentsConfig) -> Fixture {
        let serial_guard = CLOUD_API_DB_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .await;
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must name the disposable test database");
        let pool = sqlx::PgPool::connect(&database_url)
            .await
            .expect("connect to the disposable test database");
        let state =
            crate::state::tests::test_state_for_cloud_agents(&database_url, cloud, Some(KEK)).await;
        let community = Uuid::new_v4();
        let host = format!("cloud-agent-api-{}.test", community.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community)
            .bind(&host)
            .execute(&pool)
            .await
            .expect("insert test community");
        let owner = Keys::generate();
        let agent = Keys::generate();
        sqlx::query("INSERT INTO users (community_id, pubkey) VALUES ($1, $2)")
            .bind(community)
            .bind(owner.public_key().to_bytes().to_vec())
            .execute(&pool)
            .await
            .expect("insert owner");
        sqlx::query(
            "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) VALUES ($1, $2, $3)",
        )
        .bind(community)
        .bind(agent.public_key().to_bytes().to_vec())
        .bind(owner.public_key().to_bytes().to_vec())
        .execute(&pool)
        .await
        .expect("insert agent");
        let email = format!("owner-{}@example.com", Uuid::new_v4().simple());
        sqlx::query(
            "INSERT INTO accounts (id, email, pubkey, email_verified_at, wrapped_dek, kek_id, \
             sealed_nsec, nonce) VALUES ($1, $2, $3, now(), $4, 'test', $5, $6)",
        )
        .bind(Uuid::new_v4())
        .bind(&email)
        .bind(owner.public_key().to_hex())
        .bind(vec![1u8; 28])
        .bind(vec![2u8; 16])
        .bind(vec![3u8; 12])
        .execute(&pool)
        .await
        .expect("insert owner account");
        Fixture {
            state,
            pool,
            host,
            community: CommunityId::from_uuid(community),
            owner,
            agent,
            _serial_guard: serial_guard,
        }
    }

    fn nip98_header(keys: &Keys, url: &str, method: &str, body: Option<&[u8]>) -> String {
        let mut tags = vec![
            Tag::parse(["u", url]).expect("u tag"),
            Tag::parse(["method", method]).expect("method tag"),
        ];
        if let Some(body) = body {
            let payload = hex::encode(Sha256::digest(body));
            tags.push(Tag::parse(["payload", payload.as_str()]).expect("payload tag"));
        }
        let event = EventBuilder::new(Kind::HttpAuth, "")
            .tags(tags)
            .sign_with_keys(keys)
            .expect("sign NIP-98 event");
        format!(
            "Nostr {}",
            base64::engine::general_purpose::STANDARD
                .encode(serde_json::to_vec(&event).expect("serialize NIP-98 event"))
        )
    }

    async fn send(request: Request<Body>, state: &Arc<AppState>) -> (StatusCode, Value) {
        let response = Router::new()
            .nest("/api/cloud-agents", router(state.clone()))
            .oneshot(request)
            .await
            .expect("run request");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1 << 20).await.expect("body");
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    async fn call(
        fixture: &Fixture,
        signer: &Keys,
        method: &str,
        path: &str,
        body: Option<Vec<u8>>,
    ) -> (StatusCode, Value) {
        let url = format!("https://{}{path}", fixture.host);
        let authorization = nip98_header(signer, &url, method, body.as_deref());
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, &fixture.host)
            .header(header::AUTHORIZATION, authorization)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.map_or_else(Body::empty, Body::from))
            .expect("build request");
        send(request, &fixture.state).await
    }

    fn agent_nsec(keys: &Keys) -> String {
        keys.secret_key().to_bech32().expect("encode nsec")
    }

    fn bundle(nsec: &str, config_version: u64, env: &[(&str, &str)]) -> Vec<u8> {
        let env: serde_json::Map<String, Value> = env
            .iter()
            .map(|(k, v)| ((*k).to_owned(), Value::String((*v).to_owned())))
            .collect();
        serde_json::to_vec(&json!({
            "nsec": nsec,
            "authTag": null,
            "config": {
                "name": "Scout",
                "systemPrompt": "Be brief.",
                "teamInstructions": null,
                "respondTo": "owner-only",
                "respondToAllowlist": [],
                "parallelism": 2,
                "idleTimeoutSeconds": null,
                "maxTurnDurationSeconds": 900,
                "subscribeMode": "mentions",
                "envVars": env,
                "effortLevel": null
            },
            "configVersion": config_version
        }))
        .expect("serialize bundle")
    }

    fn bundle_path(fixture: &Fixture) -> String {
        format!(
            "/api/cloud-agents/{}/bundle",
            fixture.agent.public_key().to_hex()
        )
    }

    async fn stored_rows(fixture: &Fixture) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM cloud_agents WHERE community_id = $1")
            .bind(fixture.community.as_uuid())
            .fetch_one(&fixture.pool)
            .await
            .expect("count rows")
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn capabilities_reports_allowlist_membership() {
        let mut cloud = config(CloudMode::Allowlist);
        let listed_owner_email = format!("listed-{}@example.com", Uuid::new_v4().simple());
        cloud.allowlist = vec![listed_owner_email.clone()];
        let fixture = fixture(cloud).await;

        let path = "/api/cloud-agents/capabilities";
        let (status, body) = call(&fixture, &fixture.owner, "GET", path, None).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["enabled"], true);
        assert_eq!(body["allowed"], false, "the account is not on the list yet");
        assert_eq!(body["maxPerAccount"], 2);
        assert_eq!(body["models"], json!(["colony-free", "free/a"]));
        assert_eq!(body["defaultModel"], "free/a");

        sqlx::query("UPDATE accounts SET email = $2 WHERE pubkey = $1")
            .bind(fixture.owner.public_key().to_hex())
            .bind(&listed_owner_email)
            .execute(&fixture.pool)
            .await
            .expect("list the account");
        let (_, body) = call(&fixture, &fixture.owner, "GET", path, None).await;
        assert_eq!(body["allowed"], true);

        let stranger = Keys::generate();
        let (status, body) = call(&fixture, &stranger, "GET", path, None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["allowed"], false,
            "a key with no verified account is never allowed"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn capabilities_say_off_when_the_feature_is_off() {
        let fixture = fixture(config(CloudMode::Off)).await;
        let (status, body) = call(
            &fixture,
            &fixture.owner,
            "GET",
            "/api/cloud-agents/capabilities",
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            (body["enabled"].clone(), body["allowed"].clone()),
            (json!(false), json!(false))
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn bundle_rejects_non_owner() {
        let fixture = fixture(config(CloudMode::On)).await;
        let stranger = Keys::generate();
        let body = bundle(&agent_nsec(&fixture.agent), 1, &[]);
        let (status, _) = call(
            &fixture,
            &stranger,
            "PUT",
            &bundle_path(&fixture),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(stored_rows(&fixture).await, 0);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn bundle_rejects_nsec_pubkey_mismatch() {
        let fixture = fixture(config(CloudMode::On)).await;
        let someone_else = Keys::generate();
        let body = bundle(&agent_nsec(&someone_else), 1, &[]);
        let (status, response) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &bundle_path(&fixture),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        assert_eq!(
            stored_rows(&fixture).await,
            0,
            "a key for another agent is never stored"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn bundle_rejects_secret_env() {
        let fixture = fixture(config(CloudMode::On)).await;
        let body = bundle(
            &agent_nsec(&fixture.agent),
            1,
            &[("OPENROUTER_API_KEY", "sk-should-never-leave-the-mac")],
        );
        let (status, response) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &bundle_path(&fixture),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        assert!(
            !response.to_string().contains("sk-should-never"),
            "the refusal must not echo the value"
        );
        assert_eq!(stored_rows(&fixture).await, 0);
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn bundle_is_refused_while_cloud_agents_are_off() {
        let fixture = fixture(config(CloudMode::Off)).await;
        let body = bundle(&agent_nsec(&fixture.agent), 1, &[]);
        let (status, _) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &bundle_path(&fixture),
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored_rows(&fixture).await,
            0,
            "no key is stored for an account that cannot use the cloud"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn bundle_seals_the_key_publishes_a_ready_head_and_refuses_stale_versions() {
        let fixture = fixture(config(CloudMode::On)).await;
        let nsec = agent_nsec(&fixture.agent);
        let path = bundle_path(&fixture);

        let (status, response) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &path,
            Some(bundle(&nsec, 1, &[("LOG_LEVEL", "debug")])),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{response}");

        let agent_key = fixture.agent.public_key().to_bytes();
        let row = fixture
            .state
            .db
            .get_cloud_agent(fixture.community, &agent_key)
            .await
            .expect("read row")
            .expect("row stored");
        assert_eq!(row.config_version, 1);
        assert!(
            !row.sealed_nsec
                .windows(8)
                .any(|w| nsec.as_bytes().windows(8).any(|n| n == w)),
            "the key must not be stored in the clear"
        );
        let opened = crate::api::accounts::crypto::open_nsec(
            &KEK,
            &fixture.agent.public_key().to_hex(),
            &row.kek_id,
            &row.wrapped_dek,
            &row.sealed_nsec,
            &row.nonce,
        )
        .expect("the sealed key opens with the deployment key");
        assert_eq!(opened.as_str(), nsec);

        let head = load_head(
            &fixture.state,
            fixture.community,
            buzz_core::kind::KIND_AGENT_PLACEMENT_HEAD,
            &fixture.agent.public_key().to_hex(),
        )
        .await
        .expect("read head")
        .map(|stored| {
            serde_json::from_str::<PlacementHead>(&stored.event.content).expect("parse head")
        })
        .expect("a head is published when the bundle lands");
        assert!(head.cloud_ready);
        assert_eq!(
            (head.home, head.generation, head.config_version),
            (Home::Mac, 0, 1)
        );
        assert_eq!(head.status, None);

        let (status, response) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &path,
            Some(bundle(&nsec, 0, &[])),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{response}");
        assert_eq!(response["currentConfigVersion"], 1);
        let (status, _) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &path,
            Some(bundle(&nsec, 1, &[])),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::NO_CONTENT,
            "a retried upload of the same version is fine"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn boot_token_works_once() {
        let fixture = fixture(config(CloudMode::On)).await;
        let nsec = agent_nsec(&fixture.agent);
        let (status, response) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &bundle_path(&fixture),
            Some(bundle(&nsec, 1, &[])),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{response}");
        let agent_key = fixture.agent.public_key().to_bytes();
        fixture
            .state
            .db
            .set_cloud_home_cas(fixture.community, &agent_key, 0, Home::Cloud)
            .await
            .expect("flip to cloud");
        let token = boot::issue(&fixture.state, fixture.community, &agent_key, 1)
            .await
            .expect("issue boot token");

        let boot_request = |token: &str| {
            Request::builder()
                .method("POST")
                .uri("/api/cloud-agents/boot")
                .header(header::HOST, &fixture.host)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .expect("build request")
        };
        let (status, body) = send(boot_request(&token), &fixture.state).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let env = &body["env"];
        assert_eq!(env["BUZZ_PRIVATE_KEY"], json!(nsec));
        assert_eq!(env["COLONY_HOME"], "cloud");
        assert_eq!(env["COLONY_PLACEMENT_GENERATION"], "1");
        assert_eq!(
            env["BUZZ_RELAY_URL"],
            json!(format!("wss://{}", fixture.host))
        );
        assert_eq!(env["BUZZ_ACP_MODEL"], "free/a");
        assert!(env["COLONY_CREDITS_SESSION_ID"]
            .as_str()
            .is_some_and(|id| Uuid::parse_str(id).is_ok()));
        let home_token = env["COLONY_CLOUD_HOME_TOKEN"].as_str().expect("home token");
        let row = fixture
            .state
            .db
            .get_cloud_agent(fixture.community, &agent_key)
            .await
            .expect("read row")
            .expect("row");
        assert_eq!(
            row.home_token_hash.as_deref(),
            Some(crate::cloud_agents::token_hash(home_token).as_slice()),
            "the relay keeps only the hash of the home token it handed out"
        );

        let (status, _) = send(boot_request(&token), &fixture.state).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "a boot token works once");
    }

    /// The whole free-route hand-over: a `colony-free` agent first boots on
    /// OpenCode with no gateway session; its refusal report records one switch;
    /// the next boot is buzz-agent on a free-only gateway session naming no
    /// model; a second report in the same wake changes nothing.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn a_refused_free_route_boots_the_next_machine_on_the_openrouter_free_route() {
        let mut cloud = config(CloudMode::On);
        cloud.default_model = Some("colony-free".to_string());
        let fixture = fixture(cloud).await;
        let nsec = agent_nsec(&fixture.agent);
        let (status, response) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &bundle_path(&fixture),
            Some(bundle(&nsec, 1, &[])),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{response}");
        let agent_key = fixture.agent.public_key().to_bytes();
        fixture
            .state
            .db
            .set_cloud_home_cas(fixture.community, &agent_key, 0, Home::Cloud)
            .await
            .expect("flip to cloud");

        let boot_with = |token: String| {
            Request::builder()
                .method("POST")
                .uri("/api/cloud-agents/boot")
                .header(header::HOST, &fixture.host)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .expect("build request")
        };
        let report = |token: &str| {
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/cloud-agents/{}/free-route-refused",
                    fixture.agent.public_key().to_hex()
                ))
                .header(header::HOST, &fixture.host)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .expect("build request")
        };

        // First boot: OpenCode, no gateway session.
        let token = boot::issue(&fixture.state, fixture.community, &agent_key, 1)
            .await
            .expect("issue boot token");
        let (status, body) = send(boot_with(token.to_string()), &fixture.state).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let env = &body["env"];
        assert_eq!(env["COLONY_CLOUD_ROUTE"], "openCodeFree");
        assert_eq!(env["BUZZ_ACP_AGENT_COMMAND"], "opencode");
        assert!(env.get("COLONY_CREDITS_SESSION_ID").is_none());
        let first_home_token = env["COLONY_CLOUD_HOME_TOKEN"]
            .as_str()
            .expect("home token")
            .to_owned();

        // A stranger's token moves nothing.
        let (status, _) = send(report("not-the-machines-token"), &fixture.state).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(fixture
            .state
            .db
            .cloud_free_route_until(fixture.community, &agent_key)
            .await
            .expect("read route")
            .is_none());

        // The machine's own token records the switch.
        let (status, _) = send(report(&first_home_token), &fixture.state).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(fixture
            .state
            .db
            .cloud_free_route_until(fixture.community, &agent_key)
            .await
            .expect("read route")
            .is_some());

        // Next boot: buzz-agent on the gateway, free-only, naming no model.
        let token = boot::issue(&fixture.state, fixture.community, &agent_key, 1)
            .await
            .expect("issue boot token");
        let (status, body) = send(boot_with(token.to_string()), &fixture.state).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let env = &body["env"];
        assert_eq!(env["COLONY_CLOUD_ROUTE"], "openrouterFree");
        assert_eq!(env["BUZZ_ACP_AGENT_COMMAND"], "buzz-agent");
        assert!(env["COLONY_CREDITS_SESSION_ID"]
            .as_str()
            .is_some_and(|id| Uuid::parse_str(id).is_ok()));
        assert!(env.get("BUZZ_ACP_MODEL").is_none());
        assert!(env.get("COLONY_CREDITS_MODEL").is_none());
        let paid_allowed: bool = sqlx::query_scalar(
            "SELECT paid_allowed FROM account_ai_sessions \
             WHERE agent_pubkey = $1 AND NOT revoked",
        )
        .bind(&agent_key[..])
        .fetch_one(&fixture.pool)
        .await
        .expect("session row");
        assert!(
            !paid_allowed,
            "the free-route session can not choose a paid model"
        );

        // The old machine's token died with the new boot, and a second report
        // with the new one changes nothing: one switch per wake.
        let (status, _) = send(report(&first_home_token), &fixture.state).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let second_home_token = env["COLONY_CLOUD_HOME_TOKEN"].as_str().expect("home token");
        let (status, _) = send(report(second_home_token), &fixture.state).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let starts: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM cloud_agent_ops WHERE community_id = $1 AND op = 'start'",
        )
        .bind(fixture.community.as_uuid())
        .fetch_one(&fixture.pool)
        .await
        .expect("count starts");
        assert_eq!(starts, 1, "a second report queues no second start");
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn boot_refuses_unknown_missing_and_stale_tokens() {
        let fixture = fixture(config(CloudMode::On)).await;
        let unknown = Request::builder()
            .method("POST")
            .uri("/api/cloud-agents/boot")
            .header(header::AUTHORIZATION, "Bearer not-a-real-token")
            .body(Body::empty())
            .expect("build request");
        assert_eq!(
            send(unknown, &fixture.state).await.0,
            StatusCode::UNAUTHORIZED
        );
        let missing = Request::builder()
            .method("POST")
            .uri("/api/cloud-agents/boot")
            .body(Body::empty())
            .expect("build request");
        assert_eq!(
            send(missing, &fixture.state).await.0,
            StatusCode::UNAUTHORIZED
        );

        // A token issued for a generation the agent has since left is never minted.
        let agent_key = fixture.agent.public_key().to_bytes();
        let (status, _) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &bundle_path(&fixture),
            Some(bundle(&agent_nsec(&fixture.agent), 1, &[])),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(
            boot::issue(&fixture.state, fixture.community, &agent_key, 0)
                .await
                .is_err(),
            "a Mac-placed agent gets no boot token"
        );
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn delete_removes_the_cloud_copy_for_its_owner_only() {
        let fixture = fixture(config(CloudMode::On)).await;
        let path = bundle_path(&fixture);
        let (status, _) = call(
            &fixture,
            &fixture.owner,
            "PUT",
            &path,
            Some(bundle(&agent_nsec(&fixture.agent), 1, &[])),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let agent_path = format!("/api/cloud-agents/{}", fixture.agent.public_key().to_hex());

        let stranger = Keys::generate();
        let (status, _) = call(&fixture, &stranger, "DELETE", &agent_path, None).await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "another account cannot see it"
        );
        assert_eq!(stored_rows(&fixture).await, 1);

        let (status, _) = call(&fixture, &fixture.owner, "DELETE", &agent_path, None).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let pending: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM cloud_agent_ops WHERE community_id = $1 AND op = 'destroy' AND status = 'pending'",
        )
        .bind(fixture.community.as_uuid())
        .fetch_one(&fixture.pool)
        .await
        .expect("count destroy ops");
        assert_eq!(
            pending, 1,
            "the journal will destroy the machine and then the key"
        );
        let (status, _) = call(&fixture, &fixture.owner, "DELETE", &agent_path, None).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "removing twice is harmless");
    }
}
