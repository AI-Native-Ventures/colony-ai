//! Password sign-in for allowlisted operator accounts.
//!
//! This route deliberately shares the emailed-code flow's opaque identity
//! hashes, rate limits, audit trail, allowlist mapping, and generic failure
//! response. It never writes account sign-in policy state: the password route
//! has its own short Redis lockout so an operator-admin attempt cannot reset or
//! increment the Colony app account's counters.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{ConnectInfo, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use buzz_auth::OpaqueRateLimitScope;
use redis::Script;
use serde::Deserialize;
use serde_json::json;

use crate::api::accounts::{crypto, normalize_email, SecretString};
use crate::state::AppState;

use super::email::{
    audit, audit_without_email, email_identity_hash, generic_failure_response, ip_bucket_hash,
    ip_rate_hash, operator_email_pubkey, rate_allowed, VERIFY_EMAIL_RATE_LIMIT,
    VERIFY_IP_RATE_LIMIT,
};
use super::{
    cookie_header, mint_token, require_admin_page, session_key, unix_now, ApiError, SESSION_SECS,
};

const LOCKOUT_SECS: u64 = 15 * 60;
const MAX_WRONG_ATTEMPTS: u8 = 5;

const RECORD_PASSWORD_ATTEMPT_SCRIPT: &str = r#"
local raw = redis.call('GET', KEYS[1])
local attempts = raw and tonumber(raw) or 0
if raw and not attempts then return 'invalid' end
if attempts >= tonumber(ARGV[2]) then return 'locked' end
if ARGV[1] == '1' then
    if attempts > 0 then redis.call('DEL', KEYS[1]) end
    return 'correct'
end
attempts = redis.call('INCR', KEYS[1])
if attempts >= tonumber(ARGV[2]) then
    redis.call('EXPIRE', KEYS[1], ARGV[3])
    return 'locked'
end
if attempts == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[3])
end
return 'wrong'
"#;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PasswordSigninRequest {
    email: String,
    password: SecretString,
}

#[derive(Clone, Copy)]
enum PasswordAttempt {
    Correct,
    Wrong,
    Locked,
}

/// Redis key for the short-lived password-login attempt count for one opaque email identity.
pub(super) fn password_lockout_key(email_hash: &[u8; 32]) -> String {
    format!("colony:admin-password-lockout:{}", hex::encode(email_hash))
}

async fn record_password_attempt(
    state: &AppState,
    email_hash: &[u8; 32],
    password_matches: bool,
) -> Result<PasswordAttempt, ()> {
    let mut connection = state.redis_pool.get().await.map_err(|_| ())?;
    let result: String = Script::new(RECORD_PASSWORD_ATTEMPT_SCRIPT)
        .key(password_lockout_key(email_hash))
        .arg(if password_matches { "1" } else { "0" })
        .arg(MAX_WRONG_ATTEMPTS)
        .arg(LOCKOUT_SECS)
        .invoke_async(&mut *connection)
        .await
        .map_err(|_| ())?;
    match result.as_str() {
        "correct" => Ok(PasswordAttempt::Correct),
        "wrong" => Ok(PasswordAttempt::Wrong),
        "locked" => Ok(PasswordAttempt::Locked),
        _ => Err(()),
    }
}

/// `POST /session/password`: exchange an allowlisted Colony account password
/// for the same signed operator cookie used by the Google and emailed-code
/// flows.
pub(super) async fn signin(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    peer: ConnectInfo<SocketAddr>,
    body: Bytes,
) -> Result<Response, ApiError> {
    if let Err(error) = require_admin_page(&state, &headers) {
        audit_without_email(
            &state,
            "password",
            "host_or_origin_rejected",
            &headers,
            &peer,
        )
        .await;
        return Err(error);
    }
    let request = match serde_json::from_slice::<PasswordSigninRequest>(&body) {
        Ok(request) => request,
        Err(_) => {
            audit_without_email(&state, "password", "invalid_request", &headers, &peer).await;
            return Ok(generic_failure_response());
        }
    };
    let Some(email) = normalize_email(&request.email) else {
        audit_without_email(&state, "password", "invalid_request", &headers, &peer).await;
        return Ok(generic_failure_response());
    };
    let Some(kek) = state.config.accounts.account_kek() else {
        audit_without_email(&state, "password", "method_unavailable", &headers, &peer).await;
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
        OpaqueRateLimitScope::AdminPasswordSigninIp,
        OpaqueRateLimitScope::AdminPasswordSigninEmail,
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
                "password",
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
                "password",
                "rate_limiter_unavailable",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    }

    // Always execute one real or dummy Argon2 verification after passing the
    // rate limits. Eligibility and account existence are intentionally decided
    // only after that work so they do not become timing oracles.
    let account_lookup = state.db.account_by_email(&email).await;
    let password_hash = account_lookup
        .as_ref()
        .ok()
        .and_then(|account| account.as_ref())
        .and_then(|account| account.password_hash())
        .map(str::to_owned);
    let password_matches =
        match crypto::verify_password(request.password.into_inner(), password_hash).await {
            Ok(matches) => matches,
            Err(_) => {
                let _ = audit(
                    &state,
                    "password",
                    "password_verification_unavailable",
                    &email_hash,
                    &ip_audit_hash,
                )
                .await;
                return Ok(generic_failure_response());
            }
        };
    let account = match account_lookup {
        Ok(account) => account,
        Err(_) => {
            let _ = audit(
                &state,
                "password",
                "account_lookup_failed",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    };

    let initial_operator_pubkey = operator_email_pubkey(&state, &email, account.as_ref()).ok();
    let initial_account_has_verified_password = account.as_ref().is_some_and(|account| {
        account.email_verified_at.is_some() && account.password_hash().is_some()
    });

    match record_password_attempt(&state, &email_hash, password_matches).await {
        Ok(PasswordAttempt::Locked) => {
            let _ = audit(
                &state,
                "password",
                "locked_out",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
        Ok(PasswordAttempt::Wrong) => {
            let outcome =
                if initial_operator_pubkey.is_some() && initial_account_has_verified_password {
                    "wrong_password"
                } else {
                    "not_eligible"
                };
            let _ = audit(&state, "password", outcome, &email_hash, &ip_audit_hash).await;
            return Ok(generic_failure_response());
        }
        Ok(PasswordAttempt::Correct) => {}
        Err(()) => {
            let _ = audit(
                &state,
                "password",
                "redis_unavailable",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    }

    let Some(initial_account) = account.as_ref() else {
        let _ = audit(
            &state,
            "password",
            "not_eligible",
            &email_hash,
            &ip_audit_hash,
        )
        .await;
        return Ok(generic_failure_response());
    };
    let Some(initial_password_hash) = initial_account.password_hash().map(str::to_owned) else {
        let _ = audit(
            &state,
            "password",
            "not_eligible",
            &email_hash,
            &ip_audit_hash,
        )
        .await;
        return Ok(generic_failure_response());
    };
    let current_account = match state
        .db
        .account_for_admin_password_signin(initial_account.id, &email, &initial_password_hash)
        .await
    {
        Ok(account) => account,
        Err(_) => {
            let _ = audit(
                &state,
                "password",
                "account_lookup_failed",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    };
    let current_account = match current_account {
        Some(buzz_db::accounts::AdminPasswordSigninAccount::Eligible(account)) => account,
        Some(buzz_db::accounts::AdminPasswordSigninAccount::Locked) => {
            let _ = audit(
                &state,
                "password",
                "account_locked",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
        None => {
            let _ = audit(
                &state,
                "password",
                "not_eligible",
                &email_hash,
                &ip_audit_hash,
            )
            .await;
            return Ok(generic_failure_response());
        }
    };
    let Some(pubkey) = operator_email_pubkey(&state, &email, Some(&current_account)).ok() else {
        let _ = audit(
            &state,
            "password",
            "not_eligible",
            &email_hash,
            &ip_audit_hash,
        )
        .await;
        return Ok(generic_failure_response());
    };
    if !audit(&state, "password", "success", &email_hash, &ip_audit_hash).await {
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
    use super::password_lockout_key;

    #[test]
    fn password_lockout_keys_keep_email_identities_opaque_and_distinct() {
        let first = password_lockout_key(&[0x11; 32]);
        let second = password_lockout_key(&[0x22; 32]);

        assert_ne!(first, second);
        assert!(first.starts_with("colony:admin-password-lockout:"));
        assert!(!first.contains('@'));
    }
}
