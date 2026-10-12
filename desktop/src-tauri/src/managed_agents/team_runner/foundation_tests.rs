//! Saved companies, this computer's install id and the bridge wire shapes.

use super::companies::{self, CompaniesFile, COMPANIES_FILE, MAX_COMPANIES};
use super::computer::{self, COMPUTER_FILE};
use super::{
    normalize_relay, EmployeeProblem, EmployeeRuntimeStatus, EmployeeState, PauseReason,
    ProblemKind, TeamCompany, TeamComputerInfo, TeamComputerStatus,
};
use serde_json::json;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const PARTNER: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const RELAY: &str = "wss://lerato.colony.example";

fn company(relay: &str, owner: &str) -> TeamCompany {
    TeamCompany {
        relay_url: relay.to_string(),
        owner_pubkey: owner.to_string(),
    }
}

fn relay(url: &str) -> String {
    normalize_relay(url).expect("valid relay url")
}

#[test]
fn saved_companies_survive_a_restart_with_their_pause_reasons() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPANIES_FILE);
    let mut file = CompaniesFile::default();
    file.replace(vec![company(RELAY, OWNER)])
        .expect("valid companies");
    assert!(file
        .add_pause(RELAY, PauseReason::Person)
        .expect("saved company"));
    assert!(
        !file
            .add_pause(RELAY, PauseReason::Person)
            .expect("saved company"),
        "a reason is stored once"
    );
    file.add_pause(RELAY, PauseReason::Credits)
        .expect("saved company");
    companies::save(&path, &file).expect("save");

    let loaded = companies::load(&path).expect("load");
    assert_eq!(loaded, file);
    let saved = loaded.find(RELAY).expect("saved company");
    assert_eq!(
        saved.pause_reasons,
        vec![PauseReason::Person, PauseReason::Credits]
    );
    assert!(saved.is_paused());

    let on_disk: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).expect("read")).expect("json");
    assert_eq!(
        on_disk["companies"][0]["pauseReasons"],
        json!(["person", "credits"])
    );

    let mut resumed = loaded.clone();
    assert!(resumed
        .remove_pause(RELAY, PauseReason::Person)
        .expect("saved company"));
    assert!(
        resumed.find(RELAY).expect("saved").is_paused(),
        "credits still hold it"
    );
    resumed
        .remove_pause(RELAY, PauseReason::Credits)
        .expect("saved company");
    assert!(!resumed.find(RELAY).expect("saved").is_paused());
}

#[test]
fn replacing_the_list_keeps_pause_reasons_and_reports_removed_companies() {
    let mut file = CompaniesFile::default();
    file.replace(vec![
        company("wss://a.colony.example", OWNER),
        company("wss://b.colony.example", OWNER),
    ])
    .expect("valid");
    file.add_pause("wss://a.colony.example", PauseReason::Person)
        .expect("saved");

    let removed = file
        .replace(vec![company("wss://a.colony.example", OWNER)])
        .expect("valid");

    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0].relay_url, relay("wss://b.colony.example"));
    assert_eq!(file.companies.len(), 1);
    assert_eq!(file.companies[0].pause_reasons, vec![PauseReason::Person]);
}

#[test]
fn companies_are_validated_deduplicated_and_bounded() {
    let mut file = CompaniesFile::default();
    file.replace(vec![
        company(RELAY, &OWNER.to_uppercase()),
        company(RELAY, PARTNER),
    ])
    .expect("valid");
    assert_eq!(
        file.companies.len(),
        1,
        "one entry per relay, the first wins"
    );
    assert_eq!(file.companies[0].owner_pubkey, OWNER);
    assert_eq!(file.companies[0].relay_url, relay(RELAY));

    assert!(file.replace(vec![company(RELAY, "not-a-key")]).is_err());
    let too_many = (0..=MAX_COMPANIES)
        .map(|n| company(&format!("wss://c{n}.colony.example"), OWNER))
        .collect();
    assert!(file.replace(too_many).is_err());
    assert_eq!(file.companies.len(), 1, "a rejected list changes nothing");
}

#[test]
fn a_missing_companies_file_is_empty_and_an_unreadable_one_is_an_error() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPANIES_FILE);
    assert_eq!(
        companies::load(&path).expect("missing file"),
        CompaniesFile::default()
    );
    std::fs::write(&path, b"{ not json").expect("write");
    assert!(
        companies::load(&path).is_err(),
        "an unreadable file must never read as no companies"
    );
}

#[test]
fn the_active_company_is_the_first_one_this_identity_saved() {
    let mut file = CompaniesFile::default();
    file.replace(vec![
        company("wss://partner.colony.example", PARTNER),
        company("wss://mine.colony.example", OWNER),
    ])
    .expect("valid");
    let active = file.active(OWNER).expect("owned company");
    assert_eq!(active.relay_url, relay("wss://mine.colony.example"));
    assert!(file
        .active("3333333333333333333333333333333333333333333333333333333333333333")
        .is_none());
}

#[test]
fn this_computer_keeps_one_install_id() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPUTER_FILE);
    let first = computer::load_or_create(&path).expect("created");
    let id = uuid::Uuid::parse_str(&first.computer_id).expect("uuid");
    assert_eq!(id.get_version_num(), 4);
    assert_eq!(
        first.computer_id,
        id.to_string(),
        "lowercase and hyphenated"
    );
    assert_eq!(computer::load_or_create(&path).expect("reused"), first);
}

#[test]
fn an_unreadable_computer_file_is_set_aside_and_replaced() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPUTER_FILE);
    std::fs::write(&path, br#"{"computerId":"not-a-uuid"}"#).expect("write");
    let identity = computer::load_or_create(&path).expect("replaced");
    assert!(uuid::Uuid::parse_str(&identity.computer_id).is_ok());
    assert!(
        path.with_extension("json.invalid").exists(),
        "the old file is kept beside it"
    );
}

#[test]
fn computer_names_are_plain_and_bounded() {
    assert_eq!(
        computer::sanitize_name("  Lerato's MacBook Air\n"),
        "Lerato's MacBook Air"
    );
    assert_eq!(computer::sanitize_name("\u{7}\u{1b}"), "This computer");
    assert_eq!(
        computer::sanitize_name(&"n".repeat(200)).chars().count(),
        80
    );
}

#[test]
fn bridge_types_use_the_contract_wire_shape() {
    let status = EmployeeRuntimeStatus {
        agent_pubkey: OWNER.to_string(),
        name: "Naledi".to_string(),
        state: EmployeeState::Paused,
        since: 1_760_180_000,
        restarts_in_window: 0,
        pause_reason: Some(PauseReason::PlanLimit),
    };
    assert_eq!(
        serde_json::to_value(&status).expect("status"),
        json!({
            "agentPubkey": OWNER,
            "name": "Naledi",
            "state": "paused",
            "since": 1_760_180_000,
            "restartsInWindow": 0,
            "pauseReason": "plan_limit"
        })
    );
    let running = EmployeeRuntimeStatus {
        state: EmployeeState::Running,
        pause_reason: None,
        ..status
    };
    assert!(serde_json::to_value(&running)
        .expect("status")
        .get("pauseReason")
        .is_none());

    let problem = EmployeeProblem {
        agent_pubkey: Some(OWNER.to_string()),
        kind: ProblemKind::DiskFull,
        detail: "This computer is almost out of space, so Naledi is waiting.".to_string(),
    };
    assert_eq!(
        serde_json::to_value(&problem).expect("problem")["kind"],
        "disk_full"
    );

    let computer = TeamComputerStatus {
        this_computer_id: "a".into(),
        holder: Some(TeamComputerInfo {
            computer_id: "b".into(),
            computer_name: "Office iMac".into(),
            last_seen_at: 5,
        }),
        is_this_computer: false,
    };
    assert_eq!(
        serde_json::to_value(&computer).expect("status"),
        json!({
            "thisComputerId": "a",
            "holder": { "computerId": "b", "computerName": "Office iMac", "lastSeenAt": 5 },
            "isThisComputer": false
        })
    );
    let input: TeamCompany =
        serde_json::from_value(json!({ "relayUrl": RELAY, "ownerPubkey": OWNER }))
            .expect("company");
    assert_eq!(input.owner_pubkey, OWNER);
}
