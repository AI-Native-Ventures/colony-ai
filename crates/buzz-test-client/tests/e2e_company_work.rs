//! Company work-item relay integration tests.
//!
//! These tests exercise the relay's transactional kind:47006 broker and require
//! a running relay, Postgres, and Redis. They are ignored with the rest of the
//! relay-backed E2E suite by default.

use std::time::Duration;

use buzz_core::business_records::{
    company_work_d_tag, CompanyWorkItemAction, CompanyWorkItemActionKind, CompanyWorkItemHead,
    CompanyWorkItemInput, CompanyWorkStatus, CompanyWorkVerdict, CompanyWorkVerificationInput,
    BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::company_records::{
    goal_d_tag, GoalAction, GoalActionKind, GoalHead, GoalRecord, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_GOAL_HEAD, KIND_WORK_ITEM_ACTION, KIND_WORK_ITEM_HEAD};
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use serde_json::Value;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "company work E2E tests only send events to a local relay"
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

fn sub_id(name: &str) -> String {
    format!("e2e-company-work-{name}-{}", Uuid::new_v4())
}

fn test_database_url() -> String {
    std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name a disposable E2E database")
}

async fn ensure_test_community(host: &str) -> Uuid {
    let database_url = test_database_url();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
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
    let host = relay_authority();
    let community_id = ensure_test_community(&host).await;
    let database_url = test_database_url();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
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

async fn create_test_channel(keys: &Keys) -> String {
    let channel_id = Uuid::new_v4();
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).unwrap(),
            Tag::parse(["name", &format!("company-work-{channel_id}")]).unwrap(),
            Tag::parse(["channel_type", "stream"]).unwrap(),
            Tag::parse(["visibility", "open"]).unwrap(),
        ])
        .sign_with_keys(keys)
        .expect("sign channel creation");
    let response = post_event(keys, &event).await;
    assert_accepted(&response);
    channel_id.to_string()
}

async fn add_channel_member(owner: &Keys, member: &Keys, channel_id: &str) {
    let mut client = BuzzTestClient::connect(&relay_url(), owner)
        .await
        .expect("connect to add work owner");
    let event = EventBuilder::new(Kind::Custom(9000), "")
        .allow_self_tagging()
        .tags([
            Tag::parse(["h", channel_id]).unwrap(),
            Tag::parse(["p", member.public_key().to_hex().as_str()]).unwrap(),
        ])
        .sign_with_keys(owner)
        .expect("sign member invite");
    let response = client.send_event(event).await.expect("add work owner");
    assert!(
        response.accepted,
        "member invite rejected: {}",
        response.message
    );
    client.disconnect().await.expect("disconnect after invite");
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
    let body: Value = response.json().await.expect("parse E2E response");
    body
}

fn assert_accepted(response: &Value) {
    assert!(
        response["accepted"].as_bool().unwrap_or(false),
        "event was rejected: {response}"
    );
}

fn assert_rejected(response: &Value) {
    assert!(
        !response["accepted"].as_bool().unwrap_or(false),
        "event should have been rejected: {response}"
    );
}

async fn send_message(keys: &Keys, channel_id: &str, content: &str) -> String {
    let event = EventBuilder::new(Kind::Custom(9), content)
        .tags([Tag::parse(["h", channel_id]).unwrap()])
        .sign_with_keys(keys)
        .expect("sign source message");
    let event_id = event.id.to_hex();
    assert_accepted(&post_event(keys, &event).await);
    event_id
}

fn work_input(
    work_item_id: Uuid,
    requester: &Keys,
    owner: &Keys,
    goal_id: Option<Uuid>,
    source_event_id: Option<String>,
    thread_root_event_id: Option<String>,
) -> CompanyWorkItemInput {
    CompanyWorkItemInput {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        title: "Prepare the launch checklist".into(),
        status: CompanyWorkStatus::Active,
        assigned_pubkeys: vec![owner.public_key().to_hex()],
        approver_pubkeys: Vec::new(),
        deliverables: Vec::new(),
        requester_pubkey: requester.public_key().to_hex(),
        done_condition: "Every launch task has an owner".into(),
        goal_id,
        source_event_id,
        thread_root_event_id,
        evidence: None,
    }
}

async fn submit_work_action(
    keys: &Keys,
    channel_id: &str,
    action: &CompanyWorkItemAction,
) -> Value {
    let builder = buzz_sdk::business_records::build_company_work_item_action(
        Uuid::parse_str(channel_id).expect("channel UUID"),
        action,
    )
    .expect("build company work action");
    let event = builder
        .sign_with_keys(keys)
        .expect("sign company work action");
    post_event(keys, &event).await
}

async fn submit_raw_work_action(
    keys: &Keys,
    channel_id: &str,
    action: &CompanyWorkItemAction,
) -> Value {
    let event = EventBuilder::new(
        Kind::Custom(KIND_WORK_ITEM_ACTION as u16),
        serde_json::to_string(action).expect("serialize raw company work action"),
    )
    .tags([
        Tag::parse(["h", channel_id]).unwrap(),
        Tag::parse(["d", company_work_d_tag(action.work_item_id).as_str()]).unwrap(),
    ])
    .sign_with_keys(keys)
    .expect("sign raw company work action");
    post_event(keys, &event).await
}

async fn current_work_head(
    keys: &Keys,
    channel_id: &str,
    work_item_id: Uuid,
) -> (String, CompanyWorkItemHead) {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query work head");
    let id = sub_id("work-head");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_WORK_ITEM_HEAD as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::H), [channel_id])
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            [company_work_d_tag(work_item_id)],
        );
    client
        .subscribe(&id, vec![filter])
        .await
        .expect("subscribe work head");
    let events = client
        .collect_until_eose(&id, Duration::from_secs(10))
        .await
        .expect("read work head");
    client.disconnect().await.expect("disconnect query client");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned current work head");
    let head: CompanyWorkItemHead =
        serde_json::from_str(&event.content).expect("parse company work head");
    assert_eq!(head.work_item_id, work_item_id);
    (event.id.to_hex(), head)
}

async fn send_goal_action(keys: &Keys, action: &GoalAction) -> Value {
    let event = buzz_sdk::company_records::build_goal_action(action)
        .expect("build goal action")
        .sign_with_keys(keys)
        .expect("sign goal action");
    post_event(keys, &event).await
}

async fn current_goal_head(keys: &Keys, goal_id: Uuid) -> (String, GoalHead) {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query goal head");
    let id = sub_id("goal-head");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_GOAL_HEAD as u16))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            [goal_d_tag(goal_id)],
        );
    client
        .subscribe(&id, vec![filter])
        .await
        .expect("subscribe goal head");
    let events = client
        .collect_until_eose(&id, Duration::from_secs(10))
        .await
        .expect("read goal head");
    client.disconnect().await.expect("disconnect goal query");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned current goal head");
    let head: GoalHead = serde_json::from_str(&event.content).expect("parse goal head");
    assert_eq!(head.goal_id, goal_id);
    (event.id.to_hex(), head)
}

fn goal_create_action(goal_id: Uuid, owner: &Keys, channel_id: &str) -> GoalAction {
    GoalAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id,
        action: GoalActionKind::Create,
        expected_head_event_id: None,
        goal: Some(GoalRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id,
            parent_goal_id: None,
            title: "Prepare the product launch".into(),
            owner_pubkey: owner.public_key().to_hex(),
            due_date: None,
            done_condition: "The launch checklist is complete".into(),
            target: None,
            linked_channel_ids: vec![Uuid::parse_str(channel_id).expect("channel UUID")],
        }),
        progress: None,
        status: None,
        reason: None,
    }
}

fn goal_simple_action(
    goal_id: Uuid,
    action: GoalActionKind,
    expected_head_event_id: String,
) -> GoalAction {
    GoalAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id,
        action,
        expected_head_event_id: Some(expected_head_event_id),
        goal: None,
        progress: None,
        status: None,
        reason: None,
    }
}

#[tokio::test]
#[ignore]
async fn company_work_enforces_owner_submission_verifier_authority_and_revision_path() {
    let creator = Keys::generate();
    let admin = Keys::generate();
    let requester = Keys::generate();
    let owner = Keys::generate();
    let intruder = Keys::generate();
    seed_relay_member(&creator, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&owner, "member").await;
    seed_relay_member(&requester, "member").await;
    seed_relay_member(&intruder, "member").await;
    let channel_id = create_test_channel(&creator).await;
    add_channel_member(&creator, &requester, &channel_id).await;
    add_channel_member(&creator, &owner, &channel_id).await;
    add_channel_member(&creator, &admin, &channel_id).await;
    add_channel_member(&creator, &intruder, &channel_id).await;
    let source_event_id = send_message(&creator, &channel_id, "Please own the checklist").await;
    let other_root_event_id = send_message(&creator, &channel_id, "A moved discussion").await;

    let work_item_id = Uuid::new_v4();
    let create = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(
            work_item_id,
            &requester,
            &owner,
            None,
            Some(source_event_id.clone()),
            Some(source_event_id.clone()),
        )),
        status: None,
        reason: None,
        verification: None,
    };
    assert_accepted(&submit_work_action(&creator, &channel_id, &create).await);

    let (head_id, mut head) = current_work_head(&creator, &channel_id, work_item_id).await;
    assert_eq!(
        head.source_event_id.as_deref(),
        head.thread_root_event_id.as_deref()
    );
    head.thread_root_event_id = Some(other_root_event_id.clone());
    let moved = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Update,
        expected_head_event_id: Some(head_id),
        head: Some(CompanyWorkItemInput {
            schema_version: head.schema_version,
            work_item_id,
            title: head.title.clone(),
            status: head.status,
            assigned_pubkeys: head.assigned_pubkeys.clone(),
            approver_pubkeys: head.approver_pubkeys.clone(),
            deliverables: head.deliverables.clone(),
            requester_pubkey: head.requester_pubkey.clone(),
            done_condition: head.done_condition.clone(),
            goal_id: head.goal_id,
            source_event_id: head.source_event_id.clone(),
            thread_root_event_id: head.thread_root_event_id.clone(),
            evidence: head.evidence.clone(),
        }),
        status: None,
        reason: None,
        verification: None,
    };
    assert_accepted(&submit_work_action(&creator, &channel_id, &moved).await);
    let (head_id, head) = current_work_head(&creator, &channel_id, work_item_id).await;
    assert_eq!(
        head.source_event_id.as_deref(),
        Some(source_event_id.as_str())
    );
    assert_eq!(
        head.thread_root_event_id.as_deref(),
        Some(other_root_event_id.as_str())
    );

    let requester_submit = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::SetStatus,
        expected_head_event_id: Some(head_id.clone()),
        head: None,
        status: Some(CompanyWorkStatus::DoneUnverified),
        reason: Some("The requester cannot submit another person's work".into()),
        verification: None,
    };
    assert_rejected(&submit_work_action(&requester, &channel_id, &requester_submit).await);

    let owner_submit = CompanyWorkItemAction {
        expected_head_event_id: Some(head_id),
        reason: Some("The done condition is met".into()),
        ..requester_submit.clone()
    };
    assert_accepted(&submit_work_action(&owner, &channel_id, &owner_submit).await);

    let (head_id, _) = current_work_head(&creator, &channel_id, work_item_id).await;
    let revision = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Verify,
        expected_head_event_id: Some(head_id.clone()),
        head: None,
        status: None,
        reason: None,
        verification: Some(CompanyWorkVerificationInput {
            verdict: CompanyWorkVerdict::RevisionRequested,
            reason: "The checklist is missing rollback steps".into(),
            evidence: "Reviewed the current runbook".into(),
        }),
    };
    assert_rejected(&submit_work_action(&intruder, &channel_id, &revision).await);
    let missing_evidence = CompanyWorkItemAction {
        verification: Some(CompanyWorkVerificationInput {
            verdict: CompanyWorkVerdict::RevisionRequested,
            reason: "The checklist is missing rollback steps".into(),
            evidence: String::new(),
        }),
        ..revision.clone()
    };
    assert_rejected(&submit_raw_work_action(&requester, &channel_id, &missing_evidence).await);
    assert_accepted(&submit_work_action(&requester, &channel_id, &revision).await);
    let (head_id, head) = current_work_head(&creator, &channel_id, work_item_id).await;
    assert_eq!(head.status, CompanyWorkStatus::Active);
    let requester_pubkey = requester.public_key().to_hex();
    assert_eq!(
        head.verification
            .as_ref()
            .map(|item| item.reviewer_pubkey.as_str()),
        Some(requester_pubkey.as_str())
    );

    let owner_submit = CompanyWorkItemAction {
        expected_head_event_id: Some(head_id),
        ..owner_submit
    };
    assert_accepted(&submit_work_action(&owner, &channel_id, &owner_submit).await);
    let (_, head) = current_work_head(&creator, &channel_id, work_item_id).await;
    assert_eq!(head.status, CompanyWorkStatus::DoneUnverified);
    let (head_id, _) = current_work_head(&creator, &channel_id, work_item_id).await;
    let pass = CompanyWorkItemAction {
        expected_head_event_id: Some(head_id),
        verification: Some(CompanyWorkVerificationInput {
            verdict: CompanyWorkVerdict::Pass,
            reason: "The rollback steps are now included".into(),
            evidence: "Reviewed the updated launch runbook".into(),
        }),
        ..revision
    };
    assert_accepted(&submit_work_action(&admin, &channel_id, &pass).await);
    let (_, head) = current_work_head(&creator, &channel_id, work_item_id).await;
    assert_eq!(head.status, CompanyWorkStatus::DoneVerified);
    let admin_pubkey = admin.public_key().to_hex();
    assert_eq!(
        head.verification
            .as_ref()
            .map(|item| item.reviewer_pubkey.as_str()),
        Some(admin_pubkey.as_str())
    );
    assert_eq!(
        head.verification
            .as_ref()
            .map(|item| item.evidence.as_str()),
        Some("Reviewed the updated launch runbook")
    );
}

#[tokio::test]
#[ignore]
async fn company_work_denies_cross_channel_actions_and_serializes_exact_head_races() {
    let admin = Keys::generate();
    seed_relay_member(&admin, "owner").await;
    let channel_id = create_test_channel(&admin).await;
    let other_channel_id = create_test_channel(&admin).await;
    let work_item_id = Uuid::new_v4();
    let create = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(work_item_id, &admin, &admin, None, None, None)),
        status: None,
        reason: None,
        verification: None,
    };
    assert_accepted(&submit_work_action(&admin, &channel_id, &create).await);
    let (head_id, head) = current_work_head(&admin, &channel_id, work_item_id).await;
    let foreign_channel_update = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Update,
        expected_head_event_id: Some(head_id.clone()),
        head: Some(CompanyWorkItemInput {
            schema_version: head.schema_version,
            work_item_id,
            title: "Prepare the launch checklist".into(),
            status: head.status,
            assigned_pubkeys: head.assigned_pubkeys.clone(),
            approver_pubkeys: head.approver_pubkeys.clone(),
            deliverables: head.deliverables.clone(),
            requester_pubkey: head.requester_pubkey.clone(),
            done_condition: head.done_condition.clone(),
            goal_id: head.goal_id,
            source_event_id: head.source_event_id.clone(),
            thread_root_event_id: head.thread_root_event_id.clone(),
            evidence: head.evidence.clone(),
        }),
        status: None,
        reason: None,
        verification: None,
    };
    assert_rejected(&submit_work_action(&admin, &other_channel_id, &foreign_channel_update).await);

    let paused = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::SetStatus,
        expected_head_event_id: Some(head_id.clone()),
        head: None,
        status: Some(CompanyWorkStatus::Paused),
        reason: Some("Waiting for launch timing".into()),
        verification: None,
    };
    let blocked = CompanyWorkItemAction {
        status: Some(CompanyWorkStatus::Blocked),
        reason: Some("Need a final launch decision".into()),
        ..paused.clone()
    };
    let (paused, blocked) = tokio::join!(
        submit_work_action(&admin, &channel_id, &paused),
        submit_work_action(&admin, &channel_id, &blocked),
    );
    assert_ne!(
        paused["accepted"].as_bool(),
        blocked["accepted"].as_bool(),
        "exactly one action based on the same current head may commit"
    );
    let (_, head) = current_work_head(&admin, &channel_id, work_item_id).await;
    assert!(matches!(
        head.status,
        CompanyWorkStatus::Paused | CompanyWorkStatus::Blocked
    ));
}

#[tokio::test]
#[ignore]
async fn company_work_requires_live_goal_links_and_linked_work_blocks_goal_delete() {
    let admin = Keys::generate();
    seed_relay_member(&admin, "owner").await;
    let channel_id = create_test_channel(&admin).await;

    let linked_goal_id = Uuid::new_v4();
    assert_accepted(
        &send_goal_action(
            &admin,
            &goal_create_action(linked_goal_id, &admin, &channel_id),
        )
        .await,
    );
    let work_item_id = Uuid::new_v4();
    let create_linked = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(
            work_item_id,
            &admin,
            &admin,
            Some(linked_goal_id),
            None,
            None,
        )),
        status: None,
        reason: None,
        verification: None,
    };
    assert_accepted(&submit_work_action(&admin, &channel_id, &create_linked).await);
    let (head_id, _) = current_goal_head(&admin, linked_goal_id).await;
    let delete_linked = goal_simple_action(linked_goal_id, GoalActionKind::Delete, head_id);
    assert_rejected(&send_goal_action(&admin, &delete_linked).await);

    let archived_goal_id = Uuid::new_v4();
    assert_accepted(
        &send_goal_action(
            &admin,
            &goal_create_action(archived_goal_id, &admin, &channel_id),
        )
        .await,
    );
    let (head_id, _) = current_goal_head(&admin, archived_goal_id).await;
    assert_accepted(
        &send_goal_action(
            &admin,
            &goal_simple_action(archived_goal_id, GoalActionKind::Archive, head_id),
        )
        .await,
    );

    let deleted_goal_id = Uuid::new_v4();
    assert_accepted(
        &send_goal_action(
            &admin,
            &goal_create_action(deleted_goal_id, &admin, &channel_id),
        )
        .await,
    );
    let (head_id, _) = current_goal_head(&admin, deleted_goal_id).await;
    assert_accepted(
        &send_goal_action(
            &admin,
            &goal_simple_action(deleted_goal_id, GoalActionKind::Delete, head_id),
        )
        .await,
    );

    for goal_id in [archived_goal_id, deleted_goal_id] {
        let work_item_id = Uuid::new_v4();
        let action = CompanyWorkItemAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            work_item_id,
            action: CompanyWorkItemActionKind::Create,
            expected_head_event_id: None,
            head: Some(work_input(
                work_item_id,
                &admin,
                &admin,
                Some(goal_id),
                None,
                None,
            )),
            status: None,
            reason: None,
            verification: None,
        };
        assert_rejected(&submit_work_action(&admin, &channel_id, &action).await);
    }
}
