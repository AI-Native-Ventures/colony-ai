//! Broker for company function slot records (kind 47061).
//!
//! Only a community owner or admin can assign a lead, hand a function to Scout
//! or clear a slot. A lead must be a member or a managed agent of this company.
//! Each function has its own relay-signed head (kind 30671); a missing head
//! reads as an empty slot.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use buzz_core::company_functions::{
    function_d_tag, validate_function_action, validate_function_d_tag, validate_function_head,
    CompanyFunction, FunctionAction, FunctionActionKind, FunctionHead, SlotState,
};
use buzz_core::company_members::MemberStatus;
use buzz_core::company_records::{
    parse_company_command, CompanyCommand, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_COMPANY_FUNCTION_ACTION, KIND_COMPANY_FUNCTION_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, duplicate_result, forbidden, internal, invalid,
    is_admin, relay_head_event, verify_stored_head,
};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles an owner or admin function slot action (kind 47061).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::FunctionAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_function_action(&action)
        .map_err(|error| invalid(format!("function action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_COMPANY_FUNCTION_ACTION {
        return Err(invalid("function action has the wrong event kind"));
    }
    if event.verify().is_err() {
        return Err(invalid("function action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write function slots",
        ));
    }
    let d_tag = command_d_tag(&event, "function")?;
    let tagged_function = validate_function_d_tag(&d_tag)
        .map_err(|error| invalid(format!("function command d tag: {error}")))?;
    if tagged_function != action.function {
        return Err(invalid("function command d tag must match its function"));
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
    let actor_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&actor_pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    // Members and managed agents (which have no owner or admin role) are refused.
    if !actor_role.as_deref().is_some_and(is_admin) {
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden(
            "only the owner or an admin can assign function slots",
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
        return Ok(duplicate_result(&event));
    }

    if let Some(lead) = action.lead_pubkey.as_deref() {
        // A lead is never the relay itself and must belong to this company.
        let is_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM relay_members WHERE community_id = $1 AND pubkey = $2)",
        )
        .bind(community_id.as_uuid())
        .bind(lead)
        .fetch_one(&mut *tx)
        .await
        .map_err(internal)?;
        let is_agent = !is_member
            && super::company_member_records::is_registered_employee(state, community_id, lead)
                .await?;
        if !is_member && !is_agent {
            tx.rollback().await.map_err(internal)?;
            return Err(forbidden(
                "the lead must be a member or an agent of this company",
            ));
        }
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-function:{}:{}",
            community_id.as_uuid(),
            action.function.id()
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_COMPANY_FUNCTION_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_function_head(state, community_id, action.function).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        tx.rollback().await.map_err(internal)?;
        return Err(internal(
            "function head changed while its transaction lock was held",
        ));
    }
    if let Err(error) = check_expected_head(
        "function slot",
        action.expected_head_event_id.as_deref(),
        current_head_id.as_deref(),
    ) {
        tx.rollback().await.map_err(internal)?;
        return Err(error);
    }

    let head = next_function_head(&action, &actor_pubkey);
    let head_event = relay_head_event(
        state,
        KIND_COMPANY_FUNCTION_HEAD,
        &d_tag,
        serde_json::to_string(&head).map_err(internal)?,
        current_stored.as_ref(),
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
            "function slot changed before the action could commit; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_COMPANY_FUNCTION_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_COMPANY_FUNCTION_HEAD,
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

/// The head a function action produces. `AssignLead` fills the slot,
/// `CoverByScout` clears the lead, `Clear` empties the slot.
fn next_function_head(action: &FunctionAction, actor_pubkey: &str) -> FunctionHead {
    let (state, lead_pubkey) = match action.kind {
        FunctionActionKind::AssignLead => (SlotState::Filled, action.lead_pubkey.clone()),
        FunctionActionKind::CoverByScout => (SlotState::CoveredByScout, None),
        FunctionActionKind::Clear => (SlotState::Empty, None),
    };
    FunctionHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        function: action.function,
        state,
        lead_pubkey,
        updated_by_pubkey: actor_pubkey.to_owned(),
        updated_at: Utc::now().timestamp(),
    }
}

pub(super) async fn current_function_head(
    state: &AppState,
    community_id: CommunityId,
    function: CompanyFunction,
) -> Result<Option<StoredEvent>, IngestError> {
    let d_tag = function_d_tag(function);
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_COMPANY_FUNCTION_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag.clone());
    query.global_only = true;
    query.limit = Some(2);
    let mut rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    if rows.len() > 1 {
        return Err(internal("stored function d-tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        let head = serde_json::from_str::<FunctionHead>(&stored.event.content)
            .map_err(|error| internal(format!("stored function head is invalid: {error}")))?;
        validate_function_head(&head)
            .map_err(|error| internal(format!("stored function head: {error}")))?;
        if head.function != function {
            return Err(internal("stored function head does not match its d-tag"));
        }
        verify_stored_head(stored, KIND_COMPANY_FUNCTION_HEAD, &d_tag, state)?;
    }
    Ok(stored)
}

/// The state of one function slot, `None` while it has no head.
pub(super) async fn current_function_state(
    state: &AppState,
    community_id: CommunityId,
    function: CompanyFunction,
) -> Result<Option<SlotState>, IngestError> {
    let Some(stored) = current_function_head(state, community_id, function).await? else {
        return Ok(None);
    };
    let head = serde_json::from_str::<FunctionHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored function head is invalid: {error}")))?;
    Ok(Some(head.state))
}

/// Whether `lead` can still run a function: not paused, terminated or archived,
/// and still a member or a managed agent of this company.
async fn lead_is_active(
    state: &AppState,
    community_id: CommunityId,
    lead: &str,
) -> Result<bool, IngestError> {
    if matches!(
        super::company_member_records::member_position_status(state, community_id, lead).await?,
        Some(MemberStatus::Paused | MemberStatus::Terminated)
    ) {
        return Ok(false);
    }
    if state
        .db
        .is_archived(community_id, lead)
        .await
        .map_err(internal)?
    {
        return Ok(false);
    }
    let is_member = state
        .db
        .get_relay_member(community_id, lead)
        .await
        .map_err(internal)?
        .is_some();
    if is_member {
        return Ok(true);
    }
    super::company_member_records::is_registered_employee(state, community_id, lead).await
}

/// Takes the per-function write lock the slot broker uses.
async fn lock_function_slot(
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    function: CompanyFunction,
) -> Result<(), IngestError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-function:{}:{}",
            community_id.as_uuid(),
            function.id()
        ))
        .execute(&mut **tx)
        .await
        .map_err(internal)?;
    Ok(())
}

/// Empties one slot inside `tx` when its head is still `expected_head_id`.
///
/// Returns the new head, or `None` when the slot changed since it was read so
/// the caller can decide whether to retry.
async fn empty_slot_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    function: CompanyFunction,
    expected_head_id: &[u8],
    actor_pubkey: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    lock_function_slot(tx, community_id, function).await?;
    let d_tag = function_d_tag(function);
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        KIND_COMPANY_FUNCTION_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    if current_head_id.as_deref() != Some(expected_head_id) {
        return Ok(None);
    }
    let current_stored = current_function_head(state, community_id, function).await?;
    let head = FunctionHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        function,
        state: SlotState::Empty,
        lead_pubkey: None,
        updated_by_pubkey: actor_pubkey.to_owned(),
        updated_at: Utc::now().timestamp(),
    };
    let head_event = relay_head_event(
        state,
        KIND_COMPANY_FUNCTION_HEAD,
        &d_tag,
        serde_json::to_string(&head).map_err(internal)?,
        current_stored.as_ref(),
    )?;
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            &head_event,
            &d_tag,
            None,
            ParameterizedReplacePrecondition::ExpectedRevision(expected_head_id),
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Ok(None);
    }
    Ok(Some(replaced.event))
}

/// Empties every slot led by `lead` inside `tx`, so a pause, termination or
/// removal commits together with the cleared slots or not at all.
///
/// Returns the new heads for the caller to dispatch after commit.
pub(super) async fn clear_slots_led_by_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    lead: &str,
    actor_pubkey: &str,
) -> Result<Vec<StoredEvent>, IngestError> {
    let mut cleared = Vec::new();
    for function in CompanyFunction::ALL {
        let Some(stored) = current_function_head(state, community_id, function).await? else {
            continue;
        };
        let head = serde_json::from_str::<FunctionHead>(&stored.event.content)
            .map_err(|error| internal(format!("stored function head is invalid: {error}")))?;
        if head.state != SlotState::Filled || head.lead_pubkey.as_deref() != Some(lead) {
            continue;
        }
        match empty_slot_in_tx(
            tx,
            state,
            community_id,
            function,
            &stored.event.id.to_bytes(),
            actor_pubkey,
        )
        .await?
        {
            Some(event) => cleared.push(event),
            None => {
                return Err(conflict(
                    "function slot changed while clearing it; refresh and retry",
                ))
            }
        }
    }
    Ok(cleared)
}

/// Empties every slot whose lead is no longer active (paused, terminated,
/// archived, removed or left).
///
/// Called after every path that can end an employee's or member's work and
/// before a slot is judged, so a stale lead never stays on the map. A failure
/// is returned to the caller, never swallowed: the slot stays stale and the
/// next call retries it.
pub(crate) async fn reconcile_function_slots(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    actor_pubkey: &str,
) -> Result<(), IngestError> {
    if actor_pubkey.len() == 64 {
        return Ok(());
    }
    let community_id = tenant.community();
    for function in CompanyFunction::ALL {
        let Some(stored) = current_function_head(state, community_id, function).await? else {
            continue;
        };
        let head = serde_json::from_str::<FunctionHead>(&stored.event.content)
            .map_err(|error| internal(format!("stored function head is invalid: {error}")))?;
        let Some(lead) = head.lead_pubkey.as_deref() else {
            continue;
        };
        if head.state != SlotState::Filled || lead_is_active(state, community_id, lead).await? {
            continue;
        }
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
        let cleared = empty_slot_in_tx(
            &mut tx,
            state,
            community_id,
            function,
            &stored.event.id.to_bytes(),
            actor_pubkey,
        )
        .await?;
        match cleared {
            Some(event) => {
                tx.commit().await.map_err(internal)?;
                super::event::dispatch_persistent_event(
                    tenant,
                    state,
                    &event,
                    KIND_COMPANY_FUNCTION_HEAD,
                    &state.relay_keypair.public_key().to_hex(),
                    None,
                )
                .await;
            }
            // Someone else changed the slot first; the next call looks again.
            None => tx.rollback().await.map_err(internal)?,
        }
    }
    Ok(())
}

/// Puts a newly hired employee into the slot their hire proposal named.
///
/// Runs inside the hire completion transaction, so the slot fills together
/// with the hired head or not at all. A hire with no slot intent changes
/// nothing. A slot that has meanwhile gained another active lead keeps that
/// lead: the hire still completes and the slot is not taken over.
pub(super) async fn assign_slot_for_hire_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    state: &AppState,
    community_id: CommunityId,
    hire_id: Uuid,
    employee_pubkey: &str,
    actor_pubkey: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let Some(intent) =
        super::company_access::current_slot_hire(state, community_id, hire_id).await?
    else {
        return Ok(None);
    };
    let function = intent.function;
    lock_function_slot(tx, community_id, function).await?;
    let d_tag = function_d_tag(function);
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        KIND_COMPANY_FUNCTION_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_function_head(state, community_id, function).await?;
    if let Some(stored) = &current_stored {
        let head = serde_json::from_str::<FunctionHead>(&stored.event.content)
            .map_err(|error| internal(format!("stored function head is invalid: {error}")))?;
        if let (SlotState::Filled, Some(lead)) = (head.state, head.lead_pubkey.as_deref()) {
            if lead != employee_pubkey && lead_is_active(state, community_id, lead).await? {
                return Ok(None);
            }
        }
    }
    let head = FunctionHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        function,
        state: SlotState::Filled,
        lead_pubkey: Some(employee_pubkey.to_owned()),
        updated_by_pubkey: actor_pubkey.to_owned(),
        updated_at: Utc::now().timestamp(),
    };
    validate_function_head(&head)
        .map_err(|error| internal(format!("function head for the hired lead: {error}")))?;
    let head_event = relay_head_event(
        state,
        KIND_COMPANY_FUNCTION_HEAD,
        &d_tag,
        serde_json::to_string(&head).map_err(internal)?,
        current_stored.as_ref(),
    )?;
    let precondition = current_head_id.as_deref().map_or(
        ParameterizedReplacePrecondition::CreateOnly,
        ParameterizedReplacePrecondition::ExpectedRevision,
    );
    let replaced = state
        .db
        .replace_parameterized_event_in_transaction(
            tx,
            community_id,
            &head_event,
            &d_tag,
            None,
            precondition,
        )
        .await
        .map_err(internal)?;
    if replaced.status != ParameterizedReplaceStatus::Inserted {
        return Err(conflict(
            "function slot changed before the hire could fill it; refresh and retry",
        ));
    }
    Ok(Some(replaced.event))
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use std::time::Duration;

        use tokio::sync::Mutex;
        use uuid::Uuid;

        use super::super::*;

        static FUNCTIONS_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

        struct Fixture {
            state: Arc<AppState>,
            tenant: TenantContext,
            _serial_guard: tokio::sync::MutexGuard<'static, ()>,
        }

        async fn fixture() -> Fixture {
            let serial_guard = FUNCTIONS_DB_TEST_LOCK
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
            let host = format!("company-functions-{}.test", community_id.simple());
            sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
                .bind(community_id)
                .bind(&host)
                .execute(&pool)
                .await
                .expect("insert test community");
            Fixture {
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

        fn function_action(
            function: CompanyFunction,
            kind: FunctionActionKind,
            lead: Option<&nostr::Keys>,
            expected: Option<&str>,
        ) -> FunctionAction {
            FunctionAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                function,
                kind,
                lead_pubkey: lead.map(|keys| keys.public_key().to_hex()),
                expected_head_event_id: expected.map(str::to_owned),
            }
        }

        async fn send(
            fixture: &Fixture,
            keys: &nostr::Keys,
            action: &FunctionAction,
        ) -> Result<IngestResult, IngestError> {
            let event = buzz_sdk::company_records::build_function_action(action)
                .expect("build function action")
                .sign_with_keys(keys)
                .expect("sign function action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn head_of(
            fixture: &Fixture,
            function: CompanyFunction,
        ) -> (StoredEvent, FunctionHead) {
            let stored =
                current_function_head(&fixture.state, fixture.tenant.community(), function)
                    .await
                    .expect("query function head")
                    .expect("function head exists");
            let head = serde_json::from_str(&stored.event.content).expect("function head");
            (stored, head)
        }

        fn rejection(result: Result<IngestResult, IngestError>) -> String {
            match result {
                Err(IngestError::Rejected(message)) => message,
                _ => panic!("expected a rejected function action"),
            }
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn assign_by_owner_sets_filled_with_lead() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let lead = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_member(&fixture, &lead, "member").await;

            let action = function_action(
                CompanyFunction::Sales,
                FunctionActionKind::AssignLead,
                Some(&lead),
                None,
            );
            send(&fixture, &owner, &action).await.expect("assign lead");

            let (stored, head) = head_of(&fixture, CompanyFunction::Sales).await;
            assert_eq!(
                stored.event.kind.as_u16() as u32,
                KIND_COMPANY_FUNCTION_HEAD
            );
            assert_eq!(
                stored.event.pubkey,
                fixture.state.relay_keypair.public_key()
            );
            assert!(stored.channel_id.is_none());
            assert_eq!(head.state, SlotState::Filled);
            assert_eq!(head.lead_pubkey, Some(lead.public_key().to_hex()));
            assert_eq!(head.updated_by_pubkey, owner.public_key().to_hex());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn assign_to_a_managed_agent_is_allowed() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = nostr::Keys::generate();
            let agent_bytes = agent.public_key().to_bytes();
            // The owner needs a users row before an agent can point at it.
            fixture
                .state
                .db
                .ensure_user(fixture.tenant.community(), &owner.public_key().to_bytes())
                .await
                .expect("ensure owner user");
            fixture
                .state
                .db
                .ensure_user(fixture.tenant.community(), &agent_bytes)
                .await
                .expect("ensure agent user");
            fixture
                .state
                .db
                .set_agent_owner(
                    fixture.tenant.community(),
                    &agent_bytes,
                    &owner.public_key().to_bytes(),
                )
                .await
                .expect("bind managed agent owner");

            let action = function_action(
                CompanyFunction::CustomerSuccess,
                FunctionActionKind::AssignLead,
                Some(&agent),
                None,
            );
            send(&fixture, &owner, &action)
                .await
                .expect("assign a managed agent as lead");
            let (_, head) = head_of(&fixture, CompanyFunction::CustomerSuccess).await;
            assert_eq!(head.state, SlotState::Filled);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn assign_to_non_member_is_denied() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let stranger = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;

            let action = function_action(
                CompanyFunction::Finance,
                FunctionActionKind::AssignLead,
                Some(&stranger),
                None,
            );
            let message = rejection(send(&fixture, &owner, &action).await);
            assert!(
                message.contains("the lead must be a member or an agent of this company"),
                "{message}"
            );
            let missing = current_function_head(
                &fixture.state,
                fixture.tenant.community(),
                CompanyFunction::Finance,
            )
            .await
            .expect("query function head");
            assert!(missing.is_none(), "a denied write must not create a head");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn assign_by_member_is_denied() {
            let fixture = fixture().await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;

            let action = function_action(
                CompanyFunction::Sales,
                FunctionActionKind::AssignLead,
                Some(&member),
                None,
            );
            let message = rejection(send(&fixture, &member, &action).await);
            assert!(
                message.contains("only the owner or an admin can assign function slots"),
                "{message}"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn cover_sets_covered_by_scout_and_clears_lead() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let lead = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_member(&fixture, &lead, "member").await;

            send(
                &fixture,
                &owner,
                &function_action(
                    CompanyFunction::Operations,
                    FunctionActionKind::AssignLead,
                    Some(&lead),
                    None,
                ),
            )
            .await
            .expect("assign lead");
            let first = head_of(&fixture, CompanyFunction::Operations)
                .await
                .0
                .event
                .id
                .to_hex();
            send(
                &fixture,
                &owner,
                &function_action(
                    CompanyFunction::Operations,
                    FunctionActionKind::CoverByScout,
                    None,
                    Some(first.as_str()),
                ),
            )
            .await
            .expect("cover by Scout");

            let (_, head) = head_of(&fixture, CompanyFunction::Operations).await;
            assert_eq!(head.state, SlotState::CoveredByScout);
            assert_eq!(head.lead_pubkey, None);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn clear_sets_empty() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;

            send(
                &fixture,
                &owner,
                &function_action(
                    CompanyFunction::Brand,
                    FunctionActionKind::CoverByScout,
                    None,
                    None,
                ),
            )
            .await
            .expect("cover by Scout");
            let first = head_of(&fixture, CompanyFunction::Brand)
                .await
                .0
                .event
                .id
                .to_hex();
            send(
                &fixture,
                &owner,
                &function_action(
                    CompanyFunction::Brand,
                    FunctionActionKind::Clear,
                    None,
                    Some(first.as_str()),
                ),
            )
            .await
            .expect("clear");

            let (_, head) = head_of(&fixture, CompanyFunction::Brand).await;
            assert_eq!(head.state, SlotState::Empty);
            assert_eq!(head.lead_pubkey, None);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn function_slots_are_independent_and_stale_heads_conflict() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;

            send(
                &fixture,
                &owner,
                &function_action(
                    CompanyFunction::Sales,
                    FunctionActionKind::CoverByScout,
                    None,
                    None,
                ),
            )
            .await
            .expect("cover sales");
            // Another function still has no head, so a writer expecting none succeeds there.
            send(
                &fixture,
                &owner,
                &function_action(
                    CompanyFunction::Finance,
                    FunctionActionKind::CoverByScout,
                    None,
                    None,
                ),
            )
            .await
            .expect("cover finance");
            // A writer that believes Sales has no head is stale.
            let message = rejection(
                send(
                    &fixture,
                    &owner,
                    &function_action(
                        CompanyFunction::Sales,
                        FunctionActionKind::Clear,
                        None,
                        None,
                    ),
                )
                .await,
            );
            assert!(message.starts_with("conflict:"), "{message}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn function_command_d_tag_must_match_its_function() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let action = function_action(
                CompanyFunction::Sales,
                FunctionActionKind::Clear,
                None,
                None,
            );
            let event = nostr::EventBuilder::new(
                nostr::Kind::Custom(KIND_COMPANY_FUNCTION_ACTION as u16),
                serde_json::to_string(&action).expect("serialize"),
            )
            .tags([nostr::Tag::parse(["d", "company:function:finance"]).expect("d tag")])
            .sign_with_keys(&owner)
            .expect("sign");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, event, auth(&owner)).await);
            assert!(message.contains("must match its function"), "{message}");
        }
    }
}
