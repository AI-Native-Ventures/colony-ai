//! The free route of a cloud agent.
//!
//! A cloud agent whose model is `colony-free` first works through OpenCode's
//! free model (`opencode acp` inside the machine). That route is a favour from
//! OpenCode, not a contract, so the harness watches it. When OpenCode refuses
//! (the free tier is closed to this machine, the free model ended, a rate limit)
//! or fails three turns in a row, the harness
//!   1. posts nothing to the chat,
//!   2. leaves the message it was working on unanswered and unhandled in its
//!      wake ledger, so the next boot picks it up again,
//!   3. tells the relay (`POST /api/cloud-agents/{agent}/free-route-refused`,
//!      bearer = home token) so the relay boots the next machine on the
//!      OpenRouter free route, and
//!   4. exits with [`FREE_ROUTE_REFUSED_EXIT_CODE`].
//!
//! The route is named by `COLONY_CLOUD_ROUTE` in the boot environment. Only the
//! OpenCode route ever refuses, so the switch happens at most once per wake and
//! can never loop: the machine that boots after a switch is on a route that
//! never reports a refusal.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use crate::acp::AcpError;

/// Variable (set by the cloud boot response) naming the route this machine
/// works on.
pub const ROUTE_VAR: &str = "COLONY_CLOUD_ROUTE";
/// Value of [`ROUTE_VAR`] for OpenCode's free model.
pub const ROUTE_OPENCODE_FREE: &str = "openCodeFree";
/// Value of [`ROUTE_VAR`] for the OpenRouter free models behind the Colony
/// gateway.
pub const ROUTE_OPENROUTER_FREE: &str = "openrouterFree";

/// Exit code of a harness whose free route was refused (BSD `EX_TEMPFAIL`'s
/// neighbour): "boot me again on the other free route".
pub const FREE_ROUTE_REFUSED_EXIT_CODE: i32 = 76;

/// Failed turns in a row on the OpenCode route before the route counts as
/// refused even though no single error said so.
pub const CONSECUTIVE_FAILURE_LIMIT: u32 = 3;

/// Longest the report to the relay may take. The harness exits either way.
const REPORT_TIMEOUT: Duration = Duration::from_secs(8);

/// Which route this machine works on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// Not a free route: a Mac agent, or a cloud agent on a paid model.
    Other,
    /// OpenCode's free model.
    OpenCodeFree,
    /// The OpenRouter free models behind the Colony gateway.
    OpenrouterFree,
}

impl Route {
    /// Parses the value of [`ROUTE_VAR`]. Anything unknown is [`Route::Other`].
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some(ROUTE_OPENCODE_FREE) => Self::OpenCodeFree,
            Some(ROUTE_OPENROUTER_FREE) => Self::OpenrouterFree,
            _ => Self::Other,
        }
    }

    /// The route named by this process's environment.
    pub fn current() -> Self {
        Self::parse(std::env::var(ROUTE_VAR).ok().as_deref())
    }
}

/// What one finished turn looked like, for the refusal decision.
#[derive(Debug, Clone, Copy)]
pub(crate) enum TurnResult<'a> {
    /// The turn finished.
    Ok,
    /// The agent reported an error.
    Error(&'a AcpError),
    /// The turn failed without saying why (silence, a timeout, the process
    /// exited). `log_shows_limit` says OpenCode's own log names the free limit.
    Silent { log_shows_limit: bool },
    /// Cancelled on purpose: says nothing about the route.
    Neutral,
}

/// Phrases (lower case) that mean OpenCode refuses this route outright.
const REFUSAL_PHRASES: &[&str] = &[
    "free usage limit reached",
    "free model ended",
    "can only be used from within opencode",
    "free tier can only be used",
    "rate limit",
    "rate_limit",
    "too many requests",
    "http 429",
    "status 429",
];

/// `true` when `text` says OpenCode refuses the free route.
pub(crate) fn is_refusal_text(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    REFUSAL_PHRASES.iter().any(|phrase| lower.contains(phrase))
}

fn is_refusal_error(error: &AcpError) -> bool {
    match error {
        AcpError::AgentError { message, .. } => is_refusal_text(message),
        _ => false,
    }
}

/// Counts failed turns in a row.
#[derive(Debug, Default)]
pub(crate) struct FailureStreak {
    count: AtomicU32,
}

impl FailureStreak {
    pub(crate) const fn new() -> Self {
        Self {
            count: AtomicU32::new(0),
        }
    }

    /// Decides whether a finished turn means the route is refused, and keeps
    /// the streak. `true` means: stop, tell the relay, exit.
    pub(crate) fn refuses(&self, turn: TurnResult<'_>) -> bool {
        match turn {
            TurnResult::Ok => {
                self.count.store(0, Ordering::SeqCst);
                false
            }
            TurnResult::Neutral => false,
            TurnResult::Error(error) if is_refusal_error(error) => true,
            TurnResult::Silent {
                log_shows_limit: true,
            } => true,
            TurnResult::Error(_) | TurnResult::Silent { .. } => {
                self.count.fetch_add(1, Ordering::SeqCst) + 1 >= CONSECUTIVE_FAILURE_LIMIT
            }
        }
    }
}

static STREAK: FailureStreak = FailureStreak::new();
static REFUSED: AtomicBool = AtomicBool::new(false);

/// Judges a finished turn against the process-wide streak.
pub(crate) fn judge(turn: TurnResult<'_>) -> bool {
    STREAK.refuses(turn)
}

/// Records that this process must report the refusal and exit with
/// [`FREE_ROUTE_REFUSED_EXIT_CODE`].
pub(crate) fn mark_refused() {
    REFUSED.store(true, Ordering::SeqCst);
}

/// Whether the free route was refused during this run.
pub(crate) fn refused() -> bool {
    REFUSED.load(Ordering::SeqCst)
}

/// Path of the report route for `agent_hex`.
pub(crate) fn report_path(agent_hex: &str) -> String {
    format!("/api/cloud-agents/{agent_hex}/free-route-refused")
}

/// Tells the relay this machine's free route was refused. Best effort and
/// bounded: a failed report is logged, never retried. The relay then boots the
/// next machine on the same route again, and a refusal there reports again.
pub(crate) async fn report_refusal(rest: &crate::relay::RestClient) {
    let Some(token) = crate::cloud_boot::home_token() else {
        tracing::warn!("free route refused, but this machine has no home token to report with");
        return;
    };
    let url = format!(
        "{}{}",
        rest.base_url.trim_end_matches('/'),
        report_path(&rest.keys.public_key().to_hex())
    );
    let sent = rest
        .http
        .post(&url)
        .bearer_auth(token)
        .timeout(REPORT_TIMEOUT)
        .send()
        .await;
    match sent {
        Ok(response) if response.status().is_success() => {
            tracing::info!("free route refusal reported to the relay");
        }
        Ok(response) => {
            tracing::warn!(status = %response.status(), "relay did not accept the free route refusal");
        }
        Err(error) => tracing::warn!(%error, "free route refusal could not be reported"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent_error(message: &str) -> AcpError {
        AcpError::AgentError {
            code: -32000,
            message: message.to_owned(),
        }
    }

    #[test]
    fn the_route_comes_from_the_boot_variable() {
        assert_eq!(Route::parse(Some("openCodeFree")), Route::OpenCodeFree);
        assert_eq!(
            Route::parse(Some(" openrouterFree ")),
            Route::OpenrouterFree
        );
        assert_eq!(Route::parse(Some("gateway")), Route::Other);
        assert_eq!(Route::parse(Some("")), Route::Other);
        assert_eq!(Route::parse(None), Route::Other);
    }

    #[test]
    fn every_refusal_class_refuses_at_once() {
        for message in [
            "AI_APICallError: Free usage limit reached. Free models work in OpenCode",
            "free model ended: opencode/deepseek-v4.1-flash-free",
            "OpenCode's free tier can only be used from within OpenCode",
            "429 Too Many Requests",
            "provider rate limit hit",
            "llm: HTTP 429: slow down",
        ] {
            let streak = FailureStreak::new();
            assert!(
                streak.refuses(TurnResult::Error(&agent_error(message))),
                "{message}"
            );
        }
        let streak = FailureStreak::new();
        assert!(streak.refuses(TurnResult::Silent {
            log_shows_limit: true
        }));
    }

    #[test]
    fn an_ordinary_failure_is_not_a_refusal_until_the_streak_is_three() {
        let streak = FailureStreak::new();
        let error = agent_error("tool crashed");
        assert!(!streak.refuses(TurnResult::Error(&error)));
        assert!(!streak.refuses(TurnResult::Silent {
            log_shows_limit: false
        }));
        assert!(streak.refuses(TurnResult::Error(&error)), "third in a row");
    }

    #[test]
    fn a_good_turn_resets_the_streak() {
        let streak = FailureStreak::new();
        let error = agent_error("tool crashed");
        assert!(!streak.refuses(TurnResult::Error(&error)));
        assert!(!streak.refuses(TurnResult::Error(&error)));
        assert!(!streak.refuses(TurnResult::Ok));
        assert!(!streak.refuses(TurnResult::Error(&error)));
        assert!(!streak.refuses(TurnResult::Error(&error)));
        assert!(streak.refuses(TurnResult::Error(&error)));
    }

    #[test]
    fn a_cancel_says_nothing_about_the_route() {
        let streak = FailureStreak::new();
        let error = agent_error("tool crashed");
        assert!(!streak.refuses(TurnResult::Error(&error)));
        assert!(!streak.refuses(TurnResult::Error(&error)));
        assert!(!streak.refuses(TurnResult::Neutral));
        assert!(streak.refuses(TurnResult::Error(&error)), "streak kept");
    }

    #[test]
    fn the_report_goes_to_the_agents_own_path() {
        assert_eq!(
            report_path(&"ab".repeat(32)),
            format!("/api/cloud-agents/{}/free-route-refused", "ab".repeat(32))
        );
    }

    #[test]
    fn the_exit_code_is_not_the_placement_code() {
        assert_eq!(FREE_ROUTE_REFUSED_EXIT_CODE, 76);
        assert_ne!(
            FREE_ROUTE_REFUSED_EXIT_CODE,
            crate::placement::PLACEMENT_MOVED_EXIT_CODE
        );
    }
}
