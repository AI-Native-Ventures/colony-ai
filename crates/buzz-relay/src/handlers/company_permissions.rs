//! Nostr-first broker for community-wide standing tool permissions.
//!
//! Permission actions and relay-signed heads are global company records. Each
//! update uses an exact-head compare-and-swap in the same transaction as its
//! source action.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::{Event, EventBuilder, EventId, Kind, Tag};
use uuid::Uuid;

use buzz_core::business_records::{client_d_tag, ClientHead};
use buzz_core::company_records::{
    parse_company_command, validate_tool_permission_action, validate_tool_permission_d_tag,
    CompanyCommand, ToolPermissionAction, ToolPermissionCommandKind, ToolPermissionHead,
    ToolPermissionRecord, ToolPermissionStatus, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_CLIENT_HEAD, KIND_TOOL_PERMISSION_ACTION, KIND_TOOL_PERMISSION_HEAD};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles a member-signed standing permission mutation (kind 47035).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let kind = u32::from(event.kind.as_u16());
    let command = parse_company_command(kind, &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::ToolPermissionAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    if kind != KIND_TOOL_PERMISSION_ACTION {
        return Err(invalid("tool permission action has the wrong event kind"));
    }
    let d_tag = command_d_tag(&event, action.permission_id)?;
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write company permissions",
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
    if !is_admin(&role) {
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden(
            "only a community owner or admin can manage standing tool permissions",
        ));
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

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-permission:{}:{}",
            community_id.as_uuid(),
            action.permission_id
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_TOOL_PERMISSION_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_permission_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(IngestError::Internal(
            "error: permission head changed while its transaction lock was held".into(),
        ));
    }
    let current = current_stored
        .as_ref()
        .map(parse_permission_head)
        .transpose()?;
    if current
        .as_ref()
        .is_some_and(|head| head.permission_id != action.permission_id)
    {
        tx.rollback().await.map_err(internal)?;
        return Err(IngestError::Internal(
            "error: stored permission head does not match its d-tag".into(),
        ));
    }
    check_expected_head(&action, current_head_id.as_deref())?;
    let now = Utc::now();
    validate_tool_permission_action(&action, now)
        .map_err(|error| invalid(format!("tool permission action: {error}")))?;

    let next = next_permission_head(&event, &action, current.as_ref(), &actor_pubkey)?;
    if action.action != ToolPermissionCommandKind::Revoke {
        let permission = action
            .permission
            .as_ref()
            .ok_or_else(|| invalid("grant or update needs the permission"))?;
        if let Some(current) = &current {
            if current.permission.agent_pubkey != permission.agent_pubkey
                || current.permission.action != permission.action
            {
                tx.rollback().await.map_err(internal)?;
                return Err(invalid(
                    "an update can change only permission scope and expiry",
                ));
            }
        }
        ensure_managed_agent(state, tenant, &permission.agent_pubkey).await?;
        validate_scope_exists(state, tenant, permission).await?;
    }

    let head_event = relay_permission_head_event(&next, &d_tag, current_stored.as_ref(), state)?;
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
        return Err(conflict(
            "permission changed before the action could commit",
        ));
    }

    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_TOOL_PERMISSION_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_TOOL_PERMISSION_HEAD,
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

fn command_d_tag(event: &Event, permission_id: Uuid) -> Result<String, IngestError> {
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
            "permission commands require one d tag, no h tag, and no unsupported tags",
        ));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| invalid("permission command d tag must have a value"))?;
    validate_tool_permission_d_tag(d_tag, permission_id)
        .map_err(|error| invalid(format!("permission command d tag: {error}")))?;
    Ok(d_tag.to_owned())
}

fn check_expected_head(
    action: &ToolPermissionAction,
    current_head_id: Option<&[u8]>,
) -> Result<(), IngestError> {
    match (
        action.action,
        action.expected_head_event_id.as_deref(),
        current_head_id,
    ) {
        (ToolPermissionCommandKind::Grant, None, None) => Ok(()),
        (ToolPermissionCommandKind::Grant, _, Some(_)) => {
            Err(conflict("permission already exists"))
        }
        (_, Some(expected), Some(actual)) if expected == hex::encode(actual) => Ok(()),
        (_, Some(_), Some(actual)) => Err(conflict(format!(
            "permission changed; current head is {}",
            hex::encode(actual)
        ))),
        (_, _, None) => Err(conflict("permission does not exist")),
        _ => Err(invalid(
            "expectedHeadEventId does not match the permission action",
        )),
    }
}

fn next_permission_head(
    event: &Event,
    action: &ToolPermissionAction,
    current: Option<&ToolPermissionHead>,
    actor_pubkey: &str,
) -> Result<ToolPermissionHead, IngestError> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let (status, permission, granted_by_pubkey) = match action.action {
        ToolPermissionCommandKind::Grant => {
            if current.is_some() {
                return Err(conflict("permission already exists"));
            }
            (
                ToolPermissionStatus::Active,
                action
                    .permission
                    .clone()
                    .ok_or_else(|| invalid("grant needs the permission"))?,
                actor_pubkey.to_owned(),
            )
        }
        ToolPermissionCommandKind::Update => {
            let current = current.ok_or_else(|| conflict("permission does not exist"))?;
            if current.status != ToolPermissionStatus::Active {
                return Err(conflict("revoked permissions cannot be edited"));
            }
            (
                ToolPermissionStatus::Active,
                action
                    .permission
                    .clone()
                    .ok_or_else(|| invalid("update needs the permission"))?,
                current.granted_by_pubkey.clone(),
            )
        }
        ToolPermissionCommandKind::Revoke => {
            let current = current.ok_or_else(|| conflict("permission does not exist"))?;
            if current.status != ToolPermissionStatus::Active {
                return Err(conflict("permission is already revoked"));
            }
            (
                ToolPermissionStatus::Revoked,
                current.permission.clone(),
                current.granted_by_pubkey.clone(),
            )
        }
    };
    Ok(ToolPermissionHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        permission_id: action.permission_id,
        status,
        permission,
        granted_by_pubkey,
        changed_by_pubkey: actor_pubkey.to_owned(),
        updated_at: now,
        source_action_event_id: event.id.to_hex(),
    })
}

async fn ensure_managed_agent(
    state: &AppState,
    tenant: &TenantContext,
    pubkey_hex: &str,
) -> Result<(), IngestError> {
    let pubkey = nostr::PublicKey::from_hex(pubkey_hex)
        .map_err(|_| invalid("permission agent must be a public key"))?;
    let identity = state
        .db
        .get_agent_channel_policy(tenant.community(), &pubkey.to_bytes())
        .await
        .map_err(internal)?;
    if identity.is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some()) {
        Ok(())
    } else {
        Err(invalid("standing permissions require a managed agent"))
    }
}

async fn validate_scope_exists(
    state: &AppState,
    tenant: &TenantContext,
    permission: &ToolPermissionRecord,
) -> Result<(), IngestError> {
    use buzz_core::company_records::ToolPermissionScopeKind;
    match permission.scope.kind {
        ToolPermissionScopeKind::Channel => {
            let channel_id = Uuid::parse_str(&permission.scope.id)
                .map_err(|_| invalid("channel scope must contain a channel UUID"))?;
            state
                .db
                .get_channel_for_event_write(tenant.community(), channel_id)
                .await
                .map(|_| ())
                .map_err(internal)?;
        }
        ToolPermissionScopeKind::Thread => {
            let event_id = EventId::parse(&permission.scope.id)
                .map_err(|_| invalid("thread scope must contain a root event id"))?;
            let stored = state
                .db
                .get_event_by_id_for_event_write(tenant.community(), &event_id.to_bytes())
                .await
                .map_err(internal)?
                .ok_or_else(|| invalid("thread scope does not exist in this community"))?;
            let channel_id = stored
                .channel_id
                .ok_or_else(|| invalid("thread scope must be inside a channel"))?;
            if buzz_core::nip10::parse_thread_markers(&stored.event.tags)
                .resolve()
                .is_some()
            {
                let meta = super::ingest::resolve_nip10_thread_meta(
                    tenant.community(),
                    &stored.event,
                    channel_id,
                    state,
                )
                .await
                .map_err(|message| invalid(format!("thread scope: {message}")))?
                .ok_or_else(|| invalid("thread scope does not resolve to a channel thread"))?;
                if hex::encode(meta.root_event_id) != permission.scope.id {
                    return Err(invalid("thread scope must name the canonical thread root"));
                }
            } else if stored.event.id.to_hex() != permission.scope.id {
                return Err(invalid("thread scope must name the canonical thread root"));
            }
        }
        ToolPermissionScopeKind::Customer => {
            let client_id = Uuid::parse_str(&permission.scope.id)
                .map_err(|_| invalid("customer scope must contain a customer UUID"))?;
            let d_tag = client_d_tag(client_id, "client", client_id);
            let mut query = EventQuery::for_community(tenant.community());
            query.kinds = Some(vec![KIND_CLIENT_HEAD as i32]);
            query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
            query.d_tag = Some(d_tag);
            query.limit = Some(2);
            let rows = state
                .db
                .query_events_for_event_write(&query)
                .await
                .map_err(internal)?;
            let stored = rows
                .first()
                .ok_or_else(|| invalid("customer scope does not exist in this community"))?;
            let client = serde_json::from_str::<ClientHead>(&stored.event.content)
                .map_err(|_| internal("stored customer record is invalid"))?;
            if rows.len() != 1
                || client.client_id != client_id
                || client.status != "active"
                || stored.channel_id != Some(client_id)
            {
                return Err(invalid("customer scope is not an active customer record"));
            }
        }
    }
    Ok(())
}

async fn current_permission_head(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_TOOL_PERMISSION_HEAD as i32]);
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
            "error: duplicate tool permission head coordinate".into(),
        ));
    }
    let head = rows.pop();
    if let Some(head) = &head {
        let parsed = parse_permission_head(head)?;
        validate_tool_permission_d_tag(d_tag, parsed.permission_id)
            .map_err(|error| internal(format!("stored permission d tag: {error}")))?;
        let d_tags = head
            .event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "d")
            .collect::<Vec<_>>();
        let p_tags = head
            .event
            .tags
            .iter()
            .filter(|tag| tag.kind().to_string() == "p")
            .collect::<Vec<_>>();
        if d_tags.len() != 1
            || d_tags[0].content() != Some(d_tag)
            || p_tags.len() != 1
            || p_tags[0].content() != Some(parsed.permission.agent_pubkey.as_str())
            || head.event.tags.len() != 2
        {
            return Err(IngestError::Internal(
                "error: stored permission head tags do not match its content".into(),
            ));
        }
    }
    Ok(head)
}

fn parse_permission_head(event: &StoredEvent) -> Result<ToolPermissionHead, IngestError> {
    let head = serde_json::from_str::<ToolPermissionHead>(&event.event.content).map_err(|_| {
        IngestError::Internal("error: stored tool permission head is invalid".into())
    })?;
    if event.event.kind != Kind::Custom(KIND_TOOL_PERMISSION_HEAD as u16)
        || event.event.verify().is_err()
        || head.schema_version != COMPANY_RECORD_SCHEMA_VERSION
        || head.permission_id != head.permission.permission_id
        || nostr::PublicKey::from_hex(&head.permission.agent_pubkey).is_err()
        || nostr::PublicKey::from_hex(&head.granted_by_pubkey).is_err()
        || nostr::PublicKey::from_hex(&head.changed_by_pubkey).is_err()
        || EventId::parse(&head.source_action_event_id).is_err()
    {
        return Err(IngestError::Internal(
            "error: stored tool permission head identity is invalid".into(),
        ));
    }
    Ok(head)
}

fn relay_permission_head_event(
    head: &ToolPermissionHead,
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
        Tag::parse(["d", d_tag]).map_err(|error| internal(format!("permission d tag: {error}")))?;
    let agent_tag = Tag::parse(["p", head.permission.agent_pubkey.as_str()])
        .map_err(|error| internal(format!("permission agent tag: {error}")))?;
    EventBuilder::new(Kind::Custom(KIND_TOOL_PERMISSION_HEAD as u16), content)
        .tags([d_tag, agent_tag])
        .custom_created_at(nostr::Timestamp::from_secs(created_at))
        .sign_with_keys(&state.relay_keypair)
        .map_err(internal)
}

fn is_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
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

#[cfg(test)]
mod postgres_tests {
    use std::time::Duration;

    use buzz_core::company_records::{
        tool_permission_d_tag, ToolPermissionCommandKind, ToolPermissionScope,
        ToolPermissionScopeKind, ToolPermissionVerb, COMPANY_RECORD_SCHEMA_VERSION,
    };
    use buzz_core::tenant::CommunityId;
    use nostr::{EventBuilder, Kind, Tag};
    use tokio::sync::Mutex;

    use super::*;

    static PERMISSION_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

    struct Fixture {
        pool: sqlx::PgPool,
        state: Arc<AppState>,
        tenant: TenantContext,
        owner: nostr::Keys,
        root: Event,
        _serial_guard: tokio::sync::MutexGuard<'static, ()>,
    }

    async fn fixture() -> Fixture {
        let serial_guard = PERMISSION_DB_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
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
        let community_id = Uuid::new_v4();
        let host = format!("company-permissions-{}.test", community_id.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(&host)
            .execute(&pool)
            .await
            .expect("insert test community");
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_id), host);
        let owner = nostr::Keys::generate();
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
                &format!("permission-{}", Uuid::new_v4().simple()),
                buzz_core::channel::ChannelType::Stream,
                buzz_core::channel::ChannelVisibility::Private,
                None,
                &owner.public_key().to_bytes(),
                None,
            )
            .await
            .expect("create private stream");
        let root = EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_STREAM_MESSAGE as u16),
            "Thread",
        )
        .tags([Tag::parse(["h", channel.id.to_string().as_str()]).expect("h tag")])
        .sign_with_keys(&owner)
        .expect("sign root");
        state
            .db
            .insert_event(tenant.community(), &root, Some(channel.id))
            .await
            .expect("store thread root");
        Fixture {
            pool,
            state,
            tenant,
            owner,
            root,
            _serial_guard: serial_guard,
        }
    }

    async fn add_member(fixture: &Fixture, keys: &nostr::Keys, role: &str, managed_agent: bool) {
        fixture
            .state
            .db
            .ensure_user(fixture.tenant.community(), &keys.public_key().to_bytes())
            .await
            .expect("ensure actor identity");
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
        if managed_agent {
            fixture
                .state
                .db
                .set_agent_owner(
                    fixture.tenant.community(),
                    &keys.public_key().to_bytes(),
                    &fixture.owner.public_key().to_bytes(),
                )
                .await
                .expect("bind managed agent owner");
        }
    }

    fn auth(keys: &nostr::Keys) -> IngestAuth {
        IngestAuth::Http {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            auth_method: super::super::ingest::HttpAuthMethod::DevPubkey,
        }
    }

    fn permission(
        permission_id: Uuid,
        agent: &nostr::Keys,
        thread_root_event_id: &str,
        expires_at: String,
    ) -> ToolPermissionRecord {
        ToolPermissionRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id,
            agent_pubkey: agent.public_key().to_hex(),
            action: ToolPermissionVerb::MessageOutsider.permission_key().into(),
            scope: ToolPermissionScope {
                kind: ToolPermissionScopeKind::Thread,
                id: thread_root_event_id.to_owned(),
            },
            expires_at,
        }
    }

    fn signed_action(keys: &nostr::Keys, action: &ToolPermissionAction) -> Event {
        buzz_sdk::company_records::build_tool_permission_action(action)
            .expect("build permission action")
            .sign_with_keys(keys)
            .expect("sign permission action")
    }

    async fn send(
        fixture: &Fixture,
        keys: &nostr::Keys,
        action: &ToolPermissionAction,
    ) -> Result<IngestResult, IngestError> {
        let event = signed_action(keys, action);
        handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
    }

    async fn current(fixture: &Fixture, permission_id: Uuid) -> StoredEvent {
        current_permission_head(
            &fixture.state,
            fixture.tenant.community(),
            &tool_permission_d_tag(permission_id),
        )
        .await
        .expect("query current permission head")
        .expect("permission head exists")
    }

    #[tokio::test]
    #[ignore = "requires disposable Postgres and Redis"]
    async fn broker_grants_edits_and_revokes_with_role_and_exact_head_checks() {
        let fixture = fixture().await;
        let agent = nostr::Keys::generate();
        let member = nostr::Keys::generate();
        add_member(&fixture, &agent, "member", true).await;
        add_member(&fixture, &member, "member", false).await;

        let permission_id = Uuid::new_v4();
        let expires_at = (Utc::now() + chrono::Duration::hours(2)).to_rfc3339();
        let record = permission(
            permission_id,
            &agent,
            &fixture.root.id.to_hex(),
            expires_at.clone(),
        );
        let grant = ToolPermissionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id,
            action: ToolPermissionCommandKind::Grant,
            expected_head_event_id: None,
            permission: Some(record.clone()),
            reason: None,
        };
        assert!(matches!(
            send(&fixture, &member, &grant).await,
            Err(IngestError::AuthFailed(message)) if message.contains("owner or admin")
        ));
        assert!(
            send(&fixture, &fixture.owner, &grant)
                .await
                .expect("owner grants exact permission")
                .accepted
        );

        let granted = current(&fixture, permission_id).await;
        granted.event.verify().expect("relay-signed head");
        assert_eq!(
            granted.event.pubkey,
            fixture.state.relay_keypair.public_key()
        );
        assert!(granted.event.tags.iter().any(|tag| {
            tag.kind().to_string() == "p"
                && tag.content() == Some(agent.public_key().to_hex().as_str())
        }));
        let grant_head = parse_permission_head(&granted).expect("parse granted head");
        assert_eq!(grant_head.status, ToolPermissionStatus::Active);

        let mut updated_record = record;
        updated_record.expires_at = (Utc::now() + chrono::Duration::hours(3)).to_rfc3339();
        let update = ToolPermissionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id,
            action: ToolPermissionCommandKind::Update,
            expected_head_event_id: Some(granted.event.id.to_hex()),
            permission: Some(updated_record),
            reason: None,
        };
        assert!(
            send(&fixture, &fixture.owner, &update)
                .await
                .expect("owner edits expiry")
                .accepted
        );
        let updated = current(&fixture, permission_id).await;
        let stale = ToolPermissionAction {
            expected_head_event_id: Some(granted.event.id.to_hex()),
            permission: Some(permission(
                permission_id,
                &agent,
                &fixture.root.id.to_hex(),
                (Utc::now() + chrono::Duration::hours(4)).to_rfc3339(),
            )),
            ..update
        };
        let stale_result = send(&fixture, &fixture.owner, &stale).await;
        assert!(
            matches!(&stale_result, Err(IngestError::Rejected(message))
                if message.contains("current head")
                    || message.contains("permission changed before the action could commit")),
            "stale permission update must fail with a head conflict"
        );
        assert_eq!(
            current(&fixture, permission_id).await.event.id.to_hex(),
            updated.event.id.to_hex(),
            "stale permission update must leave the current head unchanged"
        );

        let revoke = ToolPermissionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id,
            action: ToolPermissionCommandKind::Revoke,
            expected_head_event_id: Some(updated.event.id.to_hex()),
            permission: None,
            reason: Some("Access no longer needed".into()),
        };
        assert!(
            send(&fixture, &fixture.owner, &revoke)
                .await
                .expect("owner revokes permission")
                .accepted
        );
        let revoked = parse_permission_head(&current(&fixture, permission_id).await)
            .expect("parse revoked head");
        assert_eq!(revoked.status, ToolPermissionStatus::Revoked);
        let _ = &fixture.pool;
    }
}
