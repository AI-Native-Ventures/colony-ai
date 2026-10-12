//! Finishing a hire as one journaled operation. Every step checks whether it
//! already happened, so a host killed anywhere resumes to exactly one
//! employee, one hello and one Complete. The relay and host side plugs in
//! through [`HireIo`] (`hire_relay.rs`).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::hire_journal::{HireJournalEntry, HireStep};
use super::normalize_relay;
use crate::managed_agents::RoleContext;

/// How long the real-run gate holds a hire after a step.
pub(crate) const GATE_HOLD: std::time::Duration = std::time::Duration::from_secs(20);

/// Plain refusals.
pub(crate) const FINISHED_ELSEWHERE: &str = "This hire was finished on another computer.";
pub(crate) const CHANGED: &str = "This hire changed. Open it again to finish it.";
pub(crate) const NOT_APPROVED: &str = "This hire is not approved yet.";
pub(crate) const DECLINED: &str = "This hire was declined.";
pub(crate) const GONE: &str = "This hire no longer exists.";
pub(crate) const NOT_FOUNDER: &str = "Only the person who approved this hire can finish it.";

/// `team_hire_complete` input (overview shape).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HireCompleteInput {
    /// The company relay.
    pub relay_url: String,
    /// The approved hire.
    pub hire_id: String,
    /// The role's persona.
    pub persona_id: String,
    /// The employee's name.
    pub display_name: String,
    /// The conversation the employee joins.
    pub home_channel_id: String,
    /// Accepted from callers that still send it and ignored: the host sends
    /// the company time zone from the business profile.
    #[serde(default)]
    pub time_zone: Option<String>,
}

/// What `team_hire_complete` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HireCompleteState {
    /// A fresh hire finished.
    Started,
    /// An interrupted hire finished.
    Resumed,
    /// The hire had already finished.
    AlreadyComplete,
}

/// `team_hire_complete` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HireCompleteResult {
    /// The employee's public key (hex).
    pub agent_pubkey: String,
    /// What happened.
    pub state: HireCompleteState,
}

/// Lenient read of a hire proposal: keys this build does not know are ignored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProposalView {
    pub(crate) hire_id: Uuid,
    pub(crate) role_pack: RolePackView,
    pub(crate) display_name: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) manager_pubkey: Option<String>,
    pub(crate) introduction_channel_id: Uuid,
    pub(crate) runtime_id: String,
    #[serde(default)]
    pub(crate) provider_id: Option<String>,
    #[serde(default)]
    pub(crate) model_id: Option<String>,
}

/// The role pack fields the host uses.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RolePackView {
    pub(crate) persona_id: String,
    pub(crate) job: String,
    #[serde(default)]
    pub(crate) owns: Option<String>,
    #[serde(default)]
    pub(crate) ask_before: Vec<String>,
    #[serde(default)]
    pub(crate) on_hire: Option<OnHireView>,
}

/// What a new employee studies first.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnHireView {
    #[serde(default)]
    pub(crate) sources: Vec<String>,
    #[serde(default = "default_plan_horizon_days")]
    pub(crate) plan_horizon_days: u8,
}

fn default_plan_horizon_days() -> u8 {
    14
}

/// The relay's hire head, read leniently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HireView {
    pub(crate) head_event_id: String,
    /// `proposed`, `awaiting_founder`, `approved`, `hired` or `denied`.
    pub(crate) status: String,
    pub(crate) founder_pubkey: Option<String>,
    pub(crate) employee_pubkey: Option<String>,
    pub(crate) proposal: ProposalView,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeadContent {
    status: String,
    #[serde(default)]
    founder_pubkey: Option<String>,
    #[serde(default)]
    employee_pubkey: Option<String>,
    proposal: ProposalView,
}

/// Read a hire head's content.
pub(crate) fn hire_view_from(head_event_id: &str, content: &str) -> Result<HireView, String> {
    let head: HeadContent =
        serde_json::from_str(content).map_err(|_| "the hire record is unreadable".to_string())?;
    Ok(HireView {
        head_event_id: head_event_id.to_string(),
        status: head.status,
        founder_pubkey: head.founder_pubkey,
        employee_pubkey: head.employee_pubkey,
        proposal: head.proposal,
    })
}

/// A checked `HireCompleteInput`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedHire {
    pub(crate) relay_url: String,
    pub(crate) hire_id: Uuid,
    pub(crate) persona_id: String,
    pub(crate) display_name: String,
    pub(crate) home_channel_id: Uuid,
}

/// Check the input before anything happens.
pub(crate) fn validated_input(input: &HireCompleteInput) -> Result<ValidatedHire, String> {
    let relay_url = normalize_relay(&input.relay_url)?;
    let hire_id =
        Uuid::parse_str(input.hire_id.trim()).map_err(|_| "hire id must be a UUID".to_string())?;
    let home_channel_id = Uuid::parse_str(input.home_channel_id.trim())
        .map_err(|_| "home channel id must be a UUID".to_string())?;
    let persona_id = input.persona_id.trim().to_string();
    let display_name = input.display_name.trim().to_string();
    if persona_id.is_empty() || persona_id.chars().count() > 120 {
        return Err("persona id must be 1 to 120 characters".to_string());
    }
    if display_name.is_empty() || display_name.chars().count() > 120 {
        return Err("display name must be 1 to 120 characters".to_string());
    }
    Ok(ValidatedHire {
        relay_url,
        hire_id,
        persona_id,
        display_name,
        home_channel_id,
    })
}

/// A fresh journal entry.
pub(crate) fn new_entry(hire: &ValidatedHire, time_zone: String, now: i64) -> HireJournalEntry {
    HireJournalEntry {
        hire_id: hire.hire_id,
        relay_url: hire.relay_url.clone(),
        persona_id: hire.persona_id.clone(),
        display_name: hire.display_name.clone(),
        home_channel_id: hire.home_channel_id,
        time_zone,
        step: HireStep::Opened,
        employee_pubkey: None,
        introduction_event_id: None,
        replay_floor: None,
        started_at: now,
        updated_at: now,
        last_error: None,
    }
}

/// What a call reports when the journal already holds the hire.
pub(crate) fn existing_entry_state(entry: &HireJournalEntry) -> HireCompleteState {
    if entry.is_finished() {
        HireCompleteState::AlreadyComplete
    } else {
        HireCompleteState::Resumed
    }
}

/// The company time zone: the business profile's when the profile has one,
/// this computer's when there is no profile, `UTC` when neither is a valid
/// IANA label.
pub(crate) fn choose_time_zone(profile_zone: Option<&str>, computer_zone: Option<&str>) -> String {
    let valid = |zone: &&str| buzz_core_pkg::company_duties::is_timezone_label(zone);
    match profile_zone.map(str::trim).filter(valid) {
        Some(zone) => zone.to_string(),
        None => computer_zone
            .map(str::trim)
            .filter(valid)
            .unwrap_or("UTC")
            .to_string(),
    }
}

/// The role context a hired employee runs with. Its goal is the hire id,
/// which is how a resumed hire finds the employee it already made.
pub(crate) fn role_context_for(view: &HireView, manager_name: Option<String>) -> RoleContext {
    let proposal = &view.proposal;
    RoleContext {
        title: proposal.title.clone(),
        job: proposal.role_pack.job.clone(),
        owns: proposal.role_pack.owns.clone(),
        ask_before: proposal.role_pack.ask_before.clone(),
        manager_name,
        home_channel_id: Some(proposal.introduction_channel_id.to_string()),
        goal_id: Some(proposal.hire_id.to_string()),
        on_hire_sources: proposal
            .role_pack
            .on_hire
            .as_ref()
            .map(|on_hire| on_hire.sources.clone())
            .unwrap_or_default(),
        plan_horizon_days: proposal
            .role_pack
            .on_hire
            .as_ref()
            .map_or(14, |on_hire| on_hire.plan_horizon_days),
    }
}

/// The new employee's hello, posted as the employee.
pub(crate) fn hello_text(display_name: &str, title: &str) -> String {
    format!(
        "Hi everyone, I'm {display_name}, the new {title}. I'm reading up on the business and will share my plan soon."
    )
}

/// The marker that makes the hello idempotent.
pub(crate) fn hello_marker(hire_id: Uuid) -> String {
    format!("company-hire:{hire_id}:introduction")
}

/// Real-run gate seam: hold after `employee_created` only when
/// `COLONY_TEAM_GATE=1` and `COLONY_TEAM_GATE_HOLD_AFTER=employee_created`.
pub(crate) fn gate_hold_from(gate: Option<&str>, hold_after: Option<&str>) -> Option<HireStep> {
    match (gate, hold_after) {
        (Some("1"), Some("employee_created")) => Some(HireStep::EmployeeCreated),
        _ => None,
    }
}

/// The relay and host operations a hire needs. Each one is safe to repeat.
pub(crate) trait HireIo {
    /// Recheck company ownership, claim and pause before each side effect.
    async fn ensure_ready(&mut self) -> Result<(), String>;
    /// The signed-in person, who signs every hire action.
    fn owner(&self) -> &str;
    /// Unix seconds now.
    fn now(&self) -> i64;
    /// The relay's hire head; `None` when the relay has no such hire.
    async fn hire(&mut self, hire_id: Uuid) -> Result<Option<HireView>, String>;
    /// The local employee made for `hire_id`, or the local record `attached` names.
    async fn find_employee(
        &mut self,
        hire_id: Uuid,
        attached: Option<&str>,
    ) -> Result<Option<String>, String>;
    /// The manager's name, when the relay knows it.
    async fn manager_name(&mut self, manager_pubkey: &str) -> Option<String>;
    /// Create the employee (start with Colony on) with `role` in the same save.
    async fn create_employee(
        &mut self,
        view: &HireView,
        role: RoleContext,
    ) -> Result<String, String>;
    /// Make sure the employee's profile is on the relay.
    async fn ensure_profile(&mut self, employee: &str) -> Result<(), String>;
    /// Publish `AttachEmployee` on the exact current head.
    async fn attach_employee(&mut self, view: &HireView, employee: &str) -> Result<(), String>;
    /// Add the employee to the home channel unless it is a member.
    async fn add_employee_to_channel(
        &mut self,
        channel: Uuid,
        employee: &str,
    ) -> Result<(), String>;
    /// Add the owner to the home channel unless they are a member.
    async fn ensure_owner_in_channel(&mut self, channel: Uuid) -> Result<(), String>;
    /// Post `text` as the employee; a message already posted under `marker` is returned instead.
    async fn post_hello(
        &mut self,
        employee: &str,
        channel: Uuid,
        text: &str,
        marker: &str,
    ) -> Result<String, String>;
    /// Publish `Complete` with the company time zone.
    async fn complete(
        &mut self,
        view: &HireView,
        employee: &str,
        introduction_event_id: &str,
        time_zone: &str,
    ) -> Result<(), String>;
    /// Start the employee with the replay floor (a running pair is left alone).
    async fn start_employee(
        &mut self,
        employee: &str,
        replay_floor: Option<u64>,
    ) -> Result<(), String>;
    /// Write the journal entry durably.
    fn save(&mut self, entry: &HireJournalEntry) -> Result<(), String>;
    /// Real-run gate seam (Task 4.15).
    async fn hold_after(&mut self, step: HireStep);
}

fn employee_of(entry: &HireJournalEntry) -> Result<&str, String> {
    entry
        .employee_pubkey
        .as_deref()
        .ok_or_else(|| "the new employee is missing from the hire journal".to_string())
}

fn step_to<I: HireIo>(
    io: &mut I,
    entry: &mut HireJournalEntry,
    step: HireStep,
) -> Result<(), String> {
    entry.step = step;
    entry.updated_at = io.now();
    entry.last_error = None;
    io.save(entry)
}

async fn current_hire<I: HireIo>(io: &mut I, entry: &HireJournalEntry) -> Result<HireView, String> {
    let view = io
        .hire(entry.hire_id)
        .await?
        .ok_or_else(|| GONE.to_string())?;
    match view.status.as_str() {
        "approved" | "hired" => Ok(view),
        "denied" => Err(DECLINED.to_string()),
        _ => Err(NOT_APPROVED.to_string()),
    }
}

fn check_unchanged(entry: &HireJournalEntry, view: &HireView) -> Result<(), String> {
    let proposal = &view.proposal;
    if proposal.role_pack.persona_id != entry.persona_id
        || proposal.display_name != entry.display_name
        || proposal.introduction_channel_id != entry.home_channel_id
    {
        return Err(CHANGED.to_string());
    }
    Ok(())
}

/// Finish one hire from wherever its journal entry stopped. Returns the
/// employee's public key.
pub(crate) async fn run_hire<I: HireIo>(
    io: &mut I,
    mut entry: HireJournalEntry,
) -> Result<String, String> {
    while entry.step != HireStep::Started {
        let before = entry.step;
        let attempted = async {
            io.ensure_ready().await?;
            advance(io, &mut entry).await
        }
        .await;
        if let Err(error) = attempted {
            entry.last_error = Some(error.clone());
            entry.updated_at = io.now();
            if let Err(save_error) = io.save(&entry) {
                eprintln!("team runner: could not note why a hire stopped: {save_error}");
            }
            return Err(error);
        }
        if entry.step == before {
            return Err("the hire made no progress".to_string());
        }
    }
    employee_of(&entry).map(str::to_string)
}

async fn advance<I: HireIo>(io: &mut I, entry: &mut HireJournalEntry) -> Result<(), String> {
    match entry.step {
        HireStep::Opened => {
            let view = current_hire(io, entry).await?;
            check_unchanged(entry, &view)?;
            let found = io
                .find_employee(entry.hire_id, view.employee_pubkey.as_deref())
                .await?;
            let employee = match found {
                Some(pubkey) => pubkey,
                None if view.status == "hired" || view.employee_pubkey.is_some() => {
                    return Err(FINISHED_ELSEWHERE.to_string())
                }
                None => {
                    let founder_is_owner = view
                        .founder_pubkey
                        .as_deref()
                        .is_some_and(|founder| founder.eq_ignore_ascii_case(io.owner()));
                    if !founder_is_owner {
                        return Err(NOT_FOUNDER.to_string());
                    }
                    let manager = match view.proposal.manager_pubkey.as_deref() {
                        Some(pubkey) => io.manager_name(pubkey).await,
                        None => None,
                    };
                    io.create_employee(&view, role_context_for(&view, manager))
                        .await?
                }
            };
            entry.employee_pubkey = Some(employee);
            step_to(io, entry, HireStep::EmployeeCreated)?;
            io.hold_after(HireStep::EmployeeCreated).await;
        }
        HireStep::EmployeeCreated => {
            let employee = employee_of(entry)?.to_string();
            io.ensure_profile(&employee).await?;
            let view = current_hire(io, entry).await?;
            match view.employee_pubkey.as_deref() {
                None => io.attach_employee(&view, &employee).await?,
                Some(attached) if attached.eq_ignore_ascii_case(&employee) => {}
                Some(_) => return Err(FINISHED_ELSEWHERE.to_string()),
            }
            step_to(io, entry, HireStep::EmployeeAttached)?;
        }
        HireStep::EmployeeAttached => {
            let employee = employee_of(entry)?.to_string();
            io.add_employee_to_channel(entry.home_channel_id, &employee)
                .await?;
            step_to(io, entry, HireStep::EmployeeInChannel)?;
        }
        HireStep::EmployeeInChannel => {
            io.ensure_owner_in_channel(entry.home_channel_id).await?;
            step_to(io, entry, HireStep::OwnerInChannel)?;
        }
        HireStep::OwnerInChannel => {
            let employee = employee_of(entry)?.to_string();
            let view = current_hire(io, entry).await?;
            let text = hello_text(&entry.display_name, &view.proposal.title);
            let marker = hello_marker(entry.hire_id);
            let event_id = io
                .post_hello(&employee, entry.home_channel_id, &text, &marker)
                .await?;
            entry.introduction_event_id = Some(event_id);
            step_to(io, entry, HireStep::HelloPosted)?;
        }
        HireStep::HelloPosted => {
            let employee = employee_of(entry)?.to_string();
            let introduction = entry
                .introduction_event_id
                .clone()
                .ok_or_else(|| "the hello is missing from the hire journal".to_string())?;
            let view = current_hire(io, entry).await?;
            if view.status == "hired" {
                let ours = view
                    .employee_pubkey
                    .as_deref()
                    .is_some_and(|attached| attached.eq_ignore_ascii_case(&employee));
                if !ours {
                    return Err(FINISHED_ELSEWHERE.to_string());
                }
            } else {
                if entry.replay_floor.is_none() {
                    // Taken before Complete, so the kickoff the relay posts
                    // with Complete is newer than the floor and is answered.
                    entry.replay_floor = Some(u64::try_from(io.now()).unwrap_or(0));
                    entry.updated_at = io.now();
                    io.save(entry)?;
                }
                let time_zone = entry.time_zone.clone();
                io.complete(&view, &employee, &introduction, &time_zone)
                    .await?;
            }
            step_to(io, entry, HireStep::Completed)?;
        }
        HireStep::Completed => {
            let employee = employee_of(entry)?.to_string();
            io.start_employee(&employee, entry.replay_floor).await?;
            step_to(io, entry, HireStep::Started)?;
        }
        HireStep::Started => {}
    }
    Ok(())
}
