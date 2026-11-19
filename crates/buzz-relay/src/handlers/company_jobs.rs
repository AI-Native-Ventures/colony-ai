//! Broker for signed per-job specialist assignments.
//!
//! A job head says whether one job has a specialist. The function slot remains
//! untouched, so an older desktop can continue to read only its known records.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use buzz_core::company_functions::CompanyFunction;
use buzz_core::company_jobs::{
    job_d_tag, job_hire_d_tag, parse_job_d_tag, validate_job_action, validate_job_head,
    validate_job_hire_head, JobAction, JobActionKind, JobHead, JobHireHead, JobRecordRef, JobState,
    KIND_COMPANY_JOB_ACTION, KIND_COMPANY_JOB_HEAD,
};
use buzz_core::company_members::{MemberPositionAction, MemberPositionActionKind, MemberStatus};
use buzz_core::company_records::{
    parse_company_command, CompanyCommand, HireStatus, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, duplicate_result, forbidden, internal, invalid,
    is_admin, relay_head_event, verify_stored_head,
};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

const MAX_CURRENT_JOB_HEADS: i64 = 10_000;

/// Handles an owner or administrator job action.
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::JobAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_job_action(&action).map_err(|error| invalid(format!("job action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_COMPANY_JOB_ACTION {
        return Err(invalid("job action has the wrong event kind"));
    }
    if event.verify().is_err() {
        return Err(invalid("job action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write job assignments",
        ));
    }

    let d_tag = command_d_tag(&event, "job")?;
    let expected_tag = action
        .d_tag()
        .map_err(|error| invalid(format!("job action coordinate: {error}")))?;
    if d_tag != expected_tag {
        return Err(invalid("job command d tag must match its action"));
    }
    match (action.action, parse_job_d_tag(&d_tag)) {
        (JobActionKind::HireSet, Ok(JobRecordRef::HireIntent(hire_id)))
            if action.hire_id == Some(hire_id) => {}
        (
            JobActionKind::Assign | JobActionKind::Clear,
            Ok(JobRecordRef::Assignment { function, job_id }),
        ) if function == action.function && job_id == action.job_id => {}
        _ => return Err(invalid("job command d tag has the wrong record family")),
    }

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
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
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&actor_pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    if !role.as_deref().is_some_and(is_admin) {
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden(
            "only the owner or an admin can assign company jobs",
        ));
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

    if let Some(assignee) = action.assignee_pubkey.as_deref() {
        ensure_active_company_assignee(state, community_id, assignee).await?;
    }
    if action.action == JobActionKind::HireSet {
        ensure_hire_can_take_job(state, community_id, &action, &actor_pubkey).await?;
    }

    lock_job_coordinate(&mut tx, community_id, &d_tag).await?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_COMPANY_JOB_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_job_stored(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|stored| stored.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(internal(
            "job head changed while its transaction lock was held",
        ));
    }
    if let Err(error) = check_expected_head(
        "job assignment",
        action.expected_head_event_id.as_deref(),
        current_head_id.as_deref(),
    ) {
        tx.rollback().await.map_err(internal)?;
        return Err(error);
    }

    let content = next_job_content(&action, &actor_pubkey)?;
    let head_event = relay_head_event(
        state,
        KIND_COMPANY_JOB_HEAD,
        &d_tag,
        content,
        current_stored.as_ref(),
    )?;
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
            "job assignment changed before the action could commit; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_COMPANY_JOB_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_COMPANY_JOB_HEAD,
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

fn next_job_content(action: &JobAction, actor_pubkey: &str) -> Result<String, IngestError> {
    let now = Utc::now().timestamp();
    match action.action {
        JobActionKind::Assign | JobActionKind::Clear => {
            let head = JobHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                function: action.function,
                job_id: action.job_id.clone(),
                state: if action.action == JobActionKind::Assign {
                    JobState::Filled
                } else {
                    JobState::Empty
                },
                assignee_pubkey: action.assignee_pubkey.clone(),
                updated_by_pubkey: actor_pubkey.to_owned(),
                updated_at: now,
            };
            validate_job_head(&head).map_err(|error| internal(format!("job head: {error}")))?;
            serde_json::to_string(&head).map_err(internal)
        }
        JobActionKind::HireSet => {
            let hire_id = action
                .hire_id
                .ok_or_else(|| invalid("hire_set needs hireId"))?;
            let head = JobHireHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                hire_id,
                function: action.function,
                job_id: action.job_id.clone(),
                set_by_pubkey: actor_pubkey.to_owned(),
                updated_at: now,
            };
            validate_job_hire_head(&head)
                .map_err(|error| internal(format!("job hire head: {error}")))?;
            serde_json::to_string(&head).map_err(internal)
        }
    }
}

async fn ensure_active_company_assignee(
    state: &AppState,
    community_id: CommunityId,
    assignee: &str,
) -> Result<(), IngestError> {
    let is_member = state
        .db
        .get_relay_member(community_id, assignee)
        .await
        .map_err(internal)?
        .is_some();
    let is_employee = !is_member
        && super::company_member_records::is_registered_employee(state, community_id, assignee)
            .await?;
    if !is_member && !is_employee {
        return Err(forbidden(
            "the specialist must be a member or an agent of this company",
        ));
    }
    if !job_assignee_is_active(state, community_id, assignee).await? {
        return Err(conflict("the specialist is not active"));
    }
    Ok(())
}

async fn ensure_hire_can_take_job(
    state: &AppState,
    community_id: CommunityId,
    action: &JobAction,
    actor_pubkey: &str,
) -> Result<(), IngestError> {
    let hire_id = action
        .hire_id
        .ok_or_else(|| invalid("hire_set needs hireId"))?;
    let hire_tag = buzz_core::company_records::hire_d_tag(hire_id);
    let hire_stored = super::company_hires::current_hire_head(state, community_id, &hire_tag)
        .await?
        .ok_or_else(|| conflict("that hire does not exist"))?;
    let hire = super::company_hires::parse_hire_head(&hire_stored)?;
    if hire.proposed_by_pubkey != actor_pubkey {
        let is_admin = state
            .db
            .get_relay_member(community_id, actor_pubkey)
            .await
            .map_err(internal)?
            .is_some_and(|member| super::company_cofounder::is_admin(&member.role));
        if !is_admin {
            return Err(forbidden(
                "only the owner, an admin or the proposer can choose a hire job",
            ));
        }
    }
    if !matches!(
        hire.status,
        HireStatus::Proposed | HireStatus::AwaitingFounder
    ) {
        return Err(conflict(
            "the job can only be chosen while the hire is waiting for a decision",
        ));
    }
    let Some(existing) =
        current_job_head(state, community_id, action.function, &action.job_id).await?
    else {
        return Ok(());
    };
    if existing.state == JobState::Filled {
        if let Some(assignee) = existing.assignee_pubkey.as_deref() {
            if job_assignee_is_active(state, community_id, assignee).await? {
                return Err(conflict(
                    "that job already has a specialist; remove them before hiring another",
                ));
            }
        }
    }
    Ok(())
}

async fn job_assignee_is_active(
    state: &AppState,
    community_id: CommunityId,
    assignee: &str,
) -> Result<bool, IngestError> {
    if matches!(
        super::company_member_records::member_position_status(state, community_id, assignee)
            .await?,
        Some(MemberStatus::Paused | MemberStatus::Terminated)
    ) {
        return Ok(false);
    }
    if state
        .db
        .is_archived(community_id, assignee)
        .await
        .map_err(internal)?
    {
        return Ok(false);
    }
    if state
        .db
        .get_relay_member(community_id, assignee)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Ok(true);
    }
    super::company_member_records::is_registered_employee(state, community_id, assignee).await
}

async fn lock_job_coordinate(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<(), IngestError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-job:{}:{d_tag}", community_id.as_uuid()))
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

async fn current_job_stored(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    parse_job_d_tag(d_tag).map_err(|error| internal(format!("job d tag: {error}")))?;
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_COMPANY_JOB_HEAD as i32]);
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
        return Err(internal("stored job d tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        verify_stored_head(stored, KIND_COMPANY_JOB_HEAD, d_tag, state)?;
    }
    Ok(stored)
}

/// Loads the current assignment for one job.
pub(super) async fn current_job_head(
    state: &AppState,
    community_id: CommunityId,
    function: CompanyFunction,
    job_id: &str,
) -> Result<Option<JobHead>, IngestError> {
    let d_tag = job_d_tag(function, job_id).map_err(|error| invalid(format!("job id: {error}")))?;
    let Some(stored) = current_job_stored(state, community_id, &d_tag).await? else {
        return Ok(None);
    };
    let head = serde_json::from_str::<JobHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored job head is invalid: {error}")))?;
    validate_job_head(&head).map_err(|error| internal(format!("stored job head: {error}")))?;
    if head.function != function || head.job_id != job_id {
        return Err(internal("stored job head does not match its d tag"));
    }
    Ok(Some(head))
}

/// Loads the job intent attached to a pending hire.
pub(super) async fn current_job_hire(
    state: &AppState,
    community_id: CommunityId,
    hire_id: Uuid,
) -> Result<Option<JobHireHead>, IngestError> {
    let d_tag = job_hire_d_tag(hire_id);
    let Some(stored) = current_job_stored(state, community_id, &d_tag).await? else {
        return Ok(None);
    };
    let head = serde_json::from_str::<JobHireHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored job hire head is invalid: {error}")))?;
    validate_job_hire_head(&head)
        .map_err(|error| internal(format!("stored job hire head: {error}")))?;
    if head.hire_id != hire_id {
        return Err(internal("stored job hire head does not match its d tag"));
    }
    Ok(Some(head))
}

/// Resolves a specialist's manager from the live part head when its hire has a
/// job intent. A hire without an intent keeps the manager in its proposal.
pub(super) async fn manager_for_job_hire(
    state: &AppState,
    community_id: CommunityId,
    hire_id: Uuid,
    fallback_manager: &str,
) -> Result<Option<String>, IngestError> {
    let Some(intent) = current_job_hire(state, community_id, hire_id).await? else {
        return Ok(None);
    };
    let Some(stored) =
        super::company_functions::current_function_head(state, community_id, intent.function)
            .await?
    else {
        return Ok(Some(fallback_manager.to_owned()));
    };
    let head =
        serde_json::from_str::<buzz_core::company_functions::FunctionHead>(&stored.event.content)
            .map_err(|error| internal(format!("stored function head is invalid: {error}")))?;
    if head.state == buzz_core::company_functions::SlotState::Filled {
        if let Some(lead) = head.lead_pubkey.as_deref() {
            if job_assignee_is_active(state, community_id, lead).await? {
                return Ok(Some(lead.to_owned()));
            }
        }
    }
    Ok(Some(fallback_manager.to_owned()))
}

/// Applies a recorded job intent inside the hire completion transaction.
pub(super) async fn assign_job_for_hire_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    hire_id: Uuid,
    employee_pubkey: &str,
    actor_pubkey: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let Some(intent) = current_job_hire(state, community_id, hire_id).await? else {
        return Ok(None);
    };
    let d_tag = job_d_tag(intent.function, &intent.job_id)
        .map_err(|error| internal(format!("job hire id: {error}")))?;
    lock_job_coordinate(tx, community_id, &d_tag).await?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        KIND_COMPANY_JOB_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_job_stored(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|stored| stored.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(internal(
            "job head changed while the hire completion lock was held",
        ));
    }
    if let Some(current) = current_stored.as_ref() {
        let current = serde_json::from_str::<JobHead>(&current.event.content)
            .map_err(|error| internal(format!("stored job head is invalid: {error}")))?;
        validate_job_head(&current)
            .map_err(|error| internal(format!("stored job head: {error}")))?;
        if current.state == JobState::Filled {
            if let Some(assignee) = current.assignee_pubkey.as_deref() {
                if assignee != employee_pubkey
                    && job_assignee_is_active(state, community_id, assignee).await?
                {
                    return Ok(None);
                }
            }
        }
    }
    let head = JobHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        function: intent.function,
        job_id: intent.job_id,
        state: JobState::Filled,
        assignee_pubkey: Some(employee_pubkey.to_owned()),
        updated_by_pubkey: actor_pubkey.to_owned(),
        updated_at: Utc::now().timestamp(),
    };
    validate_job_head(&head).map_err(|error| internal(format!("hire job head: {error}")))?;
    let event = relay_head_event(
        state,
        KIND_COMPANY_JOB_HEAD,
        &d_tag,
        serde_json::to_string(&head).map_err(internal)?,
        current_stored.as_ref(),
    )?;
    let precondition = current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            &event,
            &d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err(conflict(
            "job assignment changed before the hire could complete; refresh and retry",
        ));
    }
    Ok(Some(replaced.event))
}

async fn current_job_assignments(
    state: &AppState,
    community_id: CommunityId,
) -> Result<Vec<(StoredEvent, JobHead)>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_COMPANY_JOB_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(MAX_CURRENT_JOB_HEADS + 1);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() as i64 > MAX_CURRENT_JOB_HEADS {
        return Err(internal(
            "company job assignments exceed the supported current-head limit",
        ));
    }
    let mut assignments = Vec::new();
    for stored in rows {
        let d_tags = stored
            .event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .collect::<Vec<_>>();
        let d_tag = d_tags
            .first()
            .and_then(|tag| tag.content())
            .ok_or_else(|| internal("stored job head has no d tag"))?;
        verify_stored_head(&stored, KIND_COMPANY_JOB_HEAD, d_tag, state)?;
        let JobRecordRef::Assignment { function, job_id } = parse_job_d_tag(d_tag)
            .map_err(|error| internal(format!("stored job d tag: {error}")))?
        else {
            continue;
        };
        let head = serde_json::from_str::<JobHead>(&stored.event.content)
            .map_err(|error| internal(format!("stored job head is invalid: {error}")))?;
        validate_job_head(&head).map_err(|error| internal(format!("stored job head: {error}")))?;
        if head.function != function || head.job_id != job_id {
            return Err(internal("stored job head does not match its d tag"));
        }
        assignments.push((stored, head));
    }
    Ok(assignments)
}

async fn empty_job_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    function: CompanyFunction,
    job_id: &str,
    expected_head_id: &[u8],
    actor_pubkey: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let d_tag =
        job_d_tag(function, job_id).map_err(|error| internal(format!("job id: {error}")))?;
    lock_job_coordinate(tx, community_id, &d_tag).await?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        KIND_COMPANY_JOB_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    if current_head_id.as_deref() != Some(expected_head_id) {
        return Ok(None);
    }
    let current_stored = current_job_stored(state, community_id, &d_tag).await?;
    let head = JobHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        function,
        job_id: job_id.to_owned(),
        state: JobState::Empty,
        assignee_pubkey: None,
        updated_by_pubkey: actor_pubkey.to_owned(),
        updated_at: Utc::now().timestamp(),
    };
    let event = relay_head_event(
        state,
        KIND_COMPANY_JOB_HEAD,
        &d_tag,
        serde_json::to_string(&head).map_err(internal)?,
        current_stored.as_ref(),
    )?;
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            &event,
            &d_tag,
            None,
            ParameterizedReplacePrecondition::ExpectedRevision(expected_head_id),
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Ok(None);
    }
    Ok(Some(replaced.event))
}

/// Clears all jobs held by a departing employee inside the member transaction.
pub(super) async fn clear_job_assignments_by_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    assignee: &str,
    actor_pubkey: &str,
) -> Result<Vec<StoredEvent>, IngestError> {
    let assignments = current_job_assignments(state, community_id).await?;
    let mut cleared = Vec::new();
    for (stored, head) in assignments {
        if head.state != JobState::Filled || head.assignee_pubkey.as_deref() != Some(assignee) {
            continue;
        }
        match empty_job_in_tx(
            tx,
            state,
            community_id,
            head.function,
            &head.job_id,
            &stored.event.id.to_bytes(),
            actor_pubkey,
        )
        .await?
        {
            Some(event) => cleared.push(event),
            None => {
                return Err(conflict(
                    "job assignment changed while clearing it; refresh and retry",
                ))
            }
        }
    }
    Ok(cleared)
}

/// Clears stale job assignees after archive, leave, or administration paths.
pub(crate) async fn reconcile_job_assignments(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    actor_pubkey: &str,
) -> Result<(), IngestError> {
    let community_id = tenant.community();
    for (stored, head) in current_job_assignments(state, community_id).await? {
        let Some(assignee) = head.assignee_pubkey.as_deref() else {
            continue;
        };
        if head.state != JobState::Filled
            || job_assignee_is_active(state, community_id, assignee).await?
        {
            continue;
        }
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
        match empty_job_in_tx(
            &mut tx,
            state,
            community_id,
            head.function,
            &head.job_id,
            &stored.event.id.to_bytes(),
            actor_pubkey,
        )
        .await?
        {
            Some(event) => {
                tx.commit().await.map_err(internal)?;
                super::event::dispatch_persistent_event(
                    tenant,
                    state,
                    &event,
                    KIND_COMPANY_JOB_HEAD,
                    &state.relay_keypair.public_key().to_hex(),
                    None,
                )
                .await;
            }
            None => tx.rollback().await.map_err(internal)?,
        }
    }
    Ok(())
}

/// Moves active specialists in one function under its current head or Scout.
///
/// The caller keeps this inside its existing hire or member lifecycle
/// transaction, so users never observe a durable job assignment with a lost
/// manager transition.
pub(super) async fn reparent_job_specialists_for_function_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    state: &AppState,
    function: CompanyFunction,
    manager_pubkey: &str,
    source_action_event_id: &str,
) -> Result<Vec<StoredEvent>, IngestError> {
    let community_id = tenant.community();
    let assignments = current_job_assignments(state, community_id).await?;
    let mut replaced = Vec::new();
    for (_, assignment) in assignments {
        if assignment.function != function || assignment.state != JobState::Filled {
            continue;
        }
        let Some(assignee) = assignment.assignee_pubkey.as_deref() else {
            continue;
        };
        if assignee == manager_pubkey
            || !job_assignee_is_active(state, community_id, assignee).await?
        {
            continue;
        }
        let Some((current, position)) = super::company_member_records::load_position_for_proposal(
            state,
            community_id,
            assignee,
        )
        .await?
        else {
            continue;
        };
        if position.status != MemberStatus::Active
            || position.manager_pubkey.as_deref() == Some(manager_pubkey)
        {
            continue;
        }
        let action = MemberPositionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            pubkey: assignee.to_owned(),
            action: MemberPositionActionKind::SetManager,
            expected_head_event_id: Some(current.event.id.to_hex()),
            title: None,
            manager_pubkey: Some(Some(manager_pubkey.to_owned())),
            reason: None,
        };
        let prepared = super::company_member_records::prepare_member_position_proposal(
            tx,
            tenant,
            state,
            &action,
            source_action_event_id,
        )
        .await?;
        replaced.push(
            super::company_member_records::replace_prepared_member_position(
                tx,
                community_id,
                &prepared,
                state,
            )
            .await?,
        );
    }
    Ok(replaced)
}

#[cfg(test)]
#[path = "company_jobs/postgres_tests.rs"]
mod postgres_tests;
