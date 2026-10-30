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
    hide_templates: AtomicBool,
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
            hide_templates: AtomicBool::new(false),
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
        if self.hide_templates.load(Ordering::SeqCst) {
            return Ok(Vec::new());
        }
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
async fn agent_messages_are_drafts_the_owner_approves_edits_or_rejects() {
    let fx = fixture().await;
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
    let send = |to: &str, body: &str| json!({"v": 1, "requestId": Uuid::new_v4().to_string(), "to": to, "text": body});
    let decide = |draft: Uuid, decision: &str| json!({"v": 1, "draftId": draft.to_string(), "decision": decision});
    let drafts = || async {
        fx.state
            .db
            .whatsapp_list_drafts(fx.community(), 50)
            .await
            .expect("drafts")
    };

    // The owner typing in Colony is the approval: it is queued and goes out at once.
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230008", "wamid.IN8", "Hello"))
            .await,
        StatusCode::OK
    );
    let owner_send = fx
        .command(
            &fx.owner,
            KIND_WHATSAPP_SEND_REQUEST,
            send("+27821230008", "Owner here"),
        )
        .await
        .expect("owner sends");
    assert!(
        owner_send.message.starts_with("queued"),
        "{}",
        owner_send.message
    );
    fx.run_sender(Utc::now()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "an owner's own message is sent at once"
    );

    // An agent's message is a draft.
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230007", "wamid.IN7", "Hello"))
            .await,
        StatusCode::OK
    );
    let made = fx
        .command(
            &agent,
            KIND_WHATSAPP_SEND_REQUEST,
            send("+27821230007", "Hi Thabo"),
        )
        .await
        .expect("agent drafts");
    assert!(
        made.message.starts_with("draft pending approval"),
        "{}",
        made.message
    );

    // GUARD: `initial_state` in sender.rs and the sender reading only 'queued'/'ready'.
    // If an agent message were queued, this would call Graph.
    fx.run_sender(Utc::now()).await;
    fx.run_sender(Utc::now() + Duration::minutes(30)).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "a pending draft never reaches Graph"
    );
    let pending = drafts().await;
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].state, "draft");
    let draft_id = pending[0].id;
    assert!(
        pending[0].event_id.is_some(),
        "the draft is shown in the contact's thread"
    );

    // GUARD: 'draft' counts as pending in `whatsapp_count_pending_outbound`.
    let refusal = rejection(
        fx.command(
            &agent,
            KIND_WHATSAPP_SEND_REQUEST,
            send("+27821230007", "And another"),
        )
        .await,
    );
    assert!(refusal.contains("one message at a time"), "{refusal}");

    // Only the owner or an admin decides.
    let refusal = rejection(
        fx.command(
            &agent,
            KIND_WHATSAPP_BATCH_DECISION,
            decide(draft_id, "approve"),
        )
        .await,
    );
    assert!(refusal.contains("only the owner or an admin"), "{refusal}");
    fx.run_sender(Utc::now()).await;
    assert_eq!(fx.graph.send_count(), 1);

    // Approve with an edit: the relay sends exactly the edited text, once.
    let mut approve = decide(draft_id, "approve");
    approve["text"] = json!("Hi Thabo, thanks for getting back to us");
    fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, approve)
        .await
        .expect("owner approves with an edit");
    fx.run_sender(Utc::now()).await;
    fx.run_sender(Utc::now()).await;
    assert_eq!(fx.graph.send_count(), 2);
    assert_eq!(
        fx.graph.sends.lock().expect("sends").last(),
        Some(&SendRequest::Text {
            to: "27821230007".into(),
            body: "Hi Thabo, thanks for getting back to us".into()
        })
    );
    // A second decision on the same draft changes nothing.
    let again = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_BATCH_DECISION,
            decide(draft_id, "reject"),
        )
        .await,
    );
    assert!(again.starts_with("duplicate"), "{again}");

    // A rejected draft is never sent.
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230009", "wamid.IN9", "Hello"))
            .await,
        StatusCode::OK
    );
    fx.command(
        &agent,
        KIND_WHATSAPP_SEND_REQUEST,
        send("+27821230009", "Pitch"),
    )
    .await
    .expect("agent drafts again");
    let second = drafts().await;
    assert_eq!(second.len(), 1);
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        decide(second[0].id, "reject"),
    )
    .await
    .expect("owner rejects");
    fx.run_sender(Utc::now() + Duration::minutes(5)).await;
    assert_eq!(fx.graph.send_count(), 2, "a rejected draft is never sent");
    let stored = fx
        .state
        .db
        .whatsapp_get_message(fx.community(), second[0].id)
        .await
        .expect("message")
        .expect("exists");
    assert_eq!(stored.state, "rejected");
    assert!(drafts().await.is_empty());
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn an_outreach_agent_cannot_open_a_new_chat_outside_an_approved_batch() {
    let fx = fixture().await;
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
    let opener = json!({
        "v": 1,
        "requestId": Uuid::new_v4().to_string(),
        "to": "+27821230021",
        "template": {"name": "intro", "language": "en", "params": ["Thabo"]},
    });

    // GUARD: `check_send` refuses a template to a new chat unless the sender is an owner or admin.
    let refusal = rejection(fx.command(&agent, KIND_WHATSAPP_SEND_REQUEST, opener).await);
    assert!(
        refusal.contains("new chats need an approved batch"),
        "{refusal}"
    );
    fx.run_sender(Utc::now()).await;
    assert_eq!(
        fx.graph.send_count(),
        0,
        "a refused opener never reaches Graph"
    );
    assert!(
        fx.state
            .db
            .whatsapp_list_drafts(fx.community(), 50)
            .await
            .expect("drafts")
            .is_empty(),
        "a refused opener leaves no draft behind"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_managed_agent_with_an_admin_role_row_still_only_drafts() {
    let fx = fixture().await;
    let agent = Keys::generate();
    let community = fx.community();
    let agent_bytes = agent.public_key().to_bytes();
    let owner_bytes = fx.owner.public_key().to_bytes();
    fx.state
        .db
        .ensure_user(community, &owner_bytes)
        .await
        .expect("owner user");
    fx.state
        .db
        .ensure_user(community, &agent_bytes)
        .await
        .expect("agent user");
    fx.state
        .db
        .set_agent_owner(community, &agent_bytes, &owner_bytes)
        .await
        .expect("bind the managed agent to its owner");
    fx.state
        .db
        .add_member(
            community,
            fx.outreach_channel().await,
            &agent_bytes,
            MemberRole::Member,
            Some(&owner_bytes),
        )
        .await
        .expect("agent joins Outreach");
    // The mistake being guarded: someone gives the agent an admin role row.
    fx.state
        .db
        .add_relay_member(community, &agent.public_key().to_hex(), "admin", None)
        .await
        .expect("agent holds an admin row");
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230022", "wamid.IN22", "Hello"))
            .await,
        StatusCode::OK
    );

    // GUARD: `access_for` never grants OwnerAdmin to a managed agent. Without it
    // the message is `queued` and the sender calls Graph.
    let made = fx
        .command(
            &agent,
            KIND_WHATSAPP_SEND_REQUEST,
            json!({"v": 1, "requestId": Uuid::new_v4().to_string(), "to": "+27821230022", "text": "Hi Thabo"}),
        )
        .await;
    let message = match made {
        Ok(result) => result.message,
        Err(error) => panic!("agent send failed: {error:?}"),
    };
    assert!(message.starts_with("draft pending approval"), "{message}");
    fx.run_sender(Utc::now()).await;
    assert_eq!(
        fx.graph.send_count(),
        0,
        "an agent message waits for the owner even with an admin row"
    );
    // And it cannot approve its own draft.
    let drafts = fx
        .state
        .db
        .whatsapp_list_drafts(fx.community(), 50)
        .await
        .expect("drafts");
    assert_eq!(drafts.len(), 1);
    let own_approval = rejection(
        fx.command(
            &agent,
            KIND_WHATSAPP_BATCH_DECISION,
            json!({"v": 1, "draftId": drafts[0].id.to_string(), "decision": "approve"}),
        )
        .await,
    );
    assert!(own_approval.contains("owner or an admin"), "{own_approval}");
    fx.run_sender(Utc::now()).await;
    assert_eq!(fx.graph.send_count(), 0);
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
        refusal.contains("only the owner, admins, their agents and Outreach members"),
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

/// Record `agent` as owned by `owner` through the production NIP-OA backfill, exactly as the
/// WebSocket and HTTP auth paths do after verifying the auth tag.
async fn own_agent(fx: &Fixture, agent: &Keys, owner: &Keys) {
    assert!(
        crate::api::relay_members::materialize_nip_oa_owner(
            &fx.state,
            &fx.tenant,
            &agent.public_key(),
            &owner.public_key(),
        )
        .await,
        "the agent owner is recorded"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn agents_owned_by_the_owner_or_an_admin_prepare_without_channel_membership() {
    // GUARD: `access_for` calls `whatsapp_agent_is_owned_by_admin` before the Outreach
    // membership check. Without it the owned agent below is refused like any outsider.
    let fx = fixture().await;
    let scout = Keys::generate();
    own_agent(&fx, &scout, &fx.owner).await;
    let channel = fx.outreach_channel().await;
    assert!(
        !fx.state
            .db
            .is_member(fx.community(), channel, &scout.public_key().to_bytes())
            .await
            .expect("membership"),
        "the agent is NOT in the Outreach channel"
    );
    assert_eq!(
        super::access_for(&fx.state, &fx.tenant, &scout.public_key())
            .await
            .expect("access"),
        super::Access::Outreach
    );

    // It prepares a batch from a DM without being in the channel.
    let batch_id = Uuid::new_v4();
    let created = fx
        .command(
            &scout,
            KIND_WHATSAPP_BATCH,
            batch(batch_id, &["+27820000011"]),
        )
        .await
        .expect("an owned agent prepares a batch");
    assert!(
        created.message.starts_with("pending approval"),
        "{}",
        created.message
    );

    // It never approves, and nothing sends until the owner does.
    let decision = json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"});
    let refusal = rejection(
        fx.command(&scout, KIND_WHATSAPP_BATCH_DECISION, decision.clone())
            .await,
    );
    assert!(refusal.contains("only the owner or an admin"), "{refusal}");
    fx.run_sender(base()).await;
    assert_eq!(fx.graph.send_count(), 0, "a pending batch never sends");

    // It may not change settings either.
    let refusal = rejection(
        fx.command(
            &scout,
            KIND_WHATSAPP_SETTINGS,
            json!({"v": 1, "dailyNewChatCap": 45}),
        )
        .await,
    );
    assert!(
        refusal.contains("only the owner or an admin can change WhatsApp settings"),
        "{refusal}"
    );

    // An agent owned by an admin counts too.
    let admin = Keys::generate();
    fx.state
        .db
        .add_relay_member(
            fx.community(),
            &admin.public_key().to_hex(),
            "admin",
            Some(&fx.owner.public_key().to_hex()),
        )
        .await
        .expect("admin");
    let admin_agent = Keys::generate();
    own_agent(&fx, &admin_agent, &admin).await;
    assert_eq!(
        super::access_for(&fx.state, &fx.tenant, &admin_agent.public_key())
            .await
            .expect("access"),
        super::Access::Outreach
    );

    fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, decision)
        .await
        .expect("owner approves");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn agents_not_owned_by_an_owner_or_admin_stay_refused_whatever_they_are_called() {
    // GUARD: the ownership join in `whatsapp_agent_is_owned_by_admin` requires the recorded
    // owner to be a current owner or admin and ignores display names.
    let fx = fixture().await;
    let refused = |who: &'static str, keys: Keys| {
        let fx = &fx;
        async move {
            let access = super::access_for(&fx.state, &fx.tenant, &keys.public_key())
                .await
                .expect("access");
            assert_eq!(
                access,
                super::Access::Member,
                "{who} must stay a plain member"
            );
            let reason = rejection(
                fx.command(
                    &keys,
                    KIND_WHATSAPP_BATCH,
                    batch(Uuid::new_v4(), &["+27820000012"]),
                )
                .await,
            );
            assert!(
                reason.contains("only the owner, admins, their agents and Outreach members"),
                "{who}: {reason}"
            );
        }
    };

    // An agent with no recorded owner, even when it calls itself Scout.
    let named_scout = Keys::generate();
    fx.state
        .db
        .ensure_user_for_authorization(fx.community(), &named_scout.public_key().to_bytes())
        .await
        .expect("user row");
    sqlx::query("UPDATE users SET display_name = 'Scout' WHERE community_id = $1 AND pubkey = $2")
        .bind(fx.community().as_uuid())
        .bind(&named_scout.public_key().to_bytes()[..])
        .execute(&fx.pool)
        .await
        .expect("name it Scout");
    refused("an unowned agent named Scout", named_scout).await;

    // A foreign agent owned by a plain member.
    let member = Keys::generate();
    fx.state
        .db
        .add_relay_member(
            fx.community(),
            &member.public_key().to_hex(),
            "member",
            Some(&fx.owner.public_key().to_hex()),
        )
        .await
        .expect("member");
    let members_agent = Keys::generate();
    own_agent(&fx, &members_agent, &member).await;
    refused("an agent owned by a plain member", members_agent).await;

    // An agent owned by someone who is not in the company at all.
    let stranger = Keys::generate();
    let strangers_agent = Keys::generate();
    own_agent(&fx, &strangers_agent, &stranger).await;
    refused("an agent owned by a stranger", strangers_agent).await;

    // An agent loses access when its owner is demoted.
    let admin = Keys::generate();
    fx.state
        .db
        .add_relay_member(
            fx.community(),
            &admin.public_key().to_hex(),
            "admin",
            Some(&fx.owner.public_key().to_hex()),
        )
        .await
        .expect("admin");
    let admins_agent = Keys::generate();
    own_agent(&fx, &admins_agent, &admin).await;
    assert_eq!(
        super::access_for(&fx.state, &fx.tenant, &admins_agent.public_key())
            .await
            .expect("access"),
        super::Access::Outreach
    );
    sqlx::query("UPDATE relay_members SET role = 'member' WHERE community_id = $1 AND pubkey = $2")
        .bind(fx.community().as_uuid())
        .bind(admin.public_key().to_hex())
        .execute(&fx.pool)
        .await
        .expect("demote");
    refused("an agent whose owner was demoted", admins_agent).await;
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_batch_row_shows_in_the_thread_from_creation_through_the_send_and_the_contact_has_a_name()
{
    // GUARD: `whatsapp_list_thread` hides only 'dropped' rows. It used to hide 'held' too, so a
    // contact created by a batch showed "No messages yet" until the owner approved the batch.
    // GUARD: `client_state` maps held/ready/skipped to states the app can parse.
    // GUARD: `contact_view` falls back to the number, and a row `name` seeds a blank name.
    let fx = fixture().await;
    let agent = Keys::generate();
    own_agent(&fx, &agent, &fx.owner).await;
    let thread = |wa: &'static str| {
        let fx = &fx;
        async move {
            crate::api::whatsapp::thread_view(&fx.state, fx.community(), wa, 50, true, Utc::now())
                .await
                .expect("thread answer")
        }
    };

    // A bare number with no lead and no name, and a second row that carries a name.
    let batch_id = Uuid::new_v4();
    let content = json!({
        "v": 1,
        "batchId": batch_id.to_string(),
        "template": "intro",
        "language": "en",
        "rows": [
            {"to": "+27683735905", "params": ["Thabo"]},
            {"to": "+27683735906", "name": "Lerato Dlamini", "params": ["Lerato"]},
        ],
    });
    fx.command(&agent, KIND_WHATSAPP_BATCH, content)
        .await
        .expect("agent prepares the batch");

    // Batch just created, nothing approved: the conversation already holds the message.
    let view = thread("27683735905").await;
    let messages = view["messages"].as_array().expect("messages");
    assert_eq!(
        messages.len(),
        1,
        "the pending row is in the thread: {view}"
    );
    assert_eq!(messages[0]["direction"], "out");
    assert_eq!(messages[0]["state"], "queued");
    assert_eq!(messages[0]["awaitingApproval"], true);
    assert!(messages[0]["text"]
        .as_str()
        .expect("text")
        .contains("Thabo"));
    // GUARD: an app that does not opt in never sees the held row, so an older app cannot
    // label a message that still waits for approval as approved.
    let hidden = crate::api::whatsapp::thread_view(
        &fx.state,
        fx.community(),
        "27683735905",
        50,
        false,
        Utc::now(),
    )
    .await
    .expect("thread answer");
    assert_eq!(
        hidden["messages"].as_array().expect("messages").len(),
        0,
        "held rows stay hidden without includeHeld: {hidden}"
    );
    // No name anywhere: the contact shows its number, never an empty string.
    assert_eq!(view["contact"]["displayName"], "+27683735905");
    // A row name seeds the blank name.
    let named = thread("27683735906").await;
    assert_eq!(named["contact"]["displayName"], "Lerato Dlamini");

    // A WhatsApp profile name is never overwritten by a later row name.
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), "27683735906", Some("Lerato D"))
        .await
        .expect("profile name");
    fx.state
        .db
        .whatsapp_set_name_if_blank(fx.community(), "27683735906", "Someone Else")
        .await
        .expect("set if blank");
    assert_eq!(
        thread("27683735906").await["contact"]["displayName"],
        "Lerato D"
    );

    // Approved, outside the window (05:00 in Johannesburg): the row is ready, shown as queued.
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"}),
    )
    .await
    .expect("owner approves");
    fx.run_sender(base() - Duration::hours(7)).await;
    let view = thread("27683735905").await;
    assert_eq!(view["messages"][0]["state"], "queued");
    assert_eq!(view["messages"][0]["awaitingApproval"], false);

    // Sent: the same row now reads sent.
    fx.run_sender(base()).await;
    assert!(fx.graph.send_count() >= 1, "the fake Graph took the sends");
    let view = thread("27683735905").await;
    assert_eq!(view["messages"].as_array().expect("messages").len(), 1);
    assert_eq!(view["messages"][0]["state"], "sent");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_contact_whose_only_row_waits_for_approval_is_never_reported_as_sent() {
    // GUARD: `outreach_status` ranks `sent` above `waiting_for_approval`, and the flags come
    // from `whatsapp_outreach_flags` over the real rows. The app used to call every contact
    // without an inbound message "Sent", including one whose only row was still `held`.
    let fx = fixture().await;
    let agent = Keys::generate();
    own_agent(&fx, &agent, &fx.owner).await;
    let status_of = |wa: &'static str| {
        let fx = &fx;
        async move {
            let view = crate::api::whatsapp::thread_view(
                &fx.state,
                fx.community(),
                wa,
                50,
                true,
                Utc::now(),
            )
            .await
            .expect("thread answer");
            let listed = fx
                .state
                .db
                .whatsapp_list_contacts(fx.community(), 50)
                .await
                .expect("contacts");
            let listed =
                crate::api::whatsapp::contacts_view(&fx.state, fx.community(), &listed, Utc::now())
                    .await
                    .expect("contacts answer");
            let in_list = listed["contacts"]
                .as_array()
                .expect("contacts")
                .iter()
                .find(|c| c["waId"] == wa)
                .cloned()
                .expect("listed");
            // The thread and the list agree.
            assert_eq!(view["contact"]["outreachStatus"], in_list["outreachStatus"]);
            assert_eq!(
                view["contact"]["hasSentOutbound"],
                in_list["hasSentOutbound"]
            );
            (
                view["contact"]["outreachStatus"]
                    .as_str()
                    .expect("status")
                    .to_owned(),
                view["contact"]["awaitingApproval"] == true,
                view["contact"]["hasSentOutbound"] == true,
            )
        }
    };

    let batch_id = Uuid::new_v4();
    fx.command(
        &agent,
        KIND_WHATSAPP_BATCH,
        batch(batch_id, &["+27683735905"]),
    )
    .await
    .expect("agent prepares the batch");
    assert_eq!(
        status_of("27683735905").await,
        ("waiting_for_approval".to_owned(), true, false),
        "a held-only contact is waiting for approval, not sent"
    );

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"}),
    )
    .await
    .expect("owner approves");
    fx.run_sender(base() - Duration::hours(7)).await;
    assert_eq!(
        status_of("27683735905").await,
        ("queued".to_owned(), false, false),
        "approved but outside the window: queued, still not sent"
    );

    fx.run_sender(base()).await;
    assert_eq!(
        status_of("27683735905").await,
        ("sent".to_owned(), false, true)
    );

    // A reply wins over everything.
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27683735905", "wamid.IN-S", "Hello"))
            .await,
        StatusCode::OK
    );
    assert_eq!(status_of("27683735905").await.0, "replied");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn approving_a_batch_whose_template_is_gone_from_meta_fails_with_template_missing() {
    // GUARD: `ensure_batch_template` in `handle_decision`. Without it the approval flips the
    // rows to ready and the worker sends a template Meta no longer has.
    let fx = fixture().await;
    let agent = Keys::generate();
    own_agent(&fx, &agent, &fx.owner).await;
    let batch_id = Uuid::new_v4();
    fx.command(
        &agent,
        KIND_WHATSAPP_BATCH,
        batch(batch_id, &["+27683735905"]),
    )
    .await
    .expect("agent prepares the batch");

    // Meta drops the template after the batch was prepared.
    fx.graph.hide_templates.store(true, Ordering::SeqCst);
    let decision = json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"});
    let refusal = rejection(
        fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, decision.clone())
            .await,
    );
    assert!(refusal.contains("template_missing"), "{refusal}");

    // The batch is still pending, its row still held, and nothing goes out.
    let batch_row = fx
        .state
        .db
        .whatsapp_get_batch(fx.community(), batch_id)
        .await
        .expect("batch")
        .expect("exists");
    assert_eq!(batch_row.status, "pending");
    fx.run_sender(base()).await;
    assert_eq!(fx.graph.send_count(), 0, "nothing is sent blind");
    let rows = fx
        .state
        .db
        .whatsapp_list_batch_rows(fx.community(), batch_id)
        .await
        .expect("batch rows");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].state, "held");

    // The template comes back (or a resync finds it): the same approval now works.
    fx.graph.hide_templates.store(false, Ordering::SeqCst);
    fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, decision)
        .await
        .expect("owner approves once the template is back");
    fx.run_sender(base()).await;
    assert_eq!(fx.graph.send_count(), 1);
}

// ── send_now: the owner's test release of a small approved batch ──────────────

/// 05:00 in Johannesburg, outside the 08:00 to 18:00 send window.
fn night() -> DateTime<Utc> {
    base() - Duration::hours(7)
}

fn send_now(batch_id: Uuid) -> Value {
    json!({"v": 1, "batchId": batch_id.to_string(), "decision": "send_now"})
}

/// The owner prepares a batch and approves it; its rows are `ready`.
async fn approved_batch(fx: &Fixture, numbers: &[&str]) -> Uuid {
    let batch_id = Uuid::new_v4();
    fx.command(&fx.owner, KIND_WHATSAPP_BATCH, batch(batch_id, numbers))
        .await
        .expect("owner prepares a batch");
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"}),
    )
    .await
    .expect("owner approves the batch");
    batch_id
}

async fn batch_rows(fx: &Fixture, batch_id: Uuid) -> Vec<buzz_db::whatsapp::WhatsappMessage> {
    fx.state
        .db
        .whatsapp_list_batch_rows(fx.community(), batch_id)
        .await
        .expect("batch rows")
}

/// `sendsAt` of the first message in a contact's thread view.
async fn sends_at_in_thread(fx: &Fixture, wa_id: &str, now: DateTime<Utc>) -> Option<String> {
    let view = crate::api::whatsapp::thread_view(&fx.state, fx.community(), wa_id, 50, true, now)
        .await
        .expect("thread answer");
    view["messages"][0]["sendsAt"].as_str().map(str::to_owned)
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn send_now_sends_a_small_approved_batch_outside_the_window_and_without_the_gap() {
    // GUARD: `released` in `sender::process_community`. Without it the three rows wait for
    // 08:00 and then for the gap between two new chats, so nothing is sent at 05:00.
    // GUARD: `sends_at` in the thread view: a queued row says when it goes out.
    let fx = fixture().await;
    // Exactly `SEND_NOW_MAX_ROWS` rows is still a test.
    let numbers = ["+27820000011", "+27820000012", "+27820000013"];
    let batch_id = approved_batch(&fx, &numbers).await;

    fx.run_sender(night()).await;
    assert_eq!(fx.graph.send_count(), 0, "outside the window nothing goes");
    assert_eq!(
        sends_at_in_thread(&fx, "27820000011", night())
            .await
            .as_deref(),
        Some("2026-10-29T06:00:00+00:00"),
        "a queued row names the start of the next window"
    );

    let released = fx
        .command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, send_now(batch_id))
        .await
        .expect("owner releases the test batch");
    assert!(
        released.message.starts_with("send_now: 3"),
        "{}",
        released.message
    );
    let sends_at = sends_at_in_thread(&fx, "27820000011", night())
        .await
        .expect("a released row says when it goes out");
    let at = DateTime::parse_from_rfc3339(&sends_at)
        .expect("sendsAt is an ISO time")
        .with_timezone(&Utc);
    assert!(
        (Utc::now() - at).num_seconds().abs() < 120,
        "a released row goes out now, not at 06:00: {sends_at}"
    );

    fx.run_sender(night()).await;
    assert_eq!(
        fx.graph.send_count(),
        3,
        "all three go in one pass, no gap between them"
    );
    for row in batch_rows(&fx, batch_id).await {
        assert!(
            matches!(row.state.as_str(), "sent" | "delivered" | "read"),
            "{}",
            row.state
        );
    }

    // At most once: a second release finds nothing waiting and a second pass sends nothing.
    let refusal = rejection(
        fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, send_now(batch_id))
            .await,
    );
    assert!(refusal.contains("waiting to send"), "{refusal}");
    fx.run_sender(night()).await;
    assert_eq!(fx.graph.send_count(), 3);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn send_now_rows_still_count_to_the_daily_cap() {
    // GUARD: `decide_owner_send_now` keeps the cap check. A release that ignored the cap
    // would send both rows although the owner allows one new chat a day.
    let fx = fixture().await;
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SETTINGS,
        json!({"v": 1, "dailyNewChatCap": 1}),
    )
    .await
    .expect("owner sets the cap");
    let batch_id = approved_batch(&fx, &["+27820000021", "+27820000022"]).await;
    fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, send_now(batch_id))
        .await
        .expect("owner releases the test batch");

    fx.run_sender(night()).await;
    assert_eq!(fx.graph.send_count(), 1, "the cap of 1 holds");
    fx.run_sender(night()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "the cap still holds on the next pass"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn only_the_owner_or_an_admin_can_send_now_never_an_agent() {
    // GUARD: the `is_owner_admin` check at the top of `handle_decision`, which also covers
    // `send_now`. An agent that could release a batch would defeat the owner's approval.
    let fx = fixture().await;
    let batch_id = approved_batch(&fx, &["+27820000031"]).await;

    let owned = Keys::generate();
    own_agent(&fx, &owned, &fx.owner).await;
    let member = Keys::generate();
    fx.state
        .db
        .add_member(
            fx.community(),
            fx.outreach_channel().await,
            &member.public_key().to_bytes(),
            MemberRole::Member,
            Some(&fx.owner.public_key().to_bytes()),
        )
        .await
        .expect("owner adds the agent to Outreach");
    for agent in [&owned, &member] {
        let refusal = rejection(
            fx.command(agent, KIND_WHATSAPP_BATCH_DECISION, send_now(batch_id))
                .await,
        );
        assert!(refusal.contains("only the owner or an admin"), "{refusal}");
    }

    assert!(
        batch_rows(&fx, batch_id)
            .await
            .iter()
            .all(|row| row.send_after.is_none()),
        "a refused release flags nothing"
    );
    fx.run_sender(night()).await;
    assert_eq!(fx.graph.send_count(), 0, "still waiting for 08:00");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn send_now_is_refused_for_a_batch_of_more_than_three_rows() {
    // GUARD: the `total > max_rows` check in `whatsapp_send_now_batch`. send_now is a test
    // release, not a way around the send window for a blast.
    let fx = fixture().await;
    let numbers = [
        "+27820000051",
        "+27820000052",
        "+27820000053",
        "+27820000054",
    ];
    let batch_id = approved_batch(&fx, &numbers).await;

    let refusal = rejection(
        fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, send_now(batch_id))
            .await,
    );
    assert!(refusal.contains("at most 3 rows"), "{refusal}");
    assert!(
        batch_rows(&fx, batch_id)
            .await
            .iter()
            .all(|row| row.send_after.is_none()),
        "a refused release flags nothing"
    );
    fx.run_sender(night()).await;
    assert_eq!(fx.graph.send_count(), 0);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn send_now_is_refused_for_a_batch_that_is_not_approved() {
    // GUARD: the `approved` status check in `whatsapp_send_now_batch`. A pending batch has
    // not been approved, so releasing it would send what the owner never approved.
    let fx = fixture().await;
    let batch_id = Uuid::new_v4();
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH,
        batch(batch_id, &["+27820000061"]),
    )
    .await
    .expect("owner prepares a batch");

    let refusal = rejection(
        fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, send_now(batch_id))
            .await,
    );
    assert!(refusal.contains("approved batch"), "{refusal}");
    let rows = batch_rows(&fx, batch_id).await;
    assert_eq!(rows[0].state, "held");
    assert!(rows[0].send_after.is_none());
    fx.run_sender(night()).await;
    fx.run_sender(base()).await;
    assert_eq!(fx.graph.send_count(), 0, "a pending batch never sends");

    // A rejected batch is refused the same way, and an unknown one too.
    let rejected = Uuid::new_v4();
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH,
        batch(rejected, &["+27820000062"]),
    )
    .await
    .expect("owner prepares a second batch");
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "batchId": rejected.to_string(), "decision": "reject"}),
    )
    .await
    .expect("owner rejects it");
    let refusal = rejection(
        fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, send_now(rejected))
            .await,
    );
    assert!(refusal.contains("approved batch"), "{refusal}");
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_BATCH_DECISION,
            send_now(Uuid::new_v4()),
        )
        .await,
    );
    assert!(refusal.contains("no such batch"), "{refusal}");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn send_now_still_refuses_opted_out_contacts_and_a_stopped_number() {
    // GUARD: the opted_out check in `sender::process_community` runs before the new-chat
    // branch, and `send_paused` (quality RED) stops the whole pass. send_now skips only the
    // window and the gap.
    let fx = fixture().await;
    let batch_id = approved_batch(&fx, &["+27820000041", "+27820000042"]).await;
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27820000041", "wamid.IN41", "STOP"))
            .await,
        StatusCode::OK
    );
    fx.command(&fx.owner, KIND_WHATSAPP_BATCH_DECISION, send_now(batch_id))
        .await
        .expect("owner releases the test batch");

    // Quality RED stops sending: nothing goes, not even the released rows.
    fx.state
        .db
        .whatsapp_set_send_paused(
            fx.community(),
            true,
            Some("Quality rating is RED. Sending stopped."),
        )
        .await
        .expect("quality stop");
    fx.run_sender(night()).await;
    assert_eq!(fx.graph.send_count(), 0, "a quality stop beats send_now");

    fx.state
        .db
        .whatsapp_set_send_paused(fx.community(), false, None)
        .await
        .expect("quality recovers");
    fx.run_sender(night()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "only the contact who did not opt out is messaged"
    );
    let rows = batch_rows(&fx, batch_id).await;
    let opted_out = rows
        .iter()
        .find(|row| row.wa_id == "27820000041")
        .expect("the opted-out row");
    assert_eq!(opted_out.state, "skipped");
    assert!(
        opted_out
            .skip_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("opted out")),
        "{:?}",
        opted_out.skip_reason
    );
}
