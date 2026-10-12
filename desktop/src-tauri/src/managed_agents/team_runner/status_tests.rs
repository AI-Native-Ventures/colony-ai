//! What `team_status` reports.

use super::status::{
    display_name, employee_state, is_team_employee, shown_pause_reason, EmployeeFacts,
};
use super::{EmployeeState, PauseReason};
use crate::managed_agents::{ManagedAgentRecord, ManagedAgentRuntimeLifecycle};

fn facts<'a>(
    pause_reasons: &'a [PauseReason],
    lifecycle: Option<&'a ManagedAgentRuntimeLifecycle>,
) -> EmployeeFacts<'a> {
    EmployeeFacts {
        away: false,
        pause_reasons,
        failing: false,
        expected: true,
        lifecycle,
    }
}

#[test]
fn away_wins_over_paused_and_failing() {
    let mut employee = facts(&[PauseReason::Person], None);
    employee.failing = true;
    employee.away = true;
    assert_eq!(employee_state(&employee), EmployeeState::Away);
    employee.away = false;
    assert_eq!(employee_state(&employee), EmployeeState::Paused);
    employee.pause_reasons = &[];
    assert_eq!(employee_state(&employee), EmployeeState::Failing);
}

#[test]
fn a_paused_team_shows_the_reason_a_person_must_act_on_first() {
    assert_eq!(
        shown_pause_reason(&[PauseReason::Person, PauseReason::Credits]),
        Some(PauseReason::Credits)
    );
    assert_eq!(
        shown_pause_reason(&[PauseReason::Person, PauseReason::PlanLimit]),
        Some(PauseReason::PlanLimit)
    );
    assert_eq!(
        shown_pause_reason(&[PauseReason::Person]),
        Some(PauseReason::Person)
    );
    assert_eq!(shown_pause_reason(&[]), None);
}

#[test]
fn the_pair_lifecycle_maps_to_starting_running_and_stopped() {
    use ManagedAgentRuntimeLifecycle as L;
    for (lifecycle, expected) in [
        (L::Starting, EmployeeState::Starting),
        (L::Listening, EmployeeState::Running),
        (L::Waking, EmployeeState::Running),
        (L::Ready, EmployeeState::Running),
        (L::Failed, EmployeeState::Starting),
    ] {
        assert_eq!(
            employee_state(&facts(&[], Some(&lifecycle))),
            expected,
            "{lifecycle:?}"
        );
    }
    assert_eq!(
        employee_state(&facts(&[], None)),
        EmployeeState::Starting,
        "an expected employee waiting for its restart is starting"
    );
    let mut stopped = facts(&[], None);
    stopped.expected = false;
    assert_eq!(employee_state(&stopped), EmployeeState::Stopped);
}

#[test]
fn employees_are_local_agents_that_start_with_colony_and_keep_their_names() {
    let mut record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
        "pubkey": "ab".repeat(32),
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
    .expect("record fixture parses");
    assert!(is_team_employee(&record));
    assert_eq!(display_name(&record), "naledi");
    record.display_name = Some("Naledi".to_string());
    assert_eq!(display_name(&record), "Naledi");
    record.start_on_app_launch = false;
    assert!(!is_team_employee(&record));
}
