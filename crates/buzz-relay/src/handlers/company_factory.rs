//! Nostr-first broker for Software Factory run preview and pull request records.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::Event;
use uuid::Uuid;

use buzz_core::factory_run_records::{
    apply_factory_run_action, factory_run_d_tag, parse_factory_run_action,
    validate_factory_run_head, FactoryRunHead, FactoryRunRecordError,
};
use buzz_core::kind::{KIND_FACTORY_RUN_ACTION, KIND_FACTORY_RUN_HEAD};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_datastore_tracing::datastore_span;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handle a member-signed Factory run record command.
#[datastore_span(name = "company_factory_run_action", system = "postgresql")]
pub async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_FACTORY_RUN_ACTION {
        return Err(invalid("unsupported Factory run action kind"));
    }
    let action = parse_factory_run_action(&event.content).map_err(map_record_error)?;
    let d_tag = factory_run_command_d_tag(&event, action.run_id)?;
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write Factory run records",
        ));
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
    .map_err(internal)?
    .ok_or_else(|| forbidden("actor is not a member of this community"))?;

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
        return Ok(IngestResult {
            event_id: event.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-factory-run:{}:{}",
            community_id.as_uuid(),
            action.run_id
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_FACTORY_RUN_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_factory_run_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(IngestError::Internal(
            "error: Factory run head changed while its transaction lock was held".into(),
        ));
    }
    let current = current_stored
        .as_ref()
        .map(parse_factory_run_head)
        .transpose()?;
    let expected_d_tag = factory_run_d_tag(action.run_id);
    if d_tag != expected_d_tag {
        tx.rollback().await.map_err(internal)?;
        return Err(invalid("Factory run action d-tag does not match runId"));
    }

    let updated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let current_head_hex = current_head_id.as_deref().map(hex::encode);
    let head = apply_factory_run_action(
        &action,
        &actor_pubkey,
        is_admin(&role),
        current.as_ref(),
        current_head_hex.as_deref(),
        &updated_at,
    )
    .map_err(map_record_error)?;
    let head_event = super::business_records::relay_global_head_event(
        KIND_FACTORY_RUN_HEAD,
        &d_tag,
        &head,
        current_stored.as_ref(),
        state,
    )?;

    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community_id, &event, None)
            .await
            .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(IngestResult {
            event_id: event.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
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
        return Err(conflict("Factory run changed before the action committed"));
    }

    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_FACTORY_RUN_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_FACTORY_RUN_HEAD,
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

fn factory_run_command_d_tag(event: &Event, run_id: Uuid) -> Result<String, IngestError> {
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
    if d_tags.len() != 1
        || auth_tag_count > 1
        || event.tags.iter().any(|tag| {
            let kind = tag.kind().to_string();
            kind != "d" && kind != "auth"
        })
    {
        return Err(invalid("Factory run action must carry only one d-tag"));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| invalid("Factory run action d-tag must have a value"))?;
    if d_tag != factory_run_d_tag(run_id) {
        return Err(invalid("Factory run action d-tag does not match runId"));
    }
    Ok(d_tag.to_owned())
}

async fn current_factory_run_head(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_FACTORY_RUN_HEAD as i32]);
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
            "error: duplicate Factory run head coordinate".into(),
        ));
    }
    let head = rows.pop();
    if let Some(head) = &head {
        let parsed = parse_factory_run_head(head)?;
        if factory_run_d_tag(parsed.run_id) != d_tag {
            return Err(IngestError::Internal(
                "error: stored Factory run d-tag does not match runId".into(),
            ));
        }
    }
    Ok(head)
}

fn parse_factory_run_head(event: &StoredEvent) -> Result<FactoryRunHead, IngestError> {
    let head = serde_json::from_str::<FactoryRunHead>(&event.event.content)
        .map_err(|_| internal("stored Factory run head content is invalid"))?;
    validate_factory_run_head(&head).map_err(|error| internal(error.to_string()))?;
    Ok(head)
}

fn is_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

fn map_record_error(error: FactoryRunRecordError) -> IngestError {
    match error {
        FactoryRunRecordError::Forbidden => forbidden("actor is not the run owner or an admin"),
        FactoryRunRecordError::Conflict => conflict("expected Factory run head is stale"),
        FactoryRunRecordError::InvalidContent => invalid("Factory run action content is invalid"),
        FactoryRunRecordError::UnsupportedSchemaVersion => {
            invalid("Factory run record schema version is unsupported")
        }
        FactoryRunRecordError::Invalid(message) => invalid(message),
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
