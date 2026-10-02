//! Google OpenID Connect ID-token verification with cache-aware JWKS loading.

use std::sync::Arc;
use std::time::{Duration, Instant};

use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;
use tokio::sync::Mutex;

const GOOGLE_JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const MAX_JWKS_BYTES: usize = 1024 * 1024;
const MAX_ID_TOKEN_BYTES: usize = 16 * 1024;
const JWT_CLOCK_LEEWAY_SECS: u64 = 30;

/// Verification failures are safe to map to a generic account error.
#[derive(Debug, Error)]
pub enum GoogleTokenError {
    /// The ID token did not satisfy signature, issuer, expiry, email, or audience checks.
    #[error("invalid Google ID token")]
    Invalid,
    /// Google's JWKS endpoint could not be reached or parsed.
    #[error("Google verification keys unavailable")]
    Unavailable,
}

/// Verified identity claims needed to create or link one account.
pub struct VerifiedGoogleIdentity {
    /// Google OIDC subject, the provider's stable identity key.
    pub sub: String,
    /// Normalized and verified email address.
    pub email: String,
}

struct CachedKeys {
    keys: Arc<JwkSet>,
    expires_at: Instant,
}

/// Verifies Google-signed OIDC ID tokens against a bounded JWKS cache.
pub struct GoogleIdTokenVerifier {
    client: reqwest::Client,
    jwks_url: String,
    cache: Mutex<Option<CachedKeys>>,
}

impl GoogleIdTokenVerifier {
    /// Create the Google verifier used by production requests.
    pub fn google_default() -> Self {
        Self::new(GOOGLE_JWKS_URL)
    }

    /// Create a verifier for an explicit JWKS endpoint, also used by local tests.
    pub fn new(jwks_url: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            jwks_url: jwks_url.into(),
            cache: Mutex::new(None),
        }
    }

    /// Verify signature and the OIDC claims required by the account contract.
    pub async fn verify(
        &self,
        id_token: &str,
        client_ids: &[String],
    ) -> Result<VerifiedGoogleIdentity, GoogleTokenError> {
        if id_token.is_empty() || id_token.len() > MAX_ID_TOKEN_BYTES || client_ids.is_empty() {
            return Err(GoogleTokenError::Invalid);
        }
        let header = decode_header(id_token).map_err(|_| GoogleTokenError::Invalid)?;
        if header.alg != Algorithm::RS256 {
            return Err(GoogleTokenError::Invalid);
        }
        let kid = header.kid.as_deref().ok_or(GoogleTokenError::Invalid)?;

        let mut keys = self.get_keys(false).await?;
        let mut jwk = keys.find(kid);
        if jwk.is_none() {
            keys = self.get_keys(true).await?;
            jwk = keys.find(kid);
        }
        let jwk = jwk.ok_or(GoogleTokenError::Invalid)?;
        let decoding_key = DecodingKey::from_jwk(jwk).map_err(|_| GoogleTokenError::Invalid)?;
        let audience_refs: Vec<&str> = client_ids.iter().map(String::as_str).collect();
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&audience_refs);
        validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
        validation.leeway = JWT_CLOCK_LEEWAY_SECS;
        validation.validate_exp = true;
        let claims = decode::<GoogleClaims>(id_token, &decoding_key, &validation)
            .map_err(|_| GoogleTokenError::Invalid)?
            .claims;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| GoogleTokenError::Unavailable)?
            .as_secs();
        if claims.exp.saturating_add(JWT_CLOCK_LEEWAY_SECS) < now {
            return Err(GoogleTokenError::Invalid);
        }

        let audience_matches = match &claims.aud {
            Value::String(aud) => client_ids.iter().any(|expected| expected == aud),
            Value::Array(audiences) => audiences.iter().any(|aud| {
                aud.as_str()
                    .is_some_and(|aud| client_ids.iter().any(|expected| expected == aud))
            }),
            _ => false,
        };
        if !audience_matches
            || !matches!(
                claims.iss.as_str(),
                "https://accounts.google.com" | "accounts.google.com"
            )
            || !claims.email_verified
            || claims.sub.is_empty()
            || claims.sub.len() > 255
        {
            return Err(GoogleTokenError::Invalid);
        }
        let email = normalize_email(&claims.email).ok_or(GoogleTokenError::Invalid)?;
        Ok(VerifiedGoogleIdentity {
            sub: claims.sub,
            email,
        })
    }

    async fn get_keys(&self, force: bool) -> Result<Arc<JwkSet>, GoogleTokenError> {
        let mut cache = self.cache.lock().await;
        if !force {
            if let Some(cached) = cache.as_ref() {
                if Instant::now() < cached.expires_at {
                    return Ok(Arc::clone(&cached.keys));
                }
            }
        }

        let response = self
            .client
            .get(&self.jwks_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|_| GoogleTokenError::Unavailable)?;
        if !response.status().is_success() {
            return Err(GoogleTokenError::Unavailable);
        }
        let ttl = cache_ttl(response.headers());
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| GoogleTokenError::Unavailable)?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_JWKS_BYTES {
                return Err(GoogleTokenError::Unavailable);
            }
            bytes.extend_from_slice(&chunk);
        }
        let keys: JwkSet =
            serde_json::from_slice(&bytes).map_err(|_| GoogleTokenError::Unavailable)?;
        if keys.keys.is_empty() || keys.keys.len() > 64 {
            return Err(GoogleTokenError::Unavailable);
        }
        let keys = Arc::new(keys);
        if ttl.is_zero() {
            *cache = None;
        } else {
            *cache = Some(CachedKeys {
                keys: Arc::clone(&keys),
                expires_at: Instant::now() + ttl,
            });
        }
        Ok(keys)
    }
}

#[derive(Deserialize)]
struct GoogleClaims {
    iss: String,
    aud: Value,
    sub: String,
    exp: u64,
    email: String,
    email_verified: bool,
}

fn cache_ttl(headers: &reqwest::header::HeaderMap) -> Duration {
    let Some(value) = headers
        .get(reqwest::header::CACHE_CONTROL)
        .and_then(|header| header.to_str().ok())
    else {
        return Duration::from_secs(300);
    };
    let mut max_age_secs = None;
    for directive in value.split(',').map(str::trim) {
        let (name, directive_value) = directive
            .split_once('=')
            .map_or((directive, None), |(name, value)| {
                (name.trim(), Some(value.trim()))
            });
        if name.eq_ignore_ascii_case("no-cache") || name.eq_ignore_ascii_case("no-store") {
            return Duration::ZERO;
        }
        if name.eq_ignore_ascii_case("max-age") {
            if let Some(seconds) =
                directive_value.and_then(|value| value.trim_matches('"').parse::<u64>().ok())
            {
                max_age_secs =
                    Some(max_age_secs.map_or(seconds, |previous: u64| previous.min(seconds)));
            }
        }
    }
    Duration::from_secs(max_age_secs.unwrap_or(300).min(24 * 60 * 60))
}

fn normalize_email(email: &str) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_control_honors_max_age_and_no_store() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::CACHE_CONTROL,
            reqwest::header::HeaderValue::from_static("public, max-age=120"),
        );
        assert_eq!(cache_ttl(&headers), Duration::from_secs(120));
        headers.insert(
            reqwest::header::CACHE_CONTROL,
            reqwest::header::HeaderValue::from_static("max-age=120, no-store"),
        );
        assert_eq!(cache_ttl(&headers), Duration::ZERO);
        headers.insert(
            reqwest::header::CACHE_CONTROL,
            reqwest::header::HeaderValue::from_static("MAX-AGE=86400, public"),
        );
        assert_eq!(cache_ttl(&headers), Duration::from_secs(24 * 60 * 60));
    }

    #[test]
    fn email_is_normalized_without_removing_plus_addresses() {
        assert_eq!(
            normalize_email(" Founder+ops@Example.COM "),
            Some("founder+ops@example.com".to_owned())
        );
        assert_eq!(normalize_email("no-at-sign"), None);
        assert_eq!(normalize_email("name @example.com"), None);
    }
}
