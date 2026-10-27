//! Private, keyless Colony managed-session inference. Never a generic provider URL.

use base64::{engine::general_purpose::STANDARD, Engine};
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag};
use reqwest::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;

use crate::types::AgentError;

/// Largest request body the relay takes (its `MAX_BODY` is 1 MiB), less 4 KiB
/// because the relay adds its routing fields to what it forwards upstream.
///
/// A Scout session carries about 47 KB of prompt and tool definitions before its
/// first message, and the agent keeps up to 200k tokens of history (roughly
/// 600 KB) before it summarises, so the old 64 KiB refused every session after
/// its first tool result.
const MAX_BODY_BYTES: usize = 1024 * 1024 - 4096;
/// Most messages in one request (the relay's `MAX_MESSAGES`).
const MAX_MESSAGES: usize = 1024;
/// Stands in for a part the text-only gateway cannot carry, such as a screenshot.
const OMITTED_PART: &str =
    "[An image was part of this result. Colony credits carry text only, so it is not included.]";

/// Safe, terminal failures from the private credits operation. No provider bodies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreditRefusal {
    /// The available balance cannot fund the request.
    OutOfCredits,
    /// An account or session has reached its concurrency limit.
    Busy,
    /// A send may have incurred usage. Never automatically replay the turn.
    Recovering,
    /// A previous request was settled but its output was lost.
    AlreadyCompleted,
    /// Owner authorization must be renewed by restarting the agent.
    Unauthorized,
    /// The deployment-wide daily spend ceiling was reached. Not the person's fault.
    DailyLimit,
    /// Gateway is disabled, unconfigured or temporarily unavailable.
    Unavailable,
    /// The bounded text/function contract cannot represent this input.
    Unsupported,
}

impl std::fmt::Display for CreditRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::OutOfCredits => "Out of credits. Top up to keep your Colony Agent working.",
            Self::Busy => "Your Colony Agents are busy. Try again shortly.",
            Self::Recovering => "Usage is being recovered automatically. This turn was stopped; do not resend it automatically.",
            Self::AlreadyCompleted => "This request was already charged. Its response could not be recovered. Start a new conversation turn.",
            Self::Unauthorized => "Managed session expired or unauthorized. Restart your Colony Agent.",
            Self::DailyLimit => "Colony AI has reached its limit for today. Try again tomorrow, or connect Claude Code, Codex or an OpenRouter key in Settings > Agents.",
            Self::Unavailable => "Colony credits are unavailable. Try again later.",
            Self::Unsupported => "Colony credits currently support bounded text and function tools. This input cannot be sent.",
        })
    }
}

/// Convert a workspace relay URL to its strict same-origin HTTP gateway root.
/// Plain HTTP is permitted only for loopback development relays.
pub fn gateway_origin(relay: &str) -> Result<String, CreditRefusal> {
    let mut url = url::Url::parse(relay).map_err(|_| CreditRefusal::Unavailable)?;
    let scheme = match url.scheme() {
        "wss" | "https" => "https",
        "ws" | "http" if matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) => {
            "http"
        }
        _ => return Err(CreditRefusal::Unavailable),
    };
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(CreditRefusal::Unavailable);
    }
    let scheme = scheme.to_owned();
    url.set_scheme(&scheme)
        .map_err(|_| CreditRefusal::Unavailable)?;
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

// Deliberately no Debug: contains the existing managed relay identity.
pub(crate) struct CreditsGateway {
    http: Client,
    url: String,
    session: Uuid,
    keys: Keys,
    auth_tag: Option<String>,
}

impl CreditsGateway {
    pub(crate) fn from_env() -> Result<Self, AgentError> {
        let env =
            |key| std::env::var(key).map_err(|_| AgentError::Credits(CreditRefusal::Unauthorized));
        if std::env::var("COLONY_CREDITS_GATEWAY").ok().as_deref() != Some("1") {
            return Err(AgentError::Credits(CreditRefusal::Unavailable));
        }
        Self::new(
            &env("BUZZ_RELAY_URL")?,
            &env("COLONY_CREDITS_SESSION_ID")?,
            Keys::parse(&env("BUZZ_PRIVATE_KEY")?)
                .map_err(|_| AgentError::Credits(CreditRefusal::Unauthorized))?,
            std::env::var("BUZZ_AUTH_TAG").ok(),
        )
    }

    pub(crate) fn new(
        relay: &str,
        session: &str,
        keys: Keys,
        auth_tag: Option<String>,
    ) -> Result<Self, AgentError> {
        let origin = gateway_origin(relay).map_err(AgentError::Credits)?;
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(100))
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .map_err(|_| AgentError::Credits(CreditRefusal::Unavailable))?;
        Ok(Self {
            http,
            url: format!("{origin}/api/credits-gateway/managed-inference"),
            session: Uuid::parse_str(session)
                .map_err(|_| AgentError::Credits(CreditRefusal::Unauthorized))?,
            keys,
            auth_tag,
        })
    }

    pub(crate) async fn complete(&self, openai: Value) -> Result<Value, AgentError> {
        let messages = text_messages(&openai["messages"]).map_err(AgentError::Credits)?;
        let tools = openai.get("tools").cloned().unwrap_or(json!([]));
        let body = fit_body(&self.session, messages, tools).map_err(AgentError::Credits)?;
        let hash = hex::encode(Sha256::digest(&body));
        let nonce = Uuid::new_v4().to_string();
        let tags = [
            vec!["u", &self.url],
            vec!["method", "POST"],
            vec!["payload", &hash],
            vec!["nonce", &nonce],
        ]
        .into_iter()
        .map(Tag::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AgentError::Credits(CreditRefusal::Unauthorized))?;
        let event = EventBuilder::new(Kind::HttpAuth, "")
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|_| AgentError::Credits(CreditRefusal::Unauthorized))?;
        let mut request = self
            .http
            .post(&self.url)
            .header(
                "authorization",
                format!("Nostr {}", STANDARD.encode(event.as_json())),
            )
            .header("content-type", "application/json")
            .body(body);
        if let Some(tag) = &self.auth_tag {
            request = request.header("x-auth-tag", tag);
        }
        // Exactly one attempt. On cancellation/timeout the relay journal owns recovery.
        let mut response = request
            .send()
            .await
            .map_err(|_| AgentError::Credits(CreditRefusal::Recovering))?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AgentError::Credits(CreditRefusal::Recovering))?
        {
            if bytes.len() + chunk.len() > 1024 * 1024 {
                return Err(AgentError::Credits(CreditRefusal::Recovering));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        let refusal = match status {
            200 => {
                return if value["choices"].is_array() {
                    Ok(value)
                } else {
                    Err(AgentError::Credits(CreditRefusal::Recovering))
                }
            }
            402 => CreditRefusal::OutOfCredits,
            401 | 403 => CreditRefusal::Unauthorized,
            409 if value["error"] == "already_completed" => CreditRefusal::AlreadyCompleted,
            409 => CreditRefusal::Recovering,
            429 => CreditRefusal::Busy,
            503 if value["code"] == "daily_limit" => CreditRefusal::DailyLimit,
            400 | 413 => {
                // The relay answers with a fixed sentence, never a provider body,
                // so it is safe to log and tells the two kinds of refusal apart.
                let reason: String = value["error"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(120)
                    .collect();
                tracing::warn!(status, %reason, "Colony credits refused the request as unsupported");
                CreditRefusal::Unsupported
            }
            _ => CreditRefusal::Unavailable,
        };
        Err(AgentError::Credits(refusal))
    }
}

/// The request body, with the oldest turns dropped when the whole conversation
/// would not fit the gateway's bounds. The agent's own history budget is far
/// larger than the gateway's body, so a long session is trimmed here rather than
/// refused. The system message stays, history restarts on a user message (a
/// tool result is never left without the call it answers), and the newest turn
/// is never cut. Refuses only when that turn alone does not fit.
fn fit_body(session: &Uuid, messages: Vec<Value>, tools: Value) -> Result<Vec<u8>, CreditRefusal> {
    let envelope = |messages: &[Value]| {
        serde_json::to_vec(&json!({
            "session_id": session, "request_id": Uuid::new_v4(),
            "messages": messages, "tools": tools,
        }))
        .map_err(|_| CreditRefusal::Unsupported)
    };
    // Sizes once, so a 16 MiB history is not serialized again for every cut.
    let fixed = envelope(&[])?.len();
    let sizes = messages
        .iter()
        .map(|message| serde_json::to_vec(message).map(|bytes| bytes.len() + 1))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| CreditRefusal::Unsupported)?;
    let pinned = usize::from(messages[0]["role"] == "system");
    let pinned_bytes: usize = sizes[..pinned].iter().sum();
    let mut suffix = vec![0usize; messages.len() + 1];
    for (i, size) in sizes.iter().enumerate().rev() {
        suffix[i] = suffix[i + 1] + size;
    }
    let fits = |start: usize| {
        fixed + pinned_bytes + suffix[start] <= MAX_BODY_BYTES
            && pinned + messages.len() - start <= MAX_MESSAGES
    };
    let start = if fits(pinned) {
        pinned
    } else {
        (pinned + 1..messages.len())
            .find(|&i| messages[i]["role"] == "user" && fits(i))
            .ok_or(CreditRefusal::Unsupported)?
    };
    if start > pinned {
        tracing::info!(
            dropped = start - pinned,
            kept = messages.len() - start,
            "Colony credits request trimmed to the gateway body limit"
        );
    }
    let kept: Vec<Value> = messages[..pinned]
        .iter()
        .chain(&messages[start..])
        .cloned()
        .collect();
    let body = envelope(&kept)?;
    if body.len() > MAX_BODY_BYTES {
        return Err(CreditRefusal::Unsupported);
    }
    Ok(body)
}

fn text_messages(value: &Value) -> Result<Vec<Value>, CreditRefusal> {
    let messages = value.as_array().ok_or(CreditRefusal::Unsupported)?;
    if messages.is_empty() {
        return Err(CreditRefusal::Unsupported);
    }
    messages
        .iter()
        .map(|message| {
            let mut result = json!({"role": message["role"], "content": message["content"]});
            if let Some(parts) = message["content"].as_array() {
                let mut text = String::new();
                for part in parts {
                    match part["type"].as_str() {
                        Some("text") => {
                            text.push_str(part["text"].as_str().ok_or(CreditRefusal::Unsupported)?)
                        }
                        // A screenshot or other non-text part is described, not
                        // sent: refusing it would fail the whole turn.
                        Some(_) => {
                            if !text.is_empty() {
                                text.push('\n');
                            }
                            text.push_str(OMITTED_PART);
                        }
                        None => return Err(CreditRefusal::Unsupported),
                    }
                }
                result["content"] = json!(text);
            }
            for key in ["tool_calls", "tool_call_id", "name"] {
                if let Some(value) = message.get(key) {
                    result[key] = value.clone();
                }
            }
            // Provider-specific reasoning signatures are not part of the Colony contract.
            if let Some(calls) = result["tool_calls"].as_array_mut() {
                for call in calls {
                    *call =
                        json!({"id": call["id"], "type": "function", "function": call["function"]});
                }
            }
            Ok(result)
        })
        .collect()
}

#[cfg(test)]
mod tests;
