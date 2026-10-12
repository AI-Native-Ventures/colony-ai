//! A hire finishes exactly once wherever the host was killed (overview review
//! focus 1): one employee, one hello, one Complete.

use std::collections::BTreeSet;

use uuid::Uuid;

use super::hire::{
    choose_time_zone, existing_entry_state, gate_hold_from, hello_marker, hello_text,
    hire_view_from, new_entry, role_context_for, run_hire, validated_input, HireCompleteInput,
    HireCompleteState, HireIo, HireView, CHANGED, FINISHED_ELSEWHERE, NOT_FOUNDER,
};
use super::hire_journal::{self, HireJournal, HireJournalEntry, HireStep, JOURNAL_FILE};
use crate::managed_agents::RoleContext;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const STRANGER: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const HIRE: &str = "6f1d6a8e-3c1b-4c5e-9a57-3f5c2b8d9e10";
const CHANNEL: &str = "0b8f2a4c-6d1e-4f3a-8b9c-1d2e3f4a5b6c";
const RELAY: &str = "wss://lerato.colony.example";
const ZONE: &str = "Africa/Johannesburg";

/// The relay and this computer: what a killed host leaves behind.
struct World {
    status: String,
    head_version: u32,
    founder: String,
    attached: Option<String>,
    /// Local employee records: public key and role context goal.
    employees: Vec<(String, Option<String>)>,
    members: BTreeSet<String>,
    /// Posted hellos: marker and event id.
    hellos: Vec<(String, String)>,
    completes: u32,
    completed_zone: Option<String>,
    completed_at: Option<i64>,
    running: BTreeSet<String>,
    start_floors: Vec<Option<u64>>,
    journal: Option<HireJournalEntry>,
    clock: i64,
    log: Vec<&'static str>,
}

impl World {
    fn approved() -> Self {
        Self {
            status: "approved".into(),
            head_version: 1,
            founder: OWNER.into(),
            attached: None,
            employees: Vec::new(),
            members: BTreeSet::new(),
            hellos: Vec::new(),
            completes: 0,
            completed_zone: None,
            completed_at: None,
            running: BTreeSet::new(),
            start_floors: Vec::new(),
            journal: None,
            clock: 1_760_180_000,
            log: Vec::new(),
        }
    }
}

/// Every effect is fenced by boundaries. The host dies at boundary
/// `crash_at`; after that nothing happens.
struct FakeIo<'w> {
    world: &'w mut World,
    crash_at: Option<usize>,
    seen: usize,
    dead: bool,
}

impl<'w> FakeIo<'w> {
    fn new(world: &'w mut World, crash_at: Option<usize>) -> Self {
        Self {
            world,
            crash_at,
            seen: 0,
            dead: false,
        }
    }

    fn boundary(&mut self) -> Result<(), String> {
        if self.dead {
            return Err("the host is gone".into());
        }
        let here = self.seen;
        self.seen += 1;
        if self.crash_at == Some(here) {
            self.dead = true;
            return Err(format!("the host was killed at boundary {here}"));
        }
        self.world.clock += 1;
        Ok(())
    }
}

fn proposal() -> serde_json::Value {
    serde_json::json!({
        "hireId": HIRE,
        "rolePack": {
            "personaId": "builtin:test-employee",
            "title": "Test Employee",
            "job": "Post one short note a day",
            "skills": [],
            "tools": [],
            "workerMenu": ["claude"],
            "owns": "One short note a day",
            "askBefore": ["anything public"],
            "onHire": { "sources": ["business profile"], "planHorizonDays": 14 }
        },
        "displayName": "Gate Tester",
        "title": "Test Employee",
        "introductionChannelId": CHANNEL,
        "runtimeId": "claude"
    })
}

fn view_of(world: &World) -> HireView {
    let head = serde_json::json!({
        "schemaVersion": 1,
        "proposal": proposal(),
        "status": world.status,
        "proposedByPubkey": OWNER,
        "founderPubkey": world.founder,
        "employeePubkey": world.attached,
        "sourceActionEventId": "00",
        "fieldFromANewerRelay": true
    });
    hire_view_from(&format!("head-{}", world.head_version), &head.to_string()).expect("head parses")
}

impl HireIo for FakeIo<'_> {
    fn owner(&self) -> &str {
        OWNER
    }

    fn now(&self) -> i64 {
        self.world.clock
    }

    async fn hire(&mut self, _hire_id: Uuid) -> Result<Option<HireView>, String> {
        self.boundary()?;
        Ok(Some(view_of(self.world)))
    }

    async fn find_employee(
        &mut self,
        hire_id: Uuid,
        attached: Option<&str>,
    ) -> Result<Option<String>, String> {
        self.boundary()?;
        let goal = hire_id.to_string();
        Ok(self
            .world
            .employees
            .iter()
            .find(|(pubkey, made_for)| {
                made_for.as_deref() == Some(goal.as_str()) || Some(pubkey.as_str()) == attached
            })
            .map(|(pubkey, _)| pubkey.clone()))
    }

    async fn manager_name(&mut self, _manager_pubkey: &str) -> Option<String> {
        None
    }

    async fn create_employee(
        &mut self,
        _view: &HireView,
        role: RoleContext,
    ) -> Result<String, String> {
        self.boundary()?;
        let pubkey = format!("{:064x}", self.world.employees.len() + 1);
        self.world.employees.push((pubkey.clone(), role.goal_id));
        self.world.log.push("create_employee");
        self.boundary()?;
        Ok(pubkey)
    }

    async fn ensure_profile(&mut self, _employee: &str) -> Result<(), String> {
        self.boundary()?;
        self.boundary()
    }

    async fn attach_employee(&mut self, view: &HireView, employee: &str) -> Result<(), String> {
        self.boundary()?;
        if view.head_event_id != format!("head-{}", self.world.head_version)
            || self.world.attached.is_some()
        {
            return Err("relay rejected event: the hire head moved".into());
        }
        self.world.attached = Some(employee.to_string());
        self.world.head_version += 1;
        self.world.log.push("attach_employee");
        self.boundary()
    }

    async fn add_employee_to_channel(
        &mut self,
        _channel: Uuid,
        employee: &str,
    ) -> Result<(), String> {
        self.boundary()?;
        self.world.members.insert(employee.to_string());
        self.world.log.push("employee_in_channel");
        self.boundary()
    }

    async fn ensure_owner_in_channel(&mut self, _channel: Uuid) -> Result<(), String> {
        self.boundary()?;
        self.world.members.insert(OWNER.to_string());
        self.world.log.push("owner_in_channel");
        self.boundary()
    }

    async fn post_hello(
        &mut self,
        _employee: &str,
        _channel: Uuid,
        _text: &str,
        marker: &str,
    ) -> Result<String, String> {
        self.boundary()?;
        if let Some((_, id)) = self
            .world
            .hellos
            .iter()
            .find(|(posted, _)| posted == marker)
        {
            return Ok(id.clone());
        }
        let id = format!("{:064x}", 900 + self.world.hellos.len());
        self.world.hellos.push((marker.to_string(), id.clone()));
        self.world.log.push("hello");
        self.boundary()?;
        Ok(id)
    }

    async fn complete(
        &mut self,
        view: &HireView,
        employee: &str,
        introduction_event_id: &str,
        time_zone: &str,
    ) -> Result<(), String> {
        self.boundary()?;
        // The relay's rules (part B).
        if self.world.status == "hired" {
            return Err("relay rejected event: founder sign-off is required before hiring".into());
        }
        if view.head_event_id != format!("head-{}", self.world.head_version) {
            return Err("relay rejected event: the hire head moved".into());
        }
        assert_eq!(self.world.attached.as_deref(), Some(employee));
        assert!(
            self.world.members.contains(OWNER) && self.world.members.contains(employee),
            "the owner and the employee join the home channel before Complete"
        );
        assert!(self
            .world
            .hellos
            .iter()
            .any(|(_, id)| id == introduction_event_id));
        self.world.status = "hired".into();
        self.world.head_version += 1;
        self.world.completes += 1;
        self.world.completed_zone = Some(time_zone.to_string());
        self.world.completed_at = Some(self.world.clock);
        self.world.log.push("complete");
        self.boundary()
    }

    async fn start_employee(
        &mut self,
        employee: &str,
        replay_floor: Option<u64>,
    ) -> Result<(), String> {
        self.boundary()?;
        // A pair that already runs is not started twice (`start_pair`).
        self.world.running.insert(employee.to_string());
        self.world.start_floors.push(replay_floor);
        self.boundary()
    }

    fn save(&mut self, entry: &HireJournalEntry) -> Result<(), String> {
        self.boundary()?;
        self.world.journal = Some(entry.clone());
        self.boundary()
    }

    async fn hold_after(&mut self, _step: HireStep) {}
}

fn input() -> HireCompleteInput {
    HireCompleteInput {
        relay_url: RELAY.into(),
        hire_id: HIRE.into(),
        persona_id: "builtin:test-employee".into(),
        display_name: "Gate Tester".into(),
        home_channel_id: CHANNEL.into(),
        time_zone: None,
    }
}

fn fresh_entry() -> HireJournalEntry {
    new_entry(
        &validated_input(&input()).expect("valid input"),
        ZONE.to_string(),
        1_760_180_000,
    )
}

#[tokio::test]
async fn interrupted_hire_resumes_to_exactly_one_employee_hello_and_complete() {
    let mut boundary = 0;
    loop {
        let mut world = World::approved();
        let entry = fresh_entry();
        // The command saves the entry before the first side effect.
        world.journal = Some(entry.clone());

        let first = run_hire(&mut FakeIo::new(&mut world, Some(boundary)), entry).await;
        if first.is_ok() {
            assert!(
                boundary > 20,
                "every boundary of a hire was interrupted once"
            );
            break;
        }

        // Colony starts again and resumes from the journal on disk.
        let resumed = world.journal.clone().expect("a journal entry is on disk");
        let employee = run_hire(&mut FakeIo::new(&mut world, None), resumed)
            .await
            .unwrap_or_else(|error| panic!("boundary {boundary}: {error}"));

        assert_eq!(
            world.employees.len(),
            1,
            "boundary {boundary}: one employee"
        );
        assert_eq!(world.hellos.len(), 1, "boundary {boundary}: one hello");
        assert_eq!(world.completes, 1, "boundary {boundary}: one Complete");
        assert_eq!(world.attached.as_deref(), Some(employee.as_str()));
        assert!(world.members.contains(OWNER) && world.members.contains(&employee));
        assert_eq!(world.completed_zone.as_deref(), Some(ZONE));
        assert_eq!(world.running, BTreeSet::from([employee.clone()]));
        let floor = world
            .start_floors
            .last()
            .copied()
            .flatten()
            .expect("the first start carries a replay floor");
        assert!(
            i64::try_from(floor).expect("small") < world.completed_at.expect("completed"),
            "boundary {boundary}: the floor is taken before Complete, so the kickoff is replayed"
        );
        assert_eq!(
            world.journal.map(|entry| entry.step),
            Some(HireStep::Started)
        );
        boundary += 1;
    }
}

#[tokio::test]
async fn the_owner_joins_the_home_channel_before_complete() {
    let mut world = World::approved();
    run_hire(&mut FakeIo::new(&mut world, None), fresh_entry())
        .await
        .expect("hire finishes");
    let at = |what: &str| {
        world
            .log
            .iter()
            .position(|done| *done == what)
            .unwrap_or_else(|| panic!("{what} happened"))
    };
    assert!(at("employee_in_channel") < at("complete"));
    assert!(at("owner_in_channel") < at("complete"));
    assert!(at("hello") < at("complete"));
    assert!(at("attach_employee") < at("hello"));
}

#[tokio::test]
async fn a_hire_finished_on_another_computer_creates_no_employee() {
    let mut world = World::approved();
    world.status = "hired".into();
    world.attached = Some(STRANGER.into());
    let result = run_hire(&mut FakeIo::new(&mut world, None), fresh_entry()).await;
    assert_eq!(result, Err(FINISHED_ELSEWHERE.to_string()));
    assert!(world.employees.is_empty());
}

#[tokio::test]
async fn only_the_approving_founder_finishes_a_hire() {
    let mut world = World::approved();
    world.founder = STRANGER.into();
    let result = run_hire(&mut FakeIo::new(&mut world, None), fresh_entry()).await;
    assert_eq!(result, Err(NOT_FOUNDER.to_string()));
    assert!(world.employees.is_empty());
}

#[tokio::test]
async fn a_hire_that_changed_is_refused_before_anything_happens() {
    let mut world = World::approved();
    let mut entry = fresh_entry();
    entry.display_name = "Someone Else".into();
    let result = run_hire(&mut FakeIo::new(&mut world, None), entry).await;
    assert_eq!(result, Err(CHANGED.to_string()));
    assert!(world.employees.is_empty());
}

#[test]
fn a_journal_entry_says_whether_the_hire_resumed_or_was_already_complete() {
    let mut entry = fresh_entry();
    entry.step = HireStep::HelloPosted;
    assert_eq!(existing_entry_state(&entry), HireCompleteState::Resumed);
    entry.step = HireStep::Started;
    assert_eq!(
        existing_entry_state(&entry),
        HireCompleteState::AlreadyComplete
    );
}

#[test]
fn the_company_time_zone_comes_from_the_profile_then_this_computer() {
    assert_eq!(choose_time_zone(Some(ZONE), Some("Europe/London")), ZONE);
    assert_eq!(
        choose_time_zone(None, Some("Europe/London")),
        "Europe/London"
    );
    assert_eq!(choose_time_zone(None, Some("not a zone!")), "UTC");
    assert_eq!(choose_time_zone(None, None), "UTC");
}

#[test]
fn the_hello_is_plain_and_names_the_role() {
    let hello = hello_text("Naledi", "Social Media Manager");
    assert_eq!(
        hello,
        "Hi everyone, I'm Naledi, the new Social Media Manager. I'm reading up on the business and will share my plan soon."
    );
    for banned in ["Buzz", "Fizz", "Honey", "\u{2014}"] {
        assert!(!hello.contains(banned));
    }
    let hire_id = Uuid::parse_str(HIRE).expect("uuid");
    assert_eq!(
        hello_marker(hire_id),
        format!("company-hire:{HIRE}:introduction")
    );
}

#[test]
fn the_role_context_carries_the_hire_as_its_goal() {
    let world = World::approved();
    let role = role_context_for(&view_of(&world), Some("Scout".into()));
    assert_eq!(role.goal_id.as_deref(), Some(HIRE));
    assert_eq!(role.home_channel_id.as_deref(), Some(CHANNEL));
    assert_eq!(role.title, "Test Employee");
    assert_eq!(role.manager_name.as_deref(), Some("Scout"));
    assert_eq!(role.ask_before, vec!["anything public".to_string()]);
    assert_eq!(role.on_hire_sources, vec!["business profile".to_string()]);
    assert_eq!(role.plan_horizon_days, 14);
    crate::managed_agents::validate_role_context(&role).expect("a valid role context");
}

#[test]
fn the_gate_hold_needs_both_variables() {
    assert_eq!(
        gate_hold_from(Some("1"), Some("employee_created")),
        Some(HireStep::EmployeeCreated)
    );
    assert_eq!(gate_hold_from(None, Some("employee_created")), None);
    assert_eq!(gate_hold_from(Some("1"), None), None);
    assert_eq!(gate_hold_from(Some("1"), Some("hello_posted")), None);
}

#[test]
fn hire_input_is_validated_and_ignores_a_time_zone() {
    let hire = validated_input(&input()).expect("valid");
    assert_eq!(hire.hire_id.to_string(), HIRE);
    let mut bad = input();
    bad.hire_id = "not-a-uuid".into();
    assert!(validated_input(&bad).is_err());
    let mut bad = input();
    bad.home_channel_id = "general".into();
    assert!(validated_input(&bad).is_err());

    let sent: HireCompleteInput = serde_json::from_value(serde_json::json!({
        "relayUrl": RELAY,
        "hireId": HIRE,
        "personaId": "builtin:test-employee",
        "displayName": "Gate Tester",
        "homeChannelId": CHANNEL,
        "timeZone": "Europe/London"
    }))
    .expect("the overview shape still parses");
    let entry = new_entry(&validated_input(&sent).expect("valid"), ZONE.to_string(), 1);
    assert_eq!(
        entry.time_zone, ZONE,
        "the host's time zone wins over the caller's"
    );
}

#[test]
fn the_journal_keeps_unfinished_hires_and_prunes_old_finished_ones() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(JOURNAL_FILE);
    assert_eq!(
        hire_journal::load(&path).expect("missing"),
        HireJournal::default()
    );

    let now = 1_800_000_000;
    let mut journal = HireJournal::default();
    let unfinished = HireJournalEntry {
        hire_id: Uuid::new_v4(),
        updated_at: now - 90 * 24 * 3_600,
        ..fresh_entry()
    };
    journal.upsert(unfinished.clone());
    for age in 0..205 {
        journal.upsert(HireJournalEntry {
            hire_id: Uuid::new_v4(),
            step: HireStep::Started,
            updated_at: now - age * 3_600,
            ..fresh_entry()
        });
    }
    journal.upsert(HireJournalEntry {
        hire_id: Uuid::new_v4(),
        step: HireStep::Started,
        updated_at: now - 31 * 24 * 3_600,
        ..fresh_entry()
    });
    journal.prune(now);
    assert!(journal.entries.len() <= 200);
    assert!(
        journal.find(unfinished.hire_id).is_some(),
        "an unfinished hire is never pruned"
    );
    assert_eq!(journal.unfinished(&unfinished.relay_url).len(), 1);

    hire_journal::save(&path, &journal).expect("save");
    assert_eq!(hire_journal::load(&path).expect("load"), journal);
    std::fs::write(&path, b"not json").expect("write");
    assert!(
        hire_journal::load(&path).is_err(),
        "an unreadable journal is never read as empty"
    );
}

#[test]
fn launch_restore_waits_for_the_hire_and_only_its_journal_can_start_it_first() {
    let pubkey = "ab".repeat(32);
    let mut entry = fresh_entry();
    entry.employee_pubkey = Some(pubkey.clone());
    entry.replay_floor = Some(123);
    let record: crate::managed_agents::ManagedAgentRecord =
        serde_json::from_value(serde_json::json!({
            "pubkey": pubkey,
            "name": "Gate Tester",
            "relay_url": RELAY,
            "acp_command": "", "agent_command": "", "agent_args": [], "mcp_command": "",
            "turn_timeout_seconds": 0, "parallelism": 1, "system_prompt": null,
            "created_at": "", "updated_at": "", "last_started_at": null,
            "last_stopped_at": null, "last_exit_code": null, "last_error": null,
            "start_on_app_launch": true,
            "role_context": role_context_for(&view_of(&World::approved()), None)
        }))
        .expect("record");
    for step in [
        HireStep::Opened,
        HireStep::EmployeeCreated,
        HireStep::EmployeeAttached,
        HireStep::EmployeeInChannel,
        HireStep::OwnerInChannel,
        HireStep::HelloPosted,
        HireStep::Completed,
        HireStep::Started,
    ] {
        entry.step = step;
        let journal = HireJournal {
            entries: vec![entry.clone()],
        };
        assert_eq!(
            journal.allows_restore(&record, RELAY),
            step == HireStep::Started,
            "{step:?}"
        );
        assert_eq!(
            journal
                .require_first_start(&record, RELAY, Some(123))
                .is_ok(),
            step >= HireStep::Completed,
            "{step:?}"
        );
        assert_eq!(
            journal.require_first_start(&record, RELAY, None).is_ok(),
            step == HireStep::Started,
            "{step:?}"
        );
        assert!(journal.allows_restore(&record, "wss://another.example"));
    }
}
