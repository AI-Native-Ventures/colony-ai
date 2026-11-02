//! Outreach lists and shared Discovery campaigns.
//!
//! Two small business records that ride the business broker next to leads:
//! an *outreach list* is a named, ordered set of lead ids, and a *Discovery
//! campaign* is the shared record of one Discovery search. Both are written as
//! member or agent actions (kinds 47075 and 47076) and read back as relay-signed
//! heads (kinds 30684 and 30685). This module owns the content shapes, the field
//! rules and the pure transition functions, so the relay, the CLI and the tests
//! all apply the same rules. Contract: `docs/outreach-lists-contract.md`.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::business_records::{business_d_tag, BUSINESS_RECORD_SCHEMA_VERSION};

/// Most distinct leads one list holds (the Discovery campaign maximum).
pub const MAX_LIST_MEMBERS: usize = 500;
/// Longest list name, in characters.
pub const MAX_LIST_NAME_CHARS: usize = 80;
/// Longest list note, in characters.
pub const MAX_LIST_NOTE_CHARS: usize = 500;
/// Longest campaign name, in characters.
pub const MAX_CAMPAIGN_NAME_CHARS: usize = 120;
/// Longest campaign area, query or end note, in characters.
pub const MAX_CAMPAIGN_TEXT_CHARS: usize = 300;
/// Longest campaign taxonomy label or picked tag, in characters.
pub const MAX_CAMPAIGN_LABEL_CHARS: usize = 60;
/// Most picked tags a campaign keeps.
pub const MAX_CAMPAIGN_TAGS: usize = 20;
/// Most leads one campaign can target.
pub const MAX_CAMPAIGN_TARGET: u32 = 500;
/// Largest found or skipped count a campaign record accepts.
pub const MAX_CAMPAIGN_COUNT: u32 = 100_000;
/// Longest WhatsApp template name or language code, in characters.
pub const MAX_TEMPLATE_NAME_CHARS: usize = 512;

/// Why an outreach list or campaign change was refused. The text is plain
/// English and safe to show a person.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum OutreachError {
    /// The content is malformed or breaks a field rule.
    #[error("{0}")]
    Invalid(String),
    /// The change cannot apply to the record as it stands now.
    #[error("{0}")]
    Conflict(String),
    /// The caller may not make this change.
    #[error("{0}")]
    Forbidden(String),
}

fn invalid<T>(message: impl Into<String>) -> Result<T, OutreachError> {
    Err(OutreachError::Invalid(message.into()))
}

fn conflict<T>(message: impl Into<String>) -> Result<T, OutreachError> {
    Err(OutreachError::Conflict(message.into()))
}

/// Build the d-tag of one outreach list.
pub fn outreach_list_d_tag(community_id: Uuid, list_id: Uuid) -> String {
    business_d_tag(community_id, "outreach_list", list_id)
}

/// Build the d-tag of one Discovery campaign.
pub fn discovery_campaign_d_tag(community_id: Uuid, campaign_id: Uuid) -> String {
    business_d_tag(community_id, "discovery_campaign", campaign_id)
}

/// Trim `value` and check it is non-empty text of at most `max` characters with no control
/// characters. Newlines are allowed only when `multiline` is true.
fn clean_text(
    field: &str,
    value: &str,
    max: usize,
    multiline: bool,
) -> Result<String, OutreachError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return invalid(format!("{field} cannot be empty"));
    }
    clean_optional_text(field, trimmed, max, multiline)
}

/// Like [`clean_text`] but an empty value is allowed (it means "clear").
fn clean_optional_text(
    field: &str,
    value: &str,
    max: usize,
    multiline: bool,
) -> Result<String, OutreachError> {
    let trimmed = value.trim();
    if trimmed.chars().count() > max {
        return invalid(format!("{field} is longer than {max} characters"));
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() && !(multiline && c == '\n'))
    {
        return invalid(format!("{field} has characters that are not allowed"));
    }
    Ok(trimmed.to_owned())
}

fn check_schema(version: u8) -> Result<(), OutreachError> {
    if version == BUSINESS_RECORD_SCHEMA_VERSION {
        Ok(())
    } else {
        invalid("unsupported schema version")
    }
}

fn check_event_id(field: &str, value: &str) -> Result<(), OutreachError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        invalid(format!("{field} must be a 64 character lowercase hex id"))
    }
}

/// Reject every field in `present` that is `true`, naming it.
fn reject_fields(op: &str, present: &[(&str, bool)]) -> Result<(), OutreachError> {
    for (field, is_present) in present {
        if *is_present {
            return invalid(format!("{field} is not used by {op}"));
        }
    }
    Ok(())
}

/// Require every field in `present` to be `true`, naming the first that is missing.
fn require_fields(op: &str, present: &[(&str, bool)]) -> Result<(), OutreachError> {
    for (field, is_present) in present {
        if !*is_present {
            return invalid(format!("{op} needs {field}"));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Outreach lists
// ---------------------------------------------------------------------------

/// One change to an outreach list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ListOp {
    /// Make a new list.
    Create,
    /// Change the title and/or note.
    Rename,
    /// Append leads.
    AddMembers,
    /// Drop leads.
    RemoveMembers,
    /// Set or clear the default WhatsApp template.
    SetDefaultTemplate,
    /// Archive the list (people only).
    Archive,
    /// Bring an archived list back (people only).
    Unarchive,
}

impl ListOp {
    /// Operations that only a person may perform; agents hold the `bot` role and may not.
    pub fn people_only(self) -> bool {
        matches!(self, ListOp::Archive | ListOp::Unarchive)
    }

    fn label(self) -> &'static str {
        match self {
            ListOp::Create => "create",
            ListOp::Rename => "rename",
            ListOp::AddMembers => "add_members",
            ListOp::RemoveMembers => "remove_members",
            ListOp::SetDefaultTemplate => "set_default_template",
            ListOp::Archive => "archive",
            ListOp::Unarchive => "unarchive",
        }
    }
}

/// How a list came to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ListSourceKind {
    /// A person ticked leads.
    Manual,
    /// Made from a Discovery campaign's leads.
    Campaign,
    /// An agent made it.
    Agent,
}

/// Where a list's first members came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListSource {
    /// How the list came to be.
    pub kind: ListSourceKind,
    /// The campaign, only for `campaign`.
    pub campaign_id: Option<Uuid>,
}

/// A WhatsApp template named by its Meta template name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TemplateRef {
    /// The Meta template name (the stable key; the Colony title can be renamed).
    pub name: String,
    /// The template language code.
    pub language: String,
}

/// Whether a list is in use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ListStatus {
    /// Visible and editable.
    Active,
    /// Hidden by default; only `unarchive` applies.
    Archived,
}

/// Member or agent request to change an outreach list (kind 47075).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OutreachListAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable list UUID.
    pub list_id: Uuid,
    /// Requested change.
    pub op: ListOp,
    /// Exact head this change expects; absent for `create`, optional otherwise.
    pub expected_head_event_id: Option<String>,
    /// New title (`create`, `rename`).
    pub name: Option<String>,
    /// New note (`create`, `rename`); an empty note clears it.
    pub note: Option<String>,
    /// Leads to start with, add or remove.
    #[serde(default)]
    pub lead_ids: Vec<Uuid>,
    /// Where the list came from (`create` only).
    pub source: Option<ListSource>,
    /// Default template (`create`, `set_default_template`).
    pub default_template: Option<TemplateRef>,
}

/// One lead in a list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListMember {
    /// The lead (prospect) id.
    pub lead_id: Uuid,
    /// Pubkey of whoever added it.
    pub added_by: String,
    /// Whether an agent added it (decided by the relay from the caller's role).
    pub added_by_agent: bool,
    /// Unix seconds it was added.
    pub added_at: i64,
}

/// Relay-authored outreach list head (kind 30684).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OutreachListHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable list UUID.
    pub list_id: Uuid,
    /// Title.
    pub name: String,
    /// Optional note.
    pub note: Option<String>,
    /// Active or archived.
    pub status: ListStatus,
    /// Where the list came from.
    pub source: ListSource,
    /// Default WhatsApp template, if any.
    pub default_template: Option<TemplateRef>,
    /// Leads in add order.
    pub members: Vec<ListMember>,
    /// Pubkey of the creator.
    pub created_by: String,
    /// Whether an agent created it.
    pub created_by_agent: bool,
    /// Unix seconds it was created.
    pub created_at: i64,
    /// Pubkey of the last editor.
    pub updated_by: String,
    /// Unix seconds of the last change.
    pub updated_at: i64,
    /// Event id of the action that produced this head.
    pub source_action_event_id: String,
}

/// Who is making a list change, as decided by the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListActor {
    /// Caller pubkey, lowercase hex.
    pub pubkey: String,
    /// Whether the caller is an agent (`bot` role).
    pub is_agent: bool,
}

fn check_template(template: &TemplateRef) -> Result<TemplateRef, OutreachError> {
    let name = clean_text(
        "template name",
        &template.name,
        MAX_TEMPLATE_NAME_CHARS,
        false,
    )?;
    let language = clean_text("template language", &template.language, 16, false)?;
    Ok(TemplateRef { name, language })
}

/// Check the shape of a list action: schema, which fields each op uses, lengths and caps.
/// This does not need the current head.
pub fn validate_list_action(action: &OutreachListAction) -> Result<(), OutreachError> {
    check_schema(action.schema_version)?;
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        check_event_id("expectedHeadEventId", expected)?;
    }
    let op = action.op.label();
    let has_name = action.name.is_some();
    let has_note = action.note.is_some();
    let has_leads = !action.lead_ids.is_empty();
    let has_source = action.source.is_some();
    let has_template = action.default_template.is_some();

    match action.op {
        ListOp::Create => {
            require_fields(op, &[("name", has_name), ("source", has_source)])?;
            if action.expected_head_event_id.is_some() {
                return invalid("create cannot name an expected head");
            }
        }
        ListOp::Rename => {
            if !has_name && !has_note {
                return invalid("rename needs a name or a note");
            }
            reject_fields(
                op,
                &[
                    ("leadIds", has_leads),
                    ("source", has_source),
                    ("defaultTemplate", has_template),
                ],
            )?;
        }
        ListOp::AddMembers | ListOp::RemoveMembers => {
            require_fields(op, &[("leadIds", has_leads)])?;
            reject_fields(
                op,
                &[
                    ("name", has_name),
                    ("note", has_note),
                    ("source", has_source),
                    ("defaultTemplate", has_template),
                ],
            )?;
        }
        ListOp::SetDefaultTemplate => reject_fields(
            op,
            &[
                ("name", has_name),
                ("note", has_note),
                ("leadIds", has_leads),
                ("source", has_source),
            ],
        )?,
        ListOp::Archive | ListOp::Unarchive => reject_fields(
            op,
            &[
                ("name", has_name),
                ("note", has_note),
                ("leadIds", has_leads),
                ("source", has_source),
                ("defaultTemplate", has_template),
            ],
        )?,
    }

    if let Some(name) = action.name.as_deref() {
        clean_text("name", name, MAX_LIST_NAME_CHARS, false)?;
    }
    if let Some(note) = action.note.as_deref() {
        clean_optional_text("note", note, MAX_LIST_NOTE_CHARS, true)?;
    }
    if let Some(template) = action.default_template.as_ref() {
        check_template(template)?;
    }
    if let Some(source) = action.source.as_ref() {
        match (source.kind, source.campaign_id) {
            (ListSourceKind::Campaign, None) => {
                return invalid("a campaign source needs campaignId");
            }
            (ListSourceKind::Manual | ListSourceKind::Agent, Some(_)) => {
                return invalid("only a campaign source has a campaignId");
            }
            _ => {}
        }
    }
    let distinct: BTreeSet<Uuid> = action.lead_ids.iter().copied().collect();
    if distinct.len() > MAX_LIST_MEMBERS {
        return invalid(format!("a list holds at most {MAX_LIST_MEMBERS} leads"));
    }
    Ok(())
}

/// The lead ids this action would newly put in the list, in order and without repeats. The relay
/// checks that each is a real lead before the change is applied.
pub fn list_leads_to_verify(
    previous: Option<&OutreachListHead>,
    action: &OutreachListAction,
) -> Vec<Uuid> {
    if !matches!(action.op, ListOp::Create | ListOp::AddMembers) {
        return Vec::new();
    }
    let present: BTreeSet<Uuid> = previous
        .map(|head| head.members.iter().map(|member| member.lead_id).collect())
        .unwrap_or_default();
    let mut seen = BTreeSet::new();
    action
        .lead_ids
        .iter()
        .copied()
        .filter(|id| !present.contains(id) && seen.insert(*id))
        .collect()
}

/// Apply a validated list action to the current head (`None` before `create`) and return the
/// next head. `now` is the action's Unix seconds; `source_action_event_id` is its event id.
pub fn apply_list_action(
    previous: Option<&OutreachListHead>,
    action: &OutreachListAction,
    actor: &ListActor,
    now: i64,
    source_action_event_id: &str,
) -> Result<OutreachListHead, OutreachError> {
    validate_list_action(action)?;
    if action.op.people_only() && actor.is_agent {
        return Err(OutreachError::Forbidden(
            "only people can archive or restore a list".into(),
        ));
    }

    let Some(previous) = previous else {
        if action.op != ListOp::Create {
            return conflict("this list does not exist");
        }
        return create_list(action, actor, now, source_action_event_id);
    };
    if action.op == ListOp::Create {
        return conflict("this list already exists");
    }
    // `expected_head_event_id` is compared with the stored head by the relay; the transition
    // itself never depends on it.

    let mut head = previous.clone();
    match (previous.status, action.op) {
        (ListStatus::Archived, ListOp::Unarchive) => head.status = ListStatus::Active,
        (ListStatus::Archived, _) => {
            return conflict("this list is archived; restore it before changing it");
        }
        (ListStatus::Active, ListOp::Unarchive) => return conflict("this list is not archived"),
        (ListStatus::Active, ListOp::Archive) => head.status = ListStatus::Archived,
        (ListStatus::Active, ListOp::Rename) => {
            if let Some(name) = action.name.as_deref() {
                head.name = clean_text("name", name, MAX_LIST_NAME_CHARS, false)?;
            }
            if let Some(note) = action.note.as_deref() {
                let note = clean_optional_text("note", note, MAX_LIST_NOTE_CHARS, true)?;
                head.note = if note.is_empty() { None } else { Some(note) };
            }
        }
        (ListStatus::Active, ListOp::AddMembers) => {
            let mut seen: BTreeSet<Uuid> = head.members.iter().map(|m| m.lead_id).collect();
            for lead_id in &action.lead_ids {
                if seen.insert(*lead_id) {
                    head.members.push(ListMember {
                        lead_id: *lead_id,
                        added_by: actor.pubkey.clone(),
                        added_by_agent: actor.is_agent,
                        added_at: now,
                    });
                }
            }
            if head.members.len() > MAX_LIST_MEMBERS {
                return invalid(format!("a list holds at most {MAX_LIST_MEMBERS} leads"));
            }
        }
        (ListStatus::Active, ListOp::RemoveMembers) => {
            let dropped: BTreeSet<Uuid> = action.lead_ids.iter().copied().collect();
            head.members
                .retain(|member| !dropped.contains(&member.lead_id));
        }
        (ListStatus::Active, ListOp::SetDefaultTemplate) => {
            head.default_template = match action.default_template.as_ref() {
                Some(template) => Some(check_template(template)?),
                None => None,
            };
        }
        (ListStatus::Active, ListOp::Create) => return conflict("this list already exists"),
    }
    head.updated_by = actor.pubkey.clone();
    head.updated_at = now;
    head.source_action_event_id = source_action_event_id.to_owned();
    Ok(head)
}

fn create_list(
    action: &OutreachListAction,
    actor: &ListActor,
    now: i64,
    source_action_event_id: &str,
) -> Result<OutreachListHead, OutreachError> {
    let name = clean_text(
        "name",
        action.name.as_deref().unwrap_or_default(),
        MAX_LIST_NAME_CHARS,
        false,
    )?;
    let note = match action.note.as_deref() {
        Some(note) => {
            let note = clean_optional_text("note", note, MAX_LIST_NOTE_CHARS, true)?;
            if note.is_empty() {
                None
            } else {
                Some(note)
            }
        }
        None => None,
    };
    let Some(source) = action.source.clone() else {
        return invalid("create needs source");
    };
    let default_template = match action.default_template.as_ref() {
        Some(template) => Some(check_template(template)?),
        None => None,
    };
    let mut seen = BTreeSet::new();
    let members: Vec<ListMember> = action
        .lead_ids
        .iter()
        .filter(|id| seen.insert(**id))
        .map(|lead_id| ListMember {
            lead_id: *lead_id,
            added_by: actor.pubkey.clone(),
            added_by_agent: actor.is_agent,
            added_at: now,
        })
        .collect();
    Ok(OutreachListHead {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        list_id: action.list_id,
        name,
        note,
        status: ListStatus::Active,
        source,
        default_template,
        members,
        created_by: actor.pubkey.clone(),
        created_by_agent: actor.is_agent,
        created_at: now,
        updated_by: actor.pubkey.clone(),
        updated_at: now,
        source_action_event_id: source_action_event_id.to_owned(),
    })
}

/// Check the shape of a stored list head. The relay runs this on every head it reads back.
pub fn validate_list_head(head: &OutreachListHead) -> Result<(), OutreachError> {
    check_schema(head.schema_version)?;
    clean_text("name", &head.name, MAX_LIST_NAME_CHARS, false)?;
    if head.members.len() > MAX_LIST_MEMBERS {
        return invalid(format!("a list holds at most {MAX_LIST_MEMBERS} leads"));
    }
    let distinct: BTreeSet<Uuid> = head.members.iter().map(|m| m.lead_id).collect();
    if distinct.len() != head.members.len() {
        return invalid("a lead appears twice in the list");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Discovery campaigns
// ---------------------------------------------------------------------------

/// One change to a Discovery campaign.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampaignOp {
    /// Record a new campaign.
    Create,
    /// Update the running counts.
    Progress,
    /// End the run.
    Finish,
    /// Change the name.
    Rename,
    /// Archive the campaign (people only).
    Archive,
}

impl CampaignOp {
    fn label(self) -> &'static str {
        match self {
            CampaignOp::Create => "create",
            CampaignOp::Progress => "progress",
            CampaignOp::Finish => "finish",
            CampaignOp::Rename => "rename",
            CampaignOp::Archive => "archive",
        }
    }
}

/// Who a campaign searches for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampaignAudience {
    /// Businesses.
    Businesses,
    /// People.
    People,
}

/// Where a campaign run stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CampaignStatus {
    /// Searching now.
    Running,
    /// Paused.
    Paused,
    /// Finished, target reached or no more results.
    Complete,
    /// Stopped by a person.
    Cancelled,
    /// Stopped by an error.
    Failed,
}

impl CampaignStatus {
    /// True once the run has ended.
    pub fn is_finished(self) -> bool {
        matches!(
            self,
            CampaignStatus::Complete | CampaignStatus::Cancelled | CampaignStatus::Failed
        )
    }
}

/// Whether a person or an agent started a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunnerKind {
    /// A person.
    Person,
    /// An agent.
    Agent,
}

/// Who started a campaign run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CampaignRunBy {
    /// Person or agent.
    pub kind: RunnerKind,
    /// Their pubkey, lowercase hex.
    pub pubkey: String,
}

/// Member or agent request to change a Discovery campaign (kind 47076).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DiscoveryCampaignAction {
    /// Schema version.
    pub schema_version: u8,
    /// Stable campaign UUID (the `campaign:<id>` external id on its leads).
    pub campaign_id: Uuid,
    /// Requested change.
    pub op: CampaignOp,
    /// Exact head this change expects; absent for `create`, optional otherwise.
    pub expected_head_event_id: Option<String>,
    /// Title (`create`, `rename`).
    pub name: Option<String>,
    /// Businesses or people (`create`).
    pub audience: Option<CampaignAudience>,
    /// Industry label (`create`).
    pub industry_name: Option<String>,
    /// Vertical id (`create`).
    pub vertical_id: Option<String>,
    /// Vertical label (`create`).
    pub vertical_name: Option<String>,
    /// Tags picked for the search (`create`).
    pub picked_tags: Option<Vec<String>>,
    /// Free-text search phrase (`create`).
    pub query: Option<String>,
    /// Area searched (`create`).
    pub area: Option<String>,
    /// Number of leads wanted (`create`).
    pub target: Option<u32>,
    /// Leads found so far (`create`, `progress`, `finish`).
    pub found: Option<u32>,
    /// Places skipped because they were already leads (`create`, `progress`, `finish`).
    pub skipped_duplicates: Option<u32>,
    /// Run state (`create`, `progress`, `finish`).
    pub status: Option<CampaignStatus>,
    /// Plain-words reason a run ended short or failed (`create`, `finish`).
    pub end_note: Option<String>,
    /// Who started the run (`create`).
    pub run_by: Option<CampaignRunBy>,
}

/// Relay-authored Discovery campaign head (kind 30685).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DiscoveryCampaignHead {
    /// Schema version.
    pub schema_version: u8,
    /// Stable campaign UUID.
    pub campaign_id: Uuid,
    /// Title.
    pub name: String,
    /// Businesses or people.
    pub audience: CampaignAudience,
    /// Industry label.
    pub industry_name: String,
    /// Vertical id.
    pub vertical_id: String,
    /// Vertical label.
    pub vertical_name: String,
    /// Tags picked for the search.
    pub picked_tags: Vec<String>,
    /// Free-text search phrase.
    pub query: Option<String>,
    /// Area searched.
    pub area: String,
    /// Number of leads wanted.
    pub target: u32,
    /// Leads found so far.
    pub found: u32,
    /// Places skipped because they were already leads.
    pub skipped_duplicates: u32,
    /// Run state.
    pub status: CampaignStatus,
    /// Plain-words reason a run ended short or failed.
    pub end_note: Option<String>,
    /// Who started the run.
    pub run_by: Option<CampaignRunBy>,
    /// Whether the campaign is archived.
    pub archived: bool,
    /// Pubkey of the creator.
    pub created_by: String,
    /// Whether an agent created it.
    pub created_by_agent: bool,
    /// Unix seconds it was created.
    pub created_at: i64,
    /// Unix seconds of the last change.
    pub updated_at: i64,
    /// Event id of the action that produced this head.
    pub source_action_event_id: String,
}

fn check_count(field: &str, value: u32) -> Result<(), OutreachError> {
    if value > MAX_CAMPAIGN_COUNT {
        return invalid(format!("{field} is larger than {MAX_CAMPAIGN_COUNT}"));
    }
    Ok(())
}

fn check_run_by(run_by: &CampaignRunBy) -> Result<(), OutreachError> {
    if run_by.pubkey.len() == 64
        && run_by
            .pubkey
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        invalid("runBy.pubkey must be a 64 character lowercase hex pubkey")
    }
}

fn clean_tags(tags: &[String]) -> Result<Vec<String>, OutreachError> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag = clean_text("pickedTags entry", tag, MAX_CAMPAIGN_LABEL_CHARS, false)?;
        if !out.contains(&tag) {
            out.push(tag);
        }
    }
    if out.len() > MAX_CAMPAIGN_TAGS {
        return invalid(format!(
            "pickedTags has more than {MAX_CAMPAIGN_TAGS} entries"
        ));
    }
    Ok(out)
}

/// Check the shape of a campaign action: schema, which fields each op uses, lengths and caps.
pub fn validate_campaign_action(action: &DiscoveryCampaignAction) -> Result<(), OutreachError> {
    check_schema(action.schema_version)?;
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        check_event_id("expectedHeadEventId", expected)?;
    }
    let op = action.op.label();
    let a = action;
    let identity = [
        ("audience", a.audience.is_some()),
        ("industryName", a.industry_name.is_some()),
        ("verticalId", a.vertical_id.is_some()),
        ("verticalName", a.vertical_name.is_some()),
        ("pickedTags", a.picked_tags.is_some()),
        ("query", a.query.is_some()),
        ("area", a.area.is_some()),
        ("target", a.target.is_some()),
        ("runBy", a.run_by.is_some()),
    ];
    match a.op {
        CampaignOp::Create => {
            if a.expected_head_event_id.is_some() {
                return invalid("create cannot name an expected head");
            }
            require_fields(
                op,
                &[
                    ("name", a.name.is_some()),
                    ("audience", a.audience.is_some()),
                    ("industryName", a.industry_name.is_some()),
                    ("verticalId", a.vertical_id.is_some()),
                    ("verticalName", a.vertical_name.is_some()),
                    ("area", a.area.is_some()),
                    ("target", a.target.is_some()),
                    ("status", a.status.is_some()),
                ],
            )?;
        }
        CampaignOp::Progress => {
            require_fields(
                op,
                &[
                    ("found", a.found.is_some()),
                    ("skippedDuplicates", a.skipped_duplicates.is_some()),
                ],
            )?;
            reject_fields(op, &identity)?;
            reject_fields(
                op,
                &[
                    ("name", a.name.is_some()),
                    ("endNote", a.end_note.is_some()),
                ],
            )?;
            if a.status.is_some_and(CampaignStatus::is_finished) {
                return invalid("progress cannot end a run; use finish");
            }
        }
        CampaignOp::Finish => {
            require_fields(
                op,
                &[
                    ("status", a.status.is_some()),
                    ("found", a.found.is_some()),
                    ("skippedDuplicates", a.skipped_duplicates.is_some()),
                ],
            )?;
            reject_fields(op, &identity)?;
            reject_fields(op, &[("name", a.name.is_some())])?;
            if !a.status.is_some_and(CampaignStatus::is_finished) {
                return invalid("finish needs a status of complete, cancelled or failed");
            }
        }
        CampaignOp::Rename => {
            require_fields(op, &[("name", a.name.is_some())])?;
            reject_fields(op, &identity)?;
            reject_fields(
                op,
                &[
                    ("found", a.found.is_some()),
                    ("skippedDuplicates", a.skipped_duplicates.is_some()),
                    ("status", a.status.is_some()),
                    ("endNote", a.end_note.is_some()),
                ],
            )?;
        }
        CampaignOp::Archive => {
            reject_fields(op, &identity)?;
            reject_fields(
                op,
                &[
                    ("name", a.name.is_some()),
                    ("found", a.found.is_some()),
                    ("skippedDuplicates", a.skipped_duplicates.is_some()),
                    ("status", a.status.is_some()),
                    ("endNote", a.end_note.is_some()),
                ],
            )?;
        }
    }

    if let Some(name) = a.name.as_deref() {
        clean_text("name", name, MAX_CAMPAIGN_NAME_CHARS, false)?;
    }
    for (field, value, max) in [
        (
            "industryName",
            a.industry_name.as_deref(),
            MAX_CAMPAIGN_LABEL_CHARS,
        ),
        (
            "verticalId",
            a.vertical_id.as_deref(),
            MAX_CAMPAIGN_LABEL_CHARS,
        ),
        (
            "verticalName",
            a.vertical_name.as_deref(),
            MAX_CAMPAIGN_LABEL_CHARS,
        ),
        ("area", a.area.as_deref(), MAX_CAMPAIGN_TEXT_CHARS),
    ] {
        if let Some(value) = value {
            clean_text(field, value, max, false)?;
        }
    }
    for (field, value) in [
        ("query", a.query.as_deref()),
        ("endNote", a.end_note.as_deref()),
    ] {
        if let Some(value) = value {
            clean_optional_text(field, value, MAX_CAMPAIGN_TEXT_CHARS, false)?;
        }
    }
    if let Some(tags) = a.picked_tags.as_deref() {
        clean_tags(tags)?;
    }
    if let Some(target) = a.target {
        if target == 0 || target > MAX_CAMPAIGN_TARGET {
            return invalid(format!("target must be 1 through {MAX_CAMPAIGN_TARGET}"));
        }
    }
    if let Some(found) = a.found {
        check_count("found", found)?;
    }
    if let Some(skipped) = a.skipped_duplicates {
        check_count("skippedDuplicates", skipped)?;
    }
    if let Some(run_by) = a.run_by.as_ref() {
        check_run_by(run_by)?;
    }
    Ok(())
}

/// Apply a validated campaign action to the current head (`None` before `create`).
pub fn apply_campaign_action(
    previous: Option<&DiscoveryCampaignHead>,
    action: &DiscoveryCampaignAction,
    actor: &ListActor,
    now: i64,
    source_action_event_id: &str,
) -> Result<DiscoveryCampaignHead, OutreachError> {
    validate_campaign_action(action)?;
    if action.op == CampaignOp::Archive && actor.is_agent {
        return Err(OutreachError::Forbidden(
            "only people can archive a campaign".into(),
        ));
    }
    let Some(previous) = previous else {
        if action.op != CampaignOp::Create {
            return conflict("this campaign does not exist");
        }
        return create_campaign(action, actor, now, source_action_event_id);
    };
    if action.op == CampaignOp::Create {
        return conflict("this campaign already exists");
    }
    if previous.archived {
        return conflict("this campaign is archived");
    }

    let mut head = previous.clone();
    match action.op {
        CampaignOp::Create => return conflict("this campaign already exists"),
        CampaignOp::Rename => {
            head.name = clean_text(
                "name",
                action.name.as_deref().unwrap_or_default(),
                MAX_CAMPAIGN_NAME_CHARS,
                false,
            )?;
        }
        CampaignOp::Archive => head.archived = true,
        CampaignOp::Progress | CampaignOp::Finish => {
            if previous.status.is_finished() {
                return conflict("this campaign run has already ended");
            }
            // Counts never go down: a late or repeated update keeps the larger value.
            head.found = head.found.max(action.found.unwrap_or(0));
            head.skipped_duplicates = head
                .skipped_duplicates
                .max(action.skipped_duplicates.unwrap_or(0));
            if let Some(status) = action.status {
                head.status = status;
            }
            if action.op == CampaignOp::Finish {
                head.end_note = match action.end_note.as_deref() {
                    Some(note) => {
                        let note =
                            clean_optional_text("endNote", note, MAX_CAMPAIGN_TEXT_CHARS, false)?;
                        if note.is_empty() {
                            None
                        } else {
                            Some(note)
                        }
                    }
                    None => None,
                };
            }
        }
    }
    head.updated_at = now;
    head.source_action_event_id = source_action_event_id.to_owned();
    Ok(head)
}

fn create_campaign(
    action: &DiscoveryCampaignAction,
    actor: &ListActor,
    now: i64,
    source_action_event_id: &str,
) -> Result<DiscoveryCampaignHead, OutreachError> {
    let text = |field: &str, value: &Option<String>, max: usize| -> Result<String, OutreachError> {
        clean_text(field, value.as_deref().unwrap_or_default(), max, false)
    };
    let optional = |field: &str, value: &Option<String>| -> Result<Option<String>, OutreachError> {
        match value.as_deref() {
            Some(value) => {
                let value = clean_optional_text(field, value, MAX_CAMPAIGN_TEXT_CHARS, false)?;
                Ok(if value.is_empty() { None } else { Some(value) })
            }
            None => Ok(None),
        }
    };
    let (Some(audience), Some(target), Some(status)) =
        (action.audience, action.target, action.status)
    else {
        return invalid("create needs audience, target and status");
    };
    Ok(DiscoveryCampaignHead {
        schema_version: BUSINESS_RECORD_SCHEMA_VERSION,
        campaign_id: action.campaign_id,
        name: text("name", &action.name, MAX_CAMPAIGN_NAME_CHARS)?,
        audience,
        industry_name: text(
            "industryName",
            &action.industry_name,
            MAX_CAMPAIGN_LABEL_CHARS,
        )?,
        vertical_id: text("verticalId", &action.vertical_id, MAX_CAMPAIGN_LABEL_CHARS)?,
        vertical_name: text(
            "verticalName",
            &action.vertical_name,
            MAX_CAMPAIGN_LABEL_CHARS,
        )?,
        picked_tags: clean_tags(action.picked_tags.as_deref().unwrap_or_default())?,
        query: optional("query", &action.query)?,
        area: text("area", &action.area, MAX_CAMPAIGN_TEXT_CHARS)?,
        target,
        found: action.found.unwrap_or(0),
        skipped_duplicates: action.skipped_duplicates.unwrap_or(0),
        status,
        end_note: optional("endNote", &action.end_note)?,
        run_by: action.run_by.clone(),
        archived: false,
        created_by: actor.pubkey.clone(),
        created_by_agent: actor.is_agent,
        created_at: now,
        updated_at: now,
        source_action_event_id: source_action_event_id.to_owned(),
    })
}

/// Check the shape of a stored campaign head.
pub fn validate_campaign_head(head: &DiscoveryCampaignHead) -> Result<(), OutreachError> {
    check_schema(head.schema_version)?;
    clean_text("name", &head.name, MAX_CAMPAIGN_NAME_CHARS, false)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EVENT: &str = "0000000000000000000000000000000000000000000000000000000000000001";
    const PERSON: &str = "aa00000000000000000000000000000000000000000000000000000000000001";
    const AGENT: &str = "bb00000000000000000000000000000000000000000000000000000000000002";

    fn person() -> ListActor {
        ListActor {
            pubkey: PERSON.into(),
            is_agent: false,
        }
    }

    fn agent() -> ListActor {
        ListActor {
            pubkey: AGENT.into(),
            is_agent: true,
        }
    }

    fn lead(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn action(op: ListOp) -> OutreachListAction {
        OutreachListAction {
            schema_version: 1,
            list_id: lead(900),
            op,
            expected_head_event_id: None,
            name: None,
            note: None,
            lead_ids: Vec::new(),
            source: None,
            default_template: None,
        }
    }

    fn create_action(leads: &[u128]) -> OutreachListAction {
        OutreachListAction {
            name: Some("  Melville guesthouses, Nov ".into()),
            source: Some(ListSource {
                kind: ListSourceKind::Manual,
                campaign_id: None,
            }),
            lead_ids: leads.iter().map(|n| lead(*n)).collect(),
            ..action(ListOp::Create)
        }
    }

    fn created(leads: &[u128], actor: &ListActor) -> OutreachListHead {
        apply_list_action(None, &create_action(leads), actor, 100, EVENT).expect("create")
    }

    #[test]
    fn create_trims_the_name_keeps_add_order_and_marks_the_agent() {
        let head = created(&[3, 1, 3, 2], &agent());
        assert_eq!(head.name, "Melville guesthouses, Nov");
        assert_eq!(
            head.members.iter().map(|m| m.lead_id).collect::<Vec<_>>(),
            vec![lead(3), lead(1), lead(2)]
        );
        assert!(head.created_by_agent && head.members.iter().all(|m| m.added_by_agent));
        assert_eq!(head.status, ListStatus::Active);
        assert_eq!(head.created_by, AGENT);
        assert!(validate_list_head(&head).is_ok());
    }

    #[test]
    fn create_needs_a_name_and_a_source_and_no_expected_head() {
        let mut a = create_action(&[]);
        a.name = None;
        assert!(validate_list_action(&a).is_err());
        let mut a = create_action(&[]);
        a.source = None;
        assert!(validate_list_action(&a).is_err());
        let mut a = create_action(&[]);
        a.expected_head_event_id = Some(EVENT.into());
        assert!(validate_list_action(&a).is_err());
        let mut a = create_action(&[]);
        a.name = Some("   ".into());
        assert!(validate_list_action(&a).is_err());
        let mut a = create_action(&[]);
        a.name = Some("x".repeat(MAX_LIST_NAME_CHARS + 1));
        assert!(validate_list_action(&a).is_err());
    }

    #[test]
    fn source_kind_and_campaign_id_must_agree() {
        let mut a = create_action(&[]);
        a.source = Some(ListSource {
            kind: ListSourceKind::Campaign,
            campaign_id: None,
        });
        assert!(validate_list_action(&a).is_err());
        a.source = Some(ListSource {
            kind: ListSourceKind::Agent,
            campaign_id: Some(lead(5)),
        });
        assert!(validate_list_action(&a).is_err());
        a.source = Some(ListSource {
            kind: ListSourceKind::Campaign,
            campaign_id: Some(lead(5)),
        });
        assert!(validate_list_action(&a).is_ok());
    }

    #[test]
    fn a_list_holds_at_most_500_leads() {
        let ids: Vec<u128> = (1..=501).collect();
        assert!(validate_list_action(&create_action(&ids)).is_err());
        let ids: Vec<u128> = (1..=500).collect();
        let head = created(&ids, &person());
        let mut add = action(ListOp::AddMembers);
        add.lead_ids = vec![lead(9_999)];
        let error = apply_list_action(Some(&head), &add, &person(), 200, EVENT).unwrap_err();
        assert!(matches!(error, OutreachError::Invalid(_)), "{error}");
    }

    #[test]
    fn add_ignores_present_ids_and_remove_ignores_absent_ids() {
        let head = created(&[1, 2], &person());
        let mut add = action(ListOp::AddMembers);
        add.lead_ids = vec![lead(2), lead(3), lead(3)];
        let next = apply_list_action(Some(&head), &add, &agent(), 200, EVENT).unwrap();
        assert_eq!(
            next.members.iter().map(|m| m.lead_id).collect::<Vec<_>>(),
            vec![lead(1), lead(2), lead(3)]
        );
        assert!(!next.members[1].added_by_agent && next.members[2].added_by_agent);
        assert_eq!(next.updated_at, 200);

        let mut remove = action(ListOp::RemoveMembers);
        remove.lead_ids = vec![lead(1), lead(77)];
        let next = apply_list_action(Some(&next), &remove, &person(), 300, EVENT).unwrap();
        assert_eq!(
            next.members.iter().map(|m| m.lead_id).collect::<Vec<_>>(),
            vec![lead(2), lead(3)]
        );
    }

    #[test]
    fn leads_to_verify_are_only_the_new_ones() {
        let head = created(&[1, 2], &person());
        let mut add = action(ListOp::AddMembers);
        add.lead_ids = vec![lead(2), lead(3), lead(3), lead(4)];
        assert_eq!(
            list_leads_to_verify(Some(&head), &add),
            vec![lead(3), lead(4)]
        );
        let mut remove = action(ListOp::RemoveMembers);
        remove.lead_ids = vec![lead(1)];
        assert!(list_leads_to_verify(Some(&head), &remove).is_empty());
        assert_eq!(
            list_leads_to_verify(None, &create_action(&[5, 5, 6])),
            vec![lead(5), lead(6)]
        );
    }

    #[test]
    fn rename_changes_the_name_and_an_empty_note_clears_it() {
        let mut head = created(&[1], &person());
        head.note = Some("old".into());
        let mut rename = action(ListOp::Rename);
        rename.name = Some("Sandton lodges".into());
        rename.note = Some("".into());
        let next = apply_list_action(Some(&head), &rename, &agent(), 200, EVENT).unwrap();
        assert_eq!(next.name, "Sandton lodges");
        assert_eq!(next.note, None);
        assert_eq!(next.updated_by, AGENT);
        assert_eq!(next.created_by, PERSON);

        assert!(validate_list_action(&action(ListOp::Rename)).is_err());
    }

    #[test]
    fn default_template_is_set_by_name_and_cleared_when_absent() {
        let head = created(&[1], &person());
        let mut set = action(ListOp::SetDefaultTemplate);
        set.default_template = Some(TemplateRef {
            name: " built_a_site ".into(),
            language: "en".into(),
        });
        let next = apply_list_action(Some(&head), &set, &person(), 200, EVENT).unwrap();
        assert_eq!(next.default_template.as_ref().unwrap().name, "built_a_site");
        let clear = action(ListOp::SetDefaultTemplate);
        let next = apply_list_action(Some(&next), &clear, &person(), 300, EVENT).unwrap();
        assert_eq!(next.default_template, None);
    }

    #[test]
    fn agents_cannot_archive_or_restore_but_people_can() {
        let head = created(&[1], &person());
        let error = apply_list_action(Some(&head), &action(ListOp::Archive), &agent(), 200, EVENT)
            .unwrap_err();
        assert!(matches!(error, OutreachError::Forbidden(_)));
        let archived =
            apply_list_action(Some(&head), &action(ListOp::Archive), &person(), 200, EVENT)
                .unwrap();
        assert_eq!(archived.status, ListStatus::Archived);
        let error = apply_list_action(
            Some(&archived),
            &action(ListOp::Unarchive),
            &agent(),
            300,
            EVENT,
        )
        .unwrap_err();
        assert!(matches!(error, OutreachError::Forbidden(_)));
        let restored = apply_list_action(
            Some(&archived),
            &action(ListOp::Unarchive),
            &person(),
            300,
            EVENT,
        )
        .unwrap();
        assert_eq!(restored.status, ListStatus::Active);
    }

    #[test]
    fn an_archived_list_only_accepts_unarchive() {
        let head = created(&[1], &person());
        let archived =
            apply_list_action(Some(&head), &action(ListOp::Archive), &person(), 200, EVENT)
                .unwrap();
        let mut add = action(ListOp::AddMembers);
        add.lead_ids = vec![lead(2)];
        let error = apply_list_action(Some(&archived), &add, &person(), 300, EVENT).unwrap_err();
        assert!(matches!(error, OutreachError::Conflict(_)));
        let error = apply_list_action(
            Some(&archived),
            &action(ListOp::Archive),
            &person(),
            300,
            EVENT,
        )
        .unwrap_err();
        assert!(matches!(error, OutreachError::Conflict(_)));
        let error = apply_list_action(
            Some(&head),
            &action(ListOp::Unarchive),
            &person(),
            300,
            EVENT,
        )
        .unwrap_err();
        assert!(matches!(error, OutreachError::Conflict(_)));
    }

    #[test]
    fn create_conflicts_with_an_existing_list_and_edits_need_a_list() {
        let head = created(&[1], &person());
        let error = apply_list_action(Some(&head), &create_action(&[2]), &person(), 200, EVENT)
            .unwrap_err();
        assert!(matches!(error, OutreachError::Conflict(_)));
        let mut add = action(ListOp::AddMembers);
        add.lead_ids = vec![lead(2)];
        let error = apply_list_action(None, &add, &person(), 200, EVENT).unwrap_err();
        assert!(matches!(error, OutreachError::Conflict(_)));
    }

    #[test]
    fn fields_an_op_does_not_use_are_refused() {
        let mut add = action(ListOp::AddMembers);
        add.lead_ids = vec![lead(1)];
        add.name = Some("nope".into());
        assert!(validate_list_action(&add).is_err());
        let mut archive = action(ListOp::Archive);
        archive.lead_ids = vec![lead(1)];
        assert!(validate_list_action(&archive).is_err());
        assert!(validate_list_action(&action(ListOp::AddMembers)).is_err());
    }

    #[test]
    fn a_wrong_schema_version_or_malformed_expected_head_is_refused() {
        let mut a = create_action(&[]);
        a.schema_version = 2;
        assert!(validate_list_action(&a).is_err());
        let mut a = action(ListOp::Archive);
        a.expected_head_event_id = Some("ABC".into());
        assert!(validate_list_action(&a).is_err());
        a.expected_head_event_id = Some(EVENT.into());
        assert!(validate_list_action(&a).is_ok());
    }

    #[test]
    fn list_action_json_round_trips_in_camel_case_and_rejects_unknown_fields() {
        let json = r#"{"schemaVersion":1,"listId":"00000000-0000-0000-0000-000000000384",
            "op":"add_members","expectedHeadEventId":null,"name":null,"note":null,
            "leadIds":["00000000-0000-0000-0000-000000000001"],"source":null,
            "defaultTemplate":null}"#;
        let parsed: OutreachListAction = serde_json::from_str(json).expect("parse");
        assert_eq!(parsed.op, ListOp::AddMembers);
        assert_eq!(parsed.lead_ids, vec![lead(1)]);
        let with_extra = json.replace("\"note\":null,", "\"note\":null,\"extra\":1,");
        assert!(serde_json::from_str::<OutreachListAction>(&with_extra).is_err());
        let minimal =
            r#"{"schemaVersion":1,"listId":"00000000-0000-0000-0000-000000000384","op":"archive"}"#;
        assert!(serde_json::from_str::<OutreachListAction>(minimal).is_ok());
    }

    #[test]
    fn head_json_uses_camel_case_and_nulls() {
        let head = created(&[1], &person());
        let value = serde_json::to_value(&head).unwrap();
        assert_eq!(value["status"], "active");
        assert_eq!(value["source"]["kind"], "manual");
        assert!(value["source"]["campaignId"].is_null());
        assert!(value["defaultTemplate"].is_null());
        assert_eq!(value["members"][0]["addedByAgent"], false);
        let back: OutreachListHead = serde_json::from_value(value).unwrap();
        assert_eq!(back, head);
    }

    #[test]
    fn d_tags_are_namespaced_per_community_and_kind_of_record() {
        let community = lead(7);
        assert_eq!(
            outreach_list_d_tag(community, lead(9)),
            format!("business:{}:outreach_list:{}", lead(7), lead(9))
        );
        assert_eq!(
            discovery_campaign_d_tag(community, lead(9)),
            format!("business:{}:discovery_campaign:{}", lead(7), lead(9))
        );
        assert_ne!(
            outreach_list_d_tag(community, lead(9)),
            discovery_campaign_d_tag(community, lead(9))
        );
    }

    fn campaign_create() -> DiscoveryCampaignAction {
        DiscoveryCampaignAction {
            schema_version: 1,
            campaign_id: lead(50),
            op: CampaignOp::Create,
            expected_head_event_id: None,
            name: Some("Restaurants prospects, Johannesburg".into()),
            audience: Some(CampaignAudience::Businesses),
            industry_name: Some("Food and drink".into()),
            vertical_id: Some("restaurants".into()),
            vertical_name: Some("Restaurants".into()),
            picked_tags: Some(vec!["fine dining".into(), "fine dining".into()]),
            query: Some("".into()),
            area: Some("Johannesburg, South Africa".into()),
            target: Some(50),
            found: None,
            skipped_duplicates: None,
            status: Some(CampaignStatus::Running),
            end_note: None,
            run_by: Some(CampaignRunBy {
                kind: RunnerKind::Person,
                pubkey: PERSON.into(),
            }),
        }
    }

    fn campaign_op(op: CampaignOp) -> DiscoveryCampaignAction {
        DiscoveryCampaignAction {
            op,
            name: None,
            audience: None,
            industry_name: None,
            vertical_id: None,
            vertical_name: None,
            picked_tags: None,
            query: None,
            area: None,
            target: None,
            status: None,
            run_by: None,
            ..campaign_create()
        }
    }

    fn campaign() -> DiscoveryCampaignHead {
        apply_campaign_action(None, &campaign_create(), &person(), 100, EVENT).expect("create")
    }

    #[test]
    fn campaign_create_dedupes_tags_and_drops_an_empty_query() {
        let head = campaign();
        assert_eq!(head.picked_tags, vec!["fine dining".to_string()]);
        assert_eq!(head.query, None);
        assert_eq!(head.found, 0);
        assert_eq!(head.status, CampaignStatus::Running);
        assert!(!head.archived);
        assert!(validate_campaign_head(&head).is_ok());
    }

    #[test]
    fn campaign_create_can_carry_final_numbers_for_the_backfill() {
        let mut a = campaign_create();
        a.found = Some(39);
        a.skipped_duplicates = Some(4);
        a.status = Some(CampaignStatus::Complete);
        a.end_note = Some("Google has no more restaurants".into());
        let head = apply_campaign_action(None, &a, &person(), 100, EVENT).unwrap();
        assert_eq!((head.found, head.skipped_duplicates), (39, 4));
        assert_eq!(head.status, CampaignStatus::Complete);
        assert!(head.end_note.is_some());
    }

    #[test]
    fn campaign_target_must_be_1_to_500() {
        for target in [0, 501] {
            let mut a = campaign_create();
            a.target = Some(target);
            assert!(validate_campaign_action(&a).is_err(), "{target}");
        }
        let mut a = campaign_create();
        a.target = Some(500);
        assert!(validate_campaign_action(&a).is_ok());
    }

    #[test]
    fn progress_never_lowers_counts_and_cannot_end_a_run() {
        let head = campaign();
        let mut p = campaign_op(CampaignOp::Progress);
        p.found = Some(12);
        p.skipped_duplicates = Some(3);
        let head = apply_campaign_action(Some(&head), &p, &agent(), 200, EVENT).unwrap();
        assert_eq!((head.found, head.skipped_duplicates), (12, 3));
        p.found = Some(5);
        p.skipped_duplicates = Some(9);
        p.status = Some(CampaignStatus::Paused);
        let head = apply_campaign_action(Some(&head), &p, &agent(), 300, EVENT).unwrap();
        assert_eq!((head.found, head.skipped_duplicates), (12, 9));
        assert_eq!(head.status, CampaignStatus::Paused);
        p.status = Some(CampaignStatus::Complete);
        assert!(validate_campaign_action(&p).is_err());
    }

    #[test]
    fn finish_ends_the_run_once() {
        let head = campaign();
        let mut f = campaign_op(CampaignOp::Finish);
        f.found = Some(50);
        f.skipped_duplicates = Some(2);
        f.status = Some(CampaignStatus::Complete);
        let head = apply_campaign_action(Some(&head), &f, &person(), 200, EVENT).unwrap();
        assert_eq!(head.status, CampaignStatus::Complete);
        assert_eq!(head.end_note, None);
        let error = apply_campaign_action(Some(&head), &f, &person(), 300, EVENT).unwrap_err();
        assert!(matches!(error, OutreachError::Conflict(_)));
        f.status = Some(CampaignStatus::Running);
        assert!(validate_campaign_action(&f).is_err());
    }

    #[test]
    fn campaign_rename_and_archive_rules() {
        let head = campaign();
        let mut rename = campaign_op(CampaignOp::Rename);
        rename.name = Some("Joburg restaurants".into());
        let head = apply_campaign_action(Some(&head), &rename, &agent(), 200, EVENT).unwrap();
        assert_eq!(head.name, "Joburg restaurants");

        let archive = campaign_op(CampaignOp::Archive);
        let error = apply_campaign_action(Some(&head), &archive, &agent(), 300, EVENT).unwrap_err();
        assert!(matches!(error, OutreachError::Forbidden(_)));
        let head = apply_campaign_action(Some(&head), &archive, &person(), 300, EVENT).unwrap();
        assert!(head.archived);
        let error = apply_campaign_action(Some(&head), &rename, &person(), 400, EVENT).unwrap_err();
        assert!(matches!(error, OutreachError::Conflict(_)));
    }

    #[test]
    fn campaign_ops_refuse_fields_they_do_not_use() {
        let mut p = campaign_op(CampaignOp::Progress);
        p.found = Some(1);
        p.skipped_duplicates = Some(0);
        p.name = Some("x".into());
        assert!(validate_campaign_action(&p).is_err());
        let mut r = campaign_op(CampaignOp::Rename);
        r.name = Some("x".into());
        r.target = Some(5);
        assert!(validate_campaign_action(&r).is_err());
        assert!(validate_campaign_action(&campaign_op(CampaignOp::Rename)).is_err());
        let mut c = campaign_create();
        c.area = None;
        assert!(validate_campaign_action(&c).is_err());
    }

    #[test]
    fn campaign_json_round_trips() {
        let head = campaign();
        let value = serde_json::to_value(&head).unwrap();
        assert_eq!(value["audience"], "businesses");
        assert_eq!(value["status"], "running");
        assert_eq!(value["runBy"]["kind"], "person");
        let back: DiscoveryCampaignHead = serde_json::from_value(value).unwrap();
        assert_eq!(back, head);
    }
}
