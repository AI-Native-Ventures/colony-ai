//! Bounded server-configured transport and exact provider cost accounting.

use std::borrow::Cow;
use std::time::Duration;

use super::credits_gateway_message::upstream_message;
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
/// Most tool definitions in one request. The agent registers at most 128 MCP
/// tools and adds its own `load_skill`, so a real session never exceeds 129;
/// the rest is headroom. The 1 MiB body cap bounds what the definitions cost.
const MAX_TOOLS: usize = 160;
/// Most tool calls in one assistant message.
const MAX_TOOL_CALLS: usize = 64;
/// Prompt tokens the hold assumes for a request when the model's own context
/// window is not configured: the free Scout model's 262,144.
const DEFAULT_CONTEXT_TOKENS: i64 = 262_144;
/// Largest context window the hold can cover. At the price ceiling the hold for
/// this many prompt tokens plus a full reply is 398,976,000 nanousd, just under
/// the 400,000,000 the ledger allows for one request.
const MAX_CONTEXT_TOKENS: i64 = 312_000;
const MAX_RESPONSE: usize = 1024 * 1024;
const MAX_OUTPUT: i64 = 4096;
/// Times a request is retried after the provider answers 429.
const RATE_LIMIT_RETRIES: usize = 3;
/// Most models one request can walk: the primary and its fallbacks.
const MAX_CHAIN: usize = 8;
/// Most of a provider's error body read to classify it, and the longest wait
/// for it. The body is never kept or logged, only sorted into a fixed code.
const ERROR_PEEK: usize = 4096;
const ERROR_PEEK_TIME: Duration = Duration::from_secs(2);

/// How `Upstream::complete` rides out a provider rate limit.
///
/// A free model is limited upstream often (a 429 on roughly half the calls in a
/// trial), and the managed client makes exactly one attempt, so without this
/// about half of all requests, the first hello included, would be refused. A 429
/// is the provider declining before it generates anything: it costs nothing and
/// the hold stays as it is, so retrying cannot bill twice. Any other status is
/// never retried.
#[derive(Clone, Copy, Debug)]
struct RetryPolicy {
    /// Wait before retry 1, 2 and 3, before jitter.
    backoff: [Duration; RATE_LIMIT_RETRIES],
    /// A provider `Retry-After` longer than this is ignored.
    retry_after_cap: Duration,
    /// Wall-clock budget for every attempt and wait of one `complete`. The
    /// managed client gives up on a request after 100 s (`CreditsGateway::new`),
    /// so this stays 10 s inside that, which is also the longest a single
    /// attempt has always been allowed to take.
    budget: Duration,
    /// Shortest attempt worth starting: no retry begins unless this much budget
    /// is left after its wait.
    min_attempt: Duration,
}

impl RetryPolicy {
    const PRODUCTION: Self = Self {
        backoff: [
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(4),
        ],
        retry_after_cap: Duration::from_secs(5),
        budget: Duration::from_secs(90),
        min_attempt: Duration::from_secs(5),
    };

    /// The same rules with waits short enough for tests to run through.
    #[cfg(test)]
    const FAST: Self = Self {
        backoff: [
            Duration::from_millis(10),
            Duration::from_millis(20),
            Duration::from_millis(40),
        ],
        retry_after_cap: Duration::from_secs(5),
        budget: Duration::from_secs(30),
        min_attempt: Duration::from_millis(10),
    };

    /// The wait before retry number `retry` (0 for the first): the backoff plus
    /// up to a quarter more of jitter, so relays limited together do not come
    /// back together, or the provider's `Retry-After` when that is longer and no
    /// more than the cap. A longer `Retry-After` is not trusted with our budget.
    fn wait(&self, retry: usize, retry_after: Option<Duration>) -> Duration {
        let base = self.backoff[retry];
        let jitter_ms = (uuid::Uuid::new_v4().as_u128() % (base.as_millis() / 4 + 1)) as u64;
        let wait = base + Duration::from_millis(jitter_ms);
        match retry_after {
            Some(after) if after <= self.retry_after_cap => wait.max(after),
            _ => wait,
        }
    }
}

/// One request to the provider that did not return a body.
enum Attempt {
    /// 429, with the provider's `Retry-After` when it sent whole seconds and a
    /// fixed code for why (see `rate_limit_reason`).
    RateLimited {
        retry_after: Option<Duration>,
        reason: &'static str,
        /// The provider's own reason, cleaned for the log (see `upstream_message`).
        message: String,
    },
    /// This model cannot serve the request but another may: it is gone or
    /// expired, or refuses the caller's access to it or its policy
    /// (`Rejected`, the provider clearly refused), or it failed with a 5xx
    /// (`Ambiguous`, it may have generated).
    Unavailable(CompletionFailure),
    /// The request would fail on every model, or ended without a clear answer.
    Failed(CompletionFailure),
}

/// A model that backs up the primary, with its own prices.
struct ChainModel {
    name: String,
    prices: Option<TokenPrices>,
}

/// A provider's reply and which model of the chain gave it, so the usage, the
/// price table and the stored metering all name the model that really answered.
pub(super) struct Answer {
    pub(super) bytes: Vec<u8>,
    model: usize,
}

/// How one request fared down the chain: what it was sent to, and how it ended.
pub(super) struct Completion {
    /// Every call made to a provider, in order, as `model(status)`: the HTTP
    /// status the provider answered, or `net` when there was none (a transport
    /// failure or a timeout). A model that was limited and asked again appears
    /// once per call.
    pub(super) tried: Vec<String>,
    pub(super) result: Result<Answer, CompletionFailure>,
}

/// Never derive Debug: the bearer must never enter logs.
pub(super) struct Upstream {
    client: Client,
    key: Zeroizing<String>,
    origin: String,
    /// The first model of the chain. The fingerprint names only this one, so
    /// adding fallbacks never fences the recovery of requests in flight.
    pub(super) model: String,
    pub(super) fingerprint: String,
    openrouter: bool,
    prices: Option<TokenPrices>,
    /// Models tried in order when the one before them cannot answer. Empty
    /// means the single-model behaviour, byte for byte.
    fallbacks: Vec<ChainModel>,
    policy: Policy,
    context_tokens: i64,
    /// Longest one attempt may take.
    timeout: Duration,
    retry: RetryPolicy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CompletionFailure {
    Rejected,
    Ambiguous,
}

impl Upstream {
    pub(super) fn from_env() -> Option<Self> {
        Self::from_vars(|name| std::env::var(name).ok())
    }

    /// The configuration read through `var`, so tests can supply it without
    /// touching the process environment. Anything wrong anywhere is `None`: the
    /// gateway stays off rather than run on a half-read setting.
    fn from_vars(var: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let origin = var("COLONY_CREDITS_UPSTREAM_BASE_URL")
            .unwrap_or_else(|| "https://openrouter.ai/api/v1".into());
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
        let key = var("COLONY_CREDITS_UPSTREAM_KEY")
            .or_else(|| openrouter.then(|| var("OPENROUTER_MASTER_KEY")).flatten())?;
        if key.trim().is_empty() {
            return None;
        }
        let model = var("COLONY_CREDITS_UPSTREAM_MODEL")
            .or_else(|| openrouter.then(|| MODEL.to_owned()))?;
        let table: Option<std::collections::HashMap<String, TokenPrices>> =
            match var("COLONY_CREDITS_MODEL_PRICES") {
                Some(table) => Some(serde_json::from_str(&table).ok()?),
                None if openrouter => None,
                None => return None,
            };
        let prices = match &table {
            Some(table) => Some(table.get(&model)?.clone()),
            None => None,
        };
        let allowed: Vec<String> = match var("COLONY_CREDITS_ALLOWED_MODELS") {
            Some(list) => serde_json::from_str(&list).ok()?,
            None => vec![MODEL.into()],
        };
        let tracking = if openrouter {
            Some(var("COLONY_CREDITS_USER_HASH_KEY")?)
        } else {
            None
        };
        let policy = Policy::new(&model, allowed, openrouter, tracking).ok()?;
        // The model's context window, in tokens. No prompt can be longer, so it
        // bounds what a request can cost and what the relay holds for it. Set it
        // when the server model's window is smaller than the default. It covers
        // the whole chain, so it must fit the smallest window in it.
        let context_tokens = match var("COLONY_CREDITS_MODEL_CONTEXT_TOKENS") {
            Some(raw) => raw.trim().parse::<i64>().ok()?,
            None => DEFAULT_CONTEXT_TOKENS,
        };
        // Models that back up the primary, as a JSON array. Unset or blank is no
        // fallback at all. Each one is held to what the primary is held to: the
        // allowed list and, where there is a price table, a price in it.
        let fallbacks = match var("COLONY_CREDITS_UPSTREAM_FALLBACK_MODELS") {
            Some(raw) if !raw.trim().is_empty() => {
                let names: Vec<String> = serde_json::from_str(&raw).ok()?;
                names
                    .into_iter()
                    .map(|name| {
                        let prices = match &table {
                            Some(table) => Some(table.get(&name)?.clone()),
                            None => None,
                        };
                        Some(ChainModel { name, prices })
                    })
                    .collect::<Option<Vec<_>>>()?
            }
            _ => Vec::new(),
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
        .ok()?
        .with_fallbacks(fallbacks)
        .ok()
    }

    /// Sets the models that back up the primary. A fallback is refused, and the
    /// gateway with it, unless it passes every check the primary passed: on the
    /// allowed list, a valid price, a sane name, and not already in the chain.
    fn with_fallbacks(mut self, fallbacks: Vec<ChainModel>) -> Result<Self, ()> {
        if fallbacks.len() >= MAX_CHAIN {
            return Err(());
        }
        for (index, fallback) in fallbacks.iter().enumerate() {
            self.policy.check_model(&fallback.name)?;
            if fallback.name.is_empty()
                || fallback.name.len() > 200
                || fallback.name == self.model
                || fallbacks[..index].iter().any(|o| o.name == fallback.name)
            {
                return Err(());
            }
            if let Some(prices) = &fallback.prices {
                prices.validate()?;
            }
            if !self.openrouter && fallback.prices.is_none() {
                return Err(());
            }
        }
        self.fallbacks = fallbacks;
        Ok(self)
    }

    /// Every model of the chain, primary first, with its prices.
    fn chain(&self) -> impl Iterator<Item = (&str, Option<&TokenPrices>)> {
        std::iter::once((self.model.as_str(), self.prices.as_ref())).chain(
            self.fallbacks
                .iter()
                .map(|fallback| (fallback.name.as_str(), fallback.prices.as_ref())),
        )
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
            fallbacks: Vec::new(),
            policy,
            context_tokens,
            timeout,
            retry: RetryPolicy::PRODUCTION,
        })
    }

    #[cfg(test)]
    pub(super) fn fake(origin: String, timeout: Duration) -> Self {
        let mut upstream = Self::new(
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
        .unwrap();
        upstream.retry = RetryPolicy::FAST;
        upstream
    }

    #[cfg(test)]
    pub(super) fn fake_direct(origin: String, prices: TokenPrices) -> Self {
        let mut upstream = Self::new(
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
        .unwrap();
        upstream.retry = RetryPolicy::FAST;
        upstream
    }

    /// A chain of fake models, the first being the primary. A direct provider
    /// needs a price for every model; OpenRouter may have none.
    #[cfg(test)]
    pub(super) fn fake_chain(
        origin: String,
        openrouter: bool,
        models: &[(&str, Option<TokenPrices>)],
    ) -> Self {
        let names: Vec<String> = models.iter().map(|(name, _)| (*name).into()).collect();
        let first = names[0].clone();
        let policy = Policy::new(
            &first,
            names,
            openrouter,
            openrouter.then(|| "synthetic-customer-hmac-key-at-least-32-bytes".into()),
        )
        .unwrap();
        let fallbacks = models[1..]
            .iter()
            .map(|(name, prices)| ChainModel {
                name: (*name).into(),
                prices: prices.clone(),
            })
            .collect();
        let mut upstream = Self::new(
            "synthetic-test-key".into(),
            origin,
            Duration::from_secs(1),
            first,
            openrouter,
            models[0].1.clone(),
            policy,
            DEFAULT_CONTEXT_TOKENS,
        )
        .unwrap()
        .with_fallbacks(fallbacks)
        .unwrap();
        upstream.retry = RetryPolicy::FAST;
        upstream
    }

    pub(super) fn request(&self, request: &ManagedRequest) -> Result<(Value, i64), Refusal> {
        for (model, _) in self.chain() {
            self.policy
                .check_model(model)
                .map_err(|_| "model_not_allowed")?;
        }
        let (body, mut reserve) = request.upstream_body(
            &self.model,
            self.openrouter,
            self.prices.as_ref(),
            self.context_tokens,
        )?;
        // OpenRouter holds at the price ceiling for every model. A direct
        // provider holds at the model's own price table, so the hold must cover
        // the dearest model that could answer, or its charge could pass the hold.
        if !self.openrouter {
            for fallback in &self.fallbacks {
                let (_, other) = request.upstream_body(
                    &fallback.name,
                    false,
                    fallback.prices.as_ref(),
                    self.context_tokens,
                )?;
                reserve = reserve.max(other);
            }
        }
        Ok((body, reserve))
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

    /// The answer read as billing evidence, under the model that gave it.
    pub(super) fn observe(&self, answer: &Answer) -> Result<ObservedResponse, ()> {
        let (model, prices) = self.chain().nth(answer.model).ok_or(())?;
        observe(&answer.bytes, model, prices)
    }

    /// The request body for chain model `index`. The primary's body is sent as
    /// it is. A fallback gets its own `model`, and the OpenAI-only route that
    /// `upstream_body` pins `MODEL` to goes with `MODEL` alone, so a model is
    /// never sent a provider pin that was written for another.
    fn body_for<'a>(&self, body: &'a Value, index: usize) -> Cow<'a, Value> {
        if index == 0 {
            return Cow::Borrowed(body);
        }
        let model = &self.fallbacks[index - 1].name;
        let mut body = body.clone();
        body["model"] = json!(model);
        if self.openrouter {
            if let Some(provider) = body.get_mut("provider").and_then(Value::as_object_mut) {
                if model == MODEL {
                    provider.insert("only".into(), json!(["openai"]));
                    provider.insert("allow_fallbacks".into(), json!(false));
                } else {
                    provider.remove("only");
                    provider.remove("allow_fallbacks");
                }
            }
        }
        Cow::Owned(body)
    }

    /// One completion, riding out provider rate limits (see `RetryPolicy`) and,
    /// when fallback models are set, moving down the chain.
    ///
    /// The chain is walked in order, once, with no wait between models: a 429 or
    /// an unavailable model sends the request to the next one at once, because
    /// another model is a different provider's capacity and waiting is for when
    /// every model is limited. A model that refuses on its own account is
    /// dropped for the rest of the request and never asked twice: it is gone
    /// (404, or a 400 naming the model), it will not serve this caller (402 or
    /// 403, for example a model offered only to some clients) or it failed with
    /// a 5xx. When models were only rate limited, the same backoff as before
    /// waits and the walk repeats over those. Only a refusal that would fail on
    /// every model is final (a bad key, a request too large or malformed), and
    /// so is an attempt that ends without a clear answer. Attempts are bounded
    /// at `RATE_LIMIT_RETRIES` plus one per model, so a limit shared by all the
    /// free models costs a handful of calls and not one per model per retry.
    /// With no fallback this is the single-model retry loop it has always been.
    pub(super) async fn complete(&self, body: &Value) -> Completion {
        let mut tried = Vec::new();
        let result = self.walk(body, &mut tried).await;
        Completion { tried, result }
    }

    async fn walk(
        &self,
        body: &Value,
        tried: &mut Vec<String>,
    ) -> Result<Answer, CompletionFailure> {
        let started = tokio::time::Instant::now();
        let mut live: Vec<usize> = (0..=self.fallbacks.len()).collect();
        let max_attempts = RATE_LIMIT_RETRIES + live.len();
        let mut attempts = 0;
        let mut waits = 0;
        // A 5xx: that model may have generated, so the end of the chain is not a
        // clear refusal and the hold is left to the durable worker.
        let mut unclear = false;
        loop {
            let mut retry_after: Option<Duration> = None;
            let mut gone = Vec::new();
            for &index in &live {
                let left = self.retry.budget.saturating_sub(started.elapsed());
                if attempts > 0 && (attempts >= max_attempts || left < self.retry.min_attempt) {
                    break;
                }
                attempts += 1;
                let (model, _) = self.chain().nth(index).ok_or(CompletionFailure::Rejected)?;
                match self
                    .attempt(model, &self.body_for(body, index), left, tried)
                    .await
                {
                    Ok(bytes) => {
                        if index > 0 {
                            tracing::info!(
                                model,
                                attempt = attempts,
                                "Colony gateway answered from a fallback model"
                            );
                        }
                        return Ok(Answer {
                            bytes,
                            model: index,
                        });
                    }
                    Err(Attempt::Failed(failure)) => return Err(failure),
                    Err(Attempt::RateLimited {
                        retry_after: after,
                        reason,
                        message,
                    }) => {
                        // The model, the count, a fixed reason code and the
                        // provider's cleaned message, never the rest of its body.
                        tracing::warn!(
                            model,
                            attempt = attempts,
                            upstream_status = 429,
                            reason,
                            upstream_message = message.as_str(),
                            "Colony gateway upstream rate limited a request"
                        );
                        retry_after = match (retry_after, after) {
                            (Some(a), Some(b)) => Some(a.min(b)),
                            (a, b) => a.or(b),
                        };
                    }
                    Err(Attempt::Unavailable(failure)) => {
                        unclear |= failure == CompletionFailure::Ambiguous;
                        gone.push(index);
                    }
                }
            }
            live.retain(|index| !gone.contains(index));
            let exhausted = if unclear {
                CompletionFailure::Ambiguous
            } else {
                CompletionFailure::Rejected
            };
            if live.is_empty() || waits == RATE_LIMIT_RETRIES || attempts >= max_attempts {
                return Err(exhausted);
            }
            let wait = self.retry.wait(waits, retry_after);
            let left = self.retry.budget.saturating_sub(started.elapsed());
            if wait.saturating_add(self.retry.min_attempt) > left {
                return Err(exhausted);
            }
            waits += 1;
            tokio::time::sleep(wait).await;
        }
    }

    async fn attempt(
        &self,
        model: &str,
        body: &Value,
        left: Duration,
        tried: &mut Vec<String>,
    ) -> Result<Vec<u8>, Attempt> {
        let sent = self
            .client
            .post(format!("{}/chat/completions", self.origin))
            .bearer_auth(self.key.as_str())
            .header("X-OpenRouter-Title", "Colony Agent")
            .timeout(self.timeout.min(left))
            .json(body)
            .send()
            .await;
        let mut response = match sent {
            Ok(response) => response,
            Err(_) => {
                tried.push(format!("{model}(net)"));
                return Err(Attempt::Failed(CompletionFailure::Ambiguous));
            }
        };
        let status = response.status().as_u16();
        tried.push(format!("{model}({status})"));
        if status == 429 {
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
                .map(Duration::from_secs);
            let platform_headers = response.headers().contains_key("x-ratelimit-limit");
            let peek = peek_error(&mut response).await;
            return Err(Attempt::RateLimited {
                retry_after,
                reason: rate_limit_reason(platform_headers, &peek),
                message: upstream_message(&peek),
            });
        }
        if !response.status().is_success() {
            // The status and the provider's own reason, cleaned of keys and cut
            // short (`upstream_message`): enough to tell a model that will not
            // serve this caller from a problem with the prompt, never the body.
            let peek = peek_error(&mut response).await;
            let message = upstream_message(&peek);
            tracing::warn!(
                model,
                upstream_status = status,
                upstream_message = message.as_str(),
                "Colony gateway upstream did not accept a request"
            );
            return Err(refusal(status, &peek));
        }
        bounded_response(response)
            .await
            .map_err(|_| Attempt::Failed(CompletionFailure::Ambiguous))
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

/// The start of a provider's error body, for sorting into a fixed code and then
/// dropping. Bounded in size and time; whatever cannot be read is empty.
async fn peek_error(response: &mut reqwest::Response) -> Vec<u8> {
    let read = async {
        let mut bytes = Vec::new();
        while bytes.len() < ERROR_PEEK {
            match response.chunk().await {
                Ok(Some(chunk)) => bytes.extend_from_slice(&chunk),
                _ => break,
            }
        }
        bytes.truncate(ERROR_PEEK);
        bytes
    };
    tokio::time::timeout(ERROR_PEEK_TIME, read)
        .await
        .unwrap_or_default()
}

/// Why a 429 happened, as one of a few fixed words, so the relay log can tell
/// OpenRouter's account-wide limit on free models (shared by every `:free`
/// model, so a fallback model cannot help) from one provider being busy (which a
/// fallback model does help). Read from the error body and headers, never logged
/// from them. The wording is OpenRouter's; a 429 that matches none of it is
/// `unknown`, and is treated like any other limit.
fn rate_limit_reason(platform_headers: bool, body: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(body).to_lowercase();
    let provider_named = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value["error"]["metadata"]["provider_name"]
                .as_str()
                .map(|name| !name.is_empty())
        })
        .unwrap_or(false);
    if text.contains("free-models-per-day") {
        "free_models_per_day"
    } else if text.contains("free-models-per-min") {
        "free_models_per_minute"
    } else if provider_named || text.contains("rate-limited upstream") {
        "provider_rate_limited"
    } else if platform_headers || text.contains("rate_limit_exceeded") {
        "account_rate_limited"
    } else {
        "unknown"
    }
}

/// What a provider's refusal means for the chain, from its status and the start
/// of its body. A refusal that says something about this model only (it is gone,
/// it will not serve this caller, it is failing) moves the request on; one that
/// would be the same on every model ends it.
///
/// - 404, and a 400 that names the model as unusable: the model is gone, expired
///   or not offered.
/// - 402 and 403: the model's access rules or policy refuse this caller (for
///   example a model offered only to agentic harnesses). A key OpenRouter
///   refuses is a 401, so these are read as that model's; if every model
///   answers one, each is asked once and the request ends as a clear refusal.
/// - 5xx: the model is failing and may have generated, so the end of the chain
///   is not a clear refusal.
/// - 401 (the key), 413 and 422 (the request is too large or malformed) and any
///   other 400 are the caller's, and would fail on every model.
/// - Any other status ends the request without a clear answer.
fn refusal(status: u16, body: &[u8]) -> Attempt {
    match status {
        402..=404 => Attempt::Unavailable(CompletionFailure::Rejected),
        400 if names_unusable_model(body) => Attempt::Unavailable(CompletionFailure::Rejected),
        400 | 401 | 413 | 422 => Attempt::Failed(CompletionFailure::Rejected),
        500.. => Attempt::Unavailable(CompletionFailure::Ambiguous),
        _ => Attempt::Failed(CompletionFailure::Ambiguous),
    }
}

/// A 400 that says the model is not one the provider can serve: about the model,
/// not the request, so another model may take it. Any other 400 is about the
/// request and would fail on every model.
fn names_unusable_model(body: &[u8]) -> bool {
    let text = String::from_utf8_lossy(body).to_lowercase();
    text.contains("not a valid model")
        || text.contains("no endpoints found")
        || (text.contains("model")
            && [
                "not available",
                "unavailable",
                "not found",
                "does not exist",
            ]
            .iter()
            .any(|phrase| text.contains(phrase)))
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

/// The rule that refused a managed request: a fixed name per check, never any
/// request content, so the relay can log which rule fired without logging a
/// prompt, a key or a value.
pub(super) type Refusal = &'static str;

impl ManagedRequest {
    fn upstream_body(
        &self,
        model: &str,
        openrouter: bool,
        prices: Option<&TokenPrices>,
        context_tokens: i64,
    ) -> Result<(Value, i64), Refusal> {
        if self.messages.is_empty() {
            return Err("messages_empty");
        }
        if self.messages.len() > MAX_MESSAGES {
            return Err("messages_over_limit");
        }
        if self.tools.len() > MAX_TOOLS {
            return Err("tools_over_limit");
        }
        let messages = self
            .messages
            .iter()
            .map(clean_message)
            .collect::<Result<Vec<_>, _>>()?;
        if self
            .tools
            .iter()
            .any(|tool| tool["type"] != "function" || !tool["function"].is_object())
        {
            return Err("tool_shape");
        }
        let mut body = json!({
            "model": model, "messages": messages, "stream": false,
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
        let bytes = serde_json::to_vec(&body).map_err(|_| "body_serialize")?;
        if bytes.len() > MAX_BODY {
            return Err("body_over_limit");
        }
        // Two tokens per serialized UTF-8 byte plus 32768 framing tokens is a
        // conservative upper bound for this text-only, bounded-message model,
        // and no prompt can exceed the model's context window, so the hold never
        // asks for more than that. max_price is USD / million tokens. Bill only
        // actual returned cost.
        let prompt_bound =
            (i64::try_from(bytes.len()).map_err(|_| "body_size")? * 2 + 32768).min(context_tokens);
        let ceiling = TokenPrices::openrouter_ceiling();
        let hold_prices = if openrouter {
            &ceiling
        } else {
            prices.ok_or("price_table_missing")?
        };
        // A model priced at zero (a free one) still holds one nanousd: the ledger
        // refuses a hold of nothing, and that must not read as an unsupported input.
        let reserve = hold_prices
            .charge(prompt_bound as u64, MAX_OUTPUT as u64)
            .map_err(|_| "hold_price")?
            .max(1);
        if !(1..=400_000_000).contains(&reserve) {
            return Err("hold_over_ledger_limit");
        }
        Ok((body, reserve))
    }
}

/// One message as the provider should see it. Text only, no multimodal content
/// or server-side plugins: function tools run inside the managed Colony Agent's
/// existing permission boundary.
///
/// An explicit `null` (or an empty list) for an optional field means the same as
/// leaving it out, and is dropped. The shipped client sends `"tool_calls": null`
/// on every system, user and tool message, and a provider would read a present
/// key as a claim about the turn.
fn clean_message(message: &Value) -> Result<Value, Refusal> {
    let mut object = message.as_object().ok_or("message_not_object")?.clone();
    if object.keys().any(|key| {
        !["role", "content", "tool_calls", "tool_call_id", "name"].contains(&key.as_str())
    }) {
        return Err("message_key_not_allowed");
    }
    for key in ["tool_calls", "tool_call_id", "name"] {
        if object.get(key).is_some_and(Value::is_null) {
            object.remove(key);
        }
    }
    if !matches!(
        object.get("role").and_then(Value::as_str),
        Some("system" | "user" | "assistant" | "tool")
    ) {
        return Err("message_role");
    }
    if !object
        .get("content")
        .is_none_or(|content| content.is_null() || content.is_string())
    {
        return Err("message_content");
    }
    if let Some(calls) = object.get("tool_calls") {
        let calls = calls.as_array().ok_or("tool_calls_not_array")?;
        if calls.len() > MAX_TOOL_CALLS {
            return Err("tool_calls_over_limit");
        }
        if calls.iter().any(|call| call["type"] != "function") {
            return Err("tool_call_type");
        }
        if calls.is_empty() {
            object.remove("tool_calls");
        }
    }
    Ok(Value::Object(object))
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

    /// The exact bytes the packaged 3.0.9 client posted. Captured from the
    /// shipped `buzz-acp connection-test` (the onboarding first hello) and from a
    /// shipped `buzz-agent` shell round, each against a loopback recorder. Every
    /// message that is not an assistant turn with calls carries `"tool_calls":
    /// null`, which no hand-built body in these tests ever had.
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
        assert!(upstream.complete(&json!({})).await.result.is_err());
        task.abort();
        let oversized = Router::new().route(
            "/chat/completions",
            post(|| async { "x".repeat(MAX_RESPONSE + 1) }),
        );
        let (origin, task) = fake_server(oversized).await;
        assert!(Upstream::fake(origin, Duration::from_secs(1))
            .complete(&json!({}))
            .await
            .result
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
        assert!(upstream.complete(&json!({})).await.result.is_err());
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

    fn admit(value: Value) -> Result<(Value, i64), ()> {
        managed(value)
            .upstream_body(
                MODEL,
                true,
                Some(&TokenPrices::openrouter_ceiling()),
                DEFAULT_CONTEXT_TOKENS,
            )
            .map_err(|_| ())
    }

    /// The forwarded messages must carry no explicit null: providers read a
    /// present `tool_calls` key as a claim about the turn.
    fn assert_no_null_fields(body: &Value) {
        for message in body["messages"].as_array().unwrap() {
            assert!(
                message.as_object().unwrap().values().all(|v| !v.is_null()),
                "{message}"
            );
        }
    }

    #[test]
    fn the_packaged_first_hello_is_admitted_and_forwarded_without_nulls() {
        // The onboarding proof of the shipped app: two messages, no tools, and
        // `"tool_calls": null` on both. The relay refused it as unsupported.
        let value: Value = serde_json::from_str(scout_session::PACKAGED_FIRST_HELLO).unwrap();
        assert!(value["messages"][0]["tool_calls"].is_null());
        assert!(value["messages"][0].get("tool_calls").is_some());
        let (body, reserve) = admit(value).unwrap();
        assert_eq!(body["messages"].as_array().unwrap().len(), 2);
        assert_no_null_fields(&body);
        assert!((1..=400_000_000).contains(&reserve), "{reserve}");
    }

    #[test]
    fn the_packaged_tool_round_is_admitted_and_keeps_its_calls() {
        let value: Value = serde_json::from_str(scout_session::PACKAGED_TOOL_ROUND).unwrap();
        let (body, _) = admit(value).unwrap();
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 4);
        assert_no_null_fields(&body);
        assert_eq!(
            messages[2]["tool_calls"][0]["function"]["name"],
            "dev__shell"
        );
        assert_eq!(messages[3]["tool_call_id"], "call_1");
        assert_eq!(body["tools"].as_array().unwrap().len(), 5);
    }

    #[test]
    fn an_empty_or_null_optional_field_means_the_same_as_an_absent_one() {
        let value = json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
            "messages":[
                {"role":"system","content":"s","tool_calls":null,"tool_call_id":null,"name":null},
                {"role":"assistant","content":"hi","tool_calls":[]},
                {"role":"user","content":"u"}]});
        let (body, _) = admit(value).unwrap();
        assert_no_null_fields(&body);
        assert!(body["messages"][1].get("tool_calls").is_none());
    }

    #[test]
    fn a_session_may_carry_every_tool_the_agent_can_register() {
        // The agent registers up to 128 MCP tools and adds `load_skill` itself.
        let tools = |count: usize| {
            (0..count)
                .map(|i| json!({"type":"function","function":{"name":format!("t{i}"),"description":"d","parameters":{"type":"object"}}}))
                .collect::<Vec<_>>()
        };
        let request = |count: usize| {
            json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
                "messages":[{"role":"user","content":"hi"}],"tools":tools(count)})
        };
        assert!(admit(request(129)).is_ok());
        assert!(admit(request(161)).is_err());
    }

    /// A provider that answers the scripted `(status, Retry-After)` pairs in
    /// order and then `after` for ever. Returns the origin, the server task and
    /// how many requests it has seen.
    async fn scripted_provider(
        script: Vec<(u16, Option<&'static str>)>,
        after: u16,
    ) -> (
        String,
        tokio::task::JoinHandle<()>,
        std::sync::Arc<std::sync::atomic::AtomicUsize>,
    ) {
        use axum::{
            http::{HeaderMap, HeaderValue, StatusCode},
            routing::post,
            Router,
        };
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        };
        let hits = Arc::new(AtomicUsize::new(0));
        let seen = hits.clone();
        let script = Arc::new(Mutex::new(std::collections::VecDeque::from(script)));
        let router = Router::new().route(
            "/chat/completions",
            post(move || {
                let seen = seen.clone();
                let script = script.clone();
                async move {
                    seen.fetch_add(1, Ordering::SeqCst);
                    let (status, retry_after) =
                        script.lock().unwrap().pop_front().unwrap_or((after, None));
                    let mut headers = HeaderMap::new();
                    if let Some(value) = retry_after {
                        headers.insert("retry-after", HeaderValue::from_static(value));
                    }
                    let body = if status == 200 {
                        r#"{"id":"gen-ok","choices":[],"usage":{"cost":0.01}}"#
                    } else {
                        r#"{"error":{"message":"scripted"}}"#
                    };
                    (StatusCode::from_u16(status).unwrap(), headers, body)
                }
            }),
        );
        let (origin, task) = fake_server(router).await;
        (origin, task, hits)
    }

    #[tokio::test]
    async fn a_rate_limited_request_is_retried_until_the_provider_answers() {
        use std::sync::atomic::Ordering;
        let (origin, task, hits) = scripted_provider(vec![(429, None), (429, None)], 200).await;
        let upstream = Upstream::fake(origin, Duration::from_secs(1));
        let answer = upstream.complete(&json!({})).await.result.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&answer.bytes).unwrap()["id"],
            "gen-ok"
        );
        // Two refusals and one answer.
        assert_eq!(hits.load(Ordering::SeqCst), 3);
        task.abort();
    }

    #[tokio::test]
    async fn a_provider_that_never_stops_limiting_gets_bounded_attempts_then_todays_refusal() {
        use std::sync::atomic::Ordering;
        let (origin, task, hits) = scripted_provider(vec![], 429).await;
        let upstream = Upstream::fake(origin, Duration::from_secs(1));
        assert_eq!(
            upstream.complete(&json!({})).await.result.err(),
            Some(CompletionFailure::Rejected)
        );
        assert_eq!(hits.load(Ordering::SeqCst), 1 + RATE_LIMIT_RETRIES);
        task.abort();
    }

    #[tokio::test]
    async fn only_a_rate_limit_is_ever_retried() {
        use std::sync::atomic::Ordering;
        for (status, failure) in [
            (400, CompletionFailure::Rejected),
            (401, CompletionFailure::Rejected),
            (402, CompletionFailure::Rejected),
            (403, CompletionFailure::Rejected),
            (404, CompletionFailure::Rejected),
            (413, CompletionFailure::Rejected),
            (422, CompletionFailure::Rejected),
            (500, CompletionFailure::Ambiguous),
            (503, CompletionFailure::Ambiguous),
        ] {
            let (origin, task, hits) = scripted_provider(vec![], status).await;
            let upstream = Upstream::fake(origin, Duration::from_secs(1));
            assert_eq!(
                upstream.complete(&json!({})).await.result.err(),
                Some(failure),
                "{status}"
            );
            assert_eq!(
                hits.load(Ordering::SeqCst),
                1,
                "{status} must not be retried"
            );
            task.abort();
        }
    }

    #[tokio::test]
    async fn a_huge_or_unreadable_retry_after_is_not_waited_for() {
        use std::sync::atomic::Ordering;
        for retry_after in ["3600", "6", "soon", "Wed, 21 Oct 2026 07:28:00 GMT"] {
            let (origin, task, hits) = scripted_provider(vec![(429, Some(retry_after))], 200).await;
            let upstream = Upstream::fake(origin, Duration::from_secs(1));
            let started = std::time::Instant::now();
            upstream.complete(&json!({})).await.result.unwrap();
            assert!(
                started.elapsed() < Duration::from_secs(2),
                "{retry_after}: waited {:?}",
                started.elapsed()
            );
            assert_eq!(hits.load(Ordering::SeqCst), 2);
            task.abort();
        }
    }

    #[tokio::test]
    async fn a_short_retry_after_is_honoured() {
        let (origin, task, _) = scripted_provider(vec![(429, Some("1"))], 200).await;
        let upstream = Upstream::fake(origin, Duration::from_secs(5));
        let started = std::time::Instant::now();
        upstream.complete(&json!({})).await.result.unwrap();
        assert!(started.elapsed() >= Duration::from_secs(1));
        assert!(started.elapsed() < Duration::from_secs(4));
        task.abort();
    }

    #[tokio::test]
    async fn no_retry_starts_when_the_budget_cannot_hold_its_wait_and_an_attempt() {
        use std::sync::atomic::Ordering;
        let (origin, task, hits) = scripted_provider(vec![], 429).await;
        let mut upstream = Upstream::fake(origin, Duration::from_secs(1));
        upstream.retry = RetryPolicy {
            budget: Duration::from_millis(50),
            backoff: [Duration::from_millis(100); RATE_LIMIT_RETRIES],
            ..RetryPolicy::FAST
        };
        assert_eq!(
            upstream.complete(&json!({})).await.result.err(),
            Some(CompletionFailure::Rejected)
        );
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        task.abort();
    }

    #[test]
    fn the_production_schedule_backs_off_one_two_four_seconds_with_jitter_and_a_capped_retry_after()
    {
        let policy = RetryPolicy::PRODUCTION;
        let mut seen = std::collections::HashSet::new();
        for _ in 0..200 {
            for (retry, base) in [1u64, 2, 4].into_iter().enumerate() {
                let wait = policy.wait(retry, None);
                assert!(
                    wait >= Duration::from_secs(base) && wait <= Duration::from_millis(base * 1250),
                    "retry {retry}: {wait:?}"
                );
                seen.insert(wait.as_millis());
            }
        }
        assert!(seen.len() > 10, "the waits carry jitter");
        // A Retry-After of five seconds or less is honoured when it is longer.
        assert_eq!(
            policy.wait(0, Some(Duration::from_secs(3))),
            Duration::from_secs(3)
        );
        assert_eq!(
            policy.wait(0, Some(Duration::from_secs(5))),
            Duration::from_secs(5)
        );
        // A longer one is ignored, however large.
        for secs in [6, 60, 3600, u64::MAX / 2] {
            assert!(policy.wait(0, Some(Duration::from_secs(secs))) <= Duration::from_millis(1250));
        }
        // It never shortens the backoff.
        assert!(policy.wait(2, Some(Duration::from_secs(1))) >= Duration::from_secs(4));
    }

    #[test]
    fn the_retry_budget_leaves_the_managed_client_room_to_receive_the_answer() {
        // `CreditsGateway::new` gives the client 100 s for a whole request.
        const CLIENT_REQUEST_TIMEOUT: Duration = Duration::from_secs(100);
        let policy = RetryPolicy::PRODUCTION;
        assert!(policy.budget + Duration::from_secs(10) <= CLIENT_REQUEST_TIMEOUT);
        // The longest waits (each the backoff plus full jitter, or the capped
        // Retry-After) still leave the last attempt its minimum.
        let worst: Duration = policy
            .backoff
            .iter()
            .map(|base| (*base + *base / 4).max(policy.retry_after_cap))
            .sum();
        assert!(worst + policy.min_attempt <= policy.budget);
    }

    #[test]
    fn a_refusal_names_the_check_that_fired_and_nothing_else() {
        // The relay logs this name on every 400, so an operator can tell which
        // rule refused a client. It is a fixed word, never request content.
        let refused = |messages: Value, tools: Value| {
            managed(
                json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
                "messages":messages,"tools":tools}),
            )
            .upstream_body(
                MODEL,
                true,
                Some(&TokenPrices::openrouter_ceiling()),
                DEFAULT_CONTEXT_TOKENS,
            )
            .unwrap_err()
        };
        let user = json!({"role":"user","content":"hi"});
        let ok = || json!([user.clone()]);
        assert_eq!(refused(json!([]), json!([])), "messages_empty");
        assert_eq!(refused(json!(["text"]), json!([])), "message_not_object");
        assert_eq!(
            refused(
                json!([{"role":"user","content":"hi","model":"x"}]),
                json!([])
            ),
            "message_key_not_allowed"
        );
        assert_eq!(
            refused(json!([{"role":"developer","content":"hi"}]), json!([])),
            "message_role"
        );
        assert_eq!(
            refused(
                json!([{"role":"user","content":[{"type":"text","text":"hi"}]}]),
                json!([])
            ),
            "message_content"
        );
        assert_eq!(
            refused(
                json!([{"role":"assistant","content":"","tool_calls":"x"}]),
                json!([])
            ),
            "tool_calls_not_array"
        );
        assert_eq!(
            refused(
                json!([{"role":"assistant","content":"","tool_calls":[{"type":"code","id":"1"}]}]),
                json!([])
            ),
            "tool_call_type"
        );
        assert_eq!(refused(ok(), json!([{"type":"web_search"}])), "tool_shape");
        assert_eq!(
            refused(
                ok(),
                json!((0..=MAX_TOOLS).map(|_| json!({})).collect::<Vec<_>>())
            ),
            "tools_over_limit"
        );
        assert_eq!(
            refused(
                json!((0..=MAX_MESSAGES).map(|_| user.clone()).collect::<Vec<_>>()),
                json!([])
            ),
            "messages_over_limit"
        );
        assert_eq!(
            refused(
                json!([{"role":"user","content":"x".repeat(MAX_BODY)}]),
                json!([])
            ),
            "body_over_limit"
        );
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

    // ---- Fallback model chain -------------------------------------------------

    /// What a fake provider answers for one model.
    #[derive(Clone, Copy)]
    enum Reply {
        /// 200 with a million prompt and a million completion tokens, and
        /// `cost` as OpenRouter's returned cost when given.
        Ok(Option<&'static str>),
        Status(u16),
        Body(u16, &'static str),
    }

    type Calls = std::sync::Arc<std::sync::Mutex<Vec<Value>>>;

    /// A provider that answers by the `model` of each request (404 for a model it
    /// was not told about) and keeps every body it was sent, in order.
    async fn model_provider(
        replies: Vec<(&'static str, Reply)>,
    ) -> (String, tokio::task::JoinHandle<()>, Calls) {
        use axum::{
            http::{HeaderMap, StatusCode},
            routing::post,
            Json, Router,
        };
        use std::sync::{Arc, Mutex};
        let calls: Calls = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        let replies = Arc::new(replies);
        let router = Router::new().route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let seen = seen.clone();
                let replies = replies.clone();
                async move {
                    let model = body["model"].as_str().unwrap_or_default().to_owned();
                    seen.lock().unwrap().push(body);
                    let reply = replies
                        .iter()
                        .find(|(name, _)| *name == model)
                        .map(|(_, reply)| *reply)
                        .unwrap_or(Reply::Status(404));
                    let text = match reply {
                        Reply::Ok(cost) => format!(
                            r#"{{"id":"gen-{model}","choices":[],"usage":{{{}"prompt_tokens":1000000,"completion_tokens":1000000}}}}"#,
                            cost.map(|c| format!(r#""cost":{c},"#)).unwrap_or_default()
                        ),
                        Reply::Status(_) => r#"{"error":{"message":"scripted"}}"#.into(),
                        Reply::Body(_, text) => text.into(),
                    };
                    let status = match reply {
                        Reply::Ok(_) => 200,
                        Reply::Status(status) | Reply::Body(status, _) => status,
                    };
                    (StatusCode::from_u16(status).unwrap(), HeaderMap::new(), text)
                }
            }),
        );
        let (origin, task) = fake_server(router).await;
        (origin, task, calls)
    }

    fn models_called(calls: &Calls) -> Vec<String> {
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|body| body["model"].as_str().unwrap_or_default().to_owned())
            .collect()
    }

    /// The body `request` builds for the primary: it names the primary model.
    fn primary_body(upstream: &Upstream) -> Value {
        json!({"model": upstream.model})
    }

    fn free_chain(origin: String, names: &[&str]) -> Upstream {
        let models: Vec<(&str, Option<TokenPrices>)> =
            names.iter().map(|name| (*name, None)).collect();
        Upstream::fake_chain(origin, true, &models)
    }

    #[tokio::test]
    async fn a_rate_limited_model_hands_the_request_to_the_next_at_once() {
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            ("free/b", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b", "free/c"]);
        let answer = upstream
            .complete(&primary_body(&upstream))
            .await
            .result
            .unwrap();
        // One try on the limited model, no wait and no retry of it, then the next.
        assert_eq!(models_called(&calls), ["free/a", "free/b"]);
        assert_eq!(answer.model, 1);
        task.abort();
    }

    #[tokio::test]
    async fn a_gone_expired_refused_or_failing_model_hands_the_request_to_the_next() {
        let invalid_model = r#"{"error":{"message":"free/a is not a valid model ID","code":400}}"#;
        let not_available =
            r#"{"error":{"message":"The model free/a is not available right now","code":400}}"#;
        let no_endpoints = r#"{"error":{"message":"No endpoints found for free/a.","code":400}}"#;
        let agentic =
            r#"{"error":{"message":"free/a is only available on agentic harnesses","code":403}}"#;
        for reply in [
            Reply::Status(404),
            Reply::Body(400, invalid_model),
            Reply::Body(400, not_available),
            Reply::Body(400, no_endpoints),
            // Access or policy of one model, not of the caller's request.
            Reply::Body(403, agentic),
            Reply::Status(403),
            Reply::Status(402),
            Reply::Status(500),
            Reply::Status(502),
            Reply::Status(503),
        ] {
            let (origin, task, calls) =
                model_provider(vec![("free/a", reply), ("free/b", Reply::Ok(Some("0")))]).await;
            let upstream = free_chain(origin, &["free/a", "free/b"]);
            let answer = upstream
                .complete(&primary_body(&upstream))
                .await
                .result
                .unwrap();
            assert_eq!(models_called(&calls), ["free/a", "free/b"]);
            assert_eq!(answer.model, 1);
            task.abort();
        }
    }

    #[tokio::test]
    async fn a_chain_skips_each_failed_model_down_to_the_one_that_answers() {
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(404)),
            ("free/b", Reply::Status(429)),
            ("free/c", Reply::Status(503)),
            ("free/d", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b", "free/c", "free/d"]);
        let answer = upstream
            .complete(&primary_body(&upstream))
            .await
            .result
            .unwrap();
        assert_eq!(
            models_called(&calls),
            ["free/a", "free/b", "free/c", "free/d"]
        );
        assert_eq!(answer.model, 3);
        task.abort();
    }

    #[tokio::test]
    async fn a_chain_that_is_all_gone_ends_in_todays_refusal_after_one_call_each() {
        let (origin, task, calls) = model_provider(vec![]).await;
        let upstream = free_chain(origin, &["free/a", "free/b", "free/c"]);
        assert_eq!(
            upstream
                .complete(&primary_body(&upstream))
                .await
                .result
                .err(),
            Some(CompletionFailure::Rejected)
        );
        assert_eq!(models_called(&calls), ["free/a", "free/b", "free/c"]);
        task.abort();
    }

    #[tokio::test]
    async fn a_chain_that_is_all_rate_limited_ends_in_todays_refusal() {
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            ("free/b", Reply::Status(429)),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        assert_eq!(
            upstream
                .complete(&primary_body(&upstream))
                .await
                .result
                .err(),
            Some(CompletionFailure::Rejected)
        );
        // Every model is asked before any wait.
        assert_eq!(&models_called(&calls)[..2], ["free/a", "free/b"]);
        task.abort();
    }

    #[tokio::test]
    async fn a_server_error_anywhere_in_the_chain_leaves_the_end_unclear() {
        // A 5xx may have generated, so the end of the chain is not a clear
        // refusal: the hold stays for the durable worker, as a single model's 5xx
        // has always left it.
        let (origin, task, _) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            ("free/b", Reply::Status(503)),
            ("free/c", Reply::Status(404)),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b", "free/c"]);
        assert_eq!(
            upstream
                .complete(&primary_body(&upstream))
                .await
                .result
                .err(),
            Some(CompletionFailure::Ambiguous)
        );
        task.abort();
    }

    #[tokio::test]
    async fn an_error_about_the_request_is_final_and_the_next_model_is_never_asked() {
        for status in [400, 401, 413, 422] {
            let (origin, task, calls) = model_provider(vec![
                ("free/a", Reply::Status(status)),
                ("free/b", Reply::Ok(Some("0"))),
            ])
            .await;
            let upstream = free_chain(origin, &["free/a", "free/b"]);
            assert_eq!(
                upstream
                    .complete(&primary_body(&upstream))
                    .await
                    .result
                    .err(),
                Some(CompletionFailure::Rejected),
                "{status}"
            );
            assert_eq!(models_called(&calls), ["free/a"], "{status}");
            task.abort();
        }
        // A 400 that is not about the model id is about the request.
        let (origin, task, calls) = model_provider(vec![
            (
                "free/a",
                Reply::Body(400, r#"{"error":{"message":"tools are malformed"}}"#),
            ),
            ("free/b", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        assert!(upstream
            .complete(&primary_body(&upstream))
            .await
            .result
            .is_err());
        assert_eq!(models_called(&calls), ["free/a"]);
        task.abort();
    }

    /// GATE-311 (29 Oct): the primary answered 429, the first fallback answered
    /// 403 "only available on agentic harnesses", and the request ended there
    /// with three free models never asked.
    #[tokio::test]
    async fn a_limited_model_then_a_model_that_refuses_access_still_reaches_the_third() {
        let (origin, task, calls) = model_provider(vec![
            (
                "free/a",
                Reply::Body(
                    429,
                    r#"{"error":{"message":"free/a is temporarily rate-limited upstream","code":429,"metadata":{"provider_name":"Poolside"}}}"#,
                ),
            ),
            (
                "free/b",
                Reply::Body(
                    403,
                    r#"{"error":{"message":"free/b is only available on agentic harnesses","code":403}}"#,
                ),
            ),
            ("free/c", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b", "free/c", "free/d"]);
        let completion = upstream.complete(&primary_body(&upstream)).await;
        assert_eq!(models_called(&calls), ["free/a", "free/b", "free/c"]);
        assert_eq!(completion.result.unwrap().model, 2);
        assert_eq!(
            completion.tried,
            ["free/a(429)", "free/b(403)", "free/c(200)"]
        );
        task.abort();
    }

    #[tokio::test]
    async fn a_401_stops_the_chain_at_once_even_after_a_limited_model() {
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            ("free/b", Reply::Status(401)),
            ("free/c", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b", "free/c"]);
        let completion = upstream.complete(&primary_body(&upstream)).await;
        assert_eq!(completion.result.err(), Some(CompletionFailure::Rejected));
        assert_eq!(models_called(&calls), ["free/a", "free/b"]);
        assert_eq!(completion.tried, ["free/a(429)", "free/b(401)"]);
        task.abort();
    }

    #[tokio::test]
    async fn a_chain_where_every_model_refuses_ends_in_todays_refusal_after_one_call_each() {
        let unavailable = r#"{"error":{"message":"The model free/d is not available","code":400}}"#;
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(403)),
            ("free/b", Reply::Status(402)),
            ("free/c", Reply::Status(404)),
            ("free/d", Reply::Body(400, unavailable)),
            ("free/e", Reply::Status(403)),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b", "free/c", "free/d", "free/e"]);
        let completion = upstream.complete(&primary_body(&upstream)).await;
        // A clear refusal everywhere: the usual 503 and the hold is released.
        assert_eq!(completion.result.err(), Some(CompletionFailure::Rejected));
        assert_eq!(
            models_called(&calls),
            ["free/a", "free/b", "free/c", "free/d", "free/e"]
        );
        assert_eq!(
            completion.tried,
            [
                "free/a(403)",
                "free/b(402)",
                "free/c(404)",
                "free/d(400)",
                "free/e(403)"
            ]
        );
        task.abort();
    }

    #[tokio::test]
    async fn a_model_that_refused_is_not_asked_again_while_another_keeps_being_limited() {
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            ("free/b", Reply::Status(403)),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        assert_eq!(
            upstream
                .complete(&primary_body(&upstream))
                .await
                .result
                .err(),
            Some(CompletionFailure::Rejected)
        );
        let called = models_called(&calls);
        assert_eq!(called.iter().filter(|m| *m == "free/b").count(), 1);
        // The limited one gets the backoff retries it always had, no more.
        assert_eq!(
            called.iter().filter(|m| *m == "free/a").count(),
            1 + RATE_LIMIT_RETRIES
        );
        task.abort();
    }

    #[test]
    fn a_refusal_is_sorted_by_who_it_is_about() {
        fn kind(attempt: Attempt) -> &'static str {
            match attempt {
                Attempt::RateLimited { .. } => "limited",
                Attempt::Unavailable(CompletionFailure::Rejected) => "moves on, clear",
                Attempt::Unavailable(CompletionFailure::Ambiguous) => "moves on, unclear",
                Attempt::Failed(CompletionFailure::Rejected) => "ends, clear",
                Attempt::Failed(CompletionFailure::Ambiguous) => "ends, unclear",
            }
        }
        let empty: &[u8] = b"";
        let model_body: &[u8] = br#"{"error":{"message":"free/a is not a valid model ID"}}"#;
        let request_body: &[u8] = br#"{"error":{"message":"tools are malformed"}}"#;
        for (status, body, expect) in [
            (402, empty, "moves on, clear"),
            (403, empty, "moves on, clear"),
            (404, empty, "moves on, clear"),
            (400, model_body, "moves on, clear"),
            (500, empty, "moves on, unclear"),
            (502, empty, "moves on, unclear"),
            (503, empty, "moves on, unclear"),
            (400, request_body, "ends, clear"),
            (400, empty, "ends, clear"),
            (401, empty, "ends, clear"),
            (413, empty, "ends, clear"),
            (422, empty, "ends, clear"),
            (302, empty, "ends, unclear"),
            (408, empty, "ends, unclear"),
        ] {
            assert_eq!(
                kind(refusal(status, body)),
                expect,
                "{status} {}",
                String::from_utf8_lossy(body)
            );
        }
    }

    #[test]
    fn a_400_moves_on_only_when_it_says_the_model_is_unusable() {
        for model in [
            r#"{"error":{"message":"x is not a valid model ID"}}"#,
            r#"{"error":{"message":"Model x is not available"}}"#,
            r#"{"error":{"message":"No endpoints found for x"}}"#,
            r#"{"error":{"message":"The model `x` does not exist"}}"#,
            r#"{"error":{"message":"model not found: x"}}"#,
            r#"{"error":{"message":"This model is currently unavailable"}}"#,
        ] {
            assert!(names_unusable_model(model.as_bytes()), "{model}");
        }
        for request in [
            r#"{"error":{"message":"tools are malformed"}}"#,
            r#"{"error":{"message":"messages.2.content must be a string"}}"#,
            // Says "not found" of something other than the model.
            r#"{"error":{"message":"tool_call_id call_1 not found in messages"}}"#,
            r#"{"error":{"message":"Invalid 'model' parameter type"}}"#,
            "",
        ] {
            assert!(!names_unusable_model(request.as_bytes()), "{request}");
        }
    }

    #[tokio::test]
    async fn a_call_that_never_got_an_answer_is_recorded_as_net() {
        // Nothing listens on port 1.
        let upstream = Upstream::fake("http://127.0.0.1:1".into(), Duration::from_secs(1));
        let completion = upstream.complete(&primary_body(&upstream)).await;
        assert_eq!(completion.result.err(), Some(CompletionFailure::Ambiguous));
        assert_eq!(completion.tried, [format!("{MODEL}(net)")]);
    }

    #[tokio::test]
    async fn a_limit_shared_by_every_model_costs_a_few_calls_not_one_per_model_per_retry() {
        let names = ["free/a", "free/b", "free/c", "free/d", "free/e"];
        let (origin, task, calls) =
            model_provider(names.iter().map(|n| (*n, Reply::Status(429))).collect()).await;
        let upstream = free_chain(origin, &names);
        assert_eq!(
            upstream
                .complete(&primary_body(&upstream))
                .await
                .result
                .err(),
            Some(CompletionFailure::Rejected)
        );
        // The retries a single model gets, plus one try for each extra model.
        assert_eq!(
            calls.lock().unwrap().len(),
            RATE_LIMIT_RETRIES + names.len()
        );
        task.abort();
    }

    #[tokio::test]
    async fn the_budget_still_stops_a_walk_that_cannot_afford_a_wait() {
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            ("free/b", Reply::Status(429)),
        ])
        .await;
        let mut upstream = free_chain(origin, &["free/a", "free/b"]);
        upstream.retry = RetryPolicy {
            budget: Duration::from_millis(50),
            backoff: [Duration::from_millis(100); RATE_LIMIT_RETRIES],
            ..RetryPolicy::FAST
        };
        assert_eq!(
            upstream
                .complete(&primary_body(&upstream))
                .await
                .result
                .err(),
            Some(CompletionFailure::Rejected)
        );
        assert_eq!(models_called(&calls), ["free/a", "free/b"]);
        task.abort();
    }

    #[tokio::test]
    async fn a_model_that_was_only_limited_is_asked_again_after_the_backoff() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        // free/a answers 429 once and then answers; free/b is gone. The walk
        // drops b, waits, and asks a again.
        let hits = Arc::new(AtomicUsize::new(0));
        let seen = hits.clone();
        let router = axum::Router::new().route(
            "/chat/completions",
            axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
                let seen = seen.clone();
                async move {
                    let model = body["model"].as_str().unwrap_or_default().to_owned();
                    if model == "free/b" {
                        return (axum::http::StatusCode::NOT_FOUND, String::new());
                    }
                    if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                        return (axum::http::StatusCode::TOO_MANY_REQUESTS, String::new());
                    }
                    (
                        axum::http::StatusCode::OK,
                        r#"{"id":"gen-a","choices":[],"usage":{"cost":0}}"#.into(),
                    )
                }
            }),
        );
        let (origin, task) = fake_server(router).await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        let answer = upstream
            .complete(&primary_body(&upstream))
            .await
            .result
            .unwrap();
        assert_eq!(answer.model, 0);
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        task.abort();
    }

    #[tokio::test]
    async fn with_no_fallback_the_request_goes_out_exactly_as_it_was_built() {
        let (origin, task, calls) = model_provider(vec![(MODEL, Reply::Ok(None))]).await;
        let upstream = Upstream::fake(origin, Duration::from_secs(1));
        assert!(upstream.fallbacks.is_empty());
        let body = json!({"model":MODEL,"messages":[{"role":"user","content":"hi"}],
            "provider":{"max_price":{"prompt":1},"only":["openai"],"allow_fallbacks":false}});
        let answer = upstream.complete(&body).await.result.unwrap();
        assert_eq!(answer.model, 0);
        assert_eq!(calls.lock().unwrap()[0], body);
        task.abort();
    }

    #[tokio::test]
    async fn each_model_is_sent_its_own_name_and_only_the_openai_model_is_pinned() {
        let request = || {
            managed(
                json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
                "messages":[{"role":"user","content":"hi"}]}),
            )
        };
        // The pinned model first, a free one behind it.
        let (origin, task, calls) = model_provider(vec![
            (MODEL, Reply::Status(429)),
            ("free/b", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &[MODEL, "free/b"]);
        let (body, _) = upstream.request(&request()).unwrap();
        upstream.complete(&body).await.result.unwrap();
        let sent = calls.lock().unwrap().clone();
        assert_eq!(sent[0]["model"], MODEL);
        assert_eq!(sent[0]["provider"]["only"], json!(["openai"]));
        assert_eq!(sent[0]["provider"]["allow_fallbacks"], false);
        assert_eq!(sent[1]["model"], "free/b");
        assert!(sent[1]["provider"].get("only").is_none());
        assert!(sent[1]["provider"].get("allow_fallbacks").is_none());
        assert_eq!(
            sent[1]["provider"]["max_price"],
            sent[0]["provider"]["max_price"]
        );
        assert_eq!(sent[1]["messages"], sent[0]["messages"]);
        task.abort();
        // A free model first, the pinned one behind it.
        let (origin, task, calls) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            (MODEL, Reply::Ok(Some("0.01"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", MODEL]);
        let (body, _) = upstream.request(&request()).unwrap();
        upstream.complete(&body).await.result.unwrap();
        let sent = calls.lock().unwrap().clone();
        assert_eq!(sent[0]["model"], "free/a");
        assert!(sent[0]["provider"].get("only").is_none());
        assert_eq!(sent[1]["model"], MODEL);
        assert_eq!(sent[1]["provider"]["only"], json!(["openai"]));
        assert_eq!(sent[1]["provider"]["allow_fallbacks"], false);
        task.abort();
    }

    #[tokio::test]
    async fn the_charge_and_the_stored_usage_name_the_model_that_answered() {
        let price = |input: &str, output: &str| TokenPrices {
            input_nanousd_per_million: input.into(),
            output_nanousd_per_million: output.into(),
        };
        let dear = price("1000000000", "2000000000");
        let free = price("0", "0");
        // Returned cost: a free model that answers is charged nothing.
        let (origin, task, _) = model_provider(vec![
            ("free/a", Reply::Status(429)),
            ("free/b", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        let observed = upstream
            .observe(
                &upstream
                    .complete(&primary_body(&upstream))
                    .await
                    .result
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(observed.charged, Some(0));
        assert_eq!(observed.usage["model"], "free/b");
        assert_eq!(observed.response["model"], "free/b");
        assert_eq!(observed.generation, "gen-free/b");
        task.abort();
        // Token table: the answering model's own prices decide the charge.
        let models = [("direct/a", Some(dear.clone())), ("direct/b", Some(free))];
        let (origin, task, _) = model_provider(vec![
            ("direct/a", Reply::Status(404)),
            ("direct/b", Reply::Ok(None)),
        ])
        .await;
        let upstream = Upstream::fake_chain(origin, false, &models);
        let observed = upstream
            .observe(
                &upstream
                    .complete(&primary_body(&upstream))
                    .await
                    .result
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(observed.charged, Some(0), "the free fallback costs nothing");
        assert_eq!(observed.usage["model"], "direct/b");
        assert_eq!(observed.usage["inputPriceNanousdPerMillion"], "0");
        task.abort();
        let (origin, task, _) = model_provider(vec![
            ("direct/a", Reply::Ok(None)),
            ("direct/b", Reply::Ok(None)),
        ])
        .await;
        let upstream = Upstream::fake_chain(origin, false, &models);
        let observed = upstream
            .observe(
                &upstream
                    .complete(&primary_body(&upstream))
                    .await
                    .result
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(observed.usage["model"], "direct/a");
        assert_eq!(observed.charged, dear.charge(1_000_000, 1_000_000).ok());
        assert!(observed.charged.is_some_and(|charged| charged > 0));
        task.abort();
    }

    #[test]
    fn a_direct_providers_hold_covers_the_dearest_model_that_could_answer() {
        let price = |input: &str, output: &str| TokenPrices {
            input_nanousd_per_million: input.into(),
            output_nanousd_per_million: output.into(),
        };
        let cheap = price("1000", "2000");
        let dear = price("1000000000", "2000000000");
        let request = managed(
            json!({"session_id":uuid::Uuid::new_v4(),"request_id":uuid::Uuid::new_v4(),
            "messages":[{"role":"user","content":"hi"}]}),
        );
        let hold = |models: &[(&str, Option<TokenPrices>)]| {
            Upstream::fake_chain("https://upstream.invalid".into(), false, models)
                .request(&request)
                .unwrap()
                .1
        };
        let alone = hold(&[("direct/a", Some(cheap.clone()))]);
        let behind_dear = hold(&[("direct/a", Some(cheap.clone())), ("direct/b", Some(dear))]);
        let behind_free = hold(&[
            ("direct/a", Some(cheap)),
            ("direct/b", Some(price("0", "0"))),
        ]);
        assert!(behind_dear > alone * 1000, "{behind_dear} vs {alone}");
        assert_eq!(behind_free, alone);
    }

    #[test]
    fn every_chain_model_must_pass_the_allowed_list_or_the_gateway_stays_off() {
        let base = [
            ("COLONY_CREDITS_UPSTREAM_KEY", "synthetic-test-key"),
            ("COLONY_CREDITS_UPSTREAM_MODEL", "free/a"),
            (
                "COLONY_CREDITS_ALLOWED_MODELS",
                r#"["free/a","free/b","free/c"]"#,
            ),
            (
                "COLONY_CREDITS_USER_HASH_KEY",
                "synthetic-customer-hmac-key-at-least-32-bytes",
            ),
        ];
        let build = |extra: &[(&str, &str)]| {
            let vars: std::collections::HashMap<String, String> = base
                .iter()
                .chain(extra)
                .map(|(k, v)| ((*k).into(), (*v).into()))
                .collect();
            Upstream::from_vars(move |name| vars.get(name).cloned())
        };
        let fallback = |value: &'static str| [("COLONY_CREDITS_UPSTREAM_FALLBACK_MODELS", value)];
        let names = |upstream: &Upstream| -> Vec<String> {
            upstream.chain().map(|(name, _)| name.to_owned()).collect()
        };
        // Unset, blank or empty: the single model of today, nothing else.
        for extra in [
            &[][..],
            &fallback("")[..],
            &fallback("  ")[..],
            &fallback("[]")[..],
        ] {
            let upstream = build(extra).unwrap();
            assert!(upstream.fallbacks.is_empty());
            assert_eq!(names(&upstream), ["free/a"]);
        }
        assert_eq!(
            names(&build(&fallback(r#"["free/b","free/c"]"#)).unwrap()),
            ["free/a", "free/b", "free/c"]
        );
        // The chain does not change what recovery is keyed on.
        assert_eq!(
            build(&fallback(r#"["free/b"]"#)).unwrap().fingerprint,
            build(&[]).unwrap().fingerprint
        );
        // One bad entry, or a bad value, and the gateway is off.
        for bad in [
            r#"["free/z"]"#,
            r#"["free/b","free/z"]"#,
            r#"["free/b","free/b"]"#,
            r#"["free/a"]"#,
            r#"[""]"#,
            r#""free/b""#,
            r#"{"free/b":1}"#,
            r#"[1]"#,
            "free/b",
        ] {
            assert!(build(&fallback(bad)).is_none(), "{bad}");
        }
        // The chain is bounded: seven fallbacks fit, eight do not.
        let many = |count: usize| {
            let ids: Vec<String> = (0..count).map(|i| format!("free/f{i}")).collect();
            let allowed = serde_json::to_string(&ids).unwrap();
            let allowed = allowed.replacen('[', r#"["free/a","#, 1);
            let vars: std::collections::HashMap<String, String> = [
                (
                    "COLONY_CREDITS_UPSTREAM_KEY",
                    "synthetic-test-key".to_owned(),
                ),
                ("COLONY_CREDITS_UPSTREAM_MODEL", "free/a".to_owned()),
                ("COLONY_CREDITS_ALLOWED_MODELS", allowed),
                (
                    "COLONY_CREDITS_USER_HASH_KEY",
                    "synthetic-customer-hmac-key-at-least-32-bytes".to_owned(),
                ),
                (
                    "COLONY_CREDITS_UPSTREAM_FALLBACK_MODELS",
                    serde_json::to_string(&ids).unwrap(),
                ),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect();
            Upstream::from_vars(move |name| vars.get(name).cloned())
        };
        assert!(many(MAX_CHAIN - 1).is_some());
        assert!(many(MAX_CHAIN).is_none());
    }

    #[test]
    fn every_chain_model_needs_a_valid_price_wherever_the_primary_does() {
        let build = |url: Option<&str>, prices: &str, fallbacks: &str| {
            let mut vars: std::collections::HashMap<String, String> = [
                ("COLONY_CREDITS_UPSTREAM_KEY", "synthetic-test-key"),
                ("COLONY_CREDITS_UPSTREAM_MODEL", "free/a"),
                ("COLONY_CREDITS_ALLOWED_MODELS", r#"["free/a","free/b"]"#),
                (
                    "COLONY_CREDITS_USER_HASH_KEY",
                    "synthetic-customer-hmac-key-at-least-32-bytes",
                ),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect();
            if let Some(url) = url {
                vars.insert("COLONY_CREDITS_UPSTREAM_BASE_URL".into(), url.into());
            }
            if !prices.is_empty() {
                vars.insert("COLONY_CREDITS_MODEL_PRICES".into(), prices.into());
            }
            vars.insert(
                "COLONY_CREDITS_UPSTREAM_FALLBACK_MODELS".into(),
                fallbacks.into(),
            );
            Upstream::from_vars(move |name| vars.get(name).cloned())
        };
        let zero = r#"{"input_nanousd_per_million":"0","output_nanousd_per_million":"0"}"#;
        let both = format!(r#"{{"free/a":{zero},"free/b":{zero}}}"#);
        let only_a = format!(r#"{{"free/a":{zero}}}"#);
        let bad = r#"{"free/a":{"input_nanousd_per_million":"0","output_nanousd_per_million":"0"},"free/b":{"input_nanousd_per_million":"x","output_nanousd_per_million":"0"}}"#;
        // OpenRouter without a table needs none; with one, every model is in it.
        assert!(build(None, "", r#"["free/b"]"#).is_some());
        assert!(build(None, &both, r#"["free/b"]"#).is_some());
        assert!(build(None, &only_a, r#"["free/b"]"#).is_none());
        assert!(build(None, bad, r#"["free/b"]"#).is_none());
        // A direct provider has no returned cost, so it always needs the table.
        let direct = Some("https://direct.example/v1");
        assert!(build(direct, &both, r#"["free/b"]"#).is_some());
        assert!(build(direct, &only_a, r#"["free/b"]"#).is_none());
        let upstream = build(direct, &both, r#"["free/b"]"#).unwrap();
        assert!(upstream.chain().all(|(_, prices)| prices.is_some()));
    }

    #[tokio::test]
    async fn a_429_is_sorted_into_a_fixed_reason_from_the_provider_body() {
        let day = r#"{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day","metadata":{"headers":{"X-RateLimit-Limit":"50"}}}}"#;
        let minute =
            r#"{"error":{"code":429,"message":"Rate limit exceeded: free-models-per-min"}}"#;
        let busy = r#"{"error":{"message":"poolside/laguna-s-2.1:free is temporarily rate-limited upstream. Please retry shortly","code":429,"metadata":{"provider_name":"Poolside","is_byok":false}}}"#;
        let platform = r#"{"error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded"}}}"#;
        for (body, reason) in [
            (day, "free_models_per_day"),
            (minute, "free_models_per_minute"),
            (busy, "provider_rate_limited"),
            (platform, "account_rate_limited"),
            (r#"{"error":"slow down"}"#, "unknown"),
            ("", "unknown"),
            ("not json at all", "unknown"),
        ] {
            let (origin, task, _) = model_provider(vec![("free/a", Reply::Body(429, body))]).await;
            let upstream = free_chain(origin, &["free/a"]);
            let attempt = upstream
                .attempt(
                    "free/a",
                    &json!({"model":"free/a"}),
                    Duration::from_secs(1),
                    &mut Vec::new(),
                )
                .await;
            match attempt {
                Err(Attempt::RateLimited { reason: got, .. }) => assert_eq!(got, reason, "{body}"),
                _ => panic!("a 429 must be a rate limit: {body}"),
            }
            task.abort();
        }
        // OpenRouter marks a platform limit with these headers on the 429.
        assert_eq!(rate_limit_reason(true, b""), "account_rate_limited");
        assert_eq!(rate_limit_reason(false, b""), "unknown");
        // A named provider wins over the platform marker: it is that provider.
        assert_eq!(
            rate_limit_reason(true, busy.as_bytes()),
            "provider_rate_limited"
        );
    }

    #[derive(Clone, Default)]
    struct LogBuffer(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for LogBuffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// Built here so the source holds no key-shaped literal, and leaked because
    /// a scripted reply body is `'static`.
    fn leaked(text: String) -> &'static str {
        Box::leak(text.into_boxed_str())
    }

    fn fake_key() -> String {
        format!("sk-or-v1-{}", "0a1b2c3d".repeat(8))
    }

    fn captured() -> (LogBuffer, tracing::subscriber::DefaultGuard) {
        let logs = LogBuffer::default();
        let sink = logs.clone();
        let guard = tracing::subscriber::set_default(
            tracing_subscriber::fmt()
                .with_writer(move || sink.clone())
                .with_ansi(false)
                .finish(),
        );
        (logs, guard)
    }

    fn text_of(logs: &LogBuffer) -> String {
        String::from_utf8_lossy(&logs.0.lock().unwrap()).into_owned()
    }

    /// A text field is quoted or not depending on the formatter.
    fn has(line: &str, field: &str, value: &str) -> bool {
        line.contains(&format!("{field}=\"{value}\"")) || line.contains(&format!("{field}={value}"))
    }

    #[tokio::test]
    async fn the_429_log_names_the_model_attempt_reason_and_the_cleaned_message_only() {
        let (logs, _guard) = captured();
        let busy = leaked(format!(
            r#"{{"error":{{"message":"free/a is temporarily rate-limited upstream. Retry with {}","code":429,"metadata":{{"provider_name":"Poolside","raw":"RAW-PROVIDER-TEXT"}}}}}}"#,
            fake_key()
        ));
        let (origin, task, _) = model_provider(vec![
            ("free/a", Reply::Body(429, busy)),
            ("free/b", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        upstream
            .complete(
                &json!({"model":"free/a","messages":[{"role":"user","content":"SECRET-PROMPT"}]}),
            )
            .await
            .result
            .unwrap();
        task.abort();
        let text = text_of(&logs);
        let limited = text
            .lines()
            .find(|line| line.contains("upstream rate limited a request"))
            .unwrap_or_else(|| panic!("no 429 line in {text}"));
        assert!(has(limited, "model", "free/a"), "{limited}");
        assert!(has(limited, "attempt", "1"), "{limited}");
        assert!(has(limited, "upstream_status", "429"), "{limited}");
        assert!(has(limited, "reason", "provider_rate_limited"), "{limited}");
        // The provider's own sentence, with the key it carried taken out.
        assert!(
            has(
                limited,
                "upstream_message",
                "free/a is temporarily rate-limited upstream. Retry with [removed]"
            ),
            "{limited}"
        );
        assert!(
            text.contains("answered from a fallback model") && text.contains("free/b"),
            "{text}"
        );
        // Only `error.message` is read: not the metadata, the prompt, the key we
        // send nor the one the provider echoed.
        for secret in [
            "RAW-PROVIDER-TEXT",
            "Poolside",
            "SECRET-PROMPT",
            "synthetic-test-key",
            "sk-or",
        ] {
            assert!(!text.contains(secret), "{secret} leaked into {text}");
        }
    }

    #[tokio::test]
    async fn a_refusal_log_carries_the_status_and_the_cleaned_reason_and_no_key_or_prompt() {
        let (logs, _guard) = captured();
        let refused = leaked(format!(
            r#"{{"error":{{"message":"free/a is only available on agentic harnesses. Bearer {}","code":403,"metadata":{{"raw":"RAW-PROVIDER-TEXT"}}}}}}"#,
            fake_key()
        ));
        let (origin, task, _) = model_provider(vec![
            ("free/a", Reply::Body(403, refused)),
            ("free/b", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        upstream
            .complete(
                &json!({"model":"free/a","messages":[{"role":"user","content":"SECRET-PROMPT"}]}),
            )
            .await
            .result
            .unwrap();
        task.abort();
        let text = text_of(&logs);
        let line = text
            .lines()
            .find(|line| line.contains("upstream did not accept a request"))
            .unwrap_or_else(|| panic!("no refusal line in {text}"));
        assert!(has(line, "model", "free/a"), "{line}");
        assert!(has(line, "upstream_status", "403"), "{line}");
        assert!(
            has(
                line,
                "upstream_message",
                "free/a is only available on agentic harnesses. Bearer [removed]"
            ),
            "{line}"
        );
        for secret in [
            "RAW-PROVIDER-TEXT",
            "SECRET-PROMPT",
            "synthetic-test-key",
            "sk-or",
        ] {
            assert!(!text.contains(secret), "{secret} leaked into {text}");
        }
    }

    #[tokio::test]
    async fn a_refusal_with_no_readable_message_logs_an_empty_one() {
        let (logs, _guard) = captured();
        let (origin, task, _) = model_provider(vec![
            ("free/a", Reply::Body(403, "<html>Forbidden</html>")),
            ("free/b", Reply::Ok(Some("0"))),
        ])
        .await;
        let upstream = free_chain(origin, &["free/a", "free/b"]);
        upstream
            .complete(&primary_body(&upstream))
            .await
            .result
            .unwrap();
        task.abort();
        let text = text_of(&logs);
        let line = text
            .lines()
            .find(|line| line.contains("upstream did not accept a request"))
            .unwrap_or_else(|| panic!("no refusal line in {text}"));
        assert!(has(line, "upstream_status", "403"), "{line}");
        assert!(has(line, "upstream_message", ""), "{line}");
        assert!(!text.contains("Forbidden"), "{text}");
    }
}
