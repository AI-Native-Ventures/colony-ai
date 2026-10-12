//! The team runner: the host owns "the team runs".
//!
//! For each company saved on this computer (`team-companies.json` in app
//! data), the host starts the employees when Colony starts, finishes a hire
//! as one journaled operation, restarts an employee after an unexpected exit,
//! pauses and resumes the team, and runs a company's employees only while
//! this computer holds the company's team computer record.
//!
//! Lock order: the mutexes in [`TeamRunnerState`] are leaf locks. Code never
//! holds one while it calls runtime, store or relay code, and never takes one
//! while it holds another.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

mod companies;
mod computer;

pub(crate) use companies::{CompaniesFile, StoredCompany};
pub(crate) use computer::ComputerIdentity;

/// Event carrying one [`EmployeeRuntimeStatus`] whenever an employee's state changes.
pub(crate) const STATUS_EVENT: &str = "team://status";
/// Event carrying one [`EmployeeProblem`].
pub(crate) const PROBLEM_EVENT: &str = "team://problem";

/// A company this computer may run, persisted in `team-companies.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamCompany {
    /// The company's relay WebSocket URL.
    pub relay_url: String,
    /// The signed-in person who saved the company on this computer.
    pub owner_pubkey: String,
}

/// The computer named in a company's team computer record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamComputerInfo {
    /// Install id of the holding computer.
    pub computer_id: String,
    /// Name people see, for example "Lerato's MacBook Air".
    pub computer_name: String,
    /// Relay time of the holder's latest claim or heartbeat, Unix seconds.
    pub last_seen_at: i64,
}

/// Which computer runs a company's team, from this computer's point of view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamComputerStatus {
    /// This install's id.
    pub this_computer_id: String,
    /// The computer the record names, `None` when no computer holds the team.
    pub holder: Option<TeamComputerInfo>,
    /// Whether the record names this computer.
    pub is_this_computer: bool,
}

/// Why a company's team is paused. A team runs only when no reason remains.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PauseReason {
    /// A person paused the team.
    Person,
    /// The company ran out of credits.
    Credits,
    /// The company reached its plan limit.
    PlanLimit,
}

/// What an employee is doing on this computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmployeeState {
    /// Starting, or waiting to start again after an unexpected exit.
    Starting,
    /// Connected and answering.
    Running,
    /// The company is paused.
    Paused,
    /// Stopped on purpose.
    Stopped,
    /// Kept stopping, so restarts stopped until a person restarts it.
    Failing,
    /// Another computer runs the team.
    Away,
}

/// One employee's runtime status (`team_status` and `team://status`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeRuntimeStatus {
    /// The employee's public key (hex).
    pub agent_pubkey: String,
    /// The employee's name.
    pub name: String,
    /// What the employee is doing.
    pub state: EmployeeState,
    /// When the employee entered `state`, Unix seconds.
    pub since: i64,
    /// Unexpected exits in the last ten minutes.
    pub restarts_in_window: u32,
    /// Why the team is paused; set only when `state` is `paused`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause_reason: Option<PauseReason>,
}

/// What went wrong for one employee.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemKind {
    /// A start attempt failed.
    StartFailed,
    /// The employee exited unexpectedly and is being restarted.
    Crashed,
    /// The fifth unexpected exit within ten minutes; restarts stopped.
    CrashLoop,
    /// The company ran out of credits.
    CreditsOut,
    /// The employee cannot save its wake ledger (the disk is full).
    DiskFull,
}

/// A problem the interface shows a person (`team://problem`). `detail` is
/// plain words, never a path, key, model name or error code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmployeeProblem {
    /// The employee the problem is about, or no employee for an engine problem.
    pub agent_pubkey: Option<String>,
    /// What went wrong.
    pub kind: ProblemKind,
    /// Plain words for a person.
    pub detail: String,
}

/// Host-wide team runner state, managed by Tauri (`lib.rs`).
#[derive(Default)]
pub(crate) struct TeamRunnerState {
    /// Cache of `team-companies.json`. Writers hold this lock across the
    /// durable write, so the file and the cache never disagree.
    companies: Mutex<CompaniesFile>,
    /// This install's id, loaded or created on first use.
    computer: Mutex<Option<ComputerIdentity>>,
}

/// Unix seconds now.
pub(crate) fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// The canonical form of a relay URL, the key every team record uses.
pub(crate) fn normalize_relay(relay_url: &str) -> Result<String, String> {
    buzz_core_pkg::relay::normalize_relay_url(relay_url).map_err(|error| error.to_string())
}

/// `<app data>/team`, created on first use.
pub(crate) fn team_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("team");
    std::fs::create_dir_all(&dir).map_err(|error| format!("failed to create team dir: {error}"))?;
    Ok(dir)
}

fn poisoned() -> String {
    "team state is unavailable".to_string()
}

fn runner<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, TeamRunnerState>, String> {
    app.try_state::<TeamRunnerState>()
        .ok_or_else(|| "team runner is not ready".to_string())
}

/// Emit one employee's status.
pub(crate) fn emit_status<R: Runtime>(app: &AppHandle<R>, status: &EmployeeRuntimeStatus) {
    if let Err(error) = app.emit(STATUS_EVENT, status) {
        eprintln!("team runner: failed to emit a status: {error}");
    }
}

/// Emit one problem.
pub(crate) fn emit_problem<R: Runtime>(app: &AppHandle<R>, problem: &EmployeeProblem) {
    if let Err(error) = app.emit(PROBLEM_EVENT, problem) {
        eprintln!("team runner: failed to emit a problem: {error}");
    }
}

/// Load `team-companies.json` into the cache. Runs once at boot, before
/// anything can spawn. An unreadable file is an error: it never reads as
/// "no companies", and it stays on disk untouched.
pub(crate) fn load_saved_companies<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let path = team_dir(app)?.join(companies::COMPANIES_FILE);
    let file = companies::load(&path)?;
    *runner(app)?.companies.lock().map_err(|_| poisoned())? = file;
    Ok(())
}

/// A copy of the saved companies.
pub(crate) fn saved_companies<R: Runtime>(app: &AppHandle<R>) -> Result<CompaniesFile, String> {
    Ok(runner(app)?
        .companies
        .lock()
        .map_err(|_| poisoned())?
        .clone())
}

/// Change the saved companies as one durable write: the change runs on a
/// copy, the copy is written, and only then does the cache take it.
pub(crate) fn update_companies<R: Runtime, T>(
    app: &AppHandle<R>,
    change: impl FnOnce(&mut CompaniesFile) -> Result<T, String>,
) -> Result<T, String> {
    let path = team_dir(app)?.join(companies::COMPANIES_FILE);
    let state = runner(app)?;
    let mut cache = state.companies.lock().map_err(|_| poisoned())?;
    let mut next = cache.clone();
    let out = change(&mut next)?;
    companies::save(&path, &next)?;
    *cache = next;
    Ok(out)
}

/// This install's id, loaded or created once.
pub(crate) fn ensure_computer<R: Runtime>(app: &AppHandle<R>) -> Result<ComputerIdentity, String> {
    let state = runner(app)?;
    if let Some(identity) = state.computer.lock().map_err(|_| poisoned())?.clone() {
        return Ok(identity);
    }
    let path = team_dir(app)?.join(computer::COMPUTER_FILE);
    let identity = computer::load_or_create(&path)?;
    *state.computer.lock().map_err(|_| poisoned())? = Some(identity.clone());
    Ok(identity)
}

#[cfg(test)]
mod foundation_tests;
