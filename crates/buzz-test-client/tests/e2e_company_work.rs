//! Company work-item relay integration tests.
//!
//! These tests exercise the relay's transactional kind:47006 broker and require
//! a running relay, Postgres, and Redis. They are ignored with the rest of the
//! relay-backed E2E suite by default.

use std::time::{Duration, Instant};

use buzz_core::business_records::{
    company_work_d_tag, CompanyWorkItemAction, CompanyWorkItemActionKind, CompanyWorkItemHead,
    CompanyWorkItemInput, CompanyWorkStatus, CompanyWorkVerdict, CompanyWorkVerificationInput,
    BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::company_records::{
    goal_d_tag, GoalAction, GoalActionKind, GoalHead, GoalRecord, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::company_work_tracking::{
    company_work_suggestion_d_tag, company_work_watchdog_d_tag, CompanyWorkCheckWhen,
    CompanyWorkSuggestionInput, CompanyWorkSuggestionStatus, CompanyWorkTrackingAction,
    CompanyWorkTrackingActionKind, CompanyWorkTrackingHead, CompanyWorkTrackingRecordType,
    CompanyWorkWatchdogConfig,
};
use buzz_core::kind::{
    KIND_COMPANY_WORK_TRACKING_HEAD, KIND_GOAL_HEAD, KIND_WORK_ITEM_ACTION, KIND_WORK_ITEM_HEAD,
};
use buzz_db::company_work_watchdog::{
    claim_due_batch, fail_delivery, retry_at, MAX_DELIVERY_ATTEMPTS,
};
use buzz_test_client::BuzzTestClient;
use chrono::{DateTime, SecondsFormat, Utc};
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use serde_json::Value;
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
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

async fn mark_managed_agent(agent: &Keys, owner: &Keys) {
    let host = relay_authority();
    let community_id = ensure_test_community(&host).await;
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
        due_at: None,
    }
}

#[tokio::test]
#[ignore]
async fn company_work_suggestions_validate_source_authority_and_explicit_lifecycle() {
    let admin = Keys::generate();
    let proposer = Keys::generate();
    let requester = Keys::generate();
    let owner = Keys::generate();
    let managed_agent = Keys::generate();
    let outsider = Keys::generate();
    for (keys, role) in [
        (&admin, "owner"),
        (&proposer, "member"),
        (&requester, "member"),
        (&owner, "member"),
        (&managed_agent, "member"),
        (&outsider, "member"),
    ] {
        seed_relay_member(keys, role).await;
    }
    mark_managed_agent(&managed_agent, &owner).await;

    let channel_id = create_test_channel(&admin).await;
    let other_channel_id = create_test_channel(&admin).await;
    for member in [&proposer, &requester, &owner, &managed_agent] {
        add_channel_member(&admin, member, &channel_id).await;
    }
    add_channel_member(&admin, &managed_agent, &other_channel_id).await;
    let source_event_id = send_message(&owner, &channel_id, "Please own the checklist").await;
    let foreign_source_id =
        send_message(&owner, &other_channel_id, "A separate channel discussion").await;

    let accepted_suggestion_id = Uuid::new_v4();
    let invalid_proposal = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Propose,
        record_id: accepted_suggestion_id,
        expected_head_event_id: None,
        suggestion: Some(CompanyWorkSuggestionInput {
            source_event_id: foreign_source_id,
            expires_at: None,
            work_item: work_input(Uuid::new_v4(), &requester, &owner, None, None, None),
        }),
        accepted_work_item_id: None,
        config: None,
    };
    assert_rejected(&submit_tracking_action(&managed_agent, &channel_id, &invalid_proposal).await);

    let proposal = CompanyWorkTrackingAction {
        suggestion: Some(CompanyWorkSuggestionInput {
            source_event_id: source_event_id.clone(),
            expires_at: None,
            work_item: work_input(Uuid::new_v4(), &requester, &owner, None, None, None),
        }),
        ..invalid_proposal
    };
    assert_accepted(&submit_tracking_action(&managed_agent, &channel_id, &proposal).await);
    let suggested_work_id = proposal
        .suggestion
        .as_ref()
        .expect("proposal payload")
        .work_item
        .work_item_id;
    let (suggestion_head_id, suggestion_head) = current_tracking_head(
        &admin,
        &channel_id,
        accepted_suggestion_id,
        CompanyWorkTrackingRecordType::CommitmentSuggestion,
    )
    .await;
    let CompanyWorkTrackingHead::CommitmentSuggestion(suggestion) = suggestion_head else {
        panic!("proposal must create a commitment suggestion head");
    };
    assert_eq!(suggestion.status, CompanyWorkSuggestionStatus::Pending);
    assert_eq!(
        suggestion.proposed_by_pubkey,
        managed_agent.public_key().to_hex()
    );
    assert_eq!(suggestion.source_event_id, source_event_id);
    assert_eq!(suggestion.source_channel_id.to_string(), channel_id);
    assert_eq!(
        suggestion.work_item.source_event_id.as_deref(),
        Some(suggestion.source_event_id.as_str())
    );
    assert_eq!(
        suggestion.work_item.thread_root_event_id.as_deref(),
        Some(suggestion.source_event_id.as_str())
    );
    assert_eq!(suggestion.work_item.work_item_id, suggested_work_id);
    assert!(
        !work_head_exists(&admin, &channel_id, suggested_work_id).await,
        "proposal alone must not create work"
    );

    let denied_accept = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Accept,
        record_id: accepted_suggestion_id,
        expected_head_event_id: Some(suggestion_head_id.clone()),
        suggestion: None,
        accepted_work_item_id: Some(suggested_work_id),
        config: None,
    };
    assert_rejected(&submit_tracking_action(&managed_agent, &channel_id, &denied_accept).await);
    assert_rejected(&submit_tracking_action(&outsider, &channel_id, &denied_accept).await);
    assert!(!work_head_exists(&admin, &channel_id, suggested_work_id).await);

    let accept = CompanyWorkTrackingAction {
        expected_head_event_id: Some(suggestion_head_id),
        ..denied_accept
    };
    assert_accepted(&submit_tracking_action(&requester, &channel_id, &accept).await);
    let (_, accepted_head) = current_tracking_head(
        &admin,
        &channel_id,
        accepted_suggestion_id,
        CompanyWorkTrackingRecordType::CommitmentSuggestion,
    )
    .await;
    let CompanyWorkTrackingHead::CommitmentSuggestion(accepted) = accepted_head else {
        panic!("accepted record must remain a commitment suggestion head");
    };
    assert_eq!(accepted.status, CompanyWorkSuggestionStatus::Accepted);
    assert_eq!(accepted.accepted_work_item_id, Some(suggested_work_id));
    let (_, work_head) = current_work_head(&admin, &channel_id, suggested_work_id).await;
    assert_eq!(
        work_head.source_event_id.as_deref(),
        Some(source_event_id.as_str())
    );
    assert_eq!(
        work_head.thread_root_event_id.as_deref(),
        Some(source_event_id.as_str())
    );

    let dismissed_id = Uuid::new_v4();
    let human_proposal = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Propose,
        record_id: dismissed_id,
        expected_head_event_id: None,
        suggestion: Some(CompanyWorkSuggestionInput {
            source_event_id: source_event_id.clone(),
            expires_at: None,
            work_item: work_input(Uuid::new_v4(), &proposer, &owner, None, None, None),
        }),
        accepted_work_item_id: None,
        config: None,
    };
    assert_accepted(&submit_tracking_action(&proposer, &channel_id, &human_proposal).await);
    let (dismiss_head_id, _) = current_tracking_head(
        &admin,
        &channel_id,
        dismissed_id,
        CompanyWorkTrackingRecordType::CommitmentSuggestion,
    )
    .await;
    let dismiss = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Dismiss,
        record_id: dismissed_id,
        expected_head_event_id: Some(dismiss_head_id),
        suggestion: None,
        accepted_work_item_id: None,
        config: None,
    };
    assert_accepted(&submit_tracking_action(&requester, &channel_id, &dismiss).await);
    let (_, dismissed_head) = current_tracking_head(
        &admin,
        &channel_id,
        dismissed_id,
        CompanyWorkTrackingRecordType::CommitmentSuggestion,
    )
    .await;
    assert!(matches!(
        dismissed_head,
        CompanyWorkTrackingHead::CommitmentSuggestion(ref item)
            if item.status == CompanyWorkSuggestionStatus::Dismissed
    ));

    let expired_id = Uuid::new_v4();
    let expires_at =
        (Utc::now() + chrono::Duration::seconds(5)).to_rfc3339_opts(SecondsFormat::Millis, true);
    let expiring_proposal = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Propose,
        record_id: expired_id,
        expected_head_event_id: None,
        suggestion: Some(CompanyWorkSuggestionInput {
            source_event_id,
            expires_at: Some(expires_at.clone()),
            work_item: work_input(Uuid::new_v4(), &proposer, &owner, None, None, None),
        }),
        accepted_work_item_id: None,
        config: None,
    };
    assert_accepted(&submit_tracking_action(&proposer, &channel_id, &expiring_proposal).await);
    let (expire_head_id, _) = current_tracking_head(
        &admin,
        &channel_id,
        expired_id,
        CompanyWorkTrackingRecordType::CommitmentSuggestion,
    )
    .await;
    let expires = DateTime::parse_from_rfc3339(&expires_at)
        .expect("valid expiry timestamp")
        .with_timezone(&Utc);
    let remaining = (expires - Utc::now()).to_std().unwrap_or_default();
    tokio::time::sleep(remaining + Duration::from_millis(300)).await;
    let expire = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Expire,
        record_id: expired_id,
        expected_head_event_id: Some(expire_head_id),
        suggestion: None,
        accepted_work_item_id: None,
        config: None,
    };
    assert_accepted(&submit_tracking_action(&requester, &channel_id, &expire).await);
    let (_, expired_head) = current_tracking_head(
        &admin,
        &channel_id,
        expired_id,
        CompanyWorkTrackingRecordType::CommitmentSuggestion,
    )
    .await;
    assert!(matches!(
        expired_head,
        CompanyWorkTrackingHead::CommitmentSuggestion(ref item)
            if item.status == CompanyWorkSuggestionStatus::Expired
    ));
}

async fn configure_watchdog(
    keys: &Keys,
    channel_id: &str,
    work_item_id: Uuid,
    interval_seconds: u32,
) -> (String, CompanyWorkTrackingHead) {
    let configure = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Configure,
        record_id: work_item_id,
        expected_head_event_id: None,
        suggestion: None,
        accepted_work_item_id: None,
        config: Some(CompanyWorkWatchdogConfig {
            check_when: CompanyWorkCheckWhen::NoUpdate,
            check_interval_seconds: interval_seconds,
            ask_first_pubkey: None,
            escalate_to_pubkey: None,
            escalation_interval_seconds: None,
        }),
    };
    assert_accepted(&submit_tracking_action(keys, channel_id, &configure).await);
    current_tracking_head(
        keys,
        channel_id,
        work_item_id,
        CompanyWorkTrackingRecordType::WatchdogConfiguration,
    )
    .await
}

async fn watchdog_schedule(
    pool: &PgPool,
    community_id: Uuid,
    work_item_id: Uuid,
    config_event_id: &[u8],
) -> (Uuid, DateTime<Utc>) {
    let row = sqlx::query(
        "SELECT id, scheduled_for FROM company_work_watchdog_deliveries \
         WHERE community_id = $1 AND work_item_id = $2 AND config_event_id = $3 \
         ORDER BY scheduled_for ASC LIMIT 1",
    )
    .bind(community_id)
    .bind(work_item_id)
    .bind(config_event_id)
    .fetch_one(pool)
    .await
    .expect("watchdog config durably schedules a check-in");
    (
        row.try_get("id").expect("delivery id"),
        row.try_get("scheduled_for").expect("schedule time"),
    )
}

async fn watchdog_delivery_state(
    pool: &PgPool,
    community_id: Uuid,
    delivery_id: Uuid,
) -> (String, i32, DateTime<Utc>, Option<String>) {
    let row = sqlx::query(
        "SELECT state, attempt_count, next_attempt_at, last_error \
         FROM company_work_watchdog_deliveries WHERE community_id = $1 AND id = $2",
    )
    .bind(community_id)
    .bind(delivery_id)
    .fetch_one(pool)
    .await
    .expect("read watchdog delivery journal");
    (
        row.try_get("state").expect("delivery state"),
        row.try_get("attempt_count").expect("attempt count"),
        row.try_get("next_attempt_at").expect("next attempt time"),
        row.try_get("last_error").expect("last error"),
    )
}

#[tokio::test]
#[ignore]
async fn company_work_watchdogs_require_explicit_config_retry_durably_deliver_and_cancel() {
    let admin = Keys::generate();
    let owner = Keys::generate();
    seed_relay_member(&admin, "owner").await;
    seed_relay_member(&owner, "member").await;
    let channel_id = create_test_channel(&admin).await;
    add_channel_member(&admin, &owner, &channel_id).await;

    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&test_database_url())
        .await
        .expect("connect watchdog test database");
    let community_id = ensure_test_community(&relay_authority()).await;
    let work_item_id = Uuid::new_v4();
    let root_event_id = send_message(&admin, &channel_id, "Launch checklist thread").await;
    let create = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(
            work_item_id,
            &owner,
            &owner,
            None,
            Some(root_event_id.clone()),
            Some(root_event_id.clone()),
        )),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_accepted(&submit_work_action(&admin, &channel_id, &create).await);
    let unsaved_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM company_work_watchdog_deliveries \
         WHERE community_id = $1 AND work_item_id = $2",
    )
    .bind(community_id)
    .bind(work_item_id)
    .fetch_one(&pool)
    .await
    .expect("check default watchdog state");
    assert_eq!(
        unsaved_count, 0,
        "watchdog starts OFF without a saved config"
    );

    let explicit_interval_seconds = 60;
    let (config_event_id, config_head) =
        configure_watchdog(&owner, &channel_id, work_item_id, explicit_interval_seconds).await;
    let CompanyWorkTrackingHead::WatchdogConfiguration(config) = config_head else {
        panic!("configure must create a watchdog head");
    };
    assert!(config.enabled);
    assert_eq!(
        config
            .config
            .as_ref()
            .map(|item| item.check_interval_seconds),
        Some(explicit_interval_seconds),
        "watchdog saves the explicitly chosen test interval"
    );
    let config_event_bytes = hex::decode(config_event_id).expect("config event id");
    let (delivery_id, scheduled_for) =
        watchdog_schedule(&pool, community_id, work_item_id, &config_event_bytes).await;

    let mut injected_time = scheduled_for;
    for expected_attempt in 1..=MAX_DELIVERY_ATTEMPTS {
        let claimed = claim_due_batch(
            &pool,
            "company-work-tracking-e2e",
            injected_time,
            injected_time + chrono::Duration::minutes(5),
            1,
        )
        .await
        .expect("claim due watchdog delivery");
        assert_eq!(claimed.len(), 1, "one due check-in should be leased");
        let delivery = claimed.into_iter().next().expect("claimed delivery");
        assert_eq!(delivery.id, delivery_id);
        assert_eq!(delivery.work_item_id, work_item_id);
        assert_eq!(delivery.attempt_count, expected_attempt);
        assert!(fail_delivery(
            &pool,
            &delivery,
            injected_time,
            "injected transport failure"
        )
        .await
        .expect("persist failure and retry"));

        let (state, attempt_count, next_attempt_at, last_error) =
            watchdog_delivery_state(&pool, community_id, delivery_id).await;
        assert_eq!(attempt_count, expected_attempt);
        assert_eq!(last_error.as_deref(), Some("injected transport failure"));
        if expected_attempt == MAX_DELIVERY_ATTEMPTS {
            assert_eq!(state, "failed", "retry limit is terminal");
        } else {
            assert_eq!(state, "pending", "failure remains durable and retryable");
            assert_eq!(next_attempt_at, retry_at(injected_time, expected_attempt));
            let before_retry = next_attempt_at - chrono::Duration::seconds(1);
            let early_claim = claim_due_batch(
                &pool,
                "company-work-tracking-e2e",
                before_retry,
                before_retry + chrono::Duration::minutes(5),
                1,
            )
            .await
            .expect("early retry query");
            assert!(
                early_claim.is_empty(),
                "retry must honor its persisted backoff"
            );
            injected_time = next_attempt_at;
        }
    }

    let delivered_work_id = Uuid::new_v4();
    let delivered_root_id = send_message(&admin, &channel_id, "Quiet thread for check-in").await;
    let delivered_create = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id: delivered_work_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(
            delivered_work_id,
            &owner,
            &owner,
            None,
            Some(delivered_root_id.clone()),
            Some(delivered_root_id.clone()),
        )),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_accepted(&submit_work_action(&admin, &channel_id, &delivered_create).await);
    let (delivered_config_id, _) =
        configure_watchdog(&owner, &channel_id, delivered_work_id, 1).await;
    let delivered_config_bytes = hex::decode(delivered_config_id).expect("config event id");
    let (delivered_id, _) = watchdog_schedule(
        &pool,
        community_id,
        delivered_work_id,
        &delivered_config_bytes,
    )
    .await;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let (state, _, _, last_error) =
            watchdog_delivery_state(&pool, community_id, delivered_id).await;
        if state == "delivered" {
            break;
        }
        assert!(
            state != "failed" && state != "cancelled",
            "scheduler did not deliver check-in: state={state}, last_error={last_error:?}"
        );
        assert!(
            Instant::now() < deadline,
            "scheduler did not deliver the due check-in before timeout"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let replies = thread_replies(&admin, &channel_id, &delivered_root_id).await;
    let check_in = replies
        .iter()
        .find(|event| event.content == "Check-in: Prepare the launch checklist")
        .expect("successful watchdog delivery is a message in the work thread");
    assert!(check_in.tags.iter().any(|tag| {
        let values = tag.as_slice();
        tag.kind().to_string() == "e"
            && values
                .get(1)
                .is_some_and(|value| value == &delivered_root_id)
            && values.get(3).is_some_and(|marker| marker == "reply")
    }));
    let (delivered_head_id, delivered_head) = current_tracking_head(
        &admin,
        &channel_id,
        delivered_work_id,
        CompanyWorkTrackingRecordType::WatchdogConfiguration,
    )
    .await;
    assert!(
        matches!(
            current_work_head(&admin, &channel_id, delivered_work_id)
                .await
                .1
                .status,
            CompanyWorkStatus::Active
        ),
        "watchdog messages never change work status"
    );
    assert!(matches!(
        delivered_head,
        CompanyWorkTrackingHead::WatchdogConfiguration(ref item) if item.enabled
    ));
    let disable_delivered = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Disable,
        record_id: delivered_work_id,
        expected_head_event_id: Some(delivered_head_id),
        suggestion: None,
        accepted_work_item_id: None,
        config: None,
    };
    assert_accepted(&submit_tracking_action(&owner, &channel_id, &disable_delivered).await);

    let cancel_work_id = Uuid::new_v4();
    let cancel_root_id = send_message(&admin, &channel_id, "Second watchdog thread").await;
    let cancel_create = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id: cancel_work_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(
            cancel_work_id,
            &owner,
            &owner,
            None,
            Some(cancel_root_id.clone()),
            Some(cancel_root_id),
        )),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_accepted(&submit_work_action(&admin, &channel_id, &cancel_create).await);
    let (cancel_config_event_id, _) =
        configure_watchdog(&owner, &channel_id, cancel_work_id, 60).await;
    let cancel_config_bytes = hex::decode(cancel_config_event_id.clone()).expect("config event id");
    let (cancel_delivery_id, cancel_scheduled_for) =
        watchdog_schedule(&pool, community_id, cancel_work_id, &cancel_config_bytes).await;
    let claimed = claim_due_batch(
        &pool,
        "company-work-tracking-e2e",
        cancel_scheduled_for,
        cancel_scheduled_for + chrono::Duration::minutes(5),
        1,
    )
    .await
    .expect("claim delivery before watchdog disable");
    assert_eq!(claimed.len(), 1);
    let in_flight = claimed.into_iter().next().expect("in-flight delivery");
    assert_eq!(in_flight.id, cancel_delivery_id);
    let disable = CompanyWorkTrackingAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        action: CompanyWorkTrackingActionKind::Disable,
        record_id: cancel_work_id,
        expected_head_event_id: Some(cancel_config_event_id),
        suggestion: None,
        accepted_work_item_id: None,
        config: None,
    };
    assert_accepted(&submit_tracking_action(&owner, &channel_id, &disable).await);
    let (state, _, _, _) = watchdog_delivery_state(&pool, community_id, cancel_delivery_id).await;
    assert_eq!(state, "cancelled", "disable cancels an in-flight lease");
    assert!(!fail_delivery(
        &pool,
        &in_flight,
        cancel_scheduled_for,
        "stale worker completion",
    )
    .await
    .expect("cancelled lease rejects a stale failure"));
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

async fn submit_tracking_action(
    keys: &Keys,
    channel_id: &str,
    action: &CompanyWorkTrackingAction,
) -> Value {
    let builder = buzz_sdk::company_work_tracking::build_company_work_tracking_action(
        Uuid::parse_str(channel_id).expect("channel UUID"),
        action,
    )
    .expect("build company work tracking action");
    let event = builder
        .sign_with_keys(keys)
        .expect("sign company work tracking action");
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

async fn current_tracking_head(
    keys: &Keys,
    channel_id: &str,
    record_id: Uuid,
    record_type: CompanyWorkTrackingRecordType,
) -> (String, CompanyWorkTrackingHead) {
    let d_tag = match record_type {
        CompanyWorkTrackingRecordType::CommitmentSuggestion => {
            company_work_suggestion_d_tag(record_id)
        }
        CompanyWorkTrackingRecordType::WatchdogConfiguration => {
            company_work_watchdog_d_tag(record_id)
        }
    };
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query work tracking head");
    let id = sub_id("work-tracking-head");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_COMPANY_WORK_TRACKING_HEAD as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::H), [channel_id])
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    client
        .subscribe(&id, vec![filter])
        .await
        .expect("subscribe work tracking head");
    let events = client
        .collect_until_eose(&id, Duration::from_secs(10))
        .await
        .expect("read work tracking head");
    client
        .disconnect()
        .await
        .expect("disconnect tracking query client");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned current work tracking head");
    let head: CompanyWorkTrackingHead =
        serde_json::from_str(&event.content).expect("parse work tracking head");
    (event.id.to_hex(), head)
}

async fn work_head_exists(keys: &Keys, channel_id: &str, work_item_id: Uuid) -> bool {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query optional work head");
    let id = sub_id("optional-work-head");
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
        .expect("subscribe optional work head");
    let events = client
        .collect_until_eose(&id, Duration::from_secs(10))
        .await
        .expect("read optional work head");
    client
        .disconnect()
        .await
        .expect("disconnect optional work query");
    !events.is_empty()
}

async fn thread_replies(keys: &Keys, channel_id: &str, root_event_id: &str) -> Vec<Event> {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query work thread");
    let id = sub_id("work-thread-replies");
    let filter = Filter::new()
        .kind(Kind::Custom(9))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::H), [channel_id])
        .custom_tags(SingleLetterTag::lowercase(Alphabet::E), [root_event_id]);
    client
        .subscribe(&id, vec![filter])
        .await
        .expect("subscribe to work thread replies");
    let events = client
        .collect_until_eose(&id, Duration::from_secs(10))
        .await
        .expect("read work thread replies");
    client
        .disconnect()
        .await
        .expect("disconnect work thread query");
    events
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
        due_at: None,
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
            due_at: None,
        }),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
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
        due_at: None,
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
        due_at: None,
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
async fn company_work_due_dates_validate_authority_preserve_legacy_updates_and_record_history() {
    let admin = Keys::generate();
    let owner = Keys::generate();
    let intruder = Keys::generate();
    seed_relay_member(&admin, "owner").await;
    seed_relay_member(&owner, "member").await;
    seed_relay_member(&intruder, "member").await;
    let channel_id = create_test_channel(&admin).await;
    add_channel_member(&admin, &owner, &channel_id).await;
    add_channel_member(&admin, &intruder, &channel_id).await;

    let work_item_id = Uuid::new_v4();
    let create = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(work_item_id, &owner, &owner, None, None, None)),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_accepted(&submit_work_action(&admin, &channel_id, &create).await);

    let future_due = (chrono::Utc::now() + chrono::Duration::days(30))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let (head_id, created_head) = current_work_head(&admin, &channel_id, work_item_id).await;
    let set_due = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::SetDueDate,
        expected_head_event_id: Some(head_id),
        head: None,
        status: None,
        reason: None,
        verification: None,
        due_at: Some(future_due.clone()),
    };
    assert_accepted(&submit_work_action(&owner, &channel_id, &set_due).await);
    let (head_id, due_head) = current_work_head(&admin, &channel_id, work_item_id).await;
    assert_eq!(due_head.due_at.as_deref(), Some(future_due.as_str()));
    assert!(due_head.accepted_at.is_some());
    assert_eq!(due_head.accepted_at, created_head.accepted_at);
    assert_eq!(due_head.status, CompanyWorkStatus::Active);

    let malformed_timestamp = CompanyWorkItemAction {
        due_at: Some("2026-10-30T09:00:00+00:00".into()),
        ..set_due.clone()
    };
    assert_rejected(&submit_raw_work_action(&owner, &channel_id, &malformed_timestamp).await);
    let before_acceptance = CompanyWorkItemAction {
        due_at: Some("2000-01-01T00:00:00Z".into()),
        ..set_due.clone()
    };
    assert_rejected(&submit_raw_work_action(&owner, &channel_id, &before_acceptance).await);
    let unauthorized = CompanyWorkItemAction {
        expected_head_event_id: Some(head_id.clone()),
        ..set_due.clone()
    };
    assert_rejected(&submit_work_action(&intruder, &channel_id, &unauthorized).await);

    let generic_update = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Update,
        expected_head_event_id: Some(head_id),
        head: Some(CompanyWorkItemInput {
            schema_version: due_head.schema_version,
            work_item_id,
            title: due_head.title.clone(),
            status: due_head.status,
            assigned_pubkeys: due_head.assigned_pubkeys.clone(),
            approver_pubkeys: due_head.approver_pubkeys.clone(),
            deliverables: due_head.deliverables.clone(),
            requester_pubkey: due_head.requester_pubkey.clone(),
            done_condition: due_head.done_condition.clone(),
            goal_id: due_head.goal_id,
            source_event_id: due_head.source_event_id.clone(),
            thread_root_event_id: due_head.thread_root_event_id.clone(),
            evidence: due_head.evidence.clone(),
            due_at: None,
        }),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_accepted(&submit_work_action(&owner, &channel_id, &generic_update).await);
    let (head_id, updated_head) = current_work_head(&admin, &channel_id, work_item_id).await;
    assert_eq!(updated_head.due_at, Some(future_due));

    let changed_due = (chrono::Utc::now() + chrono::Duration::days(60))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let change_due = CompanyWorkItemAction {
        expected_head_event_id: Some(head_id),
        due_at: Some(changed_due),
        ..set_due.clone()
    };
    assert_accepted(&submit_work_action(&owner, &channel_id, &change_due).await);
    let (head_id, changed_head) = current_work_head(&admin, &channel_id, work_item_id).await;
    assert!(changed_head.due_at.is_some());
    let clear_due = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::ClearDueDate,
        expected_head_event_id: Some(head_id),
        head: None,
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_accepted(&submit_work_action(&owner, &channel_id, &clear_due).await);
    let (_, cleared_head) = current_work_head(&admin, &channel_id, work_item_id).await;
    assert_eq!(cleared_head.due_at, None);
    assert_eq!(cleared_head.status, CompanyWorkStatus::Active);
    assert_eq!(cleared_head.accepted_at, created_head.accepted_at);

    let mut client = BuzzTestClient::connect(&relay_url(), &admin)
        .await
        .expect("connect to query due-date history");
    let id = sub_id("work-due-history");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_WORK_ITEM_ACTION as u16))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::H),
            [channel_id.as_str()],
        )
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            [company_work_d_tag(work_item_id)],
        );
    client
        .subscribe(&id, vec![filter])
        .await
        .expect("subscribe due-date history");
    let due_actions: Vec<Event> = client
        .collect_until_eose(&id, Duration::from_secs(10))
        .await
        .expect("read due-date history")
        .into_iter()
        .filter(|event| {
            serde_json::from_str::<CompanyWorkItemAction>(&event.content).is_ok_and(|action| {
                matches!(
                    action.action,
                    CompanyWorkItemActionKind::SetDueDate | CompanyWorkItemActionKind::ClearDueDate
                )
            })
        })
        .collect();
    client
        .disconnect()
        .await
        .expect("disconnect due-date history client");
    assert_eq!(due_actions.len(), 3);
    assert!(due_actions
        .iter()
        .all(|event| event.pubkey == owner.public_key() && event.created_at.as_secs() > 0));
}

#[tokio::test]
#[ignore]
async fn company_work_moves_between_channels_only_for_authorized_same_audience_members() {
    let admin = Keys::generate();
    let requester = Keys::generate();
    let owner = Keys::generate();
    let intruder = Keys::generate();
    seed_relay_member(&admin, "owner").await;
    seed_relay_member(&requester, "member").await;
    seed_relay_member(&owner, "member").await;
    seed_relay_member(&intruder, "member").await;

    let source_channel_id = create_test_channel(&admin).await;
    let destination_channel_id = create_test_channel(&admin).await;
    for member in [&requester, &owner, &intruder] {
        add_channel_member(&admin, member, &source_channel_id).await;
        add_channel_member(&admin, member, &destination_channel_id).await;
    }
    let source_event_id = send_message(&owner, &source_channel_id, "I will own this work").await;
    let destination_root_id =
        send_message(&admin, &destination_channel_id, "October client review").await;
    let goal_id = Uuid::new_v4();
    assert_accepted(
        &send_goal_action(
            &admin,
            &goal_create_action(goal_id, &admin, &source_channel_id),
        )
        .await,
    );

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
            Some(goal_id),
            Some(source_event_id.clone()),
            Some(source_event_id.clone()),
        )),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_accepted(&submit_work_action(&admin, &source_channel_id, &create).await);
    let (head_id, head) = current_work_head(&admin, &source_channel_id, work_item_id).await;

    let destination_head = |root: &str| CompanyWorkItemInput {
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
        thread_root_event_id: Some(root.to_owned()),
        evidence: head.evidence.clone(),
        due_at: None,
    };
    let denied_move = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Update,
        expected_head_event_id: Some(head_id.clone()),
        head: Some(destination_head(&destination_root_id)),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_rejected(&submit_work_action(&intruder, &source_channel_id, &denied_move).await);
    assert_eq!(
        current_work_head(&admin, &source_channel_id, work_item_id)
            .await
            .1
            .thread_root_event_id
            .as_deref(),
        Some(source_event_id.as_str())
    );

    let moved = CompanyWorkItemAction {
        expected_head_event_id: Some(head_id),
        head: Some(destination_head(&destination_root_id)),
        ..denied_move
    };
    assert_accepted(&submit_work_action(&owner, &source_channel_id, &moved).await);
    let (_, current) = current_work_head(&admin, &destination_channel_id, work_item_id).await;
    assert_eq!(current.work_item_id, work_item_id);
    assert_eq!(
        current.source_event_id.as_deref(),
        Some(source_event_id.as_str())
    );
    assert_eq!(
        current.thread_root_event_id.as_deref(),
        Some(destination_root_id.as_str())
    );
    assert_eq!(current.assigned_pubkeys, head.assigned_pubkeys);
    assert_eq!(current.requester_pubkey, head.requester_pubkey);
    assert_eq!(current.goal_id, Some(goal_id));
    assert_eq!(current.done_condition, head.done_condition);
    assert_eq!(current.status, head.status);
    assert_eq!(current.evidence, head.evidence);
}

#[tokio::test]
#[ignore]
async fn company_work_move_rejects_a_changed_destination_audience() {
    let admin = Keys::generate();
    let requester = Keys::generate();
    let owner = Keys::generate();
    let extra_member = Keys::generate();
    seed_relay_member(&admin, "owner").await;
    seed_relay_member(&requester, "member").await;
    seed_relay_member(&owner, "member").await;
    seed_relay_member(&extra_member, "member").await;

    let source_channel_id = create_test_channel(&admin).await;
    let destination_channel_id = create_test_channel(&admin).await;
    for member in [&requester, &owner] {
        add_channel_member(&admin, member, &source_channel_id).await;
        add_channel_member(&admin, member, &destination_channel_id).await;
    }
    add_channel_member(&admin, &extra_member, &source_channel_id).await;
    let source_event_id = send_message(&owner, &source_channel_id, "Source root").await;
    let destination_root_id = send_message(&admin, &destination_channel_id, "Target root").await;
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
        due_at: None,
    };
    assert_accepted(&submit_work_action(&admin, &source_channel_id, &create).await);
    let (head_id, head) = current_work_head(&admin, &source_channel_id, work_item_id).await;
    let move_action = CompanyWorkItemAction {
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
            thread_root_event_id: Some(destination_root_id),
            evidence: head.evidence.clone(),
            due_at: None,
        }),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };
    assert_rejected(&submit_work_action(&owner, &source_channel_id, &move_action).await);
    let (_, current) = current_work_head(&admin, &source_channel_id, work_item_id).await;
    assert_eq!(
        current.thread_root_event_id.as_deref(),
        Some(source_event_id.as_str())
    );
}

#[tokio::test]
#[ignore]
async fn company_work_allows_channel_members_without_relay_membership() {
    let community_owner = Keys::generate();
    let channel_member = Keys::generate();
    seed_relay_member(&community_owner, "owner").await;
    let channel_id = create_test_channel(&community_owner).await;
    add_channel_member(&community_owner, &channel_member, &channel_id).await;
    let source_event_id = send_message(&channel_member, &channel_id, "I will own this work").await;
    let work_item_id = Uuid::new_v4();
    let create = CompanyWorkItemAction {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        work_item_id,
        action: CompanyWorkItemActionKind::Create,
        expected_head_event_id: None,
        head: Some(work_input(
            work_item_id,
            &channel_member,
            &channel_member,
            None,
            Some(source_event_id.clone()),
            Some(source_event_id),
        )),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
    };

    assert_accepted(&submit_work_action(&channel_member, &channel_id, &create).await);
    let (_, head) = current_work_head(&community_owner, &channel_id, work_item_id).await;
    assert_eq!(head.status, CompanyWorkStatus::Active);
    assert_eq!(
        head.assigned_pubkeys,
        vec![channel_member.public_key().to_hex()]
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
        due_at: None,
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
            due_at: None,
        }),
        status: None,
        reason: None,
        verification: None,
        due_at: None,
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
        due_at: None,
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
        due_at: None,
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
        let create_unlinked = CompanyWorkItemAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            work_item_id,
            action: CompanyWorkItemActionKind::Create,
            expected_head_event_id: None,
            head: Some(work_input(work_item_id, &admin, &admin, None, None, None)),
            status: None,
            reason: None,
            verification: None,
            due_at: None,
        };
        assert_accepted(&submit_work_action(&admin, &channel_id, &create_unlinked).await);
        let (head_id, unlinked_head) = current_work_head(&admin, &channel_id, work_item_id).await;
        assert_eq!(unlinked_head.goal_id, None);

        let link_to_unavailable_goal = CompanyWorkItemAction {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            work_item_id,
            action: CompanyWorkItemActionKind::Update,
            expected_head_event_id: Some(head_id),
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
            due_at: None,
        };
        assert_rejected(&submit_work_action(&admin, &channel_id, &link_to_unavailable_goal).await);
        let (_, unchanged_head) = current_work_head(&admin, &channel_id, work_item_id).await;
        assert_eq!(unchanged_head.goal_id, None);
    }
}
