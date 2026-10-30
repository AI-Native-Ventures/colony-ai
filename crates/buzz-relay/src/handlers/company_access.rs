//! Broker for the company access list, capability gaps and slot hires (kind 47066).
//!
//! One relay-signed head kind (30676) carries three record families told apart
//! by d-tag: `company:access:<id>`, `company:capgap:<id>` and
//! `company:slot-hire:<id>`. Who may write what:
//!
//! * grant, revoke, approve, decline and "done" are owner or admin only;
//! * an employee or member records a capability gap (co-founder mode must be on)
//!   and, as the proposer, finishes the setup once the owner said done;
//! * the proposer of a hire (or an owner or admin) records the slot that hire is for.
//!
//! An agent can never create an access entry directly: new access exists only
//! through an approved capability gap, which is the cost and consent gate.
//! Colony-run tools (WhatsApp, Discovery, credits) are checked against their
//! entry by [`access_revoked`] where the relay performs the action.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;
use sqlx::{Postgres, Transaction};

use buzz_core::company_access::{
    access_d_tag, builtin_access_entry, parse_access_d_tag, slot_hire_d_tag,
    validate_access_action, validate_access_head, validate_capability_gap_head,
    validate_slot_hire_head, AccessAction, AccessCategory, AccessHead, AccessOp, AccessState,
    CapabilityGapHead, GapState, SlotHireHead,
};
use buzz_core::company_functions::SlotState;
use buzz_core::company_records::{
    parse_company_command, CompanyCommand, HireStatus, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_COMPANY_ACCESS_ACTION, KIND_COMPANY_ACCESS_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;
use uuid::Uuid;

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, duplicate_result, forbidden, internal, invalid,
    is_admin, relay_head_event, verify_stored_head,
};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// One head the action writes, with the head it replaces.
struct HeadWrite {
    d_tag: String,
    content: String,
    current: Option<StoredEvent>,
    current_head_id: Option<Vec<u8>>,
}

/// Handles an access list, capability gap or slot hire write (kind 47066).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    let command = parse_company_command(u32::from(event.kind.as_u16()), &event.content)
        .map_err(|error| invalid(format!("company command: {error}")))?;
    let CompanyCommand::AccessAction(action) = command else {
        return Err(IngestError::Rejected(
            "restricted: this company-record action is not enabled on this relay".into(),
        ));
    };
    validate_access_action(&action).map_err(|error| invalid(format!("access action: {error}")))?;
    if u32::from(event.kind.as_u16()) != KIND_COMPANY_ACCESS_ACTION {
        return Err(invalid("access action has the wrong event kind"));
    }
    if event.verify().is_err() {
        return Err(invalid("access action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write access records",
        ));
    }
    let d_tag = command_d_tag(&event, "access")?;
    let expected_d_tag = action
        .d_tag()
        .map_err(|error| invalid(format!("access action: {error}")))?;
    if d_tag != expected_d_tag {
        return Err(invalid("access command d tag must match its record"));
    }

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    if action.op == AccessOp::SlotHireSet {
        // Heal a slot whose lead already left before the slot is judged below.
        super::company_functions::reconcile_function_slots(tenant, state, &actor_pubkey).await?;
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
    let actor_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2 FOR UPDATE",
    )
    .bind(community_id.as_uuid())
    .bind(&actor_pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(internal)?;
    let actor_is_admin = actor_role.as_deref().is_some_and(is_admin);
    // Managed agents have no relay role; they count as employees of this company.
    let actor_is_known = actor_role.is_some()
        || super::company_member_records::is_registered_employee(
            state,
            community_id,
            &actor_pubkey,
        )
        .await?;
    if !actor_is_known {
        tx.rollback().await.map_err(internal)?;
        return Err(forbidden(
            "only a member or an agent of this company can write here",
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

    // One lock for the whole access family keeps a two-head write (finishing a
    // gap creates its access entry) free of interleaving writers.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("company-access:{}", community_id.as_uuid()))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;

    let now = Utc::now().timestamp();
    let writes = match plan_writes(
        state,
        &mut tx,
        community_id,
        &action,
        &d_tag,
        &actor_pubkey,
        actor_is_admin,
        now,
    )
    .await
    {
        Ok(writes) => writes,
        Err(error) => {
            tx.rollback().await.map_err(internal)?;
            return Err(error);
        }
    };

    let (stored_action, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community_id, &event, None)
            .await
            .map_err(internal)?;
    if !inserted {
        tx.rollback().await.map_err(internal)?;
        return Ok(duplicate_result(&event));
    }
    let mut stored_heads = Vec::with_capacity(writes.len());
    for write in &writes {
        let head_event = relay_head_event(
            state,
            KIND_COMPANY_ACCESS_HEAD,
            &write.d_tag,
            write.content.clone(),
            write.current.as_ref(),
        )?;
        let precondition = write.current_head_id.as_deref().map_or(
            ParameterizedReplacePrecondition::CreateOnly,
            ParameterizedReplacePrecondition::ExpectedRevision,
        );
        let replaced = state
            .db
            .replace_parameterized_event_in_transaction(
                &mut tx,
                community_id,
                &head_event,
                &write.d_tag,
                None,
                precondition,
            )
            .await
            .map_err(internal)?;
        if replaced.status != ParameterizedReplaceStatus::Inserted {
            tx.rollback().await.map_err(internal)?;
            return Err(conflict(
                "access record changed before the action could commit; refresh and retry",
            ));
        }
        stored_heads.push(replaced.event);
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_COMPANY_ACCESS_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    for head in &stored_heads {
        super::event::dispatch_persistent_event(
            tenant,
            state,
            head,
            KIND_COMPANY_ACCESS_HEAD,
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

/// Locks the head at `d_tag`, loads it and refuses when the two disagree.
async fn lock_head(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<(Option<StoredEvent>, Option<Vec<u8>>), IngestError> {
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        tx,
        community_id,
        KIND_COMPANY_ACCESS_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        d_tag,
    )
    .await
    .map_err(internal)?;
    let current = current_access_head(state, community_id, d_tag).await?;
    if current
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(internal(
            "access head changed while its transaction lock was held",
        ));
    }
    Ok((current, current_head_id))
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, IngestError> {
    serde_json::to_string(value).map_err(internal)
}

fn parse_gap(stored: &StoredEvent) -> Result<CapabilityGapHead, IngestError> {
    let head = serde_json::from_str::<CapabilityGapHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored capability gap head is invalid: {error}")))?;
    validate_capability_gap_head(&head)
        .map_err(|error| internal(format!("stored capability gap head: {error}")))?;
    Ok(head)
}

fn parse_access(stored: &StoredEvent) -> Result<AccessHead, IngestError> {
    let head = serde_json::from_str::<AccessHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored access head is invalid: {error}")))?;
    validate_access_head(&head)
        .map_err(|error| internal(format!("stored access head: {error}")))?;
    Ok(head)
}

fn admin_only(is_admin: bool, message: &'static str) -> Result<(), IngestError> {
    if is_admin {
        Ok(())
    } else {
        Err(forbidden(message))
    }
}

/// Works out which heads the action writes. Runs inside the open transaction
/// and holds the head locks; the caller rolls back on any error.
#[allow(clippy::too_many_arguments)]
async fn plan_writes(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    community_id: CommunityId,
    action: &AccessAction,
    d_tag: &str,
    actor: &str,
    actor_is_admin: bool,
    now: i64,
) -> Result<Vec<HeadWrite>, IngestError> {
    let (current, current_head_id) = lock_head(state, tx, community_id, d_tag).await?;
    check_expected_head(
        "access record",
        action.expected_head_event_id.as_deref(),
        current_head_id.as_deref(),
    )?;
    match action.op {
        AccessOp::Grant => {
            admin_only(
                actor_is_admin,
                "only the owner or an admin can grant access",
            )?;
            let (Some(access_id), Some(entry)) = (action.access_id.as_ref(), action.entry.as_ref())
            else {
                return Err(invalid("grant needs accessId and entry"));
            };
            let head = AccessHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                access_id: access_id.clone(),
                entry: entry.clone(),
                state: AccessState::Active,
                granted_by_pubkey: actor.to_owned(),
                granted_at: now,
                via_gap_id: None,
                revoked_by_pubkey: None,
                revoked_at: None,
                revoke_reason: None,
                updated_at: now,
            };
            Ok(vec![access_write(d_tag, &head, current, current_head_id)?])
        }
        AccessOp::Revoke => {
            admin_only(
                actor_is_admin,
                "only the owner or an admin can revoke access",
            )?;
            let access_id = action
                .access_id
                .as_deref()
                .ok_or_else(|| invalid("revoke needs accessId"))?;
            let mut head = match current.as_ref() {
                Some(stored) => parse_access(stored)?,
                // Colony-run tools exist before anyone grants them; revoking one
                // starts from its built-in entry.
                None => {
                    let entry = action
                        .entry
                        .clone()
                        .or_else(|| builtin_access_entry(access_id))
                        .ok_or_else(|| conflict("there is no such access entry to revoke"))?;
                    AccessHead {
                        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                        access_id: access_id.to_owned(),
                        entry,
                        state: AccessState::Active,
                        granted_by_pubkey: actor.to_owned(),
                        granted_at: now,
                        via_gap_id: None,
                        revoked_by_pubkey: None,
                        revoked_at: None,
                        revoke_reason: None,
                        updated_at: now,
                    }
                }
            };
            if head.state == AccessState::Revoked {
                return Err(conflict("this access is already revoked"));
            }
            head.state = AccessState::Revoked;
            head.revoked_by_pubkey = Some(actor.to_owned());
            head.revoked_at = Some(now);
            head.revoke_reason = action.reason.clone();
            head.updated_at = now;
            Ok(vec![access_write(d_tag, &head, current, current_head_id)?])
        }
        AccessOp::GapPropose => {
            if !super::company_cofounder::cofounder_enabled(state, community_id).await? {
                return Err(forbidden(
                    "co-founder mode is off, so capability gaps are not recorded",
                ));
            }
            let (Some(gap_id), Some(gap)) = (action.gap_id, action.gap.as_ref()) else {
                return Err(invalid("gap_propose needs gapId and gap"));
            };
            let head = CapabilityGapHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                gap_id,
                gap: gap.clone(),
                state: GapState::Proposed,
                proposed_by_pubkey: actor.to_owned(),
                proposed_at: now,
                approved_by_pubkey: None,
                approved_at: None,
                approved_cost_cents: None,
                human_done_at: None,
                completed_at: None,
                declined_reason: None,
                updated_at: now,
            };
            Ok(vec![gap_write(d_tag, &head, current, current_head_id)?])
        }
        AccessOp::GapApprove | AccessOp::GapDecline | AccessOp::GapDone => {
            admin_only(
                actor_is_admin,
                "only the owner or an admin can approve, decline or finish a gap step",
            )?;
            let stored = current
                .as_ref()
                .ok_or_else(|| conflict("gap does not exist"))?;
            let mut head = parse_gap(stored)?;
            match (action.op, head.state) {
                (AccessOp::GapApprove, GapState::Proposed) => {
                    let cost = head
                        .gap
                        .chosen_option()
                        .map(|option| option.cost_cents)
                        .ok_or_else(|| internal("stored gap has no chosen option"))?;
                    head.state = GapState::Approved;
                    head.approved_by_pubkey = Some(actor.to_owned());
                    head.approved_at = Some(now);
                    head.approved_cost_cents = Some(cost);
                }
                (AccessOp::GapDecline, GapState::Proposed | GapState::Approved) => {
                    head.state = GapState::Declined;
                    head.declined_reason = action.reason.clone();
                }
                (AccessOp::GapDone, GapState::Approved) => {
                    head.state = GapState::HumanDone;
                    head.human_done_at = Some(now);
                }
                _ => return Err(conflict("the gap is not in a state that accepts this step")),
            }
            head.updated_at = now;
            Ok(vec![gap_write(d_tag, &head, current, current_head_id)?])
        }
        AccessOp::GapComplete => {
            let stored = current
                .as_ref()
                .ok_or_else(|| conflict("gap does not exist"))?;
            let mut head = parse_gap(stored)?;
            if !actor_is_admin && head.proposed_by_pubkey != actor {
                return Err(forbidden(
                    "only the owner, an admin or the agent that proposed the gap can finish it",
                ));
            }
            if head.state != GapState::HumanDone {
                return Err(conflict(
                    "the gap needs the owner's approval and the human step before it can be finished",
                ));
            }
            // The cost the owner approved must still be the cost on the gap.
            let approved = head.approved_cost_cents;
            let stated = head.gap.chosen_option().map(|option| option.cost_cents);
            if approved.is_none() || approved != stated {
                return Err(conflict("the approved cost does not match the gap"));
            }
            let access_id = head.gap.access_id.clone();
            let access_tag = access_d_tag(&access_id);
            let (access_current, access_head_id) =
                lock_head(state, tx, community_id, &access_tag).await?;
            let access = AccessHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                access_id,
                entry: head.gap.access.clone(),
                state: AccessState::Active,
                granted_by_pubkey: actor.to_owned(),
                granted_at: now,
                via_gap_id: Some(head.gap_id),
                revoked_by_pubkey: None,
                revoked_at: None,
                revoke_reason: None,
                updated_at: now,
            };
            head.state = GapState::Completed;
            head.completed_at = Some(now);
            head.updated_at = now;
            Ok(vec![
                gap_write(d_tag, &head, current, current_head_id)?,
                access_write(&access_tag, &access, access_current, access_head_id)?,
            ])
        }
        AccessOp::SlotHireSet => {
            let (Some(hire_id), Some(function)) = (action.hire_id, action.function) else {
                return Err(invalid("slot_hire_set needs hireId and function"));
            };
            let hire_tag = buzz_core::company_records::hire_d_tag(hire_id);
            let hire_stored =
                super::company_hires::current_hire_head(state, community_id, &hire_tag)
                    .await?
                    .ok_or_else(|| conflict("that hire does not exist"))?;
            let hire = super::company_hires::parse_hire_head(&hire_stored)?;
            if !actor_is_admin && hire.proposed_by_pubkey != actor {
                return Err(forbidden(
                    "only the owner, an admin or the proposer of the hire can choose its slot",
                ));
            }
            if !matches!(
                hire.status,
                HireStatus::Proposed | HireStatus::AwaitingFounder
            ) {
                return Err(conflict(
                    "the slot can only be chosen while the hire is waiting for a decision",
                ));
            }
            // The caller already healed slots whose lead left; refuse one that still has a lead.
            if let Some(slot) =
                super::company_functions::current_function_state(state, community_id, function)
                    .await?
            {
                if slot == SlotState::Filled {
                    return Err(conflict(
                        "that slot already has a lead; clear it before hiring into it",
                    ));
                }
            }
            let head = SlotHireHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                hire_id,
                function,
                set_by_pubkey: actor.to_owned(),
                updated_at: now,
            };
            validate_slot_hire_head(&head)
                .map_err(|error| internal(format!("slot hire head: {error}")))?;
            Ok(vec![HeadWrite {
                d_tag: d_tag.to_owned(),
                content: to_json(&head)?,
                current,
                current_head_id,
            }])
        }
    }
}

fn access_write(
    d_tag: &str,
    head: &AccessHead,
    current: Option<StoredEvent>,
    current_head_id: Option<Vec<u8>>,
) -> Result<HeadWrite, IngestError> {
    validate_access_head(head).map_err(|error| internal(format!("access head: {error}")))?;
    Ok(HeadWrite {
        d_tag: d_tag.to_owned(),
        content: to_json(head)?,
        current,
        current_head_id,
    })
}

fn gap_write(
    d_tag: &str,
    head: &CapabilityGapHead,
    current: Option<StoredEvent>,
    current_head_id: Option<Vec<u8>>,
) -> Result<HeadWrite, IngestError> {
    validate_capability_gap_head(head)
        .map_err(|error| internal(format!("capability gap head: {error}")))?;
    Ok(HeadWrite {
        d_tag: d_tag.to_owned(),
        content: to_json(head)?,
        current,
        current_head_id,
    })
}

/// Loads the stored head at `d_tag` (any of the three record families).
pub(super) async fn current_access_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    parse_access_d_tag(d_tag).map_err(|error| internal(format!("access d-tag: {error}")))?;
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_COMPANY_ACCESS_HEAD as i32]);
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
        return Err(internal("stored access d-tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        verify_stored_head(stored, KIND_COMPANY_ACCESS_HEAD, d_tag, state)?;
    }
    Ok(stored)
}

/// The slot hire intent recorded for `hire_id`, when there is one.
pub(super) async fn current_slot_hire(
    state: &AppState,
    community_id: CommunityId,
    hire_id: Uuid,
) -> Result<Option<SlotHireHead>, IngestError> {
    let Some(stored) = current_access_head(state, community_id, &slot_hire_d_tag(hire_id)).await?
    else {
        return Ok(None);
    };
    let head = serde_json::from_str::<SlotHireHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored slot hire head is invalid: {error}")))?;
    validate_slot_hire_head(&head)
        .map_err(|error| internal(format!("stored slot hire head: {error}")))?;
    if head.hire_id != hire_id {
        return Err(internal("stored slot hire head does not match its d-tag"));
    }
    Ok(Some(head))
}

/// Whether a Colony-run tool was revoked. Used where the relay itself performs
/// the action (WhatsApp sends, Discovery search, the credits gateway).
///
/// A tool with no head is available. Any lookup failure is an error so the
/// caller refuses the action instead of letting a revoked tool through.
pub(crate) async fn access_revoked(
    state: &AppState,
    community_id: CommunityId,
    category: AccessCategory,
) -> Result<bool, String> {
    let Some(access_id) = category.fixed_access_id() else {
        return Ok(false);
    };
    let d_tag = access_d_tag(access_id);
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_COMPANY_ACCESS_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(d_tag);
    query.global_only = true;
    query.limit = Some(2);
    let rows = state
        .db
        .query_events(&query)
        .await
        .map_err(|error| format!("access lookup failed: {error}"))?;
    let Some(stored) = rows.first() else {
        return Ok(false);
    };
    let head = serde_json::from_str::<AccessHead>(&stored.event.content)
        .map_err(|error| format!("stored access head is invalid: {error}"))?;
    Ok(head.state == AccessState::Revoked)
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use std::time::Duration;

        use buzz_core::company_access::{
            builtin_access_entry, gap_d_tag, AccessEntry, CapabilityGap, GapOption,
        };
        use buzz_core::company_cofounder::CofounderSettings;
        use tokio::sync::Mutex;

        use super::super::*;

        static ACCESS_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

        struct Fixture {
            state: Arc<AppState>,
            tenant: TenantContext,
            _serial_guard: tokio::sync::MutexGuard<'static, ()>,
        }

        async fn fixture() -> Fixture {
            let serial_guard = ACCESS_DB_TEST_LOCK
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
            let host = format!("company-access-{}.test", community_id.simple());
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

        /// A managed agent owned by `owner`, which is how Scout and employees sign.
        async fn add_agent(fixture: &Fixture, owner: &nostr::Keys) -> nostr::Keys {
            let agent = nostr::Keys::generate();
            let community = fixture.tenant.community();
            for keys in [owner, &agent] {
                fixture
                    .state
                    .db
                    .ensure_user(community, &keys.public_key().to_bytes())
                    .await
                    .expect("ensure user");
            }
            fixture
                .state
                .db
                .set_agent_owner(
                    community,
                    &agent.public_key().to_bytes(),
                    &owner.public_key().to_bytes(),
                )
                .await
                .expect("bind managed agent owner");
            agent
        }

        fn auth(keys: &nostr::Keys) -> IngestAuth {
            IngestAuth::Http {
                pubkey: keys.public_key(),
                scopes: vec![buzz_auth::Scope::MessagesWrite],
                auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
            }
        }

        fn blank(op: AccessOp) -> AccessAction {
            AccessAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                op,
                access_id: None,
                gap_id: None,
                hire_id: None,
                entry: None,
                gap: None,
                function: None,
                reason: None,
                expected_head_event_id: None,
            }
        }

        async fn send(
            fixture: &Fixture,
            keys: &nostr::Keys,
            action: AccessAction,
        ) -> Result<IngestResult, IngestError> {
            let event = buzz_sdk::company_records::build_access_action(&action)
                .expect("build access action")
                .sign_with_keys(keys)
                .expect("sign access action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn head_id(fixture: &Fixture, d_tag: &str) -> Option<String> {
            current_access_head(&fixture.state, fixture.tenant.community(), d_tag)
                .await
                .expect("query access head")
                .map(|stored| stored.event.id.to_hex())
        }

        async fn access_head(fixture: &Fixture, access_id: &str) -> AccessHead {
            let stored = current_access_head(
                &fixture.state,
                fixture.tenant.community(),
                &access_d_tag(access_id),
            )
            .await
            .expect("query access head")
            .expect("access head exists");
            serde_json::from_str(&stored.event.content).expect("access head")
        }

        async fn gap_head(fixture: &Fixture, gap_id: Uuid) -> CapabilityGapHead {
            let stored = current_access_head(
                &fixture.state,
                fixture.tenant.community(),
                &gap_d_tag(gap_id),
            )
            .await
            .expect("query gap head")
            .expect("gap head exists");
            serde_json::from_str(&stored.event.content).expect("gap head")
        }

        fn rejection(result: Result<IngestResult, IngestError>) -> String {
            match result {
                Err(IngestError::Rejected(message)) => message,
                Err(other) => panic!("expected a rejection, got {other:?}"),
                Ok(accepted) => panic!(
                    "expected a rejection, the relay accepted {}",
                    accepted.event_id
                ),
            }
        }

        async fn cofounder_on(fixture: &Fixture, owner: &nostr::Keys) {
            let settings = CofounderSettings {
                enabled: true,
                ..CofounderSettings::default()
            };
            let event = buzz_sdk::company_records::build_cofounder_action(&settings, None)
                .expect("build co-founder action")
                .sign_with_keys(owner)
                .expect("sign co-founder action");
            crate::handlers::company_cofounder::handle(
                &fixture.tenant,
                &fixture.state,
                event,
                auth(owner),
            )
            .await
            .expect("turn co-founder mode on");
        }

        fn sample_gap() -> CapabilityGap {
            CapabilityGap {
                title: "Sign up for a free e-sign tool".into(),
                need: "Clients sign agreements in Colony".into(),
                options: vec![GapOption {
                    name: "Free sign".into(),
                    cost_text: "Free".into(),
                    cost_cents: 0,
                    recurring: false,
                    works: true,
                    note: None,
                }],
                chosen: 0,
                chosen_reason: None,
                human_step: "Choose a password, then tell me".into(),
                page_url: Some("https://example.com/signup".into()),
                access_id: "esign".into(),
                access: AccessEntry {
                    name: "E-sign, free plan".into(),
                    category: AccessCategory::Esign,
                    used_for: "Agreements to sign".into(),
                    agents: vec![],
                    cost: "Free, 3 a month".into(),
                },
            }
        }

        async fn propose_gap(fixture: &Fixture, agent: &nostr::Keys) -> Uuid {
            let gap_id = Uuid::new_v4();
            send(
                fixture,
                agent,
                AccessAction {
                    gap_id: Some(gap_id),
                    gap: Some(sample_gap()),
                    ..blank(AccessOp::GapPropose)
                },
            )
            .await
            .expect("the agent records a capability gap");
            gap_id
        }

        async fn gap_step(
            fixture: &Fixture,
            keys: &nostr::Keys,
            op: AccessOp,
            gap_id: Uuid,
        ) -> Result<IngestResult, IngestError> {
            send(
                fixture,
                keys,
                AccessAction {
                    gap_id: Some(gap_id),
                    expected_head_event_id: head_id(fixture, &gap_d_tag(gap_id)).await,
                    ..blank(op)
                },
            )
            .await
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn revoking_a_colony_run_tool_flips_the_relay_gate() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let community = fixture.tenant.community();
            assert!(
                !access_revoked(&fixture.state, community, AccessCategory::Whatsapp)
                    .await
                    .expect("lookup")
            );

            send(
                &fixture,
                &owner,
                AccessAction {
                    access_id: Some("whatsapp".into()),
                    reason: Some("pause outreach".into()),
                    ..blank(AccessOp::Revoke)
                },
            )
            .await
            .expect("owner revokes WhatsApp");

            assert!(
                access_revoked(&fixture.state, community, AccessCategory::Whatsapp)
                    .await
                    .expect("lookup")
            );
            assert!(
                !access_revoked(&fixture.state, community, AccessCategory::Discovery)
                    .await
                    .expect("lookup"),
                "revoking one tool leaves the others on"
            );
            let head = access_head(&fixture, "whatsapp").await;
            assert_eq!(head.state, AccessState::Revoked);
            assert_eq!(head.revoke_reason.as_deref(), Some("pause outreach"));
            assert_eq!(head.revoked_by_pubkey, Some(owner.public_key().to_hex()));

            let again = rejection(
                send(
                    &fixture,
                    &owner,
                    AccessAction {
                        access_id: Some("whatsapp".into()),
                        expected_head_event_id: head_id(&fixture, &access_d_tag("whatsapp")).await,
                        ..blank(AccessOp::Revoke)
                    },
                )
                .await,
            );
            assert!(again.starts_with("conflict:"), "{again}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_member_or_agent_cannot_revoke_or_grant_access() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            let member = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            add_member(&fixture, &member, "member").await;
            let agent = add_agent(&fixture, &owner).await;
            let stranger = nostr::Keys::generate();

            let revoke = AccessAction {
                access_id: Some("whatsapp".into()),
                ..blank(AccessOp::Revoke)
            };
            let message = rejection(send(&fixture, &member, revoke.clone()).await);
            assert!(
                message.contains("only the owner or an admin can revoke access"),
                "{message}"
            );
            let grant = AccessAction {
                access_id: Some("whatsapp".into()),
                entry: builtin_access_entry("whatsapp"),
                ..blank(AccessOp::Grant)
            };
            let message = rejection(send(&fixture, &agent, grant).await);
            assert!(
                message.contains("only the owner or an admin can grant access"),
                "{message}"
            );
            let message = rejection(send(&fixture, &stranger, revoke).await);
            assert!(
                message.contains("only a member or an agent of this company can write here"),
                "{message}"
            );
            assert!(
                !access_revoked(
                    &fixture.state,
                    fixture.tenant.community(),
                    AccessCategory::Whatsapp
                )
                .await
                .expect("lookup"),
                "a refused revoke must not change the gate"
            );
            assert!(head_id(&fixture, &access_d_tag("whatsapp")).await.is_none());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn an_agent_cannot_reach_new_access_without_the_owner() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_agent(&fixture, &owner).await;
            cofounder_on(&fixture, &owner).await;
            let gap_id = propose_gap(&fixture, &agent).await;
            assert_eq!(gap_head(&fixture, gap_id).await.state, GapState::Proposed);

            // The agent cannot approve its own gap or finish it before the owner acts.
            let message = rejection(gap_step(&fixture, &agent, AccessOp::GapApprove, gap_id).await);
            assert!(message.contains("only the owner or an admin"), "{message}");
            let message =
                rejection(gap_step(&fixture, &agent, AccessOp::GapComplete, gap_id).await);
            assert!(message.contains("approval and the human step"), "{message}");

            gap_step(&fixture, &owner, AccessOp::GapApprove, gap_id)
                .await
                .expect("owner approves the stated cost");
            let approved = gap_head(&fixture, gap_id).await;
            assert_eq!(approved.state, GapState::Approved);
            assert_eq!(approved.approved_cost_cents, Some(0));
            assert_eq!(
                approved.approved_by_pubkey,
                Some(owner.public_key().to_hex())
            );
            let message =
                rejection(gap_step(&fixture, &agent, AccessOp::GapComplete, gap_id).await);
            assert!(message.contains("approval and the human step"), "{message}");

            gap_step(&fixture, &owner, AccessOp::GapDone, gap_id)
                .await
                .expect("owner does the human step");
            assert!(
                head_id(&fixture, &access_d_tag("esign")).await.is_none(),
                "no access exists until the setup is finished"
            );

            gap_step(&fixture, &agent, AccessOp::GapComplete, gap_id)
                .await
                .expect("the agent finishes the setup");
            let done = gap_head(&fixture, gap_id).await;
            assert_eq!(done.state, GapState::Completed);
            let access = access_head(&fixture, "esign").await;
            assert_eq!(access.state, AccessState::Active);
            assert_eq!(access.via_gap_id, Some(gap_id));
            assert_eq!(access.entry.name, "E-sign, free plan");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn only_the_proposer_or_an_admin_can_finish_a_gap() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let proposer = add_agent(&fixture, &owner).await;
            let other = add_agent(&fixture, &owner).await;
            cofounder_on(&fixture, &owner).await;
            let gap_id = propose_gap(&fixture, &proposer).await;
            gap_step(&fixture, &owner, AccessOp::GapApprove, gap_id)
                .await
                .expect("approve");
            gap_step(&fixture, &owner, AccessOp::GapDone, gap_id)
                .await
                .expect("done");

            let message =
                rejection(gap_step(&fixture, &other, AccessOp::GapComplete, gap_id).await);
            assert!(
                message.contains("or the agent that proposed the gap can finish it"),
                "{message}"
            );
            assert!(head_id(&fixture, &access_d_tag("esign")).await.is_none());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_capability_gap_is_refused_while_cofounder_mode_is_off() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_agent(&fixture, &owner).await;
            let message = rejection(
                send(
                    &fixture,
                    &agent,
                    AccessAction {
                        gap_id: Some(Uuid::new_v4()),
                        gap: Some(sample_gap()),
                        ..blank(AccessOp::GapPropose)
                    },
                )
                .await,
            );
            assert!(message.contains("co-founder mode is off"), "{message}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_revoked_whatsapp_entry_refuses_non_owner_sends() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_agent(&fixture, &owner).await;
            let send_request = |keys: &nostr::Keys| {
                nostr::EventBuilder::new(
                    nostr::Kind::Custom(buzz_core::kind::KIND_WHATSAPP_SEND_REQUEST as u16),
                    "{}",
                )
                .sign_with_keys(keys)
                .expect("sign send request")
            };

            let before = crate::handlers::whatsapp_commands::handle(
                &fixture.tenant,
                &fixture.state,
                send_request(&agent),
                auth(&agent),
            )
            .await;
            let before = rejection(before);
            assert!(!before.contains("revoked"), "{before}");

            send(
                &fixture,
                &owner,
                AccessAction {
                    access_id: Some("whatsapp".into()),
                    ..blank(AccessOp::Revoke)
                },
            )
            .await
            .expect("owner revokes WhatsApp");

            let after = crate::handlers::whatsapp_commands::handle(
                &fixture.tenant,
                &fixture.state,
                send_request(&agent),
                auth(&agent),
            )
            .await;
            let after = rejection(after);
            assert!(after.contains("WhatsApp access was revoked"), "{after}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_revoked_discovery_entry_refuses_agent_searches_but_not_the_owner() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_agent(&fixture, &owner).await;
            let check = |keys: &nostr::Keys| {
                let pubkey = keys.public_key();
                let state = fixture.state.clone();
                let tenant = fixture.tenant.clone();
                async move {
                    crate::api::discovery::enforce_discovery_access(&state, &tenant, &pubkey).await
                }
            };

            check(&agent).await.expect("an agent can search at first");
            send(
                &fixture,
                &owner,
                AccessAction {
                    access_id: Some("discovery".into()),
                    ..blank(AccessOp::Revoke)
                },
            )
            .await
            .expect("owner revokes Discovery");

            let (status, _) = check(&agent)
                .await
                .expect_err("a revoked Discovery entry stops the agent");
            assert_eq!(status, axum::http::StatusCode::FORBIDDEN);
            check(&owner).await.expect("the owner can still search");
        }
    }
}
