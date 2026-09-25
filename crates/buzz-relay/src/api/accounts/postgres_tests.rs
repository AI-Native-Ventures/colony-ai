use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use buzz_db::Db;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;

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

const TEST_KEK: [u8; 32] = [0x5a; 32];
const TEST_GOOGLE_AUDIENCE: &str = "colony-test-google-client";
const FAKE_GOOGLE_PRIVATE_KEY: &str = include_str!("testdata/fake_google_private.pem");
const FAKE_GOOGLE_JWKS: &str = include_str!("testdata/fake_google_jwks.json");

async fn test_state(
    google_client_ids: Vec<String>,
    google_jwks_url: Option<String>,
) -> (Arc<AppState>, PgPool, String) {
    let mut config = crate::config::Config::from_env().expect("test relay config");
    let database_url = crate::test_support::database_url();
    config.database_url = database_url.clone();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_owned());
    config.require_relay_membership = false;
    config.accounts = crate::config::AccountConfig::test_config(
        Some(TEST_KEK),
        Some(AccountMailMode::Log),
        google_client_ids,
        google_jwks_url,
    );
    let host = format!("account-test-{}.example", Uuid::new_v4().simple());
    config.relay_url = format!("wss://{host}");

    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect account integration test Postgres");
    // The shared PostgreSQL test harness clones the current desired schema,
    // which intentionally has no historical migration ledger. Local runs
    // against an empty database still need the normal migration path.
    if !matches!(
        std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(),
        Ok("desired")
    ) {
        buzz_db::migration::run_migrations(&pool)
            .await
            .expect("apply account integration schema");
    }
    let db = Db::from_pool(pool.clone());
    db.ensure_configured_community(&host)
        .await
        .expect("create account integration community");

    let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("create account integration Redis pool");
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
            .await
            .expect("connect account integration Redis pubsub"),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media_storage =
        buzz_media::MediaStorage::new(&config.media).expect("account integration media config");
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
    (Arc::new(state), pool, host)
}

fn request_with_ip(
    method: &str,
    path: &str,
    host: &str,
    ip: Ipv4Addr,
    body: Vec<u8>,
    authorization: Option<String>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, host)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(authorization) = authorization {
        builder = builder.header(header::AUTHORIZATION, authorization);
    }
    let mut request = builder
        .body(Body::from(body))
        .expect("build account request");
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::new(IpAddr::V4(ip), 43123)));
    request
}

fn nip98_header(keys: &Keys, method: &str, url: &str, body: Option<&[u8]>) -> String {
    let mut tags = vec![
        Tag::parse(["u", url]).expect("NIP-98 URL tag"),
        Tag::parse(["method", method]).expect("NIP-98 method tag"),
    ];
    if let Some(body) = body {
        let hash = hex::encode(Sha256::digest(body));
        tags.push(Tag::parse(["payload", hash.as_str()]).expect("NIP-98 payload tag"));
    }
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .tags(tags)
        .sign_with_keys(keys)
        .expect("sign NIP-98 request");
    format!(
        "Nostr {}",
        BASE64.encode(serde_json::to_vec(&event).expect("serialize NIP-98 event"))
    )
}

async fn call(
    state: Arc<AppState>,
    method: &str,
    path: &str,
    host: &str,
    ip: Ipv4Addr,
    body: Value,
    keys: Option<&Keys>,
) -> axum::response::Response {
    let body = serde_json::to_vec(&body).expect("serialize request");
    let authorization = keys.map(|keys| {
        nip98_header(
            keys,
            method,
            &format!("https://{host}{path}"),
            (!body.is_empty()).then_some(body.as_slice()),
        )
    });
    crate::router::build_router(state)
        .oneshot(request_with_ip(method, path, host, ip, body, authorization))
        .await
        .expect("account router response")
}

async fn json_response(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let body = to_bytes(response.into_body(), ACCOUNT_BODY_LIMIT)
        .await
        .expect("read account response");
    let json = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).expect("account response JSON")
    };
    (status, json)
}

async fn deliver_pending_mail(state: &Arc<AppState>) {
    let messages = state
        .db
        .claim_account_mail_outbox(buzz_db::accounts::ACCOUNT_MAIL_BATCH_LIMIT)
        .await
        .expect("claim test account mail");
    for message in messages {
        deliver_mail(state, &message).await;
    }
}

async fn test_mail_code(pool: &PgPool, email: &str, purpose: &str) -> String {
    sqlx::query_scalar(
        "SELECT code FROM account_test_mail WHERE recipient = $1 AND purpose = $2 \
         ORDER BY delivered_at DESC LIMIT 1",
    )
    .bind(email)
    .bind(purpose)
    .fetch_one(pool)
    .await
    .expect("read code from the test-only mail sink")
}

fn wrong_test_code(actual: &str) -> String {
    if actual == "000000" {
        "000001".to_owned()
    } else {
        "000000".to_owned()
    }
}

fn google_token(email: &str, sub: &str) -> String {
    google_token_with_claims(
        email,
        sub,
        TEST_GOOGLE_AUDIENCE,
        true,
        (Utc::now().timestamp() + 600) as u64,
    )
}

fn google_token_with_claims(
    email: &str,
    sub: &str,
    audience: &str,
    email_verified: bool,
    expires_at: u64,
) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("fake-google-kid".to_owned());
    let claims = json!({
        "iss": "https://accounts.google.com",
        "aud": audience,
        "sub": sub,
        "exp": expires_at,
        "email": email,
        "email_verified": email_verified,
    });
    encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(FAKE_GOOGLE_PRIVATE_KEY.as_bytes())
            .expect("parse generated test RSA key"),
    )
    .expect("sign generated Google test token")
}

fn unique_test_ip() -> Ipv4Addr {
    let bytes = Uuid::new_v4().into_bytes();
    Ipv4Addr::new(127, bytes[13], bytes[14], bytes[15])
}

async fn fake_google_jwks() -> (String, tokio::task::JoinHandle<()>) {
    let jwks: Value = serde_json::from_str(FAKE_GOOGLE_JWKS).expect("parse generated fake JWKS");
    let app = Router::new().route(
        "/jwks",
        get(move || {
            let jwks = jwks.clone();
            async move { Json(jwks) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind local fake JWKS server");
    let address = listener.local_addr().expect("fake JWKS local address");
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("serve local fake JWKS");
    });
    (format!("http://{address}/jwks"), task)
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn me_returns_account_not_found_for_unclaimed_nip98_signer() {
    let (state, _pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let signer = Keys::generate();
    let response = crate::router::build_router(state)
        .oneshot(request_with_ip(
            "GET",
            "/api/accounts/me",
            &host,
            ip,
            Vec::new(),
            Some(nip98_header(
                &signer,
                "GET",
                &format!("https://{host}/api/accounts/me"),
                None,
            )),
        ))
        .await
        .expect("account profile response for unclaimed signer");
    let (status, body) = json_response(response).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, json!({ "error": "account_not_found" }));
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn signup_verify_signin_reset_claim_me_password_and_delete_use_production_routes() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("owner-{}@example.test", Uuid::new_v4().simple());
    let password = "original-passphrase";
    let signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": email, "password": password }),
        None,
    )
    .await;
    let (signup_status, signup_body) = json_response(signup).await;
    assert_eq!(signup_status, StatusCode::ACCEPTED);
    assert_eq!(signup_body["status"], "verification_sent");
    assert_eq!(
        signup_body["retry_after_secs"],
        ACCOUNT_CODE_RESEND_COOLDOWN_SECS
    );
    deliver_pending_mail(&state).await;
    let verification_code = test_mail_code(&pool, &email, "verify_email").await;
    let (verify_status, verify_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": email, "code": verification_code.clone() }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    let original_pubkey = verify_body["account"]["pubkey"]
        .as_str()
        .expect("session public key")
        .to_owned();
    let original_nsec = verify_body["nsec"].as_str().expect("session key");
    let original_nsec = Zeroizing::new(original_nsec.to_owned());

    for (candidate, expected_status) in [
        (password, StatusCode::OK),
        ("not-the-correct-password", StatusCode::UNAUTHORIZED),
    ] {
        let (status, body) = json_response(
            call(
                state.clone(),
                "POST",
                "/api/accounts/signin",
                &host,
                ip,
                json!({ "email": email, "password": candidate }),
                None,
            )
            .await,
        )
        .await;
        assert_eq!(status, expected_status);
        if status == StatusCode::OK {
            assert_eq!(
                body["account"]["pubkey"].as_str(),
                Some(original_pubkey.as_str())
            );
            assert!(body["nsec"]
                .as_str()
                .is_some_and(|nsec| nsec == original_nsec.as_str()));
        }
    }

    let reset_request = call(
        state.clone(),
        "POST",
        "/api/accounts/reset/request",
        &host,
        ip,
        json!({ "email": email }),
        None,
    )
    .await;
    assert_eq!(reset_request.status(), StatusCode::ACCEPTED);
    let (reset_request_status, reset_request_body) = json_response(reset_request).await;
    assert_eq!(reset_request_status, StatusCode::ACCEPTED);
    assert_eq!(
        reset_request_body["retry_after_secs"],
        ACCOUNT_CODE_RESEND_COOLDOWN_SECS
    );
    deliver_pending_mail(&state).await;
    let reset_code = test_mail_code(&pool, &email, "reset_password").await;
    let reset_password = "recovered-passphrase";
    let (check_status, check_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/check",
            &host,
            ip,
            json!({ "email": email, "code": reset_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(check_status, StatusCode::OK);
    assert_eq!(check_body["status"], "code_valid");
    let (reset_status, reset_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/confirm",
            &host,
            ip,
            json!({ "email": email, "code": reset_code.clone(), "new_password": reset_password }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(reset_status, StatusCode::OK);
    assert_eq!(
        reset_body["account"]["pubkey"].as_str(),
        Some(original_pubkey.as_str())
    );
    assert!(reset_body["nsec"]
        .as_str()
        .is_some_and(|nsec| nsec == original_nsec.as_str()));

    let (replay_status, replay_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/confirm",
            &host,
            ip,
            json!({ "email": email, "code": reset_code, "new_password": reset_password }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(replay_status, StatusCode::GONE);
    assert_eq!(replay_body["error"], "code_expired");

    let (login_status, login_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/signin",
            &host,
            ip,
            json!({ "email": email, "password": reset_password }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(login_status, StatusCode::OK);
    assert_eq!(
        login_body["account"]["pubkey"].as_str(),
        Some(original_pubkey.as_str())
    );

    let nostr_keys = Keys::parse(original_nsec.as_str()).expect("parse returned account key");
    let new_password_body = json!({ "new_password": "claimed-password" });
    let new_password_bytes =
        serde_json::to_vec(&new_password_body).expect("serialize password body");
    let set_password = crate::router::build_router(state.clone())
        .oneshot(request_with_ip(
            "POST",
            "/api/accounts/password",
            &host,
            ip,
            new_password_bytes.clone(),
            Some(nip98_header(
                &nostr_keys,
                "POST",
                &format!("https://{host}/api/accounts/password"),
                Some(&new_password_bytes),
            )),
        ))
        .await
        .expect("password route response");
    assert_eq!(set_password.status(), StatusCode::NO_CONTENT);

    let me = crate::router::build_router(state.clone())
        .oneshot(request_with_ip(
            "GET",
            "/api/accounts/me",
            &host,
            ip,
            Vec::new(),
            Some(nip98_header(
                &nostr_keys,
                "GET",
                &format!("https://{host}/api/accounts/me"),
                None,
            )),
        ))
        .await
        .expect("account profile route response");
    let (me_status, me_body) = json_response(me).await;
    assert_eq!(me_status, StatusCode::OK);
    assert_eq!(me_body["pubkey"].as_str(), Some(original_pubkey.as_str()));
    assert!(me_body.get("nsec").is_none());

    let delete = crate::router::build_router(state.clone())
        .oneshot(request_with_ip(
            "DELETE",
            "/api/accounts/me",
            &host,
            ip,
            Vec::new(),
            Some(nip98_header(
                &nostr_keys,
                "DELETE",
                &format!("https://{host}/api/accounts/me"),
                None,
            )),
        ))
        .await
        .expect("account delete route response");
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);
    let deleted_count: i64 = sqlx::query_scalar("SELECT count(*) FROM accounts WHERE email = $1")
        .bind(&email)
        .fetch_one(&pool)
        .await
        .expect("check deleted account");
    assert_eq!(deleted_count, 0);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn signup_stores_server_signed_profile_and_reset_check_keeps_code_for_confirmation() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("profile-{}@example.test", Uuid::new_v4().simple());
    let signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({
            "email": email,
            "password": "profile-test-password",
            "display_name": "Ada Lovelace",
        }),
        None,
    )
    .await;
    let (signup_status, signup_body) = json_response(signup).await;
    assert_eq!(signup_status, StatusCode::ACCEPTED);
    assert_eq!(
        signup_body["retry_after_secs"],
        ACCOUNT_CODE_RESEND_COOLDOWN_SECS
    );

    let (resend_status, resend_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/resend-code",
            &host,
            ip,
            json!({ "email": email, "purpose": "verify" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(resend_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resend_body["error"], "resend_cooldown");
    assert!(resend_body["retry_after_secs"].as_i64().unwrap_or_default() > 0);

    let pubkey: String = sqlx::query_scalar("SELECT pubkey FROM accounts WHERE email = $1")
        .bind(&email)
        .fetch_one(&pool)
        .await
        .expect("signup account pubkey");
    let community_id: Uuid = sqlx::query_scalar("SELECT id FROM communities WHERE host = $1")
        .bind(&host)
        .fetch_one(&pool)
        .await
        .expect("signup community id");
    let event_json: Value = sqlx::query_scalar(
        "SELECT jsonb_build_object( \
             'id', encode(id, 'hex'), \
             'pubkey', encode(pubkey, 'hex'), \
             'created_at', FLOOR(EXTRACT(EPOCH FROM created_at))::BIGINT, \
             'kind', kind, 'tags', tags, 'content', content, \
             'sig', encode(sig, 'hex')) \
         FROM events WHERE community_id = $1 AND pubkey = $2 AND kind = 0 \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(community_id)
    .bind(hex::decode(&pubkey).expect("decode profile pubkey"))
    .fetch_one(&pool)
    .await
    .expect("signup kind-zero profile event");
    let profile_event =
        nostr::Event::from_json(event_json.to_string()).expect("parse stored profile event");
    assert_eq!(profile_event.kind, Kind::Metadata);
    assert_eq!(
        serde_json::from_str::<Value>(&profile_event.content).expect("profile content"),
        json!({ "display_name": "Ada Lovelace" })
    );
    assert!(profile_event.verify_id());
    assert!(profile_event.verify_signature());

    deliver_pending_mail(&state).await;
    let verification_code = test_mail_code(&pool, &email, "verify_email").await;
    let (verify_status, verify_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": email, "code": verification_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    assert_eq!(verify_body["account"]["pubkey"], pubkey);
    let (verify_replay_status, verify_replay_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": email, "code": verification_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(verify_replay_status, StatusCode::GONE);
    assert_eq!(verify_replay_body["error"], "code_expired");

    let reset_request = call(
        state.clone(),
        "POST",
        "/api/accounts/reset/request",
        &host,
        ip,
        json!({ "email": email }),
        None,
    )
    .await;
    assert_eq!(reset_request.status(), StatusCode::ACCEPTED);
    let (reset_resend_status, reset_resend_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/resend-code",
            &host,
            ip,
            json!({ "email": email, "purpose": "reset" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(reset_resend_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(reset_resend_body["error"], "resend_cooldown");
    assert!(
        reset_resend_body["retry_after_secs"]
            .as_i64()
            .unwrap_or_default()
            > 0
    );
    deliver_pending_mail(&state).await;
    let reset_code = test_mail_code(&pool, &email, "reset_password").await;
    let wrong_code = wrong_test_code(&reset_code);
    let (wrong_status, wrong_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/check",
            &host,
            ip,
            json!({ "email": email, "code": wrong_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(wrong_status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(wrong_body["error"], "wrong_code");
    assert_eq!(wrong_body["attempts_left"], 4);

    let (check_status, check_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/check",
            &host,
            ip,
            json!({ "email": email, "code": reset_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(check_status, StatusCode::OK);
    assert_eq!(check_body["status"], "code_valid");

    let confirm = call(
        state.clone(),
        "POST",
        "/api/accounts/reset/confirm",
        &host,
        ip,
        json!({
            "email": email,
            "code": reset_code,
            "new_password": "profile-reset-password",
        }),
        None,
    )
    .await;
    assert_eq!(confirm.status(), StatusCode::OK);
    let replay = call(
        state,
        "POST",
        "/api/accounts/reset/confirm",
        &host,
        ip,
        json!({
            "email": email,
            "code": reset_code,
            "new_password": "profile-reset-password-2",
        }),
        None,
    )
    .await;
    let (replay_status, replay_body) = json_response(replay).await;
    assert_eq!(replay_status, StatusCode::GONE);
    assert_eq!(replay_body["error"], "code_expired");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn verification_code_reports_remaining_attempts_and_resend_lockout() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("verify-lock-{}@example.test", Uuid::new_v4().simple());
    let signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": email, "password": "verify-lock-password" }),
        None,
    )
    .await;
    assert_eq!(signup.status(), StatusCode::ACCEPTED);
    deliver_pending_mail(&state).await;
    let actual_code = test_mail_code(&pool, &email, "verify_email").await;
    let wrong_code = wrong_test_code(&actual_code);

    for attempts_left in (1..=4).rev() {
        let (status, body) = json_response(
            call(
                state.clone(),
                "POST",
                "/api/accounts/verify",
                &host,
                ip,
                json!({ "email": email, "code": wrong_code }),
                None,
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"], "wrong_code");
        assert_eq!(body["attempts_left"], attempts_left);
    }

    let (locked_status, locked_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": email, "code": wrong_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(locked_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(locked_body["error"], "too_many_attempts");
    assert!(locked_body["retry_after_secs"].as_i64().unwrap_or_default() > 0);

    let account = state
        .db
        .account_by_email(&email)
        .await
        .expect("read locked verification account")
        .expect("locked verification account exists");
    let (_, replacement) = new_code(&TEST_KEK, AccountCodePurpose::VerifyEmail)
        .expect("generate replacement verification code");
    let issue = state
        .db
        .issue_account_code(account.id, &account.email, &replacement)
        .await
        .expect("attempt direct replacement of locked verification code");
    assert!(matches!(
        issue,
        IssueAccountCodeOutcome::Locked { retry_after_secs } if retry_after_secs > 0
    ));

    let (resend_status, resend_body) = json_response(
        call(
            state,
            "POST",
            "/api/accounts/resend-code",
            &host,
            ip,
            json!({ "email": email, "purpose": "verify" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(resend_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resend_body["error"], "too_many_attempts");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn reset_code_reports_attempt_limit_without_consuming_on_check() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("reset-lock-{}@example.test", Uuid::new_v4().simple());
    let signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": email, "password": "reset-lock-password" }),
        None,
    )
    .await;
    assert_eq!(signup.status(), StatusCode::ACCEPTED);
    deliver_pending_mail(&state).await;
    let verification_code = test_mail_code(&pool, &email, "verify_email").await;
    let verified = call(
        state.clone(),
        "POST",
        "/api/accounts/verify",
        &host,
        ip,
        json!({ "email": email, "code": verification_code }),
        None,
    )
    .await;
    assert_eq!(verified.status(), StatusCode::OK);
    assert_eq!(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/request",
            &host,
            ip,
            json!({ "email": email }),
            None,
        )
        .await
        .status(),
        StatusCode::ACCEPTED
    );
    deliver_pending_mail(&state).await;
    let reset_code = test_mail_code(&pool, &email, "reset_password").await;
    let wrong_code = wrong_test_code(&reset_code);

    let (confirm_wrong_status, confirm_wrong_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/confirm",
            &host,
            ip,
            json!({
                "email": email,
                "code": wrong_code,
                "new_password": "reset-confirm-password",
            }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(confirm_wrong_status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(confirm_wrong_body["error"], "wrong_code");
    assert_eq!(confirm_wrong_body["attempts_left"], 4);

    for attempts_left in (1..=3).rev() {
        let (status, body) = json_response(
            call(
                state.clone(),
                "POST",
                "/api/accounts/reset/check",
                &host,
                ip,
                json!({ "email": email, "code": wrong_code }),
                None,
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"], "wrong_code");
        assert_eq!(body["attempts_left"], attempts_left);
    }
    let (locked_status, locked_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/check",
            &host,
            ip,
            json!({ "email": email, "code": wrong_code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(locked_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(locked_body["error"], "too_many_attempts");
    assert!(locked_body["retry_after_secs"].as_i64().unwrap_or_default() > 0);

    let (confirm_locked_status, confirm_locked_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/confirm",
            &host,
            ip,
            json!({
                "email": email,
                "code": reset_code,
                "new_password": "reset-confirm-password-2",
            }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(confirm_locked_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(confirm_locked_body["error"], "too_many_attempts");
    assert!(
        confirm_locked_body["retry_after_secs"]
            .as_i64()
            .unwrap_or_default()
            > 0
    );

    let (resend_status, resend_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/resend-code",
            &host,
            ip,
            json!({ "email": email, "purpose": "reset" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(resend_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(resend_body["error"], "too_many_attempts");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn google_test_jwks_creates_accounts_and_links_verified_email() {
    let (jwks_url, server) = fake_google_jwks().await;
    let (state, pool, host) =
        test_state(vec![TEST_GOOGLE_AUDIENCE.to_owned()], Some(jwks_url)).await;
    let ip = unique_test_ip();
    let new_email = format!("google-new-{}@example.test", Uuid::new_v4().simple());
    let new_sub = format!("fake-google-sub-new-{}", Uuid::new_v4().simple());
    for invalid_token in [
        google_token_with_claims(
            "unverified@example.test",
            "unverified-test-sub",
            TEST_GOOGLE_AUDIENCE,
            false,
            (Utc::now().timestamp() + 600) as u64,
        ),
        google_token_with_claims(
            "wrong-audience@example.test",
            "wrong-audience-test-sub",
            "another-test-client",
            true,
            (Utc::now().timestamp() + 600) as u64,
        ),
        google_token_with_claims(
            "expired@example.test",
            "expired-test-sub",
            TEST_GOOGLE_AUDIENCE,
            true,
            0,
        ),
    ] {
        let (status, _) = json_response(
            call(
                state.clone(),
                "POST",
                "/api/accounts/google",
                &host,
                ip,
                json!({ "id_token": invalid_token }),
                None,
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    let token = google_token(&new_email, &new_sub);
    let (new_status, new_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/google",
            &host,
            ip,
            json!({ "id_token": token }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(new_status, StatusCode::OK);
    assert_eq!(
        new_body["account"]["email"].as_str(),
        Some(new_email.as_str())
    );
    let new_pubkey = new_body["account"]["pubkey"]
        .as_str()
        .expect("Google account pubkey");

    let linked_email = format!("google-link-{}@example.test", Uuid::new_v4().simple());
    let signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": linked_email, "password": "original-link-password" }),
        None,
    )
    .await;
    assert_eq!(signup.status(), StatusCode::ACCEPTED);
    deliver_pending_mail(&state).await;
    let code = test_mail_code(&pool, &linked_email, "verify_email").await;
    let (verify_status, verify_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": linked_email, "code": code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    let original_pubkey = verify_body["account"]["pubkey"]
        .as_str()
        .expect("verified account key");
    let linked_sub = format!("fake-google-sub-link-{}", Uuid::new_v4().simple());
    let token = google_token(&linked_email, &linked_sub);
    let (link_status, link_body) = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/google",
            &host,
            ip,
            json!({ "id_token": token }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(link_status, StatusCode::OK);
    assert_eq!(
        link_body["account"]["pubkey"].as_str(),
        Some(original_pubkey)
    );
    assert_eq!(link_body["account"]["google_linked"].as_bool(), Some(true));
    assert_ne!(new_pubkey, original_pubkey);
    server.abort();
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn claim_requires_matching_nip98_signer_and_returns_verification_only() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("claim-{}@example.test", Uuid::new_v4().simple());
    let (pubkey, nsec) = crypto::generate_nostr_identity().expect("create test account identity");
    let (_other_pubkey, other_nsec) =
        crypto::generate_nostr_identity().expect("create other identity");
    let mismatched = json!({
        "email": email,
        "password": "claim-passphrase",
        "nsec": other_nsec.as_str(),
    });
    let mismatched_bytes = serde_json::to_vec(&mismatched).expect("serialize mismatched claim");
    let other_keys = Keys::parse(&nsec).expect("parse claim signer key");
    let mismatch_response = crate::router::build_router(state.clone())
        .oneshot(request_with_ip(
            "POST",
            "/api/accounts/claim",
            &host,
            ip,
            mismatched_bytes.clone(),
            Some(nip98_header(
                &other_keys,
                "POST",
                &format!("https://{host}/api/accounts/claim"),
                Some(&mismatched_bytes),
            )),
        ))
        .await
        .expect("mismatched claim response");
    assert_eq!(mismatch_response.status(), StatusCode::UNAUTHORIZED);

    let claim = json!({
        "email": email,
        "password": "claim-passphrase",
        "nsec": nsec.as_str(),
    });
    let claim_bytes = serde_json::to_vec(&claim).expect("serialize claim body");
    let keys = Keys::parse(&nsec).expect("parse matching claim key");
    let response = crate::router::build_router(state.clone())
        .oneshot(request_with_ip(
            "POST",
            "/api/accounts/claim",
            &host,
            ip,
            claim_bytes.clone(),
            Some(nip98_header(
                &keys,
                "POST",
                &format!("https://{host}/api/accounts/claim"),
                Some(&claim_bytes),
            )),
        ))
        .await
        .expect("matching claim response");
    let (claim_status, claim_body) = json_response(response).await;
    assert_eq!(claim_status, StatusCode::ACCEPTED);
    assert_eq!(claim_body["status"], "verification_sent");
    let account = state
        .db
        .account_by_email(&email)
        .await
        .expect("read claimed account")
        .expect("claimed account exists");
    assert_eq!(account.pubkey, pubkey);
    assert!(account.email_verified_at.is_none());
    deliver_pending_mail(&state).await;
    let code = test_mail_code(&pool, &email, "verify_email").await;
    let (verify_status, verify_body) = json_response(
        call(
            state,
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": email, "code": code }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    assert_eq!(
        verify_body["account"]["pubkey"].as_str(),
        Some(pubkey.as_str())
    );
    assert!(verify_body["nsec"]
        .as_str()
        .is_some_and(|value| value == nsec.as_str()));
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn lockout_enumeration_code_expiry_attempts_and_ip_email_limits_are_enforced() {
    let (state, pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("limit-{}@example.test", Uuid::new_v4().simple());
    let signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": email, "password": "lockout-passphrase" }),
        None,
    )
    .await;
    assert_eq!(signup.status(), StatusCode::ACCEPTED);
    deliver_pending_mail(&state).await;
    let code = test_mail_code(&pool, &email, "verify_email").await;
    assert_eq!(
        call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": email, "code": code }),
            None
        )
        .await
        .status(),
        StatusCode::OK
    );

    for _ in 0..5 {
        let wrong = call(
            state.clone(),
            "POST",
            "/api/accounts/signin",
            &host,
            ip,
            json!({ "email": email, "password": "wrong-lockout-passphrase" }),
            None,
        )
        .await;
        assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    }
    let locked = call(
        state.clone(),
        "POST",
        "/api/accounts/signin",
        &host,
        ip,
        json!({ "email": email, "password": "lockout-passphrase" }),
        None,
    )
    .await;
    assert_eq!(locked.status(), StatusCode::UNAUTHORIZED);

    let missing = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/signin",
            &host,
            unique_test_ip(),
            json!({ "email": "missing-user@example.test", "password": "wrong-lockout-passphrase" }),
            None,
        )
        .await,
    )
    .await;
    let wrong_existing = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/signin",
            &host,
            unique_test_ip(),
            json!({ "email": email, "password": "wrong-lockout-passphrase" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(missing.0, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong_existing.0, StatusCode::UNAUTHORIZED);
    assert_eq!(missing.1, wrong_existing.1);

    let attempted_email = format!("attempts-{}@example.test", Uuid::new_v4().simple());
    let attempt_signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": attempted_email, "password": "attempts-passphrase" }),
        None,
    )
    .await;
    assert_eq!(attempt_signup.status(), StatusCode::ACCEPTED);
    deliver_pending_mail(&state).await;
    let actual_code = test_mail_code(&pool, &attempted_email, "verify_email").await;
    let wrong_code = if actual_code == "000000" {
        "000001"
    } else {
        "000000"
    };
    for attempts_left in (1..=4).rev() {
        let response = call(
            state.clone(),
            "POST",
            "/api/accounts/verify",
            &host,
            ip,
            json!({ "email": attempted_email, "code": wrong_code }),
            None,
        )
        .await;
        let (status, body) = json_response(response).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(body["error"], "wrong_code");
        assert_eq!(body["attempts_left"], attempts_left);
    }
    let locked_code = call(
        state.clone(),
        "POST",
        "/api/accounts/verify",
        &host,
        ip,
        json!({ "email": attempted_email, "code": actual_code }),
        None,
    )
    .await;
    let (locked_status, locked_body) = json_response(locked_code).await;
    assert_eq!(locked_status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(locked_body["error"], "too_many_attempts");
    assert!(locked_body["retry_after_secs"]
        .as_i64()
        .is_some_and(|seconds| seconds > 0));

    let expired_email = format!("expired-{}@example.test", Uuid::new_v4().simple());
    let expired_signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": expired_email, "password": "expired-passphrase" }),
        None,
    )
    .await;
    assert_eq!(expired_signup.status(), StatusCode::ACCEPTED);
    deliver_pending_mail(&state).await;
    let expired_code = test_mail_code(&pool, &expired_email, "verify_email").await;
    sqlx::query(
        "UPDATE account_codes c SET expires_at = now() - interval '1 minute' \
         FROM accounts a WHERE c.account_id = a.id AND a.email = $1 AND c.consumed_at IS NULL",
    )
    .bind(&expired_email)
    .execute(&pool)
    .await
    .expect("expire verification code");
    let expired_response = call(
        state.clone(),
        "POST",
        "/api/accounts/verify",
        &host,
        ip,
        json!({ "email": expired_email, "code": expired_code }),
        None,
    )
    .await;
    assert_eq!(expired_response.status(), StatusCode::GONE);

    let email_limited = format!("email-rate-{}@example.test", Uuid::new_v4().simple());
    for attempt in 0..=EMAIL_RATE_LIMIT {
        let response = call(
            state.clone(),
            "POST",
            "/api/accounts/reset/request",
            &host,
            unique_test_ip(),
            json!({ "email": email_limited }),
            None,
        )
        .await;
        assert_eq!(
            response.status(),
            if attempt < EMAIL_RATE_LIMIT {
                StatusCode::ACCEPTED
            } else {
                StatusCode::TOO_MANY_REQUESTS
            }
        );
        if attempt == EMAIL_RATE_LIMIT {
            let (_, body) = json_response(response).await;
            assert_eq!(body["error"], "rate_limited");
            assert!(body["retry_after_secs"]
                .as_i64()
                .is_some_and(|seconds| seconds > 0));
        }
    }

    let ip_base = unique_test_ip();
    for attempt in 0..=IP_RATE_LIMIT {
        let email = format!("ip-rate-{attempt}-{}@example.test", Uuid::new_v4().simple());
        let response = call(
            state.clone(),
            "POST",
            "/api/accounts/reset/request",
            &host,
            ip_base,
            json!({ "email": email }),
            None,
        )
        .await;
        assert_eq!(
            response.status(),
            if attempt < IP_RATE_LIMIT {
                StatusCode::ACCEPTED
            } else {
                StatusCode::TOO_MANY_REQUESTS
            }
        );
    }
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn reset_requests_do_not_enumerate_and_signup_is_the_only_email_conflict() {
    let (state, _pool, host) = test_state(Vec::new(), None).await;
    let ip = unique_test_ip();
    let email = format!("enumeration-{}@example.test", Uuid::new_v4().simple());
    let signup = call(
        state.clone(),
        "POST",
        "/api/accounts/signup",
        &host,
        ip,
        json!({ "email": email, "password": "enumeration-passphrase" }),
        None,
    )
    .await;
    assert_eq!(signup.status(), StatusCode::ACCEPTED);
    let duplicate = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/signup",
            &host,
            ip,
            json!({ "email": email, "password": "enumeration-passphrase" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(duplicate.0, StatusCode::CONFLICT);
    assert_eq!(duplicate.1["error"], "email_taken");

    let existing = json_response(
        call(
            state.clone(),
            "POST",
            "/api/accounts/reset/request",
            &host,
            ip,
            json!({ "email": email }),
            None,
        )
        .await,
    )
    .await;
    let missing = json_response(
        call(
            state,
            "POST",
            "/api/accounts/reset/request",
            &host,
            ip,
            json!({ "email": "not-present@example.test" }),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(existing, missing);
    assert_eq!(existing.0, StatusCode::ACCEPTED);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn account_configuration_debug_never_contains_the_master_key() {
    let (state, _pool, _host) = test_state(Vec::new(), None).await;
    let debug = format!("{:?}", state.config.accounts);
    let encoded_key = BASE64.encode(TEST_KEK);
    assert!(debug.contains("[REDACTED]"));
    assert!(!debug.contains(&encoded_key));
}
