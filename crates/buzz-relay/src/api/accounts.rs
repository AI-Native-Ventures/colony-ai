//! Email, password, Google, and key-custody account endpoints.

mod crypto;
mod google;
mod mail;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::config::{AccountConfig, AccountMailMode, Config};
use crate::state::AppState;
use buzz_db::accounts::{
    AccountCodePurpose, AccountRecord, CheckAccountCodeOutcome, ConsumeAccountCodeOutcome,
    CreateAccountOutcome, IssueAccountCodeOutcome, NewAccount, NewAccountCode,
};
use buzz_pubsub::EventTopic;

use super::{api_error, bridge};

const ACCOUNT_BODY_LIMIT: usize = 16 * 1024;
const IP_RATE_LIMIT: i64 = 60;
const EMAIL_RATE_LIMIT: i64 = 10;
const RATE_LIMIT_WINDOW_SECS: i64 = 60;
const ACCOUNT_CODE_RESEND_COOLDOWN_SECS: i64 = 30;
const MAIL_BATCH_SIZE: i64 = 16;

/// Shared account clients. The verifier owns an in-memory cache of Google keys.
pub struct AccountServices {
    pub(crate) google_verifier: google::GoogleIdTokenVerifier,
    pub(crate) http_client: reqwest::Client,
}

impl AccountServices {
    /// Construct account clients for the relay process.
    pub fn new() -> Self {
        Self::with_google_verifier(google::GoogleIdTokenVerifier::google_default())
    }

    /// Construct account clients from the validated relay account settings.
    pub(crate) fn from_config(config: &AccountConfig) -> Self {
        let verifier = match config.google_jwks_url() {
            Some(jwks_url) => google::GoogleIdTokenVerifier::new(jwks_url),
            None => google::GoogleIdTokenVerifier::google_default(),
        };
        Self::with_google_verifier(verifier)
    }

    fn with_google_verifier(google_verifier: google::GoogleIdTokenVerifier) -> Self {
        Self {
            google_verifier,
            http_client: reqwest::Client::new(),
        }
    }
}

impl Default for AccountServices {
    fn default() -> Self {
        Self::new()
    }
}

/// Build the account HTTP routes with bounded request bodies and IP limits.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/signup", post(signup))
        .route("/verify", post(verify_email))
        .route("/resend-code", post(resend_code))
        .route("/signin", post(signin))
        .route("/google", post(google_signin))
        .route("/reset/request", post(reset_request))
        .route("/reset/check", post(reset_check))
        .route("/reset/confirm", post(reset_confirm))
        .route("/claim", post(claim))
        .route("/password", post(set_password))
        .route("/me", get(me).delete(delete_me))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ip_rate_limit_middleware,
        ))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            ACCOUNT_BODY_LIMIT,
        ))
        .with_state(state)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SignupRequest {
    email: String,
    password: SecretString,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VerifyRequest {
    email: String,
    code: SecretString,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResendRequest {
    email: String,
    purpose: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SigninRequest {
    email: String,
    password: SecretString,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GoogleRequest {
    id_token: SecretString,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResetRequest {
    email: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResetConfirmRequest {
    email: String,
    code: SecretString,
    new_password: SecretString,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResetCheckRequest {
    email: String,
    code: SecretString,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClaimRequest {
    email: String,
    password: SecretString,
    nsec: SecretString,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordRequest {
    new_password: SecretString,
}

struct SecretString(Zeroizing<String>);

impl<'de> Deserialize<'de> for SecretString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let mut value = String::deserialize(deserializer)?;
        let secret = Zeroizing::new(std::mem::take(&mut value));
        value.zeroize();
        Ok(Self(secret))
    }
}

impl Serialize for SecretString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.0.as_str())
    }
}

impl SecretString {
    fn as_str(&self) -> &str {
        self.0.as_str()
    }

    fn into_inner(self) -> Zeroizing<String> {
        self.0
    }
}

#[derive(Serialize)]
struct SessionResponse {
    account: PublicAccount,
    nsec: SecretString,
}

#[derive(Serialize)]
struct PublicAccount {
    id: Uuid,
    email: String,
    pubkey: String,
    has_password: bool,
    google_linked: bool,
}

impl From<&AccountRecord> for PublicAccount {
    fn from(account: &AccountRecord) -> Self {
        Self {
            id: account.id,
            email: account.email.clone(),
            pubkey: account.pubkey.clone(),
            has_password: account.password_hash().is_some(),
            google_linked: account.google_linked,
        }
    }
}

fn json_error(status: StatusCode, code: &'static str) -> (StatusCode, Json<Value>) {
    api_error(status, code)
}

fn invalid_request() -> (StatusCode, Json<Value>) {
    json_error(StatusCode::BAD_REQUEST, "invalid_request")
}

fn invalid_credentials() -> (StatusCode, Json<Value>) {
    json_error(StatusCode::UNAUTHORIZED, "invalid_credentials")
}

fn account_unavailable() -> (StatusCode, Json<Value>) {
    json_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "account_service_unavailable",
    )
}

pub(super) fn normalize_email(email: &str) -> Option<String> {
    let email = email.trim().to_lowercase();
    let (local, domain) = email.split_once('@')?;
    if email.len() > 254
        || local.is_empty()
        || domain.is_empty()
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.starts_with('-')
        || domain.ends_with('-')
        || domain.contains('@')
        || email.chars().any(char::is_whitespace)
    {
        return None;
    }
    Some(email)
}

fn normalize_display_name(
    display_name: Option<String>,
) -> Result<Option<String>, (StatusCode, Json<Value>)> {
    let Some(display_name) = display_name else {
        return Ok(None);
    };
    let display_name = display_name.trim().to_owned();
    if display_name.is_empty() {
        return Ok(None);
    }
    if display_name.chars().count() > 80 || display_name.chars().any(char::is_control) {
        return Err(invalid_request());
    }
    Ok(Some(display_name))
}

async fn tenant_from_headers(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<buzz_core::TenantContext, (StatusCode, Json<Value>)> {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "not_found"))
}

fn decode_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, (StatusCode, Json<Value>)> {
    serde_json::from_slice(body).map_err(|_| invalid_request())
}

fn account_kek(config: &Config) -> Result<&[u8; 32], (StatusCode, Json<Value>)> {
    config
        .accounts
        .account_kek()
        .ok_or_else(account_unavailable)
}

fn new_code(
    kek: &[u8; 32],
    purpose: AccountCodePurpose,
) -> Result<(Zeroizing<String>, NewAccountCode), (StatusCode, Json<Value>)> {
    let clear_code = crypto::generate_code();
    let code_id = Uuid::new_v4();
    let outbox_id = Uuid::new_v4();
    let code_hash = crypto::hash_code(kek, &clear_code).map_err(|_| account_unavailable())?;
    let (code_ciphertext, nonce) =
        crypto::seal_mail_code(kek, outbox_id, &clear_code).map_err(|_| account_unavailable())?;
    Ok((
        clear_code,
        NewAccountCode {
            code_id,
            outbox_id,
            code_hash,
            code_ciphertext,
            nonce: nonce.to_vec(),
            purpose,
        },
    ))
}

fn new_account(
    config: &Config,
    email: String,
    password_hash: Option<String>,
    nsec: &str,
    email_verified: bool,
) -> Result<NewAccount, (StatusCode, Json<Value>)> {
    let kek = account_kek(config)?;
    let pubkey = crypto::pubkey_from_nsec(nsec).map_err(|_| invalid_request())?;
    let envelope = crypto::seal_nsec(kek, &pubkey, nsec).map_err(|_| account_unavailable())?;
    Ok(NewAccount {
        email,
        pubkey,
        password_hash,
        wrapped_dek: envelope.wrapped_dek,
        kek_id: envelope.kek_id,
        sealed_nsec: envelope.sealed_nsec,
        nonce: envelope.nonce.to_vec(),
        email_verified,
    })
}

fn session(
    config: &Config,
    account: &AccountRecord,
) -> Result<Json<SessionResponse>, (StatusCode, Json<Value>)> {
    let nsec = crypto::open_nsec(
        account_kek(config)?,
        &account.pubkey,
        account.kek_id(),
        account.wrapped_dek(),
        account.sealed_nsec(),
        account.nonce(),
    )
    .map_err(|_| account_unavailable())?;
    Ok(Json(SessionResponse {
        account: PublicAccount::from(account),
        nsec: SecretString(nsec),
    }))
}

async fn ip_rate_limit_middleware(
    State(state): State<Arc<AppState>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip().to_string())
        .unwrap_or_else(|| "unknown".to_owned());
    let route = request.uri().path();
    if let Err(response) = check_rate_limit(&state, "ip", route, &peer_ip, IP_RATE_LIMIT).await {
        return response.into_response();
    }
    let host = request
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if crate::tenant::bind_community(&state.db, host)
        .await
        .is_err()
    {
        return api_error(StatusCode::NOT_FOUND, "not_found").into_response();
    }
    next.run(request).await
}

async fn email_rate_limit(
    state: &AppState,
    route: &str,
    email: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    check_rate_limit(state, "email", route, email, EMAIL_RATE_LIMIT).await
}

async fn check_rate_limit(
    state: &AppState,
    dimension: &str,
    route: &str,
    identifier: &str,
    limit: i64,
) -> Result<(), (StatusCode, Json<Value>)> {
    const SCRIPT: &str = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('TTL',KEYS[1])}";
    let mut hasher = Sha256::new();
    hasher.update(dimension.as_bytes());
    hasher.update(b"\0");
    hasher.update(identifier.as_bytes());
    let digest = hex::encode(hasher.finalize());
    let key = format!("colony:account-rate:{route}:{digest}");
    let mut connection = state
        .redis_pool
        .get()
        .await
        .map_err(|_| account_unavailable())?;
    let counts: (i64, i64) = redis::cmd("EVAL")
        .arg(SCRIPT)
        .arg(1)
        .arg(key)
        .arg(RATE_LIMIT_WINDOW_SECS)
        .query_async(&mut *connection)
        .await
        .map_err(|_| account_unavailable())?;
    if counts.0 > limit {
        let retry_after_secs = counts.1.max(1);
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": "rate_limited",
                "retry_after_secs": retry_after_secs,
            })),
        ));
    }
    Ok(())
}

/// `POST /api/accounts/signup` creates an unverified account and queues mail.
async fn signup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let request: SignupRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/signup", &email).await?;
    ensure_mail_enabled(&state)?;
    let display_name = normalize_display_name(request.display_name)?;
    let password = request.password.into_inner();
    crypto::validate_password(&password).map_err(|error| match error {
        crypto::PasswordValidationError::Weak => {
            json_error(StatusCode::UNPROCESSABLE_ENTITY, "weak_password")
        }
        crypto::PasswordValidationError::TooLong => invalid_request(),
    })?;
    let password_hash = crypto::hash_password(password)
        .await
        .map_err(|_| account_unavailable())?;
    let kek = account_kek(&state.config)?;
    let (nsec_pubkey, nsec) =
        crypto::generate_nostr_identity().map_err(|_| account_unavailable())?;
    let new_account = new_account(
        &state.config,
        email.clone(),
        Some(password_hash),
        &nsec,
        false,
    )?;
    if new_account.pubkey != nsec_pubkey {
        return Err(account_unavailable());
    }
    let tenant = tenant_from_headers(&state, &headers).await?;
    let profile_content = match display_name {
        Some(display_name) => serde_json::json!({ "display_name": display_name }).to_string(),
        None => "{}".to_owned(),
    };
    let identity_keys = nostr::Keys::parse(nsec.as_str()).map_err(|_| account_unavailable())?;
    let profile_event = nostr::EventBuilder::new(nostr::Kind::Metadata, profile_content)
        .sign_with_keys(&identity_keys)
        .map_err(|_| account_unavailable())?;
    let (clear_code, code) = new_code(kek, AccountCodePurpose::VerifyEmail)?;
    if state
        .db
        .account_by_email(&email)
        .await
        .map_err(|error| map_db_error("signup", error))?
        .is_some()
    {
        return Err(json_error(StatusCode::CONFLICT, "email_taken"));
    }
    let cooldown =
        match reserve_code_cooldown(&state, &email, AccountCodePurpose::VerifyEmail).await? {
            CodeCooldownReservation::Acquired(lease) => lease,
            CodeCooldownReservation::Active { retry_after_secs } => {
                return Err(resend_cooldown(retry_after_secs));
            }
        };
    match state
        .db
        .create_account_with_profile(
            &new_account,
            Some(&code),
            Some((&profile_event, tenant.community())),
        )
        .await
    {
        Ok(CreateAccountOutcome::Created(_)) => {}
        Ok(CreateAccountOutcome::EmailTaken) => {
            release_code_cooldown(&state, &cooldown).await?;
            return Err(json_error(StatusCode::CONFLICT, "email_taken"));
        }
        Ok(CreateAccountOutcome::IdentityTaken) => {
            release_code_cooldown(&state, &cooldown).await?;
            return Err(json_error(StatusCode::CONFLICT, "identity_taken"));
        }
        Err(error) => {
            release_code_cooldown(&state, &cooldown).await?;
            return Err(map_db_error("signup", error));
        }
    }
    if let Err(error) = state
        .pubsub
        .publish_event(&tenant, EventTopic::Global, &profile_event)
        .await
    {
        tracing::warn!(
            event_id = %profile_event.id,
            error = %error,
            "account profile is stored and will be available to event queries"
        );
    }
    drop(clear_code);
    Ok(verification_sent(ACCOUNT_CODE_RESEND_COOLDOWN_SECS))
}

/// `POST /api/accounts/verify` consumes a code and returns the account session.
async fn verify_email(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Json<SessionResponse>, (StatusCode, Json<Value>)> {
    let request: VerifyRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/verify", &email).await?;
    let code = request.code.into_inner();
    if !valid_code(&code) {
        return Err(code_expired());
    }
    let code_hash =
        crypto::hash_code(account_kek(&state.config)?, &code).map_err(|_| account_unavailable())?;
    let outcome = state
        .db
        .consume_account_code(&email, AccountCodePurpose::VerifyEmail, &code_hash, None)
        .await
        .map_err(|error| map_db_error("verify", error))?;
    match outcome {
        ConsumeAccountCodeOutcome::Accepted(account) => session(&state.config, &account),
        ConsumeAccountCodeOutcome::Invalid { attempts_left } => Err(wrong_code(attempts_left)),
        ConsumeAccountCodeOutcome::Expired => Err(code_expired()),
        ConsumeAccountCodeOutcome::AttemptsExceeded { retry_after_secs } => {
            Err(too_many_attempts(retry_after_secs))
        }
    }
}

/// `POST /api/accounts/resend-code` always returns the same response.
async fn resend_code(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let request: ResendRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/resend-code", &email).await?;
    ensure_mail_enabled(&state)?;
    let purpose = match request.purpose.as_str() {
        "verify" => AccountCodePurpose::VerifyEmail,
        "reset" => AccountCodePurpose::ResetPassword,
        _ => return Err(invalid_request()),
    };
    if let Some(retry_after_secs) = state
        .db
        .account_code_lockout_remaining(&email, purpose)
        .await
        .map_err(|error| map_db_error("resend", error))?
    {
        return Err(too_many_attempts(retry_after_secs));
    }
    let cooldown = match reserve_code_cooldown(&state, &email, purpose).await? {
        CodeCooldownReservation::Acquired(lease) => lease,
        CodeCooldownReservation::Active { retry_after_secs } => {
            return Err(resend_cooldown(retry_after_secs));
        }
    };
    let account = match state.db.account_by_email(&email).await {
        Ok(account) => account,
        Err(error) => {
            release_code_cooldown(&state, &cooldown).await?;
            return Err(map_db_error("resend", error));
        }
    };
    if let Some(account) = account {
        let eligible = match purpose {
            AccountCodePurpose::VerifyEmail => account.email_verified_at.is_none(),
            AccountCodePurpose::ResetPassword => true,
        };
        if eligible {
            match queue_code(&state, &account, purpose).await {
                Ok(None) => {}
                Ok(Some(retry_after_secs)) => {
                    release_code_cooldown(&state, &cooldown).await?;
                    return Err(too_many_attempts(retry_after_secs));
                }
                Err(error) => {
                    release_code_cooldown(&state, &cooldown).await?;
                    return Err(error);
                }
            }
        }
    }
    Ok(verification_sent(ACCOUNT_CODE_RESEND_COOLDOWN_SECS))
}

/// `POST /api/accounts/signin` verifies an email and password.
async fn signin(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Json<SessionResponse>, (StatusCode, Json<Value>)> {
    let request: SigninRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/signin", &email).await?;
    let Some(account) = state
        .db
        .account_by_email(&email)
        .await
        .map_err(|error| map_db_error("signin", error))?
    else {
        let _ = crypto::verify_password(request.password.into_inner(), None)
            .await
            .map_err(|_| account_unavailable())?;
        return Err(invalid_credentials());
    };
    if account.email_verified_at.is_none() {
        ensure_mail_enabled(&state)?;
        issue_code(&state, &account, AccountCodePurpose::VerifyEmail).await?;
        return Err(json_error(StatusCode::FORBIDDEN, "email_unverified"));
    }
    let correct = crypto::verify_password(
        request.password.into_inner(),
        account.password_hash().map(str::to_owned),
    )
    .await
    .map_err(|_| account_unavailable())?;
    if !correct {
        state
            .db
            .account_password_signin_failure(account.id)
            .await
            .map_err(|error| map_db_error("signin", error))?;
        return Err(invalid_credentials());
    }
    let account = state
        .db
        .account_password_signin_success(account.id)
        .await
        .map_err(|error| map_db_error("signin", error))?
        .ok_or_else(invalid_credentials)?;
    session(&state.config, &account)
}

/// `POST /api/accounts/google` verifies a Google ID token and creates or links.
async fn google_signin(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Json<SessionResponse>, (StatusCode, Json<Value>)> {
    let request: GoogleRequest = decode_body(&body)?;
    if state.config.accounts.google_client_ids().is_empty() {
        return Err(account_unavailable());
    }
    let identity = state
        .account_services
        .google_verifier
        .verify(
            request.id_token.as_str(),
            state.config.accounts.google_client_ids(),
        )
        .await
        .map_err(|error| match error {
            google::GoogleTokenError::Invalid => invalid_credentials(),
            google::GoogleTokenError::Unavailable => account_unavailable(),
        })?;
    email_rate_limit(&state, "/api/accounts/google", &identity.email).await?;
    let (pubkey, nsec) = crypto::generate_nostr_identity().map_err(|_| account_unavailable())?;
    let account = new_account(&state.config, identity.email.clone(), None, &nsec, true)?;
    if account.pubkey != pubkey {
        return Err(account_unavailable());
    }
    let account = state
        .db
        .account_google_signin(&identity.sub, &identity.email, &account)
        .await
        .map_err(|error| map_db_error("google_signin", error))?;
    session(&state.config, &account)
}

/// `POST /api/accounts/reset/request` always returns a generic 202 response.
async fn reset_request(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let request: ResetRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/reset/request", &email).await?;
    ensure_mail_enabled(&state)?;
    let purpose = AccountCodePurpose::ResetPassword;
    if state
        .db
        .account_code_lockout_remaining(&email, purpose)
        .await
        .map_err(|error| map_db_error("reset_request", error))?
        .is_some()
    {
        return Ok(verification_sent(ACCOUNT_CODE_RESEND_COOLDOWN_SECS));
    }
    match reserve_code_cooldown(&state, &email, purpose).await? {
        CodeCooldownReservation::Active { .. } => {}
        CodeCooldownReservation::Acquired(lease) => {
            let account = match state.db.account_by_email(&email).await {
                Ok(account) => account,
                Err(error) => {
                    release_code_cooldown(&state, &lease).await?;
                    return Err(map_db_error("reset_request", error));
                }
            };
            if let Some(account) = account {
                if let Err(error) = queue_code(&state, &account, purpose).await {
                    release_code_cooldown(&state, &lease).await?;
                    return Err(error);
                }
            }
        }
    }
    Ok(verification_sent(ACCOUNT_CODE_RESEND_COOLDOWN_SECS))
}

/// `POST /api/accounts/reset/check` validates a code without consuming it.
async fn reset_check(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let request: ResetCheckRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/reset/check", &email).await?;
    let code = request.code.into_inner();
    if !valid_code(&code) {
        return Err(code_expired());
    }
    let code_hash =
        crypto::hash_code(account_kek(&state.config)?, &code).map_err(|_| account_unavailable())?;
    let outcome = state
        .db
        .check_account_code(&email, AccountCodePurpose::ResetPassword, &code_hash)
        .await
        .map_err(|error| map_db_error("reset_check", error))?;
    match outcome {
        CheckAccountCodeOutcome::Valid => Ok(Json(serde_json::json!({ "status": "code_valid" }))),
        CheckAccountCodeOutcome::Invalid { attempts_left } => Err(wrong_code(attempts_left)),
        CheckAccountCodeOutcome::Expired => Err(code_expired()),
        CheckAccountCodeOutcome::AttemptsExceeded { retry_after_secs } => {
            Err(too_many_attempts(retry_after_secs))
        }
    }
}

/// `POST /api/accounts/reset/confirm` changes the password while preserving the key.
async fn reset_confirm(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> Result<Json<SessionResponse>, (StatusCode, Json<Value>)> {
    let request: ResetConfirmRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/reset/confirm", &email).await?;
    let password = request.new_password.into_inner();
    crypto::validate_password(&password).map_err(|error| match error {
        crypto::PasswordValidationError::Weak => {
            json_error(StatusCode::UNPROCESSABLE_ENTITY, "weak_password")
        }
        crypto::PasswordValidationError::TooLong => invalid_request(),
    })?;
    let password_hash = crypto::hash_password(password)
        .await
        .map_err(|_| account_unavailable())?;
    let code = request.code.into_inner();
    if !valid_code(&code) {
        return Err(code_expired());
    }
    let code_hash =
        crypto::hash_code(account_kek(&state.config)?, &code).map_err(|_| account_unavailable())?;
    let outcome = state
        .db
        .consume_account_code(
            &email,
            AccountCodePurpose::ResetPassword,
            &code_hash,
            Some(&password_hash),
        )
        .await
        .map_err(|error| map_db_error("reset_confirm", error))?;
    match outcome {
        ConsumeAccountCodeOutcome::Accepted(account) => session(&state.config, &account),
        ConsumeAccountCodeOutcome::Invalid { attempts_left } => Err(wrong_code(attempts_left)),
        ConsumeAccountCodeOutcome::Expired => Err(code_expired()),
        ConsumeAccountCodeOutcome::AttemptsExceeded { retry_after_secs } => {
            Err(too_many_attempts(retry_after_secs))
        }
    }
}

/// `POST /api/accounts/claim` attaches an existing Nostr identity to email login.
async fn claim(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let request: ClaimRequest = decode_body(&body)?;
    let email = normalize_email(&request.email).ok_or_else(invalid_request)?;
    email_rate_limit(&state, "/api/accounts/claim", &email).await?;
    ensure_mail_enabled(&state)?;
    let nsec = request.nsec.into_inner();
    let nsec_pubkey = crypto::pubkey_from_nsec(&nsec).map_err(|_| invalid_request())?;
    let signer = authenticate(
        &state,
        &headers,
        "POST",
        "/api/accounts/claim",
        Some(&body),
        true,
    )
    .await?;
    if signer.to_hex() != nsec_pubkey {
        return Err(invalid_credentials());
    }
    let password = request.password.into_inner();
    crypto::validate_password(&password).map_err(|error| match error {
        crypto::PasswordValidationError::Weak => {
            json_error(StatusCode::UNPROCESSABLE_ENTITY, "weak_password")
        }
        crypto::PasswordValidationError::TooLong => invalid_request(),
    })?;
    let password_hash = crypto::hash_password(password)
        .await
        .map_err(|_| account_unavailable())?;
    let (clear_code, code) =
        new_code(account_kek(&state.config)?, AccountCodePurpose::VerifyEmail)?;
    let account = new_account(
        &state.config,
        email.clone(),
        Some(password_hash),
        &nsec,
        false,
    )?;
    match state.db.create_account(&account, Some(&code)).await {
        Ok(CreateAccountOutcome::Created(_)) => {}
        Ok(CreateAccountOutcome::EmailTaken | CreateAccountOutcome::IdentityTaken) => {}
        Err(error) => return Err(map_db_error("claim", error)),
    }
    drop(clear_code);
    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "status": "verification_sent" })),
    ))
}

/// `POST /api/accounts/password` sets a password for the NIP-98 identity.
async fn set_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let request: PasswordRequest = decode_body(&body)?;
    let signer = authenticate(
        &state,
        &headers,
        "POST",
        "/api/accounts/password",
        Some(&body),
        true,
    )
    .await?;
    let pubkey = signer.to_hex();
    let Some(account) = state
        .db
        .account_by_pubkey(&pubkey)
        .await
        .map_err(|error| map_db_error("set_password", error))?
    else {
        return Err(invalid_credentials());
    };
    email_rate_limit(&state, "/api/accounts/password", &account.email).await?;
    let password = request.new_password.into_inner();
    crypto::validate_password(&password).map_err(|error| match error {
        crypto::PasswordValidationError::Weak => {
            json_error(StatusCode::UNPROCESSABLE_ENTITY, "weak_password")
        }
        crypto::PasswordValidationError::TooLong => invalid_request(),
    })?;
    let password_hash = crypto::hash_password(password)
        .await
        .map_err(|_| account_unavailable())?;
    if !state
        .db
        .account_set_password(&pubkey, &password_hash)
        .await
        .map_err(|error| map_db_error("set_password", error))?
    {
        return Err(invalid_credentials());
    }
    Ok(StatusCode::NO_CONTENT)
}

/// `GET /api/accounts/me` returns public account details for the signer.
async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<PublicAccount>, (StatusCode, Json<Value>)> {
    let signer = authenticate(&state, &headers, "GET", "/api/accounts/me", None, false).await?;
    let account = state
        .db
        .account_by_pubkey(&signer.to_hex())
        .await
        .map_err(|error| map_db_error("me", error))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "account_not_found"))?;
    email_rate_limit(&state, "/api/accounts/me", &account.email).await?;
    Ok(Json(PublicAccount::from(&account)))
}

/// `DELETE /api/accounts/me` deletes the signer's account and encrypted key.
async fn delete_me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, (StatusCode, Json<Value>)> {
    let signer = authenticate(&state, &headers, "DELETE", "/api/accounts/me", None, false).await?;
    let pubkey = signer.to_hex();
    let account = state
        .db
        .account_by_pubkey(&pubkey)
        .await
        .map_err(|error| map_db_error("delete", error))?
        .ok_or_else(invalid_credentials)?;
    email_rate_limit(&state, "/api/accounts/me", &account.email).await?;
    if state
        .db
        .delete_account(&pubkey)
        .await
        .map_err(|error| map_db_error("delete", error))?
    {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(invalid_credentials())
    }
}

async fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    require_payload: bool,
) -> Result<nostr::PublicKey, (StatusCode, Json<Value>)> {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, host)
        .await
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "not_found"))?;
    let url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, path);
    let auth = bridge::verify_bridge_auth_with_options(
        headers,
        method,
        &url,
        body,
        true,
        require_payload,
    )?;
    bridge::check_nip98_replay(state, &tenant, auth.event_id_bytes).await?;
    Ok(auth.pubkey)
}

fn valid_code(code: &str) -> bool {
    code.len() == 6 && code.bytes().all(|byte| byte.is_ascii_digit())
}

fn code_expired() -> (StatusCode, Json<Value>) {
    json_error(StatusCode::GONE, "code_expired")
}

fn wrong_code(attempts_left: i32) -> (StatusCode, Json<Value>) {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(serde_json::json!({
            "error": "wrong_code",
            "attempts_left": attempts_left,
        })),
    )
}

fn too_many_attempts(retry_after_secs: i64) -> (StatusCode, Json<Value>) {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "error": "too_many_attempts",
            "retry_after_secs": retry_after_secs.max(1),
        })),
    )
}

fn resend_cooldown(retry_after_secs: i64) -> (StatusCode, Json<Value>) {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "error": "resend_cooldown",
            "retry_after_secs": retry_after_secs.max(1),
        })),
    )
}

struct CodeCooldownLease {
    key: String,
    token: String,
}

enum CodeCooldownReservation {
    Acquired(CodeCooldownLease),
    Active { retry_after_secs: i64 },
}

fn code_purpose_key(purpose: AccountCodePurpose) -> &'static str {
    match purpose {
        AccountCodePurpose::VerifyEmail => "verify",
        AccountCodePurpose::ResetPassword => "reset",
    }
}

async fn reserve_code_cooldown(
    state: &AppState,
    email: &str,
    purpose: AccountCodePurpose,
) -> Result<CodeCooldownReservation, (StatusCode, Json<Value>)> {
    let mut hasher = Sha256::new();
    hasher.update(email.as_bytes());
    let digest = hex::encode(hasher.finalize());
    let key = format!(
        "colony:account-code-cooldown:{}:{digest}",
        code_purpose_key(purpose)
    );
    let token = Uuid::new_v4().to_string();
    let mut connection = state
        .redis_pool
        .get()
        .await
        .map_err(|_| account_unavailable())?;
    let acquired: Option<String> = redis::cmd("SET")
        .arg(&key)
        .arg(&token)
        .arg("NX")
        .arg("EX")
        .arg(ACCOUNT_CODE_RESEND_COOLDOWN_SECS)
        .query_async(&mut *connection)
        .await
        .map_err(|_| account_unavailable())?;
    if acquired.is_some() {
        return Ok(CodeCooldownReservation::Acquired(CodeCooldownLease {
            key,
            token,
        }));
    }
    let retry_after_secs: i64 = redis::cmd("TTL")
        .arg(&key)
        .query_async(&mut *connection)
        .await
        .map_err(|_| account_unavailable())?;
    Ok(CodeCooldownReservation::Active {
        retry_after_secs: retry_after_secs.max(1),
    })
}

async fn release_code_cooldown(
    state: &AppState,
    lease: &CodeCooldownLease,
) -> Result<(), (StatusCode, Json<Value>)> {
    const RELEASE_SCRIPT: &str =
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
    let mut connection = state
        .redis_pool
        .get()
        .await
        .map_err(|_| account_unavailable())?;
    let _: i64 = redis::cmd("EVAL")
        .arg(RELEASE_SCRIPT)
        .arg(1)
        .arg(&lease.key)
        .arg(&lease.token)
        .query_async(&mut *connection)
        .await
        .map_err(|_| account_unavailable())?;
    Ok(())
}

fn verification_sent(retry_after_secs: i64) -> (StatusCode, Json<Value>) {
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "status": "verification_sent",
            "retry_after_secs": retry_after_secs.max(1),
        })),
    )
}

fn ensure_mail_enabled(state: &AppState) -> Result<(), (StatusCode, Json<Value>)> {
    if state.config.accounts.mail_mode().is_some() {
        account_kek(&state.config).map(|_| ())
    } else {
        Err(account_unavailable())
    }
}

async fn issue_code(
    state: &AppState,
    account: &AccountRecord,
    purpose: AccountCodePurpose,
) -> Result<(), (StatusCode, Json<Value>)> {
    if state
        .db
        .account_code_lockout_remaining(&account.email, purpose)
        .await
        .map_err(|error| map_db_error("issue_code", error))?
        .is_some()
    {
        return Ok(());
    }
    let lease = match reserve_code_cooldown(state, &account.email, purpose).await? {
        CodeCooldownReservation::Acquired(lease) => lease,
        CodeCooldownReservation::Active { .. } => return Ok(()),
    };
    match queue_code(state, account, purpose).await {
        Ok(None) => {}
        Ok(Some(_)) => {}
        Err(error) => {
            release_code_cooldown(state, &lease).await?;
            return Err(error);
        }
    }
    Ok(())
}

async fn queue_code(
    state: &AppState,
    account: &AccountRecord,
    purpose: AccountCodePurpose,
) -> Result<Option<i64>, (StatusCode, Json<Value>)> {
    let (clear_code, code) = new_code(account_kek(&state.config)?, purpose)?;
    let outcome = state
        .db
        .issue_account_code(account.id, &account.email, &code)
        .await
        .map_err(|error| map_db_error("issue_code", error))?;
    let mut clear_code = clear_code;
    clear_code.zeroize();
    Ok(match outcome {
        IssueAccountCodeOutcome::Issued => None,
        IssueAccountCodeOutcome::Locked { retry_after_secs } => Some(retry_after_secs),
    })
}

fn map_db_error(operation: &'static str, error: buzz_db::DbError) -> (StatusCode, Json<Value>) {
    tracing::error!(operation, error = %error, "account database operation failed");
    account_unavailable()
}

/// Run the durable account email delivery worker until the relay shuts down.
pub async fn run_mail_outbox_worker(state: Arc<AppState>) {
    let mut idle_delay = Duration::from_millis(250);
    loop {
        let batch = match state.db.claim_account_mail_outbox(MAIL_BATCH_SIZE).await {
            Ok(rows) => rows,
            Err(_) => {
                tracing::error!("account mail outbox claim failed");
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            }
        };
        if batch.is_empty() {
            tokio::time::sleep(idle_delay).await;
            idle_delay = (idle_delay * 2).min(Duration::from_secs(10));
            continue;
        }
        idle_delay = Duration::from_millis(250);
        for message in batch {
            deliver_mail(&state, &message).await;
        }
    }
}

async fn deliver_mail(state: &AppState, message: &buzz_db::accounts::AccountMailOutboxRecord) {
    let Some(kek) = state.config.accounts.account_kek() else {
        retry_mail(state, message, "key_unavailable").await;
        return;
    };
    let code =
        match crypto::open_mail_code(kek, message.id, &message.code_ciphertext, &message.nonce) {
            Ok(code) => code,
            Err(_) => {
                retry_mail(state, message, "ciphertext_invalid").await;
                return;
            }
        };
    let delivered = match state.config.accounts.mail_mode() {
        Some(AccountMailMode::Log) => state
            .db
            .record_account_test_mail(
                message.id,
                message.account_id,
                &message.recipient,
                &message.purpose,
                &code,
            )
            .await
            .map_err(|_| "sink_write_failed"),
        Some(AccountMailMode::Resend) => mail::send_resend(
            &state.account_services.http_client,
            &state.config.accounts,
            &message.recipient,
            &message.purpose,
            &code,
        )
        .await
        .map_err(|_| "provider_unavailable"),
        None => Err("mail_unconfigured"),
    };
    if delivered.is_ok() {
        match state
            .db
            .complete_account_mail_outbox(message.id, message.claim_token)
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                tracing::warn!(outbox_id = %message.id, "account mail lease ownership lost")
            }
            Err(_) => tracing::error!(outbox_id = %message.id, "account mail completion failed"),
        }
    } else if let Err(error_code) = delivered {
        retry_mail(state, message, error_code).await;
    }
}

async fn retry_mail(
    state: &AppState,
    message: &buzz_db::accounts::AccountMailOutboxRecord,
    error_code: &'static str,
) {
    let backoff = 2_i64
        .saturating_pow(message.attempts.min(10) as u32)
        .min(1800);
    if state
        .db
        .retry_account_mail_outbox(
            message.id,
            message.claim_token,
            Utc::now() + ChronoDuration::seconds(backoff),
            error_code,
        )
        .await
        .is_err()
    {
        tracing::error!(outbox_id = %message.id, error_code, "account mail retry scheduling failed");
    }
}

#[cfg(test)]
mod postgres_tests;
