//! The spawn and stop hooks bind to the production functions.

use tauri::Manager;

use super::{note_spawned, note_stopped_on_purpose, TeamCompany, TeamRunnerState};

const RELAY: &str = "wss://lerato.colony.example";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const PK: &str = "abababababababababababababababababababababababababababababababab";
const ELSEWHERE: &str = "wss://elsewhere.colony.example";

#[test]
fn stop_hooks_only_track_saved_company_relays() {
    let state = TeamRunnerState::default();
    let mut companies = super::CompaniesFile::default();
    companies
        .replace(vec![TeamCompany {
            relay_url: RELAY.into(),
            owner_pubkey: OWNER.into(),
        }])
        .expect("valid");
    state
        .companies
        .lock()
        .expect("companies")
        .remember_load(Ok(companies))
        .expect("loaded");
    let app = tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app builds headless");
    let handle = app.handle();
    let expected = |pubkey: &str| {
        handle
            .state::<TeamRunnerState>()
            .book
            .lock()
            .expect("book")
            .is_expected(pubkey)
    };

    note_spawned(handle, PK, ELSEWHERE);
    assert!(
        !expected(PK),
        "a pair on a relay that is not a saved company is not the team's"
    );

    note_spawned(handle, PK, RELAY);
    assert!(expected(PK));

    note_stopped_on_purpose(handle, PK, ELSEWHERE);
    assert!(
        expected(PK),
        "stopping another relay's pair keeps the employee expected"
    );

    note_stopped_on_purpose(handle, PK, RELAY);
    assert!(
        !expected(PK),
        "a pair stopped on purpose is never restarted"
    );
}
