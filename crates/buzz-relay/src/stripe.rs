//! Hosted Stripe Checkout and timestamped raw-body webhook verification.

use crate::{
    credit_packs::Currency,
    payments_provider::{
        CheckoutAuthorization, PaymentProvider, ProviderError, ProviderEvent, ReconciledPayment,
    },
};
use axum::http::HeaderMap;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use std::{net::IpAddr, time::Duration};
use zeroize::Zeroizing;

const API_VERSION: &str = "2025-02-24.acacia";
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

/// Stripe credentials stay server-side and are never included in Debug output.
pub struct Stripe {
    client: reqwest::Client,
    secret: Zeroizing<String>,
    webhook_secret: Zeroizing<String>,
    api_base: String,
}

#[derive(Deserialize)]
struct Session {
    id: String,
    url: Option<String>,
    client_reference_id: Option<String>,
    mode: String,
    payment_status: String,
    status: Option<String>,
    amount_total: Option<i64>,
    currency: Option<String>,
}

#[derive(Deserialize)]
struct Event {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    data: EventData,
}
#[derive(Deserialize)]
struct EventData {
    object: serde_json::Value,
}

impl Stripe {
    /// Construct a bounded, non-redirecting client for Stripe's official API.
    pub fn new(secret: String, webhook_secret: String) -> Result<Self, ProviderError> {
        if secret.is_empty() || webhook_secret.is_empty() {
            return Err(ProviderError::Configuration);
        }
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            secret: Zeroizing::new(secret),
            webhook_secret: Zeroizing::new(webhook_secret),
            api_base: "https://api.stripe.com/v1".to_owned(),
        })
    }

    async fn session_response(response: reqwest::Response) -> Result<Session, ProviderError> {
        if !response.status().is_success() {
            return Err(ProviderError::Status {
                status: response.status().as_u16(),
            });
        }
        let mut response = response;
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(ProviderError::MalformedResponse);
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_| ProviderError::MalformedResponse)
    }

    fn verify_signature(&self, body: &[u8], headers: &HeaderMap) -> Result<(), ProviderError> {
        let rejected = || ProviderError::RejectedCallback("invalid Stripe signature");
        let header = headers
            .get("stripe-signature")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(rejected)?;
        if header.len() > 4096 {
            return Err(rejected());
        }
        let timestamps: Vec<&str> = header
            .split(',')
            .filter_map(|v| v.trim().strip_prefix("t="))
            .collect();
        if timestamps.len() != 1 {
            return Err(rejected());
        }
        let timestamp = timestamps[0].parse::<i64>().map_err(|_| rejected())?;
        if chrono::Utc::now().timestamp().abs_diff(timestamp) > 300 {
            return Err(rejected());
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(self.webhook_secret.as_bytes())
            .map_err(|_| rejected())?;
        mac.update(timestamps[0].as_bytes());
        mac.update(b".");
        mac.update(body);
        for signature in header
            .split(',')
            .filter_map(|v| v.trim().strip_prefix("v1="))
        {
            if let Ok(signature) = hex::decode(signature) {
                if mac.clone().verify_slice(&signature).is_ok() {
                    return Ok(());
                }
            }
        }
        Err(rejected())
    }
}

#[async_trait::async_trait]
impl PaymentProvider for Stripe {
    async fn initialize(
        &self,
        amount: i64,
        email: &str,
        reference: &str,
        callback_url: &str,
    ) -> Result<CheckoutAuthorization, ProviderError> {
        if amount <= 0 {
            return Err(ProviderError::InvalidAmount);
        }
        let fields = [
            ("mode", "payment".to_owned()),
            ("client_reference_id", reference.to_owned()),
            ("customer_email", email.to_owned()),
            ("success_url", format!("{callback_url}?result=return")),
            ("cancel_url", format!("{callback_url}?result=cancel")),
            ("line_items[0][price_data][currency]", "usd".to_owned()),
            ("line_items[0][price_data][unit_amount]", amount.to_string()),
            (
                "line_items[0][price_data][product_data][name]",
                "Colony credits".to_owned(),
            ),
            ("line_items[0][quantity]", "1".to_owned()),
        ];
        let response = self
            .client
            .post(format!("{}/checkout/sessions", self.api_base))
            .bearer_auth(self.secret.as_str())
            .header("Stripe-Version", API_VERSION)
            .header("Idempotency-Key", reference)
            .form(&fields)
            .send()
            .await?;
        let session = Self::session_response(response).await?;
        if session.client_reference_id.as_deref() != Some(reference)
            || session.amount_total != Some(amount)
            || session.currency.as_deref() != Some("usd")
            || session.mode != "payment"
        {
            return Err(ProviderError::MalformedResponse);
        }
        let url = session.url.ok_or(ProviderError::MalformedResponse)?;
        let parsed = url::Url::parse(&url).map_err(|_| ProviderError::MalformedResponse)?;
        if parsed.scheme() != "https"
            || parsed.host_str() != Some("checkout.stripe.com")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(ProviderError::MalformedResponse);
        }
        Ok(CheckoutAuthorization {
            url,
            fields: vec![],
            session_id: Some(session.id),
        })
    }
    fn currency(&self) -> Currency {
        Currency::Usd
    }
    fn name(&self) -> &'static str {
        "stripe"
    }

    async fn verify_callback(
        &self,
        body: &[u8],
        headers: &HeaderMap,
        _source_ip: Option<IpAddr>,
    ) -> Result<ProviderEvent, ProviderError> {
        self.verify_signature(body, headers)?;
        let event: Event = serde_json::from_slice(body)
            .map_err(|_| ProviderError::RejectedCallback("invalid Stripe event"))?;
        if !matches!(
            event.kind.as_str(),
            "checkout.session.completed"
                | "checkout.session.async_payment_succeeded"
                | "checkout.session.async_payment_failed"
                | "checkout.session.expired"
        ) {
            return Ok(ProviderEvent::Ignored);
        }
        let session: Session = serde_json::from_value(event.data.object)
            .map_err(|_| ProviderError::RejectedCallback("invalid Stripe session"))?;
        if session.mode != "payment" {
            return Ok(ProviderEvent::Ignored);
        }
        let status = match event.kind.as_str() {
            "checkout.session.expired" => "CANCELLED",
            "checkout.session.async_payment_failed" => "FAILED",
            _ if session.payment_status == "paid" => "COMPLETE",
            _ => "PENDING",
        };
        Ok(ProviderEvent::StripePayment {
            event_id: event.id,
            reference: session
                .client_reference_id
                .ok_or(ProviderError::RejectedCallback("missing reference"))?,
            session_id: session.id,
            status: status.to_owned(),
            amount: session
                .amount_total
                .ok_or(ProviderError::RejectedCallback("missing amount"))?,
            currency: session
                .currency
                .ok_or(ProviderError::RejectedCallback("missing currency"))?
                .to_ascii_uppercase(),
        })
    }

    async fn reconcile_payment(
        &self,
        session_id: &str,
    ) -> Result<ReconciledPayment, ProviderError> {
        if !session_id.starts_with("cs_")
            || !session_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err(ProviderError::MalformedResponse);
        }
        let response = self
            .client
            .get(format!("{}/checkout/sessions/{session_id}", self.api_base))
            .bearer_auth(self.secret.as_str())
            .header("Stripe-Version", API_VERSION)
            .send()
            .await?;
        let session = Self::session_response(response).await?;
        if session.id != session_id
            || session.currency.as_deref() != Some("usd")
            || session.mode != "payment"
        {
            return Err(ProviderError::MalformedResponse);
        }
        Ok(ReconciledPayment {
            reference: session
                .client_reference_id
                .ok_or(ProviderError::MalformedResponse)?,
            provider_payment_id: session.id,
            status: if session.payment_status == "paid" {
                "COMPLETE"
            } else if session.status.as_deref() == Some("expired") {
                "CANCELLED"
            } else {
                "PENDING"
            }
            .to_owned(),
            amount_minor_units: session.amount_total,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::post, Json, Router};

    fn provider() -> Stripe {
        Stripe::new("fake-api".into(), "fake-webhook".into()).expect("fake config")
    }
    fn signed(body: &[u8], timestamp: i64) -> HeaderMap {
        let mut mac = Hmac::<Sha256>::new_from_slice(b"fake-webhook").expect("hmac");
        mac.update(format!("{timestamp}.").as_bytes());
        mac.update(body);
        let mut headers = HeaderMap::new();
        headers.insert(
            "stripe-signature",
            format!(
                "t={timestamp},v1={}",
                hex::encode(mac.finalize().into_bytes())
            )
            .parse()
            .expect("header"),
        );
        headers
    }
    fn body(kind: &str, payment_status: &str) -> Vec<u8> {
        serde_json::to_vec(
            &serde_json::json!({"id":"evt_test", "type":kind, "data":{"object":{
                "id":"cs_test_checkout", "client_reference_id":"credit-test", "mode":"payment",
                "payment_status":payment_status, "amount_total":500, "currency":"usd"
            }}}),
        )
        .expect("event")
    }

    #[tokio::test]
    async fn raw_signature_rejects_tampering_missing_wrong_and_stale_signatures() {
        let provider = provider();
        let body = body("checkout.session.completed", "paid");
        let headers = signed(&body, chrono::Utc::now().timestamp());
        assert!(
            matches!(provider.verify_callback(&body, &headers, None).await.expect("verified"), ProviderEvent::StripePayment { status, amount:500, .. } if status == "COMPLETE")
        );
        let mut changed = body.clone();
        changed.push(b' ');
        assert!(provider
            .verify_callback(&changed, &headers, None)
            .await
            .is_err());
        assert!(provider
            .verify_callback(&body, &HeaderMap::new(), None)
            .await
            .is_err());
        assert!(provider
            .verify_callback(
                &body,
                &signed(&body, chrono::Utc::now().timestamp() - 301),
                None
            )
            .await
            .is_err());
        let mut wrong = headers.clone();
        wrong.insert(
            "stripe-signature",
            "t=1,v1=deadbeef".parse().expect("header"),
        );
        assert!(provider.verify_callback(&body, &wrong, None).await.is_err());
    }

    #[tokio::test]
    async fn completed_unpaid_waits_for_async_confirmation_and_expiry_is_terminal() {
        let provider = provider();
        for (kind, paid, expected) in [
            ("checkout.session.completed", "unpaid", "PENDING"),
            (
                "checkout.session.async_payment_succeeded",
                "paid",
                "COMPLETE",
            ),
            ("checkout.session.async_payment_failed", "unpaid", "FAILED"),
            ("checkout.session.expired", "unpaid", "CANCELLED"),
        ] {
            let body = body(kind, paid);
            assert!(
                matches!(provider.verify_callback(&body, &signed(&body, chrono::Utc::now().timestamp()), None).await.expect("verified"), ProviderEvent::StripePayment { status, .. } if status == expected)
            );
        }
    }

    #[tokio::test]
    async fn fake_stripe_receives_server_price_and_stable_idempotency_key() {
        let app = Router::new().route("/checkout/sessions", post(|headers: HeaderMap, body: axum::body::Bytes| async move {
            assert_eq!(headers["idempotency-key"], "credit-test");
            assert_eq!(headers["stripe-version"], API_VERSION);
            let fields: std::collections::HashMap<String, String> = url::form_urlencoded::parse(&body).into_owned().collect();
            assert_eq!(fields["line_items[0][price_data][unit_amount]"], "500");
            assert_eq!(fields["line_items[0][price_data][currency]"], "usd");
            assert_eq!(fields["mode"], "payment");
            Json(serde_json::json!({"id":"cs_test_checkout", "url":"https://checkout.stripe.com/c/pay/test", "mode":"payment", "payment_status":"unpaid", "client_reference_id":"credit-test", "amount_total":500, "currency":"usd"}))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake");
        let mut provider = provider();
        provider.api_base = format!("http://{}", listener.local_addr().expect("address"));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("fake server");
        });
        for _ in 0..2 {
            let result = provider
                .initialize(
                    500,
                    "buyer@example.invalid",
                    "credit-test",
                    "https://colony.example/api/payments/checkout/return",
                )
                .await
                .expect("checkout");
            assert_eq!(result.session_id.as_deref(), Some("cs_test_checkout"));
            assert!(result.fields.is_empty());
        }
        server.abort();
    }
}
