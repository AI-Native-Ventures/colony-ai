//! Postgres-backed proofs of the production seams of WhatsApp outreach. Meta is never
//! reached: every Graph call goes to [`FakeGraph`].
//!
//! Each test names the guard it depends on; removing that guard makes the test fail.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use axum::routing::get;
use axum::Router;
use chrono::{DateTime, Duration, TimeZone, Utc};
use hmac::{Hmac, KeyInit, Mac};
use nostr::{EventBuilder, Keys, Kind, Tag};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use buzz_core::business_records::{
    prospect_d_tag, PartyRecord, ProspectActivity, ProspectActivityKind, ProspectHead,
    ProspectQualification, ProspectRecordInput, ProspectStage, BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::channel::MemberRole;
use buzz_core::kind::{
    KIND_PROSPECT_HEAD, KIND_WHATSAPP_BATCH, KIND_WHATSAPP_BATCH_DECISION,
    KIND_WHATSAPP_CONTACT_UPDATE, KIND_WHATSAPP_SAFETY_ACTION, KIND_WHATSAPP_SEND_REQUEST,
    KIND_WHATSAPP_SETTINGS, KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::whatsapp_stage::WhatsappStage;

use super::connect;
use super::graph::{
    DownloadError, GraphApi, GraphError, MediaInfo, PhoneInfo, RemoteTemplate, SendRequest,
};
use super::media;
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
    send_results: Mutex<VecDeque<Result<(), GraphError>>>,
    verify_token: Mutex<Option<String>>,
    tokens_seen: Mutex<Vec<String>>,
    cleared: AtomicBool,
    sabotage_after_send: AtomicBool,
    reject_token: AtomicBool,
    hide_templates: AtomicBool,
    media_info: Mutex<Result<MediaInfo, GraphError>>,
    media_download: Mutex<Result<Vec<u8>, DownloadError>>,
}

impl FakeGraph {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            sends: Mutex::new(Vec::new()),
            send_results: Mutex::new(VecDeque::new()),
            verify_token: Mutex::new(None),
            tokens_seen: Mutex::new(Vec::new()),
            cleared: AtomicBool::new(false),
            sabotage_after_send: AtomicBool::new(false),
            reject_token: AtomicBool::new(false),
            hide_templates: AtomicBool::new(false),
            media_info: Mutex::new(Err(GraphError::Unavailable("no media scripted".into()))),
            media_download: Mutex::new(Err(DownloadError::Graph(GraphError::Unavailable(
                "no media scripted".into(),
            )))),
        }
    }

    fn script_media(
        &self,
        info: Result<MediaInfo, GraphError>,
        download: Result<Vec<u8>, DownloadError>,
    ) {
        *self.media_info.lock().expect("media info lock") = info;
        *self.media_download.lock().expect("media download lock") = download;
    }

    fn script_sends(&self, results: Vec<Result<(), GraphError>>) {
        *self.send_results.lock().expect("send results lock") = results.into();
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
        if let Some(Err(error)) = self
            .send_results
            .lock()
            .expect("send results lock")
            .pop_front()
        {
            return Err(error);
        }
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

    async fn media_info(&self, token: &str, _media_id: &str) -> Result<MediaInfo, GraphError> {
        self.tokens_seen
            .lock()
            .expect("tokens lock")
            .push(token.to_string());
        self.media_info.lock().expect("media info lock").clone()
    }

    async fn download_media(
        &self,
        _token: &str,
        _url: &str,
        _max_bytes: u64,
    ) -> Result<Vec<u8>, DownloadError> {
        self.media_download
            .lock()
            .expect("media download lock")
            .clone()
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
    fixture_with_fence(false).await
}

/// A fixture whose writer pool arms the production replica-fence floor
/// (`buzz.created_at_floor`, 960 s) on every connection, exactly as `Db::connect` does, so a
/// channel event older than the floor is refused at COMMIT.
async fn fence_fixture() -> Fixture {
    fixture_with_fence(true).await
}

async fn fixture_with_fence(arm_fence: bool) -> Fixture {
    let mut config = crate::config::Config::from_env().expect("test relay config");
    let database_url = crate::test_support::database_url();
    config.database_url = database_url.clone();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_owned());
    config.require_relay_membership = false;
    config.accounts = crate::config::AccountConfig::test_config(Some(KEK), None, vec![], None);
    let host = format!("whatsapp-test-{}.example", Uuid::new_v4().simple());
    config.relay_url = format!("wss://{host}");

    let pool = if arm_fence {
        PgPoolOptions::new()
            .after_connect(|conn, _meta| {
                Box::pin(async move {
                    sqlx::query("SELECT set_config('buzz.created_at_floor', $1, false)")
                        .bind(buzz_db::replica_fence::CREATED_AT_FLOOR_SECS.to_string())
                        .execute(&mut *conn)
                        .await?;
                    Ok(())
                })
            })
            .connect(&database_url)
            .await
    } else {
        PgPool::connect(&database_url).await
    }
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
        Some(buzz_audit::AuditService::new(pool.clone())),
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

fn batch_for_business(batch_id: Uuid, business_id: &str, numbers: &[&str]) -> Value {
    json!({
        "v": 1,
        "batchId": batch_id.to_string(),
        "template": "intro",
        "language": "en",
        "rows": numbers
            .iter()
            .map(|number| json!({
                "to": number,
                "leadId": business_id,
                "params": ["Thabo"],
            }))
            .collect::<Vec<_>>(),
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

/// Seed the authoritative relay-signed prospect head that the phone linker reads in production.
async fn seed_prospect_head(fx: &Fixture, phone: &str, name: &str, status: &str) -> String {
    seed_prospect_head_with_note(fx, phone, name, status, None).await
}

/// Seed a prospect head whose immutable activity history may contain one Scout note.
async fn seed_prospect_head_with_note(
    fx: &Fixture,
    phone: &str,
    name: &str,
    status: &str,
    note: Option<&str>,
) -> String {
    seed_prospect_head_with_activity(
        fx,
        phone,
        name,
        status,
        note.map(|content| (ProspectActivityKind::Note, content)),
    )
    .await
}

async fn seed_prospect_head_with_activity(
    fx: &Fixture,
    phone: &str,
    name: &str,
    status: &str,
    activity: Option<(ProspectActivityKind, &str)>,
) -> String {
    let prospect_id = Uuid::new_v4();
    let head = ProspectHead {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        prospect_id,
        status: status.to_string(),
        prospect: ProspectRecordInput {
            prospect_id,
            party: PartyRecord {
                party_id: prospect_id,
                party_type: "organization".into(),
                display_name: name.to_string(),
                external_ids: Vec::new(),
            },
            industry: "Hospitality".into(),
            vertical: "Guesthouse".into(),
            fit_score: None,
            origin: None,
            discovery_tags: Vec::new(),
            maps: None,
            potential_monthly_value_minor: None,
            website: Some("https://example.test".into()),
            contact_name: None,
            location: Some("Sandton".into()),
            email: None,
            phone: Some(phone.to_string()),
            whatsapp_phone: None,
            evidence: Vec::new(),
            last_verified_at: None,
            qualification: ProspectQualification::Unreviewed,
            saved: false,
            stage: ProspectStage::Qualified,
            lost_reason: None,
        },
        activities: activity
            .map(|(activity_kind, content)| {
                vec![ProspectActivity {
                    activity_id: Uuid::new_v4(),
                    activity_kind,
                    content: content.to_string(),
                    proposal_id: None,
                    proposal_version_event_id: None,
                    author_pubkey: "0".repeat(64),
                    created_at: base().timestamp(),
                }]
            })
            .unwrap_or_default(),
        source_action_event_id: "0".repeat(64),
    };
    let d_tag = prospect_d_tag(*fx.community().as_uuid(), prospect_id);
    let event = EventBuilder::new(
        Kind::Custom(KIND_PROSPECT_HEAD as u16),
        serde_json::to_string(&head).expect("serialize prospect head"),
    )
    .tags(vec![
        Tag::parse(["d", d_tag.as_str()]).expect("prospect d tag")
    ])
    .sign_with_keys(&fx.state.relay_keypair)
    .expect("sign prospect head");
    let (_, inserted) = fx
        .state
        .db
        .replace_parameterized_event(fx.community(), &event, &d_tag, None)
        .await
        .expect("insert prospect head");
    assert!(inserted, "the fixture prospect head is stored");
    prospect_id.to_string()
}

async fn contact_link_snapshot(
    fx: &Fixture,
) -> Vec<(String, Option<String>, Option<DateTime<Utc>>, String)> {
    sqlx::query(
        "SELECT wa_id, lead_id, lead_link_checked_at, display_name FROM whatsapp_contacts \
         WHERE community_id = $1 ORDER BY wa_id",
    )
    .bind(fx.community().as_uuid())
    .fetch_all(&fx.pool)
    .await
    .expect("contact link snapshot")
    .iter()
    .map(|row| {
        (
            row.try_get("wa_id").expect("wa id"),
            row.try_get("lead_id").expect("lead id"),
            row.try_get("lead_link_checked_at")
                .expect("lead link check timestamp"),
            row.try_get("display_name").expect("display name"),
        )
    })
    .collect()
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_direct_send_links_a_phone_matched_lead_before_graph() {
    // GUARD: `enqueue_send` must resolve and persist an unlinked contact before its safety
    // lookup. The contact therefore carries the business identity before the sender can call
    // Graph, and a later business stop can fence this number too.
    let fx = fixture().await;
    let wa = "+27821234561";
    let lead_id = seed_prospect_head(&fx, wa, "Sandton Country Manor", "active").await;

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SEND_REQUEST,
        json!({
            "v": 1,
            "requestId": Uuid::new_v4().to_string(),
            "to": wa,
            "template": {"name": "intro", "language": "en", "params": ["Thabo"]},
        }),
    )
    .await
    .expect("owner queues the matching contact");

    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), "27821234561")
        .await
        .expect("contact query")
        .expect("queued send created the contact");
    assert_eq!(contact.lead_id.as_deref(), Some(lead_id.as_str()));
    assert_eq!(fx.graph.send_count(), 0, "linking finishes before Graph");

    fx.run_sender(base()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "the linked row reaches fake Graph"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_batch_without_lead_id_links_its_exact_phone_match_without_renaming_the_contact() {
    // GUARD: batch preflight resolves a missing `leadId` before `whatsapp_send_safety`, then
    // persists the exact unique match only after every row passes validation.
    let fx = fixture().await;
    let wa = "+27821234562";
    let lead_id = seed_prospect_head(&fx, wa, "The Dog's Bollocks at YARD", "active").await;
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), "27821234562", Some("Meta profile"))
        .await
        .expect("existing profile contact");

    fx.command(&fx.owner, KIND_WHATSAPP_BATCH, batch(Uuid::new_v4(), &[wa]))
        .await
        .expect("batch without lead id is prepared");

    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), "27821234562")
        .await
        .expect("contact query")
        .expect("batch contact");
    assert_eq!(contact.lead_id.as_deref(), Some(lead_id.as_str()));
    assert_eq!(contact.display_name, "Meta profile");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn sender_backfill_links_a_phone_named_only_in_an_active_prospect_note() {
    // GUARD: a WhatsApp number Scout found in a note, rather than in `prospect.phone`, must
    // link through the same production sender backfill seam as an exact phone-field match.
    let fx = fixture().await;
    let wa_id = "27732086891";
    let lead_id = seed_prospect_head_with_note(
        &fx,
        "+27110001111",
        "Scout mobile only",
        "active",
        Some("Added to hl_posts WhatsApp batch. Used mobile +27 73 208 6891 from their website."),
    )
    .await;
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), wa_id, Some("Meta profile"))
        .await
        .expect("backfill fixture contact");

    fx.run_sender(base()).await;

    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), wa_id)
        .await
        .expect("contact query")
        .expect("fixture contact remains");
    assert_eq!(contact.lead_id.as_deref(), Some(lead_id.as_str()));
    assert_eq!(contact.display_name, "Meta profile");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn sender_backfill_requires_one_active_standalone_activity_note_match() {
    // GUARD: a secondary match is safe only for one active prospect's complete phone token.
    // Ambiguous notes, archived prospects, and target-looking substrings stay unlinked and
    // retain the existing durable retry behavior.
    let fx = fixture().await;
    let unique = "27732086892";
    let ambiguous = "27732086893";
    let archived = "27732086894";
    let substring = "27732086895";
    let contact_activity = "27732086897";
    let unique_note = format!("Used WhatsApp +{unique} from their website.");
    let ambiguous_note = format!("Used WhatsApp +{ambiguous} from their website.");
    let archived_note = format!("Used WhatsApp +{archived} from their website.");
    let substring_note = format!("Used WhatsApp 1{substring}0 from their website.");
    let contact_activity_note = format!("Used WhatsApp +{contact_activity} from their website.");
    let unique_lead = seed_prospect_head_with_note(
        &fx,
        "+27110001112",
        "Unique note business",
        "active",
        Some(&unique_note),
    )
    .await;
    let _ambiguous_one = seed_prospect_head_with_note(
        &fx,
        "+27110001113",
        "First note duplicate",
        "active",
        Some(&ambiguous_note),
    )
    .await;
    let _ambiguous_two = seed_prospect_head_with_note(
        &fx,
        "+27110001114",
        "Second note duplicate",
        "active",
        Some(&ambiguous_note),
    )
    .await;
    let _archived = seed_prospect_head_with_note(
        &fx,
        "+27110001115",
        "Archived note business",
        "archived",
        Some(&archived_note),
    )
    .await;
    let _substring = seed_prospect_head_with_note(
        &fx,
        "+27110001116",
        "Embedded digits business",
        "active",
        Some(&substring_note),
    )
    .await;
    let _contact_activity = seed_prospect_head_with_activity(
        &fx,
        "+27110001119",
        "Contact activity business",
        "active",
        Some((ProspectActivityKind::Contact, &contact_activity_note)),
    )
    .await;
    for (wa_id, name) in [
        (unique, "Unique profile"),
        (ambiguous, "Ambiguous profile"),
        (archived, "Archived profile"),
        (substring, "Substring profile"),
        (contact_activity, "Contact activity profile"),
    ] {
        fx.state
            .db
            .whatsapp_ensure_contact(fx.community(), wa_id, Some(name))
            .await
            .expect("backfill fixture contact");
    }

    fx.run_sender(base()).await;
    let first = contact_link_snapshot(&fx).await;
    let linked = |wa_id: &str| {
        first
            .iter()
            .find(|row| row.0 == wa_id)
            .expect("fixture contact appears in snapshot")
    };
    assert_eq!(linked(unique).1.as_deref(), Some(unique_lead.as_str()));
    for wa_id in [ambiguous, archived, substring, contact_activity] {
        assert_eq!(linked(wa_id).1, None, "{wa_id} stays unlinked");
        assert!(
            linked(wa_id).2.is_some(),
            "{wa_id} records the durable retry timestamp"
        );
    }

    fx.run_sender(base() + Duration::seconds(5)).await;
    assert_eq!(
        contact_link_snapshot(&fx).await,
        first,
        "a second sender pass before retry is idempotent"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn sender_backfill_prefers_an_exact_prospect_phone_over_an_activity_note() {
    // GUARD: the existing exact `prospect.phone` resolver is authoritative even when another
    // active prospect's Scout note names the same mobile number.
    let fx = fixture().await;
    let wa_id = "27732086896";
    let primary_lead =
        seed_prospect_head(&fx, &format!("+{wa_id}"), "Phone field business", "active").await;
    let note = format!("Used WhatsApp +{wa_id} from their website.");
    let _secondary_lead = seed_prospect_head_with_note(
        &fx,
        "+27110001117",
        "Note field business",
        "active",
        Some(&note),
    )
    .await;
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), wa_id, Some("Meta profile"))
        .await
        .expect("backfill fixture contact");

    fx.run_sender(base()).await;

    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), wa_id)
        .await
        .expect("contact query")
        .expect("fixture contact remains");
    assert_eq!(contact.lead_id.as_deref(), Some(primary_lead.as_str()));
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn sender_backfill_links_exact_matches_once_and_records_retry_state_for_other_contacts() {
    // GUARD: the sender's bounded durable backfill must link only exact active matches, retain
    // an existing association, and acknowledge no-match or ambiguous rows so a restart makes
    // no further change before their retry is due.
    let fx = fixture().await;
    let matched = "27821234563";
    let unmatched = "27821234564";
    let ambiguous = "27821234565";
    let preserved = "27821234566";
    let archived = "27821234567";
    let matched_lead = seed_prospect_head(
        &fx,
        &format!("+{matched}"),
        "Sandton Country Manor",
        "active",
    )
    .await;
    let _ambiguous_one =
        seed_prospect_head(&fx, &format!("+{ambiguous}"), "First duplicate", "active").await;
    let _ambiguous_two =
        seed_prospect_head(&fx, &format!("+{ambiguous}"), "Second duplicate", "active").await;
    let _archived_lead =
        seed_prospect_head(&fx, &format!("+{archived}"), "Closed venue", "archived").await;
    for (wa_id, name) in [
        (matched, "Matched profile"),
        (unmatched, "No match profile"),
        (ambiguous, "Ambiguous profile"),
        (preserved, "Existing profile"),
        (archived, "Archived profile"),
    ] {
        fx.state
            .db
            .whatsapp_ensure_contact(fx.community(), wa_id, Some(name))
            .await
            .expect("backfill fixture contact");
    }
    let existing_lead = Uuid::new_v4().to_string();
    assert!(
        fx.state
            .db
            .whatsapp_set_lead(fx.community(), preserved, &existing_lead)
            .await
            .expect("set preserved lead"),
        "fixture contact starts linked"
    );
    let competing_lead = Uuid::new_v4().to_string();
    assert!(
        !fx.state
            .db
            .whatsapp_set_lead(fx.community(), preserved, &competing_lead)
            .await
            .expect("second lead write"),
        "the production contact write must never overwrite an existing lead id"
    );

    fx.run_sender(base()).await;
    let first = contact_link_snapshot(&fx).await;
    let linked = |wa_id: &str| {
        first
            .iter()
            .find(|row| row.0 == wa_id)
            .expect("fixture contact appears in snapshot")
    };
    assert_eq!(linked(matched).1.as_deref(), Some(matched_lead.as_str()));
    assert_eq!(linked(unmatched).1, None);
    assert!(
        linked(unmatched).2.is_some(),
        "no-match row has retry state"
    );
    assert_eq!(linked(ambiguous).1, None);
    assert!(
        linked(ambiguous).2.is_some(),
        "ambiguous row has retry state"
    );
    assert_eq!(linked(preserved).1.as_deref(), Some(existing_lead.as_str()));
    assert_eq!(linked(preserved).2, None, "existing link is not revisited");
    assert_eq!(linked(archived).1, None);
    assert!(
        linked(archived).2.is_some(),
        "archived-only row has retry state"
    );
    assert_eq!(linked(matched).3, "Matched profile");

    fx.run_sender(base() + Duration::seconds(5)).await;
    assert_eq!(
        contact_link_snapshot(&fx).await,
        first,
        "a restart before the durable retry time makes no contact changes"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_legacy_queued_contact_links_before_the_business_stop_is_checked() {
    // GUARD: the worker links a legacy queued row from Scout's secondary note match before its
    // existing safety lookup. Without that ordering, a business reply stop misses this contact
    // and Graph receives the send.
    let fx = fixture().await;
    let target = "27821234568";
    let source = "27821234569";
    let note =
        format!("Added to hl_posts WhatsApp batch. Used mobile +{target} from their website.");
    let lead_id = seed_prospect_head_with_note(
        &fx,
        "+27110001118",
        "Stopped business",
        "active",
        Some(&note),
    )
    .await;
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), source, Some("Replying profile"))
        .await
        .expect("source contact");
    assert!(
        fx.state
            .db
            .whatsapp_set_lead(fx.community(), source, &lead_id)
            .await
            .expect("link stop source"),
        "source link is inserted"
    );
    fx.state
        .db
        .whatsapp_record_inbound_safety(fx.community(), source, Some(&lead_id), base(), None, None)
        .await
        .expect("record business reply stop");
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), target, Some("Legacy profile"))
        .await
        .expect("legacy target contact");
    assert!(
        fx.state
            .db
            .whatsapp_mark_lead_link_checked(fx.community(), target, base())
            .await
            .expect("record a recent legacy backfill check"),
        "the sender path, not the earlier backfill page, must resolve this queued contact"
    );
    let queued = buzz_db::whatsapp::NewOutboundMessage {
        id: Uuid::new_v4(),
        wa_id: target.into(),
        kind: "template".into(),
        body: "Hi Thabo".into(),
        template_name: Some("intro".into()),
        template_language: Some("en".into()),
        params: json!(["Thabo"]),
        state: "queued".into(),
        idempotency_key: format!("legacy-unlinked:{}", Uuid::new_v4()),
        batch_id: None,
        batch_idx: None,
        new_chat: false,
        sender_pubkey: fx.owner.public_key().to_bytes().to_vec(),
    };
    fx.state
        .db
        .whatsapp_insert_outbound(fx.community(), &queued)
        .await
        .expect("legacy queued row");

    fx.run_sender(base()).await;

    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), target)
        .await
        .expect("target contact query")
        .expect("legacy target contact remains");
    assert_eq!(contact.lead_id.as_deref(), Some(lead_id.as_str()));
    let message = fx
        .state
        .db
        .whatsapp_get_message(fx.community(), queued.id)
        .await
        .expect("queued row query")
        .expect("queued row remains visible");
    assert_eq!(message.state, "skipped");
    assert!(
        message
            .skip_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("whole business")),
        "the existing business stop, rather than the window check, skips the row"
    );
    assert_eq!(
        fx.graph.send_count(),
        0,
        "the stopped business never reaches Graph"
    );
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
async fn a_local_language_opt_out_is_durable_and_later_sends_are_refused() {
    let fx = fixture().await;
    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &inbound("27821230002", "wamid.IN2", "Yeka imilayezo, ngiyabonga."),
        )
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
    let rule: Option<String> = sqlx::query_scalar(
        "SELECT matched_rule FROM whatsapp_suppressions \
         WHERE community_id = $1 AND identity_kind = 'phone' AND identity_value = $2 \
           AND scope = 'opt_out' AND undone_at IS NULL",
    )
    .bind(fx.community().as_uuid())
    .bind("27821230002")
    .fetch_one(&fx.pool)
    .await
    .expect("durable local-language opt-out rule");
    assert_eq!(rule.as_deref(), Some("zu_yeka_imilayezo"));

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
async fn owner_reply_after_inbound_business_stop_is_queued_and_sent() {
    let fx = fixture().await;
    let wa_id = "27821230024";
    let business_id = "business-owner-reply";
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), wa_id, None)
        .await
        .expect("create linked contact");
    fx.state
        .db
        .whatsapp_set_lead(fx.community(), wa_id, business_id)
        .await
        .expect("link contact to business");

    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &inbound(wa_id, "wamid.OWNER-REPLY-STOP", "Please tell me more."),
        )
        .await,
        StatusCode::OK
    );

    // This exercises the real command handler, enqueue safety check, sender safety recheck,
    // and atomic claim. Before the owner-reply exception it is rejected as a business stop.
    let queued = fx
        .command(
            &fx.owner,
            KIND_WHATSAPP_SEND_REQUEST,
            json!({
                "v": 1,
                "requestId": Uuid::new_v4().to_string(),
                "to": "+27821230024",
                "text": "Thanks for getting back to us.",
            }),
        )
        .await
        .expect("an owner can reply during the open window");
    assert!(queued.message.starts_with("queued"), "{}", queued.message);

    fx.run_sender(Utc::now()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "the queued owner reply reaches Graph"
    );
    assert_eq!(
        fx.graph.sends.lock().expect("sends").last(),
        Some(&SendRequest::Text {
            to: wa_id.into(),
            body: "Thanks for getting back to us.".into(),
        })
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn owner_can_approve_an_existing_agent_text_draft_after_an_inbound_business_stop() {
    let fx = fixture().await;
    let wa_id = "27821230025";
    let business_id = "business-owner-draft-reply";
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
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), wa_id, None)
        .await
        .expect("create linked contact");
    fx.state
        .db
        .whatsapp_set_lead(fx.community(), wa_id, business_id)
        .await
        .expect("link contact to business");
    sqlx::query(
        "UPDATE whatsapp_contacts SET last_inbound_at = $3, outbound_since_inbound = 0 \
         WHERE community_id = $1 AND wa_id = $2",
    )
    .bind(fx.community().as_uuid())
    .bind(wa_id)
    .bind(Utc::now() - Duration::minutes(1))
    .execute(&fx.pool)
    .await
    .expect("open the service window for the draft");

    fx.command(
        &agent,
        KIND_WHATSAPP_SEND_REQUEST,
        json!({
            "v": 1,
            "requestId": Uuid::new_v4().to_string(),
            "to": "+27821230025",
            "text": "Thank you for replying.",
        }),
    )
    .await
    .expect("agent creates a draft before the inbound safety stop");
    let draft = fx
        .state
        .db
        .whatsapp_list_drafts(fx.community(), 10)
        .await
        .expect("list drafts")
        .into_iter()
        .next()
        .expect("one pending draft");

    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &inbound(wa_id, "wamid.OWNER-DRAFT-STOP", "Can we talk this week?"),
        )
        .await,
        StatusCode::OK
    );

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "draftId": draft.id.to_string(), "decision": "approve"}),
    )
    .await
    .expect("owner can approve the in-window free-text draft");
    fx.run_sender(Utc::now()).await;
    assert_eq!(fx.graph.send_count(), 1, "the approved draft reaches Graph");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn an_opt_out_business_stop_blocks_an_owner_reply_to_another_open_contact() {
    let fx = fixture().await;
    let business_id = "business-opt-out-stop";
    let source = "27821230026";
    let other = "27821230027";
    for wa_id in [source, other] {
        fx.state
            .db
            .whatsapp_ensure_contact(fx.community(), wa_id, None)
            .await
            .expect("create linked contact");
        fx.state
            .db
            .whatsapp_set_lead(fx.community(), wa_id, business_id)
            .await
            .expect("link contact to business");
    }
    sqlx::query(
        "UPDATE whatsapp_contacts SET last_inbound_at = $3, outbound_since_inbound = 0 \
         WHERE community_id = $1 AND wa_id = $2",
    )
    .bind(fx.community().as_uuid())
    .bind(other)
    .bind(Utc::now() - Duration::minutes(1))
    .execute(&fx.pool)
    .await
    .expect("open the other contact's service window");

    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &inbound(source, "wamid.BUSINESS-OPTOUT", "STOP")
        )
        .await,
        StatusCode::OK
    );

    // GUARD: an opt-out-caused business stop is never the inbound-reply exception, even where
    // the other contact has an otherwise open free-text window.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_SEND_REQUEST,
            json!({
                "v": 1,
                "requestId": Uuid::new_v4().to_string(),
                "to": "+27821230027",
                "text": "Thank you for your reply.",
            }),
        )
        .await,
    );
    assert!(refusal.contains("whole business"), "{refusal}");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_reply_stops_its_whole_business_and_never_contact_blocks_every_send_fence() {
    let fx = fixture().await;
    let business_id = "business-outreach-safety";
    let first = "+27821230021";
    let second = "+27821230022";
    let batch_id = Uuid::new_v4();
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH,
        batch_for_business(batch_id, business_id, &[first, second]),
    )
    .await
    .expect("prepare linked business batch");
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"}),
    )
    .await
    .expect("approve linked business batch");

    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &inbound(
                "27821230021",
                "wamid.BUSINESS-STOP",
                "Please call tomorrow."
            )
        )
        .await,
        StatusCode::OK
    );
    let stopped_rows = batch_rows(&fx, batch_id).await;
    assert!(
        stopped_rows.iter().all(|row| row.state == "skipped"),
        "every queued business contact must stop after one reply: {stopped_rows:?}"
    );
    assert!(stopped_rows.iter().all(|row| {
        row.skip_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("whole business"))
    }));

    // GUARD: batch preflight and `whatsapp_claim_message` both read the same durable business
    // fence. The direct request proves callers cannot bypass the held batch rows.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_SEND_REQUEST,
            json!({
                "v": 1,
                "requestId": Uuid::new_v4().to_string(),
                "to": second,
                "template": {"name": "intro", "language": "en", "params": ["Thabo"]},
            }),
        )
        .await,
    );
    assert!(refusal.contains("whole business"), "{refusal}");

    let atomic_business_row = buzz_db::whatsapp::NewOutboundMessage {
        id: Uuid::new_v4(),
        wa_id: "27821230022".into(),
        kind: "template".into(),
        body: "Hi Thabo".into(),
        template_name: Some("intro".into()),
        template_language: Some("en".into()),
        params: json!(["Thabo"]),
        state: "queued".into(),
        idempotency_key: format!("business-claim:{}", Uuid::new_v4()),
        batch_id: None,
        batch_idx: None,
        new_chat: false,
        sender_pubkey: fx.owner.public_key().to_bytes().to_vec(),
    };
    fx.state
        .db
        .whatsapp_insert_outbound(fx.community(), &atomic_business_row)
        .await
        .expect("insert stale business row");
    assert!(
        !fx.state
            .db
            .whatsapp_claim_message(
                fx.community(),
                atomic_business_row.id,
                Uuid::new_v4(),
                base() + Duration::minutes(2),
                base(),
            )
            .await
            .expect("business claim result"),
        "the final atomic claim fence rejects a row that predates the reply"
    );

    // GUARD: the direct-command idempotency predicate in `whatsapp_claim_message`. A future
    // relay-owned follow-up is free text and may have an open target window, but it must never
    // inherit the owner-reply exception.
    sqlx::query(
        "UPDATE whatsapp_contacts SET last_inbound_at = $3, outbound_since_inbound = 0 \
         WHERE community_id = $1 AND wa_id = $2",
    )
    .bind(fx.community().as_uuid())
    .bind("27821230022")
    .bind(Utc::now() - Duration::minutes(1))
    .execute(&fx.pool)
    .await
    .expect("open the other contact's service window");
    let automatic_text_row = buzz_db::whatsapp::NewOutboundMessage {
        id: Uuid::new_v4(),
        wa_id: "27821230022".into(),
        kind: "text".into(),
        body: "Automated follow-up".into(),
        template_name: None,
        template_language: None,
        params: json!([]),
        state: "queued".into(),
        idempotency_key: format!("followup:{}", Uuid::new_v4()),
        batch_id: None,
        batch_idx: None,
        new_chat: false,
        sender_pubkey: fx.owner.public_key().to_bytes().to_vec(),
    };
    fx.state
        .db
        .whatsapp_insert_outbound(fx.community(), &automatic_text_row)
        .await
        .expect("insert automatic text row");
    assert!(
        !fx.state
            .db
            .whatsapp_claim_message(
                fx.community(),
                automatic_text_row.id,
                Uuid::new_v4(),
                base() + Duration::minutes(2),
                Utc::now(),
            )
            .await
            .expect("automatic text claim result"),
        "the final atomic claim fence rejects an automatic free-text row after a reply"
    );

    let never_contact = "+27821230023";
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SAFETY_ACTION,
        json!({
            "v": 1,
            "action": "never_contact_add",
            "waId": never_contact,
            "reason": "owner privacy request",
        }),
    )
    .await
    .expect("add never-contact entry");
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_BATCH,
            batch(Uuid::new_v4(), &[never_contact]),
        )
        .await,
    );
    assert!(refusal.contains("never-contact"), "{refusal}");
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), "27821230023", None)
        .await
        .expect("never-contact test contact");
    let atomic_never_contact_row = buzz_db::whatsapp::NewOutboundMessage {
        id: Uuid::new_v4(),
        wa_id: "27821230023".into(),
        kind: "template".into(),
        body: "Hi Thabo".into(),
        template_name: Some("intro".into()),
        template_language: Some("en".into()),
        params: json!(["Thabo"]),
        state: "queued".into(),
        idempotency_key: format!("never-contact-claim:{}", Uuid::new_v4()),
        batch_id: None,
        batch_idx: None,
        new_chat: false,
        sender_pubkey: fx.owner.public_key().to_bytes().to_vec(),
    };
    fx.state
        .db
        .whatsapp_insert_outbound(fx.community(), &atomic_never_contact_row)
        .await
        .expect("insert stale never-contact row");
    assert!(
        !fx.state
            .db
            .whatsapp_claim_message(
                fx.community(),
                atomic_never_contact_row.id,
                Uuid::new_v4(),
                base() + Duration::minutes(2),
                base(),
            )
            .await
            .expect("never-contact claim result"),
        "the final atomic claim fence rejects a row that predates a never-contact decision"
    );

    let (action, detail): (String, Value) = sqlx::query_as(
        "SELECT action, detail FROM audit_log WHERE community_id = $1 AND object_id = $2 \
         ORDER BY seq DESC LIMIT 1",
    )
    .bind(fx.community().as_uuid())
    .bind("27821230023")
    .fetch_one(&fx.pool)
    .await
    .expect("never-contact audit entry");
    assert_eq!(action, "whatsapp_outreach_safety_changed");
    assert_eq!(detail["action"], "never_contact_add");

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SAFETY_ACTION,
        json!({
            "v": 1,
            "action": "never_contact_undo",
            "waId": never_contact,
        }),
    )
    .await
    .expect("undo never-contact entry");
    let (action, detail): (String, Value) = sqlx::query_as(
        "SELECT action, detail FROM audit_log WHERE community_id = $1 AND object_id = $2 \
         ORDER BY seq DESC LIMIT 1",
    )
    .bind(fx.community().as_uuid())
    .bind("27821230023")
    .fetch_one(&fx.pool)
    .await
    .expect("never-contact undo audit entry");
    assert_eq!(action, "whatsapp_outreach_safety_changed");
    assert_eq!(detail["action"], "never_contact_undo");
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

fn sticker_hook(from: &str, wamid: &str, media_id: &str) -> String {
    json!({"object": "whatsapp_business_account", "entry": [{"id": WABA_ID, "changes": [{
    "field": "messages",
    "value": {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "27820000000", "phone_number_id": PHONE_ID},
        "contacts": [{"profile": {"name": "Kensington Guest House"}, "wa_id": from}],
        "messages": [{"from": from, "id": wamid, "timestamp": Utc::now().timestamp().to_string(),
                      "type": "sticker",
                      "sticker": {"id": media_id, "mime_type": "image/webp", "animated": false}}]
    }}]}]})
    .to_string()
}

async fn media_of(fx: &Fixture, wa_id: &str) -> buzz_db::whatsapp::WhatsappMedia {
    let message = fx.thread(wa_id).await.remove(0);
    fx.state
        .db
        .whatsapp_get_media(fx.community(), message.id)
        .await
        .expect("media lookup")
        .expect("the message has a media record")
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn an_inbound_sticker_keeps_its_media_id_and_a_failed_download_leaves_a_retry_record() {
    // GUARD: `whatsapp_set_inbound_media` in `inbound::handle_message`. Without it the sticker
    // is the bare text "[sticker]" and the Meta media id is lost.
    let fx = fixture().await;
    let wa = "27821239001";
    fx.graph.script_media(
        Err(GraphError::Unavailable("timeout".into())),
        Err(DownloadError::Graph(GraphError::Unavailable(
            "timeout".into(),
        ))),
    );
    assert_eq!(
        fx.deliver(APP_SECRET, &sticker_hook(wa, "wamid.STK1", "MEDIA-77"))
            .await,
        StatusCode::OK,
        "a failed download never fails the webhook"
    );
    let row = fx.thread(wa).await.remove(0);
    assert_eq!(
        (row.kind.as_str(), row.body.as_str()),
        ("media", "[sticker]")
    );
    let media = media_of(&fx, wa).await;
    assert_eq!(media.media["mediaId"], "MEDIA-77");
    assert_eq!(media.media["mime"], "image/webp");
    // GUARD: the failure is a durable record with a backoff, not a log line.
    assert_eq!(media.state.as_deref(), Some("pending"));
    assert_eq!(media.attempts, 1);
    assert!(media.retry_at.is_some_and(|at| at > Utc::now()));
    assert_eq!(media.error.as_deref(), Some("timeout"));
    // The chat still has its Colony message, flagged as not downloaded yet.
    let channel = fx.outreach_channel().await;
    let events = channel_events(&fx, channel, wa).await;
    // The thread root and the sticker can share a second, so find the sticker by its tag.
    let posted = events
        .iter()
        .find(|event| event.2.to_string().contains("wa-media"))
        .expect("the sticker was posted");
    assert!(posted.0.contains("still downloading"), "{}", posted.0);

    // A redelivery of the same webhook changes nothing.
    assert_eq!(
        fx.deliver(APP_SECRET, &sticker_hook(wa, "wamid.STK1", "MEDIA-77"))
            .await,
        StatusCode::OK
    );
    assert_eq!(fx.thread(wa).await.len(), 1);
    assert_eq!(media_of(&fx, wa).await.attempts, 1);

    // The thread API tells the app what happened.
    let view =
        crate::api::whatsapp::thread_view(&fx.state, fx.community(), wa, 50, true, Utc::now())
            .await
            .expect("thread");
    assert_eq!(view["messages"][0]["media"]["type"], "sticker");
    assert_eq!(view["messages"][0]["media"]["state"], "pending");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn an_unopenable_token_is_recorded_with_backoff_inline_and_in_sender_repair() {
    let fx = fixture().await;
    // Keep webhook authentication usable, but tamper only with the saved access-token envelope.
    sqlx::query("UPDATE whatsapp_connections SET sealed_token = $2 WHERE community_id = $1")
        .bind(fx.community().as_uuid())
        .bind(vec![0_u8; 32])
        .execute(&fx.pool)
        .await
        .expect("tamper access-token envelope");

    let wa = "27821239008";
    assert_eq!(
        fx.deliver(APP_SECRET, &sticker_hook(wa, "wamid.STK8", "MEDIA-84"))
            .await,
        StatusCode::OK
    );
    let first = media_of(&fx, wa).await;
    assert_eq!(first.state.as_deref(), Some("pending"));
    assert_eq!(first.attempts, 1);
    assert_eq!(first.error.as_deref(), Some("token_unavailable"));
    let first_retry_at = first.retry_at.expect("inline backoff scheduled");
    assert!(first_retry_at > Utc::now());

    // GUARD: an unopenable token also advances the durable backoff instead of leaving this
    // oldest row immediately due on every sender pass.
    let connection = fx
        .state
        .db
        .whatsapp_get_connection(fx.community())
        .await
        .expect("connection lookup")
        .expect("connected number");
    let repair_at = first_retry_at + Duration::seconds(1);
    media::repair(&fx.state, &fx.tenant, &connection, None, repair_at).await;
    let second = media_of(&fx, wa).await;
    assert_eq!(second.state.as_deref(), Some("pending"));
    assert_eq!(second.attempts, 2);
    assert_eq!(second.error.as_deref(), Some("token_unavailable"));
    assert!(second.retry_at.is_some_and(|at| at > repair_at));
    assert_eq!(
        fx.graph.tokens_seen.lock().expect("token lock").len(),
        1,
        "media is not sent to Graph without an opened token"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_file_meta_no_longer_has_is_gone_and_only_a_failed_download_can_be_retried() {
    let fx = fixture().await;
    let wa = "27821239002";
    fx.graph.script_media(
        Err(GraphError::Rejected {
            http_status: 404,
            code: None,
            message: String::new(),
        }),
        Err(DownloadError::TooLarge),
    );
    assert_eq!(
        fx.deliver(APP_SECRET, &sticker_hook(wa, "wamid.STK2", "MEDIA-78"))
            .await,
        StatusCode::OK
    );
    let media = media_of(&fx, wa).await;
    assert_eq!(media.state.as_deref(), Some("gone"));
    assert_eq!(media.error.as_deref(), Some("not_found"));

    let retry = |id: Uuid| update(wa, json!({"retryMedia": id.to_string()}));
    let outcome = fx
        .command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            retry(media.message_id),
        )
        .await
        .expect("owner command");
    assert!(
        outcome.message.contains("nothing to retry"),
        "a gone file is not restarted: {}",
        outcome.message
    );
    assert_eq!(media_of(&fx, wa).await.state.as_deref(), Some("gone"));

    // A download that gave up can be retried by someone who may reply, and nobody else.
    sqlx::query(
        "UPDATE whatsapp_messages SET media_state = 'failed', media_error = 'timeout', \
             media_attempts = 8 WHERE community_id = $1 AND id = $2",
    )
    .bind(fx.community().as_uuid())
    .bind(media.message_id)
    .execute(&fx.pool)
    .await
    .expect("mark failed");
    let stranger = Keys::generate();
    let refusal = rejection(
        fx.command(
            &stranger,
            KIND_WHATSAPP_CONTACT_UPDATE,
            retry(media.message_id),
        )
        .await,
    );
    assert!(refusal.contains("only the owner"), "{refusal}");
    assert_eq!(media_of(&fx, wa).await.state.as_deref(), Some("failed"));
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_CONTACT_UPDATE,
        retry(media.message_id),
    )
    .await
    .expect("owner retries");
    let again = media_of(&fx, wa).await;
    assert_eq!(again.state.as_deref(), Some("pending"));
    assert_eq!(again.attempts, 0);
    assert!(again.retry_at.is_some_and(|at| at <= Utc::now()));
    // Another contact's message id is not retryable through this contact.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update(
                "27821239003",
                json!({"retryMedia": media.message_id.to_string()}),
            ),
        )
        .await,
    );
    assert!(
        refusal.contains("no such media") || refusal.contains("no such contact"),
        "{refusal}"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_file_over_the_cap_is_marked_too_large_and_never_retried() {
    let fx = fixture().await;
    let wa = "27821239004";
    fx.graph.script_media(
        Ok(MediaInfo {
            url: "https://lookaside.fbsbx.com/x".into(),
            mime_type: None,
            sha256: None,
            file_size: Some(super::media::MAX_MEDIA_BYTES + 1),
        }),
        Ok(vec![]),
    );
    assert_eq!(
        fx.deliver(APP_SECRET, &sticker_hook(wa, "wamid.STK3", "MEDIA-79"))
            .await,
        StatusCode::OK
    );
    let media = media_of(&fx, wa).await;
    assert_eq!(media.state.as_deref(), Some("failed"));
    assert_eq!(media.error.as_deref(), Some("too_large"));
    let reset = fx
        .state
        .db
        .whatsapp_media_reset(fx.community(), media.message_id, Utc::now())
        .await
        .expect("reset");
    assert!(!reset, "retrying cannot make a file smaller");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn the_sender_loop_retries_a_due_download_and_leaves_a_not_yet_due_one_alone() {
    let fx = fixture().await;
    let wa = "27821239005";
    fx.graph.script_media(
        Err(GraphError::Unavailable("timeout".into())),
        Err(DownloadError::Graph(GraphError::Unavailable(
            "timeout".into(),
        ))),
    );
    fx.deliver(APP_SECRET, &sticker_hook(wa, "wamid.STK4", "MEDIA-80"))
        .await;
    let first = media_of(&fx, wa).await;
    assert_eq!(first.attempts, 1);
    let retry_at = first.retry_at.expect("scheduled");

    // Before the backoff ends nothing is fetched again.
    fx.run_sender(retry_at - Duration::seconds(5)).await;
    assert_eq!(media_of(&fx, wa).await.attempts, 1);
    // After it, the loop tries again and records the next failure with a longer wait.
    fx.run_sender(retry_at + Duration::seconds(1)).await;
    let second = media_of(&fx, wa).await;
    assert_eq!(second.attempts, 2);
    assert!(second.retry_at.expect("scheduled") > retry_at);
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
async fn payment_recovery_requeues_only_eligible_failed_rows_once() {
    // GUARD: this runs the production Graph trait, sender, signed settings command and durable
    // row transition. Removing the failed-state, account-code or contact opt-out predicate makes
    // an assertion below fail.
    let fx = fixture().await;
    let plain_member = Keys::generate();
    fx.state
        .db
        .add_relay_member(
            fx.community(),
            &plain_member.public_key().to_hex(),
            "member",
            Some(&fx.owner.public_key().to_hex()),
        )
        .await
        .expect("plain relay member");
    let batch_id = approved_batch(
        &fx,
        &[
            "+27820001001",
            "+27820001002",
            "+27820001003",
            "+27820001004",
        ],
    )
    .await;
    let original_keys = batch_row_idempotency_keys(&fx, batch_id).await;

    // These are historic rows that existed before the payment refusal stopped the connection.
    // Create them while the account is still healthy: the production claim fence must reject
    // every attempt made after the actual 131042 below.
    let rows_before_pause = batch_rows(&fx, batch_id).await;
    let contact_refusal_lease = Uuid::new_v4();
    assert!(fx
        .state
        .db
        .whatsapp_claim_message(
            fx.community(),
            rows_before_pause[1].id,
            contact_refusal_lease,
            base() - Duration::minutes(19),
            base() - Duration::minutes(20),
        )
        .await
        .expect("claim recipient failure"));
    assert!(fx
        .state
        .db
        .whatsapp_fail_send(
            fx.community(),
            rows_before_pause[1].id,
            contact_refusal_lease,
            "131026",
            "This number is not on WhatsApp",
        )
        .await
        .expect("record recipient failure"));
    let opted_out_account_lease = Uuid::new_v4();
    assert!(fx
        .state
        .db
        .whatsapp_claim_message(
            fx.community(),
            rows_before_pause[2].id,
            opted_out_account_lease,
            base() - Duration::minutes(9),
            base() - Duration::minutes(10),
        )
        .await
        .expect("claim opted-out account failure"));
    assert!(fx
        .state
        .db
        .whatsapp_fail_send(
            fx.community(),
            rows_before_pause[2].id,
            opted_out_account_lease,
            "131042",
            "Business eligibility payment issue",
        )
        .await
        .expect("record historic account failure"));
    assert!(fx
        .state
        .db
        .whatsapp_opt_out(
            fx.community(),
            &rows_before_pause[2].wa_id,
            "stop",
            base() - Duration::minutes(8),
        )
        .await
        .expect("record late opt-out"));
    fx.graph.script_sends(vec![Err(GraphError::Rejected {
        http_status: 400,
        code: Some(131_042),
        message: "Business eligibility payment issue".into(),
    })]);

    fx.run_sender(base()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "the Graph stub recorded the initial definite payment refusal"
    );
    assert!(
        fx.state
            .db
            .whatsapp_ensure_settings(fx.community())
            .await
            .expect("settings after account refusal")
            .send_paused,
        "GUARD: a 131042 response pauses the connection before more rows can be claimed"
    );
    let rows = batch_rows(&fx, batch_id).await;
    assert_eq!(
        rows.iter()
            .map(|row| row.state.as_str())
            .collect::<Vec<_>>(),
        vec!["failed", "failed", "failed", "ready"],
        "the failed row is durable and later batch rows still wait"
    );
    assert!(
        !fx.state
            .db
            .whatsapp_claim_message(
                fx.community(),
                rows[3].id,
                Uuid::new_v4(),
                base() + Duration::minutes(5),
                base() + Duration::seconds(4),
            )
            .await
            .expect("claim is fenced while account health is paused"),
        "GUARD: a second worker cannot claim a ready row after the first worker records 131042"
    );
    let notices = account_pause_notices(&fx, fx.outreach_channel().await).await;
    assert_eq!(notices.len(), 1, "the new account incident notifies once");
    assert!(notices[0].0.contains("payment problem"), "{:?}", notices[0]);
    let owner_tag = json!(["p", fx.owner.public_key().to_hex()]);
    let plain_member_tag = json!(["p", plain_member.public_key().to_hex()]);
    let tags = notices[0].1.as_array().expect("notice tags");
    assert!(
        tags.iter().any(|tag| tag == &owner_tag),
        "the owner receives the account-health mention"
    );
    assert!(
        !tags.iter().any(|tag| tag == &plain_member_tag),
        "a plain member does not receive the account-health notification"
    );

    let first_resume = fx
        .command(
            &fx.owner,
            KIND_WHATSAPP_SETTINGS,
            json!({"v": 1, "resumeAndRetry": true}),
        )
        .await
        .expect("owner resumes the payment failures");
    assert!(
        first_resume
            .message
            .contains("1 failed message(s) requeued"),
        "{}",
        first_resume.message
    );
    let requeued = batch_rows(&fx, batch_id).await;
    assert_eq!(
        requeued
            .iter()
            .map(|row| row.state.as_str())
            .collect::<Vec<_>>(),
        vec!["ready", "failed", "failed", "ready"],
        "only the eligible payment failure returned to the queue"
    );
    assert_eq!(
        batch_row_idempotency_keys(&fx, batch_id).await,
        original_keys,
        "recovery updates the original rows and leaves every idempotency key intact"
    );

    let second_resume = fx
        .command(
            &fx.owner,
            KIND_WHATSAPP_SETTINGS,
            json!({"v": 1, "resumeAndRetry": true}),
        )
        .await
        .expect("repeated recovery is safe");
    assert!(
        second_resume
            .message
            .contains("nothing to retry: no eligible account-level failed messages"),
        "{}",
        second_resume.message
    );
    fx.run_sender(base() + Duration::minutes(10)).await;
    fx.run_sender(base() + Duration::minutes(10)).await;
    assert_eq!(
        fx.graph.send_count(),
        2,
        "the original payment-refused row is sent once after recovery, never twice"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn engagement_limit_is_contact_only_and_retries_after_the_selected_delay() {
    // GUARD: this uses the production Graph stub, failure classifier, sender loop and signed
    // retryLater command. If 131049 becomes an account failure, the second recipient cannot
    // send and the account-pause assertions below fail.
    let fx = fixture().await;
    let batch_id = approved_batch(&fx, &["+27820001101", "+27820001102"]).await;
    fx.graph.script_sends(vec![
        Err(GraphError::Rejected {
            http_status: 400,
            code: Some(131_049),
            message: "This message was not delivered to maintain healthy ecosystem engagement."
                .into(),
        }),
        Ok(()),
    ]);

    fx.run_sender(base()).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "the first eligible row reaches the Graph stub and is refused only for its contact"
    );
    assert!(
        !fx.state
            .db
            .whatsapp_ensure_settings(fx.community())
            .await
            .expect("settings after engagement refusal")
            .send_paused,
        "131049 must never pause the account queue"
    );
    let rows = batch_rows(&fx, batch_id).await;
    assert_eq!(rows[0].state, "failed");
    assert_eq!(rows[0].error_code.as_deref(), Some("131049"));
    assert_eq!(rows[1].state, "ready");
    let paused = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), &rows[0].wa_id)
        .await
        .expect("limited contact")
        .expect("limited contact exists");
    assert_eq!(paused.pause_reason.as_deref(), Some("Meta error 131049"));
    assert!(paused.retry_after.is_none());
    assert_eq!(
        fx.state
            .db
            .whatsapp_count_failed_messages_by_code(fx.community(), "131049")
            .await
            .expect("engagement summary"),
        1
    );

    // The normal new-chat pacing interval still applies after a refused attempt. On the next
    // eligible pass the second recipient reaches Graph, proving the 131049 contact pause did
    // not become a connection-wide pause.
    fx.run_sender(base() + Duration::minutes(10)).await;
    assert_eq!(
        fx.graph.send_count(),
        2,
        "a 131049 refusal does not stop another contact after normal pacing"
    );
    assert_eq!(batch_rows(&fx, batch_id).await[1].state, "sent");

    // A contact can have more than one historical engagement-limit refusal. The owner selected
    // one message in the thread, so only that exact row may become eligible at the deadline.
    let other_failure_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO whatsapp_messages \
         (community_id, id, wa_id, direction, kind, body, state, error_code, error_text, \
          idempotency_key, new_chat) \
         VALUES ($1, $2, $3, 'out', 'template', 'A later template', 'failed', '131049', \
                 'This message was not delivered to maintain healthy ecosystem engagement.', \
                 $4, TRUE)",
    )
    .bind(fx.community().as_uuid())
    .bind(other_failure_id)
    .bind(&rows[0].wa_id)
    .bind(format!("engagement-limit-{other_failure_id}"))
    .execute(&fx.pool)
    .await
    .expect("second historical engagement failure");

    let scheduled = fx
        .command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            json!({
                "v": 1,
                "waId": rows[0].wa_id,
                "retryLater": {"messageId": rows[0].id.to_string(), "days": 7},
            }),
        )
        .await
        .expect("owner schedules a seven-day retry");
    assert!(
        scheduled.message.contains("7 days"),
        "{}",
        scheduled.message
    );
    let scheduled_contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), &rows[0].wa_id)
        .await
        .expect("scheduled contact")
        .expect("scheduled contact exists");
    let retry_after = scheduled_contact
        .retry_after
        .expect("seven-day retry deadline");
    fx.run_sender(retry_after - Duration::seconds(1)).await;
    assert_eq!(
        fx.graph.send_count(),
        2,
        "the delayed retry cannot re-enter the same day's sender pass"
    );

    let retry_due = retry_after + Duration::seconds(1);
    fx.run_sender(retry_due).await;
    let released = fx
        .state
        .db
        .whatsapp_get_message(fx.community(), rows[0].id)
        .await
        .expect("released retry")
        .expect("released retry exists");
    assert!(
        matches!(released.state.as_str(), "ready" | "sent"),
        "the selected retry is released only after its deadline"
    );

    // A delayed engagement retry returns to the normal queue. It is not Send now, so the
    // first permitted sender window still decides when Graph receives it.
    if released.state != "sent" {
        fx.run_sender(super::policy::next_window_start(retry_due))
            .await;
    }
    assert_eq!(
        fx.graph.send_count(),
        3,
        "the existing row is retried once only after the selected delay and normal send window"
    );
    let retried = fx
        .state
        .db
        .whatsapp_get_message(fx.community(), rows[0].id)
        .await
        .expect("retried message")
        .expect("retried message exists");
    assert_eq!(retried.state, "sent");
    let untouched_failure = fx
        .state
        .db
        .whatsapp_get_message(fx.community(), other_failure_id)
        .await
        .expect("other engagement failure")
        .expect("other engagement failure exists");
    assert_eq!(
        untouched_failure.state, "failed",
        "a per-contact retry only requeues the exact message the owner selected"
    );
    assert!(untouched_failure.send_after.is_none());
    let released_contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), &rows[0].wa_id)
        .await
        .expect("released contact")
        .expect("released contact exists");
    assert!(released_contact.paused_at.is_none());
    assert!(released_contact.retry_after.is_none());
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
    let unknown_id = mine[0].1.id;
    fx.run_sender(base() + Duration::hours(24)).await;
    assert_eq!(
        fx.graph.send_count(),
        1,
        "an unconfirmed row is never resent"
    );

    // GUARD: recovery stays owner-controlled. Checking leaves the original unconfirmed and
    // does not reach Graph; only an explicit, confirmed resend creates one new row.
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
        json!({
            "v": 1,
            "action": "check_status",
            "messageId": unknown_id.to_string(),
            "confirm": false,
        }),
    )
    .await
    .expect("owner checks the unknown outcome");
    assert_eq!(fx.graph.send_count(), 1, "checking does not send");
    let listed = fx
        .state
        .db
        .whatsapp_list_unknown_sends(fx.community(), 10)
        .await
        .expect("list unknown sends");
    assert_eq!(
        listed.iter().map(|message| message.id).collect::<Vec<_>>(),
        vec![unknown_id]
    );

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
        json!({
            "v": 1,
            "action": "resend",
            "messageId": unknown_id.to_string(),
            "confirm": true,
        }),
    )
    .await
    .expect("owner confirms one replacement");
    let original = fx
        .state
        .db
        .whatsapp_get_message(fx.community(), unknown_id)
        .await
        .expect("original lookup")
        .expect("original row");
    assert_eq!(
        original.state, "unconfirmed",
        "the original evidence stays intact"
    );
    let thread = fx.thread("27820000009").await;
    assert_eq!(
        thread
            .iter()
            .filter(|message| message.state == "queued")
            .count(),
        1,
        "one explicit replacement is queued"
    );
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
            json!({
                "v": 1,
                "action": "resend",
                "messageId": unknown_id.to_string(),
                "confirm": true,
            }),
        )
        .await,
    );
    assert!(refusal.contains("already has a replacement"), "{refusal}");

    fx.graph.sabotage_after_send.store(false, Ordering::SeqCst);
    fx.run_sender(base() + Duration::hours(24)).await;
    assert_eq!(
        fx.graph.send_count(),
        2,
        "one owner-confirmed replacement, and no automatic resend, reaches Graph"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn an_owner_can_mark_an_unknown_send_delivered_only_with_confirmation() {
    let fx = fixture().await;
    let wa_id = "27820000010";
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), wa_id, Some("Thabo"))
        .await
        .expect("contact");
    let message_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO whatsapp_messages \
         (community_id, id, wa_id, direction, kind, body, state, idempotency_key, \
          lease_token, lease_until) \
         VALUES ($1, $2, $3, 'out', 'template', 'Hi Thabo', 'sending', $4, $5, $6)",
    )
    .bind(fx.community().as_uuid())
    .bind(message_id)
    .bind(wa_id)
    .bind(format!("mark-delivered:{message_id}"))
    .bind(Uuid::new_v4())
    .bind(base() - Duration::minutes(1))
    .execute(&fx.pool)
    .await
    .expect("simulate expired in-flight send");
    fx.state
        .db
        .whatsapp_expire_leases(base())
        .await
        .expect("turn expired lease into unknown outcome");

    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
            json!({
                "v": 1,
                "action": "mark_delivered",
                "messageId": message_id.to_string(),
                "confirm": false,
            }),
        )
        .await,
    );
    assert!(refusal.contains("requires confirm"), "{refusal}");
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_UNKNOWN_SEND_RECOVERY,
        json!({
            "v": 1,
            "action": "mark_delivered",
            "messageId": message_id.to_string(),
            "confirm": true,
        }),
    )
    .await
    .expect("owner marks delivery after confirmation");
    let message = fx
        .state
        .db
        .whatsapp_get_message(fx.community(), message_id)
        .await
        .expect("message lookup")
        .expect("message exists");
    assert_eq!(message.state, "delivered");
    assert_eq!(fx.graph.send_count(), 0, "marking delivery does not send");
    let (action, detail): (String, Value) = sqlx::query_as(
        "SELECT action, detail FROM audit_log WHERE community_id = $1 AND object_id = $2 \
         ORDER BY seq DESC LIMIT 1",
    )
    .bind(fx.community().as_uuid())
    .bind(message_id.to_string())
    .fetch_one(&fx.pool)
    .await
    .expect("unknown-send audit entry");
    assert_eq!(action, "whatsapp_unknown_send_recovery");
    assert_eq!(detail["action"], "mark_delivered");
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
async fn approved_unsent_batch_contact_is_queued_then_contacted_after_the_send() {
    // GUARD: the production desk read model derives `queued` from ready work, then lets the
    // first persisted send take precedence. The current desktop explicitly advertises the
    // queued-stage capability, so this exercises the same thread contact view that it reads.
    let fx = fixture().await;
    let agent = Keys::generate();
    own_agent(&fx, &agent, &fx.owner).await;
    let wa = "27821230151";
    let batch_id = Uuid::new_v4();
    fx.command(
        &agent,
        KIND_WHATSAPP_BATCH,
        json!({
            "v": 1,
            "batchId": batch_id.to_string(),
            "template": "intro",
            "language": "en",
            "note": "Melville guesthouses",
            "rows": [{"to": format!("+{wa}"), "params": ["Thabo"]}],
        }),
    )
    .await
    .expect("agent prepares batch");
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_BATCH_DECISION,
        json!({"v": 1, "batchId": batch_id.to_string(), "decision": "approve"}),
    )
    .await
    .expect("owner approves batch");

    // 05:00 Johannesburg is outside the sender window, so the approved row remains unsent.
    fx.run_sender(base() - Duration::hours(7)).await;
    let queued = contact_json_current_desktop(&fx, wa).await;
    assert_eq!(queued["stage"], WhatsappStage::Queued.as_str());
    assert_eq!(queued["stageSetBy"], "auto");
    assert_eq!(queued["queuedFrom"], "Batch: Melville guesthouses");
    assert_eq!(queued["lastContactedAt"], Value::Null);

    fx.run_sender(base()).await;
    let contacted = contact_json_current_desktop(&fx, wa).await;
    assert_eq!(contacted["stage"], "contacted");
    assert_eq!(contacted["queuedFrom"], Value::Null);
    assert!(contacted["lastContactedAt"].is_string());
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

/// The read model intentionally does not expose idempotency keys, so this test checks the
/// durable production rows directly while still exercising the signed command and sender seams.
async fn batch_row_idempotency_keys(fx: &Fixture, batch_id: Uuid) -> Vec<(Uuid, String)> {
    sqlx::query(
        "SELECT id, idempotency_key FROM whatsapp_messages \
         WHERE community_id = $1 AND batch_id = $2 ORDER BY batch_idx",
    )
    .bind(fx.community().as_uuid())
    .bind(batch_id)
    .fetch_all(&fx.pool)
    .await
    .expect("batch idempotency rows")
    .iter()
    .map(|row| {
        (
            row.try_get("id").expect("message id"),
            row.try_get("idempotency_key").expect("idempotency key"),
        )
    })
    .collect()
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
async fn owner_pause_command_stops_ready_rows_and_never_replays_an_expired_lease() {
    // GUARD: this sends the exact desktop `sendingPaused` settings payload through the signed
    // command handler, then exercises the production lease-expiry and sender paths. Removing
    // the handler field, the durable pause fence, or the sender pause check makes this fail.
    let fx = fixture().await;
    let batch_id = approved_batch(&fx, &["+27820000071", "+27820000072"]).await;
    let rows = batch_rows(&fx, batch_id).await;
    let lease = Uuid::new_v4();
    assert!(fx
        .state
        .db
        .whatsapp_claim_message(
            fx.community(),
            rows[0].id,
            lease,
            base() + Duration::minutes(1),
            base(),
        )
        .await
        .expect("claim the in-flight row"));

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SETTINGS,
        json!({"v": 1, "sendingPaused": true}),
    )
    .await
    .expect("the owner pause command is accepted");

    let settings = fx
        .state
        .db
        .whatsapp_ensure_settings(fx.community())
        .await
        .expect("settings after owner pause");
    assert!(settings.send_paused, "the account is durably paused");
    assert_eq!(settings.pause_reason.as_deref(), Some("owner paused"));
    assert!(settings.owner_paused, "the owner pause has its own source");
    let owner_pubkey = fx.owner.public_key().to_bytes();
    assert_eq!(
        settings.owner_paused_by.as_deref(),
        Some(owner_pubkey.as_slice()),
        "the status identifies who paused sending"
    );
    assert!(
        settings.owner_paused_at.is_some(),
        "the status identifies when the owner pause started"
    );
    let status = connect::status_view(&fx.state, &fx.tenant)
        .await
        .expect("owner pause status projection");
    assert_eq!(status["sendingPaused"], json!(true));
    assert_eq!(status["pauseReason"], json!("owner paused"));
    assert_eq!(status["ownerPaused"], json!(true));
    assert_eq!(status["ownerPausedBy"], json!(hex::encode(owner_pubkey)));
    assert!(status["ownerPausedAt"].as_str().is_some());
    let (action, actor, detail): (String, Vec<u8>, Value) = sqlx::query_as(
        "SELECT action, actor_pubkey, detail FROM audit_log \
         WHERE community_id = $1 AND object_id = 'whatsapp-sending' \
         ORDER BY seq DESC LIMIT 1",
    )
    .bind(fx.community().as_uuid())
    .fetch_one(&fx.pool)
    .await
    .expect("owner pause audit entry");
    assert_eq!(action, "whatsapp_sending_pause_changed");
    assert_eq!(actor, owner_pubkey);
    assert_eq!(detail["paused"], json!(true));
    assert_eq!(detail["reason"], json!("owner paused"));

    // The sender can have listed this row before the owner command committed. The production
    // claim is the final durable fence before Graph, so it must still refuse that race.
    assert!(
        !fx.state
            .db
            .whatsapp_claim_message(
                fx.community(),
                rows[1].id,
                Uuid::new_v4(),
                base() + Duration::minutes(3),
                base() + Duration::minutes(2),
            )
            .await
            .expect("paused rows cannot be claimed"),
        "the final claim fence rejects a row queued before the owner pause"
    );

    let mut last_phone_refresh = HashMap::new();
    let mut last_template_sync = HashMap::new();
    sender::tick(
        &fx.state,
        base() + Duration::minutes(2),
        &mut last_phone_refresh,
        &mut last_template_sync,
    )
    .await
    .expect("sender tick while paused");

    assert_eq!(
        fx.graph.send_count(),
        0,
        "a paused account reaches no Graph send"
    );
    let rows = batch_rows(&fx, batch_id).await;
    assert_eq!(
        rows[0].state, "unconfirmed",
        "an expired in-flight lease is never returned to the send queue"
    );
    assert_eq!(rows[1].state, "ready", "the untouched row stays queued");

    // The quality reader owns only its own source. Recovery must not erase the owner pause.
    connect::apply_phone_info(
        &fx.state,
        &fx.tenant,
        &PhoneInfo {
            display_phone_number: Some("+27 82 000 0000".into()),
            verified_name: Some("Horizon Labs".into()),
            quality_rating: Some("RED".into()),
            status: Some("CONNECTED".into()),
        },
    )
    .await;
    let quality_red = fx
        .state
        .db
        .whatsapp_ensure_settings(fx.community())
        .await
        .expect("settings after quality red");
    assert!(quality_red.owner_paused);
    assert!(quality_red.quality_paused);
    assert_eq!(quality_red.pause_reason.as_deref(), Some("owner paused"));

    connect::apply_phone_info(
        &fx.state,
        &fx.tenant,
        &PhoneInfo {
            display_phone_number: Some("+27 82 000 0000".into()),
            verified_name: Some("Horizon Labs".into()),
            quality_rating: Some("GREEN".into()),
            status: Some("CONNECTED".into()),
        },
    )
    .await;
    let quality_recovered = fx
        .state
        .db
        .whatsapp_ensure_settings(fx.community())
        .await
        .expect("settings after quality recovery");
    assert!(quality_recovered.owner_paused);
    assert!(!quality_recovered.quality_paused);
    assert!(quality_recovered.send_paused);

    fx.command(
        &fx.owner,
        KIND_WHATSAPP_SETTINGS,
        json!({"v": 1, "sendingPaused": false}),
    )
    .await
    .expect("the owner resume command is accepted");
    let resumed = fx
        .state
        .db
        .whatsapp_ensure_settings(fx.community())
        .await
        .expect("settings after owner resume");
    assert!(!resumed.owner_paused);
    assert!(!resumed.quality_paused);
    assert!(!resumed.send_paused);
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
        .whatsapp_set_quality_send_paused(fx.community(), true)
        .await
        .expect("quality stop");
    fx.run_sender(night()).await;
    assert_eq!(fx.graph.send_count(), 0, "a quality stop beats send_now");

    fx.state
        .db
        .whatsapp_set_quality_send_paused(fx.community(), false)
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

/// Seed a contact created a day ago, with one inbound text, one inbound button and one sent
/// template, all a day old and all without a Colony message: what production held after the
/// first outreach batch on 30 Oct.
async fn seed_old_unposted_chat(fx: &Fixture, wa_id: &str, profile_name: &str) {
    let day_ago = Utc::now() - Duration::days(1);
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), wa_id, Some(profile_name))
        .await
        .expect("contact");
    sqlx::query(
        "UPDATE whatsapp_contacts SET created_at = $3 WHERE community_id = $1 AND wa_id = $2",
    )
    .bind(fx.community().as_uuid())
    .bind(wa_id)
    .bind(day_ago)
    .execute(&fx.pool)
    .await
    .expect("backdate the contact");
    sqlx::query(
        "INSERT INTO whatsapp_messages \
         (community_id, id, wa_id, direction, kind, body, state, wamid, sent_at, created_at) \
         VALUES ($1, $2, $3, 'out', 'template', 'Hi, it is Sam.', 'read', $4, $5, $5)",
    )
    .bind(fx.community().as_uuid())
    .bind(Uuid::new_v4())
    .bind(wa_id)
    .bind(format!("wamid.OUT{wa_id}"))
    .bind(day_ago)
    .execute(&fx.pool)
    .await
    .expect("sent template");
    for (offset, kind, body) in [(60, "button", "Yes, call me"), (120, "text", "Thanks")] {
        fx.state
            .db
            .whatsapp_insert_inbound(
                fx.community(),
                wa_id,
                kind,
                body,
                &format!("wamid.IN{offset}{wa_id}"),
                day_ago + Duration::seconds(offset),
            )
            .await
            .expect("inbound")
            .expect("new row");
    }
}

async fn channel_events(
    fx: &Fixture,
    channel: Uuid,
    wa_id: &str,
) -> Vec<(String, DateTime<Utc>, Value)> {
    sqlx::query_as::<_, (String, DateTime<Utc>, Value)>(
        "SELECT content, created_at, tags FROM events \
         WHERE community_id = $1 AND channel_id = $2 AND kind = 9 \
           AND tags @> jsonb_build_array(jsonb_build_array('wa', $3::text)) \
         ORDER BY created_at, id",
    )
    .bind(fx.community().as_uuid())
    .bind(channel)
    .bind(wa_id)
    .fetch_all(&fx.pool)
    .await
    .expect("channel events")
}

async fn account_pause_notices(fx: &Fixture, channel: Uuid) -> Vec<(String, Value)> {
    sqlx::query_as::<_, (String, Value)>(
        "SELECT content, tags FROM events \
         WHERE community_id = $1 AND channel_id = $2 AND kind = 9 \
           AND tags @> jsonb_build_array(jsonb_build_array('wa-notice', 'account_sending_paused')) \
         ORDER BY created_at, id",
    )
    .bind(fx.community().as_uuid())
    .bind(channel)
    .fetch_all(&fx.pool)
    .await
    .expect("account-pause notices")
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn rows_unposted_for_a_day_post_by_themselves_under_the_replica_fence() {
    // GUARD (self-heal): production held three rows of a contact created a day earlier. The
    // thread root was signed with `contact.created_at` and each reply with the message time, so
    // the 960 s replica-fence floor refused every attempt, every 5 s, for ever.
    // `channel::fence_safe_time` stamps them inside the floor; `repair_unposted` then posts them.
    let fx = fence_fixture().await;
    let channel = fx.outreach_channel().await;
    let wa_id = "27683735905";
    seed_old_unposted_chat(&fx, wa_id, ".").await;
    assert!(channel_events(&fx, channel, wa_id).await.is_empty());

    let now = Utc::now();
    sender::repair_unposted(&fx.state, &fx.tenant, Some(channel), now).await;

    let contact = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), wa_id)
        .await
        .expect("contact")
        .expect("exists");
    let root = contact
        .thread_root_event_id
        .expect("the thread root is recorded");
    let events = channel_events(&fx, channel, wa_id).await;
    assert_eq!(events.len(), 4, "one root and three posts: {events:?}");
    let roots: Vec<_> = events
        .iter()
        .filter(|(content, _, _)| content.starts_with("WhatsApp: "))
        .collect();
    assert_eq!(roots.len(), 1, "exactly one thread root");
    // GUARD: a profile name of "." shows the number.
    assert_eq!(roots[0].0, "WhatsApp: +27683735905 (+27683735905)");
    let root_at = roots[0].1;
    let floor = Duration::seconds(buzz_db::replica_fence::CREATED_AT_FLOOR_SECS);
    for (content, at, _) in &events {
        assert!(now - *at < floor, "{content:?} at {at} is inside the fence");
        assert!(*at >= root_at, "{content:?} is never before its root");
    }
    for message in fx.thread(wa_id).await {
        let event = message
            .event_id
            .expect("every message has its Colony event");
        assert_ne!(event, root, "a reply, not the root");
    }

    // A second pass has nothing left to do: still one root, no duplicates.
    sender::repair_unposted(
        &fx.state,
        &fx.tenant,
        Some(channel),
        now + Duration::seconds(5),
    )
    .await;
    assert_eq!(channel_events(&fx, channel, wa_id).await.len(), 4);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_stale_contact_copy_joins_the_thread_root_that_already_won() {
    // GUARD: `ensure_thread_root` re-reads the contact before it posts, and
    // `whatsapp_set_thread_root` reports a lost compare-and-set, so two racing first posts end
    // with ONE recorded root and every reply under it.
    let fx = fence_fixture().await;
    let channel = fx.outreach_channel().await;
    let wa_id = "27683735906";
    seed_old_unposted_chat(&fx, wa_id, "Lerato").await;
    let stale = fx
        .state
        .db
        .whatsapp_get_contact(fx.community(), wa_id)
        .await
        .expect("contact")
        .expect("exists");
    assert!(stale.thread_root_event_id.is_none());

    let first = super::channel::ensure_thread_root(&fx.state, &fx.tenant, channel, &stale)
        .await
        .expect("first root");
    // The racer holds the same stale copy (no root yet) and must land on the same root.
    let second = super::channel::ensure_thread_root(&fx.state, &fx.tenant, channel, &stale)
        .await
        .expect("second root");
    assert_eq!(first, second);
    assert!(
        !fx.state
            .db
            .whatsapp_set_thread_root(fx.community(), wa_id, &[7u8; 32])
            .await
            .expect("set again"),
        "the first writer wins"
    );
    let roots = channel_events(&fx, channel, wa_id)
        .await
        .into_iter()
        .filter(|(content, _, _)| content.starts_with("WhatsApp: Lerato"))
        .count();
    assert_eq!(roots, 1);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_post_that_keeps_failing_backs_off_then_gives_up_without_starving_other_rows() {
    // GUARD: `repair_unposted` used to retry the same failing rows every 5 s for ever, and 25
    // such rows would have starved every row behind them (AGENTS.md rules 1 and 4).
    let fx = fixture().await;
    let wa_id = "27683735907";
    seed_old_unposted_chat(&fx, wa_id, "Thabo").await;
    // A channel that does not exist: every post is refused, which stands for a permanent failure.
    let missing = Some(Uuid::new_v4());
    let attempts = || async {
        sqlx::query_scalar::<_, i32>(
            "SELECT COALESCE(sum(post_attempts), 0)::int FROM whatsapp_messages \
             WHERE community_id = $1 AND wa_id = $2",
        )
        .bind(fx.community().as_uuid())
        .bind(wa_id)
        .fetch_one(&fx.pool)
        .await
        .expect("attempts")
    };

    let t0 = Utc::now();
    sender::repair_unposted(&fx.state, &fx.tenant, missing, t0).await;
    assert_eq!(attempts().await, 3, "each of the three rows tried once");
    // Inside the first backoff (5 s) nothing is tried.
    sender::repair_unposted(&fx.state, &fx.tenant, missing, t0 + Duration::seconds(2)).await;
    assert_eq!(attempts().await, 3, "no retry inside the backoff");
    // After it, each row is tried again, and the wait doubles.
    sender::repair_unposted(&fx.state, &fx.tenant, missing, t0 + Duration::seconds(6)).await;
    assert_eq!(attempts().await, 6);
    sender::repair_unposted(&fx.state, &fx.tenant, missing, t0 + Duration::seconds(10)).await;
    assert_eq!(attempts().await, 6, "the second wait is 10 s");

    // Hours apart the rows keep failing until they give up for good.
    let mut at = t0 + Duration::seconds(6);
    for _ in 0..40 {
        at += Duration::hours(2);
        sender::repair_unposted(&fx.state, &fx.tenant, missing, at).await;
    }
    let total = attempts().await;
    assert_eq!(
        total,
        3 * buzz_db::whatsapp::POST_MAX_ATTEMPTS,
        "stops at the cap"
    );
    let gave_up: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM whatsapp_messages \
         WHERE community_id = $1 AND wa_id = $2 AND post_gave_up_at IS NOT NULL",
    )
    .bind(fx.community().as_uuid())
    .bind(wa_id)
    .fetch_one(&fx.pool)
    .await
    .expect("gave up");
    assert_eq!(gave_up, 3);
    sender::repair_unposted(&fx.state, &fx.tenant, missing, at + Duration::days(30)).await;
    assert_eq!(attempts().await, total, "a row that gave up is not retried");

    // Backed-off rows leave the list, so a healthy row behind 25 failing ones is reached.
    let other = "27683735908";
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), other, Some("Nomsa"))
        .await
        .expect("contact");
    let mut ids = Vec::new();
    for index in 0..26 {
        let id = fx
            .state
            .db
            .whatsapp_insert_inbound(
                fx.community(),
                other,
                "text",
                "hello",
                &format!("wamid.STARVE{index:02}"),
                t0 + Duration::seconds(index),
            )
            .await
            .expect("inbound")
            .expect("new row");
        ids.push(id);
    }
    let now = t0;
    let first_page = fx
        .state
        .db
        .whatsapp_list_unposted(fx.community(), 25, now)
        .await
        .expect("list");
    assert_eq!(first_page.len(), 25);
    for message in &first_page {
        fx.state
            .db
            .whatsapp_note_post_failure(fx.community(), message.id, now)
            .await
            .expect("note failure");
    }
    let next = fx
        .state
        .db
        .whatsapp_list_unposted(fx.community(), 25, now)
        .await
        .expect("list");
    assert!(
        next.iter().any(|message| ids.contains(&message.id)),
        "a row behind the failing page is reached"
    );
    assert!(next
        .iter()
        .all(|m| !first_page.iter().any(|f| f.id == m.id)));
}

// ── Outreach desk: stage, label, views ─────────────────────────────────────────────────────

/// The contact as the app reads it (`thread` answer), with the desk fields.
async fn contact_json(fx: &Fixture, wa_id: &str) -> Value {
    crate::api::whatsapp::thread_view(&fx.state, fx.community(), wa_id, 50, true, Utc::now())
        .await
        .expect("thread view")["contact"]
        .clone()
}

/// The contact as desktop 3.0.38 reads it. `whatsappOutreachApi.test.mjs` binds this capability
/// marker to every desktop query; the no-marker helper above deliberately remains legacy-safe.
async fn contact_json_current_desktop(fx: &Fixture, wa_id: &str) -> Value {
    crate::api::whatsapp::thread_view_for_capability(
        &fx.state,
        fx.community(),
        wa_id,
        50,
        true,
        Utc::now(),
        true,
    )
    .await
    .expect("current desktop thread view")["contact"]
        .clone()
}

/// An inbound button tap with an explicit time and the message it answers.
fn tap_at(
    from: &str,
    wamid: &str,
    title: &str,
    context: Option<&str>,
    at: DateTime<Utc>,
) -> String {
    let mut message = json!({"from": from, "id": wamid, "timestamp": at.timestamp().to_string(),
                      "type": "button", "button": {"text": title, "payload": "x"}});
    if let Some(context) = context {
        message["context"] = json!({"from": "27820000000", "id": context});
    }
    json!({"object": "whatsapp_business_account", "entry": [{"id": WABA_ID, "changes": [{
    "field": "messages",
    "value": {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "27820000000", "phone_number_id": PHONE_ID},
        "contacts": [{"profile": {"name": "Naledi"}, "wa_id": from}],
        "messages": [message]
    }}]}]})
    .to_string()
}

/// An outbound template row that reached the contact, as a delivered opener does.
async fn seed_opener(fx: &Fixture, wa_id: &str, wamid: &str, state: &str, code: Option<&str>) {
    fx.state
        .db
        .whatsapp_ensure_contact(fx.community(), wa_id, None)
        .await
        .expect("contact");
    sqlx::query(
        "INSERT INTO whatsapp_messages (community_id, id, wa_id, direction, kind, body, \
             template_name, template_language, state, wamid, error_code, sent_at, created_at) \
         VALUES ($1, $2, $3, 'out', 'template', 'Hi', 'intro', 'en', $4, $5, $6, now() - interval '2 hours', now() - interval '2 hours')",
    )
    .bind(fx.community().as_uuid())
    .bind(Uuid::new_v4())
    .bind(wa_id)
    .bind(state)
    .bind(wamid)
    .bind(code)
    .execute(&fx.pool)
    .await
    .expect("seed opener");
}

async fn set_template_buttons(fx: &Fixture, buttons: Value) {
    sqlx::query(
        "UPDATE whatsapp_templates SET buttons = $2 WHERE community_id = $1 AND name = 'intro'",
    )
    .bind(fx.community().as_uuid())
    .bind(buttons)
    .execute(&fx.pool)
    .await
    .expect("set template buttons");
}

fn update(wa_id: &str, body: Value) -> Value {
    let mut content = json!({"v": 1, "waId": wa_id});
    content
        .as_object_mut()
        .expect("object")
        .extend(body.as_object().expect("object").clone());
    content
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn only_people_who_may_reply_can_change_a_stage_or_name_and_every_change_is_audited() {
    // GUARD: `Access::can_send` check in `handle_contact_update`. Without it the plain member
    // below moves the card.
    let fx = fixture().await;
    let wa = "27821230101";
    seed_opener(&fx, wa, "wamid.OUT-A", "delivered", None).await;

    let member = Keys::generate();
    let refusal = rejection(
        fx.command(
            &member,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update(wa, json!({"stage": "client"})),
        )
        .await,
    );
    assert!(
        refusal.contains("only the owner, admins, their agents and Outreach members"),
        "{refusal}"
    );
    let refusal = rejection(
        fx.command(
            &member,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update(wa, json!({"label": "Mine now"})),
        )
        .await,
    );
    assert!(refusal.contains("only the owner"), "{refusal}");
    let view = contact_json(&fx, wa).await;
    assert_eq!(view["stage"], "contacted", "a refused change moves nothing");
    assert_eq!(view["label"], Value::Null);

    // Owner, admin, Scout (an agent owned by the owner) and an Outreach channel member.
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
    let scout = Keys::generate();
    own_agent(&fx, &scout, &fx.owner).await;
    let outreach = Keys::generate();
    fx.state
        .db
        .add_member(
            fx.community(),
            fx.outreach_channel().await,
            &outreach.public_key().to_bytes(),
            MemberRole::Member,
            Some(&fx.owner.public_key().to_bytes()),
        )
        .await
        .expect("outreach member");
    for (who, keys, stage) in [
        ("owner", &fx.owner, "replied"),
        ("admin", &admin, "wants_call"),
        ("scout", &scout, "quote_sent"),
        ("outreach member", &outreach, "no_thanks"),
    ] {
        fx.command(
            keys,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update(wa, json!({"stage": stage})),
        )
        .await
        .unwrap_or_else(|error| panic!("{who} may set a stage: {error:?}"));
        let view = contact_json(&fx, wa).await;
        assert_eq!(view["stage"], stage, "{who}");
        assert_eq!(view["stageSetBy"], keys.public_key().to_hex(), "{who}");
    }

    // Facts cannot be set; neither can a word that is not a stage.
    for bad in ["queued", "stopped", "not_on_whatsapp", "won", "none"] {
        let refusal = rejection(
            fx.command(
                &fx.owner,
                KIND_WHATSAPP_CONTACT_UPDATE,
                update(wa, json!({"stage": bad})),
            )
            .await,
        );
        assert!(refusal.contains("stage must be"), "{bad}: {refusal}");
    }
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update(wa, json!({})),
        )
        .await,
    );
    assert!(refusal.contains("nothing to change"), "{refusal}");

    // Label: set shows everywhere, the profile name stays secondary, null clears it.
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_CONTACT_UPDATE,
        update(wa, json!({"label": "  Plane   Tree Hotel "})),
    )
    .await
    .expect("rename");
    let view = contact_json(&fx, wa).await;
    assert_eq!(view["label"], "Plane Tree Hotel");
    assert_eq!(view["displayName"], "Plane Tree Hotel");
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_CONTACT_UPDATE,
        update(wa, json!({"label": null})),
    )
    .await
    .expect("clear");
    let view = contact_json(&fx, wa).await;
    assert_eq!(view["label"], Value::Null);
    assert_eq!(
        view["displayName"], "+27821230101",
        "no profile name yet: the number"
    );
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update(wa, json!({"label": "   "})),
        )
        .await,
    );
    assert!(refusal.contains("label is empty"), "{refusal}");
    let unknown = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update("27821239999", json!({"stage": "client"})),
        )
        .await,
    );
    assert!(unknown.contains("no such contact"), "{unknown}");

    // Audit: 4 stage changes + set label + clear label, none for the refused ones.
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE community_id = $1 AND action = 'whatsapp_contact_updated'",
    )
    .bind(fx.community().as_uuid())
    .fetch_one(&fx.pool)
    .await
    .expect("audit count");
    assert_eq!(audited, 6, "every accepted change is audited");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_manual_stage_holds_against_older_facts_and_gives_way_to_a_newer_positive_tap() {
    // GUARD: precedence in `buzz_core::whatsapp_stage::derive_stage`, read through the view.
    let fx = fixture().await;
    let wa = "27821230102";
    seed_opener(&fx, wa, "wamid.OUT-B", "delivered", None).await;
    set_template_buttons(
        &fx,
        json!([{"type": "QUICK_REPLY", "text": "Yes, call me"}, {"type": "QUICK_REPLY", "text": "No thanks"}]),
    )
    .await;
    let view = contact_json(&fx, wa).await;
    assert_eq!(view["stage"], "contacted");
    assert_eq!(view["stageSetBy"], "auto");
    assert!(view["lastContactedAt"].is_string());
    assert_eq!(view["lastOutboundState"], "delivered");

    // The owner moves it to call_booked; a plain reply later does not pull it back.
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_CONTACT_UPDATE,
        update(wa, json!({"stage": "call_booked"})),
    )
    .await
    .expect("move");
    assert_eq!(
        fx.deliver(APP_SECRET, &inbound(wa, "wamid.IN-B1", "ok thanks"))
            .await,
        StatusCode::OK
    );
    let view = contact_json(&fx, wa).await;
    assert_eq!(
        view["stage"], "call_booked",
        "never backwards automatically"
    );
    assert_eq!(view["stageSetBy"], fx.owner.public_key().to_hex());
    assert!(view["lastReplyAt"].is_string());

    // Moved down by hand, the owner's word beats the older reply too.
    fx.command(
        &fx.owner,
        KIND_WHATSAPP_CONTACT_UPDATE,
        update(wa, json!({"stage": "contacted"})),
    )
    .await
    .expect("move down");
    assert_eq!(contact_json(&fx, wa).await["stage"], "contacted");

    // A NEWER tap on the first quick-reply button implies a later stage and wins.
    let later = Utc::now() + Duration::minutes(5);
    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &tap_at(
                wa,
                "wamid.IN-B2",
                "Yes, call me",
                Some("wamid.OUT-B"),
                later
            )
        )
        .await,
        StatusCode::OK
    );
    let view = contact_json(&fx, wa).await;
    assert_eq!(view["stage"], "wants_call");
    assert_eq!(view["stageSetBy"], "auto");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn no_thanks_and_stop_both_opt_out_but_read_as_different_stages() {
    // GUARD: `classify_opt_out` stores the reason; `OptOutKind::from_reason` reads it.
    let fx = fixture().await;
    let community = fx.community();
    let reason_of = |wa: &'static str| {
        let fx = &fx;
        async move {
            fx.state
                .db
                .whatsapp_get_contact(fx.community(), wa)
                .await
                .expect("contact")
                .expect("exists")
        }
    };

    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &button_tap("27821230111", "wamid.IN-N1", "No thanks")
        )
        .await,
        StatusCode::OK
    );
    let contact = reason_of("27821230111").await;
    assert!(
        contact.opted_out_at.is_some(),
        "No thanks still blocks sending"
    );
    assert_eq!(contact.opt_out_reason.as_deref(), Some("no_thanks"));
    assert_eq!(contact_json(&fx, "27821230111").await["stage"], "no_thanks");
    assert_eq!(contact_json(&fx, "27821230111").await["optedOut"], true);

    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &button_tap("27821230112", "wamid.IN-N2", "Stop messages")
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        reason_of("27821230112").await.opt_out_reason.as_deref(),
        Some("stop")
    );
    assert_eq!(contact_json(&fx, "27821230112").await["stage"], "stopped");

    assert_eq!(
        fx.deliver(APP_SECRET, &inbound("27821230113", "wamid.IN-N3", "STOP"))
            .await,
        StatusCode::OK
    );
    assert_eq!(contact_json(&fx, "27821230113").await["stage"], "stopped");

    // A row from before the desk ("asked to stop") reads as stopped.
    fx.state
        .db
        .whatsapp_ensure_contact(community, "27821230114", Some("Old"))
        .await
        .expect("contact");
    fx.state
        .db
        .whatsapp_opt_out(community, "27821230114", "asked to stop", Utc::now())
        .await
        .expect("opt out");
    assert_eq!(contact_json(&fx, "27821230114").await["stage"], "stopped");

    // An opted-out contact cannot be moved by hand: the stage would show nothing.
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update("27821230111", json!({"stage": "client"})),
        )
        .await,
    );
    assert!(refusal.contains("cannot be changed"), "{refusal}");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_tap_on_the_templates_first_quick_reply_button_wants_a_call() {
    // GUARD: `tap_means_wants_call` reads the stored template buttons through the tapped
    // message; the literal texts are only the fallback for an unknown template.
    let fx = fixture().await;
    for (wa, wamid) in [
        ("27821230121", "wamid.OUT-W1"),
        ("27821230122", "wamid.OUT-W2"),
        ("27821230123", "wamid.OUT-W3"),
    ] {
        seed_opener(&fx, wa, wamid, "delivered", None).await;
    }
    let now = Utc::now();

    // First button "Send me a quote" (not a literal text we know): tapping it counts.
    set_template_buttons(
        &fx,
        json!([{"type": "QUICK_REPLY", "text": "Send me a quote"}, {"type": "QUICK_REPLY", "text": "No thanks"}]),
    )
    .await;
    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &tap_at(
                "27821230121",
                "wamid.IN-W1",
                "Send me a quote",
                Some("wamid.OUT-W1"),
                now
            )
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        contact_json(&fx, "27821230121").await["stage"],
        "wants_call"
    );

    // The literal "Yes, call me" on a template whose first button is something else is just a reply.
    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &tap_at(
                "27821230122",
                "wamid.IN-W2",
                "Yes, call me",
                Some("wamid.OUT-W2"),
                now
            )
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(contact_json(&fx, "27821230122").await["stage"], "replied");

    // Redelivery of the same tap changes nothing (idempotent).
    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &tap_at(
                "27821230121",
                "wamid.IN-W1",
                "Send me a quote",
                Some("wamid.OUT-W1"),
                now
            )
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        contact_json(&fx, "27821230121").await["stage"],
        "wants_call"
    );

    // No context (template unknown): the literal fallback applies.
    assert_eq!(
        fx.deliver(
            APP_SECRET,
            &tap_at("27821230123", "wamid.IN-W3", "Yes, tell me more", None, now)
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        contact_json(&fx, "27821230123").await["stage"],
        "wants_call"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_failed_send_with_the_meta_undeliverable_code_is_not_on_whatsapp_until_a_later_send_lands(
) {
    let fx = fixture().await;
    let wa = "27821230131";
    seed_opener(&fx, wa, "wamid.OUT-F1", "failed", Some("131026")).await;
    assert_eq!(contact_json(&fx, wa).await["stage"], "not_on_whatsapp");
    assert_eq!(contact_json(&fx, wa).await["lastOutboundState"], "failed");

    // Another failure code (a spam block) is not "not on WhatsApp".
    let other = "27821230132";
    seed_opener(&fx, other, "wamid.OUT-F2", "failed", Some("131049")).await;
    assert_ne!(contact_json(&fx, other).await["stage"], "not_on_whatsapp");

    // A newer message that reached the contact clears it.
    sqlx::query(
        "INSERT INTO whatsapp_messages (community_id, id, wa_id, direction, kind, body, state, wamid, sent_at, created_at) \
         VALUES ($1, $2, $3, 'out', 'text', 'Hello again', 'sent', 'wamid.OUT-F3', now(), now())",
    )
    .bind(fx.community().as_uuid())
    .bind(Uuid::new_v4())
    .bind(wa)
    .execute(&fx.pool)
    .await
    .expect("later send");
    assert_eq!(contact_json(&fx, wa).await["stage"], "contacted");

    // A manual move is refused while the number is unreachable.
    let blocked = "27821230133";
    seed_opener(&fx, blocked, "wamid.OUT-F4", "failed", Some("131026")).await;
    let refusal = rejection(
        fx.command(
            &fx.owner,
            KIND_WHATSAPP_CONTACT_UPDATE,
            update(blocked, json!({"stage": "client"})),
        )
        .await,
    );
    assert!(refusal.contains("cannot be changed"), "{refusal}");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn contact_pages_and_stage_counts_cover_every_contact_not_one_capped_page() {
    // GUARD: the desktop used to ask for one page of 200 and count its stages, so a community
    // with 429 contacts read 62 Contacted instead of 174. Paging must reach every contact
    // exactly once, and the counts must come from all of them whatever the page size.
    const TOTAL: usize = 450;
    let fx = fixture().await;
    for i in 0..TOTAL {
        let wa = format!("2782{i:07}");
        match i % 5 {
            // Never messaged.
            0 => {
                fx.state
                    .db
                    .whatsapp_ensure_contact(fx.community(), &wa, None)
                    .await
                    .expect("contact");
            }
            // Opener delivered.
            1 => seed_opener(&fx, &wa, &format!("wamid.PAGE-{i}"), "delivered", None).await,
            // Opener failed for a reason other than "not on WhatsApp".
            2 => {
                seed_opener(
                    &fx,
                    &wa,
                    &format!("wamid.PAGE-{i}"),
                    "failed",
                    Some("131049"),
                )
                .await
            }
            // Opener failed because the number is not on WhatsApp.
            3 => {
                seed_opener(
                    &fx,
                    &wa,
                    &format!("wamid.PAGE-{i}"),
                    "failed",
                    Some("131026"),
                )
                .await
            }
            // They wrote first.
            _ => {
                fx.state
                    .db
                    .whatsapp_ensure_contact(fx.community(), &wa, None)
                    .await
                    .expect("contact");
                fx.state
                    .db
                    .whatsapp_touch_inbound(
                        fx.community(),
                        &wa,
                        base() + Duration::hours((i / 50) as i64),
                    )
                    .await
                    .expect("inbound");
            }
        }
    }
    // Fifty contacts share each creation time, so the `wa_id` tie-break decides their order.
    sqlx::query(
        "UPDATE whatsapp_contacts \
         SET created_at = $2::timestamptz + (substr(wa_id, 5)::bigint / 50) * interval '1 hour' \
         WHERE community_id = $1",
    )
    .bind(fx.community().as_uuid())
    .bind(base())
    .execute(&fx.pool)
    .await
    .expect("share creation times");
    let now = Utc::now();

    // A cursor this relay did not issue is refused, never read as the first page.
    let refused = crate::api::whatsapp::contacts_page_view(
        &fx.state,
        fx.community(),
        200,
        Some("not-a-cursor"),
        false,
        now,
        true,
    )
    .await
    .expect_err("a malformed cursor is a 400");
    assert_eq!(refused.0, StatusCode::BAD_REQUEST);

    // (a) Paging through `nextCursor` returns every contact exactly once, in list order.
    let mut seen: Vec<String> = Vec::new();
    let mut listed_stages: HashMap<String, u64> = HashMap::new();
    let mut listed_failed_not_contacted = 0u64;
    let mut before: Option<String> = None;
    let mut pages = 0;
    loop {
        let page = crate::api::whatsapp::contacts_page_view(
            &fx.state,
            fx.community(),
            200,
            before.as_deref(),
            false,
            now,
            true,
        )
        .await
        .expect("contacts page");
        assert!(
            page.get("stageCounts").is_none(),
            "counts are opt in: {page}"
        );
        for contact in page["contacts"].as_array().expect("contacts") {
            seen.push(contact["waId"].as_str().expect("waId").to_owned());
            let stage = contact["stage"].as_str().expect("stage").to_owned();
            if stage == "none" && contact["lastOutboundState"] == "failed" {
                listed_failed_not_contacted += 1;
            }
            *listed_stages.entry(stage).or_insert(0) += 1;
        }
        pages += 1;
        assert!(pages <= 3, "450 contacts fit three pages of 200");
        match page["nextCursor"].as_str() {
            Some(cursor) => before = Some(cursor.to_owned()),
            None => break,
        }
    }
    assert_eq!(pages, 3);
    assert_eq!(seen.len(), TOTAL);
    assert_eq!(
        seen.iter().collect::<std::collections::HashSet<_>>().len(),
        TOTAL,
        "no contact appears on two pages"
    );
    let expected_order: Vec<String> = sqlx::query_scalar(
        "SELECT wa_id FROM whatsapp_contacts WHERE community_id = $1 \
         ORDER BY GREATEST(last_inbound_at, last_outbound_at, created_at) DESC, wa_id DESC",
    )
    .bind(fx.community().as_uuid())
    .fetch_all(&fx.pool)
    .await
    .expect("expected order");
    assert_eq!(seen, expected_order);

    // (b) Counts cover all 450 contacts however small the page, and equal the full list.
    let counted = crate::api::whatsapp::contacts_page_view(
        &fx.state,
        fx.community(),
        1,
        None,
        true,
        now,
        true,
    )
    .await
    .expect("counted contacts");
    assert_eq!(counted["contacts"].as_array().map(Vec::len), Some(1));
    assert!(counted["nextCursor"].is_string());
    assert_eq!(counted["totalContacts"], TOTAL);
    assert_eq!(counted["countsTruncated"], false);
    let stage_counts = counted["stageCounts"].as_object().expect("stageCounts");
    let from_counts: HashMap<String, u64> = stage_counts
        .iter()
        .map(|(stage, n)| (stage.clone(), n.as_u64().expect("count")))
        .collect();
    assert_eq!(from_counts.values().sum::<u64>(), TOTAL as u64);
    assert_eq!(from_counts, listed_stages);
    assert_eq!(
        counted["failedNotContacted"].as_u64(),
        Some(listed_failed_not_contacted)
    );
    assert_eq!(listed_failed_not_contacted, (TOTAL / 5) as u64);
    for stage in ["contacted", "replied", "not_on_whatsapp"] {
        assert_eq!(from_counts[stage], (TOTAL / 5) as u64, "{stage}");
    }

    // A legacy caller (no queued capability) gets the same totals.
    let legacy = crate::api::whatsapp::contacts_page_view(
        &fx.state,
        fx.community(),
        1,
        None,
        true,
        now,
        false,
    )
    .await
    .expect("legacy counts");
    assert_eq!(legacy["totalContacts"], TOTAL);

    // The bound: chunk edges do not change the numbers, and a cap below the community size
    // counts exactly that many and says the numbers are a floor.
    let chunked = super::desk::stage_counts_bounded(&fx.state, fx.community(), true, 450, 100)
        .await
        .expect("chunked counts");
    assert_eq!(chunked.total, TOTAL as u64);
    assert!(
        !chunked.truncated,
        "a cap equal to the size is not a truncation"
    );
    let expected_by_stage: std::collections::BTreeMap<String, u64> =
        from_counts.iter().map(|(k, v)| (k.clone(), *v)).collect();
    assert_eq!(chunked.by_stage, expected_by_stage);
    let capped = super::desk::stage_counts_bounded(&fx.state, fx.community(), true, 300, 100)
        .await
        .expect("capped counts");
    assert_eq!(capped.total, 300);
    assert!(capped.truncated);
}
