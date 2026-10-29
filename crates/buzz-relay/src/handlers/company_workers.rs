//! Broker for budgeted employee worker runs (kind 47062, head kind 30672).
//!
//! A worker run is a company record, never a team member: this handler writes
//! only the action event and the relay-signed head. It creates no member,
//! position, user row or managed agent.

use std::sync::Arc;

use chrono::Utc;
use nostr::{Event, EventBuilder, Kind, Tag};

use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::company_workers::{
    validate_worker_action, validate_worker_d_tag, validate_worker_head, worker_d_tag, WorkerRun,
    WorkerRunAction, WorkerRunHead, WorkerStatus,
};
use buzz_core::kind::{KIND_WORKER_RUN_ACTION, KIND_WORKER_RUN_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Seconds a new run's start time may differ from the relay clock.
const START_SKEW_SECS: i64 = 300;

/// Handles an employee's or admin's worker run write (kind 47062).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_WORKER_RUN_ACTION {
        return Err(invalid("worker action has the wrong event kind"));
    }
    let action = serde_json::from_str::<WorkerRunAction>(&event.content)
        .map_err(|error| invalid(format!("worker action: {error}")))?;
    validate_worker_action(&action).map_err(|error| invalid(format!("worker action: {error}")))?;
    if event.verify().is_err() {
        return Err(invalid("worker action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write worker runs",
        ));
    }
    let d_tag = command_d_tag(&event, &action.run)?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let actor_is_parent = actor_pubkey == action.run.parent_pubkey;
    let actor_managed = is_managed_agent(state, community_id, &auth.pubkey().to_bytes()).await?;

    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community_id)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;
    let actor_role = member_role(&mut tx, community_id, &actor_pubkey, true).await?;
    let actor_is_admin = actor_role.as_deref().is_some_and(is_admin);
    if actor_role.is_none() && !actor_managed {
        return Err(forbidden("actor is not a member or managed employee"));
    }
    if !actor_is_parent && !actor_is_admin {
        return Err(forbidden(
            "only the employee that started this worker, or an owner or admin, can write it",
        ));
    }
    if !actor_is_parent {
        let parent_bytes = nostr::PublicKey::from_hex(&action.run.parent_pubkey)
            .map_err(|_| invalid("parentPubkey must be a public key"))?
            .to_bytes();
        let parent_role =
            member_role(&mut tx, community_id, &action.run.parent_pubkey, false).await?;
        if parent_role.is_none() && !is_managed_agent(state, community_id, &parent_bytes).await? {
            return Err(forbidden(
                "the worker's employee is not a member or managed employee",
            ));
        }
    }

    let command_id = event.id.to_bytes();
    let already_stored = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community_id.as_uuid())
    .bind(command_id.as_slice())
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    if already_stored {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-worker:{}:{}",
            community_id.as_uuid(),
            action.run.worker_id
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_WORKER_RUN_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_worker_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(internal(
            "worker head changed while its transaction lock was held",
        ));
    }
    let current = current_stored.as_ref().map(parse_worker_head).transpose()?;
    check_expected_head(&action, current_head_id.as_deref())?;

    let now = Utc::now().timestamp();
    match current.as_ref() {
        None => {
            if action.run.status != WorkerStatus::Running {
                return Err(invalid("a worker's first record must be running"));
            }
            if (action.run.started_at - now).abs() > START_SKEW_SECS {
                return Err(invalid("a worker's start time must be close to now"));
            }
        }
        Some(head) => {
            check_transition(&head.run, &action.run)?;
        }
    }

    let next = WorkerRunHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        run: action.run.clone(),
        updated_by_pubkey: actor_pubkey.clone(),
        updated_at: now,
        source_action_event_id: event.id.to_hex(),
    };
    validate_worker_head(&next).map_err(|error| invalid(format!("worker head: {error}")))?;
    let head_event = relay_worker_head_event(&next, &d_tag, current_stored.as_ref(), state)?;
    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community_id, &event, None)
            .await
            .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let precondition = current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community_id,
            &head_event,
            &d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict(
            "worker run changed before the action could commit; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_WORKER_RUN_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_WORKER_RUN_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

/// A run that has ended never changes, and a write may only end the run it
/// names: identity, label, model and deadline are fixed at start.
fn check_transition(current: &WorkerRun, next: &WorkerRun) -> Result<(), IngestError> {
    if current.status != WorkerStatus::Running {
        return Err(conflict("worker run already ended"));
    }
    if next.status == WorkerStatus::Running {
        return Err(invalid("a worker run can only be ended once it is running"));
    }
    if current.worker_id != next.worker_id
        || current.parent_pubkey != next.parent_pubkey
        || current.label != next.label
        || current.model != next.model
        || current.started_at != next.started_at
        || current.deadline_at != next.deadline_at
    {
        return Err(invalid(
            "a worker's identity, label, model and deadline cannot change",
        ));
    }
    Ok(())
}

async fn is_managed_agent(
    state: &AppState,
    community_id: CommunityId,
    pubkey: &[u8; 32],
) -> Result<bool, IngestError> {
    Ok(state
        .db
        .get_agent_channel_policy(community_id, pubkey)
        .await
        .map_err(internal)?
        .is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some()))
}

async fn member_role(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: CommunityId,
    pubkey: &str,
    lock: bool,
) -> Result<Option<String>, IngestError> {
    let sql = if lock {
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE"
    } else {
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2"
    };
    sqlx::query_scalar::<_, String>(sql)
        .bind(community_id.as_uuid())
        .bind(pubkey)
        .fetch_optional(&mut **tx)
        .await
        .map_err(internal)
}

async fn current_worker_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_WORKER_RUN_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.to_owned());
    query.global_only = true;
    query.limit = Some(2);
    let mut rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() > 1 {
        return Err(internal("stored worker d-tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        let head = parse_worker_head(stored)?;
        validate_worker_d_tag(d_tag, &head.run.worker_id)
            .map_err(|error| internal(format!("stored worker d-tag: {error}")))?;
        let d_tags = stored
            .event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .collect::<Vec<_>>();
        let p_tags = stored
            .event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "p")
            .collect::<Vec<_>>();
        if stored.event.kind != Kind::Custom(KIND_WORKER_RUN_HEAD as u16)
            || stored.event.pubkey != state.relay_keypair.public_key()
            || stored.event.verify().is_err()
            || stored.channel_id.is_some()
            || d_tags.len() != 1
            || d_tags[0].content() != Some(d_tag)
            || p_tags.len() != 1
            || p_tags[0].content() != Some(head.run.parent_pubkey.as_str())
            || stored.event.tags.len() != 2
        {
            return Err(internal("stored worker head has invalid d or p tags"));
        }
    }
    Ok(stored)
}

fn parse_worker_head(stored: &StoredEvent) -> Result<WorkerRunHead, IngestError> {
    let head = serde_json::from_str::<WorkerRunHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored worker head is invalid: {error}")))?;
    validate_worker_head(&head)
        .map_err(|error| internal(format!("stored worker head: {error}")))?;
    Ok(head)
}

fn relay_worker_head_event(
    head: &WorkerRunHead,
    d_tag: &str,
    previous: Option<&StoredEvent>,
    state: &AppState,
) -> Result<Event, IngestError> {
    let content = serde_json::to_string(head).map_err(internal)?;
    let now = nostr::Timestamp::now().as_secs();
    let created_at = previous.map_or(now, |stored| {
        now.max(stored.event.created_at.as_secs().saturating_add(1))
    });
    let d_tag = Tag::parse(["d", d_tag]).map_err(internal)?;
    let parent_tag = Tag::parse(["p", head.run.parent_pubkey.as_str()]).map_err(internal)?;
    EventBuilder::new(Kind::Custom(KIND_WORKER_RUN_HEAD as u16), content)
        .tags([d_tag, parent_tag])
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

/// One `d` tag, one `p` tag naming the employee, at most one `auth` tag.
fn command_d_tag(event: &Event, run: &WorkerRun) -> Result<String, IngestError> {
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    let p_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "p")
        .collect::<Vec<_>>();
    let auth_tag_count = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "auth")
        .count();
    if d_tags.len() != 1
        || p_tags.len() != 1
        || auth_tag_count > 1
        || event.tags.iter().any(|tag| {
            let kind = tag.kind().to_string();
            kind != "d" && kind != "p" && kind != "auth"
        })
    {
        return Err(invalid(
            "worker commands require one d tag, one p tag, and no h tag",
        ));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| invalid("worker command d tag must have a value"))?;
    if p_tags[0].content() != Some(run.parent_pubkey.as_str()) {
        return Err(invalid("worker command p tag must name the worker's employee"));
    }
    if worker_d_tag(&run.worker_id)
        .map_err(|error| invalid(format!("worker d-tag: {error}")))?
        != d_tag
    {
        return Err(invalid("worker command d tag does not match its worker id"));
    }
    Ok(d_tag.to_owned())
}

fn check_expected_head(
    action: &WorkerRunAction,
    current_head_id: Option<&[u8]>,
) -> Result<(), IngestError> {
    let expected = action.expected_head_event_id.as_deref();
    let actual = current_head_id.map(hex::encode);
    if expected == actual.as_deref() {
        Ok(())
    } else {
        Err(conflict(format!(
            "worker run changed; current head is {}",
            actual.unwrap_or_else(|| "missing".to_owned())
        )))
    }
}

fn is_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

fn duplicate_result(event: &Event) -> IngestResult {
    IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: "duplicate: already processed".into(),
    }
}

fn invalid(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("invalid: {}", message.into()))
}

fn forbidden(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("restricted: {}", message.into()))
}

fn conflict(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("conflict: {}", message.into()))
}

fn internal(error: impl std::fmt::Display) -> IngestError {
    IngestError::Internal(format!("error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(status: WorkerStatus) -> WorkerRun {
        WorkerRun {
            worker_id: "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10".into(),
            parent_pubkey: "ab".repeat(32),
            label: "Research".into(),
            model: "colony-credits".into(),
            status,
            started_at: 1_000,
            deadline_at: 1_600,
            finished_at: None,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: None,
            output_text: None,
            failure_reason: None,
        }
    }

    #[test]
    fn an_ended_worker_cannot_be_rewritten() {
        let ended = run(WorkerStatus::Done);
        let error = check_transition(&ended, &run(WorkerStatus::Cancelled)).unwrap_err();
        assert!(matches!(error, IngestError::Rejected(m) if m.starts_with("conflict:")));
    }

    #[test]
    fn a_running_worker_can_only_be_ended_with_the_same_identity() {
        let current = run(WorkerStatus::Running);
        assert!(check_transition(&current, &run(WorkerStatus::Failed)).is_ok());
        assert!(check_transition(&current, &run(WorkerStatus::Running)).is_err());
        let mut relabeled = run(WorkerStatus::Failed);
        relabeled.label = "Something else".into();
        assert!(check_transition(&current, &relabeled).is_err());
        let mut extended = run(WorkerStatus::Failed);
        extended.deadline_at += 300;
        assert!(check_transition(&current, &extended).is_err());
    }
}
