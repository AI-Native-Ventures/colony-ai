//! "Sign in with your Colony account" for the operator admin.
//!
//! The browser sends the person through Google's OpenID Connect redirect
//! (`response_type=id_token`, with a random nonce it keeps in `sessionStorage`)
//! and posts the returned ID token and nonce to `POST /session/google`. The
//! relay verifies the token with the same verifier the account sign-in uses,
//! finds the Colony account for the verified email, and only when that account's
//! public key is listed in `RELAY_OPERATOR_PUBKEYS` sets a signed, expiring,
//! `HttpOnly` session cookie. Nothing else about the account is returned and
//! no account is ever created here.
//!
//! The cookie is a stateless token: `v1.<payload>.<mac>` where the MAC is an
//! HMAC-SHA256 over the payload keyed from the deployment account key
//! (`COLONY_ACCOUNT_KEK`). Every request re-checks that the key is still in
//! `RELAY_OPERATOR_PUBKEYS`, so removing a key ends its sessions at once. Writes
//! made with the cookie also need the `X-Colony-Admin` header (a header only
//! same-origin script can add) on top of `SameSite=Strict` and the existing
//! Origin check. NIP-98 stays available as the operator fallback.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;

use super::auth::{is_admin_host, origin_matches_host, AdminPrincipal, AdminRole, AdminSource};
use super::error::ApiError;

/// Session cookie name. The `__Host-` prefix makes browsers insist on `Secure`,
/// `Path=/` and no `Domain`, so the cookie cannot be set from a sibling host.
pub(super) const COOKIE_NAME: &str = "__Host-colony_admin";

/// How long a sign-in lasts.
pub(super) const SESSION_SECS: u64 = 8 * 60 * 60;

/// Header a cookie-authenticated write must carry.
pub(super) const CSRF_HEADER: &str = "x-colony-admin";

const KEY_LABEL: &[u8] = b"colony-admin-session-v1";
const MIN_NONCE_LEN: usize = 16;
const MAX_NONCE_LEN: usize = 200;

pub(super) fn routes() -> Router<Arc<crate::state::AppState>> {
    Router::new()
        .route("/session/google", post(google_session))
        .route("/session/logout", post(logout))
}

#[derive(Serialize, Deserialize)]
struct Claims {
    /// Operator public key, lowercase hex.
    pk: String,
    iat: u64,
    exp: u64,
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn mac_for(key: &[u8; 32]) -> Result<Hmac<Sha256>, ApiError> {
    <Hmac<Sha256> as hmac::digest::KeyInit>::new_from_slice(key).map_err(|_| ApiError::internal())
}

/// Derive the session signing key from the deployment account key.
pub(super) fn session_key(kek: &[u8; 32]) -> Result<[u8; 32], ApiError> {
    let mut mac = mac_for(kek)?;
    mac.update(KEY_LABEL);
    let digest = mac.finalize().into_bytes();
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    Ok(key)
}

/// Sign a session for `pubkey_hex` valid from `now`.
pub(super) fn mint_token(key: &[u8; 32], pubkey_hex: &str, now: u64) -> Result<String, ApiError> {
    let claims = Claims {
        pk: pubkey_hex.to_owned(),
        iat: now,
        exp: now.saturating_add(SESSION_SECS),
    };
    let payload = B64.encode(serde_json::to_vec(&claims).map_err(|_| ApiError::internal())?);
    let mut mac = mac_for(key)?;
    mac.update(payload.as_bytes());
    let tag = B64.encode(mac.finalize().into_bytes());
    Ok(format!("v1.{payload}.{tag}"))
}

/// The public key a token names, when its MAC is valid and it has not expired.
pub(super) fn verify_token(key: &[u8; 32], token: &str, now: u64) -> Option<String> {
    let mut parts = token.split('.');
    let (Some("v1"), Some(payload), Some(tag), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return None;
    };
    let tag = B64.decode(tag).ok()?;
    let mut mac = mac_for(key).ok()?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&tag).ok()?;
    let claims: Claims = serde_json::from_slice(&B64.decode(payload).ok()?).ok()?;
    (claims.exp > now && claims.iat <= now.saturating_add(60)).then_some(claims.pk)
}

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    let prefix = format!("{COOKIE_NAME}=");
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .map(str::trim)
        .find_map(|pair| pair.strip_prefix(prefix.as_str()).map(str::to_owned))
}

fn is_listed_operator(state: &crate::state::AppState, pubkey_hex: &str) -> bool {
    state
        .config
        .relay_operator_pubkeys
        .iter()
        .any(|listed| listed.eq_ignore_ascii_case(pubkey_hex))
}

/// The operator a valid session cookie names, for [`super::auth::authorize`].
///
/// `Ok(None)` means "no cookie session here": the request carries an
/// `Authorization` header, or no cookie, or the cookie is invalid, expired or
/// names a key that is no longer listed, and NIP-98 is tried next. A valid
/// session making a write without the CSRF header is refused outright.
pub(super) fn principal_from_cookie(
    state: &crate::state::AppState,
    headers: &HeaderMap,
    method: &str,
) -> Result<Option<AdminPrincipal>, ApiError> {
    if headers.contains_key(header::AUTHORIZATION) {
        return Ok(None);
    }
    let Some(kek) = state.config.accounts.account_kek() else {
        return Ok(None);
    };
    let Some(token) = cookie_token(headers) else {
        return Ok(None);
    };
    let key = session_key(kek)?;
    let Some(pubkey_hex) = verify_token(&key, &token, unix_now()) else {
        return Ok(None);
    };
    if !is_listed_operator(state, &pubkey_hex) {
        return Ok(None);
    }
    let Some(pubkey) = hex::decode(&pubkey_hex)
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
    else {
        return Ok(None);
    };
    if method != "GET" && method != "HEAD" && !headers.contains_key(CSRF_HEADER) {
        return Err(ApiError::forbidden_with_message(
            "writes with a Colony sign-in need the X-Colony-Admin header",
        ));
    }
    Ok(Some(AdminPrincipal {
        pubkey,
        role: AdminRole::Operator,
        source: AdminSource::Config,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoogleSessionRequest {
    id_token: String,
    nonce: String,
}

/// Browser sign-in posts come from the admin page itself: right host, and an
/// `Origin` that is exactly the admin origin.
fn require_admin_page(state: &crate::state::AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let config = state
        .config
        .admin
        .as_ref()
        .ok_or_else(ApiError::not_found)?;
    let origin_ok = headers
        .get(header::ORIGIN)
        .and_then(|origin| origin.to_str().ok())
        .is_some_and(|origin| origin_matches_host(origin, &config.host));
    if is_admin_host(state, headers) && origin_ok {
        Ok(())
    } else {
        Err(ApiError::forbidden())
    }
}

fn cookie_header(value: &str, max_age: u64) -> Result<HeaderValue, ApiError> {
    HeaderValue::from_str(&format!(
        "{COOKIE_NAME}={value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={max_age}"
    ))
    .map_err(|_| ApiError::internal())
}

/// `POST /session/google`: exchange a Google ID token for an operator session.
async fn google_session(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
    Json(body): Json<GoogleSessionRequest>,
) -> Result<Response, ApiError> {
    require_admin_page(&state, &headers)?;
    let Some(kek) = state.config.accounts.account_kek() else {
        return Err(ApiError::forbidden_with_message(
            "Colony account sign-in is not set up on this deployment",
        ));
    };
    if state.config.accounts.google_client_ids().is_empty()
        || !(MIN_NONCE_LEN..=MAX_NONCE_LEN).contains(&body.nonce.len())
    {
        return Err(ApiError::unauthorized());
    }
    let identity = state
        .account_services
        .google_verifier
        .verify(&body.id_token, state.config.accounts.google_client_ids())
        .await
        .map_err(|_| ApiError::unauthorized())?;
    if identity.nonce.as_deref() != Some(body.nonce.as_str()) {
        return Err(ApiError::unauthorized());
    }
    // One answer for "no such account" and "not an operator", so the page
    // cannot be used to learn who has a Colony account.
    let account = state
        .db
        .account_by_email(&identity.email)
        .await?
        .filter(|account| account.email_verified_at.is_some())
        .filter(|account| is_listed_operator(&state, &account.pubkey))
        .ok_or_else(ApiError::forbidden)?;
    let token = mint_token(
        &session_key(kek)?,
        &account.pubkey.to_lowercase(),
        unix_now(),
    )?;
    let short: String = account.pubkey.chars().take(8).collect();
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

/// `POST /session/logout`: clear the cookie.
async fn logout(
    State(state): State<Arc<crate::state::AppState>>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    require_admin_page(&state, &headers)?;
    if !headers.contains_key(CSRF_HEADER) {
        return Err(ApiError::forbidden());
    }
    let mut response = (StatusCode::OK, Json(json!({ "status": "signed_out" }))).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie_header("", 0)?);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000;
    const PK: &str = "ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34";

    fn key(seed: u8) -> [u8; 32] {
        session_key(&[seed; 32]).expect("key")
    }

    #[test]
    fn a_fresh_token_names_its_operator() {
        let token = mint_token(&key(1), PK, NOW).expect("mint");
        assert_eq!(verify_token(&key(1), &token, NOW + 60).as_deref(), Some(PK));
    }

    #[test]
    fn a_token_expires_after_eight_hours() {
        let token = mint_token(&key(1), PK, NOW).expect("mint");
        assert!(verify_token(&key(1), &token, NOW + SESSION_SECS - 1).is_some());
        assert!(verify_token(&key(1), &token, NOW + SESSION_SECS).is_none());
    }

    #[test]
    fn a_token_from_another_deployment_key_is_refused() {
        let token = mint_token(&key(1), PK, NOW).expect("mint");
        assert!(verify_token(&key(2), &token, NOW).is_none());
    }

    #[test]
    fn a_tampered_or_malformed_token_is_refused() {
        let token = mint_token(&key(1), PK, NOW).expect("mint");
        let mut parts: Vec<&str> = token.split('.').collect();
        // Swap in a payload naming someone else, keeping the original MAC.
        let forged = B64.encode(
            serde_json::to_vec(&Claims {
                pk: "00".repeat(32),
                iat: NOW,
                exp: NOW + SESSION_SECS,
            })
            .expect("claims"),
        );
        parts[1] = &forged;
        assert!(verify_token(&key(1), &parts.join("."), NOW).is_none());
        for bad in ["", "v1", "v1.a", "v2.a.b", "v1.a.b.c", "not a token"] {
            assert!(verify_token(&key(1), bad, NOW).is_none(), "{bad}");
        }
    }

    #[test]
    fn a_token_dated_in_the_future_is_refused() {
        let token = mint_token(&key(1), PK, NOW + 3600).expect("mint");
        assert!(verify_token(&key(1), &token, NOW).is_none());
    }

    #[test]
    fn the_cookie_is_found_among_others() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("a=1; __Host-colony_admin=tok.en.x; b=2"),
        );
        assert_eq!(cookie_token(&headers).as_deref(), Some("tok.en.x"));
        let mut other = HeaderMap::new();
        other.insert(
            header::COOKIE,
            HeaderValue::from_static("x__Host-colony_admin=nope"),
        );
        assert!(cookie_token(&other).is_none());
    }

    #[test]
    fn the_cookie_cannot_be_read_from_a_sibling_host_or_script() {
        let value = cookie_header("tok", SESSION_SECS).expect("header");
        let text = value.to_str().expect("text");
        for required in ["__Host-", "Secure", "HttpOnly", "SameSite=Strict", "Path=/"] {
            assert!(text.contains(required), "{required}");
        }
        assert!(!text.contains("Domain"));
    }
}
