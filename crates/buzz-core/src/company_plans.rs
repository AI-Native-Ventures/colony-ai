//! Co-founder plans: a typed proposal the owner approves, edits or rejects.
//!
//! A plan is a separate company record (kind 30673 head, kind 47063 action),
//! not an ask category: a desktop that predates co-founder mode fails a whole
//! ask list on an unknown category, so plans live in their own kinds.
//!
//! One relay-signed head per plan (`company:plan:<uuid>`) holds the proposal,
//! the status of every step and an append-only approval record (who approved
//! or rejected what, and when).
//!
//! [`apply_plan_action`] is the single state machine. The relay broker calls
//! it after it has resolved the caller's role, so every rule that matters
//! (only an owner or admin approves, agents never approve, approval points
//! gate their steps, workers never spend) is testable here without a
//! database.
//!
//! A plan approval records the owner's intent. It never sends or pays by
//! itself: outreach and spending stay gated where Colony runs them (see
//! `docs/cofounder-hard-rules-audit.md`).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::company_functions::CompanyFunction;
use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored plan head (community-wide, one per plan).
pub const KIND_PLAN_HEAD: u32 = crate::kind::KIND_PLAN_HEAD;
/// Member plan proposal, decision or step update, brokered and community-wide.
pub const KIND_PLAN_ACTION: u32 = crate::kind::KIND_PLAN_ACTION;

const PLAN_D_TAG_PREFIX: &str = "company:plan:";

/// Most steps one plan may carry.
pub const MAX_PLAN_STEPS: usize = 24;
/// Longest plan title, in characters.
pub const MAX_PLAN_TITLE_CHARS: usize = 120;
/// Longest plan summary, in characters.
pub const MAX_PLAN_SUMMARY_CHARS: usize = 600;
/// Longest step title, in characters.
pub const MAX_STEP_TITLE_CHARS: usize = 160;
/// Longest step detail, in characters.
pub const MAX_STEP_DETAIL_CHARS: usize = 600;
/// Longest short label (cost, timing, target, tool, worker type), in characters.
pub const MAX_PLAN_LABEL_CHARS: usize = 80;
/// Longest note or reason, in characters.
pub const MAX_PLAN_NOTE_CHARS: usize = 500;
/// Most tools one step may name.
pub const MAX_STEP_TOOLS: usize = 6;
/// Most approval records one plan keeps.
pub const MAX_PLAN_APPROVALS: usize = 200;
/// Largest amount one step or plan budget may state, in minor currency units.
pub const MAX_PLAN_AMOUNT_CENTS: u64 = 100_000_000;

/// Lifecycle state of a plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    /// Waiting for the owner or an admin to approve, edit or reject.
    Proposed,
    /// Approved; steps run, pausing at approval points.
    Approved,
    /// Every step ended.
    Completed,
    /// The owner or an admin rejected the proposal.
    Rejected,
    /// Stopped by the proposer, the owner or an admin.
    Cancelled,
}

impl PlanStatus {
    /// A plan that is still waiting or running.
    pub const fn is_open(self) -> bool {
        matches!(self, PlanStatus::Proposed | PlanStatus::Approved)
    }
}

/// Lifecycle state of one step.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStepStatus {
    /// Not started.
    #[default]
    Pending,
    /// The step reached its approval point and waits for the owner.
    WaitingApproval,
    /// The owner approved the approval point; the step may run.
    Approved,
    /// The step is being worked.
    InProgress,
    /// The step finished.
    Done,
    /// The step was skipped or its approval point was rejected.
    Skipped,
    /// The step failed; the note says why.
    Failed,
}

impl PlanStepStatus {
    /// A step that will not change any more.
    pub const fn is_ended(self) -> bool {
        matches!(
            self,
            PlanStepStatus::Done | PlanStepStatus::Skipped | PlanStepStatus::Failed
        )
    }
}

/// What an approval point asks the owner to approve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanApprovalKind {
    /// Messages to people outside the company.
    Outreach,
    /// Spending money or credits.
    Spend,
    /// Designs, posts, websites and other branded work.
    Taste,
    /// Hiring an employee.
    Hire,
    /// Anything else the owner should see before it goes on.
    Other,
}

/// A point where the plan stops and waits for the owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanApprovalPoint {
    /// What is being approved.
    pub kind: PlanApprovalKind,
    /// One short line the owner reads, for example "You approve each batch".
    pub prompt: String,
}

/// Who does a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanOwnerKind {
    /// The lead of a company function slot.
    Function,
    /// A named employee.
    LeadAgent,
    /// A nameless worker run started by an employee.
    Worker,
    /// A person: a prepared human-only step.
    Owner,
}

/// The one who does a step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanStepOwner {
    /// Which kind of doer.
    pub kind: PlanOwnerKind,
    /// Required for `function`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<CompanyFunction>,
    /// Required for `lead_agent`; optional for `worker` (the employee that spawns it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_pubkey: Option<String>,
    /// Required for `worker`, for example `research` or `site_build`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worker_type: Option<String>,
}

/// One step of a plan, with its live state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanStep {
    /// Stable id inside the plan, `[a-z0-9_-]`, 1 to 32 characters.
    pub step_id: String,
    /// What happens, 1 to 160 characters.
    pub title: String,
    /// Optional detail, at most 600 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Who does it.
    pub owner: PlanStepOwner,
    /// Tools the step uses, for example `Discovery`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,
    /// Cost as the owner reads it: "Free", "Covered by subscription", "About R0.62 per new chat".
    pub cost_label: String,
    /// Estimated cost in minor units of the plan currency; 0 when free.
    #[serde(default)]
    pub cost_estimate_cents: u64,
    /// Timing as the owner reads it: "2 to 4 Nov", "Ongoing".
    pub when_label: String,
    /// Where the step waits for the owner, if it does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_point: Option<PlanApprovalPoint>,
    /// Current state; `pending` in every proposal (and when omitted).
    #[serde(default)]
    pub status: PlanStepStatus,
    /// Latest note, for example why a step failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// What a proposal says; the current copy lives in the head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanProposal {
    /// Plan title, 1 to 120 characters.
    pub title: String,
    /// What the plan is for, at most 600 characters.
    #[serde(default)]
    pub summary: String,
    /// The function the plan belongs to, if one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<CompanyFunction>,
    /// ISO 4217 code of every amount in the plan, for example `ZAR`.
    pub currency: String,
    /// Spend that approving the plan itself covers, for steps with no approval point.
    #[serde(default)]
    pub budget_cents: u64,
    /// When the owner should decide, in Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decide_by: Option<i64>,
    /// What the plan aims at, for example "5 won".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_label: Option<String>,
    /// Overall timing, for example "1 to 30 November".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing_label: Option<String>,
    /// Ordered steps, 1 to 24.
    pub steps: Vec<PlanStep>,
}

/// What an approval record decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanDecision {
    /// Approved.
    Approved,
    /// Rejected.
    Rejected,
    /// Edited a proposal someone else wrote.
    Edited,
    /// Stopped a plan.
    Cancelled,
}

/// What an approval record covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanApprovalScope {
    /// The whole plan.
    Plan,
    /// One step's approval point.
    Step,
}

/// Who decided what and when. Append-only inside the head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanApprovalRecord {
    /// Whole plan or one step.
    pub scope: PlanApprovalScope,
    /// The step, for `step` scope.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    /// What was decided.
    pub decision: PlanDecision,
    /// Owner or admin who decided, 64 lowercase hex characters.
    pub actor_pubkey: String,
    /// Decision time in Unix seconds.
    pub at: i64,
    /// Plan revision the decision applied to.
    pub revision: u32,
    /// Reason or note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Action event that carried the decision.
    pub action_event_id: String,
}

/// What a plan action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanActionKind {
    /// Propose a new plan.
    Propose,
    /// Replace a proposed plan's content.
    Revise,
    /// Approve the plan (owner or admin).
    Approve,
    /// Reject the plan (owner or admin).
    Reject,
    /// Stop a plan.
    Cancel,
    /// Ask the owner to approve a step's approval point.
    RequestStepApproval,
    /// Approve a step's approval point (owner or admin).
    ApproveStep,
    /// Reject a step's approval point (owner or admin); the step is skipped.
    RejectStep,
    /// Move a step along.
    UpdateStep,
}

/// Member-signed plan write (kind 47063).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable plan UUID in lowercase hyphenated form.
    pub plan_id: String,
    /// What to do.
    pub kind: PlanActionKind,
    /// The full proposal for `propose` and `revise`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<PlanProposal>,
    /// The revision being decided, for `approve` and `reject`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u32>,
    /// The step, for step actions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    /// The new step status, for `update_step`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_status: Option<PlanStepStatus>,
    /// Reason or note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Exact current head event id; omitted only for `propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

/// Relay-authored current plan (kind 30673).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable plan UUID.
    pub plan_id: String,
    /// Lifecycle state.
    pub status: PlanStatus,
    /// Starts at 1 and grows by one on every revision.
    pub revision: u32,
    /// The current proposal with live step state.
    pub plan: PlanProposal,
    /// Who proposed it.
    pub proposed_by_pubkey: String,
    /// When it was proposed, in Unix seconds.
    pub proposed_at: i64,
    /// Who made the last change.
    pub updated_by_pubkey: String,
    /// When the last change happened, in Unix seconds.
    pub updated_at: i64,
    /// Every decision, oldest first.
    #[serde(default)]
    pub approvals: Vec<PlanApprovalRecord>,
    /// Action event that produced this head.
    pub source_action_event_id: String,
}

/// Build the community-wide d-tag of a plan.
pub fn plan_d_tag(plan_id: &str) -> Result<String, CompanyRecordError> {
    if !is_canonical_uuid(plan_id) {
        return Err(CompanyRecordError::Invalid(
            "planId must be a lowercase UUID",
        ));
    }
    Ok(format!("{PLAN_D_TAG_PREFIX}{plan_id}"))
}

/// Check a d-tag against a plan id.
pub fn validate_plan_d_tag(d_tag: &str, plan_id: &str) -> Result<(), CompanyRecordError> {
    if d_tag == plan_d_tag(plan_id)? {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

fn is_canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value)
        .map(|id| !id.is_nil() && id.hyphenated().to_string() == value)
        .unwrap_or(false)
}

fn text_within(value: &str, max_chars: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max_chars
}

fn optional_text_within(value: &Option<String>, max_chars: usize) -> bool {
    value
        .as_ref()
        .is_none_or(|text| text_within(text, max_chars))
}

fn is_step_id(value: &str) -> bool {
    let length = value.chars().count();
    (1..=32).contains(&length)
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn validate_owner(owner: &PlanStepOwner) -> Result<(), CompanyRecordError> {
    let agent_ok = owner.agent_pubkey.as_deref().is_none_or(is_hex_id);
    if !agent_ok {
        return Err(CompanyRecordError::Invalid(
            "a step owner's agentPubkey must be 64 lowercase hex characters",
        ));
    }
    match owner.kind {
        PlanOwnerKind::Function => {
            if owner.function.is_none()
                || owner.agent_pubkey.is_some()
                || owner.worker_type.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "a function step owner names only a function",
                ));
            }
        }
        PlanOwnerKind::LeadAgent => {
            if owner.agent_pubkey.is_none()
                || owner.function.is_some()
                || owner.worker_type.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "a lead agent step owner names only an agentPubkey",
                ));
            }
        }
        PlanOwnerKind::Worker => {
            let type_ok = owner
                .worker_type
                .as_deref()
                .is_some_and(|value| text_within(value, MAX_PLAN_LABEL_CHARS));
            if !type_ok || owner.function.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "a worker step owner names a workerType",
                ));
            }
        }
        PlanOwnerKind::Owner => {
            if owner.function.is_some()
                || owner.agent_pubkey.is_some()
                || owner.worker_type.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "an owner step names no function, agent or worker type",
                ));
            }
        }
    }
    Ok(())
}

fn validate_step(step: &PlanStep) -> Result<(), CompanyRecordError> {
    if !is_step_id(&step.step_id) {
        return Err(CompanyRecordError::Invalid(
            "stepId is 1 to 32 characters of a-z, 0-9, - and _",
        ));
    }
    if !text_within(&step.title, MAX_STEP_TITLE_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a step title is 1 to 160 characters",
        ));
    }
    if !optional_text_within(&step.detail, MAX_STEP_DETAIL_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a step detail is 1 to 600 characters",
        ));
    }
    validate_owner(&step.owner)?;
    if step.tools.len() > MAX_STEP_TOOLS
        || step
            .tools
            .iter()
            .any(|tool| !text_within(tool, MAX_PLAN_LABEL_CHARS))
    {
        return Err(CompanyRecordError::Invalid(
            "a step names at most 6 tools of 1 to 80 characters",
        ));
    }
    if !text_within(&step.cost_label, MAX_PLAN_LABEL_CHARS)
        || !text_within(&step.when_label, MAX_PLAN_LABEL_CHARS)
    {
        return Err(CompanyRecordError::Invalid(
            "a step costLabel and whenLabel are 1 to 80 characters",
        ));
    }
    if step.cost_estimate_cents > MAX_PLAN_AMOUNT_CENTS {
        return Err(CompanyRecordError::Invalid(
            "a step costEstimateCents is out of range",
        ));
    }
    if let Some(point) = &step.approval_point {
        if !text_within(&point.prompt, MAX_PLAN_LABEL_CHARS) {
            return Err(CompanyRecordError::Invalid(
                "an approval point prompt is 1 to 80 characters",
            ));
        }
    }
    if !optional_text_within(&step.note, MAX_PLAN_NOTE_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a step note is 1 to 500 characters",
        ));
    }
    // Hard rule 4: workers only produce material for their employee.
    if step.owner.kind == PlanOwnerKind::Worker && step.title.is_empty() {
        if step.cost_estimate_cents > 0 {
            return Err(CompanyRecordError::Invalid(
                "a worker step cannot spend: workers never spend",
            ));
        }
        if step.approval_point.as_ref().is_some_and(|point| {
            matches!(
                point.kind,
                PlanApprovalKind::Outreach | PlanApprovalKind::Spend
            )
        }) {
            return Err(CompanyRecordError::Invalid(
                "a worker step cannot send or spend: workers never take outward actions",
            ));
        }
    }
    Ok(())
}

/// Validate a proposal's content. `require_pending` is true for a new or
/// revised proposal, whose steps must all start `pending` with no note.
pub fn validate_plan_proposal(
    plan: &PlanProposal,
    require_pending: bool,
) -> Result<(), CompanyRecordError> {
    if !text_within(&plan.title, MAX_PLAN_TITLE_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a plan title is 1 to 120 characters",
        ));
    }
    if plan.summary.chars().count() > MAX_PLAN_SUMMARY_CHARS {
        return Err(CompanyRecordError::Invalid(
            "a plan summary is at most 600 characters",
        ));
    }
    if plan.currency.len() != 3 || !plan.currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(CompanyRecordError::Invalid(
            "currency is a three-letter uppercase code",
        ));
    }
    if plan.budget_cents > MAX_PLAN_AMOUNT_CENTS {
        return Err(CompanyRecordError::Invalid("budgetCents is out of range"));
    }
    if plan.decide_by.is_some_and(|value| value <= 0) {
        return Err(CompanyRecordError::Invalid("decideBy must be a Unix time"));
    }
    if !optional_text_within(&plan.target_label, MAX_PLAN_LABEL_CHARS)
        || !optional_text_within(&plan.timing_label, MAX_PLAN_LABEL_CHARS)
    {
        return Err(CompanyRecordError::Invalid(
            "targetLabel and timingLabel are 1 to 80 characters",
        ));
    }
    if plan.steps.is_empty() || plan.steps.len() > MAX_PLAN_STEPS {
        return Err(CompanyRecordError::Invalid("a plan has 1 to 24 steps"));
    }
    let mut ungated_spend: u64 = 0;
    for (index, step) in plan.steps.iter().enumerate() {
        validate_step(step)?;
        if plan.steps[..index]
            .iter()
            .any(|earlier| earlier.step_id == step.step_id)
        {
            return Err(CompanyRecordError::Invalid("stepId values must be unique"));
        }
        if require_pending && (step.status != PlanStepStatus::Pending || step.note.is_some()) {
            return Err(CompanyRecordError::Invalid(
                "every step of a proposal starts pending with no note",
            ));
        }
        if step.cost_estimate_cents > 0 && step.approval_point.is_none() {
            ungated_spend = ungated_spend.saturating_add(step.cost_estimate_cents);
        }
    }
    // Hard rule 2: a step that spends is either gated by its own approval
    // point or covered by a budget the owner sees and approves with the plan.
    if ungated_spend > plan.budget_cents {
        return Err(CompanyRecordError::Invalid(
            "steps that spend need an approval point or a plan budget that covers them",
        ));
    }
    Ok(())
}

fn validate_optional_note(note: &Option<String>) -> Result<(), CompanyRecordError> {
    if optional_text_within(note, MAX_PLAN_NOTE_CHARS) {
        Ok(())
    } else {
        Err(CompanyRecordError::Invalid("a note is 1 to 500 characters"))
    }
}

/// Validate the shape of a plan action. State rules live in [`apply_plan_action`].
pub fn validate_plan_action(action: &PlanAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    plan_d_tag(&action.plan_id)?;
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(CompanyRecordError::Invalid(
                "expectedHeadEventId must be a 64-character event id",
            ));
        }
    }
    if let Some(step_id) = action.step_id.as_deref() {
        if !is_step_id(step_id) {
            return Err(CompanyRecordError::Invalid(
                "stepId is 1 to 32 characters of a-z, 0-9, - and _",
            ));
        }
    }
    validate_optional_note(&action.note)?;
    let needs_expected = !matches!(action.kind, PlanActionKind::Propose);
    if needs_expected != action.expected_head_event_id.is_some() {
        return Err(CompanyRecordError::Invalid(
            "propose names no expected head; every other action names the exact head",
        ));
    }
    let has_plan = action.plan.is_some();
    let has_revision = action.revision.is_some();
    let has_step = action.step_id.is_some();
    let has_status = action.step_status.is_some();
    match action.kind {
        PlanActionKind::Propose | PlanActionKind::Revise => {
            if !has_plan || has_revision || has_step || has_status || action.note.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "propose and revise carry only a plan",
                ));
            }
            if let Some(plan) = &action.plan {
                validate_plan_proposal(plan, true)?;
            }
        }
        PlanActionKind::Approve | PlanActionKind::Reject => {
            if has_plan || !has_revision || has_step || has_status {
                return Err(CompanyRecordError::Invalid(
                    "approve and reject carry only the revision (and a note)",
                ));
            }
        }
        PlanActionKind::Cancel => {
            if has_plan || has_revision || has_step || has_status {
                return Err(CompanyRecordError::Invalid(
                    "cancel carries only an optional note",
                ));
            }
        }
        PlanActionKind::RequestStepApproval
        | PlanActionKind::ApproveStep
        | PlanActionKind::RejectStep => {
            if has_plan || has_revision || !has_step || has_status {
                return Err(CompanyRecordError::Invalid(
                    "step approval actions carry only a stepId (and a note)",
                ));
            }
        }
        PlanActionKind::UpdateStep => {
            if has_plan || has_revision || !has_step {
                return Err(CompanyRecordError::Invalid(
                    "update_step carries a stepId and a stepStatus",
                ));
            }
            match action.step_status {
                Some(
                    PlanStepStatus::InProgress
                    | PlanStepStatus::Done
                    | PlanStepStatus::Skipped
                    | PlanStepStatus::Failed,
                ) => {}
                _ => {
                    return Err(CompanyRecordError::Invalid(
                        "update_step moves a step to in_progress, done, skipped or failed",
                    ));
                }
            }
            if action.step_status == Some(PlanStepStatus::Failed) && action.note.is_none() {
                return Err(CompanyRecordError::Invalid(
                    "a failed step needs a note that says why",
                ));
            }
        }
    }
    Ok(())
}

/// Validate a relay-authored plan head.
pub fn validate_plan_head(head: &PlanHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    plan_d_tag(&head.plan_id)?;
    if !is_hex_id(&head.proposed_by_pubkey)
        || !is_hex_id(&head.updated_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || head.proposed_at <= 0
        || head.updated_at <= 0
        || head.revision == 0
    {
        return Err(CompanyRecordError::Invalid(
            "plan head identity, revision and time must be valid",
        ));
    }
    if head.approvals.len() > MAX_PLAN_APPROVALS {
        return Err(CompanyRecordError::Invalid(
            "a plan keeps at most 200 approval records",
        ));
    }
    for record in &head.approvals {
        let step_ok = match record.scope {
            PlanApprovalScope::Plan => record.step_id.is_none(),
            PlanApprovalScope::Step => record.step_id.as_deref().is_some_and(is_step_id),
        };
        if !step_ok
            || !is_hex_id(&record.actor_pubkey)
            || !is_hex_id(&record.action_event_id)
            || record.at <= 0
            || record.revision == 0
            || !optional_text_within(&record.note, MAX_PLAN_NOTE_CHARS)
        {
            return Err(CompanyRecordError::Invalid(
                "an approval record needs a valid scope, actor, time and revision",
            ));
        }
    }
    validate_plan_proposal(&head.plan, false)
}

// ── State machine ───────────────────────────────────────────────────────────

/// Why a plan action was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanErrorKind {
    /// The action is malformed.
    Invalid,
    /// The caller may not do this.
    Forbidden,
    /// The plan is not in a state that allows this.
    Conflict,
}

/// A refused plan action with the plain reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanError {
    /// Class of refusal.
    pub kind: PlanErrorKind,
    /// Plain reason shown to the caller.
    pub message: String,
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

fn invalid(message: impl Into<String>) -> PlanError {
    PlanError {
        kind: PlanErrorKind::Invalid,
        message: message.into(),
    }
}

fn forbidden(message: impl Into<String>) -> PlanError {
    PlanError {
        kind: PlanErrorKind::Forbidden,
        message: message.into(),
    }
}

fn conflict(message: impl Into<String>) -> PlanError {
    PlanError {
        kind: PlanErrorKind::Conflict,
        message: message.into(),
    }
}

/// What the relay knows about the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanActorRole {
    /// A person who is the community owner or an admin.
    Admin,
    /// Any other community member.
    Member,
    /// A managed agent, whatever role row it has: agents never approve.
    ManagedAgent,
}

/// The caller of a plan action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanActor {
    /// Caller pubkey, 64 lowercase hex characters.
    pub pubkey: String,
    /// Caller role.
    pub role: PlanActorRole,
    /// Functions whose slot this caller leads.
    pub led_functions: Vec<CompanyFunction>,
}

/// Facts the relay supplies for one action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanContext {
    /// Relay time in Unix seconds.
    pub now: i64,
    /// Whether co-founder mode is on for the company right now.
    pub cofounder_enabled: bool,
    /// Id of the action event being applied.
    pub action_event_id: String,
}

fn require_cofounder(context: &PlanContext, what: &str) -> Result<(), PlanError> {
    if context.cofounder_enabled {
        Ok(())
    } else {
        Err(forbidden(format!(
            "co-founder mode is off for this company, so {what}"
        )))
    }
}

fn require_admin(actor: &PlanActor, what: &str) -> Result<(), PlanError> {
    if actor.role == PlanActorRole::Admin {
        Ok(())
    } else {
        Err(forbidden(format!("only the owner or an admin can {what}")))
    }
}

fn find_step_index(head: &PlanHead, step_id: &str) -> Result<usize, PlanError> {
    head.plan
        .steps
        .iter()
        .position(|step| step.step_id == step_id)
        .ok_or_else(|| invalid(format!("the plan has no step {step_id}")))
}

fn actor_can_run_step(actor: &PlanActor, head: &PlanHead, step: &PlanStep) -> bool {
    if actor.role == PlanActorRole::Admin {
        return true;
    }
    // A step for a person is only ever moved by a person with authority.
    if step.owner.kind == PlanOwnerKind::Owner {
        return false;
    }
    if actor.pubkey == head.proposed_by_pubkey {
        return true;
    }
    if step.owner.agent_pubkey.as_deref() == Some(actor.pubkey.as_str()) {
        return true;
    }
    step.owner
        .function
        .is_some_and(|function| actor.led_functions.contains(&function))
}

fn push_record(
    head: &mut PlanHead,
    scope: PlanApprovalScope,
    step_id: Option<String>,
    decision: PlanDecision,
    actor: &PlanActor,
    note: Option<String>,
    context: &PlanContext,
) -> Result<(), PlanError> {
    if head.approvals.len() >= MAX_PLAN_APPROVALS {
        return Err(conflict("this plan's approval record is full"));
    }
    head.approvals.push(PlanApprovalRecord {
        scope,
        step_id,
        decision,
        actor_pubkey: actor.pubkey.clone(),
        at: context.now,
        revision: head.revision,
        note,
        action_event_id: context.action_event_id.clone(),
    });
    Ok(())
}

fn step_transition_allowed(step: &PlanStep, to: PlanStepStatus) -> bool {
    let gated = step.approval_point.is_some();
    match (step.status, to) {
        (PlanStepStatus::Pending, PlanStepStatus::InProgress) => !gated,
        (PlanStepStatus::Approved, PlanStepStatus::InProgress) => true,
        (
            PlanStepStatus::InProgress | PlanStepStatus::Approved,
            PlanStepStatus::Done | PlanStepStatus::Failed,
        ) => true,
        // A prepared human step is done by the person without an in-progress hop.
        (PlanStepStatus::Pending, PlanStepStatus::Done) => {
            !gated && step.owner.kind == PlanOwnerKind::Owner
        }
        (
            PlanStepStatus::Pending
            | PlanStepStatus::WaitingApproval
            | PlanStepStatus::Approved
            | PlanStepStatus::InProgress,
            PlanStepStatus::Skipped,
        ) => true,
        _ => false,
    }
}

/// Apply one plan action to the current head and return the next head.
///
/// The caller (the relay broker) has already verified the signature, resolved
/// `actor` and checked that `action.expected_head_event_id` names the stored
/// head. This function owns every other rule.
pub fn apply_plan_action(
    current: Option<&PlanHead>,
    action: &PlanAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<PlanHead, PlanError> {
    validate_plan_action(action).map_err(|error| invalid(error.to_string()))?;
    let Some(head) = current else {
        return propose(action, actor, context);
    };
    if action.kind == PlanActionKind::Propose {
        return Err(conflict("a plan with this id already exists"));
    }
    if head.plan_id != action.plan_id {
        return Err(invalid("the action names a different plan than the head"));
    }
    if !head.status.is_open() {
        return Err(conflict("this plan has already ended"));
    }
    let mut next = head.clone();
    match action.kind {
        PlanActionKind::Propose => return Err(conflict("a plan with this id already exists")),
        PlanActionKind::Revise => revise(&mut next, action, actor, context)?,
        PlanActionKind::Approve => approve(&mut next, action, actor, context)?,
        PlanActionKind::Reject => reject(&mut next, action, actor, context)?,
        PlanActionKind::Cancel => cancel(&mut next, action, actor, context)?,
        PlanActionKind::RequestStepApproval => request_step_approval(&mut next, action, actor)?,
        PlanActionKind::ApproveStep | PlanActionKind::RejectStep => {
            decide_step(&mut next, action, actor, context)?
        }
        PlanActionKind::UpdateStep => update_step(&mut next, action, actor)?,
    }
    next.updated_by_pubkey = actor.pubkey.clone();
    next.updated_at = context.now;
    next.source_action_event_id = context.action_event_id.clone();
    if next.status == PlanStatus::Approved
        && next.plan.steps.iter().all(|step| step.status.is_ended())
    {
        next.status = PlanStatus::Completed;
    }
    Ok(next)
}

fn propose(
    action: &PlanAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<PlanHead, PlanError> {
    if action.kind != PlanActionKind::Propose {
        return Err(conflict("this plan does not exist"));
    }
    require_cofounder(context, "plans cannot be proposed")?;
    let plan = action
        .plan
        .clone()
        .ok_or_else(|| invalid("propose needs a plan"))?;
    Ok(PlanHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        plan_id: action.plan_id.clone(),
        status: PlanStatus::Proposed,
        revision: 1,
        plan,
        proposed_by_pubkey: actor.pubkey.clone(),
        proposed_at: context.now,
        updated_by_pubkey: actor.pubkey.clone(),
        updated_at: context.now,
        approvals: Vec::new(),
        source_action_event_id: context.action_event_id.clone(),
    })
}

fn revise(
    head: &mut PlanHead,
    action: &PlanAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    if head.status != PlanStatus::Proposed {
        return Err(conflict("only a proposed plan can be revised"));
    }
    require_cofounder(context, "plans cannot be revised")?;
    let is_proposer = actor.pubkey == head.proposed_by_pubkey;
    if !is_proposer && actor.role != PlanActorRole::Admin {
        return Err(forbidden(
            "only the proposer, the owner or an admin can revise a plan",
        ));
    }
    let plan = action
        .plan
        .clone()
        .ok_or_else(|| invalid("revise needs a plan"))?;
    head.plan = plan;
    head.revision = head.revision.saturating_add(1);
    if !is_proposer {
        push_record(
            head,
            PlanApprovalScope::Plan,
            None,
            PlanDecision::Edited,
            actor,
            None,
            context,
        )?;
    }
    Ok(())
}

fn approve(
    head: &mut PlanHead,
    action: &PlanAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_admin(actor, "approve a plan")?;
    if head.status != PlanStatus::Proposed {
        return Err(conflict("only a proposed plan can be approved"));
    }
    require_cofounder(context, "new plans cannot be approved")?;
    check_revision(head, action)?;
    head.status = PlanStatus::Approved;
    push_record(
        head,
        PlanApprovalScope::Plan,
        None,
        PlanDecision::Approved,
        actor,
        action.note.clone(),
        context,
    )
}

fn reject(
    head: &mut PlanHead,
    action: &PlanAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_admin(actor, "reject a plan")?;
    if head.status != PlanStatus::Proposed {
        return Err(conflict(
            "only a proposed plan can be rejected; cancel a running plan instead",
        ));
    }
    check_revision(head, action)?;
    head.status = PlanStatus::Rejected;
    push_record(
        head,
        PlanApprovalScope::Plan,
        None,
        PlanDecision::Rejected,
        actor,
        action.note.clone(),
        context,
    )
}

fn check_revision(head: &PlanHead, action: &PlanAction) -> Result<(), PlanError> {
    if action.revision == Some(head.revision) {
        Ok(())
    } else {
        Err(conflict(format!(
            "the plan changed since you looked: it is now revision {}",
            head.revision
        )))
    }
}

fn cancel(
    head: &mut PlanHead,
    action: &PlanAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    let is_proposer = actor.pubkey == head.proposed_by_pubkey;
    if !is_proposer && actor.role != PlanActorRole::Admin {
        return Err(forbidden(
            "only the proposer, the owner or an admin can cancel a plan",
        ));
    }
    head.status = PlanStatus::Cancelled;
    push_record(
        head,
        PlanApprovalScope::Plan,
        None,
        PlanDecision::Cancelled,
        actor,
        action.note.clone(),
        context,
    )
}

fn request_step_approval(
    head: &mut PlanHead,
    action: &PlanAction,
    actor: &PlanActor,
) -> Result<(), PlanError> {
    require_approved(head)?;
    let step_id = action.step_id.as_deref().unwrap_or_default();
    let index = find_step_index(head, step_id)?;
    let allowed = actor_can_run_step(actor, head, &head.plan.steps[index]);
    let step = &mut head.plan.steps[index];
    if !allowed {
        return Err(forbidden("you are not the doer of this step"));
    }
    if step.approval_point.is_none() {
        return Err(conflict("this step has no approval point"));
    }
    if step.status != PlanStepStatus::Pending {
        return Err(conflict("only a pending step can ask for approval"));
    }
    step.status = PlanStepStatus::WaitingApproval;
    if action.note.is_some() {
        step.note = action.note.clone();
    }
    Ok(())
}

fn decide_step(
    head: &mut PlanHead,
    action: &PlanAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    let approving = action.kind == PlanActionKind::ApproveStep;
    require_admin(
        actor,
        if approving {
            "approve a step"
        } else {
            "reject a step"
        },
    )?;
    require_approved(head)?;
    let step_id = action.step_id.clone().unwrap_or_default();
    let index = find_step_index(head, &step_id)?;
    let step = &mut head.plan.steps[index];
    if step.approval_point.is_none() {
        return Err(conflict("this step has no approval point"));
    }
    if !matches!(
        step.status,
        PlanStepStatus::Pending | PlanStepStatus::WaitingApproval
    ) {
        return Err(conflict(
            "only a step that has not started can be approved or rejected",
        ));
    }
    step.status = if approving {
        PlanStepStatus::Approved
    } else {
        PlanStepStatus::Skipped
    };
    if action.note.is_some() {
        step.note = action.note.clone();
    }
    push_record(
        head,
        PlanApprovalScope::Step,
        Some(step_id),
        if approving {
            PlanDecision::Approved
        } else {
            PlanDecision::Rejected
        },
        actor,
        action.note.clone(),
        context,
    )
}

fn update_step(
    head: &mut PlanHead,
    action: &PlanAction,
    actor: &PlanActor,
) -> Result<(), PlanError> {
    require_approved(head)?;
    let step_id = action.step_id.as_deref().unwrap_or_default();
    let index = find_step_index(head, step_id)?;
    let allowed = actor_can_run_step(actor, head, &head.plan.steps[index]);
    let step = &mut head.plan.steps[index];
    if !allowed {
        return Err(forbidden("you are not the doer of this step"));
    }
    let to = action
        .step_status
        .ok_or_else(|| invalid("update_step needs a stepStatus"))?;
    if !step_transition_allowed(step, to) {
        return Err(conflict(
            match (step.status, step.approval_point.is_some()) {
                (PlanStepStatus::Pending, true) | (PlanStepStatus::WaitingApproval, _) => {
                    "this step waits for the owner's approval before it can run"
                }
                _ => "that step cannot move to that state from where it is",
            },
        ));
    }
    step.status = to;
    if action.note.is_some() {
        step.note = action.note.clone();
    }
    Ok(())
}

fn require_approved(head: &PlanHead) -> Result<(), PlanError> {
    if head.status == PlanStatus::Approved {
        Ok(())
    } else {
        Err(conflict("the plan is not approved yet"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAN_ID: &str = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";

    fn hex(c: char) -> String {
        c.to_string().repeat(64)
    }

    fn step(id: &str) -> PlanStep {
        PlanStep {
            step_id: id.to_owned(),
            title: "Find 60 guesthouses".to_owned(),
            detail: None,
            owner: PlanStepOwner {
                kind: PlanOwnerKind::Function,
                function: Some(CompanyFunction::Sales),
                agent_pubkey: None,
                worker_type: None,
            },
            tools: vec!["Discovery".to_owned()],
            cost_label: "Covered by subscription".to_owned(),
            cost_estimate_cents: 0,
            when_label: "2 to 4 Nov".to_owned(),
            approval_point: None,
            status: PlanStepStatus::Pending,
            note: None,
        }
    }

    fn gated_step(id: &str) -> PlanStep {
        PlanStep {
            approval_point: Some(PlanApprovalPoint {
                kind: PlanApprovalKind::Outreach,
                prompt: "You approve each batch".to_owned(),
            }),
            ..step(id)
        }
    }

    fn proposal(steps: Vec<PlanStep>) -> PlanProposal {
        PlanProposal {
            title: "Get 5 clients in November".to_owned(),
            summary: "Goal for Sales.".to_owned(),
            function: Some(CompanyFunction::Sales),
            currency: "ZAR".to_owned(),
            budget_cents: 0,
            decide_by: None,
            target_label: Some("5 won".to_owned()),
            timing_label: Some("1 to 30 November".to_owned()),
            steps,
        }
    }

    fn action(kind: PlanActionKind) -> PlanAction {
        PlanAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            plan_id: PLAN_ID.to_owned(),
            kind,
            plan: None,
            revision: None,
            step_id: None,
            step_status: None,
            note: None,
            expected_head_event_id: Some(hex('e')),
        }
    }

    fn propose_action(steps: Vec<PlanStep>) -> PlanAction {
        PlanAction {
            plan: Some(proposal(steps)),
            expected_head_event_id: None,
            ..action(PlanActionKind::Propose)
        }
    }

    fn actor(role: PlanActorRole, key: char) -> PlanActor {
        PlanActor {
            pubkey: hex(key),
            role,
            led_functions: Vec::new(),
        }
    }

    fn context(enabled: bool) -> PlanContext {
        PlanContext {
            now: 1_000,
            cofounder_enabled: enabled,
            action_event_id: hex('c'),
        }
    }

    fn proposed(steps: Vec<PlanStep>) -> PlanHead {
        apply_plan_action(
            None,
            &propose_action(steps),
            &actor(PlanActorRole::ManagedAgent, 'a'),
            &context(true),
        )
        .expect("propose")
    }

    fn approved(steps: Vec<PlanStep>) -> PlanHead {
        let head = proposed(steps);
        let approve = PlanAction {
            revision: Some(1),
            ..action(PlanActionKind::Approve)
        };
        apply_plan_action(
            Some(&head),
            &approve,
            &actor(PlanActorRole::Admin, 'b'),
            &context(true),
        )
        .expect("approve")
    }

    fn refusal(result: Result<PlanHead, PlanError>) -> PlanError {
        result.expect_err("expected a refusal")
    }

    #[test]
    fn plan_d_tags_need_a_canonical_uuid() {
        assert_eq!(
            plan_d_tag(PLAN_ID).as_deref(),
            Ok("company:plan:7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10")
        );
        assert!(plan_d_tag("7F0C3C1E-5B1E-4D52-9A55-3D1F2B6A8C10").is_err());
        assert!(plan_d_tag("not-a-uuid").is_err());
        assert!(validate_plan_d_tag("company:plan:other", PLAN_ID).is_err());
    }

    #[test]
    fn plan_action_rejects_unknown_fields() {
        let json = serde_json::json!({
            "schemaVersion": 1, "planId": PLAN_ID, "kind": "cancel",
            "expectedHeadEventId": hex('e'), "surprise": true
        });
        assert!(serde_json::from_value::<PlanAction>(json).is_err());
    }

    #[test]
    fn a_plan_is_only_proposed_while_cofounder_mode_is_on() {
        let error = refusal(apply_plan_action(
            None,
            &propose_action(vec![step("find")]),
            &actor(PlanActorRole::ManagedAgent, 'a'),
            &context(false),
        ));
        assert_eq!(error.kind, PlanErrorKind::Forbidden);
        assert!(error.message.contains("co-founder mode is off"));
    }

    #[test]
    fn a_new_plan_starts_proposed_at_revision_one_with_no_approvals() {
        let head = proposed(vec![step("find")]);
        assert_eq!(head.status, PlanStatus::Proposed);
        assert_eq!(head.revision, 1);
        assert!(head.approvals.is_empty());
        assert_eq!(head.proposed_by_pubkey, hex('a'));
        validate_plan_head(&head).expect("head is valid");
    }

    #[test]
    fn a_managed_agent_can_never_approve_even_with_an_admin_role_row() {
        let head = proposed(vec![step("find")]);
        let approve = PlanAction {
            revision: Some(1),
            ..action(PlanActionKind::Approve)
        };
        for role in [PlanActorRole::ManagedAgent, PlanActorRole::Member] {
            let error = refusal(apply_plan_action(
                Some(&head),
                &approve,
                &actor(role, 'a'),
                &context(true),
            ));
            assert_eq!(error.kind, PlanErrorKind::Forbidden);
            assert!(error.message.contains("only the owner or an admin"));
        }
    }

    #[test]
    fn an_admin_approval_is_recorded_with_who_when_and_revision() {
        let head = approved(vec![step("find")]);
        assert_eq!(head.status, PlanStatus::Approved);
        assert_eq!(head.approvals.len(), 1);
        let record = &head.approvals[0];
        assert_eq!(record.decision, PlanDecision::Approved);
        assert_eq!(record.scope, PlanApprovalScope::Plan);
        assert_eq!(record.actor_pubkey, hex('b'));
        assert_eq!(record.at, 1_000);
        assert_eq!(record.revision, 1);
        validate_plan_head(&head).expect("head is valid");
    }

    #[test]
    fn approving_a_stale_revision_conflicts() {
        let head = proposed(vec![step("find")]);
        let revise = PlanAction {
            plan: Some(proposal(vec![step("find"), step("send")])),
            ..action(PlanActionKind::Revise)
        };
        let revised = apply_plan_action(
            Some(&head),
            &revise,
            &actor(PlanActorRole::Admin, 'b'),
            &context(true),
        )
        .expect("admin edits");
        assert_eq!(revised.revision, 2);
        assert_eq!(revised.approvals.len(), 1);
        assert_eq!(revised.approvals[0].decision, PlanDecision::Edited);

        let stale = PlanAction {
            revision: Some(1),
            ..action(PlanActionKind::Approve)
        };
        let error = refusal(apply_plan_action(
            Some(&revised),
            &stale,
            &actor(PlanActorRole::Admin, 'b'),
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Conflict);
    }

    #[test]
    fn the_proposer_revises_without_an_approval_record_and_a_stranger_cannot() {
        let head = proposed(vec![step("find")]);
        let revise = PlanAction {
            plan: Some(proposal(vec![step("find"), step("send")])),
            ..action(PlanActionKind::Revise)
        };
        let revised = apply_plan_action(
            Some(&head),
            &revise,
            &actor(PlanActorRole::ManagedAgent, 'a'),
            &context(true),
        )
        .expect("proposer revises");
        assert_eq!(revised.revision, 2);
        assert!(revised.approvals.is_empty());
        let error = refusal(apply_plan_action(
            Some(&head),
            &revise,
            &actor(PlanActorRole::ManagedAgent, 'd'),
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Forbidden);
    }

    #[test]
    fn rejecting_ends_the_plan_and_nothing_moves_after() {
        let head = proposed(vec![step("find")]);
        let reject = PlanAction {
            revision: Some(1),
            note: Some("Not this month".to_owned()),
            ..action(PlanActionKind::Reject)
        };
        let rejected = apply_plan_action(
            Some(&head),
            &reject,
            &actor(PlanActorRole::Admin, 'b'),
            &context(true),
        )
        .expect("reject");
        assert_eq!(rejected.status, PlanStatus::Rejected);
        assert_eq!(rejected.approvals[0].decision, PlanDecision::Rejected);
        let again = PlanAction {
            revision: Some(1),
            ..action(PlanActionKind::Approve)
        };
        let error = refusal(apply_plan_action(
            Some(&rejected),
            &again,
            &actor(PlanActorRole::Admin, 'b'),
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Conflict);
    }

    #[test]
    fn switching_off_stops_new_approvals_but_approved_work_finishes() {
        let proposed_head = proposed(vec![step("find")]);
        let approve = PlanAction {
            revision: Some(1),
            ..action(PlanActionKind::Approve)
        };
        let error = refusal(apply_plan_action(
            Some(&proposed_head),
            &approve,
            &actor(PlanActorRole::Admin, 'b'),
            &context(false),
        ));
        assert_eq!(error.kind, PlanErrorKind::Forbidden);

        let running = approved(vec![step("find")]);
        let start = PlanAction {
            step_id: Some("find".to_owned()),
            step_status: Some(PlanStepStatus::InProgress),
            ..action(PlanActionKind::UpdateStep)
        };
        let started = apply_plan_action(
            Some(&running),
            &start,
            &actor(PlanActorRole::ManagedAgent, 'a'),
            &context(false),
        )
        .expect("approved work in flight still runs");
        assert_eq!(started.plan.steps[0].status, PlanStepStatus::InProgress);
    }

    #[test]
    fn steps_do_not_move_before_the_plan_is_approved() {
        let head = proposed(vec![step("find")]);
        let start = PlanAction {
            step_id: Some("find".to_owned()),
            step_status: Some(PlanStepStatus::InProgress),
            ..action(PlanActionKind::UpdateStep)
        };
        let error = refusal(apply_plan_action(
            Some(&head),
            &start,
            &actor(PlanActorRole::ManagedAgent, 'a'),
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Conflict);
    }

    #[test]
    fn a_gated_step_cannot_start_until_the_owner_approves_its_point() {
        let head = approved(vec![gated_step("send")]);
        let start = PlanAction {
            step_id: Some("send".to_owned()),
            step_status: Some(PlanStepStatus::InProgress),
            ..action(PlanActionKind::UpdateStep)
        };
        let agent = actor(PlanActorRole::ManagedAgent, 'a');
        let error = refusal(apply_plan_action(
            Some(&head),
            &start,
            &agent,
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Conflict);

        let request = PlanAction {
            step_id: Some("send".to_owned()),
            ..action(PlanActionKind::RequestStepApproval)
        };
        let waiting =
            apply_plan_action(Some(&head), &request, &agent, &context(true)).expect("agent asks");
        assert_eq!(
            waiting.plan.steps[0].status,
            PlanStepStatus::WaitingApproval
        );

        let error = refusal(apply_plan_action(
            Some(&waiting),
            &start,
            &agent,
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Conflict);

        let approve_step = PlanAction {
            step_id: Some("send".to_owned()),
            ..action(PlanActionKind::ApproveStep)
        };
        let error = refusal(apply_plan_action(
            Some(&waiting),
            &approve_step,
            &agent,
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Forbidden);

        let owner = actor(PlanActorRole::Admin, 'b');
        let ready = apply_plan_action(Some(&waiting), &approve_step, &owner, &context(true))
            .expect("owner approves the point");
        assert_eq!(ready.plan.steps[0].status, PlanStepStatus::Approved);
        let record = ready.approvals.last().expect("step approval recorded");
        assert_eq!(record.scope, PlanApprovalScope::Step);
        assert_eq!(record.step_id.as_deref(), Some("send"));
        assert_eq!(record.decision, PlanDecision::Approved);

        let running = apply_plan_action(Some(&ready), &start, &agent, &context(true))
            .expect("now it may run");
        assert_eq!(running.plan.steps[0].status, PlanStepStatus::InProgress);
    }

    #[test]
    fn rejecting_a_step_point_skips_the_step_and_records_it() {
        let head = approved(vec![gated_step("send"), step("book")]);
        let reject_step = PlanAction {
            step_id: Some("send".to_owned()),
            note: Some("Wrong template".to_owned()),
            ..action(PlanActionKind::RejectStep)
        };
        let next = apply_plan_action(
            Some(&head),
            &reject_step,
            &actor(PlanActorRole::Admin, 'b'),
            &context(true),
        )
        .expect("owner rejects");
        assert_eq!(next.plan.steps[0].status, PlanStepStatus::Skipped);
        assert_eq!(
            next.approvals.last().unwrap().decision,
            PlanDecision::Rejected
        );
        assert_eq!(next.status, PlanStatus::Approved);
    }

    #[test]
    fn the_plan_completes_when_every_step_has_ended() {
        let mut head = approved(vec![step("find"), step("book")]);
        let agent = actor(PlanActorRole::ManagedAgent, 'a');
        for id in ["find", "book"] {
            for status in [PlanStepStatus::InProgress, PlanStepStatus::Done] {
                let update = PlanAction {
                    step_id: Some(id.to_owned()),
                    step_status: Some(status),
                    ..action(PlanActionKind::UpdateStep)
                };
                head = apply_plan_action(Some(&head), &update, &agent, &context(true))
                    .expect("update");
            }
        }
        assert_eq!(head.status, PlanStatus::Completed);
    }

    #[test]
    fn a_step_for_a_person_is_only_moved_by_the_owner_or_an_admin() {
        let human = PlanStep {
            owner: PlanStepOwner {
                kind: PlanOwnerKind::Owner,
                function: None,
                agent_pubkey: None,
                worker_type: None,
            },
            title: "Sign up for the e-sign tool".to_owned(),
            ..step("signup")
        };
        let head = approved(vec![human]);
        let done = PlanAction {
            step_id: Some("signup".to_owned()),
            step_status: Some(PlanStepStatus::Done),
            ..action(PlanActionKind::UpdateStep)
        };
        let error = refusal(apply_plan_action(
            Some(&head),
            &done,
            &actor(PlanActorRole::ManagedAgent, 'a'),
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Forbidden);
        let finished = apply_plan_action(
            Some(&head),
            &done,
            &actor(PlanActorRole::Admin, 'b'),
            &context(true),
        )
        .expect("the owner marks it done");
        assert_eq!(finished.status, PlanStatus::Completed);
    }

    #[test]
    fn the_lead_of_a_function_runs_that_functions_steps() {
        let head = approved(vec![step("find")]);
        let start = PlanAction {
            step_id: Some("find".to_owned()),
            step_status: Some(PlanStepStatus::InProgress),
            ..action(PlanActionKind::UpdateStep)
        };
        let stranger = actor(PlanActorRole::ManagedAgent, 'd');
        let error = refusal(apply_plan_action(
            Some(&head),
            &start,
            &stranger,
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Forbidden);
        let lead = PlanActor {
            led_functions: vec![CompanyFunction::Sales],
            ..stranger
        };
        assert!(apply_plan_action(Some(&head), &start, &lead, &context(true)).is_ok());
    }

    #[test]
    fn a_worker_step_can_never_spend_or_send() {
        let worker = |kind: Option<PlanApprovalKind>, cents: u64| PlanStep {
            owner: PlanStepOwner {
                kind: PlanOwnerKind::Worker,
                function: None,
                agent_pubkey: None,
                worker_type: Some("site_build".to_owned()),
            },
            cost_estimate_cents: cents,
            approval_point: kind.map(|kind| PlanApprovalPoint {
                kind,
                prompt: "You approve".to_owned(),
            }),
            ..step("build")
        };
        let mut plan = proposal(vec![worker(None, 500)]);
        plan.budget_cents = 10_000;
        assert!(validate_plan_proposal(&plan, true).is_err());
        assert!(validate_plan_proposal(
            &proposal(vec![worker(Some(PlanApprovalKind::Spend), 0)]),
            true
        )
        .is_err());
        assert!(validate_plan_proposal(
            &proposal(vec![worker(Some(PlanApprovalKind::Outreach), 0)]),
            true
        )
        .is_err());
        assert!(validate_plan_proposal(
            &proposal(vec![worker(Some(PlanApprovalKind::Taste), 0)]),
            true
        )
        .is_ok());
        assert!(validate_plan_proposal(&proposal(vec![worker(None, 0)]), true).is_ok());
    }

    #[test]
    fn spending_needs_an_approval_point_or_a_budget_that_covers_it() {
        let spending = PlanStep {
            cost_estimate_cents: 3_700,
            cost_label: "About R37".to_owned(),
            ..step("send")
        };
        assert!(validate_plan_proposal(&proposal(vec![spending.clone()]), true).is_err());
        let mut funded = proposal(vec![spending.clone()]);
        funded.budget_cents = 3_700;
        assert!(validate_plan_proposal(&funded, true).is_ok());
        let gated = PlanStep {
            approval_point: Some(PlanApprovalPoint {
                kind: PlanApprovalKind::Spend,
                prompt: "You approve the spend".to_owned(),
            }),
            ..spending
        };
        assert!(validate_plan_proposal(&proposal(vec![gated]), true).is_ok());
    }

    #[test]
    fn proposal_shape_rules() {
        assert!(validate_plan_proposal(&proposal(vec![]), true).is_err());
        assert!(validate_plan_proposal(&proposal(vec![step("a"), step("a")]), true).is_err());
        assert!(validate_plan_proposal(&proposal(vec![step("Bad Id")]), true).is_err());
        let started = PlanStep {
            status: PlanStepStatus::InProgress,
            ..step("a")
        };
        assert!(validate_plan_proposal(&proposal(vec![started.clone()]), true).is_err());
        assert!(validate_plan_proposal(&proposal(vec![started]), false).is_ok());
        let mut bad_currency = proposal(vec![step("a")]);
        bad_currency.currency = "rand".to_owned();
        assert!(validate_plan_proposal(&bad_currency, true).is_err());
        let two_owners = PlanStep {
            owner: PlanStepOwner {
                kind: PlanOwnerKind::Function,
                function: Some(CompanyFunction::Sales),
                agent_pubkey: Some(hex('a')),
                worker_type: None,
            },
            ..step("a")
        };
        assert!(validate_plan_proposal(&proposal(vec![two_owners]), true).is_err());
    }

    #[test]
    fn action_shape_rules() {
        // propose names no expected head, everything else does
        let mut propose = propose_action(vec![step("a")]);
        propose.expected_head_event_id = Some(hex('e'));
        assert!(validate_plan_action(&propose).is_err());
        let mut cancel = action(PlanActionKind::Cancel);
        cancel.expected_head_event_id = None;
        assert!(validate_plan_action(&cancel).is_err());
        // approve needs the revision
        assert!(validate_plan_action(&action(PlanActionKind::Approve)).is_err());
        // a failed step needs a note
        let failed = PlanAction {
            step_id: Some("a".to_owned()),
            step_status: Some(PlanStepStatus::Failed),
            ..action(PlanActionKind::UpdateStep)
        };
        assert!(validate_plan_action(&failed).is_err());
        // pending is not a status an update may set
        let pending = PlanAction {
            step_id: Some("a".to_owned()),
            step_status: Some(PlanStepStatus::Pending),
            ..action(PlanActionKind::UpdateStep)
        };
        assert!(validate_plan_action(&pending).is_err());
        let wrong_version = PlanAction {
            schema_version: 2,
            ..action(PlanActionKind::Cancel)
        };
        assert_eq!(
            validate_plan_action(&wrong_version),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }

    #[test]
    fn an_ended_step_never_moves_again() {
        let mut head = approved(vec![step("find"), step("book")]);
        let agent = actor(PlanActorRole::ManagedAgent, 'a');
        for status in [PlanStepStatus::InProgress, PlanStepStatus::Done] {
            let update = PlanAction {
                step_id: Some("find".to_owned()),
                step_status: Some(status),
                ..action(PlanActionKind::UpdateStep)
            };
            head = apply_plan_action(Some(&head), &update, &agent, &context(true)).unwrap();
        }
        let back = PlanAction {
            step_id: Some("find".to_owned()),
            step_status: Some(PlanStepStatus::InProgress),
            ..action(PlanActionKind::UpdateStep)
        };
        let error = refusal(apply_plan_action(
            Some(&head),
            &back,
            &agent,
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Conflict);
    }

    #[test]
    fn cancelling_is_allowed_to_the_proposer_and_admins_only() {
        let head = approved(vec![step("find")]);
        let cancel = action(PlanActionKind::Cancel);
        let error = refusal(apply_plan_action(
            Some(&head),
            &cancel,
            &actor(PlanActorRole::Member, 'd'),
            &context(true),
        ));
        assert_eq!(error.kind, PlanErrorKind::Forbidden);
        let cancelled = apply_plan_action(
            Some(&head),
            &cancel,
            &actor(PlanActorRole::ManagedAgent, 'a'),
            &context(false),
        )
        .expect("the proposer can always stop its own plan");
        assert_eq!(cancelled.status, PlanStatus::Cancelled);
        assert_eq!(
            cancelled.approvals.last().unwrap().decision,
            PlanDecision::Cancelled
        );
    }

    #[test]
    fn a_head_round_trips_and_validates() {
        let head = approved(vec![gated_step("send")]);
        let json = serde_json::to_string(&head).expect("serialise");
        let back: PlanHead = serde_json::from_str(&json).expect("parse");
        assert_eq!(back, head);
        validate_plan_head(&back).expect("valid");
    }
}
