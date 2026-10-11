//! PostgreSQL-backed tests for hire completion through the production handler.
//!
//! Each test drives one hire through create, owner approval, employee
//! attachment and the employee's introduction, then submits `complete` to
//! `handle` and reads back what the transaction stored.

use super::*;

use std::time::Duration;

use buzz_core::company_duties::{validate_duty_head, DutyHead, DutyStatus};
use buzz_core::company_members::member_d_tag;
use buzz_core::company_records::{
    goal_d_tag, GoalAction, GoalActionKind, GoalHead, GoalRecord, GoalStatus, HireRolePack,
    HireTool, HireToolRisk, RoleDutyTemplate, RoleOnHire, DEFAULT_HIRE_TIME_ZONE,
    HIRE_GOAL_DEFAULT_DONE_CONDITION, PLAN_CHECK_DUTY_INSTRUCTIONS, PLAN_CHECK_DUTY_SCHEDULE,
    PLAN_CHECK_DUTY_TITLE,
};
use buzz_core::kind::{
    KIND_DUTY_HEAD, KIND_GOAL_ACTION, KIND_GOAL_HEAD, KIND_MEMBER_POSITION_HEAD,
};
use buzz_db::channel::{ChannelType, ChannelVisibility};
use buzz_db::channel_members::MemberRole;
use buzz_workflow::schema::{ActionDef, TriggerDef, WorkflowDef};
use nostr::Keys;

static HIRE_DB_TEST_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();

const OWNS: &str = "Show up well on social media every week";
const ROLE_DUTY_TITLE: &str = "Next week's posts";

struct Fixture {
    state: Arc<AppState>,
    tenant: TenantContext,
    _serial_guard: tokio::sync::MutexGuard<'static, ()>,
    owner: Keys,
    employee: Keys,
    channel_id: Uuid,
}

async fn fixture() -> Fixture {
    fixture_with(true, true).await
}

/// Builds a community with an owner, a managed employee bound to that owner
/// and a private home channel. Either party can be left out of the channel.
async fn fixture_with(employee_in_channel: bool, owner_in_channel: bool) -> Fixture {
    let serial_guard = HIRE_DB_TEST_LOCK
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
    let host = format!("company-hires-{}.test", community_uuid.simple());
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
    let channel_creator = if owner_in_channel {
        owner.clone()
    } else {
        Keys::generate()
    };
    for keys in [&owner, &employee, &channel_creator] {
        state
            .db
            .ensure_user(community, &keys.public_key().to_bytes())
            .await
            .expect("ensure identity");
    }
    state
        .db
        .add_relay_member(community, &owner.public_key().to_hex(), "owner", None)
        .await
        .expect("add community owner");
    assert!(
        state
            .db
            .set_agent_owner(
                community,
                &employee.public_key().to_bytes(),
                &owner.public_key().to_bytes(),
            )
            .await
            .expect("bind the managed employee"),
        "the employee is owned by the owner"
    );
    let channel = state
        .db
        .create_channel(
            community,
            &format!("home-{}", Uuid::new_v4().simple()),
            ChannelType::Stream,
            ChannelVisibility::Private,
            None,
            &channel_creator.public_key().to_bytes(),
            None,
        )
        .await
        .expect("create the home channel");
    if employee_in_channel {
        state
            .db
            .add_member(
                community,
                channel.id,
                &employee.public_key().to_bytes(),
                MemberRole::Bot,
                Some(&channel_creator.public_key().to_bytes()),
            )
            .await
            .expect("add the employee to its home channel");
    }
    Fixture {
        state,
        tenant,
        _serial_guard: serial_guard,
        owner,
        employee,
        channel_id: channel.id,
    }
}

fn auth(keys: &Keys) -> IngestAuth {
    IngestAuth::Http {
        pubkey: keys.public_key(),
        scopes: vec![buzz_auth::Scope::MessagesWrite],
        auth_method: crate::handlers::ingest::HttpAuthMethod::DevPubkey,
    }
}

fn role_pack() -> HireRolePack {
    HireRolePack {
        persona_id: "persona-test-social".into(),
        title: "Social Media Manager".into(),
        job: "Plan, draft and schedule the company's social media posts.".into(),
        skills: vec!["Content planning".into()],
        tools: vec![HireTool {
            name: "social_draft".into(),
            risk: HireToolRisk::Medium,
        }],
        worker_menu: vec!["runtime-test".into()],
        default_allowance: None,
        owns: Some(OWNS.into()),
        channel: Some("social".into()),
        duties: vec![RoleDutyTemplate {
            title: ROLE_DUTY_TITLE.into(),
            schedule_text: "Every Monday at 10:00".into(),
            instructions: "Draft next week's posts as one batch and send them for approval.".into(),
        }],
        on_hire: Some(RoleOnHire {
            sources: vec!["instagram profile".into(), "product photos".into()],
            plan_horizon_days: 14,
        }),
        ask_before: vec!["anything public".into(), "prices".into()],
        home: Some("social.calendar".into()),
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

async fn submit(fixture: &Fixture, event: Event) -> Result<IngestResult, IngestError> {
    handle(&fixture.tenant, &fixture.state, event, auth(&fixture.owner)).await
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

async fn hire_head(fixture: &Fixture, hire_id: Uuid) -> StoredEvent {
    current_hire_head(
        &fixture.state,
        fixture.tenant.community(),
        &hire_d_tag(hire_id),
    )
    .await
    .expect("read the hire head")
    .expect("the hire head exists")
}

/// Drives one hire to the point where only `complete` remains and returns
/// that unsigned action.
async fn hire_ready_to_complete(fixture: &Fixture, role_pack: HireRolePack) -> HireAction {
    let hire_id = Uuid::new_v4();
    let mut create = hire_action(hire_id, HireActionKind::Create, None);
    create.proposal = Some(HireProposal {
        hire_id,
        role_pack,
        display_name: format!("Employee {}", hire_id.simple()),
        title: "Social Media Manager".into(),
        manager_pubkey: Some(fixture.owner.public_key().to_hex()),
        introduction_channel_id: fixture.channel_id,
        runtime_id: "runtime-test".into(),
        provider_id: None,
        model_id: None,
        weekly_allowance: None,
    });
    submit(fixture, sign_hire_action(&fixture.owner, &create))
        .await
        .expect("create the hire");
    let approve = hire_action(
        hire_id,
        HireActionKind::Approve,
        Some(hire_head(fixture, hire_id).await.event.id.to_hex()),
    );
    submit(fixture, sign_hire_action(&fixture.owner, &approve))
        .await
        .expect("owner approval");
    let mut attach = hire_action(
        hire_id,
        HireActionKind::AttachEmployee,
        Some(hire_head(fixture, hire_id).await.event.id.to_hex()),
    );
    attach.employee_pubkey = Some(fixture.employee.public_key().to_hex());
    submit(fixture, sign_hire_action(&fixture.owner, &attach))
        .await
        .expect("attach the employee");
    let introduction = EventBuilder::new(
        Kind::Custom(KIND_STREAM_MESSAGE as u16),
        "Hi, I'm the new social media manager.",
    )
    .tags([Tag::parse(["h", fixture.channel_id.to_string().as_str()]).expect("h tag")])
    .sign_with_keys(&fixture.employee)
    .expect("sign the introduction");
    fixture
        .state
        .db
        .insert_event(
            fixture.tenant.community(),
            &introduction,
            Some(fixture.channel_id),
        )
        .await
        .expect("store the introduction");
    let mut complete = hire_action(
        hire_id,
        HireActionKind::Complete,
        Some(hire_head(fixture, hire_id).await.event.id.to_hex()),
    );
    complete.employee_pubkey = Some(fixture.employee.public_key().to_hex());
    complete.introduction_event_id = Some(introduction.id.to_hex());
    complete
}

async fn goal_heads(fixture: &Fixture, goal_id: Uuid) -> Vec<StoredEvent> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_GOAL_HEAD as i32]);
    query.pubkey = Some(fixture.state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag = Some(goal_d_tag(goal_id));
    query.global_only = true;
    query.limit = Some(10);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query goal heads")
}

async fn member_heads(fixture: &Fixture) -> Vec<StoredEvent> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_MEMBER_POSITION_HEAD as i32]);
    query.pubkey = Some(fixture.state.relay_keypair.public_key().to_bytes().to_vec());
    query.d_tag =
        Some(member_d_tag(&fixture.employee.public_key().to_hex()).expect("member d tag"));
    query.global_only = true;
    query.limit = Some(10);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query member heads")
}

async fn duty_heads(fixture: &Fixture) -> Vec<(StoredEvent, DutyHead)> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_DUTY_HEAD as i32]);
    query.pubkey = Some(fixture.state.relay_keypair.public_key().to_bytes().to_vec());
    query.p_tag_hex = Some(fixture.employee.public_key().to_hex());
    query.limit = Some(50);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query duty heads")
        .into_iter()
        .map(|stored| {
            let head =
                serde_json::from_str::<DutyHead>(&stored.event.content).expect("duty head content");
            (stored, head)
        })
        .collect()
}

async fn channel_workflows(fixture: &Fixture) -> Vec<buzz_db::workflow::WorkflowRecord> {
    fixture
        .state
        .db
        .list_channel_workflows(
            fixture.tenant.community(),
            fixture.channel_id,
            Some(50),
            None,
        )
        .await
        .expect("list home channel workflows")
}

async fn kickoffs(fixture: &Fixture, hire_id: Uuid) -> Vec<StoredEvent> {
    let mut query = EventQuery::for_community(fixture.tenant.community());
    query.kinds = Some(vec![KIND_STREAM_MESSAGE as i32]);
    query.channel_id = Some(fixture.channel_id);
    query.p_tag_hex = Some(fixture.employee.public_key().to_hex());
    query.custom_tag = Some(("colony:on-hire".to_owned(), hire_id.to_string()));
    query.limit = Some(10);
    fixture
        .state
        .db
        .query_events_for_event_write(&query)
        .await
        .expect("query on-hire kickoffs")
}

/// Asserts a rejected `complete` left the hire approved and stored none of the
/// records that command would have written.
async fn assert_completion_left_nothing(fixture: &Fixture, complete: &HireAction, event: &Event) {
    let hire =
        parse_hire_head(&hire_head(fixture, complete.hire_id).await).expect("parse the hire head");
    assert_eq!(hire.status, HireStatus::Approved, "the hire stays approved");
    assert!(
        fixture
            .state
            .db
            .get_event_by_id_for_event_write(fixture.tenant.community(), &event.id.to_bytes())
            .await
            .expect("read the complete command")
            .is_none(),
        "the complete command is not stored"
    );
    assert!(member_heads(fixture).await.is_empty(), "no member position");
    let completion_id = event.id.to_hex();
    for stored in goal_heads(fixture, complete.hire_id).await {
        let goal: GoalHead = serde_json::from_str(&stored.event.content).expect("goal head");
        assert_ne!(
            goal.source_action_event_id, completion_id,
            "no goal from this completion"
        );
    }
    assert!(duty_heads(fixture).await.is_empty(), "no routine heads");
    assert!(
        channel_workflows(fixture).await.is_empty(),
        "no routine workflows"
    );
    assert!(
        kickoffs(fixture, complete.hire_id).await.is_empty(),
        "no on-hire kickoff"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn complete_creates_the_employee_goal_with_the_hire() {
    let fixture = fixture().await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    submit(&fixture, event.clone())
        .await
        .expect("complete the hire");

    let hire =
        parse_hire_head(&hire_head(&fixture, complete.hire_id).await).expect("parse the hire head");
    assert_eq!(hire.status, HireStatus::Hired);
    assert_eq!(
        member_heads(&fixture).await.len(),
        1,
        "member position written"
    );
    let goals = goal_heads(&fixture, complete.hire_id).await;
    assert_eq!(goals.len(), 1, "one goal head for the hire");
    let stored = &goals[0];
    assert_eq!(
        stored.event.pubkey,
        fixture.state.relay_keypair.public_key()
    );
    assert_eq!(stored.channel_id, None);
    let head: GoalHead = serde_json::from_str(&stored.event.content).expect("goal head");
    assert_eq!(head.goal_id, complete.hire_id);
    assert_eq!(head.status, GoalStatus::Active);
    assert_eq!(head.source_action_event_id, event.id.to_hex());
    let goal = head.goal.expect("a live goal");
    assert_eq!(goal.title, OWNS);
    assert_eq!(goal.done_condition, OWNS);
    assert_eq!(goal.owner_pubkey, fixture.employee.public_key().to_hex());
    assert_eq!(goal.parent_goal_id, None);
    assert_eq!(goal.linked_channel_ids, vec![fixture.channel_id]);
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn a_goal_at_the_hire_id_rolls_back_the_whole_completion() {
    let fixture = fixture().await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let existing = GoalAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        goal_id: complete.hire_id,
        action: GoalActionKind::Create,
        expected_head_event_id: None,
        goal: Some(GoalRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            goal_id: complete.hire_id,
            parent_goal_id: None,
            title: "An existing company goal".into(),
            owner_pubkey: fixture.owner.public_key().to_hex(),
            due_date: None,
            done_condition: "Already tracked".into(),
            target: None,
            linked_channel_ids: Vec::new(),
        }),
        progress: None,
        status: None,
        reason: None,
    };
    let goal_command = EventBuilder::new(
        Kind::Custom(KIND_GOAL_ACTION as u16),
        serde_json::to_string(&existing).expect("serialize goal action"),
    )
    .tags([Tag::parse(["d", goal_d_tag(complete.hire_id).as_str()]).expect("goal d tag")])
    .sign_with_keys(&fixture.owner)
    .expect("sign goal action");
    crate::handlers::company_records::handle(
        &fixture.tenant,
        &fixture.state,
        goal_command,
        auth(&fixture.owner),
    )
    .await
    .expect("create the existing goal");

    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(
        message.contains("a goal already uses this hire id"),
        "{message}"
    );
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    let goals = goal_heads(&fixture, complete.hire_id).await;
    assert_eq!(goals.len(), 1);
    let kept: GoalHead = serde_json::from_str(&goals[0].event.content).expect("goal head");
    assert_eq!(kept.title, "An existing company goal");
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn complete_creates_role_routines_and_plan_check_with_their_workflows() {
    let fixture = fixture().await;
    let mut complete = hire_ready_to_complete(&fixture, role_pack()).await;
    complete.time_zone = Some("Africa/Johannesburg".into());
    let event = sign_hire_action(&fixture.owner, &complete);
    submit(&fixture, event.clone())
        .await
        .expect("complete the hire");

    let mut duties = duty_heads(&fixture).await;
    duties.sort_by(|left, right| left.1.proposal.title.cmp(&right.1.proposal.title));
    let titles = duties
        .iter()
        .map(|(_, head)| head.proposal.title.as_str())
        .collect::<Vec<_>>();
    assert_eq!(titles, vec![ROLE_DUTY_TITLE, PLAN_CHECK_DUTY_TITLE]);
    let owner = fixture.owner.public_key().to_hex();
    let employee = fixture.employee.public_key().to_hex();
    for (stored, head) in &duties {
        assert_eq!(
            stored.event.pubkey,
            fixture.state.relay_keypair.public_key()
        );
        assert!(validate_duty_head(head).is_ok());
        assert_eq!(head.source_hire_id, Some(complete.hire_id));
        assert_eq!(head.source_ask_id, None);
        assert_eq!(head.source_ask_channel_id, None);
        assert_eq!(head.approved_by_pubkey, owner);
        assert_eq!(head.proposed_by_pubkey, owner);
        assert_eq!(head.source_action_event_id, event.id.to_hex());
        assert_eq!(head.status, DutyStatus::Active);
        assert_eq!(head.proposal.employee_pubkey, employee);
        assert_eq!(head.proposal.channel_id, fixture.channel_id);
        assert_eq!(head.proposal.time_zone, "Africa/Johannesburg");
        let workflow = fixture
            .state
            .db
            .get_workflow(fixture.tenant.community(), head.duty_id)
            .await
            .expect("the routine's workflow exists");
        assert_eq!(
            workflow.owner_pubkey,
            fixture.owner.public_key().to_bytes().to_vec()
        );
        assert_eq!(workflow.channel_id, Some(fixture.channel_id));
        assert!(workflow.enabled);
        assert_eq!(
            hex::encode(&workflow.definition_hash),
            head.workflow_definition_hash
        );
        let definition: WorkflowDef =
            serde_json::from_value(workflow.definition).expect("workflow definition");
        match definition.trigger {
            TriggerDef::Schedule { cron, timezone, .. } => {
                assert_eq!(cron.as_deref(), Some(head.proposal.schedule_cron.as_str()));
                assert_eq!(timezone.as_deref(), Some("Africa/Johannesburg"));
            }
            other => panic!("a routine workflow is scheduled, got {other:?}"),
        }
        assert!(matches!(
            &definition.steps[0].action,
            ActionDef::AskAgent { agent_pubkey, .. } if *agent_pubkey == employee
        ));
    }
    let role_routine = &duties[0].1;
    assert_eq!(role_routine.proposal.schedule_cron, "0 10 * * 1");
    let plan_check = &duties[1].1;
    assert_eq!(plan_check.proposal.schedule_text, PLAN_CHECK_DUTY_SCHEDULE);
    assert_eq!(plan_check.proposal.schedule_cron, "0 9 * * 1");
    assert_eq!(
        plan_check.proposal.instructions,
        PLAN_CHECK_DUTY_INSTRUCTIONS
    );
    assert_eq!(channel_workflows(&fixture).await.len(), 2);
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn a_v1_role_pack_gets_a_title_goal_and_only_the_utc_plan_check_routine() {
    let fixture = fixture().await;
    let mut pack = role_pack();
    pack.owns = None;
    pack.channel = None;
    pack.duties.clear();
    pack.on_hire = None;
    pack.ask_before.clear();
    pack.home = None;
    let complete = hire_ready_to_complete(&fixture, pack).await;
    submit(&fixture, sign_hire_action(&fixture.owner, &complete))
        .await
        .expect("complete a v1 hire");

    let goals = goal_heads(&fixture, complete.hire_id).await;
    assert_eq!(goals.len(), 1);
    let goal = serde_json::from_str::<GoalHead>(&goals[0].event.content)
        .expect("goal head")
        .goal
        .expect("a live goal");
    assert_eq!(goal.title, "Social Media Manager");
    assert_eq!(goal.done_condition, HIRE_GOAL_DEFAULT_DONE_CONDITION);
    let duties = duty_heads(&fixture).await;
    assert_eq!(duties.len(), 1);
    assert_eq!(duties[0].1.proposal.title, PLAN_CHECK_DUTY_TITLE);
    assert_eq!(duties[0].1.proposal.time_zone, DEFAULT_HIRE_TIME_ZONE);
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn an_employee_outside_the_home_channel_rolls_back_the_goal_and_the_hire() {
    let fixture = fixture_with(false, true).await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(
        message.contains("duty employee is not an active member of the channel"),
        "{message}"
    );
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    assert!(
        goal_heads(&fixture, complete.hire_id).await.is_empty(),
        "the goal written before the routine step rolled back"
    );
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn a_founder_outside_the_home_channel_cannot_complete_the_hire() {
    let fixture = fixture_with(true, false).await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(
        message.contains("the owner must be a member of the home channel"),
        "{message}"
    );
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    assert!(goal_heads(&fixture, complete.hire_id).await.is_empty());
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn an_unknown_time_zone_rolls_back_the_completion() {
    let fixture = fixture().await;
    let mut complete = hire_ready_to_complete(&fixture, role_pack()).await;
    complete.time_zone = Some("Mars/Olympus_Mons".into());
    let event = sign_hire_action(&fixture.owner, &complete);
    let message = rejection(submit(&fixture, event.clone()).await);
    assert!(message.contains("invalid schedule timezone"), "{message}");
    assert_completion_left_nothing(&fixture, &complete, &event).await;
    assert!(goal_heads(&fixture, complete.hire_id).await.is_empty());
}

#[tokio::test]
#[ignore = "requires disposable Postgres"]
async fn complete_publishes_exactly_one_workflow_tagged_kickoff() {
    let fixture = fixture().await;
    let complete = hire_ready_to_complete(&fixture, role_pack()).await;
    let event = sign_hire_action(&fixture.owner, &complete);
    submit(&fixture, event.clone())
        .await
        .expect("complete the hire");

    let found = kickoffs(&fixture, complete.hire_id).await;
    assert_eq!(
        found.len(),
        1,
        "one kickoff, found through the employee mention index"
    );
    let kickoff = &found[0];
    assert_eq!(
        kickoff.event.pubkey,
        fixture.state.relay_keypair.public_key()
    );
    assert!(kickoff.event.verify().is_ok());
    assert_eq!(kickoff.channel_id, Some(fixture.channel_id));
    let owner = fixture.owner.public_key().to_hex();
    let employee = fixture.employee.public_key().to_hex();
    let expected = vec![
        vec!["h".to_owned(), fixture.channel_id.to_string()],
        vec!["p".to_owned(), owner.clone()],
        vec!["p".to_owned(), employee.clone()],
        vec!["buzz:workflow".to_owned(), "true".to_owned()],
        vec!["buzz:workflow-owner".to_owned(), owner.clone()],
        vec!["buzz:workflow-mention".to_owned(), employee.clone()],
        vec!["colony:on-hire".to_owned(), complete.hire_id.to_string()],
    ];
    let tags = kickoff
        .event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect::<Vec<_>>();
    assert_eq!(tags, expected);
    let proposal = parse_hire_head(&hire_head(&fixture, complete.hire_id).await)
        .expect("parse the hire head")
        .proposal;
    assert_eq!(
        kickoff.event.content,
        format!(
            "@{} you're hired. Study the business and your sources, then write your first 2-week plan and send it to your manager for approval.",
            proposal.display_name
        )
    );

    // A replay of the accepted command and a fresh complete both leave one kickoff.
    let replay = submit(&fixture, event.clone())
        .await
        .expect("an accepted completion replay returns its duplicate result");
    assert!(replay.accepted);
    assert_eq!(replay.event_id, event.id.to_hex());
    assert!(replay.message.starts_with("duplicate:"));
    let mut second = complete.clone();
    second.expected_head_event_id = Some(
        hire_head(&fixture, complete.hire_id)
            .await
            .event
            .id
            .to_hex(),
    );
    let message = rejection(submit(&fixture, sign_hire_action(&fixture.owner, &second)).await);
    assert!(
        message.contains("founder sign-off is required before hiring"),
        "{message}"
    );
    assert_eq!(
        kickoffs(&fixture, complete.hire_id).await.len(),
        1,
        "once per hire"
    );
    assert_eq!(goal_heads(&fixture, complete.hire_id).await.len(), 1);
    assert_eq!(duty_heads(&fixture).await.len(), 2);
    assert_eq!(channel_workflows(&fixture).await.len(), 2);
}
