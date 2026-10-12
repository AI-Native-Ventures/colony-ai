//! Reading the relay's answers during a hire.

use nostr::{EventBuilder, Keys, Kind, Tag};
use uuid::Uuid;

use super::hire_relay::{employee_for, snapshot_has_member, time_zone_from_profile};
use crate::managed_agents::{ManagedAgentRecord, RoleContext};

const CHANNEL: &str = "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c";
const HIRE: &str = "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const EMPLOYEE: &str = "abababababababababababababababababababababababababababababababab";

fn record(pubkey: &str, goal: Option<&str>) -> ManagedAgentRecord {
    let mut record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
        "pubkey": pubkey,
        "name": "gate-tester",
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
    record.role_context = goal.map(|goal| RoleContext {
        title: "Test Employee".into(),
        job: "Post one short note a day".into(),
        owns: None,
        ask_before: Vec::new(),
        manager_name: None,
        home_channel_id: Some(CHANNEL.into()),
        goal_id: Some(goal.into()),
        on_hire_sources: Vec::new(),
        plan_horizon_days: 14,
    });
    record
}

#[test]
fn membership_snapshots_list_members_by_their_p_tags() {
    let relay = Keys::generate();
    let snapshot = EventBuilder::new(Kind::Custom(39002), "")
        .tags([
            Tag::parse(["d", CHANNEL]).expect("d"),
            Tag::parse(["p", OWNER, "", "owner"]).expect("p"),
            Tag::parse(["p", EMPLOYEE, "", "bot"]).expect("p"),
        ])
        .sign_with_keys(&relay)
        .expect("signed");
    assert!(snapshot_has_member(&snapshot, OWNER));
    assert!(snapshot_has_member(&snapshot, &EMPLOYEE.to_uppercase()));
    assert!(!snapshot_has_member(&snapshot, &"cd".repeat(32)));
}

#[test]
fn the_company_time_zone_is_read_from_the_profile_head() {
    assert_eq!(
        time_zone_from_profile(
            r#"{"schemaVersion":1,"name":"Lerato Designs","timeZone":"Africa/Johannesburg","keyFromANewerRelay":1}"#
        )
        .as_deref(),
        Some("Africa/Johannesburg")
    );
    assert_eq!(
        time_zone_from_profile(r#"{"schemaVersion":1,"name":"Lerato Designs"}"#),
        None
    );
    assert_eq!(time_zone_from_profile("not json"), None);
}

#[test]
fn a_resumed_hire_finds_the_employee_it_already_made() {
    let hire = Uuid::parse_str(HIRE).expect("uuid");
    let made = record(EMPLOYEE, Some(HIRE));
    let other = record(
        &"cd".repeat(32),
        Some("7a1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10"),
    );
    assert_eq!(
        employee_for(&[other.clone(), made.clone()], hire, None).as_deref(),
        Some(EMPLOYEE)
    );
    assert_eq!(
        employee_for(
            &[record(EMPLOYEE, None)],
            hire,
            Some(&EMPLOYEE.to_uppercase())
        )
        .as_deref(),
        Some(EMPLOYEE),
        "the head's attached employee counts when it is a local record"
    );
    assert_eq!(employee_for(&[other], hire, None), None);
}
