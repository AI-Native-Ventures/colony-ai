//! Agent-first CLI for reading and undoing employee configuration revisions.

use std::collections::HashMap;

use buzz_core::company_employee_history::{
    employee_history_d_tag, validate_employee_revision_action, validate_employee_revision_head,
    EmployeeRevisionAction, EmployeeRevisionActionKind, EmployeeRevisionHead,
};
use buzz_core::kind::{KIND_EMPLOYEE_REVISION_ACTION, KIND_EMPLOYEE_REVISION_HEAD};
use serde_json::{json, Value};

use crate::client::BuzzClient;
use crate::commands::parse_write_response;
use crate::error::CliError;

const EMPLOYEE_REVISION_QUERY_BOUND: u32 = 1_000;

/// Read a validated append-only employee configuration history.
pub async fn history(client: &BuzzClient, employee: &str) -> Result<(), CliError> {
    let data = load_history(client, employee).await?;
    let revisions = data
        .revisions
        .iter()
        .map(|revision| {
            let created_at = chrono::DateTime::<chrono::Utc>::from_timestamp(
                revision.event.created_at.as_secs() as i64,
                0,
            )
            .ok_or_else(|| {
                CliError::Other("revision time is outside the supported range".into())
            })?;
            Ok(json!({
                "eventId": revision.event.id.to_hex(),
                "actorPubkey": revision.event.pubkey.to_hex(),
                "createdAt": created_at.to_rfc3339(),
                "action": revision.action.action,
                "before": revision.action.before,
                "after": revision.action.after,
                "undoOfEventId": revision.action.undo_of_event_id,
            }))
        })
        .collect::<Result<Vec<_>, CliError>>()?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "employeePubkey": data.employee_pubkey,
            "head": data.head_event,
            "revisions": revisions,
        }))
        .map_err(|error| CliError::Other(format!("failed to serialize history: {error}")))?
    );
    Ok(())
}

/// Append an immutable revision restoring the selected action's before snapshot.
pub async fn undo(
    client: &BuzzClient,
    employee: &str,
    revision_event_id: &str,
) -> Result<(), CliError> {
    let employee_pubkey = normalize_employee_pubkey(employee)?;
    let revision_id = nostr::EventId::parse(revision_event_id)
        .map_err(|error| CliError::Usage(format!("invalid revision event id: {error}")))?
        .to_hex();
    let data = load_history(client, &employee_pubkey).await?;
    let head_event = data
        .head_event
        .as_ref()
        .ok_or_else(|| CliError::Usage("employee has no configuration history to undo".into()))?;
    let head = data
        .head
        .as_ref()
        .ok_or_else(|| CliError::Other("validated history head is missing".into()))?;
    let target = data
        .revisions
        .iter()
        .find(|revision| revision.event.id.to_hex() == revision_id)
        .ok_or_else(|| {
            CliError::Usage("revision event is not in this employee's history".into())
        })?;
    let action = EmployeeRevisionAction {
        schema_version: 1,
        employee_pubkey: employee_pubkey.clone(),
        action: EmployeeRevisionActionKind::Undo,
        expected_head_event_id: Some(head_event.id.to_hex()),
        previous_revision_event_id: Some(head.revision_event_id.clone()),
        before: head.snapshot.clone(),
        after: target.action.before.clone(),
        undo_of_event_id: Some(revision_id.clone()),
    };
    validate_employee_revision_action(&action)
        .map_err(|error| CliError::Usage(format!("invalid undo request: {error}")))?;
    if action.before == action.after {
        return Err(CliError::Usage(
            "the selected revision already matches the current configuration".into(),
        ));
    }
    let builder = buzz_sdk::company_employee_history::build_employee_revision_action(&action)
        .map_err(crate::validate::sdk_err)?;
    let event = client.sign_event(builder)?;
    let event_id = event.id.to_hex();
    let response = client.submit_event(event).await?;
    let normalized = parse_write_response(&response, "employee history changed before undo")?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "event_id": event_id,
            "accepted": true,
            "action": "undo",
            "employee_pubkey": employee_pubkey,
            "undo_of_event_id": revision_id,
            "relay_response": normalized,
        }))
        .map_err(|error| CliError::Other(format!("failed to serialize undo response: {error}")))?
    );
    Ok(())
}

struct ValidatedRevision {
    event: nostr::Event,
    action: EmployeeRevisionAction,
}

struct HistoryData {
    employee_pubkey: String,
    head_event: Option<nostr::Event>,
    head: Option<EmployeeRevisionHead>,
    revisions: Vec<ValidatedRevision>,
}

async fn load_history(client: &BuzzClient, employee: &str) -> Result<HistoryData, CliError> {
    let employee_pubkey = normalize_employee_pubkey(employee)?;
    let d_tag = employee_history_d_tag(&employee_pubkey)
        .map_err(|error| CliError::Usage(format!("invalid employee pubkey: {error}")))?;
    let relay_self = relay_self(client).await?;
    let raw_actions = client
        .query_all_bounded(
            json!({
                "kinds": [KIND_EMPLOYEE_REVISION_ACTION],
                "#d": [d_tag],
                "#p": [employee_pubkey],
                "limit": EMPLOYEE_REVISION_QUERY_BOUND,
            }),
            EMPLOYEE_REVISION_QUERY_BOUND,
        )
        .await?;
    let mut by_id = HashMap::<String, ValidatedRevision>::new();
    for raw in raw_actions {
        let revision = parse_revision_event(raw, &employee_pubkey, &d_tag)?;
        let id = revision.event.id.to_hex();
        if by_id.insert(id, revision).is_some() {
            return Err(CliError::Other(
                "relay returned a duplicate employee revision event".into(),
            ));
        }
    }

    let raw_heads = client
        .query_all_bounded(
            json!({
                "kinds": [KIND_EMPLOYEE_REVISION_HEAD],
                "authors": [relay_self],
                "#d": [d_tag],
                "limit": 2,
            }),
            2,
        )
        .await?;
    if raw_heads.len() > 1 {
        return Err(CliError::Other(
            "relay returned duplicate employee history heads".into(),
        ));
    }
    let (head_event, head) = raw_heads
        .into_iter()
        .next()
        .map(|raw| parse_head_event(raw, &employee_pubkey, &relay_self, &d_tag))
        .transpose()?
        .map_or((None, None), |(event, head)| (Some(event), Some(head)));

    let revisions = if let Some(head) = head.as_ref() {
        let mut reverse = Vec::with_capacity(by_id.len());
        let mut current_id = Some(head.revision_event_id.clone());
        let mut visited = HashMap::<String, ()>::new();
        while let Some(id) = current_id {
            if visited.insert(id.clone(), ()).is_some() {
                return Err(CliError::Other(
                    "employee revision history has a cycle".into(),
                ));
            }
            let revision = by_id.remove(&id).ok_or_else(|| {
                CliError::Other("employee history head references a missing revision".into())
            })?;
            current_id = revision.action.previous_revision_event_id.clone();
            reverse.push(revision);
            if reverse.len() > EMPLOYEE_REVISION_QUERY_BOUND as usize {
                return Err(CliError::Other(
                    "employee history exceeds its read bound".into(),
                ));
            }
        }
        if !by_id.is_empty() {
            return Err(CliError::Other(
                "relay returned revisions outside the current history chain".into(),
            ));
        }
        reverse.reverse();
        reverse
    } else {
        if !by_id.is_empty() {
            return Err(CliError::Other(
                "relay returned employee revisions without a current head".into(),
            ));
        }
        Vec::new()
    };

    if let (Some(event), Some(head), Some(latest)) =
        (head_event.as_ref(), head.as_ref(), revisions.last())
    {
        if head.source_action_event_id != latest.event.id.to_hex()
            || head.revision_event_id != latest.event.id.to_hex()
            || head.previous_revision_event_id != latest.action.previous_revision_event_id
            || head.snapshot != latest.action.after
            || head.actor_pubkey != latest.event.pubkey.to_hex()
            || event.id.to_hex() == head.revision_event_id
        {
            return Err(CliError::Other(
                "employee history head does not match its latest revision".into(),
            ));
        }
    }
    for revision in &revisions {
        if revision.action.action == EmployeeRevisionActionKind::Undo {
            let undo_of = revision
                .action
                .undo_of_event_id
                .as_deref()
                .ok_or_else(|| CliError::Other("undo revision has no target".into()))?;
            let restored = revisions
                .iter()
                .find(|candidate| candidate.event.id.to_hex() == undo_of)
                .ok_or_else(|| CliError::Other("undo target is not in employee history".into()))?;
            if restored.action.before != revision.action.after {
                return Err(CliError::Other(
                    "undo revision does not restore the selected snapshot".into(),
                ));
            }
        }
    }

    Ok(HistoryData {
        employee_pubkey,
        head_event,
        head,
        revisions,
    })
}

fn parse_revision_event(
    raw: Value,
    employee_pubkey: &str,
    d_tag: &str,
) -> Result<ValidatedRevision, CliError> {
    let event: nostr::Event = serde_json::from_value(raw).map_err(|error| {
        CliError::Other(format!("employee revision event is malformed: {error}"))
    })?;
    if event.kind != nostr::Kind::Custom(KIND_EMPLOYEE_REVISION_ACTION as u16) {
        return Err(CliError::Other(
            "employee revision event has the wrong kind".into(),
        ));
    }
    event.verify().map_err(|error| {
        CliError::Other(format!("employee revision signature is invalid: {error}"))
    })?;
    let d_tags = tag_values(&event, "d");
    let p_tags = tag_values(&event, "p");
    if event.tags.len() != 2
        || d_tags.len() != 1
        || d_tags.first().map(String::as_str) != Some(d_tag)
        || p_tags.len() != 1
        || p_tags.first().map(String::as_str) != Some(employee_pubkey)
    {
        return Err(CliError::Other(
            "employee revision tags do not match the requested employee".into(),
        ));
    }
    let action: EmployeeRevisionAction = serde_json::from_str(&event.content).map_err(|error| {
        CliError::Other(format!("employee revision content is invalid: {error}"))
    })?;
    validate_employee_revision_action(&action)
        .map_err(|error| CliError::Other(format!("employee revision is invalid: {error}")))?;
    if action.employee_pubkey != employee_pubkey {
        return Err(CliError::Other(
            "employee revision content does not match its employee tag".into(),
        ));
    }
    Ok(ValidatedRevision { event, action })
}

fn parse_head_event(
    raw: Value,
    employee_pubkey: &str,
    relay_self: &str,
    d_tag: &str,
) -> Result<(nostr::Event, EmployeeRevisionHead), CliError> {
    let event: nostr::Event = serde_json::from_value(raw)
        .map_err(|error| CliError::Other(format!("employee history head is malformed: {error}")))?;
    if event.kind != nostr::Kind::Custom(KIND_EMPLOYEE_REVISION_HEAD as u16) {
        return Err(CliError::Other(
            "employee history head has the wrong kind".into(),
        ));
    }
    if event.pubkey.to_hex() != relay_self {
        return Err(CliError::Other(
            "employee history head author does not match relay self".into(),
        ));
    }
    event.verify().map_err(|error| {
        CliError::Other(format!(
            "employee history head signature is invalid: {error}"
        ))
    })?;
    let d_tags = tag_values(&event, "d");
    if event.tags.len() != 1
        || d_tags.len() != 1
        || d_tags.first().map(String::as_str) != Some(d_tag)
    {
        return Err(CliError::Other(
            "employee history head must have its exact d-tag".into(),
        ));
    }
    let head: EmployeeRevisionHead = serde_json::from_str(&event.content).map_err(|error| {
        CliError::Other(format!("employee history head content is invalid: {error}"))
    })?;
    validate_employee_revision_head(&head)
        .map_err(|error| CliError::Other(format!("employee history head is invalid: {error}")))?;
    if head.employee_pubkey != employee_pubkey
        || head.revision_event_id != head.source_action_event_id
    {
        return Err(CliError::Other(
            "employee history head does not match its coordinate".into(),
        ));
    }
    Ok((event, head))
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let raw = client.get_public("/").await.map_err(|error| {
        CliError::Other(format!("failed to fetch relay info document: {error}"))
    })?;
    let nip11: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("relay info is not valid JSON: {error}")))?;
    let self_pubkey = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document missing 'self' field".into()))?;
    nostr::PublicKey::from_hex(self_pubkey)
        .map(|pubkey| pubkey.to_hex())
        .map_err(|_| CliError::Other("relay 'self' field is not a valid public key".into()))
}

fn normalize_employee_pubkey(value: &str) -> Result<String, CliError> {
    nostr::PublicKey::from_hex(value)
        .map(|pubkey| pubkey.to_hex())
        .map_err(|error| CliError::Usage(format!("invalid employee pubkey: {error}")))
}

fn tag_values(event: &nostr::Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == name)
        .filter_map(|tag| tag.content().map(str::to_owned))
        .collect()
}
