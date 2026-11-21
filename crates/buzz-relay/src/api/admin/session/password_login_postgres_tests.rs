use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, HeaderMap, Request, StatusCode};
use buzz_db::Db;
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::api::accounts::crypto;
use crate::config::{AccountConfig, AccountMailMode, AdminAuth, AdminConfig, RelayOperatorEmail};
use crate::state::AppState;

use super::password::password_lockout_key;
use super::{email_identity_hash, session_key, unix_now, verify_token, SESSION_SECS};

const TEST_KEK: [u8; 32] = [0x72; 32];
const CORRECT_PASSWORD: &str = "correct-admin-password";
const WRONG_PASSWORD: &str = "wrong-admin-password";

struct Fixture {
    state: Arc<AppState>,
    pool: PgPool,
    host: String,
}

fn unique_email(label: &str) -> String {
    format!(
        "admin-password-{label}-{}@example.test",
        Uuid::new_v4().simple()
    )
}

fn unique_ip() -> Ipv4Addr {
    let bytes = Uuid::new_v4().into_bytes();
    Ipv4Addr::new(198, bytes[13], bytes[14], bytes[15])
}

async fn fixture(
    allowlisted_emails: Vec<RelayOperatorEmail>,
    operator_pubkeys: Vec<String>,
    mail_mode: Option<AccountMailMode>,
) -> Fixture {
    let mut config = crate::config::Config::from_env().expect("test relay config");
    let database_url = crate::test_support::database_url();
    config.database_url = database_url.clone();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_owned());
    config.require_relay_membership = false;
    config.accounts = AccountConfig::test_config(Some(TEST_KEK), mail_mode, Vec::new(), None);
    let host = format!("admin-password-{}.example", Uuid::new_v4().simple());
    config.admin = Some(AdminConfig {
        host: host.clone(),
        auth: AdminAuth::Nip98,
        web_dir: None,
    });
    config.relay_operator_emails = allowlisted_emails;
    config.relay_operator_pubkeys = operator_pubkeys;

    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect admin password test Postgres");
    if !matches!(
        std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(),
        Ok("desired")
    ) {
        buzz_db::migration::run_migrations(&pool)
            .await
            .expect("apply admin password test migrations");
    }
    let db = Db::from_pool(pool.clone());
    db.ensure_configured_community(&host)
        .await
        .expect("create admin password test community");

    let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("create admin password test Redis pool");
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
            .await
            .expect("connect admin password test Redis pubsub"),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media_storage =
        buzz_media::MediaStorage::new(&config.media).expect("admin password media config");
    let (state, _audit_shutdown) = AppState::new(
        config,
        db,
        redis_pool,
        None::<buzz_audit::AuditService>,
        pubsub,
        auth,
        search,
        workflow_engine,
        nostr::Keys::generate(),
        media_storage,
    );

    Fixture {
        state: Arc::new(state),
        pool,
        host,
    }
}

async fn seed_account(
    pool: &PgPool,
    email: &str,
    pubkey: &str,
    password: Option<&str>,
    verified: bool,
    failed_attempts: i32,
    locked: bool,
) {
    let password_hash = match password {
        Some(password) => Some(
            crypto::hash_password(Zeroizing::new(password.to_owned()))
                .await
                .expect("hash test password"),
        ),
        None => None,
    };
    sqlx::query(
        "INSERT INTO accounts \
            (id, email, email_verified_at, pubkey, password_hash, wrapped_dek, kek_id, \
             sealed_nsec, nonce, failed_attempts, locked_until) \
         VALUES ($1, $2, CASE WHEN $3 THEN now() ELSE NULL END, $4, $5, $6, 'test-kek', \
                 $7, $8, $9, CASE WHEN $10 THEN now() + interval '15 minutes' ELSE NULL END)",
    )
    .bind(Uuid::new_v4())
    .bind(email)
    .bind(verified)
    .bind(pubkey)
    .bind(password_hash)
    .bind(vec![0x11_u8; 28])
    .bind(vec![0x22_u8; 16])
    .bind(vec![0x33_u8; 12])
    .bind(failed_attempts)
    .bind(locked)
    .execute(pool)
    .await
    .expect("seed admin password account");
}

fn request_with_ip(
    method: &str,
    path: &str,
    host: &str,
    origin: &str,
    ip: Ipv4Addr,
    body: Vec<u8>,
) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, host)
        .header(header::ORIGIN, origin)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .expect("build admin password request");
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::new(IpAddr::V4(ip), 43123)));
    request
}

async fn call(
    state: Arc<AppState>,
    method: &str,
    path: &str,
    host: &str,
    origin: &str,
    ip: Ipv4Addr,
    body: Value,
) -> axum::response::Response {
    let body = serde_json::to_vec(&body).expect("serialize admin password body");
    crate::router::build_router(state)
        .oneshot(request_with_ip(method, path, host, origin, ip, body))
        .await
        .expect("admin password response")
}

async fn password_signin(
    state: Arc<AppState>,
    host: &str,
    ip: Ipv4Addr,
    email: &str,
    password: &str,
) -> axum::response::Response {
    call(
        state,
        "POST",
        "/api/admin/v1/session/password",
        host,
        &format!("https://{host}"),
        ip,
        json!({ "email": email, "password": password }),
    )
    .await
}

async fn response_parts(response: axum::response::Response) -> (StatusCode, HeaderMap, Vec<u8>) {
    let status = response.status();
    let headers = response.headers().clone();
    let body = to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("read admin password response");
    (status, headers, body.to_vec())
}

fn response_json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).expect("admin password JSON response")
}

fn cookie_pair(headers: &HeaderMap) -> String {
    headers
        .get(header::SET_COOKIE)
        .expect("session cookie")
        .to_str()
        .expect("session cookie string")
        .split(';')
        .next()
        .expect("cookie pair")
        .to_owned()
}

async fn cookie_probe(
    state: Arc<AppState>,
    host: &str,
    ip: Ipv4Addr,
    cookie: String,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method("GET")
        .uri("/api/admin/v1/probe")
        .header(header::HOST, host)
        .header(header::ORIGIN, format!("https://{host}"))
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .expect("build cookie probe");
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::new(IpAddr::V4(ip), 43123)));
    crate::router::build_router(state)
        .oneshot(request)
        .await
        .expect("cookie probe response")
}

async fn audit_outcome_count(pool: &PgPool, outcome: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*)::bigint FROM relay_operator_email_login_audit \
         WHERE operation = 'password' AND outcome = $1",
    )
    .bind(outcome)
    .fetch_one(pool)
    .await
    .expect("count password-login audit outcomes")
}

async fn clear_password_lockout(state: &AppState, email: &str) {
    let email_hash = email_identity_hash(&TEST_KEK, email).expect("email hash");
    let mut connection = state.redis_pool.get().await.expect("Redis connection");
    let _: i64 = redis::cmd("DEL")
        .arg(password_lockout_key(&email_hash))
        .query_async(&mut *connection)
        .await
        .expect("clear password lockout");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn correct_password_sets_a_cookie_the_admin_api_accepts_without_mutating_the_account() {
    let email = unique_email("success");
    let pubkey = nostr::Keys::generate().public_key().to_hex();
    let fixture = fixture(
        vec![RelayOperatorEmail::Account(email.clone())],
        vec![pubkey.clone()],
        Some(AccountMailMode::Resend),
    )
    .await;
    seed_account(
        &fixture.pool,
        &email,
        &pubkey,
        Some(CORRECT_PASSWORD),
        true,
        2,
        false,
    )
    .await;

    let (status, headers, body) = response_parts(
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            unique_ip(),
            &email,
            CORRECT_PASSWORD,
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = response_json(&body);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["pubkeyShort"].as_str(), Some(&pubkey[..8]));
    assert_eq!(body["expiresInSeconds"].as_u64(), Some(SESSION_SECS));
    let cookie = headers
        .get(header::SET_COOKIE)
        .expect("password sign-in issues a cookie")
        .to_str()
        .expect("cookie is valid header text");
    assert!(cookie.contains(&format!("Max-Age={SESSION_SECS}")));

    let (probe_status, _, probe_body) = response_parts(
        cookie_probe(
            fixture.state.clone(),
            &fixture.host,
            unique_ip(),
            cookie_pair(&headers),
        )
        .await,
    )
    .await;
    assert_eq!(probe_status, StatusCode::OK);
    assert_eq!(response_json(&probe_body)["role"], "operator");

    let (failed_attempts, last_signin_is_null): (i32, bool) = sqlx::query_as(
        "SELECT failed_attempts, last_signin_at IS NULL FROM accounts WHERE email = $1",
    )
    .bind(&email)
    .fetch_one(&fixture.pool)
    .await
    .expect("read account after admin password sign-in");
    assert_eq!(
        failed_attempts, 2,
        "admin sign-in must not reset account policy"
    );
    assert!(
        last_signin_is_null,
        "admin sign-in must not update account policy"
    );
    assert_eq!(audit_outcome_count(&fixture.pool, "success").await, 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn password_failures_are_byte_identical_for_every_eligibility_boundary() {
    let wrong_email = unique_email("wrong");
    let missing_email = unique_email("missing");
    let denied_email = unique_email("denied");
    let unrostered_email = unique_email("unrostered");
    let unverified_email = unique_email("unverified");
    let no_password_email = unique_email("no-password");
    let locked_email = unique_email("account-locked");
    let wrong_key = nostr::Keys::generate().public_key().to_hex();
    let denied_key = nostr::Keys::generate().public_key().to_hex();
    let unrostered_key = nostr::Keys::generate().public_key().to_hex();
    let unverified_key = nostr::Keys::generate().public_key().to_hex();
    let no_password_key = nostr::Keys::generate().public_key().to_hex();
    let locked_key = nostr::Keys::generate().public_key().to_hex();
    let fixture = fixture(
        vec![
            RelayOperatorEmail::Account(wrong_email.clone()),
            RelayOperatorEmail::Account(missing_email.clone()),
            RelayOperatorEmail::Account(unrostered_email.clone()),
            RelayOperatorEmail::Account(unverified_email.clone()),
            RelayOperatorEmail::Account(no_password_email.clone()),
            RelayOperatorEmail::Account(locked_email.clone()),
        ],
        vec![
            wrong_key.clone(),
            unverified_key.clone(),
            no_password_key.clone(),
            locked_key.clone(),
        ],
        Some(AccountMailMode::Resend),
    )
    .await;
    seed_account(
        &fixture.pool,
        &wrong_email,
        &wrong_key,
        Some(CORRECT_PASSWORD),
        true,
        0,
        false,
    )
    .await;
    seed_account(
        &fixture.pool,
        &denied_email,
        &denied_key,
        Some(CORRECT_PASSWORD),
        true,
        0,
        false,
    )
    .await;
    seed_account(
        &fixture.pool,
        &unrostered_email,
        &unrostered_key,
        Some(CORRECT_PASSWORD),
        true,
        0,
        false,
    )
    .await;
    seed_account(
        &fixture.pool,
        &unverified_email,
        &unverified_key,
        Some(CORRECT_PASSWORD),
        false,
        0,
        false,
    )
    .await;
    seed_account(
        &fixture.pool,
        &no_password_email,
        &no_password_key,
        None,
        true,
        0,
        false,
    )
    .await;
    seed_account(
        &fixture.pool,
        &locked_email,
        &locked_key,
        Some(CORRECT_PASSWORD),
        true,
        5,
        true,
    )
    .await;

    let ip = unique_ip();
    let (expected_status, _, expected_body) = response_parts(
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &wrong_email,
            WRONG_PASSWORD,
        )
        .await,
    )
    .await;
    assert_eq!(expected_status, StatusCode::UNAUTHORIZED);

    let failures = [
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &missing_email,
            CORRECT_PASSWORD,
        )
        .await,
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &denied_email,
            CORRECT_PASSWORD,
        )
        .await,
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &unrostered_email,
            CORRECT_PASSWORD,
        )
        .await,
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &unverified_email,
            CORRECT_PASSWORD,
        )
        .await,
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &no_password_email,
            CORRECT_PASSWORD,
        )
        .await,
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &locked_email,
            CORRECT_PASSWORD,
        )
        .await,
        call(
            fixture.state.clone(),
            "POST",
            "/api/admin/v1/session/password",
            &fixture.host,
            &format!("https://{}", fixture.host),
            ip,
            json!({
                "email": wrong_email,
                "password": CORRECT_PASSWORD,
                "unexpected": true,
            }),
        )
        .await,
    ];
    for response in failures {
        let (status, _, body) = response_parts(response).await;
        assert_eq!(status, expected_status);
        assert_eq!(body, expected_body);
    }
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn alias_email_proves_the_account_password_but_mints_the_configured_alias_key() {
    let email = unique_email("alias");
    let account_key = nostr::Keys::generate().public_key().to_hex();
    let alias_key = nostr::Keys::generate().public_key().to_hex();
    let fixture = fixture(
        vec![RelayOperatorEmail::Alias {
            email: email.clone(),
            pubkey: alias_key.clone(),
        }],
        vec![alias_key.clone()],
        Some(AccountMailMode::Resend),
    )
    .await;
    seed_account(
        &fixture.pool,
        &email,
        &account_key,
        Some(CORRECT_PASSWORD),
        true,
        0,
        false,
    )
    .await;

    let (status, headers, _) = response_parts(
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            unique_ip(),
            &email,
            CORRECT_PASSWORD,
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = cookie_pair(&headers)
        .strip_prefix("__Host-colony_admin=")
        .expect("password session token")
        .to_owned();
    assert_eq!(
        verify_token(
            &session_key(&TEST_KEK).expect("session key"),
            &token,
            unix_now(),
        ),
        Some(alias_key),
        "the alias session must name the configured rostered key"
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn final_password_fence_observes_an_app_lock_created_after_the_initial_lookup() {
    let email = unique_email("lock-transition");
    let pubkey = nostr::Keys::generate().public_key().to_hex();
    let fixture = fixture(
        vec![RelayOperatorEmail::Account(email.clone())],
        vec![pubkey.clone()],
        Some(AccountMailMode::Resend),
    )
    .await;
    seed_account(
        &fixture.pool,
        &email,
        &pubkey,
        Some(CORRECT_PASSWORD),
        true,
        4,
        false,
    )
    .await;

    // This is the lookup that supplies the real Argon2 hash. A normal account
    // password failure can commit the app lock while that verification runs.
    let initial = fixture
        .state
        .db
        .account_by_email(&email)
        .await
        .expect("initial account lookup")
        .expect("seeded account");
    let password_hash = initial
        .password_hash()
        .expect("seeded password hash")
        .to_owned();
    fixture
        .state
        .db
        .account_password_signin_failure(initial.id)
        .await
        .expect("lock account after initial lookup");

    let final_fence = fixture
        .state
        .db
        .account_for_admin_password_signin(initial.id, &email, &password_hash)
        .await
        .expect("final password fence");
    assert!(matches!(
        final_fence,
        Some(buzz_db::accounts::AdminPasswordSigninAccount::Locked)
    ));
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn five_wrong_passwords_lock_the_route_until_the_redis_lock_key_is_removed() {
    let email = unique_email("lockout");
    let pubkey = nostr::Keys::generate().public_key().to_hex();
    let fixture = fixture(
        vec![RelayOperatorEmail::Account(email.clone())],
        vec![pubkey.clone()],
        Some(AccountMailMode::Resend),
    )
    .await;
    seed_account(
        &fixture.pool,
        &email,
        &pubkey,
        Some(CORRECT_PASSWORD),
        true,
        0,
        false,
    )
    .await;

    let ip = unique_ip();
    let mut expected_body = None;
    for _ in 0..4 {
        let (status, _, body) = response_parts(
            password_signin(
                fixture.state.clone(),
                &fixture.host,
                ip,
                &email,
                WRONG_PASSWORD,
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        if let Some(expected) = expected_body.as_ref() {
            assert_eq!(&body, expected);
        } else {
            expected_body = Some(body);
        }
    }
    let expected_body = expected_body.expect("first wrong-password response");
    let (fifth_status, _, fifth_body) = response_parts(
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            WRONG_PASSWORD,
        )
        .await,
    )
    .await;
    assert_eq!(fifth_status, StatusCode::UNAUTHORIZED);
    assert_eq!(&fifth_body, &expected_body);
    assert_eq!(
        audit_outcome_count(&fixture.pool, "wrong_password").await,
        4
    );
    assert_eq!(audit_outcome_count(&fixture.pool, "locked_out").await, 1);

    let (locked_status, _, locked_body) = response_parts(
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            CORRECT_PASSWORD,
        )
        .await,
    )
    .await;
    assert_eq!(locked_status, StatusCode::UNAUTHORIZED);
    assert_eq!(&locked_body, &expected_body);
    assert_eq!(audit_outcome_count(&fixture.pool, "locked_out").await, 2);

    clear_password_lockout(&fixture.state, &email).await;
    let (unlocked_status, _, _) = response_parts(
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            CORRECT_PASSWORD,
        )
        .await,
    )
    .await;
    assert_eq!(unlocked_status, StatusCode::OK);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn password_signin_does_not_require_outbound_mail_configuration() {
    let email = unique_email("mail-not-configured");
    let pubkey = nostr::Keys::generate().public_key().to_hex();
    let fixture = fixture(
        vec![RelayOperatorEmail::Account(email.clone())],
        vec![pubkey.clone()],
        None,
    )
    .await;
    seed_account(
        &fixture.pool,
        &email,
        &pubkey,
        Some(CORRECT_PASSWORD),
        true,
        0,
        false,
    )
    .await;

    let (status, _, _) = response_parts(
        password_signin(
            fixture.state.clone(),
            &fixture.host,
            unique_ip(),
            &email,
            CORRECT_PASSWORD,
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}
