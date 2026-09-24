use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use base64::Engine as _;
use nostr::{EventBuilder, Keys, Kind, Tag};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::{router::build_router, state::AppState};

struct AlwaysFreshReplayGuard;

impl buzz_auth::Nip98ReplayGuard for AlwaysFreshReplayGuard {
    fn try_mark_in_scope<'a>(
        &'a self,
        _scope: &'a str,
        _event_id: &'a nostr::EventId,
        _ttl_secs: u64,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<bool, buzz_auth::AuthError>> + Send + 'a>,
    > {
        Box::pin(async { Ok(true) })
    }
}

async fn test_state(
    public: bool,
    ip_limit: u32,
    global_limit: u32,
) -> (Arc<AppState>, PgPool, String, String) {
    let mut config = crate::config::Config::from_env().expect("test relay config");
    let database_url = crate::test_support::database_url();
    config.database_url = database_url.clone();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    config.require_relay_membership = false;
    let domain = format!("communities-{}.example", Uuid::new_v4().simple());
    config.self_provision_domain = Some(domain.clone());
    config.self_provision_public = public;
    config.self_provision_public_ip_limit = ip_limit;
    config.self_provision_public_global_limit = global_limit;

    let host = format!("self-serve-{}.example", Uuid::new_v4().simple());
    config.relay_url = format!("wss://{host}");

    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect self-serve integration test Postgres");
    if !matches!(
        std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(),
        Ok("desired")
    ) {
        buzz_db::migration::run_migrations(&pool)
            .await
            .expect("apply self-serve integration schema");
    }
    let db = buzz_db::Db::from_pool(pool.clone());
    db.ensure_configured_community(&host)
        .await
        .expect("create ingress community");

    let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("create self-serve integration Redis pool");
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
            .await
            .expect("connect self-serve integration Redis pubsub"),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media_storage =
        buzz_media::MediaStorage::new(&config.media).expect("self-serve integration media config");
    let (mut state, _audit_shutdown) = AppState::new(
        config,
        db,
        redis_pool,
        None::<buzz_audit::AuditService>,
        pubsub,
        auth,
        search,
        workflow_engine,
        Keys::generate(),
        media_storage,
    );
    state.nip98_replay = Arc::new(AlwaysFreshReplayGuard);
    (Arc::new(state), pool, host, domain)
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
    let json = serde_json::to_vec(&event).expect("serialize NIP-98 event");
    format!(
        "Nostr {}",
        base64::engine::general_purpose::STANDARD.encode(json)
    )
}

async fn signed_request(
    state: Arc<AppState>,
    keys: &Keys,
    host: &str,
    method: &str,
    path: &str,
    body: Option<String>,
    client_ip: Option<&str>,
) -> axum::response::Response {
    signed_request_with_signature_path(state, keys, host, method, (path, path), body, client_ip)
        .await
}

async fn signed_request_with_signature_path(
    state: Arc<AppState>,
    keys: &Keys,
    host: &str,
    method: &str,
    paths: (&str, &str),
    body: Option<String>,
    client_ip: Option<&str>,
) -> axum::response::Response {
    let (request_path, signature_path) = paths;
    // `relay_url` is WSS in these integration states, so the NIP-98 HTTP URL
    // uses HTTPS just like the production desktop client.
    let url = format!("https://{host}{signature_path}");
    let authorization = nip98_header(keys, &url, method, body.as_deref().map(str::as_bytes));
    let mut request = Request::builder()
        .method(method)
        .uri(request_path)
        .header(header::HOST, host)
        .header(header::AUTHORIZATION, authorization);
    if let Some(ip) = client_ip {
        request = request.header("fly-client-ip", ip);
    }
    if body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/json");
    }
    build_router(state)
        .oneshot(
            request
                .body(body.map_or_else(Body::empty, Body::from))
                .expect("build request"),
        )
        .await
        .expect("run request")
}

async fn add_member(state: &AppState, host: &str, keys: &Keys) {
    let community = state
        .db
        .lookup_community_by_host(host)
        .await
        .expect("lookup ingress community")
        .expect("ingress community exists");
    state
        .db
        .add_relay_member(community.id, &keys.public_key().to_hex(), "member", None)
        .await
        .expect("add test member");
}

async fn create_request(
    state: Arc<AppState>,
    keys: &Keys,
    ingress_host: &str,
    name: &str,
    client_ip: Option<&str>,
) -> axum::response::Response {
    signed_request(
        state,
        keys,
        ingress_host,
        "POST",
        "/api/communities",
        Some(serde_json::json!({ "name": name }).to_string()),
        client_ip,
    )
    .await
}

async fn response_json(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read response body");
    serde_json::from_slice(&bytes).expect("response JSON")
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn create_grants_owner_membership_and_mine_lists_it() {
    let (state, _pool, ingress_host, domain) = test_state(false, 3, 50).await;
    let owner = Keys::generate();
    add_member(&state, &ingress_host, &owner).await;
    let slug = format!("team-{}", Uuid::new_v4().simple());

    let response = create_request(state.clone(), &owner, &ingress_host, &slug, None).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    let community = &body["community"];
    assert_eq!(community["slug"], slug);
    assert_eq!(community["normalized_host"], format!("{slug}.{domain}"));
    assert_eq!(community["owner_pubkey"], owner.public_key().to_hex());

    let host = community["normalized_host"].as_str().expect("host string");
    let record = state
        .db
        .lookup_community_by_host(host)
        .await
        .expect("lookup created community")
        .expect("created community exists");
    let membership = state
        .db
        .get_relay_member(record.id, &owner.public_key().to_hex())
        .await
        .expect("lookup created owner membership")
        .expect("owner has a membership row");
    assert_eq!(membership.role, "owner");

    let mine = signed_request(
        state.clone(),
        &owner,
        &ingress_host,
        "GET",
        "/api/communities/mine",
        None,
        None,
    )
    .await;
    assert_eq!(mine.status(), StatusCode::OK);
    let mine = response_json(mine).await;
    assert!(mine["communities"]
        .as_array()
        .is_some_and(|rows| { rows.iter().any(|row| row["normalized_host"] == host) }));

    let member_scope = signed_request_with_signature_path(
        state,
        &owner,
        &ingress_host,
        "GET",
        (
            "/api/communities/mine?scope=member",
            "/api/communities/mine",
        ),
        None,
        None,
    )
    .await;
    assert_eq!(member_scope.status(), StatusCode::OK);
    let member_scope = response_json(member_scope).await;
    assert!(member_scope["communities"].as_array().is_some_and(|rows| {
        rows.iter()
            .any(|row| row["normalized_host"] == host && row["role"] == "owner")
    }));
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn availability_reports_free_taken_and_invalid_slugs() {
    let (state, _pool, ingress_host, domain) = test_state(false, 3, 50).await;
    let owner = Keys::generate();
    add_member(&state, &ingress_host, &owner).await;
    let slug = format!("check-{}", Uuid::new_v4().simple());

    let available = build_router(state.clone())
        .oneshot(
            Request::builder()
                .uri(format!("/api/communities/availability?name={slug}"))
                .body(Body::empty())
                .expect("availability request"),
        )
        .await
        .expect("availability response");
    assert_eq!(available.status(), StatusCode::OK);
    let available = response_json(available).await;
    assert_eq!(available["available"], true);
    assert_eq!(available["normalized_host"], format!("{slug}.{domain}"));

    let invalid = build_router(state.clone())
        .oneshot(
            Request::builder()
                .uri("/api/communities/availability?name=bad--name")
                .body(Body::empty())
                .expect("invalid availability request"),
        )
        .await
        .expect("invalid availability response");
    assert_eq!(invalid.status(), StatusCode::OK);
    let invalid = response_json(invalid).await;
    assert_eq!(invalid["available"], false);
    assert!(invalid["reason"].as_str().is_some());

    add_member(&state, &ingress_host, &owner).await;
    let created = create_request(state.clone(), &owner, &ingress_host, &slug, None).await;
    assert_eq!(created.status(), StatusCode::OK);

    let taken = build_router(state)
        .oneshot(
            Request::builder()
                .uri(format!("/api/communities/availability?name={slug}"))
                .body(Body::empty())
                .expect("taken availability request"),
        )
        .await
        .expect("taken availability response");
    let taken = response_json(taken).await;
    assert_eq!(taken["available"], false);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn create_rejects_invalid_slug_on_the_signed_route() {
    let (state, _pool, ingress_host, _domain) = test_state(false, 3, 50).await;
    let member = Keys::generate();
    add_member(&state, &ingress_host, &member).await;

    let response = create_request(state, &member, &ingress_host, "relay", None).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn create_enforces_the_atomic_per_owner_cap() {
    let (state, _pool, ingress_host, _domain) = test_state(false, 3, 50).await;
    let owner = Keys::generate();
    add_member(&state, &ingress_host, &owner).await;
    let cap = buzz_db::relay_members::max_communities_per_owner() as usize;
    assert!(cap > 0, "owner cap must be positive");

    for _ in 0..cap {
        let slug = format!("cap-{}", Uuid::new_v4().simple());
        let response = create_request(state.clone(), &owner, &ingress_host, &slug, None).await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    let over_cap = format!("cap-{}", Uuid::new_v4().simple());
    let response = create_request(state, &owner, &ingress_host, &over_cap, None).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(response_json(response).await["error"]
        .as_str()
        .is_some_and(|error| error.starts_with("limit_reached:")));
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn public_mode_allows_first_creation_then_enforces_per_ip_limit() {
    let (state, _pool, ingress_host, _domain) = test_state(true, 1, 50).await;
    let new_account = Keys::generate();

    let first = create_request(
        state.clone(),
        &new_account,
        &ingress_host,
        &format!("public-{}", Uuid::new_v4().simple()),
        Some("198.51.100.10"),
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);

    let second = create_request(
        state,
        &new_account,
        &ingress_host,
        &format!("public-{}", Uuid::new_v4().simple()),
        Some("198.51.100.10"),
    )
    .await;
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn public_mode_enforces_the_global_creation_limit_across_source_ips() {
    let (state, _pool, ingress_host, _domain) = test_state(true, 50, 1).await;
    let first_account = Keys::generate();
    let second_account = Keys::generate();

    let first = create_request(
        state.clone(),
        &first_account,
        &ingress_host,
        &format!("global-{}", Uuid::new_v4().simple()),
        Some("198.51.100.20"),
    )
    .await;
    assert_eq!(first.status(), StatusCode::OK);

    let second = create_request(
        state,
        &second_account,
        &ingress_host,
        &format!("global-{}", Uuid::new_v4().simple()),
        Some("198.51.100.21"),
    )
    .await;
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn public_mode_fails_closed_when_the_shared_limiter_is_unavailable() {
    let (state, _pool, ingress_host, _domain) = test_state(true, 3, 50).await;
    let mut broken_state = (*state).clone();
    broken_state.redis_pool = deadpool_redis::Config::from_url("redis://127.0.0.1:1")
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("create unavailable Redis pool");
    let state = Arc::new(broken_state);
    let account = Keys::generate();
    let slug = format!("redis-down-{}", Uuid::new_v4().simple());

    let response = create_request(
        state.clone(),
        &account,
        &ingress_host,
        &slug,
        Some("198.51.100.30"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

    let host = format!(
        "{slug}.{}",
        state
            .config
            .self_provision_domain
            .as_deref()
            .expect("domain")
    );
    assert!(state
        .db
        .lookup_community_by_host(&host)
        .await
        .expect("check community after rate limiter outage")
        .is_none());
}
