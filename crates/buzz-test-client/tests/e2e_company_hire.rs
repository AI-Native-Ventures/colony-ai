//! Company hire relay integration tests.
//!
//! These tests run against a disposable local relay, Postgres, and Redis. They
//! are ignored with the rest of the relay-backed E2E suite by default.

use std::time::Duration;

use buzz_core::company_records::{
    hire_d_tag, AskAction, AskActionKind, AskCategory, AskRecord, AskStatus, AskSubject,
    AskSubjectKind, AskType, HireAction, HireActionKind, HireHead, HireProposal, HireRolePack,
    HireStatus, HireTool, HireToolRisk, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_ASK_HEAD, KIND_HIRE_ACTION, KIND_HIRE_HEAD};
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use serde_json::Value;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "company hire E2E tests only send events to a local relay"
    );
    url
}

fn relay_http_url() -> String {
    relay_url()
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_string()
}

fn relay_authority() -> String {
    let url = url::Url::parse(&relay_http_url()).expect("relay HTTP URL");
    url[url::Position::BeforeHost..url::Position::AfterPort].to_string()
}

fn test_database_url() -> String {
    std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name a disposable E2E database")
}

async fn ensure_test_community(host: &str) -> Uuid {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities (id, host) VALUES ($1, $2) \
         ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(id)
    .bind(host)
    .execute(&pool)
    .await
    .expect("seed E2E community");
    sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
        .bind(host)
        .fetch_one(&pool)
        .await
        .expect("read E2E community")
}

async fn seed_relay_member(keys: &Keys, role: &str) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, $3, NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET role = $3, updated_at = now()",
    )
    .bind(community_id)
    .bind(keys.public_key().to_hex())
    .bind(role)
    .execute(&pool)
    .await
    .expect("seed E2E relay member");
}

async fn post_event(keys: &Keys, event: &Event) -> Value {
    let response = reqwest::Client::new()
        .post(format!("{}/events", relay_http_url()))
        .header("X-Pubkey", keys.public_key().to_hex())
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(event).expect("serialize E2E event"))
        .send()
        .await
        .expect("submit E2E event");
    response.json().await.expect("parse E2E response")
}

fn assert_accepted(response: &Value) {
    assert!(
        response["accepted"].as_bool().unwrap_or(false),
        "event was rejected: {response}"
    );
}

fn assert_rejected(response: &Value, expected: &str) {
    assert!(
        !response["accepted"].as_bool().unwrap_or(false),
        "event should have been rejected: {response}"
    );
    assert!(
        response["message"]
            .as_str()
            .unwrap_or_default()
            .contains(expected),
        "rejection should explain {expected}: {response}"
    );
}

fn hire_proposal(hire_id: Uuid, name: String, channel_id: Uuid) -> HireProposal {
    HireProposal {
        hire_id,
        role_pack: HireRolePack {
            persona_id: "persona-e2e-researcher".into(),
            title: "Researcher".into(),
            job: "Prepare research summaries".into(),
            skills: vec!["Research".into()],
            tools: vec![HireTool {
                name: "read_reports".into(),
                risk: HireToolRisk::Low,
            }],
            worker_menu: vec!["runtime-e2e".into()],
            default_allowance: None,
        },
        display_name: name,
        title: "Researcher".into(),
        manager_pubkey: None,
        introduction_channel_id: channel_id,
        runtime_id: "runtime-e2e".into(),
        provider_id: None,
        model_id: None,
        weekly_allowance: Some("15".into()),
    }
}

async fn submit_hire_action(keys: &Keys, action: &HireAction) -> Value {
    let event = EventBuilder::new(
        Kind::Custom(KIND_HIRE_ACTION as u16),
        serde_json::to_string(action).expect("serialize hire action"),
    )
    .tags([Tag::parse(["d", hire_d_tag(action.hire_id).as_str()]).expect("hire d-tag")])
    .sign_with_keys(keys)
    .expect("sign hire action");
    post_event(keys, &event).await
}

async fn current_hire_head(keys: &Keys, hire_id: Uuid) -> (String, HireHead) {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query hire head");
    let sub_id = format!("e2e-company-hire-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_HIRE_HEAD as u16))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            [hire_d_tag(hire_id)],
        );
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe hire head");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read hire head");
    client.disconnect().await.expect("disconnect query client");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned current hire head");
    let head: HireHead = serde_json::from_str(&event.content).expect("parse hire head");
    assert_eq!(head.proposal.hire_id, hire_id);
    (event.id.to_hex(), head)
}

async fn create_test_channel(owner: &Keys) -> Uuid {
    let channel_id = Uuid::new_v4();
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id"),
            Tag::parse(["name", &format!("hire-{channel_id}")]).expect("channel name"),
            Tag::parse(["channel_type", "stream"]).expect("channel type"),
            Tag::parse(["visibility", "open"]).expect("channel visibility"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel create");
    assert_accepted(&post_event(owner, &event).await);
    channel_id
}

async fn add_channel_member(owner: &Keys, member: &Keys, channel_id: Uuid) {
    let mut client = BuzzTestClient::connect(&relay_url(), owner)
        .await
        .expect("connect to add channel member");
    let event = EventBuilder::new(Kind::Custom(9000), "")
        .allow_self_tagging()
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id"),
            Tag::parse(["p", member.public_key().to_hex().as_str()]).expect("member pubkey"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel invite");
    let response = client.send_event(event).await.expect("add channel member");
    assert!(
        response.accepted,
        "channel invite rejected: {}",
        response.message
    );
    client.disconnect().await.expect("disconnect after invite");
}

async fn send_root_message(keys: &Keys, channel_id: Uuid) -> String {
    let event = EventBuilder::new(Kind::Custom(9), "Please review this proposed hire")
        .tags([Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id")])
        .sign_with_keys(keys)
        .expect("sign thread root");
    let event_id = event.id.to_hex();
    assert_accepted(&post_event(keys, &event).await);
    event_id
}

async fn submit_ask_action(keys: &Keys, channel_id: Uuid, action: &AskAction) -> Value {
    let event = buzz_sdk::asks::build_ask_action(channel_id, action)
        .expect("build hire ask action")
        .sign_with_keys(keys)
        .expect("sign hire ask action");
    post_event(keys, &event).await
}

#[tokio::test]
#[ignore]
async fn company_hire_authority_name_collisions_and_founder_signoff_are_enforced() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let manager = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&manager, "member").await;

    let channel_id = Uuid::new_v4();
    let hire_id = Uuid::new_v4();
    let name = format!("Hire {}", hire_id.simple());
    let create = HireAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        hire_id,
        action: HireActionKind::Create,
        expected_head_event_id: None,
        proposal: Some(hire_proposal(hire_id, name.clone(), channel_id)),
        employee_pubkey: None,
        introduction_event_id: None,
        reason: None,
    };
    assert_accepted(&submit_hire_action(&admin, &create).await);
    let (head_id, head) = current_hire_head(&owner, hire_id).await;
    assert_eq!(head.status, HireStatus::Proposed);

    let duplicate_id = Uuid::new_v4();
    let duplicate_name = HireAction {
        hire_id: duplicate_id,
        proposal: Some(hire_proposal(duplicate_id, name, channel_id)),
        ..create.clone()
    };
    assert_rejected(
        &submit_hire_action(&owner, &duplicate_name).await,
        "employee display name is already in use",
    );

    let manager_hire_id = Uuid::new_v4();
    let manager_direct = HireAction {
        hire_id: manager_hire_id,
        proposal: Some(hire_proposal(
            manager_hire_id,
            format!("Manager {}", manager_hire_id.simple()),
            channel_id,
        )),
        ..create.clone()
    };
    assert_rejected(
        &submit_hire_action(&manager, &manager_direct).await,
        "only a community owner or admin can hire",
    );

    let admin_approval = HireAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        hire_id,
        action: HireActionKind::Approve,
        expected_head_event_id: Some(head_id.clone()),
        proposal: None,
        employee_pubkey: None,
        introduction_event_id: None,
        reason: None,
    };
    assert_rejected(
        &submit_hire_action(&admin, &admin_approval).await,
        "founder sign-off requires the community owner",
    );

    let incomplete_completion = HireAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        hire_id,
        action: HireActionKind::Complete,
        expected_head_event_id: Some(head_id),
        proposal: None,
        employee_pubkey: Some(manager.public_key().to_hex()),
        introduction_event_id: Some("e".repeat(64)),
        reason: None,
    };
    assert_rejected(
        &submit_hire_action(&owner, &incomplete_completion).await,
        "founder sign-off is required before hiring",
    );

    let (head_id, _) = current_hire_head(&owner, hire_id).await;
    let owner_approval = HireAction {
        expected_head_event_id: Some(head_id),
        ..admin_approval
    };
    assert_accepted(&submit_hire_action(&owner, &owner_approval).await);
    let (_, approved) = current_hire_head(&owner, hire_id).await;
    assert_eq!(approved.status, HireStatus::Approved);
    assert_eq!(
        approved.founder_pubkey.as_deref(),
        Some(owner.public_key().to_hex().as_str())
    );
}

#[tokio::test]
#[ignore]
async fn company_member_can_propose_a_hire_ask_for_authorized_review() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let manager = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&manager, "member").await;

    let channel_id = create_test_channel(&owner).await;
    add_channel_member(&owner, &admin, channel_id).await;
    add_channel_member(&owner, &manager, channel_id).await;
    let root_event_id = send_root_message(&manager, channel_id).await;
    let hire_id = Uuid::new_v4();
    let ask_id = Uuid::new_v4();
    let proposal = hire_proposal(
        hire_id,
        format!("Proposed {}", hire_id.simple()),
        channel_id,
    );
    let ask = AskRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        ask_type: AskType::Approval,
        category: AskCategory::Hire,
        title: "Hire a researcher".into(),
        body: Some("Prepare hospitality research for the company".into()),
        thread_root_event_id: Some(root_event_id),
        thread_start: None,
        addressee_pubkey: Some(owner.public_key().to_hex()),
        decide_by: None,
        options: None,
        items: None,
        tool_consent: None,
        subject: Some(AskSubject {
            kind: AskSubjectKind::Hire,
            id: hire_id.to_string(),
        }),
        member_proposal: None,
        secret_request: None,
        hire_proposal: Some(proposal),
        duty_proposal: None,
        spend_allowance_proposal: None,
    };
    let action = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Create,
        expected_head_event_id: None,
        ask: Some(ask),
        reason: None,
    };
    assert_accepted(&submit_ask_action(&manager, channel_id, &action).await);

    let (_, hire) = current_hire_head(&owner, hire_id).await;
    assert_eq!(hire.status, HireStatus::Proposed);
    assert_eq!(hire.source_ask_id, Some(ask_id));
    assert_eq!(hire.source_ask_channel_id, Some(channel_id));

    let mut client = BuzzTestClient::connect(&relay_url(), &owner)
        .await
        .expect("connect to read hire ask");
    let sub_id = format!("e2e-company-hire-ask-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_ASK_HEAD as u16))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::H),
            [channel_id.to_string()],
        )
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            [format!("channel:{channel_id}:ask:{ask_id}")],
        );
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe hire ask head");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read hire ask head");
    client.disconnect().await.expect("disconnect ask query");
    let ask_event = events.into_iter().next().expect("relay returned hire ask");
    let ask_head: buzz_core::company_records::AskHead =
        serde_json::from_str(&ask_event.content).expect("parse hire ask head");
    assert_eq!(ask_head.status, AskStatus::Open);
    assert_eq!(
        ask_head
            .ask
            .hire_proposal
            .as_ref()
            .map(|value| value.hire_id),
        Some(hire_id)
    );
}
