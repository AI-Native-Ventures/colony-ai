use super::*;

const PLAYBOOK_ID: &str = "3c2f6a0e-1b7d-4f0a-9c55-7a1d0e4b2f11";
const JOB_ID: &str = "9d41b7c2-5e0a-4a63-8f12-c0a7e3d5b6a4";

fn hex(c: char) -> String {
    c.to_string().repeat(64)
}

fn function_owner(function: CompanyFunction) -> PlanStepOwner {
    PlanStepOwner {
        kind: PlanOwnerKind::Function,
        function: Some(function),
        agent_pubkey: None,
        worker_type: None,
    }
}

fn founder_owner() -> PlanStepOwner {
    PlanStepOwner {
        kind: PlanOwnerKind::Owner,
        function: None,
        agent_pubkey: None,
        worker_type: None,
    }
}

fn worker_owner() -> PlanStepOwner {
    PlanStepOwner {
        kind: PlanOwnerKind::Worker,
        function: None,
        agent_pubkey: None,
        worker_type: Some("site_build".to_owned()),
    }
}

fn step(id: &str, owner: PlanStepOwner) -> PlaybookStep {
    PlaybookStep {
        step_id: id.to_owned(),
        title: format!("Step {id}"),
        detail: None,
        owner,
        inputs: vec!["signed agreement".to_owned()],
        outputs: vec!["brief".to_owned()],
        tools: vec!["WhatsApp".to_owned()],
        approval_point: None,
    }
}

fn gated(id: &str, owner: PlanStepOwner, kind: PlanApprovalKind) -> PlaybookStep {
    PlaybookStep {
        approval_point: Some(PlanApprovalPoint {
            kind,
            prompt: "You approve before it runs".to_owned(),
        }),
        ..step(id, owner)
    }
}

/// brief (Operations) -> approval (you, gated) -> launch (Operations).
fn delivery() -> PlaybookContent {
    PlaybookContent {
        title: "Delivery playbook".to_owned(),
        summary: "How Horizon Labs delivers a website.".to_owned(),
        function: Some(CompanyFunction::Operations),
        steps: vec![
            step("brief", function_owner(CompanyFunction::Operations)),
            gated("approval", founder_owner(), PlanApprovalKind::Taste),
            gated(
                "launch",
                function_owner(CompanyFunction::Operations),
                PlanApprovalKind::Other,
            ),
        ],
    }
}

fn delivery_v2() -> PlaybookContent {
    let mut content = delivery();
    content.steps.push(step(
        "review",
        function_owner(CompanyFunction::CustomerSuccess),
    ));
    content
}

fn action(kind: PlaybookActionKind) -> PlaybookAction {
    PlaybookAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        playbook_id: PLAYBOOK_ID.to_owned(),
        kind,
        content: None,
        change_summary: None,
        revision: None,
        note: None,
        expected_head_event_id: Some(hex('e')),
    }
}

fn propose_action(content: PlaybookContent) -> PlaybookAction {
    PlaybookAction {
        content: Some(content),
        expected_head_event_id: None,
        ..action(PlaybookActionKind::Propose)
    }
}

fn change_action(content: PlaybookContent) -> PlaybookAction {
    PlaybookAction {
        content: Some(content),
        change_summary: Some("Add a review step".to_owned()),
        ..action(PlaybookActionKind::ProposeChange)
    }
}

fn decide_action(kind: PlaybookActionKind, revision: u32) -> PlaybookAction {
    PlaybookAction {
        revision: Some(revision),
        ..action(kind)
    }
}

fn actor(role: PlanActorRole, key: char) -> PlanActor {
    PlanActor {
        pubkey: hex(key),
        role,
        led_functions: Vec::new(),
    }
}

fn scout() -> PlanActor {
    actor(PlanActorRole::ManagedAgent, 'a')
}

fn owner() -> PlanActor {
    actor(PlanActorRole::Admin, 'b')
}

fn member() -> PlanActor {
    actor(PlanActorRole::Member, 'd')
}

fn context(enabled: bool) -> PlanContext {
    PlanContext {
        now: 1_000,
        cofounder_enabled: enabled,
        action_event_id: hex('c'),
    }
}

fn apply(
    head: Option<&PlaybookHead>,
    action: &PlaybookAction,
    who: &PlanActor,
) -> Result<PlaybookHead, PlanError> {
    apply_playbook_action(head, action, who, &context(true))
}

fn proposed() -> PlaybookHead {
    apply(None, &propose_action(delivery()), &scout()).expect("propose")
}

fn active() -> PlaybookHead {
    apply(
        Some(&proposed()),
        &decide_action(PlaybookActionKind::Approve, 1),
        &owner(),
    )
    .expect("approve")
}

fn refusal(result: Result<PlaybookHead, PlanError>) -> PlanError {
    result.expect_err("the action should be refused")
}

// ── Playbook ────────────────────────────────────────────────────────────────

#[test]
fn an_agent_proposes_a_playbook_and_it_waits_for_the_owner() {
    let head = proposed();
    assert_eq!(head.status, PlaybookStatus::Proposed);
    assert_eq!(head.version, 0);
    assert!(head.current.is_none(), "nothing is approved yet");
    let pending = head.pending.as_ref().expect("pending");
    assert_eq!(pending.revision, 1);
    assert_eq!(pending.proposed_by_pubkey, hex('a'));
    validate_playbook_head(&head).expect("head is valid");
}

#[test]
fn a_plain_member_cannot_propose_a_playbook() {
    let error = refusal(apply(None, &propose_action(delivery()), &member()));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    assert!(error.message.contains("agent or the owner or an admin"));
}

#[test]
fn proposing_needs_co_founder_mode() {
    let error = refusal(apply_playbook_action(
        None,
        &propose_action(delivery()),
        &scout(),
        &context(false),
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    assert!(error.message.contains("co-founder mode is off"));
}

#[test]
fn only_the_owner_or_an_admin_approves_and_an_agent_never_does() {
    let head = proposed();
    let by_agent = refusal(apply(
        Some(&head),
        &decide_action(PlaybookActionKind::Approve, 1),
        &scout(),
    ));
    assert_eq!(by_agent.kind, PlanErrorKind::Forbidden);
    let by_member = refusal(apply(
        Some(&head),
        &decide_action(PlaybookActionKind::Approve, 1),
        &member(),
    ));
    assert_eq!(by_member.kind, PlanErrorKind::Forbidden);

    let approved = active();
    assert_eq!(approved.status, PlaybookStatus::Active);
    assert_eq!(approved.version, 1);
    assert_eq!(approved.current.as_ref(), Some(&delivery()));
    assert!(approved.pending.is_none());
    let record = approved.records.last().expect("record");
    assert_eq!(record.decision, PlaybookDecision::Approved);
    assert_eq!(record.version, 1);
    assert_eq!(record.actor_pubkey, hex('b'));
    assert_eq!(
        record.proposed_by_pubkey.as_deref(),
        Some(hex('a').as_str())
    );
    validate_playbook_head(&approved).expect("head is valid");
}

#[test]
fn approving_needs_co_founder_mode_but_rejecting_does_not() {
    let head = proposed();
    let approve = apply_playbook_action(
        Some(&head),
        &decide_action(PlaybookActionKind::Approve, 1),
        &owner(),
        &context(false),
    );
    assert_eq!(refusal(approve).kind, PlanErrorKind::Forbidden);
    let reject = apply_playbook_action(
        Some(&head),
        &decide_action(PlaybookActionKind::Reject, 1),
        &owner(),
        &context(false),
    )
    .expect("reject works with the mode off");
    assert_eq!(reject.status, PlaybookStatus::Rejected);
}

#[test]
fn approving_a_stale_revision_is_a_conflict() {
    let revised = apply(
        Some(&proposed()),
        &PlaybookAction {
            content: Some(delivery_v2()),
            ..action(PlaybookActionKind::Revise)
        },
        &scout(),
    )
    .expect("revise");
    assert_eq!(revised.pending.as_ref().expect("pending").revision, 2);
    let error = refusal(apply(
        Some(&revised),
        &decide_action(PlaybookActionKind::Approve, 1),
        &owner(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn a_change_waits_and_the_current_version_stays_until_the_owner_approves() {
    let waiting = apply(Some(&active()), &change_action(delivery_v2()), &scout()).expect("change");
    assert_eq!(waiting.version, 1, "still version 1");
    assert_eq!(waiting.current.as_ref(), Some(&delivery()));
    assert_eq!(waiting.status, PlaybookStatus::Active);
    let pending = waiting.pending.as_ref().expect("pending");
    assert_eq!(pending.change_summary.as_deref(), Some("Add a review step"));
    validate_playbook_head(&waiting).expect("valid");

    let approved = apply(
        Some(&waiting),
        &decide_action(PlaybookActionKind::Approve, 1),
        &owner(),
    )
    .expect("approve change");
    assert_eq!(approved.version, 2);
    assert_eq!(approved.current.as_ref(), Some(&delivery_v2()));
    assert!(approved.pending.is_none());
    let versions: Vec<u32> = approved
        .records
        .iter()
        .filter(|record| record.decision == PlaybookDecision::Approved)
        .map(|record| record.version)
        .collect();
    assert_eq!(versions, vec![1, 2]);
    assert_eq!(
        approved
            .records
            .last()
            .expect("record")
            .change_summary
            .as_deref(),
        Some("Add a review step")
    );
}

#[test]
fn a_second_change_cannot_pile_on_a_waiting_one() {
    let waiting = apply(Some(&active()), &change_action(delivery_v2()), &scout()).expect("change");
    let error = refusal(apply(
        Some(&waiting),
        &change_action(delivery_v2()),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn a_change_must_differ_from_the_current_version() {
    let error = refusal(apply(Some(&active()), &change_action(delivery()), &scout()));
    assert_eq!(error.kind, PlanErrorKind::Invalid);
}

#[test]
fn a_change_needs_an_approved_playbook_and_a_member_cannot_propose_one() {
    let error = refusal(apply(
        Some(&proposed()),
        &change_action(delivery_v2()),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
    let error = refusal(apply(
        Some(&active()),
        &change_action(delivery_v2()),
        &member(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
}

#[test]
fn rejecting_a_change_keeps_the_playbook_and_rejecting_a_first_proposal_ends_it() {
    let waiting = apply(Some(&active()), &change_action(delivery_v2()), &scout()).expect("change");
    let kept = apply(
        Some(&waiting),
        &decide_action(PlaybookActionKind::Reject, 1),
        &owner(),
    )
    .expect("reject change");
    assert_eq!(kept.status, PlaybookStatus::Active);
    assert_eq!(kept.version, 1);
    assert!(kept.pending.is_none());
    assert_eq!(
        kept.records.last().expect("record").decision,
        PlaybookDecision::Rejected
    );

    let ended = apply(
        Some(&proposed()),
        &decide_action(PlaybookActionKind::Reject, 1),
        &owner(),
    )
    .expect("reject first proposal");
    assert_eq!(ended.status, PlaybookStatus::Rejected);
    validate_playbook_head(&ended).expect("valid");
    let error = refusal(apply(Some(&ended), &change_action(delivery_v2()), &scout()));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn an_agent_cannot_reject_either() {
    let error = refusal(apply(
        Some(&proposed()),
        &decide_action(PlaybookActionKind::Reject, 1),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
}

#[test]
fn the_proposer_or_the_owner_withdraws_but_another_agent_does_not() {
    let head = proposed();
    let other_agent = actor(PlanActorRole::ManagedAgent, 'f');
    let error = refusal(apply(
        Some(&head),
        &action(PlaybookActionKind::Withdraw),
        &other_agent,
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    let withdrawn = apply(Some(&head), &action(PlaybookActionKind::Withdraw), &scout())
        .expect("proposer withdraws");
    assert_eq!(withdrawn.status, PlaybookStatus::Rejected);
    assert_eq!(
        withdrawn.records.last().expect("record").decision,
        PlaybookDecision::Withdrawn
    );
}

#[test]
fn revising_bumps_the_revision_and_an_owner_edit_is_recorded() {
    let revise = |who: &PlanActor, head: &PlaybookHead| {
        apply(
            Some(head),
            &PlaybookAction {
                content: Some(delivery_v2()),
                change_summary: Some("Added review".to_owned()),
                ..action(PlaybookActionKind::Revise)
            },
            who,
        )
    };
    let by_proposer = revise(&scout(), &proposed()).expect("proposer revises");
    assert_eq!(by_proposer.pending.as_ref().expect("pending").revision, 2);
    assert!(
        by_proposer.records.is_empty(),
        "the proposer's own edit is not a decision"
    );
    let by_owner = revise(&owner(), &proposed()).expect("owner revises");
    assert_eq!(
        by_owner.records.last().expect("record").decision,
        PlaybookDecision::Edited
    );
    let stranger = actor(PlanActorRole::ManagedAgent, 'f');
    assert_eq!(
        refusal(revise(&stranger, &proposed())).kind,
        PlanErrorKind::Forbidden
    );
    assert_eq!(
        refusal(revise(&member(), &proposed())).kind,
        PlanErrorKind::Forbidden
    );
}

#[test]
fn only_the_owner_writes_a_version_directly() {
    let edit = |who: &PlanActor| {
        apply(
            Some(&active()),
            &PlaybookAction {
                content: Some(delivery_v2()),
                ..action(PlaybookActionKind::Edit)
            },
            who,
        )
    };
    assert_eq!(refusal(edit(&scout())).kind, PlanErrorKind::Forbidden);
    assert_eq!(refusal(edit(&member())).kind, PlanErrorKind::Forbidden);
    let head = edit(&owner()).expect("owner edits");
    assert_eq!(head.version, 2);
    assert_eq!(head.current.as_ref(), Some(&delivery_v2()));
    assert_eq!(
        head.records.last().expect("record").decision,
        PlaybookDecision::Published
    );
}

#[test]
fn an_owner_edit_drops_a_waiting_change() {
    let waiting = apply(Some(&active()), &change_action(delivery_v2()), &scout()).expect("change");
    let head = apply(
        Some(&waiting),
        &PlaybookAction {
            content: Some(delivery_v2()),
            ..action(PlaybookActionKind::Edit)
        },
        &owner(),
    )
    .expect("edit");
    assert!(head.pending.is_none());
    validate_playbook_head(&head).expect("valid");
}

#[test]
fn only_the_owner_archives_and_an_archived_playbook_takes_no_changes() {
    let error = refusal(apply(
        Some(&active()),
        &action(PlaybookActionKind::Archive),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    let archived = apply(
        Some(&active()),
        &action(PlaybookActionKind::Archive),
        &owner(),
    )
    .expect("archive");
    assert_eq!(archived.status, PlaybookStatus::Archived);
    validate_playbook_head(&archived).expect("valid");
    let error = refusal(apply(
        Some(&archived),
        &change_action(delivery_v2()),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn a_worker_step_never_carries_an_outward_approval_point() {
    for kind in [PlanApprovalKind::Outreach, PlanApprovalKind::Spend] {
        let mut content = delivery();
        content.steps[0] = gated("brief", worker_owner(), kind);
        let error = refusal(apply(None, &propose_action(content), &scout()));
        assert_eq!(error.kind, PlanErrorKind::Invalid, "{kind:?}");
    }
    let mut content = delivery();
    content.steps[0] = gated("brief", worker_owner(), PlanApprovalKind::Taste);
    apply(None, &propose_action(content), &scout()).expect("a taste check is fine");
}

#[test]
fn playbook_content_rules() {
    let mut content = delivery();
    content.steps[1].step_id = "brief".to_owned();
    assert!(
        validate_playbook_content(&content).is_err(),
        "duplicate step ids"
    );
    let mut content = delivery();
    content.steps.clear();
    assert!(validate_playbook_content(&content).is_err(), "no steps");
    let mut content = delivery();
    content.steps = (0..=MAX_PLAYBOOK_STEPS)
        .map(|index| step(&format!("s{index}"), founder_owner()))
        .collect();
    assert!(
        validate_playbook_content(&content).is_err(),
        "too many steps"
    );
    let mut content = delivery();
    content.steps[0].inputs = vec!["x".to_owned(); MAX_PLAYBOOK_STEP_LISTED + 1];
    assert!(
        validate_playbook_content(&content).is_err(),
        "too many inputs"
    );
    let mut content = delivery();
    content.steps[0].owner = PlanStepOwner {
        kind: PlanOwnerKind::LeadAgent,
        function: None,
        agent_pubkey: None,
        worker_type: None,
    };
    assert!(
        validate_playbook_content(&content).is_err(),
        "lead agent names no agent"
    );
}

#[test]
fn playbook_json_refuses_unknown_keys() {
    let head = active();
    let mut value = serde_json::to_value(&head).expect("json");
    assert!(serde_json::from_value::<PlaybookHead>(value.clone()).is_ok());
    value["surprise"] = serde_json::json!(true);
    assert!(serde_json::from_value::<PlaybookHead>(value).is_err());
    let mut value = serde_json::to_value(action(PlaybookActionKind::Archive)).expect("json");
    value["surprise"] = serde_json::json!(true);
    assert!(serde_json::from_value::<PlaybookAction>(value).is_err());
}

#[test]
fn playbook_action_shapes() {
    // propose names no head; every other action names it.
    let mut bad = propose_action(delivery());
    bad.expected_head_event_id = Some(hex('e'));
    assert!(validate_playbook_action(&bad).is_err());
    let mut bad = action(PlaybookActionKind::Archive);
    bad.expected_head_event_id = None;
    assert!(validate_playbook_action(&bad).is_err());
    // A change needs its summary.
    let mut bad = change_action(delivery_v2());
    bad.change_summary = None;
    assert!(validate_playbook_action(&bad).is_err());
    // Approve carries a revision and nothing else.
    assert!(validate_playbook_action(&action(PlaybookActionKind::Approve)).is_err());
    let mut bad = decide_action(PlaybookActionKind::Approve, 1);
    bad.content = Some(delivery());
    assert!(validate_playbook_action(&bad).is_err());
}

#[test]
fn d_tags_tell_the_two_families_apart() {
    let playbook = playbook_d_tag(PLAYBOOK_ID).expect("d tag");
    let job = playbook_job_d_tag(JOB_ID).expect("d tag");
    assert_eq!(playbook, format!("company:playbook:{PLAYBOOK_ID}"));
    assert_eq!(job, format!("company:playbook-job:{JOB_ID}"));
    assert_eq!(
        playbook_record_kind(&playbook),
        Some(PlaybookRecordKind::Playbook)
    );
    assert_eq!(playbook_record_kind(&job), Some(PlaybookRecordKind::Job));
    assert_eq!(playbook_record_kind("company:plan:x"), None);
    assert!(validate_playbook_d_tag(&job, PLAYBOOK_ID).is_err());
    assert!(validate_playbook_job_d_tag(&playbook, JOB_ID).is_err());
    assert!(playbook_d_tag("not-a-uuid").is_err());
    assert!(playbook_job_d_tag(&PLAYBOOK_ID.to_uppercase()).is_err());
}

// ── Jobs ────────────────────────────────────────────────────────────────────

fn job_action(kind: JobActionKind) -> PlaybookJobAction {
    PlaybookJobAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        job_id: JOB_ID.to_owned(),
        kind,
        playbook_id: None,
        playbook_version: None,
        title: None,
        step_id: None,
        step_status: None,
        progress_label: None,
        hand_off_to: None,
        note: None,
        expected_head_event_id: Some(hex('e')),
    }
}

fn start_action() -> PlaybookJobAction {
    PlaybookJobAction {
        playbook_id: Some(PLAYBOOK_ID.to_owned()),
        title: Some("Plane Tree Guesthouse".to_owned()),
        expected_head_event_id: None,
        ..job_action(JobActionKind::Start)
    }
}

fn step_action(kind: JobActionKind, step_id: &str) -> PlaybookJobAction {
    PlaybookJobAction {
        step_id: Some(step_id.to_owned()),
        ..job_action(kind)
    }
}

fn update(step_id: &str, status: JobStepStatus) -> PlaybookJobAction {
    PlaybookJobAction {
        step_status: Some(status),
        ..step_action(JobActionKind::UpdateStep, step_id)
    }
}

fn apply_job(
    head: Option<&PlaybookJobHead>,
    action: &PlaybookJobAction,
    who: &PlanActor,
) -> Result<PlaybookJobHead, PlanError> {
    apply_job_action(head, Some(&active()), action, who, &context(true))
}

fn job_refusal(result: Result<PlaybookJobHead, PlanError>) -> PlanError {
    result.expect_err("the action should be refused")
}

fn started() -> PlaybookJobHead {
    apply_job(None, &start_action(), &scout()).expect("start")
}

/// Runs the job until the founder's gated step is the current one.
fn at_founder_step() -> PlaybookJobHead {
    let job = started();
    let job = apply_job(
        Some(&job),
        &update("brief", JobStepStatus::InProgress),
        &scout(),
    )
    .expect("in progress");
    apply_job(Some(&job), &update("brief", JobStepStatus::Done), &scout()).expect("done")
}

#[test]
fn a_job_copies_the_approved_version_and_starts_at_the_first_step() {
    let job = started();
    assert_eq!(job.status, JobStatus::Running);
    assert_eq!(job.playbook_version, 1);
    assert_eq!(job.playbook_title, "Delivery playbook");
    assert_eq!(job.title, "Plane Tree Guesthouse");
    assert_eq!(job.current_step_id.as_deref(), Some("brief"));
    assert_eq!(job.steps.len(), 3);
    assert!(job
        .steps
        .iter()
        .all(|step| step.status == JobStepStatus::Pending));
    assert_eq!(
        job.steps[1].approval_point,
        delivery().steps[1].approval_point
    );
    assert_eq!(job.started_by_pubkey, hex('a'));
    validate_job_head(&job).expect("valid");
}

#[test]
fn a_job_keeps_the_version_it_started_from() {
    // The playbook moves to version 2 afterwards; the job still shows version 1 steps.
    let job = started();
    let v2 = apply(
        Some(&apply(Some(&active()), &change_action(delivery_v2()), &scout()).expect("change")),
        &decide_action(PlaybookActionKind::Approve, 1),
        &owner(),
    )
    .expect("v2");
    assert_eq!(v2.version, 2);
    assert_eq!(job.playbook_version, 1);
    assert_eq!(job.steps.len(), 3);
    let second = apply_job_action(
        None,
        Some(&v2),
        &PlaybookJobAction {
            playbook_version: Some(1),
            ..start_action()
        },
        &scout(),
        &context(true),
    );
    assert_eq!(job_refusal(second).kind, PlanErrorKind::Conflict);
}

#[test]
fn only_an_agent_or_the_owner_starts_a_job_and_only_with_the_mode_on() {
    let error = job_refusal(apply_job(None, &start_action(), &member()));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    let error = job_refusal(apply_job_action(
        None,
        Some(&active()),
        &start_action(),
        &scout(),
        &context(false),
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    apply_job(None, &start_action(), &owner()).expect("the owner starts a job too");
}

#[test]
fn a_job_needs_an_approved_playbook() {
    for playbook in [Some(proposed()), None] {
        let error = job_refusal(apply_job_action(
            None,
            playbook.as_ref(),
            &start_action(),
            &scout(),
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Conflict);
    }
    let archived = apply(
        Some(&active()),
        &action(PlaybookActionKind::Archive),
        &owner(),
    )
    .expect("archive");
    let error = job_refusal(apply_job_action(
        None,
        Some(&archived),
        &start_action(),
        &scout(),
        &context(true),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn steps_run_in_order() {
    let error = job_refusal(apply_job(
        Some(&started()),
        &update("launch", JobStepStatus::InProgress),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
    assert!(error.message.contains("not the current step"));
}

#[test]
fn an_approval_point_blocks_the_step_until_the_owner_approves() {
    let job = at_founder_step();
    assert_eq!(job.current_step_id.as_deref(), Some("approval"));

    // Not started and not asked: the founder's own step cannot just run.
    let error = job_refusal(apply_job(
        Some(&job),
        &update("approval", JobStepStatus::InProgress),
        &owner(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
    assert!(error.message.contains("waits for the owner's approval"));

    // Asking moves it to waiting; it still cannot run.
    let asked = apply_job(
        Some(&job),
        &step_action(JobActionKind::RequestStepApproval, "approval"),
        &owner(),
    )
    .expect("ask");
    assert_eq!(asked.steps[1].status, JobStepStatus::WaitingApproval);
    let error = job_refusal(apply_job(
        Some(&asked),
        &update("approval", JobStepStatus::InProgress),
        &owner(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);

    // An agent never approves, whatever it leads.
    let error = job_refusal(apply_job(
        Some(&asked),
        &step_action(JobActionKind::ApproveStep, "approval"),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);

    // The owner approves; now it runs, and the decision is on record.
    let approved = apply_job(
        Some(&asked),
        &step_action(JobActionKind::ApproveStep, "approval"),
        &owner(),
    )
    .expect("approve");
    assert_eq!(approved.steps[1].status, JobStepStatus::Approved);
    assert_eq!(approved.approvals.len(), 1);
    assert_eq!(approved.approvals[0].decision, JobDecision::Approved);
    assert_eq!(approved.approvals[0].actor_pubkey, hex('b'));
    let running = apply_job(
        Some(&approved),
        &update("approval", JobStepStatus::InProgress),
        &owner(),
    )
    .expect("runs after approval");
    assert_eq!(running.steps[1].status, JobStepStatus::InProgress);
    validate_job_head(&running).expect("valid");
}

#[test]
fn a_gated_step_asked_for_by_its_agent_waits_and_is_not_started_by_it() {
    // launch is gated and owned by Operations; its agent asks, then must wait.
    let mut job = at_founder_step();
    job = apply_job(
        Some(&job),
        &step_action(JobActionKind::ApproveStep, "approval"),
        &owner(),
    )
    .expect("approve");
    job = apply_job(
        Some(&job),
        &update("approval", JobStepStatus::Done),
        &owner(),
    )
    .expect("done");
    assert_eq!(job.current_step_id.as_deref(), Some("launch"));
    let error = job_refusal(apply_job(
        Some(&job),
        &update("launch", JobStepStatus::InProgress),
        &scout(),
    ));
    assert!(error.message.contains("waits for the owner's approval"));
    let asked = apply_job(
        Some(&job),
        &step_action(JobActionKind::RequestStepApproval, "launch"),
        &scout(),
    )
    .expect("ask");
    assert_eq!(asked.steps[2].status, JobStepStatus::WaitingApproval);
    assert_eq!(asked.steps[2].status_at, 1_000);
    // Asking twice is refused.
    let error = job_refusal(apply_job(
        Some(&asked),
        &step_action(JobActionKind::RequestStepApproval, "launch"),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn rejecting_an_approval_point_skips_the_step_and_moves_on() {
    let job = at_founder_step();
    let rejected = apply_job(
        Some(&job),
        &PlaybookJobAction {
            note: Some("Not this design".to_owned()),
            ..step_action(JobActionKind::RejectStep, "approval")
        },
        &owner(),
    )
    .expect("reject");
    assert_eq!(rejected.steps[1].status, JobStepStatus::Skipped);
    assert_eq!(rejected.approvals[0].decision, JobDecision::Rejected);
    assert_eq!(rejected.current_step_id.as_deref(), Some("launch"));
}

#[test]
fn a_step_without_an_approval_point_has_nothing_to_approve() {
    let error = job_refusal(apply_job(
        Some(&started()),
        &step_action(JobActionKind::ApproveStep, "brief"),
        &owner(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
    let error = job_refusal(apply_job(
        Some(&started()),
        &step_action(JobActionKind::RequestStepApproval, "brief"),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn the_job_completes_when_every_step_ended() {
    let mut job = at_founder_step();
    job = apply_job(
        Some(&job),
        &step_action(JobActionKind::ApproveStep, "approval"),
        &owner(),
    )
    .expect("approve");
    job = apply_job(
        Some(&job),
        &update("approval", JobStepStatus::Done),
        &owner(),
    )
    .expect("done");
    job = apply_job(
        Some(&job),
        &step_action(JobActionKind::ApproveStep, "launch"),
        &owner(),
    )
    .expect("approve launch");
    assert_eq!(job.status, JobStatus::Running);
    job = apply_job(Some(&job), &update("launch", JobStepStatus::Done), &scout()).expect("done");
    assert_eq!(job.status, JobStatus::Completed);
    assert!(job.current_step_id.is_none());
    assert_eq!(job.ended_at, Some(1_000));
    assert_eq!(job.approvals.len(), 2);
    validate_job_head(&job).expect("valid");
    let error = job_refusal(apply_job(
        Some(&job),
        &job_action(JobActionKind::Cancel),
        &owner(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn a_blocked_step_needs_a_reason_and_can_resume() {
    let error = apply_job(
        Some(&started()),
        &update("brief", JobStepStatus::Blocked),
        &scout(),
    );
    assert_eq!(job_refusal(error).kind, PlanErrorKind::Invalid);
    let blocked = apply_job(
        Some(&started()),
        &PlaybookJobAction {
            note: Some("Waiting for the logo".to_owned()),
            ..update("brief", JobStepStatus::Blocked)
        },
        &scout(),
    )
    .expect("block");
    assert_eq!(blocked.steps[0].status, JobStepStatus::Blocked);
    assert_eq!(blocked.current_step_id.as_deref(), Some("brief"));
    validate_job_head(&blocked).expect("valid");
    let resumed = apply_job(
        Some(&blocked),
        &update("brief", JobStepStatus::InProgress),
        &scout(),
    )
    .expect("resume");
    assert_eq!(resumed.steps[0].status, JobStepStatus::InProgress);
}

#[test]
fn a_gated_step_cannot_be_blocked_around_its_approval() {
    let job = at_founder_step();
    let error = job_refusal(apply_job(
        Some(&job),
        &PlaybookJobAction {
            note: Some("stuck".to_owned()),
            ..update("approval", JobStepStatus::Blocked)
        },
        &owner(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn a_progress_label_rides_along_with_an_update() {
    let job = apply_job(
        Some(&started()),
        &PlaybookJobAction {
            progress_label: Some("Round 1 of 2".to_owned()),
            ..update("brief", JobStepStatus::InProgress)
        },
        &scout(),
    )
    .expect("update");
    assert_eq!(job.steps[0].progress_label.as_deref(), Some("Round 1 of 2"));
}

#[test]
fn only_the_doer_moves_a_step() {
    let stranger = actor(PlanActorRole::ManagedAgent, 'f');
    let error = job_refusal(apply_job(
        Some(&started()),
        &update("brief", JobStepStatus::InProgress),
        &stranger,
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    // The lead of the step's function may.
    let lead = PlanActor {
        led_functions: vec![CompanyFunction::Operations],
        ..stranger.clone()
    };
    apply_job(
        Some(&started()),
        &update("brief", JobStepStatus::InProgress),
        &lead,
    )
    .expect("the function lead moves its step");
    // A step for the founder is only moved by a person with authority.
    let error = job_refusal(apply_job(
        Some(&at_founder_step()),
        &step_action(JobActionKind::RequestStepApproval, "approval"),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
}

#[test]
fn a_step_can_be_handed_to_another_function_and_the_new_lead_runs_it() {
    let job = started();
    let handed = apply_job(
        Some(&job),
        &PlaybookJobAction {
            hand_off_to: Some(function_owner(CompanyFunction::CustomerSuccess)),
            note: Some("They own the client chat".to_owned()),
            ..step_action(JobActionKind::HandOff, "brief")
        },
        &scout(),
    )
    .expect("hand off");
    assert_eq!(
        handed.steps[0].owner,
        function_owner(CompanyFunction::CustomerSuccess)
    );
    assert_eq!(handed.handoffs.len(), 1);
    assert_eq!(
        handed.handoffs[0].from,
        function_owner(CompanyFunction::Operations)
    );
    assert_eq!(handed.handoffs[0].by_pubkey, hex('a'));
    validate_job_head(&handed).expect("valid");
    let customer_success_lead = PlanActor {
        led_functions: vec![CompanyFunction::CustomerSuccess],
        ..actor(PlanActorRole::ManagedAgent, 'f')
    };
    apply_job(
        Some(&handed),
        &update("brief", JobStepStatus::InProgress),
        &customer_success_lead,
    )
    .expect("the new owner's lead runs it");
}

#[test]
fn a_hand_off_keeps_the_hard_rules() {
    let job = at_founder_step();
    let job = apply_job(
        Some(&job),
        &PlaybookJobAction {
            hand_off_to: Some(function_owner(CompanyFunction::Sales)),
            ..step_action(JobActionKind::HandOff, "launch")
        },
        &scout(),
    )
    .expect("hand to sales");
    // A step gated for outreach cannot be handed to a worker.
    let mut content = delivery();
    content.steps[2] = gated(
        "launch",
        function_owner(CompanyFunction::Operations),
        PlanApprovalKind::Outreach,
    );
    let mut playbook = active();
    playbook.current = Some(content);
    let started = apply_job_action(
        None,
        Some(&playbook),
        &start_action(),
        &scout(),
        &context(true),
    )
    .expect("start");
    let error = job_refusal(apply_job_action(
        Some(&started),
        Some(&playbook),
        &PlaybookJobAction {
            hand_off_to: Some(worker_owner()),
            ..step_action(JobActionKind::HandOff, "launch")
        },
        &scout(),
        &context(true),
    ));
    assert_eq!(error.kind, PlanErrorKind::Invalid);
    assert_eq!(job.steps[2].owner, function_owner(CompanyFunction::Sales));
}

#[test]
fn a_hand_off_to_the_same_owner_or_of_an_ended_step_is_refused() {
    let same = job_refusal(apply_job(
        Some(&started()),
        &PlaybookJobAction {
            hand_off_to: Some(function_owner(CompanyFunction::Operations)),
            ..step_action(JobActionKind::HandOff, "brief")
        },
        &scout(),
    ));
    assert_eq!(same.kind, PlanErrorKind::Conflict);
    let job = at_founder_step();
    let ended = job_refusal(apply_job(
        Some(&job),
        &PlaybookJobAction {
            hand_off_to: Some(function_owner(CompanyFunction::Sales)),
            ..step_action(JobActionKind::HandOff, "brief")
        },
        &scout(),
    ));
    assert_eq!(ended.kind, PlanErrorKind::Conflict);
}

#[test]
fn the_starter_or_the_owner_cancels_and_a_stranger_does_not() {
    let stranger = actor(PlanActorRole::ManagedAgent, 'f');
    let error = job_refusal(apply_job(
        Some(&started()),
        &job_action(JobActionKind::Cancel),
        &stranger,
    ));
    assert_eq!(error.kind, PlanErrorKind::Forbidden);
    let cancelled = apply_job(
        Some(&started()),
        &job_action(JobActionKind::Cancel),
        &scout(),
    )
    .expect("starter cancels");
    assert_eq!(cancelled.status, JobStatus::Cancelled);
    assert!(cancelled.current_step_id.is_none());
    assert_eq!(cancelled.ended_at, Some(1_000));
    validate_job_head(&cancelled).expect("valid");
    let error = job_refusal(apply_job(
        Some(&cancelled),
        &update("brief", JobStepStatus::InProgress),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn work_in_flight_finishes_with_the_mode_off() {
    let job = started();
    let off = context(false);
    let moved = apply_job_action(
        Some(&job),
        Some(&active()),
        &update("brief", JobStepStatus::InProgress),
        &scout(),
        &off,
    )
    .expect("step updates still work");
    assert_eq!(moved.steps[0].status, JobStepStatus::InProgress);
}

#[test]
fn a_job_cannot_be_started_twice_or_updated_before_it_exists() {
    let error = job_refusal(apply_job(Some(&started()), &start_action(), &scout()));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
    let error = job_refusal(apply_job(
        None,
        &update("brief", JobStepStatus::InProgress),
        &scout(),
    ));
    assert_eq!(error.kind, PlanErrorKind::Conflict);
}

#[test]
fn job_action_shapes() {
    let mut bad = start_action();
    bad.expected_head_event_id = Some(hex('e'));
    assert!(validate_job_action(&bad).is_err());
    let mut bad = start_action();
    bad.title = None;
    assert!(validate_job_action(&bad).is_err());
    let mut bad = update("brief", JobStepStatus::Pending);
    bad.expected_head_event_id = Some(hex('e'));
    assert!(validate_job_action(&bad).is_err(), "pending is not a move");
    let mut bad = update("brief", JobStepStatus::Done);
    bad.expected_head_event_id = None;
    assert!(validate_job_action(&bad).is_err());
    let mut bad = step_action(JobActionKind::ApproveStep, "brief");
    bad.step_status = Some(JobStepStatus::Done);
    assert!(validate_job_action(&bad).is_err());
    let mut bad = job_action(JobActionKind::HandOff);
    bad.step_id = Some("brief".to_owned());
    assert!(
        validate_job_action(&bad).is_err(),
        "hand_off needs handOffTo"
    );
    let mut bad = job_action(JobActionKind::Cancel);
    bad.step_id = Some("brief".to_owned());
    assert!(validate_job_action(&bad).is_err());
    let mut value = serde_json::to_value(job_action(JobActionKind::Cancel)).expect("json");
    value["surprise"] = serde_json::json!(true);
    assert!(serde_json::from_value::<PlaybookJobAction>(value).is_err());
}

#[test]
fn a_job_head_with_the_wrong_current_step_is_invalid() {
    let mut job = started();
    job.current_step_id = Some("launch".to_owned());
    assert!(validate_job_head(&job).is_err());
    let mut job = started();
    job.status = JobStatus::Completed;
    assert!(validate_job_head(&job).is_err(), "steps have not ended");
    let mut job = started();
    job.steps[0].status = JobStepStatus::Blocked;
    assert!(validate_job_head(&job).is_err(), "blocked without a note");
}
