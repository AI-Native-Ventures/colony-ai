//! Relay integration tests for company duties and lessons.
//!
//! These cases run against the isolated CI relay, Postgres, and Redis service.

use std::time::Duration;

use buzz_core::company_duties::{
    duty_d_tag, DutyAction, DutyActionKind, DutyHead, DutyProposal, DutyStatus,
};
use buzz_core::company_lessons::{
    lesson_d_tag, LessonAction, LessonActionKind, LessonConfidence, LessonEvidenceRef, LessonHead,
    LessonSnapshot, LessonStatus,
};
use buzz_core::company_members::{member_d_tag, MemberPositionAction, MemberPositionActionKind};
use buzz_core::company_records::{
    ask_d_tag, AskAction, AskActionKind, AskCategory, AskHead, AskOutcome, AskRecord, AskResponse,
    AskSubject, AskSubjectKind, AskType, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{
    KIND_ASK_ACTION, KIND_ASK_HEAD, KIND_DUTY_ACTION, KIND_DUTY_HEAD, KIND_LESSON_ACTION,
    KIND_LESSON_HEAD, KIND_MEMBER_POSITION_ACTION,
};
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "company duties and lessons E2E tests only send events to a local relay"
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
    let pool = PgPoolOptions::new()
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
    let pool = PgPoolOptions::new()
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
    sqlx::query(
        "INSERT INTO users (community_id, pubkey) VALUES ($1, $2) \
         ON CONFLICT (community_id, pubkey) DO NOTHING",
    )
    .bind(community_id)
    .bind(keys.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed E2E user");
}

async fn register_employee(employee: &Keys, owner: &Keys) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey) VALUES ($1, $2) \
         ON CONFLICT (community_id, pubkey) DO NOTHING",
    )
    .bind(community_id)
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed employee owner user");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET agent_owner_pubkey = EXCLUDED.agent_owner_pubkey",
    )
    .bind(community_id)
    .bind(employee.public_key().to_bytes().as_slice())
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed managed employee identity");

    let employee_pubkey = employee.public_key().to_hex();
    let position = MemberPositionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        pubkey: employee_pubkey.clone(),
        action: MemberPositionActionKind::SetPosition,
        expected_head_event_id: None,
        title: Some("Company employee".into()),
        manager_pubkey: Some(Some(owner.public_key().to_hex())),
        reason: None,
    };
    let d_tag = member_d_tag(&employee_pubkey).expect("member d-tag");
    let event = EventBuilder::new(
        Kind::Custom(KIND_MEMBER_POSITION_ACTION as u16),
        serde_json::to_string(&position).expect("serialize employee position"),
    )
    .tags([Tag::parse(["d", d_tag.as_str()]).expect("member d-tag")])
    .sign_with_keys(owner)
    .expect("sign employee position");
    assert_accepted(&post_event(owner, &event).await);
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
    let message = response["message"]
        .as_str()
        .or_else(|| response["error"].as_str())
        .unwrap_or_default();
    assert!(
        message.contains(expected),
        "rejection should explain {expected}: {response}"
    );
}

async fn create_test_channel(owner: &Keys) -> Uuid {
    let channel_id = Uuid::new_v4();
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id"),
            Tag::parse(["name", &format!("duties-lessons-{channel_id}")]).expect("channel name"),
            Tag::parse(["channel_type", "stream"]).expect("channel type"),
            Tag::parse(["visibility", "open"]).expect("channel visibility"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel creation");
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

async fn send_message(keys: &Keys, channel_id: Uuid, content: &str) -> String {
    let event = EventBuilder::new(Kind::Custom(9), content)
        .tags([Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id")])
        .sign_with_keys(keys)
        .expect("sign source message");
    let event_id = event.id.to_hex();
    assert_accepted(&post_event(keys, &event).await);
    event_id
}

async fn current_head<T: DeserializeOwned>(
    keys: &Keys,
    kind: u32,
    d_tag: &str,
    channel_id: Option<Uuid>,
) -> (String, T) {
    let mut filter = Filter::new()
        .kind(Kind::Custom(kind as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    if let Some(channel_id) = channel_id {
        filter = filter.custom_tags(
            SingleLetterTag::lowercase(Alphabet::H),
            [channel_id.to_string()],
        );
    }
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query company head");
    let sub_id = format!("e2e-company-record-{}", Uuid::new_v4());
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe company head");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read company head");
    client.disconnect().await.expect("disconnect query client");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned current company head");
    let record = serde_json::from_str(&event.content).expect("parse company head");
    (event.id.to_hex(), record)
}

async fn submit_ask_action(keys: &Keys, channel_id: Uuid, action: &AskAction) -> Value {
    let event = buzz_sdk::asks::build_ask_action(channel_id, action)
        .expect("build duty ask action")
        .sign_with_keys(keys)
        .expect("sign duty ask action");
    post_event(keys, &event).await
}

async fn submit_unvalidated_ask_action(keys: &Keys, channel_id: Uuid, action: &AskAction) -> Value {
    let ask = action.ask.as_ref().expect("unvalidated create ask");
    let channel = channel_id.to_string();
    let d_tag = ask_d_tag(channel_id, action.ask_id);
    let root = ask
        .thread_root_event_id
        .as_deref()
        .expect("duty ask thread root");
    let event = EventBuilder::new(
        Kind::Custom(KIND_ASK_ACTION as u16),
        serde_json::to_string(action).expect("serialize unvalidated ask action"),
    )
    .tags([
        Tag::parse(["h", channel.as_str()]).expect("ask channel tag"),
        Tag::parse(["d", d_tag.as_str()]).expect("ask d-tag"),
        Tag::parse(["e", root, "", "root"]).expect("ask root tag"),
        Tag::parse(["e", root, "", "reply"]).expect("ask reply tag"),
    ])
    .sign_with_keys(keys)
    .expect("sign unvalidated ask action");
    post_event(keys, &event).await
}

async fn submit_ask_response(keys: &Keys, channel_id: Uuid, response: &AskResponse) -> Value {
    let event = buzz_sdk::asks::build_ask_response(channel_id, response)
        .expect("build duty ask response")
        .sign_with_keys(keys)
        .expect("sign duty ask response");
    post_event(keys, &event).await
}

async fn submit_lesson_action(keys: &Keys, employee_pubkey: &str, action: &LessonAction) -> Value {
    let event = EventBuilder::new(
        Kind::Custom(KIND_LESSON_ACTION as u16),
        serde_json::to_string(action).expect("serialize lesson action"),
    )
    .tags([
        Tag::parse(["d", &lesson_d_tag(action.lesson_id)]).expect("lesson d-tag"),
        Tag::parse(["p", employee_pubkey]).expect("lesson employee p-tag"),
    ])
    .sign_with_keys(keys)
    .expect("sign lesson action");
    post_event(keys, &event).await
}

async fn submit_duty_action(keys: &Keys, action: &DutyAction) -> Value {
    let d_tag = duty_d_tag(action.duty_id);
    let event = EventBuilder::new(
        Kind::Custom(KIND_DUTY_ACTION as u16),
        serde_json::to_string(action).expect("serialize duty action"),
    )
    .tags([Tag::parse(["d", d_tag.as_str()]).expect("duty d-tag")])
    .sign_with_keys(keys)
    .expect("sign duty action");
    post_event(keys, &event).await
}

fn duty_proposal(duty_id: Uuid, employee: &Keys, channel_id: Uuid) -> DutyProposal {
    DutyProposal {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        duty_id,
        employee_pubkey: employee.public_key().to_hex(),
        title: "Review the customer report".into(),
        schedule_text: "Every Monday at 08:00".into(),
        schedule_cron: "0 8 * * 1".into(),
        time_zone: "Africa/Johannesburg".into(),
        channel_id,
        instructions: "Review the current report and share findings in the channel.".into(),
    }
}

#[tokio::test]
#[ignore]
async fn company_duty_ask_requires_owner_or_admin_and_creates_the_versioned_workflow() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let proposer = Keys::generate();
    let employee = Keys::generate();
    for (keys, role) in [(&owner, "owner"), (&admin, "admin"), (&proposer, "member")] {
        seed_relay_member(keys, role).await;
    }
    register_employee(&employee, &owner).await;

    let channel_id = create_test_channel(&owner).await;
    for member in [&admin, &proposer, &employee] {
        add_channel_member(&owner, member, channel_id).await;
    }
    let root_event_id = send_message(&employee, channel_id, "Please review this schedule").await;
    let duty_id = Uuid::new_v4();
    let ask_id = Uuid::new_v4();
    let proposal = duty_proposal(duty_id, &employee, channel_id);
    let ask = AskRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        ask_type: AskType::Approval,
        category: AskCategory::Duty,
        title: "Review the customer report".into(),
        body: Some("Review the proposed schedule and instructions.".into()),
        thread_root_event_id: Some(root_event_id),
        thread_start: None,
        addressee_pubkey: None,
        decide_by: None,
        options: None,
        items: None,
        tool_consent: None,
        subject: Some(AskSubject {
            kind: AskSubjectKind::Duty,
            id: duty_id.to_string(),
        }),
        member_proposal: None,
        secret_request: None,
        hire_proposal: None,
        duty_proposal: Some(proposal.clone()),
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

    let mut invalid_schedule = action.clone();
    let invalid_ask = invalid_schedule.ask.as_mut().expect("ask payload");
    invalid_ask
        .duty_proposal
        .as_mut()
        .expect("duty payload")
        .schedule_cron = "30 8 * * 1".into();
    assert_rejected(
        &submit_unvalidated_ask_action(&employee, channel_id, &invalid_schedule).await,
        "scheduleCron must match",
    );
    assert_accepted(&submit_ask_action(&employee, channel_id, &action).await);

    let ask_tag = ask_d_tag(channel_id, ask_id);
    let (ask_head_id, _): (String, AskHead) =
        current_head(&owner, KIND_ASK_HEAD, &ask_tag, Some(channel_id)).await;
    let response = AskResponse {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        expected_head_event_id: ask_head_id,
        outcome: AskOutcome::Approved,
        reason: Some("Schedule and instructions reviewed.".into()),
        answer: None,
        option_id: None,
        checked_item_ids: None,
        secret_binding_id: None,
    };
    assert_rejected(
        &submit_ask_response(&proposer, channel_id, &response).await,
        "Only company owners and admins can decide this",
    );
    assert_accepted(&submit_ask_response(&admin, channel_id, &response).await);

    let duty_tag = duty_d_tag(duty_id);
    let (active_head_id, head): (String, DutyHead) =
        current_head(&owner, KIND_DUTY_HEAD, &duty_tag, None).await;
    assert_eq!(head.status, DutyStatus::Active);
    assert_eq!(head.proposal, proposal);
    assert_eq!(head.proposed_by_pubkey, employee.public_key().to_hex());
    assert_eq!(head.approved_by_pubkey, admin.public_key().to_hex());
    assert_eq!(head.source_ask_id, ask_id);
    assert_eq!(head.source_ask_channel_id, channel_id);

    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres");
    let workflow: Option<(bool, Value)> = sqlx::query_as(
        "SELECT enabled, definition FROM workflows WHERE community_id = $1 AND id = $2",
    )
    .bind(community_id)
    .bind(duty_id)
    .fetch_optional(&pool)
    .await
    .expect("read duty workflow");
    let (enabled, definition) = workflow.expect("approved duty creates its workflow");
    assert!(enabled);
    assert_eq!(definition["trigger"]["on"], "schedule");
    assert_eq!(definition["trigger"]["cron"], "0 8 * * 1");
    assert_eq!(definition["trigger"]["timezone"], "Africa/Johannesburg");

    let pause = DutyAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        duty_id,
        action: DutyActionKind::Pause,
        expected_head_event_id: active_head_id.clone(),
        proposal: None,
        reason: None,
    };
    assert_rejected(
        &submit_duty_action(&proposer, &pause).await,
        "only a community owner or admin can manage duties",
    );
    assert_accepted(&submit_duty_action(&admin, &pause).await);
    let (paused_head_id, paused): (String, DutyHead) =
        current_head(&owner, KIND_DUTY_HEAD, &duty_tag, None).await;
    assert_eq!(paused.status, DutyStatus::Paused);
    let (enabled_after_pause,): (bool,) =
        sqlx::query_as("SELECT enabled FROM workflows WHERE community_id = $1 AND id = $2")
            .bind(community_id)
            .bind(duty_id)
            .fetch_one(&pool)
            .await
            .expect("read paused duty workflow");
    assert!(!enabled_after_pause);

    let resume = DutyAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        duty_id,
        action: DutyActionKind::Resume,
        expected_head_event_id: paused_head_id,
        proposal: None,
        reason: None,
    };
    assert_accepted(&submit_duty_action(&owner, &resume).await);
    let (_, resumed): (String, DutyHead) =
        current_head(&owner, KIND_DUTY_HEAD, &duty_tag, None).await;
    assert_eq!(resumed.status, DutyStatus::Active);
    let (enabled_after_resume,): (bool,) =
        sqlx::query_as("SELECT enabled FROM workflows WHERE community_id = $1 AND id = $2")
            .bind(community_id)
            .bind(duty_id)
            .fetch_one(&pool)
            .await
            .expect("read resumed duty workflow");
    assert!(enabled_after_resume);
}

#[tokio::test]
#[ignore]
async fn company_lessons_require_evidence_and_record_approval_then_reset_on_edit() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let proposer = Keys::generate();
    let employee = Keys::generate();
    for (keys, role) in [(&owner, "owner"), (&admin, "admin"), (&proposer, "member")] {
        seed_relay_member(keys, role).await;
    }
    register_employee(&employee, &owner).await;

    let channel_id = create_test_channel(&owner).await;
    for member in [&admin, &proposer, &employee] {
        add_channel_member(&owner, member, channel_id).await;
    }
    let evidence_id = send_message(&proposer, channel_id, "This source supports the lesson.").await;
    let employee_pubkey = employee.public_key().to_hex();
    let lesson_id = Uuid::new_v4();
    let snapshot = LessonSnapshot {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id,
        employee_pubkey: employee_pubkey.clone(),
        lesson: "Keep campaign conclusions linked to their source evidence.".into(),
        evidence: vec![LessonEvidenceRef {
            event_id: evidence_id.clone(),
            assessment: None,
        }],
        confidence: LessonConfidence::Unassessed,
    };
    let create = LessonAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id,
        action: LessonActionKind::Create,
        expected_head_event_id: None,
        snapshot: Some(snapshot.clone()),
        confidence: None,
    };
    let mut missing_evidence = create.clone();
    missing_evidence
        .snapshot
        .as_mut()
        .expect("lesson snapshot")
        .evidence[0]
        .event_id = "ab".repeat(32);
    assert_rejected(
        &submit_lesson_action(&proposer, &employee_pubkey, &missing_evidence).await,
        "does not exist in this community",
    );
    assert_accepted(&submit_lesson_action(&proposer, &employee_pubkey, &create).await);

    let lesson_tag = lesson_d_tag(lesson_id);
    let (candidate_id, candidate): (String, LessonHead) =
        current_head(&owner, KIND_LESSON_HEAD, &lesson_tag, None).await;
    assert_eq!(candidate.status, LessonStatus::Candidate);
    assert_eq!(candidate.snapshot.confidence, LessonConfidence::Unassessed);
    assert_eq!(candidate.snapshot.evidence.len(), 1);
    assert_eq!(candidate.proposed_by_pubkey, proposer.public_key().to_hex());

    let approve = LessonAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id,
        action: LessonActionKind::Approve,
        expected_head_event_id: Some(candidate_id.clone()),
        snapshot: None,
        confidence: Some(LessonConfidence::Moderate),
    };
    assert_rejected(
        &submit_lesson_action(&proposer, &employee_pubkey, &approve).await,
        "only a community owner or admin can approve lessons",
    );
    assert_accepted(&submit_lesson_action(&admin, &employee_pubkey, &approve).await);
    let (approved_id, approved): (String, LessonHead) =
        current_head(&owner, KIND_LESSON_HEAD, &lesson_tag, None).await;
    assert_eq!(approved.status, LessonStatus::Approved);
    assert_eq!(approved.snapshot.confidence, LessonConfidence::Moderate);
    let approval = approved.approval.expect("approval provenance");
    assert_eq!(approval.approved_by_pubkey, admin.public_key().to_hex());
    assert!(!approval.approved_at.is_empty());

    let mut edited_snapshot = snapshot;
    edited_snapshot.lesson = "Keep each campaign conclusion linked to its evidence.".into();
    let update = LessonAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id,
        action: LessonActionKind::Update,
        expected_head_event_id: Some(approved_id),
        snapshot: Some(edited_snapshot),
        confidence: None,
    };
    assert_accepted(&submit_lesson_action(&proposer, &employee_pubkey, &update).await);
    let (_, candidate_again): (String, LessonHead) =
        current_head(&owner, KIND_LESSON_HEAD, &lesson_tag, None).await;
    assert_eq!(candidate_again.status, LessonStatus::Candidate);
    assert_eq!(
        candidate_again.snapshot.confidence,
        LessonConfidence::Unassessed
    );
    assert!(candidate_again.approval.is_none());
    assert_eq!(candidate_again.snapshot.evidence[0].event_id, evidence_id);
}
