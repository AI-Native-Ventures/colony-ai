//! Account authentication proof against a running disposable relay.
//!
//! The hosted workflow starts the relay with the CI mail sink and a local
//! Google JWKS fixture. Run with:
//!
//! ```text
//! cargo test -p buzz-test-client --test e2e_accounts -- --ignored --nocapture --test-threads=1
//! ```

use std::io::{Read, Seek, SeekFrom};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag, ToBech32};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MAIL_LOG: &str = "/tmp/buzz-relay.log";
const MAIL_CODE_WAIT: Duration = Duration::from_secs(30);
const MAIL_LOG_TAIL_BYTES: u64 = 64 * 1024;
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

struct AccountSession {
    pubkey: String,
    has_password: bool,
    google_linked: bool,
    keys: Keys,
}

fn relay_url() -> String {
    std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string())
}

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

fn relay_http_url() -> String {
    relay_url()
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string()
}

fn unique_email(label: &str) -> String {
    format!("{label}+{}@example.test", Uuid::new_v4())
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn nip98_post_header(keys: &Keys, url: &str, body: &str) -> String {
    let event = EventBuilder::new(Kind::Custom(27_235), "")
        .tags(vec![
            Tag::parse(["u", url]).expect("NIP-98 URL tag"),
            Tag::parse(["method", "POST"]).expect("NIP-98 method tag"),
            Tag::parse(["payload", &sha256_hex(body.as_bytes())]).expect("NIP-98 payload tag"),
            Tag::parse(["nonce", &Uuid::new_v4().to_string()]).expect("NIP-98 nonce tag"),
        ])
        .sign_with_keys(keys)
        .expect("sign NIP-98 event");
    format!(
        "Nostr {}",
        BASE64.encode(serde_json::to_string(&event).expect("serialize NIP-98 event"))
    )
}

async fn post_json(path: &str, body: &Value) -> reqwest::Response {
    request_json(path, body, None).await
}

async fn post_json_nip98(path: &str, body: &Value, keys: &Keys) -> reqwest::Response {
    request_json(path, body, Some(keys)).await
}

async fn request_json(path: &str, body: &Value, signer: Option<&Keys>) -> reqwest::Response {
    let url = format!("{}{}", relay_http_url(), path);
    let serialized = serde_json::to_string(body).expect("serialize account request");
    let mut request = http_client()
        .post(&url)
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    if let Some(keys) = signer {
        request = request.header(
            reqwest::header::AUTHORIZATION,
            nip98_post_header(keys, &url, &serialized),
        );
    }
    request
        .body(serialized)
        .send()
        .await
        .unwrap_or_else(|_| panic!("POST {path} failed"))
}

fn assert_status(response: &reqwest::Response, status: reqwest::StatusCode) {
    assert_eq!(response.status(), status, "unexpected account API status");
}

async fn assert_error(
    response: reqwest::Response,
    status: reqwest::StatusCode,
    code: &str,
) -> Value {
    assert_eq!(
        response.status(),
        status,
        "unexpected account API error status"
    );
    let body: Value = response.json().await.expect("account API error is JSON");
    assert_eq!(
        body.get("error").and_then(Value::as_str),
        Some(code),
        "account API returned a different error"
    );
    body
}

async fn parse_session(response: reqwest::Response) -> AccountSession {
    assert_status(&response, reqwest::StatusCode::OK);
    let mut body: Value = response.json().await.expect("session payload is JSON");
    let account = body
        .get_mut("account")
        .and_then(Value::as_object_mut)
        .expect("session payload has account");
    let pubkey = account
        .get("pubkey")
        .and_then(Value::as_str)
        .expect("account has pubkey")
        .to_string();
    let has_password = account
        .get("has_password")
        .and_then(Value::as_bool)
        .expect("account has has_password");
    let google_linked = account
        .get("google_linked")
        .and_then(Value::as_bool)
        .expect("account has google_linked");
    let nsec = body
        .get("nsec")
        .and_then(Value::as_str)
        .expect("session payload has nsec")
        .to_string();
    let keys = Keys::parse(&nsec).unwrap_or_else(|_| panic!("session nsec is invalid"));
    drop(nsec);
    drop(body);
    assert_eq!(keys.public_key().to_hex(), pubkey);
    AccountSession {
        pubkey,
        has_password,
        google_linked,
        keys,
    }
}

fn mail_code_from_json_line(line: &str, email: &str, purpose: &str) -> Option<String> {
    let value: Value = serde_json::from_str(line).ok()?;
    let object = value.as_object()?;
    let line_email = ["email", "to", "recipient"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))?;
    let line_purpose = object.get("purpose").and_then(Value::as_str)?;
    let code = object.get("code").and_then(Value::as_str)?;
    if !line_email.eq_ignore_ascii_case(email)
        || !line_purpose.to_ascii_lowercase().contains(purpose)
        || code.len() != 6
        || !code.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    Some(code.to_string())
}

fn mail_code_from_text_line(line: &str, email: &str, purpose: &str) -> Option<String> {
    if !line
        .to_ascii_lowercase()
        .contains(&email.to_ascii_lowercase())
        || !line.to_ascii_lowercase().contains(purpose)
    {
        return None;
    }
    let lower = line.to_ascii_lowercase();
    let code_key = lower.find("code")?;
    let tail = line[code_key + "code".len()..].trim_start_matches(|character: char| {
        character.is_ascii_whitespace() || matches!(character, '=' | ':' | '"' | '\'')
    });
    let code: String = tail.chars().take_while(char::is_ascii_digit).collect();
    if code.len() == 6 {
        Some(code)
    } else {
        None
    }
}

async fn mail_code(email: &str, purpose: &str) -> String {
    let deadline = Instant::now() + MAIL_CODE_WAIT;
    loop {
        if let Some(contents) = mail_log_tail() {
            for line in contents.lines().rev() {
                if let Some(code) = mail_code_from_json_line(line, email, purpose)
                    .or_else(|| mail_code_from_text_line(line, email, purpose))
                {
                    return code;
                }
            }
        }
        assert!(
            Instant::now() < deadline,
            "mail sink did not record the requested code"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn mail_log_tail() -> Option<String> {
    let mut file = std::fs::File::open(MAIL_LOG).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(MAIL_LOG_TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(MAIL_LOG_TAIL_BYTES)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

async fn sign_up(email: &str, password: &str) {
    let response = post_json(
        "/api/accounts/signup",
        &json!({ "email": email, "password": password }),
    )
    .await;
    assert_status(&response, reqwest::StatusCode::ACCEPTED);
    let body: Value = response.json().await.expect("signup response is JSON");
    assert_eq!(
        body.get("status").and_then(Value::as_str),
        Some("verification_sent")
    );
    assert!(
        body.get("nsec").is_none(),
        "signup must not return the signing key before verification"
    );
}

async fn verify_signup(email: &str) -> AccountSession {
    let code = mail_code(email, "verify").await;
    let response = post_json(
        "/api/accounts/verify",
        &json!({ "email": email, "code": code }),
    )
    .await;
    parse_session(response).await
}

async fn register_verified(email: &str, password: &str) -> AccountSession {
    sign_up(email, password).await;
    verify_signup(email).await
}

async fn post_google_token(email: &str, subject: &str) -> String {
    let token_url = std::env::var("COLONY_TEST_GOOGLE_TOKEN_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8765/token".to_string());
    let audience = std::env::var("COLONY_TEST_GOOGLE_AUDIENCE")
        .unwrap_or_else(|_| "colony-auth-e2e-client".to_string());
    let response = http_client()
        .post(token_url)
        .json(&json!({ "email": email, "subject": subject, "audience": audience }))
        .send()
        .await
        .expect("request local Google test token");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let body: Value = response.json().await.expect("Google test token is JSON");
    let token = body
        .get("id_token")
        .and_then(Value::as_str)
        .expect("Google test fixture returns id_token")
        .to_string();
    drop(body);
    token
}

async fn post_message_as(keys: &Keys, content: &str) -> (String, String) {
    let channel_id = Uuid::new_v4().to_string();
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("NIP-42 account connection");

    let channel_event = EventBuilder::new(Kind::Custom(9007), "")
        .tags(vec![
            Tag::parse(["h", &channel_id]).expect("channel id tag"),
            Tag::parse(["name", &format!("auth-e2e-{channel_id}")]).expect("channel name tag"),
            Tag::parse(["channel_type", "stream"]).expect("channel type tag"),
            Tag::parse(["visibility", "open"]).expect("channel visibility tag"),
        ])
        .sign_with_keys(keys)
        .expect("sign channel creation event");
    let channel_result = client
        .send_event(channel_event)
        .await
        .expect("send channel creation event");
    assert!(channel_result.accepted, "relay rejected channel creation");

    let message = EventBuilder::new(Kind::Custom(9), content)
        .tags([Tag::parse(["h", &channel_id]).expect("channel message tag")])
        .sign_with_keys(keys)
        .expect("sign channel message");
    let event_id = message.id.to_hex();
    let result = client
        .send_event(message)
        .await
        .expect("send channel message");
    assert!(result.accepted, "relay rejected NIP-42 channel message");
    client
        .disconnect()
        .await
        .expect("disconnect account device");
    (channel_id, event_id)
}

async fn assert_message_readable(keys: &Keys, channel_id: &str, event_id: &str, content: &str) {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("NIP-42 second device connection");
    let subscription_id = format!("account-auth-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(9))
        .custom_tag(SingleLetterTag::lowercase(Alphabet::H), channel_id);
    client
        .subscribe(&subscription_id, vec![filter])
        .await
        .expect("subscribe to account message history");
    let events = client
        .collect_until_eose(&subscription_id, Duration::from_secs(10))
        .await
        .expect("read account message history");
    assert!(
        events
            .iter()
            .any(|event| event.id.to_hex() == event_id && event.content == content),
        "second device did not read the original account message"
    );
    client
        .close_subscription(&subscription_id)
        .await
        .expect("close account history subscription");
    client.disconnect().await.expect("disconnect second device");
}

async fn assert_rate_limited(response: reqwest::Response) {
    let body = assert_error(
        response,
        reqwest::StatusCode::TOO_MANY_REQUESTS,
        "rate_limited",
    )
    .await;
    assert!(
        body.get("retry_after_secs")
            .and_then(Value::as_u64)
            .is_some_and(|seconds| seconds > 0),
        "rate limit response must include a positive retry_after_secs"
    );
}

#[tokio::test]
#[ignore]
async fn email_signup_signin_and_reset_preserve_identity_and_history() {
    let email = unique_email("account-lifecycle");
    let original_password = "original-password-123";
    let next_password = "replacement-password-456";
    let first_device = register_verified(&email, original_password).await;
    assert!(first_device.has_password);
    assert!(!first_device.google_linked);

    let content = format!("account-history-{}", Uuid::new_v4());
    let (channel_id, event_id) = post_message_as(&first_device.keys, &content).await;

    let second_device_response = post_json(
        "/api/accounts/signin",
        &json!({ "email": email, "password": original_password }),
    )
    .await;
    let second_device = parse_session(second_device_response).await;
    assert_eq!(second_device.pubkey, first_device.pubkey);
    assert_message_readable(&second_device.keys, &channel_id, &event_id, &content).await;

    let request_reset = post_json("/api/accounts/reset/request", &json!({ "email": email })).await;
    assert_status(&request_reset, reqwest::StatusCode::ACCEPTED);
    let reset_code = mail_code(&email, "reset").await;
    let reset_response = post_json(
        "/api/accounts/reset/confirm",
        &json!({
            "email": email,
            "code": reset_code,
            "new_password": next_password,
        }),
    )
    .await;
    let reset_session = parse_session(reset_response).await;
    assert_eq!(reset_session.pubkey, first_device.pubkey);
    assert_message_readable(&reset_session.keys, &channel_id, &event_id, &content).await;

    let old_password_response = post_json(
        "/api/accounts/signin",
        &json!({ "email": email, "password": original_password }),
    )
    .await;
    assert_error(
        old_password_response,
        reqwest::StatusCode::UNAUTHORIZED,
        "invalid_credentials",
    )
    .await;

    let new_password_response = post_json(
        "/api/accounts/signin",
        &json!({ "email": email, "password": next_password }),
    )
    .await;
    let new_password_session = parse_session(new_password_response).await;
    assert_eq!(new_password_session.pubkey, first_device.pubkey);
}

#[tokio::test]
#[ignore = "pending relay lane local Google JWKS verifier hook"]
async fn google_create_and_link_accounts() {
    let google_email = unique_email("google-created");
    let google_subject = Uuid::new_v4().to_string();
    let create_token = post_google_token(&google_email, &google_subject).await;
    let created_response =
        post_json("/api/accounts/google", &json!({ "id_token": create_token })).await;
    let created = parse_session(created_response).await;
    assert!(!created.has_password);
    assert!(created.google_linked);

    let repeat_token = post_google_token(&google_email, &google_subject).await;
    let repeat_response =
        post_json("/api/accounts/google", &json!({ "id_token": repeat_token })).await;
    let repeat = parse_session(repeat_response).await;
    assert_eq!(repeat.pubkey, created.pubkey);

    let email = unique_email("google-linked");
    let password_session = register_verified(&email, "linked-account-password-123").await;
    let linked_subject = Uuid::new_v4().to_string();
    let link_token = post_google_token(&email, &linked_subject).await;
    let linked_response =
        post_json("/api/accounts/google", &json!({ "id_token": link_token })).await;
    let linked = parse_session(linked_response).await;
    assert_eq!(linked.pubkey, password_session.pubkey);
    assert!(linked.has_password);
    assert!(linked.google_linked);

    let linked_signin_token = post_google_token(&email, &linked_subject).await;
    let linked_signin_response = post_json(
        "/api/accounts/google",
        &json!({ "id_token": linked_signin_token }),
    )
    .await;
    let linked_signin = parse_session(linked_signin_response).await;
    assert_eq!(linked_signin.pubkey, password_session.pubkey);
}

#[tokio::test]
#[ignore]
async fn claiming_existing_key_preserves_identity_and_history() {
    let existing_keys = Keys::generate();
    let content = format!("claimed-key-history-{}", Uuid::new_v4());
    let (channel_id, event_id) = post_message_as(&existing_keys, &content).await;
    let nsec = existing_keys
        .secret_key()
        .to_bech32()
        .expect("encode generated test identity");
    let email = unique_email("claimed-identity");
    let password = "claimed-account-password-123";
    let claim = post_json_nip98(
        "/api/accounts/claim",
        &json!({ "email": email, "password": password, "nsec": nsec }),
        &existing_keys,
    )
    .await;
    assert_status(&claim, reqwest::StatusCode::ACCEPTED);
    let claim_body: Value = claim.json().await.expect("claim response is JSON");
    assert_eq!(
        claim_body.get("status").and_then(Value::as_str),
        Some("verification_sent")
    );
    assert!(
        claim_body.get("nsec").is_none(),
        "claim must not return the signing key before verification"
    );

    let claimed = verify_signup(&email).await;
    assert_eq!(claimed.pubkey, existing_keys.public_key().to_hex());
    assert_message_readable(&claimed.keys, &channel_id, &event_id, &content).await;

    let signin = post_json(
        "/api/accounts/signin",
        &json!({ "email": email, "password": password }),
    )
    .await;
    let password_session = parse_session(signin).await;
    assert_eq!(password_session.pubkey, claimed.pubkey);
}

#[tokio::test]
#[ignore]
async fn expired_verification_code_is_rejected() {
    let email = unique_email("expired-code");
    sign_up(&email, "expired-code-password-123").await;
    let code = mail_code(&email, "verify").await;
    let code_hash = Sha256::digest(code.as_bytes()).to_vec();
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://buzz:buzz_dev@localhost:5432/buzz".to_string());
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("connect to disposable E2E Postgres");
    let update = sqlx::query(
        "UPDATE account_codes SET expires_at = now() - interval '1 second' \
         WHERE code_hash = $1 AND consumed_at IS NULL",
    )
    .bind(code_hash)
    .execute(&pool)
    .await
    .expect("expire signup code in disposable E2E database");
    assert_eq!(update.rows_affected(), 1, "signup code row was not found");
    pool.close().await;

    let response = post_json(
        "/api/accounts/verify",
        &json!({ "email": email, "code": code }),
    )
    .await;
    assert_error(response, reqwest::StatusCode::GONE, "code_expired").await;
}

#[tokio::test]
#[ignore]
async fn password_lockout_and_route_rate_limit_are_enforced() {
    let email = unique_email("lockout");
    let password = "correct-lockout-password-123";
    let session = register_verified(&email, password).await;

    for _ in 0..5 {
        let response = post_json(
            "/api/accounts/signin",
            &json!({ "email": email, "password": "incorrect-password-123" }),
        )
        .await;
        assert_error(
            response,
            reqwest::StatusCode::UNAUTHORIZED,
            "invalid_credentials",
        )
        .await;
    }
    let locked_response = post_json(
        "/api/accounts/signin",
        &json!({ "email": email, "password": password }),
    )
    .await;
    let lockout_body = assert_error(
        locked_response,
        reqwest::StatusCode::TOO_MANY_REQUESTS,
        "rate_limited",
    )
    .await;
    let retry_after_secs = lockout_body
        .get("retry_after_secs")
        .and_then(Value::as_u64)
        .expect("lockout response has retry_after_secs");
    assert!(
        (895..=900).contains(&retry_after_secs),
        "five failed sign-ins must lock the account for about 15 minutes"
    );

    let mut rate_limited = false;
    for attempt in 0..100 {
        let response = post_json(
            "/api/accounts/resend-code",
            &json!({
                "email": unique_email(&format!("rate-limit-{attempt}")),
                "purpose": "verify",
            }),
        )
        .await;
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            assert_rate_limited(response).await;
            rate_limited = true;
            break;
        }
        assert_status(&response, reqwest::StatusCode::ACCEPTED);
    }
    assert!(
        rate_limited,
        "resend-code did not enforce its IP rate limit"
    );
    drop(session);
}
