//! Company access list, capability gaps and slot hires (kind 30676 heads, 47066 actions).
//!
//! One new head kind carries three record families, told apart by d-tag:
//!
//! * `company:access:<access id>`: one tool or account Scout and agents may use.
//! * `company:capgap:<gap id>`: a capability gap Scout found, with the options,
//!   the cheapest that works, the stated cost and the one human step.
//! * `company:slot-hire:<hire id>`: the function slot a hire proposal is for.
//!
//! These are new records, so a desktop that predates them keeps loading every
//! older list. Nothing here adds a key to an existing record type.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::company_functions::CompanyFunction;
use crate::company_records::{
    is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION, MAX_REASON_CHARS,
};

/// Relay-authored access, capability gap and slot hire head (community-wide).
pub const KIND_COMPANY_ACCESS_HEAD: u32 = crate::kind::KIND_COMPANY_ACCESS_HEAD;
/// Member access, capability gap and slot hire write, brokered and community-wide.
pub const KIND_COMPANY_ACCESS_ACTION: u32 = crate::kind::KIND_COMPANY_ACCESS_ACTION;

const ACCESS_D_TAG_PREFIX: &str = "company:access:";
const GAP_D_TAG_PREFIX: &str = "company:capgap:";
const SLOT_HIRE_D_TAG_PREFIX: &str = "company:slot-hire:";

/// Longest access id.
pub const MAX_ACCESS_ID_CHARS: usize = 40;
/// Most agents one access entry can name.
pub const MAX_ACCESS_AGENTS: usize = 16;
/// Most options one capability gap can list.
pub const MAX_GAP_OPTIONS: usize = 5;

const MAX_NAME_CHARS: usize = 80;
const MAX_USED_FOR_CHARS: usize = 120;
const MAX_COST_CHARS: usize = 80;
const MAX_TITLE_CHARS: usize = 120;
const MAX_TEXT_CHARS: usize = 400;
const MAX_NOTE_CHARS: usize = 200;
const MAX_URL_CHARS: usize = 500;

/// What kind of tool or account an access entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessCategory {
    /// The company WhatsApp business number (relay-gated).
    Whatsapp,
    /// Discovery search (relay-gated).
    Discovery,
    /// Colony credits for agent AI (relay-gated).
    Credits,
    /// A site the built-in browser is logged in to.
    BrowserLogin,
    /// Any other connected account.
    ConnectedAccount,
    /// A calendar.
    Calendar,
    /// An e-sign service.
    Esign,
    /// A payment link provider.
    PaymentLink,
    /// Anything else.
    Other,
}

impl AccessCategory {
    /// Stable lower snake case id.
    pub const fn id(&self) -> &'static str {
        match self {
            AccessCategory::Whatsapp => "whatsapp",
            AccessCategory::Discovery => "discovery",
            AccessCategory::Credits => "credits",
            AccessCategory::BrowserLogin => "browser_login",
            AccessCategory::ConnectedAccount => "connected_account",
            AccessCategory::Calendar => "calendar",
            AccessCategory::Esign => "esign",
            AccessCategory::PaymentLink => "payment_link",
            AccessCategory::Other => "other",
        }
    }

    /// The fixed access id of a Colony-run tool the relay itself gates.
    ///
    /// Those entries have exactly one record per company so a revoke cannot be
    /// dodged by granting a second entry of the same tool.
    pub const fn fixed_access_id(&self) -> Option<&'static str> {
        match self {
            AccessCategory::Whatsapp => Some("whatsapp"),
            AccessCategory::Discovery => Some("discovery"),
            AccessCategory::Credits => Some("credits"),
            _ => None,
        }
    }
}

/// Build the community-wide d-tag of one access entry.
pub fn access_d_tag(access_id: &str) -> String {
    format!("{ACCESS_D_TAG_PREFIX}{access_id}")
}

/// Build the community-wide d-tag of one capability gap.
pub fn gap_d_tag(gap_id: Uuid) -> String {
    format!("{GAP_D_TAG_PREFIX}{gap_id}")
}

/// Build the community-wide d-tag of one slot hire intent.
pub fn slot_hire_d_tag(hire_id: Uuid) -> String {
    format!("{SLOT_HIRE_D_TAG_PREFIX}{hire_id}")
}

/// The record a d-tag of kind 30676 points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessRecordRef {
    /// An access entry.
    Access(String),
    /// A capability gap.
    Gap(Uuid),
    /// A slot hire intent.
    SlotHire(Uuid),
}

/// Whether `value` is a valid access id: 1 to 40 characters of `a-z`, `0-9`
/// and `-`, not starting with `-`.
pub fn is_access_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ACCESS_ID_CHARS
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// Parse a d-tag of kind 30676 into the record it names.
pub fn parse_access_d_tag(tag: &str) -> Result<AccessRecordRef, CompanyRecordError> {
    if let Some(id) = tag.strip_prefix(ACCESS_D_TAG_PREFIX) {
        return if is_access_id(id) {
            Ok(AccessRecordRef::Access(id.to_owned()))
        } else {
            Err(CompanyRecordError::DTagMismatch)
        };
    }
    if let Some(id) = tag.strip_prefix(GAP_D_TAG_PREFIX) {
        return parse_canonical_uuid(id).map(AccessRecordRef::Gap);
    }
    if let Some(id) = tag.strip_prefix(SLOT_HIRE_D_TAG_PREFIX) {
        return parse_canonical_uuid(id).map(AccessRecordRef::SlotHire);
    }
    Err(CompanyRecordError::DTagMismatch)
}

/// A UUID in its one canonical lowercase hyphenated form, so a d-tag has one spelling.
fn parse_canonical_uuid(value: &str) -> Result<Uuid, CompanyRecordError> {
    let id = Uuid::parse_str(value).map_err(|_| CompanyRecordError::DTagMismatch)?;
    if id.hyphenated().to_string() == value {
        Ok(id)
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

/// One tool or account Scout and agents can use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccessEntry {
    /// Name shown to people, for example "Gmail, in the browser".
    pub name: String,
    /// What kind of tool or account it is.
    pub category: AccessCategory,
    /// What it is used for, in plain words.
    pub used_for: String,
    /// Agents that use it (64-character hex). Empty means every agent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agents: Vec<String>,
    /// What it costs, in plain words, for example "Free" or "About R0.62 per new chat".
    pub cost: String,
}

/// The entry of a Colony-run tool that exists before anyone grants it.
///
/// WhatsApp, Discovery and credits are always available to a company, so they
/// have no head until someone revokes them. A revoke with no head starts from
/// this entry.
pub fn builtin_access_entry(access_id: &str) -> Option<AccessEntry> {
    let (name, category, used_for, cost) = match access_id {
        "whatsapp" => (
            "WhatsApp business number",
            AccessCategory::Whatsapp,
            "Outreach and replies",
            "About R0.62 per new chat",
        ),
        "discovery" => (
            "Discovery",
            AccessCategory::Discovery,
            "Finding leads",
            "Covered by subscription",
        ),
        "credits" => (
            "Colony credits",
            AccessCategory::Credits,
            "AI work for agents",
            "Uses your credits",
        ),
        _ => return None,
    };
    Some(AccessEntry {
        name: name.into(),
        category,
        used_for: used_for.into(),
        agents: Vec::new(),
        cost: cost.into(),
    })
}

/// One option Scout compared while closing a capability gap.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GapOption {
    /// Product or approach name.
    pub name: String,
    /// What it costs, in plain words.
    pub cost_text: String,
    /// Cost in cents of the company currency, 0 when free.
    pub cost_cents: u64,
    /// Whether the cost repeats every month.
    pub recurring: bool,
    /// Whether the option does what the company needs.
    pub works: bool,
    /// Why it is or is not a fit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// A capability Scout needs and Colony cannot do yet, with the plan to get it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CapabilityGap {
    /// Short title, for example "Sign up for a free e-sign tool".
    pub title: String,
    /// What Scout needs it for.
    pub need: String,
    /// The options compared, at most five.
    pub options: Vec<GapOption>,
    /// Index into `options` of the option Scout picked.
    pub chosen: u8,
    /// Required when the pick is not the cheapest option that works.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chosen_reason: Option<String>,
    /// The one human step, for example "Choose a password, then tell me".
    pub human_step: String,
    /// The exact https page to open in the built-in browser.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_url: Option<String>,
    /// Access id the finished setup will create.
    pub access_id: String,
    /// The access entry the finished setup will create.
    pub access: AccessEntry,
}

impl CapabilityGap {
    /// The option Scout picked, when `chosen` points at one.
    pub fn chosen_option(&self) -> Option<&GapOption> {
        self.options.get(usize::from(self.chosen))
    }
}

/// Whether an access entry can be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessState {
    /// Scout and agents can use it.
    Active,
    /// The owner revoked it; it must not be used until granted again.
    Revoked,
}

/// Relay-authored access entry head (d-tag `company:access:<id>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccessHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable access id from the d-tag.
    pub access_id: String,
    /// What the entry is.
    pub entry: AccessEntry,
    /// Whether it can be used.
    pub state: AccessState,
    /// Who granted it last.
    pub granted_by_pubkey: String,
    /// Unix seconds of the last grant.
    pub granted_at: i64,
    /// The capability gap whose finished setup created it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via_gap_id: Option<Uuid>,
    /// Who revoked it, when revoked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_by_pubkey: Option<String>,
    /// Unix seconds of the revoke, when revoked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<i64>,
    /// Why it was revoked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoke_reason: Option<String>,
    /// Unix seconds of the last change.
    pub updated_at: i64,
}

/// Where a capability gap is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GapState {
    /// Scout recorded it; the owner has not approved the cost yet.
    Proposed,
    /// The owner approved the stated cost; the human step is next.
    Approved,
    /// The owner did the human step and said done; Scout finishes the setup.
    HumanDone,
    /// Scout finished the setup and the access entry exists.
    Completed,
    /// The owner said not now.
    Declined,
}

/// Relay-authored capability gap head (d-tag `company:capgap:<id>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CapabilityGapHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable gap id from the d-tag.
    pub gap_id: Uuid,
    /// The gap and its plan.
    pub gap: CapabilityGap,
    /// Where it is in its life.
    pub state: GapState,
    /// Who recorded it.
    pub proposed_by_pubkey: String,
    /// Unix seconds it was recorded.
    pub proposed_at: i64,
    /// Owner or admin who approved the cost.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by_pubkey: Option<String>,
    /// Unix seconds of the approval.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<i64>,
    /// The exact cost in cents the owner approved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_cost_cents: Option<u64>,
    /// Unix seconds the human step was marked done.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub human_done_at: Option<i64>,
    /// Unix seconds the setup was finished.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
    /// Why the owner declined.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub declined_reason: Option<String>,
    /// Unix seconds of the last change.
    pub updated_at: i64,
}

/// Relay-authored slot hire head (d-tag `company:slot-hire:<hire id>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SlotHireHead {
    /// Schema version.
    pub schema_version: u8,
    /// The hire this intent belongs to.
    pub hire_id: Uuid,
    /// The function slot the new employee will lead.
    pub function: CompanyFunction,
    /// Who recorded the intent.
    pub set_by_pubkey: String,
    /// Unix seconds of the last change.
    pub updated_at: i64,
}

/// Supported writes on kind 47066.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessOp {
    /// Owner or admin adds or restores an access entry.
    Grant,
    /// Owner or admin revokes an access entry.
    Revoke,
    /// Scout or an employee records a capability gap.
    GapPropose,
    /// Owner or admin approves the stated cost.
    GapApprove,
    /// Owner or admin declines the gap.
    GapDecline,
    /// Owner or admin marks the human step done.
    GapDone,
    /// Scout finishes the setup; the access entry is created in the same write.
    GapComplete,
    /// Record which function slot a hire proposal is for.
    SlotHireSet,
}

/// Member-signed write on the access list, capability gaps or slot hires (kind 47066).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccessAction {
    /// Schema version.
    pub schema_version: u8,
    /// The write.
    pub op: AccessOp,
    /// Access id for `grant` and `revoke`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_id: Option<String>,
    /// Gap id for every `gap_*` write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap_id: Option<Uuid>,
    /// Hire id for `slot_hire_set`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hire_id: Option<Uuid>,
    /// The entry for `grant`, or for `revoke` of an entry with no head yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry: Option<AccessEntry>,
    /// The gap for `gap_propose`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gap: Option<CapabilityGap>,
    /// The function for `slot_hire_set`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<CompanyFunction>,
    /// Reason for `revoke` or `gap_decline`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Exact current head event id, omitted only while no head exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

impl AccessAction {
    /// The d-tag of the record this write changes (the gap, for `gap_complete`).
    pub fn d_tag(&self) -> Result<String, CompanyRecordError> {
        let missing = CompanyRecordError::Invalid("write is missing its record id");
        match self.op {
            AccessOp::Grant | AccessOp::Revoke => {
                self.access_id.as_deref().map(access_d_tag).ok_or(missing)
            }
            AccessOp::GapPropose
            | AccessOp::GapApprove
            | AccessOp::GapDecline
            | AccessOp::GapDone
            | AccessOp::GapComplete => self.gap_id.map(gap_d_tag).ok_or(missing),
            AccessOp::SlotHireSet => self.hire_id.map(slot_hire_d_tag).ok_or(missing),
        }
    }
}

fn text_ok(value: &str, max: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

fn bad(message: &'static str) -> CompanyRecordError {
    CompanyRecordError::Invalid(message)
}

/// Validate an access entry against the id it will be stored under.
pub fn validate_access_entry(
    access_id: &str,
    entry: &AccessEntry,
) -> Result<(), CompanyRecordError> {
    if !is_access_id(access_id) {
        return Err(bad("accessId must be 1 to 40 characters of a-z, 0-9 and -"));
    }
    if let Some(fixed) = entry.category.fixed_access_id() {
        if access_id != fixed {
            return Err(bad(
                "whatsapp, discovery and credits entries use their own fixed access id",
            ));
        }
    }
    if !text_ok(&entry.name, MAX_NAME_CHARS)
        || !text_ok(&entry.used_for, MAX_USED_FOR_CHARS)
        || !text_ok(&entry.cost, MAX_COST_CHARS)
    {
        return Err(bad(
            "an access entry needs a name, what it is used for and its cost",
        ));
    }
    if entry.agents.len() > MAX_ACCESS_AGENTS || entry.agents.iter().any(|agent| !is_hex_id(agent))
    {
        return Err(bad("agents are at most 16 64-character pubkeys"));
    }
    Ok(())
}

/// Validate a capability gap: the options, the cheapest-that-works rule and the page.
pub fn validate_capability_gap(gap: &CapabilityGap) -> Result<(), CompanyRecordError> {
    if !text_ok(&gap.title, MAX_TITLE_CHARS)
        || !text_ok(&gap.need, MAX_TEXT_CHARS)
        || !text_ok(&gap.human_step, MAX_TEXT_CHARS)
    {
        return Err(bad("a gap needs a title, a need and one human step"));
    }
    if gap.options.is_empty() || gap.options.len() > MAX_GAP_OPTIONS {
        return Err(bad("a gap lists 1 to 5 options"));
    }
    for option in &gap.options {
        let note_ok = option
            .note
            .as_deref()
            .is_none_or(|note| text_ok(note, MAX_NOTE_CHARS));
        if !text_ok(&option.name, MAX_NAME_CHARS)
            || !text_ok(&option.cost_text, MAX_COST_CHARS)
            || !note_ok
        {
            return Err(bad("each option needs a name and a stated cost"));
        }
    }
    let chosen = gap
        .chosen_option()
        .ok_or_else(|| bad("chosen must point at one of the options"))?;
    if !chosen.works {
        return Err(bad("the chosen option must be one that works"));
    }
    let cheapest = gap
        .options
        .iter()
        .filter(|option| option.works)
        .map(|option| option.cost_cents)
        .min()
        .unwrap_or(chosen.cost_cents);
    if chosen.cost_cents > u64::MAX
        && gap
            .chosen_reason
            .as_deref()
            .is_none_or(|reason| !text_ok(reason, MAX_TEXT_CHARS))
    {
        return Err(bad(
            "a pick that is not the cheapest option that works needs chosenReason",
        ));
    }
    if let Some(url) = gap.page_url.as_deref() {
        let host_ok = url
            .strip_prefix("https://")
            .is_some_and(|rest| !rest.is_empty() && !rest.starts_with('/'));
        if url.chars().count() > MAX_URL_CHARS
            || !host_ok
            || url.chars().any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(bad("pageUrl must be an https address without spaces"));
        }
    }
    validate_access_entry(&gap.access_id, &gap.access)
}

fn expect_fields(
    action: &AccessAction,
    access_id: bool,
    gap_id: bool,
    hire_id: bool,
    gap: bool,
    function: bool,
) -> Result<(), CompanyRecordError> {
    if action.access_id.is_some() != access_id
        || action.gap_id.is_some() != gap_id
        || action.hire_id.is_some() != hire_id
        || action.gap.is_some() != gap
        || action.function.is_some() != function
    {
        return Err(bad("write carries the wrong fields for its op"));
    }
    Ok(())
}

/// Validate one write on kind 47066.
pub fn validate_access_action(action: &AccessAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(bad("expectedHeadEventId must be a 64-character event id"));
        }
    }
    let reason_allowed = matches!(action.op, AccessOp::Revoke | AccessOp::GapDecline);
    match action.reason.as_deref() {
        Some(_) if !reason_allowed => return Err(bad("this op takes no reason")),
        Some(reason) if !text_ok(reason, MAX_REASON_CHARS) => {
            return Err(bad("reason must be 1 to 1000 characters"));
        }
        _ => {}
    }
    // Only a revoke of an entry with no head yet carries an entry besides a grant.
    if action.entry.is_some() && !matches!(action.op, AccessOp::Grant | AccessOp::Revoke) {
        return Err(bad("only grant and revoke carry an entry"));
    }
    match action.op {
        AccessOp::Grant => {
            expect_fields(action, true, false, false, false, false)?;
            let (Some(id), Some(entry)) = (action.access_id.as_deref(), action.entry.as_ref())
            else {
                return Err(bad("grant needs accessId and entry"));
            };
            validate_access_entry(id, entry)
        }
        AccessOp::Revoke => {
            expect_fields(action, true, false, false, false, false)?;
            let id = action.access_id.as_deref().unwrap_or_default();
            match action.entry.as_ref() {
                Some(entry) => validate_access_entry(id, entry),
                None if is_access_id(id) => Ok(()),
                None => Err(bad("accessId must be 1 to 40 characters of a-z, 0-9 and -")),
            }
        }
        AccessOp::GapPropose => {
            expect_fields(action, false, true, false, true, false)?;
            if action.expected_head_event_id.is_some() {
                return Err(bad("gap_propose creates a gap and takes no expected head"));
            }
            match action.gap.as_ref() {
                Some(gap) => validate_capability_gap(gap),
                None => Err(bad("gap_propose needs the gap")),
            }
        }
        AccessOp::GapApprove | AccessOp::GapDecline | AccessOp::GapDone | AccessOp::GapComplete => {
            expect_fields(action, false, true, false, false, false)?;
            if action.expected_head_event_id.is_none() {
                return Err(bad("this gap write needs the current head"));
            }
            Ok(())
        }
        AccessOp::SlotHireSet => {
            expect_fields(action, false, false, true, false, true)?;
            Ok(())
        }
    }
}

/// Validate a relay-authored access head.
pub fn validate_access_head(head: &AccessHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    validate_access_entry(&head.access_id, &head.entry)?;
    if !is_hex_id(&head.granted_by_pubkey) || head.granted_at < 0 || head.updated_at < 0 {
        return Err(bad("access head needs a valid granter and time"));
    }
    match (
        head.state,
        head.revoked_by_pubkey.as_deref(),
        head.revoked_at,
    ) {
        (AccessState::Active, None, None) => Ok(()),
        (AccessState::Revoked, Some(by), Some(at)) if is_hex_id(by) && at >= 0 => Ok(()),
        _ => Err(bad(
            "an access head is revoked exactly when it names its revoker",
        )),
    }
}

/// Validate a relay-authored capability gap head.
pub fn validate_capability_gap_head(head: &CapabilityGapHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    validate_capability_gap(&head.gap)?;
    if !is_hex_id(&head.proposed_by_pubkey) || head.proposed_at < 0 || head.updated_at < 0 {
        return Err(bad("gap head needs a valid proposer and time"));
    }
    let approved = head.approved_by_pubkey.is_some()
        && head.approved_at.is_some()
        && head.approved_cost_cents.is_some();
    let needs_approval = matches!(
        head.state,
        GapState::Approved | GapState::HumanDone | GapState::Completed
    );
    if needs_approval && !approved {
        return Err(bad("an approved gap records who approved which cost"));
    }
    Ok(())
}

/// Validate a relay-authored slot hire head.
pub fn validate_slot_hire_head(head: &SlotHireHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if !is_hex_id(&head.set_by_pubkey) || head.updated_at < 0 {
        return Err(bad("slot hire head needs a valid author and time"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::company_records::parse_company_command;

    fn entry(category: AccessCategory) -> AccessEntry {
        AccessEntry {
            name: "Pinterest, in the browser".into(),
            category,
            used_for: "Design ideas".into(),
            agents: vec![],
            cost: "Free".into(),
        }
    }

    fn option(name: &str, cents: u64, works: bool) -> GapOption {
        GapOption {
            name: name.into(),
            cost_text: if cents == 0 {
                "Free".into()
            } else {
                "Paid".into()
            },
            cost_cents: cents,
            recurring: false,
            works,
            note: None,
        }
    }

    fn gap() -> CapabilityGap {
        CapabilityGap {
            title: "Sign up for a free e-sign tool".into(),
            need: "Clients sign agreements in Colony".into(),
            options: vec![
                option("Paid sign", 9900, true),
                option("Free sign", 0, true),
            ],
            chosen: 1,
            chosen_reason: None,
            human_step: "Choose a password, then tell me".into(),
            page_url: Some("https://example.com/signup".into()),
            access_id: "esign".into(),
            access: entry(AccessCategory::Esign),
        }
    }

    fn base(op: AccessOp) -> AccessAction {
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

    #[test]
    fn d_tags_round_trip_for_all_three_records() {
        let id = Uuid::new_v4();
        assert_eq!(
            parse_access_d_tag(&access_d_tag("gmail-browser")),
            Ok(AccessRecordRef::Access("gmail-browser".into()))
        );
        assert_eq!(
            parse_access_d_tag(&gap_d_tag(id)),
            Ok(AccessRecordRef::Gap(id))
        );
        assert_eq!(
            parse_access_d_tag(&slot_hire_d_tag(id)),
            Ok(AccessRecordRef::SlotHire(id))
        );
        for bad_tag in [
            "company:access:",
            "company:access:Upper",
            "company:access:-lead",
            "company:capgap:not-a-uuid",
            "company:function:sales",
        ] {
            assert_eq!(
                parse_access_d_tag(bad_tag),
                Err(CompanyRecordError::DTagMismatch),
                "{bad_tag}"
            );
        }
        let upper = format!("company:capgap:{}", id.to_string().to_uppercase());
        assert_eq!(
            parse_access_d_tag(&upper),
            Err(CompanyRecordError::DTagMismatch)
        );
    }

    #[test]
    fn colony_run_tools_only_use_their_fixed_access_id() {
        assert!(validate_access_entry("whatsapp", &entry(AccessCategory::Whatsapp)).is_ok());
        assert!(validate_access_entry("whatsapp-2", &entry(AccessCategory::Whatsapp)).is_err());
        assert!(validate_access_entry("discovery", &entry(AccessCategory::Whatsapp)).is_err());
        assert!(validate_access_entry("credits", &entry(AccessCategory::Credits)).is_ok());
        assert!(validate_access_entry("anything", &entry(AccessCategory::Other)).is_ok());
    }

    #[test]
    fn builtin_entries_are_valid_under_their_fixed_ids() {
        for id in ["whatsapp", "discovery", "credits"] {
            let builtin = builtin_access_entry(id).expect("builtin entry");
            assert_eq!(builtin.category.fixed_access_id(), Some(id));
            assert!(validate_access_entry(id, &builtin).is_ok(), "{id}");
        }
        assert!(builtin_access_entry("gmail-browser").is_none());
    }

    #[test]
    fn gap_pick_must_be_the_cheapest_that_works() {
        assert!(validate_capability_gap(&gap()).is_ok());
        let mut costlier = gap();
        costlier.chosen = 0;
        assert!(validate_capability_gap(&costlier).is_err());
        costlier.chosen_reason = Some("Needs legally binding signatures".into());
        assert!(validate_capability_gap(&costlier).is_ok());
        let mut broken = gap();
        broken.options[1].works = false;
        assert!(validate_capability_gap(&broken).is_err());
        let mut out_of_range = gap();
        out_of_range.chosen = 9;
        assert!(validate_capability_gap(&out_of_range).is_err());
    }

    #[test]
    fn gap_page_must_be_https() {
        let mut http = gap();
        http.page_url = Some("http://example.com".into());
        assert!(validate_capability_gap(&http).is_err());
        let mut js = gap();
        js.page_url = Some("javascript:alert(1)".into());
        assert!(validate_capability_gap(&js).is_err());
        let mut spaced = gap();
        spaced.page_url = Some("https://example.com/a b".into());
        assert!(validate_capability_gap(&spaced).is_err());
        let mut none = gap();
        none.page_url = None;
        assert!(validate_capability_gap(&none).is_ok());
    }

    #[test]
    fn each_op_carries_only_its_own_fields() {
        let gap_id = Uuid::new_v4();
        let mut grant = base(AccessOp::Grant);
        assert!(validate_access_action(&grant).is_err());
        grant.access_id = Some("gmail-browser".into());
        grant.entry = Some(entry(AccessCategory::BrowserLogin));
        assert!(validate_access_action(&grant).is_ok());
        grant.reason = Some("why".into());
        assert!(validate_access_action(&grant).is_err());

        let mut revoke = base(AccessOp::Revoke);
        revoke.access_id = Some("whatsapp".into());
        assert!(validate_access_action(&revoke).is_ok());
        revoke.reason = Some("No longer needed".into());
        assert!(validate_access_action(&revoke).is_ok());
        revoke.gap_id = Some(gap_id);
        assert!(validate_access_action(&revoke).is_err());

        let mut propose = base(AccessOp::GapPropose);
        propose.gap_id = Some(gap_id);
        propose.gap = Some(gap());
        assert!(validate_access_action(&propose).is_ok());
        propose.expected_head_event_id = Some("a".repeat(64));
        assert!(validate_access_action(&propose).is_err());

        for op in [
            AccessOp::GapApprove,
            AccessOp::GapDecline,
            AccessOp::GapDone,
            AccessOp::GapComplete,
        ] {
            let mut write = base(op);
            write.gap_id = Some(gap_id);
            assert!(
                validate_access_action(&write).is_err(),
                "{op:?} needs the current head"
            );
            write.expected_head_event_id = Some("b".repeat(64));
            assert!(validate_access_action(&write).is_ok(), "{op:?}");
        }

        let mut slot = base(AccessOp::SlotHireSet);
        slot.hire_id = Some(Uuid::new_v4());
        assert!(validate_access_action(&slot).is_err());
        slot.function = Some(CompanyFunction::Finance);
        assert!(validate_access_action(&slot).is_ok());
    }

    #[test]
    fn action_d_tag_follows_its_record() {
        let gap_id = Uuid::new_v4();
        let hire_id = Uuid::new_v4();
        let mut complete = base(AccessOp::GapComplete);
        complete.gap_id = Some(gap_id);
        assert_eq!(complete.d_tag(), Ok(gap_d_tag(gap_id)));
        let mut slot = base(AccessOp::SlotHireSet);
        slot.hire_id = Some(hire_id);
        assert_eq!(slot.d_tag(), Ok(slot_hire_d_tag(hire_id)));
        let mut revoke = base(AccessOp::Revoke);
        revoke.access_id = Some("discovery".into());
        assert_eq!(revoke.d_tag(), Ok("company:access:discovery".to_owned()));
        assert!(base(AccessOp::Grant).d_tag().is_err());
    }

    #[test]
    fn access_action_rejects_unknown_fields_and_wrong_version() {
        let json = r#"{"schemaVersion":1,"op":"revoke","accessId":"whatsapp","surprise":1}"#;
        assert!(serde_json::from_str::<AccessAction>(json).is_err());
        let mut wrong = base(AccessOp::Revoke);
        wrong.access_id = Some("whatsapp".into());
        wrong.schema_version = 2;
        assert_eq!(
            validate_access_action(&wrong),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
    }

    #[test]
    fn access_action_parses_through_the_company_command_parser() {
        let mut revoke = base(AccessOp::Revoke);
        revoke.access_id = Some("discovery".into());
        let content = serde_json::to_string(&revoke).expect("serialize");
        assert!(parse_company_command(KIND_COMPANY_ACCESS_ACTION, &content).is_ok());
    }

    #[test]
    fn access_head_is_revoked_exactly_when_it_names_its_revoker() {
        let mut head = AccessHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            access_id: "whatsapp".into(),
            entry: entry(AccessCategory::Whatsapp),
            state: AccessState::Active,
            granted_by_pubkey: "a".repeat(64),
            granted_at: 1,
            via_gap_id: None,
            revoked_by_pubkey: None,
            revoked_at: None,
            revoke_reason: None,
            updated_at: 1,
        };
        assert!(validate_access_head(&head).is_ok());
        head.state = AccessState::Revoked;
        assert!(validate_access_head(&head).is_err());
        head.revoked_by_pubkey = Some("b".repeat(64));
        head.revoked_at = Some(2);
        assert!(validate_access_head(&head).is_ok());
        head.state = AccessState::Active;
        assert!(validate_access_head(&head).is_err());
    }
}
