//! Bounded, credential-safe provider verification for onboarding.

use serde::Serialize;
use serde_json::json;

use crate::managed_agents::{validate_global_config, GlobalAgentConfig};

/// Safe outcomes. Provider bodies and credentials never cross back into the UI.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum AiConnectionResult {
    Connected,
    KeyRejected,
    InsufficientBalance,
    NetworkFailure,
    UnknownModel,
    MissingConfiguration,
    UnsupportedProvider,
    ProviderFailure,
}

fn status_result(status: u16) -> AiConnectionResult {
    match status {
        401 | 403 => AiConnectionResult::KeyRejected,
        402 => AiConnectionResult::InsufficientBalance,
        404 => AiConnectionResult::UnknownModel,
        _ => AiConnectionResult::ProviderFailure,
    }
}

/// Make one tool-free request with a 20-second total budget. This does not save.
#[tauri::command]
pub async fn test_ai_connection(config: GlobalAgentConfig) -> AiConnectionResult {
    if validate_global_config(&config).is_err() {
        return AiConnectionResult::MissingConfiguration;
    }
    let provider = config.provider.as_deref().unwrap_or_default();
    let model = config.model.as_deref().unwrap_or_default().trim();
    let (key_name, base_name, default_base, path) = match provider {
        "anthropic" => (
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_BASE_URL",
            "https://api.anthropic.com",
            "/v1/messages",
        ),
        "openai" | "openai-compat" => (
            "OPENAI_COMPAT_API_KEY",
            "OPENAI_COMPAT_BASE_URL",
            "https://api.openai.com/v1",
            "/responses",
        ),
        "openrouter" => (
            "OPENROUTER_API_KEY",
            "OPENROUTER_BASE_URL",
            "https://openrouter.ai/api/v1",
            "/chat/completions",
        ),
        "deepseek" => (
            "DEEPSEEK_API_KEY",
            "DEEPSEEK_BASE_URL",
            "https://api.deepseek.com",
            "/chat/completions",
        ),
        _ => return AiConnectionResult::UnsupportedProvider,
    };
    let key = config
        .env_vars
        .get(key_name)
        .map(String::as_str)
        .unwrap_or_default()
        .trim();
    if key.is_empty() || model.is_empty() {
        return AiConnectionResult::MissingConfiguration;
    }
    let base = config
        .env_vars
        .get(base_name)
        .map(String::as_str)
        .unwrap_or(default_base);
    // Match the runtime's OpenAI Auto route and explicit endpoint override.
    let path = if provider == "openai" || provider == "openai-compat" {
        match config.env_vars.get("OPENAI_COMPAT_API").map(String::as_str) {
            Some("responses") => "/responses",
            Some("chat") => "/chat/completions",
            _ if reqwest::Url::parse(base)
                .ok()
                .and_then(|url| url.host_str().map(str::to_owned))
                .as_deref()
                == Some("api.openai.com") =>
            {
                "/responses"
            }
            _ => "/chat/completions",
        }
    } else {
        path
    };
    let body = if provider == "anthropic" {
        json!({"model": model, "max_tokens": 32, "messages": [{"role": "user", "content": "Reply OK."}]})
    } else if path == "/responses" {
        json!({"model": model, "max_output_tokens": 32, "input": "Reply OK."})
    } else {
        json!({"model": model, "max_tokens": 32, "messages": [{"role": "user", "content": "Reply OK."}]})
    };
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return AiConnectionResult::NetworkFailure;
    };
    let request = client
        .post(format!("{}{path}", base.trim_end_matches('/')))
        .json(&body);
    let request = if provider == "anthropic" {
        request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
    } else {
        request.bearer_auth(key)
    };
    let Ok(mut response) = request.send().await else {
        return AiConnectionResult::NetworkFailure;
    };
    if !response.status().is_success() {
        return status_result(response.status().as_u16());
    }
    // Bound response capture even when a provider ignores the output token cap.
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 64 * 1024 => {
                bytes.extend_from_slice(&chunk)
            }
            Ok(Some(_)) => return AiConnectionResult::ProviderFailure,
            Ok(None) => break,
            Err(_) => return AiConnectionResult::NetworkFailure,
        }
    }
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return AiConnectionResult::ProviderFailure;
    };
    let response_field = if provider == "anthropic" {
        "content"
    } else if path == "/responses" {
        "output"
    } else {
        "choices"
    };
    if value.get("error").is_none()
        && value
            .get(response_field)
            .and_then(serde_json::Value::as_array)
            .is_some_and(|items| !items.is_empty())
    {
        AiConnectionResult::Connected
    } else {
        AiConnectionResult::ProviderFailure
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn http_failures_have_distinct_safe_outcomes() {
        assert_eq!(status_result(401), AiConnectionResult::KeyRejected);
        assert_eq!(status_result(403), AiConnectionResult::KeyRejected);
        assert_eq!(status_result(402), AiConnectionResult::InsufficientBalance);
        assert_eq!(status_result(404), AiConnectionResult::UnknownModel);
        assert_eq!(status_result(500), AiConnectionResult::ProviderFailure);
    }

    #[tokio::test]
    async fn production_probe_uses_the_draft_and_classifies_real_http_responses() {
        for (status, body, expected) in [
            (
                200,
                r#"{"choices":[{"message":{"content":"OK"}}]}"#,
                AiConnectionResult::Connected,
            ),
            (
                401,
                "credential response must not leak",
                AiConnectionResult::KeyRejected,
            ),
            (403, "denied", AiConnectionResult::KeyRejected),
            (402, "no credits", AiConnectionResult::InsufficientBalance),
            (404, "model missing", AiConnectionResult::UnknownModel),
            (
                200,
                r#"{"error":{"message":"failed"}}"#,
                AiConnectionResult::ProviderFailure,
            ),
        ] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("stub listener");
            let address = listener.local_addr().expect("stub address");
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.expect("request");
                let mut captured = vec![0; 4096];
                let length = stream.read(&mut captured).await.expect("request bytes");
                let request = String::from_utf8_lossy(&captured[..length]);
                assert!(request.starts_with("POST /chat/completions"));
                assert!(request.contains("fixture-model"));
                assert!(request.contains("fixture-key"));
                assert!(!request.contains("\"tools\""));
                let response = format!("HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream
                    .write_all(response.as_bytes())
                    .await
                    .expect("response");
            });
            let config = GlobalAgentConfig {
                provider: Some("openrouter".into()),
                model: Some("fixture-model".into()),
                env_vars: std::collections::BTreeMap::from([
                    ("OPENROUTER_API_KEY".into(), "fixture-key".into()),
                    ("OPENROUTER_BASE_URL".into(), format!("http://{address}")),
                ]),
                ..Default::default()
            };
            assert_eq!(test_ai_connection(config).await, expected);
            server.await.expect("stub completed");
        }
    }

    #[tokio::test]
    async fn production_probe_reports_network_failure() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("stub listener");
        let address = listener.local_addr().expect("stub address");
        drop(listener);
        let config = GlobalAgentConfig {
            provider: Some("openrouter".into()),
            model: Some("fixture-model".into()),
            env_vars: std::collections::BTreeMap::from([
                ("OPENROUTER_API_KEY".into(), "fixture-key".into()),
                ("OPENROUTER_BASE_URL".into(), format!("http://{address}")),
            ]),
            ..Default::default()
        };
        assert_eq!(
            test_ai_connection(config).await,
            AiConnectionResult::NetworkFailure
        );
    }
}
