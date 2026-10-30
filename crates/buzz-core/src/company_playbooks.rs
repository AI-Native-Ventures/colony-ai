//! Co-founder playbooks: a business's routine, designed with the founder,
//! versioned, and run once per client job.
//!
//! Two record families share one head kind (30677) and one action kind
//! (47067). The d-tag tells them apart:
//!
//! * `company:playbook:<uuid>` is the **playbook**: ordered steps, each with an
//!   owner (a function, a lead agent, a worker type or the founder), inputs,
//!   outputs, tools and an optional approval point. The head holds the
//!   approved version (`current`), at most one proposed change (`pending`) and
//!   an append-only decision record.
//! * `company:playbook-job:<uuid>` is a **running copy** for one client job. It
//!   snapshots the steps of the playbook version it started from, so a later
//!   version never rewrites a job in flight, and it tracks the current step,
//!   each step's state and every approval.
//!
//! [`apply_playbook_action`] and [`apply_job_action`] are the two state
//! machines. The relay broker resolves who the caller is and whether
//! co-founder mode is on, then calls them, so every rule that matters is
//! testable here without a database:
//!
//! * Only an agent or the owner or an admin proposes a playbook or a change; only
//!   the owner or an admin approves, rejects, edits or archives one. A managed
//!   agent never approves, whatever role row it has.
//! * A change waits as `pending` until the owner approves it, and only then
//!   becomes the next version.
//! * A job step with an approval point cannot start until the owner approved
//!   it. Steps run in order: only the current step moves.
//! * A worker step never sends or spends (hard rule 4).
//!
//! A playbook approval records intent. It never sends or pays anything by
//! itself: outreach and spending stay gated where Colony runs them.

use serde::{Deserialize, Serialize};

use crate::company_functions::CompanyFunction;
use crate::company_plans::{
    is_canonical_uuid, is_step_id, optional_text_within, text_within, validate_owner, PlanActor,
    PlanActorRole, PlanApprovalKind, PlanApprovalPoint, PlanContext, PlanError, PlanErrorKind,
    PlanOwnerKind, PlanStepOwner,
};
use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored playbook or job head (community-wide, one per record).
pub const KIND_PLAYBOOK_HEAD: u32 = crate::kind::KIND_PLAYBOOK_HEAD;
/// Member playbook or job write, brokered and community-wide.
pub const KIND_PLAYBOOK_ACTION: u32 = crate::kind::KIND_PLAYBOOK_ACTION;

const PLAYBOOK_D_TAG_PREFIX: &str = "company:playbook:";
const JOB_D_TAG_PREFIX: &str = "company:playbook-job:";

/// Most steps one playbook may carry.
pub const MAX_PLAYBOOK_STEPS: usize = 24;
/// Longest playbook or job title, in characters.
pub const MAX_PLAYBOOK_TITLE_CHARS: usize = 120;
/// Longest playbook summary, in characters.
pub const MAX_PLAYBOOK_SUMMARY_CHARS: usize = 600;
/// Longest step title, in characters.
pub const MAX_PLAYBOOK_STEP_TITLE_CHARS: usize = 160;
/// Longest step detail, in characters.
pub const MAX_PLAYBOOK_STEP_DETAIL_CHARS: usize = 600;
/// Longest input, output, tool or progress label, in characters.
pub const MAX_PLAYBOOK_LABEL_CHARS: usize = 120;
/// Longest note, reason or change summary, in characters.
pub const MAX_PLAYBOOK_NOTE_CHARS: usize = 500;
/// Most inputs, outputs or tools one step may name.
pub const MAX_PLAYBOOK_STEP_LISTED: usize = 6;
/// Most decision records one playbook keeps.
pub const MAX_PLAYBOOK_RECORDS: usize = 200;
/// Most approval records one job keeps.
pub const MAX_JOB_APPROVALS: usize = 200;
/// Most hand-offs one job keeps.
pub const MAX_JOB_HANDOFFS: usize = 100;

// ── Shared types ────────────────────────────────────────────────────────────

/// One step of a playbook: what happens, who does it and what it needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookStep {
    /// Stable id inside the playbook, `[a-z0-9_-]`, 1 to 32 characters.
    pub step_id: String,
    /// What happens, 1 to 160 characters.
    pub title: String,
    /// Optional detail, at most 600 characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Who does it: a function, a lead agent, a worker type or the founder.
    pub owner: PlanStepOwner,
    /// What the step needs, for example "signed agreement".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<String>,
    /// What the step produces, for example "preview link".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outputs: Vec<String>,
    /// Tools the step uses, for example `WhatsApp`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,
    /// Where the step waits for the owner before it runs, if it does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_point: Option<PlanApprovalPoint>,
}

/// What a playbook says. The approved copy lives in the head's `current`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookContent {
    /// Playbook title, 1 to 120 characters.
    pub title: String,
    /// What the playbook is for, at most 600 characters.
    #[serde(default)]
    pub summary: String,
    /// The function the playbook belongs to; `operations` for delivery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<CompanyFunction>,
    /// Ordered steps, 1 to 24.
    pub steps: Vec<PlaybookStep>,
}

struct StepFields<'a> {
    step_id: &'a str,
    title: &'a str,
    detail: &'a Option<String>,
    owner: &'a PlanStepOwner,
    inputs: &'a [String],
    outputs: &'a [String],
    tools: &'a [String],
    approval_point: &'a Option<PlanApprovalPoint>,
}

fn list_ok(values: &[String]) -> bool {
    values.len() <= MAX_PLAYBOOK_STEP_LISTED
        && values
            .iter()
            .all(|value| text_within(value, MAX_PLAYBOOK_LABEL_CHARS))
}

fn validate_owner_and_gate(
    owner: &PlanStepOwner,
    approval_point: &Option<PlanApprovalPoint>,
) -> Result<(), CompanyRecordError> {
    validate_owner(owner)?;
    if let Some(point) = approval_point {
        if !text_within(&point.prompt, 80) {
            return Err(CompanyRecordError::Invalid(
                "an approval point prompt is 1 to 80 characters",
            ));
        }
    }
    // Hard rule 4: workers only produce material for their employee.
    if owner.kind == PlanOwnerKind::Worker
        && approval_point.as_ref().is_some_and(|point| {
            matches!(
                point.kind,
                PlanApprovalKind::Outreach | PlanApprovalKind::Spend
            )
        })
    {
        return Err(CompanyRecordError::Invalid(
            "a worker step cannot send or spend: workers never take outward actions",
        ));
    }
    Ok(())
}

fn validate_fields(fields: &StepFields<'_>) -> Result<(), CompanyRecordError> {
    if !is_step_id(fields.step_id) {
        return Err(CompanyRecordError::Invalid(
            "stepId is 1 to 32 characters of a-z, 0-9, - and _",
        ));
    }
    if !text_within(fields.title, MAX_PLAYBOOK_STEP_TITLE_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a step title is 1 to 160 characters",
        ));
    }
    if !optional_text_within(fields.detail, MAX_PLAYBOOK_STEP_DETAIL_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a step detail is 1 to 600 characters",
        ));
    }
    if !list_ok(fields.inputs) || !list_ok(fields.outputs) || !list_ok(fields.tools) {
        return Err(CompanyRecordError::Invalid(
            "a step names at most 6 inputs, 6 outputs and 6 tools of 1 to 120 characters",
        ));
    }
    validate_owner_and_gate(fields.owner, fields.approval_point)
}

impl PlaybookStep {
    fn fields(&self) -> StepFields<'_> {
        StepFields {
            step_id: &self.step_id,
            title: &self.title,
            detail: &self.detail,
            owner: &self.owner,
            inputs: &self.inputs,
            outputs: &self.outputs,
            tools: &self.tools,
            approval_point: &self.approval_point,
        }
    }
}

/// Validate a playbook's content.
pub fn validate_playbook_content(content: &PlaybookContent) -> Result<(), CompanyRecordError> {
    if !text_within(&content.title, MAX_PLAYBOOK_TITLE_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a playbook title is 1 to 120 characters",
        ));
    }
    if content.summary.chars().count() > MAX_PLAYBOOK_SUMMARY_CHARS {
        return Err(CompanyRecordError::Invalid(
            "a playbook summary is at most 600 characters",
        ));
    }
    if content.steps.is_empty() || content.steps.len() > MAX_PLAYBOOK_STEPS {
        return Err(CompanyRecordError::Invalid("a playbook has 1 to 24 steps"));
    }
    for (index, step) in content.steps.iter().enumerate() {
        validate_fields(&step.fields())?;
        if content.steps[..index]
            .iter()
            .any(|earlier| earlier.step_id == step.step_id)
        {
            return Err(CompanyRecordError::Invalid("stepId values must be unique"));
        }
    }
    Ok(())
}

// ── D-tags ──────────────────────────────────────────────────────────────────

/// Which record family a d-tag names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaybookRecordKind {
    /// A playbook (`company:playbook:<uuid>`).
    Playbook,
    /// A running copy for one job (`company:playbook-job:<uuid>`).
    Job,
}

/// Which family a d-tag belongs to, if it is a playbook d-tag at all.
pub fn playbook_record_kind(d_tag: &str) -> Option<PlaybookRecordKind> {
    if d_tag.starts_with(PLAYBOOK_D_TAG_PREFIX) {
        Some(PlaybookRecordKind::Playbook)
    } else if d_tag.starts_with(JOB_D_TAG_PREFIX) {
        Some(PlaybookRecordKind::Job)
    } else {
        None
    }
}

/// Build the community-wide d-tag of a playbook.
pub fn playbook_d_tag(playbook_id: &str) -> Result<String, CompanyRecordError> {
    if !is_canonical_uuid(playbook_id) {
        return Err(CompanyRecordError::Invalid(
            "playbookId must be a lowercase UUID",
        ));
    }
    Ok(format!("{PLAYBOOK_D_TAG_PREFIX}{playbook_id}"))
}

/// Build the community-wide d-tag of a running copy.
pub fn playbook_job_d_tag(job_id: &str) -> Result<String, CompanyRecordError> {
    if !is_canonical_uuid(job_id) {
        return Err(CompanyRecordError::Invalid(
            "jobId must be a lowercase UUID",
        ));
    }
    Ok(format!("{JOB_D_TAG_PREFIX}{job_id}"))
}

/// Check a d-tag against a playbook id.
pub fn validate_playbook_d_tag(d_tag: &str, playbook_id: &str) -> Result<(), CompanyRecordError> {
    if d_tag == playbook_d_tag(playbook_id)? {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// Check a d-tag against a job id.
pub fn validate_playbook_job_d_tag(d_tag: &str, job_id: &str) -> Result<(), CompanyRecordError> {
    if d_tag == playbook_job_d_tag(job_id)? {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

// ── Playbook head and actions ───────────────────────────────────────────────

/// Lifecycle state of a playbook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybookStatus {
    /// Proposed and never approved; no version exists yet.
    Proposed,
    /// Has an approved version that jobs can start from.
    Active,
    /// Retired by the owner or an admin; running jobs finish, no new jobs start.
    Archived,
    /// The first proposal was rejected or withdrawn.
    Rejected,
}

impl PlaybookStatus {
    /// A playbook that still accepts changes.
    pub const fn is_open(self) -> bool {
        matches!(self, PlaybookStatus::Proposed | PlaybookStatus::Active)
    }
}

/// What a decision record says happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybookDecision {
    /// The owner approved a proposal; it became the next version.
    Approved,
    /// The owner rejected a proposal.
    Rejected,
    /// The owner or an admin edited a proposal that was waiting.
    Edited,
    /// The owner or an admin wrote the next version directly.
    Published,
    /// The proposer or the owner withdrew a proposal.
    Withdrawn,
    /// The owner or an admin retired the playbook.
    Archived,
}

/// A proposal waiting for the owner: a new playbook or a change to the current version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookChange {
    /// The whole playbook as it would read once approved.
    pub content: PlaybookContent,
    /// One short line the owner reads, for example "Add a logins checklist to step 2".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_summary: Option<String>,
    /// Who proposed it.
    pub proposed_by_pubkey: String,
    /// When it was proposed, in Unix seconds.
    pub proposed_at: i64,
    /// Starts at 1 and grows by one every time the proposal is revised.
    pub revision: u32,
}

/// Who decided what and when. Append-only inside the head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookDecisionRecord {
    /// What happened.
    pub decision: PlaybookDecision,
    /// The playbook version in effect after this decision.
    pub version: u32,
    /// The proposal revision decided, when the decision concerns a proposal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u32>,
    /// Owner, admin or proposer who decided, 64 lowercase hex characters.
    pub actor_pubkey: String,
    /// Decision time in Unix seconds.
    pub at: i64,
    /// Reason or note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// What the decided change said it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_summary: Option<String>,
    /// Who proposed the decided change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposed_by_pubkey: Option<String>,
    /// Action event that carried the decision.
    pub action_event_id: String,
}

/// Relay-authored current playbook (kind 30677, d-tag `company:playbook:<uuid>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable playbook UUID.
    pub playbook_id: String,
    /// Lifecycle state.
    pub status: PlaybookStatus,
    /// Latest approved version; 0 until the first approval.
    pub version: u32,
    /// The approved content of `version`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<PlaybookContent>,
    /// A proposal waiting for the owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<PlaybookChange>,
    /// Every decision, oldest first.
    #[serde(default)]
    pub records: Vec<PlaybookDecisionRecord>,
    /// Who first proposed it.
    pub created_by_pubkey: String,
    /// When it was first proposed, in Unix seconds.
    pub created_at: i64,
    /// Who made the last change.
    pub updated_by_pubkey: String,
    /// When the last change happened, in Unix seconds.
    pub updated_at: i64,
    /// Action event that produced this head.
    pub source_action_event_id: String,
}

/// What a playbook action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybookActionKind {
    /// Propose a new playbook (agent or admin).
    Propose,
    /// Propose a change to the approved version (agent or admin).
    ProposeChange,
    /// Replace the content of the waiting proposal (its proposer, the owner or an admin).
    Revise,
    /// Take back the waiting proposal (its proposer, the owner or an admin).
    Withdraw,
    /// Approve the waiting proposal; it becomes the next version (owner or admin).
    Approve,
    /// Reject the waiting proposal (owner or admin).
    Reject,
    /// Write the next version directly (owner or admin).
    Edit,
    /// Retire the playbook (owner or admin).
    Archive,
}

/// Member-signed playbook write (kind 47067, d-tag `company:playbook:<uuid>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable playbook UUID in lowercase hyphenated form.
    pub playbook_id: String,
    /// What to do.
    pub kind: PlaybookActionKind,
    /// The whole playbook, for `propose`, `propose_change`, `revise` and `edit`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<PlaybookContent>,
    /// One short line saying what the change does; required for `propose_change`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub change_summary: Option<String>,
    /// The proposal revision being decided, for `approve` and `reject`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u32>,
    /// Reason or note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Exact current head event id; omitted only for `propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

fn validate_note(note: &Option<String>) -> Result<(), CompanyRecordError> {
    if optional_text_within(note, MAX_PLAYBOOK_NOTE_CHARS) {
        Ok(())
    } else {
        Err(CompanyRecordError::Invalid("a note is 1 to 500 characters"))
    }
}

fn validate_expected(expected: &Option<String>) -> Result<(), CompanyRecordError> {
    if expected.as_deref().is_none_or(is_hex_id) {
        Ok(())
    } else {
        Err(CompanyRecordError::Invalid(
            "expectedHeadEventId must be a 64-character event id",
        ))
    }
}

/// Validate the shape of a playbook action. State rules live in [`apply_playbook_action`].
pub fn validate_playbook_action(action: &PlaybookAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    playbook_d_tag(&action.playbook_id)?;
    validate_expected(&action.expected_head_event_id)?;
    validate_note(&action.note)?;
    if !optional_text_within(&action.change_summary, MAX_PLAYBOOK_NOTE_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a change summary is 1 to 500 characters",
        ));
    }
    let needs_expected = !matches!(action.kind, PlaybookActionKind::Propose);
    if needs_expected != action.expected_head_event_id.is_some() {
        return Err(CompanyRecordError::Invalid(
            "propose names no expected head; every other action names the exact head",
        ));
    }
    let has_content = action.content.is_some();
    let has_summary = action.change_summary.is_some();
    let has_revision = action.revision.is_some();
    let has_note = action.note.is_some();
    match action.kind {
        PlaybookActionKind::Propose | PlaybookActionKind::Revise | PlaybookActionKind::Edit => {
            if !has_content || has_revision || has_note {
                return Err(CompanyRecordError::Invalid(
                    "propose, revise and edit carry a playbook and an optional change summary",
                ));
            }
        }
        PlaybookActionKind::ProposeChange => {
            if !has_content || !has_summary || has_revision || has_note {
                return Err(CompanyRecordError::Invalid(
                    "propose_change carries a playbook and a change summary",
                ));
            }
        }
        PlaybookActionKind::Approve | PlaybookActionKind::Reject => {
            if has_content || has_summary || !has_revision {
                return Err(CompanyRecordError::Invalid(
                    "approve and reject carry only the revision (and a note)",
                ));
            }
        }
        PlaybookActionKind::Withdraw | PlaybookActionKind::Archive => {
            if has_content || has_summary || has_revision {
                return Err(CompanyRecordError::Invalid(
                    "withdraw and archive carry only an optional note",
                ));
            }
        }
    }
    if let Some(content) = &action.content {
        validate_playbook_content(content)?;
    }
    Ok(())
}

/// Validate a relay-authored playbook head.
pub fn validate_playbook_head(head: &PlaybookHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    playbook_d_tag(&head.playbook_id)?;
    if !is_hex_id(&head.created_by_pubkey)
        || !is_hex_id(&head.updated_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || head.created_at <= 0
        || head.updated_at <= 0
    {
        return Err(CompanyRecordError::Invalid(
            "playbook head identity and time must be valid",
        ));
    }
    if (head.version == 0) != head.current.is_none() && head.status != PlaybookStatus::Archived {
        return Err(CompanyRecordError::Invalid(
            "a playbook has current content exactly when it has a version",
        ));
    }
    let shape_ok = match head.status {
        PlaybookStatus::Proposed => head.version == 0 && head.pending.is_some(),
        PlaybookStatus::Active => head.version > 0,
        PlaybookStatus::Archived => head.pending.is_none(),
        PlaybookStatus::Rejected => head.version == 0 && head.pending.is_none(),
    };
    if !shape_ok {
        return Err(CompanyRecordError::Invalid(
            "the playbook's status does not match its version and proposal",
        ));
    }
    if let Some(current) = &head.current {
        validate_playbook_content(current)?;
    }
    if let Some(pending) = &head.pending {
        validate_playbook_content(&pending.content)?;
        if !is_hex_id(&pending.proposed_by_pubkey)
            || pending.proposed_at <= 0
            || pending.revision == 0
            || !optional_text_within(&pending.change_summary, MAX_PLAYBOOK_NOTE_CHARS)
        {
            return Err(CompanyRecordError::Invalid(
                "a pending change needs a valid proposer, time and revision",
            ));
        }
    }
    if head.records.len() > MAX_PLAYBOOK_RECORDS {
        return Err(CompanyRecordError::Invalid(
            "a playbook keeps at most 200 decision records",
        ));
    }
    for record in &head.records {
        if !is_hex_id(&record.actor_pubkey)
            || !is_hex_id(&record.action_event_id)
            || record
                .proposed_by_pubkey
                .as_deref()
                .is_some_and(|key| !is_hex_id(key))
            || record.at <= 0
            || record.revision == Some(0)
            || !optional_text_within(&record.note, MAX_PLAYBOOK_NOTE_CHARS)
            || !optional_text_within(&record.change_summary, MAX_PLAYBOOK_NOTE_CHARS)
        {
            return Err(CompanyRecordError::Invalid(
                "a decision record needs a valid actor, time and event id",
            ));
        }
    }
    Ok(())
}

// ── Errors and rules shared by both state machines ─────────────────────────

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

/// A plain member never writes a playbook or starts a job.
fn require_agent_or_admin(actor: &PlanActor, what: &str) -> Result<(), PlanError> {
    if actor.role == PlanActorRole::Member {
        Err(forbidden(format!(
            "only an agent or the owner or an admin can {what}"
        )))
    } else {
        Ok(())
    }
}

// ── Playbook state machine ──────────────────────────────────────────────────

/// Apply one playbook action to the current head and return the next head.
///
/// The caller (the relay broker) has already verified the signature, resolved
/// `actor` and checked that `action.expected_head_event_id` names the stored
/// head. This function owns every other rule.
pub fn apply_playbook_action(
    current: Option<&PlaybookHead>,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<PlaybookHead, PlanError> {
    validate_playbook_action(action).map_err(|error| invalid(error.to_string()))?;
    let Some(head) = current else {
        return propose_playbook(action, actor, context);
    };
    if action.kind == PlaybookActionKind::Propose {
        return Err(conflict("a playbook with this id already exists"));
    }
    if head.playbook_id != action.playbook_id {
        return Err(invalid(
            "the action names a different playbook than the head",
        ));
    }
    if !head.status.is_open() {
        return Err(conflict("this playbook has already ended"));
    }
    let mut next = head.clone();
    match action.kind {
        PlaybookActionKind::Propose => {
            return Err(conflict("a playbook with this id already exists"))
        }
        PlaybookActionKind::ProposeChange => propose_change(&mut next, action, actor, context)?,
        PlaybookActionKind::Revise => revise(&mut next, action, actor, context)?,
        PlaybookActionKind::Withdraw => withdraw(&mut next, action, actor, context)?,
        PlaybookActionKind::Approve => approve(&mut next, action, actor, context)?,
        PlaybookActionKind::Reject => reject(&mut next, action, actor, context)?,
        PlaybookActionKind::Edit => edit(&mut next, action, actor, context)?,
        PlaybookActionKind::Archive => archive(&mut next, action, actor, context)?,
    }
    next.updated_by_pubkey = actor.pubkey.clone();
    next.updated_at = context.now;
    next.source_action_event_id = context.action_event_id.clone();
    Ok(next)
}

fn propose_playbook(
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<PlaybookHead, PlanError> {
    if action.kind != PlaybookActionKind::Propose {
        return Err(conflict("this playbook does not exist"));
    }
    require_cofounder(context, "playbooks cannot be proposed")?;
    require_agent_or_admin(actor, "propose a playbook")?;
    let content = action
        .content
        .clone()
        .ok_or_else(|| invalid("propose needs a playbook"))?;
    Ok(PlaybookHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        playbook_id: action.playbook_id.clone(),
        status: PlaybookStatus::Proposed,
        version: 0,
        current: None,
        pending: Some(PlaybookChange {
            content,
            change_summary: action.change_summary.clone(),
            proposed_by_pubkey: actor.pubkey.clone(),
            proposed_at: context.now,
            revision: 1,
        }),
        records: Vec::new(),
        created_by_pubkey: actor.pubkey.clone(),
        created_at: context.now,
        updated_by_pubkey: actor.pubkey.clone(),
        updated_at: context.now,
        source_action_event_id: context.action_event_id.clone(),
    })
}

fn push_record(
    head: &mut PlaybookHead,
    decision: PlaybookDecision,
    revision: Option<u32>,
    actor: &PlanActor,
    note: Option<String>,
    decided: Option<&PlaybookChange>,
    context: &PlanContext,
) -> Result<(), PlanError> {
    if head.records.len() >= MAX_PLAYBOOK_RECORDS {
        return Err(conflict("this playbook's decision record is full"));
    }
    head.records.push(PlaybookDecisionRecord {
        decision,
        version: head.version,
        revision,
        actor_pubkey: actor.pubkey.clone(),
        at: context.now,
        note,
        change_summary: decided.and_then(|change| change.change_summary.clone()),
        proposed_by_pubkey: decided.map(|change| change.proposed_by_pubkey.clone()),
        action_event_id: context.action_event_id.clone(),
    });
    Ok(())
}

fn propose_change(
    head: &mut PlaybookHead,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_cofounder(context, "playbook changes cannot be proposed")?;
    require_agent_or_admin(actor, "propose a change to a playbook")?;
    if head.status != PlaybookStatus::Active {
        return Err(conflict(
            "only an approved playbook takes a proposed change; revise the first proposal instead",
        ));
    }
    if head.pending.is_some() {
        return Err(conflict(
            "a change is already waiting for the owner; revise or withdraw it first",
        ));
    }
    let content = action
        .content
        .clone()
        .ok_or_else(|| invalid("propose_change needs a playbook"))?;
    if head.current.as_ref() == Some(&content) {
        return Err(invalid(
            "the proposed playbook is the same as the current version",
        ));
    }
    head.pending = Some(PlaybookChange {
        content,
        change_summary: action.change_summary.clone(),
        proposed_by_pubkey: actor.pubkey.clone(),
        proposed_at: context.now,
        revision: 1,
    });
    Ok(())
}

fn revise(
    head: &mut PlaybookHead,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_cofounder(context, "playbook proposals cannot be revised")?;
    let Some(pending) = head.pending.as_mut() else {
        return Err(conflict("no change is waiting to be revised"));
    };
    let is_proposer = actor.pubkey == pending.proposed_by_pubkey;
    if !is_proposer && actor.role != PlanActorRole::Admin {
        return Err(forbidden(
            "only the proposer, the owner or an admin can revise a proposal",
        ));
    }
    let content = action
        .content
        .clone()
        .ok_or_else(|| invalid("revise needs a playbook"))?;
    pending.content = content;
    if action.change_summary.is_some() {
        pending.change_summary = action.change_summary.clone();
    }
    pending.revision = pending.revision.saturating_add(1);
    let revision = pending.revision;
    if !is_proposer {
        let decided = head.pending.clone();
        push_record(
            head,
            PlaybookDecision::Edited,
            Some(revision),
            actor,
            None,
            decided.as_ref(),
            context,
        )?;
    }
    Ok(())
}

fn check_revision(pending: &PlaybookChange, action: &PlaybookAction) -> Result<(), PlanError> {
    if action.revision == Some(pending.revision) {
        Ok(())
    } else {
        Err(conflict(format!(
            "the proposal changed since you looked: it is now revision {}",
            pending.revision
        )))
    }
}

fn take_pending(head: &mut PlaybookHead) -> Result<PlaybookChange, PlanError> {
    head.pending
        .take()
        .ok_or_else(|| conflict("no change is waiting for a decision"))
}

fn approve(
    head: &mut PlaybookHead,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_cofounder(context, "new playbook versions cannot be approved")?;
    let pending = head
        .pending
        .as_ref()
        .ok_or_else(|| conflict("no change is waiting for a decision"))?;
    check_revision(pending, action)?;
    let pending = take_pending(head)?;
    head.version = head.version.saturating_add(1);
    head.current = Some(pending.content.clone());
    head.status = PlaybookStatus::Active;
    push_record(
        head,
        PlaybookDecision::Approved,
        Some(pending.revision),
        actor,
        action.note.clone(),
        Some(&pending),
        context,
    )
}

fn reject(
    head: &mut PlaybookHead,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_admin(actor, "reject a playbook or a change to one")?;
    let pending = head
        .pending
        .as_ref()
        .ok_or_else(|| conflict("no change is waiting for a decision"))?;
    check_revision(pending, action)?;
    let pending = take_pending(head)?;
    if head.version == 0 {
        head.status = PlaybookStatus::Rejected;
    }
    push_record(
        head,
        PlaybookDecision::Rejected,
        Some(pending.revision),
        actor,
        action.note.clone(),
        Some(&pending),
        context,
    )
}

fn withdraw(
    head: &mut PlaybookHead,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    let pending = head
        .pending
        .as_ref()
        .ok_or_else(|| conflict("no change is waiting to be withdrawn"))?;
    if actor.pubkey != pending.proposed_by_pubkey && actor.role != PlanActorRole::Admin {
        return Err(forbidden(
            "only the proposer, the owner or an admin can withdraw a proposal",
        ));
    }
    let pending = take_pending(head)?;
    if head.version == 0 {
        head.status = PlaybookStatus::Rejected;
    }
    push_record(
        head,
        PlaybookDecision::Withdrawn,
        Some(pending.revision),
        actor,
        action.note.clone(),
        Some(&pending),
        context,
    )
}

fn edit(
    head: &mut PlaybookHead,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_admin(actor, "write a playbook version directly")?;
    let content = action
        .content
        .clone()
        .ok_or_else(|| invalid("edit needs a playbook"))?;
    if head.current.as_ref() == Some(&content) {
        return Err(invalid("the playbook is the same as the current version"));
    }
    head.pending = None;
    head.version = head.version.saturating_add(1);
    head.current = Some(content);
    head.status = PlaybookStatus::Active;
    push_record(
        head,
        PlaybookDecision::Published,
        None,
        actor,
        None,
        None,
        context,
    )?;
    if let Some(record) = head.records.last_mut() {
        record.change_summary = action.change_summary.clone();
    }
    Ok(())
}

fn archive(
    head: &mut PlaybookHead,
    action: &PlaybookAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    require_admin(actor, "archive a playbook")?;
    head.pending = None;
    head.status = PlaybookStatus::Archived;
    push_record(
        head,
        PlaybookDecision::Archived,
        None,
        actor,
        action.note.clone(),
        None,
        context,
    )
}

// ── Job head and actions ────────────────────────────────────────────────────

/// Lifecycle state of one step of a running copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStepStatus {
    /// Not started.
    Pending,
    /// The step reached its approval point and waits for the owner.
    WaitingApproval,
    /// The owner approved the approval point; the step may run.
    Approved,
    /// The step is being worked.
    InProgress,
    /// The step finished.
    Done,
    /// The step cannot go on; the note says why. It can resume.
    Blocked,
    /// The step was skipped or its approval point was rejected.
    Skipped,
}

impl JobStepStatus {
    /// A step that will not change any more.
    pub const fn is_ended(self) -> bool {
        matches!(self, JobStepStatus::Done | JobStepStatus::Skipped)
    }
}

/// One step of a running copy, with its live state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookJobStep {
    /// Stable id, copied from the playbook version.
    pub step_id: String,
    /// What happens.
    pub title: String,
    /// Optional detail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Who does it now (a hand-off changes this).
    pub owner: PlanStepOwner,
    /// What the step needs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<String>,
    /// What the step produces.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outputs: Vec<String>,
    /// Tools the step uses.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,
    /// Where the step waits for the owner before it runs, if it does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_point: Option<PlanApprovalPoint>,
    /// Current state.
    pub status: JobStepStatus,
    /// Latest note, for example why a step is blocked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Short progress line, for example "Round 1 of 2".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_label: Option<String>,
    /// When `status` last changed, in Unix seconds.
    pub status_at: i64,
}

impl PlaybookJobStep {
    fn fields(&self) -> StepFields<'_> {
        StepFields {
            step_id: &self.step_id,
            title: &self.title,
            detail: &self.detail,
            owner: &self.owner,
            inputs: &self.inputs,
            outputs: &self.outputs,
            tools: &self.tools,
            approval_point: &self.approval_point,
        }
    }
}

/// Lifecycle state of a running copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    /// Steps are running.
    Running,
    /// Every step ended.
    Completed,
    /// Stopped by the starter, the owner or an admin.
    Cancelled,
}

impl JobStatus {
    /// A job that still runs.
    pub const fn is_open(self) -> bool {
        matches!(self, JobStatus::Running)
    }
}

/// What a job approval record decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobDecision {
    /// The owner approved the step's approval point.
    Approved,
    /// The owner rejected it; the step was skipped.
    Rejected,
}

/// Who approved or rejected a step's approval point, and when. Append-only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobApprovalRecord {
    /// The step.
    pub step_id: String,
    /// What was decided.
    pub decision: JobDecision,
    /// Owner or admin who decided, 64 lowercase hex characters.
    pub actor_pubkey: String,
    /// Decision time in Unix seconds.
    pub at: i64,
    /// Reason or note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Action event that carried the decision.
    pub action_event_id: String,
}

/// A step handed to another function, agent or worker type. Append-only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct JobHandoffRecord {
    /// The step.
    pub step_id: String,
    /// Who had it.
    pub from: PlanStepOwner,
    /// Who has it now.
    pub to: PlanStepOwner,
    /// Who handed it over.
    pub by_pubkey: String,
    /// Time of the hand-off in Unix seconds.
    pub at: i64,
    /// Why.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Action event that carried the hand-off.
    pub action_event_id: String,
}

/// Relay-authored running copy (kind 30677, d-tag `company:playbook-job:<uuid>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookJobHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable job UUID.
    pub job_id: String,
    /// The playbook it runs.
    pub playbook_id: String,
    /// The playbook version the steps were copied from.
    pub playbook_version: u32,
    /// The playbook's title at start.
    pub playbook_title: String,
    /// The job, for example the client's name.
    pub title: String,
    /// Lifecycle state.
    pub status: JobStatus,
    /// The first step that has not ended; absent once the job ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_step_id: Option<String>,
    /// The steps with live state, in order.
    pub steps: Vec<PlaybookJobStep>,
    /// Every approval decision, oldest first.
    #[serde(default)]
    pub approvals: Vec<JobApprovalRecord>,
    /// Every hand-off, oldest first.
    #[serde(default)]
    pub handoffs: Vec<JobHandoffRecord>,
    /// Who started it.
    pub started_by_pubkey: String,
    /// When it started, in Unix seconds.
    pub started_at: i64,
    /// When it completed or was cancelled, in Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    /// Who made the last change.
    pub updated_by_pubkey: String,
    /// When the last change happened, in Unix seconds.
    pub updated_at: i64,
    /// Action event that produced this head.
    pub source_action_event_id: String,
}

/// What a job action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobActionKind {
    /// Start a running copy of a playbook (agent or admin).
    Start,
    /// Move the current step along.
    UpdateStep,
    /// Ask the owner to approve the current step's approval point.
    RequestStepApproval,
    /// Approve the current step's approval point (owner or admin).
    ApproveStep,
    /// Reject the current step's approval point; the step is skipped (owner or admin).
    RejectStep,
    /// Hand a step to another function, agent or worker type.
    HandOff,
    /// Stop the job.
    Cancel,
}

/// Member-signed job write (kind 47067, d-tag `company:playbook-job:<uuid>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaybookJobAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable job UUID in lowercase hyphenated form.
    pub job_id: String,
    /// What to do.
    pub kind: JobActionKind,
    /// The playbook to run, for `start`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playbook_id: Option<String>,
    /// The version the caller expects, for `start`; refused when the playbook moved on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playbook_version: Option<u32>,
    /// The job's title, for `start`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The step, for step actions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    /// The new step status, for `update_step`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_status: Option<JobStepStatus>,
    /// A short progress line for `update_step`, for example "Round 1 of 2".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_label: Option<String>,
    /// The new owner, for `hand_off`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hand_off_to: Option<PlanStepOwner>,
    /// Reason or note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Exact current head event id; omitted only for `start`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

/// Validate the shape of a job action. State rules live in [`apply_job_action`].
pub fn validate_job_action(action: &PlaybookJobAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    playbook_job_d_tag(&action.job_id)?;
    validate_expected(&action.expected_head_event_id)?;
    validate_note(&action.note)?;
    if let Some(step_id) = action.step_id.as_deref() {
        if !is_step_id(step_id) {
            return Err(CompanyRecordError::Invalid(
                "stepId is 1 to 32 characters of a-z, 0-9, - and _",
            ));
        }
    }
    if let Some(playbook_id) = action.playbook_id.as_deref() {
        playbook_d_tag(playbook_id)?;
    }
    if !optional_text_within(&action.title, MAX_PLAYBOOK_TITLE_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a job title is 1 to 120 characters",
        ));
    }
    if !optional_text_within(&action.progress_label, MAX_PLAYBOOK_LABEL_CHARS) {
        return Err(CompanyRecordError::Invalid(
            "a progress label is 1 to 120 characters",
        ));
    }
    let needs_expected = !matches!(action.kind, JobActionKind::Start);
    if needs_expected != action.expected_head_event_id.is_some() {
        return Err(CompanyRecordError::Invalid(
            "start names no expected head; every other action names the exact head",
        ));
    }
    let start_fields =
        action.playbook_id.is_some() || action.playbook_version.is_some() || action.title.is_some();
    let has_step = action.step_id.is_some();
    let has_status = action.step_status.is_some();
    let has_progress = action.progress_label.is_some();
    let has_hand_off = action.hand_off_to.is_some();
    let step_only = has_step && !start_fields && !has_status && !has_progress && !has_hand_off;
    match action.kind {
        JobActionKind::Start => {
            if action.playbook_id.is_none()
                || action.title.is_none()
                || has_step
                || has_status
                || has_progress
                || has_hand_off
                || action.note.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "start carries a playbookId, a title and optionally a playbookVersion",
                ));
            }
        }
        JobActionKind::UpdateStep => {
            if !has_step || start_fields || !has_status || has_hand_off {
                return Err(CompanyRecordError::Invalid(
                    "update_step carries a stepId and a stepStatus",
                ));
            }
            match action.step_status {
                Some(
                    JobStepStatus::InProgress
                    | JobStepStatus::Done
                    | JobStepStatus::Blocked
                    | JobStepStatus::Skipped,
                ) => {}
                _ => {
                    return Err(CompanyRecordError::Invalid(
                        "update_step moves a step to in_progress, done, blocked or skipped",
                    ));
                }
            }
            if action.step_status == Some(JobStepStatus::Blocked) && action.note.is_none() {
                return Err(CompanyRecordError::Invalid(
                    "a blocked step needs a note that says why",
                ));
            }
        }
        JobActionKind::RequestStepApproval
        | JobActionKind::ApproveStep
        | JobActionKind::RejectStep => {
            if !step_only {
                return Err(CompanyRecordError::Invalid(
                    "step approval actions carry only a stepId (and a note)",
                ));
            }
        }
        JobActionKind::HandOff => {
            if !has_step || start_fields || has_status || has_progress || !has_hand_off {
                return Err(CompanyRecordError::Invalid(
                    "hand_off carries a stepId and handOffTo",
                ));
            }
            if let Some(owner) = &action.hand_off_to {
                validate_owner(owner)?;
            }
        }
        JobActionKind::Cancel => {
            if has_step || start_fields || has_status || has_progress || has_hand_off {
                return Err(CompanyRecordError::Invalid(
                    "cancel carries only an optional note",
                ));
            }
        }
    }
    Ok(())
}

fn current_index(steps: &[PlaybookJobStep]) -> Option<usize> {
    steps.iter().position(|step| !step.status.is_ended())
}

fn expected_current(head: &PlaybookJobHead) -> Option<String> {
    if head.status == JobStatus::Running {
        current_index(&head.steps).map(|index| head.steps[index].step_id.clone())
    } else {
        None
    }
}

/// Validate a relay-authored job head.
pub fn validate_job_head(head: &PlaybookJobHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    playbook_job_d_tag(&head.job_id)?;
    playbook_d_tag(&head.playbook_id)?;
    if !is_hex_id(&head.started_by_pubkey)
        || !is_hex_id(&head.updated_by_pubkey)
        || !is_hex_id(&head.source_action_event_id)
        || head.started_at <= 0
        || head.updated_at <= 0
        || head.ended_at.is_some_and(|at| at <= 0)
        || head.playbook_version == 0
    {
        return Err(CompanyRecordError::Invalid(
            "job head identity, version and time must be valid",
        ));
    }
    if !text_within(&head.title, MAX_PLAYBOOK_TITLE_CHARS)
        || !text_within(&head.playbook_title, MAX_PLAYBOOK_TITLE_CHARS)
    {
        return Err(CompanyRecordError::Invalid(
            "a job title is 1 to 120 characters",
        ));
    }
    if head.steps.is_empty() || head.steps.len() > MAX_PLAYBOOK_STEPS {
        return Err(CompanyRecordError::Invalid("a job has 1 to 24 steps"));
    }
    for (index, step) in head.steps.iter().enumerate() {
        validate_fields(&step.fields())?;
        if head.steps[..index]
            .iter()
            .any(|earlier| earlier.step_id == step.step_id)
        {
            return Err(CompanyRecordError::Invalid("stepId values must be unique"));
        }
        if step.status_at <= 0
            || !optional_text_within(&step.note, MAX_PLAYBOOK_NOTE_CHARS)
            || !optional_text_within(&step.progress_label, MAX_PLAYBOOK_LABEL_CHARS)
        {
            return Err(CompanyRecordError::Invalid(
                "a job step needs a valid time, note and progress label",
            ));
        }
        if step.status == JobStepStatus::Blocked && step.note.is_none() {
            return Err(CompanyRecordError::Invalid(
                "a blocked step needs a note that says why",
            ));
        }
    }
    if head.current_step_id != expected_current(head) {
        return Err(CompanyRecordError::Invalid(
            "currentStepId must name the first step that has not ended while the job runs",
        ));
    }
    let all_ended = head.steps.iter().all(|step| step.status.is_ended());
    let status_matches_steps = match head.status {
        JobStatus::Completed => all_ended,
        JobStatus::Running => !all_ended,
        JobStatus::Cancelled => true,
    };
    if !status_matches_steps {
        return Err(CompanyRecordError::Invalid(
            "a job is completed exactly when every step ended",
        ));
    }
    if head.approvals.len() > MAX_JOB_APPROVALS || head.handoffs.len() > MAX_JOB_HANDOFFS {
        return Err(CompanyRecordError::Invalid(
            "a job keeps at most 200 approval records and 100 hand-offs",
        ));
    }
    for record in &head.approvals {
        if !is_step_id(&record.step_id)
            || !is_hex_id(&record.actor_pubkey)
            || !is_hex_id(&record.action_event_id)
            || record.at <= 0
            || !optional_text_within(&record.note, MAX_PLAYBOOK_NOTE_CHARS)
        {
            return Err(CompanyRecordError::Invalid(
                "a job approval record needs a valid step, actor, time and event id",
            ));
        }
    }
    for record in &head.handoffs {
        validate_owner(&record.from)?;
        validate_owner(&record.to)?;
        if !is_step_id(&record.step_id)
            || !is_hex_id(&record.by_pubkey)
            || !is_hex_id(&record.action_event_id)
            || record.at <= 0
            || !optional_text_within(&record.note, MAX_PLAYBOOK_NOTE_CHARS)
        {
            return Err(CompanyRecordError::Invalid(
                "a hand-off record needs a valid step, actor, time and event id",
            ));
        }
    }
    Ok(())
}

// ── Job state machine ───────────────────────────────────────────────────────

fn find_job_step(head: &PlaybookJobHead, step_id: &str) -> Result<usize, PlanError> {
    head.steps
        .iter()
        .position(|step| step.step_id == step_id)
        .ok_or_else(|| invalid(format!("the job has no step {step_id}")))
}

/// Steps run in order: only the first step that has not ended moves.
fn require_current(head: &PlaybookJobHead, index: usize) -> Result<(), PlanError> {
    match current_index(&head.steps) {
        Some(current) if current == index => Ok(()),
        Some(current) => Err(conflict(format!(
            "step {} is not the current step; the job is at step {}",
            head.steps[index].step_id, head.steps[current].step_id
        ))),
        None => Err(conflict("every step of this job has ended")),
    }
}

fn actor_can_run_job_step(
    actor: &PlanActor,
    head: &PlaybookJobHead,
    step: &PlaybookJobStep,
) -> bool {
    if actor.role == PlanActorRole::Admin {
        return true;
    }
    // A step for a person is only ever moved by a person with authority.
    if step.owner.kind == PlanOwnerKind::Owner {
        return false;
    }
    if actor.role == PlanActorRole::Member {
        return false;
    }
    if actor.pubkey == head.started_by_pubkey {
        return true;
    }
    if step.owner.agent_pubkey.as_deref() == Some(actor.pubkey.as_str()) {
        return true;
    }
    step.owner
        .function
        .is_some_and(|function| actor.led_functions.contains(&function))
}

fn job_transition_allowed(step: &PlaybookJobStep, to: JobStepStatus) -> bool {
    let gated = step.approval_point.is_some();
    match (step.status, to) {
        (JobStepStatus::Pending, JobStepStatus::InProgress) => !gated,
        (JobStepStatus::Approved, JobStepStatus::InProgress) => true,
        (JobStepStatus::Blocked, JobStepStatus::InProgress) => true,
        (JobStepStatus::InProgress | JobStepStatus::Approved, JobStepStatus::Done) => true,
        // A prepared human step is done by the person without an in-progress hop.
        (JobStepStatus::Pending, JobStepStatus::Done) => {
            !gated && step.owner.kind == PlanOwnerKind::Owner
        }
        (JobStepStatus::Pending, JobStepStatus::Blocked) => !gated,
        (JobStepStatus::Approved | JobStepStatus::InProgress, JobStepStatus::Blocked) => true,
        (
            JobStepStatus::Pending
            | JobStepStatus::WaitingApproval
            | JobStepStatus::Approved
            | JobStepStatus::InProgress
            | JobStepStatus::Blocked,
            JobStepStatus::Skipped,
        ) => true,
        _ => false,
    }
}

/// Apply one job action to the current head and return the next head.
///
/// `playbook` is the playbook head the job names (only `start` reads it). The
/// caller (the relay broker) has already verified the signature, resolved
/// `actor` and checked `action.expected_head_event_id` against the stored job
/// head. This function owns every other rule.
pub fn apply_job_action(
    current: Option<&PlaybookJobHead>,
    playbook: Option<&PlaybookHead>,
    action: &PlaybookJobAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<PlaybookJobHead, PlanError> {
    validate_job_action(action).map_err(|error| invalid(error.to_string()))?;
    let Some(head) = current else {
        return start_job(playbook, action, actor, context);
    };
    if action.kind == JobActionKind::Start {
        return Err(conflict("a job with this id already exists"));
    }
    if head.job_id != action.job_id {
        return Err(invalid("the action names a different job than the head"));
    }
    if !head.status.is_open() {
        return Err(conflict("this job has already ended"));
    }
    let mut next = head.clone();
    match action.kind {
        JobActionKind::Start => return Err(conflict("a job with this id already exists")),
        JobActionKind::UpdateStep => update_job_step(&mut next, action, actor, context)?,
        JobActionKind::RequestStepApproval => {
            request_job_approval(&mut next, action, actor, context)?
        }
        JobActionKind::ApproveStep | JobActionKind::RejectStep => {
            decide_job_step(&mut next, action, actor, context)?
        }
        JobActionKind::HandOff => hand_off(&mut next, action, actor, context)?,
        JobActionKind::Cancel => cancel_job(&mut next, actor)?,
    }
    next.updated_by_pubkey = actor.pubkey.clone();
    next.updated_at = context.now;
    next.source_action_event_id = context.action_event_id.clone();
    if next.status == JobStatus::Running && next.steps.iter().all(|step| step.status.is_ended()) {
        next.status = JobStatus::Completed;
        next.ended_at = Some(context.now);
    }
    if next.status == JobStatus::Cancelled {
        next.ended_at = Some(context.now);
    }
    next.current_step_id = expected_current(&next);
    Ok(next)
}

fn start_job(
    playbook: Option<&PlaybookHead>,
    action: &PlaybookJobAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<PlaybookJobHead, PlanError> {
    if action.kind != JobActionKind::Start {
        return Err(conflict("this job does not exist"));
    }
    require_cofounder(context, "jobs cannot be started")?;
    require_agent_or_admin(actor, "start a job")?;
    let playbook = playbook.ok_or_else(|| conflict("that playbook does not exist"))?;
    if action.playbook_id.as_deref() != Some(playbook.playbook_id.as_str()) {
        return Err(invalid(
            "the action names a different playbook than the one given",
        ));
    }
    let content = match (&playbook.status, &playbook.current) {
        (PlaybookStatus::Active, Some(content)) => content,
        (PlaybookStatus::Archived, _) => {
            return Err(conflict(
                "that playbook is archived; jobs can no longer start from it",
            ))
        }
        _ => {
            return Err(conflict(
                "that playbook has no approved version yet; the owner has to approve it first",
            ))
        }
    };
    if let Some(wanted) = action.playbook_version {
        if wanted != playbook.version {
            return Err(conflict(format!(
                "the playbook moved on: it is now version {}",
                playbook.version
            )));
        }
    }
    let title = action
        .title
        .clone()
        .ok_or_else(|| invalid("start needs a title"))?;
    let steps = content
        .steps
        .iter()
        .map(|step| PlaybookJobStep {
            step_id: step.step_id.clone(),
            title: step.title.clone(),
            detail: step.detail.clone(),
            owner: step.owner.clone(),
            inputs: step.inputs.clone(),
            outputs: step.outputs.clone(),
            tools: step.tools.clone(),
            approval_point: step.approval_point.clone(),
            status: JobStepStatus::Pending,
            note: None,
            progress_label: None,
            status_at: context.now,
        })
        .collect::<Vec<_>>();
    let mut head = PlaybookJobHead {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        job_id: action.job_id.clone(),
        playbook_id: playbook.playbook_id.clone(),
        playbook_version: playbook.version,
        playbook_title: content.title.clone(),
        title,
        status: JobStatus::Running,
        current_step_id: None,
        steps,
        approvals: Vec::new(),
        handoffs: Vec::new(),
        started_by_pubkey: actor.pubkey.clone(),
        started_at: context.now,
        ended_at: None,
        updated_by_pubkey: actor.pubkey.clone(),
        updated_at: context.now,
        source_action_event_id: context.action_event_id.clone(),
    };
    head.current_step_id = expected_current(&head);
    Ok(head)
}

fn update_job_step(
    head: &mut PlaybookJobHead,
    action: &PlaybookJobAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    let step_id = action.step_id.as_deref().unwrap_or_default();
    let index = find_job_step(head, step_id)?;
    require_current(head, index)?;
    if !actor_can_run_job_step(actor, head, &head.steps[index]) {
        return Err(forbidden("you are not the doer of this step"));
    }
    let to = action
        .step_status
        .ok_or_else(|| invalid("update_step needs a stepStatus"))?;
    let step = &mut head.steps[index];
    if !job_transition_allowed(step, to) {
        return Err(conflict(
            match (step.status, step.approval_point.is_some()) {
                (JobStepStatus::Pending, true) | (JobStepStatus::WaitingApproval, _) => {
                    "this step waits for the owner's approval before it can run"
                }
                _ => "that step cannot move to that state from where it is",
            },
        ));
    }
    step.status = to;
    step.status_at = context.now;
    if action.note.is_some() {
        step.note = action.note.clone();
    }
    if action.progress_label.is_some() {
        step.progress_label = action.progress_label.clone();
    }
    Ok(())
}

fn request_job_approval(
    head: &mut PlaybookJobHead,
    action: &PlaybookJobAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    let step_id = action.step_id.as_deref().unwrap_or_default();
    let index = find_job_step(head, step_id)?;
    require_current(head, index)?;
    if !actor_can_run_job_step(actor, head, &head.steps[index]) {
        return Err(forbidden("you are not the doer of this step"));
    }
    let step = &mut head.steps[index];
    if step.approval_point.is_none() {
        return Err(conflict("this step has no approval point"));
    }
    if step.status != JobStepStatus::Pending {
        return Err(conflict("only a pending step can ask for approval"));
    }
    step.status = JobStepStatus::WaitingApproval;
    step.status_at = context.now;
    if action.note.is_some() {
        step.note = action.note.clone();
    }
    Ok(())
}

fn decide_job_step(
    head: &mut PlaybookJobHead,
    action: &PlaybookJobAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    let approving = action.kind == JobActionKind::ApproveStep;
    require_admin(
        actor,
        if approving {
            "approve a step"
        } else {
            "reject a step"
        },
    )?;
    let step_id = action.step_id.clone().unwrap_or_default();
    let index = find_job_step(head, &step_id)?;
    require_current(head, index)?;
    if head.approvals.len() >= MAX_JOB_APPROVALS {
        return Err(conflict("this job's approval record is full"));
    }
    let step = &mut head.steps[index];
    if step.approval_point.is_none() {
        return Err(conflict("this step has no approval point"));
    }
    if !matches!(
        step.status,
        JobStepStatus::Pending | JobStepStatus::WaitingApproval
    ) {
        return Err(conflict(
            "only a step that has not started can be approved or rejected",
        ));
    }
    step.status = if approving {
        JobStepStatus::Approved
    } else {
        JobStepStatus::Skipped
    };
    step.status_at = context.now;
    if action.note.is_some() {
        step.note = action.note.clone();
    }
    head.approvals.push(JobApprovalRecord {
        step_id,
        decision: if approving {
            JobDecision::Approved
        } else {
            JobDecision::Rejected
        },
        actor_pubkey: actor.pubkey.clone(),
        at: context.now,
        note: action.note.clone(),
        action_event_id: context.action_event_id.clone(),
    });
    Ok(())
}

fn hand_off(
    head: &mut PlaybookJobHead,
    action: &PlaybookJobAction,
    actor: &PlanActor,
    context: &PlanContext,
) -> Result<(), PlanError> {
    let step_id = action.step_id.clone().unwrap_or_default();
    let index = find_job_step(head, &step_id)?;
    if head.steps[index].status.is_ended() {
        return Err(conflict("a step that ended cannot be handed on"));
    }
    if !actor_can_run_job_step(actor, head, &head.steps[index]) {
        return Err(forbidden("you are not the doer of this step"));
    }
    if head.handoffs.len() >= MAX_JOB_HANDOFFS {
        return Err(conflict("this job's hand-off record is full"));
    }
    let to = action
        .hand_off_to
        .clone()
        .ok_or_else(|| invalid("hand_off needs handOffTo"))?;
    let step = &mut head.steps[index];
    if step.owner == to {
        return Err(conflict("the step already has that owner"));
    }
    validate_owner_and_gate(&to, &step.approval_point)
        .map_err(|error| invalid(error.to_string()))?;
    let from = std::mem::replace(&mut step.owner, to.clone());
    head.handoffs.push(JobHandoffRecord {
        step_id,
        from,
        to,
        by_pubkey: actor.pubkey.clone(),
        at: context.now,
        note: action.note.clone(),
        action_event_id: context.action_event_id.clone(),
    });
    Ok(())
}

fn cancel_job(head: &mut PlaybookJobHead, actor: &PlanActor) -> Result<(), PlanError> {
    if actor.pubkey != head.started_by_pubkey && actor.role != PlanActorRole::Admin {
        return Err(forbidden(
            "only whoever started the job, the owner or an admin can cancel it",
        ));
    }
    head.status = JobStatus::Cancelled;
    Ok(())
}

#[cfg(test)]
mod tests;
