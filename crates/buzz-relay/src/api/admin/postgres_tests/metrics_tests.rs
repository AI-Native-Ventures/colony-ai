//! The operator-only admin boards: refusals, shapes and the read audit.

use super::*;

fn board_uris() -> Vec<String> {
    vec![
        "/metrics/overview".to_string(),
        "/metrics/businesses".to_string(),
        format!("/metrics/businesses/{}", Uuid::new_v4()),
        "/metrics/ai-usage".to_string(),
        "/metrics/health".to_string(),
    ]
}

async fn get_json(
    state: &Arc<crate::state::AppState>,
    request: Request<Body>,
) -> (StatusCode, serde_json::Value) {
    let response = status_for(state.clone(), request).await;
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .expect("body");
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

fn signed_by(keys: &nostr::Keys, uri: &str) -> Request<Body> {
    status_request(
        Request::builder()
            .uri(uri)
            .header(header::HOST, "admin.example")
            .header(header::AUTHORIZATION, make_nostr_auth(keys, uri)),
    )
}

#[tokio::test]
async fn disabled_auth_mode_refuses_every_board() {
    let state = disabled_mode_state().await;
    for uri in board_uris() {
        let request = status_request(
            Request::builder()
                .uri(&uri)
                .header(header::HOST, "admin.example"),
        );
        let (status, _) = get_json(&state, request).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{uri}: the boards have no anonymous read"
        );
    }
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn a_signed_key_that_is_not_on_the_roster_is_refused() {
    let state = test_state().await;
    let stranger = nostr::Keys::generate();
    for uri in board_uris() {
        let (status, _) = get_json(&state, signed_by(&stranger, &uri)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{uri}");
    }
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn a_moderator_is_refused_every_board() {
    let state = test_state().await;
    let moderator = nostr::Keys::generate();
    let moderator_bytes = moderator.public_key().to_bytes();
    state
        .db
        .upsert_relay_operator(
            &moderator_bytes,
            "moderator",
            &test_operator_keys().public_key().to_bytes(),
            true,
        )
        .await
        .expect("roster the moderator");
    let mut statuses = Vec::new();
    for uri in board_uris() {
        let (status, _) = get_json(&state, signed_by(&moderator, &uri)).await;
        statuses.push((uri, status));
    }
    state
        .db
        .remove_relay_operator(
            &moderator_bytes,
            &test_operator_keys().public_key().to_bytes(),
            true,
        )
        .await
        .expect("clean up the moderator");
    for (uri, status) in statuses {
        assert_eq!(status, StatusCode::FORBIDDEN, "{uri}");
    }
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn an_operator_reads_every_board_and_each_read_is_audited() {
    let state = test_state().await;
    let pool = sqlx::PgPool::connect(&database_url()).await.expect("pool");
    let actor = test_operator_keys().public_key().to_bytes().to_vec();
    let count = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*)::bigint FROM relay_operator_read_audit WHERE actor_pubkey = $1",
        )
        .bind(&actor)
        .fetch_one(&pool)
        .await
        .expect("audit count")
    };
    let before = count().await;

    let boards = [
        ("/metrics/overview", "kpis"),
        ("/metrics/businesses?days=7&sort=name&limit=5", "items"),
        ("/metrics/ai-usage?days=90", "kpis"),
        ("/metrics/health", "relay"),
    ];
    for (uri, key) in boards {
        let (status, body) = get_json(&state, status_request(authorized(uri))).await;
        assert_eq!(status, StatusCode::OK, "{uri}: {body}");
        assert!(body.get(key).is_some(), "{uri} has {key}");
        assert!(body.get("generatedAt").is_some(), "{uri} has generatedAt");
    }
    let (_, health) = get_json(&state, status_request(authorized("/metrics/health"))).await;
    assert_eq!(health["relay"]["status"], "up");
    assert!(health["connections"]["now"].is_number());
    assert!(health["checks"]
        .as_array()
        .expect("checks")
        .iter()
        .any(|check| check["key"] == "deploy"));

    let after = count().await;
    assert!(
        after - before >= 5,
        "every read leaves one audit row ({before} -> {after})"
    );
}

#[tokio::test]
#[ignore = "requires Postgres"]
async fn board_queries_are_validated() {
    let state = test_state().await;
    let missing = Uuid::new_v4();
    let cases = [
        (
            "/metrics/overview?days=5".to_string(),
            StatusCode::BAD_REQUEST,
            "invalid_days",
        ),
        (
            "/metrics/ai-usage?days=0".to_string(),
            StatusCode::BAD_REQUEST,
            "invalid_days",
        ),
        (
            "/metrics/businesses?sort=bogus".to_string(),
            StatusCode::BAD_REQUEST,
            "invalid_sort",
        ),
        (
            "/metrics/businesses?limit=0".to_string(),
            StatusCode::BAD_REQUEST,
            "invalid_limit",
        ),
        (
            "/metrics/businesses?limit=201".to_string(),
            StatusCode::BAD_REQUEST,
            "invalid_limit",
        ),
        (
            "/metrics/businesses?offset=-1".to_string(),
            StatusCode::BAD_REQUEST,
            "invalid_offset",
        ),
        (
            format!("/metrics/businesses/{missing}"),
            StatusCode::NOT_FOUND,
            "not_found",
        ),
    ];
    for (uri, expected, code) in cases {
        let (status, body) = get_json(&state, status_request(authorized(&uri))).await;
        assert_eq!(status, expected, "{uri}");
        assert_eq!(body["error"]["code"], code, "{uri}");
    }
    let (status, _) = get_json(
        &state,
        status_request(authorized("/metrics/overview?bogus=1")),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "unknown parameters are refused"
    );
}
