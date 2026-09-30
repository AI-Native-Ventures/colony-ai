//! Shared typed content and validation for Colony company records.
//!
//! Company records (goals, asks, member positions, tool permissions and secret
//! bindings) are brokered like business records: a member signs a command, the
//! relay validates it and emits a relay-signed replaceable head. Goals,
//! positions, permissions and secret bindings are community-wide (no `h` tag);
//! asks live in a channel thread. See `docs/company-records.md` for the contract.
//!
//! This module holds the pure parts of the contract: typed content that
//! rejects unknown fields, per-action payload rules, the goal-tree cycle
//! check, ask response rules, secret binding rules and ask authority decision. The relay
//! supplies everything that needs I/O (current heads, roles, agent status).

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::company_members::MemberPositionActionKind;

/// Current company-record JSON schema version.
pub const COMPANY_RECORD_SCHEMA_VERSION: u8 = 1;

/// Longest goal or ask title, in characters.
pub const MAX_TITLE_CHARS: usize = 180;
/// Longest goal done condition, in characters.
pub const MAX_DONE_CONDITION_CHARS: usize = 1000;
/// Longest progress evidence note, in characters.
pub const MAX_EVIDENCE_CHARS: usize = 2000;
/// Longest ask body, in characters.
pub const MAX_ASK_BODY_CHARS: usize = 4000;
/// Longest exact tool action preview shown in a tool consent ask, in characters.
pub const MAX_TOOL_CONSENT_PREVIEW_CHARS: usize = 4000;
/// Longest exact action label on a standing permission, in characters.
pub const MAX_TOOL_PERMISSION_ACTION_CHARS: usize = 180;
/// Longest ask answer, in characters.
pub const MAX_ANSWER_CHARS: usize = 4000;
/// Longest human-readable secret binding name, in characters.
pub const MAX_SECRET_NAME_CHARS: usize = 120;
/// Longest tool name on a secret request or binding, in characters.
pub const MAX_SECRET_TOOL_CHARS: usize = 120;
/// Longest reason attached to a decision, status change or cancellation.
pub const MAX_REASON_CHARS: usize = 1000;
/// Longest target unit label, in characters.
pub const MAX_UNIT_CHARS: usize = 24;
/// Maximum goal-tree depth walked when checking for cycles.
pub const MAX_GOAL_DEPTH: usize = 64;

/// Errors returned while parsing or validating a company-record command.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CompanyRecordError {
    /// The event kind does not have a member-authored company command schema.
    #[error("unsupported company command kind")]
    UnsupportedKind,
    /// The JSON content does not match the kind's typed schema.
    #[error("invalid company record content")]
    InvalidContent,
    /// The record uses a schema version the relay does not understand.
    #[error("unsupported company record schema version")]
    UnsupportedSchemaVersion,
    /// The d-tag is not in the expected namespace for this record.
    #[error("company record d-tag does not match its namespace")]
    DTagMismatch,
    /// A field breaks a contract rule; the message names the field and rule.
    #[error("invalid company record: {0}")]
    Invalid(&'static str),
}

/// Member-authored company command content parsed by the relay broker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "record", rename_all = "snake_case")]
pub enum CompanyCommand {
    /// Goal mutation (kind 47031).
    GoalAction(GoalAction),
    /// Ask create or cancel (kind 47032).
    AskAction(Box<AskAction>),
    /// Ask resolution (kind 47033).
    AskResponse(AskResponse),
    /// Secret binding create, activation or revocation (kind 47036).
    SecretBindingAction(SecretBindingAction),
    /// Standing tool permission mutation (kind 47035).
    ToolPermissionAction(ToolPermissionAction),
    /// Member-position mutation (kind 47037).
    MemberPositionAction(crate::company_members::MemberPositionAction),
    /// Employee configuration revision (kind 47040).
    EmployeeRevisionAction(crate::company_employee_history::EmployeeRevisionAction),
    /// Hire proposal, founder approval or completion (kind 47039).
    HireAction(HireAction),
    /// Employee duty lifecycle action (kind 47044).
    DutyAction(crate::company_duties::DutyAction),
    /// Employee lesson lifecycle action (kind 47045).
    LessonAction(crate::company_lessons::LessonAction),
}

/// Storage location for a secret value. The value is never part of a company record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretStorage {
    /// The authenticated user's operating system credential store.
    Device,
    /// Shared encrypted relay storage. Unsupported by the current relay.
    Server,
}

/// Lifecycle status of a secret binding head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretBindingStatus {
    /// Metadata exists and is waiting for secure entry and activation.
    Pending,
    /// The binding may be used after the runtime verifies this current head.
    Active,
    /// Future use must be denied.
    Revoked,
}

/// Secret binding actions supported by the relay broker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretBindingActionKind {
    /// Create metadata without a value.
    Create,
    /// Activate after the value has been saved in the selected store.
    Activate,
    /// Revoke future uses of this binding.
    Revoke,
}

/// A channel ask that requested a secret binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretAskCoordinate {
    /// Channel containing the secret ask.
    pub channel_id: Uuid,
    /// Secret ask UUID.
    pub ask_id: Uuid,
}

/// Non-secret details an agent supplies when requesting a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretAskRequest {
    /// Name of the tool that needs the credential.
    pub tool_name: String,
    /// Client or service the requested credential is for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_name: Option<String>,
    /// Scope the requested binding should allow.
    pub allowed_use: String,
}

/// Metadata for one binding. This type deliberately has no value field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretBindingSpec {
    /// Schema version.
    pub schema_version: u8,
    /// Stable binding UUID.
    pub binding_id: Uuid,
    /// Human-readable connection name.
    pub name: String,
    /// Member or agent that may use this binding.
    pub employee_pubkey: String,
    /// Tool name this binding is scoped to.
    pub tool_name: String,
    /// Human-readable use scope.
    pub allowed_use: String,
    /// Device or server storage selection.
    pub storage: SecretStorage,
    /// Ask that led to this binding, when the binding resolves a request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ask: Option<SecretAskCoordinate>,
}

/// Member-signed create, activation or revocation command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretBindingAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable binding UUID.
    pub binding_id: Uuid,
    /// Requested lifecycle transition.
    pub action: SecretBindingActionKind,
    /// Exact current head for activation and revocation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Metadata, required only for create.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding: Option<SecretBindingSpec>,
}

/// Relay-signed canonical secret binding head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretBindingHead {
    /// Schema version.
    pub schema_version: u8,
    /// Binding metadata, never the value.
    pub binding: SecretBindingSpec,
    /// Relay-controlled lifecycle state.
    pub status: SecretBindingStatus,
    /// Member command that last advanced this head.
    pub source_action_event_id: String,
}

// ── Goals ────────────────────────────────────────────────────────────────────

/// Lifecycle status of a goal head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    /// Being worked on.
    Active,
    /// Behind plan; still open.
    OffPace,
    /// Explicitly marked achieved by someone with authority.
    Achieved,
    /// Hidden from active lists; history kept; restorable.
    Archived,
    /// Removed; a minimal head keeps references readable.
    Deleted,
}

/// A goal mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalActionKind {
    /// Create a goal that has no head.
    Create,
    /// Replace the goal's editable fields.
    Update,
    /// Record progress with evidence.
    Progress,
    /// Move between active, off pace and achieved.
    SetStatus,
    /// Archive the goal (sub-goals stay active).
    Archive,
    /// Restore an archived goal to active.
    Restore,
    /// Delete the goal when nothing depends on it.
    Delete,
}

/// Optional numeric target for a goal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GoalTarget {
    /// Target value as a decimal string, e.g. `"12"` or `"2.5"`.
    pub value: String,
    /// Unit label, e.g. `"clients"`.
    pub unit: String,
}

/// Editable goal fields supplied by a member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GoalRecord {
    /// Schema version.
    pub schema_version: u8,
    /// Stable goal UUID; equals the command's `goalId`.
    pub goal_id: Uuid,
    /// Parent goal for a sub-goal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_goal_id: Option<Uuid>,
    /// Goal title.
    pub title: String,
    /// Pubkey of the person or employee who owns the goal.
    pub owner_pubkey: String,
    /// Optional due date, `YYYY-MM-DD`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    /// Plain-language condition that means the goal is done.
    pub done_condition: String,
    /// Optional numeric target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<GoalTarget>,
    /// Channels where the goal is discussed.
    #[serde(default)]
    pub linked_channel_ids: Vec<Uuid>,
}

/// Progress recorded against a goal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GoalProgress {
    /// Current value as a decimal string; required when the goal has a target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    /// What shows the progress, in plain words.
    pub evidence: String,
    /// Event ids or `buzz://` links that back the evidence.
    #[serde(default)]
    pub evidence_refs: Vec<String>,
}

/// Member request to change a goal (kind 47031).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GoalAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable goal UUID.
    pub goal_id: Uuid,
    /// Requested mutation.
    pub action: GoalActionKind,
    /// Exact current head event id; omitted only on create.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Goal fields for create and update.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<GoalRecord>,
    /// Progress for the progress action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<GoalProgress>,
    /// Explicit target status for progress or set_status: active, off_pace or achieved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<GoalStatus>,
    /// Required for set_status; optional for archive and delete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Progress as stored on the head, with who recorded it and when.
// No deny_unknown_fields: serde does not support it together with flatten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedGoalProgress {
    /// The member-supplied progress.
    #[serde(flatten)]
    pub progress: GoalProgress,
    /// Who recorded it.
    pub recorded_by_pubkey: String,
    /// When it was recorded (RFC 3339).
    pub recorded_at: String,
}

/// Relay-authored canonical goal head (kind 30642).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GoalHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable goal UUID.
    pub goal_id: Uuid,
    /// Lifecycle status.
    pub status: GoalStatus,
    /// Title, kept on deleted heads so references can say what was deleted.
    pub title: String,
    /// Current goal fields; absent on a deleted head.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal: Option<GoalRecord>,
    /// Latest recorded progress.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<RecordedGoalProgress>,
    /// Event id of the member action that produced this head.
    pub source_action_event_id: String,
}

// ── Standing tool permissions ────────────────────────────────────────────────

/// Always-ask action a standing permission may authorize.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionVerb {
    /// Spend money or make a purchase.
    SpendMoney,
    /// Send a message to an outsider.
    MessageOutsider,
    /// Delete data.
    DeleteData,
    /// Publish content publicly.
    PublishPublicly,
}

impl ToolPermissionVerb {
    /// Stable permission action key corresponding to this sensitive action.
    pub const fn permission_key(self) -> &'static str {
        match self {
            Self::SpendMoney => "spend_money",
            Self::MessageOutsider => "message_outsider",
            Self::DeleteData => "delete_data",
            Self::PublishPublicly => "publish_publicly",
        }
    }
}

/// Kind of resource a standing tool permission is scoped to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionScopeKind {
    /// One canonical NIP-10 thread root event id.
    Thread,
    /// One channel UUID.
    Channel,
    /// One customer UUID.
    Customer,
}

/// Exact target covered by a standing tool permission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolPermissionScope {
    /// Resource kind.
    pub kind: ToolPermissionScopeKind,
    /// Stable id for the resource kind.
    pub id: String,
}

/// Permission fields supplied on grant and scope or expiry update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolPermissionRecord {
    /// Schema version.
    pub schema_version: u8,
    /// Stable permission UUID.
    pub permission_id: Uuid,
    /// Managed agent receiving the permission.
    pub agent_pubkey: String,
    /// Exact action label or stable sensitive-action key this record covers.
    pub action: String,
    /// Exact thread, channel or customer covered by this record.
    pub scope: ToolPermissionScope,
    /// RFC 3339 UTC expiry time.
    pub expires_at: String,
}

/// Operation requested by a standing tool permission command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionCommandKind {
    /// Create a new permission.
    Grant,
    /// Edit only the permission scope or expiry.
    Update,
    /// Revoke a permission while retaining its audit head.
    Revoke,
}

/// Member request to grant, update or revoke a tool permission (kind 47035).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolPermissionAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable permission UUID.
    pub permission_id: Uuid,
    /// Requested operation.
    pub action: ToolPermissionCommandKind,
    /// Exact current head event id; omitted only on grant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Permission fields on grant and update.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<ToolPermissionRecord>,
    /// Required reason on revoke.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Lifecycle status of a relay-signed tool permission head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionStatus {
    /// The record is not revoked. Expiry is checked separately.
    Active,
    /// The record was revoked by an owner or admin.
    Revoked,
}

/// Relay-authored canonical standing tool permission head (kind 30646).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolPermissionHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable permission UUID.
    pub permission_id: Uuid,
    /// Lifecycle status. Expiry is derived from `permission.expiresAt`.
    pub status: ToolPermissionStatus,
    /// Current action, agent, scope and expiry.
    pub permission: ToolPermissionRecord,
    /// Who originally granted the permission.
    pub granted_by_pubkey: String,
    /// Who last changed the permission head.
    pub changed_by_pubkey: String,
    /// RFC 3339 UTC timestamp of the last change.
    pub updated_at: String,
    /// Event id of the member action that produced this head.
    pub source_action_event_id: String,
}

/// Exact action preview shown on a tool consent ask.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolConsentPreview {
    /// Action category that triggered the consent request.
    pub action: ToolPermissionVerb,
    /// Exact bounded preview of the action for the human resolver.
    pub action_preview: String,
}

// ── Asks ─────────────────────────────────────────────────────────────────────

/// Kind of answer an ask needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskType {
    /// Approve, reject or request a revision.
    Approval,
    /// Approve or reject one exact tool invocation.
    ToolConsent,
    /// Free-text answer.
    Question,
    /// Pick one option.
    Choice,
    /// Confirm every checklist item.
    Checklist,
    /// Pass or fail with a reason.
    Verdict,
}

/// What an ask decides; controls who may resolve it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskCategory {
    /// Ordinary team decision.
    General,
    /// Spending money.
    Money,
    /// Hiring.
    Hire,
    /// Tool use or consent.
    Tool,
    /// Secret or credential handling.
    Secret,
    /// A proposed employee duty and its scheduled workflow.
    Duty,
}

impl AskCategory {
    /// Categories that only community owners and admins may resolve.
    pub const fn requires_authority(self) -> bool {
        !matches!(self, AskCategory::General)
    }
}

/// One choice option or checklist item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskOption {
    /// Stable id within the ask, `[a-z0-9_-]`, 1 to 32 characters.
    pub id: String,
    /// Label shown to people, 1 to 180 characters.
    pub label: String,
}

/// Record the ask is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AskSubjectKind {
    /// A goal (`buzz://goal/<id>`).
    Goal,
    /// A workflow run.
    WorkflowRun,
    /// A work item.
    WorkItem,
    /// A community member position.
    CompanyMember,
    /// A proposed employee hire.
    Hire,
    /// A proposed employee duty.
    Duty,
}

/// Optional link from an ask to the record it is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskSubject {
    /// Kind of record.
    pub kind: AskSubjectKind,
    /// Record id (UUID for goals and work items, run id for workflow runs).
    pub id: String,
}

/// Ask fields supplied by the asker on create.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskRecord {
    /// Schema version.
    pub schema_version: u8,
    /// Stable ask UUID; equals the command's `askId`.
    pub ask_id: Uuid,
    /// Kind of answer needed.
    #[serde(rename = "type")]
    pub ask_type: AskType,
    /// What the ask decides.
    pub category: AskCategory,
    /// Short question or decision.
    pub title: String,
    /// Optional markdown detail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Root event of the thread the card belongs to.
    pub thread_root_event_id: String,
    /// Optional person or employee the ask is addressed to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addressee_pubkey: Option<String>,
    /// Optional deadline (RFC 3339). Overdue is derived, never stored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decide_by: Option<String>,
    /// Options for a choice ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<AskOption>>,
    /// Items for a checklist ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<AskOption>>,
    /// Exact action preview for a tool consent ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_consent: Option<ToolConsentPreview>,
    /// Optional record the ask is about.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<AskSubject>,
    /// Member-position mutation requested by an approval ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member_proposal: Option<crate::company_members::MemberPositionAction>,
    /// Non-secret tool and scope details for a secret request.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_request: Option<SecretAskRequest>,
    /// Typed employee hire proposal attached to a hire approval ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hire_proposal: Option<HireProposal>,
    /// Typed duty proposal attached to an owner/admin approval ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duty_proposal: Option<crate::company_duties::DutyProposal>,
}

/// Risk level shown for one tool included in a role pack.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HireToolRisk {
    /// Read-only or otherwise low-impact tool access.
    Low,
    /// Tool access that can change company records or internal state.
    Medium,
    /// Tool access that can affect external people, systems or money.
    High,
}

/// A named tool and its human-reviewed risk label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HireTool {
    /// Tool identifier from the real role catalog.
    pub name: String,
    /// Risk label shown before founder sign-off.
    pub risk: HireToolRisk,
}

/// Role metadata projected from a real persona or team catalog record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HireRolePack {
    /// Stable persona or role catalog identifier.
    pub persona_id: String,
    /// Role title shown in the hiring flow.
    pub title: String,
    /// Job description for the role.
    pub job: String,
    /// Required or expected skills.
    pub skills: Vec<String>,
    /// Tools and their risk labels.
    pub tools: Vec<HireTool>,
    /// Available worker runtime identifiers from the live runtime catalog.
    pub worker_menu: Vec<String>,
    /// Optional allowance metadata supplied by this real catalog record.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_allowance: Option<String>,
}

/// The requested role and configured employee values for one hire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HireProposal {
    /// Stable UUID for the hire head.
    pub hire_id: Uuid,
    /// Snapshot of the selected real role pack.
    pub role_pack: HireRolePack,
    /// Employee display name; uniqueness is checked again on completion.
    pub display_name: String,
    /// Configured employee title, separate from the immutable role-pack title.
    pub title: String,
    /// Optional direct manager selected from the current company team.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manager_pubkey: Option<String>,
    /// Channel where the employee introduction will be posted.
    pub introduction_channel_id: Uuid,
    /// Runtime identifier selected from the live worker menu.
    pub runtime_id: String,
    /// Optional provider identifier selected from the live provider catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    /// Optional model identifier from the dynamic provider catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Optional configured allowance. Runtime enforcement is a separate API.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_allowance: Option<String>,
}

/// Lifecycle of a relay-signed hire head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HireStatus {
    /// Waiting for an owner or admin to resolve the proposal ask.
    Proposed,
    /// An admin approved the ask and the community owner must sign off.
    AwaitingFounder,
    /// The community owner signed off; employee creation may proceed.
    Approved,
    /// The employee identity and introduction post are recorded.
    Hired,
    /// The proposal was denied.
    Denied,
}

/// Relay-signed current employee hire head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HireHead {
    /// Schema version.
    pub schema_version: u8,
    /// Proposal and selected configuration.
    pub proposal: HireProposal,
    /// Relay-controlled lifecycle state.
    pub status: HireStatus,
    /// Member who first proposed this hire.
    pub proposed_by_pubkey: String,
    /// Source ask UUID for an employee-proposed hire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ask_id: Option<Uuid>,
    /// Channel containing the source ask, completing its exact coordinate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_ask_channel_id: Option<Uuid>,
    /// Community owner who signed founder approval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub founder_pubkey: Option<String>,
    /// Managed employee identity recorded after founder approval and before completion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub employee_pubkey: Option<String>,
    /// Introduction event id after completion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub introduction_event_id: Option<String>,
    /// Explanation when a proposal was denied.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub denial_reason: Option<String>,
    /// Member command that last advanced this head.
    pub source_action_event_id: String,
}

/// Hire lifecycle commands supported by the relay broker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HireActionKind {
    /// Create a direct owner/admin proposal before founder sign-off.
    Create,
    /// Replace an unapproved proposal at its exact current head.
    Update,
    /// Record the community owner's founder approval.
    Approve,
    /// Durably attach the owner-created managed employee before side effects.
    AttachEmployee,
    /// Record the created managed employee and introduction event.
    Complete,
    /// Deny an existing proposal.
    Deny,
}

/// Member-signed hire command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HireAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable hire UUID.
    pub hire_id: Uuid,
    /// Requested lifecycle transition.
    pub action: HireActionKind,
    /// Exact current head for every action except create.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Proposal payload, required only for create.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proposal: Option<HireProposal>,
    /// Created employee identity, required only for attachment and completion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub employee_pubkey: Option<String>,
    /// Introduction event id, required only for complete.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub introduction_event_id: Option<String>,
    /// Denial reason, required only for deny.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Stable d-tag for one hire head.
pub fn hire_d_tag(hire_id: Uuid) -> String {
    format!("company:hire:{hire_id}")
}

/// Validates role-pack metadata and the employee's selected configuration.
pub fn validate_hire_proposal(proposal: &HireProposal) -> Result<(), CompanyRecordError> {
    require_text(&proposal.role_pack.persona_id, 120, "personaId is required")?;
    require_text(
        &proposal.role_pack.title,
        MAX_TITLE_CHARS,
        "role title is required",
    )?;
    require_text(
        &proposal.role_pack.job,
        MAX_ASK_BODY_CHARS,
        "role job is required",
    )?;
    if proposal.role_pack.skills.len() > 32
        || proposal
            .role_pack
            .skills
            .iter()
            .any(|skill| skill.trim().is_empty() || char_len(skill) > MAX_TITLE_CHARS)
    {
        return Err(CompanyRecordError::Invalid(
            "role skills must be non-empty and limited to 32 entries",
        ));
    }
    if proposal.role_pack.tools.len() > 64 {
        return Err(CompanyRecordError::Invalid("role has too many tools"));
    }
    let mut tool_names = BTreeSet::new();
    for tool in &proposal.role_pack.tools {
        require_text(&tool.name, MAX_SECRET_TOOL_CHARS, "tool name is required")?;
        if !tool_names.insert(tool.name.to_lowercase()) {
            return Err(CompanyRecordError::Invalid("role tools must be unique"));
        }
    }
    if proposal.role_pack.worker_menu.is_empty() || proposal.role_pack.worker_menu.len() > 32 {
        return Err(CompanyRecordError::Invalid(
            "workerMenu needs 1 to 32 live runtime identifiers",
        ));
    }
    let mut workers = BTreeSet::new();
    for worker in &proposal.role_pack.worker_menu {
        require_text(worker, 120, "worker runtime identifier is required")?;
        if !workers.insert(worker.clone()) {
            return Err(CompanyRecordError::Invalid(
                "workerMenu entries must be unique",
            ));
        }
    }
    if !workers.contains(&proposal.runtime_id) {
        return Err(CompanyRecordError::Invalid(
            "runtimeId must be available in the role workerMenu",
        ));
    }
    if let Some(allowance) = proposal.role_pack.default_allowance.as_deref() {
        if !is_decimal(allowance) {
            return Err(CompanyRecordError::Invalid(
                "defaultAllowance must be a non-negative decimal",
            ));
        }
    }
    if let Some(allowance) = proposal.weekly_allowance.as_deref() {
        if !is_decimal(allowance) {
            return Err(CompanyRecordError::Invalid(
                "weeklyAllowance must be a non-negative decimal",
            ));
        }
    }
    require_text(
        &proposal.display_name,
        MAX_TITLE_CHARS,
        "employee displayName is required",
    )?;
    require_text(
        &proposal.title,
        MAX_TITLE_CHARS,
        "employee title is required",
    )?;
    require_text(&proposal.runtime_id, 120, "runtimeId is required")?;
    if let Some(provider_id) = proposal.provider_id.as_deref() {
        require_text(provider_id, 120, "providerId must not be empty")?;
    }
    if let Some(model_id) = proposal.model_id.as_deref() {
        require_text(model_id, 180, "modelId must not be empty")?;
    }
    if proposal
        .manager_pubkey
        .as_deref()
        .is_some_and(|manager| !is_hex_id(manager))
    {
        return Err(CompanyRecordError::Invalid(
            "managerPubkey must be a lowercase pubkey",
        ));
    }
    Ok(())
}

/// Validates which payload belongs to each hire lifecycle action.
pub fn validate_hire_action(action: &HireAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    validate_expected_head(
        action.expected_head_event_id.as_deref(),
        action.action == HireActionKind::Create,
    )?;
    match action.action {
        HireActionKind::Create => {
            let proposal = action.proposal.as_ref().ok_or(CompanyRecordError::Invalid(
                "create needs the hire proposal",
            ))?;
            if proposal.hire_id != action.hire_id
                || action.employee_pubkey.is_some()
                || action.introduction_event_id.is_some()
                || action.reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "create carries only a matching hire proposal",
                ));
            }
            validate_hire_proposal(proposal)
        }
        HireActionKind::Update => {
            let proposal = action.proposal.as_ref().ok_or(CompanyRecordError::Invalid(
                "update needs the hire proposal",
            ))?;
            if proposal.hire_id != action.hire_id
                || action.employee_pubkey.is_some()
                || action.introduction_event_id.is_some()
                || action.reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "update carries only a matching hire proposal",
                ));
            }
            validate_hire_proposal(proposal)
        }
        HireActionKind::Approve => {
            if action.proposal.is_some()
                || action.employee_pubkey.is_some()
                || action.introduction_event_id.is_some()
                || action.reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "approve does not carry a proposal, employee or reason",
                ));
            }
            Ok(())
        }
        HireActionKind::AttachEmployee => {
            let employee = action
                .employee_pubkey
                .as_deref()
                .ok_or(CompanyRecordError::Invalid(
                    "attach_employee needs employeePubkey",
                ))?;
            if action.proposal.is_some()
                || action.introduction_event_id.is_some()
                || action.reason.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "attach_employee carries only employeePubkey",
                ));
            }
            if !is_hex_id(employee) {
                return Err(CompanyRecordError::Invalid(
                    "employeePubkey must be a lowercase hex id",
                ));
            }
            Ok(())
        }
        HireActionKind::Complete => {
            let employee = action
                .employee_pubkey
                .as_deref()
                .ok_or(CompanyRecordError::Invalid("complete needs employeePubkey"))?;
            let introduction =
                action
                    .introduction_event_id
                    .as_deref()
                    .ok_or(CompanyRecordError::Invalid(
                        "complete needs introductionEventId",
                    ))?;
            if action.proposal.is_some() || action.reason.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "complete carries only employeePubkey and introductionEventId",
                ));
            }
            if !is_hex_id(employee) || !is_hex_id(introduction) {
                return Err(CompanyRecordError::Invalid(
                    "complete identity coordinates must be lowercase hex ids",
                ));
            }
            Ok(())
        }
        HireActionKind::Deny => {
            let reason = action
                .reason
                .as_deref()
                .ok_or(CompanyRecordError::Invalid("deny needs a reason"))?;
            require_text(reason, MAX_REASON_CHARS, "denial reason is required")?;
            if action.proposal.is_some()
                || action.employee_pubkey.is_some()
                || action.introduction_event_id.is_some()
            {
                return Err(CompanyRecordError::Invalid("deny carries only a reason"));
            }
            Ok(())
        }
    }
}

/// Ask create or cancel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskActionKind {
    /// Post a new ask into a thread.
    Create,
    /// Withdraw an open ask.
    Cancel,
}

/// Member request to create or cancel an ask (kind 47032).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable ask UUID.
    pub ask_id: Uuid,
    /// Create or cancel.
    pub action: AskActionKind,
    /// Exact current head; required on cancel, omitted on create.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
    /// Ask fields on create.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask: Option<AskRecord>,
    /// Required on cancel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// How an ask was resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskOutcome {
    /// Approval granted.
    Approved,
    /// Approval refused.
    Rejected,
    /// Approval sent back with changes requested.
    RevisionRequested,
    /// Question answered.
    Answered,
    /// Choice made.
    Chosen,
    /// Checklist confirmed.
    Confirmed,
    /// Verdict: passes.
    Pass,
    /// Verdict: fails.
    Fail,
    /// A secret request was resolved by creating and activating a binding.
    SecretBound,
}

/// Member resolution of an ask (kind 47033).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskResponse {
    /// Schema version.
    pub schema_version: u8,
    /// The ask being resolved.
    pub ask_id: Uuid,
    /// Exact current head event id.
    pub expected_head_event_id: String,
    /// Resolution outcome; must fit the ask's type.
    pub outcome: AskOutcome,
    /// Reason for approval decisions and verdicts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Answer to a question.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    /// Chosen option id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
    /// Every checklist item id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_item_ids: Option<Vec<String>>,
    /// Secret binding created for a secret ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_binding_id: Option<Uuid>,
}

/// Lifecycle status of an ask head.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskStatus {
    /// Waiting for an answer (may be overdue).
    Open,
    /// Answered or decided.
    Resolved,
    /// Withdrawn by the asker or an admin.
    Cancelled,
}

/// Resolution stored on the head.
// No deny_unknown_fields: serde does not support it together with flatten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskResolution {
    /// Outcome and payload exactly as submitted.
    #[serde(flatten)]
    pub response: AskResolutionPayload,
    /// Who resolved it.
    pub resolved_by_pubkey: String,
    /// When (RFC 3339).
    pub resolved_at: String,
    /// The kind 47033 event.
    pub response_event_id: String,
}

/// Outcome and payload fields copied from the response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskResolutionPayload {
    /// Outcome.
    pub outcome: AskOutcome,
    /// Reason, when the outcome needs one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Answer, for questions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    /// Chosen option, for choices.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
    /// Confirmed items, for checklists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_item_ids: Option<Vec<String>>,
    /// Binding created to resolve a secret ask.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_binding_id: Option<Uuid>,
}

/// Cancellation stored on the head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskCancellation {
    /// Who cancelled.
    pub cancelled_by_pubkey: String,
    /// When (RFC 3339).
    pub cancelled_at: String,
    /// Why.
    pub reason: String,
}

/// Relay-authored canonical ask head (kind 30643).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AskHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable ask UUID.
    pub ask_id: Uuid,
    /// Lifecycle status.
    pub status: AskStatus,
    /// Who asked.
    pub asker_pubkey: String,
    /// When the ask was created (RFC 3339).
    pub created_at: String,
    /// The ask as created.
    pub ask: AskRecord,
    /// Present once resolved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<AskResolution>,
    /// Present once cancelled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancellation: Option<AskCancellation>,
    /// Event id of the member action or response that produced this head.
    pub source_action_event_id: String,
}

// ── Coordinates ──────────────────────────────────────────────────────────────

/// d-tag of a goal command or head.
pub fn goal_d_tag(goal_id: Uuid) -> String {
    format!("company:goal:{goal_id}")
}

/// d-tag of an ask command or head.
pub fn ask_d_tag(channel_id: Uuid, ask_id: Uuid) -> String {
    format!("channel:{channel_id}:ask:{ask_id}")
}

/// Company-wide coordinate for a secret binding.
pub fn secret_binding_d_tag(binding_id: Uuid) -> String {
    format!("company:secret:{binding_id}")
}

/// Validates a secret binding d-tag against its UUID.
pub fn validate_secret_binding_d_tag(
    d_tag: &str,
    binding_id: Uuid,
) -> Result<(), CompanyRecordError> {
    if d_tag == secret_binding_d_tag(binding_id) {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// d-tag of a standing tool permission command or head.
pub fn tool_permission_d_tag(permission_id: Uuid) -> String {
    format!("company:permission:{permission_id}")
}

/// Checks a goal command's d-tag against its goal id.
pub fn validate_goal_d_tag(d_tag: &str, goal_id: Uuid) -> Result<(), CompanyRecordError> {
    if d_tag == goal_d_tag(goal_id) {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// Checks an ask command's d-tag against its channel and ask id.
pub fn validate_ask_d_tag(
    d_tag: &str,
    channel_id: Uuid,
    ask_id: Uuid,
) -> Result<(), CompanyRecordError> {
    if d_tag == ask_d_tag(channel_id, ask_id) {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// Checks a tool permission command's d-tag against its stable permission id.
pub fn validate_tool_permission_d_tag(
    d_tag: &str,
    permission_id: Uuid,
) -> Result<(), CompanyRecordError> {
    if d_tag == tool_permission_d_tag(permission_id) {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/// Parses a member-authored company command and checks its schema version.
pub fn parse_company_command(
    kind: u32,
    content: &str,
) -> Result<CompanyCommand, CompanyRecordError> {
    let command = match kind {
        crate::kind::KIND_GOAL_ACTION => {
            serde_json::from_str::<GoalAction>(content).map(CompanyCommand::GoalAction)
        }
        crate::kind::KIND_ASK_ACTION => serde_json::from_str::<AskAction>(content)
            .map(|action| CompanyCommand::AskAction(Box::new(action))),
        crate::kind::KIND_ASK_RESPONSE => {
            serde_json::from_str::<AskResponse>(content).map(CompanyCommand::AskResponse)
        }
        crate::kind::KIND_SECRET_BINDING_ACTION => {
            serde_json::from_str::<SecretBindingAction>(content)
                .map(CompanyCommand::SecretBindingAction)
        }
        crate::kind::KIND_TOOL_PERMISSION_ACTION => {
            serde_json::from_str::<ToolPermissionAction>(content)
                .map(CompanyCommand::ToolPermissionAction)
        }
        crate::kind::KIND_MEMBER_POSITION_ACTION => {
            serde_json::from_str::<crate::company_members::MemberPositionAction>(content)
                .map(CompanyCommand::MemberPositionAction)
        }
        crate::kind::KIND_EMPLOYEE_REVISION_ACTION => {
            serde_json::from_str::<crate::company_employee_history::EmployeeRevisionAction>(content)
                .map(CompanyCommand::EmployeeRevisionAction)
        }
        crate::kind::KIND_HIRE_ACTION => {
            serde_json::from_str::<HireAction>(content).map(CompanyCommand::HireAction)
        }
        crate::kind::KIND_DUTY_ACTION => {
            serde_json::from_str::<crate::company_duties::DutyAction>(content)
                .map(CompanyCommand::DutyAction)
        }
        crate::kind::KIND_LESSON_ACTION => {
            serde_json::from_str::<crate::company_lessons::LessonAction>(content)
                .map(CompanyCommand::LessonAction)
        }
        _ => return Err(CompanyRecordError::UnsupportedKind),
    }
    .map_err(|_| CompanyRecordError::InvalidContent)?;

    let schema_version = match &command {
        CompanyCommand::GoalAction(value) => value.schema_version,
        CompanyCommand::AskAction(value) => value.schema_version,
        CompanyCommand::AskResponse(value) => value.schema_version,
        CompanyCommand::SecretBindingAction(value) => value.schema_version,
        CompanyCommand::ToolPermissionAction(value) => value.schema_version,
        CompanyCommand::MemberPositionAction(value) => value.schema_version,
        CompanyCommand::EmployeeRevisionAction(value) => value.schema_version,
        CompanyCommand::HireAction(value) => value.schema_version,
        CompanyCommand::DutyAction(value) => value.schema_version,
        CompanyCommand::LessonAction(value) => value.schema_version,
    };
    if schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    Ok(command)
}

// ── Field rules ──────────────────────────────────────────────────────────────

fn char_len(value: &str) -> usize {
    value.chars().count()
}

fn require_text(value: &str, max: usize, rule: &'static str) -> Result<(), CompanyRecordError> {
    let len = char_len(value.trim());
    if len == 0 || char_len(value) > max {
        return Err(CompanyRecordError::Invalid(rule));
    }
    Ok(())
}

/// Returns `true` for a 64-character lowercase hex event id or pubkey.
pub fn is_hex_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Returns `true` for a non-negative decimal string such as `12` or `2.50`.
pub fn is_decimal(value: &str) -> bool {
    if value.is_empty() || value.len() > 30 {
        return false;
    }
    let mut parts = value.splitn(2, '.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next();
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    digits(whole) && fraction.is_none_or(digits)
}

fn is_option_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 32
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
}

fn is_rfc3339(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

fn is_date(value: &str) -> bool {
    value.len() == 10 && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

fn validate_expected_head(expected: Option<&str>, create: bool) -> Result<(), CompanyRecordError> {
    match (create, expected) {
        (true, None) => Ok(()),
        (true, Some(_)) => Err(CompanyRecordError::Invalid(
            "expectedHeadEventId must be omitted on create",
        )),
        (false, Some(id)) if is_hex_id(id) => Ok(()),
        (false, _) => Err(CompanyRecordError::Invalid(
            "expectedHeadEventId must name the current head",
        )),
    }
}

/// Validates a goal's editable fields.
pub fn validate_goal_record(goal: &GoalRecord) -> Result<(), CompanyRecordError> {
    if goal.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    require_text(
        &goal.title,
        MAX_TITLE_CHARS,
        "title is required, 180 characters at most",
    )?;
    require_text(
        &goal.done_condition,
        MAX_DONE_CONDITION_CHARS,
        "doneCondition is required, 1000 characters at most",
    )?;
    if !is_hex_id(&goal.owner_pubkey) {
        return Err(CompanyRecordError::Invalid("ownerPubkey must be a pubkey"));
    }
    if goal.parent_goal_id == Some(goal.goal_id) {
        return Err(CompanyRecordError::Invalid(
            "a goal cannot be its own parent",
        ));
    }
    if let Some(due) = &goal.due_date {
        if !is_date(due) {
            return Err(CompanyRecordError::Invalid("dueDate must be YYYY-MM-DD"));
        }
    }
    if let Some(target) = &goal.target {
        if !is_decimal(&target.value) {
            return Err(CompanyRecordError::Invalid(
                "target value must be a decimal number",
            ));
        }
        require_text(
            &target.unit,
            MAX_UNIT_CHARS,
            "target unit is required, 24 characters at most",
        )?;
    }
    let unique: BTreeSet<_> = goal.linked_channel_ids.iter().collect();
    if unique.len() != goal.linked_channel_ids.len() || goal.linked_channel_ids.len() > 50 {
        return Err(CompanyRecordError::Invalid(
            "linkedChannelIds must be unique, 50 at most",
        ));
    }
    Ok(())
}

/// Validates recorded progress; `has_target` is whether the goal has a target.
pub fn validate_goal_progress(
    progress: &GoalProgress,
    has_target: bool,
) -> Result<(), CompanyRecordError> {
    require_text(
        &progress.evidence,
        MAX_EVIDENCE_CHARS,
        "progress needs evidence, 2000 characters at most",
    )?;
    match (&progress.current, has_target) {
        (Some(value), true) if is_decimal(value) => {}
        (None, false) => {}
        (_, true) => {
            return Err(CompanyRecordError::Invalid(
                "progress current must be a decimal number for a goal with a target",
            ))
        }
        (Some(_), false) => {
            return Err(CompanyRecordError::Invalid(
                "progress current is only allowed when the goal has a target",
            ))
        }
    }
    if progress.evidence_refs.len() > 20
        || progress
            .evidence_refs
            .iter()
            .any(|r| !(is_hex_id(r) || (r.starts_with("buzz://") && r.len() <= 512)))
    {
        return Err(CompanyRecordError::Invalid(
            "evidenceRefs must be event ids or buzz:// links, 20 at most",
        ));
    }
    Ok(())
}

/// Validates a goal action's shape: which payload each action carries.
///
/// Rules that need the current head (target presence for progress, parent
/// existence, cycles, dependents on delete, authority) are checked by the
/// relay with [`goal_parent_creates_cycle`] and the stored heads.
pub fn validate_goal_action(action: &GoalAction) -> Result<(), CompanyRecordError> {
    use GoalActionKind as A;
    validate_expected_head(
        action.expected_head_event_id.as_deref(),
        action.action == A::Create,
    )?;
    let payload_ok = match action.action {
        A::Create | A::Update => {
            action.goal.is_some()
                && action.progress.is_none()
                && action.status.is_none()
                && action.reason.is_none()
        }
        A::Progress => {
            action.goal.is_none() && action.progress.is_some() && action.reason.is_none()
        }
        A::SetStatus => {
            action.goal.is_none()
                && action.progress.is_none()
                && action.status.is_some()
                && action.reason.is_some()
        }
        A::Archive | A::Delete => {
            action.goal.is_none() && action.progress.is_none() && action.status.is_none()
        }
        A::Restore => {
            action.goal.is_none()
                && action.progress.is_none()
                && action.status.is_none()
                && action.reason.is_none()
        }
    };
    if !payload_ok {
        return Err(CompanyRecordError::Invalid(
            "payload does not match the goal action",
        ));
    }
    if let Some(goal) = &action.goal {
        if goal.goal_id != action.goal_id {
            return Err(CompanyRecordError::Invalid("goal.goalId must equal goalId"));
        }
        validate_goal_record(goal)?;
    }
    if let Some(status) = action.status {
        if !matches!(
            status,
            GoalStatus::Active | GoalStatus::OffPace | GoalStatus::Achieved
        ) {
            return Err(CompanyRecordError::Invalid(
                "goal status must be active, off_pace or achieved",
            ));
        }
    }
    if let Some(reason) = &action.reason {
        require_text(
            reason,
            MAX_REASON_CHARS,
            "reason is required, 1000 characters at most",
        )?;
    }
    Ok(())
}

/// Returns `true` when making `new_parent` the parent of `goal_id` would
/// create a cycle, or when the chain is deeper than [`MAX_GOAL_DEPTH`].
///
/// `parent_of` returns the current parent of a goal from stored heads.
pub fn goal_parent_creates_cycle(
    goal_id: Uuid,
    new_parent: Uuid,
    parent_of: impl Fn(Uuid) -> Option<Uuid>,
) -> bool {
    let mut cursor = Some(new_parent);
    for _ in 0..MAX_GOAL_DEPTH {
        match cursor {
            None => return false,
            Some(id) if id == goal_id => return true,
            Some(id) => cursor = parent_of(id),
        }
    }
    true
}

/// Validates a standing permission's stable identity, target scope and expiry.
pub fn validate_tool_permission_record(
    permission: &ToolPermissionRecord,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), CompanyRecordError> {
    if permission.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_hex_id(&permission.agent_pubkey) {
        return Err(CompanyRecordError::Invalid(
            "agentPubkey must be a lowercase public key",
        ));
    }
    require_text(
        &permission.action,
        MAX_TOOL_PERMISSION_ACTION_CHARS,
        "action is required, 180 characters at most",
    )?;
    if ![
        ToolPermissionVerb::SpendMoney.permission_key(),
        ToolPermissionVerb::MessageOutsider.permission_key(),
        ToolPermissionVerb::DeleteData.permission_key(),
        ToolPermissionVerb::PublishPublicly.permission_key(),
    ]
    .contains(&permission.action.as_str())
    {
        return Err(CompanyRecordError::Invalid(
            "action must be one of the always-ask action values",
        ));
    }
    let valid_scope = match permission.scope.kind {
        ToolPermissionScopeKind::Thread => is_hex_id(&permission.scope.id),
        ToolPermissionScopeKind::Channel | ToolPermissionScopeKind::Customer => {
            is_canonical_uuid(&permission.scope.id)
        }
    };
    if !valid_scope {
        return Err(CompanyRecordError::Invalid(
            "scope id does not match its thread, channel or customer kind",
        ));
    }
    let expires_at = parse_utc_timestamp(&permission.expires_at).ok_or(
        CompanyRecordError::Invalid("expiresAt must be an RFC 3339 UTC timestamp"),
    )?;
    if expires_at <= now {
        return Err(CompanyRecordError::Invalid(
            "expiresAt must be later than command acceptance",
        ));
    }
    Ok(())
}

/// Validates a permission mutation's expected-head and action payload rules.
pub fn validate_tool_permission_action(
    action: &ToolPermissionAction,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<(), CompanyRecordError> {
    validate_expected_head(
        action.expected_head_event_id.as_deref(),
        action.action == ToolPermissionCommandKind::Grant,
    )?;
    match action.action {
        ToolPermissionCommandKind::Grant | ToolPermissionCommandKind::Update => {
            let permission = action
                .permission
                .as_ref()
                .ok_or(CompanyRecordError::Invalid(
                    "grant or update needs the permission",
                ))?;
            if action.reason.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "grant or update does not take a reason",
                ));
            }
            if permission.permission_id != action.permission_id {
                return Err(CompanyRecordError::Invalid(
                    "permission.permissionId must equal permissionId",
                ));
            }
            validate_tool_permission_record(permission, now)
        }
        ToolPermissionCommandKind::Revoke => {
            if action.permission.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "revoke does not carry the permission",
                ));
            }
            let reason = action
                .reason
                .as_deref()
                .ok_or(CompanyRecordError::Invalid("revoke needs a reason"))?;
            require_text(
                reason,
                MAX_REASON_CHARS,
                "reason is required, 1000 characters at most",
            )
        }
    }
}

/// Returns whether an active permission authorizes this exact agent, action,
/// scope and time. Callers must load and verify the relay-signed current head.
pub fn tool_permission_matches(
    head: &ToolPermissionHead,
    agent_pubkey: &str,
    action: ToolPermissionVerb,
    scope: &ToolPermissionScope,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    head.status == ToolPermissionStatus::Active
        && head.permission.agent_pubkey == agent_pubkey
        && head.permission.action == action.permission_key()
        && head.permission.scope == *scope
        && parse_utc_timestamp(&head.permission.expires_at)
            .is_some_and(|expires_at| expires_at > now)
}

fn is_canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

fn parse_utc_timestamp(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .filter(|timestamp| timestamp.offset().local_minus_utc() == 0)
        .map(|timestamp| timestamp.with_timezone(&chrono::Utc))
}

/// Validates an ask as created.
///
/// `addressee_is_agent` comes from the relay's account record; an agent may
/// only be asked questions and verdicts.
pub fn validate_ask_record(
    ask: &AskRecord,
    addressee_is_agent: bool,
) -> Result<(), CompanyRecordError> {
    if ask.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    require_text(
        &ask.title,
        MAX_TITLE_CHARS,
        "title is required, 180 characters at most",
    )?;
    if let Some(body) = &ask.body {
        if char_len(body) > MAX_ASK_BODY_CHARS {
            return Err(CompanyRecordError::Invalid(
                "body is 4000 characters at most",
            ));
        }
    }
    match (ask.category, ask.secret_request.as_ref()) {
        (AskCategory::Secret, Some(request)) => {
            if ask.ask_type != AskType::Question {
                return Err(CompanyRecordError::Invalid(
                    "a secret request must be a question",
                ));
            }
            require_text(
                &request.tool_name,
                MAX_SECRET_TOOL_CHARS,
                "secret tool name is required, 120 characters at most",
            )?;
            if let Some(client_name) = &request.client_name {
                require_text(
                    client_name,
                    MAX_SECRET_NAME_CHARS,
                    "secret client name must be 120 characters at most",
                )?;
            }
            require_text(
                &request.allowed_use,
                MAX_DONE_CONDITION_CHARS,
                "secret allowedUse is required, 1000 characters at most",
            )?;
        }
        (AskCategory::Secret, None) => {
            return Err(CompanyRecordError::Invalid(
                "a secret ask needs non-secret tool and allowedUse details",
            ));
        }
        (_, Some(_)) => {
            return Err(CompanyRecordError::Invalid(
                "secret request details are only valid for secret asks",
            ));
        }
        (_, None) => {}
    }
    if !is_hex_id(&ask.thread_root_event_id) {
        return Err(CompanyRecordError::Invalid(
            "threadRootEventId must be an event id",
        ));
    }
    if let Some(addressee) = &ask.addressee_pubkey {
        if !is_hex_id(addressee) {
            return Err(CompanyRecordError::Invalid(
                "addresseePubkey must be a pubkey",
            ));
        }
        if addressee_is_agent && !matches!(ask.ask_type, AskType::Question | AskType::Verdict) {
            return Err(CompanyRecordError::Invalid(
                "an agent can only be asked a question or a verdict",
            ));
        }
    }
    if let Some(deadline) = &ask.decide_by {
        if !is_rfc3339(deadline) {
            return Err(CompanyRecordError::Invalid(
                "decideBy must be an RFC 3339 timestamp",
            ));
        }
    }
    let check_list = |list: &Vec<AskOption>, min: usize, max: usize, rule: &'static str| {
        let ids: BTreeSet<_> = list.iter().map(|o| o.id.as_str()).collect();
        let ok = list.len() >= min
            && list.len() <= max
            && ids.len() == list.len()
            && list.iter().all(|o| {
                is_option_id(&o.id)
                    && !o.label.trim().is_empty()
                    && char_len(&o.label) <= MAX_TITLE_CHARS
            });
        if ok {
            Ok(())
        } else {
            Err(CompanyRecordError::Invalid(rule))
        }
    };
    match ask.ask_type {
        AskType::Choice => {
            if ask.items.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "a choice ask has options, not items",
                ));
            }
            let options = ask.options.as_ref().ok_or(CompanyRecordError::Invalid(
                "a choice ask needs 2 to 8 options",
            ))?;
            check_list(
                options,
                2,
                8,
                "a choice ask needs 2 to 8 options with unique ids",
            )?;
        }
        AskType::Checklist => {
            if ask.options.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "a checklist ask has items, not options",
                ));
            }
            let items = ask.items.as_ref().ok_or(CompanyRecordError::Invalid(
                "a checklist ask needs 1 to 20 items",
            ))?;
            check_list(
                items,
                1,
                20,
                "a checklist ask needs 1 to 20 items with unique ids",
            )?;
        }
        AskType::Approval | AskType::Question | AskType::Verdict => {
            if ask.options.is_some() || ask.items.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "only choice and checklist asks carry options or items",
                ));
            }
        }
        AskType::ToolConsent => {
            if ask.category != AskCategory::Tool {
                return Err(CompanyRecordError::Invalid(
                    "a tool consent ask must use the tool category",
                ));
            }
            if ask.options.is_some() || ask.items.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "a tool consent ask does not carry options or items",
                ));
            }
            let preview = ask
                .tool_consent
                .as_ref()
                .ok_or(CompanyRecordError::Invalid(
                    "a tool consent ask needs the exact action preview",
                ))?;
            require_text(
                &preview.action_preview,
                MAX_TOOL_CONSENT_PREVIEW_CHARS,
                "actionPreview is required, 4000 characters at most",
            )?;
        }
    }
    if ask.ask_type != AskType::ToolConsent && ask.tool_consent.is_some() {
        return Err(CompanyRecordError::Invalid(
            "only a tool consent ask carries toolConsent",
        ));
    }
    if let Some(subject) = &ask.subject {
        let ok = match subject.kind {
            AskSubjectKind::Goal | AskSubjectKind::WorkItem => Uuid::parse_str(&subject.id).is_ok(),
            AskSubjectKind::WorkflowRun => !subject.id.is_empty() && subject.id.len() <= 64,
            AskSubjectKind::Hire | AskSubjectKind::Duty => is_canonical_uuid(&subject.id),
            AskSubjectKind::CompanyMember => {
                subject.id.len() == 64
                    && subject
                        .id
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            }
        };
        if !ok {
            return Err(CompanyRecordError::Invalid(
                "subject id does not match its kind",
            ));
        }
    }
    if let Some(proposal) = ask.hire_proposal.as_ref() {
        validate_hire_proposal(proposal)?;
        if !matches!(
            ask.subject.as_ref(),
            Some(AskSubject {
                kind: AskSubjectKind::Hire,
                id,
            }) if id == &proposal.hire_id.to_string()
        ) || ask.ask_type != AskType::Approval
            || ask.category != AskCategory::Hire
            || ask.member_proposal.is_some()
            || ask.secret_request.is_some()
            || ask.options.is_some()
            || ask.items.is_some()
        {
            return Err(CompanyRecordError::Invalid(
                "hire proposals need a hire subject and a hire approval ask",
            ));
        }
    } else if ask
        .subject
        .as_ref()
        .is_some_and(|subject| subject.kind == AskSubjectKind::Hire)
    {
        return Err(CompanyRecordError::Invalid(
            "hire subjects need a hireProposal",
        ));
    }
    if let Some(proposal) = ask.duty_proposal.as_ref() {
        crate::company_duties::validate_duty_proposal(proposal)?;
        if !matches!(
            ask.subject.as_ref(),
            Some(AskSubject {
                kind: AskSubjectKind::Duty,
                id,
            }) if id == &proposal.duty_id.to_string()
        ) || ask.ask_type != AskType::Approval
            || ask.category != AskCategory::Duty
            || ask.addressee_pubkey.is_some()
            || ask.member_proposal.is_some()
            || ask.secret_request.is_some()
            || ask.hire_proposal.is_some()
            || ask.options.is_some()
            || ask.items.is_some()
        {
            return Err(CompanyRecordError::Invalid(
                "duty proposals need an unaddressed duty approval ask",
            ));
        }
    } else if ask
        .subject
        .as_ref()
        .is_some_and(|subject| subject.kind == AskSubjectKind::Duty)
        || ask.category == AskCategory::Duty
    {
        return Err(CompanyRecordError::Invalid(
            "duty approval asks need a dutyProposal",
        ));
    }
    match (&ask.subject, &ask.member_proposal) {
        (Some(subject), Some(proposal)) => {
            let required_category = match proposal.action {
                MemberPositionActionKind::Terminate | MemberPositionActionKind::Rehire => {
                    AskCategory::Hire
                }
                _ => AskCategory::General,
            };
            if subject.kind != AskSubjectKind::CompanyMember
                || subject.id != proposal.pubkey
                || ask.ask_type != AskType::Approval
                || ask.category != required_category
                || ask.addressee_pubkey.is_none()
                || ask.options.is_some()
                || ask.items.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "member proposals need an addressed general approval ask for that member",
                ));
            }
            crate::company_members::validate_member_position_action(proposal)?;
        }
        (Some(subject), None) if subject.kind == AskSubjectKind::CompanyMember => {
            return Err(CompanyRecordError::Invalid(
                "company member subjects need a memberProposal",
            ));
        }
        (None, Some(_)) => {
            return Err(CompanyRecordError::Invalid(
                "memberProposal needs a company member subject",
            ));
        }
        _ => {}
    }
    Ok(())
}

/// Validates an ask action's shape.
pub fn validate_ask_action(
    action: &AskAction,
    addressee_is_agent: bool,
) -> Result<(), CompanyRecordError> {
    validate_expected_head(
        action.expected_head_event_id.as_deref(),
        action.action == AskActionKind::Create,
    )?;
    match action.action {
        AskActionKind::Create => {
            let ask = action
                .ask
                .as_ref()
                .ok_or(CompanyRecordError::Invalid("create needs the ask"))?;
            if action.reason.is_some() {
                return Err(CompanyRecordError::Invalid("create does not take a reason"));
            }
            if ask.ask_id != action.ask_id {
                return Err(CompanyRecordError::Invalid("ask.askId must equal askId"));
            }
            validate_ask_record(ask, addressee_is_agent)
        }
        AskActionKind::Cancel => {
            if action.ask.is_some() {
                return Err(CompanyRecordError::Invalid("cancel does not carry the ask"));
            }
            let reason = action
                .reason
                .as_deref()
                .ok_or(CompanyRecordError::Invalid("cancel needs a reason"))?;
            require_text(
                reason,
                MAX_REASON_CHARS,
                "reason is required, 1000 characters at most",
            )
        }
    }
}

/// Validates a response against the ask it resolves.
pub fn validate_ask_response(
    ask: &AskRecord,
    response: &AskResponse,
) -> Result<(), CompanyRecordError> {
    use AskOutcome as O;
    if !is_hex_id(&response.expected_head_event_id) {
        return Err(CompanyRecordError::Invalid(
            "expectedHeadEventId must name the current head",
        ));
    }
    if ask.category == AskCategory::Secret {
        if ask.ask_type != AskType::Question
            || response.outcome != AskOutcome::SecretBound
            || response.reason.is_some()
            || response.answer.is_some()
            || response.option_id.is_some()
            || response.checked_item_ids.is_some()
            || response.secret_binding_id.is_none()
        {
            return Err(CompanyRecordError::Invalid(
                "a secret ask resolves only to a secret binding id",
            ));
        }
        return Ok(());
    }
    if response.outcome == AskOutcome::SecretBound || response.secret_binding_id.is_some() {
        return Err(CompanyRecordError::Invalid(
            "secret binding references are only valid for secret asks",
        ));
    }
    if ask.hire_proposal.is_some() && !matches!(response.outcome, O::Approved | O::Rejected) {
        return Err(CompanyRecordError::Invalid(
            "a hire proposal is approved or rejected with a reason",
        ));
    }
    let (reason, answer, option, checked) = (
        response.reason.as_deref(),
        response.answer.as_deref(),
        response.option_id.as_deref(),
        response.checked_item_ids.as_ref(),
    );
    match ask.ask_type {
        AskType::ToolConsent => {
            if !matches!(response.outcome, O::Approved | O::Rejected)
                || answer.is_some()
                || option.is_some()
                || checked.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "a tool consent ask is approved or rejected with a reason",
                ));
            }
            require_text(
                reason.unwrap_or_default(),
                MAX_REASON_CHARS,
                "a reason is required, 1000 characters at most",
            )
        }
        AskType::Approval | AskType::Verdict => {
            let allowed = match ask.ask_type {
                AskType::Approval => matches!(
                    response.outcome,
                    O::Approved | O::Rejected | O::RevisionRequested
                ),
                _ => matches!(response.outcome, O::Pass | O::Fail),
            };
            if !allowed {
                return Err(CompanyRecordError::Invalid(
                    "outcome does not fit the ask type",
                ));
            }
            if answer.is_some() || option.is_some() || checked.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "only a reason goes with this outcome",
                ));
            }
            if ask.hire_proposal.is_some() && reason.is_none() {
                Ok(())
            } else {
                require_text(
                    reason.unwrap_or_default(),
                    MAX_REASON_CHARS,
                    "a reason is required, 1000 characters at most",
                )
            }
        }
        AskType::Question => {
            if response.outcome != O::Answered
                || reason.is_some()
                || option.is_some()
                || checked.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "a question is resolved with an answer",
                ));
            }
            require_text(
                answer.unwrap_or_default(),
                MAX_ANSWER_CHARS,
                "an answer is required, 4000 characters at most",
            )
        }
        AskType::Choice => {
            if response.outcome != O::Chosen
                || reason.is_some()
                || answer.is_some()
                || checked.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "a choice is resolved with one option",
                ));
            }
            let valid = option.is_some_and(|id| {
                ask.options
                    .as_ref()
                    .is_some_and(|opts| opts.iter().any(|o| o.id == id))
            });
            if valid {
                Ok(())
            } else {
                Err(CompanyRecordError::Invalid(
                    "optionId must be one of the ask's options",
                ))
            }
        }
        AskType::Checklist => {
            if response.outcome != O::Confirmed
                || reason.is_some()
                || answer.is_some()
                || option.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "a checklist is resolved by confirming every item",
                ));
            }
            let expected: BTreeSet<&str> = ask
                .items
                .as_ref()
                .map(|items| items.iter().map(|i| i.id.as_str()).collect())
                .unwrap_or_default();
            let given: Vec<&str> = checked
                .map(|ids| ids.iter().map(String::as_str).collect())
                .unwrap_or_default();
            let given_set: BTreeSet<&str> = given.iter().copied().collect();
            if given_set.len() == given.len() && given_set == expected {
                Ok(())
            } else {
                Err(CompanyRecordError::Invalid(
                    "every checklist item must be confirmed exactly once",
                ))
            }
        }
    }
}

/// Validates metadata-only secret binding actions.
pub fn validate_secret_binding_action(
    action: &SecretBindingAction,
) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    match action.action {
        SecretBindingActionKind::Create => {
            if action.expected_head_event_id.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "create does not carry an expected head",
                ));
            }
            let binding = action
                .binding
                .as_ref()
                .ok_or(CompanyRecordError::Invalid("create needs binding metadata"))?;
            if binding.binding_id != action.binding_id {
                return Err(CompanyRecordError::Invalid(
                    "binding.bindingId must equal bindingId",
                ));
            }
            validate_secret_binding_spec(binding)
        }
        SecretBindingActionKind::Activate | SecretBindingActionKind::Revoke => {
            if action.binding.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "activation and revocation do not carry binding metadata",
                ));
            }
            let expected = action
                .expected_head_event_id
                .as_deref()
                .ok_or(CompanyRecordError::Invalid("action needs the current head"))?;
            if !is_hex_id(expected) {
                return Err(CompanyRecordError::Invalid(
                    "expectedHeadEventId must name the current head",
                ));
            }
            Ok(())
        }
    }
}

/// Validates a secret binding's non-secret metadata.
pub fn validate_secret_binding_spec(binding: &SecretBindingSpec) -> Result<(), CompanyRecordError> {
    if binding.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    require_text(
        &binding.name,
        MAX_SECRET_NAME_CHARS,
        "secret name is required, 120 characters at most",
    )?;
    if !is_hex_id(&binding.employee_pubkey) {
        return Err(CompanyRecordError::Invalid(
            "employeePubkey must be a pubkey",
        ));
    }
    require_text(
        &binding.tool_name,
        MAX_SECRET_TOOL_CHARS,
        "secret tool name is required, 120 characters at most",
    )?;
    require_text(
        &binding.allowed_use,
        MAX_DONE_CONDITION_CHARS,
        "secret allowedUse is required, 1000 characters at most",
    )?;
    Ok(())
}

/// Community role of a would-be resolver, from the relay's member records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommunityRole {
    /// Community owner.
    Owner,
    /// Community admin.
    Admin,
    /// Ordinary member.
    Member,
}

/// Facts about the signer that the relay looks up before authorising.
#[derive(Debug, Clone, Copy)]
pub struct AskResolver<'a> {
    /// Signer pubkey.
    pub pubkey: &'a str,
    /// Whether the signer is a managed agent (from `users.agent_owner_pubkey`).
    pub is_agent: bool,
    /// Community role, if the signer is a community member.
    pub community_role: Option<CommunityRole>,
    /// Whether the signer is a member of the ask's channel.
    pub is_channel_member: bool,
}

/// Returns why `resolver` may not resolve `ask`, or `None` when allowed.
///
/// Owner decision D2: owners and admins resolve money, hire, tool, secret and
/// duty asks and agents never may; an addressed general ask is resolved by its
/// addressee (agents only for questions and verdicts); an unaddressed general
/// ask by any human member of the channel.
pub fn ask_resolution_denied_reason(
    ask: &AskRecord,
    resolver: AskResolver<'_>,
) -> Option<&'static str> {
    let authority_resolver = matches!(
        resolver.community_role,
        Some(CommunityRole::Owner | CommunityRole::Admin)
    );
    if !(resolver.is_channel_member || ask.category.requires_authority() && authority_resolver) {
        return Some("Only members of this conversation can answer");
    }
    if ask.category.requires_authority() {
        if resolver.is_agent {
            return Some("Agents cannot decide spending, hires, tools, secrets or duties");
        }
        return match resolver.community_role {
            Some(CommunityRole::Owner | CommunityRole::Admin) => None,
            _ => Some("Only company owners and admins can decide this"),
        };
    }
    if ask.member_proposal.is_some() {
        if resolver.is_agent {
            return Some("Agents cannot approve member-position proposals");
        }
        if matches!(
            resolver.community_role,
            Some(CommunityRole::Owner | CommunityRole::Admin)
        ) {
            return None;
        }
    }
    match &ask.addressee_pubkey {
        Some(addressee) if addressee != resolver.pubkey => {
            Some("This ask is addressed to someone else")
        }
        Some(_)
            if resolver.is_agent
                && !matches!(ask.ask_type, AskType::Question | AskType::Verdict) =>
        {
            Some("Agents can only answer questions and verdicts")
        }
        Some(_) => None,
        None if resolver.is_agent => {
            Some("Only people can answer an ask that is not addressed to anyone")
        }
        None if !resolver.is_channel_member => Some("Only members of this conversation can answer"),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PK_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const PK_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const EV: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    fn goal(id: u128) -> GoalRecord {
        GoalRecord {
            schema_version: 1,
            goal_id: Uuid::from_u128(id),
            parent_goal_id: None,
            title: "Make every client's October plan ready on time".into(),
            owner_pubkey: PK_A.into(),
            due_date: Some("2026-10-31".into()),
            done_condition: "Every active client has an approved October plan".into(),
            target: None,
            linked_channel_ids: vec![],
        }
    }

    fn goal_action(action: GoalActionKind) -> GoalAction {
        GoalAction {
            schema_version: 1,
            goal_id: Uuid::from_u128(1),
            action,
            expected_head_event_id: (action != GoalActionKind::Create).then(|| EV.into()),
            goal: None,
            progress: None,
            status: None,
            reason: None,
        }
    }

    fn ask(ask_type: AskType) -> AskRecord {
        AskRecord {
            schema_version: 1,
            ask_id: Uuid::from_u128(9),
            ask_type,
            category: AskCategory::General,
            title: "Choose the campaign direction".into(),
            body: None,
            thread_root_event_id: EV.into(),
            addressee_pubkey: None,
            decide_by: None,
            options: None,
            items: None,
            tool_consent: None,
            subject: None,
            member_proposal: None,
            secret_request: None,
            hire_proposal: None,
            duty_proposal: None,
        }
    }

    fn opts(ids: &[&str]) -> Vec<AskOption> {
        ids.iter()
            .map(|id| AskOption {
                id: (*id).into(),
                label: format!("Option {id}"),
            })
            .collect()
    }

    fn response(outcome: AskOutcome) -> AskResponse {
        AskResponse {
            schema_version: 1,
            ask_id: Uuid::from_u128(9),
            expected_head_event_id: EV.into(),
            outcome,
            reason: None,
            answer: None,
            option_id: None,
            checked_item_ids: None,
            secret_binding_id: None,
        }
    }

    fn secret_ask() -> AskRecord {
        let mut ask = ask(AskType::Question);
        ask.category = AskCategory::Secret;
        ask.secret_request = Some(SecretAskRequest {
            tool_name: "Social publishing".into(),
            client_name: Some("Olive Studio".into()),
            allowed_use: "Prepare Olive Studio drafts".into(),
        });
        ask
    }

    fn hire_proposal() -> HireProposal {
        HireProposal {
            hire_id: Uuid::from_u128(42),
            role_pack: HireRolePack {
                persona_id: "persona-social-lead".into(),
                title: "Social Media Manager".into(),
                job: "Prepare and review company social content".into(),
                skills: vec!["Editorial planning".into(), "Reporting".into()],
                tools: vec![HireTool {
                    name: "social_draft".into(),
                    risk: HireToolRisk::Medium,
                }],
                worker_menu: vec!["runtime-available".into()],
                default_allowance: None,
            },
            display_name: "Social Media Manager".into(),
            title: "Social Media Manager".into(),
            manager_pubkey: Some(PK_A.into()),
            introduction_channel_id: Uuid::from_u128(43),
            runtime_id: "runtime-available".into(),
            provider_id: Some("provider-current".into()),
            model_id: Some("model-current".into()),
            weekly_allowance: None,
        }
    }

    fn tool_permission(now: chrono::DateTime<chrono::Utc>) -> ToolPermissionRecord {
        ToolPermissionRecord {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id: Uuid::from_u128(21),
            agent_pubkey: PK_A.into(),
            action: ToolPermissionVerb::MessageOutsider.permission_key().into(),
            scope: ToolPermissionScope {
                kind: ToolPermissionScopeKind::Thread,
                id: EV.into(),
            },
            expires_at: (now + chrono::Duration::hours(1)).to_rfc3339(),
        }
    }

    fn human(role: Option<CommunityRole>, member: bool) -> AskResolver<'static> {
        AskResolver {
            pubkey: PK_B,
            is_agent: false,
            community_role: role,
            is_channel_member: member,
        }
    }

    #[test]
    fn d_tags_are_namespaced_and_checked() {
        let channel = Uuid::from_u128(6);
        let id = Uuid::from_u128(7);
        assert_eq!(goal_d_tag(id), format!("company:goal:{id}"));
        assert_eq!(
            ask_d_tag(channel, id),
            format!("channel:{channel}:ask:{id}")
        );
        assert!(validate_goal_d_tag(&goal_d_tag(id), id).is_ok());
        assert_eq!(
            validate_goal_d_tag(&goal_d_tag(Uuid::from_u128(8)), id),
            Err(CompanyRecordError::DTagMismatch)
        );
        assert_eq!(
            validate_ask_d_tag(&ask_d_tag(channel, id), channel, Uuid::from_u128(8)),
            Err(CompanyRecordError::DTagMismatch)
        );
        assert_eq!(
            tool_permission_d_tag(id),
            format!("company:permission:{id}")
        );
        assert!(validate_tool_permission_d_tag(&tool_permission_d_tag(id), id).is_ok());
    }

    #[test]
    fn parse_rejects_unknown_fields_and_versions() {
        let mut action = goal_action(GoalActionKind::Create);
        action.goal = Some(goal(1));
        let json = serde_json::to_string(&action).unwrap();
        assert!(matches!(
            parse_company_command(crate::kind::KIND_GOAL_ACTION, &json),
            Ok(CompanyCommand::GoalAction(_))
        ));
        let with_extra = json.replacen('{', "{\"future\":1,", 1);
        assert_eq!(
            parse_company_command(crate::kind::KIND_GOAL_ACTION, &with_extra),
            Err(CompanyRecordError::InvalidContent)
        );
        let v2 = json.replace("\"schemaVersion\":1", "\"schemaVersion\":2");
        assert_eq!(
            parse_company_command(crate::kind::KIND_GOAL_ACTION, &v2),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
        assert_eq!(
            parse_company_command(crate::kind::KIND_WORK_ITEM_ACTION, &json),
            Err(CompanyRecordError::UnsupportedKind)
        );
    }

    #[test]
    fn member_proposals_require_an_addressed_general_approval_for_that_member() {
        let proposal = crate::company_members::MemberPositionAction {
            schema_version: 1,
            pubkey: PK_A.into(),
            action: crate::company_members::MemberPositionActionKind::SetTitle,
            expected_head_event_id: Some(EV.into()),
            title: Some("Operations lead".into()),
            manager_pubkey: None,
            reason: None,
        };
        let mut request = ask(AskType::Approval);
        request.addressee_pubkey = Some(PK_B.into());
        request.subject = Some(AskSubject {
            kind: AskSubjectKind::CompanyMember,
            id: PK_A.into(),
        });
        request.member_proposal = Some(proposal);
        assert!(validate_ask_record(&request, false).is_ok());

        request.ask_type = AskType::Question;
        assert!(validate_ask_record(&request, false).is_err());
        request.ask_type = AskType::Approval;
        request.category = AskCategory::Hire;
        assert!(validate_ask_record(&request, false).is_err());
        request.category = AskCategory::General;
        request.subject.as_mut().expect("subject").id = PK_B.into();
        assert!(validate_ask_record(&request, false).is_err());
    }

    #[test]
    fn hire_proposals_require_a_typed_hire_approval_ask() {
        let proposal = hire_proposal();
        let mut request = ask(AskType::Approval);
        request.category = AskCategory::Hire;
        request.subject = Some(AskSubject {
            kind: AskSubjectKind::Hire,
            id: proposal.hire_id.to_string(),
        });
        request.hire_proposal = Some(proposal.clone());
        assert!(validate_ask_record(&request, false).is_ok());

        request.ask_type = AskType::Question;
        assert!(validate_ask_record(&request, false).is_err());
        request.ask_type = AskType::Approval;
        request.subject.as_mut().expect("subject").id = Uuid::from_u128(44).to_string();
        assert!(validate_ask_record(&request, false).is_err());

        request.subject.as_mut().expect("subject").id = proposal.hire_id.to_string();
        request.hire_proposal = None;
        assert!(validate_ask_record(&request, false).is_err());

        let mut resolved_ask = ask(AskType::Approval);
        resolved_ask.category = AskCategory::Hire;
        resolved_ask.subject = Some(AskSubject {
            kind: AskSubjectKind::Hire,
            id: proposal.hire_id.to_string(),
        });
        resolved_ask.hire_proposal = Some(proposal);
        let approved = response(AskOutcome::Approved);
        assert!(validate_ask_response(&resolved_ask, &approved).is_ok());
        let mut rejected = response(AskOutcome::Rejected);
        assert!(validate_ask_response(&resolved_ask, &rejected).is_ok());
        rejected.reason = Some("   ".into());
        assert!(validate_ask_response(&resolved_ask, &rejected).is_err());
        let mut revision = approved;
        revision.outcome = AskOutcome::RevisionRequested;
        assert!(validate_ask_response(&resolved_ask, &revision).is_err());
    }

    #[test]
    fn hire_action_payloads_are_exact_and_use_the_dynamic_worker_menu() {
        let proposal = hire_proposal();
        let create = HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: proposal.hire_id,
            action: HireActionKind::Create,
            expected_head_event_id: None,
            proposal: Some(proposal.clone()),
            employee_pubkey: None,
            introduction_event_id: None,
            reason: None,
        };
        assert!(validate_hire_action(&create).is_ok());

        let mut update = create.clone();
        update.action = HireActionKind::Update;
        update.expected_head_event_id = Some(EV.into());
        assert!(validate_hire_action(&update).is_ok());
        update.expected_head_event_id = None;
        assert!(validate_hire_action(&update).is_err());

        let mut no_provider = create.clone();
        no_provider.proposal.as_mut().expect("proposal").provider_id = None;
        assert!(validate_hire_action(&no_provider).is_ok());

        let mut missing_title = create.clone();
        missing_title
            .proposal
            .as_mut()
            .expect("proposal")
            .title
            .clear();
        assert!(validate_hire_action(&missing_title).is_err());

        let attach = HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: proposal.hire_id,
            action: HireActionKind::AttachEmployee,
            expected_head_event_id: Some(EV.into()),
            proposal: None,
            employee_pubkey: Some(PK_B.into()),
            introduction_event_id: None,
            reason: None,
        };
        assert!(validate_hire_action(&attach).is_ok());
        let mut malformed_attach = attach;
        malformed_attach.introduction_event_id = Some(EV.into());
        assert!(validate_hire_action(&malformed_attach).is_err());

        let mut unavailable_runtime = create.clone();
        unavailable_runtime
            .proposal
            .as_mut()
            .expect("proposal")
            .runtime_id = "hard-coded-runtime".into();
        assert!(validate_hire_action(&unavailable_runtime).is_err());

        let mut with_preset_amount = create;
        with_preset_amount
            .proposal
            .as_mut()
            .expect("proposal")
            .weekly_allowance = Some("not-a-number".into());
        assert!(validate_hire_action(&with_preset_amount).is_err());

        let mut invalid_manager = hire_proposal();
        invalid_manager.manager_pubkey = Some("not-a-pubkey".into());
        assert!(validate_hire_proposal(&invalid_manager).is_err());

        let deny = HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: proposal.hire_id,
            action: HireActionKind::Deny,
            expected_head_event_id: Some(EV.into()),
            proposal: None,
            employee_pubkey: None,
            introduction_event_id: None,
            reason: Some("Role is not approved".into()),
        };
        assert!(validate_hire_action(&deny).is_ok());
    }

    #[test]
    fn goal_actions_carry_exactly_their_payload() {
        let mut create = goal_action(GoalActionKind::Create);
        create.goal = Some(goal(1));
        assert!(validate_goal_action(&create).is_ok());

        let mut create_with_head = create.clone();
        create_with_head.expected_head_event_id = Some(EV.into());
        assert!(validate_goal_action(&create_with_head).is_err());

        let mut update_without_head = goal_action(GoalActionKind::Update);
        update_without_head.expected_head_event_id = None;
        update_without_head.goal = Some(goal(1));
        assert!(validate_goal_action(&update_without_head).is_err());

        let mut archive = goal_action(GoalActionKind::Archive);
        assert!(validate_goal_action(&archive).is_ok());
        archive.reason = Some("Client paused the retainer".into());
        assert!(validate_goal_action(&archive).is_ok());
        archive.reason = Some("  ".into());
        assert!(validate_goal_action(&archive).is_err());

        let delete = goal_action(GoalActionKind::Delete);
        assert!(validate_goal_action(&delete).is_ok());
        let mut delete_with_empty_reason = delete.clone();
        delete_with_empty_reason.reason = Some(" ".into());
        assert!(validate_goal_action(&delete_with_empty_reason).is_err());

        let mut progress = goal_action(GoalActionKind::Progress);
        progress.progress = Some(GoalProgress {
            current: None,
            evidence: "The client approved the draft".into(),
            evidence_refs: Vec::new(),
        });
        progress.status = Some(GoalStatus::Achieved);
        assert!(validate_goal_action(&progress).is_ok());

        progress.reason = Some("A second payload is not allowed".into());
        assert!(validate_goal_action(&progress).is_err());

        let mut status = goal_action(GoalActionKind::SetStatus);
        status.status = Some(GoalStatus::Active);
        assert!(validate_goal_action(&status).is_err());
        status.reason = Some("Confirmed with the client".into());
        status.status = Some(GoalStatus::Archived);
        assert!(
            validate_goal_action(&status).is_err(),
            "archive has its own action"
        );
        status.status = Some(GoalStatus::Achieved);
        assert!(validate_goal_action(&status).is_ok());

        let mut mismatched = create.clone();
        mismatched.goal = Some(goal(2));
        assert!(validate_goal_action(&mismatched).is_err());
    }

    #[test]
    fn goal_fields_are_validated() {
        let mut g = goal(1);
        assert!(validate_goal_record(&g).is_ok());
        g.title = "   ".into();
        assert!(validate_goal_record(&g).is_err());
        g = goal(1);
        g.title = "x".repeat(181);
        assert!(validate_goal_record(&g).is_err());
        g = goal(1);
        g.due_date = Some("2026-02-30".into());
        assert!(validate_goal_record(&g).is_err());
        g = goal(1);
        g.parent_goal_id = Some(g.goal_id);
        assert!(validate_goal_record(&g).is_err());
        g = goal(1);
        g.target = Some(GoalTarget {
            value: "12".into(),
            unit: String::new(),
        });
        assert!(validate_goal_record(&g).is_err(), "a target needs a unit");
        g.target = Some(GoalTarget {
            value: "1.2.3".into(),
            unit: "clients".into(),
        });
        assert!(validate_goal_record(&g).is_err());
        g.target = Some(GoalTarget {
            value: "12.5".into(),
            unit: "clients".into(),
        });
        assert!(validate_goal_record(&g).is_ok());
    }

    #[test]
    fn progress_needs_evidence_and_a_value_only_with_a_target() {
        let p = |current: Option<&str>, evidence: &str| GoalProgress {
            current: current.map(Into::into),
            evidence: evidence.into(),
            evidence_refs: vec![],
        };
        assert!(validate_goal_progress(&p(Some("4"), "4 of 12 plans approved"), true).is_ok());
        assert!(validate_goal_progress(&p(None, "4 of 12 plans approved"), true).is_err());
        assert!(validate_goal_progress(&p(Some("4"), ""), true).is_err());
        assert!(validate_goal_progress(&p(None, "Brief agreed"), false).is_ok());
        assert!(validate_goal_progress(&p(Some("4"), "Brief agreed"), false).is_err());
        let mut with_refs = p(None, "Brief agreed");
        with_refs.evidence_refs = vec![EV.into(), "buzz://message?channel=x&id=y".into()];
        assert!(validate_goal_progress(&with_refs, false).is_ok());
        with_refs.evidence_refs.push("https://example.com".into());
        assert!(validate_goal_progress(&with_refs, false).is_err());
    }

    #[test]
    fn cycles_are_detected_through_the_parent_chain() {
        // 1 <- 2 <- 3 (3's parent is 2, 2's parent is 1)
        let parents = |id: Uuid| match id.as_u128() {
            3 => Some(Uuid::from_u128(2)),
            2 => Some(Uuid::from_u128(1)),
            _ => None,
        };
        assert!(goal_parent_creates_cycle(
            Uuid::from_u128(1),
            Uuid::from_u128(3),
            parents
        ));
        assert!(!goal_parent_creates_cycle(
            Uuid::from_u128(4),
            Uuid::from_u128(3),
            parents
        ));
        // A corrupt self-referencing chain never loops forever.
        assert!(goal_parent_creates_cycle(
            Uuid::from_u128(9),
            Uuid::from_u128(8),
            |_| Some(Uuid::from_u128(8))
        ));
    }

    #[test]
    fn tool_permission_actions_validate_identity_scope_expiry_and_cas() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-28T12:00:00Z")
            .expect("fixed test timestamp")
            .with_timezone(&chrono::Utc);
        let permission = tool_permission(now);
        assert!(validate_tool_permission_record(&permission, now).is_ok());

        let mut expired = permission.clone();
        expired.expires_at = now.to_rfc3339();
        assert!(validate_tool_permission_record(&expired, now).is_err());

        let mut invalid_scope = permission.clone();
        invalid_scope.scope.kind = ToolPermissionScopeKind::Customer;
        assert!(validate_tool_permission_record(&invalid_scope, now).is_err());

        let mut unknown_action = permission.clone();
        unknown_action.action = "read_client_reports".into();
        assert!(validate_tool_permission_record(&unknown_action, now).is_err());

        let grant = ToolPermissionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id: permission.permission_id,
            action: ToolPermissionCommandKind::Grant,
            expected_head_event_id: None,
            permission: Some(permission.clone()),
            reason: None,
        };
        assert!(validate_tool_permission_action(&grant, now).is_ok());

        let mut update = grant.clone();
        update.action = ToolPermissionCommandKind::Update;
        update.expected_head_event_id = Some(EV.into());
        assert!(validate_tool_permission_action(&update, now).is_ok());
        update.expected_head_event_id = None;
        assert!(validate_tool_permission_action(&update, now).is_err());

        let revoke = ToolPermissionAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id: permission.permission_id,
            action: ToolPermissionCommandKind::Revoke,
            expected_head_event_id: Some(EV.into()),
            permission: None,
            reason: Some("Access no longer needed".into()),
        };
        assert!(validate_tool_permission_action(&revoke, now).is_ok());
    }

    #[test]
    fn standing_permission_matches_only_the_exact_active_unexpired_grant() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-28T12:00:00Z")
            .expect("fixed test timestamp")
            .with_timezone(&chrono::Utc);
        let permission = tool_permission(now);
        let head = ToolPermissionHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            permission_id: permission.permission_id,
            status: ToolPermissionStatus::Active,
            permission: permission.clone(),
            granted_by_pubkey: PK_B.into(),
            changed_by_pubkey: PK_B.into(),
            updated_at: now.to_rfc3339(),
            source_action_event_id: EV.into(),
        };
        assert!(tool_permission_matches(
            &head,
            PK_A,
            ToolPermissionVerb::MessageOutsider,
            &permission.scope,
            now
        ));
        assert!(!tool_permission_matches(
            &head,
            PK_B,
            ToolPermissionVerb::MessageOutsider,
            &permission.scope,
            now
        ));
        assert!(!tool_permission_matches(
            &head,
            PK_A,
            ToolPermissionVerb::DeleteData,
            &permission.scope,
            now
        ));
        let other_scope = ToolPermissionScope {
            kind: ToolPermissionScopeKind::Thread,
            id: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd".into(),
        };
        assert!(!tool_permission_matches(
            &head,
            PK_A,
            ToolPermissionVerb::MessageOutsider,
            &other_scope,
            now
        ));
        let expired_now = now + chrono::Duration::hours(1);
        assert!(!tool_permission_matches(
            &head,
            PK_A,
            ToolPermissionVerb::MessageOutsider,
            &permission.scope,
            expired_now
        ));
        let mut revoked = head;
        revoked.status = ToolPermissionStatus::Revoked;
        assert!(!tool_permission_matches(
            &revoked,
            PK_A,
            ToolPermissionVerb::MessageOutsider,
            &permission.scope,
            now
        ));
    }

    #[test]
    fn asks_validate_their_type_specific_fields() {
        assert!(validate_ask_record(&ask(AskType::Question), false).is_ok());

        let mut choice = ask(AskType::Choice);
        assert!(
            validate_ask_record(&choice, false).is_err(),
            "choice needs options"
        );
        choice.options = Some(opts(&["a"]));
        assert!(
            validate_ask_record(&choice, false).is_err(),
            "at least two options"
        );
        choice.options = Some(opts(&["a", "a"]));
        assert!(validate_ask_record(&choice, false).is_err(), "unique ids");
        choice.options = Some(opts(&["a", "b", "c"]));
        assert!(validate_ask_record(&choice, false).is_ok());

        let mut checklist = ask(AskType::Checklist);
        checklist.items = Some(opts(&["brief", "assets"]));
        assert!(validate_ask_record(&checklist, false).is_ok());
        checklist.options = Some(opts(&["x", "y"]));
        assert!(validate_ask_record(&checklist, false).is_err());

        let mut approval = ask(AskType::Approval);
        approval.options = Some(opts(&["a", "b"]));
        assert!(validate_ask_record(&approval, false).is_err());

        let mut timed = ask(AskType::Question);
        timed.decide_by = Some("tomorrow".into());
        assert!(validate_ask_record(&timed, false).is_err());
        timed.decide_by = Some("2026-09-28T14:00:00Z".into());
        assert!(validate_ask_record(&timed, false).is_ok());

        let mut tool_consent = ask(AskType::ToolConsent);
        tool_consent.category = AskCategory::Tool;
        tool_consent.tool_consent = Some(ToolConsentPreview {
            action: ToolPermissionVerb::MessageOutsider,
            action_preview: "Send this email to x@y.com: Hello".into(),
        });
        assert!(validate_ask_record(&tool_consent, false).is_ok());
        tool_consent.category = AskCategory::General;
        assert!(validate_ask_record(&tool_consent, false).is_err());
        tool_consent.category = AskCategory::Tool;
        tool_consent
            .tool_consent
            .as_mut()
            .unwrap()
            .action_preview
            .clear();
        assert!(validate_ask_record(&tool_consent, false).is_err());
    }

    #[test]
    fn agents_can_only_be_asked_questions_and_verdicts() {
        let mut approval = ask(AskType::Approval);
        approval.addressee_pubkey = Some(PK_A.into());
        assert!(validate_ask_record(&approval, true).is_err());
        assert!(validate_ask_record(&approval, false).is_ok());
        let mut question = ask(AskType::Question);
        question.addressee_pubkey = Some(PK_A.into());
        assert!(validate_ask_record(&question, true).is_ok());
    }

    #[test]
    fn ask_actions_carry_exactly_their_payload() {
        let create = AskAction {
            schema_version: 1,
            ask_id: Uuid::from_u128(9),
            action: AskActionKind::Create,
            expected_head_event_id: None,
            ask: Some(ask(AskType::Question)),
            reason: None,
        };
        assert!(validate_ask_action(&create, false).is_ok());
        let mut cancel = AskAction {
            action: AskActionKind::Cancel,
            expected_head_event_id: Some(EV.into()),
            ask: None,
            reason: None,
            ..create.clone()
        };
        assert!(
            validate_ask_action(&cancel, false).is_err(),
            "cancel needs a reason"
        );
        cancel.reason = Some("Decided in the huddle".into());
        assert!(validate_ask_action(&cancel, false).is_ok());
        let mut mismatched = create;
        mismatched.ask_id = Uuid::from_u128(10);
        assert!(validate_ask_action(&mismatched, false).is_err());
    }

    #[test]
    fn responses_must_fit_the_ask_type() {
        let approval = ask(AskType::Approval);
        let mut r = response(AskOutcome::Approved);
        assert!(
            validate_ask_response(&approval, &r).is_err(),
            "approval needs a reason"
        );
        r.reason = Some("Within budget".into());
        assert!(validate_ask_response(&approval, &r).is_ok());
        r.outcome = AskOutcome::Pass;
        assert!(validate_ask_response(&approval, &r).is_err());

        let mut consent = ask(AskType::ToolConsent);
        consent.category = AskCategory::Tool;
        consent.tool_consent = Some(ToolConsentPreview {
            action: ToolPermissionVerb::MessageOutsider,
            action_preview: "Send this email to x@y.com: Hello".into(),
        });
        let mut decision = response(AskOutcome::Approved);
        assert!(validate_ask_response(&consent, &decision).is_err());
        decision.reason = Some("Approved for this action".into());
        assert!(validate_ask_response(&consent, &decision).is_ok());
        decision.outcome = AskOutcome::RevisionRequested;
        assert!(validate_ask_response(&consent, &decision).is_err());

        let question = ask(AskType::Question);
        let mut a = response(AskOutcome::Answered);
        assert!(validate_ask_response(&question, &a).is_err());
        a.answer = Some("The engagement brief first".into());
        assert!(validate_ask_response(&question, &a).is_ok());

        let mut choice = ask(AskType::Choice);
        choice.options = Some(opts(&["warm", "bold"]));
        let mut c = response(AskOutcome::Chosen);
        c.option_id = Some("loud".into());
        assert!(validate_ask_response(&choice, &c).is_err());
        c.option_id = Some("bold".into());
        assert!(validate_ask_response(&choice, &c).is_ok());

        let mut checklist = ask(AskType::Checklist);
        checklist.items = Some(opts(&["brief", "assets", "dates"]));
        let mut k = response(AskOutcome::Confirmed);
        k.checked_item_ids = Some(vec!["brief".into(), "assets".into()]);
        assert!(validate_ask_response(&checklist, &k).is_err(), "every item");
        k.checked_item_ids = Some(vec![
            "brief".into(),
            "assets".into(),
            "dates".into(),
            "dates".into(),
        ]);
        assert!(
            validate_ask_response(&checklist, &k).is_err(),
            "exactly once"
        );
        k.checked_item_ids = Some(vec!["dates".into(), "brief".into(), "assets".into()]);
        assert!(validate_ask_response(&checklist, &k).is_ok());

        let verdict = ask(AskType::Verdict);
        let mut v = response(AskOutcome::Fail);
        v.reason = Some("Missing the end card".into());
        assert!(validate_ask_response(&verdict, &v).is_ok());
        v.answer = Some("extra".into());
        assert!(validate_ask_response(&verdict, &v).is_err());
    }

    #[test]
    fn secret_asks_require_non_secret_request_details_and_bind_only_by_id() {
        let mut secret_record = secret_ask();
        assert!(validate_ask_record(&secret_record, false).is_ok());
        secret_record.secret_request = None;
        assert!(validate_ask_record(&secret_record, false).is_err());
        secret_record = secret_ask();
        secret_record
            .secret_request
            .as_mut()
            .expect("secret request")
            .client_name = Some("   ".into());
        assert!(validate_ask_record(&secret_record, false).is_err());
        secret_record = secret_ask();
        secret_record
            .secret_request
            .as_mut()
            .expect("secret request")
            .client_name = Some("x".repeat(MAX_SECRET_NAME_CHARS + 1));
        assert!(validate_ask_record(&secret_record, false).is_err());
        secret_record = secret_ask();

        let mut response = response(AskOutcome::SecretBound);
        response.secret_binding_id = Some(Uuid::from_u128(11));
        assert!(validate_ask_response(&secret_record, &response).is_ok());
        response.answer = Some("must never be used for a credential".into());
        assert!(validate_ask_response(&secret_record, &response).is_err());
        response.answer = None;
        response.secret_binding_id = None;
        assert!(validate_ask_response(&secret_record, &response).is_err());

        let mut ordinary = ask(AskType::Question);
        ordinary.secret_request = Some(SecretAskRequest {
            tool_name: "Social publishing".into(),
            client_name: None,
            allowed_use: "Prepare drafts".into(),
        });
        assert!(validate_ask_record(&ordinary, false).is_err());
    }

    #[test]
    fn secret_binding_actions_are_metadata_only_and_reject_value_fields() {
        let binding_id = Uuid::from_u128(12);
        let action = SecretBindingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            binding_id,
            action: SecretBindingActionKind::Create,
            expected_head_event_id: None,
            binding: Some(SecretBindingSpec {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                binding_id,
                name: "Publishing credential".into(),
                employee_pubkey: PK_A.into(),
                tool_name: "Social publishing".into(),
                allowed_use: "Prepare Olive Studio drafts".into(),
                storage: SecretStorage::Device,
                source_ask: None,
            }),
        };
        assert!(validate_secret_binding_action(&action).is_ok());
        let serialized = serde_json::to_string(&action).expect("metadata serialization");
        assert!(!serialized.contains("value"));

        let sentinel = format!("credential-{}", Uuid::new_v4());
        let attempted = format!(
            "{{\"schemaVersion\":1,\"bindingId\":\"{binding_id}\",\"action\":\"create\",\"binding\":{{\"schemaVersion\":1,\"bindingId\":\"{binding_id}\",\"name\":\"Publishing credential\",\"employeePubkey\":\"{PK_A}\",\"toolName\":\"Social publishing\",\"allowedUse\":\"Prepare drafts\",\"storage\":\"device\",\"value\":\"{sentinel}\"}}}}"
        );
        let error = parse_company_command(crate::kind::KIND_SECRET_BINDING_ACTION, &attempted)
            .expect_err("secret values are not part of the binding command");
        assert!(!error.to_string().contains(&sentinel));
    }

    #[test]
    fn authority_follows_owner_decision_d2() {
        let mut money = ask(AskType::Approval);
        money.category = AskCategory::Money;
        assert!(
            ask_resolution_denied_reason(&money, human(Some(CommunityRole::Member), true))
                .is_some()
        );
        assert!(
            ask_resolution_denied_reason(&money, human(Some(CommunityRole::Admin), true)).is_none()
        );
        assert!(
            ask_resolution_denied_reason(&money, human(Some(CommunityRole::Owner), false))
                .is_none()
        );
        let agent_owner = AskResolver {
            is_agent: true,
            ..human(Some(CommunityRole::Owner), true)
        };
        assert_eq!(
            ask_resolution_denied_reason(&money, agent_owner),
            Some("Agents cannot decide spending, hires, tools, secrets or duties")
        );

        let mut duty = ask(AskType::Approval);
        duty.category = AskCategory::Duty;
        let agent_owner = AskResolver {
            is_agent: true,
            ..human(Some(CommunityRole::Owner), true)
        };
        assert_eq!(
            ask_resolution_denied_reason(&duty, agent_owner),
            Some("Agents cannot decide spending, hires, tools, secrets or duties")
        );
        assert!(
            ask_resolution_denied_reason(&duty, human(Some(CommunityRole::Admin), true)).is_none()
        );
        assert!(
            ask_resolution_denied_reason(&duty, human(Some(CommunityRole::Member), true)).is_some()
        );

        let mut addressed = ask(AskType::Question);
        addressed.addressee_pubkey = Some(PK_A.into());
        assert!(
            ask_resolution_denied_reason(&addressed, human(Some(CommunityRole::Owner), true))
                .is_some()
        );
        let addressee = AskResolver {
            pubkey: PK_A,
            ..human(Some(CommunityRole::Member), true)
        };
        assert!(ask_resolution_denied_reason(&addressed, addressee).is_none());
        let agent_addressee = AskResolver {
            is_agent: true,
            ..addressee
        };
        assert!(ask_resolution_denied_reason(&addressed, agent_addressee).is_none());

        let open = ask(AskType::Approval);
        assert!(
            ask_resolution_denied_reason(&open, human(Some(CommunityRole::Member), true)).is_none()
        );
        assert!(ask_resolution_denied_reason(&open, human(None, false)).is_some());
        let agent = AskResolver {
            is_agent: true,
            ..human(Some(CommunityRole::Member), true)
        };
        assert!(ask_resolution_denied_reason(&open, agent).is_some());
    }

    #[test]
    fn decimals_and_ids() {
        assert!(is_decimal("0") && is_decimal("12") && is_decimal("2.50"));
        assert!(
            !is_decimal("")
                && !is_decimal("-1")
                && !is_decimal("1.")
                && !is_decimal(".5")
                && !is_decimal("1e3")
        );
        assert!(is_hex_id(EV) && !is_hex_id(&EV.to_uppercase()) && !is_hex_id("abc"));
    }
}
