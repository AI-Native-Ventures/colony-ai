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

/// Plain copy of the tagged credit notice a cloud agent posts. The desktop
/// renders the card and its actions from the tag, not from these words.
pub(crate) const OUT_OF_CREDIT_COPY: &str = "Out of AI credit.";

/// Name of the tag marking a harness system message the app turns into a card.
pub(crate) const NOTICE_TAG_NAME: &str = "colony_notice";

/// The gateway words for "balance cannot fund the request" (`CreditRefusal::OutOfCredits`).
const OUT_OF_CREDITS_MESSAGE: &str = "Out of credits. Top up to keep your Colony Agent working.";
/// The gateway words for an account or session at its concurrency limit
/// (`CreditRefusal::Busy`), which is also how a pool of rate-limited free
/// models reaches the agent (HTTP 429).
const BUSY_MESSAGE: &str = "Your Colony Agents are busy. Try again shortly.";
/// The gateway words for the deployment-wide daily ceiling (`CreditRefusal::DailyLimit`).
const DAILY_LIMIT_MESSAGE: &str = "Colony AI has reached its limit for today. Try again tomorrow, or connect Claude Code, Codex or an OpenRouter key in Settings > Agents.";

/// Which credit refusal a tagged notice reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CreditNoticeKind {
    /// The owner's balance cannot fund the request.
    OutOfCredit,
    /// The deployment's daily spend ceiling was reached.
    DailyLimit,
    /// The free route has no model to give right now: the free models share
    /// one daily allowance, or all of them are rate limited.
    FreeAiBusy,
}

impl CreditNoticeKind {
    /// Value of the `colony_notice` tag.
    pub(crate) fn tag_value(self) -> &'static str {
        match self {
            Self::OutOfCredit => "outOfCredit",
            Self::DailyLimit => "dailyLimit",
            Self::FreeAiBusy => "freeAiBusy",
        }
    }
}

/// The credit refusal behind `error`, when it is one the app shows as a card.
/// Every other credits refusal (busy, recovering, ...) keeps its plain notice.
pub(crate) fn credit_notice_kind(error: &AcpError) -> Option<CreditNoticeKind> {
    let AcpError::AgentError {
        code: -32004,
        message,
    } = error
    else {
        return None;
    };
    match message.as_str() {
        OUT_OF_CREDITS_MESSAGE => Some(CreditNoticeKind::OutOfCredit),
        DAILY_LIMIT_MESSAGE => Some(CreditNoticeKind::DailyLimit),
        _ => None,
    }
}

/// Plain copy of the tagged notice a cloud agent on the free route posts when
/// the free models are used up or rate limited. No em-dashes: user-facing.
pub(crate) const FREE_AI_BUSY_COPY: &str = "Free AI is busy right now.";

/// The notice for a turn that failed on the OpenRouter free route because the
/// free chain is exhausted (the daily limit, or every free model rate limited).
/// `None` for any other failure, or when this is not that route on a cloud
/// machine: those keep [`credit_notice`]'s words.
pub(crate) fn free_route_notice(
    error: &AcpError,
    cloud: bool,
    on_openrouter_free_route: bool,
) -> Option<(String, CreditNoticeKind)> {
    if !(cloud && on_openrouter_free_route) {
        return None;
    }
    let AcpError::AgentError {
        code: -32004,
        message,
    } = error
    else {
        return None;
    };
    matches!(message.as_str(), DAILY_LIMIT_MESSAGE | BUSY_MESSAGE)
        .then(|| (FREE_AI_BUSY_COPY.to_owned(), CreditNoticeKind::FreeAiBusy))
}

/// The text to post and the tag to attach for a failed turn.
///
/// A credit refusal always carries its `colony_notice` tag. On a cloud machine
/// its words are the short card copy; on the Mac the existing `legacy` words
/// stay, so nothing a Mac agent says changes. Any other failure is returned
/// unchanged with no tag.
pub(crate) fn credit_notice(
    error: &AcpError,
    cloud: bool,
    legacy: String,
) -> (String, Option<CreditNoticeKind>) {
    match credit_notice_kind(error) {
        Some(kind) if cloud => (OUT_OF_CREDIT_COPY.to_owned(), Some(kind)),
        Some(kind) => (legacy, Some(kind)),
        None => (legacy, None),
    }
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

#[cfg(test)]
mod credit_notice_tests {
    use super::*;

    fn gateway_error(message: &str) -> AcpError {
        AcpError::AgentError {
            code: -32004,
            message: message.to_owned(),
        }
    }

    #[test]
    fn out_of_credit_posts_one_notice() {
        let legacy = "⚠️ Out of credits. Top up to keep your Colony Agent working.".to_owned();

        // On a cloud machine: the short card copy, tagged outOfCredit.
        let (content, kind) = credit_notice(
            &gateway_error("Out of credits. Top up to keep your Colony Agent working."),
            true,
            legacy.clone(),
        );
        assert_eq!(content, "Out of AI credit.");
        assert_eq!(kind, Some(CreditNoticeKind::OutOfCredit));
        assert_eq!(kind.map(CreditNoticeKind::tag_value), Some("outOfCredit"));

        // The daily ceiling is its own tag with the same card copy.
        let (content, kind) = credit_notice(
            &gateway_error(DAILY_LIMIT_MESSAGE),
            true,
            "unused".to_owned(),
        );
        assert_eq!(content, "Out of AI credit.");
        assert_eq!(kind.map(CreditNoticeKind::tag_value), Some("dailyLimit"));

        // On the Mac the words are unchanged; only the tag is added.
        let (content, kind) = credit_notice(
            &gateway_error("Out of credits. Top up to keep your Colony Agent working."),
            false,
            legacy.clone(),
        );
        assert_eq!(content, legacy);
        assert_eq!(kind, Some(CreditNoticeKind::OutOfCredit));

        // Other credits refusals and other failures keep their plain notice, no tag.
        for error in [
            gateway_error("Your Colony Agents are busy. Try again shortly."),
            gateway_error("anything else"),
            AcpError::AgentError {
                code: -32001,
                message: "Out of credits. Top up to keep your Colony Agent working.".into(),
            },
        ] {
            let (content, kind) = credit_notice(&error, true, "plain".to_owned());
            assert_eq!((content.as_str(), kind), ("plain", None));
        }
    }

    #[test]
    fn free_ai_busy_notice_only_on_the_openrouter_free_route() {
        for message in [DAILY_LIMIT_MESSAGE, BUSY_MESSAGE] {
            let (content, kind) = free_route_notice(&gateway_error(message), true, true)
                .expect("the free chain is exhausted");
            assert_eq!(content, "Free AI is busy right now.");
            assert_eq!(kind.tag_value(), "freeAiBusy");
            // Not the free route, or not a cloud machine: nothing changes.
            assert!(free_route_notice(&gateway_error(message), true, false).is_none());
            assert!(free_route_notice(&gateway_error(message), false, true).is_none());
        }
        // Out of credit and every other failure keep their own notice.
        for error in [
            gateway_error(OUT_OF_CREDITS_MESSAGE),
            gateway_error("anything else"),
            AcpError::AgentError {
                code: -32001,
                message: BUSY_MESSAGE.into(),
            },
        ] {
            assert!(free_route_notice(&error, true, true).is_none());
        }
        assert!(!FREE_AI_BUSY_COPY.contains('\u{2014}'), "no em-dashes");
    }

    #[test]
    fn credit_words_match_what_the_gateway_says() {
        // These strings are the gateway's `CreditRefusal` Display text. If they
        // drift, `credits_notice` falls back to its generic line and the tag is lost.
        assert_eq!(
            credits_notice(OUT_OF_CREDITS_MESSAGE),
            OUT_OF_CREDITS_MESSAGE
        );
        assert_eq!(credits_notice(DAILY_LIMIT_MESSAGE), DAILY_LIMIT_MESSAGE);
        assert_eq!(credits_notice(BUSY_MESSAGE), BUSY_MESSAGE);
    }
}
