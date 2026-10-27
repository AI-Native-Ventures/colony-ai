//! Bounded server-configured transport and exact provider cost accounting.

use std::time::Duration;

use super::credits_gateway_metering::TokenPrices;
use super::credits_gateway_policy::Policy;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, value::RawValue, Value};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub(super) const MODEL: &str = "openai/gpt-4.1-mini";
/// Largest managed-inference request body, inbound and as forwarded upstream.
///
/// A real Scout session carries about 47 KB of prompt and tool definitions
/// before its first message, and the agent keeps up to 200k tokens of history
/// (roughly 600 KB) before it summarises, so 64 KiB refused every session after
/// its first tool result. 1 MiB fits that window with headroom and stays
/// bounded. The managed client stops 4 KiB short because this relay adds its
/// routing fields to what it forwards.
pub(super) const MAX_BODY: usize = 1024 * 1024;
/// Most messages in one request. The agent keeps a session's history within its
/// token window, so a long tool-using session reaches a few hundred.
const MAX_MESSAGES: usize = 1024;
/// Prompt tokens the hold assumes for a request when the model's own context
/// window is not configured: the free Scout model's 262,144.
const DEFAULT_CONTEXT_TOKENS: i64 = 262_144;
/// Largest context window the hold can cover. At the price ceiling the hold for
/// this many prompt tokens plus a full reply is 398,976,000 nanousd, just under
/// the 400,000,000 the ledger allows for one request.
const MAX_CONTEXT_TOKENS: i64 = 312_000;
const MAX_RESPONSE: usize = 1024 * 1024;
const MAX_OUTPUT: i64 = 4096;

/// Never derive Debug: the bearer must never enter logs.
pub(super) struct Upstream {
    client: Client,
    key: Zeroizing<String>,
    origin: String,
    pub(super) model: String,
    pub(super) fingerprint: String,
    openrouter: bool,
    prices: Option<TokenPrices>,
    policy: Policy,
    context_tokens: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum CompletionFailure {
    Rejected,
    Ambiguous,
}

impl Upstream {
    pub(super) fn from_env() -> Option<Self> {
        let origin = std::env::var("COLONY_CREDITS_UPSTREAM_BASE_URL")
            .unwrap_or_else(|_| "https://openrouter.ai/api/v1".into());
        let url = url::Url::parse(&origin).ok()?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return None;
        }
        let openrouter = url.host_str() == Some("openrouter.ai");
        let key = std::env::var("COLONY_CREDITS_UPSTREAM_KEY")
            .ok()
            .or_else(|| {
                openrouter
                    .then(|| std::env::var("OPENROUTER_MASTER_KEY").ok())
                    .flatten()
            })?;
        if key.trim().is_empty() {
            return None;
        }
        let model = std::env::var("COLONY_CREDITS_UPSTREAM_MODEL")
            .ok()
            .or_else(|| openrouter.then(|| MODEL.to_owned()))?;
        let prices = match std::env::var("COLONY_CREDITS_MODEL_PRICES") {
            Ok(table) => {
                let table: std::collections::HashMap<String, TokenPrices> =
                    serde_json::from_str(&table).ok()?;
                Some(table.get(&model)?.clone())
            }
            Err(_) if openrouter => None,
            Err(_) => return None,
        };
        let allowed: Vec<String> = match std::env::var("COLONY_CREDITS_ALLOWED_MODELS") {
            Ok(list) => serde_json::from_str(&list).ok()?,
            Err(_) => vec![MODEL.into()],
        };
        let tracking = if openrouter {
            Some(std::env::var("COLONY_CREDITS_USER_HASH_KEY").ok()?)
        } else {
            None
        };
        let policy = Policy::new(&model, allowed, openrouter, tracking).ok()?;
        // The model's context window, in tokens. No prompt can be longer, so it
        // bounds what a request can cost and what the relay holds for it. Set it
        // when the server model's window is smaller than the default.
        let context_tokens = match std::env::var("COLONY_CREDITS_MODEL_CONTEXT_TOKENS") {
            Ok(raw) => raw.trim().parse::<i64>().ok()?,
            Err(_) => DEFAULT_CONTEXT_TOKENS,
        };
        Self::new(
            key,
            origin.trim_end_matches('/').into(),
            Duration::from_secs(90),
            model,
            openrouter,
            prices,
            policy,
            context_tokens,
        )
        .ok()
    }

    #[allow(clippy::too_many_arguments)]
    fn new(
        key: String,
        origin: String,
        timeout: Duration,
        model: String,
        openrouter: bool,
        prices: Option<TokenPrices>,
        policy: Policy,
        context_tokens: i64,
    ) -> Result<Self, ()> {
        policy.check_model(&model)?;
        if !(8192..=MAX_CONTEXT_TOKENS).contains(&context_tokens) {
            return Err(());
        }
        if let Some(prices) = &prices {
            prices.validate()?;
        }
        if !openrouter && prices.is_none() {
            return Err(());
        }
        if model.is_empty() || model.len() > 200 {
            return Err(());
        }
        let client = Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| ())?;
        let fingerprint = hex::encode(Sha256::digest(format!(
            "{origin}\n{model}\n{openrouter}\n{}\n{}",
            prices
                .as_ref()
                .map(|p| p.input_nanousd_per_million.as_str())
                .unwrap_or("none"),
            prices
                .as_ref()
                .map(|p| p.output_nanousd_per_million.as_str())
                .unwrap_or("none")
        )));
        Ok(Self {
            client,
            key: Zeroizing::new(key),
            origin,
            model,
            fingerprint,
            openrouter,
            prices,
            policy,
            context_tokens,
        })
    }

    #[cfg(test)]
    pub(super) fn fake(origin: String, timeout: Duration) -> Self {
        Self::new(
            "synthetic-test-key".into(),
            origin,
            timeout,
            MODEL.into(),
            true,
            Some(TokenPrices::openrouter_ceiling()),
            Policy::new(
                MODEL,
                vec![MODEL.into()],
                true,
                Some("synthetic-customer-hmac-key-at-least-32-bytes".into()),
            )
            .unwrap(),
            DEFAULT_CONTEXT_TOKENS,
        )
        .unwrap()
    }

    #[cfg(test)]
    pub(super) fn fake_direct(origin: String, prices: TokenPrices) -> Self {
        Self::new(
            "synthetic-test-key".into(),
            origin,
            Duration::from_secs(1),
            "direct-test-model".into(),
            false,
            Some(prices),
            Policy::new(
                "direct-test-model",
                vec!["direct-test-model".into()],
                false,
                None,
            )
            .unwrap(),
            DEFAULT_CONTEXT_TOKENS,
        )
        .unwrap()
    }

    pub(super) fn request(&self, request: &ManagedRequest) -> Result<(Value, i64), ()> {
        self.policy.check_model(&self.model)?;
        request.upstream_body(
            &self.model,
            self.openrouter,
            self.prices.as_ref(),
            self.context_tokens,
        )
    }

    pub(super) fn attribute_customer(
        &self,
        body: &mut Value,
        account: uuid::Uuid,
    ) -> Result<(), ()> {
        if self.openrouter {
            body["user"] = json!(self.policy.user(account)?);
        }
        Ok(())
    }

    pub(super) fn observe(&self, bytes: &[u8]) -> Result<ObservedResponse, ()> {
        observe(bytes, &self.model, self.prices.as_ref())
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
        if !self.openrouter {
            return Err(());
        }
        let mut url = url::Url::parse(&format!("{}/generation", self.origin)).map_err(|_| ())?;
        url.query_pairs_mut().append_pair("id", generation);
        let response = self
            .client
            .get(url.as_str())
            .bearer_auth(self.key.as_str())
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
    fn upstream_body(
        &self,
        model: &str,
        openrouter: bool,
        prices: Option<&TokenPrices>,
        context_tokens: i64,
    ) -> Result<(Value, i64), ()> {
        if self.messages.is_empty() || self.messages.len() > MAX_MESSAGES || self.tools.len() > 64 {
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
            "model": model, "messages": self.messages, "stream": false,
            "max_tokens": MAX_OUTPUT,
        });
        if openrouter {
            body["provider"] = json!({"max_price":{"prompt":1,"completion":5,"request":0},"require_parameters":true});
        }
        if openrouter && model == MODEL {
            body["provider"]["only"] = json!(["openai"]);
            body["provider"]["allow_fallbacks"] = json!(false);
        }
        if !self.tools.is_empty() {
            body["tools"] = json!(self.tools);
        }
        let bytes = serde_json::to_vec(&body).map_err(|_| ())?;
        if bytes.len() > MAX_BODY {
            return Err(());
        }
        // Two tokens per serialized UTF-8 byte plus 32768 framing tokens is a
        // conservative upper bound for this text-only, bounded-message model,
        // and no prompt can exceed the model's context window, so the hold never
        // asks for more than that. max_price is USD / million tokens. Bill only
        // actual returned cost.
        let prompt_bound =
            (i64::try_from(bytes.len()).map_err(|_| ())? * 2 + 32768).min(context_tokens);
        let ceiling = TokenPrices::openrouter_ceiling();
        let hold_prices = if openrouter {
            &ceiling
        } else {
            prices.ok_or(())?
        };
        // A model priced at zero (a free one) still holds one nanousd: the ledger
        // refuses a hold of nothing, and that must not read as an unsupported input.
        let reserve = hold_prices
            .charge(prompt_bound as u64, MAX_OUTPUT as u64)?
            .max(1);
        if !(1..=400_000_000).contains(&reserve) {
            return Err(());
        }
        Ok((body, reserve))
    }
}

pub(super) struct ObservedResponse {
    pub generation: String,
    pub charged: Option<i64>,
    pub usage: Value,
    pub response: Value,
}

fn observe(
    bytes: &[u8],
    model: &str,
    prices: Option<&TokenPrices>,
) -> Result<ObservedResponse, ()> {
    #[derive(Deserialize)]
    struct Response {
        id: String,
        usage: Option<Box<RawValue>>,
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
    // Preserve a valid generation id even when usage has the wrong shape, so
    // automatic attribution can recover instead of charging the maximum.
    let cost = raw
        .usage
        .and_then(|usage| serde_json::from_str::<Usage>(usage.get()).ok())
        .and_then(|usage| usage.cost);
    let charged = match cost.as_ref() {
        Some(cost) => charge_decimal(cost.get()).ok(),
        None if usage.get("cost").is_none() => prices.and_then(|p| p.usage_charge(&usage).ok()),
        None => None, // Invalid/null returned cost must not silently undercharge.
    };
    let mut usage = usage;
    usage["model"] = json!(model);
    if charged.is_some() {
        if cost.is_some() {
            usage["costSource"] = json!("returned_cost");
        } else if let Some(prices) = prices {
            usage["costSource"] = json!("token_table");
            usage["inputPriceNanousdPerMillion"] = json!(prices.input_nanousd_per_million);
            usage["outputPriceNanousdPerMillion"] = json!(prices.output_nanousd_per_million);
        }
    }
    if let Some(cost) = cost.filter(|cost| charge_decimal(cost.get()).is_ok()) {
        usage["costUsd"] = json!(cost.get());
    }
    let response = json!({"id":raw.id, "model":model, "choices":value["choices"], "usage":usage});
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

/// What a Scout session really sends. The prompt is the bytes `buzz-acp` gives
/// every agent and the tools are the 20 definitions the shipped dev and browser
/// servers register (captured in the agent crate's `testdata`), in the wire
/// shape the managed client posts.
#[cfg(test)]
pub(in crate::api) mod scout_session {
    use serde_json::{json, Value};

    const BASE_PROMPT: &str = concat!(
        include_str!("../../../buzz-acp/src/base_prompt.md"),
        "\n",
        include_str!("../../../buzz-acp/src/voice.md"),
        "\n",
        include_str!("../../../buzz-acp/src/web_tasks.md")
    );

    pub(in crate::api) fn tools() -> Vec<Value> {
        let defs: Vec<Value> = serde_json::from_str(include_str!(
            "../../../buzz-agent/src/llm/testdata/scout_tool_defs.json"
        ))
        .unwrap();
        defs.into_iter()
            .map(|def| {
                json!({"type":"function","function":{
                    "name":def["name"],"description":def["description"],"parameters":def["input_schema"]}})
            })
            .collect()
    }

    /// The system message, a user turn, `rounds` shell rounds, then the next user turn.
    pub(in crate::api) fn messages(rounds: usize, result_bytes: usize) -> Vec<Value> {
        let mut messages = vec![
            json!({"role":"system","content":format!("{BASE_PROMPT}\n\nYou are Scout, the owner's Chief of Staff.")}),
            json!({"role":"user","content":"Go through the lead list and tell me who to call first."}),
        ];
        for i in 0..rounds {
            messages.push(json!({"role":"assistant","content":"","tool_calls":[{
                "id":format!("call_{i}"),"type":"function",
                "function":{"name":"dev__shell","arguments":json!({"command":format!("ls -la /work/{i}")}).to_string()}}]}));
            messages.push(json!({"role":"tool","tool_call_id":format!("call_{i}"),"content":"x".repeat(result_bytes)}));
        }
        messages.push(json!({"role":"user","content":"Now summarise what you found."}));
        messages
    }

    pub(in crate::api) fn request(
        session: uuid::Uuid,
        request: uuid::Uuid,
        rounds: usize,
        result_bytes: usize,
    ) -> Value {
        json!({"session_id":session,"request_id":request,
            "messages":messages(rounds, result_bytes),"tools":tools()})
    }

    pub(in crate::api) const PACKAGED_FIRST_HELLO: &str =
        include_str!("testdata/packaged_first_hello.json");
    pub(in crate::api) const PACKAGED_TOOL_ROUND: &str =
        include_str!("testdata/packaged_tool_round.json");
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
        let (body, reserve) = request
            .upstream_body(
                MODEL,
                true,
                Some(&TokenPrices::openrouter_ceiling()),
                DEFAULT_CONTEXT_TOKENS,
            )
            .unwrap();
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
            .upstream_body(
                MODEL,
                true,
                Some(&TokenPrices::openrouter_ceiling()),
                DEFAULT_CONTEXT_TOKENS
            )
            .is_err());
    }

    #[test]
    fn production_observer_preserves_cost_before_any_float_conversion() {
        let response = observe(br#"{"id":"gen-exact","choices":[],"usage":{"cost":0.100000000000000001,"total_tokens":1}}"#, MODEL, Some(&TokenPrices::openrouter_ceiling())).unwrap();
        assert_eq!(response.charged, Some(120_000_001));
        assert_eq!(response.usage["costUsd"], "0.100000000000000001");
        assert_eq!(
            observe(
                br#"{"id":"gen-missing","choices":[]}"#,
                MODEL,
                Some(&TokenPrices::openrouter_ceiling())
            )
            .unwrap()
            .charged,
            None
        );
    }

    #[test]
    fn malformed_usage_preserves_generation_for_automatic_attribution() {
        let observed = observe(
            br#"{"id":"recover-me","choices":[],"usage":"invalid"}"#,
            "model",
            None,
        )
        .unwrap();
        assert_eq!(observed.generation, "recover-me");
        assert_eq!(observed.charged, None);
    }

    #[test]
    fn returned_cost_precedes_token_table_and_invalid_cost_cannot_fall_back() {
        let prices = TokenPrices::openrouter_ceiling();
        let charged = observe(
            br#"{"id":"priority","usage":{"cost":0.01,"prompt_tokens":1,"completion_tokens":1}}"#,
            "model",
            Some(&prices),
        )
        .unwrap()
        .charged;
        assert_eq!(charged, Some(12_000_000));
        for cost in ["null", "-1", "\"0.01\""] {
            let bytes = format!(
                r#"{{"id":"invalid","usage":{{"cost":{cost},"prompt_tokens":1,"completion_tokens":1}}}}"#
            );
            assert_eq!(
                observe(bytes.as_bytes(), "model", Some(&prices))
                    .unwrap()
                    .charged,
                None
            );
        }
        assert_eq!(
            observe(
                br#"{"id":"no-table","usage":{"prompt_tokens":1,"completion_tokens":1}}"#,
                "model",
                None
            )
            .unwrap()
            .charged,
            None
        );
    }

    #[test]
    fn attribution_survives_inference_key_rotation() {
        let mut upstream = Upstream::fake("http://127.0.0.1:1".into(), Duration::from_secs(1));
        let account = uuid::Uuid::new_v4();
        let mut before = json!({});
        upstream.attribute_customer(&mut before, account).unwrap();
        upstream.key = Zeroizing::new("rotated-synthetic-inference-key".into());
        let mut after = json!({});
        upstream.attribute_customer(&mut after, account).unwrap();
        assert_eq!(before["user"], after["user"]);
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

    fn managed(value: Value) -> ManagedRequest {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn a_scout_session_that_has_used_tools_is_admitted_with_a_bounded_hold() {
        // 100 shell rounds of 3 KB: 203 messages and 20 real tools, well past 64 KiB.
        let value = scout_session::request(uuid::Uuid::new_v4(), uuid::Uuid::new_v4(), 100, 3_000);
        assert!(value.to_string().len() > 64 * 1024);
        let (body, reserve) = managed(value)
            .upstream_body(
                MODEL,
                true,
                Some(&TokenPrices::openrouter_ceiling()),
                DEFAULT_CONTEXT_TOKENS,
            )
            .unwrap();
        assert_eq!(body["messages"].as_array().unwrap().len(), 203);
        assert!((1..=400_000_000).contains(&reserve), "{reserve}");
    }

    #[test]
    fn the_largest_admitted_body_holds_no_more_than_the_ledger_allows() {
        // One message of 1,000,000 bytes: the body cap is 1 MiB.
        let value = json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
            "messages":[{"role":"user","content":"x".repeat(1_000_000)}]});
        let (_, reserve) = managed(value)
            .upstream_body(
                MODEL,
                true,
                Some(&TokenPrices::openrouter_ceiling()),
                DEFAULT_CONTEXT_TOKENS,
            )
            .unwrap();
        // A prompt cannot outgrow the model's window, so that is all the hold
        // covers: 262,144 prompt tokens and a full reply at the price ceiling.
        assert_eq!(reserve, 339_148_800);
        let over = json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
            "messages":[{"role":"user","content":"x".repeat(1024 * 1024)}]});
        assert!(managed(over)
            .upstream_body(
                MODEL,
                true,
                Some(&TokenPrices::openrouter_ceiling()),
                DEFAULT_CONTEXT_TOKENS
            )
            .is_err());
    }

    #[test]
    fn long_sessions_may_carry_a_thousand_messages_and_no_more() {
        let session = |count: usize| {
            json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
                "messages":(0..count).map(|_| json!({"role":"user","content":"hi"})).collect::<Vec<_>>()})
        };
        let ceiling = TokenPrices::openrouter_ceiling();
        assert!(managed(session(1024))
            .upstream_body(MODEL, true, Some(&ceiling), DEFAULT_CONTEXT_TOKENS)
            .is_ok());
        assert!(managed(session(1025))
            .upstream_body(MODEL, true, Some(&ceiling), DEFAULT_CONTEXT_TOKENS)
            .is_err());
    }

    #[test]
    fn a_free_model_priced_at_zero_still_gets_a_positive_hold() {
        // A zero price passes startup validation, so it must not turn every
        // request into "unsupported" by holding nothing.
        let prices = TokenPrices {
            input_nanousd_per_million: "0".into(),
            output_nanousd_per_million: "0".into(),
        };
        let upstream = Upstream::fake_direct("https://upstream.invalid".into(), prices);
        let value = json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
            "messages":[{"role":"user","content":"Hello Colony"}]});
        let (_, reserve) = upstream.request(&managed(value)).unwrap();
        assert!(reserve >= 1, "{reserve}");
    }

    #[test]
    fn the_models_context_window_is_bounded_so_its_hold_always_fits_the_ledger() {
        let policy = || {
            Policy::new(
                MODEL,
                vec![MODEL.into()],
                true,
                Some("synthetic-customer-hmac-key-at-least-32-bytes".into()),
            )
            .unwrap()
        };
        let build = |context: i64| {
            Upstream::new(
                "synthetic-test-key".into(),
                "https://upstream.invalid".into(),
                Duration::from_secs(1),
                MODEL.into(),
                true,
                Some(TokenPrices::openrouter_ceiling()),
                policy(),
                context,
            )
        };
        assert!(build(8191).is_err());
        assert!(build(MAX_CONTEXT_TOKENS + 1).is_err());
        // The widest window the relay accepts still holds under the ledger cap.
        let widest = build(MAX_CONTEXT_TOKENS).unwrap();
        let value = json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
            "messages":[{"role":"user","content":"x".repeat(1_000_000)}]});
        let (_, reserve) = widest.request(&managed(value)).unwrap();
        assert_eq!(reserve, 398_976_000);
    }
}
