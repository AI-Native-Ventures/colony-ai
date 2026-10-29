//! Postgres-backed proofs of the production seams of WhatsApp outreach. Meta is never
//! reached: every Graph call goes to [`FakeGraph`].
//!
//! Each test names the guard it depends on; removing that guard makes the test fail.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use axum::routing::get;
use axum::Router;
use chrono::{DateTime, Duration, TimeZone, Utc};
use hmac::{Hmac, KeyInit, Mac};
use nostr::{EventBuilder, Keys, Kind};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use buzz_core::channel::MemberRole;
use buzz_core::kind::{
    KIND_WHATSAPP_BATCH, KIND_WHATSAPP_BATCH_DECISION, KIND_WHATSAPP_SEND_REQUEST,
    KIND_WHATSAPP_SETTINGS,
};
use buzz_core::tenant::{CommunityId, TenantContext};

use super::connect;
use super::graph::{GraphApi, GraphError, PhoneInfo, RemoteTemplate, SendRequest};
use super::sender;
use crate::handlers::ingest::{HttpAuthMethod, IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

const KEK: [u8; 32] = [0x42; 32];
const APP_SECRET: &str = "test-app-secret-not-real";
const TOKEN: &str = "EAAB-test-token-not-real";
const PHONE_ID: &str = "1000001";
const WABA_ID: &str = "2000002";

struct FakeGraph {
    pool: PgPool,
    sends: Mutex<Vec<SendRequest>>,
    verify_token: Mutex<Option<String>>,
    tokens_seen: Mutex<Vec<String>>,
    cleared: AtomicBool,
    sabotage_after_send: AtomicBool,
    reject_token: AtomicBool,
}

impl FakeGraph {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            sends: Mutex::new(Vec::new()),
            verify_token: Mutex::new(None),
            tokens_seen: Mutex::new(Vec::new()),
            cleared: AtomicBool::new(false),
            sabotage_after_send: AtomicBool::new(false),
            reject_token: AtomicBool::new(false),
        }
    }

    fn send_count(&self) -> usize {
        self.sends.lock().expect("sends lock").len()
    }

    fn verify_token(&self) -> String {
        self.verify_token
            .lock()
            .expect("verify token lock")
            .clone()
            .expect("connect set the webhook override")
    }
}

#[async_trait]
impl GraphApi for FakeGraph {
    async fn get_phone_info(
        &self,
        token: &str,
        _phone_number_id: &str,
    ) -> Result<PhoneInfo, GraphError> {
        self.tokens_seen
            .lock()
            .expect("tokens lock")
            .push(token.to_string());
        if self.reject_token.load(Ordering::SeqCst) {
            return Err(GraphError::Rejected {
                http_status: 401,
                code: Some(190),
                message: "invalid token".into(),
            });
        }
        Ok(PhoneInfo {
            display_phone_number: Some("+27 82 000 0000".into()),
            verified_name: Some("Horizon Labs".into()),
            quality_rating: Some("GREEN".into()),
            status: Some("CONNECTED".into()),
        })
    }

    async fn set_webhook_override(
        &self,
        _token: &str,
        _phone_number_id: &str,
        _callback_uri: &str,
        verify_token: &str,
    ) -> Result<(), GraphError> {
        *self.verify_token.lock().expect("verify token lock") = Some(verify_token.to_string());
        Ok(())
    }

    async fn clear_webhook_override(
        &self,
        _token: &str,
        _phone_number_id: &str,
    ) -> Result<(), GraphError> {
        self.cleared.store(true, Ordering::SeqCst);
        Ok(())
    }

    async fn subscribe_app(&self, _token: &str, _waba_id: &str) -> Result<(), GraphError> {
        Ok(())
    }

    async fn list_templates(
        &self,
        _token: &str,
        _waba_id: &str,
    ) -> Result<Vec<RemoteTemplate>, GraphError> {
        Ok(vec![RemoteTemplate {
            name: "intro".into(),
            language: "en".into(),
            category: "MARKETING".into(),
            status: "APPROVED".into(),
            body: "Hi {{1}}, it is Sam from Horizon Labs.".into(),
            buttons: json!([{"type": "QUICK_REPLY", "text": "Not interested"}]),
        }])
    }

    async fn send(
        &self,
        _token: &str,
        _phone_number_id: &str,
        request: &SendRequest,
    ) -> Result<String, GraphError> {
        let wamid = {
            let mut sends = self.sends.lock().expect("sends lock");
            sends.push(request.clone());
            format!("wamid.FAKE{}", sends.len())
        };
        if self.sabotage_after_send.load(Ordering::SeqCst) {
            // The relay "crashes" after Graph accepted the message and before it could record
            // the answer: the lease the record needs is gone.
            sqlx::query("UPDATE whatsapp_messages SET lease_token = gen_random_uuid() WHERE state = 'sending'")
                .execute(&self.pool)
                .await
                .expect("sabotage the send record");
        }
        Ok(wamid)
    }
}

struct Fixture {
    state: Arc<AppState>,
    pool: PgPool,
    tenant: TenantContext,
    host: String,
    graph: Arc<FakeGraph>,
    owner: Keys,
}

async fn fixture() -> Fixture {
    let mut config = crate::config::Config::from_env().expect("test relay config");
    let database_url = crate::test_support::database_url();
    config.database_url = database_url.clone();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_owned());
    config.require_relay_membership = false;
    config.accounts = crate::config::AccountConfig::test_config(Some(KEK), None, vec![], None);
    let host = format!("whatsapp-test-{}.example", Uuid::new_v4().simple());
    config.relay_url = format!("wss://{host}");

    let pool = PgPool::connect(&database_url)
        .await
        .expect("connect whatsapp test Postgres");
    if !matches!(
        std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(),
        Ok("desired")
    ) {
        buzz_db::migration::run_migrations(&pool)
            .await
            .expect("apply whatsapp test schema");
    }
    let community_id = Uuid::new_v4();
    sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
        .bind(community_id)
        .bind(&host)
        .execute(&pool)
        .await
        .expect("insert whatsapp test community");
    let db = buzz_db::Db::from_pool(pool.clone());
    let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("whatsapp test Redis pool");
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
            .await
            .expect("whatsapp test pubsub"),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media_storage =
        buzz_media::MediaStorage::new(&config.media).expect("whatsapp test media config");
    let (mut state, _audit_shutdown) = AppState::new(
        config,
        db,
        redis_pool,
        None::<buzz_audit::AuditService>,
        pubsub,
        auth,
        search,
        workflow_engine,
        Keys::generate(),
        media_storage,
    );
    let graph = Arc::new(FakeGraph::new(pool.clone()));
    state.whatsapp_graph = graph.clone();
    let state = Arc::new(state);

    let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host.clone());
    let owner = Keys::generate();
    state
        .db
        .add_relay_member(
            tenant.community(),
            &owner.public_key().to_hex(),
            "owner",
            None,
        )
        .await
        .expect("owner is a relay member");
    let input = connect::validate_input(TOKEN, PHONE_ID, WABA_ID, APP_SECRET).expect("valid input");
    connect::connect(&state, &tenant, &owner.public_key(), input)
        .await
        .expect("connect the fake number");
    Fixture {
        state,
        pool,
        tenant,
        host,
        graph,
        owner,
    }
}

impl Fixture {
    fn community(&self) -> CommunityId {
        self.tenant.community()
    }

    async fn connection_id(&self) -> Uuid {
        self.state
            .db
            .whatsapp_get_connection(self.community())
            .await
            .expect("connection lookup")
            .expect("connected")
            .id
    }

    async fn outreach_channel(&self) -> Uuid {
        self.state
            .db
            .whatsapp_ensure_settings(self.community())
            .await
            .expect("settings")
            .outreach_channel_id
            .expect("connect created the Outreach channel")
    }

    async fn command(
        &self,
        keys: &Keys,
        kind: u32,
        content: Value,
    ) -> Result<IngestResult, IngestError> {
        let event = EventBuilder::new(Kind::Custom(kind as u16), content.to_string())
            .sign_with_keys(keys)
            .expect("sign command");
        let auth = IngestAuth::Http {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            auth_method: HttpAuthMethod::DevPubkey,
        };
        crate::handlers::whatsapp_commands::handle(&self.tenant, &self.state, event, auth).await
    }

    async fn run_sender(&self, now: DateTime<Utc>) {
        sender::process_community(&self.state, self.community(), now)
            .await
            .expect("sender pass");
    }

    fn webhook_router(&self) -> Router {
        Router::new()
            .route(
                "/hooks/whatsapp/{id}",
                get(crate::api::whatsapp::webhook_verify)
                    .post(crate::api::whatsapp::webhook_receive),
            )
            .with_state(self.state.clone())
    }

    async fn deliver(&self, secret: &str, body: &str) -> StatusCode {
        let id = self.connection_id().await;
        let request = Request::builder()
            .method("POST")
            .uri(format!("/hooks/whatsapp/{id}"))
            .header(header::HOST, &self.host)
            .header("x-hub-signature-256", signature(secret, body.as_bytes()))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_owned()))
            .expect("webhook request");
        self.webhook_router()
            .oneshot(request)
            .await
            .expect("webhook response")
            .status()
    }

    async fn thread(&self, wa_id: &str) -> Vec<buzz_db::whatsapp::WhatsappMessage> {
        self.state
            .db
            .whatsapp_list_thread(self.community(), wa_id, 50)
            .await
            .expect("thread")
    }
}

fn signature(secret: &str, body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(body);
    format!("sha256={}", hex::encode(mac.finalize().into_bytes()))
}

fn inbound(from: &str, wamid: &str, text: &str) -> String {
    json!({"object": "whatsapp_business_account", "entry": [{"id": WABA_ID, "changes": [{
    "field": "messages",
    "value": {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "27820000000", "phone_number_id": PHONE_ID},
        "contacts": [{"profile": {"name": "Thabo"}, "wa_id": from}],
        "messages": [{"from": from, "id": wamid, "timestamp": Utc::now().timestamp().to_string(),
                      "type": "text", "text": {"body": text}}]
    }}]}]})
    .to_string()
}

fn batch(batch_id: Uuid, numbers: &[&str]) -> Value {
    json!({
        "v": 1,
        "batchId": batch_id.to_string(),
        "template": "intro",
        "language": "en",
        "rows": numbers.iter().map(|n| json!({"to": n, "params": ["Thabo"]})).collect::<Vec<_>>(),
    })
}

fn base() -> DateTime<Utc> {
    // 12:00 in Johannesburg.
    Utc.with_ymd_and_hms(2026, 10, 29, 10, 0, 0)
        .single()
        .expect("time")
}

fn rejection(result: Result<IngestResult, IngestError>) -> String {
    match result.err() {
        Some(IngestError::Rejected(reason)) => reason,
        Some(other) => panic!("expected a rejection, got {other:?}"),
        None => panic!("expected a rejection, the command was accepted"),
    }
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn webhook_checks_the_signature_answers_the_challenge_and_dedupes() {
    let fx = fixture().await;
    let id = fx.connection_id().await;
    let verify_token = fx.graph.verify_token();
    let router = fx.webhook_router();

    // Challenge: only the stored verify token gets the challenge back.
    let challenge = |token: &str| {
        Request::builder()
            .method("GET")
            .uri(format!(
                "/hooks/whatsapp/{id}?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=abc123"
            ))
            .header(header::HOST, &fx.host)
            .body(Body::empty())
            .expect("challenge request")
    };
    let wrong = router
        .clone()
        .oneshot(challenge("wrong"))
        .await
        .expect("response");
    assert_eq!(wrong.status(), StatusCode::FORBIDDEN);
    let right = router
        .clone()
        .oneshot(challenge(&verify_token))
        .await
        .expect("response");
    assert_eq!(right.status(), StatusCode::OK);
    let body = to_bytes(right.into_body(), 1024).await.expect("body");
    assert_eq!(&body[..], b"abc123");

    // GUARD: `verify_signature` in api/whatsapp.rs `webhook_receive`. Without it the bad
    // signature below is accepted and stores a message.
    let payload = inbound("27821230001", "wamid.IN1", "Hello there");
    assert_eq!(
        fx.deliver("not-the-app-secret", &payload).await,
        StatusCode::UNAUTHORIZED
    );
    assert!(
        fx.thread("27821230001").await.is_empty(),
        "an unsigned payload must store nothing"
    );

    assert_eq!(fx.deliver(APP_SECRET, &payload).await, StatusCode::OK);
    let stored = fx.thread("27821230001").await;
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].body, "Hello there");
    assert!(
        stored[0].event_id.is_some(),
        "the message is mirrored into the Outreach thread"
    );

    // GUARD: `ON CONFLICT (community_id, wamid) DO NOTHING` in `whatsapp_insert_inbound`.
    // Meta redelivers; the same WhatsApp message id must not become a second message.
    assert_eq!(fx.deliver(APP_SECRET, &payload).await, StatusCode::OK);
    assert_eq!(fx.thread("27821230001").await.len(), 1);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_stop_word_opts_the_contact_out_and_later_sends_are_refused() {
    let fx = fixture().await;
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230002", "wamid.IN2", "STOP."))
            .await,
        StatusCode::OK
    );
    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), "27821230002")
        .await
        .expect("contact")
        .expect("exists");
    assert!(contact.opted_out_at.is_some());

    // GUARD: the opted_out check in `sender::check_send`. The inbound message opened the
    // 24 hour window, so without the guard this free text would be queued.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_SEND_REQUEST,
            json!({"v": 1, "requestId": Uuid::new_v4().to_string(), "to": "+27821230002", "text": "one more thing"}),
        )
        .await,
    );
    assert!(refusal.contains("opted out"), "{refusal}");

    // GUARD: `row_refusal` in whatsapp_commands.rs for batches.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_BATCH,
            batch(Uuid::new_v4(), &["+27821230002"]),
        )
        .await,
    );
    assert!(refusal.contains("opted out"), "{refusal}");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_redelivered_stop_still_opts_out_after_a_half_finished_first_delivery() {
    let fx = fixture().await;
    // The first delivery died right after the message row was stored: no window, no
    // opt-out, no Colony post.
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), "27821230004", Some("Thabo"))
        .await
        .expect("contact");
    fx.state
        .db
        .whatsapp_insert_inbound(
            fx.community(),
            "27821230004",
            "text",
            "stop",
            "wamid.IN4",
            Utc::now(),
        )
        .await
        .expect("half stored message");

    // GUARD: the stop-word check in `inbound::handle_message` runs on every delivery, not only
    // the first. If it only ran for a newly stored message the opt-out would be lost for good.
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230004", "wamid.IN4", "stop"))
            .await,
        StatusCode::OK
    );
    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), "27821230004")
        .await
        .expect("contact")
        .expect("exists");
    assert!(
        contact.opted_out_at.is_some(),
        "the redelivered stop opts the contact out"
    );
    assert!(
        contact.last_inbound_at.is_some(),
        "the redelivery opens the window"
    );
    let stored = fx.thread("27821230004").await;
    assert_eq!(stored.len(), 1);
    assert!(
        stored[0].event_id.is_some(),
        "the redelivery finishes the Colony post"
    );
}

fn button_tap(from: &str, wamid: &str, title: &str) -> String {
    json!({"object": "whatsapp_business_account", "entry": [{"id": WABA_ID, "changes": [{
    "field": "messages",
    "value": {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "27820000000", "phone_number_id": PHONE_ID},
        "contacts": [{"profile": {"name": "Naledi"}, "wa_id": from}],
        "messages": [{"from": from, "id": wamid, "timestamp": Utc::now().timestamp().to_string(),
                      "type": "button", "button": {"text": title, "payload": "x"}}]
    }}]}]})
    .to_string()
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_button_tap_is_the_reply_and_not_interested_opts_out() {
    let fx = fixture().await;
    // The synced template keeps its quick-reply button.
    let templates = fx
        .state
        .db
        .whatsapp_list_templates(fx.community())
        .await
        .expect("templates");
    assert_eq!(templates[0].buttons[0]["text"], "Not interested");

    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &button_tap("27821230005", "wamid.IN5", "Tell me more")
        )
        .await,
        StatusCode::OK
    );
    let after_tap = fx.thread("27821230005").await;
    assert_eq!(after_tap.len(), 1);
    assert_eq!(
        after_tap[0].body, "Tell me more",
        "the tapped button is the reply text"
    );
    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), "27821230005")
        .await
        .expect("c")
        .expect("exists");
    assert!(contact.opted_out_at.is_none() && contact.last_inbound_at.is_some());

    // GUARD: `is_opt_out_button` in `inbound::handle_message`. Without it the tap is only text.
    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &button_tap("27821230006", "wamid.IN6", "Not interested")
        )
        .await,
        StatusCode::OK
    );
    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), "27821230006")
        .await
        .expect("c")
        .expect("exists");
    assert!(
        contact.opted_out_at.is_some(),
        "Not interested opts the contact out"
    );
    assert_eq!(fx.thread("27821230006").await[0].body, "Not interested");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn template_titles_default_from_the_body_rename_and_survive_sync() {
    let fx = fixture().await;
    let list = || async {
        fx.state
            .db
            .whatsapp_list_templates(fx.community())
            .await
            .expect("templates")
    };
    let first = list().await;
    assert_eq!(first[0].name, "intro");
    assert_eq!(
        first[0].title, "Hi it is Sam from Horizon",
        "default title comes from the body"
    );
    assert!(!first[0].title_custom);

    let agent = Keys::generate();
    fx.state
        .db
        .add_member(
            fx.community(),
            fx.outreach_channel().await,
            &agent.public_key().to_bytes(),
            MemberRole::Member,
            Some(&fx.owner.public_key().to_bytes()),
        )
        .await
        .expect("agent joins Outreach");
    let title = |value: &str, propose: bool| json!({"v": 1, "templateTitle": {"template": "intro", "title": value, "propose": propose}});

    // An agent can only propose.
    fx.command(&agent, KIND_WHATSAPP_SETTINGS, title("Intro offer", true))
        .await
        .expect("agent proposes");
    let proposed = list().await;
    assert_eq!(
        proposed[0].title, "Hi it is Sam from Horizon",
        "a proposal changes nothing"
    );
    assert_eq!(proposed[0].proposed_title.as_deref(), Some("Intro offer"));
    // GUARD: the owner or admin check in `handle_settings` for a rename (propose = false).
    let refusal = rejection(
        fx.command(&agent, KIND_WHATSAPP_SETTINGS, title("Mine now", false))
            .await,
    );
    assert!(refusal.contains("only the owner or an admin"), "{refusal}");

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SETTINGS,
        title("Intro offer", false),
    )
    .await
    .expect("owner renames");
    let renamed = list().await;
    assert_eq!(renamed[0].title, "Intro offer");
    assert!(renamed[0].title_custom && renamed[0].proposed_title.is_none());

    // GUARD: `CASE WHEN whatsapp_templates.title_custom` in `whatsapp_replace_templates`.
    // A later sync must not overwrite the owner's title with the default.
    connect::sync_templates(&fx.state, &fx.tenant)
        .await
        .expect("resync");
    assert_eq!(list().await[0].title, "Intro offer");

    // Agents can use the title; the Meta name stays the send key.
    let created = fx
        .command(
            &fx.owner,
            KIND_WHATSAPP_BATCH,
            json!({"v": 1, "batchId": Uuid::new_v4().to_string(), "template": "Intro offer", "language": "en",
                   "rows": [{"to": "+27820000011", "params": ["Thabo"]}]}),
        )
        .await
        .expect("a batch by title");
    assert!(
        created.message.starts_with("pending approval"),
        "{}",
        created.message
    );
    let rows: Vec<String> = sqlx::query_scalar("SELECT template_name FROM whatsapp_messages WHERE community_id = $1 AND batch_id IS NOT NULL")
        .bind(fx.community().as_uuid())
        .fetch_all(&fx.pool)
        .await
        .expect("rows");
    assert_eq!(
        rows,
        vec!["intro".to_string()],
        "the row keeps the Meta name as its send key"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn free_text_needs_the_window_and_never_two_messages_in_a_row() {
    let fx = fixture().await;
    let text = |to: &str, body: &str| json!({"v": 1, "requestId": Uuid::new_v4().to_string(), "to": to, "text": body});
    // No inbound message yet: the window is closed.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_SEND_REQUEST,
            text("+27821230003", "hi"),
        )
        .await,
    );
    assert!(refusal.contains("24 hour window"), "{refusal}");

    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230003", "wamid.IN3", "Hello"))
            .await,
        StatusCode::OK
    );
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SEND_REQUEST,
        text("+27821230003", "Hi Thabo"),
    )
    .await
    .expect("inside the window the text is queued");

    // GUARD: `whatsapp_count_pending_outbound` in `enqueue_send`.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_SEND_REQUEST,
            text("+27821230003", "Again"),
        )
        .await,
    );
    assert!(refusal.contains("one message at a time"), "{refusal}");

    fx.run_sender(Utc::now()).await;
    assert_eq!(fx.graph.send_count(), 1);
    let sent = fx.thread("27821230003").await;
    assert!(sent
        .iter()
        .any(|m| m.direction == "out" && m.state == "sent"));
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn pending_batch_never_sends_and_approved_rows_are_paced_capped_and_roll_over() {
    let fx = fixture().await;
    let agent = Keys::generate();
    let batch_id = Uuid::new_v4();
    let numbers = ["+27820000001", "+27820000002", "+27820000003"];

    // An agent that is not in the Outreach channel cannot prepare batches.
    let refusal = rejection(
        fx.command(&agent, KIND_WHATSAPP_BATCH, batch(batch_id, &numbers))
            .await,
    );
    assert!(
        refusal.contains("only the owner, admins and Outreach members"),
        "{refusal}"
    );

    fx.state
        .db
        .add_member(
            fx.community(),
            fx.outreach_channel().await,
            &agent.public_key().to_bytes(),
            MemberRole::Member,
            Some(&fx.owner.public_key().to_bytes()),
        )
        .await
        .expect("owner adds the agent to Outreach");
    let created = fx
        .command(&agent, KIND_WHATSAPP_BATCH, batch(batch_id, &numbers))
        .await
        .expect("a member agent prepares a batch");
    assert!(
        created.message.starts_with("pending approval"),
        "{}",
        created.message
    );

    // GUARD: the worker only reads 'queued' and 'ready' rows (`whatsapp_list_sendable`).
    // A pending batch is 'held'; if held rows were sendable this would send three.
    fx.run_sender(base()).await;
    fx.run_sender(base() + Duration::hours(3)).await;
    assert_eq!(fx.graph.send_count(), 0, "a pending batch must never send");

    // Only the owner or an admin decides.
    let decision =
        |decision: &str| json!({"v": 1, "batchId": batch_id.to_string(), "decision": decision});
    let refusal = rejection(
        fx.command(&agent, KIND_WHATSAPP_BATCH_DECISION, decision("approve"))
            .await,
    );
    assert!(refusal.contains("only the owner or an admin"), "{refusal}");
    fx.run_sender(base()).await;
    assert_eq!(fx.graph.send_count(), 0);

    fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, decision("approve"))
        .await
        .expect("owner approves");

    // Outside 08:00 to 18:00 Johannesburg nothing goes (05:00 SAST).
    fx.run_sender(base() - Duration::hours(7)).await;
    assert_eq!(fx.graph.send_count(), 0, "outside the send window");

    // PACING: one new chat per pass, then a few minutes apart.
    fx.run_sender(base()).await;
    assert_eq!(fx.graph.send_count(), 1);
    fx.run_sender(base()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "the gap since the last new chat has not passed"
    );
    fx.run_sender(base() + Duration::minutes(7)).await;
    assert_eq!(fx.graph.send_count(), 2);

    // CAP: the owner lowers the cap to 2 and the third row waits.
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SETTINGS,
        json!({"v": 1, "dailyNewChatCap": 2}),
    )
    .await
    .expect("owner sets the cap");
    fx.run_sender(base() + Duration::minutes(14)).await;
    assert_eq!(fx.graph.send_count(), 2, "the daily cap of new chats is 2");

    // ROLL-OVER: the unsent row goes out the next day.
    fx.run_sender(base() + Duration::hours(24)).await;
    assert_eq!(fx.graph.send_count(), 3);
    let counts = fx
        .state
        .db
        .whatsapp_complete_finished_batches(fx.community())
        .await
        .expect("finish batches");
    assert_eq!(
        counts,
        vec![batch_id],
        "an approved batch with nothing left is completed"
    );

    // Re-sending the same batch id is a no-op.
    let again = fx
        .command(&agent, KIND_WHATSAPP_BATCH, batch(batch_id, &numbers))
        .await
        .expect("idempotent re-send");
    assert!(again.message.starts_with("duplicate"), "{}", again.message);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_crash_between_the_graph_call_and_the_record_never_sends_twice() {
    let fx = fixture().await;
    let batch_id = Uuid::new_v4();
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH,
        batch(batch_id, &["+27820000009"]),
    )
    .await
    .expect("owner prepares a batch");
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"}),
    )
    .await
    .expect("owner approves");

    fx.graph.sabotage_after_send.store(true, Ordering::SeqCst);
    fx.run_sender(base()).await;
    assert_eq!(fx.graph.send_count(), 1);

    // GUARD: the row is leased ('sending') BEFORE Graph is called and `list_sendable` only
    // returns 'queued' and 'ready'. If the worker re-read the row as sendable this would
    // call Graph a second time.
    fx.run_sender(base() + Duration::minutes(10)).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "a row with an unrecorded answer is not sent again"
    );

    let expired = fx
        .state
        .db
        .whatsapp_expire_leases(base() + Duration::minutes(10))
        .await
        .expect("expire leases");
    let mine: Vec<_> = expired
        .iter()
        .filter(|(community, _)| *community == fx.community())
        .collect();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].1.state, "unconfirmed");
    fx.run_sender(base() + Duration::hours(24)).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "an unconfirmed row is never resent"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn secrets_stay_sealed_and_out_of_every_response() {
    let fx = fixture().await;

    let status = connect::status_view(&fx.state, &fx.tenant)
        .await
        .expect("status")
        .to_string();
    assert!(!status.contains(TOKEN) && !status.contains(APP_SECRET));
    assert!(status.contains("\"connected\":true"));

    let sealed: Vec<u8> =
        sqlx::query_scalar("SELECT sealed_token FROM whatsapp_connections WHERE community_id = $1")
            .bind(fx.community().as_uuid())
            .fetch_one(&fx.pool)
            .await
            .expect("sealed token");
    assert!(!sealed.windows(TOKEN.len()).any(|w| w == TOKEN.as_bytes()));

    let connection = fx
        .state
        .db
        .whatsapp_get_connection(fx.community())
        .await
        .expect("connection")
        .expect("connected");
    let shown = format!("{connection:?}");
    assert!(!shown.contains(TOKEN) && !shown.contains(APP_SECRET));

    // The fake saw the real token (it flowed to Graph) but nothing else did.
    assert!(fx
        .graph
        .tokens_seen
        .lock()
        .expect("tokens")
        .iter()
        .all(|t| t == TOKEN));

    // Disconnect removes the override and deletes the sealed secrets.
    connect::disconnect(&fx.state, &fx.tenant)
        .await
        .expect("disconnect");
    assert!(fx.graph.cleared.load(Ordering::SeqCst));
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM whatsapp_connections WHERE community_id = $1")
            .bind(fx.community().as_uuid())
            .fetch_one(&fx.pool)
            .await
            .expect("count");
    assert_eq!(remaining, 0, "the secrets are deleted on disconnect");

    // A refused token never shows up in the error.
    fx.graph.reject_token.store(true, Ordering::SeqCst);
    let input = connect::validate_input(TOKEN, PHONE_ID, WABA_ID, APP_SECRET).expect("input");
    let error = connect::connect(&fx.state, &fx.tenant, &fx.owner.public_key(), input)
        .await
        .expect_err("rejected token");
    assert_eq!(error.code(), "whatsapp_token_rejected");
    assert!(!error.message().contains(TOKEN));
}
