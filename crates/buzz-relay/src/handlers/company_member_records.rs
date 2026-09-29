//! Nostr-first broker for community-wide company member positions.
//!
//! Position writes share one community lock so manager changes cannot race to
//! create a reporting cycle. Each accepted action and relay-signed head commit
//! together.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::Event;
use sqlx::Row;
use sqlx::{Postgres, Transaction};

use buzz_core::company_members::{
    apply_member_position_action, member_d_tag, member_manager_creates_cycle,
    validate_member_d_tag, validate_member_position_action, validate_member_position_head,
    MemberKind, MemberPositionAction, MemberPositionActionKind, MemberPositionHead, MemberStatus,
    MAX_ORG_DEPTH,
};
use buzz_core::kind::{KIND_MEMBER_POSITION_ACTION, KIND_MEMBER_POSITION_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_datastore_tracing::datastore_span;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

const MAX_CURRENT_MEMBER_HEADS: i64 = 10_000;

/// Handles a member-signed company position action (kind 47037).
#[datastore_span(name = "company_member_position_action", system = "postgresql")]
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let action = serde_json::from_str::<MemberPositionAction>(&event.content)
        .map_err(|_| invalid("member position action content is invalid"))?;
    validate_member_position_action(&action)
        .map_err(|error| invalid(format!("member position action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_MEMBER_POSITION_ACTION {
        return Err(IngestError::Rejected(
            "restricted: unsupported member-position action kind".into(),
        ));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write company member positions",
        ));
    }

    let d_tag = member_command_d_tag(&event, &action)?;
    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let target_pubkey = action.pubkey.clone();
    let manager_pubkey = proposed_manager(&action);
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

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-member-tree:{}", community_id.as_uuid()))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    let mut locked_pubkeys = BTreeSet::from([actor_pubkey.clone(), target_pubkey.clone()]);
    if let Some(manager_pubkey) = manager_pubkey.as_ref() {
        locked_pubkeys.insert(manager_pubkey.clone());
    }
    let locked_pubkeys = locked_pubkeys.into_iter().collect::<Vec<_>>();
    let membership_rows = sqlx::query(
        "SELECT pubkey, role FROM relay_members \
         WHERE community_id = $1 AND pubkey = ANY($2) ORDER BY pubkey FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&locked_pubkeys)
    .fetch_all(&mut *tx)
    .await
    .map_err(internal)?;
    let memberships = membership_rows
        .into_iter()
        .map(|row| {
            Ok::<_, sqlx::Error>((
                row.try_get::<String, _>("pubkey")?,
                row.try_get::<String, _>("role")?,
            ))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(internal)?;
    let actor_role = memberships
        .get(&actor_pubkey)
        .ok_or_else(|| forbidden("actor is not a member of this community"))?;
    if !is_admin(actor_role) {
        return Err(forbidden(
            "only a company owner or admin can directly change a member position",
        ));
    }
    let kind = member_kind_in_transaction(&mut tx, community_id, &target_pubkey)
        .await?
        .ok_or_else(|| invalid("target account is unavailable or is a runtime worker"))?;
    if kind == MemberKind::Human && !memberships.contains_key(&target_pubkey) {
        return Err(invalid("target is not a member of this community"));
    }
    if let Some(manager_pubkey) = manager_pubkey.as_ref() {
        let manager_kind =
            member_kind_in_transaction(&mut tx, community_id, manager_pubkey).await?;
        if !(matches!(manager_kind, Some(MemberKind::Employee))
            || manager_kind == Some(MemberKind::Human) && memberships.contains_key(manager_pubkey))
        {
            return Err(invalid("manager is not a member or managed employee"));
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

    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_MEMBER_POSITION_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    ensure_expected_head(&action, current_head_id.as_deref())?;

    let current_stored = current_member_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(IngestError::Internal(
            "error: member position head changed while its transaction lock was held".into(),
        ));
    }
    let current = current_stored.as_ref().map(parse_member_head).transpose()?;
    if current.as_ref().is_some_and(|head| head.kind != kind) {
        tx.rollback().await.map_err(internal)?;
        return Err(invalid("member kind does not match the current position"));
    }

    let positions = current_member_heads(state, community_id).await?;
    if let Some(manager_pubkey) = manager_pubkey.as_deref() {
        let manager = positions.get(manager_pubkey);
        if manager.is_some_and(|head| head.status != MemberStatus::Active) {
            tx.rollback().await.map_err(internal)?;
            return Err(invalid("manager must have an active member position"));
        }
        if member_manager_creates_cycle(&target_pubkey, manager_pubkey, |pubkey| {
            positions
                .get(pubkey)
                .and_then(|head| head.manager_pubkey.clone())
        }) {
            tx.rollback().await.map_err(internal)?;
            return Err(invalid(format!(
                "manager change would create a cycle or exceed the supported depth of {MAX_ORG_DEPTH}"
            )));
        }
    }

    let next = apply_member_position_action(
        current.as_ref(),
        &action,
        kind,
        event.id.to_hex(),
        Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    )
    .map_err(|error| invalid(format!("member position action: {error}")))?;
    let head_event = super::business_records::relay_global_head_event(
        KIND_MEMBER_POSITION_HEAD,
        &d_tag,
        &next,
        current_stored.as_ref(),
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
            "member position changed before the action committed; refresh and retry",
        ));
    }

    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_MEMBER_POSITION_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_MEMBER_POSITION_HEAD,
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

/// Loads a member position for the ask broker after it has validated community scope.
pub(crate) async fn load_position_for_proposal(
    state: &AppState,
    community_id: CommunityId,
    pubkey: &str,
) -> Result<Option<(StoredEvent, MemberPositionHead)>, IngestError> {
    let d_tag = member_d_tag(pubkey).map_err(|error| invalid(format!("member d-tag: {error}")))?;
    let Some(stored) = current_member_head(state, community_id, &d_tag).await? else {
        return Ok(None);
    };
    let head = parse_member_head(&stored)?;
    Ok(Some((stored, head)))
}

/// Returns whether a community user is a managed employee, including agents
/// that are not present in the relay_members snapshot.
pub(crate) async fn is_registered_employee(
    state: &AppState,
    community_id: CommunityId,
    pubkey_hex: &str,
) -> Result<bool, IngestError> {
    let pubkey = nostr::PublicKey::from_hex(pubkey_hex)
        .map_err(|_| invalid("member pubkey is not valid hexadecimal"))?;
    let identity = state
        .db
        .get_agent_channel_policy(community_id, &pubkey.to_bytes())
        .await
        .map_err(internal)?;
    Ok(identity.is_some_and(|(_, owner)| owner.is_some()))
}

/// A relay-signed member head prepared while holding the community tree lock.
pub(crate) struct PreparedMemberPositionHead {
    /// Member coordinate used for replacement.
    pub d_tag: String,
    /// Exact prior revision, or `None` for initial position creation.
    pub expected_head_id: Option<Vec<u8>>,
    /// Relay-signed replacement head.
    pub event: Event,
}

/// Validates and signs an approved member proposal inside the response transaction.
pub(crate) async fn prepare_member_position_proposal(
    tx: &mut Transaction<'_, Postgres>,
    tenant: &TenantContext,
    state: &AppState,
    action: &MemberPositionAction,
    response_event_id: &str,
) -> Result<PreparedMemberPositionHead, IngestError> {
    validate_member_position_action(action)
        .map_err(|error| invalid(format!("member proposal: {error}")))?;
    let community_id = tenant.community();
    let target_pubkey = action.pubkey.clone();
    let d_tag =
        member_d_tag(&target_pubkey).map_err(|error| invalid(format!("member d-tag: {error}")))?;
    let manager_pubkey = proposed_manager(action);

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-member-tree:{}", community_id.as_uuid()))
        .execute(&mut **tx)
        .await
        .map_err(internal)?;

    let mut locked_pubkeys = BTreeSet::from([target_pubkey.clone()]);
    if let Some(manager_pubkey) = manager_pubkey.as_ref() {
        locked_pubkeys.insert(manager_pubkey.clone());
    }
    let locked_pubkeys = locked_pubkeys.into_iter().collect::<Vec<_>>();
    let member_rows = sqlx::query(
        "SELECT pubkey FROM relay_members \
         WHERE community_id = $1 AND pubkey = ANY($2) ORDER BY pubkey FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&locked_pubkeys)
    .fetch_all(&mut **tx)
    .await
    .map_err(internal)?;
    let members = member_rows
        .into_iter()
        .map(|row| row.try_get::<String, _>("pubkey"))
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal)?;
    for pubkey in &locked_pubkeys {
        let member_kind = member_kind_in_transaction(tx, community_id, pubkey).await?;
        if !(matches!(member_kind, Some(MemberKind::Employee))
            || member_kind == Some(MemberKind::Human) && members.contains(pubkey))
        {
            return Err(invalid("member or manager is not in this community"));
        }
    }

    let kind = member_kind_in_transaction(tx, community_id, &target_pubkey)
        .await?
        .ok_or_else(|| invalid("target account is unavailable or is a runtime worker"))?;

    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        KIND_MEMBER_POSITION_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    ensure_expected_head(action, current_head_id.as_deref())?;
    let current_stored = current_member_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(IngestError::Internal(
            "error: member proposal head changed while its transaction lock was held".into(),
        ));
    }
    let current = current_stored.as_ref().map(parse_member_head).transpose()?;
    if current.as_ref().is_some_and(|head| head.kind != kind) {
        return Err(invalid("member kind does not match the current position"));
    }

    let positions = current_member_heads(state, community_id).await?;
    if let Some(manager_pubkey) = manager_pubkey.as_deref() {
        if positions
            .get(manager_pubkey)
            .is_some_and(|head| head.status != MemberStatus::Active)
        {
            return Err(invalid("manager must have an active member position"));
        }
        if member_manager_creates_cycle(&target_pubkey, manager_pubkey, |pubkey| {
            positions
                .get(pubkey)
                .and_then(|head| head.manager_pubkey.clone())
        }) {
            return Err(invalid(format!(
                "manager change would create a cycle or exceed the supported depth of {MAX_ORG_DEPTH}"
            )));
        }
    }

    let next = apply_member_position_action(
        current.as_ref(),
        action,
        kind,
        response_event_id.to_owned(),
        Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    )
    .map_err(|error| invalid(format!("member proposal: {error}")))?;
    let head_event = super::business_records::relay_global_head_event(
        KIND_MEMBER_POSITION_HEAD,
        &d_tag,
        &next,
        current_stored.as_ref(),
        state,
    )?;

    Ok(PreparedMemberPositionHead {
        d_tag,
        expected_head_id: current_head_id,
        event: head_event,
    })
}

/// Replaces a prepared member position inside its caller's transaction.
pub(crate) async fn replace_prepared_member_position(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    prepared: &PreparedMemberPositionHead,
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
            "member position changed before the proposal committed; refresh and retry",
        ));
    }
    Ok(replaced.event)
}

async fn current_member_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_MEMBER_POSITION_HEAD as i32]);
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
            "error: duplicate company member position head coordinate".into(),
        ));
    }
    let head = rows.pop();
    if let Some(head) = &head {
        let parsed = parse_member_head(head)?;
        validate_member_d_tag(d_tag, &parsed.pubkey)
            .map_err(|error| internal(format!("stored member d-tag: {error}")))?;
    }
    Ok(head)
}

async fn current_member_heads(
    state: &AppState,
    community_id: CommunityId,
) -> Result<BTreeMap<String, MemberPositionHead>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_MEMBER_POSITION_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(MAX_CURRENT_MEMBER_HEADS + 1);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() as i64 > MAX_CURRENT_MEMBER_HEADS {
        return Err(IngestError::Internal(format!(
            "error: company member tree exceeds the supported {MAX_CURRENT_MEMBER_HEADS} positions"
        )));
    }
    rows.iter()
        .map(|stored| {
            let head = parse_member_head(stored)?;
            let d_tag = member_d_tag(&head.pubkey)
                .map_err(|error| internal(format!("stored member pubkey: {error}")))?;
            validate_member_d_tag(&d_tag, &head.pubkey)
                .map_err(|error| internal(format!("stored member d-tag: {error}")))?;
            Ok((head.pubkey.clone(), head))
        })
        .collect()
}

fn parse_member_head(event: &StoredEvent) -> Result<MemberPositionHead, IngestError> {
    let head = serde_json::from_str::<MemberPositionHead>(&event.event.content).map_err(|_| {
        IngestError::Internal("error: stored company member head is invalid".into())
    })?;
    validate_member_position_head(&head)
        .map_err(|error| internal(format!("stored company member head: {error}")))?;
    Ok(head)
}

fn member_command_d_tag(
    event: &Event,
    action: &MemberPositionAction,
) -> Result<String, IngestError> {
    let d_tag = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .filter_map(|tag| tag.content())
        .collect::<Vec<_>>();
    let h_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "h")
        .count();
    if d_tag.len() != 1 || h_tags != 0 {
        return Err(invalid("member action needs one d-tag and no h-tag"));
    }
    validate_member_d_tag(d_tag[0], &action.pubkey)
        .map_err(|error| invalid(format!("member d-tag: {error}")))?;
    Ok(d_tag[0].to_owned())
}

fn ensure_expected_head(
    action: &MemberPositionAction,
    current_head_id: Option<&[u8]>,
) -> Result<(), IngestError> {
    match (
        action.expected_head_event_id.as_deref(),
        current_head_id,
        action.action,
    ) {
        (
            None,
            None,
            MemberPositionActionKind::SetTitle | MemberPositionActionKind::SetPosition,
        ) => Ok(()),
        (None, Some(_), _) => Err(conflict("member position already exists")),
        (Some(expected), Some(actual), _) if expected == hex::encode(actual) => Ok(()),
        (Some(_), Some(actual), _) => Err(conflict(format!(
            "member position changed; current head is {}",
            hex::encode(actual)
        ))),
        (Some(_), None, _) => Err(conflict("member position does not exist")),
        (None, None, _) => Err(invalid("expectedHeadEventId is required for this action")),
    }
}

fn proposed_manager(action: &MemberPositionAction) -> Option<String> {
    match action.action {
        MemberPositionActionKind::SetManager => action.manager_pubkey.as_ref().cloned().flatten(),
        MemberPositionActionKind::SetPosition => action.manager_pubkey.as_ref().cloned().flatten(),
        _ => None,
    }
}

fn decode_pubkey(pubkey: &str) -> Result<Vec<u8>, IngestError> {
    hex::decode(pubkey).map_err(|_| invalid("pubkey must be 64 lowercase hex characters"))
}

async fn member_kind_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    pubkey_hex: &str,
) -> Result<Option<MemberKind>, IngestError> {
    let pubkey = decode_pubkey(pubkey_hex)?;
    let is_employee = sqlx::query_scalar::<_, Option<bool>>(
        "SELECT CASE \
                 WHEN lower(COALESCE(agent_type, '')) = 'worker' THEN NULL \
                 ELSE agent_owner_pubkey IS NOT NULL \
         END FROM users WHERE community_id = $1 AND pubkey = $2",
    )
    .bind(community_id.as_uuid())
    .bind(&pubkey)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)?;
    Ok(match is_employee.flatten() {
        Some(true) => Some(MemberKind::Employee),
        Some(false) => Some(MemberKind::Human),
        None => None,
    })
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
