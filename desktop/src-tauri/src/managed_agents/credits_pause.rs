//! Credits seam between the team runner and live credits (stub).
//!
//! The harness exits with code 75 when the company is out of credits and
//! with 77 when its credits session ended. Neither is a crash: neither may
//! count toward the crash-loop window or trigger a backoff restart. Part I
//! (live credits, task 9.5) fills these bodies, mapping those codes to
//! `PausedForCredits` or `RestartNow`, and keeps every signature. Until then
//! no harness exits with those codes, and the stub changes nothing.

use tauri::AppHandle;

/// What the team runner does with one unexpected harness exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExitHandling {
    /// The company is paused for credits: do not restart.
    PausedForCredits,
    /// Restart at once without counting a crash.
    RestartNow,
    /// Apply the crash policy (backoff, crash loop).
    Crash,
}

/// Called for every unexpected harness exit, before the crash policy.
pub(crate) async fn on_harness_exit(
    _app: &AppHandle,
    _relay_url: &str,
    _agent_pubkey: &str,
    _code: Option<i32>,
) -> ExitHandling {
    ExitHandling::Crash
}

/// Whether the company is paused because its credits ran out. Start on
/// launch skips such a company and watches it instead.
pub(crate) fn is_paused_for_credits(_app: &AppHandle, _relay_url: &str) -> bool {
    false
}

/// Watch a company paused for credits, to resume it once credits arrive.
pub(crate) fn ensure_watcher(_app: &AppHandle, _relay_url: &str) {}

/// Called first by `team_resume`: `Ok(true)` when it resumed a credits pause
/// (nothing more to do), `Ok(false)` when the caller resumes as a person.
pub(crate) async fn resume_if_funded(_app: &AppHandle, _relay_url: &str) -> Result<bool, String> {
    Ok(false)
}
