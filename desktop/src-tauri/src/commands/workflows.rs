use std::collections::HashSet;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::{
    app_state::AppState,
    events,
    relay::{get_relay_json, parse_command_response, query_relay, submit_event},
};

// ── Wire shapes (snake_case, consumed by tauriWorkflows.ts) ──────────────────

/// A workflow definition as the desktop frontend expects it. Mirrors the
/// `RawWorkflow` type in `desktop/src/shared/api/tauriWorkflows.ts`.
///
/// The relay stores a workflow as a single kind:30620 event whose content is
/// the raw YAML. Everything the UI needs is derived from that event:
/// - `id` / `channel_id` from the `d` / `h` tags,
/// - `definition` from parsing the YAML body into a free-form object,
/// - `name` from `definition.name`,
/// - `owner_pubkey` / timestamps from the event itself.
///
/// The initial status comes from `definition.enabled`. Channel-scoped status
/// events override it on reads so pause and resume do not rewrite the active
/// definition.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorkflowWire {
    pub id: String,
    /// Event id of the current kind:30620 revision, used for conflict-protected updates.
    pub revision: String,
    pub name: String,
    pub owner_pubkey: String,
    pub channel_id: Option<String>,
    pub definition: Value,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Response shape for create/update. Mirrors `RawWorkflowSaveResponse` in the
/// frontend: a full workflow record plus an optional webhook secret (only
/// present for webhook-triggered workflows on creation).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorkflowSaveWire {
    #[serde(flatten)]
    pub workflow: WorkflowWire,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret: Option<String>,
}

/// An unpublished workflow draft stored as kind:30623.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorkflowDraftWire {
    pub id: String,
    pub revision: String,
    pub name: String,
    pub owner_pubkey: String,
    pub channel_id: String,
    pub definition: Value,
    pub updated_at: i64,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize, PartialEq)]
pub struct WorkflowRunCursorWire {
    pub before: String,
    pub before_id: String,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize, PartialEq)]
pub struct WorkflowRunsWire {
    pub runs: Vec<Value>,
    pub next: Option<WorkflowRunCursorWire>,
}

#[derive(Debug, Clone, serde::Deserialize, Serialize, PartialEq)]
pub struct WorkflowApprovalsWire {
    pub approvals: Vec<Value>,
}

/// Canonical trigger acknowledgement consumed by the Desktop client.
///
/// The relay currently returns only `run_id`; the workflow id is the command
/// input and a newly-created run always begins pending. Keeping that adaptation
/// here prevents the frontend from guessing fields or confusing the trigger
/// event id with the persisted run id.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WorkflowTriggerWire {
    pub run_id: String,
    pub workflow_id: String,
    pub status: String,
}

#[derive(Debug, serde::Deserialize)]
struct WorkflowTriggerAck {
    run_id: String,
}

// ── Reads ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_channel_workflows(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowWire>, String> {
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [30620],
            "#h": [channel_id],
        })],
    )
    .await?;

    let mut workflows = events.iter().map(workflow_from_event).collect::<Vec<_>>();
    apply_workflow_statuses(&state, &mut workflows).await?;
    Ok(workflows)
}

// Keep this aligned with the relay's aggregate explicit-`#h` request bound.
// Each filter below carries exactly one explicit value so old relays retain the
// known-compatible shape while current relays cannot reject large memberships.
const WORKFLOW_QUERY_CHANNEL_BATCH_SIZE: usize = 128;
const WORKFLOW_STATUS_QUERY_BATCH_SIZE: usize = 128;

async fn query_workflow_event(
    state: &AppState,
    kind: u32,
    workflow_id: &str,
    author: Option<&str>,
) -> Result<Option<nostr::Event>, String> {
    let mut filter = serde_json::json!({
        "kinds": [kind],
        "#d": [workflow_id],
        "limit": 1,
    });
    if let Some(author) = author {
        filter["authors"] = serde_json::json!([author]);
    }
    Ok(query_relay(state, &[filter]).await?.into_iter().next())
}

fn workflow_status_from_event(event: &nostr::Event) -> Option<&'static str> {
    let content: Value = serde_json::from_str(&event.content).ok()?;
    match content.get("status")?.as_str()? {
        "active" => Some("active"),
        "paused" => Some("disabled"),
        _ => None,
    }
}

async fn apply_workflow_statuses(
    state: &AppState,
    workflows: &mut [WorkflowWire],
) -> Result<(), String> {
    let filters = workflows
        .iter()
        .filter_map(|workflow| {
            let channel_id = workflow.channel_id.as_deref()?;
            Some(serde_json::json!({
                "kinds": [46021],
                "#workflow": [workflow.id],
                "#h": [channel_id],
                "limit": 1,
            }))
        })
        .collect::<Vec<_>>();
    let mut latest_status = std::collections::HashMap::<String, (u64, &'static str)>::new();
    for batch in filters.chunks(WORKFLOW_STATUS_QUERY_BATCH_SIZE) {
        for event in query_relay(state, batch).await? {
            let Some(workflow_id) = tag_value(&event, "workflow") else {
                continue;
            };
            let Some(status) = workflow_status_from_event(&event) else {
                continue;
            };
            let created_at = event.created_at.as_secs();
            let should_replace = latest_status
                .get(&workflow_id)
                .is_none_or(|(previous_at, _)| created_at >= *previous_at);
            if should_replace {
                latest_status.insert(workflow_id, (created_at, status));
            }
        }
    }
    for workflow in workflows {
        if let Some((_, status)) = latest_status.get(&workflow.id) {
            workflow.status = (*status).to_string();
        }
    }
    Ok(())
}

fn workflow_draft_from_event(event: &nostr::Event) -> Result<WorkflowDraftWire, String> {
    let id = tag_value(event, "d").ok_or_else(|| "workflow draft missing id".to_string())?;
    let channel_id =
        tag_value(event, "h").ok_or_else(|| "workflow draft missing channel".to_string())?;
    let record = workflow_record(
        id.clone(),
        event.id.to_hex(),
        Some(channel_id.clone()),
        event.pubkey.to_hex(),
        &event.content,
        event.created_at.as_secs() as i64,
        event.created_at.as_secs() as i64,
    );
    Ok(WorkflowDraftWire {
        id: record.id,
        revision: record.revision,
        name: record.name,
        owner_pubkey: record.owner_pubkey,
        channel_id,
        definition: record.definition,
        updated_at: record.updated_at,
    })
}

/// Fetch workflows across many channels using bounded relay round-trips.
///
/// The Workflows overview screen previously issued one `get_channel_workflows`
/// query per member channel (`Promise.all` fanout in `WorkflowsView`), i.e. N
/// relay POSTs. This sends one single-channel filter per channel, in requests of
/// at most 128 filters. Using one multi-value `#h` filter is equivalent under
/// NIP-01, but older relays incorrectly narrowed that shape to its first
/// channel. Each `WorkflowWire` carries its own `channel_id` (from the event's
/// `h` tag), so the frontend can still group results by channel. Neither this
/// nor the per-channel command sets a `limit`, so batching does not change
/// result completeness. Results are deduplicated by signed event ID in case a
/// caller supplies duplicate channel IDs.
#[tauri::command]
pub async fn get_channels_workflows(
    channel_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowWire>, String> {
    let filter_batches = channel_workflow_filter_batches(channel_ids)?;
    let mut seen_event_ids = HashSet::new();
    let mut workflows = Vec::new();

    for filters in filter_batches {
        let events = query_relay(&state, &filters).await?;
        append_unique_workflows(&mut workflows, &mut seen_event_ids, &events);
    }

    apply_workflow_statuses(&state, &mut workflows).await?;
    Ok(workflows)
}

fn append_unique_workflows(
    workflows: &mut Vec<WorkflowWire>,
    seen_event_ids: &mut HashSet<nostr::EventId>,
    events: &[nostr::Event],
) {
    workflows.extend(
        events
            .iter()
            .filter(|event| seen_event_ids.insert(event.id))
            .map(workflow_from_event),
    );
}

fn channel_workflow_filter_batches(channel_ids: Vec<String>) -> Result<Vec<Vec<Value>>, String> {
    let filters = channel_workflow_filters(channel_ids)?;
    Ok(filters
        .chunks(WORKFLOW_QUERY_CHANNEL_BATCH_SIZE)
        .map(<[Value]>::to_vec)
        .collect())
}

fn channel_workflow_filters(channel_ids: Vec<String>) -> Result<Vec<Value>, String> {
    channel_ids
        .into_iter()
        .map(|channel_id| {
            let channel_id = uuid::Uuid::parse_str(channel_id.trim())
                .map_err(|_| "invalid channel id".to_string())?;
            Ok(serde_json::json!({
                "kinds": [30620],
                "#h": [channel_id.to_string()],
            }))
        })
        .collect()
}

#[tauri::command]
pub async fn get_workflow(
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<WorkflowWire, String> {
    let events = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [30620],
            "#d": [workflow_id],
            "limit": 1
        })],
    )
    .await?;

    let mut workflow = events
        .first()
        .map(workflow_from_event)
        .ok_or_else(|| "workflow not found".to_string())?;
    apply_workflow_statuses(&state, std::slice::from_mut(&mut workflow)).await?;
    Ok(workflow)
}

#[tauri::command]
pub async fn get_workflow_draft(
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<Option<WorkflowDraftWire>, String> {
    let workflow_id =
        uuid::Uuid::parse_str(&workflow_id).map_err(|_| "invalid workflow id".to_string())?;
    let author = current_pubkey_hex(&state)?;
    let event =
        query_workflow_event(&state, 30623, &workflow_id.to_string(), Some(&author)).await?;
    event
        .map(|event| workflow_draft_from_event(&event))
        .transpose()
}

#[tauri::command]
pub async fn get_workflow_runs(
    workflow_id: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<WorkflowRunsWire, String> {
    let workflow_id =
        uuid::Uuid::parse_str(&workflow_id).map_err(|_| "invalid workflow id".to_string())?;
    let limit = limit.unwrap_or(20).clamp(1, 100);
    get_relay_json(
        &state,
        &format!("/workflows/{workflow_id}/runs?limit={limit}"),
    )
    .await
}

// ── Writes ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_workflow(
    channel_id: String,
    yaml_definition: String,
    state: State<'_, AppState>,
) -> Result<WorkflowSaveWire, String> {
    let workflow_id = uuid::Uuid::new_v4().to_string();
    let builder =
        events::build_workflow_definition(&workflow_id, &channel_id, &yaml_definition, None)?;
    let result = submit_event(builder, &state).await?;

    // The relay returns `webhook_secret` in the OK response message for
    // webhook-triggered workflows. Everything else in the save record is built
    // locally from the inputs we already hold — the relay's create response
    // only carries `{ workflow_id, webhook_secret? }`.
    let webhook_secret = parse_command_response::<Value>(&result.message)
        .ok()
        .and_then(|v| {
            v.get("webhook_secret")
                .and_then(Value::as_str)
                .map(str::to_string)
        });

    let now = now_secs();
    let workflow = workflow_record(
        workflow_id,
        result.event_id,
        Some(channel_id),
        current_pubkey_hex(&state)?,
        &yaml_definition,
        now,
        now,
    );

    Ok(WorkflowSaveWire {
        workflow,
        webhook_secret,
    })
}

#[tauri::command]
pub async fn save_workflow_draft(
    workflow_id: String,
    channel_id: String,
    yaml_definition: String,
    expected_revision: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkflowDraftWire, String> {
    let workflow_id = uuid::Uuid::parse_str(&workflow_id)
        .map_err(|_| "invalid workflow id".to_string())?
        .to_string();
    let channel_id = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| "invalid channel id".to_string())?
        .to_string();
    validate_workflow_draft_yaml(&yaml_definition)?;

    let author = current_pubkey_hex(&state)?;
    if let Some(active_event) = query_workflow_event(&state, 30620, &workflow_id, None).await? {
        if active_event.pubkey.to_hex() != author {
            return Err("only the workflow owner can edit its draft".to_string());
        }
        if tag_value(&active_event, "h").as_deref() != Some(channel_id.as_str()) {
            return Err("workflow belongs to a different channel".to_string());
        }
    }

    let current_draft = query_workflow_event(&state, 30623, &workflow_id, Some(&author)).await?;
    let expected_revision = match (current_draft.as_ref(), expected_revision.as_deref()) {
        (Some(event), Some(expected)) if event.id.to_hex() == expected => Some(expected),
        (None, None) => None,
        (Some(_), _) | (None, Some(_)) => {
            return Err("workflow draft changed since it was loaded; refresh and try again".into());
        }
    };
    if current_draft
        .as_ref()
        .and_then(|event| tag_value(event, "h"))
        .is_some_and(|prior_channel| prior_channel != channel_id)
    {
        return Err("workflow draft belongs to a different channel".to_string());
    }

    let builder = events::build_workflow_draft(
        &workflow_id,
        &channel_id,
        &yaml_definition,
        expected_revision,
    )?;
    let result = submit_event(builder, &state).await?;
    let now = now_secs();
    let record = workflow_record(
        workflow_id,
        result.event_id,
        Some(channel_id.clone()),
        author,
        &yaml_definition,
        current_draft
            .as_ref()
            .map(|event| event.created_at.as_secs() as i64)
            .unwrap_or(now),
        now,
    );
    Ok(WorkflowDraftWire {
        id: record.id,
        revision: record.revision,
        name: record.name,
        owner_pubkey: record.owner_pubkey,
        channel_id,
        definition: record.definition,
        updated_at: record.updated_at,
    })
}

#[tauri::command]
pub async fn publish_workflow_draft(
    workflow_id: String,
    draft_revision: String,
    expected_active_revision: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkflowSaveWire, String> {
    let workflow_id = uuid::Uuid::parse_str(&workflow_id)
        .map_err(|_| "invalid workflow id".to_string())?
        .to_string();
    let author = current_pubkey_hex(&state)?;
    let draft = query_workflow_event(&state, 30623, &workflow_id, Some(&author))
        .await?
        .ok_or_else(|| "workflow draft not found".to_string())?;
    if draft.id.to_hex() != draft_revision {
        return Err("workflow draft changed since it was loaded; refresh and try again".into());
    }
    let channel_id =
        tag_value(&draft, "h").ok_or_else(|| "workflow draft missing channel".to_string())?;
    buzz_workflow_pkg::WorkflowEngine::parse_yaml(&draft.content)
        .map_err(|error| format!("invalid workflow definition: {error}"))?;

    let active = query_workflow_event(&state, 30620, &workflow_id, None).await?;
    let expected_revision = match (active.as_ref(), expected_active_revision.as_deref()) {
        (Some(event), Some(expected))
            if event.id.to_hex() == expected && event.pubkey.to_hex() == author =>
        {
            Some(expected)
        }
        (None, None) => None,
        (Some(_), _) => {
            return Err(
                "active workflow changed since it was loaded; refresh and try again".into(),
            );
        }
        (None, Some(_)) => {
            return Err("active workflow no longer exists; refresh and try again".into());
        }
    };
    if active
        .as_ref()
        .and_then(|event| tag_value(event, "h"))
        .is_some_and(|active_channel| active_channel != channel_id)
    {
        return Err("workflow draft and active version belong to different channels".into());
    }

    let builder = events::build_workflow_definition(
        &workflow_id,
        &channel_id,
        &draft.content,
        expected_revision,
    )?;
    let result = submit_event(builder, &state).await?;
    let now = now_secs();
    let workflow = workflow_record(
        workflow_id,
        result.event_id,
        Some(channel_id),
        author,
        &draft.content,
        active
            .as_ref()
            .map(|event| event.created_at.as_secs() as i64)
            .unwrap_or(now),
        now,
    );
    Ok(WorkflowSaveWire {
        workflow,
        webhook_secret: None,
    })
}

#[tauri::command]
pub async fn set_workflow_status(
    workflow_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let workflow_id = uuid::Uuid::parse_str(&workflow_id)
        .map_err(|_| "invalid workflow id".to_string())?
        .to_string();
    if !matches!(status.as_str(), "active" | "paused") {
        return Err("workflow status must be active or paused".to_string());
    }
    let active = query_workflow_event(&state, 30620, &workflow_id, None)
        .await?
        .ok_or_else(|| "workflow not found".to_string())?;
    let channel_id =
        tag_value(&active, "h").ok_or_else(|| "workflow missing channel".to_string())?;
    let builder = events::build_workflow_status(&workflow_id, &channel_id, &status)?;
    submit_event(builder, &state).await?;
    Ok(status)
}

#[tauri::command]
pub async fn preview_workflow(
    yaml_definition: String,
) -> Result<buzz_workflow_pkg::executor::WorkflowPreview, String> {
    let (definition, _) = buzz_workflow_pkg::WorkflowEngine::parse_yaml(&yaml_definition)
        .map_err(|error| format!("invalid workflow definition: {error}"))?;
    buzz_workflow_pkg::executor::preview_workflow(
        &definition,
        &buzz_workflow_pkg::executor::TriggerContext::default(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_workflow(
    workflow_id: String,
    yaml_definition: String,
    expected_revision: String,
    state: State<'_, AppState>,
) -> Result<WorkflowSaveWire, String> {
    // Find the channel id (and creation time) from the existing workflow event
    // so the new event carries the same `h` tag — kind:30620 is replaceable by
    // (pubkey, d-tag).
    let prior = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [30620],
            "#d": [workflow_id.clone()],
            "limit": 1
        })],
    )
    .await?;

    let prior_event = prior
        .first()
        .ok_or_else(|| "workflow not found".to_string())?;
    if prior_event.id.to_hex() != expected_revision {
        return Err("workflow changed since it was loaded; refresh and try again".to_string());
    }
    let channel_id = tag_value(prior_event, "h").ok_or_else(|| "workflow not found".to_string())?;
    let created_at = prior_event.created_at.as_secs() as i64;

    let builder = events::build_workflow_definition(
        &workflow_id,
        &channel_id,
        &yaml_definition,
        Some(&expected_revision),
    )?;
    let result = submit_event(builder, &state).await?;

    let updated_at = now_secs();
    let workflow = workflow_record(
        workflow_id,
        result.event_id,
        Some(channel_id),
        current_pubkey_hex(&state)?,
        &yaml_definition,
        created_at,
        updated_at,
    );

    Ok(WorkflowSaveWire {
        workflow,
        // Updates never rotate the webhook secret.
        webhook_secret: None,
    })
}

#[tauri::command]
pub async fn delete_workflow(
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let builder = events::build_workflow_delete(&workflow_id, &current_pubkey_hex(&state)?)?;
    submit_event(builder, &state).await?;
    Ok(())
}

#[tauri::command]
pub async fn trigger_workflow(
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<WorkflowTriggerWire, String> {
    let builder = events::build_workflow_trigger(&workflow_id)?;
    let result = submit_event(builder, &state).await?;
    trigger_wire_from_message(workflow_id, &result.message)
}

// ── Approvals ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_run_approvals(
    workflow_id: String,
    run_id: String,
    state: State<'_, AppState>,
) -> Result<WorkflowApprovalsWire, String> {
    let workflow_id =
        uuid::Uuid::parse_str(&workflow_id).map_err(|_| "invalid workflow id".to_string())?;
    let run_id =
        uuid::Uuid::parse_str(&run_id).map_err(|_| "invalid workflow run id".to_string())?;
    get_relay_json(
        &state,
        &format!("/workflows/{workflow_id}/runs/{run_id}/approvals"),
    )
    .await
}

#[tauri::command]
pub async fn grant_approval(
    token: String,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let builder = events::build_approval_grant(&token, note.as_deref())?;
    let result = submit_event(builder, &state).await?;
    Ok(serde_json::json!({ "event_id": result.event_id }))
}

#[tauri::command]
pub async fn deny_approval(
    token: String,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let builder = events::build_approval_deny(&token, note.as_deref())?;
    let result = submit_event(builder, &state).await?;
    Ok(serde_json::json!({ "event_id": result.event_id }))
}

// ── Helpers (pure, unit-tested in workflows_tests.rs) ─────────────────────────

fn trigger_wire_from_message(
    workflow_id: String,
    message: &str,
) -> Result<WorkflowTriggerWire, String> {
    let ack: WorkflowTriggerAck = parse_command_response(message)?;
    if ack.run_id.trim().is_empty() {
        return Err("workflow trigger response contained an empty run_id".to_string());
    }
    Ok(WorkflowTriggerWire {
        run_id: ack.run_id,
        workflow_id,
        status: "pending".to_string(),
    })
}

fn current_pubkey_hex(state: &AppState) -> Result<String, String> {
    let keys = state.keys.lock().map_err(|e| e.to_string())?;
    Ok(keys.public_key().to_hex())
}

fn validate_workflow_draft_yaml(yaml: &str) -> Result<(), String> {
    let value: serde_yaml::Value = serde_yaml::from_str(yaml)
        .map_err(|error| format!("invalid workflow draft YAML: {error}"))?;
    if !matches!(value, serde_yaml::Value::Mapping(_)) {
        return Err("workflow draft must be a YAML object".to_string());
    }
    Ok(())
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// First value of the tag whose name matches `name` (e.g. `d`, `h`).
fn tag_value(ev: &nostr::Event, name: &str) -> Option<String> {
    ev.tags.iter().find_map(|t| {
        let s = t.as_slice();
        (s.len() >= 2 && s[0] == name).then(|| s[1].clone())
    })
}

/// Parse a workflow's YAML body into a free-form JSON object. The frontend
/// consumes `definition` as `Record<string, unknown>`, so we preserve the full
/// document. On parse failure (or a non-object document) we fall back to an
/// empty object rather than failing the whole list query — a single malformed
/// workflow must not break the page.
fn parse_definition(yaml: &str) -> Value {
    match serde_yaml::from_str::<Value>(yaml) {
        Ok(v @ Value::Object(_)) => v,
        _ => Value::Object(serde_json::Map::new()),
    }
}

/// Build a [`WorkflowWire`] record from its parts. Shared by the read path
/// (from a relay event) and the write path (from local inputs).
fn workflow_record(
    id: String,
    revision: String,
    channel_id: Option<String>,
    owner_pubkey: String,
    yaml_definition: &str,
    created_at: i64,
    updated_at: i64,
) -> WorkflowWire {
    let definition = parse_definition(yaml_definition);
    let name = definition
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| id.clone());

    let status = if definition.get("enabled").and_then(Value::as_bool) == Some(false) {
        "disabled"
    } else {
        "active"
    };
    WorkflowWire {
        id,
        revision,
        name,
        owner_pubkey,
        channel_id,
        definition,
        status: status.to_string(),
        created_at,
        updated_at,
    }
}

/// Convert a kind:30620 workflow definition event into a [`WorkflowWire`].
fn workflow_from_event(ev: &nostr::Event) -> WorkflowWire {
    let id = tag_value(ev, "d").unwrap_or_default();
    let channel_id = tag_value(ev, "h");
    let ts = ev.created_at.as_secs() as i64;
    workflow_record(
        id,
        ev.id.to_hex(),
        channel_id,
        ev.pubkey.to_hex(),
        &ev.content,
        ts,
        ts,
    )
}

#[cfg(test)]
#[path = "workflows_tests.rs"]
mod tests;
