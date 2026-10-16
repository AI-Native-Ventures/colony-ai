//! Safe provider failure notices used by the prompt-result path.

use crate::acp::AcpError;

/// Return a notice only for failures that require user configuration or credit.
pub(crate) fn notice(error: &AcpError) -> Option<String> {
    let AcpError::AgentError { code, message } = error else {
        return None;
    };
    // Credits failures may include an ambiguous billed request. Stop the outer
    // harness queue too; a fresh agent attempt would allocate a fresh request id.
    if *code == -32004 {
        return Some(format!("⚠️ {}", credits_notice(message)));
    }
    if *code != -32001 && !message.starts_with("llm:") && !message.starts_with("llm auth:") {
        return None;
    }
    let body = message
        .strip_prefix("llm auth: ")
        .or_else(|| message.strip_prefix("llm: "))
        .unwrap_or(message);
    // LLM errors may carry the effective model before the provider marker.
    let body = if body.starts_with('(') {
        body.split_once(") ").map_or(body, |(_, rest)| rest)
    } else {
        body
    };
    let (provider, detail) = [
        "DeepSeek",
        "OpenRouter",
        "OpenAI",
        "Anthropic",
        "Databricks",
    ]
    .iter()
    .find_map(|label| {
        body.strip_prefix(&format!("provider={label}; "))
            .map(|rest| (*label, rest))
    })
    .unwrap_or(("The AI provider", body));
    // Match status at the error boundary, never a number inside a payload.
    let has_status = |status: &str| {
        detail.starts_with(&format!("HTTP {status}:"))
            || detail.starts_with(&format!("{status}:"))
            || detail.starts_with(&format!("{status} "))
            || detail.starts_with(&format!("API Error: {status}"))
    };
    let problem = if *code == -32001 || message.starts_with("llm auth:") || has_status("401") {
        "rejected authentication. Open Settings, Agents, defaults to update the API key, then re-send your request."
    } else if has_status("402") || detail.starts_with("OpenRouter credits exhausted") {
        "reports no credits or balance left. Add credit at the provider or choose another provider in Settings, Agents, defaults, then re-send your request."
    } else if has_status("403") {
        "denied permission. Check the API key and model access in Settings, Agents, defaults, or choose another provider, then re-send your request."
    } else {
        return None;
    };
    let provider = if detail.starts_with("OpenRouter credits exhausted") {
        "OpenRouter"
    } else {
        provider
    };
    Some(format!("⚠️ {provider} {problem}"))
}

/// Message prefix for a session refused because its required model is gone.
pub(crate) const FREE_MODEL_ENDED_PREFIX: &str = "free model ended: ";

/// Channel notice when Start free's model is no longer offered.
pub(crate) fn free_model_ended_notice(error: &AcpError) -> Option<String> {
    match error {
        AcpError::AgentError {
            code: -32002,
            message,
        } if message.starts_with(FREE_MODEL_ENDED_PREFIX) => Some(
            "⚠️ Free AI has ended. OpenCode no longer offers the free model. Connect your own AI in Settings, then re-send your request.".to_string(),
        ),
        _ => None,
    }
}

/// Recovery copy for an interrupted paid turn whose outcome is ambiguous.
pub(crate) fn credits_interrupted_notice() -> &'static str {
    "⚠️ This Colony credits turn stopped before its result was confirmed. Usage may be recovering automatically. Automatic replay was stopped; check your balance before starting a new turn."
}

fn credits_notice(message: &str) -> &'static str {
    match message {
        "Out of credits. Top up to keep your Colony Agent working." => "Out of credits. Top up to keep your Colony Agent working.",
        "Your Colony Agents are busy. Try again shortly." => "Your Colony Agents are busy. Try again shortly.",
        "Usage is being recovered automatically. This turn was stopped; do not resend it automatically." => "Usage is being recovered automatically. This turn was stopped; do not resend it automatically.",
        "This request was already charged. Its response could not be recovered. Start a new conversation turn." => "This request was already charged. Its response could not be recovered. Start a new conversation turn.",
        "Managed session expired or unauthorized. Restart your Colony Agent." => "Managed session expired or unauthorized. Restart your Colony Agent.",
        "Colony credits are unavailable. Try again later." => "Colony credits are unavailable. Try again later.",
        "Colony credits currently support bounded text and function tools. This input cannot be sent." => "Colony credits currently support bounded text and function tools. This input cannot be sent.",
        _ => "Colony credits could not complete this turn. Automatic replay was stopped. Check your balance and restart your Colony Agent if needed.",
    }
}

/// Map provider failures to a dedicated onboarding recovery action without chat decoration.
pub(crate) fn onboarding_notice(error: &AcpError) -> Option<String> {
    if let AcpError::AgentError {
        code: -32004,
        message,
    } = error
    {
        return Some(credits_notice(message).to_owned());
    }
    let notice = notice(error)?;
    if notice.contains("rejected authentication") {
        Some("The provider rejected authentication. Sign in again or update your provider connection, then retry the test.".into())
    } else if notice.contains("no credits or balance") {
        Some("The provider has no usage balance available. Add usage at the provider or choose another connection, then retry the test.".into())
    } else {
        Some("The provider denied model access. Check access or choose another model, then retry the test.".into())
    }
}

/// Keep upstream payloads out of the eventual notice after transient retries.
pub(crate) fn retry_reason(error: &AcpError) -> Option<&'static str> {
    let AcpError::AgentError { message, .. } = error else {
        return None;
    };
    (message.starts_with("llm:") || message.starts_with("llm auth:"))
        .then_some("the AI provider rejected the request or is temporarily unavailable. Check the provider status and your configuration in Settings, Agents, defaults")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permanent_statuses_are_terminal_and_transient_statuses_are_retryable() {
        for status in [401, 402, 403, 429, 500, 502, 503] {
            let error = AcpError::AgentError {
                code: -32000,
                message: format!("llm: (model) provider=DeepSeek; HTTP {status}: private payload"),
            };
            let result = notice(&error);
            assert_eq!(result.is_some(), matches!(status, 401..=403), "{status}");
            if let Some(copy) = result {
                assert!(copy.contains("DeepSeek"));
                assert!(copy.contains("Settings, Agents, defaults"));
                assert!(!copy.contains("private payload"));
            }
        }
    }

    #[test]
    fn auth_code_and_legacy_credit_errors_are_terminal() {
        for (code, message, expected) in [
            (
                -32001,
                "llm auth: provider=OpenRouter; sensitive body",
                "OpenRouter rejected authentication",
            ),
            (
                -32000,
                "llm: (model) OpenRouter credits exhausted",
                "OpenRouter reports no credits or balance left",
            ),
            (
                -32000,
                "llm: 402 Payment Required: sensitive body",
                "The AI provider reports no credits or balance left",
            ),
        ] {
            let copy = notice(&AcpError::AgentError {
                code,
                message: message.into(),
            })
            .unwrap();
            assert!(copy.contains(expected));
            assert!(!copy.contains("sensitive body"));
        }
        assert!(notice(&AcpError::AgentError {
            code: -32000,
            message: "llm: 500: payload quotes 402 or 401".into(),
        })
        .is_none());
        assert!(notice(&AcpError::WriteTimeout(std::time::Duration::from_secs(1))).is_none());
    }
}

#[cfg(test)]
mod free_model_tests {
    use super::*;

    #[test]
    fn free_model_ended_notice_text() {
        let error = AcpError::AgentError {
            code: -32002,
            message: format!("{FREE_MODEL_ENDED_PREFIX}opencode/deepseek-v4.1-flash-free"),
        };
        assert_eq!(
            free_model_ended_notice(&error).as_deref(),
            Some("⚠️ Free AI has ended. OpenCode no longer offers the free model. Connect your own AI in Settings, then re-send your request.")
        );
    }

    #[test]
    fn other_model_errors_are_not_free_model_ended() {
        let error = AcpError::AgentError {
            code: -32002,
            message: "model not found: gpt-x".into(),
        };
        assert!(free_model_ended_notice(&error).is_none());
    }
}
