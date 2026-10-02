//! Safe provider failure notices used by the prompt-result path.

use crate::acp::AcpError;

/// Return a notice only for failures that require user configuration or credit.
pub(crate) fn notice(error: &AcpError) -> Option<String> {
    let AcpError::AgentError { code, message } = error else {
        return None;
    };
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
