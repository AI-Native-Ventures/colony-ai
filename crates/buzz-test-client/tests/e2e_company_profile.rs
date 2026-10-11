//! Company business profile and team computer relay integration tests.
//!
//! These tests exercise the company singleton brokers and require a local
//! relay, Postgres, and Redis. They are selected by the hosted relay E2E lane.

use std::time::Duration;

use buzz_core::company_profile::{
    BusinessProfile, BusinessProfileAction, BUSINESS_PROFILE_D_TAG, BUSINESS_PROFILE_REVISION_TAG,
};
use buzz_core::kind::{
    KIND_BUSINESS_PROFILE_ACTION, KIND_BUSINESS_PROFILE_HEAD, KIND_TEAM_COMPUTER_HEAD,
};
use buzz_core::team_computer::{
    TeamComputerAction, TeamComputerActionKind, TeamComputerHead, TEAM_COMPUTER_D_TAG,
};
use buzz_test_client::BuzzTestClient;
use nostr::{Alphabet, Event, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag};
use serde_json::Value;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "company profile E2E tests only send events to a local relay"
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

async fn query_one(keys: &Keys, kind: u32, d_tag: &str) -> Option<Event> {
    let mut client = BuzzTestClient::connect(&relay_url(), keys)
        .await
        .expect("connect to read a company singleton");
    let sub_id = format!("e2e-company-singleton-{}", Uuid::new_v4());
    let filter = Filter::new()
        .kind(Kind::Custom(kind as u16))
        .custom_tags(SingleLetterTag::lowercase(Alphabet::D), [d_tag]);
    client
        .subscribe(&sub_id, vec![filter])
        .await
        .expect("subscribe company singleton");
    let events = client
        .collect_until_eose(&sub_id, Duration::from_secs(10))
        .await
        .expect("read company singleton");
    client
        .disconnect()
        .await
        .expect("disconnect singleton query");
    events.into_iter().next()
}

fn sample_profile(name: &str) -> BusinessProfile {
    serde_json::from_value(serde_json::json!({
        "schemaVersion": 1,
        "name": name,
        "whatYouSell": "Women's clothing in natural linen and cotton, made in Johannesburg.",
        "whoBuys": "Women aged 25 to 45 who like local, made-to-last clothing.",
        "whereYouSell": ["instagram", "website", "markets"],
        "city": "Johannesburg",
        "country": "South Africa",
        "timeZone": "Africa/Johannesburg",
        "links": ["https://leratodesigns.co.za"],
        "voiceWords": ["warm", "confident", "local"],
        "goals": ["More sales"],
        "contact": { "email": "hello@leratodesigns.co.za", "phone": null, "whatsapp": null, "address": null },
        "buyLink": null,
        "invoice": { "registeredName": null, "registrationNumber": null, "vatNumber": null, "bankDetails": null },
        "socialAccounts": { "instagram": "leratodesigns", "facebook": null, "tiktok": null, "linkedin": null, "x": null }
    }))
    .expect("sample profile matches the contract")
}

async fn submit_profile(
    keys: &Keys,
    profile: BusinessProfile,
    expected_revision: Option<u32>,
) -> Value {
    let action = BusinessProfileAction {
        profile,
        expected_revision,
    };
    let event = buzz_sdk::company_profile::build_business_profile_action(&action)
        .expect("build profile action")
        .tag(
            Tag::parse(["test_id", Uuid::new_v4().to_string().as_str()])
                .expect("unique test action tag"),
        )
        .sign_with_keys(keys)
        .expect("sign profile action");
    post_event(keys, &event).await
}

async fn current_profile(keys: &Keys) -> Option<(u32, BusinessProfile)> {
    query_one(keys, KIND_BUSINESS_PROFILE_HEAD, BUSINESS_PROFILE_D_TAG)
        .await
        .map(|event| {
            let revision = event
                .tags
                .iter()
                .find(|tag| tag.kind().to_string() == BUSINESS_PROFILE_REVISION_TAG)
                .and_then(|tag| tag.content())
                .and_then(|value| value.parse::<u32>().ok())
                .expect("profile head carries a revision tag");
            let profile = serde_json::from_str(&event.content).expect("parse profile head");
            (revision, profile)
        })
}

async fn post_duplicates_behind_coordinate_lock(
    keys: &Keys,
    event: &Event,
    head_kind: u32,
    d_tag: &str,
) -> (Value, Value) {
    let head = query_one(keys, head_kind, d_tag)
        .await
        .expect("current head before replay");
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&test_database_url())
        .await
        .expect("connect to coordinate blocker database");
    let mut blocker = pool.begin().await.expect("begin coordinate blocker");
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .expect("coordinate blocker process");
    buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut blocker,
        buzz_core::CommunityId::from_uuid(community_id),
        head_kind,
        &head.pubkey.to_bytes(),
        d_tag,
    )
    .await
    .expect("hold the production coordinate lock");

    let launch = || {
        let keys = keys.clone();
        let event = event.clone();
        tokio::spawn(async move { post_event(&keys, &event).await })
    };
    let mut first = launch();
    let mut second = launch();
    let queued = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let waiting: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_stat_activity \
                 WHERE datname = current_database() \
                 AND $1::integer = ANY(pg_blocking_pids(pid))",
            )
            .bind(blocker_pid)
            .fetch_one(&pool)
            .await?;
            if waiting >= 2 {
                return Ok::<(), sqlx::Error>(());
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    blocker
        .rollback()
        .await
        .expect("release coordinate blocker");
    if !matches!(queued, Ok(Ok(()))) {
        first.abort();
        second.abort();
        panic!("both duplicate requests must wait behind the coordinate lock: {queued:?}");
    }
    let joined = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(&mut first, &mut second)
    })
    .await;
    let (first_result, second_result) = match joined {
        Ok(results) => results,
        Err(_) => {
            first.abort();
            second.abort();
            panic!("duplicate requests must complete after the blocker releases");
        }
    };
    pool.close().await;
    (
        first_result.expect("first duplicate request"),
        second_result.expect("second duplicate request"),
    )
}

#[tokio::test]
#[ignore]
async fn business_profile_is_written_by_owners_and_admins_and_read_by_members_and_employees() {
    let owner = Keys::generate();
    let admin = Keys::generate();
    let member = Keys::generate();
    let employee = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&member, "member").await;
    mark_managed_agent(&employee, &owner).await;

    assert_rejected(
        &submit_profile(&member, sample_profile("Member Designs"), None).await,
        "only a company owner or admin",
    );

    let before = current_profile(&owner).await.map(|(revision, _)| revision);
    let malformed_tags = BusinessProfileAction {
        profile: sample_profile("Malformed Tags Designs"),
        expected_revision: before,
    };
    let malformed_tags_event =
        buzz_sdk::company_profile::build_business_profile_action(&malformed_tags)
            .expect("build profile action with fixed d tag")
            .tag(Tag::parse(["d"]).expect("valueless d tag"))
            .sign_with_keys(&owner)
            .expect("sign malformed-tag action");
    assert_rejected(
        &post_event(&owner, &malformed_tags_event).await,
        "exactly one d tag",
    );

    let owner_name = format!("Lerato Designs {}", Uuid::new_v4().simple());
    assert_accepted(&submit_profile(&owner, sample_profile(&owner_name), before).await);
    let (first_revision, first) = current_profile(&owner)
        .await
        .expect("profile head after the owner's write");
    assert_eq!(first_revision, before.map_or(1, |revision| revision + 1));
    assert_eq!(first.name, owner_name);

    assert_rejected(
        &submit_profile(&owner, sample_profile(&owner_name), None).await,
        "already exists",
    );

    let admin_name = format!("Lerato Designs Studio {}", Uuid::new_v4().simple());
    assert_accepted(
        &submit_profile(&admin, sample_profile(&admin_name), Some(first_revision)).await,
    );
    assert_rejected(
        &submit_profile(&owner, sample_profile(&owner_name), Some(first_revision)).await,
        "business profile changed",
    );

    let current_revision = first_revision + 1;
    let mut bad_zone = sample_profile(&owner_name);
    bad_zone.time_zone = "Mars/Olympus".into();
    let invalid = BusinessProfileAction {
        profile: bad_zone,
        expected_revision: Some(current_revision),
    };
    // The SDK refuses invalid profiles, so this one is built by hand.
    let invalid_event = EventBuilder::new(
        Kind::Custom(KIND_BUSINESS_PROFILE_ACTION as u16),
        serde_json::to_string(&invalid).expect("serialize invalid action"),
    )
    .tag(Tag::parse(["d", BUSINESS_PROFILE_D_TAG]).expect("d tag"))
    .sign_with_keys(&owner)
    .expect("sign invalid action");
    assert_rejected(&post_event(&owner, &invalid_event).await, "timeZone");

    for reader in [&member, &employee] {
        let (revision, profile) = current_profile(reader)
            .await
            .expect("members and employees read the profile");
        assert_eq!(revision, current_revision);
        assert_eq!(profile.name, admin_name);
    }

    let replayed_name = format!("Replay Designs {}", Uuid::new_v4().simple());
    let replayed =
        buzz_sdk::company_profile::build_business_profile_action(&BusinessProfileAction {
            profile: sample_profile(&replayed_name),
            expected_revision: Some(current_revision),
        })
        .expect("build replayed profile action")
        .sign_with_keys(&owner)
        .expect("sign replayed profile action");
    let (first, second) = post_duplicates_behind_coordinate_lock(
        &owner,
        &replayed,
        KIND_BUSINESS_PROFILE_HEAD,
        BUSINESS_PROFILE_D_TAG,
    )
    .await;
    assert_accepted(&first);
    assert_accepted(&second);
    let (revision, profile) = current_profile(&owner).await.expect("profile after replay");
    assert_eq!(
        revision,
        current_revision + 1,
        "a replay advances the head once"
    );
    assert_eq!(profile.name, replayed_name);
}

fn computer_action(
    action: TeamComputerActionKind,
    computer_id: &str,
    computer_name: &str,
    force: bool,
) -> TeamComputerAction {
    TeamComputerAction {
        action,
        computer_id: computer_id.to_owned(),
        computer_name: computer_name.to_owned(),
        force,
    }
}

async fn submit_computer(keys: &Keys, action: TeamComputerAction) -> Value {
    let event = buzz_sdk::team_computer::build_team_computer_action(&action)
        .expect("build team computer action")
        .tag(
            Tag::parse(["test_id", Uuid::new_v4().to_string().as_str()])
                .expect("unique action tag"),
        )
        .sign_with_keys(keys)
        .expect("sign team computer action");
    post_event(keys, &event).await
}

async fn current_team_computer(keys: &Keys) -> TeamComputerHead {
    let event = query_one(keys, KIND_TEAM_COMPUTER_HEAD, TEAM_COMPUTER_D_TAG)
        .await
        .expect("a team computer head exists");
    serde_json::from_str(&event.content).expect("parse team computer head")
}

#[tokio::test]
#[ignore]
async fn team_computer_has_one_holder_heartbeats_releases_and_moves_by_force() {
    use TeamComputerActionKind::{Claim, Heartbeat, Release};

    let owner = Keys::generate();
    let admin = Keys::generate();
    let member = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&admin, "admin").await;
    seed_relay_member(&member, "member").await;
    let laptop = Uuid::new_v4().to_string();
    let desktop = Uuid::new_v4().to_string();
    let laptop_name = "Lerato's MacBook Air";
    let desktop_name = "Kagiso's laptop";

    // A forced claim gives every run a known starting point on the shared community.
    assert_accepted(
        &submit_computer(&owner, computer_action(Claim, &laptop, laptop_name, true)).await,
    );
    let head = current_team_computer(&owner).await;
    assert_eq!(head.computer_id, laptop);
    assert_eq!(head.claimed_by, owner.public_key().to_hex());
    assert_eq!(head.released_at, None);

    assert_rejected(
        &submit_computer(
            &admin,
            computer_action(Claim, &desktop, desktop_name, false),
        )
        .await,
        "the team runs on Lerato's MacBook Air",
    );
    assert_rejected(
        &submit_computer(
            &member,
            computer_action(Claim, &desktop, "Member laptop", true),
        )
        .await,
        "only a company owner or admin",
    );
    assert_accepted(
        &submit_computer(&owner, computer_action(Claim, &laptop, laptop_name, false)).await,
    );
    assert_rejected(
        &submit_computer(
            &owner,
            computer_action(Heartbeat, &laptop, laptop_name, false),
        )
        .await,
        "rate-limited",
    );
    assert_rejected(
        &submit_computer(
            &admin,
            computer_action(Heartbeat, &desktop, desktop_name, false),
        )
        .await,
        "only the computer that runs the team",
    );

    let before_heartbeat = query_one(&owner, KIND_TEAM_COMPUTER_HEAD, TEAM_COMPUTER_D_TAG)
        .await
        .expect("head before accepted heartbeat");
    let before_heartbeat_head: TeamComputerHead =
        serde_json::from_str(&before_heartbeat.content).expect("parse pre-heartbeat head");
    let wait_secs =
        (before_heartbeat_head.last_seen_at + 60 - chrono::Utc::now().timestamp()).max(0) as u64;
    assert!(
        wait_secs <= 60,
        "the heartbeat wait is bounded to one minute"
    );
    tokio::time::sleep(Duration::from_secs(wait_secs + 1)).await;
    let heartbeat = buzz_sdk::team_computer::build_team_computer_action(&computer_action(
        Heartbeat,
        &laptop,
        laptop_name,
        false,
    ))
    .expect("build accepted heartbeat")
    .sign_with_keys(&owner)
    .expect("sign accepted heartbeat");
    assert_accepted(&post_event(&owner, &heartbeat).await);
    let after_heartbeat = query_one(&owner, KIND_TEAM_COMPUTER_HEAD, TEAM_COMPUTER_D_TAG)
        .await
        .expect("head after accepted heartbeat");
    let after_heartbeat_head: TeamComputerHead =
        serde_json::from_str(&after_heartbeat.content).expect("parse post-heartbeat head");
    assert_ne!(after_heartbeat.id, before_heartbeat.id);
    assert!(after_heartbeat_head.last_seen_at >= before_heartbeat_head.last_seen_at + 60);
    assert_eq!(after_heartbeat_head.computer_id, laptop);
    let community_id = ensure_test_community(&relay_authority()).await;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&test_database_url())
        .await
        .expect("connect to verify heartbeat persistence");
    let heartbeat_stored: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community_id)
    .bind(heartbeat.id.to_bytes().as_slice())
    .fetch_one(&pool)
    .await
    .expect("read heartbeat action persistence");
    assert!(
        !heartbeat_stored,
        "heartbeats only replace the canonical head"
    );
    pool.close().await;

    assert_accepted(
        &submit_computer(&admin, computer_action(Claim, &desktop, desktop_name, true)).await,
    );
    let moved = current_team_computer(&owner).await;
    assert_eq!(moved.computer_id, desktop);
    assert_eq!(moved.claimed_by, admin.public_key().to_hex());

    assert_rejected(
        &submit_computer(
            &owner,
            computer_action(Release, &laptop, laptop_name, false),
        )
        .await,
        "only the computer that runs the team",
    );
    assert_accepted(
        &submit_computer(
            &admin,
            computer_action(Release, &desktop, desktop_name, false),
        )
        .await,
    );
    assert!(current_team_computer(&owner).await.released_at.is_some());

    assert_accepted(
        &submit_computer(&owner, computer_action(Claim, &laptop, laptop_name, false)).await,
    );
    let reclaimed = current_team_computer(&owner).await;
    assert_eq!(reclaimed.computer_id, laptop);
    assert_eq!(reclaimed.released_at, None);

    // Two computers racing for a free team: exactly one wins.
    let release = buzz_sdk::team_computer::build_team_computer_action(&computer_action(
        Release,
        &laptop,
        laptop_name,
        false,
    ))
    .expect("build replayed release")
    .tag(Tag::parse(["test_id", Uuid::new_v4().to_string().as_str()]).expect("unique release"))
    .sign_with_keys(&owner)
    .expect("sign replayed release");
    let (first_release, second_release) = post_duplicates_behind_coordinate_lock(
        &owner,
        &release,
        KIND_TEAM_COMPUTER_HEAD,
        TEAM_COMPUTER_D_TAG,
    )
    .await;
    assert_accepted(&first_release);
    assert_accepted(&second_release);
    assert!(current_team_computer(&owner).await.released_at.is_some());
    let racer_a = Uuid::new_v4().to_string();
    let racer_b = Uuid::new_v4().to_string();
    let (first, second) = tokio::join!(
        submit_computer(&owner, computer_action(Claim, &racer_a, "Racer A", false)),
        submit_computer(&admin, computer_action(Claim, &racer_b, "Racer B", false)),
    );
    let winners = [&first, &second]
        .iter()
        .filter(|response| response["accepted"].as_bool() == Some(true))
        .count();
    assert_eq!(
        winners, 1,
        "exactly one computer may take a free team: {first} {second}"
    );
}
