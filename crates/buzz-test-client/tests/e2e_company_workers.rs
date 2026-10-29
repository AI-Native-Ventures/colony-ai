//! Relay integration tests for budgeted worker run records.
//!
//! These cases run against the isolated CI relay, Postgres, and Redis service.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::company_workers::{
    worker_d_tag, WorkerRun, WorkerRunAction, WorkerRunHead, WorkerStatus,
};
use buzz_core::kind::{KIND_MEMBER_POSITION_HEAD, KIND_WORKER_RUN_HEAD};
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, Filter, Keys, Kind, SingleLetterTag};
use serde::de::DeserializeOwned;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "company worker E2E tests only send events to a local relay"
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

async fn pool() -> sqlx::PgPool {
    PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to E2E Postgres")
}

async fn ensure_test_community(host: &str) -> Uuid {
    let pool = pool().await;
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
    let pool = pool().await;
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

/// A managed agent: a user row that names its owner, and no relay membership.
async fn seed_managed_agent(agent: &Keys, owner: &Keys) {
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = pool().await;
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

fn rejection_message(response: &Value) -> String {
    assert!(
        !response["accepted"].as_bool().unwrap_or(false),
        "event should have been rejected: {response}"
    );
    response["message"]
        .as_str()
        .or_else(|| response["error"].as_str())
        .unwrap_or_default()
        .to_owned()
}

fn assert_rejected(response: &Value, expected: &str) {
    let message = rejection_message(response);
    assert!(
        message.contains(expected),
        "rejection should explain {expected}: {response}"
    );
}

async fn current_head<T: DeserializeOwned>(keys: &Keys, kind: u32, d_tag: &str) -> (String, T) {
    let filter = Filter::new()
        .kind(Kind::Custom(kind as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    let events = read_events(keys, filter).await;
    assert_eq!(events.len(), 1, "exactly one current head for {d_tag}");
    let event = &events[0];
    let record = serde_json::from_str(&event.content).expect("parse company head");
    (event.id.to_hex(), record)
}

async fn read_events(keys: &Keys, filter: Filter) -> Vec<Event> {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to query company heads");
    let sub_id = format!("e2e-company-workers-{}", Uuid::new_v4());
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe company heads");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read company heads");
    client.disconnect().await.expect("disconnect query client");
    events
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_secs() as i64
}

fn running_run(worker_id: &str, parent: &Keys) -> WorkerRun {
    let started_at = now();
    WorkerRun {
        worker_id: worker_id.to_owned(),
        parent_pubkey: parent.public_key().to_hex(),
        label: "Research: Melville guesthouses".into(),
        model: "colony-credits".into(),
        status: WorkerStatus::Running,
        started_at,
        deadline_at: started_at + 600,
        finished_at: None,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: None,
        output_text: None,
        failure_reason: None,
    }
}

fn done_run(running: &WorkerRun) -> WorkerRun {
    WorkerRun {
        status: WorkerStatus::Done,
        finished_at: Some(running.started_at + 5),
        input_tokens: 800,
        output_tokens: 300,
        cost_usd: Some(0.02),
        output_text: Some("Ten guesthouses, ranked.".into()),
        ..running.clone()
    }
}

fn action(run: &WorkerRun, expected_head_event_id: Option<&str>) -> WorkerRunAction {
    WorkerRunAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        run: run.clone(),
        expected_head_event_id: expected_head_event_id.map(str::to_owned),
    }
}

async fn submit(signer: &Keys, action: &WorkerRunAction) -> Value {
    let event = buzz_sdk::company_workers::build_worker_run_action(action)
        .expect("build worker action")
        .sign_with_keys(signer)
        .expect("sign worker action");
    post_event(signer, &event).await
}

#[tokio::test]
#[ignore]
async fn agent_writes_own_worker_record() {
    let owner = Keys::generate();
    let member = Keys::generate();
    let agent = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&member, "member").await;
    seed_managed_agent(&agent, &owner).await;

    let worker_id = Uuid::new_v4().to_string();
    let tag = worker_d_tag(&worker_id).expect("worker d-tag");
    let started = running_run(&worker_id, &agent);
    assert_accepted(&submit(&agent, &action(&started, None)).await);

    let (head_id, head): (String, WorkerRunHead) =
        current_head(&owner, KIND_WORKER_RUN_HEAD, &tag).await;
    assert_eq!(head.run.status, WorkerStatus::Running);
    assert_eq!(head.run.label, started.label);
    assert_eq!(head.updated_by_pubkey, agent.public_key().to_hex());

    // Starting the same worker twice does not replace its record. The label
    // differs so the second event is not a byte-identical duplicate.
    let mut restarted = started.clone();
    restarted.label = "A second start".into();
    assert_rejected(
        &submit(&agent, &action(&restarted, None)).await,
        "worker run changed",
    );

    // A member who is not the employee cannot end the run.
    let finished = done_run(&started);
    assert_rejected(
        &submit(&member, &action(&finished, Some(&head_id))).await,
        "only the employee that started this worker",
    );
    // An ending record must name the head it ends.
    assert_rejected(
        &submit(&agent, &action(&finished, Some(&"ab".repeat(32)))).await,
        "worker run changed",
    );
    // Identity and deadline are fixed once the run starts.
    let mut moved_deadline = finished.clone();
    moved_deadline.deadline_at += 60;
    assert_rejected(
        &submit(&agent, &action(&moved_deadline, Some(&head_id))).await,
        "cannot change",
    );
    assert_accepted(&submit(&agent, &action(&finished, Some(&head_id))).await);

    let (done_head_id, done): (String, WorkerRunHead) =
        current_head(&owner, KIND_WORKER_RUN_HEAD, &tag).await;
    assert_eq!(done.run.status, WorkerStatus::Done);
    assert_eq!(
        done.run.output_text.as_deref(),
        Some("Ten guesthouses, ranked.")
    );
    assert_eq!((done.run.input_tokens, done.run.output_tokens), (800, 300));

    // An ended run never changes.
    let mut cancelled = started.clone();
    cancelled.status = WorkerStatus::Cancelled;
    cancelled.finished_at = Some(started.started_at + 9);
    assert_rejected(
        &submit(&agent, &action(&cancelled, Some(&done_head_id))).await,
        "already ended",
    );

    // An owner can cancel a running worker started by an employee.
    let second_id = Uuid::new_v4().to_string();
    let second_tag = worker_d_tag(&second_id).expect("second d-tag");
    let second = running_run(&second_id, &agent);
    assert_accepted(&submit(&agent, &action(&second, None)).await);
    let (second_head_id, _): (String, WorkerRunHead) =
        current_head(&owner, KIND_WORKER_RUN_HEAD, &second_tag).await;
    let mut stopped = second.clone();
    stopped.status = WorkerStatus::Cancelled;
    stopped.finished_at = Some(second.started_at + 3);
    assert_accepted(&submit(&owner, &action(&stopped, Some(&second_head_id))).await);
    let (_, after): (String, WorkerRunHead) =
        current_head(&owner, KIND_WORKER_RUN_HEAD, &second_tag).await;
    assert_eq!(after.run.status, WorkerStatus::Cancelled);
    assert_eq!(after.updated_by_pubkey, owner.public_key().to_hex());
}

#[tokio::test]
#[ignore]
async fn agent_cannot_write_another_agents_worker_record() {
    let owner = Keys::generate();
    let agent_a = Keys::generate();
    let agent_b = Keys::generate();
    let stranger = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_managed_agent(&agent_a, &owner).await;
    seed_managed_agent(&agent_b, &owner).await;

    // B cannot start a worker that claims to be A's.
    let claimed = Uuid::new_v4().to_string();
    assert_rejected(
        &submit(&agent_b, &action(&running_run(&claimed, &agent_a), None)).await,
        "only the employee that started this worker",
    );
    let claimed_tag = worker_d_tag(&claimed).expect("claimed d-tag");
    let heads = read_events(
        &owner,
        Filter::new()
            .kind(Kind::Custom(KIND_WORKER_RUN_HEAD as u16))
            .custom_tags(
                SingleLetterTag::lowercase(Alphabet::D),
                [claimed_tag.as_str()],
            ),
    )
    .await;
    assert!(heads.is_empty(), "a refused write leaves no record");

    // B cannot end A's running worker either.
    let worker_id = Uuid::new_v4().to_string();
    let tag = worker_d_tag(&worker_id).expect("worker d-tag");
    let started = running_run(&worker_id, &agent_a);
    assert_accepted(&submit(&agent_a, &action(&started, None)).await);
    let (head_id, _): (String, WorkerRunHead) =
        current_head(&owner, KIND_WORKER_RUN_HEAD, &tag).await;
    let mut cancelled = started.clone();
    cancelled.status = WorkerStatus::Cancelled;
    cancelled.finished_at = Some(started.started_at + 2);
    assert_rejected(
        &submit(&agent_b, &action(&cancelled, Some(&head_id))).await,
        "only the employee that started this worker",
    );
    let (_, unchanged): (String, WorkerRunHead) =
        current_head(&owner, KIND_WORKER_RUN_HEAD, &tag).await;
    assert_eq!(unchanged.run.status, WorkerStatus::Running);

    // Someone who is neither a member nor a managed employee cannot write at all.
    let outsider_id = Uuid::new_v4().to_string();
    let response = submit(
        &stranger,
        &action(&running_run(&outsider_id, &stranger), None),
    )
    .await;
    rejection_message(&response);
}

#[tokio::test]
#[ignore]
async fn worker_record_never_appears_in_team_list() {
    let owner = Keys::generate();
    let agent = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_managed_agent(&agent, &owner).await;

    async fn team_heads(owner: &Keys) -> Vec<String> {
        let mut tags: Vec<String> = read_events(
            owner,
            Filter::new().kind(Kind::Custom(KIND_MEMBER_POSITION_HEAD as u16)),
        )
        .await
        .iter()
        .flat_map(|event| {
            event
                .tags
                .iter()
                .filter(|tag| tag.kind().to_string() == "d")
                .filter_map(|tag| tag.content().map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect();
        tags.sort();
        tags
    }
    async fn identity_rows() -> (i64, i64) {
        let community_id = ensure_test_community(&relay_authority()).await;
        let pool = pool().await;
        let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE community_id = $1")
            .bind(community_id)
            .fetch_one(&pool)
            .await
            .expect("count users");
        let members: i64 =
            sqlx::query_scalar("SELECT count(*) FROM relay_members WHERE community_id = $1")
                .bind(community_id)
                .fetch_one(&pool)
                .await
                .expect("count relay members");
        (users, members)
    }

    let team_before = team_heads(&owner).await;
    let rows_before = identity_rows().await;

    let worker_id = Uuid::new_v4().to_string();
    let started = running_run(&worker_id, &agent);
    assert_accepted(&submit(&agent, &action(&started, None)).await);
    let tag = worker_d_tag(&worker_id).expect("worker d-tag");
    let (head_id, _): (String, WorkerRunHead) =
        current_head(&owner, KIND_WORKER_RUN_HEAD, &tag).await;
    assert_accepted(&submit(&agent, &action(&done_run(&started), Some(&head_id))).await);

    let team_after = team_heads(&owner).await;
    assert_eq!(
        team_before, team_after,
        "worker records must not change the team list"
    );
    assert!(
        team_after.iter().all(|tag| !tag.contains(&worker_id)),
        "no team entry may name a worker"
    );
    assert_eq!(
        rows_before,
        identity_rows().await,
        "a worker record creates no user or member"
    );
}
