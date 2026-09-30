//! Employee AI spend relay integration tests.
//!
//! These tests exercise the company spend broker and require a local relay,
//! Postgres, and Redis. They are selected by the hosted relay E2E lane.

use std::time::Duration;

use buzz_core::agent_turn_metric::{AgentTurnMetricPayload, StopReason, TokenCounts};
use buzz_core::company_members::{MemberPositionAction, MemberPositionActionKind};
use buzz_core::company_records::{
    ask_d_tag, AskAction, AskActionKind, AskCategory, AskHead, AskOutcome, AskRecord, AskResponse,
    AskStatus, AskSubject, AskSubjectKind, AskType, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::company_spend::{
    ai_spend_record_d_tag, employee_allowance_d_tag, AiSpendRecord, AiSpendRecordAction,
    AiSpendRecordHead, AllowancePeriod, AllowanceValue, EmployeeAllowanceAction,
    EmployeeAllowanceHead, ExternalCostType, SourceOfFunds, SpendRecordActionKind,
    SpendRecordStatus,
};
use buzz_core::kind::{KIND_AI_SPEND_RECORD_HEAD, KIND_ASK_HEAD, KIND_EMPLOYEE_AI_ALLOWANCE_HEAD};
use buzz_test_client::BuzzTestClient;
use chrono::{SecondsFormat, Utc};
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use serde_json::Value;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "company spend E2E tests only send events to a local relay"
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

async fn mark_managed_agent(agent: &Keys, owner: &Keys) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
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
    .expect("seed managed agent owner user");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (community_id, pubkey) DO UPDATE \
         SET agent_owner_pubkey = EXCLUDED.agent_owner_pubkey",
    )
    .bind(community_id)
    .bind(agent.public_key().to_bytes().as_slice())
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed managed agent identity");
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

async fn submit_spend_action(keys: &Keys, action: &AiSpendRecordAction) -> Value {
    let event = buzz_sdk::company_spend::build_ai_spend_record_action(action)
        .expect("build AI spend action")
        .sign_with_keys(keys)
        .expect("sign AI spend action");
    post_event(keys, &event).await
}

async fn submit_member_position(keys: &Keys, member: &Keys) {
    let action = MemberPositionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        pubkey: member.public_key().to_hex(),
        action: MemberPositionActionKind::SetPosition,
        expected_head_event_id: None,
        title: Some("Spend test employee".into()),
        manager_pubkey: Some(None),
        reason: None,
    };
    let event = buzz_sdk::company_members::build_member_position_action(&action)
        .expect("build employee position")
        .sign_with_keys(keys)
        .expect("sign employee position");
    assert_accepted(&post_event(keys, &event).await);
}

async fn current_spend_head(keys: &Keys, record_id: &str) -> (String, AiSpendRecordHead) {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query AI spend head");
    let d_tag = ai_spend_record_d_tag(record_id).expect("spend d-tag");
    let sub_id = format!("e2e-company-spend-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_AI_SPEND_RECORD_HEAD as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe AI spend head");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read AI spend head");
    client
        .disconnect()
        .await
        .expect("disconnect AI spend query");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned AI spend head");
    let head: AiSpendRecordHead = serde_json::from_str(&event.content).expect("parse spend head");
    (event.id.to_hex(), head)
}

async fn current_allowance_head(
    keys: &Keys,
    employee_pubkey: &str,
) -> Option<(String, EmployeeAllowanceHead)> {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query employee allowance");
    let d_tag = employee_allowance_d_tag(employee_pubkey).expect("allowance d-tag");
    let sub_id = format!("e2e-company-allowance-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_EMPLOYEE_AI_ALLOWANCE_HEAD as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe employee allowance");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read employee allowance");
    client
        .disconnect()
        .await
        .expect("disconnect allowance query");
    events.into_iter().next().map(|event| {
        let head = serde_json::from_str(&event.content).expect("parse allowance head");
        (event.id.to_hex(), head)
    })
}

#[tokio::test]
#[ignore]
async fn company_spend_records_require_authority_and_verified_employee_turn_evidence() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let member = Keys::generate();
    let employee = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&member, "member").await;
    mark_managed_agent(&employee, &owner).await;
    submit_member_position(&owner, &employee).await;

    let cost_id = format!("cost:{}", Uuid::new_v4());
    let cost_record = AiSpendRecord::ExternalCost {
        provider: "E2E provider".into(),
        description: "Existing plan evidence".into(),
        cost_type: ExternalCostType::Subscription,
        actual_cash_cost_cents: "1250".into(),
        recorded_date: "2026-09-30".into(),
    };
    let create_cost = AiSpendRecordAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        record_id: cost_id.clone(),
        action: SpendRecordActionKind::Record,
        expected_head_event_id: None,
        record: Some(cost_record.clone()),
    };
    assert_rejected(
        &submit_spend_action(&member, &create_cost).await,
        "only company owners and admins can change AI spend",
    );
    assert_accepted(&submit_spend_action(&owner, &create_cost).await);
    let (cost_head_id, cost_head) = current_spend_head(&owner, &cost_id).await;
    assert_eq!(cost_head.status, SpendRecordStatus::Active);
    assert_eq!(cost_head.record, cost_record);

    let edited_cost = AiSpendRecord::ExternalCost {
        provider: "E2E provider".into(),
        description: "Existing plan evidence".into(),
        cost_type: ExternalCostType::Subscription,
        actual_cash_cost_cents: "1325".into(),
        recorded_date: "2026-09-30".into(),
    };
    let edit_cost = AiSpendRecordAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        record_id: cost_id.clone(),
        action: SpendRecordActionKind::Record,
        expected_head_event_id: Some(cost_head_id.clone()),
        record: Some(edited_cost.clone()),
    };
    assert_accepted(&submit_spend_action(&admin, &edit_cost).await);
    assert_rejected(
        &submit_spend_action(&owner, &edit_cost).await,
        "AI spend record changed",
    );
    let (edited_cost_head_id, _) = current_spend_head(&owner, &cost_id).await;
    let remove_cost = AiSpendRecordAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        record_id: cost_id.clone(),
        action: SpendRecordActionKind::Remove,
        expected_head_event_id: Some(edited_cost_head_id),
        record: None,
    };
    assert_accepted(&submit_spend_action(&owner, &remove_cost).await);
    let (_, removed_cost_head) = current_spend_head(&owner, &cost_id).await;
    assert_eq!(removed_cost_head.status, SpendRecordStatus::Removed);
    assert_eq!(removed_cost_head.record, edited_cost);

    let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let usage_payload = AgentTurnMetricPayload {
        harness: "company-spend-e2e".into(),
        model: Some("test-model".into()),
        channel_id: None,
        session_id: Some("company-spend-e2e-session".into()),
        turn_id: Some("company-spend-e2e-turn".into()),
        turn_seq: Some(1),
        timestamp: timestamp.clone(),
        turn: Some(TokenCounts {
            input_tokens: Some(100),
            output_tokens: Some(20),
            total_tokens: Some(120),
            cost_usd: Some(0.125),
            cache_read_tokens: None,
            cache_write_tokens: None,
        }),
        cumulative: None,
        delta_reliable: true,
        stop_reason: Some(StopReason::EndTurn),
        pricing_identity: None,
    };
    let ciphertext = buzz_core::agent_turn_metric::encrypt_agent_turn_metric(
        &employee,
        &owner.public_key(),
        &usage_payload,
    )
    .expect("encrypt owner-addressed harness report");
    let employee_pubkey = employee.public_key().to_hex();
    let owner_pubkey = owner.public_key().to_hex();
    let usage_event = EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_AGENT_TURN_METRIC as u16),
        ciphertext,
    )
    .tags([
        Tag::parse(["p", owner_pubkey.as_str()]).expect("owner p-tag"),
        Tag::parse(["agent", employee_pubkey.as_str()]).expect("agent tag"),
    ])
    .sign_with_keys(&employee)
    .expect("sign harness usage report");
    let usage_event_id = usage_event.id.to_hex();
    let mut employee_client = BuzzTestClient::connect(&relay_url(), &employee)
        .await
        .expect("connect managed employee");
    let usage_response = employee_client
        .send_event(usage_event)
        .await
        .expect("publish harness usage report");
    assert!(
        usage_response.accepted,
        "harness report was rejected: {}",
        usage_response.message
    );
    employee_client
        .disconnect()
        .await
        .expect("disconnect managed employee");

    let usage_id = format!("usage:{usage_event_id}");
    let usage_record = AiSpendRecord::AgentTurn {
        employee_pubkey: employee_pubkey.clone(),
        model: Some("test-model".into()),
        source_usage_event_id: usage_event_id,
        estimated_amount_nano_usd: Some("125000000".into()),
        is_estimate: true,
        source_of_funds: SourceOfFunds::Unknown,
        reported_at: timestamp,
    };
    let create_usage = AiSpendRecordAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        record_id: usage_id.clone(),
        action: SpendRecordActionKind::Record,
        expected_head_event_id: None,
        record: Some(usage_record.clone()),
    };
    let usage_action_event = buzz_sdk::company_spend::build_ai_spend_record_action(&create_usage)
        .expect("build employee usage action")
        .sign_with_keys(&owner)
        .expect("sign employee usage action");
    assert_accepted(&post_event(&owner, &usage_action_event).await);
    assert_accepted(&post_event(&owner, &usage_action_event).await);
    let (usage_head_id, usage_head) = current_spend_head(&owner, &usage_id).await;
    assert_eq!(usage_head.record, usage_record);

    mark_managed_agent(&employee, &admin).await;
    assert_rejected(
        &submit_spend_action(&owner, &create_usage).await,
        "authenticated member does not own the reported employee",
    );
    mark_managed_agent(&employee, &owner).await;
    let mut unverifiable_funding = usage_record.clone();
    if let AiSpendRecord::AgentTurn {
        source_of_funds, ..
    } = &mut unverifiable_funding
    {
        *source_of_funds = SourceOfFunds::ProviderSubscription;
    }
    let unverified_source_action = AiSpendRecordAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        record_id: usage_id.clone(),
        action: SpendRecordActionKind::Record,
        expected_head_event_id: Some(usage_head_id),
        record: Some(unverifiable_funding),
    };
    assert_rejected(
        &submit_spend_action(&owner, &unverified_source_action).await,
        "no verifiable funding source",
    );
    let (_, unchanged_usage_head) = current_spend_head(&owner, &usage_id).await;
    assert_eq!(unchanged_usage_head.record, usage_record);
}

async fn create_test_channel(owner: &Keys, channel_id: Uuid) {
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id"),
            Tag::parse(["name", &format!("spend-{channel_id}")]).expect("channel name"),
            Tag::parse(["channel_type", "stream"]).expect("channel type"),
            Tag::parse(["visibility", "open"]).expect("channel visibility"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel create");
    assert_accepted(&post_event(owner, &event).await);
}

async fn add_channel_member(owner: &Keys, member: &Keys, channel_id: Uuid) {
    let event = EventBuilder::new(Kind::Custom(9000), "")
        .allow_self_tagging()
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id"),
            Tag::parse(["p", member.public_key().to_hex().as_str()]).expect("member pubkey"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel invite");
    assert_accepted(&post_event(owner, &event).await);
}

async fn send_root_message(keys: &Keys, channel_id: Uuid) -> String {
    let event = EventBuilder::new(Kind::Custom(9), "Please review this allowance proposal")
        .tags([Tag::parse(["h", channel_id.to_string().as_str()]).expect("channel id")])
        .sign_with_keys(keys)
        .expect("sign thread root");
    let event_id = event.id.to_hex();
    assert_accepted(&post_event(keys, &event).await);
    event_id
}

async fn submit_ask_action(keys: &Keys, channel_id: Uuid, action: &AskAction) -> Value {
    let event = buzz_sdk::asks::build_ask_action(channel_id, action)
        .expect("build allowance ask")
        .sign_with_keys(keys)
        .expect("sign allowance ask");
    post_event(keys, &event).await
}

async fn submit_ask_response(keys: &Keys, channel_id: Uuid, response: &AskResponse) -> Value {
    let event = buzz_sdk::asks::build_ask_response(channel_id, response)
        .expect("build allowance ask response")
        .sign_with_keys(keys)
        .expect("sign allowance ask response");
    post_event(keys, &event).await
}

async fn current_ask_head(keys: &Keys, channel_id: Uuid, ask_id: Uuid) -> (String, AskHead) {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query money ask");
    let d_tag = ask_d_tag(channel_id, ask_id);
    let sub_id = format!("e2e-company-money-ask-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_ASK_HEAD as u16))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::H),
            [channel_id.to_string()],
        )
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe money ask");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read money ask");
    client
        .disconnect()
        .await
        .expect("disconnect money ask query");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned money ask head");
    let head: AskHead = serde_json::from_str(&event.content).expect("parse money ask head");
    (event.id.to_hex(), head)
}

#[tokio::test]
#[ignore]
async fn money_ask_approval_atomically_commits_allowance_for_an_authorized_human() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let member = Keys::generate();
    let employee = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&member, "member").await;
    mark_managed_agent(&employee, &owner).await;
    submit_member_position(&owner, &employee).await;

    let channel_id = Uuid::new_v4();
    create_test_channel(&owner, channel_id).await;
    add_channel_member(&owner, &admin, channel_id).await;
    add_channel_member(&owner, &member, channel_id).await;
    let root_event_id = send_root_message(&member, channel_id).await;
    let ask_id = Uuid::new_v4();
    let employee_pubkey = employee.public_key().to_hex();
    let proposal = EmployeeAllowanceAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        employee_pubkey: employee_pubkey.clone(),
        expected_head_event_id: None,
        allowance: AllowanceValue {
            amount_cents: "12345".into(),
            period: AllowancePeriod::Week,
        },
        temporary_allowance: None,
        funding_order: vec!["E2E provider subscription".into()],
    };
    let ask = AskRecord {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        ask_type: AskType::Approval,
        category: AskCategory::Money,
        title: "Increase employee AI allowance".into(),
        body: Some("Review the proposed weekly API-equivalent allowance.".into()),
        thread_root_event_id: root_event_id,
        addressee_pubkey: Some(owner.public_key().to_hex()),
        decide_by: None,
        options: None,
        items: None,
        tool_consent: None,
        subject: Some(AskSubject {
            kind: AskSubjectKind::CompanyMember,
            id: employee_pubkey.clone(),
        }),
        member_proposal: None,
        secret_request: None,
        hire_proposal: None,
        spend_allowance_proposal: Some(proposal),
    };
    let create_action = AskAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        action: AskActionKind::Create,
        expected_head_event_id: None,
        ask: Some(ask),
        reason: None,
    };
    assert_accepted(&submit_ask_action(&member, channel_id, &create_action).await);
    let (ask_head_id, ask_head) = current_ask_head(&owner, channel_id, ask_id).await;
    assert_eq!(ask_head.status, AskStatus::Open);
    assert!(current_allowance_head(&owner, &employee_pubkey)
        .await
        .is_none());

    let unauthorized_response = AskResponse {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        ask_id,
        expected_head_event_id: ask_head_id.clone(),
        outcome: AskOutcome::Approved,
        reason: Some("Member cannot approve money changes".into()),
        answer: None,
        option_id: None,
        checked_item_ids: None,
        secret_binding_id: None,
    };
    assert_rejected(
        &submit_ask_response(&member, channel_id, &unauthorized_response).await,
        "Only company owners and admins can decide this",
    );
    let (_, still_open_ask) = current_ask_head(&owner, channel_id, ask_id).await;
    assert_eq!(still_open_ask.status, AskStatus::Open);
    assert!(current_allowance_head(&owner, &employee_pubkey)
        .await
        .is_none());

    let admin_response = AskResponse {
        expected_head_event_id: current_ask_head(&owner, channel_id, ask_id).await.0,
        reason: Some("Approved for the employee budget".into()),
        ..unauthorized_response
    };
    assert_accepted(&submit_ask_response(&admin, channel_id, &admin_response).await);
    let (_, resolved_ask) = current_ask_head(&owner, channel_id, ask_id).await;
    assert_eq!(resolved_ask.status, AskStatus::Resolved);
    assert_eq!(
        resolved_ask
            .resolution
            .map(|resolution| resolution.response.outcome),
        Some(AskOutcome::Approved)
    );
    let (allowance_event_id, allowance_head) = current_allowance_head(&owner, &employee_pubkey)
        .await
        .expect("approved money ask committed an allowance head");
    assert_eq!(
        allowance_head.allowance,
        AllowanceValue {
            amount_cents: "12345".into(),
            period: AllowancePeriod::Week,
        }
    );
    assert_eq!(allowance_head.actor_pubkey, admin.public_key().to_hex());
    assert_ne!(allowance_event_id, ask_head_id);
}
