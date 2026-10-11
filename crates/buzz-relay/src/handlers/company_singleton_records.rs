//! Brokers for company-wide singleton records.
//!
//! A company has exactly one business profile (kind 47046 to head 30657) and
//! exactly one team computer record (kind 47047 to head 30658). Owners and
//! admins write both. Each accepted action becomes a relay-signed head with a
//! fixed `d` coordinate, replaced only with a create-only or exact-revision
//! precondition so concurrent writers cannot both win.

use std::sync::Arc;

use nostr::{Event, EventBuilder, Kind, Tag};
use sqlx::{Postgres, Transaction};

use buzz_core::company_profile::{
    next_profile_revision, validate_business_profile, BusinessProfile, BusinessProfileAction,
    ProfileRevisionConflict, BUSINESS_PROFILE_D_TAG, BUSINESS_PROFILE_REVISION_TAG,
};
use buzz_core::kind::{
    KIND_BUSINESS_PROFILE_ACTION, KIND_BUSINESS_PROFILE_HEAD, KIND_TEAM_COMPUTER_ACTION,
    KIND_TEAM_COMPUTER_HEAD,
};
use buzz_core::team_computer::{
    apply_team_computer_action, validate_team_computer_action, validate_team_computer_head,
    TeamComputerAction, TeamComputerActionKind, TeamComputerHead, TeamComputerRefusal,
    TEAM_COMPUTER_D_TAG,
};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_datastore_tracing::datastore_span;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;
use chrono::Utc;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles an owner- or admin-signed business profile replacement (kind 47046).
#[datastore_span(name = "company_business_profile_action", system = "postgresql")]
pub(super) async fn handle_business_profile(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_BUSINESS_PROFILE_ACTION {
        return Err(IngestError::Rejected(
            "restricted: unsupported business profile action kind".into(),
        ));
    }
    let action = serde_json::from_str::<BusinessProfileAction>(&event.content)
        .map_err(|_| invalid("business profile action content is invalid"))?;
    validate_business_profile(&action.profile)
        .map_err(|error| invalid(format!("business profile: {error}")))?;
    require_member_signed_global_action(&event, &auth, BUSINESS_PROFILE_D_TAG)?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let mut tx = begin_fenced_transaction(state, community_id).await?;
    require_owner_or_admin(
        &mut tx,
        community_id,
        &actor_pubkey,
        "change the business profile",
    )
    .await?;
    if event_already_stored(&mut tx, community_id, &event).await? {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let (current_head_id, current_stored) = lock_current_head(
        &mut tx,
        state,
        community_id,
        KIND_BUSINESS_PROFILE_HEAD,
        BUSINESS_PROFILE_D_TAG,
    )
    .await?;
    let current_revision = current_stored
        .as_ref()
        .map(stored_profile_revision)
        .transpose()?;
    let revision = next_profile_revision(current_revision, action.expected_revision)
        .map_err(revision_conflict)?;
    let head_event = profile_head_event(&action.profile, revision, current_stored.as_ref(), state)?;
    let Some(stored_action) = insert_action(&mut tx, community_id, &event).await? else {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    };
    let stored_head = replace_head(
        &mut tx,
        state,
        community_id,
        &head_event,
        BUSINESS_PROFILE_D_TAG,
        current_head_id.as_deref(),
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_BUSINESS_PROFILE_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_head,
        KIND_BUSINESS_PROFILE_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: format!("response:{}", serde_json::json!({ "revision": revision })),
    })
}

/// Handles an owner- or admin-signed team computer claim, heartbeat or
/// release (kind 47047). Claims and releases are stored as events; a heartbeat
/// only replaces the head, so a running team does not add one stored event a
/// minute forever.
#[datastore_span(name = "company_team_computer_action", system = "postgresql")]
pub(super) async fn handle_team_computer(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_TEAM_COMPUTER_ACTION {
        return Err(IngestError::Rejected(
            "restricted: unsupported team computer action kind".into(),
        ));
    }
    let action = serde_json::from_str::<TeamComputerAction>(&event.content)
        .map_err(|_| invalid("team computer action content is invalid"))?;
    validate_team_computer_action(&action)
        .map_err(|error| invalid(format!("team computer action: {error}")))?;
    require_member_signed_global_action(&event, &auth, TEAM_COMPUTER_D_TAG)?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let stores_action = action.action != TeamComputerActionKind::Heartbeat;
    let mut tx = begin_fenced_transaction(state, community_id).await?;
    require_owner_or_admin(
        &mut tx,
        community_id,
        &actor_pubkey,
        "change which computer runs the team",
    )
    .await?;
    if stores_action && event_already_stored(&mut tx, community_id, &event).await? {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let (current_head_id, current_stored) = lock_current_head(
        &mut tx,
        state,
        community_id,
        KIND_TEAM_COMPUTER_HEAD,
        TEAM_COMPUTER_D_TAG,
    )
    .await?;
    let current = current_stored
        .as_ref()
        .map(parse_team_computer_head)
        .transpose()?;
    let next = apply_team_computer_action(
        current.as_ref(),
        &action,
        &actor_pubkey,
        Utc::now().timestamp(),
    )
    .map_err(team_computer_refusal)?;
    let head_event = super::business_records::relay_global_head_event(
        KIND_TEAM_COMPUTER_HEAD,
        TEAM_COMPUTER_D_TAG,
        &next,
        current_stored.as_ref(),
        state,
    )?;
    let stored_action = if stores_action {
        let Some(stored) = insert_action(&mut tx, community_id, &event).await? else {
            tx.rollback().await.map_err(internal)?;
            return Ok(duplicate_result(&event));
        };
        Some(stored)
    } else {
        None
    };
    let stored_head = replace_head(
        &mut tx,
        state,
        community_id,
        &head_event,
        TEAM_COMPUTER_D_TAG,
        current_head_id.as_deref(),
    )
    .await?;
    tx.commit().await.map_err(internal)?;
    if let Some(stored_action) = stored_action {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            &stored_action,
            KIND_TEAM_COMPUTER_ACTION,
            &actor_pubkey,
            None,
        )
        .await;
    }
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_head,
        KIND_TEAM_COMPUTER_HEAD,
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

fn parse_team_computer_head(stored: &StoredEvent) -> Result<TeamComputerHead, IngestError> {
    let head = serde_json::from_str::<TeamComputerHead>(&stored.event.content)
        .map_err(|_| IngestError::Internal("error: stored team computer head is invalid".into()))?;
    validate_team_computer_head(&head)
        .map_err(|error| internal(format!("stored team computer head: {error}")))?;
    Ok(head)
}

fn team_computer_refusal(refusal: TeamComputerRefusal) -> IngestError {
    match refusal {
        TeamComputerRefusal::HeldElsewhere { computer_name } => conflict(format!(
            "the team runs on {computer_name}; move it with a forced claim"
        )),
        TeamComputerRefusal::NoClaim => conflict("no computer holds the team; claim it first"),
        TeamComputerRefusal::NotTheHolder => {
            forbidden("only the computer that runs the team can do this")
        }
        TeamComputerRefusal::HeartbeatTooSoon { retry_after_secs } => IngestError::Rejected(format!(
            "rate-limited: heartbeat at most once every 60 seconds; retry in {retry_after_secs} seconds"
        )),
    }
}

/// The signer must be the authenticated person, writing company-wide with
/// exactly one fixed `d` coordinate and no channel `h` tag.
fn require_member_signed_global_action(
    event: &Event,
    auth: &IngestAuth,
    d_tag: &str,
) -> Result<(), IngestError> {
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write company-wide records",
        ));
    }
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    let h_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "h")
        .count();
    if d_tags.len() != 1 || d_tags[0].content() != Some(d_tag) || h_tags != 0 {
        return Err(invalid(format!(
            "this action needs exactly one d tag \"{d_tag}\" and no h tag"
        )));
    }
    Ok(())
}

async fn begin_fenced_transaction(
    state: &AppState,
    community_id: CommunityId,
) -> Result<Transaction<'static, Postgres>, IngestError> {
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
    Ok(tx)
}

async fn require_owner_or_admin(
    tx: &mut Transaction<'static, Postgres>,
    community_id: CommunityId,
    actor_pubkey: &str,
    what: &str,
) -> Result<(), IngestError> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR SHARE",
    )
    .bind(community_id.as_uuid())
    .bind(actor_pubkey)
    .fetch_optional(&mut **tx)
    .await
    .map_err(internal)?;
    if matches!(role.as_deref(), Some("owner" | "admin")) {
        Ok(())
    } else {
        Err(forbidden(format!(
            "only a company owner or admin can {what}"
        )))
    }
}

async fn event_already_stored(
    tx: &mut Transaction<'static, Postgres>,
    community_id: CommunityId,
    event: &Event,
) -> Result<bool, IngestError> {
    let command_id = event.id.to_bytes();
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM events WHERE community_id = $1 AND id = $2)",
    )
    .bind(community_id.as_uuid())
    .bind(command_id.as_slice())
    .fetch_one(&mut **tx)
    .await
    .map_err(internal)
}

/// Lock the singleton coordinate and load its current head, refusing to go
/// on if the head moved between the lock and the read.
async fn lock_current_head(
    tx: &mut Transaction<'static, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    kind: u32,
    d_tag: &str,
) -> Result<(Option<Vec<u8>>, Option<StoredEvent>), IngestError> {
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        kind,
        &state.relay_keypair.public_key().to_bytes(),
        d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_singleton_head(state, community_id, kind, d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(IngestError::Internal(
            "error: company singleton head changed while its transaction lock was held".into(),
        ));
    }
    Ok((current_head_id, current_stored))
}

async fn current_singleton_head(
    state: &AppState,
    community_id: CommunityId,
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
        return Err(IngestError::Internal(
            "error: duplicate company singleton head coordinate".into(),
        ));
    }
    Ok(rows.pop())
}

async fn insert_action(
    tx: &mut Transaction<'static, Postgres>,
    community_id: CommunityId,
    event: &Event,
) -> Result<Option<StoredEvent>, IngestError> {
    let (stored, inserted) =
        buzz_db::event::insert_event_in_transaction(tx, community_id, event, None)
            .await
            .map_err(internal)?;
    Ok(inserted.then_some(stored))
}

async fn replace_head(
    tx: &mut Transaction<'static, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    head_event: &Event,
    d_tag: &str,
    current_head_id: Option<&[u8]>,
) -> Result<StoredEvent, IngestError> {
    let precondition = current_head_id.map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            head_event,
            d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err(conflict(
            "this record changed before the action committed; refresh and retry",
        ));
    }
    Ok(replaced.event)
}

fn stored_profile_revision(stored: &StoredEvent) -> Result<u32, IngestError> {
    stored
        .event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == BUSINESS_PROFILE_REVISION_TAG)
        .and_then(|tag| tag.content())
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|revision| *revision > 0)
        .ok_or_else(|| {
            IngestError::Internal(
                "error: stored business profile head has no valid revision".into(),
            )
        })
}

fn profile_head_event(
    profile: &BusinessProfile,
    revision: u32,
    previous: Option<&StoredEvent>,
    state: &AppState,
) -> Result<Event, IngestError> {
    let now = nostr::Timestamp::now().as_secs();
    let created_at = previous.map_or(now, |stored| {
        now.max(stored.event.created_at.as_secs().saturating_add(1))
    });
    let content = serde_json::to_string(profile).map_err(internal)?;
    let tags = [
        Tag::parse(["d", BUSINESS_PROFILE_D_TAG]).map_err(internal)?,
        Tag::parse([BUSINESS_PROFILE_REVISION_TAG, revision.to_string().as_str()])
            .map_err(internal)?,
    ];
    EventBuilder::new(Kind::Custom(KIND_BUSINESS_PROFILE_HEAD as u16), content)
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn revision_conflict(reason: ProfileRevisionConflict) -> IngestError {
    match reason {
        ProfileRevisionConflict::ProfileExists { current } => conflict(format!(
            "a business profile already exists at revision {current}; send expectedRevision"
        )),
        ProfileRevisionConflict::ProfileMissing => {
            conflict("no business profile exists yet; send expectedRevision as null")
        }
        ProfileRevisionConflict::Stale { current } => conflict(format!(
            "business profile changed; current revision is {current}"
        )),
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
