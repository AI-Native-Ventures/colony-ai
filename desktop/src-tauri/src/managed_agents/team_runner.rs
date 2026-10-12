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

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

mod claim;
mod claim_io;
pub(crate) mod commands;
mod companies;
mod computer;
mod hire;
mod hire_journal;
mod hire_relay;
mod launch;
mod status;
mod supervisor;
mod watch;

pub(crate) use claim::{launch_candidates, TeamSpawn};
pub(crate) use companies::{CompaniesFile, StoredCompany, NOT_SET_UP};
pub(crate) use computer::ComputerIdentity;
pub use hire::{HireCompleteInput, HireCompleteResult, HireCompleteState};
pub(crate) use launch::{pause_company, resume_company, spawn_on_boot};

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
    companies: Mutex<companies::CompaniesCache>,
    /// This install's id, loaded or created on first use.
    computer: Mutex<Option<ComputerIdentity>>,
    /// Latest team computer record seen per normalized company relay.
    claims: Mutex<HashMap<String, claim::ClaimView>>,
    /// Which employees should run, and their crash history.
    book: Mutex<supervisor::SupervisorBook>,
    /// One activation at a time (boot, saved companies, claim, resume).
    activation: tokio::sync::Mutex<()>,
    /// The supervisor and heartbeat loops start once per host.
    loops_started: AtomicBool,
    /// One hire at a time, so a resumed hire and a new call never race.
    hire_lock: tokio::sync::Mutex<()>,
}

/// Run `f` on the supervisor book (a leaf lock).
pub(crate) fn with_book<R: Runtime, T>(
    app: &AppHandle<R>,
    f: impl FnOnce(&mut supervisor::SupervisorBook) -> T,
) -> Result<T, String> {
    let state = runner(app)?;
    let mut book = state.book.lock().map_err(|_| poisoned())?;
    Ok(f(&mut book))
}

/// Proof that the team computer fence ran for one spawn. Only
/// [`spawn_clearance`] makes one; `spawn_agent_child` builds the employee
/// environment from it, so removing the fence is a compile error there.
#[must_use]
pub(crate) struct SpawnClearance {
    team: Option<TeamSpawn>,
}

impl SpawnClearance {
    /// The team facts, `None` when the spawn is not for a saved company.
    pub(crate) fn team(&self) -> Option<&TeamSpawn> {
        self.team.as_ref()
    }

    /// Keep ordinary start paths from outrunning an unfinished hire.
    pub(crate) fn require_hire_start<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        record: &super::ManagedAgentRecord,
        relay_url: &str,
        replay_floor: Option<u64>,
    ) -> Result<(), String> {
        if self.team().is_some() {
            load_hire_journal(app)?.require_first_start(record, relay_url, replay_floor)?;
        }
        Ok(())
    }
}

/// Read unfinished hire state before restore or spawn. A damaged journal
/// blocks starts rather than forgetting a first start's replay floor.
pub(crate) fn load_hire_journal<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<hire_journal::HireJournal, String> {
    hire_journal::load(&team_dir(app)?.join(hire_journal::JOURNAL_FILE))
}

/// The team computer fence for one spawn on `relay_url`. A relay that is not
/// a saved company passes untouched; a saved company's employee starts only
/// on the computer its record names, and only while it is not paused.
pub(crate) fn spawn_clearance<R: Runtime>(
    app: &AppHandle<R>,
    relay_url: &str,
) -> Result<SpawnClearance, String> {
    let Some(state) = app.try_state::<TeamRunnerState>() else {
        return Ok(SpawnClearance { team: None });
    };
    let companies = saved_companies(app)?;
    let claims = state.claims.lock().map_err(|_| poisoned())?.clone();
    let computer = state.computer.lock().map_err(|_| poisoned())?.clone();
    claim::clearance_for(&companies, &claims, computer.as_ref(), relay_url)
        .map(|team| SpawnClearance { team })
}

/// Remember what the relay said about `relay_url`'s record.
pub(crate) fn record_claim<R: Runtime>(
    app: &AppHandle<R>,
    relay_url: &str,
    view: claim::ClaimView,
) -> Result<(), String> {
    let relay = normalize_relay(relay_url)?;
    runner(app)?
        .claims
        .lock()
        .map_err(|_| poisoned())?
        .insert(relay, view);
    Ok(())
}

/// Forget `relay_url`'s record (the company was removed from this computer).
pub(crate) fn forget_claim<R: Runtime>(app: &AppHandle<R>, relay_url: &str) {
    let (Ok(relay), Ok(state)) = (normalize_relay(relay_url), runner(app)) else {
        return;
    };
    if let Ok(mut claims) = state.claims.lock() {
        claims.remove(&relay);
    }
}

/// What this computer last learned about `relay_url`'s record.
pub(crate) fn claim_view<R: Runtime>(
    app: &AppHandle<R>,
    relay_url: &str,
) -> Result<Option<claim::ClaimView>, String> {
    let relay = normalize_relay(relay_url)?;
    Ok(runner(app)?
        .claims
        .lock()
        .map_err(|_| poisoned())?
        .get(&relay)
        .cloned())
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
    let loaded =
        team_dir(app).and_then(|dir| companies::load(&dir.join(companies::COMPANIES_FILE)));
    runner(app)?
        .companies
        .lock()
        .map_err(|_| poisoned())?
        .remember_load(loaded)
}

/// A copy of the saved companies.
pub(crate) fn saved_companies<R: Runtime>(app: &AppHandle<R>) -> Result<CompaniesFile, String> {
    Ok(runner(app)?
        .companies
        .lock()
        .map_err(|_| poisoned())?
        .file()?
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
    let mut next = cache.file()?.clone();
    let out = change(&mut next)?;
    companies::save(&path, &next)?;
    cache.remember_load(Ok(next))?;
    Ok(out)
}

/// This install's id, loaded or created once.
pub(crate) fn ensure_computer<R: Runtime>(app: &AppHandle<R>) -> Result<ComputerIdentity, String> {
    let state = runner(app)?;
    let path = team_dir(app)?.join(computer::COMPUTER_FILE);
    computer::cached_identity(&state.computer, &path)
}

/// Whether the host is shutting down (no restarts, no activations).
pub(crate) fn shutting_down<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<crate::app_state::AppState>()
        .is_some_and(|state| {
            state
                .shutdown_started
                .load(std::sync::atomic::Ordering::Acquire)
        })
}

/// The signed-in person's public key (hex).
pub(crate) fn identity<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let state = app
        .try_state::<crate::app_state::AppState>()
        .ok_or_else(|| "Colony is still starting.".to_string())?;
    Ok(state.signing_keys()?.public_key().to_hex())
}

/// Whether the record for `relay_url` names this computer.
pub(crate) fn runs_here<R: Runtime>(app: &AppHandle<R>, relay_url: &str) -> bool {
    let Ok(me) = ensure_computer(app) else {
        return false;
    };
    claim_view(app, relay_url)
        .ok()
        .flatten()
        .and_then(|view| view.holder)
        .is_some_and(|holder| holder.computer_id == me.computer_id)
}

/// The signed-in person's company when this computer holds its team, paused
/// or not (the heartbeat keeps a paused team's record fresh).
pub(crate) fn held_company<R: Runtime>(app: &AppHandle<R>) -> Option<StoredCompany> {
    let identity = identity(app).ok()?;
    let company = saved_companies(app).ok()?.active(&identity).cloned()?;
    runs_here(app, &company.relay_url).then_some(company)
}

/// [`held_company`] when it is not paused: the team the supervisor keeps running.
pub(crate) fn running_company<R: Runtime>(app: &AppHandle<R>) -> Option<StoredCompany> {
    held_company(app).filter(|company| !company.is_paused())
}

/// The normalized relay when it belongs to a saved company.
fn team_relay<R: Runtime>(app: &AppHandle<R>, relay_url: &str) -> Option<String> {
    let relay = normalize_relay(relay_url).ok()?;
    saved_companies(app)
        .ok()?
        .companies
        .iter()
        .any(|company| company.relay_url == relay)
        .then_some(relay)
}

/// Spawn hook (`spawn_agent_child`): a saved company's employee that starts is
/// one the team runner keeps running on that relay.
pub(crate) fn note_spawned<R: Runtime>(app: &AppHandle<R>, pubkey: &str, relay_url: &str) {
    if let Some(relay) = team_relay(app, relay_url) {
        if let Err(error) = with_book(app, |book| book.expect_running(pubkey, &relay)) {
            eprintln!("team runner: could not record a start: {error}");
        }
    }
}

/// Stop hook (`stop_managed_agent_pair`, `stop_managed_agent_runtime`): a pair
/// stopped on purpose is never restarted by the supervisor.
pub(crate) fn note_stopped_on_purpose<R: Runtime>(
    app: &AppHandle<R>,
    pubkey: &str,
    relay_url: &str,
) {
    if let Some(relay) = team_relay(app, relay_url) {
        if let Err(error) = with_book(app, |book| book.note_stopped(pubkey, &relay)) {
            eprintln!("team runner: could not record a stop: {error}");
        }
    }
}

/// Plain words for each problem: never a path, code, key or model name.
pub(crate) fn problem_detail(kind: ProblemKind, name: &str) -> String {
    match kind {
        ProblemKind::StartFailed => format!("{name} could not start. Colony will try again shortly."),
        ProblemKind::Crashed => format!("{name} stopped unexpectedly. Colony is starting them again."),
        ProblemKind::CrashLoop => format!(
            "{name} keeps stopping, so Colony stopped restarting them. Restart them when you are ready."
        ),
        ProblemKind::CreditsOut => {
            "Your credits ran out, so your team is paused. Add credits to continue.".to_string()
        }
        ProblemKind::DiskFull => {
            format!("This computer is almost out of space, so {name} is waiting.")
        }
    }
}

#[cfg(test)]
mod claim_io_tests;
#[cfg(test)]
mod claim_tests;
#[cfg(test)]
mod commands_tests;
#[cfg(test)]
mod foundation_tests;
#[cfg(test)]
mod hire_relay_tests;
#[cfg(test)]
mod hire_tests;
#[cfg(test)]
mod hooks_tests;
#[cfg(test)]
mod launch_tests;
#[cfg(test)]
mod status_tests;
#[cfg(test)]
mod supervisor_tests;
#[cfg(test)]
mod watch_tests;
