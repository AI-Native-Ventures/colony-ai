use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{to_bytes, Body};
use axum::extract::ConnectInfo;
use axum::http::{header, HeaderMap, Request, StatusCode};
use buzz_db::Db;
use serde_json::{json, Value};
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio::time::timeout;
use tower::ServiceExt;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::api::accounts::mail::{CodeMailKind, CodeMailer, MailDeliveryError};
use crate::api::accounts::AccountServices;
use crate::config::{AccountConfig, AccountMailMode, AdminAuth, AdminConfig, RelayOperatorEmail};
use crate::state::AppState;

use super::*;

const TEST_KEK: [u8; 32] = [0x71; 32];
const ZERO_AUDIT_HASH: [u8; 32] = [0; 32];

#[derive(Debug, Clone)]
struct SentCode {
    recipient: String,
    kind: CodeMailKind,
    code: String,
}

struct FakeCodeMailer {
    tx: mpsc::UnboundedSender<SentCode>,
    outcome: FakeMailOutcome,
}

#[derive(Clone, Copy)]
enum FakeMailOutcome {
    Sent,
    ProviderError,
}

impl FakeCodeMailer {
    fn new(tx: mpsc::UnboundedSender<SentCode>, outcome: FakeMailOutcome) -> Self {
        Self { tx, outcome }
    }
}

impl CodeMailer for FakeCodeMailer {
    fn send_code<'a>(
        &'a self,
        _config: &'a AccountConfig,
        recipient: &'a str,
        kind: CodeMailKind,
        code: &'a Zeroizing<String>,
    ) -> Pin<Box<dyn Future<Output = Result<(), MailDeliveryError>> + Send + 'a>> {
        let tx = self.tx.clone();
        let outcome = self.outcome;
        let recipient = recipient.to_owned();
        let code = code.as_str().to_owned();
        Box::pin(async move {
            match outcome {
                FakeMailOutcome::ProviderError => return Err(MailDeliveryError::Provider),
                FakeMailOutcome::Sent => {}
            }
            tx.send(SentCode {
                recipient,
                kind,
                code,
            })
            .map_err(|_| MailDeliveryError::Provider)?;
            Ok(())
        })
    }
}

struct Fixture {
    state: Arc<AppState>,
    pool: PgPool,
    host: String,
    mail_rx: mpsc::UnboundedReceiver<SentCode>,
}

fn unique_email(label: &str) -> String {
    format!(
        "admin-email-{label}-{}@example.test",
        Uuid::new_v4().simple()
    )
}

fn unique_ip() -> Ipv4Addr {
    let bytes = Uuid::new_v4().into_bytes();
    Ipv4Addr::new(198, bytes[13], bytes[14], bytes[15])
}

async fn fixture(operator_emails: Vec<String>, allowlisted_emails: Vec<String>) -> Fixture {
    fixture_with_allowlist(
        operator_emails,
        allowlisted_emails
            .into_iter()
            .map(RelayOperatorEmail::Account)
            .collect(),
        Vec::new(),
    )
    .await
}

async fn fixture_with_allowlist(
    operator_emails: Vec<String>,
    allowlisted_emails: Vec<RelayOperatorEmail>,
    additional_operator_pubkeys: Vec<String>,
) -> Fixture {
    fixture_with_options(
        operator_emails,
        allowlisted_emails,
        additional_operator_pubkeys,
        Some(TEST_KEK),
        Some(AccountMailMode::Resend),
        FakeMailOutcome::Sent,
    )
    .await
}

async fn fixture_with_options(
    operator_emails: Vec<String>,
    allowlisted_emails: Vec<RelayOperatorEmail>,
    additional_operator_pubkeys: Vec<String>,
    account_kek: Option<[u8; 32]>,
    mail_mode: Option<AccountMailMode>,
    mail_outcome: FakeMailOutcome,
) -> Fixture {
    let mut config = crate::config::Config::from_env().expect("test relay config");
    let database_url = crate::test_support::database_url();
    config.database_url = database_url.clone();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_owned());
    config.require_relay_membership = false;
    config.accounts = AccountConfig::test_config(account_kek, mail_mode, Vec::new(), None);
    let host = format!("admin-email-{}.example", Uuid::new_v4().simple());
    config.admin = Some(AdminConfig {
        host: host.clone(),
        auth: AdminAuth::Nip98,
        web_dir: None,
    });
    config.relay_operator_emails = allowlisted_emails;
    let pubkeys = (0..operator_emails.len())
        .map(|_| nostr::Keys::generate().public_key().to_hex())
        .collect::<Vec<_>>();
    config.relay_operator_pubkeys = pubkeys.clone();
    for pubkey in additional_operator_pubkeys {
        if !config.relay_operator_pubkeys.contains(&pubkey) {
            config.relay_operator_pubkeys.push(pubkey);
        }
    }

    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect admin email test Postgres");
    if !matches!(
        std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(),
        Ok("desired")
    ) {
        buzz_db::migration::run_migrations(&pool)
            .await
            .expect("apply admin email test migrations");
    }
    let db = Db::from_pool(pool.clone());
    db.ensure_configured_community(&host)
        .await
        .expect("create admin email test community");

    for (email, pubkey) in operator_emails.iter().zip(pubkeys.iter()) {
        seed_verified_account(&pool, email, pubkey).await;
    }

    let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("create admin email test Redis pool");
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
            .await
            .expect("connect admin email test Redis pubsub"),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media_storage =
        buzz_media::MediaStorage::new(&config.media).expect("admin email media config");
    let (mut state, _audit_shutdown) = AppState::new(
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

    let (mail_tx, mail_rx) = mpsc::unbounded_channel();
    state.account_services = Arc::new(AccountServices::with_code_mailer_for_tests(Arc::new(
        FakeCodeMailer::new(mail_tx, mail_outcome),
    )));

    Fixture {
        state: Arc::new(state),
        pool,
        host,
        mail_rx,
    }
}

async fn seed_verified_account(pool: &PgPool, email: &str, pubkey: &str) {
    sqlx::query(
        "INSERT INTO accounts \
            (id, email, email_verified_at, pubkey, wrapped_dek, kek_id, sealed_nsec, nonce) \
         VALUES ($1, $2, now(), $3, $4, 'test-kek', $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(email)
    .bind(pubkey)
    .bind(vec![0x11_u8; 28])
    .bind(vec![0x22_u8; 16])
    .bind(vec![0x33_u8; 12])
    .execute(pool)
    .await
    .expect("seed verified operator account");
}

async fn seed_unverified_account(pool: &PgPool, email: &str, pubkey: &str) {
    sqlx::query(
        "INSERT INTO accounts \
            (id, email, email_verified_at, pubkey, wrapped_dek, kek_id, sealed_nsec, nonce) \
         VALUES ($1, $2, NULL, $3, $4, 'test-kek', $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(email)
    .bind(pubkey)
    .bind(vec![0x11_u8; 28])
    .bind(vec![0x22_u8; 16])
    .bind(vec![0x33_u8; 12])
    .execute(pool)
    .await
    .expect("seed unverified operator account");
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
        .expect("build admin email request");
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
    let body = serde_json::to_vec(&body).expect("serialize admin email body");
    crate::router::build_router(state)
        .oneshot(request_with_ip(method, path, host, origin, ip, body))
        .await
        .expect("admin email response")
}

async fn start(
    state: Arc<AppState>,
    host: &str,
    ip: Ipv4Addr,
    email: &str,
) -> axum::response::Response {
    call(
        state,
        "POST",
        "/api/admin/v1/session/email/start",
        host,
        &format!("https://{host}"),
        ip,
        json!({ "email": email }),
    )
    .await
}

async fn verify(
    state: Arc<AppState>,
    host: &str,
    ip: Ipv4Addr,
    email: &str,
    code: &str,
) -> axum::response::Response {
    call(
        state,
        "POST",
        "/api/admin/v1/session/email/verify",
        host,
        &format!("https://{host}"),
        ip,
        json!({ "email": email, "code": code }),
    )
    .await
}

async fn response_json(response: axum::response::Response) -> (StatusCode, HeaderMap, Value) {
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 16 * 1024)
        .await
        .expect("read admin email response");
    let body = serde_json::from_slice(&bytes).expect("admin email JSON response");
    (status, headers, body)
}

async fn receive_code(rx: &mut mpsc::UnboundedReceiver<SentCode>) -> SentCode {
    timeout(Duration::from_secs(2), rx.recv())
        .await
        .expect("fake mail delivery timed out")
        .expect("fake mailer sender remained open")
}

async fn assert_no_code(rx: &mut mpsc::UnboundedReceiver<SentCode>) {
    assert!(
        timeout(Duration::from_millis(150), rx.recv())
            .await
            .is_err(),
        "no code should have been delivered"
    );
}

async fn audit_outcome_count(pool: &PgPool, operation: &str, outcome: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*)::bigint FROM relay_operator_email_login_audit \
         WHERE operation = $1 AND outcome = $2",
    )
    .bind(operation)
    .bind(outcome)
    .fetch_one(pool)
    .await
    .expect("count email-login audit outcomes")
}

async fn audit_outcome_count_for_hash(
    pool: &PgPool,
    operation: &str,
    outcome: &str,
    email_hash: &[u8; 32],
) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*)::bigint FROM relay_operator_email_login_audit \
         WHERE operation = $1 AND outcome = $2 AND email_hash = $3",
    )
    .bind(operation)
    .bind(outcome)
    .bind(email_hash.as_slice())
    .fetch_one(pool)
    .await
    .expect("count email-login audit outcomes by identity hash")
}

async fn wait_for_audit_outcome_count(
    pool: &PgPool,
    operation: &str,
    outcome: &str,
    expected: i64,
) {
    timeout(Duration::from_secs(2), async {
        loop {
            if audit_outcome_count(pool, operation, outcome).await >= expected {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("email-login audit outcome {operation}/{outcome} was not recorded"));
}

async fn wait_for_audit_outcome_count_for_hash(
    pool: &PgPool,
    operation: &str,
    outcome: &str,
    email_hash: &[u8; 32],
    expected: i64,
) {
    timeout(Duration::from_secs(2), async {
        loop {
            if audit_outcome_count_for_hash(pool, operation, outcome, email_hash).await >= expected
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("email-login audit outcome {operation}/{outcome} was not recorded"));
}

#[derive(Clone, Default)]
struct LogBuffer(Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("log buffer").extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn capture_start_logs() -> (LogBuffer, tracing::subscriber::DefaultGuard) {
    let buffer = LogBuffer::default();
    let sink = buffer.clone();
    let guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_writer(move || sink.clone())
            .with_ansi(false)
            .finish(),
    );
    (buffer, guard)
}

fn start_log_lines(buffer: &LogBuffer) -> Vec<String> {
    String::from_utf8_lossy(&buffer.0.lock().expect("log buffer"))
        .lines()
        .filter(|line| line.contains("admin email login start"))
        .map(str::to_owned)
        .collect()
}

fn wrong_code(code: &str) -> String {
    if code == "00000000" {
        "00000001".to_owned()
    } else {
        "00000000".to_owned()
    }
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

async fn clear_resend_cooldown(state: &AppState, email: &str) {
    let email_hash = email_identity_hash(&TEST_KEK, email).expect("email hash");
    let key = email_cooldown_key(&email_hash);
    let mut connection = state.redis_pool.get().await.expect("Redis connection");
    let _: i64 = redis::cmd("DEL")
        .arg(key)
        .query_async(&mut *connection)
        .await
        .expect("clear resend cooldown");
}

async fn expire_code(state: &AppState, email: &str) {
    let email_hash = email_identity_hash(&TEST_KEK, email).expect("email hash");
    let key = email_code_key(&email_hash);
    let mut connection = state.redis_pool.get().await.expect("Redis connection");
    let changed: i64 = redis::cmd("EXPIRE")
        .arg(key)
        .arg(1)
        .query_async(&mut *connection)
        .await
        .expect("shorten code TTL");
    assert_eq!(changed, 1, "challenge key must exist before expiry");
    tokio::time::sleep(Duration::from_secs(2)).await;
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

async fn assert_start_reason(
    fixture: &mut Fixture,
    email: &str,
    reason: &str,
    should_deliver: bool,
) -> Option<SentCode> {
    let email_hash = if reason == "mail_unconfigured" {
        ZERO_AUDIT_HASH
    } else {
        email_identity_hash(&TEST_KEK, email).expect("email hash")
    };
    let before = audit_outcome_count_for_hash(&fixture.pool, "start", reason, &email_hash).await;
    let ip = unique_ip();
    let (logs, guard) = capture_start_logs();
    let (status, _, body) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, email).await).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(
        body,
        json!({ "status": "email_code_requested", "retryAfterSeconds": 30 })
    );
    let delivered = if should_deliver {
        Some(receive_code(&mut fixture.mail_rx).await)
    } else {
        assert_no_code(&mut fixture.mail_rx).await;
        None
    };
    wait_for_audit_outcome_count_for_hash(&fixture.pool, "start", reason, &email_hash, before + 1)
        .await;
    assert_eq!(
        audit_outcome_count_for_hash(&fixture.pool, "start", reason, &email_hash).await,
        before + 1,
        "one start request must record one audit row for its reason class"
    );
    let lines = start_log_lines(&logs);
    drop(guard);

    assert_eq!(
        lines.len(),
        1,
        "one start request must emit one reason-class log: {lines:?}"
    );
    let line = &lines[0];
    assert!(
        line.contains(&format!("reason=\"{reason}\"")),
        "log must carry its reason class: {line}"
    );
    if reason == "sent" {
        assert!(line.contains("INFO"), "sent must log at info: {line}");
    } else {
        assert!(line.contains("WARN"), "non-send must log at warn: {line}");
    }
    assert!(
        !line.contains(email),
        "log must not contain the email: {line}"
    );
    assert!(
        !line.contains(&ip.to_string()),
        "log must not contain the IP: {line}"
    );
    if let Some(delivery) = delivered.as_ref() {
        assert!(
            !line.contains(&delivery.code),
            "log must not contain the code: {line}"
        );
    }
    delivered
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn allowlisted_email_gets_one_code_and_the_google_equivalent_operator_cookie() {
    let email = unique_email("happy");
    let mut fixture = fixture(vec![email.clone()], vec![email.clone()]).await;
    let ip = unique_ip();
    let sent_before = audit_outcome_count(&fixture.pool, "start", "sent").await;
    let success_before = audit_outcome_count(&fixture.pool, "verify", "success").await;

    let (start_status, _, start_body) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, &email).await).await;
    assert_eq!(start_status, StatusCode::ACCEPTED);
    assert_eq!(
        start_body,
        json!({ "status": "email_code_requested", "retryAfterSeconds": 30 })
    );

    let delivery = receive_code(&mut fixture.mail_rx).await;
    assert_eq!(delivery.recipient, email);
    assert_eq!(delivery.kind, CodeMailKind::AdminEmailLogin);
    assert!(
        delivery.code.len() == 8 && delivery.code.bytes().all(|byte| byte.is_ascii_digit()),
        "code must be exactly eight decimal digits"
    );
    wait_for_audit_outcome_count(&fixture.pool, "start", "sent", sent_before + 1).await;
    let email_hash = email_identity_hash(&TEST_KEK, &email).expect("email hash");
    let mut connection = fixture
        .state
        .redis_pool
        .get()
        .await
        .expect("Redis connection");
    let stored_code: Option<String> = redis::cmd("GET")
        .arg(email_code_key(&email_hash))
        .query_async(&mut *connection)
        .await
        .expect("read Redis challenge");
    let stored_code = stored_code.expect("challenge must exist before verification");
    let ttl_secs: i64 = redis::cmd("TTL")
        .arg(email_code_key(&email_hash))
        .query_async(&mut *connection)
        .await
        .expect("read Redis challenge TTL");
    assert!(
        (1..=10 * 60).contains(&ttl_secs),
        "challenge must expire within the ten-minute code lifetime"
    );
    assert!(stored_code.contains("\"salt\""));
    assert!(stored_code.contains("\"code_hash\""));
    assert!(
        !stored_code.contains(&format!("\"{}\"", delivery.code)),
        "Redis must not retain the plaintext emailed code"
    );
    assert!(
        !stored_code.contains(&email),
        "Redis must not retain the operator email address"
    );

    let (verify_status, headers, verify_body) = response_json(
        verify(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            &delivery.code,
        )
        .await,
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    assert_eq!(verify_body["status"], "ok");
    let cookie = headers
        .get(header::SET_COOKIE)
        .expect("email verification issues a cookie")
        .to_str()
        .expect("cookie is valid header text");
    for required in [
        "__Host-colony_admin=",
        "Path=/",
        "Secure",
        "HttpOnly",
        "SameSite=Strict",
        "Max-Age=28800",
    ] {
        assert!(cookie.contains(required), "cookie must retain {required}");
    }

    let (probe_status, _, probe_body) = response_json(
        cookie_probe(
            fixture.state.clone(),
            &fixture.host,
            ip,
            cookie_pair(&headers),
        )
        .await,
    )
    .await;
    assert_eq!(probe_status, StatusCode::OK);
    assert_eq!(probe_body["role"], "operator");
    assert_eq!(probe_body["source"], "config");

    let rows: Vec<(String, String, i32, i32)> = sqlx::query_as(
        "SELECT operation, outcome, octet_length(email_hash), octet_length(ip_bucket_hash) \
         FROM relay_operator_email_login_audit \
         ORDER BY created_at ASC",
    )
    .fetch_all(&fixture.pool)
    .await
    .expect("read email-login audit");
    assert_eq!(
        audit_outcome_count(&fixture.pool, "start", "sent").await,
        sent_before + 1,
        "the start outcome must be durably audited exactly once"
    );
    assert_eq!(
        audit_outcome_count(&fixture.pool, "verify", "success").await,
        success_before + 1,
        "the successful verification must be durably audited exactly once"
    );
    assert!(
        rows.iter().all(|row| row.2 == 32 && row.3 == 32),
        "the audit stores only fixed-width hashes"
    );
    let sensitive_columns: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM information_schema.columns \
         WHERE table_name = 'relay_operator_email_login_audit' \
           AND column_name IN ('email', 'code', 'code_hash', 'salt')",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("inspect audit schema");
    assert_eq!(
        sensitive_columns, 0,
        "audit table must not store email or code material"
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn start_records_and_logs_each_email_delivery_reason_class() {
    let sent_email = unique_email("reason-sent");
    let mut sent = fixture(vec![sent_email.clone()], vec![sent_email.clone()]).await;
    let sent_delivery = assert_start_reason(&mut sent, &sent_email, "sent", true)
        .await
        .expect("sent flow delivers a fake code");
    assert_eq!(sent_delivery.recipient, sent_email);

    let not_allowlisted_email = unique_email("reason-not-allowlisted");
    let configured_but_different_email = unique_email("reason-not-allowlisted-configured");
    let mut not_allowlisted = fixture_with_allowlist(
        vec![not_allowlisted_email.clone()],
        vec![RelayOperatorEmail::Account(configured_but_different_email)],
        Vec::new(),
    )
    .await;
    assert_start_reason(
        &mut not_allowlisted,
        &not_allowlisted_email,
        "not_allowlisted",
        false,
    )
    .await;

    let no_account_email = unique_email("reason-no-account");
    let mut no_account = fixture(Vec::new(), vec![no_account_email.clone()]).await;
    assert_start_reason(&mut no_account, &no_account_email, "no_account", false).await;

    let unverified_email = unique_email("reason-unverified");
    let unverified_key = nostr::Keys::generate().public_key().to_hex();
    let mut unverified = fixture_with_allowlist(
        Vec::new(),
        vec![RelayOperatorEmail::Account(unverified_email.clone())],
        vec![unverified_key.clone()],
    )
    .await;
    seed_unverified_account(&unverified.pool, &unverified_email, &unverified_key).await;
    assert_start_reason(
        &mut unverified,
        &unverified_email,
        "account_unverified",
        false,
    )
    .await;

    let unrostered_email = unique_email("reason-unrostered");
    let unrostered_key = nostr::Keys::generate().public_key().to_hex();
    let mut unrostered = fixture_with_allowlist(
        Vec::new(),
        vec![RelayOperatorEmail::Account(unrostered_email.clone())],
        Vec::new(),
    )
    .await;
    seed_verified_account(&unrostered.pool, &unrostered_email, &unrostered_key).await;
    assert_start_reason(
        &mut unrostered,
        &unrostered_email,
        "not_operator_key",
        false,
    )
    .await;

    let unconfigured_email = unique_email("reason-unconfigured");
    let mut unconfigured = fixture_with_options(
        Vec::new(),
        vec![RelayOperatorEmail::Account(unconfigured_email.clone())],
        Vec::new(),
        Some(TEST_KEK),
        Some(AccountMailMode::Log),
        FakeMailOutcome::Sent,
    )
    .await;
    assert_start_reason(
        &mut unconfigured,
        &unconfigured_email,
        "mail_unconfigured",
        false,
    )
    .await;

    let provider_email = unique_email("reason-provider");
    let mut provider = fixture_with_options(
        vec![provider_email.clone()],
        vec![RelayOperatorEmail::Account(provider_email.clone())],
        Vec::new(),
        Some(TEST_KEK),
        Some(AccountMailMode::Resend),
        FakeMailOutcome::ProviderError,
    )
    .await;
    assert_start_reason(&mut provider, &provider_email, "mail_provider_error", false).await;
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn alias_email_delivers_to_the_alias_and_issues_its_rostered_pubkey_session() {
    let alias_email = unique_email("alias");
    let alias_pubkey = nostr::Keys::generate().public_key().to_hex();
    let mut fixture = fixture_with_allowlist(
        Vec::new(),
        vec![RelayOperatorEmail::Alias {
            email: alias_email.clone(),
            pubkey: alias_pubkey.clone(),
        }],
        vec![alias_pubkey.clone()],
    )
    .await;
    let ip = unique_ip();

    let (start_status, _, start_body) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, &alias_email).await).await;
    assert_eq!(start_status, StatusCode::ACCEPTED);
    assert_eq!(
        start_body,
        json!({ "status": "email_code_requested", "retryAfterSeconds": 30 })
    );
    let delivery = receive_code(&mut fixture.mail_rx).await;
    assert_eq!(delivery.recipient, alias_email);

    let (verify_status, headers, verify_body) = response_json(
        verify(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &alias_email,
            &delivery.code,
        )
        .await,
    )
    .await;
    assert_eq!(verify_status, StatusCode::OK);
    assert_eq!(verify_body["status"], "ok");
    let session_cookie = cookie_pair(&headers);
    let token = session_cookie
        .strip_prefix("__Host-colony_admin=")
        .expect("email session token");
    assert_eq!(
        verify_token(
            &session_key(&TEST_KEK).expect("session key"),
            token,
            unix_now()
        ),
        Some(alias_pubkey.clone()),
        "the alias session must name the configured rostered key"
    );

    let (probe_status, _, probe_body) = response_json(
        cookie_probe(
            fixture.state.clone(),
            &fixture.host,
            ip,
            cookie_pair(&headers),
        )
        .await,
    )
    .await;
    assert_eq!(probe_status, StatusCode::OK);
    assert_eq!(probe_body["role"], "operator");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn alias_email_without_a_rostered_pubkey_never_delivers_a_code() {
    let alias_email = unique_email("alias-unrostered");
    let alias_pubkey = nostr::Keys::generate().public_key().to_hex();
    let mut fixture = fixture_with_allowlist(
        Vec::new(),
        vec![RelayOperatorEmail::Alias {
            email: alias_email.clone(),
            pubkey: alias_pubkey,
        }],
        Vec::new(),
    )
    .await;
    let ip = unique_ip();
    let email_hash = email_identity_hash(&TEST_KEK, &alias_email).expect("email hash");
    let before =
        audit_outcome_count_for_hash(&fixture.pool, "start", "not_operator_key", &email_hash).await;

    let (status, _, body) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, &alias_email).await).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(
        body,
        json!({ "status": "email_code_requested", "retryAfterSeconds": 30 })
    );
    assert_no_code(&mut fixture.mail_rx).await;
    assert_eq!(
        audit_outcome_count_for_hash(&fixture.pool, "start", "not_operator_key", &email_hash,)
            .await,
        before + 1,
        "an unrostered alias must be audited as not_operator_key"
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn non_allowlisted_email_has_the_same_start_response_and_receives_no_mail() {
    let allowed = unique_email("allowed");
    let denied = unique_email("denied");
    let mut fixture = fixture(vec![allowed.clone(), denied.clone()], vec![allowed.clone()]).await;
    let ip = unique_ip();

    let (allowed_status, _, allowed_body) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, &allowed).await).await;
    let (denied_status, _, denied_body) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, &denied).await).await;
    assert_eq!(allowed_status, StatusCode::ACCEPTED);
    assert_eq!(denied_status, StatusCode::ACCEPTED);
    assert_eq!(
        allowed_body, denied_body,
        "start must not enumerate the allowlist"
    );

    let delivery = receive_code(&mut fixture.mail_rx).await;
    assert_eq!(delivery.recipient, allowed);
    assert_no_code(&mut fixture.mail_rx).await;
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn wrong_expired_and_reused_codes_have_one_generic_failure() {
    let email = unique_email("generic-failure");
    let mut fixture = fixture(vec![email.clone()], vec![email.clone()]).await;
    let ip = unique_ip();
    let wrong_before = audit_outcome_count(&fixture.pool, "verify", "wrong_code").await;
    let missing_before = audit_outcome_count(&fixture.pool, "verify", "missing_or_expired").await;

    let _ = start(fixture.state.clone(), &fixture.host, ip, &email).await;
    let first_code = receive_code(&mut fixture.mail_rx).await.code;
    let (wrong_status, _, wrong_body) = response_json(
        verify(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            &wrong_code(&first_code),
        )
        .await,
    )
    .await;
    assert_eq!(wrong_status, StatusCode::UNAUTHORIZED);

    let (success_status, _, _) = response_json(
        verify(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            &first_code,
        )
        .await,
    )
    .await;
    assert_eq!(success_status, StatusCode::OK);
    let (reused_status, _, reused_body) = response_json(
        verify(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            &first_code,
        )
        .await,
    )
    .await;
    assert_eq!(reused_status, StatusCode::UNAUTHORIZED);

    clear_resend_cooldown(&fixture.state, &email).await;
    let _ = start(fixture.state.clone(), &fixture.host, ip, &email).await;
    let expiring_code = receive_code(&mut fixture.mail_rx).await.code;
    expire_code(&fixture.state, &email).await;
    let (expired_status, _, expired_body) = response_json(
        verify(
            fixture.state.clone(),
            &fixture.host,
            ip,
            &email,
            &expiring_code,
        )
        .await,
    )
    .await;
    assert_eq!(expired_status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong_body, reused_body);
    assert_eq!(wrong_body, expired_body);

    assert_eq!(
        audit_outcome_count(&fixture.pool, "verify", "wrong_code").await,
        wrong_before + 1,
        "wrong-code failures must be durably audited exactly once"
    );
    assert_eq!(
        audit_outcome_count(&fixture.pool, "verify", "missing_or_expired").await,
        missing_before + 2,
        "expired and reused code failures must be durably audited exactly once each"
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn five_wrong_attempts_lock_the_email_for_fifteen_minutes() {
    let email = unique_email("lockout");
    let mut fixture = fixture(vec![email.clone()], vec![email.clone()]).await;
    let ip = unique_ip();

    let _ = start(fixture.state.clone(), &fixture.host, ip, &email).await;
    let code = receive_code(&mut fixture.mail_rx).await.code;
    let bad = wrong_code(&code);
    let mut failure = None;
    for _ in 0..5 {
        let (status, _, body) =
            response_json(verify(fixture.state.clone(), &fixture.host, ip, &email, &bad).await)
                .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        if let Some(previous) = failure.as_ref() {
            assert_eq!(previous, &body);
        } else {
            failure = Some(body);
        }
    }

    let (locked_status, _, locked_body) =
        response_json(verify(fixture.state.clone(), &fixture.host, ip, &email, &code).await).await;
    assert_eq!(locked_status, StatusCode::UNAUTHORIZED);
    assert_eq!(failure.as_ref(), Some(&locked_body));

    clear_resend_cooldown(&fixture.state, &email).await;
    let (start_status, _, _) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, &email).await).await;
    assert_eq!(start_status, StatusCode::ACCEPTED);
    assert_no_code(&mut fixture.mail_rx).await;
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn resend_cooldown_and_both_opaque_rate_limits_suppress_delivery() {
    let email = unique_email("cooldown");
    let mut email_fixture = fixture(vec![email.clone()], vec![email.clone()]).await;
    let ip = unique_ip();

    let (_, _, first_body) =
        response_json(start(email_fixture.state.clone(), &email_fixture.host, ip, &email).await)
            .await;
    let _ = receive_code(&mut email_fixture.mail_rx).await;
    let (_, _, second_body) =
        response_json(start(email_fixture.state.clone(), &email_fixture.host, ip, &email).await)
            .await;
    assert_eq!(first_body, second_body);
    assert_no_code(&mut email_fixture.mail_rx).await;

    let email_limited_email = unique_email("email-limit");
    let mut email_limit_fixture = fixture(
        vec![email_limited_email.clone()],
        vec![email_limited_email.clone()],
    )
    .await;
    let email_limit_ip = unique_ip();
    for _ in 0..START_EMAIL_RATE_LIMIT {
        clear_resend_cooldown(&email_limit_fixture.state, &email_limited_email).await;
        let _ = start(
            email_limit_fixture.state.clone(),
            &email_limit_fixture.host,
            email_limit_ip,
            &email_limited_email,
        )
        .await;
        let _ = receive_code(&mut email_limit_fixture.mail_rx).await;
    }
    clear_resend_cooldown(&email_limit_fixture.state, &email_limited_email).await;
    let (_, _, email_limited_body) = response_json(
        start(
            email_limit_fixture.state.clone(),
            &email_limit_fixture.host,
            email_limit_ip,
            &email_limited_email,
        )
        .await,
    )
    .await;
    assert_eq!(email_limited_body, first_body);
    assert_no_code(&mut email_limit_fixture.mail_rx).await;

    let ip_limited_emails = (0..=START_IP_RATE_LIMIT)
        .map(|index| unique_email(&format!("ip-{index}")))
        .collect::<Vec<_>>();
    let mut ip_fixture = fixture(ip_limited_emails.clone(), ip_limited_emails.clone()).await;
    let second_ip = unique_ip();
    for email in ip_limited_emails.iter().take(START_IP_RATE_LIMIT as usize) {
        let _ = start(ip_fixture.state.clone(), &ip_fixture.host, second_ip, email).await;
        let _ = receive_code(&mut ip_fixture.mail_rx).await;
    }
    let (_, _, ip_limited_body) = response_json(
        start(
            ip_fixture.state.clone(),
            &ip_fixture.host,
            second_ip,
            ip_limited_emails.last().expect("one extra email"),
        )
        .await,
    )
    .await;
    assert_eq!(ip_limited_body, first_body);
    assert_no_code(&mut ip_fixture.mail_rx).await;
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn email_sessions_are_admin_host_only_and_do_not_bypass_pubkey_operators() {
    let email = unique_email("host-only");
    let mut fixture = fixture(vec![email.clone()], vec![email.clone()]).await;
    let ip = unique_ip();

    let rejected_audit_count_before: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM relay_operator_email_login_audit \
         WHERE operation = 'start' AND outcome = 'host_or_origin_rejected'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("read rejected-host audit baseline");
    let response = call(
        fixture.state.clone(),
        "POST",
        "/api/admin/v1/session/email/start",
        "community.example",
        "https://community.example",
        ip,
        json!({ "email": email }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_no_code(&mut fixture.mail_rx).await;
    let rejected_audit_count_after: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM relay_operator_email_login_audit \
         WHERE operation = 'start' AND outcome = 'host_or_origin_rejected'",
    )
    .fetch_one(&fixture.pool)
    .await
    .expect("read rejected-host audit");
    assert_eq!(
        rejected_audit_count_after,
        rejected_audit_count_before + 1,
        "rejected hosts must be audited exactly once"
    );

    let unrostered_email = unique_email("unrostered");
    let unrostered_key = nostr::Keys::generate().public_key().to_hex();
    seed_verified_account(&fixture.pool, &unrostered_email, &unrostered_key).await;
    let (_, _, start_body) =
        response_json(start(fixture.state.clone(), &fixture.host, ip, &unrostered_email).await)
            .await;
    assert_eq!(
        start_body,
        json!({ "status": "email_code_requested", "retryAfterSeconds": 30 })
    );
    assert_no_code(&mut fixture.mail_rx).await;
}
