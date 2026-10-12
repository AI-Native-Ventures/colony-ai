//! What a team employee's harness receives at spawn.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::employee_env::{
    apply_employee_env, employee_env_for, wake_ledger_path, ROLE_CONTEXT_ENV_VAR,
    TEAM_COMPUTER_ID_ENV_VAR, WAKE_LEDGER_ENV_VAR,
};
use crate::managed_agents::team_runner::TeamSpawn;
use crate::managed_agents::{ManagedAgentRecord, RoleContext};

const PUBKEY: &str = "abababababababababababababababababababababababababababababababab";
const ME: &str = "3f6e2a1c-5b7d-4e8f-9a0b-1c2d3e4f5a6b";

fn record() -> ManagedAgentRecord {
    serde_json::from_value(serde_json::json!({
        "pubkey": PUBKEY,
        "name": "naledi",
        "relay_url": "",
        "acp_command": "",
        "agent_command": "",
        "agent_args": [],
        "mcp_command": "",
        "turn_timeout_seconds": 0,
        "parallelism": 1,
        "system_prompt": null,
        "start_on_app_launch": true,
        "created_at": "",
        "updated_at": "",
        "last_started_at": null,
        "last_stopped_at": null,
        "last_exit_code": null,
        "last_error": null
    }))
    .expect("record fixture parses")
}

fn context() -> RoleContext {
    RoleContext {
        title: "Test Employee".to_string(),
        job: "Post one short note a day".to_string(),
        owns: Some("One short note a day".to_string()),
        ask_before: vec!["anything public".to_string()],
        manager_name: None,
        home_channel_id: Some("0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c".to_string()),
        goal_id: Some("6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10".to_string()),
        on_hire_sources: vec!["business profile".to_string()],
        plan_horizon_days: 14,
    }
}

/// `Some(Some(value))` set, `Some(None)` removed, `None` untouched.
fn env_of(command: &Command, key: &str) -> Option<Option<String>> {
    command
        .get_envs()
        .find(|(name, _)| *name == OsStr::new(key))
        .map(|(_, value)| value.map(|value| value.to_string_lossy().into_owned()))
}

#[test]
fn a_team_employee_gets_its_role_its_wake_ledger_and_this_computers_id() {
    let mut employee = record();
    employee.role_context = Some(context());
    let team = TeamSpawn {
        computer_id: ME.to_string(),
    };
    let agents = Path::new("/data/agents");

    let env = employee_env_for(&employee, Some(&team), agents).expect("environment");
    let mut command = Command::new("buzz-acp");
    let _applied = apply_employee_env(&mut command, &env);

    let role = env_of(&command, ROLE_CONTEXT_ENV_VAR)
        .flatten()
        .expect("role context set");
    let role: RoleContext = serde_json::from_str(&role).expect("role context is JSON");
    assert_eq!(role, context());
    assert_eq!(
        env_of(&command, WAKE_LEDGER_ENV_VAR)
            .flatten()
            .map(PathBuf::from),
        Some(wake_ledger_path(agents, PUBKEY))
    );
    assert_eq!(
        env_of(&command, TEAM_COMPUTER_ID_ENV_VAR)
            .flatten()
            .as_deref(),
        Some(ME)
    );
}

#[test]
fn an_agent_outside_a_saved_company_inherits_none_of_the_team_keys() {
    let env = employee_env_for(&record(), None, Path::new("/data/agents")).expect("environment");
    let mut command = Command::new("buzz-acp");
    // As if the host itself had been started with these set.
    command.env(WAKE_LEDGER_ENV_VAR, "/tmp/somewhere-else.json");
    command.env(TEAM_COMPUTER_ID_ENV_VAR, "not-this-computer");
    let _applied = apply_employee_env(&mut command, &env);

    for key in [
        ROLE_CONTEXT_ENV_VAR,
        WAKE_LEDGER_ENV_VAR,
        TEAM_COMPUTER_ID_ENV_VAR,
    ] {
        assert_eq!(
            env_of(&command, key),
            Some(None),
            "{key} is removed, never inherited"
        );
    }
}

#[test]
fn the_wake_ledger_lives_in_the_employees_agents_folder() {
    let upper = "AB".repeat(32);
    assert_eq!(
        wake_ledger_path(Path::new("/data/agents"), &upper),
        Path::new("/data/agents")
            .join("ab".repeat(32))
            .join("wake-ledger.json")
    );
}

#[test]
fn team_keys_are_reserved_so_saved_environment_cannot_shadow_them() {
    for key in [
        ROLE_CONTEXT_ENV_VAR,
        WAKE_LEDGER_ENV_VAR,
        TEAM_COMPUTER_ID_ENV_VAR,
    ] {
        assert!(
            crate::managed_agents::env_vars::is_reserved_env_key(key),
            "{key} must be reserved"
        );
    }
}
