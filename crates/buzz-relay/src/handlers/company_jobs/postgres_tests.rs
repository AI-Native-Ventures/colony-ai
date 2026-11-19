//! PostgreSQL-backed coverage for per-job specialist assignments.
//!
//! These tests exercise the production job, member-position, and hire
//! handlers, rather than only the record serializers.

use std::sync::Arc;
use std::time::Duration;

use buzz_core::company_functions::{CompanyFunction, FunctionAction, FunctionActionKind};
use buzz_core::company_jobs::{job_d_tag, JobAction, JobActionKind, JobHead, JobState};
use buzz_core::company_members::{MemberPositionAction, MemberPositionActionKind};
use buzz_core::company_records::{
    hire_d_tag, HireAction, HireActionKind, HireHead, HireProposal, HireRolePack, HireStatus,
    HireTool, HireToolRisk, RoleOnHire, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core::kind::{KIND_HIRE_ACTION, KIND_STREAM_MESSAGE};
use buzz_core::tenant::{CommunityId, TenantContext};
use buzz_db::channel::{ChannelType, ChannelVisibility};
use buzz_db::channel_members::MemberRole;
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde::Deserialize;
use tokio::sync::Mutex;
use uuid::Uuid;

use super::*;

static JOBS_DB_TEST_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

struct Fixture {
    state: Arc<AppState>,
    tenant: TenantContext,
    owner: Keys,
    employee: Keys,
    replacement: Keys,
    channel_id: Uuid,
    _serial_guard: tokio::sync::MutexGuard<'static, ()>,
}

async fn fixture() -> Fixture {
    fixture_with_employee_ownership(true).await
}

async fn fixture_without_employee_owner() -> Fixture {
    fixture_with_employee_ownership(false).await
}

async fn fixture_with_employee_ownership(employee_owned_by_owner: bool) -> Fixture {
    let serial_guard = JOBS_DB_TEST_LOCK
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
    let community_uuid = Uuid::new_v4();
    let host = format!("company-jobs-{}.test", community_uuid.simple());
    sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
        .bind(community_uuid)
        .bind(&host)
        .execute(&pool)
        .await
        .expect("insert test community");
    let tenant = TenantContext::resolved(CommunityId::from_uuid(community_uuid), host);
    let community = tenant.community();
    let owner = Keys::generate();
    let employee = Keys::generate();
    let replacement = Keys::generate();
    for keys in [&owner, &employee, &replacement] {
        state
            .db
            .ensure_user(community, &keys.public_key().to_bytes())
            .await
            .expect("ensure user");
    }
    state
        .db
        .add_relay_member(community, &owner.public_key().to_hex(), "owner", None)
        .await
        .expect("add owner");
    if employee_owned_by_owner {
        assert!(
            state
                .db
                .set_agent_owner(
                    community,
                    &employee.public_key().to_bytes(),
                    &owner.public_key().to_bytes(),
                )
                .await
                .expect("bind managed employee"),
            "the managed employee is newly bound"
        );
    }
    assert!(
        state
            .db
            .set_agent_owner(
                community,
                &replacement.public_key().to_bytes(),
                &owner.public_key().to_bytes(),
            )
            .await
            .expect("bind replacement employee"),
        "the replacement managed employee is newly bound"
    );
    let channel = state
        .db
        .create_channel(
            community,
            &format!("jobs-{}", community_uuid.simple()),
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &owner.public_key().to_bytes(),
            None,
        )
        .await
        .expect("create home channel");
    state
        .db
        .add_member(
            community,
            channel.id,
            &employee.public_key().to_bytes(),
            MemberRole::Bot,
            Some(&owner.public_key().to_bytes()),
        )
        .await
        .expect("add employee to home channel");
    Fixture {
        state,
        tenant,
        owner,
        employee,
        replacement,
        channel_id: channel.id,
        _serial_guard: serial_guard,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrebuiltSpecialistFollowUpsActions {
    create: HireAction,
    job_hire_set: JobAction,
    approve: HireAction,
    attach_employee: HireAction,
    complete: HireAction,
}

fn prebuilt_specialist_follow_ups_actions() -> PrebuiltSpecialistFollowUpsActions {
    serde_json::from_str(include_str!(
        "../../../../../test-fixtures/company-hire/prebuilt-specialist-follow-ups.json"
    ))
    .expect("the checked-in Follow-ups specialist action shapes must deserialize")
}

fn auth(keys: &Keys) -> IngestAuth {
    IngestAuth::Http {
        pubkey: keys.public_key(),
        scopes: vec![buzz_auth::Scope::MessagesWrite],
        auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
    }
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

async fn job_head(fixture: &Fixture) -> Option<(StoredEvent, JobHead)> {
    let d_tag =
        job_d_tag(CompanyFunction::Sales, "follow-ups").expect("the fixed test job id is valid");
    current_job_stored(&fixture.state, fixture.tenant.community(), &d_tag)
        .await
        .expect("query job head")
        .map(|stored| {
            let head = serde_json::from_str(&stored.event.content).expect("parse job head");
            (stored, head)
        })
}

async fn write_job(
    fixture: &Fixture,
    action: JobActionKind,
    assignee_pubkey: Option<String>,
    hire_id: Option<Uuid>,
    expected_head_event_id: Option<String>,
) -> Result<IngestResult, IngestError> {
    let job_action = JobAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        action,
        function: CompanyFunction::Sales,
        job_id: "follow-ups".into(),
        assignee_pubkey,
        hire_id,
        expected_head_event_id,
    };
    let event = buzz_sdk::company_records::build_job_action(&job_action)
        .expect("build job action")
        .sign_with_keys(&fixture.owner)
        .expect("sign job action");
    handle(&fixture.tenant, &fixture.state, event, auth(&fixture.owner)).await
}

async fn assign_employee(fixture: &Fixture, employee: &Keys) -> JobHead {
    let expected = job_head(fixture)
        .await
        .map(|(stored, _)| stored.event.id.to_hex());
    write_job(
        fixture,
        JobActionKind::Assign,
        Some(employee.public_key().to_hex()),
        None,
        expected,
    )
    .await
    .expect("assign job");
    job_head(fixture).await.expect("job head exists").1
}

async fn set_active_position(fixture: &Fixture, employee: &Keys) -> String {
    let action = MemberPositionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        pubkey: employee.public_key().to_hex(),
        action: MemberPositionActionKind::SetPosition,
        expected_head_event_id: None,
        title: Some("Outreach specialist".into()),
        manager_pubkey: Some(Some(fixture.owner.public_key().to_hex())),
        reason: None,
    };
    let event = buzz_sdk::company_members::build_member_position_action(&action)
        .expect("build member position action")
        .sign_with_keys(&fixture.owner)
        .expect("sign member position action");
    crate::handlers::company_member_records::handle(
        &fixture.tenant,
        &fixture.state,
        event,
        auth(&fixture.owner),
    )
    .await
    .expect("set active employee position");
    crate::handlers::company_member_records::load_position_for_proposal(
        &fixture.state,
        fixture.tenant.community(),
        &action.pubkey,
    )
    .await
    .expect("load employee position")
    .expect("employee position exists")
    .0
    .event
    .id
    .to_hex()
}

async fn terminate_employee(fixture: &Fixture, employee: &Keys, expected_head_event_id: String) {
    let action = MemberPositionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        pubkey: employee.public_key().to_hex(),
        action: MemberPositionActionKind::Terminate,
        expected_head_event_id: Some(expected_head_event_id),
        title: None,
        manager_pubkey: None,
        reason: Some("The test ends this specialist's work".into()),
    };
    let event = buzz_sdk::company_members::build_member_position_action(&action)
        .expect("build termination action")
        .sign_with_keys(&fixture.owner)
        .expect("sign termination action");
    crate::handlers::company_member_records::handle(
        &fixture.tenant,
        &fixture.state,
        event,
        auth(&fixture.owner),
    )
    .await
    .expect("terminate employee");
}

async fn assign_function_lead(fixture: &Fixture, lead: &Keys) {
    fixture
        .state
        .db
        .ensure_user(fixture.tenant.community(), &lead.public_key().to_bytes())
        .await
        .expect("ensure function lead user");
    fixture
        .state
        .db
        .add_relay_member(
            fixture.tenant.community(),
            &lead.public_key().to_hex(),
            "member",
            None,
        )
        .await
        .expect("add function lead");
    let expected_head_event_id = crate::handlers::company_functions::current_function_head(
        &fixture.state,
        fixture.tenant.community(),
        CompanyFunction::Sales,
    )
    .await
    .expect("query function head")
    .map(|stored| stored.event.id.to_hex());
    let action = FunctionAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        function: CompanyFunction::Sales,
        kind: FunctionActionKind::AssignLead,
        lead_pubkey: Some(lead.public_key().to_hex()),
        expected_head_event_id,
    };
    let event = buzz_sdk::company_records::build_function_action(&action)
        .expect("build function action")
        .sign_with_keys(&fixture.owner)
        .expect("sign function action");
    crate::handlers::company_functions::handle(
        &fixture.tenant,
        &fixture.state,
        event,
        auth(&fixture.owner),
    )
    .await
    .expect("assign function lead");
}

fn specialist_role_pack() -> HireRolePack {
    HireRolePack {
        persona_id: "persona-test-follow-ups".into(),
        title: "Outreach specialist".into(),
        job: "Follow up with people who are waiting to hear from the company.".into(),
        skills: vec!["Follow-up planning".into()],
        tools: vec![HireTool {
            name: "outreach_draft".into(),
            risk: HireToolRisk::Medium,
        }],
        worker_menu: vec!["runtime-test".into()],
        default_allowance: None,
        owns: Some("Follow up with every interested customer.".into()),
        channel: Some("sales".into()),
        duties: Vec::new(),
        on_hire: Some(RoleOnHire {
            sources: vec!["customer notes".into()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["sending anything public".into()],
        home: None,
    }
}

fn hire_action(
    hire_id: Uuid,
    action: HireActionKind,
    expected_head_event_id: Option<String>,
) -> HireAction {
    HireAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        hire_id,
        action,
        expected_head_event_id,
        proposal: None,
        employee_pubkey: None,
        introduction_event_id: None,
        reason: None,
        time_zone: None,
    }
}

fn sign_hire_action(keys: &Keys, action: &HireAction) -> Event {
    EventBuilder::new(
        Kind::Custom(KIND_HIRE_ACTION as u16),
        serde_json::to_string(action).expect("serialize hire action"),
    )
    .tags([Tag::parse(["d", hire_d_tag(action.hire_id).as_str()]).expect("hire d tag")])
    .sign_with_keys(keys)
    .expect("sign hire action")
}

async fn submit_hire(fixture: &Fixture, event: Event) -> Result<IngestResult, IngestError> {
    crate::handlers::company_hires::handle(
        &fixture.tenant,
        &fixture.state,
        event,
        auth(&fixture.owner),
    )
    .await
}

async fn hire_head_id(fixture: &Fixture, hire_id: Uuid) -> String {
    crate::handlers::company_hires::current_hire_head(
        &fixture.state,
        fixture.tenant.community(),
        &hire_d_tag(hire_id),
    )
    .await
    .expect("query hire head")
    .expect("hire head exists")
    .event
    .id
    .to_hex()
}

async fn assert_prebuilt_hire_head(
    fixture: &Fixture,
    hire_id: Uuid,
    expected_status: HireStatus,
    expected_employee: Option<&str>,
) -> HireHead {
    let stored = crate::handlers::company_hires::current_hire_head(
        &fixture.state,
        fixture.tenant.community(),
        &hire_d_tag(hire_id),
    )
    .await
    .expect("query prebuilt hire head")
    .expect("prebuilt hire head exists");
    assert_eq!(
        stored.event.pubkey,
        fixture.state.relay_keypair.public_key(),
        "the relay signs every current prebuilt hire head"
    );
    assert!(
        stored.event.verify().is_ok(),
        "the relay prebuilt hire head signature verifies"
    );
    let mut expected_tags = vec![vec!["d".to_owned(), hire_d_tag(hire_id)]];
    if let Some(employee) = expected_employee {
        expected_tags.push(vec!["p".to_owned(), employee.to_owned()]);
    }
    let tags = stored
        .event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect::<Vec<_>>();
    assert_eq!(tags, expected_tags, "the relay head tags stay exact");
    let head = crate::handlers::company_hires::parse_hire_head(&stored)
        .expect("parse the relay prebuilt hire head");
    assert_eq!(head.status, expected_status);
    assert_eq!(head.employee_pubkey.as_deref(), expected_employee);
    head
}

async fn post_employee_introduction(fixture: &Fixture, channel_id: Uuid, content: &str) -> Event {
    let introduction = EventBuilder::new(Kind::Custom(KIND_STREAM_MESSAGE as u16), content)
        .tags([Tag::parse(["h", channel_id.to_string().as_str()]).expect("h tag")])
        .sign_with_keys(&fixture.employee)
        .expect("sign the employee introduction");
    let accepted = crate::handlers::ingest::ingest_event(
        &fixture.state,
        &fixture.tenant,
        introduction.clone(),
        auth(&fixture.employee),
    )
    .await
    .expect("ingest the employee introduction");
    assert!(accepted.accepted, "the employee introduction is accepted");
    introduction
}

async fn create_hire(fixture: &Fixture, hire_id: Uuid) {
    let mut create = hire_action(hire_id, HireActionKind::Create, None);
    create.proposal = Some(HireProposal {
        hire_id,
        role_pack: specialist_role_pack(),
        display_name: format!("Specialist {}", hire_id.simple()),
        title: "Outreach specialist".into(),
        manager_pubkey: Some(fixture.owner.public_key().to_hex()),
        introduction_channel_id: fixture.channel_id,
        runtime_id: "runtime-test".into(),
        provider_id: None,
        model_id: None,
        weekly_allowance: None,
    });
    submit_hire(fixture, sign_hire_action(&fixture.owner, &create))
        .await
        .expect("create hire");
}

async fn complete_hire(fixture: &Fixture, hire_id: Uuid) {
    let approve = hire_action(
        hire_id,
        HireActionKind::Approve,
        Some(hire_head_id(fixture, hire_id).await),
    );
    submit_hire(fixture, sign_hire_action(&fixture.owner, &approve))
        .await
        .expect("approve hire");
    let mut attach = hire_action(
        hire_id,
        HireActionKind::AttachEmployee,
        Some(hire_head_id(fixture, hire_id).await),
    );
    attach.employee_pubkey = Some(fixture.employee.public_key().to_hex());
    submit_hire(fixture, sign_hire_action(&fixture.owner, &attach))
        .await
        .expect("attach employee");
    let introduction = EventBuilder::new(
        Kind::Custom(KIND_STREAM_MESSAGE as u16),
        "I will begin following up with customers.",
    )
    .tags([Tag::parse(["h", fixture.channel_id.to_string().as_str()]).expect("h tag")])
    .sign_with_keys(&fixture.employee)
    .expect("sign introduction");
    fixture
        .state
        .db
        .insert_event(
            fixture.tenant.community(),
            &introduction,
            Some(fixture.channel_id),
        )
        .await
        .expect("store introduction");
    let mut complete = hire_action(
        hire_id,
        HireActionKind::Complete,
        Some(hire_head_id(fixture, hire_id).await),
    );
    complete.employee_pubkey = Some(fixture.employee.public_key().to_hex());
    complete.introduction_event_id = Some(introduction.id.to_hex());
    submit_hire(fixture, sign_hire_action(&fixture.owner, &complete))
        .await
        .expect("complete hire");
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn owner_assigns_a_registered_employee_to_one_job() {
    let fixture = fixture().await;

    let head = assign_employee(&fixture, &fixture.employee).await;

    assert_eq!(head.state, JobState::Filled);
    assert_eq!(
        head.assignee_pubkey,
        Some(fixture.employee.public_key().to_hex())
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn owner_replaces_an_existing_job_specialist() {
    let fixture = fixture().await;
    let first = assign_employee(&fixture, &fixture.employee).await;

    let replacement = assign_employee(&fixture, &fixture.replacement).await;

    assert_ne!(first.assignee_pubkey, replacement.assignee_pubkey);
    assert_eq!(replacement.state, JobState::Filled);
    assert_eq!(
        replacement.assignee_pubkey,
        Some(fixture.replacement.public_key().to_hex())
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn terminating_a_specialist_clears_their_job_in_the_member_transaction() {
    let fixture = fixture().await;
    let position_head_id = set_active_position(&fixture, &fixture.employee).await;
    assign_employee(&fixture, &fixture.employee).await;

    terminate_employee(&fixture, &fixture.employee, position_head_id).await;

    let (_, head) = job_head(&fixture)
        .await
        .expect("job head remains as empty truth");
    assert_eq!(head.state, JobState::Empty);
    assert_eq!(head.assignee_pubkey, None);
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn direct_part_assignment_reparents_its_active_specialist() {
    let fixture = fixture().await;
    set_active_position(&fixture, &fixture.employee).await;
    assign_employee(&fixture, &fixture.employee).await;
    let lead = Keys::generate();

    assign_function_lead(&fixture, &lead).await;

    let (_, position) = crate::handlers::company_member_records::load_position_for_proposal(
        &fixture.state,
        fixture.tenant.community(),
        &fixture.employee.public_key().to_hex(),
    )
    .await
    .expect("load specialist position")
    .expect("specialist position exists");
    assert_eq!(position.manager_pubkey, Some(lead.public_key().to_hex()));
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn completing_a_hire_applies_its_recorded_job_intent() {
    let fixture = fixture().await;
    let hire_id = Uuid::new_v4();
    create_hire(&fixture, hire_id).await;

    write_job(&fixture, JobActionKind::HireSet, None, Some(hire_id), None)
        .await
        .expect("record job intent");
    let intent = current_job_hire(&fixture.state, fixture.tenant.community(), hire_id)
        .await
        .expect("query job intent")
        .expect("intent head exists");
    assert_eq!(intent.job_id, "follow-ups");

    complete_hire(&fixture, hire_id).await;

    let (_, head) = job_head(&fixture)
        .await
        .expect("completion assigned the job");
    assert_eq!(head.state, JobState::Filled);
    assert_eq!(
        head.assignee_pubkey,
        Some(fixture.employee.public_key().to_hex())
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn prebuilt_follow_ups_replays_the_relay_completion_contract() {
    let fixture = fixture_without_employee_owner().await;
    let mut actions = prebuilt_specialist_follow_ups_actions();
    let hire_id = actions.create.hire_id;
    let employee = fixture.employee.public_key().to_hex();
    let owner = fixture.owner.public_key().to_hex();
    let proposal = actions
        .create
        .proposal
        .as_mut()
        .expect("the prebuilt specialist create action has its proposal");
    assert!(
        proposal.role_pack.duties.is_empty(),
        "prebuilt specialist hires add no duties"
    );
    assert!(
        proposal.role_pack.on_hire.is_none(),
        "prebuilt specialist hires add no on-hire workflow"
    );
    proposal.introduction_channel_id = fixture.channel_id;
    proposal.manager_pubkey = Some(owner);

    let created = submit_hire(&fixture, sign_hire_action(&fixture.owner, &actions.create))
        .await
        .expect("create the prebuilt Follow-ups specialist hire");
    assert!(created.accepted);
    assert_prebuilt_hire_head(&fixture, hire_id, HireStatus::Proposed, None).await;

    let job_intent_event = buzz_sdk::company_records::build_job_action(&actions.job_hire_set)
        .expect("build the fixture job intent")
        .sign_with_keys(&fixture.owner)
        .expect("sign the fixture job intent");
    let job_intent_set = crate::handlers::company_jobs::handle(
        &fixture.tenant,
        &fixture.state,
        job_intent_event,
        auth(&fixture.owner),
    )
    .await
    .expect("record the Follow-ups job intent");
    assert!(job_intent_set.accepted);
    let job_intent = crate::handlers::company_jobs::current_job_hire(
        &fixture.state,
        fixture.tenant.community(),
        hire_id,
    )
    .await
    .expect("read the job intent")
    .expect("the fixture job intent exists");
    assert_eq!(job_intent.function, CompanyFunction::Sales);
    assert_eq!(job_intent.job_id, "follow-ups");
    assert_prebuilt_hire_head(&fixture, hire_id, HireStatus::Proposed, None).await;

    actions.approve.expected_head_event_id = Some(hire_head_id(&fixture, hire_id).await);
    let approved = submit_hire(&fixture, sign_hire_action(&fixture.owner, &actions.approve))
        .await
        .expect("approve the prebuilt Follow-ups specialist hire");
    assert!(approved.accepted);
    assert_prebuilt_hire_head(&fixture, hire_id, HireStatus::Approved, None).await;

    assert!(
        fixture
            .state
            .db
            .set_agent_owner(
                fixture.tenant.community(),
                &fixture.employee.public_key().to_bytes(),
                &fixture.owner.public_key().to_bytes(),
            )
            .await
            .expect("register the managed specialist"),
        "the founder registers the specialist after approval"
    );
    actions.attach_employee.expected_head_event_id = Some(hire_head_id(&fixture, hire_id).await);
    actions.attach_employee.employee_pubkey = Some(employee.clone());
    let attached = submit_hire(
        &fixture,
        sign_hire_action(&fixture.owner, &actions.attach_employee),
    )
    .await
    .expect("attach the founder-managed specialist");
    assert!(attached.accepted);
    assert_prebuilt_hire_head(
        &fixture,
        hire_id,
        HireStatus::Approved,
        Some(employee.as_str()),
    )
    .await;

    let wrong_channel = fixture
        .state
        .db
        .create_channel(
            fixture.tenant.community(),
            &format!("wrong-specialist-introduction-{}", Uuid::new_v4().simple()),
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &fixture.owner.public_key().to_bytes(),
            None,
        )
        .await
        .expect("create the other private channel");
    fixture
        .state
        .db
        .add_member(
            fixture.tenant.community(),
            wrong_channel.id,
            &fixture.employee.public_key().to_bytes(),
            MemberRole::Bot,
            Some(&fixture.owner.public_key().to_bytes()),
        )
        .await
        .expect("add the specialist to the other channel");
    let wrong_introduction =
        post_employee_introduction(&fixture, wrong_channel.id, "I am in the wrong channel.").await;
    let mut wrong_complete = actions.complete.clone();
    wrong_complete.expected_head_event_id = Some(hire_head_id(&fixture, hire_id).await);
    wrong_complete.employee_pubkey = Some(employee.clone());
    wrong_complete.introduction_event_id = Some(wrong_introduction.id.to_hex());
    assert_eq!(
        rejection(submit_hire(&fixture, sign_hire_action(&fixture.owner, &wrong_complete),).await),
        "invalid: introduction must be a non-empty channel post signed by the new employee"
    );
    assert_prebuilt_hire_head(
        &fixture,
        hire_id,
        HireStatus::Approved,
        Some(employee.as_str()),
    )
    .await;

    let introduction = post_employee_introduction(
        &fixture,
        fixture.channel_id,
        "Follow-ups specialist here. I have joined to do Follow-ups in Sales.",
    )
    .await;
    actions.complete.expected_head_event_id = Some(hire_head_id(&fixture, hire_id).await);
    actions.complete.employee_pubkey = Some(employee.clone());
    actions.complete.introduction_event_id = Some(introduction.id.to_hex());
    assert!(
        actions.complete.time_zone.is_none(),
        "the prebuilt action keeps engine side effects opt-in"
    );
    let completion_event = sign_hire_action(&fixture.owner, &actions.complete);
    let completed = submit_hire(&fixture, completion_event.clone())
        .await
        .expect("complete from the specialist home-channel introduction");
    assert!(completed.accepted);
    let hired = assert_prebuilt_hire_head(
        &fixture,
        hire_id,
        HireStatus::Hired,
        Some(employee.as_str()),
    )
    .await;
    assert_eq!(hired.introduction_event_id, Some(introduction.id.to_hex()));
    assert_eq!(hired.source_action_event_id, completion_event.id.to_hex());

    let assignment = crate::handlers::company_jobs::current_job_head(
        &fixture.state,
        fixture.tenant.community(),
        CompanyFunction::Sales,
        "follow-ups",
    )
    .await
    .expect("read the assigned Follow-ups job")
    .expect("completion assigned the specialist job");
    assert_eq!(assignment.state, JobState::Filled);
    assert_eq!(assignment.assignee_pubkey, Some(employee));
    let retained_intent = crate::handlers::company_jobs::current_job_hire(
        &fixture.state,
        fixture.tenant.community(),
        hire_id,
    )
    .await
    .expect("read the consumed job intent")
    .expect("the immutable job intent remains queryable");
    assert_eq!(retained_intent.function, CompanyFunction::Sales);
    assert_eq!(retained_intent.job_id, "follow-ups");
}
