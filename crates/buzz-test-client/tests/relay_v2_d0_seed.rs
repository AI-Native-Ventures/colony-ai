//! D0 seed: one open stream channel + relay member + kind-9 event on the
//! disposable relay, through its public Nostr surface only.
//! Prints one `D0_SEED CHANNEL_ID=<uuid>` line on success.
//!
//! Env: RELAY_URL (ws:// disposable), DATABASE_URL (seed SQL),
//! SEED_NSEC (disposable member identity, hex).

use std::time::Duration;

use buzz_test_client::BuzzTestClient;
use nostr::{EventBuilder, Keys, Kind, Tag};

fn relay_http_url() -> String {
    std::env::var("RELAY_URL")
        .expect("RELAY_URL")
        .replace("ws://", "http://")
        .replace("wss://", "https://")
        .trim_end_matches('/')
        .to_string()
}

fn relay_authority() -> String {
    let url = url::Url::parse(&relay_http_url()).expect("relay HTTP URL");
    url[url::Position::BeforeHost..url::Position::AfterPort].to_string()
}

#[tokio::test]
#[ignore = "hosted D0 only: needs disposable relay + database"]
async fn d0_seed_disposable_channel() {
    let keys = std::env::var("SEED_NSEC")
        .ok()
        .and_then(|secret| Keys::parse(&secret).ok())
        .expect("SEED_NSEC must be a valid disposable nsec");
    let host = relay_authority();

    // Member row: same shape as e2e_relay.rs seed_relay_member (harmless
    // under open membership; proves the seed path for gated relays).
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL"))
        .await
        .expect("seed pool");
    let community_id: uuid::Uuid =
        sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
            .bind(&host)
            .fetch_one(&pool)
            .await
            .expect("seed community must exist");
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, 'member', NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE SET role = 'member'",
    )
    .bind(community_id)
    .bind(keys.public_key().to_hex())
    .execute(&pool)
    .await
    .expect("seed member");

    // Channel via kind:9007 like e2e create_test_channel.
    let http = reqwest::Client::new();
    let channel_uuid = uuid::Uuid::new_v4();
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags(vec![
            Tag::parse(["h", &channel_uuid.to_string()]).unwrap(),
            Tag::parse(["name", "relay-v2-d0"]).unwrap(),
            Tag::parse(["channel_type", "stream"]).unwrap(),
            Tag::parse(["visibility", "open"]).unwrap(),
        ])
        .sign_with_keys(&keys)
        .unwrap();
    let resp = http
        .post(format!("{}/events", relay_http_url()))
        .header("X-Pubkey", keys.public_key().to_hex())
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(&event).unwrap())
        .send()
        .await
        .expect("create channel");
    // The envelope is not the answer: POST /events returns 200 with a
    // body carrying {event_id, accepted, message}, and a refused event is
    // a successful HTTP request containing a refusal. Read the letter.
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.expect("event response body");
    let accepted = body
        .get("accepted")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    assert!(
        status.is_success() && accepted,
        "channel seed refused: status={status} body={body}"
    );

    // Kind-9 seed event over NIP-42 WS so the helper proof retrieves it
    // from the persisted store, not from any test memory.
    let url = std::env::var("RELAY_URL").expect("RELAY_URL");
    let mut client = BuzzTestClient::connect(&url, &keys)
        .await
        .expect("seed connect");
    let ok = client
        .send_text_message(&keys, &channel_uuid.to_string(), "d0 seed", 9)
        .await
        .expect("seed event");
    assert!(ok.accepted, "seed kind-9 refused: {}", ok.message);
    // Leave the connection open briefly so the relay persists before the
    // proof subscribes; then close.
    tokio::time::sleep(Duration::from_millis(500)).await;

    println!("D0_SEED CHANNEL_ID={channel_uuid}");
}
