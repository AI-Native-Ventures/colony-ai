//! Broker for company secret-binding metadata.
//!
//! Values never enter this module. A member-signed create, activation or
//! revocation command is validated and stored with its relay-signed head in
//! one transaction. Activating a binding linked to a secret ask advances both
//! heads in that transaction.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::Event;
use uuid::Uuid;

use buzz_core::company_records::{
    ask_d_tag, parse_company_command, secret_binding_d_tag, validate_secret_binding_action,
    validate_secret_binding_d_tag, validate_secret_binding_spec, AskHead, AskOutcome,
    AskResolution, AskResolutionPayload, AskStatus, CompanyCommand, SecretBindingActionKind,
    SecretBindingHead, SecretBindingStatus, SecretStorage, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_ASK_HEAD, KIND_SECRET_BINDING_HEAD};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handle a member-signed company secret binding command.
pub async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let kind = u32::from(event.kind.as_u16());
    let command = parse_company_command(kind, &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::SecretBindingAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_secret_binding_action(&action)
        .map_err(|error| invalid(format!("secret binding action: {error}")))?;
    let d_tag = command_d_tag(&event, action.binding_id)?;

    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write secret bindings",
        ));
    }

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let identity = state
        .db
        .get_agent_channel_policy(community_id, &auth.pubkey().to_bytes())
        .await
        .map_err(internal)?;
    if identity.is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some()) {
        return Err(forbidden(
            "managed agents cannot create or change secret bindings",
        ));
    }

    // Check authority before looking up a binding or linked ask. Conflict
    // responses include current-head details, so unauthorized members must
    // not be able to use them to enumerate company secret metadata.
    let actor = state
        .db
        .get_relay_member(community_id, &actor_pubkey)
        .await
        .map_err(internal)?
        .ok_or_else(|| forbidden("actor is not a member of this community"))?;
    if !is_admin(&actor.role) {
        return Err(forbidden(
            "only a community owner or admin can change secret bindings",
        ));
    }

    let current = current_secret_binding_head(state, tenant, &d_tag).await?;
    let (binding, status) = match action.action {
        SecretBindingActionKind::Create => {
            if current.is_some() {
                return Err(conflict("secret binding already exists"));
            }
            let binding = action
                .binding
                .as_ref()
                .ok_or_else(|| invalid("create needs binding metadata"))?
                .clone();
            validate_secret_binding_spec(&binding)
                .map_err(|error| invalid(format!("secret binding: {error}")))?;
            if binding.storage == SecretStorage::Server {
                return Err(IngestError::Rejected(
                    "unavailable: this relay does not have an encrypted secret store".into(),
                ));
            }
            (binding, SecretBindingStatus::Pending)
        }
        SecretBindingActionKind::Activate | SecretBindingActionKind::Revoke => {
            let stored = current
                .as_ref()
                .ok_or_else(|| conflict("secret binding does not exist"))?;
            let head = parse_secret_binding_head(stored)?;
            let expected = action
                .expected_head_event_id
                .as_deref()
                .ok_or_else(|| invalid("action needs the current head"))?;
            if stored.event.id.to_hex() != expected {
                return Err(conflict(format!(
                    "secret binding changed; current head is {}",
                    stored.event.id
                )));
            }
            if head.binding.storage == SecretStorage::Server {
                return Err(IngestError::Rejected(
                    "unavailable: this relay does not have an encrypted secret store".into(),
                ));
            }
            let next_status = match action.action {
                SecretBindingActionKind::Activate
                    if head.status == SecretBindingStatus::Pending =>
                {
                    SecretBindingStatus::Active
                }
                SecretBindingActionKind::Revoke if head.status != SecretBindingStatus::Revoked => {
                    SecretBindingStatus::Revoked
                }
                SecretBindingActionKind::Activate => {
                    return Err(conflict("only a pending secret binding can be activated"));
                }
                SecretBindingActionKind::Revoke => {
                    return Err(conflict("secret binding is already revoked"));
                }
                SecretBindingActionKind::Create => {
                    return Err(invalid("create state cannot update an existing binding"));
                }
            };
            (head.binding, next_status)
        }
    };

    let source_ask = if status == SecretBindingStatus::Active {
        binding.source_ask.as_ref()
    } else if action.action == SecretBindingActionKind::Create {
        binding.source_ask.as_ref()
    } else {
        None
    };
    let ask_current = if let Some(source_ask) = source_ask {
        let ask_d_tag = ask_d_tag(source_ask.channel_id, source_ask.ask_id);
        let stored = current_ask_head(state, tenant, source_ask.channel_id, &ask_d_tag)
            .await?
            .ok_or_else(|| conflict("linked secret ask does not exist"))?;
        validate_linked_secret_ask(&stored, &binding, source_ask.ask_id)?;
        Some((source_ask.channel_id, ask_d_tag, stored))
    } else {
        None
    };

    let relay_head = match action.action {
        SecretBindingActionKind::Create => SecretBindingHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding,
            status,
            source_action_event_id: event.id.to_hex(),
        },
        SecretBindingActionKind::Activate | SecretBindingActionKind::Revoke => SecretBindingHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding,
            status,
            source_action_event_id: event.id.to_hex(),
        },
    };
    let previous_secret_head = current.as_ref();
    let secret_head_event = super::business_records::relay_global_head_event(
        KIND_SECRET_BINDING_HEAD,
        &d_tag,
        &relay_head,
        previous_secret_head,
        state,
    )?;

    let ask_head_event = if action.action == SecretBindingActionKind::Activate {
        if let Some((channel_id, ask_d_tag, stored_ask)) = ask_current.as_ref() {
            let mut ask_head = parse_ask_head(stored_ask)?;
            ask_head.status = AskStatus::Resolved;
            ask_head.resolution = Some(AskResolution {
                response: AskResolutionPayload {
                    outcome: AskOutcome::SecretBound,
                    reason: None,
                    answer: None,
                    option_id: None,
                    checked_item_ids: None,
                    secret_binding_id: Some(action.binding_id),
                },
                resolved_by_pubkey: actor_pubkey.clone(),
                resolved_at: now_rfc3339(),
                response_event_id: event.id.to_hex(),
            });
            ask_head.cancellation = None;
            ask_head.source_action_event_id = event.id.to_hex();
            Some((
                *channel_id,
                ask_d_tag.clone(),
                stored_ask,
                super::company_asks::relay_ask_head_event(
                    &ask_head,
                    *channel_id,
                    ask_d_tag,
                    Some(stored_ask),
                    state,
                )?,
            ))
        } else {
            None
        }
    } else {
        None
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
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden(
            "only a community owner or admin can change secret bindings",
        ));
    }

    if action.action == SecretBindingActionKind::Create {
        let target_role = sqlx::query_scalar::<_, String>(
            "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR KEY SHARE",
        )
        .bind(community_id.as_uuid())
        .bind(&relay_head.binding.employee_pubkey)
        .fetch_optional(&mut *tx)
        .await
        .map_err(internal)?;
        if target_role.is_none() {
            tx.rollback().await.map_err(internal)?;
            return Err(invalid("employeePubkey is not a member of this community"));
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
        return Ok(IngestResult {
            event_id: event.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
    }

    let locked_secret_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_SECRET_BINDING_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let expected_secret_head_id = current
        .as_ref()
        .map(|stored| stored.event.id.to_bytes().to_vec());
    if locked_secret_head_id.as_deref() != expected_secret_head_id.as_deref() {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict(
            "secret binding head changed before the command committed",
        ));
    }

    if let Some((_, ask_d_tag, stored_ask)) = ask_current.as_ref() {
        let locked_ask_head_id =
            buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
                &mut tx,
                community_id,
                KIND_ASK_HEAD,
                &state.relay_keypair.public_key().to_bytes(),
                ask_d_tag,
            )
            .await
            .map_err(internal)?;
        if locked_ask_head_id.as_deref() != Some(stored_ask.event.id.to_bytes().as_slice()) {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict(
                if action.action == SecretBindingActionKind::Create {
                    "secret ask changed before its binding was created"
                } else {
                    "secret ask changed before its binding was activated"
                },
            ));
        }
    }

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

    let secret_precondition = expected_secret_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced_secret = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            community_id,
            &secret_head_event,
            &d_tag,
            None,
            secret_precondition,
        )
        .await
        .map_err(internal)?;
    if replaced_secret.status != ParameterizedReplaceStatus::Inserted {
        tx.rollback().await.map_err(internal)?;
        return Err(conflict(
            "secret binding changed before the action committed",
        ));
    }

    let mut replaced_ask = None;
    if let Some((channel_id, ask_d_tag, stored_ask, ask_head)) = ask_head_event {
        let precondition = ParameterizedReplacePrecondition::ExpectedRevision;
        let result = state
            .db
            .replace_parameterized_event_in_transaction(
                &mut tx,
                community_id,
                &ask_head,
                &ask_d_tag,
                Some(channel_id),
                precondition,
            )
            .await
            .map_err(internal)?;
        if result.status != ParameterizedReplaceStatus::Inserted {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict(
                "secret ask changed before its binding was activated",
            ));
        }
        replaced_ask = Some((result.event, stored_ask.event.id.to_hex()));
    }

    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_SECRET_BINDING_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced_secret.event,
        KIND_SECRET_BINDING_HEAD,
        &state.relay_keypair.public_key().to_hex(),
        None,
    )
    .await;
    if let Some((ask_head, _)) = replaced_ask {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            &ask_head,
            KIND_ASK_HEAD,
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

fn command_d_tag(event: &Event, binding_id: Uuid) -> Result<String, IngestError> {
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
        return Err(invalid(
            "secret binding commands require one d tag, no h tag, and no unsupported tags",
        ));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| invalid("secret binding d tag must have a value"))?;
    validate_secret_binding_d_tag(d_tag, binding_id)
        .map_err(|error| invalid(format!("secret binding d tag: {error}")))?;
    Ok(d_tag.to_owned())
}

async fn current_secret_binding_head(
    state: &AppState,
    tenant: &TenantContext,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(tenant.community());
    query.kinds = Some(vec![KIND_SECRET_BINDING_HEAD as i32]);
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
            "error: duplicate company secret binding head coordinate".into(),
        ));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        let head = parse_secret_binding_head(stored)?;
        validate_secret_binding_d_tag(d_tag, head.binding.binding_id)
            .map_err(|error| internal(format!("stored secret binding d tag: {error}")))?;
    }
    Ok(stored)
}

async fn current_ask_head(
    state: &AppState,
    tenant: &TenantContext,
    channel_id: Uuid,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(tenant.community());
    query.channel_id = Some(channel_id);
    query.kinds = Some(vec![KIND_ASK_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.to_owned());
    query.limit = Some(2);
    let mut rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() > 1 {
        return Err(IngestError::Internal(
            "error: duplicate ask head coordinate".into(),
        ));
    }
    Ok(rows.pop())
}

fn parse_secret_binding_head(stored: &StoredEvent) -> Result<SecretBindingHead, IngestError> {
    let head = serde_json::from_str::<SecretBindingHead>(&stored.event.content).map_err(|_| {
        IngestError::Internal("error: stored company secret binding head is invalid".into())
    })?;
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION
        || head.binding.schema_version != COMPANY_RECORD_SCHEMA_VERSION
    {
        return Err(IngestError::Internal(
            "error: stored company secret binding schema is unsupported".into(),
        ));
    }
    validate_secret_binding_spec(&head.binding)
        .map_err(|error| internal(format!("stored secret binding metadata: {error}")))?;
    if head.binding.storage != SecretStorage::Device {
        return Err(IngestError::Internal(
            "error: stored secret binding has unsupported storage".into(),
        ));
    }
    Ok(head)
}

fn parse_ask_head(stored: &StoredEvent) -> Result<AskHead, IngestError> {
    serde_json::from_str::<AskHead>(&stored.event.content)
        .map_err(|_| IngestError::Internal("error: stored company ask head is invalid".into()))
}

fn validate_linked_secret_ask(
    stored: &StoredEvent,
    binding: &buzz_core::company_records::SecretBindingSpec,
    ask_id: Uuid,
) -> Result<AskHead, IngestError> {
    let head = parse_ask_head(stored)?;
    let request_matches = head.ask.secret_request.as_ref().is_some_and(|request| {
        request.tool_name == binding.tool_name && request.allowed_use == binding.allowed_use
    });
    if head.ask_id != ask_id
        || head.status != AskStatus::Open
        || head.ask.category != buzz_core::company_records::AskCategory::Secret
        || head.ask.ask_type != buzz_core::company_records::AskType::Question
        || head.asker_pubkey != binding.employee_pubkey
        || !request_matches
    {
        return Err(conflict(
            "secret binding does not match its open secret ask",
        ));
    }
    Ok(head)
}

fn is_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
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
