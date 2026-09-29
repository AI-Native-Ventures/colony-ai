//! Nostr-first broker for company record asks.
//!
//! Ask commands are scoped to a channel thread and produce relay-signed kind
//! 30643 heads. Goal commands remain owned by the parallel goals lane.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::{Event, EventBuilder, Kind, Tag};
use uuid::Uuid;

use buzz_core::company_records::{
    ask_resolution_denied_reason, parse_company_command, validate_ask_action, validate_ask_d_tag,
    validate_ask_response, AskAction, AskActionKind, AskCancellation, AskHead, AskRecord,
    AskResolution, AskResolutionPayload, AskResolver, AskResponse, AskStatus, AskType,
    CommunityRole, CompanyCommand, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_ASK_ACTION, KIND_ASK_HEAD, KIND_ASK_RESPONSE};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult, ThreadMetadataOwned};
use crate::state::AppState;

#[cfg(test)]
type AskPersistTestHook = std::sync::Mutex<Option<(String, Arc<tokio::sync::Barrier>)>>;

#[cfg(test)]
static ASK_PERSIST_TEST_HOOK: std::sync::OnceLock<AskPersistTestHook> = std::sync::OnceLock::new();

/// Handles the ask commands in kinds 47032 and 47033.
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
        CompanyCommand::AskAction(action) => {
            handle_ask_action(tenant, state, event, auth, action).await
        }
        CompanyCommand::AskResponse(response) => {
            handle_ask_response(tenant, state, event, auth, response).await
        }
        CompanyCommand::GoalAction(_) => Err(IngestError::Rejected(
            "restricted: goal commands are handled by the company goal broker".into(),
        )),
        CompanyCommand::SecretBindingAction(_) => Err(IngestError::Rejected(
            "restricted: secret binding commands are handled by the company secret broker".into(),
        )),
        CompanyCommand::ToolPermissionAction(_) => Err(IngestError::Rejected(
            "restricted: tool permission commands are handled by the company permission broker"
                .into(),
        )),
    }
}

async fn handle_ask_action(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
    action: AskAction,
) -> Result<IngestResult, IngestError> {
    let (channel_id, d_tag) = command_coordinates(&event)?;
    validate_ask_d_tag(&d_tag, channel_id, action.ask_id)
        .map_err(|error| invalid(format!("ask d-tag: {error}")))?;
    require_token_channel_scope(&auth, channel_id)?;
    load_channel(state, tenant, channel_id).await?;

    if let Some(replay) = replay_existing_command(state, tenant, &event, channel_id).await? {
        return Ok(replay);
    }

    let actor = actor_facts(tenant, state, &auth, channel_id).await?;
    if !actor.is_channel_member {
        return Err(forbidden("only channel members can change an ask"));
    }
    match action.action {
        AskActionKind::Create => {
            let ask = action
                .ask
                .as_ref()
                .ok_or_else(|| invalid("create needs the ask"))?;
            if !actor.is_channel_member {
                return Err(forbidden("only channel members can create an ask"));
            }
            if ask.ask_type == AskType::ToolConsent && !actor.is_agent {
                return Err(forbidden(
                    "tool consent asks can only be created by a managed agent",
                ));
            }
            if ask.ask_type == AskType::ToolConsent {
                validate_tool_consent_deadline(ask)?;
            }
            let addressee_is_agent = match ask.addressee_pubkey.as_deref() {
                Some(pubkey) => is_managed_agent(state, tenant, pubkey).await?,
                None => false,
            };
            validate_ask_action(&action, addressee_is_agent)
                .map_err(|error| invalid(format!("ask action: {error}")))?;

            let thread_meta = super::ingest::resolve_nip10_thread_meta(
                tenant.community(),
                &event,
                channel_id,
                state,
            )
            .await
            .map_err(|message| invalid(format!("ask thread: {message}")))?
            .ok_or_else(|| invalid("ask create must reference an existing thread"))?;
            validate_thread_root(ask, &thread_meta)?;

            let current = current_ask_head(state, tenant, channel_id, &d_tag).await?;
            if let Some(current) = current {
                return Err(conflict(format!(
                    "ask already exists; current head is {}",
                    current.event.id
                )));
            }

            let now = now_rfc3339();
            let head = AskHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                ask_id: action.ask_id,
                status: AskStatus::Open,
                asker_pubkey: auth.pubkey().to_hex(),
                created_at: now,
                ask: ask.clone(),
                resolution: None,
                cancellation: None,
                source_action_event_id: event.id.to_hex(),
            };
            let head_event = relay_ask_head_event(&head, channel_id, &d_tag, None, state)?;

            persist_ask_command(
                tenant,
                state,
                AskCommandWrite {
                    command: event,
                    channel_id,
                    d_tag: &d_tag,
                    head: head_event,
                    previous_head: None,
                    thread_meta: Some(thread_meta),
                },
            )
            .await
        }
        AskActionKind::Cancel => {
            validate_ask_action(&action, false)
                .map_err(|error| invalid(format!("ask action: {error}")))?;
            let current = current_ask_head(state, tenant, channel_id, &d_tag)
                .await?
                .ok_or_else(|| conflict("ask does not exist; current head is missing"))?;
            let mut head = parse_head(&current.event)?;
            ensure_head_identity(&head, action.ask_id)?;
            ensure_expected_head(action.expected_head_event_id.as_deref(), &current)?;
            ensure_open(&head, &current)?;

            let is_asker = head.asker_pubkey == auth.pubkey().to_hex();
            if !is_asker && !actor.is_community_admin() {
                return Err(forbidden(
                    "only the asker or a company owner or admin can cancel this ask",
                ));
            }

            head.status = AskStatus::Cancelled;
            head.cancellation = Some(AskCancellation {
                cancelled_by_pubkey: auth.pubkey().to_hex(),
                cancelled_at: now_rfc3339(),
                reason: action
                    .reason
                    .as_ref()
                    .map_or_else(String::new, Clone::clone),
            });
            head.resolution = None;
            head.source_action_event_id = event.id.to_hex();
            let head_event =
                relay_ask_head_event(&head, channel_id, &d_tag, Some(&current), state)?;
            persist_ask_command(
                tenant,
                state,
                AskCommandWrite {
                    command: event,
                    channel_id,
                    d_tag: &d_tag,
                    head: head_event,
                    previous_head: Some(current),
                    thread_meta: None,
                },
            )
            .await
        }
    }
}

async fn handle_ask_response(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
    response: AskResponse,
) -> Result<IngestResult, IngestError> {
    let (channel_id, d_tag) = command_coordinates(&event)?;
    validate_ask_d_tag(&d_tag, channel_id, response.ask_id)
        .map_err(|error| invalid(format!("ask d-tag: {error}")))?;
    require_token_channel_scope(&auth, channel_id)?;
    load_channel(state, tenant, channel_id).await?;

    if let Some(replay) = replay_existing_command(state, tenant, &event, channel_id).await? {
        return Ok(replay);
    }

    let actor = actor_facts(tenant, state, &auth, channel_id).await?;

    let current = current_ask_head(state, tenant, channel_id, &d_tag)
        .await?
        .ok_or_else(|| conflict("ask does not exist; current head is missing"))?;
    let mut head = parse_head(&current.event)?;
    ensure_head_identity(&head, response.ask_id)?;
    ensure_expected_head(Some(response.expected_head_event_id.as_str()), &current)?;
    ensure_open(&head, &current)?;
    if head.ask.category == buzz_core::company_records::AskCategory::Secret {
        return Err(invalid(
            "secret asks resolve only through secret binding activation",
        ));
    }
    if head.ask.ask_type == AskType::ToolConsent && is_tool_consent_expired(&head.ask) {
        return Err(conflict("tool consent ask expired; the action was refused"));
    }
    validate_ask_response(&head.ask, &response)
        .map_err(|error| invalid(format!("ask response: {error}")))?;

    let resolver = AskResolver {
        pubkey: &actor.pubkey,
        is_agent: actor.is_agent,
        community_role: actor.community_role,
        is_channel_member: actor.is_channel_member,
    };
    if let Some(reason) = ask_resolution_denied_reason(&head.ask, resolver) {
        return Err(forbidden(reason));
    }

    let response_event_id = event.id.to_hex();
    head.status = AskStatus::Resolved;
    head.resolution = Some(AskResolution {
        response: AskResolutionPayload {
            outcome: response.outcome,
            reason: response.reason,
            answer: response.answer,
            option_id: response.option_id,
            checked_item_ids: response.checked_item_ids,
            secret_binding_id: response.secret_binding_id,
        },
        resolved_by_pubkey: auth.pubkey().to_hex(),
        resolved_at: now_rfc3339(),
        response_event_id,
    });
    head.cancellation = None;
    head.source_action_event_id = event.id.to_hex();
    let head_event = relay_ask_head_event(&head, channel_id, &d_tag, Some(&current), state)?;
    persist_ask_command(
        tenant,
        state,
        AskCommandWrite {
            command: event,
            channel_id,
            d_tag: &d_tag,
            head: head_event,
            previous_head: Some(current),
            thread_meta: None,
        },
    )
    .await
}

struct AskCommandWrite<'a> {
    command: Event,
    channel_id: Uuid,
    d_tag: &'a str,
    head: Event,
    previous_head: Option<StoredEvent>,
    thread_meta: Option<ThreadMetadataOwned>,
}

async fn persist_ask_command(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    write: AskCommandWrite<'_>,
) -> Result<IngestResult, IngestError> {
    let AskCommandWrite {
        command,
        channel_id,
        d_tag,
        head,
        previous_head,
        thread_meta,
    } = write;
    before_ask_persist_for_test(d_tag).await;
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(internal)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, tenant.community())
        .await
        .map_err(|error| {
            IngestError::Rejected(format!("restricted: community writes are fenced: {error}"))
        })?;

    let expected_head_id = previous_head
        .as_ref()
        .map(|stored| stored.event.id.to_bytes().to_vec());
    let locked_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        tenant.community(),
        KIND_ASK_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        d_tag,
    )
    .await
    .map_err(internal)?;
    if locked_head_id.as_deref() != expected_head_id.as_deref() {
        tx.rollback().await.map_err(internal)?;
        let current = locked_head_id
            .as_deref()
            .map(hex::encode)
            .unwrap_or_else(|| "missing".to_owned());
        return Err(conflict(format!(
            "ask head changed before the command committed; current head is {current}"
        )));
    }

    let (stored_command, inserted) = match thread_meta.as_ref() {
        Some(meta) => buzz_db::event::insert_event_with_thread_metadata_in_transaction(
            &mut tx,
            tenant.community(),
            &command,
            Some(channel_id),
            Some(meta.as_params()),
        )
        .await
        .map_err(internal)?,
        None => buzz_db::event::insert_event_in_transaction(
            &mut tx,
            tenant.community(),
            &command,
            Some(channel_id),
        )
        .await
        .map_err(internal)?,
    };
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(IngestResult {
            event_id: command.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
    }

    let mut stored_events = vec![(stored_command, command.pubkey.to_hex())];
    let precondition = expected_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            &mut tx,
            tenant.community(),
            &head,
            d_tag,
            Some(channel_id),
            precondition,
        )
        .await
        .map_err(internal)?;
    match replaced.status {
        ParameterizedReplaceStatus::Inserted => {
            stored_events.push((replaced.event, state.relay_keypair.public_key().to_hex()));
        }
        ParameterizedReplaceStatus::Duplicate => {}
        ParameterizedReplaceStatus::RevisionMismatch
        | ParameterizedReplaceStatus::RevisionMissing
        | ParameterizedReplaceStatus::Superseded
        | ParameterizedReplaceStatus::ReplayOnlyMiss => {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict(
                "ask head changed before the command committed; refresh the current head and retry",
            ));
        }
    }
    tx.commit().await.map_err(internal)?;

    for (stored, actor) in stored_events {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            &stored,
            u32::from(stored.event.kind.as_u16()),
            &actor,
            None,
        )
        .await;
    }

    Ok(IngestResult {
        event_id: command.id.to_hex(),
        accepted: true,
        message: String::new(),
    })
}

#[derive(Clone)]
struct ActorFacts {
    pubkey: String,
    is_agent: bool,
    community_role: Option<CommunityRole>,
    is_channel_member: bool,
}

impl ActorFacts {
    fn is_community_admin(&self) -> bool {
        matches!(
            self.community_role,
            Some(CommunityRole::Owner | CommunityRole::Admin)
        )
    }
}

async fn actor_facts(
    tenant: &TenantContext,
    state: &AppState,
    auth: &IngestAuth,
    channel_id: Uuid,
) -> Result<ActorFacts, IngestError> {
    let pubkey = auth.pubkey().to_hex();
    let identity = state
        .db
        .get_agent_channel_policy(tenant.community(), &auth.pubkey().to_bytes())
        .await
        .map_err(internal)?;
    let is_agent = identity.is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some());
    let channel_role = state
        .db
        .get_member_role(tenant.community(), channel_id, &auth.pubkey().to_bytes())
        .await
        .map_err(internal)?;
    let community_member = state
        .db
        .get_relay_member(tenant.community(), &pubkey)
        .await
        .map_err(internal)?;
    let community_role = community_member
        .as_ref()
        .and_then(|member| match member.role.as_str() {
            "owner" => Some(CommunityRole::Owner),
            "admin" => Some(CommunityRole::Admin),
            "member" => Some(CommunityRole::Member),
            _ => None,
        });

    Ok(ActorFacts {
        pubkey,
        is_agent,
        community_role,
        is_channel_member: channel_role.is_some(),
    })
}

async fn is_managed_agent(
    state: &AppState,
    tenant: &TenantContext,
    pubkey_hex: &str,
) -> Result<bool, IngestError> {
    let pubkey = nostr::PublicKey::from_hex(pubkey_hex)
        .map_err(|_| invalid("addressee must be a public key"))?;
    let identity = state
        .db
        .get_agent_channel_policy(tenant.community(), &pubkey.to_bytes())
        .await
        .map_err(internal)?;
    Ok(identity.is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some()))
}

async fn load_channel(
    state: &AppState,
    tenant: &TenantContext,
    channel_id: Uuid,
) -> Result<(), IngestError> {
    state
        .db
        .get_channel_for_event_write(tenant.community(), channel_id)
        .await
        .map(|_| ())
        .map_err(internal)
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

#[cfg(test)]
fn install_ask_persist_test_barrier(
    d_tag: String,
    barrier: Arc<tokio::sync::Barrier>,
) -> AskPersistTestHookGuard {
    let slot = ASK_PERSIST_TEST_HOOK.get_or_init(|| std::sync::Mutex::new(None));
    if let Ok(mut slot) = slot.lock() {
        *slot = Some((d_tag, barrier));
    }
    AskPersistTestHookGuard
}

#[cfg(test)]
async fn before_ask_persist_for_test(d_tag: &str) {
    let barrier = ASK_PERSIST_TEST_HOOK
        .get_or_init(|| std::sync::Mutex::new(None))
        .lock()
        .ok()
        .and_then(|slot| {
            slot.as_ref()
                .filter(|(expected, _)| expected == d_tag)
                .map(|(_, barrier)| Arc::clone(barrier))
        });
    if let Some(barrier) = barrier {
        barrier.wait().await;
    }
}

#[cfg(not(test))]
async fn before_ask_persist_for_test(_: &str) {}

#[cfg(test)]
struct AskPersistTestHookGuard;

#[cfg(test)]
impl Drop for AskPersistTestHookGuard {
    fn drop(&mut self) {
        if let Some(slot) = ASK_PERSIST_TEST_HOOK.get() {
            if let Ok(mut slot) = slot.lock() {
                *slot = None;
            }
        }
    }
}

async fn replay_existing_command(
    state: &AppState,
    tenant: &TenantContext,
    event: &Event,
    channel_id: Uuid,
) -> Result<Option<IngestResult>, IngestError> {
    let existing = state
        .db
        .get_event_by_id_for_event_write(tenant.community(), &event.id.to_bytes())
        .await
        .map_err(internal)?;
    let Some(existing) = existing else {
        return Ok(None);
    };
    if existing.event.pubkey != event.pubkey || existing.channel_id != Some(channel_id) {
        return Err(forbidden(
            "command replay must match its original author and channel",
        ));
    }
    Ok(Some(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: "duplicate: already processed".into(),
    }))
}

fn command_coordinates(event: &Event) -> Result<(Uuid, String), IngestError> {
    let h_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "h")
        .collect::<Vec<_>>();
    let d_tags = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "d")
        .collect::<Vec<_>>();
    if h_tags.len() != 1 || d_tags.len() != 1 {
        return Err(invalid(
            "ask command requires exactly one h tag and one d tag",
        ));
    }
    let h_parts = h_tags[0].as_slice();
    let d_parts = d_tags[0].as_slice();
    if h_parts.len() != 2 || d_parts.len() != 2 {
        return Err(invalid(
            "ask h and d tags must each have exactly two values",
        ));
    }
    let channel_id = Uuid::parse_str(h_parts[1].as_str())
        .map_err(|_| invalid("ask h tag must contain a channel UUID"))?;
    if channel_id.to_string() != h_parts[1] {
        return Err(invalid(
            "ask h tag channel UUID must be canonical lowercase",
        ));
    }
    Ok((channel_id, d_parts[1].to_owned()))
}

fn validate_thread_root(
    ask: &AskRecord,
    thread_meta: &ThreadMetadataOwned,
) -> Result<(), IngestError> {
    let resolved_root = hex::encode(&thread_meta.root_event_id);
    if ask.thread_root_event_id != resolved_root {
        return Err(invalid(
            "ask threadRootEventId must match the referenced thread root",
        ));
    }
    Ok(())
}

fn parse_head(event: &Event) -> Result<AskHead, IngestError> {
    serde_json::from_str(&event.content)
        .map_err(|_| IngestError::Internal("error: stored ask head content is invalid".into()))
}

fn ensure_head_identity(head: &AskHead, ask_id: Uuid) -> Result<(), IngestError> {
    if head.ask_id != ask_id || head.ask.ask_id != ask_id {
        return Err(IngestError::Internal(
            "error: ask head coordinate does not match its content".into(),
        ));
    }
    Ok(())
}

fn ensure_expected_head(
    expected_head_id: Option<&str>,
    current: &StoredEvent,
) -> Result<(), IngestError> {
    let current_head_id = current.event.id.to_hex();
    if expected_head_id == Some(current_head_id.as_str()) {
        Ok(())
    } else {
        Err(conflict(format!(
            "expected head does not match the current ask; current head is {}",
            current.event.id
        )))
    }
}

fn ensure_open(head: &AskHead, current: &StoredEvent) -> Result<(), IngestError> {
    match head.status {
        AskStatus::Open => Ok(()),
        AskStatus::Resolved => {
            let detail = head.resolution.as_ref().map_or_else(
                || "already resolved".to_owned(),
                |resolution| {
                    format!(
                        "resolved by {} at {}",
                        resolution.resolved_by_pubkey, resolution.resolved_at
                    )
                },
            );
            Err(conflict(format!(
                "ask is {detail}; current head is {}",
                current.event.id
            )))
        }
        AskStatus::Cancelled => {
            let detail = head.cancellation.as_ref().map_or_else(
                || "cancelled".to_owned(),
                |cancellation| {
                    format!(
                        "cancelled by {} at {}",
                        cancellation.cancelled_by_pubkey, cancellation.cancelled_at
                    )
                },
            );
            Err(conflict(format!(
                "ask is {detail}; current head is {}",
                current.event.id
            )))
        }
    }
}

pub(super) fn relay_ask_head_event(
    head: &AskHead,
    channel_id: Uuid,
    d_tag: &str,
    previous: Option<&StoredEvent>,
    state: &AppState,
) -> Result<Event, IngestError> {
    let content = serde_json::to_string(head).map_err(internal)?;
    let now = nostr::Timestamp::now().as_secs();
    let created_at = previous.map_or(now, |stored| {
        now.max(stored.event.created_at.as_secs().saturating_add(1))
    });
    let channel_tag = Tag::parse(["h", channel_id.to_string().as_str()])
        .map_err(|error| internal(format!("ask h tag: {error}")))?;
    let d_tag =
        Tag::parse(["d", d_tag]).map_err(|error| internal(format!("ask d tag: {error}")))?;
    let root_tag = Tag::parse(["e", head.ask.thread_root_event_id.as_str(), "", "root"])
        .map_err(|error| internal(format!("ask thread root tag: {error}")))?;
    let mut tags = vec![channel_tag, d_tag, root_tag];
    if head.ask.ask_type == AskType::ToolConsent {
        tags.push(
            Tag::parse(["t", "tool_consent"])
                .map_err(|error| internal(format!("tool consent inbox tag: {error}")))?,
        );
    }
    EventBuilder::new(Kind::Custom(KIND_ASK_HEAD as u16), content)
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn require_token_channel_scope(auth: &IngestAuth, channel_id: Uuid) -> Result<(), IngestError> {
    if auth
        .channel_ids()
        .is_some_and(|channel_ids| !channel_ids.contains(&channel_id))
    {
        return Err(IngestError::AuthFailed(
            "restricted: token is not scoped to this channel".into(),
        ));
    }
    Ok(())
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn validate_tool_consent_deadline(ask: &AskRecord) -> Result<(), IngestError> {
    let deadline = ask
        .decide_by
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
        .ok_or_else(|| invalid("tool consent asks need a deadline"))?;
    let now = Utc::now();
    if deadline <= now || deadline > now + chrono::Duration::minutes(5) {
        return Err(invalid(
            "tool consent deadline must be within the next five minutes",
        ));
    }
    Ok(())
}

fn is_tool_consent_expired(ask: &AskRecord) -> bool {
    ask.decide_by
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|deadline| deadline.with_timezone(&Utc) <= Utc::now())
}

fn invalid(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("invalid: {}", message.into()))
}

fn conflict(message: impl Into<String>) -> IngestError {
    IngestError::Rejected(format!("conflict: {}", message.into()))
}

fn forbidden(message: impl Into<String>) -> IngestError {
    IngestError::AuthFailed(format!("forbidden: {}", message.into()))
}

fn internal(error: impl std::fmt::Display) -> IngestError {
    IngestError::Internal(format!("error: {error}"))
}

const _: () = assert!(KIND_ASK_ACTION == 47_032);
const _: () = assert!(KIND_ASK_RESPONSE == 47_033);

#[cfg(test)]
mod unit_tests {
    use super::*;

    fn event_with_tags(tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::Custom(KIND_ASK_ACTION as u16), "{}")
            .tags(tags)
            .sign_with_keys(&nostr::Keys::generate())
            .expect("sign test event")
    }

    #[test]
    fn command_coordinates_require_one_canonical_channel_and_d_tag() {
        let channel_id = Uuid::from_u128(1);
        let ask_id = Uuid::from_u128(2);
        let channel = channel_id.to_string();
        let d_tag = format!("channel:{channel}:ask:{ask_id}");
        let event = event_with_tags(vec![
            Tag::parse(["h", channel.as_str()]).expect("h tag"),
            Tag::parse(["d", d_tag.as_str()]).expect("d tag"),
        ]);
        assert_eq!(
            command_coordinates(&event).expect("ask coordinates"),
            (channel_id, d_tag)
        );

        let duplicate_h = event_with_tags(vec![
            Tag::parse(["h", channel.as_str()]).expect("h tag"),
            Tag::parse(["h", channel.as_str()]).expect("second h tag"),
            Tag::parse(["d", "some-d-tag"]).expect("d tag"),
        ]);
        assert!(matches!(
            command_coordinates(&duplicate_h),
            Err(IngestError::Rejected(message)) if message.contains("exactly one h tag")
        ));
    }

    #[test]
    fn stale_and_terminal_head_rejections_include_current_head_context() {
        let keys = nostr::Keys::generate();
        let event = EventBuilder::new(Kind::Custom(KIND_ASK_HEAD as u16), "{}")
            .sign_with_keys(&keys)
            .expect("sign head event");
        let stored = StoredEvent::with_received_at(
            event.clone(),
            chrono::Utc::now(),
            Some(Uuid::from_u128(4)),
            true,
        );
        let stale = ensure_expected_head(Some(&"0".repeat(64)), &stored)
            .expect_err("stale head must conflict");
        let current_id = event.id.to_hex();
        assert!(matches!(
            stale,
            IngestError::Rejected(message) if message.contains(&current_id)
        ));
    }
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use crate::handlers::company_records;

    use buzz_core::company_records::{
        AskCategory, AskOption, AskType, COMPANY_RECORD_SCHEMA_VERSION,
    };
    use buzz_core::kind::KIND_STREAM_MESSAGE;
    use buzz_core::tenant::CommunityId;
    use buzz_db::channel::{ChannelType, ChannelVisibility};
    use buzz_db::channel_members::MemberRole;
    use nostr::Keys;
    use serde::Serialize;
    use std::time::Duration;

    static ASK_DB_TEST_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
        std::sync::OnceLock::new();

    struct Fixture {
        state: Arc<AppState>,
        tenant: TenantContext,
        _pool: sqlx::PgPool,
        _serial_guard: tokio::sync::MutexGuard<'static, ()>,
        owner: Keys,
        channel_id: Uuid,
        root: Event,
    }

    async fn fixture() -> Fixture {
        let serial_guard = ASK_DB_TEST_LOCK
            .get_or_init(|| tokio::sync::Mutex::new(()))
            .lock()
            .await;
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .expect("BUZZ_TEST_DATABASE_URL must name the disposable test database");
        let pool = sqlx::PgPool::connect(&database_url)
            .await
            .expect("connect to the disposable test database");
        let state = crate::state::tests::test_state_with_database_url_and_acquire_timeout(
            &database_url,
            Duration::from_secs(10),
        )
        .await;
        let community_uuid = Uuid::new_v4();
        let host = format!("ask-records-{}.test", community_uuid.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_uuid)
            .bind(&host)
            .execute(&pool)
            .await
            .expect("insert test community");
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_uuid), host);
        let owner = Keys::generate();
        state
            .db
            .ensure_user(tenant.community(), &owner.public_key().to_bytes())
            .await
            .expect("ensure owner identity");
        state
            .db
            .add_relay_member(
                tenant.community(),
                &owner.public_key().to_hex(),
                "owner",
                None,
            )
            .await
            .expect("add community owner");
        let channel = state
            .db
            .create_channel(
                tenant.community(),
                &format!("asks-{}", Uuid::new_v4().simple()),
                ChannelType::Stream,
                ChannelVisibility::Private,
                None,
                &owner.public_key().to_bytes(),
                None,
            )
            .await
            .expect("create private stream");
        let root = EventBuilder::new(Kind::Custom(KIND_STREAM_MESSAGE as u16), "Ask thread")
            .tags([Tag::parse(["h", channel.id.to_string().as_str()]).expect("h tag")])
            .sign_with_keys(&owner)
            .expect("sign thread root");
        state
            .db
            .insert_event(tenant.community(), &root, Some(channel.id))
            .await
            .expect("store thread root");
        Fixture {
            state,
            tenant,
            _pool: pool,
            _serial_guard: serial_guard,
            owner,
            channel_id: channel.id,
            root,
        }
    }

    async fn add_actor(
        fixture: &Fixture,
        keys: &Keys,
        relay_role: Option<&str>,
        is_agent: bool,
        channel_member: bool,
    ) {
        let pubkey = keys.public_key().to_bytes();
        fixture
            .state
            .db
            .ensure_user(fixture.tenant.community(), &pubkey)
            .await
            .expect("ensure actor identity");
        if let Some(role) = relay_role {
            fixture
                .state
                .db
                .add_relay_member(
                    fixture.tenant.community(),
                    &keys.public_key().to_hex(),
                    role,
                    Some(&fixture.owner.public_key().to_hex()),
                )
                .await
                .expect("add relay member");
        }
        if is_agent {
            fixture
                .state
                .db
                .set_agent_owner(
                    fixture.tenant.community(),
                    &pubkey,
                    &fixture.owner.public_key().to_bytes(),
                )
                .await
                .expect("bind managed agent owner");
        }
        if channel_member
            && fixture
                .state
                .db
                .get_member_role(fixture.tenant.community(), fixture.channel_id, &pubkey)
                .await
                .expect("read channel membership")
                .is_none()
        {
            fixture
                .state
                .db
                .add_member(
                    fixture.tenant.community(),
                    fixture.channel_id,
                    &pubkey,
                    MemberRole::Member,
                    Some(&fixture.owner.public_key().to_bytes()),
                )
                .await
                .expect("add channel member");
        }
    }

    fn auth(keys: &Keys) -> IngestAuth {
        IngestAuth::Http {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            auth_method: super::super::ingest::HttpAuthMethod::DevPubkey,
        }
    }

    fn ask_record(
        ask_id: Uuid,
        thread_root_event_id: &str,
        ask_type: AskType,
        category: AskCategory,
    ) -> AskRecord {
        let tool_consent = (ask_type == AskType::ToolConsent).then(|| {
            buzz_core::company_records::ToolConsentPreview {
                action: buzz_core::company_records::ToolPermissionVerb::MessageOutsider,
                action_preview: "Send this email to x@y.com: The approved draft".into(),
            }
        });
        let (options, items) = match ask_type {
            AskType::Choice => (
                Some(vec![
                    AskOption {
                        id: "one".into(),
                        label: "One".into(),
                    },
                    AskOption {
                        id: "two".into(),
                        label: "Two".into(),
                    },
                ]),
                None,
            ),
            AskType::Checklist => (
                None,
                Some(vec![AskOption {
                    id: "brief".into(),
                    label: "Brief".into(),
                }]),
            ),
            _ => (None, None),
        };
        AskRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id,
            ask_type,
            category,
            title: "Review the launch plan".into(),
            body: None,
            thread_root_event_id: thread_root_event_id.into(),
            addressee_pubkey: None,
            decide_by: (ask_type == AskType::ToolConsent)
                .then(|| (Utc::now() + chrono::Duration::minutes(2)).to_rfc3339()),
            options,
            items,
            tool_consent,
            subject: None,
            secret_request: (category == AskCategory::Secret).then(|| {
                buzz_core::company_records::SecretAskRequest {
                    tool_name: "Social publishing".into(),
                    client_name: Some("Olive Studio".into()),
                    allowed_use: "Prepare campaign drafts".into(),
                }
            }),
        }
    }

    fn sign_command<T: Serialize>(
        keys: &Keys,
        kind: u32,
        channel_id: Uuid,
        d_tag: &str,
        content: &T,
        thread_root: Option<&str>,
    ) -> Event {
        let mut tags = vec![
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("h tag"),
            Tag::parse(["d", d_tag]).expect("d tag"),
        ];
        if let Some(root_id) = thread_root {
            tags.push(Tag::parse(["e", root_id, "", "root"]).expect("root e tag"));
            tags.push(Tag::parse(["e", root_id, "", "reply"]).expect("reply e tag"));
        }
        EventBuilder::new(
            Kind::Custom(kind as u16),
            serde_json::to_string(content).expect("serialize command"),
        )
        .tags(tags)
        .sign_with_keys(keys)
        .expect("sign command")
    }

    fn sign_secret_action(
        keys: &Keys,
        action: &buzz_core::company_records::SecretBindingAction,
    ) -> Event {
        buzz_sdk::company_records::build_secret_binding_action(action)
            .expect("build secret binding action")
            .sign_with_keys(keys)
            .expect("sign secret binding action")
    }

    async fn secret_binding_head(fixture: &Fixture, binding_id: Uuid) -> StoredEvent {
        let d_tag = buzz_core::company_records::secret_binding_d_tag(binding_id);
        let mut query = EventQuery::for_community(fixture.tenant.community());
        query.kinds = Some(vec![buzz_core::kind::KIND_SECRET_BINDING_HEAD as i32]);
        query.pubkey = Some(fixture.state.relay_keypair.public_key().to_bytes().to_vec());
        query.d_tag = Some(d_tag);
        query.global_only = true;
        query.limit = Some(2);
        fixture
            .state
            .db
            .query_events_for_event_write(&query)
            .await
            .expect("query secret binding head")
            .pop()
            .expect("secret binding head exists")
    }

    async fn create_ask(
        fixture: &Fixture,
        keys: &Keys,
        mut ask: AskRecord,
    ) -> (Event, StoredEvent) {
        ask.thread_root_event_id = fixture.root.id.to_hex();
        let d_tag = buzz_core::company_records::ask_d_tag(fixture.channel_id, ask.ask_id);
        let action = AskAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id: ask.ask_id,
            action: AskActionKind::Create,
            expected_head_event_id: None,
            ask: Some(ask),
            reason: None,
        };
        let event = sign_command(
            keys,
            KIND_ASK_ACTION,
            fixture.channel_id,
            &d_tag,
            &action,
            Some(&fixture.root.id.to_hex()),
        );
        company_records::handle(&fixture.tenant, &fixture.state, event.clone(), auth(keys))
            .await
            .expect("create ask through production handler");
        let head = current_ask_head(&fixture.state, &fixture.tenant, fixture.channel_id, &d_tag)
            .await
            .expect("load ask head")
            .expect("ask head was created");
        (event, head)
    }

    fn response(ask_id: Uuid, expected_head_event_id: &str, ask_type: AskType) -> AskResponse {
        match ask_type {
            AskType::Approval | AskType::ToolConsent => AskResponse {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                ask_id,
                expected_head_event_id: expected_head_event_id.into(),
                outcome: buzz_core::company_records::AskOutcome::Approved,
                reason: Some("Approved for this release".into()),
                answer: None,
                option_id: None,
                checked_item_ids: None,
                secret_binding_id: None,
            },
            AskType::Question => AskResponse {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                ask_id,
                expected_head_event_id: expected_head_event_id.into(),
                outcome: buzz_core::company_records::AskOutcome::Answered,
                reason: None,
                answer: Some("The brief is ready".into()),
                option_id: None,
                checked_item_ids: None,
                secret_binding_id: None,
            },
            AskType::Choice => AskResponse {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                ask_id,
                expected_head_event_id: expected_head_event_id.into(),
                outcome: buzz_core::company_records::AskOutcome::Chosen,
                reason: None,
                answer: None,
                option_id: Some("one".into()),
                checked_item_ids: None,
                secret_binding_id: None,
            },
            AskType::Checklist => AskResponse {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                ask_id,
                expected_head_event_id: expected_head_event_id.into(),
                outcome: buzz_core::company_records::AskOutcome::Confirmed,
                reason: None,
                answer: None,
                option_id: None,
                checked_item_ids: Some(vec!["brief".into()]),
                secret_binding_id: None,
            },
            AskType::Verdict => AskResponse {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                ask_id,
                expected_head_event_id: expected_head_event_id.into(),
                outcome: buzz_core::company_records::AskOutcome::Pass,
                reason: Some("The work meets the done condition".into()),
                answer: None,
                option_id: None,
                checked_item_ids: None,
                secret_binding_id: None,
            },
        }
    }

    fn sign_response(keys: &Keys, channel_id: Uuid, response: &AskResponse) -> Event {
        let d_tag = buzz_core::company_records::ask_d_tag(channel_id, response.ask_id);
        sign_command(keys, KIND_ASK_RESPONSE, channel_id, &d_tag, response, None)
    }

    fn sign_response_with_agent_claim(
        keys: &Keys,
        channel_id: Uuid,
        response: &AskResponse,
        claimed_agent_pubkey: &str,
    ) -> Event {
        let d_tag = buzz_core::company_records::ask_d_tag(channel_id, response.ask_id);
        EventBuilder::new(
            Kind::Custom(KIND_ASK_RESPONSE as u16),
            serde_json::to_string(response).expect("serialize response"),
        )
        .tags([
            Tag::parse(["h", channel_id.to_string().as_str()]).expect("h tag"),
            Tag::parse(["d", d_tag.as_str()]).expect("d tag"),
            Tag::parse(["agent", claimed_agent_pubkey]).expect("agent claim tag"),
        ])
        .sign_with_keys(keys)
        .expect("sign response with client agent claim")
    }

    fn sign_cancel(
        keys: &Keys,
        channel_id: Uuid,
        ask_id: Uuid,
        expected_head_event_id: &str,
    ) -> Event {
        let d_tag = buzz_core::company_records::ask_d_tag(channel_id, ask_id);
        let action = AskAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id,
            action: AskActionKind::Cancel,
            expected_head_event_id: Some(expected_head_event_id.into()),
            ask: None,
            reason: Some("The request is no longer needed".into()),
        };
        sign_command(keys, KIND_ASK_ACTION, channel_id, &d_tag, &action, None)
    }

    async fn response_for(
        fixture: &Fixture,
        keys: &Keys,
        head: &StoredEvent,
        ask_type: AskType,
    ) -> (Event, Result<IngestResult, IngestError>) {
        let head_content = parse_head(&head.event).expect("parse current head");
        let response = response(head_content.ask_id, &head.event.id.to_hex(), ask_type);
        let event = sign_response(keys, fixture.channel_id, &response);
        let result =
            company_records::handle(&fixture.tenant, &fixture.state, event.clone(), auth(keys))
                .await;
        (event, result)
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn create_reply_counts_overdue_stays_open_and_terminal_commands_are_not_thread_items() {
        let fixture = fixture().await;
        let mut overdue = ask_record(
            Uuid::new_v4(),
            &fixture.root.id.to_hex(),
            AskType::Question,
            AskCategory::General,
        );
        overdue.decide_by = Some("2020-01-01T00:00:00Z".into());
        let (create_event, head_event) = create_ask(&fixture, &fixture.owner, overdue).await;
        let head = parse_head(&head_event.event).expect("parse ask head");
        assert_eq!(head.status, AskStatus::Open);
        assert!(head.resolution.is_none());
        assert_eq!(head.ask.decide_by.as_deref(), Some("2020-01-01T00:00:00Z"));
        assert_eq!(
            head_event.event.pubkey,
            fixture.state.relay_keypair.public_key()
        );
        assert!(head_event
            .event
            .tags
            .iter()
            .any(|tag| tag.kind().to_string() == "e"));
        let create_meta = fixture
            .state
            .db
            .get_thread_metadata_by_event(fixture.tenant.community(), &create_event.id.to_bytes())
            .await
            .expect("load create metadata")
            .expect("create event has thread metadata");
        assert_eq!(create_meta.depth, 1);
        let root_meta = fixture
            .state
            .db
            .get_thread_metadata_by_event(fixture.tenant.community(), &fixture.root.id.to_bytes())
            .await
            .expect("load root metadata")
            .expect("root metadata exists");
        assert_eq!(root_meta.reply_count, 1);
        assert_eq!(root_meta.descendant_count, 1);

        let cancel_event = sign_cancel(
            &fixture.owner,
            fixture.channel_id,
            head.ask_id,
            &head_event.event.id.to_hex(),
        );
        company_records::handle(
            &fixture.tenant,
            &fixture.state,
            cancel_event.clone(),
            auth(&fixture.owner),
        )
        .await
        .expect("asker cancels ask");
        assert!(fixture
            .state
            .db
            .get_thread_metadata_by_event(fixture.tenant.community(), &cancel_event.id.to_bytes(),)
            .await
            .expect("load cancellation metadata")
            .is_none());
        let cancelled = current_ask_head(
            &fixture.state,
            &fixture.tenant,
            fixture.channel_id,
            &buzz_core::company_records::ask_d_tag(fixture.channel_id, head.ask_id),
        )
        .await
        .expect("load cancelled head")
        .expect("cancelled head exists");
        assert_eq!(
            parse_head(&cancelled.event)
                .expect("parse cancelled")
                .status,
            AskStatus::Cancelled
        );

        let (_, resolved_head) = create_ask(
            &fixture,
            &fixture.owner,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let (response_event, result) =
            response_for(&fixture, &fixture.owner, &resolved_head, AskType::Question).await;
        result.expect("member answers question");
        assert!(
            fixture
                .state
                .db
                .get_thread_metadata_by_event(
                    fixture.tenant.community(),
                    &response_event.id.to_bytes(),
                )
                .await
                .expect("load response metadata")
                .is_none()
        );
        let root_meta = fixture
            .state
            .db
            .get_thread_metadata_by_event(fixture.tenant.community(), &fixture.root.id.to_bytes())
            .await
            .expect("reload root metadata")
            .expect("root metadata remains");
        assert_eq!(root_meta.reply_count, 2);
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn relay_enforces_category_addressee_agent_and_channel_authority() {
        let fixture = fixture().await;
        let owner = fixture.owner.clone();
        let admin = Keys::generate();
        let member = Keys::generate();
        let other_member = Keys::generate();
        let agent = Keys::generate();
        let outside = Keys::generate();
        add_actor(&fixture, &admin, Some("admin"), false, true).await;
        add_actor(&fixture, &member, Some("member"), false, true).await;
        add_actor(&fixture, &other_member, Some("member"), false, true).await;
        add_actor(&fixture, &agent, Some("member"), true, true).await;
        add_actor(&fixture, &outside, Some("member"), false, false).await;

        for category in [AskCategory::Money, AskCategory::Hire, AskCategory::Tool] {
            for (resolver, expected_reason) in [
                (
                    &member,
                    Some("Only company owners and admins can decide this"),
                ),
                (&owner, None),
                (&admin, None),
                (
                    &agent,
                    Some("Agents cannot decide spending, hires, tools or secrets"),
                ),
            ] {
                let ask = ask_record(
                    Uuid::new_v4(),
                    &fixture.root.id.to_hex(),
                    AskType::Approval,
                    category,
                );
                let (_, head) = create_ask(&fixture, &owner, ask).await;
                let (response_event, result) =
                    response_for(&fixture, resolver, &head, AskType::Approval).await;
                match expected_reason {
                    Some(reason) => {
                        assert!(matches!(
                            result,
                            Err(IngestError::AuthFailed(message)) if message.contains(reason)
                        ));
                        assert!(fixture
                            .state
                            .db
                            .get_event_by_id_for_event_write(
                                fixture.tenant.community(),
                                &response_event.id.to_bytes(),
                            )
                            .await
                            .expect("check denied response was not stored")
                            .is_none());
                    }
                    None => {
                        assert!(
                            result
                                .expect("owner or admin resolves protected ask")
                                .accepted
                        );
                    }
                }
            }
        }

        let unaddressed = ask_record(
            Uuid::new_v4(),
            &fixture.root.id.to_hex(),
            AskType::Question,
            AskCategory::General,
        );
        let (_, head) = create_ask(&fixture, &owner, unaddressed).await;
        let (_, denied) = response_for(&fixture, &agent, &head, AskType::Question).await;
        assert!(matches!(
            denied,
            Err(IngestError::AuthFailed(message)) if message.contains("Only people can answer")
        ));
        let (_, accepted) = response_for(&fixture, &member, &head, AskType::Question).await;
        assert!(
            accepted
                .expect("channel human answers unaddressed ask")
                .accepted
        );

        let (_, head) = create_ask(
            &fixture,
            &owner,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let (_, denied) = response_for(&fixture, &outside, &head, AskType::Question).await;
        assert!(matches!(
            denied,
            Err(IngestError::AuthFailed(message))
                if message.contains("Only members of this conversation can answer")
        ));

        let addressed = ask_record(
            Uuid::new_v4(),
            &fixture.root.id.to_hex(),
            AskType::Question,
            AskCategory::General,
        );
        let mut addressed = addressed;
        addressed.addressee_pubkey = Some(other_member.public_key().to_hex());
        let (_, head) = create_ask(&fixture, &owner, addressed).await;
        let (_, denied) = response_for(&fixture, &member, &head, AskType::Question).await;
        assert!(matches!(
            denied,
            Err(IngestError::AuthFailed(message)) if message.contains("addressed to someone else")
        ));
        let (_, accepted) = response_for(&fixture, &other_member, &head, AskType::Question).await;
        assert!(accepted.expect("named human addressee answers").accepted);

        for ask_type in [AskType::Question, AskType::Verdict] {
            let mut addressed = ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                ask_type,
                AskCategory::General,
            );
            addressed.addressee_pubkey = Some(agent.public_key().to_hex());
            let (_, head) = create_ask(&fixture, &owner, addressed).await;
            let (_, accepted) = response_for(&fixture, &agent, &head, ask_type).await;
            assert!(
                accepted
                    .expect("agent answers addressed question or verdict")
                    .accepted
            );
        }

        let mut agent_approval = ask_record(
            Uuid::new_v4(),
            &fixture.root.id.to_hex(),
            AskType::Approval,
            AskCategory::General,
        );
        agent_approval.addressee_pubkey = Some(agent.public_key().to_hex());
        let d_tag =
            buzz_core::company_records::ask_d_tag(fixture.channel_id, agent_approval.ask_id);
        let action = AskAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id: agent_approval.ask_id,
            action: AskActionKind::Create,
            expected_head_event_id: None,
            ask: Some(agent_approval),
            reason: None,
        };
        let create_event = sign_command(
            &owner,
            KIND_ASK_ACTION,
            fixture.channel_id,
            &d_tag,
            &action,
            Some(&fixture.root.id.to_hex()),
        );
        assert!(matches!(
            company_records::handle(&fixture.tenant, &fixture.state, create_event.clone(), auth(&owner)).await,
            Err(IngestError::Rejected(message)) if message.contains("an agent can only be asked a question or a verdict")
        ));
        assert!(fixture
            .state
            .db
            .get_event_by_id_for_event_write(
                fixture.tenant.community(),
                &create_event.id.to_bytes(),
            )
            .await
            .expect("check rejected ask create")
            .is_none());

        let unmember_ask = ask_record(
            Uuid::new_v4(),
            &fixture.root.id.to_hex(),
            AskType::Question,
            AskCategory::General,
        );
        let d_tag = buzz_core::company_records::ask_d_tag(fixture.channel_id, unmember_ask.ask_id);
        let action = AskAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id: unmember_ask.ask_id,
            action: AskActionKind::Create,
            expected_head_event_id: None,
            ask: Some(unmember_ask),
            reason: None,
        };
        let event = sign_command(
            &outside,
            KIND_ASK_ACTION,
            fixture.channel_id,
            &d_tag,
            &action,
            Some(&fixture.root.id.to_hex()),
        );
        assert!(matches!(
            company_records::handle(&fixture.tenant, &fixture.state, event.clone(), auth(&outside)).await,
            Err(IngestError::AuthFailed(message)) if message.contains("channel members")
        ));
        assert!(fixture
            .state
            .db
            .get_event_by_id_for_event_write(fixture.tenant.community(), &event.id.to_bytes())
            .await
            .expect("check nonmember command")
            .is_none());
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn tool_consent_is_agent_created_and_resolved_only_by_owner_or_admin() {
        let fixture = fixture().await;
        let agent = Keys::generate();
        let member = Keys::generate();
        let admin = Keys::generate();
        add_actor(&fixture, &agent, Some("member"), true, true).await;
        add_actor(&fixture, &member, Some("member"), false, true).await;
        add_actor(&fixture, &admin, Some("admin"), false, false).await;

        let ask = ask_record(
            Uuid::new_v4(),
            &fixture.root.id.to_hex(),
            AskType::ToolConsent,
            AskCategory::Tool,
        );
        let d_tag = buzz_core::company_records::ask_d_tag(fixture.channel_id, ask.ask_id);
        let action = AskAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            ask_id: ask.ask_id,
            action: AskActionKind::Create,
            expected_head_event_id: None,
            ask: Some(ask.clone()),
            reason: None,
        };
        let member_command = sign_command(
            &member,
            KIND_ASK_ACTION,
            fixture.channel_id,
            &d_tag,
            &action,
            Some(&fixture.root.id.to_hex()),
        );
        assert!(matches!(
            company_records::handle(
                &fixture.tenant,
                &fixture.state,
                member_command,
                auth(&member)
            )
            .await,
            Err(IngestError::AuthFailed(message))
                if message.contains("managed agent")
        ));

        let (_, head) = create_ask(&fixture, &agent, ask).await;
        let (agent_response, agent_result) =
            response_for(&fixture, &agent, &head, AskType::ToolConsent).await;
        assert!(matches!(
            agent_result,
            Err(IngestError::AuthFailed(message))
                if message.contains("Agents cannot decide")
        ));
        assert!(fixture
            .state
            .db
            .get_event_by_id_for_event_write(
                fixture.tenant.community(),
                &agent_response.id.to_bytes(),
            )
            .await
            .expect("check agent response was not stored")
            .is_none());

        let (member_response, member_result) =
            response_for(&fixture, &member, &head, AskType::ToolConsent).await;
        assert!(matches!(
            member_result,
            Err(IngestError::AuthFailed(message))
                if message.contains("Only company owners and admins")
        ));
        assert!(fixture
            .state
            .db
            .get_event_by_id_for_event_write(
                fixture.tenant.community(),
                &member_response.id.to_bytes(),
            )
            .await
            .expect("check member response was not stored")
            .is_none());

        let (_, admin_result) = response_for(&fixture, &admin, &head, AskType::ToolConsent).await;
        assert!(
            admin_result
                .expect("community admin can resolve a tool consent outside the channel")
                .accepted
        );
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn relay_enforces_cancel_authority_and_exact_head() {
        let fixture = fixture().await;
        let asker = Keys::generate();
        let other_member = Keys::generate();
        let admin = Keys::generate();
        let outside = Keys::generate();
        add_actor(&fixture, &asker, Some("member"), false, true).await;
        add_actor(&fixture, &other_member, Some("member"), false, true).await;
        add_actor(&fixture, &admin, Some("admin"), false, true).await;
        add_actor(&fixture, &outside, Some("member"), false, false).await;

        let (_, head) = create_ask(
            &fixture,
            &asker,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let current = parse_head(&head.event).expect("parse ask head");

        let stale_head_id = "0".repeat(64);
        let stale_event = sign_cancel(
            &other_member,
            fixture.channel_id,
            current.ask_id,
            &stale_head_id,
        );
        assert!(matches!(
            company_records::handle(
                &fixture.tenant,
                &fixture.state,
                stale_event.clone(),
                auth(&other_member),
            )
            .await,
            Err(IngestError::Rejected(message)) if message.contains("current head is")
        ));
        assert!(
            fixture
                .state
                .db
                .get_event_by_id_for_event_write(
                    fixture.tenant.community(),
                    &stale_event.id.to_bytes(),
                )
                .await
                .expect("check stale cancel was not stored")
                .is_none()
        );

        let unauthorized_event = sign_cancel(
            &other_member,
            fixture.channel_id,
            current.ask_id,
            &head.event.id.to_hex(),
        );
        assert!(matches!(
            company_records::handle(
                &fixture.tenant,
                &fixture.state,
                unauthorized_event.clone(),
                auth(&other_member),
            )
            .await,
            Err(IngestError::AuthFailed(message)) if message.contains("only the asker or a company owner or admin")
        ));
        assert!(fixture
            .state
            .db
            .get_event_by_id_for_event_write(
                fixture.tenant.community(),
                &unauthorized_event.id.to_bytes(),
            )
            .await
            .expect("check unauthorized cancel was not stored")
            .is_none());

        let owner_cancel = sign_cancel(
            &fixture.owner,
            fixture.channel_id,
            current.ask_id,
            &head.event.id.to_hex(),
        );
        company_records::handle(
            &fixture.tenant,
            &fixture.state,
            owner_cancel,
            auth(&fixture.owner),
        )
        .await
        .expect("company owner cancels ask");

        let (_, admin_head) = create_ask(
            &fixture,
            &asker,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let admin_ask = parse_head(&admin_head.event).expect("parse admin ask");
        let admin_cancel = sign_cancel(
            &admin,
            fixture.channel_id,
            admin_ask.ask_id,
            &admin_head.event.id.to_hex(),
        );
        company_records::handle(&fixture.tenant, &fixture.state, admin_cancel, auth(&admin))
            .await
            .expect("company admin cancels ask");

        let (_, asker_head) = create_ask(
            &fixture,
            &asker,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let asker_ask = parse_head(&asker_head.event).expect("parse asker ask");
        let asker_cancel = sign_cancel(
            &asker,
            fixture.channel_id,
            asker_ask.ask_id,
            &asker_head.event.id.to_hex(),
        );
        company_records::handle(&fixture.tenant, &fixture.state, asker_cancel, auth(&asker))
            .await
            .expect("asker cancels own ask");

        let (_, outside_head) = create_ask(
            &fixture,
            &asker,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let outside_ask = parse_head(&outside_head.event).expect("parse outside ask");
        let outside_cancel = sign_cancel(
            &outside,
            fixture.channel_id,
            outside_ask.ask_id,
            &outside_head.event.id.to_hex(),
        );
        assert!(matches!(
            company_records::handle(
                &fixture.tenant,
                &fixture.state,
                outside_cancel,
                auth(&outside),
            )
            .await,
            Err(IngestError::AuthFailed(message)) if message.contains("only channel members")
        ));
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn client_agent_tag_does_not_override_authoritative_human_identity() {
        let fixture = fixture().await;
        let human = Keys::generate();
        let claimed_agent = Keys::generate();
        add_actor(&fixture, &human, Some("member"), false, true).await;
        let (_, head) = create_ask(
            &fixture,
            &fixture.owner,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let current = parse_head(&head.event).expect("parse ask head");
        let response = response(current.ask_id, &head.event.id.to_hex(), AskType::Question);
        let event = sign_response_with_agent_claim(
            &human,
            fixture.channel_id,
            &response,
            &claimed_agent.public_key().to_hex(),
        );
        let result =
            company_records::handle(&fixture.tenant, &fixture.state, event, auth(&human)).await;
        assert!(result.expect("human record remains authoritative").accepted);
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn relay_rejects_wrong_type_payloads_with_reason_and_keeps_ask_open() {
        let fixture = fixture().await;
        for ask_type in [
            AskType::Approval,
            AskType::Question,
            AskType::Choice,
            AskType::Checklist,
            AskType::Verdict,
        ] {
            let (_, head) = create_ask(
                &fixture,
                &fixture.owner,
                ask_record(
                    Uuid::new_v4(),
                    &fixture.root.id.to_hex(),
                    ask_type,
                    AskCategory::General,
                ),
            )
            .await;
            let current = parse_head(&head.event).expect("parse current ask");
            let mut wrong = response(current.ask_id, &head.event.id.to_hex(), ask_type);
            wrong.outcome = match ask_type {
                AskType::Approval => buzz_core::company_records::AskOutcome::Answered,
                AskType::Question => buzz_core::company_records::AskOutcome::Approved,
                AskType::Choice => buzz_core::company_records::AskOutcome::Chosen,
                AskType::Checklist => buzz_core::company_records::AskOutcome::Confirmed,
                AskType::Verdict => buzz_core::company_records::AskOutcome::Approved,
                AskType::ToolConsent => buzz_core::company_records::AskOutcome::Answered,
            };
            if ask_type == AskType::Choice {
                wrong.option_id = Some("not-an-option".into());
            }
            if ask_type == AskType::Checklist {
                wrong.checked_item_ids = Some(Vec::new());
            }
            let response_event = sign_response(&fixture.owner, fixture.channel_id, &wrong);
            let result = company_records::handle(
                &fixture.tenant,
                &fixture.state,
                response_event.clone(),
                auth(&fixture.owner),
            )
            .await;
            assert!(matches!(
                result,
                Err(IngestError::Rejected(message)) if message.starts_with("invalid: ask response:")
            ));
            assert!(fixture
                .state
                .db
                .get_event_by_id_for_event_write(
                    fixture.tenant.community(),
                    &response_event.id.to_bytes(),
                )
                .await
                .expect("check invalid response missing")
                .is_none());
            let current = current_ask_head(
                &fixture.state,
                &fixture.tenant,
                fixture.channel_id,
                &buzz_core::company_records::ask_d_tag(fixture.channel_id, current.ask_id),
            )
            .await
            .expect("reload open ask")
            .expect("ask remains stored");
            assert_eq!(
                parse_head(&current.event).expect("parse head").status,
                AskStatus::Open
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn exact_head_lock_allows_only_one_of_two_concurrent_responses() {
        let fixture = fixture().await;
        let first_resolver = Keys::generate();
        let second_resolver = Keys::generate();
        add_actor(&fixture, &first_resolver, Some("member"), false, true).await;
        add_actor(&fixture, &second_resolver, Some("member"), false, true).await;
        let (_, head) = create_ask(
            &fixture,
            &fixture.owner,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let current = parse_head(&head.event).expect("parse ask head");
        let d_tag = buzz_core::company_records::ask_d_tag(fixture.channel_id, current.ask_id);
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let hook = install_ask_persist_test_barrier(d_tag, barrier);
        let first_response = response(current.ask_id, &head.event.id.to_hex(), AskType::Question);
        let second_response = response(current.ask_id, &head.event.id.to_hex(), AskType::Question);
        let first_event = sign_response(&first_resolver, fixture.channel_id, &first_response);
        let second_event = sign_response(&second_resolver, fixture.channel_id, &second_response);
        let tenant_a = fixture.tenant.clone();
        let tenant_b = fixture.tenant.clone();
        let state_a = Arc::clone(&fixture.state);
        let state_b = Arc::clone(&fixture.state);
        let task_a = tokio::spawn(async move {
            company_records::handle(&tenant_a, &state_a, first_event, auth(&first_resolver)).await
        });
        let task_b = tokio::spawn(async move {
            company_records::handle(&tenant_b, &state_b, second_event, auth(&second_resolver)).await
        });
        let result_a = task_a.await.expect("join first resolution");
        let result_b = task_b.await.expect("join second resolution");
        drop(hook);
        let successes = usize::from(result_a.as_ref().is_ok_and(|result| result.accepted))
            + usize::from(result_b.as_ref().is_ok_and(|result| result.accepted));
        assert_eq!(successes, 1);
        let failure = if result_a.is_err() {
            result_a
        } else {
            result_b
        };
        assert!(matches!(
            failure,
            Err(IngestError::Rejected(message)) if message.contains("current head is")
        ));
        let final_head = current_ask_head(
            &fixture.state,
            &fixture.tenant,
            fixture.channel_id,
            &buzz_core::company_records::ask_d_tag(fixture.channel_id, current.ask_id),
        )
        .await
        .expect("reload resolved ask")
        .expect("resolved head remains");
        assert_eq!(
            parse_head(&final_head.event)
                .expect("parse final head")
                .status,
            AskStatus::Resolved
        );
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn cancel_and_resolution_share_the_same_exact_head_lock() {
        let fixture = fixture().await;
        let resolver = Keys::generate();
        add_actor(&fixture, &resolver, Some("member"), false, true).await;
        let (_, head) = create_ask(
            &fixture,
            &fixture.owner,
            ask_record(
                Uuid::new_v4(),
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::General,
            ),
        )
        .await;
        let current = parse_head(&head.event).expect("parse ask head");
        let d_tag = buzz_core::company_records::ask_d_tag(fixture.channel_id, current.ask_id);
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let hook = install_ask_persist_test_barrier(d_tag, barrier);
        let cancel_event = sign_cancel(
            &fixture.owner,
            fixture.channel_id,
            current.ask_id,
            &head.event.id.to_hex(),
        );
        let response = response(current.ask_id, &head.event.id.to_hex(), AskType::Question);
        let response_event = sign_response(&resolver, fixture.channel_id, &response);
        let tenant_a = fixture.tenant.clone();
        let tenant_b = fixture.tenant.clone();
        let state_a = Arc::clone(&fixture.state);
        let state_b = Arc::clone(&fixture.state);
        let asker = fixture.owner.clone();
        let task_cancel = tokio::spawn(async move {
            company_records::handle(&tenant_a, &state_a, cancel_event, auth(&asker)).await
        });
        let task_response = tokio::spawn(async move {
            company_records::handle(&tenant_b, &state_b, response_event, auth(&resolver)).await
        });
        let cancel_result = task_cancel.await.expect("join cancellation");
        let response_result = task_response.await.expect("join resolution");
        drop(hook);
        let successes = usize::from(cancel_result.as_ref().is_ok_and(|result| result.accepted))
            + usize::from(response_result.as_ref().is_ok_and(|result| result.accepted));
        assert_eq!(successes, 1);
        let failure = if cancel_result.is_err() {
            cancel_result
        } else {
            response_result
        };
        assert!(matches!(
            failure,
            Err(IngestError::Rejected(message)) if message.contains("current head is")
        ));
        let final_head = current_ask_head(
            &fixture.state,
            &fixture.tenant,
            fixture.channel_id,
            &buzz_core::company_records::ask_d_tag(fixture.channel_id, current.ask_id),
        )
        .await
        .expect("reload terminal ask")
        .expect("terminal head remains");
        assert!(matches!(
            parse_head(&final_head.event)
                .expect("parse final head")
                .status,
            AskStatus::Resolved | AskStatus::Cancelled
        ));
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn secret_binding_authority_activation_and_revocation_use_exact_heads() {
        use buzz_core::company_records::{
            SecretAskCoordinate, SecretBindingAction, SecretBindingActionKind, SecretBindingHead,
            SecretBindingSpec, SecretBindingStatus, SecretStorage,
        };

        let fixture = fixture().await;
        let admin = Keys::generate();
        let member = Keys::generate();
        let agent = Keys::generate();
        add_actor(&fixture, &admin, Some("admin"), false, true).await;
        add_actor(&fixture, &member, Some("member"), false, true).await;
        add_actor(&fixture, &agent, Some("member"), true, true).await;

        let ask_id = Uuid::new_v4();
        let (_, original_ask_head) = create_ask(
            &fixture,
            &agent,
            ask_record(
                ask_id,
                &fixture.root.id.to_hex(),
                AskType::Question,
                AskCategory::Secret,
            ),
        )
        .await;
        let binding_id = Uuid::new_v4();
        let create = SecretBindingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            action: SecretBindingActionKind::Create,
            expected_head_event_id: None,
            binding: Some(SecretBindingSpec {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                binding_id,
                name: "Publishing credential".into(),
                employee_pubkey: agent.public_key().to_hex(),
                tool_name: "Social publishing".into(),
                allowed_use: "Prepare campaign drafts".into(),
                storage: SecretStorage::Device,
                source_ask: Some(SecretAskCoordinate {
                    channel_id: fixture.channel_id,
                    ask_id,
                }),
            }),
        };

        let denied = company_records::handle(
            &fixture.tenant,
            &fixture.state,
            sign_secret_action(&member, &create),
            auth(&member),
        )
        .await;
        assert!(matches!(
            denied,
            Err(IngestError::Rejected(message)) if message.contains("owner or admin")
        ));
        let denied_agent = company_records::handle(
            &fixture.tenant,
            &fixture.state,
            sign_secret_action(&agent, &create),
            auth(&agent),
        )
        .await;
        assert!(matches!(
            denied_agent,
            Err(IngestError::Rejected(message)) if message.contains("managed agents")
        ));

        company_records::handle(
            &fixture.tenant,
            &fixture.state,
            sign_secret_action(&fixture.owner, &create),
            auth(&fixture.owner),
        )
        .await
        .expect("owner creates pending binding");
        let pending = secret_binding_head(&fixture, binding_id).await;
        let pending_head = serde_json::from_str::<SecretBindingHead>(&pending.event.content)
            .expect("parse pending binding");
        assert_eq!(pending_head.status, SecretBindingStatus::Pending);

        let stale = SecretBindingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            action: SecretBindingActionKind::Activate,
            expected_head_event_id: Some("00".repeat(32)),
            binding: None,
        };
        let stale_result = company_records::handle(
            &fixture.tenant,
            &fixture.state,
            sign_secret_action(&admin, &stale),
            auth(&admin),
        )
        .await;
        assert!(matches!(
            stale_result,
            Err(IngestError::Rejected(message)) if message.contains("current head is")
        ));

        let activation = SecretBindingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            action: SecretBindingActionKind::Activate,
            expected_head_event_id: Some(pending.event.id.to_hex()),
            binding: None,
        };
        company_records::handle(
            &fixture.tenant,
            &fixture.state,
            sign_secret_action(&admin, &activation),
            auth(&admin),
        )
        .await
        .expect("admin activates binding");
        let active = secret_binding_head(&fixture, binding_id).await;
        let active_head = serde_json::from_str::<SecretBindingHead>(&active.event.content)
            .expect("parse active binding");
        assert_eq!(active_head.status, SecretBindingStatus::Active);
        let resolved_ask = current_ask_head(
            &fixture.state,
            &fixture.tenant,
            fixture.channel_id,
            &buzz_core::company_records::ask_d_tag(fixture.channel_id, ask_id),
        )
        .await
        .expect("load resolved secret ask")
        .expect("secret ask head exists");
        let resolved_ask = parse_head(&resolved_ask.event).expect("parse resolved ask");
        assert_eq!(resolved_ask.status, AskStatus::Resolved);
        let resolution = resolved_ask.resolution.expect("secret ask resolution");
        assert_eq!(
            resolution.response.outcome,
            buzz_core::company_records::AskOutcome::SecretBound
        );
        assert_eq!(resolution.response.secret_binding_id, Some(binding_id));
        assert_eq!(
            resolution.response_event_id,
            active_head.source_action_event_id
        );
        assert_eq!(
            parse_head(&original_ask_head.event)
                .expect("original ask snapshot")
                .status,
            AskStatus::Open
        );

        let revoke = SecretBindingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            action: SecretBindingActionKind::Revoke,
            expected_head_event_id: Some(active.event.id.to_hex()),
            binding: None,
        };
        company_records::handle(
            &fixture.tenant,
            &fixture.state,
            sign_secret_action(&admin, &revoke),
            auth(&admin),
        )
        .await
        .expect("admin revokes binding");
        let revoked = secret_binding_head(&fixture, binding_id).await;
        let revoked_head = serde_json::from_str::<SecretBindingHead>(&revoked.event.content)
            .expect("parse revoked binding");
        assert_eq!(revoked_head.status, SecretBindingStatus::Revoked);

        let duplicate = SecretBindingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            action: SecretBindingActionKind::Revoke,
            expected_head_event_id: Some(revoked.event.id.to_hex()),
            binding: None,
        };
        let duplicate_result = company_records::handle(
            &fixture.tenant,
            &fixture.state,
            sign_secret_action(&admin, &duplicate),
            auth(&admin),
        )
        .await;
        assert!(matches!(
            duplicate_result,
            Err(IngestError::Rejected(message)) if message.contains("already revoked")
        ));
    }
}
