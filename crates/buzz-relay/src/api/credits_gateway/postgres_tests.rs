use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use base64::Engine;
use nostr::{EventBuilder, Keys, Kind, Tag};
use sqlx::PgPool;
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;

struct Fixture {
    gateway: Gateway,
    pool: PgPool,
    host: String,
    agent: Keys,
    owner: Keys,
    auth_time: nostr::Timestamp,
    account: Uuid,
    session: Uuid,
    calls: Arc<AtomicUsize>,
    sent: Arc<std::sync::Mutex<Vec<Value>>>,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn fixture(response: Value) -> Fixture {
    fixture_status(response, StatusCode::OK).await
}

async fn fixture_status(response: Value, upstream_status: StatusCode) -> Fixture {
    fixture_provider(response, upstream_status, false).await
}

async fn fixture_provider(response: Value, upstream_status: StatusCode, direct: bool) -> Fixture {
    fixture_in(response, upstream_status, direct, false).await
}

/// Production runs a closed relay (`BUZZ_REQUIRE_RELAY_MEMBERSHIP=true`), where
/// only `relay_members` rows are admitted. `closed_relay` seeds the owner and
/// the agent as members of the fixture business only, like a real business.
async fn fixture_in(
    response: Value,
    upstream_status: StatusCode,
    direct: bool,
    closed_relay: bool,
) -> Fixture {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let sent = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = sent.clone();
    let completion = response.clone();
    let upstream = Router::new()
        .route(
            "/chat/completions",
            post(move |headers: HeaderMap, Json(body): Json<Value>| {
                let counter = counter.clone();
                let captured = captured.clone();
                let mut completion = completion.clone();
                async move {
                    assert_eq!(headers["authorization"], "Bearer synthetic-test-key");
                    assert!(headers.get("x-auth-tag").is_none());
                    if direct {
                        assert!(body.get("provider").is_none());
                        assert!(body.get("user").is_none());
                        assert_eq!(body["model"], "direct-test-model");
                    } else {
                        assert_eq!(body["provider"]["max_price"]["request"], 0);
                        assert_eq!(body["provider"]["only"], json!(["openai"]));
                        assert_eq!(body["provider"]["allow_fallbacks"], false);
                        assert!(body["user"]
                            .as_str()
                            .is_some_and(|user| user.starts_with("colony_") && user.len() == 71));
                    }
                    captured.lock().unwrap().push(body);
                    let index = counter.fetch_add(1, Ordering::SeqCst);
                    if index > 0 {
                        if let Some(id) = completion["id"].as_str().map(str::to_owned) {
                            completion["id"] = json!(format!("{id}-{index}"));
                        }
                    }
                    (upstream_status, Json(completion))
                }
            }),
        )
        .route(
            "/generation",
            get(
                move |axum::extract::Query(query): axum::extract::Query<
                    std::collections::HashMap<String, String>,
                >| {
                    let response = response.clone();
                    async move {
                        assert!(
                            !direct,
                            "direct providers must not query OpenRouter generation metadata"
                        );
                        assert_eq!(query.get("id").map(String::as_str), response["id"].as_str());
                        Json(json!({"data":{"id":response["id"],"total_cost":0.01}}))
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, upstream).await.unwrap();
    });
    let pool = PgPool::connect(&crate::test_support::database_url())
        .await
        .unwrap();
    let db = buzz_db::Db::from_pool(pool.clone());
    let owner = Keys::generate();
    let agent = Keys::generate();
    let account = Uuid::new_v4();
    let community = Uuid::new_v4();
    let host = format!("gateway-{community}.example");
    sqlx::query("INSERT INTO communities (id,host) VALUES ($1,$2)")
        .bind(community)
        .bind(&host)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO accounts (id,email,pubkey,email_verified_at,wrapped_dek,kek_id,sealed_nsec,nonce) VALUES ($1,$2,$3,now(),$4,'test',$5,$6)")
        .bind(account).bind(format!("{account}@example.invalid")).bind(owner.public_key().to_hex()).bind(vec![1u8;28]).bind(vec![2u8;16]).bind(vec![3u8;12]).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO users (community_id,pubkey) VALUES ($1,$2)")
        .bind(community)
        .bind(owner.public_key().to_bytes().to_vec())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO users (community_id,pubkey,agent_owner_pubkey) VALUES ($1,$2,$3)")
        .bind(community)
        .bind(agent.public_key().to_bytes().to_vec())
        .bind(owner.public_key().to_bytes().to_vec())
        .execute(&pool)
        .await
        .unwrap();
    if closed_relay {
        for (member, role) in [(&owner, "owner"), (&agent, "member")] {
            sqlx::query("INSERT INTO relay_members (community_id,pubkey,role) VALUES ($1,$2,$3)")
                .bind(community)
                .bind(member.public_key().to_hex())
                .bind(role)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
    sqlx::query("INSERT INTO account_credit_ledger (account_id,entry_type,amount_nanousd,source_id,description) VALUES ($1,'purchase',1000000000,'fixture','test grant')").bind(account).execute(&pool).await.unwrap();
    let session = db
        .create_credit_ai_session(
            &owner.public_key().to_hex(),
            buzz_core::CommunityId::from_uuid(community),
            agent.public_key().as_bytes(),
        )
        .await
        .unwrap();
    let mut config = crate::config::Config::from_env().unwrap();
    config.require_relay_membership = closed_relay;
    config.relay_url = format!("wss://{host}");
    config.redis_url =
        std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .unwrap();
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
            .await
            .unwrap(),
    );
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media = buzz_media::MediaStorage::new(&config.media).unwrap();
    let (state, _) = AppState::new(
        config,
        db,
        redis_pool,
        None::<buzz_audit::AuditService>,
        pubsub,
        auth,
        search,
        workflow,
        Keys::generate(),
        media,
    );
    let gateway = Gateway {
        relay: Arc::new(state),
        upstream: Some(Arc::new(if direct {
            Upstream::fake_direct(
                origin,
                super::super::credits_gateway_metering::TokenPrices {
                    input_nanousd_per_million: "1000000001".into(),
                    output_nanousd_per_million: "2000000003".into(),
                },
            )
        } else {
            Upstream::fake(origin, Duration::from_secs(1))
        })),
        enabled: true,
        policy: Arc::new(GatewayPolicy::default()),
    };
    Fixture {
        gateway,
        pool,
        host,
        agent,
        owner,
        auth_time: nostr::Timestamp::now(),
        account,
        session,
        calls,
        sent,
        server,
    }
}

fn body(f: &Fixture, request: Uuid) -> String {
    json!({"session_id":f.session,"request_id":request,"messages":[{"role":"user","content":"Hello Colony"}]}).to_string()
}
fn signed(f: &Fixture, body: &str, nonce: &str) -> Request<Body> {
    signed_path(f, body, nonce, "/managed-inference", &f.agent)
}
fn signed_path(f: &Fixture, body: &str, nonce: &str, path: &str, keys: &Keys) -> Request<Body> {
    signed_path_on(f, &f.host, body, nonce, path, keys)
}
fn signed_path_on(
    f: &Fixture,
    host: &str,
    body: &str,
    nonce: &str,
    path: &str,
    keys: &Keys,
) -> Request<Body> {
    let url = format!("https://{host}/api/credits-gateway{path}");
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .custom_created_at(f.auth_time)
        .tags([
            Tag::parse(["u", &url]).unwrap(),
            Tag::parse(["method", "POST"]).unwrap(),
            Tag::parse(["payload", &hex::encode(Sha256::digest(body.as_bytes()))]).unwrap(),
            Tag::parse(["nonce", nonce]).unwrap(),
        ])
        .sign_with_keys(keys)
        .unwrap();
    Request::post(path)
        .header("host", host)
        .header(
            "authorization",
            format!(
                "Nostr {}",
                base64::engine::general_purpose::STANDARD
                    .encode(serde_json::to_vec(&event).unwrap())
            ),
        )
        .body(Body::from(body.to_owned()))
        .unwrap()
}
async fn call(f: &Fixture, body: &str, nonce: &str) -> (StatusCode, Value) {
    let response = routes(f.gateway.clone())
        .oneshot(signed(f, body, nonce))
        .await
        .unwrap();
    let status = response.status();
    let value = serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
        .unwrap();
    (status, value)
}
fn upstream_response() -> Value {
    json!({"id":format!("gen-{}",Uuid::new_v4()),"choices":[{"message":{"role":"assistant","content":"Hello"},"finish_reason":"stop"}],"usage":{"cost":0.01,"total_tokens":10}})
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn real_route_charges_returned_cost_before_success_and_never_repeats_retry() {
    let f = fixture(upstream_response()).await;
    let payload = body(&f, Uuid::new_v4());
    let (status, value) = call(&f, &payload, "first").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["chargedNanousd"], "12000000");
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        988_000_000
    );
    let (status, value) = call(&f, &payload, "fresh-auth-retry").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(value["error"], "already_completed");
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    let (status, _) = call(&f, &payload, "first").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn real_route_rejects_anonymous_tampered_and_empty_balance_before_upstream() {
    let f = fixture(upstream_response()).await;
    let payload = body(&f, Uuid::new_v4());
    let anonymous = Request::post("/managed-inference")
        .header("host", &f.host)
        .body(Body::from(payload.clone()))
        .unwrap();
    assert_eq!(
        routes(f.gateway.clone())
            .oneshot(anonymous)
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let mut tampered = signed(&f, &payload, "tampered");
    *tampered.body_mut() = Body::from("{}");
    assert_eq!(
        routes(f.gateway.clone())
            .oneshot(tampered)
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("INSERT INTO account_credit_ledger (account_id,entry_type,amount_nanousd,source_id,description) VALUES ($1,'usage',-1000000000,'drain','test drain')").bind(f.account).execute(&f.pool).await.unwrap();
    let (status, value) = call(&f, &payload, "empty").await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED, "{value}");
    assert!(value["error"]
        .as_str()
        .unwrap()
        .starts_with("Out of credits."));
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn missing_usage_recovers_automatically_by_generation_without_another_inference() {
    let mut response = upstream_response();
    response.as_object_mut().unwrap().remove("usage");
    let mut f = fixture(response).await;
    let request = Uuid::new_v4();
    assert_eq!(
        call(&f, &body(&f, request), "missing").await.0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE account_ai_requests SET next_retry_at=now() WHERE id=$1")
        .bind(request)
        .execute(&f.pool)
        .await
        .unwrap();
    f.gateway.enabled = false; // Flag shutdown must not disable billing recovery.
    recover_due(&f.gateway).await.unwrap();
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        988_000_000
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    f.gateway.enabled = true;
    assert_eq!(
        call(&f, &body(&f, request), "recovered").await.1["error"],
        "already_completed"
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn lost_attribution_releases_session_after_window_and_keeps_review_record() {
    let f = fixture(json!({"choices":[]})).await;
    let request = Uuid::new_v4();
    assert_eq!(
        call(&f, &body(&f, request), "lost").await.0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE account_ai_requests SET created_at=now()-interval '16 minutes', next_retry_at=now() WHERE id=$1").bind(request).execute(&f.pool).await.unwrap();
    recover_due(&f.gateway).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM account_ai_requests WHERE id=$1")
        .bind(request)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(status, "estimated");
    let balance = f
        .gateway
        .relay
        .db
        .account_credit_balance(f.account)
        .await
        .unwrap();
    assert!(balance > 0 && balance < 1_000_000_000);
    // A different user turn really reaches upstream again after recovery.
    assert_eq!(
        call(&f, &body(&f, Uuid::new_v4()), "resumed").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn flag_off_rejects_inference_and_discovery_even_with_configured_upstream() {
    let mut f = fixture(upstream_response()).await;
    f.gateway.enabled = false;
    let response = routes(f.gateway.clone())
        .oneshot(Request::get("/capabilities").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let value: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(value["enabled"], false);
    assert_eq!(
        call(&f, &body(&f, Uuid::new_v4()), "disabled").await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn disconnected_upstream_keeps_durable_hold_then_recovers_without_operator() {
    let f = fixture(upstream_response()).await;
    f.server.abort();
    let request = Uuid::new_v4();
    assert_eq!(
        call(&f, &body(&f, request), "disconnect").await.0,
        StatusCode::CONFLICT
    );
    assert!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap()
            < 1_000_000_000
    );
    let pending: String = sqlx::query_scalar("SELECT status FROM account_ai_requests WHERE id=$1")
        .bind(request)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(pending, "pending");
    sqlx::query("UPDATE account_ai_requests SET created_at=now()-interval '16 minutes',next_retry_at=now() WHERE id=$1").bind(request).execute(&f.pool).await.unwrap();
    recover_due(&f.gateway).await.unwrap();
    let record = f
        .gateway
        .relay
        .db
        .credit_ai_recovery_request(request)
        .await
        .unwrap();
    let charged: i64 =
        sqlx::query_scalar("SELECT charged_nanousd FROM account_ai_requests WHERE id=$1")
            .bind(request)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(charged, record.reserved);
    assert!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap()
            >= 0
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn operator_correction_requires_operator_and_refunds_original_journal_once() {
    let response = upstream_response();
    let generation = response["id"].as_str().unwrap().to_string();
    let mut f = fixture(response).await;
    let request = Uuid::new_v4();
    // Simulate a crash after durable admission, before any provider attribution.
    let private: ManagedRequest = serde_json::from_str(&body(&f, request)).unwrap();
    let (_, reserve) = f
        .gateway
        .upstream
        .as_ref()
        .unwrap()
        .request(&private)
        .unwrap();
    let row: Uuid = sqlx::query_scalar("SELECT community_id FROM account_ai_sessions WHERE id=$1")
        .bind(f.session)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    f.gateway
        .relay
        .db
        .admit_credit_ai_request(
            &f.gateway.upstream.as_ref().unwrap().fingerprint,
            buzz_core::CommunityId::from_uuid(row),
            f.agent.public_key().as_bytes(),
            f.session,
            request,
            &"a".repeat(64),
            reserve,
        )
        .await
        .unwrap();
    f.gateway
        .relay
        .db
        .settle_credit_ai_request(request, reserve, true)
        .await
        .unwrap();
    let payload = json!({"request_id":request,"generation_id":generation}).to_string();
    let unauthorized = routes(f.gateway.clone())
        .oneshot(signed_path(
            &f,
            &payload,
            "not-operator",
            "/reconcile",
            &f.owner,
        ))
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
    let relay = Arc::get_mut(&mut f.gateway.relay).unwrap();
    Arc::make_mut(&mut relay.config)
        .relay_operator_pubkeys
        .push(f.owner.public_key().to_hex());
    for nonce in ["correct", "repeat-correct"] {
        let response = routes(f.gateway.clone())
            .oneshot(signed_path(&f, &payload, nonce, "/reconcile", &f.owner))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        988_000_000
    );
    let refunds: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM account_credit_ledger WHERE account_id=$1 AND entry_type='refund'",
    )
    .bind(f.account)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(refunds, 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn definite_upstream_rejection_releases_hold_without_billing_customer() {
    let f = fixture_status(
        json!({"error":{"message":"synthetic provider rejection"}}),
        StatusCode::UNAUTHORIZED,
    )
    .await;
    let request = Uuid::new_v4();
    assert_eq!(
        call(&f, &body(&f, request), "rejection").await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        1_000_000_000
    );
    let charged: i64 =
        sqlx::query_scalar("SELECT charged_nanousd FROM account_ai_requests WHERE id=$1")
            .bind(request)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(charged, 0);
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn fake_direct_provider_token_usage_settles_exact_ledger_without_returned_cost() {
    let response = json!({"id":format!("direct-{}",Uuid::new_v4()),"choices":[{"message":{"role":"assistant","content":"Hello direct"}}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}});
    let f = fixture_provider(response, StatusCode::OK, true).await;
    let request = Uuid::new_v4();
    let payload = body(&f, request);
    let (status, response) = call(&f, &payload, "direct-first").await;
    assert_eq!(status, StatusCode::OK, "{response}");
    // ceil((7*1000000001 + 3*2000000003) * 12 / 10000000).
    assert_eq!(response["chargedNanousd"], "15601");
    assert_eq!(response["model"], "direct-test-model");
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        999_984_399
    );
    let record = f
        .gateway
        .relay
        .db
        .credit_ai_recovery_request(request)
        .await
        .unwrap();
    assert_eq!(record.observed, Some(15_601));
    let usage: Value = sqlx::query_scalar("SELECT usage FROM account_ai_requests WHERE id=$1")
        .bind(request)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(usage["costSource"], "token_table");
    assert_eq!(usage["inputPriceNanousdPerMillion"], "1000000001");
    assert_eq!(usage["outputPriceNanousdPerMillion"], "2000000003");
    assert_eq!(
        record.upstream_id,
        f.gateway.upstream.as_ref().unwrap().fingerprint
    );
    assert_eq!(
        call(&f, &payload, "direct-retry").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn recovery_fences_provider_configuration_changes_and_still_expires_hold() {
    let mut response = upstream_response();
    response.as_object_mut().unwrap().remove("usage");
    let mut f = fixture(response).await;
    let request = Uuid::new_v4();
    assert_eq!(
        call(&f, &body(&f, request), "configuration-fence").await.0,
        StatusCode::CONFLICT
    );
    Arc::get_mut(f.gateway.upstream.as_mut().unwrap())
        .unwrap()
        .fingerprint = "different-provider-configuration".into();
    sqlx::query("UPDATE account_ai_requests SET next_retry_at=now() WHERE id=$1")
        .bind(request)
        .execute(&f.pool)
        .await
        .unwrap();
    recover_due(&f.gateway).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM account_ai_requests WHERE id=$1")
        .bind(request)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        status, "pending",
        "must not settle from the replacement provider's generation endpoint"
    );
    sqlx::query("UPDATE account_ai_requests SET created_at=now()-interval '16 minutes', next_retry_at=now() WHERE id=$1").bind(request).execute(&f.pool).await.unwrap();
    recover_due(&f.gateway).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM account_ai_requests WHERE id=$1")
        .bind(request)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(status, "estimated");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn openrouter_user_is_stable_keyed_account_pseudonym_and_models_are_server_allowlisted() {
    let f = fixture(upstream_response()).await;
    for nonce in ["customer-first", "customer-second"] {
        assert_eq!(
            call(&f, &body(&f, Uuid::new_v4()), nonce).await.0,
            StatusCode::OK
        );
    }
    let identifiers: Vec<String> = f
        .sent
        .lock()
        .unwrap()
        .iter()
        .map(|v| v["user"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(identifiers[0], identifiers[1]);
    assert!(identifiers[0].starts_with("colony_"));
    assert_eq!(identifiers[0].len(), 71);
    assert!(!identifiers[0].contains(&f.account.to_string()));
    assert!(!identifiers[0].contains('@'));
    let other = fixture(upstream_response()).await;
    assert_eq!(
        call(&other, &body(&other, Uuid::new_v4()), "other-customer")
            .await
            .0,
        StatusCode::OK
    );
    assert_ne!(
        identifiers[0],
        other.sent.lock().unwrap()[0]["user"].as_str().unwrap()
    );
    let mut blocked = fixture(upstream_response()).await;
    Arc::get_mut(blocked.gateway.upstream.as_mut().unwrap())
        .unwrap()
        .model = "unchecked-commercial-terms".into();
    assert_eq!(
        call(&blocked, &body(&blocked, Uuid::new_v4()), "unchecked-model")
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(blocked.calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        blocked
            .gateway
            .relay
            .db
            .account_credit_balance(blocked.account)
            .await
            .unwrap(),
        1_000_000_000
    );
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn gateway_response_never_exports_upstream_credentials_or_general_api_access() {
    let mut response = upstream_response();
    response["api_key"] = json!("synthetic-test-key");
    response["endpoint"] = json!("https://provider.invalid/general-api-secret");
    response["usage"]["token"] = json!("synthetic-test-key");
    response["choices"][0]["token"] = json!("synthetic-test-key");
    response["choices"][0]["message"]["credentials"] = json!({"key":"synthetic-test-key"});
    let f = fixture(response).await;
    let request = Uuid::new_v4();
    let (status, response) = call(&f, &body(&f, request), "private-response").await;
    assert_eq!(status, StatusCode::OK);
    let serialized = response.to_string();
    assert!(!serialized.contains("synthetic-test-key"));
    assert!(!serialized.contains("general-api-secret"));
    assert!(!serialized.contains("gen-"));
    assert_eq!(response["id"], format!("colony-{request}"));
    assert_eq!(response["choices"][0]["message"]["content"], "Hello");
    let bare = Request::post("/managed-inference")
        .header("host", &f.host)
        .header(
            "authorization",
            format!("Bearer {}", response["id"].as_str().unwrap()),
        )
        .body(Body::from(body(&f, Uuid::new_v4())))
        .unwrap();
    assert_eq!(
        routes(f.gateway.clone())
            .oneshot(bare)
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    let generic = Request::post("/v1/chat/completions")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(
        routes(f.gateway.clone())
            .oneshot(generic)
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
}

async fn account_email(f: &Fixture) -> String {
    sqlx::query_scalar("SELECT email FROM accounts WHERE id = $1")
        .bind(f.account)
        .fetch_one(&f.pool)
        .await
        .unwrap()
}

fn signed_get(f: &Fixture, path: &str, nonce: &str, keys: &Keys) -> Request<Body> {
    signed_get_on(f, &f.host, path, nonce, keys)
}
fn signed_get_on(f: &Fixture, host: &str, path: &str, nonce: &str, keys: &Keys) -> Request<Body> {
    let url = format!("https://{host}/api/credits-gateway{path}");
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .custom_created_at(f.auth_time)
        .tags([
            Tag::parse(["u", &url]).unwrap(),
            Tag::parse(["method", "GET"]).unwrap(),
            Tag::parse(["nonce", nonce]).unwrap(),
        ])
        .sign_with_keys(keys)
        .unwrap();
    Request::get(path)
        .header("host", host)
        .header(
            "authorization",
            format!(
                "Nostr {}",
                base64::engine::general_purpose::STANDARD
                    .encode(serde_json::to_vec(&event).unwrap())
            ),
        )
        .body(Body::empty())
        .unwrap()
}

async fn get_json(f: &Fixture, request: Request<Body>) -> (StatusCode, Value) {
    let response = routes(f.gateway.clone()).oneshot(request).await.unwrap();
    let status = response.status();
    let value = serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
        .unwrap_or(Value::Null);
    (status, value)
}

async fn ledger_rows(f: &Fixture) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM account_credit_ledger WHERE account_id = $1")
        .bind(f.account)
        .fetch_one(&f.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn free_ai_account_gets_a_real_reply_with_zero_balance_and_a_metered_journal() {
    let mut f = fixture(upstream_response()).await;
    sqlx::query("DELETE FROM account_credit_ledger WHERE account_id = $1")
        .bind(f.account)
        .execute(&f.pool)
        .await
        .unwrap();
    // Control: every other account still needs credits, before any upstream call.
    let (status, value) = call(&f, &body(&f, Uuid::new_v4()), "control").await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED, "{value}");
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    f.gateway.policy = Arc::new(GatewayPolicy {
        free_ai_accounts: vec![account_email(&f).await],
        ..GatewayPolicy::default()
    });
    let request = Uuid::new_v4();
    let payload = body(&f, request);
    let (status, value) = call(&f, &payload, "free").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["choices"][0]["message"]["content"], "Hello");
    assert_eq!(value["chargedNanousd"], "12000000");
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    // Metered in the journal, invisible to the credit ledger and balance.
    let (status, charged): (String, i64) =
        sqlx::query_as("SELECT status, charged_nanousd FROM account_ai_requests WHERE id = $1")
            .bind(request)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!((status.as_str(), charged), ("settled", 12_000_000));
    assert_eq!(ledger_rows(&f).await, 0);
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        0
    );
    // Free access does not weaken authentication or replay protection.
    let (status, _) = call(&f, &payload, "free").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn global_daily_cap_refuses_with_a_distinct_code_before_any_upstream_call() {
    let mut f = fixture(upstream_response()).await;
    for cap in [1, 0] {
        f.gateway.policy = Arc::new(GatewayPolicy {
            global_daily_cap_nanousd: Some(cap),
            ..GatewayPolicy::default()
        });
        let (status, value) = call(&f, &body(&f, Uuid::new_v4()), &format!("cap-{cap}")).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{value}");
        assert_eq!(value["code"], "daily_limit");
        assert!(value["error"].as_str().unwrap().contains("daily limit"));
    }
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        1_000_000_000
    );
    // Without a ceiling the same request is served.
    f.gateway.policy = Arc::new(GatewayPolicy::default());
    let (status, value) = call(&f, &body(&f, Uuid::new_v4()), "no-cap").await;
    assert_eq!(status, StatusCode::OK, "{value}");
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn access_route_reports_only_the_callers_own_free_ai_status() {
    let mut f = fixture(upstream_response()).await;
    let (status, value) = get_json(&f, signed_get(&f, "/access", "plain", &f.owner)).await;
    assert_eq!((status, &value["freeAi"]), (StatusCode::OK, &json!(false)));
    let (_, value) = get_json(
        &f,
        Request::get("/capabilities")
            .header("host", &f.host)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(value["freeAiConfigured"], false);
    f.gateway.policy = Arc::new(GatewayPolicy {
        free_ai_accounts: vec![account_email(&f).await],
        ..GatewayPolicy::default()
    });
    let (status, value) = get_json(&f, signed_get(&f, "/access", "owner", &f.owner)).await;
    assert_eq!((status, &value["freeAi"]), (StatusCode::OK, &json!(true)));
    assert!(
        value.as_object().unwrap().len() == 1,
        "no list or email leaks"
    );
    let (_, value) = get_json(
        &f,
        Request::get("/capabilities")
            .header("host", &f.host)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(value["freeAiConfigured"], true);
    assert!(!value.to_string().contains("example.invalid"));
    // A signer without a verified account is not free.
    let (_, value) = get_json(&f, signed_get(&f, "/access", "agent", &f.agent)).await;
    assert_eq!(value["freeAi"], false);
    // Anonymous callers are rejected, and a disabled gateway never reports free.
    let anonymous = Request::get("/access")
        .header("host", &f.host)
        .body(Body::empty())
        .unwrap();
    assert_eq!(get_json(&f, anonymous).await.0, StatusCode::UNAUTHORIZED);
    f.gateway.enabled = false;
    let (_, value) = get_json(&f, signed_get(&f, "/access", "disabled", &f.owner)).await;
    assert_eq!(value["freeAi"], false);
}

/// A second host the owner has never joined, like the deployment's root host a
/// returning device talks to before it opens a business.
async fn unjoined_host(f: &Fixture) -> String {
    let community = Uuid::new_v4();
    let host = format!("root-{community}.example");
    sqlx::query("INSERT INTO communities (id,host) VALUES ($1,$2)")
        .bind(community)
        .bind(&host)
        .execute(&f.pool)
        .await
        .unwrap();
    host
}

fn free_policy(email: String) -> Arc<GatewayPolicy> {
    Arc::new(GatewayPolicy {
        free_ai_accounts: vec![email],
        ..GatewayPolicy::default()
    })
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn closed_relay_owner_learns_free_ai_status_from_a_host_they_have_not_joined() {
    let mut f = fixture_in(upstream_response(), StatusCode::OK, false, true).await;
    f.gateway.policy = free_policy(account_email(&f).await);
    let root = unjoined_host(&f).await;

    // The host a returning device uses before it opens a business: the owner
    // signed in with a verified account but is not a member of this host.
    let (status, value) = get_json(
        &f,
        signed_get_on(&f, &root, "/access", "root-owner", &f.owner),
    )
    .await;
    assert_eq!((status, &value["freeAi"]), (StatusCode::OK, &json!(true)));
    assert_eq!(
        value.as_object().unwrap().len(),
        1,
        "no list or email leaks"
    );

    // The same event cannot be replayed to learn the answer again.
    let replay = signed_get_on(&f, &root, "/access", "root-replay", &f.owner);
    let (parts, _) = replay.into_parts();
    let again = |parts: &axum::http::request::Parts| {
        let mut request = Request::get("/access").body(Body::empty()).unwrap();
        *request.headers_mut() = parts.headers.clone();
        request
    };
    assert_eq!(get_json(&f, again(&parts)).await.0, StatusCode::OK);
    assert_eq!(
        get_json(&f, again(&parts)).await.0,
        StatusCode::UNAUTHORIZED
    );

    // A signer with no verified account is told nothing, not even "forbidden".
    let (status, value) = get_json(
        &f,
        signed_get_on(&f, &root, "/access", "root-agent", &f.agent),
    )
    .await;
    assert_eq!((status, &value["freeAi"]), (StatusCode::OK, &json!(false)));

    // The business the owner belongs to still answers the same way.
    let (status, value) = get_json(&f, signed_get(&f, "/access", "member", &f.owner)).await;
    assert_eq!((status, &value["freeAi"]), (StatusCode::OK, &json!(true)));
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn closed_relay_still_refuses_spending_from_a_host_the_owner_has_not_joined() {
    let mut f = fixture_in(upstream_response(), StatusCode::OK, false, true).await;
    f.gateway.policy = free_policy(account_email(&f).await);
    let root = unjoined_host(&f).await;

    // Only the account-level answer relaxed. Opening a session for an agent and
    // spending through it stay bound to a community the caller belongs to.
    let session = json!({"agent_pubkey": f.agent.public_key().to_hex()}).to_string();
    let response = routes(f.gateway.clone())
        .oneshot(signed_path_on(
            &f,
            &root,
            &session,
            "root-session",
            "/sessions",
            &f.owner,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let payload = body(&f, Uuid::new_v4());
    let response = routes(f.gateway.clone())
        .oneshot(signed_path_on(
            &f,
            &root,
            &payload,
            "root-spend",
            "/managed-inference",
            &f.agent,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(f.calls.load(Ordering::SeqCst), 0, "no upstream call");

    // Inside the owner's own business the same spending works.
    let (status, value) = call(&f, &payload, "member-spend").await;
    assert_eq!(status, StatusCode::OK, "{value}");
}
