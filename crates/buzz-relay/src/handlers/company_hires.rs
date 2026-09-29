//! Broker for company hire proposals and relay-signed hire heads.
//!
//! A founder approval is required before an employee identity can be attached
//! to a hire. The completed hire head and company member position are written
//! in one transaction after the signed introduction exists in its channel.

use std::sync::Arc;

use nostr::{Event, EventBuilder, EventId, Kind, Tag};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use buzz_core::company_members::{MemberPositionAction, MemberPositionActionKind};
use buzz_core::company_records::{
    hire_d_tag, parse_company_command, validate_hire_action, CompanyCommand, HireAction,
    HireActionKind, HireHead, HireProposal, HireStatus, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{
    KIND_HIRE_ACTION, KIND_HIRE_HEAD, KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2,
};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

const MAX_CURRENT_HIRE_HEADS: i64 = 10_000;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles a member-signed hire lifecycle action (kind 47039).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::HireAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_hire_action(&action).map_err(|error| invalid(format!("hire action: {error}")))?;
    let d_tag = command_d_tag(&event, action.hire_id)?;
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write company hires",
        ));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let actor = state
        .db
        .get_relay_member(community_id, &actor_pubkey)
        .await
        .map_err(internal)?
        .ok_or_else(|| forbidden("actor is not a member of this community"))?;
    if !is_admin(&actor.role) {
        return Err(forbidden(
            "only a community owner or admin can hire an employee",
        ));
    }
    if matches!(
        action.action,
        HireActionKind::Approve | HireActionKind::AttachEmployee | HireActionKind::Complete
    ) && actor.role != "owner"
    {
        return Err(forbidden("founder sign-off requires the community owner"));
    }
    let employee_intro = match action.action {
        HireActionKind::AttachEmployee => {
            let stored = current_hire_head(state, community_id, &d_tag)
                .await?
                .ok_or_else(|| conflict("hire does not exist"))?;
            let hire = parse_hire_head(&stored)?;
            let employee = action
                .employee_pubkey
                .as_deref()
                .ok_or_else(|| invalid("attach_employee needs employeePubkey"))?;
            verify_managed_employee(state, tenant, &hire, &actor_pubkey, employee).await?;
            None
        }
        HireActionKind::Complete => {
            let stored = current_hire_head(state, community_id, &d_tag)
                .await?
                .ok_or_else(|| conflict("hire does not exist"))?;
            let hire = parse_hire_head(&stored)?;
            let employee = action
                .employee_pubkey
                .as_deref()
                .ok_or_else(|| invalid("complete needs employeePubkey"))?;
            let introduction = action
                .introduction_event_id
                .as_deref()
                .ok_or_else(|| invalid("complete needs introductionEventId"))?;
            Some(
                verify_employee_and_introduction(
                    state,
                    tenant,
                    &hire,
                    &actor_pubkey,
                    employee,
                    introduction,
                )
                .await?,
            )
        }
        _ => None,
    };
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
        return Err(forbidden(
            "only a community owner or admin can hire an employee",
        ));
    }
    if matches!(
        action.action,
        HireActionKind::Approve | HireActionKind::AttachEmployee | HireActionKind::Complete
    ) && role != "owner"
    {
        return Err(forbidden("founder sign-off requires the community owner"));
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-hire:{}:{}",
            community_id.as_uuid(),
            action.hire_id
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

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

    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_HIRE_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_hire_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(IngestError::Internal(
            "error: hire head changed while its transaction lock was held".into(),
        ));
    }
    let current = current_stored.as_ref().map(parse_hire_head).transpose()?;
    let expected = action.expected_head_event_id.as_deref().map(str::to_owned);
    if expected != current_head_id.as_deref().map(hex::encode) {
        return Err(conflict(format!(
            "hire changed; current head is {}",
            current_head_id
                .as_deref()
                .map(hex::encode)
                .unwrap_or_else(|| "missing".to_owned())
        )));
    }

    let mut next = match action.action {
        HireActionKind::Create => {
            if current.is_some() {
                return Err(conflict("hire already exists"));
            }
            let proposal = action
                .proposal
                .as_ref()
                .ok_or_else(|| invalid("create needs the hire proposal"))?;
            validate_unique_name_in_transaction(
                &mut tx,
                tenant,
                state,
                &proposal.display_name,
                None,
                None,
            )
            .await?;
            if role != "owner" && role != "admin" {
                return Err(forbidden("only a community owner or admin can hire"));
            }
            HireHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                proposal: proposal.clone(),
                status: HireStatus::Proposed,
                proposed_by_pubkey: actor_pubkey.clone(),
                source_ask_id: None,
                source_ask_channel_id: None,
                founder_pubkey: None,
                employee_pubkey: None,
                introduction_event_id: None,
                denial_reason: None,
                source_action_event_id: event.id.to_hex(),
            }
        }
        HireActionKind::Update => {
            let mut head = current.ok_or_else(|| conflict("hire does not exist"))?;
            if head.status != HireStatus::Proposed {
                return Err(conflict("only an open hire proposal can be edited"));
            }
            let proposal = action
                .proposal
                .as_ref()
                .ok_or_else(|| invalid("update needs the hire proposal"))?;
            validate_unique_name_in_transaction(
                &mut tx,
                tenant,
                state,
                &proposal.display_name,
                Some(action.hire_id),
                None,
            )
            .await?;
            head.proposal = proposal.clone();
            head.source_action_event_id = event.id.to_hex();
            head
        }
        HireActionKind::Approve => {
            let mut head = current.ok_or_else(|| conflict("hire does not exist"))?;
            if !matches!(
                head.status,
                HireStatus::Proposed | HireStatus::AwaitingFounder
            ) {
                return Err(conflict("hire is not waiting for founder sign-off"));
            }
            head.status = HireStatus::Approved;
            head.founder_pubkey = Some(actor_pubkey.clone());
            head.denial_reason = None;
            head.source_action_event_id = event.id.to_hex();
            head
        }
        HireActionKind::AttachEmployee => {
            let mut head = current.ok_or_else(|| conflict("hire does not exist"))?;
            if head.status != HireStatus::Approved
                || head.founder_pubkey.as_deref() != Some(actor_pubkey.as_str())
            {
                return Err(forbidden(
                    "founder approval is required before attaching an employee",
                ));
            }
            if head.employee_pubkey.is_some() {
                return Err(conflict("an employee is already attached to this hire"));
            }
            let employee = action
                .employee_pubkey
                .clone()
                .ok_or_else(|| invalid("attach_employee needs employeePubkey"))?;
            head.employee_pubkey = Some(employee);
            head.source_action_event_id = event.id.to_hex();
            head
        }
        HireActionKind::Deny => {
            let mut head = current.ok_or_else(|| conflict("hire does not exist"))?;
            if !matches!(
                head.status,
                HireStatus::Proposed | HireStatus::AwaitingFounder
            ) {
                return Err(conflict("hire is already approved, complete or denied"));
            }
            head.status = HireStatus::Denied;
            head.denial_reason = action.reason.clone();
            head.source_action_event_id = event.id.to_hex();
            head
        }
        HireActionKind::Complete => {
            let mut head = current.ok_or_else(|| conflict("hire does not exist"))?;
            if head.status != HireStatus::Approved || head.founder_pubkey.is_none() {
                return Err(forbidden("founder sign-off is required before hiring"));
            }
            let employee = action
                .employee_pubkey
                .clone()
                .ok_or_else(|| invalid("complete needs employeePubkey"))?;
            let introduction = action
                .introduction_event_id
                .clone()
                .ok_or_else(|| invalid("complete needs introductionEventId"))?;
            if head.employee_pubkey.as_deref() != Some(employee.as_str())
                || head.founder_pubkey.as_deref() != Some(actor_pubkey.as_str())
            {
                return Err(forbidden(
                    "the approved hire employee must be attached by its founder",
                ));
            }
            validate_unique_name_in_transaction(
                &mut tx,
                tenant,
                state,
                &head.proposal.display_name,
                Some(head.proposal.hire_id),
                Some(employee.as_str()),
            )
            .await?;
            if employee_intro.as_deref() != Some(introduction.as_str()) {
                return Err(invalid("employee introduction could not be verified"));
            }
            head.status = HireStatus::Hired;
            head.employee_pubkey = Some(employee);
            head.introduction_event_id = Some(introduction);
            head.source_action_event_id = event.id.to_hex();
            head
        }
    };

    let employee_action = if action.action == HireActionKind::Complete {
        Some(MemberPositionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            pubkey: action
                .employee_pubkey
                .clone()
                .ok_or_else(|| invalid("complete needs employeePubkey"))?,
            action: MemberPositionActionKind::SetPosition,
            expected_head_event_id: None,
            title: Some(next.proposal.title.clone()),
            manager_pubkey: Some(next.proposal.manager_pubkey.clone()),
            reason: None,
        })
    } else {
        None
    };
    let prepared_position = match employee_action.as_ref() {
        Some(employee_action) => Some(
            super::company_member_records::prepare_member_position_proposal(
                &mut tx,
                tenant,
                state,
                employee_action,
                &event.id.to_hex(),
            )
            .await?,
        ),
        None => None,
    };

    next.source_action_event_id = event.id.to_hex();
    let head_event = relay_hire_head_event(&next, &d_tag, current_stored.as_ref(), state)?;
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
        return Err(conflict("hire changed before the action could commit"));
    }

    let stored_position = if let Some(prepared) = prepared_position.as_ref() {
        Some(
            super::company_member_records::replace_prepared_member_position(
                &mut tx,
                community_id,
                prepared,
                state,
            )
            .await?,
        )
    } else {
        None
    };
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_HIRE_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_HIRE_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    if let Some(stored_position) = stored_position {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            &stored_position,
            buzz_core::kind::KIND_MEMBER_POSITION_HEAD,
            &state.relay_keypair.public_key().to_hex(),
            None,
        )
        .await;
    }
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

/// Serializes one employee name and checks real member profiles and open hires.
pub(super) async fn validate_unique_name_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    state: &AppState,
    display_name: &str,
    exclude_hire_id: Option<Uuid>,
    exclude_employee_pubkey: Option<&str>,
) -> Result<(), IngestError> {
    let normalized = display_name.trim().to_lowercase();
    if normalized.is_empty() {
        return Err(invalid("employee display name is required"));
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-hire-name:{}:{normalized}",
            tenant.community().as_uuid()
        ))
        .execute(&mut **tx)
        .await
        .map_err(internal)?;

    let exclude_pubkey = exclude_employee_pubkey
        .map(nostr::PublicKey::from_hex)
        .transpose()
        .map_err(|_| invalid("employeePubkey must be a public key"))?
        .map(|pubkey| pubkey.to_bytes().to_vec());
    let profile_name_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM users \
         WHERE community_id = $1 \
         AND (agent_owner_pubkey IS NOT NULL OR EXISTS ( \
             SELECT 1 FROM relay_members rm \
             WHERE rm.community_id = users.community_id AND rm.pubkey = users.pubkey)) \
         AND lower(btrim(COALESCE(display_name, ''))) = lower($2) \
         AND ($3::bytea IS NULL OR pubkey <> $3))",
    )
    .bind(tenant.community().as_uuid())
    .bind(display_name.trim())
    .bind(exclude_pubkey)
    .fetch_one(&mut **tx)
    .await
    .map_err(internal)?;
    if profile_name_exists {
        return Err(conflict("employee display name is already in use"));
    }

    let mut query = EventQuery::for_community(tenant.community());
    query.kinds = Some(vec![KIND_HIRE_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(MAX_CURRENT_HIRE_HEADS + 1);
    let heads = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if heads.len() as i64 > MAX_CURRENT_HIRE_HEADS {
        return Err(IngestError::Internal(
            "error: current hire heads exceed the supported name-check limit".into(),
        ));
    }
    for stored in &heads {
        let head = parse_hire_head(stored)?;
        if Some(head.proposal.hire_id) != exclude_hire_id
            && head.status != HireStatus::Denied
            && head.proposal.display_name.trim().to_lowercase() == normalized
        {
            return Err(conflict("employee display name is already in use"));
        }
    }
    Ok(())
}

/// Prepare the first hire head for an employee-proposed ask.
pub(super) async fn prepare_ask_proposal(
    tenant: &TenantContext,
    state: &AppState,
    proposal: &HireProposal,
    asker_pubkey: &str,
    ask_channel_id: Uuid,
    ask_id: Uuid,
    source_action_event_id: &str,
) -> Result<PreparedHireHead, IngestError> {
    let d_tag = hire_d_tag(proposal.hire_id);
    if current_hire_head(state, tenant.community(), &d_tag)
        .await?
        .is_some()
    {
        return Err(conflict("hire already exists"));
    }
    let head = HireHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        proposal: proposal.clone(),
        status: HireStatus::Proposed,
        proposed_by_pubkey: asker_pubkey.to_owned(),
        source_ask_id: Some(ask_id),
        source_ask_channel_id: Some(ask_channel_id),
        founder_pubkey: None,
        employee_pubkey: None,
        introduction_event_id: None,
        denial_reason: None,
        source_action_event_id: source_action_event_id.to_owned(),
    };
    let event = relay_hire_head_event(&head, &d_tag, None, state)?;
    Ok(PreparedHireHead {
        d_tag,
        expected_head_id: None,
        display_name: proposal.display_name.clone(),
        event,
    })
}

/// Prepared hire head included in a caller's command transaction.
pub(super) struct PreparedHireHead {
    /// Hire d-tag.
    pub d_tag: String,
    /// Requested employee display name.
    pub display_name: String,
    /// Exact current revision, or `None` for create-only.
    pub expected_head_id: Option<Vec<u8>>,
    /// Relay-signed next head.
    pub event: Event,
}

/// Replaces a hire head in the caller's event transaction.
pub(super) async fn replace_prepared_hire_head(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    prepared: &PreparedHireHead,
    state: &AppState,
) -> Result<StoredEvent, IngestError> {
    let precondition = prepared.expected_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            &prepared.event,
            &prepared.d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err(conflict("hire changed before the linked ask committed"));
    }
    Ok(replaced.event)
}

pub(super) async fn current_hire_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_HIRE_HEAD as i32]);
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
        return Err(IngestError::Internal(
            "error: duplicate hire head coordinate".into(),
        ));
    }
    if let Some(head) = rows.first() {
        let parsed = parse_hire_head(head)?;
        if hire_d_tag(parsed.proposal.hire_id) != d_tag {
            return Err(IngestError::Internal(
                "error: stored hire head does not match its d-tag".into(),
            ));
        }
    }
    Ok(rows.pop())
}

pub(super) fn parse_hire_head(event: &StoredEvent) -> Result<HireHead, IngestError> {
    let head = serde_json::from_str::<HireHead>(&event.event.content)
        .map_err(|_| IngestError::Internal("error: stored hire head is invalid".into()))?;
    if event.event.kind != Kind::Custom(KIND_HIRE_HEAD as u16)
        || event.event.verify().is_err()
        || head.schema_version != COMPANY_RECORD_SCHEMA_VERSION
        || validate_hire_action(&HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: head.proposal.hire_id,
            action: HireActionKind::Create,
            expected_head_event_id: None,
            proposal: Some(head.proposal.clone()),
            employee_pubkey: None,
            introduction_event_id: None,
            reason: None,
        })
        .is_err()
        || nostr::PublicKey::from_hex(&head.proposed_by_pubkey).is_err()
        || EventId::parse(&head.source_action_event_id).is_err()
        || head
            .founder_pubkey
            .as_deref()
            .is_some_and(|pubkey| nostr::PublicKey::from_hex(pubkey).is_err())
        || head
            .employee_pubkey
            .as_deref()
            .is_some_and(|pubkey| nostr::PublicKey::from_hex(pubkey).is_err())
        || head
            .introduction_event_id
            .as_deref()
            .is_some_and(|id| EventId::parse(id).is_err())
        || (head.introduction_event_id.is_some() && head.employee_pubkey.is_none())
        || (head.status == HireStatus::Hired
            && (head.employee_pubkey.is_none() || head.introduction_event_id.is_none()))
        || head.source_ask_id.is_some() != head.source_ask_channel_id.is_some()
    {
        return Err(IngestError::Internal(
            "error: stored hire head identity is invalid".into(),
        ));
    }
    Ok(head)
}

pub(super) fn relay_hire_head_event(
    head: &HireHead,
    d_tag: &str,
    previous: Option<&StoredEvent>,
    state: &AppState,
) -> Result<Event, IngestError> {
    let content = serde_json::to_string(head).map_err(internal)?;
    let now = nostr::Timestamp::now().as_secs();
    let created_at = previous.map_or(now, |stored| {
        now.max(stored.event.created_at.as_secs().saturating_add(1))
    });
    let d_tag =
        Tag::parse(["d", d_tag]).map_err(|error| internal(format!("hire d-tag: {error}")))?;
    let mut tags = vec![d_tag];
    if let Some(employee_pubkey) = head.employee_pubkey.as_deref() {
        tags.push(
            Tag::parse(["p", employee_pubkey])
                .map_err(|error| internal(format!("hire employee tag: {error}")))?,
        );
    }
    EventBuilder::new(Kind::Custom(KIND_HIRE_HEAD as u16), content)
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn command_d_tag(event: &Event, hire_id: Uuid) -> Result<String, IngestError> {
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if d_tags.len() != 1 || d_tags[0].content() != Some(hire_d_tag(hire_id).as_str()) {
        return Err(invalid("hire command needs its exact company hire d-tag"));
    }
    if event.tags.iter().any(|tag| tag.kind().to_string() == "h") {
        return Err(forbidden("company hire commands cannot be channel-scoped"));
    }
    Ok(hire_d_tag(hire_id))
}

async fn verify_employee_and_introduction(
    state: &AppState,
    tenant: &TenantContext,
    hire: &HireHead,
    actor_pubkey: &str,
    employee_pubkey: &str,
    introduction_event_id: &str,
) -> Result<String, IngestError> {
    let employee =
        verify_managed_employee(state, tenant, hire, actor_pubkey, employee_pubkey).await?;
    if hire.employee_pubkey.as_deref() != Some(employee_pubkey) {
        return Err(forbidden(
            "the approved hire employee must be attached before completion",
        ));
    }
    let event_id = EventId::parse(introduction_event_id)
        .map_err(|_| invalid("introductionEventId must be an event id"))?;
    let intro = state
        .db
        .get_event_by_id_for_event_write(tenant.community(), &event_id.to_bytes())
        .await
        .map_err(internal)?
        .ok_or_else(|| invalid("employee introduction event does not exist"))?;
    let has_channel_tag = intro.event.tags.iter().any(|tag| {
        tag.kind().to_string() == "h"
            && tag.content() == Some(hire.proposal.introduction_channel_id.to_string().as_str())
    });
    if !matches!(
        u32::from(intro.event.kind.as_u16()),
        KIND_STREAM_MESSAGE | KIND_STREAM_MESSAGE_V2
    ) || intro.event.pubkey != employee
        || intro.channel_id != Some(hire.proposal.introduction_channel_id)
        || !has_channel_tag
        || intro.event.content.trim().is_empty()
    {
        return Err(invalid(
            "introduction must be a non-empty channel post signed by the new employee",
        ));
    }
    Ok(introduction_event_id.to_owned())
}

async fn verify_managed_employee(
    state: &AppState,
    tenant: &TenantContext,
    hire: &HireHead,
    actor_pubkey: &str,
    employee_pubkey: &str,
) -> Result<nostr::PublicKey, IngestError> {
    if hire.status != HireStatus::Approved || hire.founder_pubkey.as_deref() != Some(actor_pubkey) {
        return Err(forbidden("founder sign-off is required before hiring"));
    }
    let employee = nostr::PublicKey::from_hex(employee_pubkey)
        .map_err(|_| invalid("employeePubkey must be a public key"))?;
    let founder = nostr::PublicKey::from_hex(actor_pubkey).map_err(internal)?;
    if !state
        .db
        .is_agent_owner(
            tenant.community(),
            &employee.to_bytes(),
            &founder.to_bytes(),
        )
        .await
        .map_err(internal)?
    {
        return Err(invalid(
            "employee must be a managed agent created by the signing founder",
        ));
    }
    Ok(employee)
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
