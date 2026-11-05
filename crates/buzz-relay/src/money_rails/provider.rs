//! The only door out to a payment provider's API.
//!
//! [`ProviderHttp`] is the seam: production uses [`ReqwestProvider`], tests swap in a fake that
//! replays recorded fixtures. Nothing else in the relay calls a payment provider. The real
//! client is https only, never follows a redirect (so the key is never sent to another host),
//! refuses hosts that resolve to non-public addresses, pins the connection to the address it
//! checked, caps the response and times out.

use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use zeroize::Zeroizing;

use buzz_core::money_rails::connection::AuthScheme;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// Largest provider response the relay keeps, in bytes.
pub const MAX_RESPONSE_BYTES: usize = 64 * 1024;

/// A request ready to send, with the credential the relay adds. Not `Debug`, so the key cannot
/// be printed.
pub struct ProviderRequest {
    /// Upper case method.
    pub method: String,
    /// Host the key is locked to.
    pub host: String,
    /// Path and query string.
    pub path_and_query: String,
    /// Headers, without authentication.
    pub headers: Vec<(String, String)>,
    /// Body, if any.
    pub body: Option<String>,
    /// How to authenticate, and the key.
    pub auth: Option<(AuthScheme, Zeroizing<String>)>,
}

/// A provider response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderResponse {
    /// HTTP status.
    pub status: u16,
    /// Body, at most [`MAX_RESPONSE_BYTES`].
    pub body: Vec<u8>,
}

/// Why a provider call produced no response. Messages never carry a key or a URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderError {
    /// The host resolved to a non-public address or not at all.
    HostRefused,
    /// The provider could not be reached.
    Unreachable,
    /// The provider did not answer in time.
    Timeout,
    /// The response was larger than the cap.
    TooLarge,
    /// The request could not be built.
    BadRequest,
}

impl ProviderError {
    /// Stable code for the card's failure.
    pub const fn code(self) -> &'static str {
        match self {
            Self::HostRefused => "host_not_allowed",
            Self::Unreachable | Self::Timeout => "provider_unreachable",
            Self::TooLarge => "provider_response",
            Self::BadRequest => "recipe_refused",
        }
    }

    /// Plain words for the owner.
    pub const fn reason(self) -> &'static str {
        match self {
            Self::HostRefused => "The provider host could not be reached safely.",
            Self::Unreachable => "The payment provider could not be reached.",
            Self::Timeout => "The payment provider did not answer in time.",
            Self::TooLarge => "The payment provider sent back more than Colony will read.",
            Self::BadRequest => "The request to the payment provider could not be built.",
        }
    }

    /// Whether trying again can help.
    pub const fn retryable(self) -> bool {
        matches!(self, Self::Unreachable | Self::Timeout)
    }
}

/// The seam to the provider.
#[async_trait]
pub trait ProviderHttp: Send + Sync {
    /// Send one request.
    async fn execute(&self, request: &ProviderRequest) -> Result<ProviderResponse, ProviderError>;
}

/// The production client.
#[derive(Clone, Default)]
pub struct ReqwestProvider;

impl ReqwestProvider {
    /// A new client.
    pub fn new() -> Self {
        Self
    }
}

fn public_address(addresses: impl Iterator<Item = SocketAddr>) -> Option<SocketAddr> {
    let mut chosen = None;
    for address in addresses {
        let ip: IpAddr = address.ip();
        if buzz_core::network::is_not_global_unicast(&ip) || buzz_core::network::is_private_ip(&ip)
        {
            // One private answer is enough to refuse: the name must be public everywhere.
            return None;
        }
        chosen.get_or_insert(address);
    }
    chosen
}

#[async_trait]
impl ProviderHttp for ReqwestProvider {
    async fn execute(&self, request: &ProviderRequest) -> Result<ProviderResponse, ProviderError> {
        if !buzz_core::money_rails::valid_host(&request.host) {
            return Err(ProviderError::HostRefused);
        }
        let resolved = tokio::net::lookup_host((request.host.as_str(), 443))
            .await
            .map_err(|_| ProviderError::HostRefused)?;
        let address = public_address(resolved).ok_or(ProviderError::HostRefused)?;
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .resolve(&request.host, address)
            .build()
            .map_err(|_| ProviderError::BadRequest)?;
        let url = format!("https://{}{}", request.host, request.path_and_query);
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|_| ProviderError::BadRequest)?;
        let mut builder = client.request(method, url);
        for (name, value) in &request.headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
        if let Some((scheme, key)) = &request.auth {
            let (name, value) = match scheme {
                AuthScheme::Bearer => (
                    "authorization".to_owned(),
                    format!("Bearer {}", key.as_str()),
                ),
                AuthScheme::Basic => {
                    let encoded = base64::engine::general_purpose::STANDARD
                        .encode(format!("{}:", key.as_str()));
                    ("authorization".to_owned(), format!("Basic {encoded}"))
                }
                AuthScheme::Header(name) => (name.clone(), key.as_str().to_owned()),
            };
            let mut header_value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|_| ProviderError::BadRequest)?;
            header_value.set_sensitive(true);
            builder = builder.header(name, header_value);
        }
        if let Some(body) = &request.body {
            builder = builder.body(body.clone());
        }
        let mut response = builder.send().await.map_err(|error| {
            if error.is_timeout() {
                ProviderError::Timeout
            } else {
                ProviderError::Unreachable
            }
        })?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            if error.is_timeout() {
                ProviderError::Timeout
            } else {
                ProviderError::Unreachable
            }
        })? {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(ProviderError::TooLarge);
            }
            body.extend_from_slice(&chunk);
        }
        Ok(ProviderResponse { status, body })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(text: &str) -> SocketAddr {
        text.parse().expect("socket address")
    }

    #[test]
    fn only_public_addresses_are_accepted() {
        assert_eq!(
            public_address([addr("104.18.0.1:443")].into_iter()),
            Some(addr("104.18.0.1:443"))
        );
        assert!(public_address([addr("127.0.0.1:443")].into_iter()).is_none());
        assert!(public_address([addr("10.0.0.5:443")].into_iter()).is_none());
        assert!(public_address([addr("169.254.169.254:443")].into_iter()).is_none());
        // One private answer among public ones is still a refusal.
        assert!(
            public_address([addr("104.18.0.1:443"), addr("192.168.1.9:443")].into_iter()).is_none()
        );
        assert!(public_address(std::iter::empty()).is_none());
    }

    #[test]
    fn provider_errors_have_stable_codes_and_no_secret_text() {
        for error in [
            ProviderError::HostRefused,
            ProviderError::Unreachable,
            ProviderError::Timeout,
            ProviderError::TooLarge,
            ProviderError::BadRequest,
        ] {
            assert!(!error.code().is_empty());
            assert!(!error.reason().is_empty());
        }
        assert!(ProviderError::Timeout.retryable());
        assert!(!ProviderError::HostRefused.retryable());
    }
}
