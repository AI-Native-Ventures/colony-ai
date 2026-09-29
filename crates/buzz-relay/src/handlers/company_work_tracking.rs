//! Brokered commitment suggestion and watchdog configuration records.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::Event;
use uuid::Uuid;

use buzz_core::business_records::{
    company_work_d_tag, CompanyWorkItemAction, CompanyWorkItemActionKind, CompanyWorkItemHead,
    CompanyWorkStatus, BUSINESS_RECORD_SCHEMA_VERSION,
};
use buzz_core::company_work_tracking::{
    company_work_watchdog_d_tag, validate_company_work_tracking_action,
    validate_company_work_tracking_d_tag, CompanyWorkSuggestionHead, CompanyWorkSuggestionStatus,
    CompanyWorkTrackingAction, CompanyWorkTrackingActionKind, CompanyWorkTrackingHead,
    CompanyWorkTrackingRecordType, CompanyWorkWatchdogHead,
};
use buzz_core::kind::*;
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use crate::state::AppState;

use super::business_records as broker;
use super::ingest::{IngestAuth, IngestError, IngestResult};

/// Validate and persist one member-signed work tracking command.
pub async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let (channel_id, d_tag) = broker::command_coordinates(&event)?;
    let action: CompanyWorkTrackingAction = serde_json::from_str(&event.content)
        .map_err(|_| broker::invalid("company work tracking action is malformed"))?;
    validate_company_work_tracking_action(&action)
        .map_err(|error| broker::invalid(format!("company work tracking action: {error}")))?;

    let record_type = record_type_for_action(action.action);
    validate_company_work_tracking_d_tag(&d_tag, action.record_id, record_type)
        .map_err(|error| broker::invalid(format!("company work tracking d tag: {error}")))?;
    broker::require_token_channel_scope(&auth, channel_id)?;
    broker::get_company_work_stream_channel(state, tenant.community(), channel_id).await?;

    if action.action == CompanyWorkTrackingActionKind::Propose {
        validate_suggestion_source(
            tenant.community(),
            state,
            channel_id,
            action.suggestion.as_ref(),
        )
        .await?;
    }

    let actor = auth.pubkey().to_hex();
    let actor_bytes = auth.pubkey().to_bytes().to_vec();
    let community = tenant.community();
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(broker::internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;

    let relay_role = sqlx::query_scalar::<_, String>(
        "SELECT role::text FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community.as_uuid())
    .bind(&actor)
    .fetch_optional(&mut *tx)
    .await
    .map_err(broker::internal)?;
    let is_admin = relay_role
        .as_deref()
        .is_some_and(broker::is_community_admin);
    let channel_member =
        channel_member_in_transaction(&mut tx, community, channel_id, actor_bytes.as_slice())
            .await?;
    let human_actor = !is_managed_agent(state, community, auth.pubkey()).await?;

    match action.action {
        CompanyWorkTrackingActionKind::Propose => {
            if !channel_member {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::forbidden(
                    "a suggestion must be proposed by a member of its source channel",
                ));
            }
        }
        CompanyWorkTrackingActionKind::Accept => {
            if !human_actor || (!is_admin && !channel_member) {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::forbidden(
                    "only a human channel member or community owner or admin can accept a suggestion",
                ));
            }
        }
        CompanyWorkTrackingActionKind::Dismiss | CompanyWorkTrackingActionKind::Expire => {
            if !human_actor || (!is_admin && !channel_member) {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::forbidden(
                    "only a human channel member or community owner or admin can resolve a suggestion",
                ));
            }
        }
        CompanyWorkTrackingActionKind::Configure | CompanyWorkTrackingActionKind::Disable => {
            if !human_actor {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::forbidden(
                    "managed agents cannot configure watchdog settings",
                ));
            }
        }
    }

    let watchdog_work = if matches!(
        action.action,
        CompanyWorkTrackingActionKind::Configure | CompanyWorkTrackingActionKind::Disable
    ) {
        Some(
            authorize_watchdog_change(tenant, state, &mut tx, channel_id, action.record_id, &actor)
                .await?,
        )
    } else {
        None
    };
    if action.action == CompanyWorkTrackingActionKind::Configure {
        let config = action
            .config
            .as_ref()
            .ok_or_else(|| broker::invalid("watchdog config is required"))?;
        for recipient in [
            config.ask_first_pubkey.as_deref(),
            config.escalate_to_pubkey.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            let recipient = nostr::PublicKey::from_hex(recipient)
                .map_err(|_| broker::invalid("watchdog recipient must be a member public key"))?;
            broker::require_company_work_channel_membership(
                &mut tx,
                community,
                channel_id,
                &recipient.to_bytes(),
            )
            .await?;
        }
    }

    let already_stored = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community.as_uuid())
    .bind(event.id.as_bytes().as_slice())
    .fetch_one(&mut *tx)
    .await
    .map_err(broker::internal)?;
    if already_stored {
        tx.rollback().await.map_err(broker::internal)?;
        return Ok(IngestResult {
            event_id: event.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
    }

    let relay_pubkey = state.relay_keypair.public_key().to_bytes();
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community,
        KIND_COMPANY_WORK_TRACKING_HEAD,
        &relay_pubkey,
        &d_tag,
    )
    .await
    .map_err(broker::internal)?;
    match (
        action.action,
        action.expected_head_event_id.as_deref(),
        current_head_id.as_deref(),
    ) {
        (CompanyWorkTrackingActionKind::Propose, None, None) => {}
        (CompanyWorkTrackingActionKind::Configure, None, None) => {}
        (CompanyWorkTrackingActionKind::Propose, _, Some(_)) => {
            tx.rollback().await.map_err(broker::internal)?;
            return Err(broker::conflict("commitment suggestion already exists"));
        }
        (CompanyWorkTrackingActionKind::Propose, _, None) => {}
        (_, Some(expected), Some(actual)) if expected == hex::encode(actual) => {}
        (_, Some(_), Some(_)) => {
            tx.rollback().await.map_err(broker::internal)?;
            return Err(broker::conflict(
                "company work tracking record changed; retry from its current head",
            ));
        }
        (_, _, None) => {
            tx.rollback().await.map_err(broker::internal)?;
            return Err(broker::conflict(
                "company work tracking record does not exist",
            ));
        }
        _ => {
            tx.rollback().await.map_err(broker::internal)?;
            return Err(broker::invalid("expectedHeadEventId is invalid"));
        }
    }

    let previous_stored = current_head::<CompanyWorkTrackingHead>(
        state,
        community,
        KIND_COMPANY_WORK_TRACKING_HEAD,
        &d_tag,
    )
    .await?;
    if previous_stored
        .as_ref()
        .map(|stored| stored.event.id.as_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(broker::internal)?;
        return Err(IngestError::Internal(
            "error: work tracking head changed while its transaction lock was held".into(),
        ));
    }
    if previous_stored
        .as_ref()
        .is_some_and(|stored| stored.channel_id != Some(channel_id))
    {
        tx.rollback().await.map_err(broker::internal)?;
        return Err(broker::conflict(
            "work tracking record belongs to another channel",
        ));
    }
    let previous = previous_stored
        .as_ref()
        .map(|stored| {
            serde_json::from_str::<CompanyWorkTrackingHead>(&stored.event.content).map_err(|_| {
                IngestError::Internal("error: stored work tracking head is invalid".into())
            })
        })
        .transpose()?;
    ensure_record_type(previous.as_ref(), record_type)?;

    let mut created_work_head: Option<Event> = None;
    let next_head = match action.action {
        CompanyWorkTrackingActionKind::Propose => {
            let input = action
                .suggestion
                .as_ref()
                .ok_or_else(|| broker::invalid("suggestion is required"))?;
            let source =
                validate_suggestion_source(community, state, channel_id, Some(input)).await?;
            if input
                .expires_at
                .as_deref()
                .is_some_and(|expires_at| parse_utc(expires_at).is_ok_and(|at| at <= Utc::now()))
            {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::invalid("expiresAt must be later than the proposal"));
            }
            let mut work_item = input.work_item.clone();
            work_item.source_event_id = Some(source.source_event_id.clone());
            work_item.thread_root_event_id = Some(source.thread_root_event_id.clone());
            broker::ensure_company_work_people_are_members(
                &mut tx,
                community,
                channel_id,
                &work_item.requester_pubkey,
                &work_item.assigned_pubkeys,
            )
            .await?;
            CompanyWorkTrackingHead::CommitmentSuggestion(CompanyWorkSuggestionHead {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                suggestion_id: action.record_id,
                source_event_id: source.source_event_id,
                source_channel_id: channel_id,
                proposed_by_pubkey: actor.clone(),
                expires_at: input.expires_at.clone(),
                work_item,
                status: CompanyWorkSuggestionStatus::Pending,
                accepted_work_item_id: None,
                source_action_event_id: event.id.to_hex(),
            })
        }
        CompanyWorkTrackingActionKind::Accept => {
            let Some(CompanyWorkTrackingHead::CommitmentSuggestion(previous)) = previous.as_ref()
            else {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::conflict("commitment suggestion is not pending"));
            };
            if previous.status != CompanyWorkSuggestionStatus::Pending {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::conflict("commitment suggestion is not pending"));
            }
            if previous
                .expires_at
                .as_deref()
                .is_some_and(|expires_at| parse_utc(expires_at).is_ok_and(|at| at <= Utc::now()))
            {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::conflict("commitment suggestion has expired"));
            }
            let work_item_id = action
                .accepted_work_item_id
                .ok_or_else(|| broker::invalid("acceptedWorkItemId is required"))?;
            let mut input = previous.work_item.clone();
            input.work_item_id = work_item_id;
            input.source_event_id = Some(previous.source_event_id.clone());
            let source =
                get_source_root(community, state, channel_id, &previous.source_event_id).await?;
            input.thread_root_event_id = Some(source.thread_root_event_id);
            let create_action = CompanyWorkItemAction {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                work_item_id,
                action: CompanyWorkItemActionKind::Create,
                expected_head_event_id: None,
                head: Some(input.clone()),
                status: None,
                reason: None,
                verification: None,
                due_at: None,
            };
            buzz_core::business_records::validate_company_work_item_action(&create_action)
                .map_err(|error| broker::invalid(format!("accepted work item: {error}")))?;
            broker::ensure_company_work_people_are_members(
                &mut tx,
                community,
                channel_id,
                &input.requester_pubkey,
                &input.assigned_pubkeys,
            )
            .await?;
            let work_d_tag = company_work_d_tag(work_item_id);
            let work_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
                &mut tx,
                community,
                KIND_WORK_ITEM_HEAD,
                &relay_pubkey,
                &work_d_tag,
            )
            .await
            .map_err(broker::internal)?;
            if work_head_id.is_some() {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::conflict("accepted work item id already exists"));
            }
            let accepted_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
            if let Some(due_at) = input.due_at.as_deref() {
                validate_due_at_after_acceptance(due_at, &accepted_at)?;
            }
            let work_head = CompanyWorkItemHead {
                schema_version: input.schema_version,
                work_item_id,
                title: input.title,
                status: CompanyWorkStatus::Active,
                assigned_pubkeys: input.assigned_pubkeys,
                approver_pubkeys: input.approver_pubkeys,
                deliverables: input.deliverables,
                requester_pubkey: input.requester_pubkey,
                done_condition: input.done_condition,
                goal_id: input.goal_id,
                source_event_id: input.source_event_id,
                thread_root_event_id: input.thread_root_event_id,
                evidence: input.evidence,
                status_reason: None,
                verification: None,
                accepted_at: Some(accepted_at),
                due_at: input.due_at,
                source_action_event_id: event.id.to_hex(),
            };
            created_work_head = Some(broker::relay_head_event(
                KIND_WORK_ITEM_HEAD,
                channel_id,
                &work_d_tag,
                &work_head,
                None,
                state,
            )?);
            let mut next = previous.clone();
            next.status = CompanyWorkSuggestionStatus::Accepted;
            next.accepted_work_item_id = Some(work_item_id);
            next.source_action_event_id = event.id.to_hex();
            CompanyWorkTrackingHead::CommitmentSuggestion(next)
        }
        CompanyWorkTrackingActionKind::Dismiss | CompanyWorkTrackingActionKind::Expire => {
            let Some(CompanyWorkTrackingHead::CommitmentSuggestion(previous)) = previous.as_ref()
            else {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::conflict("commitment suggestion is not pending"));
            };
            if previous.status != CompanyWorkSuggestionStatus::Pending {
                tx.rollback().await.map_err(broker::internal)?;
                return Err(broker::conflict("commitment suggestion is not pending"));
            }
            let status = if action.action == CompanyWorkTrackingActionKind::Dismiss {
                CompanyWorkSuggestionStatus::Dismissed
            } else {
                let Some(expires_at) = previous.expires_at.as_deref() else {
                    tx.rollback().await.map_err(broker::internal)?;
                    return Err(broker::conflict("suggestion has no explicit expiry"));
                };
                if parse_utc(expires_at).map_err(broker::invalid)? > Utc::now() {
                    tx.rollback().await.map_err(broker::internal)?;
                    return Err(broker::conflict(
                        "suggestion cannot expire before expiresAt",
                    ));
                }
                CompanyWorkSuggestionStatus::Expired
            };
            let mut next = previous.clone();
            next.status = status;
            next.source_action_event_id = event.id.to_hex();
            CompanyWorkTrackingHead::CommitmentSuggestion(next)
        }
        CompanyWorkTrackingActionKind::Configure | CompanyWorkTrackingActionKind::Disable => {
            let previous = match previous.as_ref() {
                Some(CompanyWorkTrackingHead::WatchdogConfiguration(head)) => Some(head),
                None => None,
                _ => {
                    tx.rollback().await.map_err(broker::internal)?;
                    return Err(broker::conflict(
                        "tracking record is not a watchdog configuration",
                    ));
                }
            };
            let (enabled, config) = if action.action == CompanyWorkTrackingActionKind::Configure {
                (true, action.config.clone())
            } else {
                (false, previous.and_then(|head| head.config.clone()))
            };
            CompanyWorkTrackingHead::WatchdogConfiguration(CompanyWorkWatchdogHead {
                schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
                work_item_id: action.record_id,
                enabled,
                config,
                source_action_event_id: event.id.to_hex(),
            })
        }
    };

    let next_event = broker::relay_head_event(
        KIND_COMPANY_WORK_TRACKING_HEAD,
        channel_id,
        &d_tag,
        &next_head,
        previous_stored.as_ref(),
        state,
    )?;
    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community, &event, None)
            .await
            .map_err(broker::internal)?;
    if !inserted {
        tx.rollback().await.map_err(broker::internal)?;
        return Ok(IngestResult {
            event_id: event.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
    }
    if let Some(work_head) = created_work_head.as_ref() {
        let replaced_work = state
            .db
            .replace_parameterized_event_in_transaction(
                &mut tx,
                community,
                work_head,
                &company_work_d_tag(
                    action
                        .accepted_work_item_id
                        .ok_or_else(|| broker::invalid("acceptedWorkItemId is required"))?,
                ),
                Some(channel_id),
                ParameterizedReplacePrecondition::CreateOnly,
            )
            .await
            .map_err(broker::internal)?;
        if replaced_work.status != ParameterizedReplaceStatus::Inserted {
            tx.rollback().await.map_err(broker::internal)?;
            return Err(broker::conflict("accepted work item id already exists"));
        }
    }
    let precondition = current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community,
            &next_event,
            &d_tag,
            Some(channel_id),
            precondition,
        )
        .await
        .map_err(broker::internal)?;
    if !matches!(replaced.status, ParameterizedReplaceStatus::Inserted) {
        tx.rollback().await.map_err(broker::internal)?;
        return Err(broker::conflict("company work tracking head changed"));
    }
    if let Some(work) = watchdog_work.as_ref() {
        buzz_db::company_work_watchdog::cancel_in_transaction(&mut tx, community, action.record_id)
            .await
            .map_err(broker::internal)?;
        if let CompanyWorkTrackingHead::WatchdogConfiguration(config_head) = &next_head {
            if config_head.enabled {
                let config = config_head
                    .config
                    .as_ref()
                    .ok_or_else(|| broker::invalid("enabled watchdog config is missing"))?;
                let root_hex = work.thread_root_event_id.as_deref().ok_or_else(|| {
                    broker::conflict("watchdog check-ins require a work item thread")
                })?;
                let root_id = hex::decode(root_hex)
                    .map_err(|_| broker::invalid("work thread root is invalid"))?;
                let scheduled_for = Utc::now()
                    + chrono::Duration::seconds(i64::from(config.check_interval_seconds));
                buzz_db::company_work_watchdog::schedule_in_transaction(
                    &mut tx,
                    community,
                    action.record_id,
                    next_event.id.as_bytes(),
                    channel_id,
                    &root_id,
                    scheduled_for,
                )
                .await
                .map_err(broker::internal)?;
            }
        }
    }
    tx.commit().await.map_err(broker::internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_COMPANY_WORK_TRACKING_ACTION,
        &actor,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_COMPANY_WORK_TRACKING_HEAD,
        &next_event.pubkey.to_hex(),
        None,
    )
    .await;
    if let Some(work_head) = created_work_head.as_ref() {
        if let Ok(Some(stored)) = state
            .db
            .get_event_by_id_for_event_write(community, work_head.id.as_bytes())
            .await
        {
            super::event::dispatch_persistent_event(
                tenant,
                state,
                &stored,
                KIND_WORK_ITEM_HEAD,
                &work_head.pubkey.to_hex(),
                None,
            )
            .await;
        }
    }
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

/// Keep the watchdog head and delivery schedule aligned with a work-head move or status change.
pub(super) async fn sync_watchdog_for_work_change(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: CommunityId,
    previous_channel_id: Uuid,
    next_channel_id: Uuid,
    work: &CompanyWorkItemHead,
    state: &AppState,
) -> Result<Option<StoredEvent>, IngestError> {
    let d_tag = company_work_watchdog_d_tag(work.work_item_id);
    let relay_pubkey = state.relay_keypair.public_key().to_bytes();
    let locked_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community,
        KIND_COMPANY_WORK_TRACKING_HEAD,
        &relay_pubkey,
        &d_tag,
    )
    .await
    .map_err(broker::internal)?;
    let Some(locked_head_id) = locked_head_id else {
        buzz_db::company_work_watchdog::cancel_in_transaction(tx, community, work.work_item_id)
            .await
            .map_err(broker::internal)?;
        return Ok(None);
    };
    let current_stored = broker::current_head::<CompanyWorkTrackingHead>(
        state,
        community,
        KIND_COMPANY_WORK_TRACKING_HEAD,
        &d_tag,
    )
    .await?
    .ok_or_else(|| IngestError::Internal("error: locked watchdog head disappeared".into()))?;
    if current_stored.event.id.as_bytes() != locked_head_id.as_slice() {
        return Err(IngestError::Internal(
            "error: watchdog head changed while its transaction lock was held".into(),
        ));
    }
    if current_stored.channel_id != Some(previous_channel_id) {
        return Err(broker::conflict(
            "watchdog head does not match the work item's previous channel",
        ));
    }
    let CompanyWorkTrackingHead::WatchdogConfiguration(mut watchdog) =
        serde_json::from_str(&current_stored.event.content)
            .map_err(|_| IngestError::Internal("error: stored watchdog head is invalid".into()))?
    else {
        return Err(IngestError::Internal(
            "error: watchdog d tag contains a suggestion head".into(),
        ));
    };
    if watchdog.work_item_id != work.work_item_id {
        return Err(IngestError::Internal(
            "error: watchdog head does not match its d tag".into(),
        ));
    }

    let terminal_work = matches!(
        work.status,
        CompanyWorkStatus::Paused
            | CompanyWorkStatus::Archived
            | CompanyWorkStatus::DoneUnverified
            | CompanyWorkStatus::DoneVerified
    );
    let relocated_head = if previous_channel_id != next_channel_id {
        watchdog.source_action_event_id = work.source_action_event_id.clone();
        let next = CompanyWorkTrackingHead::WatchdogConfiguration(watchdog.clone());
        let next_event = broker::relay_head_event(
            KIND_COMPANY_WORK_TRACKING_HEAD,
            next_channel_id,
            &d_tag,
            &next,
            Some(&current_stored),
            state,
        )?;
        let replaced = state
            .db
            .replace_parameterized_event_in_transaction(
                tx,
                community,
                &next_event,
                &d_tag,
                Some(next_channel_id),
                ParameterizedReplacePrecondition::ExpectedRevision,
            )
            .await
            .map_err(broker::internal)?;
        if replaced.status != ParameterizedReplaceStatus::Inserted {
            return Err(broker::conflict("watchdog head changed while moving work"));
        }
        Some(replaced.event)
    } else {
        None
    };

    buzz_db::company_work_watchdog::cancel_in_transaction(tx, community, work.work_item_id)
        .await
        .map_err(broker::internal)?;
    if watchdog.enabled && !terminal_work {
        let config = watchdog
            .config
            .as_ref()
            .ok_or_else(|| broker::invalid("enabled watchdog config is missing"))?;
        if config.check_interval_seconds == 0 {
            return Err(broker::invalid(
                "enabled watchdog has no explicit positive interval",
            ));
        }
        let root_hex = work
            .thread_root_event_id
            .as_deref()
            .ok_or_else(|| broker::conflict("watchdog check-ins require a work item thread"))?;
        let root_id =
            hex::decode(root_hex).map_err(|_| broker::invalid("work thread root is invalid"))?;
        let config_event_id = if let Some(head) = relocated_head.as_ref() {
            head.event.id.as_bytes()
        } else {
            current_stored.event.id.as_bytes()
        };
        let scheduled_for =
            Utc::now() + chrono::Duration::seconds(i64::from(config.check_interval_seconds));
        buzz_db::company_work_watchdog::schedule_in_transaction(
            tx,
            community,
            work.work_item_id,
            config_event_id,
            next_channel_id,
            &root_id,
            scheduled_for,
        )
        .await
        .map_err(broker::internal)?;
    }
    Ok(relocated_head)
}

struct SuggestionSource {
    source_event_id: String,
    thread_root_event_id: String,
}

async fn validate_suggestion_source(
    community: CommunityId,
    state: &AppState,
    channel_id: Uuid,
    suggestion: Option<&buzz_core::company_work_tracking::CompanyWorkSuggestionInput>,
) -> Result<SuggestionSource, IngestError> {
    let suggestion = suggestion.ok_or_else(|| broker::invalid("suggestion is required"))?;
    let source = get_source_root(community, state, channel_id, &suggestion.source_event_id).await?;
    if suggestion
        .work_item
        .source_event_id
        .as_deref()
        .is_some_and(|source_event_id| source_event_id != source.source_event_id)
        || suggestion
            .work_item
            .thread_root_event_id
            .as_deref()
            .is_some_and(|thread_root_event_id| thread_root_event_id != source.thread_root_event_id)
    {
        return Err(broker::invalid(
            "suggestion work provenance must match its source message and thread",
        ));
    }
    Ok(source)
}

async fn get_source_root(
    community: CommunityId,
    state: &AppState,
    channel_id: Uuid,
    source_event_id: &str,
) -> Result<SuggestionSource, IngestError> {
    let source_id =
        hex::decode(source_event_id).map_err(|_| broker::invalid("sourceEventId is invalid"))?;
    let source = state
        .db
        .get_event_by_id_for_event_write(community, &source_id)
        .await
        .map_err(broker::internal)?
        .ok_or_else(|| broker::invalid("source message does not exist in this community"))?;
    if source.channel_id != Some(channel_id)
        || !matches!(
            source.event.kind.as_u16() as u32,
            KIND_STREAM_MESSAGE | KIND_STREAM_MESSAGE_V2
        )
    {
        return Err(broker::invalid(
            "source message must be a stream message in the suggestion channel",
        ));
    }
    let metadata = state
        .db
        .get_thread_metadata_by_event(community, &source_id)
        .await
        .map_err(broker::internal)?;
    let root_id = metadata
        .and_then(|metadata| metadata.root_event_id)
        .or_else(|| {
            buzz_core::nip10::parse_thread_markers(&source.event.tags)
                .resolve()
                .and_then(|(root, _)| hex::decode(root).ok())
        })
        .unwrap_or_else(|| source.event.id.as_bytes().to_vec());
    let root = state
        .db
        .get_event_by_id_for_event_write(community, &root_id)
        .await
        .map_err(broker::internal)?
        .ok_or_else(|| broker::invalid("source thread root does not exist"))?;
    if root.channel_id != Some(channel_id)
        || !matches!(
            root.event.kind.as_u16() as u32,
            KIND_STREAM_MESSAGE | KIND_STREAM_MESSAGE_V2
        )
        || buzz_core::nip10::parse_thread_markers(&root.event.tags)
            .resolve()
            .is_some()
    {
        return Err(broker::invalid(
            "source thread root must be a root message in the same channel",
        ));
    }
    Ok(SuggestionSource {
        source_event_id: source.event.id.to_hex(),
        thread_root_event_id: root.event.id.to_hex(),
    })
}

async fn channel_member_in_transaction(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    community: CommunityId,
    channel_id: Uuid,
    actor_pubkey: &[u8],
) -> Result<bool, IngestError> {
    sqlx::query_scalar::<_, String>(
        "SELECT cm.role::text FROM channel_members cm \
         JOIN channels c ON cm.community_id = c.community_id AND cm.channel_id = c.id \
         WHERE cm.community_id = $1 AND cm.channel_id = $2 AND cm.pubkey = $3 \
           AND cm.removed_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL \
         FOR UPDATE OF cm, c",
    )
    .bind(community.as_uuid())
    .bind(channel_id)
    .bind(actor_pubkey)
    .fetch_optional(&mut **tx)
    .await
    .map(|role| role.is_some())
    .map_err(broker::internal)
}

async fn is_managed_agent(
    state: &AppState,
    community: CommunityId,
    pubkey: &nostr::PublicKey,
) -> Result<bool, IngestError> {
    let identity = state
        .db
        .get_agent_channel_policy(community, &pubkey.to_bytes())
        .await
        .map_err(broker::internal)?;
    Ok(identity.is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some()))
}

async fn authorize_watchdog_change(
    tenant: &TenantContext,
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    channel_id: Uuid,
    work_item_id: Uuid,
    actor: &str,
) -> Result<CompanyWorkItemHead, IngestError> {
    let work_d_tag = company_work_d_tag(work_item_id);
    let locked_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        tenant.community(),
        KIND_WORK_ITEM_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &work_d_tag,
    )
    .await
    .map_err(broker::internal)?
    .ok_or_else(|| broker::conflict("company work item does not exist"))?;
    let head = current_head::<CompanyWorkItemHead>(
        state,
        tenant.community(),
        KIND_WORK_ITEM_HEAD,
        &work_d_tag,
    )
    .await?
    .ok_or_else(|| broker::conflict("company work item does not exist"))?;
    if head.channel_id != Some(channel_id) {
        return Err(broker::conflict(
            "watchdog must use the work item's current channel",
        ));
    }
    let work: CompanyWorkItemHead = serde_json::from_str(&head.event.content)
        .map_err(|_| IngestError::Internal("error: stored company work head is invalid".into()))?;
    if head.event.id.as_bytes() != locked_head_id.as_slice() {
        return Err(IngestError::Internal(
            "error: company work head changed while its transaction lock was held".into(),
        ));
    }
    if matches!(
        work.status,
        CompanyWorkStatus::Archived
            | CompanyWorkStatus::DoneUnverified
            | CompanyWorkStatus::DoneVerified
    ) {
        return Err(broker::conflict(
            "completed or archived work cannot enable a watchdog",
        ));
    }
    let community_role = sqlx::query_scalar::<_, String>(
        "SELECT role::text FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(tenant.community().as_uuid())
    .bind(actor)
    .fetch_optional(&mut **tx)
    .await
    .map_err(broker::internal)?;
    let is_admin = community_role
        .as_deref()
        .is_some_and(broker::is_community_admin);
    let is_owner = work.assigned_pubkeys.iter().any(|owner| owner == actor);
    let is_requester = work.requester_pubkey == actor;
    if !is_admin && !is_owner && !is_requester {
        return Err(broker::forbidden(
            "only the work owner, requester, or a community owner or admin can configure its watchdog",
        ));
    }
    Ok(work)
}

fn record_type_for_action(action: CompanyWorkTrackingActionKind) -> CompanyWorkTrackingRecordType {
    match action {
        CompanyWorkTrackingActionKind::Propose
        | CompanyWorkTrackingActionKind::Accept
        | CompanyWorkTrackingActionKind::Dismiss
        | CompanyWorkTrackingActionKind::Expire => {
            CompanyWorkTrackingRecordType::CommitmentSuggestion
        }
        CompanyWorkTrackingActionKind::Configure | CompanyWorkTrackingActionKind::Disable => {
            CompanyWorkTrackingRecordType::WatchdogConfiguration
        }
    }
}

fn ensure_record_type(
    head: Option<&CompanyWorkTrackingHead>,
    expected: CompanyWorkTrackingRecordType,
) -> Result<(), IngestError> {
    let matches = matches!(
        (head, expected),
        (
            Some(CompanyWorkTrackingHead::CommitmentSuggestion(_)),
            CompanyWorkTrackingRecordType::CommitmentSuggestion
        ) | (
            Some(CompanyWorkTrackingHead::WatchdogConfiguration(_)),
            CompanyWorkTrackingRecordType::WatchdogConfiguration
        )
    );
    if head.is_some() && !matches {
        return Err(broker::conflict(
            "tracking record type does not match its d tag",
        ));
    }
    Ok(())
}

async fn current_head<T: serde::de::DeserializeOwned>(
    state: &AppState,
    community: CommunityId,
    kind: u32,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    broker::current_head::<T>(state, community, kind, d_tag).await
}

fn parse_utc(value: &str) -> Result<chrono::DateTime<chrono::FixedOffset>, &'static str> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map_err(|_| "timestamp must be valid RFC 3339 UTC ending in Z")
}

fn validate_due_at_after_acceptance(due_at: &str, accepted_at: &str) -> Result<(), IngestError> {
    buzz_core::business_records::validate_utc_rfc3339(due_at)
        .map_err(|error| broker::invalid(format!("dueAt: {error}")))?;
    if parse_utc(due_at).map_err(broker::invalid)?
        <= parse_utc(accepted_at).map_err(broker::internal)?
    {
        return Err(broker::invalid("dueAt must be later than acceptance"));
    }
    Ok(())
}
