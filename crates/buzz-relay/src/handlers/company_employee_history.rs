//! Nostr-first broker for immutable employee configuration history.
//!
//! Member actions and relay-signed current heads commit together. The relay
//! checks direct-manager authority against the serialized company member tree.

use std::sync::Arc;

use chrono::{SecondsFormat, Utc};
use nostr::{Event, EventId, Kind};

use buzz_core::company_employee_history::{
    validate_employee_revision_action, validate_employee_revision_head, EmployeeConfigSnapshot,
    EmployeeRevisionAction, EmployeeRevisionActionKind, EmployeeRevisionHead,
};
use buzz_core::company_members::{MemberKind, MemberPositionHead, MemberStatus};
use buzz_core::company_records::{parse_company_command, CompanyCommand};
use buzz_core::kind::{KIND_EMPLOYEE_REVISION_ACTION, KIND_EMPLOYEE_REVISION_HEAD};
use buzz_core::tenant::TenantContext;
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handle a member-signed employee configuration revision action.
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::EmployeeRevisionAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_employee_revision_action(&action)
        .map_err(|error| invalid(format!("employee revision action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_EMPLOYEE_REVISION_ACTION {
        return Err(invalid("employee revision action has the wrong event kind"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if event.verify().is_err() {
        return Err(invalid("employee revision action signature is invalid"));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write employee history",
        ));
    }

    let d_tag = employee_revision_d_tag(&action.employee_pubkey);
    validate_action_tags(&event, &d_tag, &action.employee_pubkey)?;
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

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-member-tree:{}", community_id.as_uuid()))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    let actor_role = sqlx::query_scalar::<_, String>(
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
        return Ok(duplicate_result(&event));
    }

    let employee_position = super::company_member_records::load_position_for_proposal(
        state,
        community_id,
        &action.employee_pubkey,
    )
    .await?
    .map(|(_, head)| head)
    .ok_or_else(|| forbidden("employee has no current member position"))?;
    if employee_position.kind != MemberKind::Employee {
        return Err(forbidden(
            "configuration history is only available for employees",
        ));
    }
    if !is_admin(&actor_role)
        && !is_active_direct_human_manager(state, community_id, &actor_pubkey, &employee_position)
            .await?
    {
        return Err(forbidden(
            "only a company owner, admin, or the employee's active direct human manager can change history",
        ));
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-employee-history:{}:{}",
            community_id.as_uuid(),
            action.employee_pubkey
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_EMPLOYEE_REVISION_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_employee_history_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(internal(
            "employee history head changed while its transaction lock was held",
        ));
    }
    let current = current_stored
        .as_ref()
        .map(parse_employee_history_head)
        .transpose()?;
    check_expected_head(&action, current_head_id.as_deref())?;
    if action.previous_revision_event_id.as_deref()
        != current.as_ref().map(|head| head.revision_event_id.as_str())
    {
        return Err(conflict(
            "employee revision predecessor changed; refresh history and retry",
        ));
    }

    let before = current
        .as_ref()
        .map(|head| &head.snapshot)
        .unwrap_or(&action.before);
    if before != &action.before {
        return Err(conflict(
            "employee configuration changed; refresh history and retry",
        ));
    }
    if action.before == action.after {
        return Err(invalid("employee revision must change the configuration"));
    }
    if action.action == EmployeeRevisionActionKind::Undo {
        let undo_event_id = action
            .undo_of_event_id
            .as_deref()
            .ok_or_else(|| invalid("undo needs undoOfEventId"))?;
        let restored_snapshot = load_revision_before_snapshot(
            state,
            community_id,
            undo_event_id,
            &action.employee_pubkey,
        )
        .await?;
        if action.after != restored_snapshot {
            return Err(invalid(
                "undo after snapshot must match the prior revision's before snapshot",
            ));
        }
    }

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let next = EmployeeRevisionHead {
        schema_version: 1,
        employee_pubkey: action.employee_pubkey.clone(),
        revision_event_id: event.id.to_hex(),
        previous_revision_event_id: action.previous_revision_event_id.clone(),
        snapshot: action.after.clone(),
        actor_pubkey,
        updated_at: now,
        source_action_event_id: event.id.to_hex(),
    };
    validate_employee_revision_head(&next)
        .map_err(|error| invalid(format!("employee revision head: {error}")))?;
    let head_event = super::business_records::relay_global_head_event(
        KIND_EMPLOYEE_REVISION_HEAD,
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
            "employee history changed before the revision committed; refresh and retry",
        ));
    }

    tx.commit().await.map_err(internal)?;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_EMPLOYEE_REVISION_ACTION,
        &event.pubkey.to_hex(),
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_EMPLOYEE_REVISION_HEAD,
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

async fn is_active_direct_human_manager(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    actor_pubkey: &str,
    employee: &MemberPositionHead,
) -> Result<bool, IngestError> {
    if employee.manager_pubkey.as_deref() != Some(actor_pubkey) {
        return Ok(false);
    }
    let manager = super::company_member_records::load_position_for_proposal(
        state,
        community_id,
        actor_pubkey,
    )
    .await?;
    Ok(manager.is_some_and(|(_, head)| {
        head.kind == MemberKind::Human && head.status == MemberStatus::Active
    }))
}

fn employee_revision_d_tag(employee_pubkey: &str) -> String {
    format!("company:employee-history:{employee_pubkey}")
}

fn validate_action_tags(
    event: &Event,
    expected_d_tag: &str,
    employee_pubkey: &str,
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
    if event.tags.len() != 2
        || d_tags.len() != 1
        || d_tags[0].content() != Some(expected_d_tag)
        || p_tags.len() != 1
        || p_tags[0].content() != Some(employee_pubkey)
    {
        return Err(invalid(
            "employee revision action needs its exact d-tag and employee p-tag",
        ));
    }
    Ok(())
}

async fn current_employee_history_head(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_EMPLOYEE_REVISION_HEAD as i32]);
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
        return Err(internal("duplicate employee history head coordinate"));
    }
    let head = rows.pop();
    if let Some(head) = &head {
        let parsed = parse_employee_history_head(head)?;
        if head.event.tags.len() != 1
            || head.event.tags[0].kind().to_string() != "d"
            || head.event.tags[0].content() != Some(d_tag)
            || d_tag != employee_revision_d_tag(&parsed.employee_pubkey)
        {
            return Err(internal("stored employee history head tags do not match"));
        }
    }
    Ok(head)
}

fn parse_employee_history_head(stored: &StoredEvent) -> Result<EmployeeRevisionHead, IngestError> {
    if stored.event.kind != Kind::Custom(KIND_EMPLOYEE_REVISION_HEAD as u16)
        || stored.event.verify().is_err()
    {
        return Err(internal(
            "stored employee history head signature is invalid",
        ));
    }
    let head = serde_json::from_str::<EmployeeRevisionHead>(&stored.event.content)
        .map_err(|_| internal("stored employee history head is invalid"))?;
    validate_employee_revision_head(&head)
        .map_err(|error| internal(format!("stored employee history head: {error}")))?;
    if head.revision_event_id != head.source_action_event_id {
        return Err(internal(
            "stored employee history revision reference differs",
        ));
    }
    Ok(head)
}

async fn load_revision_before_snapshot(
    state: &AppState,
    community_id: buzz_core::tenant::CommunityId,
    event_id: &str,
    employee_pubkey: &str,
) -> Result<EmployeeConfigSnapshot, IngestError> {
    let event_id = EventId::parse(event_id)
        .map_err(|_| invalid("undoOfEventId must be a valid revision event id"))?;
    let bytes = event_id.to_bytes();
    let rows = state
        .db
        .get_events_by_ids(community_id, &[bytes.as_slice()])
        .await
        .map_err(internal)?;
    let stored = rows
        .first()
        .ok_or_else(|| conflict("the selected prior revision is unavailable"))?;
    if stored.event.kind != Kind::Custom(KIND_EMPLOYEE_REVISION_ACTION as u16)
        || stored.event.verify().is_err()
    {
        return Err(invalid("undoOfEventId is not an employee revision"));
    }
    let prior = serde_json::from_str::<EmployeeRevisionAction>(&stored.event.content)
        .map_err(|_| internal("stored employee revision action is invalid"))?;
    validate_employee_revision_action(&prior)
        .map_err(|error| internal(format!("stored employee revision action: {error}")))?;
    let d_tag = employee_revision_d_tag(employee_pubkey);
    if prior.employee_pubkey != employee_pubkey
        || stored.event.tags.len() != 2
        || !stored
            .event
            .tags
            .iter()
            .any(|tag| tag.kind().to_string() == "d" && tag.content() == Some(d_tag.as_str()))
        || !stored
            .event
            .tags
            .iter()
            .any(|tag| tag.kind().to_string() == "p" && tag.content() == Some(employee_pubkey))
    {
        return Err(invalid("undoOfEventId belongs to a different employee"));
    }
    Ok(prior.before)
}

fn check_expected_head(
    action: &EmployeeRevisionAction,
    current_head_id: Option<&[u8]>,
) -> Result<(), IngestError> {
    match (
        action.expected_head_event_id.as_deref(),
        current_head_id,
        action.action,
    ) {
        (None, None, EmployeeRevisionActionKind::Record) => Ok(()),
        (Some(expected), Some(actual), _) if expected == hex::encode(actual) => Ok(()),
        (Some(_), Some(actual), _) => Err(conflict(format!(
            "employee history changed; current head is {}",
            hex::encode(actual)
        ))),
        (Some(_), None, _) => Err(conflict("employee history does not exist")),
        (None, Some(_), _) => Err(conflict("employee history already exists")),
        (None, None, _) => Err(invalid("undo requires expectedHeadEventId")),
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

#[cfg(test)]
mod postgres_tests {
    use super::*;

    use buzz_core::company_employee_history::employee_history_d_tag;
    use buzz_core::company_members::{
        member_d_tag, MemberPositionAction, MemberPositionActionKind,
    };
    use buzz_core::kind::{KIND_EMPLOYEE_REVISION_ACTION, KIND_MEMBER_POSITION_ACTION};
    use buzz_core::tenant::CommunityId;
    use nostr::{EventBuilder, Keys, Tag};
    use std::time::Duration;
    use uuid::Uuid;

    static HISTORY_DB_TEST_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
        std::sync::OnceLock::new();

    struct Fixture {
        state: Arc<AppState>,
        tenant: TenantContext,
        _pool: sqlx::PgPool,
        _serial_guard: tokio::sync::MutexGuard<'static, ()>,
        owner: Keys,
        manager: Keys,
        other_manager: Keys,
        employee: Keys,
        outsider: Keys,
    }

    async fn fixture() -> Fixture {
        let serial_guard = HISTORY_DB_TEST_LOCK
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
        let host = format!("employee-history-{}.test", community_uuid.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community_uuid)
            .bind(&host)
            .execute(&pool)
            .await
            .expect("insert test community");
        let tenant = TenantContext::resolved(CommunityId::from_uuid(community_uuid), host);
        let owner = Keys::generate();
        let manager = Keys::generate();
        let other_manager = Keys::generate();
        let employee = Keys::generate();
        let outsider = Keys::generate();
        for keys in [&owner, &manager, &other_manager, &employee, &outsider] {
            state
                .db
                .ensure_user(tenant.community(), &keys.public_key().to_bytes())
                .await
                .expect("ensure test identity");
        }
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
        for keys in [&manager, &other_manager] {
            state
                .db
                .add_relay_member(
                    tenant.community(),
                    &keys.public_key().to_hex(),
                    "member",
                    Some(&owner.public_key().to_hex()),
                )
                .await
                .expect("add human manager");
        }
        state
            .db
            .set_agent_owner(
                tenant.community(),
                &employee.public_key().to_bytes(),
                &owner.public_key().to_bytes(),
            )
            .await
            .expect("register employee agent");
        let fixture = Fixture {
            state,
            tenant,
            _pool: pool,
            _serial_guard: serial_guard,
            owner,
            manager,
            other_manager,
            employee,
            outsider,
        };
        write_position(&fixture, &fixture.owner, &fixture.manager, "Manager").await;
        write_position(
            &fixture,
            &fixture.owner,
            &fixture.other_manager,
            "Other manager",
        )
        .await;
        write_position(&fixture, &fixture.owner, &fixture.employee, "Employee").await;
        fixture
    }

    async fn write_position(fixture: &Fixture, actor: &Keys, target: &Keys, title: &str) {
        let action = MemberPositionAction {
            schema_version: 1,
            pubkey: target.public_key().to_hex(),
            action: MemberPositionActionKind::SetPosition,
            expected_head_event_id: None,
            title: Some(title.into()),
            manager_pubkey: Some(None),
            reason: None,
        };
        let d_tag = member_d_tag(&action.pubkey).expect("member d tag");
        let event = EventBuilder::new(
            Kind::Custom(KIND_MEMBER_POSITION_ACTION as u16),
            serde_json::to_string(&action).expect("serialize member position"),
        )
        .tags([Tag::parse(["d", d_tag.as_str()]).expect("member d tag")])
        .sign_with_keys(actor)
        .expect("sign member position");
        super::super::company_member_records::handle(
            &fixture.tenant,
            &fixture.state,
            event,
            auth(actor),
        )
        .await
        .expect("record member position");
    }

    async fn set_employee_manager(fixture: &Fixture, manager: &Keys) {
        let action = MemberPositionAction {
            schema_version: 1,
            pubkey: fixture.employee.public_key().to_hex(),
            action: MemberPositionActionKind::SetPosition,
            expected_head_event_id:
                super::super::company_member_records::load_position_for_proposal(
                    &fixture.state,
                    fixture.tenant.community(),
                    &fixture.employee.public_key().to_hex(),
                )
                .await
                .expect("load employee position")
                .map(|(event, _)| event.event.id.to_hex()),
            title: Some("Employee".into()),
            manager_pubkey: Some(Some(manager.public_key().to_hex())),
            reason: None,
        };
        let d_tag = member_d_tag(&action.pubkey).expect("member d tag");
        let event = EventBuilder::new(
            Kind::Custom(KIND_MEMBER_POSITION_ACTION as u16),
            serde_json::to_string(&action).expect("serialize member position"),
        )
        .tags([Tag::parse(["d", d_tag.as_str()]).expect("member d tag")])
        .sign_with_keys(&fixture.owner)
        .expect("sign member position");
        super::super::company_member_records::handle(
            &fixture.tenant,
            &fixture.state,
            event,
            auth(&fixture.owner),
        )
        .await
        .expect("set employee manager");
    }

    fn auth(keys: &Keys) -> IngestAuth {
        IngestAuth::Http {
            pubkey: keys.public_key(),
            scopes: vec![buzz_auth::Scope::MessagesWrite],
            auth_method: super::super::ingest::HttpAuthMethod::DevPubkey,
        }
    }

    fn revision_event(keys: &Keys, action: &EmployeeRevisionAction) -> Event {
        buzz_sdk::company_employee_history::build_employee_revision_action(action)
            .expect("build employee history action")
            .sign_with_keys(keys)
            .expect("sign employee history action")
    }

    fn snapshot(instructions: &str) -> EmployeeConfigSnapshot {
        EmployeeConfigSnapshot {
            instructions: Some(instructions.into()),
            ..EmployeeConfigSnapshot::default()
        }
    }

    fn record_action(
        employee_pubkey: String,
        expected_head_event_id: Option<String>,
        previous_revision_event_id: Option<String>,
        before: EmployeeConfigSnapshot,
        after: EmployeeConfigSnapshot,
    ) -> EmployeeRevisionAction {
        EmployeeRevisionAction {
            schema_version: 1,
            employee_pubkey,
            action: EmployeeRevisionActionKind::Record,
            expected_head_event_id,
            previous_revision_event_id,
            before,
            after,
            undo_of_event_id: None,
        }
    }

    async fn current_head(fixture: &Fixture) -> (StoredEvent, EmployeeRevisionHead) {
        let d_tag = employee_history_d_tag(&fixture.employee.public_key().to_hex())
            .expect("employee history coordinate");
        let stored =
            current_employee_history_head(&fixture.state, fixture.tenant.community(), &d_tag)
                .await
                .expect("query employee history head")
                .expect("employee history head");
        let head = parse_employee_history_head(&stored).expect("parse employee history head");
        (stored, head)
    }

    #[tokio::test]
    async fn employee_history_checks_authority_and_appends_undo_as_a_new_revision() {
        let fixture = fixture().await;
        set_employee_manager(&fixture, &fixture.manager).await;
        let employee = fixture.employee.public_key().to_hex();
        let first_before = EmployeeConfigSnapshot::default();
        let first_after = snapshot("Original instructions");
        let first = record_action(
            employee.clone(),
            None,
            None,
            first_before.clone(),
            first_after.clone(),
        );
        let first_event = revision_event(&fixture.owner, &first);
        handle(
            &fixture.tenant,
            &fixture.state,
            first_event.clone(),
            auth(&fixture.owner),
        )
        .await
        .expect("owner records first employee revision");
        let (first_head_event, first_head) = current_head(&fixture).await;
        assert_eq!(first_head.snapshot, first_after);
        assert_eq!(first_head.revision_event_id, first_event.id.to_hex());
        assert_eq!(first_head.previous_revision_event_id, None);

        let second_after = snapshot("Updated instructions");
        let second = record_action(
            employee.clone(),
            Some(first_head_event.event.id.to_hex()),
            Some(first_event.id.to_hex()),
            first_after.clone(),
            second_after.clone(),
        );
        let outsider_event = revision_event(&fixture.outsider, &second);
        assert!(matches!(
            handle(&fixture.tenant, &fixture.state, outsider_event, auth(&fixture.outsider)).await,
            Err(IngestError::Rejected(message)) if message.starts_with("restricted:")
        ));
        assert_eq!(current_head(&fixture).await.1.snapshot, first_after);

        let other_manager_event = revision_event(&fixture.other_manager, &second);
        assert!(matches!(
            handle(&fixture.tenant, &fixture.state, other_manager_event, auth(&fixture.other_manager)).await,
            Err(IngestError::Rejected(message)) if message.starts_with("restricted:")
        ));
        assert_eq!(current_head(&fixture).await.1.snapshot, first_after);

        let second_event = revision_event(&fixture.manager, &second);
        handle(
            &fixture.tenant,
            &fixture.state,
            second_event.clone(),
            auth(&fixture.manager),
        )
        .await
        .expect("active direct human manager records a revision");
        let (second_head_event, second_head) = current_head(&fixture).await;
        assert_eq!(second_head.snapshot, second_after);
        assert_eq!(
            second_head.previous_revision_event_id.as_deref(),
            Some(first_event.id.to_hex().as_str())
        );

        let stale = record_action(
            employee.clone(),
            Some(first_head_event.event.id.to_hex()),
            Some(first_event.id.to_hex()),
            first_after,
            snapshot("Stale instructions"),
        );
        let stale_event = revision_event(&fixture.owner, &stale);
        assert!(matches!(
            handle(&fixture.tenant, &fixture.state, stale_event, auth(&fixture.owner)).await,
            Err(IngestError::Rejected(message)) if message.starts_with("conflict:")
        ));
        assert_eq!(current_head(&fixture).await.1.snapshot, second_after);

        let undo = EmployeeRevisionAction {
            schema_version: 1,
            employee_pubkey: employee,
            action: EmployeeRevisionActionKind::Undo,
            expected_head_event_id: Some(second_head_event.event.id.to_hex()),
            previous_revision_event_id: Some(second_event.id.to_hex()),
            before: second_head.snapshot,
            after: first_before,
            undo_of_event_id: Some(first_event.id.to_hex()),
        };
        let undo_event = revision_event(&fixture.manager, &undo);
        handle(
            &fixture.tenant,
            &fixture.state,
            undo_event.clone(),
            auth(&fixture.manager),
        )
        .await
        .expect("direct manager appends an undo revision");
        let (undo_head_event, undo_head) = current_head(&fixture).await;
        assert_eq!(undo_head.snapshot, EmployeeConfigSnapshot::default());
        assert_eq!(undo_head.revision_event_id, undo_event.id.to_hex());
        assert_eq!(
            undo_head.previous_revision_event_id,
            Some(second_event.id.to_hex())
        );
        assert_ne!(undo_head_event.event.id.to_hex(), undo_event.id.to_hex());
    }

    #[tokio::test]
    async fn employee_history_action_rejects_channel_scopes_and_extra_tags() {
        let fixture = fixture().await;
        let employee = fixture.employee.public_key().to_hex();
        let action = record_action(
            employee,
            None,
            None,
            EmployeeConfigSnapshot::default(),
            snapshot("Instructions"),
        );
        let d_tag = employee_history_d_tag(&action.employee_pubkey).expect("employee d tag");
        let event = EventBuilder::new(
            Kind::Custom(KIND_EMPLOYEE_REVISION_ACTION as u16),
            serde_json::to_string(&action).expect("serialize action"),
        )
        .tags([
            Tag::parse(["d", d_tag.as_str()]).expect("d tag"),
            Tag::parse(["p", action.employee_pubkey.as_str()]).expect("p tag"),
            Tag::parse(["h", Uuid::new_v4().to_string().as_str()]).expect("h tag"),
        ])
        .sign_with_keys(&fixture.owner)
        .expect("sign action with forbidden extra tag");
        assert!(matches!(
            handle(&fixture.tenant, &fixture.state, event, auth(&fixture.owner)).await,
            Err(IngestError::Rejected(message)) if message.starts_with("invalid:")
        ));
    }
}
