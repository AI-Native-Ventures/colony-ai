//! End-to-end tests for cloud agents: the flip, the wake, the home fence and
//! the "exactly one answer" rule, against a live relay.
//!
//! These cases run on the isolated CI relay, which is built with the
//! `test-fakes` feature and started with `COLONY_CLOUD_HOST=fake`: machines are
//! in memory, and every start of a machine leaves a file
//! (`$COLONY_CLOUD_FAKE_DIR/<agent hex>.json`) holding its boot URL and token.
//! The test plays the machine from that file, exactly as the harness does on
//! Fly: trade the boot token for the environment, connect with the home token,
//! answer what is unanswered, and let go.
//!
//! The "stub harness" (`answer_unanswered`) applies the relay-answered rule the
//! real harness uses: a mention counts as answered only when the agent
//! published a reply to it, and only the last 24 hours are looked at.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use buzz_core::agent_placement::{Home, PlacementHead, PlacementOp, PlacementStatus};
use buzz_core::kind::{KIND_AGENT_PLACEMENT_ACTION, KIND_AGENT_PLACEMENT_HEAD};
use buzz_test_client::{BuzzTestClient, TestClientError};
use nostr::{
    Alphabet, EventBuilder, Filter, Keys, Kind, SingleLetterTag, Tag, Timestamp, ToBech32,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

fn relay_url() -> String {
    let url = std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string());
    let parsed = url::Url::parse(&url).expect("RELAY_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1")),
        "cloud agent E2E tests only talk to a local relay"
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

fn fake_host_dir() -> PathBuf {
    std::env::var("COLONY_CLOUD_FAKE_DIR")
        .unwrap_or_else(|_| "/tmp/colony-fake-host".to_string())
        .into()
}

async fn pool() -> sqlx::PgPool {
    let url = std::env::var("BUZZ_TEST_DATABASE_URL")
        .expect("BUZZ_TEST_DATABASE_URL must name a disposable E2E database");
    PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect to E2E Postgres")
}

async fn community_id() -> Uuid {
    let pool = pool().await;
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO communities (id, host) VALUES ($1, $2) ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(id)
    .bind(relay_authority())
    .execute(&pool)
    .await
    .expect("seed E2E community");
    sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
        .bind(relay_authority())
        .fetch_one(&pool)
        .await
        .expect("read E2E community")
}

async fn seed_relay_member(keys: &Keys, role: &str) {
    let community = community_id().await;
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) VALUES ($1, $2, $3, NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE SET role = $3, updated_at = now()",
    )
    .bind(community)
    .bind(keys.public_key().to_hex())
    .bind(role)
    .execute(&pool)
    .await
    .expect("seed relay member");
    sqlx::query(
        "INSERT INTO users (community_id, pubkey) VALUES ($1, $2) \
         ON CONFLICT (community_id, pubkey) DO NOTHING",
    )
    .bind(community)
    .bind(keys.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed user");
}

async fn seed_managed_agent(agent: &Keys, owner: &Keys) {
    let community = community_id().await;
    let pool = pool().await;
    sqlx::query(
        "INSERT INTO users (community_id, pubkey, agent_owner_pubkey) VALUES ($1, $2, $3) \
         ON CONFLICT (community_id, pubkey) DO UPDATE SET agent_owner_pubkey = EXCLUDED.agent_owner_pubkey",
    )
    .bind(community)
    .bind(agent.public_key().to_bytes().as_slice())
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(&pool)
    .await
    .expect("seed managed agent");
}

/// The owner's verified account: cloud sessions are minted for it.
async fn seed_account(owner: &Keys) {
    let pool = pool().await;
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO accounts (id, email, pubkey, email_verified_at, wrapped_dek, kek_id, \
         sealed_nsec, nonce) VALUES ($1, $2, $3, now(), $4, 'test', $5, $6)",
    )
    .bind(id)
    .bind(format!("{}@example.invalid", id.simple()))
    .bind(owner.public_key().to_hex())
    .bind(vec![1u8; 28])
    .bind(vec![2u8; 16])
    .bind(vec![3u8; 12])
    .execute(&pool)
    .await
    .expect("seed owner account");
}

async fn post_event(keys: &Keys, event: &nostr::Event) -> Value {
    reqwest::Client::new()
        .post(format!("{}/events", relay_http_url()))
        .header("X-Pubkey", keys.public_key().to_hex())
        .header("Content-Type", "application/json")
        .body(serde_json::to_string(event).expect("serialize event"))
        .send()
        .await
        .expect("submit event")
        .json()
        .await
        .expect("parse response")
}

fn accepted(response: &Value) -> bool {
    response["accepted"].as_bool().unwrap_or(false)
}

async fn create_channel(owner: &Keys) -> Uuid {
    let channel = Uuid::new_v4();
    let event = EventBuilder::new(Kind::Custom(9007), "")
        .tags([
            Tag::parse(["h", channel.to_string().as_str()]).expect("h"),
            Tag::parse(["name", &format!("cloud-{channel}")]).expect("name"),
            Tag::parse(["channel_type", "stream"]).expect("type"),
            Tag::parse(["visibility", "open"]).expect("visibility"),
        ])
        .sign_with_keys(owner)
        .expect("sign channel create");
    let response = post_event(owner, &event).await;
    assert!(accepted(&response), "channel create refused: {response}");
    channel
}

async fn add_channel_member(owner: &Keys, member: &Keys, channel: Uuid) {
    let event = EventBuilder::new(Kind::Custom(9000), "")
        .allow_self_tagging()
        .tags([
            Tag::parse(["h", channel.to_string().as_str()]).expect("h"),
            Tag::parse(["p", member.public_key().to_hex().as_str()]).expect("p"),
        ])
        .sign_with_keys(owner)
        .expect("sign invite");
    let response = post_event(owner, &event).await;
    assert!(accepted(&response), "channel invite refused: {response}");
}

fn nip98_header(keys: &Keys, url: &str, method: &str, body: &[u8]) -> String {
    let event = EventBuilder::new(Kind::Custom(27_235), "")
        .tags(vec![
            Tag::parse(["u", url]).expect("u"),
            Tag::parse(["method", method]).expect("method"),
            Tag::parse(["payload", &hex::encode(Sha256::digest(body))]).expect("payload"),
            Tag::parse(["nonce", &Uuid::new_v4().to_string()]).expect("nonce"),
        ])
        .sign_with_keys(keys)
        .expect("sign NIP-98");
    format!(
        "Nostr {}",
        BASE64.encode(serde_json::to_string(&event).expect("serialize NIP-98"))
    )
}

/// The owner uploads the agent's key and config so it is cloud-ready.
async fn upload_bundle(owner: &Keys, agent: &Keys) {
    let path = format!("/api/cloud-agents/{}/bundle", agent.public_key().to_hex());
    let url = format!("{}{path}", relay_http_url());
    let body = serde_json::to_vec(&json!({
        "nsec": agent.secret_key().to_bech32().expect("encode nsec"),
        "authTag": null,
        "config": {
            "name": "Scout", "systemPrompt": "Be brief.", "teamInstructions": null,
            "respondTo": "owner-only", "respondToAllowlist": [], "parallelism": 1,
            "idleTimeoutSeconds": null, "maxTurnDurationSeconds": 900,
            "subscribeMode": "mentions", "envVars": {}, "effortLevel": null
        },
        "configVersion": 1
    }))
    .expect("serialize bundle");
    let response = reqwest::Client::new()
        .put(&url)
        .header("Authorization", nip98_header(owner, &url, "PUT", &body))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .expect("upload bundle");
    assert_eq!(
        response.status().as_u16(),
        204,
        "bundle upload refused: {}",
        response.text().await.unwrap_or_default()
    );
}

struct World {
    owner: Keys,
    agent: Keys,
    channel: Uuid,
}

async fn world() -> World {
    let owner = Keys::generate();
    let agent = Keys::generate();
    seed_relay_member(&owner, "owner").await;
    seed_relay_member(&agent, "member").await;
    seed_managed_agent(&agent, &owner).await;
    seed_account(&owner).await;
    let channel = create_channel(&owner).await;
    add_channel_member(&owner, &agent, channel).await;
    upload_bundle(&owner, &agent).await;
    World {
        owner,
        agent,
        channel,
    }
}

/// The agent's current placement head, read as the owner.
async fn head(world: &World) -> Option<PlacementHead> {
    let mut client = BuzzTestClient::connect(&relay_url(), &world.owner)
        .await
        .expect("connect to read the head");
    let sub = format!("head-{}", Uuid::new_v4());
    client
        .subscribe(
            &sub,
            vec![Filter::new()
                .kind(Kind::Custom(KIND_AGENT_PLACEMENT_HEAD as u16))
                .custom_tag(
                    SingleLetterTag::lowercase(Alphabet::D),
                    world.agent.public_key().to_hex(),
                )],
        )
        .await
        .expect("subscribe");
    let events = client
        .collect_until_eose(&sub, Duration::from_secs(10))
        .await
        .expect("read head");
    client.disconnect().await.expect("disconnect");
    events
        .into_iter()
        .max_by_key(|event| event.created_at)
        .map(|event| serde_json::from_str(&event.content).expect("parse head"))
}

async fn generation(world: &World) -> u64 {
    head(world).await.map_or(0, |head| head.generation)
}

async fn set_home(world: &World, home: Home) -> Value {
    let expected = generation(world).await;
    let action = json!({
        "schema": 1,
        "agent": world.agent.public_key().to_hex(),
        "op": serde_json::to_value(PlacementOp::SetHome).expect("op"),
        "home": serde_json::to_value(home).expect("home"),
        "expectedGeneration": expected,
        "cloudModel": null,
    });
    let event = EventBuilder::new(
        Kind::Custom(KIND_AGENT_PLACEMENT_ACTION as u16),
        action.to_string(),
    )
    .tags([Tag::parse(["d", world.agent.public_key().to_hex().as_str()]).expect("d")])
    .sign_with_keys(&world.owner)
    .expect("sign placement command");
    post_event(&world.owner, &event).await
}

async fn mention(world: &World, text: &str) -> String {
    let event = EventBuilder::new(Kind::Custom(9), text)
        .tags([
            Tag::parse(["h", world.channel.to_string().as_str()]).expect("h"),
            Tag::parse(["p", world.agent.public_key().to_hex().as_str()]).expect("p"),
        ])
        .sign_with_keys(&world.owner)
        .expect("sign mention");
    let id = event.id.to_hex();
    let response = post_event(&world.owner, &event).await;
    assert!(accepted(&response), "mention refused: {response}");
    id
}

/// Every channel message of the last day, as seen by the owner.
async fn channel_messages(world: &World, as_keys: &Keys) -> Vec<nostr::Event> {
    let mut client = BuzzTestClient::connect(&relay_url(), as_keys)
        .await
        .expect("connect to read the channel");
    let events = read_channel(&mut client, world).await;
    client.disconnect().await.expect("disconnect");
    events
}

async fn read_channel(client: &mut BuzzTestClient, world: &World) -> Vec<nostr::Event> {
    let sub = format!("chan-{}", Uuid::new_v4());
    client
        .subscribe(
            &sub,
            vec![Filter::new()
                .kind(Kind::Custom(9))
                .custom_tag(
                    SingleLetterTag::lowercase(Alphabet::H),
                    world.channel.to_string(),
                )
                .since(Timestamp::from_secs(
                    Timestamp::now().as_secs().saturating_sub(86_400),
                ))],
        )
        .await
        .expect("subscribe");
    let events = client
        .collect_until_eose(&sub, Duration::from_secs(10))
        .await
        .expect("read channel");
    client.close_subscription(&sub).await.expect("close");
    events
}

fn replied_to(event: &nostr::Event) -> Option<String> {
    event.tags.iter().find_map(|tag| {
        let parts = tag.as_slice();
        (parts.first().map(String::as_str) == Some("e"))
            .then(|| parts.get(1).cloned())
            .flatten()
    })
}

/// What a harness does on start: answer every mention it was sent in the last
/// 24 hours that the agent has not already replied to. A reaction is not an
/// answer, and the harness's own ledger is not consulted: the relay is the
/// record. Returns the ids it answered.
async fn answer_unanswered(client: &mut BuzzTestClient, world: &World, label: &str) -> Vec<String> {
    let agent_hex = world.agent.public_key().to_hex();
    let events = read_channel(client, world).await;
    let answered: HashSet<String> = events
        .iter()
        .filter(|event| event.pubkey == world.agent.public_key())
        .filter_map(replied_to)
        .collect();
    let mut sent = Vec::new();
    for event in events
        .iter()
        .filter(|event| event.pubkey != world.agent.public_key())
    {
        let names_agent = event.tags.iter().any(|tag| {
            let parts = tag.as_slice();
            parts.first().map(String::as_str) == Some("p")
                && parts.get(1).map(String::as_str) == Some(agent_hex.as_str())
        });
        let id = event.id.to_hex();
        if !names_agent || answered.contains(&id) {
            continue;
        }
        let reply = EventBuilder::new(Kind::Custom(9), format!("{label} answers {id}"))
            .tags([
                Tag::parse(["h", world.channel.to_string().as_str()]).expect("h"),
                Tag::parse(["e", id.as_str(), "", "reply"]).expect("e"),
            ])
            .sign_with_keys(&world.agent)
            .expect("sign reply");
        let response = client.send_event(reply).await.expect("send reply");
        assert!(response.accepted, "reply refused: {}", response.message);
        sent.push(id);
    }
    sent
}

/// How many replies the agent published to each mention, over the whole channel.
async fn replies_per_mention(world: &World, mentions: &[String]) -> Vec<usize> {
    let events = channel_messages(world, &world.owner).await;
    mentions
        .iter()
        .map(|id| {
            events
                .iter()
                .filter(|event| event.pubkey == world.agent.public_key())
                .filter(|event| replied_to(event).as_deref() == Some(id.as_str()))
                .count()
        })
        .collect()
}

struct Start {
    boot_url: String,
    boot_token: String,
    start: u64,
}

/// Waits for the fake host to start the agent's machine (a start newer than
/// `after`), the way a real machine would come up.
async fn wait_for_start(world: &World, after: u64) -> Start {
    let file = fake_host_dir().join(format!("{}.json", world.agent.public_key().to_hex()));
    for _ in 0..240 {
        if let Ok(text) = std::fs::read_to_string(&file) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                let start = value["start"].as_u64().unwrap_or(0);
                if start > after {
                    return Start {
                        boot_url: value["bootUrl"].as_str().expect("bootUrl").to_owned(),
                        boot_token: value["bootToken"].as_str().expect("bootToken").to_owned(),
                        start,
                    };
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let status = head(world).await.map(|head| (head.home, head.status));
    panic!("no machine start within 60 s; placement is {status:?}");
}

/// What the harness does first on a cloud machine: trade the boot token for the
/// environment. Returns the status and the parsed body.
async fn redeem(start: &Start) -> (u16, Value) {
    let response = reqwest::Client::new()
        .post(&start.boot_url)
        .header("Authorization", format!("Bearer {}", start.boot_token))
        .send()
        .await
        .expect("call the boot endpoint");
    let status = response.status().as_u16();
    (status, response.json().await.unwrap_or(Value::Null))
}

/// Connects as the agent the way a cloud machine does: home token in the AUTH event.
async fn connect_cloud(world: &World, home_token: &str) -> Result<BuzzTestClient, TestClientError> {
    let mut client = BuzzTestClient::connect_unauthenticated(&relay_url()).await?;
    let tag = Tag::parse(["colony_home", home_token]).expect("home tag");
    client.authenticate_with_nip_oa(&world.agent, &tag).await?;
    Ok(client)
}

/// Connects as the agent the way an app that knows nothing about cloud agents does.
async fn connect_mac(world: &World) -> Result<BuzzTestClient, TestClientError> {
    BuzzTestClient::connect(&relay_url(), &world.agent).await
}

async fn boot_cloud_machine(world: &World, after: u64) -> (BuzzTestClient, Start, Value) {
    let start = wait_for_start(world, after).await;
    let (status, body) = redeem(&start).await;
    assert_eq!(status, 200, "boot refused: {body}");
    let env = body["env"].clone();
    assert_eq!(env["COLONY_HOME"], "cloud");
    let token = env["COLONY_CLOUD_HOME_TOKEN"].as_str().expect("home token");
    let client = connect_cloud(world, token)
        .await
        .expect("the booted machine is let in");
    (client, start, env)
}

#[tokio::test]
#[ignore]
async fn flip_to_cloud_then_mention_is_answered() {
    let world = world().await;
    let flipped = set_home(&world, Home::Cloud).await;
    assert!(accepted(&flipped), "flip refused: {flipped}");
    let placement = head(&world).await.expect("placement head");
    assert_eq!((placement.home, placement.generation), (Home::Cloud, 1));
    assert!(placement.cloud_ready);

    let first = mention(&world, "Scout, are you there?").await;
    let (mut machine, start, _env) = boot_cloud_machine(&world, 0).await;
    assert!(start.start >= 1);
    let answered = answer_unanswered(&mut machine, &world, "cloud").await;
    assert_eq!(answered, vec![first.clone()]);

    // The boot token worked once: the same token is refused the second time.
    let (status, _) = redeem(&start).await;
    assert_eq!(status, 401, "a boot token works once");

    // The machine is working, and one answer exists for the one message.
    assert_eq!(replies_per_mention(&world, &[first]).await, vec![1]);
    let placement = head(&world).await.expect("placement head");
    assert!(matches!(
        placement.status,
        Some(PlacementStatus::Waking | PlacementStatus::Working | PlacementStatus::Asleep)
    ));
    machine.disconnect().await.expect("machine exits");
}

#[tokio::test]
#[ignore]
async fn mention_around_flip_answered_once() {
    let world = world().await;
    // Two mentions while the agent is on the Mac and nothing is running.
    let before_early = mention(&world, "five seconds before").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    let before_late = mention(&world, "one second before").await;

    let flipped = set_home(&world, Home::Cloud).await;
    assert!(accepted(&flipped), "flip refused: {flipped}");
    let after_early = mention(&world, "one second after").await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    let after_late = mention(&world, "five seconds after").await;
    let cloud_mentions = vec![
        before_early.clone(),
        before_late.clone(),
        after_early.clone(),
        after_late.clone(),
    ];

    // The cloud machine answers all four, once each.
    let (mut machine, _start, env) = boot_cloud_machine(&world, 0).await;
    let answered = answer_unanswered(&mut machine, &world, "cloud").await;
    assert_eq!(
        answered.iter().collect::<HashSet<_>>(),
        cloud_mentions.iter().collect::<HashSet<_>>(),
        "every mention around the flip is answered by the new home"
    );
    assert_eq!(answered.len(), 4, "no mention is answered twice");
    assert_eq!(
        replies_per_mention(&world, &cloud_mentions).await,
        vec![1; 4]
    );

    // Flip back to the Mac: the machine is cut off at once and its token is dead.
    let flipped = set_home(&world, Home::Mac).await;
    assert!(accepted(&flipped), "flip back refused: {flipped}");
    let mut cut_off = false;
    for _ in 0..20 {
        match machine.recv_event(Duration::from_millis(500)).await {
            Err(TestClientError::ConnectionClosed | TestClientError::WebSocket(_)) => {
                cut_off = true;
                break;
            }
            _ => {}
        }
    }
    assert!(
        cut_off,
        "the old home's connection is closed when the agent moves"
    );
    let old_token = env["COLONY_CLOUD_HOME_TOKEN"].as_str().expect("home token");
    assert!(
        connect_cloud(&world, old_token).await.is_err(),
        "the old cloud credential buys nothing once the agent is on the Mac"
    );

    // The Mac harness comes back, and only the message it was not around for
    // is unanswered: nothing already answered in the cloud is answered again.
    let next = mention(&world, "back on the Mac").await;
    let mut mac = connect_mac(&world)
        .await
        .expect("the Mac connects as before");
    let answered = answer_unanswered(&mut mac, &world, "mac").await;
    assert_eq!(answered, vec![next.clone()]);
    let mut everything = cloud_mentions;
    everything.push(next);
    assert_eq!(replies_per_mention(&world, &everything).await, vec![1; 5]);
    mac.disconnect().await.expect("mac exits");
}

#[tokio::test]
#[ignore]
async fn old_client_cannot_answer_cloud_agent() {
    let world = world().await;
    let flipped = set_home(&world, Home::Cloud).await;
    assert!(accepted(&flipped), "flip refused: {flipped}");

    // An app that does not know about cloud agents connects as it always did.
    assert!(
        connect_mac(&world).await.is_err(),
        "a connection without the home token must be refused while the agent is in the cloud"
    );
    assert!(
        connect_cloud(&world, &"ab".repeat(32)).await.is_err(),
        "a made-up home token must be refused"
    );

    // Back on the Mac, that same app works again.
    let flipped = set_home(&world, Home::Mac).await;
    assert!(accepted(&flipped), "flip back refused: {flipped}");
    let mac = connect_mac(&world).await.expect("the Mac connects again");
    mac.disconnect().await.expect("disconnect");
}
