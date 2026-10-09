//! Bounded, fixed-origin OpenRouter transport and exact decimal billing.

use std::time::Duration;

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, value::RawValue, Value};
use zeroize::Zeroizing;

pub(super) const MODEL: &str = "openai/gpt-4.1-mini";
pub(super) const MAX_BODY: usize = 64 * 1024;
const MAX_RESPONSE: usize = 1024 * 1024;
const MAX_OUTPUT: i64 = 4096;

/// Never derive Debug: the bearer must never enter logs.
pub(super) struct Upstream {
    client: Client,
    key: Zeroizing<String>,
    origin: String,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum CompletionFailure {
    Rejected,
    Ambiguous,
}

impl Upstream {
    pub(super) fn from_env() -> Option<Self> {
        let key = std::env::var("OPENROUTER_MASTER_KEY").ok()?;
        if key.trim().is_empty() {
            return None;
        }
        Self::new(
            key,
            "https://openrouter.ai/api/v1".into(),
            Duration::from_secs(90),
        )
        .ok()
    }

    fn new(key: String, origin: String, timeout: Duration) -> Result<Self, ()> {
        let client = Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| ())?;
        Ok(Self {
            client,
            key: Zeroizing::new(key),
            origin,
        })
    }

    #[cfg(test)]
    pub(super) fn fake(origin: String, timeout: Duration) -> Self {
        Self::new("synthetic-test-key".into(), origin, timeout).unwrap()
    }

    pub(super) async fn complete(&self, body: &Value) -> Result<Vec<u8>, CompletionFailure> {
        let response = self
            .client
            .post(format!("{}/chat/completions", self.origin))
            .bearer_auth(self.key.as_str())
            .header("X-OpenRouter-Title", "Colony Agent")
            .json(body)
            .send()
            .await
            .map_err(|_| CompletionFailure::Ambiguous)?;
        if matches!(
            response.status().as_u16(),
            400 | 401 | 402 | 403 | 404 | 413 | 422 | 429
        ) {
            return Err(CompletionFailure::Rejected);
        }
        bounded_response(response)
            .await
            .map_err(|_| CompletionFailure::Ambiguous)
    }

    pub(super) async fn generation_cost(&self, generation: &str) -> Result<i64, ()> {
        let response = self
            .client
            .get(format!("{}/generation", self.origin))
            .bearer_auth(self.key.as_str())
            .query(&[("id", generation)])
            .send()
            .await
            .map_err(|_| ())?;
        let bytes = bounded_response(response).await?;
        #[derive(Deserialize)]
        struct Generation {
            data: GenerationData,
        }
        #[derive(Deserialize)]
        struct GenerationData {
            id: String,
            total_cost: Box<RawValue>,
        }
        let result: Generation = serde_json::from_slice(&bytes).map_err(|_| ())?;
        if result.data.id != generation {
            return Err(());
        }
        charge_decimal(result.data.total_cost.get())
    }
}

async fn bounded_response(mut response: reqwest::Response) -> Result<Vec<u8>, ()> {
    if !response.status().is_success() {
        return Err(());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Private managed workflow, deliberately not an OpenAI request passthrough.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ManagedRequest {
    pub session_id: uuid::Uuid,
    pub request_id: uuid::Uuid,
    pub messages: Vec<Value>,
    #[serde(default)]
    pub tools: Vec<Value>,
}

impl ManagedRequest {
    pub(super) fn upstream_body(&self) -> Result<(Value, i64), ()> {
        if self.messages.is_empty() || self.messages.len() > 128 || self.tools.len() > 64 {
            return Err(());
        }
        for message in &self.messages {
            let object = message.as_object().ok_or(())?;
            if object.keys().any(|key| {
                !["role", "content", "tool_calls", "tool_call_id", "name"].contains(&key.as_str())
            }) {
                return Err(());
            }
            if !matches!(
                message["role"].as_str(),
                Some("system" | "user" | "assistant" | "tool")
            ) {
                return Err(());
            }
            if !message["content"].is_null() && !message["content"].is_string() {
                return Err(());
            }
            // No multimodal content or server-side plugins. Function tools run
            // inside the managed Colony Agent's existing permission boundary.
            if let Some(calls) = message.get("tool_calls") {
                let calls = calls.as_array().ok_or(())?;
                if calls.len() > 64 || calls.iter().any(|call| call["type"] != "function") {
                    return Err(());
                }
            }
        }
        if self
            .tools
            .iter()
            .any(|tool| tool["type"] != "function" || !tool["function"].is_object())
        {
            return Err(());
        }
        let mut body = json!({
            "model": MODEL, "messages": self.messages, "stream": false,
            "max_tokens": MAX_OUTPUT,
            "provider": {"max_price": {"prompt": 1, "completion": 5, "request": 0}, "require_parameters": true},
        });
        if !self.tools.is_empty() {
            body["tools"] = json!(self.tools);
        }
        let bytes = serde_json::to_vec(&body).map_err(|_| ())?;
        if bytes.len() > MAX_BODY {
            return Err(());
        }
        // Two tokens per serialized UTF-8 byte plus 32768 framing tokens is a
        // conservative upper bound for this text-only, bounded-message model.
        // max_price is USD / million tokens. Bill only actual returned cost.
        let prompt_bound = i64::try_from(bytes.len()).map_err(|_| ())? * 2 + 32768;
        let reserve = prompt_bound * 1200 + MAX_OUTPUT * 6000;
        Ok((body, reserve))
    }
}

pub(super) struct ObservedResponse {
    pub generation: String,
    pub charged: Option<i64>,
    pub usage: Value,
    pub response: Value,
}

pub(super) fn observe(bytes: &[u8]) -> Result<ObservedResponse, ()> {
    #[derive(Deserialize)]
    struct Response {
        id: String,
        usage: Option<Usage>,
    }
    #[derive(Deserialize)]
    struct Usage {
        cost: Option<Box<RawValue>>,
    }
    let raw: Response = serde_json::from_slice(bytes).map_err(|_| ())?;
    if raw.id.is_empty() || raw.id.len() > 200 {
        return Err(());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| ())?;
    let usage = value
        .get("usage")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let cost = raw.usage.and_then(|u| u.cost);
    let charged = cost
        .as_ref()
        .and_then(|cost| charge_decimal(cost.get()).ok());
    let mut usage = usage;
    if let Some(cost) = cost.filter(|cost| charge_decimal(cost.get()).is_ok()) {
        usage["costUsd"] = json!(cost.get());
    }
    let response = json!({"id":raw.id, "model":MODEL, "choices":value["choices"], "usage":usage});
    Ok(ObservedResponse {
        generation: raw.id,
        charged,
        usage,
        response,
    })
}

/// ceil(decimal USD * 1e9 * 1.20), calculated without a floating-point step.
pub(super) fn charge_decimal(raw: &str) -> Result<i64, ()> {
    if raw.len() > 64 || raw.starts_with('-') || raw.starts_with('"') {
        return Err(());
    }
    let (mantissa, exponent) = match raw.split_once(['e', 'E']) {
        Some((number, exponent)) => (number, exponent.parse::<i32>().map_err(|_| ())?),
        None => (raw, 0),
    };
    if !(-18..=18).contains(&exponent) {
        return Err(());
    }
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    if whole.is_empty()
        || fraction.len() > 18
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return Err(());
    }
    let digits: i128 = format!("{whole}{fraction}").parse().map_err(|_| ())?;
    let scale = i32::try_from(fraction.len()).map_err(|_| ())? - exponent;
    let numerator = digits.checked_mul(1_200_000_000).ok_or(())?;
    let result = if scale >= 0 {
        let denominator = 10_i128.checked_pow(scale as u32).ok_or(())?;
        numerator.checked_add(denominator - 1).ok_or(())? / denominator
    } else {
        numerator
            .checked_mul(10_i128.checked_pow((-scale) as u32).ok_or(())?)
            .ok_or(())?
    };
    i64::try_from(result).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returned_cost_is_exact_with_margin_and_rounds_once() {
        for (cost, charge) in [
            ("0", 0),
            ("0.01", 12_000_000),
            ("0.000000001", 2),
            ("1e-9", 2),
            ("0.1234567891", 148_148_147),
            ("0.100000000000000001", 120_000_001),
        ] {
            assert_eq!(charge_decimal(cost), Ok(charge), "{cost}");
        }
        for invalid in ["-1", "NaN", "null", "\"0.1\"", "1e99"] {
            assert!(charge_decimal(invalid).is_err());
        }
    }

    #[test]
    fn private_schema_refuses_provider_overrides_and_multimodal_input() {
        let mut value = json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),"messages":[{"role":"user","content":"hello"}]});
        let request: ManagedRequest = serde_json::from_value(value.clone()).unwrap();
        let (body, reserve) = request.upstream_body().unwrap();
        assert_eq!(body["model"], MODEL);
        assert_eq!(body["stream"], false);
        assert_eq!(body["provider"]["max_price"]["prompt"], 1);
        assert!((1..400_000_000).contains(&reserve));
        value["model"] = json!("expensive-model");
        assert!(serde_json::from_value::<ManagedRequest>(value.clone()).is_err());
        value.as_object_mut().unwrap().remove("model");
        value["messages"][0]["content"] =
            json!([{"type":"image_url","image_url":{"url":"https://outside.invalid"}}]);
        assert!(serde_json::from_value::<ManagedRequest>(value)
            .unwrap()
            .upstream_body()
            .is_err());
    }

    #[test]
    fn production_observer_preserves_cost_before_any_float_conversion() {
        let response = observe(br#"{"id":"gen-exact","choices":[],"usage":{"cost":0.100000000000000001,"total_tokens":1}}"#).unwrap();
        assert_eq!(response.charged, Some(120_000_001));
        assert_eq!(response.usage["costUsd"], "0.100000000000000001");
        assert_eq!(
            observe(br#"{"id":"gen-missing","choices":[]}"#)
                .unwrap()
                .charged,
            None
        );
    }

    async fn fake_server(router: axum::Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        (origin, task)
    }

    #[tokio::test]
    async fn production_transport_bounds_deadline_and_response_bytes() {
        use axum::{routing::post, Router};
        let slow = Router::new().route(
            "/chat/completions",
            post(|| async {
                tokio::time::sleep(Duration::from_secs(1)).await;
                "late"
            }),
        );
        let (origin, task) = fake_server(slow).await;
        let upstream = Upstream::fake(origin, Duration::from_millis(20));
        assert!(upstream.complete(&json!({})).await.is_err());
        task.abort();
        let oversized = Router::new().route(
            "/chat/completions",
            post(|| async { "x".repeat(MAX_RESPONSE + 1) }),
        );
        let (origin, task) = fake_server(oversized).await;
        assert!(Upstream::fake(origin, Duration::from_secs(1))
            .complete(&json!({}))
            .await
            .is_err());
        task.abort();
    }

    #[tokio::test]
    async fn production_transport_never_follows_redirects_or_accepts_other_generation() {
        use axum::{
            routing::{get, post},
            Router,
        };
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let hits = Arc::new(AtomicUsize::new(0));
        let observed = hits.clone();
        let router = Router::new()
            .route(
                "/chat/completions",
                post(|| async { axum::response::Redirect::temporary("/leak") }),
            )
            .route(
                "/leak",
                post(move || {
                    let hits = observed.clone();
                    async move {
                        hits.fetch_add(1, Ordering::SeqCst);
                        "leaked"
                    }
                }),
            )
            .route(
                "/generation",
                get(|| async {
                    axum::Json(json!({"data":{"id":"different-generation","total_cost":0.01}}))
                }),
            );
        let (origin, task) = fake_server(router).await;
        let upstream = Upstream::fake(origin, Duration::from_secs(1));
        assert!(upstream.complete(&json!({})).await.is_err());
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        assert!(upstream
            .generation_cost("original-generation")
            .await
            .is_err());
        task.abort();
    }
}
