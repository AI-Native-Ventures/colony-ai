//! Broker for co-founder playbooks and their running copies (kind 47067, head
//! kind 30677).
//!
//! One action kind and one head kind carry two record families, told apart by
//! the d-tag: `company:playbook:<uuid>` is a playbook and
//! `company:playbook-job:<uuid>` is a running copy for one client job.
//!
//! The relay resolves who the caller is (owner or admin, member, managed
//! agent), reads whether co-founder mode is on, and hands both to
//! `buzz_core::company_playbooks`, which owns every rule. The relay then
//! replaces the record's relay-signed head. A playbook record never sends,
//! pays or spends anything: it only records what the owner approved.

use std::sync::Arc;

use chrono::Utc;
use nostr::Event;

use buzz_core::company_plans::{PlanActor, PlanActorRole, PlanContext};
use buzz_core::company_playbooks::{
    apply_job_action, apply_playbook_action, playbook_d_tag, playbook_job_d_tag,
    playbook_record_kind, validate_job_action, validate_job_head, validate_playbook_action,
    validate_playbook_d_tag, validate_playbook_head, validate_playbook_job_d_tag, JobActionKind,
    PlaybookAction, PlaybookHead, PlaybookJobAction, PlaybookJobHead, PlaybookRecordKind,
};
use buzz_core::kind::{KIND_PLAYBOOK_ACTION, KIND_PLAYBOOK_HEAD};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_core::StoredEvent;
use buzz_db::replaceable::{ParameterizedReplacePrecondition, ParameterizedReplaceStatus};
use buzz_db::EventQuery;

use super::company_cofounder::{
    check_expected_head, command_d_tag, conflict, duplicate_result, forbidden, internal, invalid,
    is_admin, relay_head_event, verify_stored_head,
};
use super::company_plans::{cofounder_enabled, is_managed_agent, led_functions, map_error};
use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;

/// The parsed content of one playbook write.
enum Parsed {
    Playbook(PlaybookAction),
    Job(PlaybookJobAction),
}

impl Parsed {
    fn expected_head_event_id(&self) -> Option<&str> {
        match self {
            Parsed::Playbook(action) => action.expected_head_event_id.as_deref(),
            Parsed::Job(action) => action.expected_head_event_id.as_deref(),
        }
    }
}

/// Handles a member's or agent's playbook or job write (kind 47067).
pub(super) async fn handle(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: Event,
    auth: IngestAuth,
) -> Result<IngestResult, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_PLAYBOOK_ACTION {
        return Err(invalid("playbook action has the wrong event kind"));
    }
    let d_tag = command_d_tag(&event, "playbook")?;
    let family = playbook_record_kind(&d_tag)
        .ok_or_else(|| invalid("playbook command d tag must name a playbook or a running copy"))?;
    let parsed = parse_action(&event, &d_tag, family)?;
    if event.verify().is_err() {
        return Err(invalid("playbook action signature is invalid"));
    }
    if event.pubkey.to_hex() != auth.pubkey().to_hex() {
        return Err(forbidden(
            "event signer does not match the authenticated member",
        ));
    }
    if auth.channel_ids().is_some() {
        return Err(forbidden(
            "channel-scoped authentication cannot write playbooks",
        ));
    }

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
            "company-playbook:{}:{}",
            community_id.as_uuid(),
            d_tag
        ))
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let current_head_id = buzz_db::replaceable::lock_parameterized_event_head_in_transaction(
        &mut tx,
        community_id,
        KIND_PLAYBOOK_HEAD,
        &state.relay_keypair.public_key().to_bytes(),
        &d_tag,
    )
    .await
    .map_err(internal)?;
    let current_stored = current_head(state, community_id, &d_tag).await?;
    if current_stored
        .as_ref()
        .map(|head| head.event.id.to_bytes().to_vec())
        != current_head_id
    {
        return Err(internal(
            "playbook head changed while its transaction lock was held",
        ));
    }
    if current_stored.is_some() || parsed.expected_head_event_id().is_some() {
        check_expected_head(
            "playbook",
            parsed.expected_head_event_id(),
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
    let next_content = match &parsed {
        Parsed::Playbook(action) => {
            let current = current_stored
                .as_ref()
                .map(parse_playbook_head)
                .transpose()?;
            let next = apply_playbook_action(current.as_ref(), action, &actor, &context)
                .map_err(map_error)?;
            validate_playbook_head(&next)
                .map_err(|error| invalid(format!("playbook head: {error}")))?;
            serde_json::to_string(&next).map_err(internal)?
        }
        Parsed::Job(action) => {
            let current = current_stored.as_ref().map(parse_job_head).transpose()?;
            // Only a start reads the playbook it copies from.
            let playbook = match (action.kind, action.playbook_id.as_deref()) {
                (JobActionKind::Start, Some(playbook_id)) => {
                    playbook_head(state, community_id, playbook_id).await?
                }
                _ => None,
            };
            let next = apply_job_action(
                current.as_ref(),
                playbook.as_ref(),
                action,
                &actor,
                &context,
            )
            .map_err(map_error)?;
            validate_job_head(&next).map_err(|error| invalid(format!("job head: {error}")))?;
            serde_json::to_string(&next).map_err(internal)?
        }
    };

    let head_event = relay_head_event(
        state,
        KIND_PLAYBOOK_HEAD,
        &d_tag,
        next_content,
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
            "playbook changed before the action could commit; refresh and retry",
        ));
    }
    tx.commit().await.map_err(internal)?;

    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored_action,
        KIND_PLAYBOOK_ACTION,
        &actor_pubkey,
        None,
    )
    .await;
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &replaced.event,
        KIND_PLAYBOOK_HEAD,
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

/// Parse the action content as the family its d-tag names, and check that the
/// d-tag carries the same id as the content.
fn parse_action(
    event: &Event,
    d_tag: &str,
    family: PlaybookRecordKind,
) -> Result<Parsed, IngestError> {
    match family {
        PlaybookRecordKind::Playbook => {
            let action = serde_json::from_str::<PlaybookAction>(&event.content)
                .map_err(|error| invalid(format!("playbook action: {error}")))?;
            validate_playbook_action(&action)
                .map_err(|error| invalid(format!("playbook action: {error}")))?;
            validate_playbook_d_tag(d_tag, &action.playbook_id)
                .map_err(|error| invalid(format!("playbook command d tag: {error}")))?;
            Ok(Parsed::Playbook(action))
        }
        PlaybookRecordKind::Job => {
            let action = serde_json::from_str::<PlaybookJobAction>(&event.content)
                .map_err(|error| invalid(format!("playbook job action: {error}")))?;
            validate_job_action(&action)
                .map_err(|error| invalid(format!("playbook job action: {error}")))?;
            validate_playbook_job_d_tag(d_tag, &action.job_id)
                .map_err(|error| invalid(format!("playbook job command d tag: {error}")))?;
            Ok(Parsed::Job(action))
        }
    }
}

/// The relay-signed head stored under a d-tag, checked against the d-tag it
/// must carry.
async fn current_head(
    state: &AppState,
    community_id: CommunityId,
    d_tag: &str,
) -> Result<Option<StoredEvent>, IngestError> {
    let mut query = EventQuery::for_community(community_id);
    query.kinds = Some(vec![KIND_PLAYBOOK_HEAD as i32]);
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
        return Err(internal("stored playbook d-tag resolved to multiple heads"));
    }
    let stored = rows.pop();
    if let Some(stored) = &stored {
        let expected = match playbook_record_kind(d_tag) {
            Some(PlaybookRecordKind::Playbook) => {
                playbook_d_tag(&parse_playbook_head(stored)?.playbook_id)
            }
            Some(PlaybookRecordKind::Job) => playbook_job_d_tag(&parse_job_head(stored)?.job_id),
            None => return Err(internal("stored playbook d-tag is not a playbook d-tag")),
        }
        .map_err(|error| internal(format!("stored playbook d-tag: {error}")))?;
        if expected != d_tag {
            return Err(internal("stored playbook head does not match its d-tag"));
        }
        verify_stored_head(stored, KIND_PLAYBOOK_HEAD, d_tag, state)?;
    }
    Ok(stored)
}

/// The playbook a job start copies from, if it exists.
async fn playbook_head(
    state: &AppState,
    community_id: CommunityId,
    playbook_id: &str,
) -> Result<Option<PlaybookHead>, IngestError> {
    let d_tag = playbook_d_tag(playbook_id)
        .map_err(|error| invalid(format!("playbook job action: {error}")))?;
    current_head(state, community_id, &d_tag)
        .await?
        .as_ref()
        .map(parse_playbook_head)
        .transpose()
}

fn parse_playbook_head(stored: &StoredEvent) -> Result<PlaybookHead, IngestError> {
    let head = serde_json::from_str::<PlaybookHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored playbook head is invalid: {error}")))?;
    validate_playbook_head(&head)
        .map_err(|error| internal(format!("stored playbook head: {error}")))?;
    Ok(head)
}

fn parse_job_head(stored: &StoredEvent) -> Result<PlaybookJobHead, IngestError> {
    let head = serde_json::from_str::<PlaybookJobHead>(&stored.event.content)
        .map_err(|error| internal(format!("stored playbook job head is invalid: {error}")))?;
    validate_job_head(&head)
        .map_err(|error| internal(format!("stored playbook job head: {error}")))?;
    Ok(head)
}

#[cfg(test)]
mod tests {
    // The `postgres_tests` path puts these in the PostgreSQL CI lane, which gives
    // each test its own database.
    mod postgres_tests {
        use std::time::Duration;

        use buzz_core::company_cofounder::{CofounderSettings, COFOUNDER_D_TAG};
        use buzz_core::company_functions::CompanyFunction;
        use buzz_core::company_plans::{
            PlanApprovalKind, PlanApprovalPoint, PlanOwnerKind, PlanStepOwner,
        };
        use buzz_core::company_playbooks::{
            JobDecision, JobStatus, JobStepStatus, PlaybookActionKind, PlaybookContent,
            PlaybookDecision, PlaybookStatus, PlaybookStep,
        };
        use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
        use tokio::sync::Mutex;
        use uuid::Uuid;

        use super::super::*;
        use crate::handlers::company_cofounder::current_cofounder_head;

        static PLAYBOOK_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

        struct Fixture {
            state: Arc<AppState>,
            tenant: TenantContext,
            _serial_guard: tokio::sync::MutexGuard<'static, ()>,
        }

        async fn fixture() -> Fixture {
            let serial_guard = PLAYBOOK_DB_TEST_LOCK
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
            let host = format!("company-playbooks-{}.test", community_id.simple());
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

        fn operations() -> PlanStepOwner {
            PlanStepOwner {
                kind: PlanOwnerKind::Function,
                function: Some(CompanyFunction::Operations),
                agent_pubkey: None,
                worker_type: None,
            }
        }

        fn founder() -> PlanStepOwner {
            PlanStepOwner {
                kind: PlanOwnerKind::Owner,
                function: None,
                agent_pubkey: None,
                worker_type: None,
            }
        }

        fn step(id: &str, owner: PlanStepOwner, gated: bool) -> PlaybookStep {
            PlaybookStep {
                step_id: id.to_owned(),
                title: format!("Step {id}"),
                detail: None,
                owner,
                inputs: Vec::new(),
                outputs: Vec::new(),
                tools: Vec::new(),
                approval_point: gated.then(|| PlanApprovalPoint {
                    kind: PlanApprovalKind::Taste,
                    prompt: "Pick the design before the client sees it".to_owned(),
                }),
            }
        }

        /// brief (Operations) -> approval (you, gated).
        fn delivery() -> PlaybookContent {
            PlaybookContent {
                title: "Delivery playbook".to_owned(),
                summary: String::new(),
                function: Some(CompanyFunction::Operations),
                steps: vec![
                    step("brief", operations(), false),
                    step("approval", founder(), true),
                ],
            }
        }

        fn delivery_with_launch() -> PlaybookContent {
            let mut content = delivery();
            content.steps.push(step("launch", operations(), false));
            content
        }

        fn playbook_action(
            playbook_id: &str,
            kind: PlaybookActionKind,
            expected: Option<&str>,
        ) -> PlaybookAction {
            PlaybookAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                playbook_id: playbook_id.to_owned(),
                kind,
                content: None,
                change_summary: None,
                revision: None,
                note: None,
                expected_head_event_id: expected.map(str::to_owned),
            }
        }

        fn propose_action(playbook_id: &str) -> PlaybookAction {
            PlaybookAction {
                content: Some(delivery()),
                ..playbook_action(playbook_id, PlaybookActionKind::Propose, None)
            }
        }

        fn job_action(
            job_id: &str,
            kind: JobActionKind,
            expected: Option<&str>,
        ) -> PlaybookJobAction {
            PlaybookJobAction {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                job_id: job_id.to_owned(),
                kind,
                playbook_id: None,
                playbook_version: None,
                title: None,
                step_id: None,
                step_status: None,
                progress_label: None,
                hand_off_to: None,
                note: None,
                expected_head_event_id: expected.map(str::to_owned),
            }
        }

        fn start_action(job_id: &str, playbook_id: &str) -> PlaybookJobAction {
            PlaybookJobAction {
                playbook_id: Some(playbook_id.to_owned()),
                title: Some("Plane Tree Guesthouse".to_owned()),
                ..job_action(job_id, JobActionKind::Start, None)
            }
        }

        fn step_action(
            job_id: &str,
            kind: JobActionKind,
            step_id: &str,
            expected: &str,
        ) -> PlaybookJobAction {
            PlaybookJobAction {
                step_id: Some(step_id.to_owned()),
                ..job_action(job_id, kind, Some(expected))
            }
        }

        fn update_action(
            job_id: &str,
            step_id: &str,
            status: JobStepStatus,
            expected: &str,
        ) -> PlaybookJobAction {
            PlaybookJobAction {
                step_status: Some(status),
                ..step_action(job_id, JobActionKind::UpdateStep, step_id, expected)
            }
        }

        async fn send_playbook(
            fixture: &Fixture,
            keys: &nostr::Keys,
            action: &PlaybookAction,
        ) -> Result<IngestResult, IngestError> {
            let event = buzz_sdk::company_playbooks::build_playbook_action(action)
                .expect("build playbook action")
                .sign_with_keys(keys)
                .expect("sign playbook action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn send_job(
            fixture: &Fixture,
            keys: &nostr::Keys,
            action: &PlaybookJobAction,
        ) -> Result<IngestResult, IngestError> {
            let event = buzz_sdk::company_playbooks::build_playbook_job_action(action)
                .expect("build job action")
                .sign_with_keys(keys)
                .expect("sign job action");
            handle(&fixture.tenant, &fixture.state, event, auth(keys)).await
        }

        async fn playbook_of(fixture: &Fixture, playbook_id: &str) -> (String, PlaybookHead) {
            let d_tag = playbook_d_tag(playbook_id).expect("d tag");
            let stored = current_head(&fixture.state, fixture.tenant.community(), &d_tag)
                .await
                .expect("query playbook head")
                .expect("playbook head exists");
            let head = parse_playbook_head(&stored).expect("head");
            (stored.event.id.to_hex(), head)
        }

        async fn job_of(fixture: &Fixture, job_id: &str) -> (String, PlaybookJobHead) {
            let d_tag = playbook_job_d_tag(job_id).expect("d tag");
            let stored = current_head(&fixture.state, fixture.tenant.community(), &d_tag)
                .await
                .expect("query job head")
                .expect("job head exists");
            let head = parse_job_head(&stored).expect("head");
            (stored.event.id.to_hex(), head)
        }

        fn rejection(result: Result<IngestResult, IngestError>) -> String {
            match result {
                Err(IngestError::Rejected(message)) => message,
                _ => panic!("expected a rejected playbook action"),
            }
        }

        /// A fixture with an owner, Scout (a managed agent) and the mode on.
        async fn company() -> (Fixture, nostr::Keys, nostr::Keys) {
            let fixture = fixture().await;
            let owner = nostr::Keys::generate();
            add_member(&fixture, &owner, "owner").await;
            let scout = add_managed_agent(&fixture, &owner).await;
            set_cofounder(&fixture, &owner, true).await;
            (fixture, owner, scout)
        }

        /// Scout proposes and the owner approves version 1.
        async fn approved_playbook(
            fixture: &Fixture,
            owner: &nostr::Keys,
            scout: &nostr::Keys,
        ) -> String {
            let playbook_id = Uuid::new_v4().to_string();
            send_playbook(fixture, scout, &propose_action(&playbook_id))
                .await
                .expect("scout proposes");
            let (head_id, _) = playbook_of(fixture, &playbook_id).await;
            send_playbook(
                fixture,
                owner,
                &PlaybookAction {
                    revision: Some(1),
                    ..playbook_action(&playbook_id, PlaybookActionKind::Approve, Some(&head_id))
                },
            )
            .await
            .expect("owner approves");
            playbook_id
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn an_agent_proposes_a_playbook_and_the_owner_approves_version_one_on_record() {
            let (fixture, owner, scout) = company().await;
            let playbook_id = Uuid::new_v4().to_string();
            send_playbook(&fixture, &scout, &propose_action(&playbook_id))
                .await
                .expect("agent proposes");
            let (head_id, head) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(head.status, PlaybookStatus::Proposed);
            assert_eq!(head.version, 0);
            assert!(head.current.is_none());

            send_playbook(
                &fixture,
                &owner,
                &PlaybookAction {
                    revision: Some(1),
                    ..playbook_action(&playbook_id, PlaybookActionKind::Approve, Some(&head_id))
                },
            )
            .await
            .expect("owner approves");
            let (_, approved) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(approved.status, PlaybookStatus::Active);
            assert_eq!(approved.version, 1);
            assert_eq!(approved.current, Some(delivery()));
            assert_eq!(approved.records.len(), 1);
            assert_eq!(approved.records[0].decision, PlaybookDecision::Approved);
            assert_eq!(
                approved.records[0].actor_pubkey,
                owner.public_key().to_hex()
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_playbook_cannot_be_proposed_by_a_member_or_while_the_mode_is_off() {
            let (fixture, owner, scout) = company().await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;
            let playbook_id = Uuid::new_v4().to_string();
            let message =
                rejection(send_playbook(&fixture, &member, &propose_action(&playbook_id)).await);
            assert!(
                message.contains("only an agent or the owner or an admin"),
                "{message}"
            );

            set_cofounder(&fixture, &owner, false).await;
            let message =
                rejection(send_playbook(&fixture, &scout, &propose_action(&playbook_id)).await);
            assert!(message.contains("co-founder mode is off"), "{message}");
            let d_tag = playbook_d_tag(&playbook_id).expect("d tag");
            assert!(
                current_head(&fixture.state, fixture.tenant.community(), &d_tag)
                    .await
                    .expect("query")
                    .is_none(),
                "a refused proposal must not create a head"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn an_agent_and_a_member_can_never_approve_a_playbook() {
            let (fixture, owner, scout) = company().await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;
            let playbook_id = Uuid::new_v4().to_string();
            send_playbook(&fixture, &scout, &propose_action(&playbook_id))
                .await
                .expect("agent proposes");
            let (head_id, _) = playbook_of(&fixture, &playbook_id).await;
            let approve = PlaybookAction {
                revision: Some(1),
                ..playbook_action(&playbook_id, PlaybookActionKind::Approve, Some(&head_id))
            };
            for who in [&scout, &member] {
                let message = rejection(send_playbook(&fixture, who, &approve).await);
                assert!(
                    message.contains("only the owner or an admin can approve"),
                    "{message}"
                );
            }
            let (_, still) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(still.status, PlaybookStatus::Proposed);
            assert!(still.records.is_empty());
            // The owner can.
            send_playbook(&fixture, &owner, &approve)
                .await
                .expect("owner approves");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_change_waits_for_the_owner_and_the_version_moves_only_when_approved() {
            let (fixture, owner, scout) = company().await;
            let playbook_id = approved_playbook(&fixture, &owner, &scout).await;
            let (head_id, _) = playbook_of(&fixture, &playbook_id).await;
            send_playbook(
                &fixture,
                &scout,
                &PlaybookAction {
                    content: Some(delivery_with_launch()),
                    change_summary: Some("Add a launch step".to_owned()),
                    ..playbook_action(
                        &playbook_id,
                        PlaybookActionKind::ProposeChange,
                        Some(&head_id),
                    )
                },
            )
            .await
            .expect("scout proposes a change");
            let (head_id, waiting) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(waiting.version, 1, "the change has not taken effect");
            assert_eq!(waiting.current, Some(delivery()));
            assert!(waiting.pending.is_some());

            // Scout cannot approve its own change.
            let approve = PlaybookAction {
                revision: Some(1),
                ..playbook_action(&playbook_id, PlaybookActionKind::Approve, Some(&head_id))
            };
            let message = rejection(send_playbook(&fixture, &scout, &approve).await);
            assert!(message.contains("only the owner or an admin"), "{message}");
            send_playbook(&fixture, &owner, &approve)
                .await
                .expect("owner approves the change");
            let (_, approved) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(approved.version, 2);
            assert_eq!(approved.current, Some(delivery_with_launch()));
            assert!(approved.pending.is_none());
            assert_eq!(approved.records.len(), 2);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn only_the_owner_edits_or_archives_a_playbook() {
            let (fixture, owner, scout) = company().await;
            let playbook_id = approved_playbook(&fixture, &owner, &scout).await;
            let (head_id, _) = playbook_of(&fixture, &playbook_id).await;
            let edit = PlaybookAction {
                content: Some(delivery_with_launch()),
                ..playbook_action(&playbook_id, PlaybookActionKind::Edit, Some(&head_id))
            };
            let message = rejection(send_playbook(&fixture, &scout, &edit).await);
            assert!(message.contains("only the owner or an admin"), "{message}");
            let archive =
                playbook_action(&playbook_id, PlaybookActionKind::Archive, Some(&head_id));
            let message = rejection(send_playbook(&fixture, &scout, &archive).await);
            assert!(message.contains("only the owner or an admin"), "{message}");
            let (_, unchanged) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(unchanged.version, 1);

            send_playbook(&fixture, &owner, &edit)
                .await
                .expect("owner edits");
            let (head_id, edited) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(edited.version, 2);
            send_playbook(
                &fixture,
                &owner,
                &playbook_action(&playbook_id, PlaybookActionKind::Archive, Some(&head_id)),
            )
            .await
            .expect("owner archives");
            let (_, archived) = playbook_of(&fixture, &playbook_id).await;
            assert_eq!(archived.status, PlaybookStatus::Archived);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_job_runs_through_two_steps_with_an_approval_point_in_between() {
            let (fixture, owner, scout) = company().await;
            let playbook_id = approved_playbook(&fixture, &owner, &scout).await;
            let job_id = Uuid::new_v4().to_string();
            send_job(&fixture, &scout, &start_action(&job_id, &playbook_id))
                .await
                .expect("scout starts the job");
            let (head_id, job) = job_of(&fixture, &job_id).await;
            assert_eq!(job.playbook_version, 1);
            assert_eq!(job.current_step_id.as_deref(), Some("brief"));

            // Step 1: the brief, no approval point.
            send_job(
                &fixture,
                &scout,
                &update_action(&job_id, "brief", JobStepStatus::InProgress, &head_id),
            )
            .await
            .expect("brief starts");
            let (head_id, _) = job_of(&fixture, &job_id).await;
            send_job(
                &fixture,
                &scout,
                &update_action(&job_id, "brief", JobStepStatus::Done, &head_id),
            )
            .await
            .expect("brief is done");
            let (head_id, job) = job_of(&fixture, &job_id).await;
            assert_eq!(job.current_step_id.as_deref(), Some("approval"));

            // Step 2 has an approval point: it cannot run until the owner approves.
            let run = update_action(&job_id, "approval", JobStepStatus::InProgress, &head_id);
            let message = rejection(send_job(&fixture, &owner, &run).await);
            assert!(
                message.starts_with("conflict:") && message.contains("approval"),
                "{message}"
            );
            send_job(
                &fixture,
                &owner,
                &step_action(
                    &job_id,
                    JobActionKind::RequestStepApproval,
                    "approval",
                    &head_id,
                ),
            )
            .await
            .expect("the step asks for approval");
            let (head_id, waiting) = job_of(&fixture, &job_id).await;
            assert_eq!(waiting.steps[1].status, JobStepStatus::WaitingApproval);

            let approve = step_action(&job_id, JobActionKind::ApproveStep, "approval", &head_id);
            let message = rejection(send_job(&fixture, &scout, &approve).await);
            assert!(message.contains("only the owner or an admin"), "{message}");
            send_job(&fixture, &owner, &approve)
                .await
                .expect("owner approves the point");
            let (head_id, approved) = job_of(&fixture, &job_id).await;
            assert_eq!(approved.steps[1].status, JobStepStatus::Approved);
            assert_eq!(approved.approvals.len(), 1);
            assert_eq!(approved.approvals[0].decision, JobDecision::Approved);
            assert_eq!(
                approved.approvals[0].actor_pubkey,
                owner.public_key().to_hex()
            );

            send_job(
                &fixture,
                &owner,
                &update_action(&job_id, "approval", JobStepStatus::Done, &head_id),
            )
            .await
            .expect("approval step done");
            let (_, done) = job_of(&fixture, &job_id).await;
            assert_eq!(done.status, JobStatus::Completed);
            assert!(done.current_step_id.is_none());
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_job_cannot_start_from_a_playbook_the_owner_has_not_approved() {
            let (fixture, _owner, scout) = company().await;
            let playbook_id = Uuid::new_v4().to_string();
            send_playbook(&fixture, &scout, &propose_action(&playbook_id))
                .await
                .expect("agent proposes");
            let job_id = Uuid::new_v4().to_string();
            let message =
                rejection(send_job(&fixture, &scout, &start_action(&job_id, &playbook_id)).await);
            assert!(message.contains("no approved version"), "{message}");
            let unknown = Uuid::new_v4().to_string();
            let message =
                rejection(send_job(&fixture, &scout, &start_action(&job_id, &unknown)).await);
            assert!(message.starts_with("conflict:"), "{message}");
            let d_tag = playbook_job_d_tag(&job_id).expect("d tag");
            assert!(
                current_head(&fixture.state, fixture.tenant.community(), &d_tag)
                    .await
                    .expect("query")
                    .is_none(),
                "a refused start must not create a job"
            );
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_member_cannot_start_a_job_and_a_stranger_agent_cannot_move_its_steps() {
            let (fixture, owner, scout) = company().await;
            let playbook_id = approved_playbook(&fixture, &owner, &scout).await;
            let member = nostr::Keys::generate();
            add_member(&fixture, &member, "member").await;
            let job_id = Uuid::new_v4().to_string();
            let message =
                rejection(send_job(&fixture, &member, &start_action(&job_id, &playbook_id)).await);
            assert!(
                message.contains("only an agent or the owner or an admin"),
                "{message}"
            );

            send_job(&fixture, &scout, &start_action(&job_id, &playbook_id))
                .await
                .expect("scout starts");
            let (head_id, _) = job_of(&fixture, &job_id).await;
            let stranger = add_managed_agent(&fixture, &owner).await;
            let run = update_action(&job_id, "brief", JobStepStatus::InProgress, &head_id);
            let message = rejection(send_job(&fixture, &stranger, &run).await);
            assert!(message.contains("not the doer"), "{message}");
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_stale_job_write_conflicts() {
            let (fixture, owner, scout) = company().await;
            let playbook_id = approved_playbook(&fixture, &owner, &scout).await;
            let job_id = Uuid::new_v4().to_string();
            send_job(&fixture, &scout, &start_action(&job_id, &playbook_id))
                .await
                .expect("start");
            let (first_head, _) = job_of(&fixture, &job_id).await;
            send_job(
                &fixture,
                &scout,
                &update_action(&job_id, "brief", JobStepStatus::InProgress, &first_head),
            )
            .await
            .expect("first update");
            // The second writer still holds the old head.
            let stale = update_action(&job_id, "brief", JobStepStatus::Done, &first_head);
            let message = rejection(send_job(&fixture, &scout, &stale).await);
            assert!(message.starts_with("conflict:"), "{message}");
            let (_, job) = job_of(&fixture, &job_id).await;
            assert_eq!(job.steps[0].status, JobStepStatus::InProgress);
        }

        #[tokio::test]
        #[ignore = "requires Postgres"]
        async fn a_playbook_action_with_an_h_tag_or_the_wrong_family_is_refused() {
            let (fixture, owner, _scout) = company().await;
            let playbook_id = Uuid::new_v4().to_string();
            let action = propose_action(&playbook_id);
            let d_tag = playbook_d_tag(&playbook_id).expect("d");
            let with_h = nostr::EventBuilder::new(
                nostr::Kind::Custom(KIND_PLAYBOOK_ACTION as u16),
                serde_json::to_string(&action).expect("serialize"),
            )
            .tags([
                nostr::Tag::parse(["d", d_tag.as_str()]).expect("d"),
                nostr::Tag::parse(["h", Uuid::new_v4().to_string().as_str()]).expect("h"),
            ])
            .sign_with_keys(&owner)
            .expect("sign");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, with_h, auth(&owner)).await);
            assert!(message.contains("no h or p tag"), "{message}");

            // A playbook action under a job d-tag does not parse as a job action.
            let job_d_tag = playbook_job_d_tag(&Uuid::new_v4().to_string()).expect("d");
            let wrong_family = nostr::EventBuilder::new(
                nostr::Kind::Custom(KIND_PLAYBOOK_ACTION as u16),
                serde_json::to_string(&action).expect("serialize"),
            )
            .tag(nostr::Tag::parse(["d", job_d_tag.as_str()]).expect("d"))
            .sign_with_keys(&owner)
            .expect("sign");
            let message = rejection(
                handle(&fixture.tenant, &fixture.state, wrong_family, auth(&owner)).await,
            );
            assert!(message.contains("playbook job action"), "{message}");

            // A d-tag outside both families is refused.
            let foreign = nostr::EventBuilder::new(
                nostr::Kind::Custom(KIND_PLAYBOOK_ACTION as u16),
                serde_json::to_string(&action).expect("serialize"),
            )
            .tag(nostr::Tag::parse(["d", "company:plan:x"]).expect("d"))
            .sign_with_keys(&owner)
            .expect("sign");
            let message =
                rejection(handle(&fixture.tenant, &fixture.state, foreign, auth(&owner)).await);
            assert!(message.contains("must name a playbook"), "{message}");
        }
    }
}
