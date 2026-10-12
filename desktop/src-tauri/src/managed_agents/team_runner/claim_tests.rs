//! The team computer fence (overview review focus 2): only the computer the
//! record names starts a saved company's employees.

use std::collections::HashMap;

use nostr::{EventBuilder, Keys, Kind, Tag};

use super::claim::{
    clearance_for, launch_candidates, parse_head, spawn_refusal, status_from, ClaimView,
    CHECKING_REFUSAL, PAUSED_REFUSAL,
};
use super::companies::CompaniesFile;
use super::computer::ComputerIdentity;
use super::{normalize_relay, PauseReason, TeamCompany, TeamComputerInfo};
use crate::managed_agents::ManagedAgentRecord;

const RELAY: &str = "wss://lerato.colony.example";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const ME: &str = "3f6e2a1c-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER: &str = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

fn saved() -> CompaniesFile {
    let mut file = CompaniesFile::default();
    file.replace(vec![TeamCompany {
        relay_url: RELAY.into(),
        owner_pubkey: OWNER.into(),
    }])
    .expect("valid");
    file
}

fn held_by(id: &str, name: &str) -> ClaimView {
    ClaimView {
        holder: Some(TeamComputerInfo {
            computer_id: id.into(),
            computer_name: name.into(),
            last_seen_at: 1_760_180_300,
        }),
        fetched_at: 1_760_180_301,
    }
}

fn me() -> ComputerIdentity {
    ComputerIdentity {
        computer_id: ME.into(),
    }
}

fn claims(view: ClaimView) -> HashMap<String, ClaimView> {
    HashMap::from([(normalize_relay(RELAY).expect("relay"), view)])
}

fn record(pubkey: &str, start_on_app_launch: bool) -> ManagedAgentRecord {
    serde_json::from_value(serde_json::json!({
        "pubkey": pubkey,
        "name": "r",
        "relay_url": "",
        "acp_command": "",
        "agent_command": "",
        "agent_args": [],
        "mcp_command": "",
        "turn_timeout_seconds": 0,
        "parallelism": 1,
        "system_prompt": null,
        "start_on_app_launch": start_on_app_launch,
        "created_at": "",
        "updated_at": "",
        "last_started_at": null,
        "last_stopped_at": null,
        "last_exit_code": null,
        "last_error": null
    }))
    .expect("record fixture parses")
}

#[test]
fn spawn_refusal_names_the_computer_that_runs_the_team() {
    let file = saved();
    let company = &file.companies[0];
    assert_eq!(
        spawn_refusal(company, Some(&held_by(OTHER, "Office iMac")), Some(ME)),
        Some("Your team runs on Office iMac. Move it here to run it on this computer.".to_string())
    );
    assert_eq!(
        spawn_refusal(
            company,
            Some(&held_by(ME, "Lerato's MacBook Air")),
            Some(ME)
        ),
        None
    );
}

#[test]
fn nothing_starts_before_this_computer_knows_it_holds_the_team() {
    let file = saved();
    let company = &file.companies[0];
    let released = ClaimView {
        holder: None,
        fetched_at: 1,
    };
    assert_eq!(
        spawn_refusal(company, None, Some(ME)).as_deref(),
        Some(CHECKING_REFUSAL)
    );
    assert_eq!(
        spawn_refusal(company, Some(&released), Some(ME)).as_deref(),
        Some(CHECKING_REFUSAL)
    );
    assert_eq!(
        spawn_refusal(company, Some(&held_by(ME, "x")), None).as_deref(),
        Some(CHECKING_REFUSAL)
    );
}

#[test]
fn a_paused_company_starts_no_employee_even_on_its_own_computer() {
    let mut file = saved();
    file.add_pause(RELAY, PauseReason::Person).expect("saved");
    assert_eq!(
        spawn_refusal(&file.companies[0], Some(&held_by(ME, "x")), Some(ME)).as_deref(),
        Some(PAUSED_REFUSAL)
    );
}

#[test]
fn clearance_fences_only_saved_companies() {
    let file = saved();
    let elsewhere = claims(held_by(OTHER, "Office iMac"));
    assert_eq!(
        clearance_for(
            &file,
            &elsewhere,
            Some(&me()),
            "wss://another.colony.example"
        ),
        Ok(None),
        "a relay that is not a saved company is never fenced"
    );
    assert!(clearance_for(&file, &elsewhere, Some(&me()), RELAY).is_err());

    let mine = claims(held_by(ME, "Lerato's MacBook Air"));
    let team = clearance_for(&file, &mine, Some(&me()), RELAY)
        .expect("this computer runs the team")
        .expect("a team spawn");
    assert_eq!(team.computer_id, ME);
}

#[test]
fn launch_candidates_are_empty_when_this_computer_may_not_run_the_team() {
    let starts = "a".repeat(64);
    let records = vec![record(&starts, true), record(&"b".repeat(64), false)];
    assert_eq!(launch_candidates(&records, false), vec![starts]);
    assert!(launch_candidates(&records, true).is_empty());
}

#[test]
fn only_relay_signed_team_computer_heads_are_read() {
    let relay = Keys::generate();
    let stranger = Keys::generate();
    let relay_hex = relay.public_key().to_hex();
    let held = format!(
        r#"{{"computerId":"{OTHER}","computerName":"Office iMac","claimedBy":"{OWNER}","claimedAt":1,"lastSeenAt":2,"keyFromANewerRelay":true}}"#
    );
    let head = |keys: &Keys, d: &str, content: &str| {
        EventBuilder::new(Kind::Custom(30658), content)
            .tag(Tag::parse(["d", d]).expect("d tag"))
            .sign_with_keys(keys)
            .expect("signed")
    };

    let view = parse_head(&head(&relay, "team-computer", &held), &relay_hex).expect("relay head");
    assert_eq!(
        view.holder().map(|holder| holder.computer_name),
        Some("Office iMac".to_string())
    );
    assert!(parse_head(&head(&stranger, "team-computer", &held), &relay_hex).is_err());
    assert!(parse_head(&head(&relay, "business-profile", &held), &relay_hex).is_err());

    let mut forged = head(&relay, "team-computer", &held);
    forged.content = held.replace("Office iMac", "Forged");
    assert!(parse_head(&forged, &relay_hex).is_err());

    let released = format!(
        r#"{{"computerId":"{OTHER}","computerName":"Office iMac","claimedBy":"{OWNER}","claimedAt":1,"lastSeenAt":3,"releasedAt":3}}"#
    );
    let view = parse_head(&head(&relay, "team-computer", &released), &relay_hex).expect("released");
    assert_eq!(view.holder(), None, "a released record names no computer");
}

#[test]
fn status_reports_whether_this_computer_runs_the_team() {
    assert!(status_from(Some(&held_by(ME, "Lerato's MacBook Air")), ME).is_this_computer);
    let away = status_from(Some(&held_by(OTHER, "Office iMac")), ME);
    assert!(!away.is_this_computer);
    assert_eq!(
        away.holder.map(|holder| holder.computer_name),
        Some("Office iMac".to_string())
    );
    assert_eq!(status_from(None, ME).holder, None);
    assert_eq!(status_from(None, ME).this_computer_id, ME);
}
