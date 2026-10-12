//! The real [`HireIo`]: the company relay and this computer.

use std::path::PathBuf;

use buzz_core_pkg::company_profile::BUSINESS_PROFILE_D_TAG;
use buzz_core_pkg::company_records::{
    hire_d_tag, HireAction, HireActionKind, COMPANY_RECORD_SCHEMA_VERSION,
};
use buzz_core_pkg::kind::{KIND_BUSINESS_PROFILE_HEAD, KIND_HIRE_ACTION, KIND_HIRE_HEAD};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::hire::{
    choose_time_zone, gate_hold_from, hire_view_from, run_hire, HireIo, HireView, GATE_HOLD,
};
use super::hire_journal::{self, HireJournal, HireJournalEntry, HireStep, JOURNAL_FILE};
use super::{normalize_relay, now_unix, runner, team_dir, with_book};
use crate::app_state::AppState;
use crate::managed_agents::{CreateManagedAgentRequest, ManagedAgentRecord, RoleContext};

const NO_RUNTIME: &str = "This employee's AI is not available on this computer.";

/// Whether a relay-signed channel membership snapshot (kind 39002) lists `pubkey`.
pub(crate) fn snapshot_has_member(event: &nostr::Event, pubkey: &str) -> bool {
    event.tags.iter().any(|tag| {
        let parts = tag.as_slice();
        parts.first().map(String::as_str) == Some("p")
            && parts
                .get(1)
                .is_some_and(|member| member.eq_ignore_ascii_case(pubkey))
    })
}

/// The business profile head's `timeZone`, when it has one.
pub(crate) fn time_zone_from_profile(content: &str) -> Option<String> {
    serde_json::from_str::<Value>(content)
        .ok()?
        .get("timeZone")?
        .as_str()
        .map(str::to_string)
}

/// The local employee made for `hire_id` (its role context goal), or the
/// local record the hire head names.
pub(crate) fn employee_for(
    records: &[ManagedAgentRecord],
    hire_id: Uuid,
    attached: Option<&str>,
) -> Option<String> {
    let goal = hire_id.to_string();
    records
        .iter()
        .find(|record| {
            record
                .role_context
                .as_ref()
                .and_then(|role| role.goal_id.as_deref())
                == Some(goal.as_str())
        })
        .or_else(|| {
            attached.and_then(|pubkey| {
                records
                    .iter()
                    .find(|record| record.pubkey.eq_ignore_ascii_case(pubkey))
            })
        })
        .map(|record| record.pubkey.to_ascii_lowercase())
}

/// Hire operations against one company relay, signed by the signed-in person.
pub(crate) struct RelayHireIo {
    app: AppHandle,
    owner: nostr::Keys,
    owner_hex: String,
    relay_url: String,
    api_base: String,
    relay_self: String,
    journal_path: PathBuf,
    gate_hold: Option<HireStep>,
}

impl RelayHireIo {
    /// Bind to `relay_url` with the signed-in keys and the relay's own key.
    pub(crate) async fn new(app: &AppHandle, relay_url: &str) -> Result<Self, String> {
        let relay_url = normalize_relay(relay_url)?;
        let owner = app.state::<AppState>().signing_keys()?;
        let relay_self = super::claim_io::relay_self(app, &relay_url).await?;
        Ok(Self {
            app: app.clone(),
            owner_hex: owner.public_key().to_hex(),
            owner,
            api_base: crate::relay::relay_http_base_url(&relay_url),
            relay_url,
            relay_self,
            journal_path: team_dir(app)?.join(JOURNAL_FILE),
            gate_hold: gate_hold_from(
                std::env::var("COLONY_TEAM_GATE").ok().as_deref(),
                std::env::var("COLONY_TEAM_GATE_HOLD_AFTER").ok().as_deref(),
            ),
        })
    }

    /// The hire journal on disk.
    pub(crate) fn journal(&self) -> Result<HireJournal, String> {
        hire_journal::load(&self.journal_path)
    }

    /// The company time zone for a new hire: the business profile's
    /// `timeZone`, or this computer's zone only when there is no profile.
    pub(crate) async fn company_time_zone(&self) -> Result<String, String> {
        let heads = self
            .query(json!({
                "kinds": [KIND_BUSINESS_PROFILE_HEAD],
                "authors": [self.relay_self],
                "#d": [BUSINESS_PROFILE_D_TAG],
                "limit": 1
            }))
            .await?;
        let profile_zone = self
            .newest_relay_signed(heads)
            .and_then(|head| time_zone_from_profile(&head.content));
        let computer_zone = iana_time_zone::get_timezone().ok();
        Ok(choose_time_zone(
            profile_zone.as_deref(),
            computer_zone.as_deref(),
        ))
    }

    async fn query(&self, filter: Value) -> Result<Vec<nostr::Event>, String> {
        let state = self.app.state::<AppState>();
        crate::relay::query_relay_at(&state, &self.api_base, &[filter]).await
    }

    fn newest_relay_signed(&self, events: Vec<nostr::Event>) -> Option<nostr::Event> {
        events
            .into_iter()
            .filter(|event| {
                event.pubkey.to_hex().eq_ignore_ascii_case(&self.relay_self)
                    && event.verify().is_ok()
            })
            .max_by_key(|event| event.created_at)
    }

    fn records(&self) -> Result<Vec<ManagedAgentRecord>, String> {
        let state = self.app.state::<AppState>();
        let _store = state
            .managed_agents_store_lock
            .lock()
            .map_err(|error| error.to_string())?;
        crate::managed_agents::load_managed_agents(&self.app)
    }

    async fn publish_hire(&self, action: &HireAction) -> Result<(), String> {
        let content = serde_json::to_string(action)
            .map_err(|error| format!("the hire step could not be prepared: {error}"))?;
        let coordinate = hire_d_tag(action.hire_id);
        let builder =
            nostr::EventBuilder::new(nostr::Kind::Custom(KIND_HIRE_ACTION as u16), content).tag(
                nostr::Tag::parse(["d", coordinate.as_str()]).map_err(|error| error.to_string())?,
            );
        let state = self.app.state::<AppState>();
        crate::relay::submit_event_at_with_keys(builder, &state, &self.api_base, &self.owner)
            .await
            .map(|_| ())
    }

    async fn is_member(&self, channel: Uuid, pubkey: &str) -> Result<bool, String> {
        let snapshots = self
            .query(json!({
                "kinds": [39002],
                "authors": [self.relay_self],
                "#d": [channel.to_string()],
                "limit": 1
            }))
            .await?;
        Ok(self
            .newest_relay_signed(snapshots)
            .is_some_and(|snapshot| snapshot_has_member(&snapshot, pubkey)))
    }

    async fn add_member(
        &self,
        channel: Uuid,
        pubkey: &str,
        role: Option<&str>,
    ) -> Result<(), String> {
        let builder = crate::events::build_add_member(channel, pubkey, role)?;
        let state = self.app.state::<AppState>();
        crate::relay::submit_event_at_with_keys(builder, &state, &self.api_base, &self.owner)
            .await
            .map(|_| ())
    }

    fn hire_action(view: &HireView, action: HireActionKind) -> HireAction {
        HireAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            hire_id: view.proposal.hire_id,
            action,
            expected_head_event_id: Some(view.head_event_id.clone()),
            proposal: None,
            employee_pubkey: None,
            introduction_event_id: None,
            reason: None,
            time_zone: None,
        }
    }
}

impl HireIo for RelayHireIo {
    fn owner(&self) -> &str {
        &self.owner_hex
    }

    fn now(&self) -> i64 {
        now_unix()
    }

    async fn hire(&mut self, hire_id: Uuid) -> Result<Option<HireView>, String> {
        let heads = self
            .query(json!({
                "kinds": [KIND_HIRE_HEAD],
                "authors": [self.relay_self],
                "#d": [hire_d_tag(hire_id)],
                "limit": 1
            }))
            .await?;
        self.newest_relay_signed(heads)
            .map(|head| hire_view_from(&head.id.to_hex(), &head.content))
            .transpose()
    }

    async fn find_employee(
        &mut self,
        hire_id: Uuid,
        attached: Option<&str>,
    ) -> Result<Option<String>, String> {
        Ok(employee_for(&self.records()?, hire_id, attached))
    }

    async fn manager_name(&mut self, manager_pubkey: &str) -> Option<String> {
        let profiles = self
            .query(json!({ "kinds": [0], "authors": [manager_pubkey], "limit": 1 }))
            .await
            .ok()?;
        let newest = profiles.into_iter().max_by_key(|event| event.created_at)?;
        let profile: Value = serde_json::from_str(&newest.content).ok()?;
        ["display_name", "name"].into_iter().find_map(|key| {
            profile
                .get(key)?
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
    }

    async fn create_employee(
        &mut self,
        view: &HireView,
        role: RoleContext,
    ) -> Result<String, String> {
        let proposal = &view.proposal;
        let runtime = crate::managed_agents::known_acp_runtime_exact(&proposal.runtime_id)
            .ok_or_else(|| NO_RUNTIME.to_string())?;
        let command = runtime
            .commands
            .first()
            .copied()
            .ok_or_else(|| NO_RUNTIME.to_string())?;
        let personas = crate::managed_agents::load_personas(&self.app)?;
        let persona = personas
            .iter()
            .find(|persona| persona.id == proposal.role_pack.persona_id)
            .ok_or_else(|| "This role is not available on this computer.".to_string())?;
        // Same harness rule as the old hire screen: pin the runtime unless the
        // persona names a different one.
        let harness_override = persona
            .runtime
            .as_deref()
            .map_or(true, |persona_runtime| persona_runtime == runtime.id);
        let request: CreateManagedAgentRequest = serde_json::from_value(json!({
            "name": proposal.display_name,
            "personaId": persona.id,
            "relayUrl": null,
            "acpCommand": "buzz-acp",
            "agentCommand": command,
            "harnessOverride": harness_override,
            "agentArgs": [],
            "mcpCommand": runtime.mcp_command.unwrap_or(""),
            "turnTimeoutSeconds": null,
            "idleTimeoutSeconds": null,
            "maxTurnDurationSeconds": null,
            "parallelism": null,
            "systemPrompt": null,
            "avatarUrl": null,
            "model": proposal.model_id,
            "provider": proposal.provider_id,
            "spawnAfterCreate": false,
            "startOnAppLaunch": true,
            "backend": { "type": "local" },
            "roleContext": role
        }))
        .map_err(|error| format!("the new employee could not be prepared: {error}"))?;
        let state = self.app.state::<AppState>();
        let created =
            crate::commands::create_managed_agent(request, self.app.clone(), state).await?;
        Ok(created.agent.pubkey.to_ascii_lowercase())
    }

    async fn ensure_profile(&mut self, employee: &str) -> Result<(), String> {
        let published = self
            .query(json!({ "kinds": [0], "authors": [employee], "limit": 1 }))
            .await?;
        if !published.is_empty() {
            return Ok(());
        }
        let record = self
            .records()?
            .into_iter()
            .find(|record| record.pubkey.eq_ignore_ascii_case(employee))
            .ok_or_else(|| "The new employee is missing on this computer.".to_string())?;
        let keys = nostr::Keys::parse(record.private_key_nsec.trim())
            .map_err(|_| "The new employee's identity could not be read.".to_string())?;
        let name = super::status::display_name(&record);
        let state = self.app.state::<AppState>();
        crate::relay::sync_managed_agent_profile(
            &state,
            &self.relay_url,
            &keys,
            &name,
            record.avatar_url.as_deref(),
            None,
            record.auth_tag.as_deref(),
        )
        .await
    }

    async fn attach_employee(&mut self, view: &HireView, employee: &str) -> Result<(), String> {
        let mut action = Self::hire_action(view, HireActionKind::AttachEmployee);
        action.employee_pubkey = Some(employee.to_string());
        self.publish_hire(&action).await
    }

    async fn add_employee_to_channel(
        &mut self,
        channel: Uuid,
        employee: &str,
    ) -> Result<(), String> {
        if self.is_member(channel, employee).await? {
            return Ok(());
        }
        self.add_member(channel, employee, Some("bot")).await
    }

    async fn ensure_owner_in_channel(&mut self, channel: Uuid) -> Result<(), String> {
        let owner = self.owner_hex.clone();
        if self.is_member(channel, &owner).await? {
            return Ok(());
        }
        self.add_member(channel, &owner, None).await
    }

    async fn post_hello(
        &mut self,
        employee: &str,
        channel: Uuid,
        text: &str,
        marker: &str,
    ) -> Result<String, String> {
        let state = self.app.state::<AppState>();
        let sent = crate::commands::send_managed_agent_channel_message(
            employee.to_string(),
            channel.to_string(),
            text.to_string(),
            Some(marker.to_string()),
            Some("agent".to_string()),
            None,
            None,
            None,
            self.app.clone(),
            state,
        )
        .await?;
        Ok(sent.event_id)
    }

    async fn complete(
        &mut self,
        view: &HireView,
        employee: &str,
        introduction_event_id: &str,
        time_zone: &str,
    ) -> Result<(), String> {
        let mut action = Self::hire_action(view, HireActionKind::Complete);
        action.employee_pubkey = Some(employee.to_string());
        action.introduction_event_id = Some(introduction_event_id.to_string());
        action.time_zone = Some(time_zone.to_string());
        let Err(error) = self.publish_hire(&action).await else {
            return Ok(());
        };
        // A Complete that already landed: the relay refuses a second one, and
        // the head says `hired` with this employee.
        match self.hire(view.proposal.hire_id).await? {
            Some(head)
                if head.status == "hired"
                    && head
                        .employee_pubkey
                        .as_deref()
                        .is_some_and(|attached| attached.eq_ignore_ascii_case(employee)) =>
            {
                Ok(())
            }
            _ => Err(error),
        }
    }

    async fn start_employee(
        &mut self,
        employee: &str,
        replay_floor: Option<u64>,
    ) -> Result<(), String> {
        let relay = self.relay_url.clone();
        with_book(&self.app, |book| book.expect_running(employee, &relay))?;
        let (app, pubkey) = (self.app.clone(), employee.to_string());
        tauri::async_runtime::spawn_blocking(move || {
            crate::managed_agents::start_managed_agent_runtime_pair_with_floor(
                pubkey,
                relay,
                replay_floor,
                app,
            )
        })
        .await
        .map_err(|error| error.to_string())?
        .map(|_| ())
    }

    fn save(&mut self, entry: &HireJournalEntry) -> Result<(), String> {
        let mut journal = hire_journal::load(&self.journal_path)?;
        journal.upsert(entry.clone());
        journal.prune(now_unix());
        hire_journal::save(&self.journal_path, &journal)
    }

    async fn hold_after(&mut self, step: HireStep) {
        if self.gate_hold == Some(step) {
            eprintln!("colony-team-gate: holding the hire after {step:?}");
            tokio::time::sleep(GATE_HOLD).await;
        }
    }
}

/// Finish every unfinished hire for `relay_url` in the background, one at a
/// time. A hire that still cannot finish keeps its journal entry and its last
/// error, and resumes at the next start or the next `team_hire_complete`.
pub(crate) fn resume_unfinished(app: &AppHandle, relay_url: &str) {
    let (app, relay_url) = (app.clone(), relay_url.to_string());
    tauri::async_runtime::spawn(async move {
        let Ok(state) = runner(&app) else {
            return;
        };
        let _one_hire_at_a_time = state.hire_lock.lock().await;
        let mut io = match RelayHireIo::new(&app, &relay_url).await {
            Ok(io) => io,
            Err(error) => {
                eprintln!("team runner: unfinished hires wait for the next start: {error}");
                return;
            }
        };
        let entries = match io.journal() {
            Ok(journal) => journal.unfinished(&io.relay_url),
            Err(error) => {
                eprintln!("team runner: the hire journal could not be read: {error}");
                return;
            }
        };
        for entry in entries {
            if let Err(error) = run_hire(&mut io, entry).await {
                eprintln!("team runner: a hire could not finish yet: {error}");
            }
        }
    });
}
