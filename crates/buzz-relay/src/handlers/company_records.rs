//! Nostr-first broker for community-wide company goals.
//!
//! Goal commands and relay-signed heads have a company d-tag and no channel
//! coordinate. Goal-tree changes serialize under one community-scoped lock.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::Event;
use uuid::Uuid;

use buzz_core::business_records::{validate_company_work_d_tag, CompanyWorkItemHead};
use buzz_core::company_records::{
    goal_d_tag, goal_parent_creates_cycle, parse_company_command, validate_goal_action,
    validate_goal_d_tag, validate_goal_progress, CompanyCommand, GoalAction, GoalActionKind,
    GoalHead, GoalRecord, GoalStatus, RecordedGoalProgress, COMPANY_RECORD_SCHEMA_VERSION,
    MAX_GOAL_DEPTH,
};
use buzz_core::kind::{KIND_GOAL_ACTION, KIND_GOAL_HEAD, KIND_WORK_ITEM_HEAD};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_datastore_tracing::datastore_span;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

const MAX_CURRENT_GOAL_HEADS: i64 = 10_000;
const MAX_CURRENT_COMPANY_WORK_HEADS: i64 = 10_000;

/// Dispatches company ask and goal commands to their record handlers.
pub async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    match u32::from(event.kind.as_u16()) {
        buzz_core::kind::KIND_ASK_ACTION | buzz_core::kind::KIND_ASK_RESPONSE => {
            super::company_asks::handle(tenant, state, event, auth).await
        }
        buzz_core::kind::KIND_SECRET_BINDING_ACTION => {
            super::company_secrets::handle(tenant, state, event, auth).await
        }
        _ => handle_goal_action(tenant, state, event, auth).await,
    }
}

/// Handles a member-signed company goal action (kind 47031).
#[datastore_span(name = "company_goal_action", system = "postgresql")]
async fn handle_goal_action(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let kind = u32::from(event.kind.as_u16());
    let command = parse_company_command(kind, &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::GoalAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };

    validate_goal_action(&action).map_err(|error| invalid(format!("goal action: {error}")))?;
    let d_tag = goal_command_d_tag(&event, action.goal_id)?;

    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write company goals",
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

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-goal-tree:{}", community_id.as_uuid()))
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
        return Ok(IngestResult {
            event_id: event.id.to_hex(),
            accepted: true,
            message: "duplicate: already processed".into(),
        });
    }

    let expected_head = action.expected_head_event_id.as_deref();
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_GOAL_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    match (action.action, expected_head, current_head_id.as_deref()) {
        (GoalActionKind::Create, None, None) => {}
        (GoalActionKind::Create, _, Some(_)) => {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict("goal already exists"));
        }
        (_, Some(expected), Some(actual)) if expected == hex::encode(actual) => {}
        (_, Some(_), Some(actual)) => {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict(format!(
                "goal changed; current head is {}",
                hex::encode(actual)
            )));
        }
        (_, _, None) => {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict("goal does not exist"));
        }
        _ => {
            tx.rollback().await.map_err(internal)?;
            return Err(invalid(
                "expectedHeadEventId does not match the goal action",
            ));
        }
    }

    let current_stored = current_goal_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(IngestError::Internal(
            "error: goal head changed while its transaction lock was held".into(),
        ));
    }
    let current = current_stored.as_ref().map(parse_goal_head).transpose()?;
    if current
        .as_ref()
        .is_some_and(|head| head.goal_id != action.goal_id)
    {
        tx.rollback().await.map_err(internal)?;
        return Err(IngestError::Internal(
            "error: stored goal head does not match its d-tag".into(),
        ));
    }

    authorize_action(&role, &actor_pubkey, &action, current.as_ref())?;

    if let Some(record) = action.goal.as_ref() {
        validate_parent_and_cycle(
            ParentCycleContext {
                tenant,
                state,
                role: &role,
                actor_pubkey: &actor_pubkey,
                action_kind: action.action,
                goal_id: action.goal_id,
                current: current.as_ref(),
            },
            record,
        )
        .await?;
    }

    if action.action == GoalActionKind::Progress {
        let has_target = current
            .as_ref()
            .and_then(|head| head.goal.as_ref())
            .is_some_and(|goal| goal.target.is_some());
        let progress = action
            .progress
            .as_ref()
            .ok_or_else(|| invalid("progress payload is required"))?;
        validate_goal_progress(progress, has_target)
            .map_err(|error| invalid(format!("goal progress: {error}")))?;
    }

    if action.action == GoalActionKind::Delete {
        ensure_no_live_subgoals(tenant, state, action.goal_id).await?;
        ensure_no_company_work_items(tenant, state, action.goal_id).await?;
    }

    let head = next_goal_head(&event, &action, current.as_ref(), &actor_pubkey)?;
    let previous_event = current_stored.as_ref();
    let head_event = super::business_records::relay_global_head_event(
        KIND_GOAL_HEAD,
        &d_tag,
        &head,
        previous_event,
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
        return Err(conflict("goal changed before the action committed"));
    }

    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_GOAL_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_GOAL_HEAD,
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

fn goal_command_d_tag(event: &Event, goal_id: Uuid) -> Result<String, IngestError> {
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
            "goal commands require one d tag, no h tag, and no unsupported tags",
        ));
    }
    let d_tag = d_tags[0]
        .content()
        .ok_or_else(|| invalid("goal command d tag must have a value"))?;
    validate_goal_d_tag(d_tag, goal_id)
        .map_err(|error| invalid(format!("goal command d tag: {error}")))?;
    Ok(d_tag.to_owned())
}

fn authorize_action(
    role: &str,
    actor_pubkey: &str,
    action: &GoalAction,
    current: Option<&GoalHead>,
) -> Result<(), IngestError> {
    if action.action == GoalActionKind::Create {
        if action
            .goal
            .as_ref()
            .is_some_and(|goal| goal.parent_goal_id.is_none())
            && !is_admin(role)
        {
            return Err(forbidden(
                "only a community owner or admin can create a root goal",
            ));
        }
        return Ok(());
    }

    let head = current.ok_or_else(|| conflict("goal does not exist"))?;
    if head.status == GoalStatus::Deleted || head.goal.is_none() {
        return Err(conflict("deleted goals cannot be changed"));
    }

    match action.action {
        GoalActionKind::Update
        | GoalActionKind::Progress
        | GoalActionKind::SetStatus
        | GoalActionKind::Archive => authorize_goal_owner_or_admin(role, actor_pubkey, head),
        GoalActionKind::Restore | GoalActionKind::Delete => {
            if is_admin(role) {
                Ok(())
            } else {
                Err(forbidden(
                    "only a community owner or admin can restore or delete a goal",
                ))
            }
        }
        GoalActionKind::Create => Ok(()),
    }
}

fn authorize_goal_owner_or_admin(
    role: &str,
    actor_pubkey: &str,
    head: &GoalHead,
) -> Result<(), IngestError> {
    if is_admin(role)
        || head
            .goal
            .as_ref()
            .is_some_and(|goal| goal.owner_pubkey == actor_pubkey)
    {
        Ok(())
    } else {
        Err(forbidden(
            "only a community owner, admin, or goal owner can change this goal",
        ))
    }
}

struct ParentCycleContext<'a> {
    tenant: &'a TenantContext,
    state: &'a AppState,
    role: &'a str,
    actor_pubkey: &'a str,
    action_kind: GoalActionKind,
    goal_id: Uuid,
    current: Option<&'a GoalHead>,
}

async fn validate_parent_and_cycle(
    context: ParentCycleContext<'_>,
    record: &GoalRecord,
) -> Result<(), IngestError> {
    let ParentCycleContext {
        tenant,
        state,
        role,
        actor_pubkey,
        action_kind,
        goal_id,
        current,
    } = context;
    let Some(parent_id) = record.parent_goal_id else {
        return Ok(());
    };
    let parent_tag = goal_d_tag(parent_id);
    let parent_stored = current_goal_head(state, tenant.community(), &parent_tag)
        .await?
        .ok_or_else(|| invalid("parent goal does not exist in this community"))?;
    let parent = parse_goal_head(&parent_stored)?;
    let parent_goal = parent
        .goal
        .as_ref()
        .filter(|_| parent.status != GoalStatus::Deleted)
        .ok_or_else(|| invalid("parent goal has been deleted"))?;

    if action_kind == GoalActionKind::Create
        && !is_admin(role)
        && parent_goal.owner_pubkey != actor_pubkey
    {
        return Err(forbidden(
            "only an owner, admin, or parent goal owner can create a sub-goal",
        ));
    }

    let old_parent = current
        .and_then(|head| head.goal.as_ref())
        .and_then(|goal| goal.parent_goal_id);
    if action_kind == GoalActionKind::Update && old_parent == Some(parent_id) {
        return Ok(());
    }

    let mut parent_by_goal = std::collections::BTreeMap::new();
    let mut cursor = Some(parent_id);
    for _ in 0..MAX_GOAL_DEPTH {
        let Some(ancestor_id) = cursor else {
            break;
        };
        if ancestor_id == goal_id {
            parent_by_goal.insert(ancestor_id, None);
            cursor = None;
            break;
        }
        let ancestor_tag = goal_d_tag(ancestor_id);
        let ancestor_stored = current_goal_head(state, tenant.community(), &ancestor_tag)
            .await?
            .ok_or_else(|| invalid("goal hierarchy contains a missing parent"))?;
        let ancestor = parse_goal_head(&ancestor_stored)?;
        let parent = ancestor
            .goal
            .as_ref()
            .filter(|_| ancestor.status != GoalStatus::Deleted)
            .ok_or_else(|| invalid("goal hierarchy contains a deleted parent"))?
            .parent_goal_id;
        parent_by_goal.insert(ancestor_id, parent);
        cursor = parent;
    }
    if cursor.is_some() {
        return Err(invalid("goal hierarchy exceeds the supported depth"));
    }

    if goal_parent_creates_cycle(goal_id, parent_id, |id| {
        parent_by_goal.get(&id).copied().flatten()
    }) {
        return Err(invalid("goal parent change would create a cycle"));
    }
    Ok(())
}

async fn ensure_no_live_subgoals(
    tenant: &TenantContext,
    state: &AppState,
    goal_id: Uuid,
) -> Result<(), IngestError> {
    let heads = current_goal_heads(state, tenant.community()).await?;
    let dependents = heads
        .into_iter()
        .filter(|head| {
            head.status != GoalStatus::Deleted
                && head
                    .goal
                    .as_ref()
                    .is_some_and(|goal| goal.parent_goal_id == Some(goal_id))
        })
        .map(|head| format!("{} ({})", head.title, head.goal_id))
        .collect::<Vec<_>>();
    if dependents.is_empty() {
        Ok(())
    } else {
        Err(conflict(format!(
            "goal has non-deleted sub-goals: {}",
            dependents.join(", ")
        )))
    }
}

async fn ensure_no_company_work_items(
    tenant: &TenantContext,
    state: &AppState,
    goal_id: Uuid,
) -> Result<(), IngestError> {
    let mut query = EventQuery::for_community(tenant.community());
    query.kinds = Some(vec![KIND_WORK_ITEM_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.limit = Some(MAX_CURRENT_COMPANY_WORK_HEADS + 1);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() as i64 > MAX_CURRENT_COMPANY_WORK_HEADS {
        return Err(IngestError::Internal(format!(
            "error: company work exceeds the supported {} current heads",
            MAX_CURRENT_COMPANY_WORK_HEADS
        )));
    }

    let mut linked = Vec::new();
    for stored in rows {
        let d_tag = stored
            .event
            .tags
            .iter()
            .find(|tag| tag.kind().to_string() == "d")
            .and_then(|tag| tag.as_slice().get(1).cloned())
            .ok_or_else(|| {
                IngestError::Internal("error: relay-signed work head has no d tag".into())
            })?;
        if !d_tag.starts_with("company:work:") {
            continue;
        }
        let head =
            serde_json::from_str::<CompanyWorkItemHead>(&stored.event.content).map_err(|_| {
                IngestError::Internal("error: stored company work head is invalid".into())
            })?;
        validate_company_work_d_tag(&d_tag, head.work_item_id)
            .map_err(|error| internal(format!("stored company work d tag: {error}")))?;
        if head.goal_id == Some(goal_id) {
            linked.push(format!("{} ({})", head.title, head.work_item_id));
        }
    }

    if linked.is_empty() {
        Ok(())
    } else {
        Err(conflict(format!(
            "goal has linked company work items: {}",
            linked.join(", ")
        )))
    }
}

fn next_goal_head(
    event: &Event,
    action: &GoalAction,
    current: Option<&GoalHead>,
    actor_pubkey: &str,
) -> Result<GoalHead, IngestError> {
    let source_action_event_id = event.id.to_hex();
    let next = match action.action {
        GoalActionKind::Create => {
            let goal = action
                .goal
                .clone()
                .ok_or_else(|| invalid("goal payload is required"))?;
            GoalHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                goal_id: action.goal_id,
                status: GoalStatus::Active,
                title: goal.title.clone(),
                goal: Some(goal),
                progress: None,
                source_action_event_id,
            }
        }
        GoalActionKind::Delete => {
            let previous = current.ok_or_else(|| conflict("goal does not exist"))?;
            GoalHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                goal_id: action.goal_id,
                status: GoalStatus::Deleted,
                title: previous.title.clone(),
                goal: None,
                progress: None,
                source_action_event_id,
            }
        }
        _ => {
            let mut head = current
                .cloned()
                .ok_or_else(|| conflict("goal does not exist"))?;
            head.source_action_event_id = source_action_event_id;
            match action.action {
                GoalActionKind::Update => {
                    let goal = action
                        .goal
                        .clone()
                        .ok_or_else(|| invalid("goal payload is required"))?;
                    head.title = goal.title.clone();
                    head.goal = Some(goal);
                }
                GoalActionKind::Progress => {
                    let progress = action
                        .progress
                        .clone()
                        .ok_or_else(|| invalid("progress payload is required"))?;
                    head.progress = Some(RecordedGoalProgress {
                        progress,
                        recorded_by_pubkey: actor_pubkey.to_owned(),
                        recorded_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
                    });
                    if let Some(status) = action.status {
                        head.status = status;
                    }
                }
                GoalActionKind::SetStatus => {
                    head.status = action.status.ok_or_else(|| invalid("status is required"))?;
                }
                GoalActionKind::Archive => head.status = GoalStatus::Archived,
                GoalActionKind::Restore => {
                    if head.status != GoalStatus::Archived {
                        return Err(conflict("only archived goals can be restored"));
                    }
                    head.status = GoalStatus::Active;
                }
                GoalActionKind::Create | GoalActionKind::Delete => {
                    return Err(invalid("unexpected goal action transition"));
                }
            }
            head
        }
    };

    if action.action == GoalActionKind::Progress {
        let has_target = next.goal.as_ref().is_some_and(|goal| goal.target.is_some());
        let progress = action
            .progress
            .as_ref()
            .ok_or_else(|| invalid("progress payload is required"))?;
        validate_goal_progress(progress, has_target)
            .map_err(|error| invalid(format!("goal progress: {error}")))?;
    }
    Ok(next)
}

async fn current_goal_head(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_GOAL_HEAD as i32]);
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
            "error: duplicate company goal head coordinate".into(),
        ));
    }
    let head = rows.pop();
    if let Some(head) = &head {
        let parsed = parse_goal_head(head)?;
        validate_goal_d_tag(d_tag, parsed.goal_id)
            .map_err(|error| internal(format!("stored goal d tag: {error}")))?;
    }
    Ok(head)
}

async fn current_goal_heads(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
) -> Result<Vec<GoalHead>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_GOAL_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(MAX_CURRENT_GOAL_HEADS + 1);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() as i64 > MAX_CURRENT_GOAL_HEADS {
        return Err(IngestError::Internal(format!(
            "error: goal tree exceeds the supported {} current goals",
            MAX_CURRENT_GOAL_HEADS
        )));
    }
    rows.iter().map(parse_goal_head).collect()
}

fn parse_goal_head(event: &StoredEvent) -> Result<GoalHead, IngestError> {
    let head = serde_json::from_str::<GoalHead>(&event.event.content).map_err(|_| {
        IngestError::Internal("error: stored company goal head content is invalid".into())
    })?;
    Ok(head)
}

fn is_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use buzz_core::company_records::{GoalProgress, GoalTarget, COMPANY_RECORD_SCHEMA_VERSION};
    use buzz_core::tenant::CommunityId;
    use nostr::{EventBuilder, Kind, Tag};
    use tokio::sync::Mutex;

    use super::*;

    static COMPANY_RECORDS_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> =
        std::sync::OnceLock::new();

    struct Fixture {
        pool: sqlx::PgPool,
        state: Arc<AppState>,
        tenant: TenantContext,
        _serial_guard: tokio::sync::MutexGuard<'static, ()>,
    }

    async fn fixture() -> Fixture {
        let serial_guard = COMPANY_RECORDS_DB_TEST_LOCK
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
        let host = format!("company-goals-{}.test", community_id.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_id)
            .bind(&host)
            .execute(&pool)
            .await
            .expect("insert test community");
        Fixture {
            pool,
            state,
            tenant: TenantContext::resolved(CommunityId::from_uuid(community_id), host),
            _serial_guard: serial_guard,
        }
    }

    async fn add_member(fixture: &Fixture, keys: &nostr::Keys, role: &str) {
        fixture
            .state
            .db
            .add_relay_member(
                fixture.tenant.community(),
                &keys.public_key().to_hex(),
                role,
                None,
            )
            .await
            .expect("add relay member");
    }

    fn auth(keys: &nostr::Keys) -> IngestAuth {
        IngestAuth::Http {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
        }
    }

    fn goal_record(goal_id: Uuid, owner: &nostr::Keys, parent_goal_id: Option<Uuid>) -> GoalRecord {
        GoalRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id,
            parent_goal_id,
            title: format!("Goal {goal_id}"),
            owner_pubkey: owner.public_key().to_hex(),
            due_date: Some("2026-10-01".into()),
            done_condition: "The agreed result is complete and reviewed".into(),
            target: Some(GoalTarget {
                value: "4".into(),
                unit: "approved plans".into(),
            }),
            linked_channel_ids: Vec::new(),
        }
    }

    fn action(
        goal_id: Uuid,
        action: GoalActionKind,
        expected_head_event_id: Option<String>,
        goal: Option<GoalRecord>,
    ) -> GoalAction {
        GoalAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id,
            action,
            expected_head_event_id,
            goal,
            progress: None,
            status: None,
            reason: None,
        }
    }

    fn signed_action(keys: &nostr::Keys, action: &GoalAction) -> Event {
        buzz_sdk::company_records::build_goal_action(action)
            .expect("build goal action")
            .sign_with_keys(keys)
            .expect("sign goal action")
    }

    fn signed_raw_action(keys: &nostr::Keys, action: &GoalAction, with_h_tag: bool) -> Event {
        let content = serde_json::to_string(action).expect("serialize goal action");
        let d_tag = goal_d_tag(action.goal_id);
        let mut tags = vec![Tag::parse(["d", d_tag.as_str()]).expect("d tag")];
        if with_h_tag {
            tags.push(Tag::parse(["h", Uuid::new_v4().to_string().as_str()]).expect("h tag"));
        }
        EventBuilder::new(Kind::Custom(KIND_GOAL_ACTION as u16), content)
            .tags(tags)
            .sign_with_keys(keys)
            .expect("sign raw goal action")
    }

    async fn send(
        fixture: &Fixture,
        keys: &nostr::Keys,
        action: &GoalAction,
    ) -> Result<IngestResult, IngestError> {
        let event = signed_action(keys, action);
        handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
    }

    async fn current_head(fixture: &Fixture, goal_id: Uuid) -> StoredEvent {
        current_goal_head(
            &fixture.state,
            fixture.tenant.community(),
            &goal_d_tag(goal_id),
        )
        .await
        .expect("query current goal head")
        .expect("goal head exists")
    }

    async fn parsed_head(fixture: &Fixture, goal_id: Uuid) -> GoalHead {
        parse_goal_head(&current_head(fixture, goal_id).await).expect("parse goal head")
    }

    fn rejection(result: Result<IngestResult, IngestError>) -> String {
        match result {
            Err(IngestError::Rejected(message)) => message,
            _ => panic!("expected a rejected company goal action"),
        }
    }

    fn expected_head_id(event: &StoredEvent) -> String {
        event.event.id.to_hex()
    }

    #[tokio::test]
    async fn root_goals_require_admin_and_emit_global_relay_signed_heads() {
        let fixture = fixture().await;
        let owner = nostr::Keys::generate();
        let member = nostr::Keys::generate();
        add_member(&fixture, &owner, "owner").await;
        add_member(&fixture, &member, "member").await;
        let goal_id = Uuid::new_v4();
        let create = action(
            goal_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(goal_id, &owner, None)),
        );

        let err = rejection(send(&fixture, &member, &create).await);
        assert!(err.contains("root goal"), "{err}");
        let command_event = signed_action(&owner, &create);
        let command_id = command_event.id.to_hex();
        let created = handle(
            &fixture.tenant,
            &fixture.state,
            command_event.clone(),
            auth(&owner),
        )
        .await
        .expect("create goal");
        assert!(created.accepted);

        let head_event = current_head(&fixture, goal_id).await;
        assert_eq!(head_event.event.kind.as_u16() as u32, KIND_GOAL_HEAD);
        assert_eq!(
            head_event.event.pubkey,
            fixture.state.relay_keypair.public_key()
        );
        assert!(head_event
            .event
            .tags
            .iter()
            .all(|tag| tag.kind().to_string() != "h"));
        assert_eq!(head_event.event.tags.len(), 1);
        assert_eq!(
            head_event
                .event
                .tags
                .iter()
                .next()
                .expect("d tag")
                .kind()
                .to_string(),
            "d"
        );
        let head = parse_goal_head(&head_event).expect("parse relay-signed head");
        assert_eq!(head.status, GoalStatus::Active);
        assert_eq!(head.goal_id, goal_id);
        assert!(head.goal.is_some());

        let command = fixture
            .state
            .db
            .get_event_by_id_for_event_write(
                fixture.tenant.community(),
                &hex::decode(&created.event_id).expect("event id hex"),
            )
            .await
            .expect("load command")
            .expect("command was stored");
        assert_eq!(command.event.kind.as_u16() as u32, KIND_GOAL_ACTION);
        assert!(command
            .event
            .tags
            .iter()
            .all(|tag| tag.kind().to_string() != "h"));
        assert!(command.channel_id.is_none());

        assert_eq!(command_id, created.event_id);
        let duplicate = handle(&fixture.tenant, &fixture.state, command_event, auth(&owner))
            .await
            .expect("replay committed action");
        assert!(duplicate.message.starts_with("duplicate:"));
    }

    #[tokio::test]
    async fn parent_must_be_live_and_in_community_and_parent_owner_can_create_subgoal() {
        let fixture = fixture().await;
        let admin = nostr::Keys::generate();
        let parent_owner = nostr::Keys::generate();
        let stranger = nostr::Keys::generate();
        add_member(&fixture, &admin, "admin").await;
        add_member(&fixture, &parent_owner, "member").await;
        add_member(&fixture, &stranger, "member").await;

        let missing_parent = Uuid::new_v4();
        let child_id = Uuid::new_v4();
        let create_child = action(
            child_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(child_id, &parent_owner, Some(missing_parent))),
        );
        assert!(rejection(send(&fixture, &admin, &create_child).await).contains("does not exist"));

        let parent_id = Uuid::new_v4();
        send(
            &fixture,
            &admin,
            &action(
                parent_id,
                GoalActionKind::Create,
                None,
                Some(goal_record(parent_id, &parent_owner, None)),
            ),
        )
        .await
        .expect("create parent goal");

        let unauthorized_child_id = Uuid::new_v4();
        let unauthorized_child = action(
            unauthorized_child_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(
                unauthorized_child_id,
                &stranger,
                Some(parent_id),
            )),
        );
        assert!(
            rejection(send(&fixture, &stranger, &unauthorized_child).await)
                .contains("parent goal owner")
        );

        let child_id = Uuid::new_v4();
        let child = action(
            child_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(child_id, &parent_owner, Some(parent_id))),
        );
        send(&fixture, &parent_owner, &child)
            .await
            .expect("parent owner can create a sub-goal");

        let deleted_parent_id = Uuid::new_v4();
        send(
            &fixture,
            &admin,
            &action(
                deleted_parent_id,
                GoalActionKind::Create,
                None,
                Some(goal_record(deleted_parent_id, &admin, None)),
            ),
        )
        .await
        .expect("create deletable parent");
        let deleted_parent_head = current_head(&fixture, deleted_parent_id).await;
        let delete_parent = GoalAction {
            reason: Some("No longer needed".into()),
            ..action(
                deleted_parent_id,
                GoalActionKind::Delete,
                Some(expected_head_id(&deleted_parent_head)),
                None,
            )
        };
        send(&fixture, &admin, &delete_parent)
            .await
            .expect("delete parent");
        let child_of_deleted_id = Uuid::new_v4();
        let child_of_deleted = action(
            child_of_deleted_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(
                child_of_deleted_id,
                &admin,
                Some(deleted_parent_id),
            )),
        );
        assert!(rejection(send(&fixture, &admin, &child_of_deleted).await)
            .contains("parent goal has been deleted"));

        let other_community_id = Uuid::new_v4();
        let other_host = format!("other-company-goals-{}.test", other_community_id.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(other_community_id)
            .bind(&other_host)
            .execute(&fixture.pool)
            .await
            .expect("insert second community");
        let other_tenant =
            TenantContext::resolved(CommunityId::from_uuid(other_community_id), other_host);
        fixture
            .state
            .db
            .add_relay_member(
                other_tenant.community(),
                &admin.public_key().to_hex(),
                "owner",
                None,
            )
            .await
            .expect("add member to second community");
        let foreign_parent_id = Uuid::new_v4();
        let foreign_parent = action(
            foreign_parent_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(foreign_parent_id, &admin, None)),
        );
        let foreign_event = signed_action(&admin, &foreign_parent);
        handle(&other_tenant, &fixture.state, foreign_event, auth(&admin))
            .await
            .expect("create goal in second community");

        let shared_goal_id = Uuid::new_v4();
        let primary_goal = action(
            shared_goal_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(shared_goal_id, &admin, None)),
        );
        send(&fixture, &admin, &primary_goal)
            .await
            .expect("same coordinate is accepted in the first community");
        let secondary_goal = action(
            shared_goal_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(shared_goal_id, &admin, None)),
        );
        handle(
            &other_tenant,
            &fixture.state,
            signed_action(&admin, &secondary_goal),
            auth(&admin),
        )
        .await
        .expect("same coordinate is scoped to the second community");
        let primary_head = current_head(&fixture, shared_goal_id).await;
        let secondary_head = current_goal_head(
            &fixture.state,
            other_tenant.community(),
            &goal_d_tag(shared_goal_id),
        )
        .await
        .expect("query secondary community goal")
        .expect("secondary community goal exists");
        let primary_head = parse_goal_head(&primary_head).expect("parse first community head");
        let secondary_head = parse_goal_head(&secondary_head).expect("parse second community head");
        assert_eq!(primary_head.goal_id, secondary_head.goal_id);
        assert_eq!(primary_head.status, secondary_head.status);
        assert_eq!(primary_head.goal, secondary_head.goal);

        let cross_community_child_id = Uuid::new_v4();
        let cross_community_child = action(
            cross_community_child_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(
                cross_community_child_id,
                &admin,
                Some(foreign_parent_id),
            )),
        );
        assert!(
            rejection(send(&fixture, &admin, &cross_community_child).await)
                .contains("does not exist")
        );
    }

    #[tokio::test]
    async fn goal_owner_can_edit_and_record_evidenced_progress_without_automatic_achievement() {
        let fixture = fixture().await;
        let admin = nostr::Keys::generate();
        let owner = nostr::Keys::generate();
        let stranger = nostr::Keys::generate();
        add_member(&fixture, &admin, "owner").await;
        add_member(&fixture, &owner, "member").await;
        add_member(&fixture, &stranger, "member").await;
        let goal_id = Uuid::new_v4();
        send(
            &fixture,
            &admin,
            &action(
                goal_id,
                GoalActionKind::Create,
                None,
                Some(goal_record(goal_id, &owner, None)),
            ),
        )
        .await
        .expect("create goal");

        let before_edit = current_head(&fixture, goal_id).await;
        let mut edited = goal_record(goal_id, &owner, None);
        edited.title = "Edited by the goal owner".into();
        let edit = action(
            goal_id,
            GoalActionKind::Update,
            Some(expected_head_id(&before_edit)),
            Some(edited),
        );
        send(&fixture, &owner, &edit)
            .await
            .expect("goal owner can edit");

        let before_progress = current_head(&fixture, goal_id).await;
        let mut progress = action(
            goal_id,
            GoalActionKind::Progress,
            Some(expected_head_id(&before_progress)),
            None,
        );
        progress.progress = Some(GoalProgress {
            current: Some("4".into()),
            evidence: "Four plans have written client approval".into(),
            evidence_refs: Vec::new(),
        });
        send(&fixture, &owner, &progress)
            .await
            .expect("goal owner can record evidenced progress");
        let after_progress = parsed_head(&fixture, goal_id).await;
        assert_eq!(after_progress.status, GoalStatus::Active);
        assert_eq!(
            after_progress
                .progress
                .as_ref()
                .unwrap()
                .progress
                .current
                .as_deref(),
            Some("4")
        );
        assert_eq!(
            after_progress.progress.as_ref().unwrap().recorded_by_pubkey,
            owner.public_key().to_hex()
        );

        let explicit_progress = GoalAction {
            status: Some(GoalStatus::OffPace),
            progress: Some(GoalProgress {
                current: Some("4".into()),
                evidence: "The final plan is awaiting client sign-off".into(),
                evidence_refs: Vec::new(),
            }),
            ..action(
                goal_id,
                GoalActionKind::Progress,
                Some(expected_head_id(&current_head(&fixture, goal_id).await)),
                None,
            )
        };
        let progress_result = send(&fixture, &owner, &explicit_progress)
            .await
            .expect("progress and explicit status share one head update");
        let selected_status_head = parsed_head(&fixture, goal_id).await;
        assert_eq!(selected_status_head.status, GoalStatus::OffPace);
        assert_eq!(
            selected_status_head
                .progress
                .as_ref()
                .unwrap()
                .progress
                .evidence,
            "The final plan is awaiting client sign-off"
        );
        assert_eq!(
            selected_status_head.source_action_event_id,
            progress_result.event_id
        );

        let current_event = current_head(&fixture, goal_id).await;
        let mut no_evidence = action(
            goal_id,
            GoalActionKind::Progress,
            Some(expected_head_id(&current_event)),
            None,
        );
        no_evidence.progress = Some(GoalProgress {
            current: Some("5".into()),
            evidence: " ".into(),
            evidence_refs: Vec::new(),
        });
        let raw = signed_raw_action(&owner, &no_evidence, false);
        assert!(
            rejection(handle(&fixture.tenant, &fixture.state, raw, auth(&owner)).await)
                .contains("progress")
        );

        let after_failed_progress = current_head(&fixture, goal_id).await;
        let failed_edit = action(
            goal_id,
            GoalActionKind::Update,
            Some(expected_head_id(&after_failed_progress)),
            Some(goal_record(goal_id, &stranger, None)),
        );
        assert!(rejection(send(&fixture, &stranger, &failed_edit).await).contains("goal owner"));

        let status_action = GoalAction {
            status: Some(GoalStatus::Achieved),
            reason: Some("Done condition checked against the approved plans".into()),
            ..action(
                goal_id,
                GoalActionKind::SetStatus,
                Some(expected_head_id(&after_failed_progress)),
                None,
            )
        };
        send(&fixture, &owner, &status_action)
            .await
            .expect("goal owner can explicitly mark achieved");
        assert_eq!(
            parsed_head(&fixture, goal_id).await.status,
            GoalStatus::Achieved
        );
    }

    #[tokio::test]
    async fn goal_tree_lock_serializes_cycle_races_and_exact_head_edits() {
        let fixture = fixture().await;
        let owner = nostr::Keys::generate();
        add_member(&fixture, &owner, "owner").await;
        let goal_a = Uuid::new_v4();
        let goal_b = Uuid::new_v4();
        for goal_id in [goal_a, goal_b] {
            send(
                &fixture,
                &owner,
                &action(
                    goal_id,
                    GoalActionKind::Create,
                    None,
                    Some(goal_record(goal_id, &owner, None)),
                ),
            )
            .await
            .expect("create cycle-race goal");
        }
        let head_a = current_head(&fixture, goal_a).await;
        let head_b = current_head(&fixture, goal_b).await;
        let update_a = action(
            goal_a,
            GoalActionKind::Update,
            Some(expected_head_id(&head_a)),
            Some(goal_record(goal_a, &owner, Some(goal_b))),
        );
        let update_b = action(
            goal_b,
            GoalActionKind::Update,
            Some(expected_head_id(&head_b)),
            Some(goal_record(goal_b, &owner, Some(goal_a))),
        );
        let (result_a, result_b) = tokio::join!(
            send(&fixture, &owner, &update_a),
            send(&fixture, &owner, &update_b),
        );
        let result_a_accepted = result_a.is_ok();
        let result_b_accepted = result_b.is_ok();
        assert_ne!(result_a_accepted, result_b_accepted);
        let loser = if !result_a_accepted {
            result_a
        } else {
            result_b
        };
        assert!(rejection(loser).contains("cycle"));

        let stable_a = parsed_head(&fixture, goal_a).await;
        let stable_b = parsed_head(&fixture, goal_b).await;
        assert_eq!(
            stable_a.goal.as_ref().and_then(|goal| goal.parent_goal_id) == Some(goal_b),
            result_a_accepted,
            "the accepted A-to-B edit must be the only persisted edge"
        );
        assert_eq!(
            stable_b.goal.as_ref().and_then(|goal| goal.parent_goal_id) == Some(goal_a),
            result_b_accepted,
            "the accepted B-to-A edit must be the only persisted edge"
        );

        let edit_id = Uuid::new_v4();
        send(
            &fixture,
            &owner,
            &action(
                edit_id,
                GoalActionKind::Create,
                None,
                Some(goal_record(edit_id, &owner, None)),
            ),
        )
        .await
        .expect("create exact-head test goal");
        let original = current_head(&fixture, edit_id).await;
        let mut first_goal = goal_record(edit_id, &owner, None);
        first_goal.title = "First competing edit".into();
        let mut second_goal = goal_record(edit_id, &owner, None);
        second_goal.title = "Second competing edit".into();
        let first = action(
            edit_id,
            GoalActionKind::Update,
            Some(expected_head_id(&original)),
            Some(first_goal),
        );
        let second = action(
            edit_id,
            GoalActionKind::Update,
            Some(expected_head_id(&original)),
            Some(second_goal),
        );
        let (first_result, second_result) = tokio::join!(
            send(&fixture, &owner, &first),
            send(&fixture, &owner, &second),
        );
        assert_ne!(first_result.is_ok(), second_result.is_ok());
        let loser = if first_result.is_err() {
            first_result
        } else {
            second_result
        };
        assert!(rejection(loser).contains("current head"));
    }

    #[tokio::test]
    async fn archive_restore_and_delete_preserve_children_and_list_delete_dependents() {
        let fixture = fixture().await;
        let admin = nostr::Keys::generate();
        let owner = nostr::Keys::generate();
        add_member(&fixture, &admin, "admin").await;
        add_member(&fixture, &owner, "member").await;
        let parent_id = Uuid::new_v4();
        let child_id = Uuid::new_v4();
        send(
            &fixture,
            &admin,
            &action(
                parent_id,
                GoalActionKind::Create,
                None,
                Some(goal_record(parent_id, &owner, None)),
            ),
        )
        .await
        .expect("create parent goal");
        send(
            &fixture,
            &owner,
            &action(
                child_id,
                GoalActionKind::Create,
                None,
                Some(goal_record(child_id, &owner, Some(parent_id))),
            ),
        )
        .await
        .expect("create child goal");

        let parent_before_archive = current_head(&fixture, parent_id).await;
        let archive = GoalAction {
            reason: None,
            ..action(
                parent_id,
                GoalActionKind::Archive,
                Some(expected_head_id(&parent_before_archive)),
                None,
            )
        };
        send(&fixture, &owner, &archive)
            .await
            .expect("goal owner can archive");
        assert_eq!(
            parsed_head(&fixture, parent_id).await.status,
            GoalStatus::Archived
        );
        assert_eq!(
            parsed_head(&fixture, child_id).await.status,
            GoalStatus::Active
        );

        let parent_before_delete = current_head(&fixture, parent_id).await;
        let delete_parent = GoalAction {
            reason: Some("Remove the old direction".into()),
            ..action(
                parent_id,
                GoalActionKind::Delete,
                Some(expected_head_id(&parent_before_delete)),
                None,
            )
        };
        let blocked = rejection(send(&fixture, &admin, &delete_parent).await);
        assert!(blocked.contains(&child_id.to_string()), "{blocked}");

        let restore = GoalAction {
            ..action(
                parent_id,
                GoalActionKind::Restore,
                Some(expected_head_id(&parent_before_delete)),
                None,
            )
        };
        assert!(rejection(send(&fixture, &owner, &restore).await).contains("owner or admin"));
        send(&fixture, &admin, &restore)
            .await
            .expect("admin restores goal");
        assert_eq!(
            parsed_head(&fixture, parent_id).await.status,
            GoalStatus::Active
        );

        let child_before_archive = current_head(&fixture, child_id).await;
        let archive_child = GoalAction {
            reason: Some("Keep history but stop tracking".into()),
            ..action(
                child_id,
                GoalActionKind::Archive,
                Some(expected_head_id(&child_before_archive)),
                None,
            )
        };
        send(&fixture, &owner, &archive_child)
            .await
            .expect("archive child");
        let parent_before_second_delete = current_head(&fixture, parent_id).await;
        let delete_parent_again = GoalAction {
            reason: None,
            ..action(
                parent_id,
                GoalActionKind::Delete,
                Some(expected_head_id(&parent_before_second_delete)),
                None,
            )
        };
        assert!(
            rejection(send(&fixture, &admin, &delete_parent_again).await)
                .contains(&child_id.to_string())
        );

        let delete_child = GoalAction {
            reason: None,
            ..action(
                child_id,
                GoalActionKind::Delete,
                Some(expected_head_id(&current_head(&fixture, child_id).await)),
                None,
            )
        };
        send(&fixture, &admin, &delete_child)
            .await
            .expect("admin deletes child");
        let final_parent = current_head(&fixture, parent_id).await;
        let delete_parent = GoalAction {
            reason: None,
            ..action(
                parent_id,
                GoalActionKind::Delete,
                Some(expected_head_id(&final_parent)),
                None,
            )
        };
        send(&fixture, &admin, &delete_parent)
            .await
            .expect("admin deletes parent after child");
        let deleted = parsed_head(&fixture, parent_id).await;
        assert_eq!(deleted.status, GoalStatus::Deleted);
        assert_eq!(deleted.title, format!("Goal {parent_id}"));
        assert!(deleted.goal.is_none());
        assert!(deleted.progress.is_none());
        let deleted_event = current_head(&fixture, parent_id).await;
        assert!(deleted_event
            .event
            .tags
            .iter()
            .all(|tag| tag.kind().to_string() != "h"));
    }

    #[tokio::test]
    async fn command_coordinate_rejects_channel_tags_and_wrong_community_d_tags() {
        let fixture = fixture().await;
        let owner = nostr::Keys::generate();
        add_member(&fixture, &owner, "owner").await;
        let goal_id = Uuid::new_v4();
        let create = action(
            goal_id,
            GoalActionKind::Create,
            None,
            Some(goal_record(goal_id, &owner, None)),
        );
        let event = signed_raw_action(&owner, &create, true);
        assert!(
            rejection(handle(&fixture.tenant, &fixture.state, event, auth(&owner)).await)
                .contains("no h tag")
        );

        let content = serde_json::to_string(&create).expect("serialize goal action");
        let wrong_goal_id = Uuid::new_v4();
        let wrong_d = goal_d_tag(wrong_goal_id);
        let event = EventBuilder::new(Kind::Custom(KIND_GOAL_ACTION as u16), content)
            .tag(Tag::parse(["d", wrong_d.as_str()]).expect("wrong d tag"))
            .sign_with_keys(&owner)
            .expect("sign wrong coordinate");
        assert!(
            rejection(handle(&fixture.tenant, &fixture.state, event, auth(&owner)).await)
                .contains("d tag")
        );
    }
}
