//! Payment provider contract for server priced hosted checkouts.

use std::net::IpAddr;

use axum::http::HeaderMap;

/// NanoUSD in one US cent.
pub const NANO_USD_PER_CENT: i64 = 10_000_000;

/// Failures on the payment provider surface.
#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    /// A negative amount was requested.
    #[error("amount must not be negative")]
    NegativeAmount,

    /// A checkout amount must be greater than zero.
    #[error("amount must be positive")]
    InvalidAmount,

    /// A provider amount could not be converted to the ledger unit.
    #[error("amount too large")]
    AmountOverflow,

    /// The provider request failed or its response could not be read.
    #[error("provider request failed: {0}")]
    Request(#[from] reqwest::Error),

    /// The provider returned a non-success status.
    #[error("provider returned status {status}")]
    Status {
        /// HTTP status code returned by the provider.
        status: u16,
    },

    /// The provider returned a response that could not be interpreted.
    #[error("provider returned an unparseable response")]
    MalformedResponse,

    /// The callback did not pass every configured verification step.
    #[error("callback rejected: {0}")]
    RejectedCallback(&'static str),

    /// A required local provider value is missing or invalid.
    #[error("provider configuration is incomplete")]
    Configuration,
}

/// Destination and fields for one hosted payment form POST.
///
/// The fields include the public merchant key needed by PayFast's hosted form,
/// so this type intentionally does not implement `Debug`.
#[derive(Clone, PartialEq, Eq)]
pub struct CheckoutAuthorization {
    /// Hosted payment form endpoint.
    pub url: String,
    /// Ordered form field names and values, including the signature.
    pub fields: Vec<(String, String)>,
}

/// Convert USD cents into ledger nanoUSD using checked integer arithmetic.
pub fn nano_usd_from_cents(cents: i64) -> Result<i64, ProviderError> {
    if cents < 0 {
        return Err(ProviderError::NegativeAmount);
    }
    cents
        .checked_mul(NANO_USD_PER_CENT)
        .ok_or(ProviderError::AmountOverflow)
}

/// A verified callback or a deliberate no-op.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderEvent {
    /// A verified payment notification for a one-time credit checkout.
    Payment {
        /// Merchant generated payment reference.
        reference: String,
        /// PayFast payment identifier, when present.
        provider_payment_id: Option<String>,
        /// Provider status as received after signature, source, and postback checks.
        provider_status: String,
        /// Amount received in the gateway currency's minor units, when present.
        amount_minor_units: Option<i64>,
    },
    /// A verified notification for an initial or recurring site subscription payment.
    Subscription {
        /// Merchant generated reference, present on the initial checkout.
        reference: Option<String>,
        /// PayFast token for this recurring subscription.
        token: String,
        /// PayFast payment identifier, when present.
        provider_payment_id: Option<String>,
        /// Provider status as received after verification.
        provider_status: String,
        /// Amount received in the gateway currency's minor units, when present.
        amount_minor_units: Option<i64>,
    },
    /// A valid, unrelated callback that must not change any account balance.
    Ignored,
}

/// One server-confirmed result returned by a provider reconciliation query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconciledPayment {
    /// Merchant generated payment reference.
    pub reference: String,
    /// Provider payment identifier.
    pub provider_payment_id: String,
    /// Provider lifecycle state.
    pub status: String,
    /// Amount in the provider currency's minor units, when supplied.
    pub amount_minor_units: Option<i64>,
}

/// One hosted-checkout provider.
#[async_trait::async_trait]
pub trait PaymentProvider: Send + Sync {
    /// Build signed hosted-checkout form fields without contacting the provider.
    async fn initialize(
        &self,
        amount_minor_units: i64,
        email: &str,
        reference: &str,
        callback_url: &str,
    ) -> Result<CheckoutAuthorization, ProviderError>;

    /// Currency used in the signed checkout amount.
    fn currency(&self) -> crate::credit_packs::Currency;

    /// Verify the raw callback before interpreting any field as trusted.
    async fn verify_callback(
        &self,
        raw_body: &[u8],
        headers: &HeaderMap,
        source_ip: Option<IpAddr>,
    ) -> Result<ProviderEvent, ProviderError>;

    /// Query a provider payment after a verified ITN left its result uncertain.
    async fn reconcile_payment(
        &self,
        provider_payment_id: &str,
    ) -> Result<ReconciledPayment, ProviderError>;

    /// Provider name stored on payment intents.
    fn name(&self) -> &'static str;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_cents_to_nanousd_without_float_rounding() {
        assert_eq!(nano_usd_from_cents(500).ok(), Some(5_000_000_000));
        assert_eq!(nano_usd_from_cents(1).ok(), Some(10_000_000));
    }

    #[test]
    fn rejects_negative_and_overflowing_cents() {
        assert!(matches!(
            nano_usd_from_cents(-1),
            Err(ProviderError::NegativeAmount)
        ));
        assert!(matches!(
            nano_usd_from_cents(i64::MAX),
            Err(ProviderError::AmountOverflow)
        ));
    }
}
