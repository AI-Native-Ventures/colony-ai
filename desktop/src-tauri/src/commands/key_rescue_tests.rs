use super::*;
use nostr::ToBech32;
use std::cell::{Cell, RefCell};

/// A reader that never touches a real Keychain.
struct FakeReader {
    result: Result<Option<String>, LegacyReadError>,
    calls: Cell<u32>,
}

impl FakeReader {
    fn with_blob(blob: serde_json::Value) -> Self {
        Self {
            result: Ok(Some(blob.to_string())),
            calls: Cell::new(0),
        }
    }

    fn failing(error: LegacyReadError) -> Self {
        Self {
            result: Err(error),
            calls: Cell::new(0),
        }
    }

    fn raw(result: Result<Option<String>, LegacyReadError>) -> Self {
        Self {
            result,
            calls: Cell::new(0),
        }
    }
}

impl LegacyBlobReader for FakeReader {
    fn read_blob(&self) -> Result<Option<Zeroizing<String>>, LegacyReadError> {
        self.calls.set(self.calls.get() + 1);
        self.result.clone().map(|blob| blob.map(Zeroizing::new))
    }
}

struct MemoryAgents(RefCell<Vec<ManagedAgentRecord>>);

impl AgentKeyStore for MemoryAgents {
    fn load(&self) -> Result<Vec<ManagedAgentRecord>, String> {
        Ok(self.0.borrow().clone())
    }

    fn save(&self, records: &[ManagedAgentRecord]) -> Result<(), String> {
        *self.0.borrow_mut() = records.to_vec();
        Ok(())
    }
}

fn record(pubkey: &str, name: &str, nsec: &str) -> ManagedAgentRecord {
    serde_json::from_str(&format!(
        r#"{{
            "pubkey": "{pubkey}",
            "name": "{name}",
            "private_key_nsec": "{nsec}",
            "relay_url": "wss://localhost:3000",
            "acp_command": "buzz-acp",
            "agent_command": "goose",
            "agent_args": [],
            "mcp_command": "",
            "turn_timeout_seconds": 320,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z"
        }}"#
    ))
    .expect("sample record")
}

fn nsec(keys: &Keys) -> String {
    keys.secret_key().to_bech32().expect("nsec")
}

fn pubkey(keys: &Keys) -> String {
    keys.public_key().to_hex()
}

fn write_identity(dir: &Path, keys: &Keys) {
    colony_identity_kernel::save_key_file(&dir.join("identity.key"), keys).expect("identity.key");
}

fn device_secrets(dir: &Path) -> BTreeMap<String, String> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("device-secrets.json")).expect("file"))
        .expect("json")
}

/// The owner after 3.0.23: signed in again, one agent whose key is still in
/// the Keychain, one that is not, one that already has a key.
struct Fixture {
    dir: tempfile::TempDir,
    signed_in: Keys,
    locked: Keys,
    unknown: Keys,
    agents: MemoryAgents,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("data dir");
    let signed_in = Keys::generate();
    write_identity(dir.path(), &signed_in);
    let locked = Keys::generate();
    let unknown = Keys::generate();
    let healthy = Keys::generate();
    let agents = MemoryAgents(RefCell::new(vec![
        record(&pubkey(&locked), "Scout", ""),
        record(&pubkey(&unknown), "Nova", ""),
        record(&pubkey(&healthy), "Kit", &nsec(&healthy)),
    ]));
    Fixture {
        dir,
        signed_in,
        locked,
        unknown,
        agents,
    }
}

fn blob_for(fixture: &Fixture) -> serde_json::Value {
    serde_json::json!({
        format!("agent:{}", pubkey(&fixture.locked)): nsec(&fixture.locked),
        "company-secret:abc:1": "credential-one",
        "identity": nsec(&Keys::generate()),
    })
}

fn key_of(agents: &MemoryAgents, who: &Keys) -> String {
    agents
        .0
        .borrow()
        .iter()
        .find(|record| record.pubkey == pubkey(who))
        .expect("record")
        .private_key_nsec
        .clone()
}

#[test]
fn rescue_fills_agent_keys_and_device_secrets_and_records_the_attempt() {
    let f = fixture();
    let reader = FakeReader::with_blob(blob_for(&f));

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(key_of(&f.agents, &f.locked), nsec(&f.locked));
    assert_eq!(key_of(&f.agents, &f.unknown), "", "no key in the blob");
    assert_eq!(attempt.agents_moved, vec![pubkey(&f.locked)]);
    assert_eq!(attempt.outcome, RescueOutcome::Partial);
    assert_eq!(attempt.device_secrets_moved, 1);
    assert_eq!(
        device_secrets(f.dir.path())
            .get("company-secret:abc:1")
            .map(String::as_str),
        Some("credential-one")
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for file in ["device-secrets.json", "key-rescue.json"] {
            let mode = std::fs::metadata(f.dir.path().join(file))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "{file} must be owner-only");
        }
    }
    // The attempt is on disk and holds no secret.
    let recorded = std::fs::read_to_string(f.dir.path().join("key-rescue.json")).unwrap();
    assert!(!recorded.contains(&nsec(&f.locked)));
    assert!(!recorded.contains("credential-one"));
    assert_eq!(read_attempt(f.dir.path()), Some(attempt));
}

#[test]
fn every_locked_agent_found_is_a_full_rescue() {
    let f = fixture();
    let blob = serde_json::json!({
        format!("agent:{}", pubkey(&f.locked)): nsec(&f.locked),
        format!("agent:{}", pubkey(&f.unknown)): nsec(&f.unknown),
    });
    let reader = FakeReader::with_blob(blob);

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(attempt.outcome, RescueOutcome::Rescued);
    assert_eq!(attempt.agents_moved.len(), 2);
    let status = compute_status(f.dir.path(), &f.agents.0.borrow(), true);
    assert!(status.locked_agents.is_empty());
    assert!(!status.offer);
}

#[test]
fn a_key_that_does_not_belong_to_the_agent_is_never_used() {
    let f = fixture();
    let blob = serde_json::json!({
        format!("agent:{}", pubkey(&f.locked)): nsec(&Keys::generate()),
    });
    let reader = FakeReader::with_blob(blob);

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(key_of(&f.agents, &f.locked), "");
    assert_eq!(attempt.outcome, RescueOutcome::NothingFound);
    assert!(attempt.agents_moved.is_empty());
}

#[test]
fn a_different_signed_in_identity_is_never_replaced() {
    let f = fixture();
    let keychain_identity = Keys::generate();
    let blob = serde_json::json!({ "identity": nsec(&keychain_identity) });
    let reader = FakeReader::with_blob(blob);
    let before = std::fs::read(f.dir.path().join("identity.key")).unwrap();

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(attempt.identity, IdentityOutcome::KeptCurrent);
    assert_eq!(
        std::fs::read(f.dir.path().join("identity.key")).unwrap(),
        before,
        "identity.key must be untouched"
    );
}

#[test]
fn a_keychain_identity_of_another_account_is_not_written_when_the_file_is_absent() {
    let f = fixture();
    std::fs::remove_file(f.dir.path().join("identity.key")).unwrap();
    let blob = serde_json::json!({ "identity": nsec(&Keys::generate()) });
    let reader = FakeReader::with_blob(blob);

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(attempt.identity, IdentityOutcome::DifferentAccount);
    assert!(!f.dir.path().join("identity.key").exists());
}

#[test]
fn the_signed_in_identity_is_restored_only_when_the_file_is_absent() {
    let f = fixture();
    std::fs::remove_file(f.dir.path().join("identity.key")).unwrap();
    let blob = serde_json::json!({ "identity": nsec(&f.signed_in) });
    let reader = FakeReader::with_blob(blob);

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(attempt.identity, IdentityOutcome::Restored);
    let restored =
        colony_identity_kernel::load_key_file(&f.dir.path().join("identity.key")).unwrap();
    assert_eq!(restored.public_key(), f.signed_in.public_key());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(f.dir.path().join("identity.key"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn a_stored_device_credential_is_not_overwritten() {
    let f = fixture();
    FileSecretStore::in_dir(f.dir.path())
        .store_all_if_absent(&BTreeMap::from([(
            "company-secret:abc:1".to_owned(),
            "newer".to_owned(),
        )]))
        .unwrap();
    let reader = FakeReader::with_blob(blob_for(&f));

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(attempt.device_secrets_moved, 0);
    assert_eq!(
        device_secrets(f.dir.path())
            .get("company-secret:abc:1")
            .map(String::as_str),
        Some("newer")
    );
}

#[test]
fn a_denied_prompt_is_recorded_and_the_agents_stay_on_the_readd_path() {
    let f = fixture();
    let reader = FakeReader::failing(LegacyReadError::Denied);

    let attempt = run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();

    assert_eq!(attempt.outcome, RescueOutcome::Denied);
    assert_eq!(key_of(&f.agents, &f.locked), "");
    let status = compute_status(f.dir.path(), &f.agents.0.borrow(), true);
    assert!(!status.offer, "no retry loop");
    let names: Vec<_> = status
        .locked_agents
        .iter()
        .map(|a| a.name.as_str())
        .collect();
    assert_eq!(
        names,
        vec!["Scout", "Nova"],
        "they are listed to delete and re-add"
    );
    assert_eq!(
        status.attempt.map(|a| a.outcome),
        Some(RescueOutcome::Denied)
    );
}

#[test]
fn a_missing_unreadable_or_garbled_item_is_recorded_too() {
    for (reader, expected) in [
        (FakeReader::raw(Ok(None)), RescueOutcome::NotFound),
        (
            FakeReader::failing(LegacyReadError::Unavailable("status".into())),
            RescueOutcome::Unreadable,
        ),
        (
            FakeReader::raw(Ok(Some("not json".to_owned()))),
            RescueOutcome::Unreadable,
        ),
    ] {
        let f = fixture();
        let attempt =
            run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();
        assert_eq!(attempt.outcome, expected);
        assert!(
            !compute_status(f.dir.path(), &f.agents.0.borrow(), true).offer,
            "never offered again after {expected:?}"
        );
    }
}

#[test]
fn the_rescue_is_never_offered_or_run_twice() {
    let f = fixture();
    let first = FakeReader::failing(LegacyReadError::Denied);
    run_rescue(f.dir.path(), &f.signed_in.public_key(), &first, &f.agents).unwrap();
    assert_eq!(first.calls.get(), 1);

    // A later click, even with a reader that would now succeed, reads nothing.
    let second = FakeReader::with_blob(blob_for(&f));
    let again = run_rescue(f.dir.path(), &f.signed_in.public_key(), &second, &f.agents).unwrap();

    assert_eq!(
        second.calls.get(),
        0,
        "the Keychain is not asked a second time"
    );
    assert_eq!(again.outcome, RescueOutcome::Denied);
    assert_eq!(key_of(&f.agents, &f.locked), "");
    assert!(!compute_status(f.dir.path(), &f.agents.0.borrow(), true).offer);
}

#[test]
fn a_corrupt_attempt_record_counts_as_an_attempt() {
    let f = fixture();
    std::fs::write(f.dir.path().join("key-rescue.json"), b"{").unwrap();
    assert!(!compute_status(f.dir.path(), &f.agents.0.borrow(), true).offer);
    let reader = FakeReader::with_blob(blob_for(&f));
    run_rescue(f.dir.path(), &f.signed_in.public_key(), &reader, &f.agents).unwrap();
    assert_eq!(reader.calls.get(), 0);
}

#[test]
fn the_card_is_offered_only_when_something_is_missing_in_a_keyless_build() {
    let f = fixture();
    let locked = f.agents.0.borrow().clone();
    let healthy: Vec<_> = locked
        .iter()
        .filter(|record| !record.private_key_nsec.is_empty())
        .cloned()
        .collect();

    assert!(compute_status(f.dir.path(), &locked, true).offer);
    assert!(
        !compute_status(f.dir.path(), &locked, false).offer,
        "a build that reads the Keychain itself never offers it"
    );
    assert!(
        !compute_status(f.dir.path(), &healthy, true).offer,
        "nothing missing, nothing to offer"
    );

    // Identity file missing while the Keychain migration marker exists.
    std::fs::write(f.dir.path().join("identity.migrated"), b"1").unwrap();
    assert!(
        !compute_status(f.dir.path(), &healthy, true).offer,
        "the identity file is present"
    );
    std::fs::remove_file(f.dir.path().join("identity.key")).unwrap();
    assert!(compute_status(f.dir.path(), &healthy, true).offer);
}
