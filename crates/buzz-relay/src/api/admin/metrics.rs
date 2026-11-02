//! Operator-only admin boards: `/metrics/*` under the deployment admin API.
//!
//! Counts and health only (see `docs/admin-api-contract.md`). Every route needs
//! an authenticated NIP-98 principal holding the operator role: moderators,
//! unrostered keys and the `disabled` auth mode are all refused. Every
//! successful read leaves one row in `relay_operator_read_audit`.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, Uri},
    routing::get,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use super::auth::{authorize, require_mutation_principal, require_operator};
use super::error::ApiError;

/// Discovery results one business may fetch per month when no cap is configured.
const DEFAULT_DISCOVERY_CAP: i64 = 2000;

pub(super) fn routes() -> Router<Arc<crate::state::AppState>> {
    Router::new()
        .route("/metrics/overview", get(overview))
        .route("/metrics/businesses", get(businesses))
        .route("/metrics/businesses/{community_id}", get(business))
        .route("/metrics/ai-usage", get(ai_usage))
        .route("/metrics/health", get(health))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RangeQuery {
    days: Option<i64>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BusinessesQuery {
    days: Option<i64>,
    q: Option<String>,
    sort: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

fn parse_days(days: Option<i64>) -> Result<i64, ApiError> {
    match days.unwrap_or(30) {
        days @ (7 | 30 | 90) => Ok(days),
        _ => Err(ApiError::bad_request(
            "invalid_days",
            "days must be 7, 30 or 90",
        )),
    }
}

fn discovery_cap(state: &crate::state::AppState) -> i64 {
    state
        .config
        .discovery
        .as_ref()
        .map_or(DEFAULT_DISCOVERY_CAP, |config| {
            i64::from(config.company_monthly_results())
        })
}

/// Authenticate an operator and record the read. `route` is the route template,
/// never the query string or a business id.
async fn operator_read(
    state: &crate::state::AppState,
    uri: &Uri,
    headers: &HeaderMap,
    route: &str,
) -> Result<(), ApiError> {
    let principal = authorize(
        state,
        headers,
        uri.path_and_query()
            .map_or_else(|| uri.path(), |path| path.as_str()),
        "GET",
        None,
    )
    .await?;
    let principal = require_mutation_principal(principal)?;
    require_operator(&principal)?;
    state
        .db
        .record_operator_read(&principal.pubkey, route)
        .await?;
    Ok(())
}

async fn overview(
    State(state): State<Arc<crate::state::AppState>>,
    uri: Uri,
    headers: HeaderMap,
    Query(query): Query<RangeQuery>,
) -> Result<Json<Value>, ApiError> {
    operator_read(&state, &uri, &headers, "metrics/overview").await?;
    let days = parse_days(query.days)?;
    Ok(Json(
        state
            .db
            .admin_metrics_overview(days, discovery_cap(&state), Utc::now())
            .await?,
    ))
}

async fn businesses(
    State(state): State<Arc<crate::state::AppState>>,
    uri: Uri,
    headers: HeaderMap,
    Query(query): Query<BusinessesQuery>,
) -> Result<Json<Value>, ApiError> {
    operator_read(&state, &uri, &headers, "metrics/businesses").await?;
    let days = parse_days(query.days)?;
    let sort = query.sort.as_deref().unwrap_or("active");
    if !buzz_db::admin_metrics_read::BUSINESS_SORTS.contains(&sort) {
        return Err(ApiError::bad_request(
            "invalid_sort",
            "sort is not supported",
        ));
    }
    let limit = query.limit.unwrap_or(100);
    if !(1..=buzz_db::admin_metrics_read::MAX_BUSINESS_PAGE).contains(&limit) {
        return Err(ApiError::bad_request(
            "invalid_limit",
            "limit must be between 1 and 200",
        ));
    }
    let offset = query.offset.unwrap_or(0);
    if offset < 0 {
        return Err(ApiError::bad_request(
            "invalid_offset",
            "offset must not be negative",
        ));
    }
    let search = query.q.unwrap_or_default();
    if search.chars().count() > 100 {
        return Err(ApiError::bad_request(
            "invalid_query",
            "q must be at most 100 characters",
        ));
    }
    Ok(Json(
        state
            .db
            .admin_metrics_businesses(
                days,
                &search,
                sort,
                (limit, offset),
                discovery_cap(&state),
                Utc::now(),
            )
            .await?,
    ))
}

async fn business(
    State(state): State<Arc<crate::state::AppState>>,
    uri: Uri,
    headers: HeaderMap,
    Path(community_id): Path<Uuid>,
    Query(query): Query<RangeQuery>,
) -> Result<Json<Value>, ApiError> {
    operator_read(&state, &uri, &headers, "metrics/businesses/{communityId}").await?;
    let days = parse_days(query.days)?;
    let relay_pubkey = state.relay_keypair.public_key().to_bytes();
    match state
        .db
        .admin_metrics_business(
            community_id,
            days,
            discovery_cap(&state),
            &relay_pubkey,
            Utc::now(),
        )
        .await?
    {
        Some(body) => Ok(Json(body)),
        None => Err(ApiError::not_found()),
    }
}

async fn ai_usage(
    State(state): State<Arc<crate::state::AppState>>,
    uri: Uri,
    headers: HeaderMap,
    Query(query): Query<RangeQuery>,
) -> Result<Json<Value>, ApiError> {
    operator_read(&state, &uri, &headers, "metrics/ai-usage").await?;
    let days = parse_days(query.days)?;
    Ok(Json(
        state.db.admin_metrics_ai_usage(days, Utc::now()).await?,
    ))
}

async fn health(
    State(state): State<Arc<crate::state::AppState>>,
    uri: Uri,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    operator_read(&state, &uri, &headers, "metrics/health").await?;
    let mut body = state.db.admin_metrics_health(Utc::now()).await?;
    let version: String = crate::build_info::source_sha().chars().take(8).collect();
    let started = crate::metrics_collect::started_at();
    if let Some(object) = body.as_object_mut() {
        object.insert(
            "relay".to_owned(),
            json!({
                "status": "up",
                "version": version,
                "startedAt": started,
                "uptimePct7d": Value::Null,
            }),
        );
        object.insert(
            "connections".to_owned(),
            json!({ "now": state.conn_manager.connection_count(), "scope": "this_relay_instance" }),
        );
        if let Some(checks) = object.get_mut("checks").and_then(Value::as_array_mut) {
            checks.push(json!({
                "key": "deploy",
                "label": "Last deploy",
                "status": "ok",
                "value": format!("relay {version}"),
            }));
        }
    }
    Ok(Json(body))
}
