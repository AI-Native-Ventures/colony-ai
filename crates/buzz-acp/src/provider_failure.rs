//! Safe provider failure notices used by the prompt-result path.

use std::{
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use crate::acp::AcpError;

/// Plain copy for OpenCode's daily free-model quota running out. The same words
/// reach the Connect test, the agent's last-error line and the conversation.
pub(crate) const FREE_LIMIT_COPY: &str = "Today's free AI limit is used up. Connect your own AI in Settings > Agents, or try again later.";

/// Stable machine code the Connect test returns next to `FREE_LIMIT_COPY`.
pub(crate) const FREE_LIMIT_CODE: &str = "free_limit_reached";

/// What OpenCode reports when the free quota is gone: `AI_APICallError: Free
/// usage limit reached. Free models work in OpenCode (...); subscribe to
/// OpenCode Go to keep going`.
const FREE_LIMIT_PHRASE: &str = "free usage limit reached";

/// True when `text` is (or quotes) OpenCode's free-quota-used-up error.
pub(crate) fn is_free_limit_text(text: &str) -> bool {
    text.to_ascii_lowercase().contains(FREE_LIMIT_PHRASE)
}

/// How much of a log file's end is searched for the quota error.
const LOG_TAIL_BYTES: u64 = 32 * 1024;
/// Only the newest few logs can belong to the failing run.
const LOG_FILES_CHECKED: usize = 3;

fn opencode_log_dir() -> Option<PathBuf> {
    let data = std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
        })?;
    Some(data.join("opencode").join("log"))
}

fn log_tail_shows_free_limit(path: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
        return false;
    };
    if file
        .seek(SeekFrom::Start(length.saturating_sub(LOG_TAIL_BYTES)))
        .is_err()
    {
        return false;
    }
    let mut bytes = Vec::new();
    if file.take(LOG_TAIL_BYTES).read_to_end(&mut bytes).is_err() {
        return false;
    }
    is_free_limit_text(&String::from_utf8_lossy(&bytes))
}

fn log_dir_shows_free_limit(dir: &Path, max_age: Duration, now: SystemTime) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut recent: Vec<(SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !matches!(path.extension().and_then(|ext| ext.to_str()), Some("log")) {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            (now.duration_since(modified).unwrap_or_default() <= max_age)
                .then_some((modified, path))
        })
        .collect();
    recent.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    recent
        .into_iter()
        .take(LOG_FILES_CHECKED)
        .any(|(_, path)| log_tail_shows_free_limit(&path))
}

/// OpenCode writes API failures to its own log and can leave the ACP stream
/// silent, so a failure with no explanation is checked against the end of its
/// recently written logs. `max_age` is how far back the failing turn began.
pub(crate) fn opencode_log_shows_free_limit(max_age: Duration) -> bool {
    opencode_log_dir().is_some_and(|dir| log_dir_shows_free_limit(&dir, max_age, SystemTime::now()))
}

/// Return a notice only for failures that require user configuration or credit.
pub(crate) fn notice(error: &AcpError) -> Option<String> {
    let AcpError::AgentError { code, message } = error else {
        return None;
    };
    if is_free_limit_text(message) {
        return Some(format!("⚠️ {FREE_LIMIT_COPY}"));
    }
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
        "Colony AI has reached its limit for today. Try again tomorrow, or connect Claude Code, Codex or an OpenRouter key in Settings > Agents." => "Colony AI has reached its limit for today. Try again tomorrow, or connect Claude Code, Codex or an OpenRouter key in Settings > Agents.",
        "Colony credits are unavailable. Try again later." => "Colony credits are unavailable. Try again later.",
        "Colony credits currently support bounded text and function tools. This input cannot be sent." => "Colony credits currently support bounded text and function tools. This input cannot be sent.",
        _ => "Colony credits could not complete this turn. Automatic replay was stopped. Check your balance and restart your Colony Agent if needed.",
    }
}

/// Map provider failures to a dedicated onboarding recovery action without chat decoration.
pub(crate) fn onboarding_notice(error: &AcpError) -> Option<String> {
    if matches!(error, AcpError::AgentError { message, .. } if is_free_limit_text(message)) {
        return Some(FREE_LIMIT_COPY.to_owned());
    }
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

#[cfg(test)]
mod free_limit_tests {
    use super::*;

    /// The text OpenCode wrote to its log when the free quota ran out.
    const OPENCODE_ERROR: &str = "AI_APICallError: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going";

    #[test]
    fn the_opencode_quota_error_is_recognised_whatever_wraps_it() {
        assert!(is_free_limit_text(OPENCODE_ERROR));
        assert!(is_free_limit_text(&format!("llm: {OPENCODE_ERROR}")));
        assert!(is_free_limit_text(&OPENCODE_ERROR.to_uppercase()));
        assert!(!is_free_limit_text("llm: HTTP 500: Internal Server Error"));
        assert!(!is_free_limit_text("Free AI has ended"));
    }

    #[test]
    fn a_conversation_reply_failure_says_so_in_plain_words() {
        for code in [-32603, -32000, -32001, -32002] {
            let error = AcpError::AgentError {
                code,
                message: OPENCODE_ERROR.into(),
            };
            assert_eq!(
                notice(&error).as_deref(),
                Some("⚠️ Today's free AI limit is used up. Connect your own AI in Settings > Agents, or try again later."),
                "code {code}"
            );
        }
    }

    #[test]
    fn the_connect_test_gets_the_same_words_without_decoration() {
        let error = AcpError::AgentError {
            code: -32603,
            message: OPENCODE_ERROR.into(),
        };
        assert_eq!(
            onboarding_notice(&error).as_deref(),
            Some("Today's free AI limit is used up. Connect your own AI in Settings > Agents, or try again later.")
        );
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "colony-free-limit-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_nanos())
        ));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn a_silent_failure_is_explained_by_the_end_of_a_recent_opencode_log() {
        let dir = scratch_dir("recent");
        std::fs::write(
            dir.join("2026-10-25T080000.log"),
            format!("INFO started\nERROR {OPENCODE_ERROR}\n"),
        )
        .expect("write log");
        let now = SystemTime::now();
        assert!(log_dir_shows_free_limit(&dir, Duration::from_secs(60), now));
        // Written long before the failing turn began: not this failure.
        assert!(!log_dir_shows_free_limit(
            &dir,
            Duration::from_secs(60),
            now + Duration::from_secs(3600)
        ));
        std::fs::remove_dir_all(&dir).expect("remove scratch dir");
    }

    #[test]
    fn logs_without_the_quota_error_and_missing_dirs_say_nothing() {
        let dir = scratch_dir("other");
        std::fs::write(dir.join("run.log"), "INFO all good\n").expect("write log");
        std::fs::write(dir.join("notes.txt"), OPENCODE_ERROR).expect("write note");
        assert!(!log_dir_shows_free_limit(
            &dir,
            Duration::from_secs(60),
            SystemTime::now()
        ));
        std::fs::remove_dir_all(&dir).expect("remove scratch dir");
        assert!(!log_dir_shows_free_limit(
            &dir,
            Duration::from_secs(60),
            SystemTime::now()
        ));
    }

    #[test]
    fn only_the_end_of_a_long_log_is_searched() {
        let dir = scratch_dir("long");
        let mut text = format!("{OPENCODE_ERROR}\n");
        text.push_str(&"x".repeat(LOG_TAIL_BYTES as usize + 1024));
        std::fs::write(dir.join("run.log"), text).expect("write log");
        assert!(!log_dir_shows_free_limit(
            &dir,
            Duration::from_secs(60),
            SystemTime::now()
        ));
        std::fs::remove_dir_all(&dir).expect("remove scratch dir");
    }
}
