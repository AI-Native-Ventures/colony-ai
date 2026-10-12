//! Employee runtime status for `team_status` and `team://status`.

use std::collections::HashMap;

use tauri::{AppHandle, Manager};

use super::{
    claim_view, emit_status, ensure_computer, normalize_relay, now_unix, saved_companies,
    with_book, EmployeeRuntimeStatus, EmployeeState, PauseReason, NOT_SET_UP,
};
use crate::app_state::AppState;
use crate::managed_agents::{
    load_managed_agents, BackendKind, ManagedAgentRecord, ManagedAgentRuntimeLifecycle,
};

/// The reason a paused employee shows: credits first, then the plan limit,
/// then a person's pause, the order in which a person must act on them.
pub(crate) fn shown_pause_reason(reasons: &[PauseReason]) -> Option<PauseReason> {
    [
        PauseReason::Credits,
        PauseReason::PlanLimit,
        PauseReason::Person,
    ]
    .into_iter()
    .find(|reason| reasons.contains(reason))
}

/// Everything one employee's state depends on.
pub(crate) struct EmployeeFacts<'a> {
    pub(crate) away: bool,
    pub(crate) pause_reasons: &'a [PauseReason],
    pub(crate) failing: bool,
    pub(crate) expected: bool,
    /// The live pair's lifecycle on the company relay, if one is alive.
    pub(crate) lifecycle: Option<&'a ManagedAgentRuntimeLifecycle>,
}

/// Away, then paused, then failing, then the pair's lifecycle.
pub(crate) fn employee_state(facts: &EmployeeFacts<'_>) -> EmployeeState {
    if facts.away {
        return EmployeeState::Away;
    }
    if !facts.pause_reasons.is_empty() {
        return EmployeeState::Paused;
    }
    if facts.failing {
        return EmployeeState::Failing;
    }
    match facts.lifecycle {
        Some(ManagedAgentRuntimeLifecycle::Listening)
        | Some(ManagedAgentRuntimeLifecycle::Waking)
        | Some(ManagedAgentRuntimeLifecycle::Ready) => EmployeeState::Running,
        Some(ManagedAgentRuntimeLifecycle::Starting) => EmployeeState::Starting,
        _ if facts.expected => EmployeeState::Starting,
        _ => EmployeeState::Stopped,
    }
}

/// A company's employees: local agents that start with Colony.
pub(crate) fn is_team_employee(record: &ManagedAgentRecord) -> bool {
    record.start_on_app_launch && record.backend == BackendKind::Local
}

/// The name people see for an employee.
pub(crate) fn display_name(record: &ManagedAgentRecord) -> String {
    record
        .display_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| record.name.clone())
}

/// Every employee's status on `relay_url`, and the ones whose state changed
/// since the last snapshot.
pub(crate) fn snapshot(
    app: &AppHandle,
    relay_url: &str,
) -> Result<(Vec<EmployeeRuntimeStatus>, Vec<EmployeeRuntimeStatus>), String> {
    let relay = normalize_relay(relay_url)?;
    let company = saved_companies(app)?
        .find(&relay)
        .cloned()
        .ok_or_else(|| NOT_SET_UP.to_string())?;
    let me = ensure_computer(app)?.computer_id;
    let away = claim_view(app, &relay)?
        .and_then(|view| view.holder)
        .is_some_and(|holder| holder.computer_id != me);
    let state = app.state::<AppState>();
    let records = {
        let _store = state
            .managed_agents_store_lock
            .lock()
            .map_err(|error| error.to_string())?;
        load_managed_agents(app)?
    };
    let lifecycles: HashMap<String, ManagedAgentRuntimeLifecycle> = {
        let mut runtimes = state
            .managed_agent_processes
            .lock()
            .map_err(|error| error.to_string())?;
        runtimes
            .iter_mut()
            .filter(|(key, _)| key.relay_url == relay)
            .filter_map(|(key, runtime)| {
                runtime
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .is_none()
                    .then(|| (key.pubkey.clone(), runtime.lifecycle.clone()))
            })
            .collect()
    };
    let now = now_unix();
    with_book(app, |book| {
        let mut all = Vec::new();
        let mut changed = Vec::new();
        for record in records.iter().filter(|record| is_team_employee(record)) {
            let pubkey = record.pubkey.to_ascii_lowercase();
            let facts = EmployeeFacts {
                away,
                pause_reasons: &company.pause_reasons,
                failing: book.is_failing(&pubkey),
                expected: book.is_expected(&pubkey),
                lifecycle: lifecycles.get(&pubkey),
            };
            let current = employee_state(&facts);
            let (since, moved) = book.record_state(&pubkey, current, now);
            let status = EmployeeRuntimeStatus {
                agent_pubkey: pubkey.clone(),
                name: display_name(record),
                state: current,
                since,
                restarts_in_window: book.restarts_in_window(&pubkey, now),
                pause_reason: if current == EmployeeState::Paused {
                    shown_pause_reason(&company.pause_reasons)
                } else {
                    None
                },
            };
            if moved {
                changed.push(status.clone());
            }
            all.push(status);
        }
        (all, changed)
    })
}

/// Emit `team://status` for every employee whose state changed.
pub(crate) fn emit_changes(app: &AppHandle, relay_url: &str) {
    match snapshot(app, relay_url) {
        Ok((_, changed)) => {
            for status in &changed {
                emit_status(app, status);
            }
        }
        Err(error) => eprintln!("team runner: status is unavailable: {error}"),
    }
}
