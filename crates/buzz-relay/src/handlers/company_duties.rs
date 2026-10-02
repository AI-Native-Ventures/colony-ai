//! Broker for employee duties and their existing workflow-engine definitions.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::{Event, EventBuilder, Kind, Tag};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use buzz_core::company_duties::{
    duty_d_tag, validate_duty_action, validate_duty_d_tag, validate_duty_head,
    validate_duty_proposal, DutyAction, DutyActionKind, DutyHead, DutyProposal, DutyStatus,
};
use buzz_core::company_records::{
    parse_company_command, CompanyCommand, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_DUTY_ACTION, KIND_DUTY_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;
use buzz_workflow::schema::{ActionDef, Step, TriggerDef, WorkflowDef};

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Prepared duty record and workflow data for an ask-resolution transaction.
pub(crate) struct PreparedDutyHead {
    pub(crate) duty_id: Uuid,
    pub(crate) d_tag: String,
    pub(crate) event: Event,
    pub(crate) workflow_owner_pubkey: Vec<u8>,
    pub(crate) workflow_channel_id: Uuid,
    pub(crate) workflow_name: String,
    pub(crate) workflow_definition: String,
    pub(crate) workflow_hash: Vec<u8>,
}

/// Ask-resolution data needed to create the approved duty and workflow.
pub(crate) struct ApprovedDutyAsk<'a> {
    pub(crate) proposal: &'a DutyProposal,
    pub(crate) proposer_pubkey: &'a str,
    pub(crate) approver_pubkey: &'a str,
    pub(crate) ask_id: Uuid,
    pub(crate) ask_channel_id: Uuid,
    pub(crate) response_event_id: String,
}

/// Handles a member-signed duty lifecycle mutation (kind 47044).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::DutyAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_duty_action(&action).map_err(|error| invalid(format!("duty action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_DUTY_ACTION {
        return Err(invalid("duty action has the wrong event kind"));
    }
    let d_tag = command_d_tag(&event, action.duty_id)?;
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write company duties",
        ));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    if state
        .db
        .get_event_by_id_for_event_write(community_id, &event.id.to_bytes())
        .await
        .map_err(internal)?
        .is_some()
    {
        return Ok(duplicate_result(&event));
    }
    let stored = current_duty_head(state, community_id, &d_tag)
        .await?
        .ok_or_else(|| conflict("duty does not exist"))?;
    let mut head = parse_duty_head(&stored, state)?;
    ensure_head_identity(&head, action.duty_id)?;
    ensure_command_employee_tag(&event, &head.proposal.employee_pubkey)?;
    ensure_expected_head(&action, &stored)?;

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
    .map_err(internal)?
    .ok_or_else(|| forbidden("actor is not a member of this community"))?;
    if !is_admin(&role) {
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden(
            "only a community owner or admin can manage duties",
        ));
    }
    let duplicate = command_exists(&mut tx, community_id, &event).await?;
    if duplicate {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-duty:{}:{}",
            community_id.as_uuid(),
            action.duty_id
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let locked = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_DUTY_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    if locked.as_deref() != Some(stored.event.id.to_bytes().as_slice()) {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict("duty changed before the action could commit"));
    }

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    match action.action {
        DutyActionKind::Update => {
            if head.status == DutyStatus::Deleted {
                return Err(conflict("a deleted duty cannot be edited"));
            }
            let proposal = action
                .proposal
                .as_ref()
                .ok_or_else(|| invalid("update needs a proposal"))?;
            if proposal.employee_pubkey != head.proposal.employee_pubkey {
                return Err(invalid(
                    "duty owner cannot be changed; create a new duty for another employee",
                ));
            }
            validate_employee_channel(state, tenant, proposal).await?;
            let (_, definition_json, definition_hash) = workflow_definition(proposal)?;
            buzz_db::workflow::upsert_workflow_in_transaction(
                &mut tx,
                community_id,
                action.duty_id,
                proposal.channel_id,
                &hex::decode(&head.approved_by_pubkey).map_err(internal)?,
                &proposal.title,
                &definition_json,
                &definition_hash,
                head.status == DutyStatus::Active,
            )
            .await
            .map_err(internal)?;
            head.proposal = proposal.clone();
            head.workflow_definition_hash = hex::encode(definition_hash);
            head.updated_at = now.clone();
        }
        DutyActionKind::Pause => {
            if head.status != DutyStatus::Active {
                return Err(conflict("only an active duty can be paused"));
            }
            set_workflow_enabled(&mut tx, community_id, action.duty_id, false).await?;
            head.status = DutyStatus::Paused;
            head.updated_at = now.clone();
        }
        DutyActionKind::Resume => {
            if head.status != DutyStatus::Paused {
                return Err(conflict("only a paused duty can be resumed"));
            }
            set_workflow_enabled(&mut tx, community_id, action.duty_id, true).await?;
            head.status = DutyStatus::Active;
            head.updated_at = now.clone();
        }
        DutyActionKind::Delete => {
            if head.status == DutyStatus::Deleted {
                return Err(conflict("duty is already deleted"));
            }
            set_workflow_enabled(&mut tx, community_id, action.duty_id, false).await?;
            head.status = DutyStatus::Deleted;
            head.updated_at = now.clone();
        }
    };
    head.source_action_event_id = event.id.to_hex();
    let head_event = relay_duty_head_event(&head, &d_tag, Some(&stored), state)?;
    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community_id, &event, None)
            .await
            .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let expected_revision = stored.event.id.to_bytes();
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community_id,
            &head_event,
            &d_tag,
            None,
            ParameterizedReplacePrecondition::ExpectedRevision(&expected_revision),
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict("duty changed before the action could commit"));
    }
    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_DUTY_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_DUTY_HEAD,
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

/// Validate and prepare a duty proposal before the ask broker's atomic commit.
pub(crate) async fn prepare_approved_duty(
    tenant: &TenantContext,
    state: &AppState,
    approval: ApprovedDutyAsk<'_>,
) -> Result<PreparedDutyHead, IngestError> {
    let ApprovedDutyAsk {
        proposal,
        proposer_pubkey,
        approver_pubkey,
        ask_id,
        ask_channel_id,
        response_event_id,
    } = approval;
    validate_duty_proposal_route(tenant, state, proposal, ask_channel_id).await?;
    let (_, definition_json, definition_hash) = workflow_definition(proposal)?;
    let d_tag = duty_d_tag(proposal.duty_id);
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let head = DutyHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        duty_id: proposal.duty_id,
        proposal: proposal.clone(),
        status: DutyStatus::Active,
        proposed_by_pubkey: proposer_pubkey.to_owned(),
        approved_by_pubkey: approver_pubkey.to_owned(),
        approved_at: now.clone(),
        source_ask_id: ask_id,
        source_ask_channel_id: ask_channel_id,
        workflow_definition_hash: hex::encode(&definition_hash),
        created_at: now.clone(),
        updated_at: now,
        source_action_event_id: response_event_id,
    };
    let event = relay_duty_head_event(&head, &d_tag, None, state)?;
    Ok(PreparedDutyHead {
        duty_id: proposal.duty_id,
        d_tag,
        event,
        workflow_owner_pubkey: hex::decode(approver_pubkey).map_err(internal)?,
        workflow_channel_id: proposal.channel_id,
        workflow_name: proposal.title.clone(),
        workflow_definition: definition_json,
        workflow_hash: definition_hash,
    })
}

/// Validate the employee and destination channel for a typed duty ask.
pub(crate) async fn validate_duty_proposal_route(
    tenant: &TenantContext,
    state: &AppState,
    proposal: &DutyProposal,
    ask_channel_id: Uuid,
) -> Result<(), IngestError> {
    validate_duty_proposal(proposal).map_err(|error| invalid(format!("duty proposal: {error}")))?;
    if proposal.channel_id != ask_channel_id {
        return Err(invalid(
            "duty proposal channel must match the ask conversation channel",
        ));
    }
    validate_employee_channel(state, tenant, proposal).await
}

/// Atomically insert the linked workflow and duty head.
pub(crate) async fn replace_prepared_duty_head(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: CommunityId,
    prepared: &PreparedDutyHead,
    state: &AppState,
) -> Result<StoredEvent, IngestError> {
    let duplicate_workflow = buzz_db::workflow::create_workflow_in_transaction(
        tx,
        community_id,
        prepared.duty_id,
        prepared.workflow_channel_id,
        &prepared.workflow_owner_pubkey,
        &prepared.workflow_name,
        &prepared.workflow_definition,
        &prepared.workflow_hash,
    )
    .await
    .map_err(internal)?;
    if !duplicate_workflow {
        return Err(conflict("workflow id already exists"));
    }
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            &prepared.event,
            &prepared.d_tag,
            None,
            ParameterizedReplacePrecondition::CreateOnly,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err(conflict("duty already exists"));
    }
    Ok(replaced.event)
}

/// Resolve one relay-signed duty head by its d-tag.
pub(crate) async fn current_duty_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_DUTY_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.to_owned());
    query.limit = Some(2);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() > 1 {
        return Err(internal("stored duty d-tag resolved to multiple heads"));
    }
    let stored = rows.into_iter().next();
    if let Some(stored) = &stored {
        let head = parse_duty_head(stored, state)?;
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
        if stored.channel_id.is_some()
            || stored.event.tags.len() != 2
            || d_tags.len() != 1
            || d_tags[0].content() != Some(d_tag)
            || p_tags.len() != 1
            || p_tags[0].content() != Some(head.proposal.employee_pubkey.as_str())
        {
            return Err(internal("stored duty head has invalid scope or tags"));
        }
    }
    Ok(stored)
}

fn workflow_definition(
    proposal: &DutyProposal,
) -> Result<(WorkflowDef, String, Vec<u8>), IngestError> {
    let definition = WorkflowDef {
        name: proposal.title.clone(),
        description: Some(proposal.instructions.clone()),
        trigger: TriggerDef::Schedule {
            cron: Some(proposal.schedule_cron.clone()),
            interval: None,
            timezone: Some(proposal.time_zone.clone()),
        },
        steps: vec![Step {
            id: "duty".into(),
            name: Some(proposal.title.clone()),
            if_expr: None,
            timeout_secs: None,
            action: ActionDef::AskAgent {
                agent_pubkey: proposal.employee_pubkey.clone(),
                instruction: proposal.instructions.clone(),
                expected_result: None,
            },
        }],
        enabled: true,
    };
    definition
        .validate()
        .map_err(|error| invalid(format!("workflow definition: {error}")))?;
    let definition_json =
        serde_json::to_string(&definition).map_err(|error| internal(error.to_string()))?;
    let hash = Sha256::digest(definition_json.as_bytes()).to_vec();
    Ok((definition, definition_json, hash))
}

async fn validate_employee_channel(
    state: &AppState,
    tenant: &TenantContext,
    proposal: &DutyProposal,
) -> Result<(), IngestError> {
    if !super::company_member_records::is_registered_employee(
        state,
        tenant.community(),
        &proposal.employee_pubkey,
    )
    .await?
    {
        return Err(invalid(
            "scheduled duties require a managed employee with workflow execution support",
        ));
    }
    state
        .db
        .get_channel_for_event_write(tenant.community(), proposal.channel_id)
        .await
        .map_err(|_| invalid("duty channel does not exist in this community"))?;
    let member_role = state
        .db
        .get_member_role(
            tenant.community(),
            proposal.channel_id,
            &hex::decode(&proposal.employee_pubkey).map_err(internal)?,
        )
        .await
        .map_err(internal)?;
    if member_role.is_none() {
        return Err(invalid(
            "duty employee is not an active member of the channel",
        ));
    }
    Ok(())
}

async fn set_workflow_enabled(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: CommunityId,
    workflow_id: Uuid,
    enabled: bool,
) -> Result<(), IngestError> {
    let result = sqlx::query(
        "UPDATE workflows SET enabled = $1, updated_at = NOW() \
         WHERE community_id = $2 AND id = $3",
    )
    .bind(enabled)
    .bind(community_id.as_uuid())
    .bind(workflow_id)
    .execute(&mut **tx)
    .await
    .map_err(internal)?;
    if result.rows_affected() != 1 {
        return Err(conflict("duty workflow definition is missing"));
    }
    Ok(())
}

async fn command_exists(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community_id: CommunityId,
    event: &Event,
) -> Result<bool, IngestError> {
    let event_id = event.id.to_bytes();
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community_id.as_uuid())
    .bind(event_id.as_slice())
    .fetch_one(&mut **tx)
    .await
    .map_err(internal)
}

fn parse_duty_head(stored: &StoredEvent, state: &AppState) -> Result<DutyHead, IngestError> {
    if stored.event.kind != Kind::Custom(KIND_DUTY_HEAD as u16)
        || stored.event.pubkey != state.relay_keypair.public_key()
        || stored.event.verify().is_err()
    {
        return Err(internal("stored duty head signature or author is invalid"));
    }
    let head = serde_json::from_str::<DutyHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored duty head is invalid: {error}")))?;
    validate_duty_head(&head).map_err(|error| internal(format!("stored duty head: {error}")))?;
    Ok(head)
}

fn ensure_head_identity(head: &DutyHead, duty_id: Uuid) -> Result<(), IngestError> {
    if head.duty_id == duty_id && head.proposal.duty_id == duty_id {
        Ok(())
    } else {
        Err(internal(
            "stored duty head identity does not match its d-tag",
        ))
    }
}

fn ensure_expected_head(action: &DutyAction, stored: &StoredEvent) -> Result<(), IngestError> {
    let actual = stored.event.id.to_hex();
    if action.expected_head_event_id == actual {
        Ok(())
    } else {
        Err(conflict(format!("duty changed; current head is {actual}")))
    }
}

fn relay_duty_head_event(
    head: &DutyHead,
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
    let employee_tag =
        Tag::parse(["p", head.proposal.employee_pubkey.as_str()]).map_err(internal)?;
    EventBuilder::new(Kind::Custom(KIND_DUTY_HEAD as u16), content)
        .tags([d_tag, employee_tag])
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn command_d_tag(event: &Event, duty_id: Uuid) -> Result<String, IngestError> {
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    let auth_tag_count = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "auth")
        .count();
    // The SDK and desktop builders name the duty's employee in one `p` tag; it is
    // checked against the stored duty head once that is loaded.
    let employee_tag_count = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "p")
        .count();
    if d_tags.len() != 1
        || auth_tag_count > 1
        || employee_tag_count > 1
        || event.tags.iter().any(|tag| {
            let kind = tag.kind().to_string();
            kind != "d" && kind != "auth" && kind != "p"
        })
    {
        return Err(invalid(
            "duty commands require one d tag, at most one employee p tag, no h tag, and no unsupported tags",
        ));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| invalid("duty command d tag must have a value"))?;
    validate_duty_d_tag(d_tag, duty_id)
        .map_err(|error| invalid(format!("duty command d tag: {error}")))?;
    Ok(d_tag.to_owned())
}

/// A command's optional employee `p` tag must name the stored duty's employee.
fn ensure_command_employee_tag(event: &Event, employee_pubkey: &str) -> Result<(), IngestError> {
    let mismatched = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "p")
        .any(|tag| tag.content() != Some(employee_pubkey));
    if mismatched {
        Err(invalid("duty command p tag must name the duty's employee"))
    } else {
        Ok(())
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
    use nostr::Keys;

    fn pause_command(extra_tags: Vec<Tag>, employee_pubkey: &str) -> (Event, Uuid) {
        let duty_id = Uuid::from_u128(7);
        let action = DutyAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            duty_id,
            action: DutyActionKind::Pause,
            expected_head_event_id: "ab".repeat(32),
            proposal: None,
            reason: None,
        };
        let event = buzz_sdk::company_duties::build_duty_action(&action, employee_pubkey)
            .expect("build duty action")
            .tags(extra_tags)
            .sign_with_keys(&Keys::generate())
            .expect("sign duty action");
        (event, duty_id)
    }

    #[test]
    fn command_tags_accept_the_layout_the_sdk_and_desktop_send() {
        let employee = Keys::generate().public_key().to_hex();
        let (event, duty_id) = pause_command(Vec::new(), &employee);
        assert!(event.tags.iter().any(|tag| tag.kind().to_string() == "p"));
        assert!(command_d_tag(&event, duty_id).is_ok());
    }

    #[test]
    fn command_tags_reject_channel_scope_and_a_second_employee_tag() {
        let employee = Keys::generate().public_key().to_hex();
        let channel = Tag::parse(["h", "ebe2a2eb-24c7-4cb0-ab92-65e5ffb90971"]).expect("h tag");
        let (event, duty_id) = pause_command(vec![channel], &employee);
        assert!(command_d_tag(&event, duty_id).is_err());

        let other = Keys::generate().public_key().to_hex();
        let second = Tag::parse(["p", other.as_str()]).expect("p tag");
        let (event, duty_id) = pause_command(vec![second], &employee);
        assert!(command_d_tag(&event, duty_id).is_err());
    }

    #[test]
    fn command_employee_tag_must_name_the_stored_duty_employee() {
        let employee = Keys::generate().public_key().to_hex();
        let (event, _) = pause_command(Vec::new(), &employee);
        assert!(ensure_command_employee_tag(&event, &employee).is_ok());
        let someone_else = Keys::generate().public_key().to_hex();
        assert!(ensure_command_employee_tag(&event, &someone_else).is_err());
    }
}
