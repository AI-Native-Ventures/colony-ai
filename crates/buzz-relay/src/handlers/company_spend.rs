//! Broker for community-wide employee allowances and AI spend records.
//!
//! Each member action and relay-signed head replacement commits atomically.
//! Spend metadata is owner/admin authored evidence and never triggers an
//! external provider operation.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::{Event, EventId, Kind};
use sqlx::{Postgres, Transaction};

use buzz_core::company_members::MemberKind;
use buzz_core::company_records::{
    parse_company_command, CompanyCommand, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::company_spend::{
    ai_spend_record_d_tag, employee_allowance_d_tag, validate_ai_spend_record_action,
    validate_ai_spend_record_head, validate_employee_allowance_action,
    validate_employee_allowance_head, AiSpendRecord, AiSpendRecordAction, AiSpendRecordHead,
    EmployeeAllowanceAction, EmployeeAllowanceHead, SourceOfFunds, SpendRecordActionKind,
    SpendRecordStatus,
};
use buzz_core::kind::{
    KIND_AGENT_TURN_METRIC, KIND_AI_SPEND_RECORD_ACTION, KIND_AI_SPEND_RECORD_HEAD,
    KIND_EMPLOYEE_AI_ALLOWANCE_ACTION, KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Allowance head prepared for an approved money ask.
pub(super) struct PreparedAllowanceHead {
    /// Employee allowance coordinate.
    pub d_tag: String,
    /// Employee whose company position must remain current through commit.
    pub employee_pubkey: String,
    /// Exact current allowance head revision, or `None` for first write.
    pub expected_head_id: Option<Vec<u8>>,
    /// Relay-signed next allowance head.
    pub event: Event,
}

/// Prepare the allowance head linked to an approved money ask.
pub(super) async fn prepare_approved_allowance_head(
    tenant: &TenantContext,
    state: &AppState,
    action: &EmployeeAllowanceAction,
    actor_pubkey: &str,
    response_event_id: &str,
) -> Result<PreparedAllowanceHead, IngestError> {
    validate_employee_allowance_action(action)
        .map_err(|error| invalid(format!("employee allowance proposal: {error}")))?;
    let d_tag = employee_allowance_d_tag(&action.employee_pubkey)
        .map_err(|error| invalid(format!("employee allowance d-tag: {error}")))?;
    let current = current_head_by_coordinate(
        state,
        tenant.community(),
        KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
        &d_tag,
    )
    .await?;
    check_expected_head(
        action.expected_head_event_id.as_deref(),
        current.as_ref().map(|e| &e.event),
    )?;
    let previous_id = current
        .as_ref()
        .map(|stored| stored.event.id.to_bytes().to_vec());
    let head = EmployeeAllowanceHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        employee_pubkey: action.employee_pubkey.clone(),
        allowance: action.allowance.clone(),
        temporary_allowance: action.temporary_allowance.clone(),
        funding_order: action.funding_order.clone(),
        actor_pubkey: actor_pubkey.to_owned(),
        updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        source_action_event_id: response_event_id.to_owned(),
    };
    validate_employee_allowance_head(&head)
        .map_err(|error| invalid(format!("approved employee allowance: {error}")))?;
    let event = super::business_records::relay_global_head_event(
        KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
        &d_tag,
        &head,
        current.as_ref(),
        state,
    )?;
    Ok(PreparedAllowanceHead {
        d_tag,
        employee_pubkey: action.employee_pubkey.clone(),
        expected_head_id: previous_id,
        event,
    })
}

/// Replace an allowance head in a caller-owned transaction.
pub(super) async fn replace_prepared_allowance_head(
    tx: &mut Transaction<'_, Postgres>,
    community_id: buzz_core::tenant::CommunityId,
    prepared: &PreparedAllowanceHead,
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
        return Err(conflict(
            "employee allowance changed before the approval committed",
        ));
    }
    Ok(replaced.event)
}

/// Dispatch one employee allowance or AI spend action.
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let kind = u32::from(event.kind.as_u16());
    let command = parse_company_command(kind, &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    match command {
        CompanyCommand::EmployeeAllowanceAction(action) => {
            handle_allowance_action(tenant, state, event, auth, action).await
        }
        CompanyCommand::AiSpendRecordAction(action) => {
            handle_spend_action(tenant, state, event, auth, action).await
        }
        _ => Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        )),
    }
}

async fn handle_allowance_action(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
    action: EmployeeAllowanceAction,
) -> Result<IngestResult, IngestError> {
    validate_employee_allowance_action(&action)
        .map_err(|error| invalid(format!("employee allowance action: {error}")))?;
    validate_member_action(&event, &auth, KIND_EMPLOYEE_AI_ALLOWANCE_ACTION)?;
    let actor = auth.pubkey().to_hex();
    let d_tag = employee_allowance_d_tag(&action.employee_pubkey)
        .map_err(|error| invalid(format!("employee allowance d-tag: {error}")))?;
    validate_tags(&event, &d_tag, Some(&action.employee_pubkey))?;
    ensure_unscoped_auth(&auth)?;

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let next = EmployeeAllowanceHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        employee_pubkey: action.employee_pubkey.clone(),
        allowance: action.allowance.clone(),
        temporary_allowance: action.temporary_allowance.clone(),
        funding_order: action.funding_order.clone(),
        actor_pubkey: actor,
        updated_at: now,
        source_action_event_id: event.id.to_hex(),
    };
    validate_employee_allowance_head(&next)
        .map_err(|error| invalid(format!("employee allowance head: {error}")))?;

    persist_global_head_action(
        tenant,
        state,
        event,
        d_tag,
        KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
        &next,
        action.expected_head_event_id.as_deref(),
        Some(&action.employee_pubkey),
    )
    .await
}

async fn handle_spend_action(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
    action: AiSpendRecordAction,
) -> Result<IngestResult, IngestError> {
    validate_ai_spend_record_action(&action)
        .map_err(|error| invalid(format!("AI spend record action: {error}")))?;
    validate_member_action(&event, &auth, KIND_AI_SPEND_RECORD_ACTION)?;
    let d_tag = ai_spend_record_d_tag(&action.record_id)
        .map_err(|error| invalid(format!("AI spend d-tag: {error}")))?;
    let employee_pubkey = action.record.as_ref().and_then(|record| match record {
        AiSpendRecord::AgentTurn {
            employee_pubkey, ..
        } => Some(employee_pubkey.as_str()),
        AiSpendRecord::ExternalCost { .. } => None,
    });
    validate_tags(&event, &d_tag, employee_pubkey)?;
    ensure_unscoped_auth(&auth)?;
    let actor = auth.pubkey().to_hex();

    let record = match action.action {
        SpendRecordActionKind::Record => action
            .record
            .clone()
            .ok_or_else(|| invalid("record action requires record"))?,
        SpendRecordActionKind::Remove => {
            let existing = current_spend_head(state, tenant, &d_tag)
                .await?
                .ok_or_else(|| conflict("AI spend record does not exist"))?;
            check_expected_head(
                action.expected_head_event_id.as_deref(),
                Some(&existing.event),
            )?;
            parse_spend_head(&existing)?.record
        }
    };
    if let AiSpendRecord::AgentTurn {
        employee_pubkey,
        source_usage_event_id,
        source_of_funds,
        ..
    } = &record
    {
        validate_usage_report_owner(
            tenant,
            state,
            source_usage_event_id,
            employee_pubkey,
            &actor,
        )
        .await?;
        if *source_of_funds != SourceOfFunds::Unknown {
            return Err(forbidden(
                "the current harness usage report has no verifiable funding source",
            ));
        }
    }

    let status = match action.action {
        SpendRecordActionKind::Record => SpendRecordStatus::Active,
        SpendRecordActionKind::Remove => SpendRecordStatus::Removed,
    };
    let next = AiSpendRecordHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        record_id: action.record_id.clone(),
        record,
        status,
        actor_pubkey: actor,
        updated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        source_action_event_id: event.id.to_hex(),
    };
    validate_ai_spend_record_head(&next)
        .map_err(|error| invalid(format!("AI spend record head: {error}")))?;
    persist_global_head_action(
        tenant,
        state,
        event,
        d_tag,
        KIND_AI_SPEND_RECORD_HEAD,
        &next,
        action.expected_head_event_id.as_deref(),
        employee_pubkey,
    )
    .await
}

async fn persist_global_head_action<T: serde::Serialize>(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    d_tag: String,
    head_kind: u32,
    head: &T,
    expected_head_event_id: Option<&str>,
    employee_pubkey: Option<&str>,
) -> Result<IngestResult, IngestError> {
    let community_id = tenant.community();
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
    let actor = event.pubkey.to_hex();
    let actor_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&actor)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    if !matches!(actor_role.as_deref(), Some("owner" | "admin")) {
        return Err(forbidden(
            "only company owners and admins can change AI spend",
        ));
    }
    if let Some(employee_pubkey) = employee_pubkey {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(format!("company-member-tree:{}", community_id.as_uuid()))
            .execute(&mut *tx)
            .await
            .map_err(internal)?;
        require_employee(tenant, state, employee_pubkey).await?;
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
    let locked_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        head_kind,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    check_expected_head_bytes(expected_head_event_id, locked_head_id.as_deref())?;
    let previous = current_head_by_coordinate(state, community_id, head_kind, &d_tag).await?;
    let actual_previous_id = previous
        .as_ref()
        .map(|stored| stored.event.id.to_bytes().to_vec());
    if actual_previous_id != locked_head_id {
        return Err(internal(
            "AI spend head changed while its transaction lock was held",
        ));
    }
    let head_event = super::business_records::relay_global_head_event(
        head_kind,
        &d_tag,
        head,
        previous.as_ref(),
        state,
    )?;
    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community_id, &event, None)
            .await
            .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let precondition = locked_head_id.as_deref().map_or(
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
            "AI spend record changed before the action committed; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        u32::from(event.kind.as_u16()),
        &event.pubkey.to_hex(),
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        head_kind,
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

pub(super) async fn require_employee(
    tenant: &TenantContext,
    state: &AppState,
    employee_pubkey: &str,
) -> Result<(), IngestError> {
    let position = super::company_member_records::load_position_for_proposal(
        state,
        tenant.community(),
        employee_pubkey,
    )
    .await?
    .ok_or_else(|| forbidden("AI spend employee has no current company position"))?;
    if position.1.kind == MemberKind::Employee {
        Ok(())
    } else {
        Err(forbidden("AI spend records require an employee position"))
    }
}

async fn validate_usage_report_owner(
    tenant: &TenantContext,
    state: &AppState,
    report_id: &str,
    employee_pubkey: &str,
    owner_pubkey: &str,
) -> Result<(), IngestError> {
    let event_id = EventId::parse(report_id)
        .map_err(|_| invalid("sourceUsageEventId must be a valid event id"))?;
    let bytes = event_id.to_bytes();
    let rows = state
        .db
        .get_events_by_ids(tenant.community(), &[bytes.as_slice()])
        .await
        .map_err(internal)?;
    let report = rows
        .first()
        .ok_or_else(|| invalid("source usage report does not exist in this community"))?;
    let owner_bytes = nostr::PublicKey::parse(owner_pubkey)
        .map_err(|_| invalid("authenticated member key is invalid"))?
        .to_bytes();
    let employee_bytes = nostr::PublicKey::parse(employee_pubkey)
        .map_err(|_| invalid("employee key is invalid"))?
        .to_bytes();
    let owner_tag_matches = report
        .event
        .tags
        .iter()
        .any(|tag| tag.kind().to_string() == "p" && tag.content() == Some(owner_pubkey));
    if report.event.kind != Kind::Custom(KIND_AGENT_TURN_METRIC as u16)
        || report.event.pubkey.to_bytes() != employee_bytes
        || !owner_tag_matches
    {
        return Err(invalid(
            "source usage report must be authored by the employee and addressed to its owner",
        ));
    }
    let is_owner = state
        .db
        .is_agent_owner(tenant.community(), &employee_bytes, &owner_bytes)
        .await
        .map_err(internal)?;
    if !is_owner {
        return Err(forbidden(
            "authenticated member does not own the reported employee",
        ));
    }
    Ok(())
}

async fn current_spend_head(
    state: &AppState,
    tenant: &TenantContext,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    current_head_by_coordinate(state, tenant.community(), KIND_AI_SPEND_RECORD_HEAD, d_tag).await
}

async fn current_head_by_coordinate(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    kind: u32,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![kind as i32]);
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
        return Err(internal("duplicate AI spend head coordinate"));
    }
    let head = rows.pop();
    if let Some(head) = &head {
        if head.event.kind != Kind::Custom(kind as u16)
            || head.event.verify().is_err()
            || head.event.tags.len() != 1
            || !head
                .event
                .tags
                .iter()
                .any(|tag| tag.kind().to_string() == "d" && tag.content() == Some(d_tag))
        {
            return Err(internal(
                "stored AI spend head signature or tags are invalid",
            ));
        }
        match kind {
            KIND_EMPLOYEE_AI_ALLOWANCE_HEAD => {
                let parsed = serde_json::from_str::<EmployeeAllowanceHead>(&head.event.content)
                    .map_err(|_| internal("stored employee allowance head is invalid"))?;
                validate_employee_allowance_head(&parsed)
                    .map_err(|error| internal(format!("stored allowance head: {error}")))?;
                if employee_allowance_d_tag(&parsed.employee_pubkey)
                    .ok()
                    .as_deref()
                    != Some(d_tag)
                {
                    return Err(internal("stored allowance head coordinate does not match"));
                }
            }
            KIND_AI_SPEND_RECORD_HEAD => {
                let parsed = parse_spend_head(head)?;
                if ai_spend_record_d_tag(&parsed.record_id).ok().as_deref() != Some(d_tag) {
                    return Err(internal("stored AI spend record coordinate does not match"));
                }
            }
            _ => return Err(internal("unexpected AI spend head kind")),
        }
    }
    Ok(head)
}

fn parse_spend_head(stored: &StoredEvent) -> Result<AiSpendRecordHead, IngestError> {
    let head = serde_json::from_str::<AiSpendRecordHead>(&stored.event.content)
        .map_err(|_| internal("stored AI spend record head is invalid"))?;
    validate_ai_spend_record_head(&head)
        .map_err(|error| internal(format!("stored AI spend record head: {error}")))?;
    Ok(head)
}

fn validate_member_action(
    event: &Event,
    auth: &IngestAuth,
    expected_kind: u32,
) -> Result<(), IngestError> {
    if u32::from(event.kind.as_u16()) != expected_kind {
        return Err(invalid("AI spend action has the wrong event kind"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match authenticated member",
        ));
    }
    if event.verify().is_err() {
        return Err(invalid("AI spend action signature is invalid"));
    }
    Ok(())
}

fn ensure_unscoped_auth(auth: &IngestAuth) -> Result<(), IngestError> {
    if auth.channel_ids().is_some() {
        Err(forbidden(
            "channel-scoped authentication cannot write company AI spend",
        ))
    } else {
        Ok(())
    }
}

fn validate_tags(
    event: &Event,
    expected_d_tag: &str,
    employee_pubkey: Option<&str>,
) -> Result<(), IngestError> {
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
    let expected_tag_count = if employee_pubkey.is_some() { 2 } else { 1 };
    if event.tags.len() != expected_tag_count
        || d_tags.len() != 1
        || d_tags[0].content() != Some(expected_d_tag)
        || p_tags.len() != usize::from(employee_pubkey.is_some())
        || employee_pubkey.is_some_and(|pubkey| p_tags[0].content() != Some(pubkey))
    {
        return Err(invalid(
            "AI spend action has invalid d-tag or employee p-tag",
        ));
    }
    Ok(())
}

fn check_expected_head(
    expected_head_event_id: Option<&str>,
    current: Option<&Event>,
) -> Result<(), IngestError> {
    let actual = current.map(|event| event.id.to_hex());
    match (expected_head_event_id, actual.as_deref()) {
        (None, None) => Ok(()),
        (Some(expected), Some(actual)) if expected == actual => Ok(()),
        (Some(_), Some(actual)) => Err(conflict(format!(
            "AI spend record changed; current head is {actual}"
        ))),
        (Some(_), None) => Err(conflict("AI spend record does not exist")),
        (None, Some(_)) => Err(conflict("AI spend record already exists")),
    }
}

fn check_expected_head_bytes(
    expected_head_event_id: Option<&str>,
    current_head_id: Option<&[u8]>,
) -> Result<(), IngestError> {
    match (expected_head_event_id, current_head_id) {
        (None, None) => Ok(()),
        (Some(expected), Some(actual)) if expected == hex::encode(actual) => Ok(()),
        (Some(_), Some(actual)) => Err(conflict(format!(
            "AI spend record changed; current head is {}",
            hex::encode(actual)
        ))),
        (Some(_), None) => Err(conflict("AI spend record does not exist")),
        (None, Some(_)) => Err(conflict("AI spend record already exists")),
    }
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

#[allow(dead_code)]
fn _action_kind_guard(action: &AiSpendRecordAction) -> bool {
    action.action == SpendRecordActionKind::Record
}
