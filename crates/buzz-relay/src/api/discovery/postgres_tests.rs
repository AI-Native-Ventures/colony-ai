//! Monthly company cap tests: the production `run_search` path against a real
//! database and a local stub of the Outscraper API. No real provider is called.

use super::*;
use axum::{routing::get, Router};
use buzz_core::CommunityId;
use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;

const TEST_KEY: &str = "test-key-not-a-secret";

struct Fixture {
    db: buzz_db::Db,
    pool: sqlx::PgPool,
}

async fn fixture() -> Fixture {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect(&crate::test_support::database_url())
        .await
        .expect("test database");
    Fixture {
        db: buzz_db::Db::from_pool(pool.clone()),
        pool,
    }
}

impl Fixture {
    async fn community(&self) -> CommunityId {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(id)
            .bind(format!("{id}.example"))
            .execute(&self.pool)
            .await
            .expect("community");
        CommunityId::from_uuid(id)
    }

    async fn used(&self, community: CommunityId, now: DateTime<Utc>) -> i32 {
        self.db
            .discovery_results_this_month(*community.as_uuid(), month_start(now))
            .await
            .expect("usage")
    }
}

fn october() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 29, 12, 0, 0)
        .single()
        .unwrap()
}

fn november() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 2, 8, 0, 0).single().unwrap()
}

fn places(count: usize) -> Value {
    let rows: Vec<Value> = (0..count)
        .map(|index| serde_json::json!({ "name": format!("Place {index}") }))
        .collect();
    serde_json::json!({ "id": "req-1", "status": "Success", "data": [rows] })
}

/// Stub provider that always answers with `count` places and counts its calls.
async fn stub(
    count: usize,
) -> (
    DiscoveryConfig,
    Arc<AtomicUsize>,
    tokio::task::JoinHandle<()>,
) {
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    let router = Router::new().route(
        "/maps/search-v3",
        get(move || {
            let seen = seen.clone();
            async move {
                seen.fetch_add(1, Ordering::SeqCst);
                Json(places(count))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind stub");
    let base = format!("http://{}", listener.local_addr().expect("address"));
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("serve stub");
    });
    let config = DiscoveryConfig::new(TEST_KEY.to_string(), base.clone(), base)
        .with_poll_interval(Duration::from_millis(5));
    (config, calls, server)
}

fn search_for(limit: u32) -> ValidatedSearch {
    ValidatedSearch {
        query: "guesthouses, Melville".to_string(),
        region: Some("za".to_string()),
        limit,
        skip: 0,
        language: "en".to_string(),
    }
}

async fn run(
    fixture: &Fixture,
    config: &DiscoveryConfig,
    community: CommunityId,
    limit: u32,
    now: DateTime<Utc>,
) -> Result<Value, (StatusCode, Json<Value>)> {
    run_search(
        &fixture.db,
        &build_discovery_http_client(),
        config,
        community,
        search_for(limit),
        now,
    )
    .await
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn search_counts_results_per_company_month() {
    let fixture = fixture().await;
    let community = fixture.community().await;
    let (config, _, server) = stub(3).await;

    run(&fixture, &config, community, 10, october())
        .await
        .expect("first");
    run(&fixture, &config, community, 10, october())
        .await
        .expect("second");
    assert_eq!(fixture.used(community, october()).await, 6);

    // A new month starts from zero.
    run(&fixture, &config, community, 10, november())
        .await
        .expect("november");
    assert_eq!(fixture.used(community, november()).await, 3);
    assert_eq!(fixture.used(community, october()).await, 6);
    server.abort();
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn search_over_monthly_cap_returns_429_with_reset() {
    let fixture = fixture().await;
    let community = fixture.community().await;
    let (config, calls, server) = stub(3).await;
    let config = config.with_company_monthly_results(6);

    run(&fixture, &config, community, 10, october())
        .await
        .expect("first");
    run(&fixture, &config, community, 10, october())
        .await
        .expect("second");
    let calls_before = calls.load(Ordering::SeqCst);

    let (status, body) = run(&fixture, &config, community, 10, october())
        .await
        .expect_err("cap reached");
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        body.0,
        serde_json::json!({ "error": "monthly_limit", "resets_at": "2026-11-01T00:00:00Z" })
    );
    // Refused before the provider is asked, and nothing more is counted.
    assert_eq!(calls.load(Ordering::SeqCst), calls_before);
    assert_eq!(fixture.used(community, october()).await, 6);

    // The next month is open again.
    run(&fixture, &config, community, 10, november())
        .await
        .expect("next month");
    server.abort();
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn cap_is_per_company_not_per_member() {
    let fixture = fixture().await;
    let company_a = fixture.community().await;
    let company_b = fixture.community().await;
    let (config, _, server) = stub(4).await;
    let config = config.with_company_monthly_results(8);

    // Two different members of company A search; the handler hands both to
    // run_search with the same tenant community, so they share one counter.
    run(&fixture, &config, company_a, 10, october())
        .await
        .expect("member one");
    run(&fixture, &config, company_a, 10, october())
        .await
        .expect("member two");
    let (status, _) = run(&fixture, &config, company_a, 10, october())
        .await
        .expect_err("company A used its month");
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);

    // Company B is untouched by company A's usage.
    run(&fixture, &config, company_b, 10, october())
        .await
        .expect("company B");
    assert_eq!(fixture.used(company_b, october()).await, 4);
    server.abort();
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn page_is_trimmed_to_what_the_month_has_left() {
    let fixture = fixture().await;
    let community = fixture.community().await;
    let (config, _, server) = stub(10).await;
    let config = config.with_company_monthly_results(7);

    let body = run(&fixture, &config, community, 10, october())
        .await
        .expect("page");
    assert_eq!(body["places"].as_array().expect("places").len(), 7);
    assert_eq!(fixture.used(community, october()).await, 7);
    server.abort();
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn failed_provider_call_is_not_counted() {
    let fixture = fixture().await;
    let community = fixture.community().await;
    let router = Router::new().route(
        "/maps/search-v3",
        get(|| async {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({})),
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let base = format!("http://{}", listener.local_addr().expect("address"));
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.expect("serve stub");
    });
    let config = DiscoveryConfig::new(TEST_KEY.to_string(), base.clone(), base);

    let (status, _) = run(&fixture, &config, community, 10, october())
        .await
        .expect_err("provider failed");
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(fixture.used(community, october()).await, 0);
    server.abort();
}
