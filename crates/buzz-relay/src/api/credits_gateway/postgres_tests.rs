use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use base64::Engine;
use nostr::{EventBuilder, Keys, Kind, Tag};
use sqlx::PgPool;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
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
    /// Statuses the provider answers with, in order, before it starts answering
    /// normally. Fill it after building the fixture.
    script: Arc<std::sync::Mutex<std::collections::VecDeque<StatusCode>>>,
    /// Milliseconds the provider thinks before it answers.
    delay_ms: Arc<AtomicU64>,
    /// How many of the next calls hang for `hang_ms` before the provider
    /// answers, so a request can time out and later ones are answered at once.
    hang_calls: Arc<AtomicUsize>,
    hang_ms: Arc<AtomicU64>,
    /// Milliseconds between the provider's response headers (sent at once, with
    /// a whitespace keep-alive) and its JSON body, as OpenRouter answers a
    /// non-streamed request. Zero answers in one piece.
    late_ms: Arc<AtomicU64>,
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
    fixture_with(response, upstream_status, direct, closed_relay, false).await
}

/// The gateway with a chain of three free models, `free/a:free`, `free/b:free` then
/// `free/c:free`, which OpenRouter does not pin to one provider like the default
/// model.
async fn fixture_chain(response: Value) -> Fixture {
    fixture_with(response, StatusCode::OK, false, false, true).await
}

async fn fixture_with(
    response: Value,
    upstream_status: StatusCode,
    direct: bool,
    closed_relay: bool,
    chain: bool,
) -> Fixture {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let sent = Arc::new(std::sync::Mutex::new(Vec::new()));
    let captured = sent.clone();
    let script = Arc::new(std::sync::Mutex::new(std::collections::VecDeque::<
        StatusCode,
    >::new()));
    let scripted = script.clone();
    let delay_ms = Arc::new(AtomicU64::new(0));
    let thinking = delay_ms.clone();
    let hang_calls = Arc::new(AtomicUsize::new(0));
    let hang_ms = Arc::new(AtomicU64::new(0));
    let (hanging_calls, hanging_ms) = (hang_calls.clone(), hang_ms.clone());
    let late_ms = Arc::new(AtomicU64::new(0));
    let lateness = late_ms.clone();
    let completion = response.clone();
    let upstream = Router::new()
        .route(
            "/chat/completions",
            post(move |headers: HeaderMap, Json(body): Json<Value>| {
                let counter = counter.clone();
                let captured = captured.clone();
                let scripted = scripted.clone();
                let thinking = thinking.clone();
                let hanging_calls = hanging_calls.clone();
                let hanging_ms = hanging_ms.clone();
                let lateness = lateness.clone();
                let mut completion = completion.clone();
                async move {
                    assert_eq!(headers["authorization"], "Bearer synthetic-test-key");
                    assert!(headers.get("x-auth-tag").is_none());
                    if chain {
                        assert!(["free/a:free", "free/b:free", "free/c:free"]
                            .contains(&body["model"].as_str().unwrap()));
                        assert_eq!(body["provider"]["max_price"]["request"], 0);
                        assert!(body["provider"].get("only").is_none());
                        assert!(body["user"]
                            .as_str()
                            .is_some_and(|user| user.starts_with("colony_") && user.len() == 71));
                    } else if direct {
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
                    if hanging_calls.load(Ordering::SeqCst) > 0 {
                        hanging_calls.fetch_sub(1, Ordering::SeqCst);
                        let hang = hanging_ms.load(Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(hang)).await;
                    }
                    let delay = thinking.load(Ordering::SeqCst);
                    if delay > 0 {
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                    }
                    let refusal = scripted.lock().unwrap().pop_front();
                    if let Some(status) = refusal {
                        return (status, Json(json!({"error":{"message":"scripted"}})))
                            .into_response();
                    }
                    if index > 0 {
                        if let Some(id) = completion["id"].as_str().map(str::to_owned) {
                            completion["id"] = json!(format!("{id}-{index}"));
                        }
                    }
                    let late = lateness.load(Ordering::SeqCst);
                    if late > 0 && upstream_status.is_success() {
                        let text = completion.to_string();
                        let chunks = futures_util::stream::unfold(0, move |step| {
                            let text = text.clone();
                            async move {
                                match step {
                                    0 => {
                                        Some((Ok::<_, std::convert::Infallible>(b" ".to_vec()), 1))
                                    }
                                    1 => {
                                        tokio::time::sleep(Duration::from_millis(late)).await;
                                        Some((Ok(text.into_bytes()), 2))
                                    }
                                    _ => None,
                                }
                            }
                        });
                        return (
                            upstream_status,
                            [(axum::http::header::CONTENT_TYPE, "application/json")],
                            Body::from_stream(chunks),
                        )
                            .into_response();
                    }
                    (upstream_status, Json(completion)).into_response()
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
        upstream: Some(Arc::new(if chain {
            Upstream::fake_chain(
                origin,
                true,
                &[
                    ("free/a:free", None),
                    ("free/b:free", None),
                    ("free/c:free", None),
                ],
            )
        } else if direct {
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
        keepalive: Keepalive::PRODUCTION,
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
        script,
        delay_ms,
        hang_calls,
        hang_ms,
        late_ms,
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
async fn real_route_admits_a_full_scout_session_and_charges_returned_cost() {
    let f = fixture(upstream_response()).await;
    // 100 shell rounds and the 20 real Scout tools: 203 messages, past 64 KiB.
    let payload = super::super::credits_gateway_upstream::scout_session::request(
        f.session,
        Uuid::new_v4(),
        100,
        3_000,
    )
    .to_string();
    assert!(payload.len() > 64 * 1024);
    let (status, value) = call(&f, &payload, "scout-session").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["chargedNanousd"], "12000000");
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    let sent = f.sent.lock().unwrap();
    assert_eq!(sent[0]["messages"].as_array().unwrap().len(), 203);
    assert_eq!(sent[0]["tools"].as_array().unwrap().len(), 20);
}

/// The bytes the shipped 3.0.9 client really posts, through the real route. Its
/// messages carry `"tool_calls": null`, which hand-built bodies never did, so the
/// relay refused every request the app ever made.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn real_route_admits_what_the_packaged_client_really_posts() {
    use super::super::credits_gateway_upstream::scout_session::{
        PACKAGED_FIRST_HELLO, PACKAGED_TOOL_ROUND,
    };
    for (name, packaged, messages) in [
        ("first-hello", PACKAGED_FIRST_HELLO, 2),
        ("tool-round", PACKAGED_TOOL_ROUND, 4),
    ] {
        let f = fixture(upstream_response()).await;
        let mut value: Value = serde_json::from_str(packaged).unwrap();
        value["session_id"] = json!(f.session);
        value["request_id"] = json!(Uuid::new_v4());
        let (status, reply) = call(&f, &value.to_string(), name).await;
        assert_eq!(status, StatusCode::OK, "{name}: {reply}");
        assert_eq!(f.calls.load(Ordering::SeqCst), 1, "{name}");
        let sent = f.sent.lock().unwrap();
        let forwarded = sent[0]["messages"].as_array().unwrap();
        assert_eq!(forwarded.len(), messages, "{name}");
        // A null optional field is dropped before the provider sees it.
        for message in forwarded {
            assert!(
                message.as_object().unwrap().values().all(|v| !v.is_null()),
                "{name}: {message}"
            );
        }
    }
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

/// A free model is rate limited upstream about as often as it answers, and the
/// managed client makes one attempt, so the relay rides out a 429 itself. The
/// provider declines a 429 before generating: nothing is billed for it.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_rate_limited_provider_is_retried_and_the_customer_is_charged_once() {
    let f = fixture(upstream_response()).await;
    f.script
        .lock()
        .unwrap()
        .extend([StatusCode::TOO_MANY_REQUESTS, StatusCode::TOO_MANY_REQUESTS]);
    let request = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, request), "limited-then-ok").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["chargedNanousd"], "12000000");
    // Two refusals and the answer: three trips, one charge.
    assert_eq!(f.calls.load(Ordering::SeqCst), 3);
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        988_000_000
    );
    let charged: i64 =
        sqlx::query_scalar("SELECT charged_nanousd FROM account_ai_requests WHERE id=$1")
            .bind(request)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(charged, 12_000_000);
    // The client's own retry of a settled request is still refused: no second charge.
    assert_eq!(
        call(&f, &body(&f, request), "limited-then-ok-again")
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_client_that_disconnects_mid_request_still_has_its_usage_settled() {
    // GATE-309-R2: a harness killed while its request was with the provider
    // dropped the handler, the hold stayed pending and, 15 minutes later, settled
    // provisionally at the reserved maximum.
    let f = fixture(upstream_response()).await;
    f.delay_ms.store(300, Ordering::SeqCst);
    let request = Uuid::new_v4();
    let payload = body(&f, request);
    // The client leaves once the request has reached the provider.
    let mut pending = Box::pin(routes(f.gateway.clone()).oneshot(signed(&f, &payload, "gone")));
    tokio::select! {
        _ = &mut pending => panic!("answered before the client left"),
        _ = async {
            while f.calls.load(Ordering::SeqCst) == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        } => {}
    }
    drop(pending);
    let mut status = String::new();
    for _ in 0..50 {
        status = sqlx::query_scalar("SELECT status FROM account_ai_requests WHERE id=$1")
            .bind(request)
            .fetch_one(&f.pool)
            .await
            .unwrap();
        if status != "pending" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    // Settled at the provider's own cost, without the recovery worker.
    assert_eq!(status, "settled");
    let charged: i64 =
        sqlx::query_scalar("SELECT charged_nanousd FROM account_ai_requests WHERE id=$1")
            .bind(request)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(charged, 12_000_000);
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
    // The app's own retry of that request is refused: it was charged once.
    assert_eq!(
        call(&f, &payload, "gone-retry").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_provider_that_stays_rate_limited_is_refused_and_nothing_is_billed() {
    let f = fixture_status(
        json!({"error":{"message":"synthetic rate limit"}}),
        StatusCode::TOO_MANY_REQUESTS,
    )
    .await;
    let request = Uuid::new_v4();
    assert_eq!(
        call(&f, &body(&f, request), "limited-forever").await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    // The first try and three retries, then the refusal the app always saw.
    assert_eq!(f.calls.load(Ordering::SeqCst), 4);
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

/// GATE-311: the free model was rate limited and the judge's account fell back
/// to "Connect your AI". With a chain the next free model answers in the same
/// request, and the stored usage and the charge name the model that answered.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_rate_limited_free_model_hands_over_and_the_metering_names_the_model_that_answered() {
    let free_reply = json!({"id":format!("gen-{}",Uuid::new_v4()),"choices":[{"message":{"role":"assistant","content":"Hello"},"finish_reason":"stop"}],"usage":{"cost":0,"total_tokens":10}});
    let f = fixture_chain(free_reply).await;
    f.script
        .lock()
        .unwrap()
        .push_back(StatusCode::TOO_MANY_REQUESTS);
    let request = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, request), "free-handover").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["model"], "free/b:free");
    assert_eq!(value["chargedNanousd"], "0");
    // The limited model once, with no wait and no retry of it, then the next.
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    let sent = f.sent.lock().unwrap().clone();
    assert_eq!(sent[0]["model"], "free/a:free");
    assert_eq!(sent[1]["model"], "free/b:free");
    let (model, charged): (String, i64) = sqlx::query_as(
        "SELECT usage->>'model', charged_nanousd FROM account_ai_requests WHERE id=$1",
    )
    .bind(request)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(model, "free/b:free");
    assert_eq!(charged, 0);
    // A free model costs the customer nothing.
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        1_000_000_000
    );
}

#[derive(Clone, Default)]
struct LogBuffer(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

impl std::io::Write for LogBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Route logs into a buffer until the guard drops. The runtime of a test is
/// single threaded, so the request task logs on this thread too.
fn capture_logs() -> (LogBuffer, tracing::subscriber::DefaultGuard) {
    let logs = LogBuffer::default();
    let sink = logs.clone();
    let guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .with_writer(move || sink.clone())
            .with_ansi(false)
            .finish(),
    );
    (logs, guard)
}

fn finished_lines(logs: &LogBuffer) -> Vec<String> {
    String::from_utf8_lossy(&logs.0.lock().unwrap())
        .lines()
        .filter(|line| line.contains("Colony gateway request finished"))
        .map(str::to_owned)
        .collect()
}

/// A field is quoted or not depending on the formatter.
fn has(line: &str, field: &str, value: &str) -> bool {
    line.contains(&format!("{field}=\"{value}\"")) || line.contains(&format!("{field}={value}"))
}

/// GATE-311-R2: a first hello on a slow free model sat silent for a minute, the
/// proxy in front of the relay closed the idle connection, and the managed
/// client reported "Usage is being recovered automatically" while the request
/// carried on unseen. The relay now sends bytes while it waits, and the answer
/// still arrives as the same JSON, charged once.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_slow_provider_gets_bytes_before_an_idle_limit_and_the_customer_is_charged_once() {
    use futures_util::StreamExt;
    let mut f = fixture(upstream_response()).await;
    f.gateway.keepalive = Keepalive {
        after: Duration::from_millis(100),
        every: Duration::from_millis(100),
    };
    f.delay_ms.store(900, Ordering::SeqCst);
    let request = Uuid::new_v4();
    let payload = body(&f, request);
    let started = std::time::Instant::now();
    let response = routes(f.gateway.clone())
        .oneshot(signed(&f, &payload, "slow-provider"))
        .await
        .unwrap();
    // The headers are out at about `after`, long before the provider answers.
    assert!(
        started.elapsed() < Duration::from_millis(700),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(response.status(), StatusCode::OK);
    let mut frames = response.into_body().into_data_stream();
    let first = frames.next().await.unwrap().unwrap();
    assert_eq!(
        &first[..],
        b" ",
        "a byte on the wire while the provider thinks"
    );
    assert!(
        started.elapsed() < Duration::from_millis(700),
        "{:?}",
        started.elapsed()
    );
    let mut bytes = first.to_vec();
    while let Some(frame) = frames.next().await {
        bytes.extend_from_slice(&frame.unwrap());
    }
    // The managed client parses the whole body with `serde_json::from_slice`.
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(value["choices"].is_array(), "{value}");
    assert_eq!(value["chargedNanousd"], "12000000");
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        988_000_000
    );
    // The same request is already charged: no second charge.
    assert_eq!(
        call(&f, &payload, "slow-provider-again").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_refusal_after_the_stream_started_still_releases_the_hold_and_logs_the_real_status() {
    let (logs, _guard) = capture_logs();
    let mut f = fixture(upstream_response()).await;
    f.gateway.keepalive = Keepalive {
        after: Duration::from_millis(100),
        every: Duration::from_millis(100),
    };
    f.delay_ms.store(600, Ordering::SeqCst);
    f.script.lock().unwrap().push_back(StatusCode::NOT_FOUND);
    let request = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, request), "slow-refusal").await;
    // The status was committed when the stream began; the body says what failed.
    assert_eq!(status, StatusCode::OK);
    assert!(value["error"].is_string(), "{value}");
    assert!(value.get("choices").is_none(), "{value}");
    let (state, charged): (String, i64) =
        sqlx::query_as("SELECT status, charged_nanousd FROM account_ai_requests WHERE id=$1")
            .bind(request)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!((state.as_str(), charged), ("settled", 0));
    assert_eq!(
        f.gateway
            .relay
            .db
            .account_credit_balance(f.account)
            .await
            .unwrap(),
        1_000_000_000
    );
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(
        has(&lines[0], "outcome", "upstream_rejected"),
        "{}",
        lines[0]
    );
    assert!(has(&lines[0], "status", "503"), "{}", lines[0]);
    assert!(has(&lines[0], "streamed", "true"), "{}", lines[0]);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn every_request_ends_in_one_log_line_with_its_path_and_no_content() {
    let (logs, _guard) = capture_logs();
    let ok = fixture(upstream_response()).await;
    let payload = body(&ok, Uuid::new_v4());
    assert_eq!(call(&ok, &payload, "logged-ok").await.0, StatusCode::OK);
    // The same request again is refused at the door, and that is logged too.
    assert_eq!(
        call(&ok, &payload, "logged-again").await.0,
        StatusCode::CONFLICT
    );
    // A provider that refuses is a different path.
    let refused = fixture(upstream_response()).await;
    refused
        .script
        .lock()
        .unwrap()
        .push_back(StatusCode::NOT_FOUND);
    assert_eq!(
        call(&refused, &body(&refused, Uuid::new_v4()), "logged-refused")
            .await
            .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    // And one the provider fails without a clear answer.
    let unclear = fixture(upstream_response()).await;
    unclear
        .script
        .lock()
        .unwrap()
        .push_back(StatusCode::BAD_GATEWAY);
    assert_eq!(
        call(&unclear, &body(&unclear, Uuid::new_v4()), "logged-unclear")
            .await
            .0,
        StatusCode::CONFLICT
    );
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 4, "{lines:?}");
    assert!(has(&lines[0], "outcome", "ok"), "{}", lines[0]);
    assert!(has(&lines[0], "status", "200"), "{}", lines[0]);
    assert!(has(&lines[0], "primary_model", "openai/gpt-4.1-mini"));
    assert!(has(&lines[0], "answered_by", "openai/gpt-4.1-mini"));
    assert!(has(&lines[0], "streamed", "false"), "{}", lines[0]);
    assert!(lines[0].contains("elapsed_ms="), "{}", lines[0]);
    assert!(
        has(&lines[0], "models_tried", "openai/gpt-4.1-mini(200)"),
        "{}",
        lines[0]
    );
    assert!(
        has(&lines[1], "outcome", "admission_completed"),
        "{}",
        lines[1]
    );
    assert!(has(&lines[1], "status", "409"), "{}", lines[1]);
    // Refused at the door: no provider was called.
    assert!(has(&lines[1], "models_tried", "none"), "{}", lines[1]);
    assert!(
        has(&lines[2], "outcome", "upstream_rejected"),
        "{}",
        lines[2]
    );
    assert!(has(&lines[2], "status", "503"), "{}", lines[2]);
    assert!(
        has(&lines[2], "models_tried", "openai/gpt-4.1-mini(404)"),
        "{}",
        lines[2]
    );
    assert!(
        has(&lines[3], "outcome", "upstream_unclear"),
        "{}",
        lines[3]
    );
    assert!(has(&lines[3], "status", "409"), "{}", lines[3]);
    assert!(
        has(&lines[3], "models_tried", "openai/gpt-4.1-mini(502)"),
        "{}",
        lines[3]
    );
    // The provider's own reason is logged, once per refusal and cleaned.
    let all = String::from_utf8_lossy(&logs.0.lock().unwrap()).into_owned();
    let reasons: Vec<&str> = all
        .lines()
        .filter(|line| line.contains("upstream did not accept a request"))
        .collect();
    assert_eq!(reasons.len(), 2, "{all}");
    assert!(has(reasons[0], "upstream_status", "404"), "{}", reasons[0]);
    assert!(has(reasons[1], "upstream_status", "502"), "{}", reasons[1]);
    for line in reasons {
        assert!(has(line, "upstream_message", "scripted"), "{line}");
    }
    // Never the prompt, a reply, a key or a bearer.
    for secret in ["Hello Colony", "synthetic-test-key", "Bearer"] {
        assert!(!all.contains(secret), "{secret} leaked into the log");
    }
}

fn free_reply() -> Value {
    json!({"id":format!("gen-{}",Uuid::new_v4()),"choices":[{"message":{"role":"assistant","content":"Hello"},"finish_reason":"stop"}],"usage":{"cost":0,"total_tokens":10}})
}

async fn row(f: &Fixture, request: Uuid) -> (String, i64) {
    sqlx::query_as("SELECT status, charged_nanousd FROM account_ai_requests WHERE id=$1")
        .bind(request)
        .fetch_one(&f.pool)
        .await
        .unwrap()
}

async fn balance(f: &Fixture) -> i64 {
    f.gateway
        .relay
        .db
        .account_credit_balance(f.account)
        .await
        .unwrap()
}

/// GATE-311 (29 Oct): the primary answered 429, then the first fallback 403
/// ("only available on agentic harnesses"), and the request ended there with the
/// rest of the free models never asked. A model that refuses on its own account
/// is skipped: the third answers, the customer pays nothing, and the one log
/// line names every call.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_model_that_refuses_access_is_skipped_and_the_third_answers_with_every_call_logged() {
    let (logs, _guard) = capture_logs();
    let f = fixture_chain(free_reply()).await;
    f.script
        .lock()
        .unwrap()
        .extend([StatusCode::TOO_MANY_REQUESTS, StatusCode::FORBIDDEN]);
    let request = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, request), "refused-then-third").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["model"], "free/c:free");
    assert_eq!(value["chargedNanousd"], "0");
    assert_eq!(f.calls.load(Ordering::SeqCst), 3);
    let models: Vec<String> = f
        .sent
        .lock()
        .unwrap()
        .iter()
        .map(|sent| sent["model"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(models, ["free/a:free", "free/b:free", "free/c:free"]);
    let (model, charged): (String, i64) = sqlx::query_as(
        "SELECT usage->>'model', charged_nanousd FROM account_ai_requests WHERE id=$1",
    )
    .bind(request)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!((model.as_str(), charged), ("free/c:free", 0));
    assert_eq!(balance(&f).await, 1_000_000_000);
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(has(&lines[0], "outcome", "ok"), "{}", lines[0]);
    assert!(has(&lines[0], "answered_by", "free/c:free"), "{}", lines[0]);
    assert!(
        has(
            &lines[0],
            "models_tried",
            "free/a:free(429),free/b:free(403),free/c:free(200)"
        ),
        "{}",
        lines[0]
    );
    // The refusal that used to end the request says why, in the provider's words.
    let all = String::from_utf8_lossy(&logs.0.lock().unwrap()).into_owned();
    let refusal = all
        .lines()
        .find(|line| line.contains("upstream did not accept a request"))
        .unwrap_or_else(|| panic!("no refusal line in {all}"));
    assert!(has(refusal, "model", "free/b:free"), "{refusal}");
    assert!(has(refusal, "upstream_status", "403"), "{refusal}");
    assert!(has(refusal, "upstream_message", "scripted"), "{refusal}");
}

/// When every model refuses, the answer is the one it has always been (503, the
/// hold released, nothing billed) after exactly one call to each model.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn every_model_refusing_is_todays_503_after_one_call_each_and_the_hold_is_released() {
    let (logs, _guard) = capture_logs();
    let f = fixture_chain(free_reply()).await;
    f.script.lock().unwrap().extend([
        StatusCode::FORBIDDEN,
        StatusCode::PAYMENT_REQUIRED,
        StatusCode::NOT_FOUND,
    ]);
    let request = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, request), "all-refuse").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{value}");
    assert_eq!(f.calls.load(Ordering::SeqCst), 3);
    assert_eq!(row(&f, request).await, ("settled".to_owned(), 0));
    assert_eq!(balance(&f).await, 1_000_000_000);
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(
        has(&lines[0], "outcome", "upstream_rejected"),
        "{}",
        lines[0]
    );
    assert!(has(&lines[0], "status", "503"), "{}", lines[0]);
    assert!(has(&lines[0], "answered_by", "none"), "{}", lines[0]);
    assert!(
        has(
            &lines[0],
            "models_tried",
            "free/a:free(403),free/b:free(402),free/c:free(404)"
        ),
        "{}",
        lines[0]
    );
}

/// A refusal of the key itself would be the same on every model: it ends the
/// request at once, even after a model was only limited.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_refused_key_ends_the_request_at_once_with_the_remaining_models_unasked() {
    let (logs, _guard) = capture_logs();
    let f = fixture_chain(free_reply()).await;
    f.script
        .lock()
        .unwrap()
        .extend([StatusCode::TOO_MANY_REQUESTS, StatusCode::UNAUTHORIZED]);
    let request = Uuid::new_v4();
    let (status, _) = call(&f, &body(&f, request), "key-refused").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    assert_eq!(row(&f, request).await, ("settled".to_owned(), 0));
    assert_eq!(balance(&f).await, 1_000_000_000);
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(
        has(
            &lines[0],
            "models_tried",
            "free/a:free(429),free/b:free(401)"
        ),
        "{}",
        lines[0]
    );
}

/// GATE-312 R2 (29 Oct): a free model took 90 s to answer nothing, the one call
/// used the whole budget and the request ended unclear. A free model that gives
/// no answer in time is handed over like a refusal: the next one answers, the
/// customer pays nothing and the log says what happened to the first.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_free_model_that_hangs_hands_over_to_the_next_and_nothing_is_charged() {
    let (logs, _guard) = capture_logs();
    let f = fixture_chain(free_reply()).await;
    f.hang_ms.store(2000, Ordering::SeqCst);
    f.hang_calls.store(1, Ordering::SeqCst);
    let request = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, request), "hang-then-next").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["model"], "free/b:free");
    assert_eq!(value["chargedNanousd"], "0");
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    assert_eq!(row(&f, request).await, ("settled".to_owned(), 0));
    assert_eq!(balance(&f).await, 1_000_000_000);
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(has(&lines[0], "outcome", "ok"), "{}", lines[0]);
    assert!(
        has(
            &lines[0],
            "models_tried",
            "free/a:free(timeout),free/b:free(200)"
        ),
        "{}",
        lines[0]
    );
    let all = String::from_utf8_lossy(&logs.0.lock().unwrap()).into_owned();
    let refusal = all
        .lines()
        .find(|line| line.contains("upstream did not accept a request"))
        .unwrap_or_else(|| panic!("no refusal line in {all}"));
    assert!(has(refusal, "model", "free/a:free"), "{refusal}");
    assert!(has(refusal, "upstream_status", "0"), "{refusal}");
}

/// GATE-312 R3 (29 Oct, 16:30:51): the provider answered 200 with its headers
/// at once and the JSON a while later. The deadline that hands a silent model
/// to the next one must not also cut a model that is already answering: the
/// request is answered by that model, nothing is charged and no other model is
/// asked.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_free_model_that_sent_its_headers_is_answered_even_when_its_body_is_late() {
    let (logs, _guard) = capture_logs();
    let f = fixture_chain(free_reply()).await;
    // Past the 400 ms the test relay gives a model for its headers, inside the
    // 1 s it gives a call.
    f.late_ms.store(700, Ordering::SeqCst);
    let request = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, request), "late-body").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["model"], "free/a:free");
    assert_eq!(value["chargedNanousd"], "0");
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    assert_eq!(row(&f, request).await, ("settled".to_owned(), 0));
    assert_eq!(balance(&f).await, 1_000_000_000);
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert!(has(&lines[0], "outcome", "ok"), "{}", lines[0]);
    assert!(
        has(&lines[0], "models_tried", "free/a:free(200)"),
        "{}",
        lines[0]
    );
}

/// A model that answered 200 and is still generating when the call runs out of
/// time ends the request clear (503), never unclear: the hold is released at
/// once and the next request of the session runs. The log says the body was
/// cut, not that nothing came.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_free_model_whose_body_never_finishes_ends_clear_and_the_next_request_runs() {
    let (logs, _guard) = capture_logs();
    let f = fixture_chain(free_reply()).await;
    f.late_ms.store(5000, Ordering::SeqCst);
    let first = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, first), "never-finishes").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{value}");
    assert_eq!(row(&f, first).await, ("settled".to_owned(), 0));
    f.late_ms.store(0, Ordering::SeqCst);
    let next = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, next), "after-never-finishes").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(row(&f, next).await, ("settled".to_owned(), 0));
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert!(
        has(&lines[0], "outcome", "upstream_rejected"),
        "{}",
        lines[0]
    );
    assert!(
        has(&lines[0], "models_tried", "free/a:free(200/timeout)"),
        "{}",
        lines[0]
    );
    assert!(has(&lines[1], "outcome", "ok"), "{}", lines[1]);
}

/// The same GATE-312 R2 turn when every free model hangs: the request ends in
/// today's clear 503, and, because nothing free can have been charged, its row
/// is settled at zero at once. Left pending it kept the session "busy" for the
/// next fifteen minutes (admission refuses a second request of a session while
/// one is pending): the thread said "Usage is being recovered" and the next
/// mention "Your Colony Agents are busy".
async fn hung_free_chain_then_the_next_request(f: Fixture) {
    let (logs, _guard) = capture_logs();
    f.hang_ms.store(2500, Ordering::SeqCst);
    f.hang_calls.store(3, Ordering::SeqCst);
    let first = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, first), "all-hang").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{value}");
    assert_eq!(f.calls.load(Ordering::SeqCst), 3);
    assert_eq!(row(&f, first).await, ("settled".to_owned(), 0));
    // The next mention of the same agent runs: not refused as busy.
    let next = Uuid::new_v4();
    let (status, value) = call(&f, &body(&f, next), "after-hang").await;
    assert_eq!(status, StatusCode::OK, "{value}");
    assert_eq!(value["model"], "free/a:free");
    assert_eq!(row(&f, next).await, ("settled".to_owned(), 0));
    let lines = finished_lines(&logs);
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert!(
        has(&lines[0], "outcome", "upstream_rejected"),
        "{}",
        lines[0]
    );
    assert!(
        has(
            &lines[0],
            "models_tried",
            "free/a:free(timeout),free/b:free(timeout),free/c:free(timeout)"
        ),
        "{}",
        lines[0]
    );
    assert!(has(&lines[1], "outcome", "ok"), "{}", lines[1]);
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn every_free_model_hanging_releases_the_hold_and_the_next_request_runs() {
    let f = fixture_chain(free_reply()).await;
    hung_free_chain_then_the_next_request(f).await;
}

#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn every_free_model_hanging_releases_a_free_ai_account_too() {
    // The judge's account: journal only, no balance, no ledger rows.
    let mut f = fixture_chain(free_reply()).await;
    sqlx::query("DELETE FROM account_credit_ledger WHERE account_id = $1")
        .bind(f.account)
        .execute(&f.pool)
        .await
        .unwrap();
    f.gateway.policy = Arc::new(GatewayPolicy {
        free_ai_accounts: vec![account_email(&f).await],
        ..GatewayPolicy::default()
    });
    let pool = f.pool.clone();
    let account = f.account;
    hung_free_chain_then_the_next_request(f).await;
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM account_credit_ledger WHERE account_id = $1")
            .bind(account)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rows, 0);
}

/// Paid usage keeps its recovery: a paid model that gives no answer may have
/// charged, so the hold stays for the durable worker and, until it settles, the
/// session is busy. This is the behaviour a free model must not have.
#[tokio::test]
#[ignore = "requires Postgres and Redis"]
async fn a_paid_model_that_hangs_keeps_its_hold_and_the_session_stays_busy() {
    let f = fixture(upstream_response()).await;
    // The fixture's upstream gives up after 1 s.
    f.delay_ms.store(1500, Ordering::SeqCst);
    let first = Uuid::new_v4();
    let (status, _) = call(&f, &body(&f, first), "paid-hang").await;
    assert_eq!(status, StatusCode::CONFLICT);
    let state: String = sqlx::query_scalar("SELECT status FROM account_ai_requests WHERE id=$1")
        .bind(first)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(state, "pending");
    f.delay_ms.store(0, Ordering::SeqCst);
    let (status, value) = call(&f, &body(&f, Uuid::new_v4()), "paid-next").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "{value}");
}
