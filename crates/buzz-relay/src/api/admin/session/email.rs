//! Allowlisted emailed one-time codes for the deployment operator console.
//!
//! Redis holds only a salted, keyed code hash with a short TTL. Postgres holds
//! a separate append-only audit trail of fixed-width keyed identity hashes.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use buzz_auth::{OpaqueRateLimitScope, RateLimiter};
use hmac::Mac as _;
use redis::Script;
use serde::{Deserialize, Serialize};
use serde_json::json;
use subtle::ConstantTimeEq;
use tracing::Instrument as _;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::api::accounts::{
    mail::{CodeMailKind, MailDeliveryError},
    normalize_email, SecretString,
};
use crate::config::{OperatorEmailLoginStatus, RelayOperatorEmail};
use crate::state::AppState;

use super::{
    cookie_header, is_listed_operator, mint_token, require_admin_page, session_key, unix_now,
    ApiError, SESSION_SECS,
};

const CODE_TTL_SECS: u64 = 10 * 60;
const RESEND_COOLDOWN_SECS: u64 = 30;
const LOCKOUT_SECS: u64 = 15 * 60;
const MAX_WRONG_ATTEMPTS: u8 = 5;
const RATE_LIMIT_WINDOW_SECS: u64 = 60;

/// Per-minute operator email-code start quota for one opaque source IP.
pub(crate) const START_IP_RATE_LIMIT: u64 = 20;
/// Per-minute operator email-code start quota for one opaque email hash.
pub(crate) const START_EMAIL_RATE_LIMIT: u64 = 5;
const VERIFY_IP_RATE_LIMIT: u64 = 30;
const VERIFY_EMAIL_RATE_LIMIT: u64 = 10;

const IDENTITY_HASH_LABEL: &[u8] = b"colony-admin-email-identity-v1\0";
const IP_RATE_HASH_LABEL: &[u8] = b"colony-admin-email-ip-rate-v1\0";
const IP_BUCKET_HASH_LABEL: &[u8] = b"colony-admin-email-ip-bucket-v1\0";
const CODE_HASH_LABEL: &[u8] = b"colony-admin-email-code-v1\0";
const ZERO_HASH: [u8; 32] = [0; 32];

const RESERVE_CODE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[3]) == 1 then return 'locked' end
if not redis.call('SET', KEYS[2], ARGV[2], 'NX', 'EX', ARGV[3]) then return 'cooldown' end
redis.call('SET', KEYS[1], ARGV[4], 'EX', ARGV[5])
if ARGV[1] ~= '1' then return 'ineligible' end
return 'issued'
"#;

const VERIFY_CODE_SCRIPT: &str = r#"
if redis.call('EXISTS', KEYS[2]) == 1 then return 'locked' end
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
if not string.find(raw, ARGV[1], 1, true) then return 'changed' end
if ARGV[2] == '1' then
    redis.call('DEL', KEYS[1])
    return 'accepted'
end
local challenge = cjson.decode(raw)
challenge.attempts = (challenge.attempts or 0) + 1
if challenge.attempts >= tonumber(ARGV[3]) then
    redis.call('DEL', KEYS[1])
    redis.call('SET', KEYS[2], '1', 'EX', ARGV[4])
    return 'locked'
end
redis.call('SET', KEYS[1], cjson.encode(challenge), 'KEEPTTL')
return 'wrong'
"#;

const DELETE_CURRENT_CHALLENGE_SCRIPT: &str = r#"
local raw = redis.call('GET', KEYS[1])
if raw and string.find(raw, ARGV[1], 1, true) then
    redis.call('DEL', KEYS[1])
end
return 1
"#;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EmailStartRequest {
    email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EmailVerifyRequest {
    email: String,
    code: SecretString,
}

#[derive(Serialize, Deserialize)]
struct StoredEmailCode {
    challenge_id: Uuid,
    salt: [u8; 32],
    code_hash: [u8; 32],
    attempts: u8,
}

#[derive(Clone, Copy)]
enum CodeReservation {
    Issued,
    Cooldown,
    Locked,
    Ineligible,
}

#[derive(Clone, Copy)]
enum CodeVerification {
    Accepted,
    Wrong,
    Locked,
    Missing,
    Changed,
}

/// Privacy-safe class for one email-code start outcome.
///
/// These values are intentionally the entire server-side diagnostic surface:
/// they identify a deployment/configuration condition without retaining or
/// logging the requested address, code, or client address.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartReason {
    Sent,
    NotAllowlisted,
    NoAccount,
    AccountUnverified,
    NotOperatorKey,
    MailUnconfigured,
    MailProviderError,
}

impl StartReason {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Sent => "sent",
            Self::NotAllowlisted => "not_allowlisted",
            Self::NoAccount => "no_account",
            Self::AccountUnverified => "account_unverified",
            Self::NotOperatorKey => "not_operator_key",
            Self::MailUnconfigured => "mail_unconfigured",
            Self::MailProviderError => "mail_provider_error",
        }
    }
}

fn requested_response() -> Response {
    (
        StatusCode::ACCEPTED,
        Json(json!({
            "status": "email_code_requested",
            "retryAfterSeconds": RESEND_COOLDOWN_SECS,
        })),
    )
        .into_response()
}

fn generic_failure_response() -> Response {
    // This deliberately does not use ApiError::unauthorized(), which advertises
    // the unrelated NIP-98 challenge and would distinguish code failures.
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": {
                "code": "invalid_email_code",
                "message": "The code is invalid or has expired.",
            }
        })),
    )
        .into_response()
}

fn keyed_hash(kek: &[u8; 32], label: &[u8], fields: &[&[u8]]) -> Result<[u8; 32], ApiError> {
    let mut mac = super::mac_for(kek)?;
    mac.update(label);
    for field in fields {
        mac.update(&(field.len() as u64).to_be_bytes());
        mac.update(field);
    }
    let digest = mac.finalize().into_bytes();
    let mut hash = [0; 32];
    hash.copy_from_slice(&digest);
    Ok(hash)
}

/// Derive the opaque Redis and audit identity for one normalized operator email.
pub(crate) fn email_identity_hash(kek: &[u8; 32], email: &str) -> Result<[u8; 32], ApiError> {
    keyed_hash(kek, IDENTITY_HASH_LABEL, &[email.as_bytes()])
}

/// Resolve the client address for abuse limits and audit bucketing.
///
/// Fly replaces `Fly-Client-IP` at its edge. For a directly exposed relay the
/// socket peer is the safe fallback; this value is never used for authorization.
fn client_ip(headers: &HeaderMap, peer: &ConnectInfo<SocketAddr>) -> IpAddr {
    headers
        .get("fly-client-ip")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<IpAddr>().ok())
        .unwrap_or_else(|| peer.0.ip())
}

fn ip_bucket(headers: &HeaderMap, peer: &ConnectInfo<SocketAddr>) -> String {
    match client_ip(headers, peer) {
        IpAddr::V4(ip) => {
            let [first, second, third, _] = ip.octets();
            format!("v4:{first}.{second}.{third}.0/24")
        }
        IpAddr::V6(ip) => format!("v6:{:x}/64", u128::from(ip) >> 64),
    }
}

fn ip_bucket_hash(
    kek: &[u8; 32],
    headers: &HeaderMap,
    peer: &ConnectInfo<SocketAddr>,
) -> Result<[u8; 32], ApiError> {
    let bucket = ip_bucket(headers, peer);
    keyed_hash(kek, IP_BUCKET_HASH_LABEL, &[bucket.as_bytes()])
}

fn ip_rate_hash(
    kek: &[u8; 32],
    headers: &HeaderMap,
    peer: &ConnectInfo<SocketAddr>,
) -> Result<[u8; 32], ApiError> {
    let ip = client_ip(headers, peer).to_string();
    keyed_hash(kek, IP_RATE_HASH_LABEL, &[ip.as_bytes()])
}

fn code_hash(
    kek: &[u8; 32],
    email: &str,
    salt: &[u8; 32],
    code: &str,
) -> Result<[u8; 32], ApiError> {
    keyed_hash(
        kek,
        CODE_HASH_LABEL,
        &[email.as_bytes(), salt.as_slice(), code.as_bytes()],
    )
}

/// Generate eight decimal digits with rejection sampling, avoiding modulo bias.
fn generate_code() -> Zeroizing<String> {
    const SPACE: u32 = 100_000_000;
    const UPPER: u32 = (u32::MAX / SPACE) * SPACE;
    loop {
        let candidate = rand::random::<u32>();
        if candidate < UPPER {
            return Zeroizing::new(format!("{:08}", candidate % SPACE));
        }
    }
}

fn valid_code_format(code: &str) -> bool {
    code.len() == 8 && code.bytes().all(|byte| byte.is_ascii_digit())
}

/// Redis key for a short-lived salted email-code challenge.
pub(crate) fn email_code_key(email_hash: &[u8; 32]) -> String {
    format!("colony:admin-email-code:{}", hex::encode(email_hash))
}

/// Redis key for the short resend cooldown.
pub(crate) fn email_cooldown_key(email_hash: &[u8; 32]) -> String {
    format!("colony:admin-email-cooldown:{}", hex::encode(email_hash))
}

fn email_lockout_key(email_hash: &[u8; 32]) -> String {
    format!("colony:admin-email-lockout:{}", hex::encode(email_hash))
}

fn operator_email_pubkey(
    state: &AppState,
    email: &str,
    account: Option<&buzz_db::accounts::AccountRecord>,
) -> Result<String, StartReason> {
    if state.config.operator_email_login_status() != OperatorEmailLoginStatus::Enabled {
        return Err(StartReason::MailUnconfigured);
    }
    let Some(configured) = state
        .config
        .relay_operator_emails
        .iter()
        .find(|configured| configured.email() == email)
    else {
        return Err(StartReason::NotAllowlisted);
    };
    match configured {
        RelayOperatorEmail::Alias { pubkey, .. } => {
            if is_listed_operator(state, pubkey) {
                Ok(pubkey.clone())
            } else {
                Err(StartReason::NotOperatorKey)
            }
        }
        RelayOperatorEmail::Account(_) => {
            let account = account.ok_or(StartReason::NoAccount)?;
            if account.email_verified_at.is_none() {
                return Err(StartReason::AccountUnverified);
            }
            if !is_listed_operator(state, &account.pubkey) {
                return Err(StartReason::NotOperatorKey);
            }
            Ok(account.pubkey.to_lowercase())
        }
    }
}

async fn audit(
    state: &AppState,
    operation: &'static str,
    outcome: &'static str,
    email_hash: &[u8; 32],
    ip_bucket_hash: &[u8; 32],
) -> bool {
    state
        .db
        .record_operator_email_login_audit(operation, outcome, email_hash, ip_bucket_hash)
        .await
        .is_ok()
}

fn log_start_reason(reason: StartReason) {
    if reason == StartReason::Sent {
        tracing::info!(reason = reason.as_str(), "admin email login start");
    } else {
        tracing::warn!(reason = reason.as_str(), "admin email login start");
    }
}

async fn record_start_result(
    state: &AppState,
    reason: StartReason,
    email_hash: &[u8; 32],
    ip_bucket_hash: &[u8; 32],
) {
    let _ = audit(state, "start", reason.as_str(), email_hash, ip_bucket_hash).await;
    log_start_reason(reason);
}

async fn audit_without_email(
    state: &AppState,
    operation: &'static str,
    outcome: &'static str,
    headers: &HeaderMap,
    peer: &ConnectInfo<SocketAddr>,
) {
    let ip_bucket_hash = state
        .config
        .accounts
        .account_kek()
        .and_then(|kek| ip_bucket_hash(kek, headers, peer).ok())
        .unwrap_or(ZERO_HASH);
    let _ = audit(state, operation, outcome, &ZERO_HASH, &ip_bucket_hash).await;
}

async fn record_start_result_without_email(
    state: &AppState,
    reason: StartReason,
    headers: &HeaderMap,
    peer: &ConnectInfo<SocketAddr>,
) {
    let ip_bucket_hash = state
        .config
        .accounts
        .account_kek()
        .and_then(|kek| ip_bucket_hash(kek, headers, peer).ok())
        .unwrap_or(ZERO_HASH);
    record_start_result(state, reason, &ZERO_HASH, &ip_bucket_hash).await;
}

async fn rate_allowed(
    state: &AppState,
    ip_scope: OpaqueRateLimitScope,
    email_scope: OpaqueRateLimitScope,
    ip_rate_hash: &[u8; 32],
    email_hash: &[u8; 32],
    ip_limit: u64,
    email_limit: u64,
) -> Result<bool, ()> {
    // Always touch both quota dimensions. A limit in one bucket must not make
    // the other counter an observable side channel.
    let ip = state.admission_rate_limiter.check_opaque(
        ip_scope,
        ip_rate_hash,
        RATE_LIMIT_WINDOW_SECS,
        ip_limit,
    );
    let email = state.admission_rate_limiter.check_opaque(
        email_scope,
        email_hash,
        RATE_LIMIT_WINDOW_SECS,
        email_limit,
    );
    let (ip, email) = tokio::join!(ip, email);
    let (Ok(ip), Ok(email)) = (ip, email) else {
        return Err(());
    };
    Ok(ip.allowed && email.allowed)
}

async fn reserve_code(
    state: &AppState,
    email_hash: &[u8; 32],
    stored: &StoredEmailCode,
    eligible: bool,
) -> Result<CodeReservation, ()> {
    let encoded = serde_json::to_string(stored).map_err(|_| ())?;
    let mut connection = state.redis_pool.get().await.map_err(|_| ())?;
    let result: String = Script::new(RESERVE_CODE_SCRIPT)
        .key(email_code_key(email_hash))
        .key(email_cooldown_key(email_hash))
        .key(email_lockout_key(email_hash))
        .arg(if eligible { "1" } else { "0" })
        .arg("1")
        .arg(RESEND_COOLDOWN_SECS)
        .arg(encoded)
        .arg(CODE_TTL_SECS)
        .invoke_async(&mut *connection)
        .await
        .map_err(|_| ())?;
    match result.as_str() {
        "issued" => Ok(CodeReservation::Issued),
        "cooldown" => Ok(CodeReservation::Cooldown),
        "locked" => Ok(CodeReservation::Locked),
        "ineligible" => Ok(CodeReservation::Ineligible),
        _ => Err(()),
    }
}

async fn load_code(state: &AppState, email_hash: &[u8; 32]) -> Result<Option<StoredEmailCode>, ()> {
    let mut connection = state.redis_pool.get().await.map_err(|_| ())?;
    let raw: Option<String> = redis::cmd("GET")
        .arg(email_code_key(email_hash))
        .query_async(&mut *connection)
        .await
        .map_err(|_| ())?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(|_| ()))
        .transpose()
}

async fn verify_stored_code(
    state: &AppState,
    email_hash: &[u8; 32],
    challenge_id: Uuid,
    matches: bool,
) -> Result<CodeVerification, ()> {
    let mut connection = state.redis_pool.get().await.map_err(|_| ())?;
    let result: String = Script::new(VERIFY_CODE_SCRIPT)
        .key(email_code_key(email_hash))
        .key(email_lockout_key(email_hash))
        .arg(challenge_id.to_string())
        .arg(if matches { "1" } else { "0" })
        .arg(MAX_WRONG_ATTEMPTS)
        .arg(LOCKOUT_SECS)
        .invoke_async(&mut *connection)
        .await
        .map_err(|_| ())?;
    match result.as_str() {
        "accepted" => Ok(CodeVerification::Accepted),
        "wrong" => Ok(CodeVerification::Wrong),
        "locked" => Ok(CodeVerification::Locked),
        "missing" => Ok(CodeVerification::Missing),
        "changed" => Ok(CodeVerification::Changed),
        _ => Err(()),
    }
}

async fn delete_current_code(state: &AppState, email_hash: &[u8; 32], challenge_id: Uuid) {
    let Ok(mut connection) = state.redis_pool.get().await else {
        return;
    };
    let _: Result<i64, _> = Script::new(DELETE_CURRENT_CHALLENGE_SCRIPT)
        .key(email_code_key(email_hash))
        .arg(challenge_id.to_string())
        .invoke_async(&mut *connection)
        .await;
}

fn spawn_delivery(
    state: Arc<AppState>,
    email: String,
    email_hash: [u8; 32],
    ip_bucket_hash: [u8; 32],
    challenge_id: Uuid,
    code: Zeroizing<String>,
) {
    tokio::spawn(
        async move {
            let reason = match state
                .account_services
                .code_mailer
                .send_code(
                    &state.config.accounts,
                    &email,
                    CodeMailKind::AdminEmailLogin,
                    &code,
                )
                .await
            {
                Ok(()) => StartReason::Sent,
                Err(MailDeliveryError::Unconfigured) => StartReason::MailUnconfigured,
                Err(MailDeliveryError::Provider) => StartReason::MailProviderError,
            };
            if reason != StartReason::Sent {
                delete_current_code(&state, &email_hash, challenge_id).await;
            }
            record_start_result(&state, reason, &email_hash, &ip_bucket_hash).await;
        }
        .instrument(tracing::info_span!("admin_email_delivery")),
    );
}

/// `POST /session/email/start`: request an emailed code without exposing the
/// operator allowlist. Every valid request answers with the same 202 body.
pub(super) async fn start(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    peer: ConnectInfo<SocketAddr>,
    body: Bytes,
) -> Result<Response, ApiError> {
    if let Err(error) = require_admin_page(&state, &headers) {
        audit_without_email(&state, "start", "host_or_origin_rejected", &headers, &peer).await;
        return Err(error);
    }
    let request = match serde_json::from_slice::<EmailStartRequest>(&body) {
        Ok(request) => request,
        Err(_) => {
            record_start_result_without_email(&state, StartReason::NotAllowlisted, &headers, &peer)
                .await;
            return Ok(requested_response());
        }
    };
    let Some(email) = normalize_email(&request.email) else {
        record_start_result_without_email(&state, StartReason::NotAllowlisted, &headers, &peer)
            .await;
        return Ok(requested_response());
    };
    if state.config.operator_email_login_status() != OperatorEmailLoginStatus::Enabled {
        record_start_result_without_email(&state, StartReason::MailUnconfigured, &headers, &peer)
            .await;
        return Ok(requested_response());
    }
    let Some(kek) = state.config.accounts.account_kek() else {
        record_start_result_without_email(&state, StartReason::MailUnconfigured, &headers, &peer)
            .await;
        return Ok(requested_response());
    };
    let email_hash = match email_identity_hash(kek, &email) {
        Ok(hash) => hash,
        Err(_) => {
            record_start_result_without_email(
                &state,
                StartReason::MailProviderError,
                &headers,
                &peer,
            )
            .await;
            return Ok(requested_response());
        }
    };
    let ip_rate_hash = match ip_rate_hash(kek, &headers, &peer) {
        Ok(hash) => hash,
        Err(_) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ZERO_HASH,
            )
            .await;
            return Ok(requested_response());
        }
    };
    let ip_audit_hash = match ip_bucket_hash(kek, &headers, &peer) {
        Ok(hash) => hash,
        Err(_) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ZERO_HASH,
            )
            .await;
            return Ok(requested_response());
        }
    };
    match rate_allowed(
        &state,
        OpaqueRateLimitScope::AdminEmailStartIp,
        OpaqueRateLimitScope::AdminEmailStartEmail,
        &ip_rate_hash,
        &email_hash,
        START_IP_RATE_LIMIT,
        START_EMAIL_RATE_LIMIT,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(requested_response());
        }
        Err(()) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(requested_response());
        }
    }

    // Resolve every syntactically valid email before eligibility filtering so
    // the account lookup does not become an allowlist timing oracle.
    let account = match state.db.account_by_email(&email).await {
        Ok(account) => account,
        Err(_) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(requested_response());
        }
    };
    let eligibility = operator_email_pubkey(&state, &email, account.as_ref());
    let eligible = eligibility.is_ok();
    let code = generate_code();
    let salt = rand::random::<[u8; 32]>();
    let code_hash = match code_hash(kek, &email, &salt, code.as_str()) {
        Ok(hash) => hash,
        Err(_) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(requested_response());
        }
    };
    let stored = StoredEmailCode {
        challenge_id: Uuid::new_v4(),
        salt,
        code_hash,
        attempts: 0,
    };
    let reservation = match reserve_code(&state, &email_hash, &stored, eligible).await {
        Ok(reservation) => reservation,
        Err(()) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(requested_response());
        }
    };
    match (eligibility, reservation) {
        (Ok(_), CodeReservation::Issued) => spawn_delivery(
            state,
            email,
            email_hash,
            ip_audit_hash,
            stored.challenge_id,
            code,
        ),
        (Err(reason), _) => {
            record_start_result(&state, reason, &email_hash, &ip_audit_hash).await;
        }
        (
            Ok(_),
            CodeReservation::Cooldown | CodeReservation::Locked | CodeReservation::Ineligible,
        ) => {
            record_start_result(
                &state,
                StartReason::MailProviderError,
                &email_hash,
                &ip_audit_hash,
            )
            .await;
        }
    }
    Ok(requested_response())
}

/// `POST /session/email/verify`: consume one email code and mint the exact
/// cookie session used by Google sign-in when the account remains an operator.
pub(super) async fn verify(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    peer: ConnectInfo<SocketAddr>,
    body: Bytes,
) -> Result<Response, ApiError> {
    if let Err(error) = require_admin_page(&state, &headers) {
        audit_without_email(&state, "verify", "host_or_origin_rejected", &headers, &peer).await;
        return Err(error);
    }
    let request = match serde_json::from_slice::<EmailVerifyRequest>(&body) {
        Ok(request) => request,
        Err(_) => {
            audit_without_email(&state, "verify", "invalid_request", &headers, &peer).await;
            return Ok(generic_failure_response());
        }
    };
    let Some(email) = normalize_email(&request.email) else {
        audit_without_email(&state, "verify", "invalid_request", &headers, &peer).await;
        return Ok(generic_failure_response());
    };
    let Some(kek) = state.config.accounts.account_kek() else {
        audit_without_email(&state, "verify", "method_unavailable", &headers, &peer).await;
        return Ok(generic_failure_response());
    };
    let email_hash = match email_identity_hash(kek, &email) {
        Ok(hash) => hash,
        Err(_) => return Ok(generic_failure_response()),
    };
    let ip_rate_hash = match ip_rate_hash(kek, &headers, &peer) {
        Ok(hash) => hash,
        Err(_) => return Ok(generic_failure_response()),
    };
    let ip_audit_hash = match ip_bucket_hash(kek, &headers, &peer) {
        Ok(hash) => hash,
        Err(_) => return Ok(generic_failure_response()),
    };
    match rate_allowed(
        &state,
        OpaqueRateLimitScope::AdminEmailVerifyIp,
        OpaqueRateLimitScope::AdminEmailVerifyEmail,
        &ip_rate_hash,
        &email_hash,
        VERIFY_IP_RATE_LIMIT,
        VERIFY_EMAIL_RATE_LIMIT,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => {
            let _ = audit(
                &state,
                "verify",
                "rate_limited",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
        Err(()) => {
            let _ = audit(
                &state,
                "verify",
                "rate_limiter_unavailable",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    }
    let account = match state.db.account_by_email(&email).await {
        Ok(account) => account,
        Err(_) => {
            let _ = audit(
                &state,
                "verify",
                "account_lookup_failed",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    };
    let Some(pubkey) = operator_email_pubkey(&state, &email, account.as_ref()).ok() else {
        let _ = audit(
            &state,
            "verify",
            "not_eligible",
            &email_hash,
            &ip_audit_hash,
        )
        .await;
        return Ok(generic_failure_response());
    };
    let code = request.code.into_inner();
    let Some(stored) = (match load_code(&state, &email_hash).await {
        Ok(stored) => stored,
        Err(()) => {
            let _ = audit(
                &state,
                "verify",
                "redis_unavailable",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    }) else {
        let _ = audit(
            &state,
            "verify",
            "missing_or_expired",
            &email_hash,
            &ip_audit_hash,
        )
        .await;
        return Ok(generic_failure_response());
    };
    let candidate = match code_hash(kek, &email, &stored.salt, code.as_str()) {
        Ok(hash) => hash,
        Err(_) => return Ok(generic_failure_response()),
    };
    let hash_matches = bool::from(stored.code_hash.ct_eq(&candidate));
    let matches = valid_code_format(code.as_str()) & hash_matches;
    let verification =
        match verify_stored_code(&state, &email_hash, stored.challenge_id, matches).await {
            Ok(verification) => verification,
            Err(()) => {
                let _ = audit(
                    &state,
                    "verify",
                    "redis_unavailable",
                    &email_hash,
                    &ip_audit_hash,
                )
                .await;
                return Ok(generic_failure_response());
            }
        };
    if !matches!(verification, CodeVerification::Accepted) {
        let outcome = match verification {
            CodeVerification::Wrong => "wrong_code",
            CodeVerification::Locked => "locked_out",
            CodeVerification::Missing | CodeVerification::Changed => "missing_or_expired",
            CodeVerification::Accepted => unreachable!(),
        };
        let _ = audit(&state, "verify", outcome, &email_hash, &ip_audit_hash).await;
        return Ok(generic_failure_response());
    }
    if !audit(&state, "verify", "success", &email_hash, &ip_audit_hash).await {
        return Ok(generic_failure_response());
    }
    let token = mint_token(&session_key(kek)?, &pubkey, unix_now())?;
    let short: String = pubkey.chars().take(8).collect();
    let mut response = (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "pubkeyShort": short,
            "expiresInSeconds": SESSION_SECS,
        })),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie_header(&token, SESSION_SECS)?);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr};

    use axum::extract::ConnectInfo;
    use axum::http::HeaderMap;

    use super::{ip_bucket_hash, ip_rate_hash};

    #[test]
    fn rate_limits_keep_source_ips_distinct_while_audits_bucket_them() {
        let key = [0x61; 32];
        let headers = HeaderMap::new();
        let first = ConnectInfo(SocketAddr::from((Ipv4Addr::new(198, 51, 100, 10), 443)));
        let second = ConnectInfo(SocketAddr::from((Ipv4Addr::new(198, 51, 100, 11), 443)));

        assert_ne!(
            ip_rate_hash(&key, &headers, &first).expect("first source hash"),
            ip_rate_hash(&key, &headers, &second).expect("second source hash"),
            "per-IP limits must not merge distinct source addresses"
        );
        assert_eq!(
            ip_bucket_hash(&key, &headers, &first).expect("first audit bucket"),
            ip_bucket_hash(&key, &headers, &second).expect("second audit bucket"),
            "audit records retain only the bounded IP bucket"
        );
    }
}
