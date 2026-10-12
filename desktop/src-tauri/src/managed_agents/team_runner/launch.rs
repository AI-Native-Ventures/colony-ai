//! Start on launch, the claim at every start, the heartbeat, pause and resume.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use buzz_core_pkg::team_computer::TeamComputerActionKind;
use tauri::{AppHandle, Manager};

use super::claim::{ClaimView, HEARTBEAT_EVERY_SECS};
use super::companies::StoredCompany;
use super::{
    claim_io, claim_view, ensure_computer, held_company, identity, normalize_relay, runner,
    runs_here, saved_companies, shutting_down, update_companies, with_book, PauseReason,
    NOT_SET_UP,
};
use crate::app_state::AppState;
use crate::managed_agents::credits_pause;

/// Time a harness gets to finish its turn (it drains for up to 30 s).
const PAUSE_GRACE: Duration = Duration::from_secs(35);
const ACTIVATION_RETRY_FIRST_SECS: u64 = 15;
const ACTIVATION_RETRY_MAX_SECS: u64 = 300;

/// What activation does for the open company.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivationPlan {
    /// No company is saved for the signed-in person.
    Idle,
    /// This computer runs the team: start every employee.
    StartTeam,
    /// Another computer runs the team: start nothing.
    Away,
    /// The team is paused: start nothing (watch credits when paused for credits).
    Paused {
        /// Whether a credits pause is among the reasons.
        credits: bool,
    },
    /// The record names no computer even after a claim: try again later.
    Retry,
}

/// Decide activation from the record, this computer's id and the pause reasons.
pub(crate) fn activation_plan(
    view: &ClaimView,
    this_computer_id: &str,
    reasons: &[PauseReason],
    paused_for_credits: bool,
) -> ActivationPlan {
    let credits = paused_for_credits || reasons.contains(&PauseReason::Credits);
    match view.holder.as_ref() {
        Some(holder) if holder.computer_id != this_computer_id => ActivationPlan::Away,
        Some(_) if credits || !reasons.is_empty() => ActivationPlan::Paused { credits },
        Some(_) => ActivationPlan::StartTeam,
        None => ActivationPlan::Retry,
    }
}

/// Why the team is still paused after a person's resume, in plain words.
pub(crate) fn still_paused_message(reasons: &[PauseReason]) -> Option<String> {
    let message = match super::status::shown_pause_reason(reasons)? {
        PauseReason::Credits => {
            "Your team is still paused because your credits ran out. Add credits to continue."
        }
        PauseReason::PlanLimit => "Your team is still paused because your plan limit was reached.",
        PauseReason::Person => "Your team is still paused.",
    };
    Some(message.to_string())
}

/// Boot (`lib.rs`): load the saved companies, start the loops and activate
/// the team in the background. Nothing waits for an interface.
pub(crate) fn spawn_on_boot(app: AppHandle) {
    if let Err(error) = super::load_saved_companies(&app) {
        eprintln!(
            "team runner: the saved companies could not be read, so the team does not start: {error}"
        );
        return;
    }
    if saved_companies(&app).map_or(true, |file| file.companies.is_empty()) {
        return;
    }
    start_loops(&app);
    tauri::async_runtime::spawn(activate_with_retry(app));
}

/// Start the supervisor and heartbeat loops once per host.
pub(crate) fn start_loops(app: &AppHandle) {
    let Ok(state) = runner(app) else {
        return;
    };
    if state.loops_started.swap(true, Ordering::AcqRel) {
        return;
    }
    super::watch::spawn_supervisor_loop(app.clone());
    spawn_heartbeat_loop(app.clone());
}

/// Activate, retrying after 15 s, 30 s, and so on up to every 5 minutes while
/// the relay or the identity is not ready. Ends on success, on shutdown, or
/// when no company is saved for the signed-in person.
pub(crate) async fn activate_with_retry(app: AppHandle) {
    let mut wait = ACTIVATION_RETRY_FIRST_SECS;
    loop {
        if shutting_down(&app) {
            return;
        }
        match activate(&app).await {
            Ok(_) => return,
            Err(error) => {
                eprintln!("team runner: starting the team will be retried in {wait} s: {error}")
            }
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
        wait = (wait * 2).min(ACTIVATION_RETRY_MAX_SECS);
    }
}

/// Bring the signed-in person's company to the state its record and pause
/// reasons call for.
pub(crate) async fn activate(app: &AppHandle) -> Result<ActivationPlan, String> {
    let state = runner(app)?;
    let _one_at_a_time = state.activation.lock().await;
    let identity = identity(app)?;
    let Some(company) = saved_companies(app)?.active(&identity).cloned() else {
        return Ok(ActivationPlan::Idle);
    };
    open_company(app, &company.relay_url)?;
    let me = ensure_computer(app)?.computer_id;
    // Claim at every start: for the current holder this only refreshes its
    // name and time; when another computer holds the team it reads the record.
    let view = claim_io::claim(app, &company.relay_url, false).await?;
    let paused_for_credits = credits_pause::is_paused_for_credits(app, &company.relay_url);
    let plan = activation_plan(&view, &me, &company.pause_reasons, paused_for_credits);
    match plan {
        ActivationPlan::StartTeam => {
            start_team(app, &company).await?;
            // Hires a killed host left unfinished finish now, exactly once.
            super::hire_relay::resume_unfinished(app, &company.relay_url);
        }
        ActivationPlan::Paused { credits: true } => {
            credits_pause::ensure_watcher(app, &company.relay_url)
        }
        ActivationPlan::Retry => {
            return Err("the team computer record could not be read yet".to_string())
        }
        ActivationPlan::Paused { credits: false } | ActivationPlan::Away | ActivationPlan::Idle => {
        }
    }
    super::status::emit_changes(app, &company.relay_url);
    Ok(plan)
}

/// Make `relay_url` the open relay: the one every spawn, message and profile
/// write uses. The new app never calls `apply_workspace`, so the team runner
/// opens the company. A different open relay is never replaced.
pub(crate) fn open_company(app: &AppHandle, relay_url: &str) -> Result<(), String> {
    let wanted = normalize_relay(relay_url)?;
    let state = app.state::<AppState>();
    {
        let mut open = state
            .relay_url_override
            .lock()
            .map_err(|error| error.to_string())?;
        match open.as_deref().and_then(|url| normalize_relay(url).ok()) {
            Some(current) if current == wanted => return Ok(()),
            Some(_) => return Err("Another company is open in Colony. Close it first.".to_string()),
            None => *open = Some(wanted),
        }
    }
    crate::relay_admission::reset_gate_for_workspace_change();
    Ok(())
}

/// Close `relay_url` when it is the open relay (the company was removed).
pub(crate) fn close_company(app: &AppHandle, relay_url: &str) {
    let Ok(relay) = normalize_relay(relay_url) else {
        return;
    };
    let state = app.state::<AppState>();
    let Ok(mut open) = state.relay_url_override.lock() else {
        return;
    };
    if open
        .as_deref()
        .and_then(|url| normalize_relay(url).ok())
        .as_deref()
        == Some(relay.as_str())
    {
        *open = None;
    }
}

/// The saved company at `relay_url` for the signed-in person, opened.
pub(crate) fn team_company(app: &AppHandle, relay_url: &str) -> Result<StoredCompany, String> {
    let identity = identity(app)?;
    let company = saved_companies(app)?
        .find(relay_url)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    if !company.owner_pubkey.eq_ignore_ascii_case(&identity) {
        return Err("Sign in as the person who set up this company on this computer.".to_string());
    }
    open_company(app, &company.relay_url)?;
    Ok(company)
}

/// `Ok` when this computer runs `company`'s team; reads the record first when
/// it was never read.
pub(crate) async fn ensure_runs_here(
    app: &AppHandle,
    company: &StoredCompany,
) -> Result<(), String> {
    let me = ensure_computer(app)?.computer_id;
    let view = match claim_view(app, &company.relay_url)? {
        Some(view) => view,
        None => claim_io::refresh(app, &company.relay_url).await?,
    };
    match view.holder {
        Some(holder) if holder.computer_id == me => Ok(()),
        Some(holder) => Err(format!(
            "Your team runs on {}. Finish this on that computer.",
            holder.computer_name
        )),
        None => Err("No computer runs your team yet. Run it on this computer first.".to_string()),
    }
}

/// The public keys of the company's employees on this computer.
pub(crate) fn team_employee_pubkeys(app: &AppHandle) -> Result<Vec<String>, String> {
    employee_pubkeys(app, None)
}

fn employee_pubkeys(
    app: &AppHandle,
    restoring: Option<(&super::hire_journal::HireJournal, &str)>,
) -> Result<Vec<String>, String> {
    let state = app.state::<AppState>();
    let _store = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(crate::managed_agents::load_managed_agents(app)?
        .iter()
        .filter(|record| super::status::is_team_employee(record))
        .filter(|record| {
            restoring.is_none_or(|(journal, relay)| journal.allows_restore(record, relay))
        })
        .map(|record| record.pubkey.to_ascii_lowercase())
        .collect())
}

/// Start every employee of `company` (launch restore with the company open)
/// and expect them to keep running.
pub(crate) async fn start_team(app: &AppHandle, company: &StoredCompany) -> Result<(), String> {
    let state = app.state::<AppState>();
    // This start replaces the deferred restore `apply_workspace` would run,
    // so the old app never restores the team a second time.
    state
        .managed_agent_restore_pending
        .store(false, Ordering::Release);
    let journal = super::load_hire_journal(app)?;
    let employees = employee_pubkeys(app, Some((&journal, &company.relay_url)))?;
    with_book(app, |book| {
        for pubkey in &employees {
            book.expect_running(pubkey, &company.relay_url);
        }
    })?;
    crate::managed_agents::restore_managed_agents_on_launch(app, &state.shutdown_started).await
}

fn live_pids(app: &AppHandle, relay: &str, employees: &[String]) -> Result<Vec<u32>, String> {
    let state = app.state::<AppState>();
    let mut runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(runtimes
        .iter_mut()
        .filter(|(key, _)| key.relay_url == relay && employees.contains(&key.pubkey))
        .filter(|(_, runtime)| runtime.child.try_wait().ok().flatten().is_none())
        .map(|(_, runtime)| runtime.child.id())
        .collect())
}

/// Stop every employee of `relay_url` after its current turn: ask each
/// harness to finish, wait up to 35 s, then stop each pair. The supervisor
/// learns first that the stops are on purpose.
pub(crate) async fn stop_team(app: &AppHandle, relay_url: &str) -> Result<(), String> {
    let relay = normalize_relay(relay_url)?;
    let employees = team_employee_pubkeys(app)?;
    with_book(app, |book| {
        for pubkey in &employees {
            book.note_stopped(pubkey, &relay);
        }
    })?;
    for pid in live_pids(app, &relay, &employees)? {
        if let Err(error) = crate::managed_agents::request_graceful_exit(pid) {
            eprintln!("team runner: could not ask an employee to finish its turn: {error}");
        }
    }
    let grace = if cfg!(unix) {
        PAUSE_GRACE
    } else {
        Duration::ZERO
    };
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline && !live_pids(app, &relay, &employees)?.is_empty() {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    let mut first_error = None;
    for pubkey in employees {
        let (app, relay) = (app.clone(), relay.clone());
        let stopped = tauri::async_runtime::spawn_blocking(move || {
            crate::managed_agents::stop_managed_agent_runtime(pubkey, relay, app)
        })
        .await;
        match stopped {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => {
                first_error.get_or_insert(error);
            }
            Err(error) => {
                first_error.get_or_insert(error.to_string());
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

/// Another computer took the team: stop here and report away.
pub(crate) async fn stand_down(app: &AppHandle, relay_url: &str) {
    if let Err(error) = stop_team(app, relay_url).await {
        eprintln!("team runner: standing down left an employee running: {error}");
    }
    super::status::emit_changes(app, relay_url);
}

/// Pause `relay_url`'s team for `reason`. The reason is saved before anything
/// stops, so a restart keeps the team paused; the team stops when this
/// computer runs it.
pub(crate) async fn pause_company(
    app: &AppHandle,
    relay_url: &str,
    reason: PauseReason,
) -> Result<(), String> {
    update_companies(app, |file| file.add_pause(relay_url, reason))?;
    if runs_here(app, relay_url) {
        stop_team(app, relay_url).await?;
    }
    super::status::emit_changes(app, relay_url);
    Ok(())
}

/// Clear `reason`. When no reason remains and this computer runs the team,
/// give failing employees a fresh start and start the team.
pub(crate) async fn resume_company(
    app: &AppHandle,
    relay_url: &str,
    reason: PauseReason,
) -> Result<(), String> {
    update_companies(app, |file| file.remove_pause(relay_url, reason))?;
    let company = saved_companies(app)?
        .find(relay_url)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    if !company.is_paused() && runs_here(app, &company.relay_url) {
        let employees = team_employee_pubkeys(app)?;
        with_book(app, |book| {
            for pubkey in &employees {
                book.reset(pubkey);
            }
        })?;
        start_team(app, &company).await?;
    }
    super::status::emit_changes(app, &company.relay_url);
    Ok(())
}

/// Heartbeat every two minutes while this computer holds the team.
fn spawn_heartbeat_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(HEARTBEAT_EVERY_SECS)).await;
            if shutting_down(&app) {
                return;
            }
            let Some(company) = held_company(&app) else {
                continue;
            };
            let sent = claim_io::publish(
                &app,
                &company.relay_url,
                TeamComputerActionKind::Heartbeat,
                false,
            )
            .await;
            match sent {
                Ok(()) => {}
                Err(error) if claim_io::is_rate_limited(&error) => {}
                Err(error) if claim_io::is_not_holder(&error) => {
                    match claim_io::refresh(&app, &company.relay_url).await {
                        Ok(_) if !runs_here(&app, &company.relay_url) => {
                            stand_down(&app, &company.relay_url).await
                        }
                        Ok(_) => {}
                        Err(refresh_error) => eprintln!(
                            "team runner: could not check which computer runs the team: {refresh_error}"
                        ),
                    }
                }
                Err(error) => {
                    eprintln!("team runner: heartbeat failed; the team keeps running: {error}")
                }
            }
        }
    });
}
