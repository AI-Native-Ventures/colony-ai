//! The team runner's Tauri commands. One registration serves the old app
//! shell and the new app: both invoke the host by command name.

use tauri::AppHandle;

use super::claim::status_from;
use super::hire::{existing_entry_state, new_entry, run_hire, validated_input, HireIo};
use super::hire_relay::RelayHireIo;
use super::launch::{
    activate, activate_with_retry, close_company, ensure_runs_here, start_loops, start_team,
    still_paused_message, stop_team, team_company, team_employee_pubkeys,
};
use super::{
    claim_io, claim_view, ensure_computer, forget_claim, identity, now_unix, runner, runs_here,
    saved_companies, update_companies, with_book, EmployeeRuntimeStatus, HireCompleteInput,
    HireCompleteResult, HireCompleteState, PauseReason, TeamCompany, TeamComputerStatus,
    NOT_SET_UP,
};
use crate::managed_agents::credits_pause;

const PAUSED: &str = "Your team is paused. Resume it first.";

/// Save the companies this computer may run, then start the active one.
/// Removed companies are given up first (team stopped here, record
/// released); a failure saves nothing, so a retry sees the same removal.
#[tauri::command]
pub async fn team_set_companies(companies: Vec<TeamCompany>, app: AppHandle) -> Result<(), String> {
    let next = super::companies::normalize(companies.clone())?;
    let removed: Vec<_> = saved_companies(&app)?
        .companies
        .into_iter()
        .filter(|saved| {
            !next
                .iter()
                .any(|company| company.relay_url == saved.relay_url)
        })
        .collect();
    for company in &removed {
        if runs_here(&app, &company.relay_url) {
            stop_team(&app, &company.relay_url).await?;
            claim_io::release(&app, &company.relay_url).await?;
        }
    }
    update_companies(&app, |file| file.replace(companies).map(|_| ()))?;
    for company in &removed {
        forget_claim(&app, &company.relay_url);
        close_company(&app, &company.relay_url);
    }
    start_loops(&app);
    tauri::async_runtime::spawn(activate_with_retry(app.clone()));
    Ok(())
}

/// Which computer runs the company's team (read fresh from the relay).
#[tauri::command]
pub async fn team_claim_status(
    relay_url: String,
    app: AppHandle,
) -> Result<TeamComputerStatus, String> {
    let company = team_company(&app, &relay_url)?;
    let view = claim_io::refresh(&app, &company.relay_url).await?;
    Ok(status_from(
        Some(&view),
        &ensure_computer(&app)?.computer_id,
    ))
}

/// Run the team on this computer. Moving employee identities is deferred,
/// so a forced move is refused until those identities can move safely.
#[tauri::command]
pub async fn team_claim(
    relay_url: String,
    force: bool,
    app: AppHandle,
) -> Result<TeamComputerStatus, String> {
    if force {
        return Err("Moving your team to another computer is not available yet. Keep it on the computer that hired them.".to_string());
    }
    let company = team_company(&app, &relay_url)?;
    let me = ensure_computer(&app)?.computer_id;
    let view = claim_io::claim(&app, &company.relay_url, force).await?;
    if view
        .holder
        .as_ref()
        .is_some_and(|holder| holder.computer_id == me)
    {
        start_loops(&app);
        activate(&app).await?;
    }
    let view = claim_view(&app, &company.relay_url)?.unwrap_or(view);
    Ok(status_from(Some(&view), &me))
}

/// Finish an approved hire: create the employee, attach it, add it and the
/// owner to the home channel, post its hello, publish Complete with the
/// company time zone, and start it. Journaled: a killed host finishes it once.
#[tauri::command]
pub async fn team_hire_complete(
    input: HireCompleteInput,
    app: AppHandle,
) -> Result<HireCompleteResult, String> {
    let hire = validated_input(&input)?;
    let company = team_company(&app, &hire.relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if company.is_paused() {
        return Err("Your team is paused. Resume it to finish this hire.".to_string());
    }
    let state = runner(&app)?;
    let _one_hire_at_a_time = state.hire_lock.lock().await;
    let mut io = RelayHireIo::new(&app, &hire.relay_url).await?;
    let journal = io.journal()?;
    journal.ensure_capacity_for(hire.hire_id)?;
    let (entry, outcome) = match journal.find(hire.hire_id) {
        Some(existing) => (existing.clone(), existing_entry_state(existing)),
        None => (
            new_entry(&hire, io.company_time_zone().await?, now_unix()),
            HireCompleteState::Started,
        ),
    };
    if outcome == HireCompleteState::AlreadyComplete {
        let agent_pubkey = entry
            .employee_pubkey
            .clone()
            .ok_or_else(|| "the finished hire has no employee".to_string())?;
        return Ok(HireCompleteResult {
            agent_pubkey,
            state: outcome,
        });
    }
    // Durable before the first side effect: a killed host resumes from here.
    io.save(&entry)?;
    let agent_pubkey = run_hire(&mut io, entry).await?;
    Ok(HireCompleteResult {
        agent_pubkey,
        state: outcome,
    })
}

/// Restart one employee now and clear its crash loop.
#[tauri::command]
pub async fn team_restart_employee(agent_pubkey: String, app: AppHandle) -> Result<(), String> {
    let pubkey = agent_pubkey.trim().to_ascii_lowercase();
    if pubkey.len() != 64 || !pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("employee key must be 64 hexadecimal characters".to_string());
    }
    let identity = identity(&app)?;
    let active = saved_companies(&app)?
        .active(&identity)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    let company = team_company(&app, &active.relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if company.is_paused() {
        return Err(PAUSED.to_string());
    }
    if !team_employee_pubkeys(&app)?.contains(&pubkey) {
        return Err("This employee is not part of your team on this computer.".to_string());
    }
    with_book(&app, |book| book.reset(&pubkey))?;
    let relay = company.relay_url.clone();
    let (stop_app, stop_key, stop_relay) = (app.clone(), pubkey.clone(), relay.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::managed_agents::stop_managed_agent_runtime(stop_key, stop_relay, stop_app)
    })
    .await
    .map_err(|error| error.to_string())??;
    with_book(&app, |book| book.expect_running(&pubkey, &relay))?;
    let (start_app, start_relay) = (app.clone(), relay.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::managed_agents::start_managed_agent_runtime_pair_lazy(pubkey, start_relay, start_app)
    })
    .await
    .map_err(|error| error.to_string())??;
    super::status::emit_changes(&app, &relay);
    Ok(())
}

/// Restart every employee (each finishes its turn first) and clear crash loops.
#[tauri::command]
pub async fn team_restart_all(relay_url: String, app: AppHandle) -> Result<(), String> {
    let company = team_company(&app, &relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if company.is_paused() {
        return Err(PAUSED.to_string());
    }
    stop_team(&app, &company.relay_url).await?;
    let employees = team_employee_pubkeys(&app)?;
    with_book(&app, |book| {
        for pubkey in &employees {
            book.reset(pubkey);
        }
    })?;
    start_team(&app, &company).await?;
    super::status::emit_changes(&app, &company.relay_url);
    Ok(())
}

/// Pause the team (reason: a person). Only on the computer that runs it.
#[tauri::command]
pub async fn team_pause(relay_url: String, app: AppHandle) -> Result<(), String> {
    let company = team_company(&app, &relay_url)?;
    ensure_runs_here(&app, &company).await?;
    super::pause_company(&app, &company.relay_url, PauseReason::Person).await
}

/// Resume the team. Credits come first: a funded credits pause resumes in
/// part I's seam. Otherwise the person's pause is cleared; another reason
/// that still holds the team is reported in plain words.
#[tauri::command]
pub async fn team_resume(relay_url: String, app: AppHandle) -> Result<(), String> {
    let company = team_company(&app, &relay_url)?;
    ensure_runs_here(&app, &company).await?;
    if credits_pause::resume_if_funded(&app, &company.relay_url).await? {
        return Ok(());
    }
    super::resume_company(&app, &company.relay_url, PauseReason::Person).await?;
    let reasons = saved_companies(&app)?
        .find(&company.relay_url)
        .map(|saved| saved.pause_reasons.clone())
        .unwrap_or_default();
    match still_paused_message(&reasons) {
        Some(message) => Err(message),
        None => Ok(()),
    }
}

/// Every employee's runtime status on this computer.
#[tauri::command]
pub async fn team_status(
    relay_url: String,
    app: AppHandle,
) -> Result<Vec<EmployeeRuntimeStatus>, String> {
    let (all, changed) = super::status::snapshot(&app, &relay_url)?;
    for status in &changed {
        super::emit_status(&app, status);
    }
    Ok(all)
}
