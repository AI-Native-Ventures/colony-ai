//! Authorized structured reads for workflow execution state.
//!
//! Runs and approvals are relay-owned database rows, not Nostr events. These
//! endpoints expose those read models without inventing synthetic events.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, RawQuery, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use buzz_core::TenantContext;

use crate::{
    api::{api_error, bridge, internal_error},
    state::AppState,
};

const DEFAULT_RUN_LIMIT: i64 = 20;
const MAX_RUN_LIMIT: i64 = 100;

/// Pagination query for workflow run history.
#[derive(Debug, Deserialize, Default)]
pub struct RunsQuery {
    before: Option<DateTime<Utc>>,
    before_id: Option<Uuid>,
    limit: Option<i64>,
}

fn request_path(path: &str, raw_query: Option<&str>) -> String {
    match raw_query {
        Some(query) if !query.is_empty() => format!("{path}?{query}"),
        _ => path.to_string(),
    }
}

fn next_scheduled_at(
    definition: &Value,
    enabled: bool,
    now: DateTime<Utc>,
) -> Result<Option<DateTime<Utc>>, String> {
    if !enabled {
        return Ok(None);
    }
    let Some(trigger) = definition.get("trigger") else {
        return Err("workflow definition is missing its trigger".into());
    };
    if trigger.get("on").and_then(Value::as_str) != Some("schedule") {
        return Ok(None);
    }
    let Some(cron) = trigger.get("cron").and_then(Value::as_str) else {
        return Ok(None);
    };
    let timezone = trigger
        .get("timezone")
        .and_then(Value::as_str)
        .unwrap_or("UTC");
    buzz_workflow::next_cron_occurrence(cron, timezone, now)
}

async fn authorize_workflow_read(
    state: &Arc<AppState>,
    headers: &HeaderMap,
    path: &str,
    raw_query: Option<&str>,
    workflow_id: Uuid,
) -> Result<(TenantContext, buzz_db::workflow::WorkflowRecord), (StatusCode, Json<Value>)> {
    let raw_host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let tenant = crate::tenant::bind_community(&state.db, raw_host)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::NOT_FOUND,
                "relay: no community is configured for this host",
            )
        })?;

    let path_with_query = request_path(path, raw_query);
    let url = bridge::nip98_expected_url(&state.config.relay_url, &tenant, &path_with_query);
    let bridge::VerifiedBridgeAuth {
        pubkey,
        event_id_bytes,
        signed_created_at,
    } = bridge::verify_bridge_auth(headers, "GET", &url, None, state.config.require_auth_token)?;
    bridge::enforce_http_admission(state, &tenant, &pubkey).await?;
    bridge::check_nip98_replay(state, &tenant, event_id_bytes).await?;

    let pubkey_bytes = pubkey.to_bytes().to_vec();
    let auth_tag = super::relay_members::extract_auth_tag_header(headers);
    super::relay_members::enforce_relay_membership(
        state,
        tenant.community(),
        &pubkey_bytes,
        auth_tag,
        signed_created_at,
    )
    .await?;

    let workflow = state
        .db
        .get_workflow(tenant.community(), workflow_id)
        .await
        .map_err(|error| match error {
            buzz_db::error::DbError::NotFound(_) => {
                api_error(StatusCode::NOT_FOUND, "workflow not found")
            }
            other => internal_error(&format!("get workflow for run read: {other}")),
        })?;
    let channel_id = workflow
        .channel_id
        .ok_or_else(|| api_error(StatusCode::FORBIDDEN, "workflow is not channel-scoped"))?;
    let accessible = state
        .get_accessible_channel_ids_cached(tenant.community(), &pubkey_bytes)
        .await
        .map_err(|error| internal_error(&format!("workflow channel access lookup: {error}")))?;
    if !accessible.contains(&channel_id) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "workflow is not accessible",
        ));
    }

    Ok((tenant, workflow))
}

/// `GET /workflows/{workflow_id}/runs` — one authorized, keyset-paginated page.
pub async fn workflow_runs(
    State(state): State<Arc<AppState>>,
    Path(workflow_id): Path<Uuid>,
    headers: HeaderMap,
    RawQuery(raw_query): RawQuery,
    Query(query): Query<RunsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if query.before.is_some() != query.before_id.is_some() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "before and before_id must be supplied together",
        ));
    }
    let limit = query.limit.unwrap_or(DEFAULT_RUN_LIMIT);
    if !(1..=MAX_RUN_LIMIT).contains(&limit) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "limit must be between 1 and 100",
        ));
    }

    let path = format!("/workflows/{workflow_id}/runs");
    let (tenant, workflow) =
        authorize_workflow_read(&state, &headers, &path, raw_query.as_deref(), workflow_id).await?;
    let next_scheduled_at = next_scheduled_at(&workflow.definition, workflow.enabled, Utc::now())
        .map_err(|error| {
        internal_error(&format!("calculate next workflow schedule: {error}"))
    })?;
    let mut rows = state
        .db
        .list_workflow_runs_page(
            tenant.community(),
            workflow_id,
            query.before,
            query.before_id,
            limit + 1,
        )
        .await
        .map_err(|error| internal_error(&format!("list workflow runs: {error}")))?;

    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    let next = if has_more {
        rows.last().map(|last| {
            serde_json::json!({
                "before": last.created_at,
                "before_id": last.id,
            })
        })
    } else {
        None
    };

    Ok(Json(serde_json::json!({
        "runs": rows.iter().map(run_json).collect::<Vec<_>>(),
        "next": next,
        "next_scheduled_at": next_scheduled_at.map(|instant| instant.to_rfc3339()),
        "workflow_definition_hash": hex::encode(&workflow.definition_hash),
        "workflow_channel_id": workflow.channel_id,
        "workflow_enabled": workflow.enabled,
    })))
}

/// `GET /workflows/{workflow_id}/runs/{run_id}/approvals` — approvals for a run.
pub async fn run_approvals(
    State(state): State<Arc<AppState>>,
    Path((workflow_id, run_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = format!("/workflows/{workflow_id}/runs/{run_id}/approvals");
    let (tenant, _workflow) =
        authorize_workflow_read(&state, &headers, &path, None, workflow_id).await?;

    let run = state
        .db
        .get_workflow_run(tenant.community(), run_id)
        .await
        .map_err(|error| match error {
            buzz_db::error::DbError::NotFound(_) => {
                api_error(StatusCode::NOT_FOUND, "workflow run not found")
            }
            other => internal_error(&format!("get workflow run for approval read: {other}")),
        })?;
    if run.workflow_id != workflow_id {
        return Err(api_error(StatusCode::NOT_FOUND, "workflow run not found"));
    }

    let approvals = state
        .db
        .get_run_approvals(tenant.community(), workflow_id, run_id)
        .await
        .map_err(|error| internal_error(&format!("list run approvals: {error}")))?;
    Ok(Json(serde_json::json!({
        "approvals": approvals.iter().map(approval_json).collect::<Vec<_>>(),
    })))
}

fn run_json(run: &buzz_db::workflow::WorkflowRunRecord) -> Value {
    serde_json::json!({
        "id": run.id,
        "workflow_id": run.workflow_id,
        "definition_version": run.definition_version.as_ref().map(hex::encode),
        "status": run.status,
        "current_step": run.current_step,
        "execution_trace": run.execution_trace,
        "started_at": run.started_at.map(|value| value.timestamp()),
        "completed_at": run.completed_at.map(|value| value.timestamp()),
        "error_code": run.error_code,
        "error_message": run.error_message,
        "schedule_context": schedule_context(run),
        "created_at": run.created_at.timestamp(),
    })
}

fn schedule_context(run: &buzz_db::workflow::WorkflowRunRecord) -> Option<Value> {
    let fields = run
        .trigger_context
        .as_ref()?
        .get("webhook_fields")?
        .as_object()?;
    let scheduled_for = fields.get("scheduled_for")?.as_str()?;
    let first_missed_occurrence = fields
        .get("first_missed_occurrence")
        .and_then(Value::as_str);
    let latest_missed_occurrence = fields
        .get("latest_missed_occurrence")
        .and_then(Value::as_str);
    let missed_occurrences = fields
        .get("missed_occurrences")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let skipped_occurrences = fields
        .get("skipped_occurrences")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    Some(serde_json::json!({
        "scheduled_for": scheduled_for,
        "first_missed_occurrence": first_missed_occurrence,
        "latest_missed_occurrence": latest_missed_occurrence,
        "missed_occurrences": missed_occurrences,
        "skipped_occurrences": skipped_occurrences,
    }))
}

fn approval_json(approval: &buzz_db::workflow::ApprovalRecord) -> Value {
    serde_json::json!({
        "approval_ref": hex::encode(&approval.token),
        "workflow_id": approval.workflow_id,
        "run_id": approval.run_id,
        "step_id": approval.step_id,
        "step_index": approval.step_index,
        "approver_spec": approval.approver_spec,
        "status": approval.status,
        "approver_pubkey": approval.approver_pubkey.as_ref().map(hex::encode),
        "note": approval.note,
        "expires_at": approval.expires_at,
        "created_at": approval.created_at.timestamp(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_path_preserves_signed_query_verbatim() {
        assert_eq!(
            request_path("/workflows/id/runs", Some("limit=20&before_id=abc")),
            "/workflows/id/runs?limit=20&before_id=abc"
        );
        assert_eq!(
            request_path("/workflows/id/runs", None),
            "/workflows/id/runs"
        );
    }

    #[test]
    fn approval_wire_does_not_expose_hash_as_token() {
        let approval = buzz_db::workflow::ApprovalRecord {
            token: vec![0xab; 32],
            workflow_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            step_id: "review".to_string(),
            step_index: 1,
            approver_spec: "any".to_string(),
            status: buzz_db::workflow::ApprovalStatus::Pending,
            approver_pubkey: None,
            note: None,
            expires_at: Utc::now(),
            created_at: Utc::now(),
        };
        let wire = approval_json(&approval);
        assert!(wire.get("token").is_none());
        assert_eq!(wire["approval_ref"], hex::encode([0xab; 32]));
    }

    #[test]
    fn run_wire_exposes_the_definition_version_without_the_snapshot() {
        let version = vec![0xcd; 32];
        let run = buzz_db::workflow::WorkflowRunRecord {
            id: Uuid::new_v4(),
            community_id: buzz_core::CommunityId::from_uuid(Uuid::new_v4()),
            workflow_id: Uuid::new_v4(),
            workflow_channel_id: Some(Uuid::new_v4()),
            definition_version: Some(version.clone()),
            definition_snapshot: Some(serde_json::json!({ "name": "private definition" })),
            status: buzz_db::workflow::RunStatus::Completed,
            trigger_event_id: None,
            current_step: 0,
            execution_trace: serde_json::json!([]),
            trigger_context: None,
            started_at: None,
            completed_at: None,
            error_message: None,
            error_code: None,
            created_at: Utc::now(),
        };

        let wire = run_json(&run);
        assert_eq!(wire["definition_version"], hex::encode(version));
        assert!(wire.get("definition_snapshot").is_none());
        assert!(wire["schedule_context"].is_null());
    }

    #[test]
    fn run_wire_exposes_bounded_schedule_catch_up_fields_without_trigger_content() {
        let run = buzz_db::workflow::WorkflowRunRecord {
            id: Uuid::new_v4(),
            community_id: buzz_core::CommunityId::from_uuid(Uuid::new_v4()),
            workflow_id: Uuid::new_v4(),
            workflow_channel_id: Some(Uuid::new_v4()),
            definition_version: Some(vec![0xcd; 32]),
            definition_snapshot: None,
            status: buzz_db::workflow::RunStatus::Completed,
            trigger_event_id: None,
            current_step: 0,
            execution_trace: serde_json::json!([]),
            trigger_context: Some(serde_json::json!({
                "text": "private trigger text",
                "webhook_fields": {
                    "scheduled_for": "2026-09-14T08:00:00+00:00",
                    "first_missed_occurrence": "2026-09-07T08:00:00+00:00",
                    "latest_missed_occurrence": "2026-09-14T08:00:00+00:00",
                    "missed_occurrences": "2",
                    "skipped_occurrences": "1",
                    "unrelated": "private field"
                }
            })),
            started_at: None,
            completed_at: None,
            error_message: None,
            error_code: None,
            created_at: Utc::now(),
        };

        let wire = run_json(&run);
        assert_eq!(
            wire["schedule_context"],
            serde_json::json!({
                "scheduled_for": "2026-09-14T08:00:00+00:00",
                "first_missed_occurrence": "2026-09-07T08:00:00+00:00",
                "latest_missed_occurrence": "2026-09-14T08:00:00+00:00",
                "missed_occurrences": 2,
                "skipped_occurrences": 1
            })
        );
        assert!(!wire.to_string().contains("private trigger text"));
        assert!(!wire.to_string().contains("private field"));
    }
}
