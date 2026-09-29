//! Relay acceptance and authorization tests for Factory run records.
//!
//! These tests use a disposable local relay, Postgres database, and Redis.

use std::time::Duration;

use buzz_core::factory_run_records::{
    factory_run_d_tag, FactoryCheckResult, FactoryCheckStatus, FactoryPreviewState,
    FactoryPullRequest, FactoryPullRequestState, FactoryRunAction, FactoryRunActionKind,
    FactoryRunHead, FACTORY_RUN_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::KIND_FACTORY_RUN_HEAD;
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, Filter, Keys, Kind, SingleLetterTag};
use serde_json::Value;
use uuid::Uuid;

fn relay_url() -> String {
    let value = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_owned());
    let parsed = url::Url::parse(&value).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "Factory run record E2E tests only send events to a local relay"
    );
    value
}

fn relay_http_url() -> String {
    relay_url()
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_owned()
}

fn relay_authority() -> String {
    let url = url::Url::parse(&relay_http_url()).expect("relay HTTP URL");
    url[url::Position::BeforeHost..url::Position::AfterPort].to_owned()
}

async fn seed_relay_member(keys: &Keys, role: &str) {
    let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name a disposable E2E database");
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("connect to E2E Postgres");
    let host = relay_authority();
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities (id, host) VALUES ($1, $2) \
         ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(id)
    .bind(&host)
    .execute(&pool)
    .await
    .expect("seed E2E community");
    let community_id: Uuid =
        sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
            .bind(&host)
            .fetch_one(&pool)
            .await
            .expect("read E2E community");
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

fn assert_rejected(response: &Value) {
    assert!(
        !response["accepted"].as_bool().unwrap_or(false),
        "event should have been rejected: {response}"
    );
}

async fn submit_action(keys: &Keys, action: &FactoryRunAction) -> Value {
    let event = buzz_sdk::company_records::build_factory_run_action(action)
        .expect("build Factory run action")
        .sign_with_keys(keys)
        .expect("sign Factory run action");
    post_event(keys, &event).await
}

async fn current_head(keys: &Keys, run_id: Uuid) -> (String, FactoryRunHead) {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query Factory run head");
    let subscription_id = format!("e2e-factory-run-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_FACTORY_RUN_HEAD as u16))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            [factory_run_d_tag(run_id)],
        );
    client
        .subscribe(&subscription_id, vec![filter])
        .await
        .expect("subscribe to Factory run head");
    let events = client
        .collect_until_eose(&subscription_id, Duration::from_secs(10))
        .await
        .expect("read Factory run head");
    client
        .disconnect()
        .await
        .expect("disconnect Factory run query");
    let event = events
        .into_iter()
        .next()
        .expect("relay returned Factory head");
    let head: FactoryRunHead = serde_json::from_str(&event.content).expect("parse Factory head");
    assert_eq!(head.run_id, run_id);
    (event.id.to_hex(), head)
}

fn action(
    run_id: Uuid,
    kind: FactoryRunActionKind,
    expected_head_event_id: Option<String>,
    run_owner_pubkey: Option<String>,
) -> FactoryRunAction {
    FactoryRunAction {
        schema_version: FACTORY_RUN_RECORD_SCHEMA_VERSION,
        run_id,
        run_owner_pubkey,
        expected_head_event_id,
        action: kind,
        command: None,
        local_url: None,
        preview: None,
        pull_request: None,
    }
}

#[tokio::test]
#[ignore]
async fn factory_run_records_validate_state_and_enforce_owner_or_admin_authority() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let member = Keys::generate();
    seed_relay_member(&owner, "member").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&member, "member").await;

    let run_id = Uuid::new_v4();
    let mut configure = action(
        run_id,
        FactoryRunActionKind::ConfigurePreview,
        None,
        Some(owner.public_key().to_hex()),
    );
    configure.command = Some("pnpm dev".to_owned());
    configure.local_url = Some("http://127.0.0.1:4100".to_owned());
    assert_accepted(&submit_action(&owner, &configure).await);

    let (head_id, head) = current_head(&owner, run_id).await;
    assert!(matches!(
        head.preview,
        FactoryPreviewState::NotStarted { .. }
    ));

    let mut intruder_start = action(
        run_id,
        FactoryRunActionKind::ReportPreviewState,
        Some(head_id.clone()),
        None,
    );
    intruder_start.preview = Some(FactoryPreviewState::Starting {
        command: "pnpm dev".to_owned(),
        local_url: "http://127.0.0.1:4100".to_owned(),
    });
    assert_rejected(&submit_action(&member, &intruder_start).await);

    let mut admin_start = intruder_start.clone();
    admin_start.expected_head_event_id = Some(head_id.clone());
    assert_accepted(&submit_action(&admin, &admin_start).await);
    let (starting_id, starting) = current_head(&owner, run_id).await;
    assert!(matches!(
        starting.preview,
        FactoryPreviewState::Starting { .. }
    ));

    let mut report_failure = action(
        run_id,
        FactoryRunActionKind::ReportPreviewState,
        Some(starting_id.clone()),
        None,
    );
    report_failure.preview = Some(FactoryPreviewState::Failed {
        command: "pnpm dev".to_owned(),
        local_url: "http://127.0.0.1:4100".to_owned(),
        reason: "The configured command exited".to_owned(),
        startup_output: Some("Missing script: dev".to_owned()),
    });
    assert_accepted(&submit_action(&owner, &report_failure).await);
    let (failed_id, failed) = current_head(&owner, run_id).await;
    assert!(matches!(failed.preview, FactoryPreviewState::Failed { .. }));

    let mut invalid_transition = action(
        run_id,
        FactoryRunActionKind::ReportPreviewState,
        Some(failed_id.clone()),
        None,
    );
    invalid_transition.preview = Some(FactoryPreviewState::Running {
        command: "pnpm dev".to_owned(),
        local_url: "http://127.0.0.1:4100".to_owned(),
        url: "http://127.0.0.1:4100".to_owned(),
    });
    assert_rejected(&submit_action(&owner, &invalid_transition).await);

    let mut stale_update = report_failure.clone();
    stale_update.expected_head_event_id = Some(starting_id);
    stale_update.preview = Some(FactoryPreviewState::Failed {
        command: "pnpm dev".to_owned(),
        local_url: "http://127.0.0.1:4100".to_owned(),
        reason: "A stale failure report".to_owned(),
        startup_output: Some("Superseded report".to_owned()),
    });
    assert_rejected(&submit_action(&owner, &stale_update).await);

    let mut link = action(
        run_id,
        FactoryRunActionKind::LinkPullRequest,
        Some(failed_id),
        None,
    );
    link.pull_request = Some(FactoryPullRequest {
        url: "https://github.com/example/project/pull/123".to_owned(),
        number: 123,
        state: FactoryPullRequestState::Unknown,
        check_results: vec![FactoryCheckResult {
            name: "Hosted CI".to_owned(),
            status: FactoryCheckStatus::Queued,
            details_url: None,
        }],
        review_handoff: Some("Review the linked changes".to_owned()),
    });
    assert_accepted(&submit_action(&admin, &link).await);
    let (linked_id, linked) = current_head(&owner, run_id).await;
    assert_eq!(linked.pull_request.as_ref().map(|pr| pr.number), Some(123));

    let unlink = action(
        run_id,
        FactoryRunActionKind::UnlinkPullRequest,
        Some(linked_id.clone()),
        None,
    );
    assert_rejected(&submit_action(&member, &unlink).await);
    let (linked_id, _) = current_head(&owner, run_id).await;
    let admin_unlink = action(
        run_id,
        FactoryRunActionKind::UnlinkPullRequest,
        Some(linked_id),
        None,
    );
    assert_accepted(&submit_action(&admin, &admin_unlink).await);
    let (_, unlinked) = current_head(&owner, run_id).await;
    assert!(unlinked.pull_request.is_none());

    let invalid_run_id = Uuid::new_v4();
    let mut invalid_configuration = action(
        invalid_run_id,
        FactoryRunActionKind::ConfigurePreview,
        None,
        Some(owner.public_key().to_hex()),
    );
    invalid_configuration.command = Some("pnpm dev".to_owned());
    invalid_configuration.local_url = Some("http://preview.example.com".to_owned());
    assert_rejected(&submit_action(&owner, &invalid_configuration).await);
}
