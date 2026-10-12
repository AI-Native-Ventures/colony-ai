//! The host registers every team command under the overview's names.

const TEAM_COMMANDS: [&str; 9] = [
    "team_set_companies",
    "team_claim_status",
    "team_claim",
    "team_hire_complete",
    "team_restart_employee",
    "team_restart_all",
    "team_pause",
    "team_resume",
    "team_status",
];

#[test]
fn every_team_command_is_registered_with_the_host() {
    let lib = include_str!("../../lib.rs");
    let handler = lib
        .split("tauri::generate_handler![")
        .nth(1)
        .expect("the invoke handler list");
    for name in TEAM_COMMANDS {
        assert!(
            handler.contains(&format!("managed_agents::team_runner::commands::{name},")),
            "{name} must be registered"
        );
    }
}

#[test]
fn every_team_command_exists_with_its_contract_name() {
    let commands = include_str!("commands.rs");
    for name in TEAM_COMMANDS {
        assert!(
            commands.contains(&format!("pub async fn {name}(")),
            "{name} must be a command"
        );
    }
}

#[test]
fn phase_zero_claim_refuses_moves_until_employee_keys_can_move() {
    let commands = include_str!("commands.rs");
    let claim = commands
        .split("pub async fn team_claim(")
        .nth(1)
        .expect("claim command")
        .split("pub async fn team_hire_complete(")
        .next()
        .expect("claim body");
    assert!(
        claim.contains("if force {"),
        "forced moves are deferred by integration item 19"
    );
    assert!(claim.contains("Moving your team to another computer is not available yet."));
}
