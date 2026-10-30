//! Co-founder onboarding state.
//!
//! When co-founder mode is switched on, Scout plays back a business brief, asks
//! only what is missing (one question at a time), and proposes the company map.
//! One relay-signed head (`company:onboarding`) remembers where that stands, so
//! switching co-founder mode off and on again never restarts it.
//!
//! The answers themselves live in their own records: the brief in `company:brief`
//! and the money setting and approval switches in `company:cofounder`. This record
//! holds progress only: which steps are done, the single open question, the
//! accounts Scout asked the owner to connect, and the proposed company map.
//!
//! Scout (a managed agent) asks and proposes; only an owner or admin answers and
//! approves. This is a new kind, so a desktop that predates it keeps loading its
//! existing lists.

use serde::{Deserialize, Serialize};

use crate::company_cofounder::{ApprovalSwitches, CofounderSettings, MoneyPreference};
use crate::company_functions::CompanyFunction;
use crate::company_records::{is_hex_id, CompanyRecordError, COMPANY_RECORD_SCHEMA_VERSION};

/// Relay-authored onboarding head (community-wide).
pub const KIND_ONBOARDING_HEAD: u32 = crate::kind::KIND_ONBOARDING_HEAD;
/// Member onboarding mutation, brokered and community-wide.
pub const KIND_ONBOARDING_ACTION: u32 = crate::kind::KIND_ONBOARDING_ACTION;
/// The single d-tag of the onboarding record.
pub const ONBOARDING_D_TAG: &str = "company:onboarding";

/// Longest question text, in characters.
pub const MAX_QUESTION_CHARS: usize = 200;
/// Most accounts one onboarding can ask the owner to connect.
pub const MAX_ONBOARDING_ACCOUNTS: usize = 8;
/// Longest account id, in characters.
pub const MAX_ACCOUNT_ID_CHARS: usize = 40;
/// Longest account label, in characters.
pub const MAX_ACCOUNT_LABEL_CHARS: usize = 80;
/// Longest account page address, in characters.
pub const MAX_ACCOUNT_URL_CHARS: usize = 300;

/// One step of onboarding, in the order the owner meets them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingStep {
    /// Check the business brief Scout played back.
    Brief,
    /// Choose cheapest first or best option.
    Money,
    /// Choose what else waits for the owner's OK.
    Approvals,
    /// Connect an account Scout needs (for example Pinterest).
    Accounts,
    /// Approve the company map.
    Map,
}

impl OnboardingStep {
    /// Every step, in order.
    pub const ALL: [OnboardingStep; 5] = [
        OnboardingStep::Brief,
        OnboardingStep::Money,
        OnboardingStep::Approvals,
        OnboardingStep::Accounts,
        OnboardingStep::Map,
    ];
}

/// Where one step stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepState {
    /// Not asked yet.
    Todo,
    /// Scout asked; waiting for the owner.
    Asked,
    /// Answered.
    Done,
    /// The owner chose to skip it.
    Skipped,
}

impl StepState {
    const fn is_settled(self) -> bool {
        matches!(self, StepState::Done | StepState::Skipped)
    }
}

/// A step and its state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StepStatus {
    /// Which step.
    pub step: OnboardingStep,
    /// Its state.
    pub state: StepState,
}

/// An account Scout asks the owner to connect.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountRequest {
    /// Lower case slug, for example `pinterest`.
    pub id: String,
    /// Name shown to the owner, for example "Pinterest".
    pub label: String,
    /// The login page Scout opens in the built-in browser. Must be `https://`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Where one requested account stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountState {
    /// Waiting for the owner to log in.
    Asked,
    /// The owner said they are logged in.
    Done,
    /// The owner skipped it.
    Skipped,
}

/// A requested account and its state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountEntry {
    /// Lower case slug, for example `pinterest`.
    pub id: String,
    /// Name shown to the owner.
    pub label: String,
    /// The login page, when Scout gave one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Its state.
    pub state: AccountState,
}

impl AccountEntry {
    fn from_request(request: &AccountRequest, state: AccountState) -> Self {
        Self {
            id: request.id.clone(),
            label: request.label.clone(),
            url: request.url.clone(),
            state,
        }
    }

    fn request(&self) -> AccountRequest {
        AccountRequest {
            id: self.id.clone(),
            label: self.label.clone(),
            url: self.url.clone(),
        }
    }
}

/// The one question waiting for the owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OpenQuestion {
    /// The step it belongs to.
    pub step: OnboardingStep,
    /// A short question.
    pub text: String,
    /// For the accounts step: the account to connect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountRequest>,
}

/// How Scout proposes to cover one function.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapPlacement {
    /// An agent already on the team moves into the slot. Needs `leadPubkey`.
    ExistingAgent,
    /// Scout covers the function for now.
    Scout,
    /// Nobody yet; the slot stays empty.
    Empty,
}

/// One function in the proposed map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MapEntry {
    /// The function.
    pub function: CompanyFunction,
    /// How it is covered.
    pub placement: MapPlacement,
    /// The agent for `existing_agent`; absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_pubkey: Option<String>,
}

/// What Scout proposes: all five functions in order and which one to fill first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MapProposalInput {
    /// Exactly five entries, in function order.
    pub entries: Vec<MapEntry>,
    /// The function to fill first.
    pub first_function: CompanyFunction,
}

/// The proposed company map and whether the owner approved it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MapProposal {
    /// Exactly five entries, in function order.
    pub entries: Vec<MapEntry>,
    /// The function to fill first.
    pub first_function: CompanyFunction,
    /// Whether an owner or admin approved it. Approval records the decision only;
    /// slots are filled by the function slot actions.
    pub approved: bool,
}

/// What an onboarding action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingActionKind {
    /// Begin onboarding, or resume it without losing progress.
    Start,
    /// Ask the owner one question.
    Ask,
    /// Take the open question back.
    Withdraw,
    /// Propose the company map.
    ProposeMap,
    /// The owner answers the open question.
    Answer,
    /// The owner approves the proposed map.
    ApproveMap,
    /// The owner turns the proposed map down.
    RejectMap,
    /// Finish onboarding.
    Complete,
}

impl OnboardingActionKind {
    /// Whether only an owner or an admin may take this action.
    pub const fn needs_admin(self) -> bool {
        matches!(
            self,
            OnboardingActionKind::Answer
                | OnboardingActionKind::ApproveMap
                | OnboardingActionKind::RejectMap
        )
    }
}

/// Member-signed onboarding change (kind 47065).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OnboardingAction {
    /// Schema version.
    pub schema_version: u8,
    /// What to do.
    pub kind: OnboardingActionKind,
    /// The step, for `ask` and `answer`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<OnboardingStep>,
    /// The question, for `ask`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// The account, for `ask` on the accounts step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountRequest>,
    /// The map, for `propose_map`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map: Option<MapProposalInput>,
    /// For `answer`: the owner skips the question.
    #[serde(default)]
    pub skipped: bool,
    /// For `answer` on the money step: the setting the owner chose. Must match
    /// the saved co-founder settings, so save the setting first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub money_preference: Option<MoneyPreference>,
    /// For `answer` on the approvals step: the switches the owner chose. Must
    /// match the saved co-founder settings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_switches: Option<ApprovalSwitches>,
    /// For `start`: the agent that leads co-founder work (Scout). Defaults to the
    /// signer when the signer is an agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lead_pubkey: Option<String>,
    /// Exact current head event id, omitted only while no head exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,
}

/// Whether onboarding is still going.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingStatus {
    /// Steps remain.
    InProgress,
    /// Finished. Switching co-founder mode off and on does not reopen it.
    Complete,
}

/// Relay-authored canonical onboarding head (kind 30675).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OnboardingHead {
    /// Schema version.
    pub schema_version: u8,
    /// Counts every accepted action, starting at 1.
    pub revision: u32,
    /// In progress or complete.
    pub status: OnboardingStatus,
    /// The agent that leads co-founder work. Wakes go to this agent.
    pub lead_pubkey: String,
    /// All five steps, in order.
    pub steps: Vec<StepStatus>,
    /// The one open question, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question: Option<OpenQuestion>,
    /// Accounts Scout asked the owner to connect.
    #[serde(default)]
    pub accounts: Vec<AccountEntry>,
    /// The proposed company map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub map: Option<MapProposal>,
    /// Unix seconds onboarding started.
    pub started_at: i64,
    /// Unix seconds onboarding was last resumed (switched back on).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resumed_at: Option<i64>,
    /// How many times onboarding was resumed.
    #[serde(default)]
    pub resume_count: u32,
    /// Unix seconds onboarding finished.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
    /// Who made the last change.
    pub updated_by_pubkey: String,
    /// Unix seconds of the last change.
    pub updated_at: i64,
}

impl OnboardingHead {
    /// The state of one step.
    pub fn step_state(&self, step: OnboardingStep) -> StepState {
        self.steps
            .iter()
            .find(|status| status.step == step)
            .map_or(StepState::Todo, |status| status.state)
    }

    fn set_step(&mut self, step: OnboardingStep, state: StepState) {
        if let Some(status) = self.steps.iter_mut().find(|status| status.step == step) {
            status.state = state;
        }
    }
}

/// Saved facts an action is checked against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OnboardingContext {
    /// The company's saved co-founder settings (defaults while none are saved).
    pub settings: CofounderSettings,
    /// Whether the owner has confirmed a business brief.
    pub brief_confirmed: bool,
}

fn slug_ok(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_ACCOUNT_ID_CHARS
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Validate an account request.
pub fn validate_account_request(account: &AccountRequest) -> Result<(), CompanyRecordError> {
    if !slug_ok(&account.id) {
        return Err(CompanyRecordError::Invalid(
            "account id must be a lower case slug of 1 to 40 characters",
        ));
    }
    if account.label.trim().is_empty() || account.label.chars().count() > MAX_ACCOUNT_LABEL_CHARS {
        return Err(CompanyRecordError::Invalid(
            "account label must be 1 to 80 characters",
        ));
    }
    if let Some(url) = account.url.as_deref() {
        if !url.starts_with("https://")
            || url.chars().count() > MAX_ACCOUNT_URL_CHARS
            || url.chars().any(char::is_whitespace)
        {
            return Err(CompanyRecordError::Invalid(
                "account url must be an https:// address of at most 300 characters",
            ));
        }
    }
    Ok(())
}

fn validate_map_entries(
    entries: &[MapEntry],
    first_function: CompanyFunction,
) -> Result<(), CompanyRecordError> {
    if entries.len() != CompanyFunction::ALL.len()
        || entries
            .iter()
            .zip(CompanyFunction::ALL)
            .any(|(entry, function)| entry.function != function)
    {
        return Err(CompanyRecordError::Invalid(
            "the map needs the five functions once each, in order",
        ));
    }
    for entry in entries {
        match (entry.placement, entry.lead_pubkey.as_deref()) {
            (MapPlacement::ExistingAgent, Some(lead)) if is_hex_id(lead) => {}
            (MapPlacement::ExistingAgent, _) => {
                return Err(CompanyRecordError::Invalid(
                    "an existing agent placement needs a lead public key",
                ));
            }
            (MapPlacement::Scout | MapPlacement::Empty, None) => {}
            (MapPlacement::Scout | MapPlacement::Empty, Some(_)) => {
                return Err(CompanyRecordError::Invalid(
                    "only an existing agent placement names a lead",
                ));
            }
        }
    }
    if !entries.iter().any(|entry| entry.function == first_function) {
        return Err(CompanyRecordError::Invalid(
            "the first function must be one of the five functions",
        ));
    }
    Ok(())
}

/// Validate an onboarding action's shape for its kind.
pub fn validate_onboarding_action(action: &OnboardingAction) -> Result<(), CompanyRecordError> {
    if action.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if let Some(expected) = action.expected_head_event_id.as_deref() {
        if !is_hex_id(expected) {
            return Err(CompanyRecordError::Invalid(
                "expectedHeadEventId must be a 64-character event id",
            ));
        }
    }
    if let Some(lead) = action.lead_pubkey.as_deref() {
        if !is_hex_id(lead) {
            return Err(CompanyRecordError::Invalid(
                "leadPubkey must be a 64-character public key",
            ));
        }
    }
    let carries_payload = action.step.is_some()
        || action.text.is_some()
        || action.account.is_some()
        || action.map.is_some()
        || action.skipped
        || action.money_preference.is_some()
        || action.approval_switches.is_some();
    match action.kind {
        OnboardingActionKind::Start => {
            if carries_payload {
                return Err(CompanyRecordError::Invalid(
                    "start carries no step, question or map",
                ));
            }
        }
        OnboardingActionKind::Withdraw
        | OnboardingActionKind::ApproveMap
        | OnboardingActionKind::RejectMap
        | OnboardingActionKind::Complete => {
            if carries_payload || action.lead_pubkey.is_some() {
                return Err(CompanyRecordError::Invalid(
                    "this action carries no step, question or map",
                ));
            }
        }
        OnboardingActionKind::Ask => {
            let (Some(step), Some(text)) = (action.step, action.text.as_deref()) else {
                return Err(CompanyRecordError::Invalid(
                    "ask needs a step and a question",
                ));
            };
            if text.trim().is_empty() || text.chars().count() > MAX_QUESTION_CHARS {
                return Err(CompanyRecordError::Invalid(
                    "the question must be 1 to 200 characters",
                ));
            }
            if step == OnboardingStep::Map {
                return Err(CompanyRecordError::Invalid(
                    "the map is proposed with propose_map, not asked",
                ));
            }
            match (step, action.account.as_ref()) {
                (OnboardingStep::Accounts, Some(account)) => validate_account_request(account)?,
                (OnboardingStep::Accounts, None) => {
                    return Err(CompanyRecordError::Invalid(
                        "an accounts question names the account",
                    ));
                }
                (_, Some(_)) => {
                    return Err(CompanyRecordError::Invalid(
                        "only an accounts question names an account",
                    ));
                }
                (_, None) => {}
            }
            if action.map.is_some()
                || action.skipped
                || action.money_preference.is_some()
                || action.approval_switches.is_some()
                || action.lead_pubkey.is_some()
            {
                return Err(CompanyRecordError::Invalid("ask carries only a question"));
            }
        }
        OnboardingActionKind::ProposeMap => {
            let Some(map) = action.map.as_ref() else {
                return Err(CompanyRecordError::Invalid("propose_map needs the map"));
            };
            validate_map_entries(&map.entries, map.first_function)?;
            if action.step.is_some()
                || action.text.is_some()
                || action.account.is_some()
                || action.skipped
                || action.money_preference.is_some()
                || action.approval_switches.is_some()
                || action.lead_pubkey.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "propose_map carries only the map",
                ));
            }
        }
        OnboardingActionKind::Answer => {
            let Some(step) = action.step else {
                return Err(CompanyRecordError::Invalid("answer needs the step"));
            };
            if step == OnboardingStep::Map {
                return Err(CompanyRecordError::Invalid(
                    "the map is approved with approve_map",
                ));
            }
            if action.text.is_some()
                || action.account.is_some()
                || action.map.is_some()
                || action.lead_pubkey.is_some()
            {
                return Err(CompanyRecordError::Invalid(
                    "answer carries only the answer",
                ));
            }
            if !action.skipped {
                match step {
                    OnboardingStep::Money if action.money_preference.is_none() => {
                        return Err(CompanyRecordError::Invalid(
                            "a money answer names the chosen setting",
                        ));
                    }
                    OnboardingStep::Approvals if action.approval_switches.is_none() => {
                        return Err(CompanyRecordError::Invalid(
                            "an approvals answer names the chosen switches",
                        ));
                    }
                    _ => {}
                }
            }
            if (step != OnboardingStep::Money && action.money_preference.is_some())
                || (step != OnboardingStep::Approvals && action.approval_switches.is_some())
            {
                return Err(CompanyRecordError::Invalid(
                    "a setting belongs only to its own step",
                ));
            }
        }
    }
    Ok(())
}

/// Validate a relay-authored onboarding head.
pub fn validate_onboarding_head(head: &OnboardingHead) -> Result<(), CompanyRecordError> {
    if head.schema_version != COMPANY_RECORD_SCHEMA_VERSION {
        return Err(CompanyRecordError::UnsupportedSchemaVersion);
    }
    if head.revision == 0
        || !is_hex_id(&head.lead_pubkey)
        || !is_hex_id(&head.updated_by_pubkey)
        || head.started_at < 0
        || head.updated_at < 0
    {
        return Err(CompanyRecordError::Invalid(
            "onboarding head needs a revision, a lead, an updater and times",
        ));
    }
    if head.steps.len() != OnboardingStep::ALL.len()
        || head
            .steps
            .iter()
            .zip(OnboardingStep::ALL)
            .any(|(status, step)| status.step != step)
    {
        return Err(CompanyRecordError::Invalid(
            "onboarding head needs all five steps in order",
        ));
    }
    if head.accounts.len() > MAX_ONBOARDING_ACCOUNTS {
        return Err(CompanyRecordError::Invalid(
            "onboarding lists at most 8 accounts",
        ));
    }
    for account in &head.accounts {
        validate_account_request(&account.request())?;
    }
    if let Some(map) = head.map.as_ref() {
        validate_map_entries(&map.entries, map.first_function)?;
    }
    Ok(())
}

/// Check that a d-tag is the onboarding coordinate.
pub fn validate_onboarding_d_tag(tag: &str) -> Result<(), CompanyRecordError> {
    if tag == ONBOARDING_D_TAG {
        Ok(())
    } else {
        Err(CompanyRecordError::DTagMismatch)
    }
}

fn refuse(message: &'static str) -> CompanyRecordError {
    CompanyRecordError::Invalid(message)
}

/// The head an onboarding action produces, given the current head.
///
/// Pure: who may take the action (`needs_admin`, and whether the lead is a real
/// agent) is decided by the relay. `actor_is_admin` only decides who becomes the
/// lead on a first `start`.
pub fn next_onboarding_head(
    current: Option<&OnboardingHead>,
    action: &OnboardingAction,
    actor_pubkey: &str,
    actor_is_admin: bool,
    context: &OnboardingContext,
    now: i64,
) -> Result<OnboardingHead, CompanyRecordError> {
    validate_onboarding_action(action)?;
    let mut head = match (current, action.kind) {
        (Some(current), _) => current.clone(),
        (None, OnboardingActionKind::Start) => {
            let lead = match (action.lead_pubkey.as_deref(), actor_is_admin) {
                (Some(lead), _) => lead.to_owned(),
                (None, false) => actor_pubkey.to_owned(),
                (None, true) => {
                    return Err(refuse(
                        "an owner or admin starting onboarding names the lead agent",
                    ));
                }
            };
            OnboardingHead {
                schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                revision: 0,
                status: OnboardingStatus::InProgress,
                lead_pubkey: lead,
                steps: OnboardingStep::ALL
                    .into_iter()
                    .map(|step| StepStatus {
                        step,
                        state: StepState::Todo,
                    })
                    .collect(),
                question: None,
                accounts: Vec::new(),
                map: None,
                started_at: now,
                resumed_at: None,
                resume_count: 0,
                completed_at: None,
                updated_by_pubkey: actor_pubkey.to_owned(),
                updated_at: now,
            }
        }
        (None, _) => return Err(refuse("onboarding has not started")),
    };

    match action.kind {
        OnboardingActionKind::Start => {
            // Resuming keeps every step as it was.
            if current.is_some() {
                head.resume_count = head.resume_count.saturating_add(1);
                head.resumed_at = Some(now);
                if let Some(lead) = action.lead_pubkey.as_deref() {
                    head.lead_pubkey = lead.to_owned();
                }
            }
        }
        OnboardingActionKind::Ask => {
            require_in_progress(&head)?;
            if head.question.is_some() {
                return Err(refuse(
                    "a question is already open; wait for the answer or withdraw it",
                ));
            }
            let (Some(step), Some(text)) = (action.step, action.text.clone()) else {
                return Err(refuse("ask needs a step and a question"));
            };
            if head.step_state(step).is_settled() {
                return Err(refuse("that step is already answered"));
            }
            if let Some(account) = action.account.as_ref() {
                let existing = head
                    .accounts
                    .iter_mut()
                    .find(|entry| entry.id == account.id);
                match existing {
                    Some(entry) => {
                        if entry.state != AccountState::Asked {
                            return Err(refuse("that account is already answered"));
                        }
                        *entry = AccountEntry::from_request(account, AccountState::Asked);
                    }
                    None => {
                        if head.accounts.len() >= MAX_ONBOARDING_ACCOUNTS {
                            return Err(refuse("onboarding lists at most 8 accounts"));
                        }
                        head.accounts
                            .push(AccountEntry::from_request(account, AccountState::Asked));
                    }
                }
            }
            head.set_step(step, StepState::Asked);
            head.question = Some(OpenQuestion {
                step,
                text,
                account: action.account.clone(),
            });
        }
        OnboardingActionKind::Withdraw => {
            require_in_progress(&head)?;
            let Some(question) = head.question.take() else {
                return Err(refuse("there is no open question to withdraw"));
            };
            head.set_step(question.step, StepState::Todo);
            if let Some(account) = question.account {
                head.accounts
                    .retain(|entry| entry.id != account.id || entry.state != AccountState::Asked);
            }
        }
        OnboardingActionKind::ProposeMap => {
            require_in_progress(&head)?;
            if head.question.is_some() {
                return Err(refuse("answer or withdraw the open question first"));
            }
            for step in [
                OnboardingStep::Brief,
                OnboardingStep::Money,
                OnboardingStep::Approvals,
            ] {
                if !head.step_state(step).is_settled() {
                    return Err(refuse(
                        "answer the brief, money and approvals questions before proposing the map",
                    ));
                }
            }
            let Some(map) = action.map.clone() else {
                return Err(refuse("propose_map needs the map"));
            };
            head.map = Some(MapProposal {
                entries: map.entries,
                first_function: map.first_function,
                approved: false,
            });
            head.set_step(OnboardingStep::Map, StepState::Asked);
        }
        OnboardingActionKind::Answer => {
            require_in_progress(&head)?;
            let Some(step) = action.step else {
                return Err(refuse("answer needs the step"));
            };
            let Some(question) = head.question.clone() else {
                return Err(refuse("there is no open question to answer"));
            };
            if question.step != step {
                return Err(refuse("that question is not the open one"));
            }
            if !action.skipped {
                match step {
                    OnboardingStep::Brief if !context.brief_confirmed => {
                        return Err(refuse("confirm the business brief first"));
                    }
                    OnboardingStep::Money
                        if action.money_preference != Some(context.settings.money_preference) =>
                    {
                        return Err(refuse(
                            "the money setting you chose is not saved yet; save it first",
                        ));
                    }
                    OnboardingStep::Approvals
                        if action.approval_switches != Some(context.settings.approval_switches) =>
                    {
                        return Err(refuse(
                            "the approval switches you chose are not saved yet; save them first",
                        ));
                    }
                    _ => {}
                }
            }
            let settled = if action.skipped {
                StepState::Skipped
            } else {
                StepState::Done
            };
            if let Some(account) = question.account.as_ref() {
                if let Some(entry) = head
                    .accounts
                    .iter_mut()
                    .find(|entry| entry.id == account.id)
                {
                    entry.state = if action.skipped {
                        AccountState::Skipped
                    } else {
                        AccountState::Done
                    };
                }
            }
            head.set_step(step, settled);
            head.question = None;
        }
        OnboardingActionKind::ApproveMap => {
            require_in_progress(&head)?;
            let Some(map) = head.map.as_mut() else {
                return Err(refuse("there is no proposed map to approve"));
            };
            if map.approved {
                return Err(refuse("the map is already approved"));
            }
            map.approved = true;
            head.set_step(OnboardingStep::Map, StepState::Done);
        }
        OnboardingActionKind::RejectMap => {
            require_in_progress(&head)?;
            if head.map.take().is_none() {
                return Err(refuse("there is no proposed map to turn down"));
            }
            head.set_step(OnboardingStep::Map, StepState::Todo);
        }
        OnboardingActionKind::Complete => {
            require_in_progress(&head)?;
            if head.question.is_some() {
                return Err(refuse("answer or withdraw the open question first"));
            }
            for step in [
                OnboardingStep::Brief,
                OnboardingStep::Money,
                OnboardingStep::Approvals,
                OnboardingStep::Map,
            ] {
                if !head.step_state(step).is_settled() {
                    return Err(refuse(
                        "finish the brief, money, approvals and map steps first",
                    ));
                }
            }
            head.status = OnboardingStatus::Complete;
            head.completed_at = Some(now);
        }
    }
    head.revision = head.revision.saturating_add(1);
    head.updated_by_pubkey = actor_pubkey.to_owned();
    head.updated_at = now;
    Ok(head)
}

fn require_in_progress(head: &OnboardingHead) -> Result<(), CompanyRecordError> {
    if head.status == OnboardingStatus::Complete {
        Err(refuse("onboarding is already complete"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const SCOUT: &str = "2222222222222222222222222222222222222222222222222222222222222222";
    const AYA: &str = "3333333333333333333333333333333333333333333333333333333333333333";

    fn blank(kind: OnboardingActionKind) -> OnboardingAction {
        OnboardingAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            kind,
            step: None,
            text: None,
            account: None,
            map: None,
            skipped: false,
            money_preference: None,
            approval_switches: None,
            lead_pubkey: None,
            expected_head_event_id: None,
        }
    }

    fn ctx() -> OnboardingContext {
        OnboardingContext {
            settings: CofounderSettings::default(),
            brief_confirmed: true,
        }
    }

    fn ask(step: OnboardingStep) -> OnboardingAction {
        let mut action = blank(OnboardingActionKind::Ask);
        action.step = Some(step);
        action.text = Some("A short question".into());
        if step == OnboardingStep::Accounts {
            action.account = Some(AccountRequest {
                id: "pinterest".into(),
                label: "Pinterest".into(),
                url: Some("https://www.pinterest.com/login/".into()),
            });
        }
        action
    }

    fn answer(step: OnboardingStep) -> OnboardingAction {
        let mut action = blank(OnboardingActionKind::Answer);
        action.step = Some(step);
        match step {
            OnboardingStep::Money => action.money_preference = Some(MoneyPreference::CheapestFirst),
            OnboardingStep::Approvals => {
                action.approval_switches = Some(ApprovalSwitches::default());
            }
            _ => {}
        }
        action
    }

    fn started() -> OnboardingHead {
        next_onboarding_head(
            None,
            &blank(OnboardingActionKind::Start),
            SCOUT,
            false,
            &ctx(),
            10,
        )
        .unwrap()
    }

    fn step_through(head: OnboardingHead, step: OnboardingStep) -> OnboardingHead {
        let asked =
            next_onboarding_head(Some(&head), &ask(step), SCOUT, false, &ctx(), 20).unwrap();
        next_onboarding_head(Some(&asked), &answer(step), OWNER, true, &ctx(), 30).unwrap()
    }

    fn map_input() -> MapProposalInput {
        MapProposalInput {
            entries: vec![
                MapEntry {
                    function: CompanyFunction::Sales,
                    placement: MapPlacement::ExistingAgent,
                    lead_pubkey: Some(AYA.into()),
                },
                MapEntry {
                    function: CompanyFunction::Operations,
                    placement: MapPlacement::Scout,
                    lead_pubkey: None,
                },
                MapEntry {
                    function: CompanyFunction::CustomerSuccess,
                    placement: MapPlacement::Empty,
                    lead_pubkey: None,
                },
                MapEntry {
                    function: CompanyFunction::Finance,
                    placement: MapPlacement::Empty,
                    lead_pubkey: None,
                },
                MapEntry {
                    function: CompanyFunction::Brand,
                    placement: MapPlacement::Empty,
                    lead_pubkey: None,
                },
            ],
            first_function: CompanyFunction::Sales,
        }
    }

    fn propose_map() -> OnboardingAction {
        let mut action = blank(OnboardingActionKind::ProposeMap);
        action.map = Some(map_input());
        action
    }

    fn through_questions() -> OnboardingHead {
        let mut head = started();
        for step in [
            OnboardingStep::Brief,
            OnboardingStep::Money,
            OnboardingStep::Approvals,
        ] {
            head = step_through(head, step);
        }
        head
    }

    #[test]
    fn start_creates_five_todo_steps_led_by_the_signing_agent() {
        let head = started();
        assert_eq!(head.lead_pubkey, SCOUT);
        assert_eq!(head.status, OnboardingStatus::InProgress);
        assert_eq!(head.steps.len(), 5);
        assert!(head.steps.iter().all(|s| s.state == StepState::Todo));
        assert_eq!(head.revision, 1);
        assert!(validate_onboarding_head(&head).is_ok());
    }

    #[test]
    fn an_admin_starting_must_name_the_lead() {
        let missing = next_onboarding_head(
            None,
            &blank(OnboardingActionKind::Start),
            OWNER,
            true,
            &ctx(),
            1,
        );
        assert!(missing.is_err());
        let mut named = blank(OnboardingActionKind::Start);
        named.lead_pubkey = Some(SCOUT.into());
        let head = next_onboarding_head(None, &named, OWNER, true, &ctx(), 1).unwrap();
        assert_eq!(head.lead_pubkey, SCOUT);
    }

    #[test]
    fn starting_again_resumes_without_losing_progress() {
        let progressed = step_through(started(), OnboardingStep::Brief);
        let resumed = next_onboarding_head(
            Some(&progressed),
            &blank(OnboardingActionKind::Start),
            SCOUT,
            false,
            &ctx(),
            99,
        )
        .unwrap();
        assert_eq!(resumed.step_state(OnboardingStep::Brief), StepState::Done);
        assert_eq!(resumed.resume_count, 1);
        assert_eq!(resumed.resumed_at, Some(99));
        assert_eq!(resumed.started_at, progressed.started_at);
        assert_eq!(resumed.status, OnboardingStatus::InProgress);
    }

    #[test]
    fn starting_after_complete_stays_complete() {
        let mut head = through_questions();
        head = next_onboarding_head(Some(&head), &propose_map(), SCOUT, false, &ctx(), 40).unwrap();
        head = next_onboarding_head(
            Some(&head),
            &blank(OnboardingActionKind::ApproveMap),
            OWNER,
            true,
            &ctx(),
            50,
        )
        .unwrap();
        head = next_onboarding_head(
            Some(&head),
            &blank(OnboardingActionKind::Complete),
            SCOUT,
            false,
            &ctx(),
            60,
        )
        .unwrap();
        assert_eq!(head.status, OnboardingStatus::Complete);
        let again = next_onboarding_head(
            Some(&head),
            &blank(OnboardingActionKind::Start),
            SCOUT,
            false,
            &ctx(),
            70,
        )
        .unwrap();
        assert_eq!(again.status, OnboardingStatus::Complete);
        assert_eq!(again.completed_at, Some(60));
        assert_eq!(again.resume_count, 1);
    }

    #[test]
    fn nothing_but_start_works_before_onboarding_starts() {
        assert!(
            next_onboarding_head(None, &ask(OnboardingStep::Brief), SCOUT, false, &ctx(), 1)
                .is_err()
        );
    }

    #[test]
    fn only_one_question_is_open_at_a_time() {
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Brief),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        assert_eq!(asked.step_state(OnboardingStep::Brief), StepState::Asked);
        let second = next_onboarding_head(
            Some(&asked),
            &ask(OnboardingStep::Money),
            SCOUT,
            false,
            &ctx(),
            3,
        );
        assert!(second.is_err());
    }

    #[test]
    fn withdraw_reopens_the_step() {
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Money),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        let withdrawn = next_onboarding_head(
            Some(&asked),
            &blank(OnboardingActionKind::Withdraw),
            SCOUT,
            false,
            &ctx(),
            3,
        )
        .unwrap();
        assert!(withdrawn.question.is_none());
        assert_eq!(withdrawn.step_state(OnboardingStep::Money), StepState::Todo);
    }

    #[test]
    fn an_answered_step_cannot_be_asked_again() {
        let done = step_through(started(), OnboardingStep::Brief);
        assert!(next_onboarding_head(
            Some(&done),
            &ask(OnboardingStep::Brief),
            SCOUT,
            false,
            &ctx(),
            40
        )
        .is_err());
    }

    #[test]
    fn answering_needs_the_open_question() {
        assert!(next_onboarding_head(
            Some(&started()),
            &answer(OnboardingStep::Brief),
            OWNER,
            true,
            &ctx(),
            2
        )
        .is_err());
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Money),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        assert!(next_onboarding_head(
            Some(&asked),
            &answer(OnboardingStep::Brief),
            OWNER,
            true,
            &ctx(),
            3
        )
        .is_err());
    }

    #[test]
    fn the_brief_answer_needs_a_confirmed_brief() {
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Brief),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        let unconfirmed = OnboardingContext {
            brief_confirmed: false,
            ..ctx()
        };
        assert!(next_onboarding_head(
            Some(&asked),
            &answer(OnboardingStep::Brief),
            OWNER,
            true,
            &unconfirmed,
            3
        )
        .is_err());
        let mut skip = answer(OnboardingStep::Brief);
        skip.skipped = true;
        assert!(next_onboarding_head(Some(&asked), &skip, OWNER, true, &unconfirmed, 3).is_ok());
    }

    #[test]
    fn the_money_answer_must_match_the_saved_setting() {
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Money),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        let mut wrong = answer(OnboardingStep::Money);
        wrong.money_preference = Some(MoneyPreference::BestOption);
        assert!(next_onboarding_head(Some(&asked), &wrong, OWNER, true, &ctx(), 3).is_err());
        let saved = OnboardingContext {
            settings: CofounderSettings {
                money_preference: MoneyPreference::BestOption,
                ..CofounderSettings::default()
            },
            ..ctx()
        };
        let done = next_onboarding_head(Some(&asked), &wrong, OWNER, true, &saved, 3).unwrap();
        assert_eq!(done.step_state(OnboardingStep::Money), StepState::Done);
    }

    #[test]
    fn the_approvals_answer_must_match_the_saved_switches() {
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Approvals),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        let mut chosen = answer(OnboardingStep::Approvals);
        chosen.approval_switches = Some(ApprovalSwitches {
            approve_every_hire: true,
            ..ApprovalSwitches::default()
        });
        assert!(next_onboarding_head(Some(&asked), &chosen, OWNER, true, &ctx(), 3).is_err());
    }

    #[test]
    fn the_accounts_step_tracks_each_account() {
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Accounts),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        assert_eq!(asked.accounts.len(), 1);
        assert_eq!(asked.accounts[0].state, AccountState::Asked);
        let done = next_onboarding_head(
            Some(&asked),
            &answer(OnboardingStep::Accounts),
            OWNER,
            true,
            &ctx(),
            3,
        )
        .unwrap();
        assert_eq!(done.accounts[0].state, AccountState::Done);
        assert_eq!(done.step_state(OnboardingStep::Accounts), StepState::Done);
    }

    #[test]
    fn withdrawing_an_account_question_drops_the_asked_account() {
        let asked = next_onboarding_head(
            Some(&started()),
            &ask(OnboardingStep::Accounts),
            SCOUT,
            false,
            &ctx(),
            2,
        )
        .unwrap();
        let withdrawn = next_onboarding_head(
            Some(&asked),
            &blank(OnboardingActionKind::Withdraw),
            SCOUT,
            false,
            &ctx(),
            3,
        )
        .unwrap();
        assert!(withdrawn.accounts.is_empty());
    }

    #[test]
    fn the_map_waits_for_the_first_three_answers() {
        assert!(
            next_onboarding_head(Some(&started()), &propose_map(), SCOUT, false, &ctx(), 2)
                .is_err()
        );
        let ready = through_questions();
        let proposed =
            next_onboarding_head(Some(&ready), &propose_map(), SCOUT, false, &ctx(), 40).unwrap();
        assert_eq!(proposed.step_state(OnboardingStep::Map), StepState::Asked);
        assert!(!proposed.map.as_ref().unwrap().approved);
        assert!(validate_onboarding_head(&proposed).is_ok());
    }

    #[test]
    fn map_rules_are_enforced() {
        let mut short = propose_map();
        short.map.as_mut().unwrap().entries.pop();
        assert!(validate_onboarding_action(&short).is_err());
        let mut out_of_order = propose_map();
        out_of_order.map.as_mut().unwrap().entries.swap(0, 1);
        assert!(validate_onboarding_action(&out_of_order).is_err());
        let mut no_lead = propose_map();
        no_lead.map.as_mut().unwrap().entries[0].lead_pubkey = None;
        assert!(validate_onboarding_action(&no_lead).is_err());
        let mut stray_lead = propose_map();
        stray_lead.map.as_mut().unwrap().entries[1].lead_pubkey = Some(AYA.into());
        assert!(validate_onboarding_action(&stray_lead).is_err());
    }

    #[test]
    fn approving_the_map_marks_the_step_done_and_rejecting_clears_it() {
        let proposed = next_onboarding_head(
            Some(&through_questions()),
            &propose_map(),
            SCOUT,
            false,
            &ctx(),
            40,
        )
        .unwrap();
        let approved = next_onboarding_head(
            Some(&proposed),
            &blank(OnboardingActionKind::ApproveMap),
            OWNER,
            true,
            &ctx(),
            50,
        )
        .unwrap();
        assert!(approved.map.as_ref().unwrap().approved);
        assert_eq!(approved.step_state(OnboardingStep::Map), StepState::Done);
        let rejected = next_onboarding_head(
            Some(&proposed),
            &blank(OnboardingActionKind::RejectMap),
            OWNER,
            true,
            &ctx(),
            50,
        )
        .unwrap();
        assert!(rejected.map.is_none());
        assert_eq!(rejected.step_state(OnboardingStep::Map), StepState::Todo);
    }

    #[test]
    fn complete_needs_every_required_step() {
        assert!(next_onboarding_head(
            Some(&through_questions()),
            &blank(OnboardingActionKind::Complete),
            SCOUT,
            false,
            &ctx(),
            60
        )
        .is_err());
    }

    #[test]
    fn who_needs_admin_is_decided_by_kind() {
        for kind in [
            OnboardingActionKind::Answer,
            OnboardingActionKind::ApproveMap,
            OnboardingActionKind::RejectMap,
        ] {
            assert!(kind.needs_admin(), "{kind:?}");
        }
        for kind in [
            OnboardingActionKind::Start,
            OnboardingActionKind::Ask,
            OnboardingActionKind::Withdraw,
            OnboardingActionKind::ProposeMap,
            OnboardingActionKind::Complete,
        ] {
            assert!(!kind.needs_admin(), "{kind:?}");
        }
    }

    #[test]
    fn action_shape_rules() {
        // An ask needs a step and text; the map is never asked.
        assert!(validate_onboarding_action(&blank(OnboardingActionKind::Ask)).is_err());
        let mut map_ask = ask(OnboardingStep::Brief);
        map_ask.step = Some(OnboardingStep::Map);
        assert!(validate_onboarding_action(&map_ask).is_err());
        // An account belongs only to the accounts step, and is required there.
        let mut stray = ask(OnboardingStep::Brief);
        stray.account = ask(OnboardingStep::Accounts).account;
        assert!(validate_onboarding_action(&stray).is_err());
        let mut missing = ask(OnboardingStep::Accounts);
        missing.account = None;
        assert!(validate_onboarding_action(&missing).is_err());
        // Account address must be https.
        let mut http = ask(OnboardingStep::Accounts);
        http.account.as_mut().unwrap().url = Some("http://pinterest.com".into());
        assert!(validate_onboarding_action(&http).is_err());
        // A long question is refused.
        let mut long = ask(OnboardingStep::Brief);
        long.text = Some("x".repeat(MAX_QUESTION_CHARS + 1));
        assert!(validate_onboarding_action(&long).is_err());
        // The money answer names the setting.
        let mut bare = blank(OnboardingActionKind::Answer);
        bare.step = Some(OnboardingStep::Money);
        assert!(validate_onboarding_action(&bare).is_err());
        // A setting never rides on another step.
        let mut stray_setting = answer(OnboardingStep::Brief);
        stray_setting.money_preference = Some(MoneyPreference::BestOption);
        assert!(validate_onboarding_action(&stray_setting).is_err());
        // Wrong schema version and malformed expected head.
        let mut wrong = blank(OnboardingActionKind::Start);
        wrong.schema_version = 2;
        assert_eq!(
            validate_onboarding_action(&wrong),
            Err(CompanyRecordError::UnsupportedSchemaVersion)
        );
        let mut bad_head = blank(OnboardingActionKind::Start);
        bad_head.expected_head_event_id = Some("nope".into());
        assert!(validate_onboarding_action(&bad_head).is_err());
    }

    #[test]
    fn onboarding_action_rejects_unknown_fields() {
        let json = r#"{"schemaVersion":1,"kind":"start","surprise":1}"#;
        assert!(serde_json::from_str::<OnboardingAction>(json).is_err());
        let ok = r#"{"schemaVersion":1,"kind":"start"}"#;
        assert!(serde_json::from_str::<OnboardingAction>(ok).is_ok());
    }

    #[test]
    fn onboarding_d_tag_is_a_single_coordinate() {
        assert!(validate_onboarding_d_tag(ONBOARDING_D_TAG).is_ok());
        assert_eq!(
            validate_onboarding_d_tag("company:onboarding:x"),
            Err(CompanyRecordError::DTagMismatch)
        );
    }
}
