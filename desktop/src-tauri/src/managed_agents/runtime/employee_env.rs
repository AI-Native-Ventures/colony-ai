//! The environment a team employee's harness gets at spawn.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::managed_agents::team_runner::TeamSpawn;
use crate::managed_agents::ManagedAgentRecord;

/// The employee's role as JSON; the harness renders a `<colony-role>` block.
pub(crate) const ROLE_CONTEXT_ENV_VAR: &str = "COLONY_ROLE_CONTEXT";
/// The employee's wake ledger file: missed wake-ups are answered once.
pub(crate) const WAKE_LEDGER_ENV_VAR: &str = "COLONY_WAKE_LEDGER";
/// This computer's install id, the one the team computer record names.
pub(crate) const TEAM_COMPUTER_ID_ENV_VAR: &str = "COLONY_TEAM_COMPUTER_ID";

/// `<app data>/agents/<pubkey>/wake-ledger.json`. The harness creates the folder.
pub(crate) fn wake_ledger_path(agents_dir: &Path, pubkey: &str) -> PathBuf {
    agents_dir
        .join(pubkey.to_ascii_lowercase())
        .join("wake-ledger.json")
}

/// What one spawn exports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EmployeeEnv {
    pub(crate) role_context: Option<String>,
    pub(crate) wake_ledger: Option<PathBuf>,
    pub(crate) team_computer_id: Option<String>,
}

/// Build the environment for `record`. `team` is the fence's answer for this
/// spawn: `Some` only on a saved company's relay on the computer that runs it.
pub(crate) fn employee_env_for(
    record: &ManagedAgentRecord,
    team: Option<&TeamSpawn>,
    agents_dir: &Path,
) -> Result<EmployeeEnv, String> {
    let role_context = record
        .role_context
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|_| {
            format!(
                "{} could not start: its role could not be prepared.",
                record.name
            )
        })?;
    Ok(EmployeeEnv {
        role_context,
        wake_ledger: team.map(|_| wake_ledger_path(agents_dir, &record.pubkey)),
        team_computer_id: team.map(|team| team.computer_id.clone()),
    })
}

/// Proof the employee environment was written. `spawn_with_effort_proof`
/// consumes it, so removing [`apply_employee_env`] from the spawn is a
/// compile error.
#[must_use]
pub(crate) struct EmployeeEnvApplied(());

/// Write the three keys, or remove them when unset, so a value inherited from
/// the process that started the host never reaches an employee.
pub(crate) fn apply_employee_env(command: &mut Command, env: &EmployeeEnv) -> EmployeeEnvApplied {
    match &env.role_context {
        Some(value) => command.env(ROLE_CONTEXT_ENV_VAR, value),
        None => command.env_remove(ROLE_CONTEXT_ENV_VAR),
    };
    match &env.wake_ledger {
        Some(path) => command.env(WAKE_LEDGER_ENV_VAR, path),
        None => command.env_remove(WAKE_LEDGER_ENV_VAR),
    };
    match &env.team_computer_id {
        Some(value) => command.env(TEAM_COMPUTER_ID_ENV_VAR, value),
        None => command.env_remove(TEAM_COMPUTER_ID_ENV_VAR),
    };
    EmployeeEnvApplied(())
}
