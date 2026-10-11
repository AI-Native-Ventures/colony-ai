//! Company business profile and team computer relay integration tests.
//!
//! These tests exercise the company singleton brokers and require a local
//! relay, Postgres, and Redis. They are selected by the hosted relay E2E lane.

use std::time::Duration;

use buzz_core::company_profile::{
    BusinessProfile, BusinessProfileAction, BUSINESS_PROFILE_D_TAG, BUSINESS_PROFILE_REVISION_TAG,
};
use buzz_core::kind::{KIND_BUSINESS_PROFILE_ACTION, KIND_BUSINESS_PROFILE_HEAD};
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
}
