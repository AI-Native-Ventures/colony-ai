//! Postgres-backed proofs of the production seams of payment links. No provider is ever
//! reached: every provider call goes to [`FakeProvider`], which replays recorded fixtures.
//!
//! Each test names the guard it depends on; removing that guard makes the test fail.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde::Serialize;
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use uuid::Uuid;
use zeroize::Zeroizing;

use buzz_core::business_records::{
    invoice_head_d_tag, invoice_version_d_tag, InvoiceHead, InvoiceStatus, InvoiceVersion,
    InvoiceVersionAction, ProposalLine, BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{
    KIND_INVOICE_HEAD, KIND_INVOICE_VERSION, KIND_MONEY_CONNECTION_ACTION, KIND_PAYMENT,
    KIND_PAYMENT_LINK_ACTION,
};
use buzz_core::money_rails::connection::{
    AuthScheme, ConnectionAction, ConnectionOp, StoredRecipe,
};
use buzz_core::money_rails::link::{
    ApprovalFacts, LinkAction, LinkHead, LinkOp, LinkState, RecipientInput, ReportSource, SystemOp,
};
use buzz_core::money_rails::notice::{
    sign_for_test, NoticeMap, SignatureConfig, SignatureEncoding, SignedPayload,
};
use buzz_core::money_rails::recipe::{
    AmountPointer, AmountScale, BodyEncoding, EqualsPointer, Extract, Recipe, RecipePurpose,
};
use buzz_core::money_rails::{
    connection_d_tag, link_d_tag, RecipientChannel, Route, MONEY_RAILS_SCHEMA_VERSION,
};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::channel::{ChannelType, ChannelVisibility};

use super::notices::{receive, NoticeError};
use super::provider::{ProviderError, ProviderHttp, ProviderRequest, ProviderResponse};
use super::runner::run_create;
use super::{jobs, load_connection, read_invoice};
use crate::handlers::ingest::{HttpAuthMethod, IngestAuth, IngestError, IngestResult};
use crate::handlers::money_connections::{create_connection, disconnect_connection, ConnectInput};
use crate::handlers::money_pay_links::{apply_system_op, read_link, use_browser_grant};
use crate::state::AppState;

const KEK: [u8; 32] = [0x42; 32];
const KEY: &str = "sk_test_not_a_real_key_0123456789";
const SIGNING_SECRET: &str = "whsec_test_not_a_real_secret";
const API_HOST: &str = "api.examplepay.com";
const DASHBOARD_HOST: &str = "dashboard.examplepay.com";
const TOTAL: i64 = 1_000_000;
const DEPOSIT: i64 = 375_000;

// ── fake provider ─────────────────────────────────────────────────────────────

#[derive(Clone)]
enum Reply {
    /// A created link: amount (minor units) and currency the provider reports.
    Created(i64, &'static str),
    /// An error status with a body.
    Error(u16, String),
}

struct Call {
    method: String,
    host: String,
    path_and_query: String,
    body: Option<String>,
    key: Option<String>,
}

struct FakeProvider {
    calls: Mutex<Vec<Call>>,
    reply: Mutex<Reply>,
}

impl FakeProvider {
    fn new() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            reply: Mutex::new(Reply::Created(DEPOSIT, "zar")),
        }
    }

    fn set_reply(&self, reply: Reply) {
        *self.reply.lock().expect("reply lock") = reply;
    }

    fn call_count(&self) -> usize {
        self.calls.lock().expect("calls lock").len()
    }
}

#[async_trait]
impl ProviderHttp for FakeProvider {
    async fn execute(&self, request: &ProviderRequest) -> Result<ProviderResponse, ProviderError> {
        self.calls.lock().expect("calls lock").push(Call {
            method: request.method.clone(),
            host: request.host.clone(),
            path_and_query: request.path_and_query.clone(),
            body: request.body.clone(),
            key: request
                .auth
                .as_ref()
                .map(|(_, key)| key.as_str().to_owned()),
        });
        let reply = self.reply.lock().expect("reply lock").clone();
        Ok(match reply {
            Reply::Created(amount, currency) => ProviderResponse {
                status: 200,
                body: serde_json::to_vec(&json!({
                    "id": "plink_fixture_1",
                    "url": "https://buy.examplepay.com/fixture1",
                    "amount": amount,
                    "currency": currency,
                }))
                .expect("fixture body"),
            },
            Reply::Error(status, body) => ProviderResponse {
                status,
                body: body.into_bytes(),
            },
        })
    }
}

// ── captured logs ─────────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct LogBuf(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for LogBuf {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().expect("log lock").extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogBuf {
    type Writer = LogBuf;

    fn make_writer(&'a self) -> LogBuf {
        self.clone()
    }
}

impl LogBuf {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().expect("log lock")).into_owned()
    }
}

// ── fixture ───────────────────────────────────────────────────────────────────

struct Fixture {
    state: Arc<AppState>,
    pool: PgPool,
    tenant: TenantContext,
    owner: Keys,
    scout: Keys,
    provider: Arc<FakeProvider>,
    client_id: Uuid,
    invoice_id: Uuid,
}

async fn fixture() -> Fixture {
    let mut config = crate::config::Config::from_env().expect("test relay config");
    let database_url = crate::test_support::database_url();
    config.database_url = database_url.clone();
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_owned());
    config.require_relay_membership = false;
    config.accounts = crate::config::AccountConfig::test_config(Some(KEK), None, vec![], None);
    let host = format!("money-test-{}.example", Uuid::new_v4().simple());
    config.relay_url = format!("wss://{host}");

    let pool = PgPoolOptions::new()
        .connect(&database_url)
        .await
        .expect("connect money rails test Postgres");
    if !matches!(
        std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref(),
        Ok("desired")
    ) {
        buzz_db::migration::run_migrations(&pool)
            .await
            .expect("apply money rails test schema");
    }
    let community_id = Uuid::new_v4();
    sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
        .bind(community_id)
        .bind(&host)
        .execute(&pool)
        .await
        .expect("insert money rails test community");
    let db = buzz_db::Db::from_pool(pool.clone());
    let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .expect("money rails test Redis pool");
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
            .await
            .expect("money rails test pubsub"),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media_storage =
        buzz_media::MediaStorage::new(&config.media).expect("money rails test media config");
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
    let provider = Arc::new(FakeProvider::new());
    state.money_http = provider.clone();
    let state = Arc::new(state);
    let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host);

    let owner = Keys::generate();
    let scout = Keys::generate();
    let community = tenant.community();
    state
        .db
        .add_relay_member(community, &owner.public_key().to_hex(), "owner", None)
        .await
        .expect("owner is a relay member");
    state
        .db
        .ensure_user(community, &owner.public_key().to_bytes())
        .await
        .expect("owner user");
    state
        .db
        .ensure_user(community, &scout.public_key().to_bytes())
        .await
        .expect("scout user");
    state
        .db
        .set_agent_owner(
            community,
            &scout.public_key().to_bytes(),
            &owner.public_key().to_bytes(),
        )
        .await
        .expect("scout is owned by the owner");

    let client_channel = state
        .db
        .create_channel(
            community,
            &format!("client-{}", Uuid::new_v4().simple()),
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &owner.public_key().to_bytes(),
            None,
        )
        .await
        .expect("client channel");
    let fixture = Fixture {
        state,
        pool,
        tenant,
        owner,
        scout,
        provider,
        client_id: client_channel.id,
        invoice_id: Uuid::new_v4(),
    };
    fixture.seed_issued_invoice().await;
    fixture
}

fn http_auth(keys: &Keys) -> IngestAuth {
    IngestAuth::Http {
        pubkey: keys.public_key(),
        scopes: vec![buzz_auth::Scope::MessagesWrite],
        auth_method: HttpAuthMethod::DevPubkey,
    }
}

fn signed_with_h<T: Serialize>(
    keys: &Keys,
    kind: u32,
    channel_id: Uuid,
    d_tag: &str,
    content: &T,
) -> Event {
    EventBuilder::new(
        Kind::Custom(kind as u16),
        serde_json::to_string(content).expect("serialize"),
    )
    .tags([
        Tag::parse(["h", channel_id.to_string().as_str()]).expect("h tag"),
        Tag::parse(["d", d_tag]).expect("d tag"),
    ])
    .sign_with_keys(keys)
    .expect("sign")
}

fn signed_global<T: Serialize>(keys: &Keys, kind: u32, d_tag: &str, content: &T) -> Event {
    EventBuilder::new(
        Kind::Custom(kind as u16),
        serde_json::to_string(content).expect("serialize"),
    )
    .tags([Tag::parse(["d", d_tag]).expect("d tag")])
    .sign_with_keys(keys)
    .expect("sign")
}

fn rejection(result: Result<IngestResult, IngestError>) -> String {
    match result {
        Err(IngestError::Rejected(message)) => message,
        Err(other) => panic!("expected a rejection, got {other:?}"),
        Ok(done) => panic!("expected a rejection, got accepted: {}", done.message),
    }
}

impl Fixture {
    fn community(&self) -> CommunityId {
        self.tenant.community()
    }

    /// A draft invoice written the way a proposal acceptance would, then issued through the
    /// production business record broker.
    async fn seed_issued_invoice(&self) {
        let client_id = self.client_id;
        let invoice_id = self.invoice_id;
        let proposal_version_event_id = "a".repeat(64);
        let lines = vec![ProposalLine {
            service_id: None,
            description: "Shopfront refit".into(),
            quantity_hundredths: 100,
            unit_amount_minor: TOTAL,
        }];
        let version = InvoiceVersion {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            client_id,
            invoice_id,
            version: 1,
            previous_version_event_id: None,
            proposal_version_event_id: Some(proposal_version_event_id.clone()),
            expected_head_event_id: None,
            action: InvoiceVersionAction::ProposalAcceptance,
            currency: "ZAR".into(),
            lines: lines.clone(),
            tax_lines: Vec::new(),
            seller_tax_number: None,
            customer_tax_number: None,
            total_minor: TOTAL,
            status: InvoiceStatus::Draft,
            due_at: None,
            void_reason: None,
        };
        let version_event = signed_with_h(
            &self.owner,
            KIND_INVOICE_VERSION,
            client_id,
            &invoice_version_d_tag(client_id, invoice_id, 1),
            &version,
        );
        let (_, inserted) = self
            .state
            .db
            .insert_event(self.community(), &version_event, Some(client_id))
            .await
            .expect("insert seeded invoice version");
        assert!(inserted);
        let head = InvoiceHead {
            schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
            client_id,
            invoice_id,
            proposal_id: Uuid::new_v4(),
            proposal_version_event_id,
            currency: "ZAR".into(),
            lines,
            tax_lines: Vec::new(),
            seller_tax_number: None,
            customer_tax_number: None,
            total_minor: TOTAL,
            credited_minor: 0,
            written_off_minor: 0,
            collected_minor: 0,
            outstanding_minor: 0,
            payment_evidence_count: 0,
            version: 1,
            current_version_event_id: version_event.id.to_hex(),
            status: InvoiceStatus::Draft,
            due_at: None,
            issued_at: None,
            source_event_id: version_event.id.to_hex(),
        };
        let head_d = invoice_head_d_tag(client_id, invoice_id);
        let head_event = signed_with_h_relay(&self.state, client_id, &head_d, &head);
        self.state
            .db
            .replace_parameterized_event(self.community(), &head_event, &head_d, Some(client_id))
            .await
            .expect("insert seeded invoice head");

        // Issue it through the production broker.
        let current = read_invoice(&self.state, self.community(), invoice_id)
            .await
            .expect("read invoice")
            .expect("invoice exists");
        let issue = InvoiceVersion {
            version: 2,
            previous_version_event_id: Some(current.head.current_version_event_id.clone()),
            expected_head_event_id: Some(current.event.event.id.to_hex()),
            action: InvoiceVersionAction::Issue,
            status: InvoiceStatus::Issued,
            ..version
        };
        let issue_event = signed_with_h(
            &self.owner,
            KIND_INVOICE_VERSION,
            client_id,
            &invoice_version_d_tag(client_id, invoice_id, 2),
            &issue,
        );
        crate::handlers::business_records::handle(
            &self.tenant,
            &self.state,
            issue_event,
            http_auth(&self.owner),
        )
        .await
        .expect("issue the invoice");
    }

    async fn invoice(&self) -> super::InvoiceRead {
        read_invoice(&self.state, self.community(), self.invoice_id)
            .await
            .expect("read invoice")
            .expect("invoice exists")
    }

    async fn collected(&self) -> i64 {
        self.invoice().await.head.collected_minor
    }

    async fn payment_event_count(&self) -> i64 {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM events WHERE community_id = $1 AND kind = $2",
        )
        .bind(self.community().as_uuid())
        .bind(KIND_PAYMENT as i32)
        .fetch_one(&self.pool)
        .await
        .expect("count payment evidence")
    }

    /// An API route connection locked to `API_HOST`.
    async fn connect_api(&self, with_signing: bool) -> (Uuid, Uuid) {
        let signature = with_signing.then(signature_config);
        let (config, notice_id) = create_connection(
            &self.tenant,
            &self.state,
            &self.owner.public_key(),
            ConnectInput {
                provider: "examplepay".into(),
                label: "ExamplePay".into(),
                route: Route::Api,
                api_key: Some(Zeroizing::new(KEY.to_owned())),
                api_hosts: vec![API_HOST.to_owned()],
                auth_scheme: Some(AuthScheme::Basic),
                browser_hosts: vec![DASHBOARD_HOST.to_owned()],
                signing_secret: with_signing.then(|| Zeroizing::new(SIGNING_SECRET.to_owned())),
                signature,
            },
        )
        .await
        .expect("connect the provider");
        (config.connection_id, notice_id)
    }

    async fn connect_browser(&self) -> Uuid {
        let (config, _) = create_connection(
            &self.tenant,
            &self.state,
            &self.owner.public_key(),
            ConnectInput {
                provider: "examplepay".into(),
                label: "ExamplePay".into(),
                route: Route::Browser,
                api_key: None,
                api_hosts: Vec::new(),
                auth_scheme: None,
                browser_hosts: vec![DASHBOARD_HOST.to_owned()],
                signing_secret: None,
                signature: None,
            },
        )
        .await
        .expect("connect the browser route");
        config.connection_id
    }

    async fn connection_head_id(&self, connection_id: Uuid) -> String {
        crate::handlers::company_initiative::load_head(
            &self.state,
            self.community(),
            buzz_core::kind::KIND_MONEY_CONNECTION_HEAD,
            &connection_d_tag(connection_id),
        )
        .await
        .expect("load connection head")
        .expect("connection head exists")
        .event
        .id
        .to_hex()
    }

    async fn connection_action(
        &self,
        keys: &Keys,
        connection_id: Uuid,
        op: ConnectionOp,
        fill: impl FnOnce(&mut ConnectionAction),
    ) -> Result<IngestResult, IngestError> {
        let mut action = ConnectionAction {
            schema_version: MONEY_RAILS_SCHEMA_VERSION,
            op,
            connection_id,
            expected_head_event_id: Some(self.connection_head_id(connection_id).await),
            provider: None,
            label: None,
            browser_hosts: None,
            recipe: None,
            recipe_id: None,
            recipe_hash: None,
            notice_map: None,
            map_hash: None,
        };
        fill(&mut action);
        let event = signed_global(
            keys,
            KIND_MONEY_CONNECTION_ACTION,
            &connection_d_tag(connection_id),
            &action,
        );
        crate::handlers::money_connections::handle(
            &self.tenant,
            &self.state,
            event,
            http_auth(keys),
        )
        .await
    }

    /// Scout proposes `recipe` and the owner approves exactly what was proposed.
    async fn approve_recipe(&self, connection_id: Uuid, recipe: Recipe) {
        let id = recipe.recipe_id.clone();
        self.connection_action(
            &self.scout,
            connection_id,
            ConnectionOp::ProposeRecipe,
            |a| a.recipe = Some(recipe),
        )
        .await
        .expect("scout proposes the recipe");
        let hash = self.stored_recipe(connection_id, &id).await.recipe_hash;
        self.connection_action(
            &self.owner,
            connection_id,
            ConnectionOp::ApproveRecipe,
            |a| {
                a.recipe_id = Some(id);
                a.recipe_hash = Some(hash);
            },
        )
        .await
        .expect("owner approves the recipe");
    }

    async fn stored_recipe(&self, connection_id: Uuid, recipe_id: &str) -> StoredRecipe {
        load_connection(&self.state, self.community(), connection_id)
            .await
            .expect("load connection")
            .expect("connection exists")
            .config
            .recipes
            .into_iter()
            .find(|stored| stored.recipe.recipe_id == recipe_id)
            .expect("recipe is stored")
    }

    fn blank_link_action(op: LinkOp, link_id: Uuid, expected: Option<String>) -> LinkAction {
        LinkAction {
            schema_version: MONEY_RAILS_SCHEMA_VERSION,
            op,
            link_id,
            expected_head_event_id: expected,
            party_id: None,
            invoice_id: None,
            amount_minor: None,
            currency: None,
            purpose: None,
            connection_id: None,
            recipient: None,
            message: None,
            expires_in_days: None,
            facts: None,
            reason: None,
            note: None,
            url: None,
            provider_reference: None,
            shown_amount_minor: None,
            shown_currency: None,
            source: None,
        }
    }

    async fn link_action(
        &self,
        keys: &Keys,
        action: LinkAction,
    ) -> Result<IngestResult, IngestError> {
        let event = signed_global(
            keys,
            KIND_PAYMENT_LINK_ACTION,
            &link_d_tag(action.link_id),
            &action,
        );
        crate::handlers::money_pay_links::handle(&self.tenant, &self.state, event, http_auth(keys))
            .await
    }

    async fn head(&self, link_id: Uuid) -> (String, LinkHead) {
        let (stored, head) = read_link(&self.state, self.community(), link_id)
            .await
            .expect("read card")
            .expect("card exists");
        (stored.event.id.to_hex(), head)
    }

    /// Scout drafts a card for the deposit on `connection_id`.
    async fn draft(&self, connection_id: Uuid) -> Uuid {
        let link_id = Uuid::new_v4();
        let mut action = Self::blank_link_action(LinkOp::Draft, link_id, None);
        action.party_id = Some("party-1".into());
        action.invoice_id = Some(self.invoice_id);
        action.amount_minor = Some(DEPOSIT);
        action.currency = Some("ZAR".into());
        action.purpose = Some("Deposit for the shopfront refit".into());
        action.connection_id = Some(connection_id);
        action.recipient = Some(RecipientInput {
            channel: RecipientChannel::Whatsapp,
            address: "+27 82 123 4521".into(),
            name: "Thandi".into(),
        });
        action.message = Some("Hi Thandi, here is your deposit link: {link}".into());
        self.link_action(&self.scout, action)
            .await
            .expect("scout drafts the card");
        link_id
    }

    fn approval_facts(head: &LinkHead) -> ApprovalFacts {
        ApprovalFacts {
            invoice_id: head.invoice_id,
            amount_minor: head.amount_minor,
            currency: head.currency.clone(),
            connection_id: head.connection_id,
            recipient_ref: head.recipient_ref,
            message: head.message.clone(),
            expires_in_days: head.expires_in_days,
        }
    }

    async fn approve(&self, link_id: Uuid) -> Result<IngestResult, IngestError> {
        let (head_id, head) = self.head(link_id).await;
        let mut action = Self::blank_link_action(LinkOp::Approve, link_id, Some(head_id));
        action.facts = Some(Self::approval_facts(&head));
        self.link_action(&self.owner, action).await
    }

    /// Draft, approve and run the create job: the card ends up with a created link.
    async fn created_card(&self, connection_id: Uuid) -> Uuid {
        let link_id = self.draft(connection_id).await;
        self.approve(link_id).await.expect("owner approves");
        jobs::process_now(
            &self.state,
            self.provider.as_ref(),
            &self.tenant,
            link_id,
            "create",
        )
        .await;
        link_id
    }

    /// A card the client has the link for: created and delivered.
    async fn sent_card(&self, connection_id: Uuid) -> Uuid {
        let link_id = self.created_card(connection_id).await;
        apply_system_op(&self.tenant, &self.state, link_id, SystemOp::Delivered)
            .await
            .expect("delivered");
        assert_eq!(self.head(link_id).await.1.state, LinkState::Sent);
        link_id
    }

    async fn all_event_text(&self) -> String {
        let rows: Vec<String> =
            sqlx::query_scalar("SELECT to_jsonb(e)::text FROM events e WHERE community_id = $1")
                .bind(self.community().as_uuid())
                .fetch_all(&self.pool)
                .await
                .expect("read events");
        rows.join("\n")
    }
}

fn signed_with_h_relay<T: Serialize>(
    state: &AppState,
    channel_id: Uuid,
    d_tag: &str,
    content: &T,
) -> Event {
    EventBuilder::new(
        Kind::Custom(KIND_INVOICE_HEAD as u16),
        serde_json::to_string(content).expect("serialize"),
    )
    .tags([
        Tag::parse(["h", channel_id.to_string().as_str()]).expect("h tag"),
        Tag::parse(["d", d_tag]).expect("d tag"),
    ])
    .sign_with_keys(&state.relay_keypair)
    .expect("sign head")
}

fn create_recipe(path: &str) -> Recipe {
    Recipe {
        recipe_id: "create-payment-link".into(),
        title: "Create payment link".into(),
        purpose: RecipePurpose::CreateLink,
        method: "POST".into(),
        host: API_HOST.into(),
        path: path.into(),
        query: Vec::new(),
        headers: Vec::new(),
        body_encoding: BodyEncoding::Form,
        body:
            "amount={{amount_minor}}&currency={{currency_lower}}&name={{purpose}}&ref={{card_ref}}"
                .into(),
        extract: Extract {
            url: Some("/url".into()),
            reference: Some("/id".into()),
            amount: Some(AmountPointer {
                pointer: "/amount".into(),
                scale: AmountScale::Minor,
            }),
            currency: Some("/currency".into()),
            paid: None,
        },
    }
}

fn signature_config() -> SignatureConfig {
    SignatureConfig {
        header: "x-test-signature".into(),
        encoding: SignatureEncoding::Hex,
        prefix: Some("sha256=".into()),
        signed_payload: SignedPayload::Body,
        timestamp_field: None,
        signature_field: None,
        tolerance_secs: None,
    }
}

fn notice_map() -> NoticeMap {
    NoticeMap {
        event_id: Some("/id".into()),
        reference: Some("/data/object/payment_link".into()),
        amount: Some(AmountPointer {
            pointer: "/data/object/amount_total".into(),
            scale: AmountScale::Minor,
        }),
        currency: Some("/data/object/currency".into()),
        occurred_at: Some("/created".into()),
        success_when: vec![EqualsPointer {
            pointer: "/type".into(),
            equals: "checkout.session.completed".into(),
        }],
    }
}

fn notice_body(event_id: &str, kind: &str, amount: i64, currency: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "id": event_id,
        "type": kind,
        "created": chrono::Utc::now().timestamp(),
        "data": {"object": {
            "payment_link": "plink_fixture_1",
            "amount_total": amount,
            "currency": currency,
        }}
    }))
    .expect("notice body")
}

impl Fixture {
    /// Scout proposes the notice map and the owner approves exactly that map.
    async fn approve_notice_map(&self, connection_id: Uuid) {
        self.connection_action(
            &self.scout,
            connection_id,
            ConnectionOp::ProposeNoticeMap,
            |a| a.notice_map = Some(notice_map()),
        )
        .await
        .expect("scout proposes the notice map");
        let hash = load_connection(&self.state, self.community(), connection_id)
            .await
            .expect("load")
            .expect("exists")
            .config
            .notice_map
            .expect("map stored")
            .map_hash;
        self.connection_action(
            &self.owner,
            connection_id,
            ConnectionOp::ApproveNoticeMap,
            |a| a.map_hash = Some(hash),
        )
        .await
        .expect("owner approves the notice map");
    }

    async fn post_notice(
        &self,
        notice_id: Uuid,
        body: &[u8],
        signature: Option<String>,
    ) -> Result<super::notices::NoticeOutcome, NoticeError> {
        let header = move |name: &str| {
            if name == "x-test-signature" {
                signature.clone()
            } else {
                None
            }
        };
        receive(
            &self.state,
            self.provider.as_ref(),
            &self.tenant,
            notice_id,
            &header,
            body,
        )
        .await
    }

    fn sign(body: &[u8]) -> String {
        sign_for_test(&signature_config(), SIGNING_SECRET.as_bytes(), body, 0)
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn vault_key_never_appears_in_any_output() {
    // GUARD: sealed storage, the scrub of provider errors and the head projection. Removing
    // any one of them puts the key into an event, a card or a log line.
    let logs = LogBuf::default();
    let _guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_writer(logs.clone())
            .with_max_level(tracing::Level::TRACE)
            .finish(),
    );
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(true).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    // The provider echoes the key back in its error, the way a real 401 can.
    fx.provider.set_reply(Reply::Error(
        401,
        json!({"error": {"message": format!("Invalid API Key provided: {KEY}")}}).to_string(),
    ));
    let link_id = fx.created_card(connection_id).await;

    let (_, head) = fx.head(link_id).await;
    assert_eq!(head.state, LinkState::Failed);
    let reason = head.failure.as_ref().expect("failure").reason.clone();
    assert!(reason.contains("[removed]"), "{reason}");

    let mut everything = fx.all_event_text().await;
    everything.push_str(&serde_json::to_string(&head).expect("head json"));
    everything.push_str(
        &serde_json::to_string(
            &load_connection(&fx.state, fx.community(), connection_id)
                .await
                .expect("load")
                .expect("exists")
                .config
                .to_head("x"),
        )
        .expect("connection head json"),
    );
    everything.push_str(&logs.text());
    assert!(!everything.contains(KEY), "the key leaked into an output");
    assert!(
        !everything.contains(SIGNING_SECRET),
        "the signing secret leaked into an output"
    );

    // At rest the key is only the sealed value.
    let row = fx
        .state
        .db
        .money_get_connection(fx.community(), connection_id)
        .await
        .expect("row")
        .expect("exists");
    let sealed = row.sealed_api_key.expect("sealed key is stored");
    assert!(!sealed.windows(KEY.len()).any(|w| w == KEY.as_bytes()));
    // The provider did get the key, once, and only on the locked host.
    let calls = fx.provider.calls.lock().expect("calls");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].host, API_HOST);
    assert_eq!(calls[0].method, "POST");
    assert_eq!(calls[0].path_and_query, "/v1/payment_links");
    assert!(calls[0]
        .body
        .as_deref()
        .is_some_and(|body| body.contains("amount=375000")));
    assert_eq!(calls[0].key.as_deref(), Some(KEY));
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn refund_recipe_is_refused_even_when_approved() {
    // GUARD: the refusal list at propose, approve and every run.
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(false).await;

    // Proposed by Scout: stored as refused, and the owner cannot approve it.
    let mut refund = create_recipe("/v1/refunds");
    refund.recipe_id = "refund-x".into();
    fx.connection_action(&fx.scout, connection_id, ConnectionOp::ProposeRecipe, |a| {
        a.recipe = Some(refund.clone())
    })
    .await
    .expect("the proposal is recorded as refused");
    let stored = fx.stored_recipe(connection_id, "refund-x").await;
    assert_eq!(stored.refusal.as_deref(), Some("refund_path"));
    let message = rejection(
        fx.connection_action(&fx.owner, connection_id, ConnectionOp::ApproveRecipe, |a| {
            a.recipe_id = Some("refund-x".into());
            a.recipe_hash = Some(stored.recipe_hash.clone());
        })
        .await,
    );
    assert!(message.contains("refund_path"), "{message}");

    // Even a recipe forced to "approved" in storage is refused when it runs, and the provider
    // is never called.
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    let link_id = fx.draft(connection_id).await;
    fx.approve(link_id).await.expect("owner approves the card");
    let mut tampered = load_connection(&fx.state, fx.community(), connection_id)
        .await
        .expect("load")
        .expect("exists");
    tampered
        .config
        .recipes
        .iter_mut()
        .find(|stored| stored.recipe.recipe_id == "create-payment-link")
        .expect("the approved recipe")
        .recipe
        .path = "/v1/refunds".into();
    let (_, head) = fx.head(link_id).await;
    let failure = run_create(
        &fx.state,
        fx.provider.as_ref(),
        fx.community(),
        &head,
        &tampered,
        None,
    )
    .await
    .expect_err("a refund path must never run");
    assert_eq!(failure.code, "refund_path");
    assert_eq!(fx.provider.call_count(), 0);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn recipe_host_is_locked_to_the_connected_api_hosts() {
    // GUARD: validate_recipe's host lock at propose time; a foreign host is stored as refused.
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(false).await;
    let mut foreign = create_recipe("/v1/payment_links");
    foreign.host = "evil.example.com".into();
    fx.connection_action(&fx.scout, connection_id, ConnectionOp::ProposeRecipe, |a| {
        a.recipe = Some(foreign)
    })
    .await
    .expect("the proposal is recorded as refused");
    let stored = fx.stored_recipe(connection_id, "create-payment-link").await;
    assert_eq!(stored.refusal.as_deref(), Some("host_not_allowed"));
    let message = rejection(
        fx.connection_action(&fx.owner, connection_id, ConnectionOp::ApproveRecipe, |a| {
            a.recipe_id = Some("create-payment-link".into());
            a.recipe_hash = Some(stored.recipe_hash.clone());
        })
        .await,
    );
    assert!(message.contains("host_not_allowed"), "{message}");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn approve_after_edit_is_refused_and_edit_voids_the_approval() {
    // GUARD: the atomic approve re-check and the void on edit.
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(false).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    let link_id = fx.draft(connection_id).await;
    let (_, before) = fx.head(link_id).await;
    let stale_facts = Fixture::approval_facts(&before);
    fx.approve(link_id).await.expect("owner approves");
    assert_eq!(fx.head(link_id).await.1.state, LinkState::CreatingLink);

    // The owner changes the amount after approving: the approval is void and no job runs.
    let (head_id, _) = fx.head(link_id).await;
    let mut edit = Fixture::blank_link_action(LinkOp::Edit, link_id, Some(head_id));
    edit.amount_minor = Some(400_000);
    fx.link_action(&fx.owner, edit).await.expect("owner edits");
    let (head_id, edited) = fx.head(link_id).await;
    assert_eq!(edited.state, LinkState::NeedsYou);
    assert!(edited.approval.is_none() && edited.approval_voided);
    jobs::process_now(
        &fx.state,
        fx.provider.as_ref(),
        &fx.tenant,
        link_id,
        "create",
    )
    .await;
    assert_eq!(
        fx.provider.call_count(),
        0,
        "a voided approval creates nothing"
    );

    // Approving with the facts of the old card is refused.
    let mut stale = Fixture::blank_link_action(LinkOp::Approve, link_id, Some(head_id.clone()));
    stale.facts = Some(stale_facts);
    let message = rejection(fx.link_action(&fx.owner, stale).await);
    assert!(message.contains("approval_facts_changed"), "{message}");

    // Approving against a head that has since moved is refused.
    let mut moved = Fixture::blank_link_action(LinkOp::Approve, link_id, Some("0".repeat(64)));
    moved.facts = Some(Fixture::approval_facts(&edited));
    let message = rejection(fx.link_action(&fx.owner, moved).await);
    assert!(message.starts_with("conflict:"), "{message}");

    // Scout can never approve.
    let mut scout_approve = Fixture::blank_link_action(LinkOp::Approve, link_id, Some(head_id));
    scout_approve.facts = Some(Fixture::approval_facts(&edited));
    let message = rejection(fx.link_action(&fx.scout, scout_approve).await);
    assert!(message.starts_with("restricted:"), "{message}");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_link_with_another_amount_is_never_sent() {
    // GUARD: the amount check on the created link (review focus 2).
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(false).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    fx.provider.set_reply(Reply::Created(37_500, "zar"));
    let link_id = fx.created_card(connection_id).await;
    let (_, head) = fx.head(link_id).await;
    assert_eq!(head.state, LinkState::NeedsYou);
    assert!(head.link.is_none() && head.approval.is_none());
    assert_eq!(
        head.failure.as_ref().map(|f| f.code.as_str()),
        Some("amount_mismatch")
    );
    assert!(fx
        .state
        .db
        .money_get_job(fx.community(), link_id, "send")
        .await
        .expect("job lookup")
        .is_none_or(|job| job.done));
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn unverified_notice_never_marks_paid() {
    // GUARD: judge_notice is the only writer of Verified; an unsigned connection can only report.
    let fx = fixture().await;
    let (connection_id, notice_id) = fx.connect_api(false).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    fx.approve_notice_map(connection_id).await;
    let link_id = fx.sent_card(connection_id).await;

    let body = notice_body("evt_1", "checkout.session.completed", DEPOSIT, "zar");
    let outcome = fx
        .post_notice(notice_id, &body, None)
        .await
        .expect("stored");
    assert_eq!(outcome.judgement, "reported");
    let (_, head) = fx.head(link_id).await;
    assert_eq!(head.state, LinkState::PaymentReported);
    assert_ne!(head.state, LinkState::Paid);
    assert_eq!(fx.payment_event_count().await, 0, "no evidence was written");
    assert_eq!(fx.collected().await, 0);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn spoofed_and_replayed_notices_are_not_paid_and_a_signed_one_is_paid_once() {
    // GUARD: HMAC verification, the dedupe key and idempotent evidence.
    let fx = fixture().await;
    let (connection_id, notice_id) = fx.connect_api(true).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    fx.approve_notice_map(connection_id).await;
    let link_id = fx.sent_card(connection_id).await;

    let body = notice_body("evt_paid", "checkout.session.completed", DEPOSIT, "zar");
    // Unsigned and wrongly signed posts change nothing.
    let unsigned = fx
        .post_notice(notice_id, &body, None)
        .await
        .expect("stored");
    assert_eq!(unsigned.judgement, "ignored");
    let wrong = fx
        .post_notice(
            notice_id,
            &notice_body("evt_forged", "checkout.session.completed", DEPOSIT, "zar"),
            Some("sha256=00".into()),
        )
        .await
        .expect("stored");
    assert_eq!(wrong.judgement, "ignored");
    assert_eq!(fx.head(link_id).await.1.state, LinkState::Sent);
    assert_eq!(fx.payment_event_count().await, 0);

    // A correctly signed success for the right amount is paid, with evidence.
    let signed = fx
        .post_notice(notice_id, &body, Some(Fixture::sign(&body)))
        .await
        .expect("stored");
    assert_eq!(signed.judgement, "verified");
    let (_, head) = fx.head(link_id).await;
    assert_eq!(head.state, LinkState::Paid);
    assert_eq!(fx.payment_event_count().await, 1);
    assert_eq!(fx.collected().await, DEPOSIT);

    // The same signed body again is a duplicate: no second payment.
    let replay = fx
        .post_notice(notice_id, &body, Some(Fixture::sign(&body)))
        .await
        .expect("stored");
    assert!(replay.duplicate);
    assert_eq!(fx.payment_event_count().await, 1);
    assert_eq!(fx.collected().await, DEPOSIT);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_signed_notice_for_another_amount_is_a_report_not_a_payment() {
    // GUARD: the amount comparison inside judge_notice.
    let fx = fixture().await;
    let (connection_id, notice_id) = fx.connect_api(true).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    fx.approve_notice_map(connection_id).await;
    let link_id = fx.sent_card(connection_id).await;
    let body = notice_body("evt_small", "checkout.session.completed", 100, "zar");
    let outcome = fx
        .post_notice(notice_id, &body, Some(Fixture::sign(&body)))
        .await
        .expect("stored");
    assert_eq!(outcome.judgement, "reported");
    let (_, head) = fx.head(link_id).await;
    assert_eq!(head.state, LinkState::PaymentReported);
    assert!(head.payment.as_ref().is_some_and(|p| p.mismatch.is_some()));
    assert_eq!(fx.collected().await, 0);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn notices_over_the_cap_and_unknown_addresses_are_refused() {
    // GUARD: the 64 KiB cap and the random notice address.
    let fx = fixture().await;
    let (_, notice_id) = fx.connect_api(false).await;
    let too_big = vec![b'x'; buzz_core::money_rails::NOTICE_MAX_BYTES + 1];
    assert_eq!(
        fx.post_notice(notice_id, &too_big, None).await,
        Err(NoticeError::TooLarge)
    );
    assert_eq!(
        fx.post_notice(Uuid::new_v4(), b"{}", None).await,
        Err(NoticeError::NotFound)
    );
    let just_fits = vec![b'x'; buzz_core::money_rails::NOTICE_MAX_BYTES];
    let outcome = fx
        .post_notice(notice_id, &just_fits, None)
        .await
        .expect("a notice at the cap is stored");
    assert_eq!(outcome.judgement, "unmatched");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn the_owner_tick_records_evidence_and_scout_cannot_confirm() {
    // GUARD: confirm_payment is owner only; evidence goes through the business record broker.
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(false).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    let link_id = fx.sent_card(connection_id).await;

    let (head_id, _) = fx.head(link_id).await;
    let mut report = Fixture::blank_link_action(LinkOp::ReportPayment, link_id, Some(head_id));
    report.source = Some(ReportSource::Dashboard);
    fx.link_action(&fx.scout, report)
        .await
        .expect("scout reports a payment");
    let (head_id, reported) = fx.head(link_id).await;
    assert_eq!(reported.state, LinkState::PaymentReported);
    assert_eq!(fx.collected().await, 0, "a report is not a payment");

    let scout_confirm =
        Fixture::blank_link_action(LinkOp::ConfirmPayment, link_id, Some(head_id.clone()));
    let message = rejection(fx.link_action(&fx.scout, scout_confirm).await);
    assert!(message.starts_with("restricted:"), "{message}");

    let confirm = Fixture::blank_link_action(LinkOp::ConfirmPayment, link_id, Some(head_id));
    fx.link_action(&fx.owner, confirm)
        .await
        .expect("owner ticks");
    jobs::process_now(
        &fx.state,
        fx.provider.as_ref(),
        &fx.tenant,
        link_id,
        "evidence",
    )
    .await;
    assert_eq!(fx.head(link_id).await.1.state, LinkState::Paid);
    assert_eq!(fx.collected().await, DEPOSIT);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn the_browser_grant_allows_exactly_one_create_on_the_provider_host() {
    // GUARD: use_browser_grant's compare and set, host match and refusal list.
    let fx = fixture().await;
    let connection_id = fx.connect_browser().await;
    let link_id = fx.draft(connection_id).await;
    fx.approve(link_id).await.expect("owner approves");
    let (_, head) = fx.head(link_id).await;
    assert_eq!(head.state, LinkState::CreatingLink);
    assert_eq!(
        head.browser_grant.as_ref().map(|g| g.host.as_str()),
        Some(DASHBOARD_HOST)
    );

    let step = |host: &'static str, kind: &'static str, label: &'static str| {
        let fx = &fx;
        async move {
            use_browser_grant(
                &fx.tenant,
                &fx.state,
                link_id,
                host,
                kind,
                label,
                "https://dashboard.examplepay.com/payment-links/create",
            )
            .await
            .expect("decision")
        }
    };
    assert_eq!(
        step("evil.example.com", "create", "Create link").await.code,
        "host_mismatch"
    );
    assert_eq!(
        step(DASHBOARD_HOST, "pay", "Pay").await.code,
        "kind_not_allowed"
    );
    assert_eq!(
        step(DASHBOARD_HOST, "create", "Refund payment").await.code,
        "refund_path"
    );
    let first = step(DASHBOARD_HOST, "create", "Create link").await;
    assert!(first.allow, "{first:?}");
    let second = step(DASHBOARD_HOST, "create", "Create link").await;
    assert!(!second.allow);
    assert_eq!(second.code, "grant_used");
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn a_failed_message_is_visible_and_the_owner_can_mark_it_sent() {
    // GUARD: delivery failure leaves a durable state; the link is kept (no WhatsApp number is
    // connected in this test, so the send is refused by the existing sender rules).
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(false).await;
    fx.approve_recipe(connection_id, create_recipe("/v1/payment_links"))
        .await;
    let link_id = fx.created_card(connection_id).await;
    assert_eq!(fx.head(link_id).await.1.state, LinkState::CreatingLink);
    jobs::process_now(&fx.state, fx.provider.as_ref(), &fx.tenant, link_id, "send").await;
    let (head_id, failed) = fx.head(link_id).await;
    assert_eq!(failed.state, LinkState::Failed);
    assert!(failed.link.is_some(), "the created link is kept");
    assert!(failed.failure.is_some());

    let mut mark = Fixture::blank_link_action(LinkOp::MarkSent, link_id, Some(head_id));
    mark.note = Some("Sent it myself".into());
    fx.link_action(&fx.owner, mark)
        .await
        .expect("owner marks it sent");
    assert_eq!(fx.head(link_id).await.1.state, LinkState::Sent);
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn disconnect_deletes_the_sealed_secrets_and_keeps_the_head() {
    // GUARD: delete_secrets runs in the same transaction as the head change.
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(true).await;
    disconnect_connection(&fx.tenant, &fx.state, connection_id)
        .await
        .expect("disconnect");
    let row = fx
        .state
        .db
        .money_get_connection(fx.community(), connection_id)
        .await
        .expect("row")
        .expect("the row stays for history");
    assert_eq!(row.status, "disconnected");
    assert!(row.sealed_api_key.is_none() && row.sealed_signing_secret.is_none());
    assert!(row.kek_id.is_none());
}

#[tokio::test]
#[ignore = "requires disposable Postgres and Redis"]
async fn money_rails_commands_need_the_owner_or_their_agent() {
    // GUARD: access_for; a plain member can draft nothing and connect nothing.
    let fx = fixture().await;
    let (connection_id, _) = fx.connect_api(false).await;
    let stranger = Keys::generate();
    fx.state
        .db
        .add_relay_member(
            fx.community(),
            &stranger.public_key().to_hex(),
            "member",
            None,
        )
        .await
        .expect("member");
    let link_id = Uuid::new_v4();
    let mut draft = Fixture::blank_link_action(LinkOp::Draft, link_id, None);
    draft.party_id = Some("party-1".into());
    draft.invoice_id = Some(fx.invoice_id);
    draft.amount_minor = Some(DEPOSIT);
    draft.currency = Some("ZAR".into());
    draft.purpose = Some("Deposit".into());
    draft.connection_id = Some(connection_id);
    draft.recipient = Some(RecipientInput {
        channel: RecipientChannel::Whatsapp,
        address: "+27821234521".into(),
        name: "Thandi".into(),
    });
    draft.message = Some("Pay here {link}".into());
    let message = rejection(fx.link_action(&stranger, draft).await);
    assert!(message.starts_with("restricted:"), "{message}");
}
