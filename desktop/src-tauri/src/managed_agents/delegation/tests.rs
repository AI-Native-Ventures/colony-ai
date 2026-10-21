use super::*;
use nostr::Keys;

fn record(agent: &Keys, auth_tag: Option<String>) -> ManagedAgentRecord {
    let mut record: ManagedAgentRecord = serde_json::from_value(serde_json::json!({
        "pubkey": agent.public_key().to_hex(),
        "name": "Scout",
        "private_key_nsec": "nsec1fake",
        "relay_url": "",
        "acp_command": "buzz-acp",
        "agent_command": "buzz-agent",
        "agent_args": [],
        "mcp_command": "",
        "turn_timeout_seconds": 320,
        "created_at": "",
        "updated_at": ""
    }))
    .expect("record fixture");
    record.auth_tag = auth_tag;
    record
}

/// The tag `create_managed_agent` mints: `owner` delegates `agent`.
fn tag(owner: &Keys, agent: &Keys) -> String {
    buzz_sdk_pkg::nip_oa::compute_auth_tag(owner, &agent.public_key(), "").expect("auth tag")
}

#[test]
fn delegation_table_covers_legacy_own_foreign_and_unreadable_tags() {
    let owner = Keys::generate();
    let previous_owner = Keys::generate();
    let agent = Keys::generate();
    let other_agent = Keys::generate();
    let owner_hex = owner.public_key().to_hex();

    let cases: Vec<(&str, Option<String>, bool)> = vec![
        ("legacy record without a tag", None, true),
        (
            "tag minted by the signed-in owner",
            Some(tag(&owner, &agent)),
            true,
        ),
        (
            "tag minted by the account from before an identity reset",
            Some(tag(&previous_owner, &agent)),
            false,
        ),
        (
            "owner's tag copied from a different agent",
            Some(tag(&owner, &other_agent)),
            false,
        ),
        ("tag that is not JSON", Some("not json".into()), false),
        ("empty tag", Some(String::new()), false),
        (
            "structurally valid tag with a forged signature",
            Some(format!(
                "[\"auth\",\"{owner_hex}\",\"\",\"{}\"]",
                "ab".repeat(64)
            )),
            false,
        ),
    ];
    for (label, auth_tag, expected) in cases {
        assert_eq!(
            record_delegated_by(&record(&agent, auth_tag), &owner_hex),
            expected,
            "{label}"
        );
    }
}

#[test]
fn owner_comparison_ignores_hex_case() {
    let owner = Keys::generate();
    let agent = Keys::generate();
    let own = record(&agent, Some(tag(&owner, &agent)));
    assert!(record_delegated_by(
        &own,
        &owner.public_key().to_hex().to_ascii_uppercase()
    ));
}

#[test]
fn start_lookup_refuses_a_foreign_record_in_plain_words_and_keeps_it() {
    let owner = Keys::generate();
    let previous_owner = Keys::generate();
    let own_agent = Keys::generate();
    let foreign_agent = Keys::generate();
    let owner_hex = owner.public_key().to_hex();
    let foreign_tag = tag(&previous_owner, &foreign_agent);
    let mut records = vec![
        record(&own_agent, Some(tag(&owner, &own_agent))),
        record(&foreign_agent, Some(foreign_tag.clone())),
    ];

    let own_pubkey = own_agent.public_key().to_hex();
    let found =
        find_delegated_agent_mut(&mut records, &own_pubkey, &owner_hex).expect("own agent starts");
    assert_eq!(found.pubkey, own_pubkey);

    let foreign_pubkey = foreign_agent.public_key().to_hex();
    let error = find_delegated_agent_mut(&mut records, &foreign_pubkey, &owner_hex)
        .expect_err("foreign agent is refused");
    assert_eq!(error, FOREIGN_DELEGATION_ERROR);
    assert!(
        !error.contains('\u{2014}'),
        "user-facing copy must not use the long dash"
    );
    // Refusal never deletes or rewrites the other account's record.
    assert_eq!(records.len(), 2);
    assert_eq!(records[1].auth_tag.as_deref(), Some(foreign_tag.as_str()));

    let missing = find_delegated_agent_mut(&mut records, &"cd".repeat(32), &owner_hex)
        .expect_err("missing agent");
    assert!(missing.contains("not found"), "{missing}");
}

#[test]
fn list_keeps_own_and_legacy_records_in_order_and_drops_foreign_ones() {
    let owner = Keys::generate();
    let previous_owner = Keys::generate();
    let own = Keys::generate();
    let legacy = Keys::generate();
    let foreign = Keys::generate();
    let unreadable = Keys::generate();
    let records = vec![
        record(&foreign, Some(tag(&previous_owner, &foreign))),
        record(&own, Some(tag(&owner, &own))),
        record(&unreadable, Some("[\"auth\"]".into())),
        record(&legacy, None),
    ];
    let owner_hex = owner.public_key().to_hex();

    let listed: Vec<String> = delegated_records(&records, &owner_hex)
        .map(|record| record.pubkey.clone())
        .collect();
    assert_eq!(
        listed,
        vec![own.public_key().to_hex(), legacy.public_key().to_hex()]
    );

    // Signing back into the account that made the foreign record shows it again.
    let previous_hex = previous_owner.public_key().to_hex();
    let listed_for_previous: Vec<String> = delegated_records(&records, &previous_hex)
        .map(|record| record.pubkey.clone())
        .collect();
    assert_eq!(
        listed_for_previous,
        vec![foreign.public_key().to_hex(), legacy.public_key().to_hex()]
    );
}

#[test]
fn auto_start_requires_launch_flag_local_backend_and_delegation() {
    let owner = Keys::generate();
    let previous_owner = Keys::generate();
    let agent = Keys::generate();
    let owner_hex = owner.public_key().to_hex();

    let mut own = record(&agent, Some(tag(&owner, &agent)));
    own.start_on_app_launch = true;
    assert!(auto_start_eligible(&own, &owner_hex));

    let mut legacy = record(&agent, None);
    legacy.start_on_app_launch = true;
    assert!(auto_start_eligible(&legacy, &owner_hex));

    let mut foreign = record(&agent, Some(tag(&previous_owner, &agent)));
    foreign.start_on_app_launch = true;
    assert!(
        !auto_start_eligible(&foreign, &owner_hex),
        "another account's agent must never auto-start"
    );

    let mut manual = own.clone();
    manual.start_on_app_launch = false;
    assert!(!auto_start_eligible(&manual, &owner_hex));

    let mut remote = own.clone();
    remote.backend = BackendKind::Provider {
        id: "provider".into(),
        config: serde_json::json!({}),
    };
    assert!(!auto_start_eligible(&remote, &owner_hex));
}

#[test]
fn signed_in_owner_is_the_live_identity() {
    let state = crate::app_state::build_app_state();
    let owner = Keys::generate();
    *state.keys.lock().expect("keys lock") = owner.clone();
    assert_eq!(
        signed_in_owner_hex(&state).expect("owner"),
        owner.public_key().to_hex()
    );
}
