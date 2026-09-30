//! Broker for structured employee lessons and explicit evidence assessments.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::{Event, EventBuilder, Kind, Tag};

use buzz_core::company_lessons::{
    validate_lesson_action, validate_lesson_d_tag, validate_lesson_head, LessonAction,
    LessonActionKind, LessonApproval, LessonConfidence, LessonHead, LessonSnapshot, LessonStatus,
};
use buzz_core::company_members::MemberKind;
use buzz_core::company_records::{
    parse_company_command, CompanyCommand, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_LESSON_ACTION, KIND_LESSON_HEAD};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles a member or managed employee's lesson lifecycle action (kind 47045).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::LessonAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_lesson_action(&action).map_err(|error| invalid(format!("lesson action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_LESSON_ACTION {
        return Err(invalid("lesson action has the wrong event kind"));
    }
    if event.verify().is_err() {
        return Err(invalid("lesson action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write employee lessons",
        ));
    }
    let d_tag = command_d_tag(&event, &action)?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let managed_agent = state
        .db
        .get_agent_channel_policy(community_id, &auth.pubkey().to_bytes())
        .await
        .map_err(internal)?
        .is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some());

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
    let actor_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&actor_pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    if actor_role.is_none() && !managed_agent {
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden("actor is not a member or managed employee"));
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
            "company-lesson:{}:{}",
            community_id.as_uuid(),
            action.lesson_id
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_LESSON_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_lesson_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(internal(
            "lesson head changed while its transaction lock was held",
        ));
    }
    let current = current_stored.as_ref().map(parse_lesson_head).transpose()?;
    if current.as_ref().is_some_and(|head| {
        head.lesson_id != action.lesson_id || head.snapshot.lesson_id != action.lesson_id
    }) {
        tx.rollback().await.map_err(internal)?;
        return Err(internal("stored lesson head does not match its d-tag"));
    }
    let command_employee = event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "p")
        .and_then(|tag| tag.content())
        .ok_or_else(|| invalid("lesson command p tag must name its employee"))?;
    let expected_employee = action
        .snapshot
        .as_ref()
        .map(|snapshot| snapshot.employee_pubkey.as_str())
        .or_else(|| {
            current
                .as_ref()
                .map(|head| head.snapshot.employee_pubkey.as_str())
        })
        .ok_or_else(|| invalid("lesson action has no employee"))?;
    if command_employee != expected_employee {
        tx.rollback().await.map_err(internal)?;
        return Err(invalid("lesson command p tag must match its employee"));
    }
    check_expected_head(&action, current_head_id.as_deref())?;

    let employee_pubkey = match action.action {
        LessonActionKind::Create => {
            let snapshot = action
                .snapshot
                .as_ref()
                .ok_or_else(|| invalid("create needs a snapshot"))?;
            snapshot.employee_pubkey.clone()
        }
        LessonActionKind::Update => {
            let current = current
                .as_ref()
                .ok_or_else(|| conflict("lesson does not exist"))?;
            let snapshot = action
                .snapshot
                .as_ref()
                .ok_or_else(|| invalid("update needs a snapshot"))?;
            if current.status == LessonStatus::Deprecated {
                tx.rollback().await.map_err(internal)?;
                return Err(conflict("a deprecated lesson cannot be edited"));
            }
            if snapshot.employee_pubkey != current.snapshot.employee_pubkey {
                tx.rollback().await.map_err(internal)?;
                return Err(invalid("lesson owner cannot be changed"));
            }
            let actor_is_admin = actor_role.as_deref().is_some_and(is_admin);
            if current.proposed_by_pubkey != actor_pubkey && !actor_is_admin {
                tx.rollback().await.map_err(internal)?;
                return Err(forbidden(
                    "only the proposer or an owner or admin can edit this lesson",
                ));
            }
            snapshot.employee_pubkey.clone()
        }
        LessonActionKind::Approve => {
            let current = current
                .as_ref()
                .ok_or_else(|| conflict("lesson does not exist"))?;
            let actor_is_admin = actor_role.as_deref().is_some_and(is_admin);
            if !actor_is_admin {
                tx.rollback().await.map_err(internal)?;
                return Err(forbidden(
                    "only a community owner or admin can approve lessons",
                ));
            }
            if current.status != LessonStatus::Candidate {
                tx.rollback().await.map_err(internal)?;
                return Err(conflict("only a candidate lesson can be approved"));
            }
            if action.confidence == Some(LessonConfidence::Unassessed) {
                tx.rollback().await.map_err(internal)?;
                return Err(invalid("approval needs an assessed confidence"));
            }
            current.snapshot.employee_pubkey.clone()
        }
        LessonActionKind::Deprecate => {
            let current = current
                .as_ref()
                .ok_or_else(|| conflict("lesson does not exist"))?;
            let actor_is_admin = actor_role.as_deref().is_some_and(is_admin);
            if !actor_is_admin {
                tx.rollback().await.map_err(internal)?;
                return Err(forbidden(
                    "only a community owner or admin can deprecate lessons",
                ));
            }
            if current.status == LessonStatus::Deprecated {
                tx.rollback().await.map_err(internal)?;
                return Err(conflict("lesson is already deprecated"));
            }
            current.snapshot.employee_pubkey.clone()
        }
        LessonActionKind::RestoreCandidate => {
            let current = current
                .as_ref()
                .ok_or_else(|| conflict("lesson does not exist"))?;
            let actor_is_admin = actor_role.as_deref().is_some_and(is_admin);
            if !actor_is_admin {
                tx.rollback().await.map_err(internal)?;
                return Err(forbidden(
                    "only a community owner or admin can restore lessons",
                ));
            }
            if current.status != LessonStatus::Deprecated {
                tx.rollback().await.map_err(internal)?;
                return Err(conflict("only a deprecated lesson can return to candidate"));
            }
            current.snapshot.employee_pubkey.clone()
        }
    };
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-member-tree:{}", community_id.as_uuid()))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    validate_employee_target(state, community_id, &employee_pubkey).await?;
    validate_evidence_refs(state, community_id, action.snapshot.as_ref()).await?;

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let next = next_lesson_head(&event, &action, current.as_ref(), &actor_pubkey, now)?;
    let head_event = relay_lesson_head_event(&next, &d_tag, current_stored.as_ref(), state)?;
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
            "lesson changed before the action could commit; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_LESSON_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_LESSON_HEAD,
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

fn next_lesson_head(
    event: &Event,
    action: &LessonAction,
    current: Option<&LessonHead>,
    actor_pubkey: &str,
    now: String,
) -> Result<LessonHead, IngestError> {
    let (snapshot, status, approval, proposed_by_pubkey) = match action.action {
        LessonActionKind::Create => (
            action
                .snapshot
                .clone()
                .ok_or_else(|| invalid("create needs a snapshot"))?,
            LessonStatus::Candidate,
            None,
            actor_pubkey.to_owned(),
        ),
        LessonActionKind::Update => (
            action
                .snapshot
                .clone()
                .ok_or_else(|| invalid("update needs a snapshot"))?,
            LessonStatus::Candidate,
            None,
            current
                .ok_or_else(|| conflict("lesson does not exist"))?
                .proposed_by_pubkey
                .clone(),
        ),
        LessonActionKind::Approve => {
            let current = current.ok_or_else(|| conflict("lesson does not exist"))?;
            let confidence = action
                .confidence
                .filter(|value| *value != LessonConfidence::Unassessed)
                .ok_or_else(|| invalid("approval needs an assessed confidence"))?;
            let mut snapshot = current.snapshot.clone();
            snapshot.confidence = confidence;
            (
                snapshot,
                LessonStatus::Approved,
                Some(LessonApproval {
                    approved_by_pubkey: actor_pubkey.to_owned(),
                    approved_at: now.clone(),
                }),
                current.proposed_by_pubkey.clone(),
            )
        }
        LessonActionKind::Deprecate => {
            let current = current.ok_or_else(|| conflict("lesson does not exist"))?;
            (
                current.snapshot.clone(),
                LessonStatus::Deprecated,
                current.approval.clone(),
                current.proposed_by_pubkey.clone(),
            )
        }
        LessonActionKind::RestoreCandidate => {
            let current = current.ok_or_else(|| conflict("lesson does not exist"))?;
            let mut snapshot = current.snapshot.clone();
            snapshot.confidence = LessonConfidence::Unassessed;
            (
                snapshot,
                LessonStatus::Candidate,
                None,
                current.proposed_by_pubkey.clone(),
            )
        }
    };
    let previous = current;
    Ok(LessonHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        lesson_id: action.lesson_id,
        snapshot,
        status,
        proposed_by_pubkey,
        approval,
        created_at: previous.map_or_else(|| now.clone(), |head| head.created_at.clone()),
        updated_at: now,
        source_action_event_id: event.id.to_hex(),
    })
}

async fn validate_employee_target(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    employee_pubkey: &str,
) -> Result<(), IngestError> {
    let Some((_, position)) = super::company_member_records::load_position_for_proposal(
        state,
        community_id,
        employee_pubkey,
    )
    .await?
    else {
        return Err(invalid("lesson target has no current employee position"));
    };
    if position.kind != MemberKind::Employee {
        return Err(invalid("lessons require an employee profile"));
    }
    Ok(())
}

async fn validate_evidence_refs(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    snapshot: Option<&LessonSnapshot>,
) -> Result<(), IngestError> {
    let Some(snapshot) = snapshot else {
        return Ok(());
    };
    for reference in &snapshot.evidence {
        let event_id = nostr::EventId::from_hex(&reference.event_id)
            .map_err(|_| invalid("lesson evidence id is not a valid event id"))?;
        let event_id_bytes = event_id.to_bytes();
        if state
            .db
            .get_event_by_id_for_event_write(community_id, &event_id_bytes)
            .await
            .map_err(internal)?
            .is_none()
        {
            return Err(invalid(format!(
                "lesson evidence event {} does not exist in this community",
                reference.event_id
            )));
        }
    }
    Ok(())
}

async fn current_lesson_head(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_LESSON_HEAD as i32]);
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
        return Err(internal("stored lesson d-tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        let head = parse_lesson_head(stored)?;
        validate_lesson_d_tag(d_tag, head.lesson_id)
            .map_err(|error| internal(format!("stored lesson d-tag: {error}")))?;
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
        if stored.event.kind != nostr::Kind::Custom(KIND_LESSON_HEAD as u16)
            || stored.event.pubkey != state.relay_keypair.public_key()
            || stored.event.verify().is_err()
            || stored.channel_id.is_some()
            || d_tags.len() != 1
            || d_tags[0].content() != Some(d_tag)
            || p_tags.len() != 1
            || p_tags[0].content() != Some(head.snapshot.employee_pubkey.as_str())
            || stored.event.tags.len() != 2
        {
            return Err(internal("stored lesson head has invalid d or p tags"));
        }
    }
    Ok(stored)
}

fn parse_lesson_head(stored: &StoredEvent) -> Result<LessonHead, IngestError> {
    let head = serde_json::from_str::<LessonHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored lesson head is invalid: {error}")))?;
    validate_lesson_head(&head)
        .map_err(|error| internal(format!("stored lesson head: {error}")))?;
    Ok(head)
}

fn relay_lesson_head_event(
    head: &LessonHead,
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
        Tag::parse(["p", head.snapshot.employee_pubkey.as_str()]).map_err(internal)?;
    EventBuilder::new(Kind::Custom(KIND_LESSON_HEAD as u16), content)
        .tags([d_tag, employee_tag])
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn command_d_tag(event: &Event, action: &LessonAction) -> Result<String, IngestError> {
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
            "lesson commands require one d tag, one p tag, and no h tag",
        ));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| invalid("lesson command d tag must have a value"))?;
    let employee_pubkey = p_tags[0]
        .content()
        .ok_or_else(|| invalid("lesson command p tag must have a value"))?;
    if nostr::PublicKey::from_hex(employee_pubkey).is_err() {
        return Err(invalid("lesson command p tag must be a public key"));
    }
    validate_lesson_d_tag(d_tag, action.lesson_id)
        .map_err(|error| invalid(format!("lesson command d tag: {error}")))?;
    Ok(d_tag.to_owned())
}

fn check_expected_head(
    action: &LessonAction,
    current_head_id: Option<&[u8]>,
) -> Result<(), IngestError> {
    let expected = action.expected_head_event_id.as_deref();
    let actual = current_head_id.map(hex::encode);
    if expected == actual.as_deref() {
        Ok(())
    } else {
        Err(conflict(format!(
            "lesson changed; current head is {}",
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
