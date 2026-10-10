//! Private, keyless Colony managed-session inference. Never a generic provider URL.

use base64::{engine::general_purpose::STANDARD, Engine};
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag};
use reqwest::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;

use crate::types::AgentError;

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
            Keys::parse(env("BUZZ_PRIVATE_KEY")?)
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
        let body = serde_json::to_vec(&json!({
            "session_id": self.session, "request_id": Uuid::new_v4(),
            "messages": messages, "tools": openai.get("tools").cloned().unwrap_or(json!([])),
        }))
        .map_err(|_| AgentError::Credits(CreditRefusal::Unsupported))?;
        if body.len() > 64 * 1024 {
            return Err(AgentError::Credits(CreditRefusal::Unsupported));
        }
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
            400 | 413 => CreditRefusal::Unsupported,
            _ => CreditRefusal::Unavailable,
        };
        Err(AgentError::Credits(refusal))
    }
}

fn text_messages(value: &Value) -> Result<Vec<Value>, CreditRefusal> {
    let messages = value.as_array().ok_or(CreditRefusal::Unsupported)?;
    if messages.is_empty() || messages.len() > 128 {
        return Err(CreditRefusal::Unsupported);
    }
    messages
        .iter()
        .map(|message| {
            let mut result = json!({"role": message["role"], "content": message["content"]});
            if let Some(parts) = message["content"].as_array() {
                let mut text = String::new();
                for part in parts {
                    if part["type"] != "text" {
                        return Err(CreditRefusal::Unsupported);
                    }
                    text.push_str(part["text"].as_str().ok_or(CreditRefusal::Unsupported)?);
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
