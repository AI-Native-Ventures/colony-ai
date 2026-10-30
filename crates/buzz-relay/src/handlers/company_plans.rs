//! Broker for co-founder plans (kind 47063, head kind 30673).
//!
//! The relay resolves who the caller is (owner or admin, member, managed
//! agent), reads whether co-founder mode is on, and hands both to
//! `buzz_core::company_plans::apply_plan_action`, which owns every rule. The
//! relay then replaces the plan's relay-signed head. A plan record never
//! sends, pays or spends anything: it only records what the owner approved.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;

use buzz_core::company_cofounder::{CofounderHead, COFOUNDER_D_TAG};
use buzz_core::company_functions::{CompanyFunction, FunctionHead, SlotState};
use buzz_core::company_plans::{
    apply_plan_action, plan_d_tag, validate_plan_action, validate_plan_d_tag, validate_plan_head,
    PlanAction, PlanActor, PlanActorRole, PlanContext, PlanError, PlanErrorKind, PlanHead,
};
use buzz_core::kind::{KIND_COMPANY_FUNCTION_HEAD, KIND_PLAN_ACTION, KIND_PLAN_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, current_cofounder_head, duplicate_result,
    forbidden, internal, invalid, is_admin, relay_head_event, verify_stored_head,
};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// Handles a member's or agent's plan write (kind 47063).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_PLAN_ACTION {
        return Err(invalid("plan action has the wrong event kind"));
    }
    let action = serde_json::from_str::<PlanAction>(&event.content)
        .map_err(|error| invalid(format!("plan action: {error}")))?;
    validate_plan_action(&action).map_err(|error| invalid(format!("plan action: {error}")))?;
    if event.verify().is_err() {
        return Err(invalid("plan action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write plans",
        ));
    }
    let d_tag = command_d_tag(&event, "plan")?;
    validate_plan_d_tag(&d_tag, &action.plan_id)
        .map_err(|error| invalid(format!("plan command d tag: {error}")))?;

    let community_id = tenant.community();
    let actor_pubkey = auth.pubkey().to_hex();
    let actor_managed = is_managed_agent(state, community_id, &auth.pubkey().to_bytes()).await?;

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
    .map_err(internal)?;
    if role.is_none() && !actor_managed {
        return Err(forbidden("actor is not a member or managed employee"));
    }
    // A managed agent never counts as an owner or admin, whatever its role row says.
    let actor_role = if actor_managed {
        PlanActorRole::ManagedAgent
    } else if role.as_deref().is_some_and(is_admin) {
        PlanActorRole::Admin
    } else {
        PlanActorRole::Member
    };

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

    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "company-plan:{}:{}",
            community_id.as_uuid(),
            action.plan_id
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_PLAN_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_plan_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(internal(
            "plan head changed while its transaction lock was held",
        ));
    }
    let current = current_stored.as_ref().map(parse_plan_head).transpose()?;
    if current.is_some() || action.expected_head_event_id.is_some() {
        check_expected_head(
            "plan",
            action.expected_head_event_id.as_deref(),
            current_head_id.as_deref(),
        )?;
    }

    let actor = PlanActor {
        pubkey: actor_pubkey.clone(),
        role: actor_role,
        led_functions: led_functions(state, community_id, &actor_pubkey).await?,
    };
    let context = PlanContext {
        now: Utc::now().timestamp(),
        cofounder_enabled: cofounder_enabled(state, community_id).await?,
        action_event_id: event.id.to_hex(),
    };
    let next = apply_plan_action(current.as_ref(), &action, &actor, &context).map_err(map_error)?;
    validate_plan_head(&next).map_err(|error| invalid(format!("plan head: {error}")))?;

    let head_event = relay_head_event(
        state,
        KIND_PLAN_HEAD,
        &d_tag,
        serde_json::to_string(&next).map_err(internal)?,
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
            "plan changed before the action could commit; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_PLAN_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_PLAN_HEAD,
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

fn map_error(error: PlanError) -> IngestError {
    match error.kind {
        PlanErrorKind::Invalid => invalid(error.message),
        PlanErrorKind::Forbidden => forbidden(error.message),
        PlanErrorKind::Conflict => conflict(error.message),
    }
}

async fn is_managed_agent(
    state: &AppState,
    community_id: CommunityId,
    pubkey: &[u8; 32],
) -> Result<bool, IngestError> {
    Ok(state
        .db
        .get_agent_channel_policy(community_id, pubkey)
        .await
        .map_err(internal)?
        .is_some_and(|(_, owner_pubkey)| owner_pubkey.is_some()))
}

/// Whether co-founder mode is on right now. No head means off.
async fn cofounder_enabled(
    state: &AppState,
    community_id: CommunityId,
) -> Result<bool, IngestError> {
    let stored = current_cofounder_head(state, community_id, COFOUNDER_D_TAG).await?;
    let enabled = stored
        .map(|stored| serde_json::from_str::<CofounderHead>(&stored.event.content))
        .transpose()
        .map_err(internal)?
        .is_some_and(|head| head.settings.enabled);
    Ok(enabled)
}

/// The functions whose slot this pubkey leads. A head that does not parse
/// grants nothing.
async fn led_functions(
    state: &AppState,
    community_id: CommunityId,
    pubkey: &str,
) -> Result<Vec<CompanyFunction>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_COMPANY_FUNCTION_HEAD as i32]);
    query.pubkey = Some(state.relay_keypair.public_key().to_bytes().to_vec());
    query.global_only = true;
    query.limit = Some(20);
    let rows = state
        .db
        .query_events_for_event_write(&query)
        .await
        .map_err(internal)?;
    Ok(rows
        .iter()
        .filter_map(|stored| serde_json::from_str::<FunctionHead>(&stored.event.content).ok())
        .filter(|head| {
            head.state == SlotState::Filled && head.lead_pubkey.as_deref() == Some(pubkey)
        })
        .map(|head| head.function)
        .collect())
}

async fn current_plan_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_PLAN_HEAD as i32]);
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
        return Err(internal("stored plan d-tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        let head = parse_plan_head(stored)?;
        let expected = plan_d_tag(&head.plan_id)
            .map_err(|error| internal(format!("stored plan d-tag: {error}")))?;
        if expected != d_tag {
            return Err(internal("stored plan head does not match its d-tag"));
        }
        verify_stored_head(stored, KIND_PLAN_HEAD, d_tag, state)?;
    }
    Ok(stored)
}

fn parse_plan_head(stored: &StoredEvent) -> Result<PlanHead, IngestError> {
    let head = serde_json::from_str::<PlanHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored plan head is invalid: {error}")))?;
    validate_plan_head(&head).map_err(|error| internal(format!("stored plan head: {error}")))?;
    Ok(head)
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use std::time::Duration;

        use buzz_core::company_cofounder::{CofounderSettings, COFOUNDER_D_TAG};
        use buzz_core::company_functions::{FunctionAction, FunctionActionKind};
        use buzz_core::company_plans::{
            PlanActionKind, PlanApprovalKind, PlanApprovalPoint, PlanDecision, PlanOwnerKind,
            PlanProposal, PlanStatus, PlanStep, PlanStepOwner, PlanStepStatus,
        };
        use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
        use tokio::sync::Mutex;
        use uuid::Uuid;

        use super::super::*;

        static PLAN_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

        struct Fixture {
            state: Arc<AppState>,
            tenant: TenantContext,
            _serial_guard: tokio::sync::MutexGuard<'static, ()>,
        }

        async fn fixture() -> Fixture {
            let serial_guard = PLAN_DB_TEST_LOCK
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
            let host = format!("company-plans-{}.test", community_id.simple());
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

        /// A managed agent: a user row bound to an owner, with no member role.
        async fn add_managed_agent(fixture: &Fixture, owner: &nostr::Keys) -> nostr::Keys {
            let agent = nostr::Keys::generate();
            let community = fixture.tenant.community();
            fixture
                .state
                .db
                .ensure_user(community, &owner.public_key().to_bytes())
                .await
                .expect("ensure owner user");
            fixture
                .state
                .db
                .ensure_user(community, &agent.public_key().to_bytes())
                .await
                .expect("ensure agent user");
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

        async fn set_cofounder(fixture: &Fixture, owner: &nostr::Keys, enabled: bool) {
            let settings = CofounderSettings {
                enabled,
                ..CofounderSettings::default()
            };
            let head =
                current_cofounder_head(&fixture.state, fixture.tenant.community(), COFOUNDER_D_TAG)
                    .await
                    .expect("query co-founder head")
                    .map(|stored| stored.event.id.to_hex());
            let event =
                buzz_sdk::company_records::build_cofounder_action(&settings, head.as_deref())
                    .expect("build co-founder action")
                    .sign_with_keys(owner)
                    .expect("sign");
            super::super::super::company_cofounder::handle(
                &fixture.tenant,
                &fixture.state,
                event,
                auth(owner),
            )
            .await
            .expect("owner sets co-founder mode");
        }

        fn step(id: &str, gated: bool) -> PlanStep {
            PlanStep {
                step_id: id.to_owned(),
                title: "Send the opener".to_owned(),
                detail: None,
                owner: PlanStepOwner {
                    kind: PlanOwnerKind::Function,
                    function: Some(CompanyFunction::Sales),
                    agent_pubkey: None,
                    worker_type: None,
                },
                tools: Vec::new(),
                cost_label: "Free".to_owned(),
                cost_estimate_cents: 0,
                when_label: "From 4 Nov".to_owned(),
                approval_point: gated.then(|| PlanApprovalPoint {
                    kind: PlanApprovalKind::Outreach,
                    prompt: "You approve each batch".to_owned(),
                }),
                status: PlanStepStatus::Pending,
                note: None,
            }
        }

        fn base_action(plan_id: &str, kind: PlanActionKind, expected: Option<&str>) -> PlanAction {
            PlanAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                plan_id: plan_id.to_owned(),
                kind,
                plan: None,
                revision: None,
                step_id: None,
                step_status: None,
                note: None,
                expected_head_event_id: expected.map(str::to_owned),
            }
        }

        fn propose_action(plan_id: &str) -> PlanAction {
            PlanAction {
                plan: Some(PlanProposal {
                    title: "Get 5 clients in November".to_owned(),
                    summary: String::new(),
                    function: Some(CompanyFunction::Sales),
                    currency: "ZAR".to_owned(),
                    budget_cents: 0,
                    decide_by: None,
                    target_label: None,
                    timing_label: None,
                    steps: vec![step("send", true)],
                }),
                ..base_action(plan_id, PlanActionKind::Propose, None)
            }
        }

        async fn send(
            fixture: &Fixture,
            keys: &nostr::Keys,
            action: &PlanAction,
        ) -> Result<IngestResult, IngestError> {
            let event = buzz_sdk::company_plans::build_plan_action(action)
                .expect("build plan action")
                .sign_with_keys(keys)
                .expect("sign plan action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn head_of(fixture: &Fixture, plan_id: &str) -> (String, PlanHead) {
            let d_tag = plan_d_tag(plan_id).expect("d tag");
            let stored = current_plan_head(&fixture.state, fixture.tenant.community(), &d_tag)
                .await
                .expect("query plan head")
                .expect("plan head exists");
            let head = serde_json::from_str::<PlanHead>(&stored.event.content).expect("head");
            (stored.event.id.to_hex(), head)
        }

        fn rejection(result: Result<IngestResult, IngestError>) -> String {
            match result {
                Err(IngestError::Rejected(message)) => message,
                _ => panic!("expected a rejected plan action"),
            }
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn an_agent_proposes_a_plan_and_the_owner_approves_it_on_record() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_managed_agent(&fixture, &owner).await;
            set_cofounder(&fixture, &owner, true).await;

            let plan_id = Uuid::new_v4().to_string();
            send(&fixture, &agent, &propose_action(&plan_id))
                .await
                .expect("agent proposes");
            let (head_id, head) = head_of(&fixture, &plan_id).await;
            assert_eq!(head.status, PlanStatus::Proposed);
            assert_eq!(head.proposed_by_pubkey, agent.public_key().to_hex());

            let approve = PlanAction {
                revision: Some(1),
                ..base_action(&plan_id, PlanActionKind::Approve, Some(&head_id))
            };
            send(&fixture, &owner, &approve)
                .await
                .expect("owner approves");
            let (_, approved) = head_of(&fixture, &plan_id).await;
            assert_eq!(approved.status, PlanStatus::Approved);
            assert_eq!(approved.approvals.len(), 1);
            assert_eq!(approved.approvals[0].decision, PlanDecision::Approved);
            assert_eq!(
                approved.approvals[0].actor_pubkey,
                owner.public_key().to_hex()
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_plan_cannot_be_proposed_while_cofounder_mode_is_off() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_managed_agent(&fixture, &owner).await;

            let plan_id = Uuid::new_v4().to_string();
            let message = rejection(send(&fixture, &agent, &propose_action(&plan_id)).await);
            assert!(message.contains("co-founder mode is off"), "{message}");

            set_cofounder(&fixture, &owner, true).await;
            set_cofounder(&fixture, &owner, false).await;
            let message = rejection(send(&fixture, &agent, &propose_action(&plan_id)).await);
            assert!(message.contains("co-founder mode is off"), "{message}");
            let d_tag = plan_d_tag(&plan_id).expect("d tag");
            assert!(
                current_plan_head(&fixture.state, fixture.tenant.community(), &d_tag)
                    .await
                    .expect("query")
                    .is_none(),
                "a refused proposal must not create a head"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn an_agent_and_a_member_can_never_approve_a_plan() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;
            let agent = add_managed_agent(&fixture, &owner).await;
            set_cofounder(&fixture, &owner, true).await;

            let plan_id = Uuid::new_v4().to_string();
            send(&fixture, &agent, &propose_action(&plan_id))
                .await
                .expect("agent proposes");
            let (head_id, _) = head_of(&fixture, &plan_id).await;
            let approve = PlanAction {
                revision: Some(1),
                ..base_action(&plan_id, PlanActionKind::Approve, Some(&head_id))
            };
            for who in [&agent, &member] {
                let message = rejection(send(&fixture, who, &approve).await);
                assert!(
                    message.contains("only the owner or an admin can approve a plan"),
                    "{message}"
                );
            }
            let (_, still) = head_of(&fixture, &plan_id).await;
            assert_eq!(still.status, PlanStatus::Proposed);
            assert!(still.approvals.is_empty());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn an_approval_point_gates_its_step_until_the_owner_approves() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_managed_agent(&fixture, &owner).await;
            set_cofounder(&fixture, &owner, true).await;

            let plan_id = Uuid::new_v4().to_string();
            send(&fixture, &agent, &propose_action(&plan_id))
                .await
                .expect("propose");
            let (head_id, _) = head_of(&fixture, &plan_id).await;
            send(
                &fixture,
                &owner,
                &PlanAction {
                    revision: Some(1),
                    ..base_action(&plan_id, PlanActionKind::Approve, Some(&head_id))
                },
            )
            .await
            .expect("approve plan");

            let (head_id, _) = head_of(&fixture, &plan_id).await;
            let start = PlanAction {
                step_id: Some("send".to_owned()),
                step_status: Some(PlanStepStatus::InProgress),
                ..base_action(&plan_id, PlanActionKind::UpdateStep, Some(&head_id))
            };
            let message = rejection(send(&fixture, &agent, &start).await);
            assert!(
                message.starts_with("conflict:") && message.contains("approval"),
                "{message}"
            );

            send(
                &fixture,
                &agent,
                &PlanAction {
                    step_id: Some("send".to_owned()),
                    ..base_action(
                        &plan_id,
                        PlanActionKind::RequestStepApproval,
                        Some(&head_id),
                    )
                },
            )
            .await
            .expect("agent asks for the step approval");
            let (head_id, _) = head_of(&fixture, &plan_id).await;
            let approve_step = PlanAction {
                step_id: Some("send".to_owned()),
                ..base_action(&plan_id, PlanActionKind::ApproveStep, Some(&head_id))
            };
            let message = rejection(send(&fixture, &agent, &approve_step).await);
            assert!(message.contains("only the owner or an admin"), "{message}");
            send(&fixture, &owner, &approve_step)
                .await
                .expect("owner approves the point");

            let (head_id, ready) = head_of(&fixture, &plan_id).await;
            assert_eq!(ready.plan.steps[0].status, PlanStepStatus::Approved);
            let start = PlanAction {
                step_id: Some("send".to_owned()),
                step_status: Some(PlanStepStatus::InProgress),
                ..base_action(&plan_id, PlanActionKind::UpdateStep, Some(&head_id))
            };
            send(&fixture, &agent, &start).await.expect("now it runs");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn the_slot_lead_runs_its_functions_steps_and_a_stranger_cannot() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let scout = add_managed_agent(&fixture, &owner).await;
            let aya = add_managed_agent(&fixture, &owner).await;
            let stranger = add_managed_agent(&fixture, &owner).await;
            set_cofounder(&fixture, &owner, true).await;
            let assign = FunctionAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                function: CompanyFunction::Sales,
                kind: FunctionActionKind::AssignLead,
                lead_pubkey: Some(aya.public_key().to_hex()),
                expected_head_event_id: None,
            };
            let event = buzz_sdk::company_records::build_function_action(&assign)
                .expect("build function action")
                .sign_with_keys(&owner)
                .expect("sign");
            super::super::super::company_functions::handle(
                &fixture.tenant,
                &fixture.state,
                event,
                auth(&owner),
            )
            .await
            .expect("owner assigns Aya to Sales");

            let plan_id = Uuid::new_v4().to_string();
            send(&fixture, &scout, &propose_action(&plan_id))
                .await
                .expect("Scout proposes");
            let (head_id, _) = head_of(&fixture, &plan_id).await;
            send(
                &fixture,
                &owner,
                &PlanAction {
                    revision: Some(1),
                    ..base_action(&plan_id, PlanActionKind::Approve, Some(&head_id))
                },
            )
            .await
            .expect("approve");
            let (head_id, _) = head_of(&fixture, &plan_id).await;
            let ask = PlanAction {
                step_id: Some("send".to_owned()),
                ..base_action(
                    &plan_id,
                    PlanActionKind::RequestStepApproval,
                    Some(&head_id),
                )
            };
            let message = rejection(send(&fixture, &stranger, &ask).await);
            assert!(message.contains("not the doer"), "{message}");
            send(&fixture, &aya, &ask)
                .await
                .expect("the Sales lead asks for its step approval");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_stale_plan_write_conflicts_and_cannot_overwrite_a_decision() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let agent = add_managed_agent(&fixture, &owner).await;
            set_cofounder(&fixture, &owner, true).await;
            let plan_id = Uuid::new_v4().to_string();
            send(&fixture, &agent, &propose_action(&plan_id))
                .await
                .expect("propose");
            let (first_head, _) = head_of(&fixture, &plan_id).await;
            send(
                &fixture,
                &owner,
                &PlanAction {
                    revision: Some(1),
                    note: Some("Not now".to_owned()),
                    ..base_action(&plan_id, PlanActionKind::Reject, Some(&first_head))
                },
            )
            .await
            .expect("owner rejects");
            // The agent still holds the old head and tries to revise.
            let revise = PlanAction {
                plan: propose_action(&plan_id).plan,
                ..base_action(&plan_id, PlanActionKind::Revise, Some(&first_head))
            };
            let message = rejection(send(&fixture, &agent, &revise).await);
            assert!(message.starts_with("conflict:"), "{message}");
            let (_, head) = head_of(&fixture, &plan_id).await;
            assert_eq!(head.status, PlanStatus::Rejected);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_plan_action_with_an_h_tag_is_refused() {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            set_cofounder(&fixture, &owner, true).await;
            let plan_id = Uuid::new_v4().to_string();
            let action = propose_action(&plan_id);
            let event = nostr::EventBuilder::new(
                nostr::Kind::Custom(KIND_PLAN_ACTION as u16),
                serde_json::to_string(&action).expect("serialize"),
            )
            .tags([
                nostr::Tag::parse(["d", plan_d_tag(&plan_id).expect("d").as_str()]).expect("d"),
                nostr::Tag::parse(["h", Uuid::new_v4().to_string().as_str()]).expect("h"),
            ])
            .sign_with_keys(&owner)
            .expect("sign");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, event, auth(&owner)).await);
            assert!(message.contains("no h or p tag"), "{message}");
        }
    }
}
