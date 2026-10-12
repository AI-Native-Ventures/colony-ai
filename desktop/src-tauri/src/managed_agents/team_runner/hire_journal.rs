//! `hire-journal.json`: one entry per hire this computer is finishing, saved
//! after every step so a restart resumes at the first unfinished step.

use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// File name inside `<app data>/team`.
pub(crate) const JOURNAL_FILE: &str = "hire-journal.json";
const MAX_ENTRIES: usize = 200;
const KEEP_FINISHED_SECS: i64 = 30 * 24 * 60 * 60;

/// The last step a hire finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HireStep {
    /// The entry exists; nothing happened yet.
    Opened,
    /// The employee record exists on this computer.
    EmployeeCreated,
    /// The hire head names the employee.
    EmployeeAttached,
    /// The employee is a member of the home channel.
    EmployeeInChannel,
    /// The owner is a member of the home channel.
    OwnerInChannel,
    /// The employee posted its hello.
    HelloPosted,
    /// The hire head says `hired`.
    Completed,
    /// The employee is started. Finished.
    Started,
}

/// One hire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HireJournalEntry {
    pub(crate) hire_id: Uuid,
    pub(crate) relay_url: String,
    pub(crate) persona_id: String,
    pub(crate) display_name: String,
    pub(crate) home_channel_id: Uuid,
    /// The company time zone, resolved once when the hire opened.
    pub(crate) time_zone: String,
    pub(crate) step: HireStep,
    #[serde(default)]
    pub(crate) employee_pubkey: Option<String>,
    #[serde(default)]
    pub(crate) introduction_event_id: Option<String>,
    /// Unix seconds captured just before `Complete`: the first start's replay floor.
    #[serde(default)]
    pub(crate) replay_floor: Option<u64>,
    pub(crate) started_at: i64,
    pub(crate) updated_at: i64,
    #[serde(default)]
    pub(crate) last_error: Option<String>,
}

impl HireJournalEntry {
    /// Whether the hire finished.
    pub(crate) fn is_finished(&self) -> bool {
        self.step == HireStep::Started
    }
}

/// The whole file.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct HireJournal {
    #[serde(default)]
    pub(crate) entries: Vec<HireJournalEntry>,
}

impl HireJournal {
    /// Bound unfinished work without throwing away the records that make
    /// retries safe. Existing hires can always resume.
    pub(crate) fn ensure_capacity_for(&self, hire_id: Uuid) -> Result<(), String> {
        if self.find(hire_id).is_none()
            && self
                .entries
                .iter()
                .filter(|entry| !entry.is_finished())
                .count()
                >= MAX_ENTRIES
        {
            return Err("Colony has too many unfinished hires on this computer. Finish one before starting another.".to_string());
        }
        Ok(())
    }
    /// A startup restore never outruns an unfinished hire's Complete and
    /// first start. The journal resumes that first start with its replay floor.
    pub(crate) fn allows_restore(
        &self,
        record: &crate::managed_agents::ManagedAgentRecord,
        relay_url: &str,
    ) -> bool {
        self.entry_for_employee(record, relay_url)
            .is_none_or(HireJournalEntry::is_finished)
    }

    /// Only the journal can start an unfinished hire, after Complete, with
    /// the replay floor it saved before Complete.
    pub(crate) fn require_first_start(
        &self,
        record: &crate::managed_agents::ManagedAgentRecord,
        relay_url: &str,
        replay_floor: Option<u64>,
    ) -> Result<(), String> {
        if let Some(entry) = self.entry_for_employee(record, relay_url) {
            if !entry.is_finished()
                && (entry.step != HireStep::Completed
                    || replay_floor.is_none()
                    || replay_floor != entry.replay_floor)
            {
                return Err("This hire is still finishing. Colony will start the employee when it is ready.".to_string());
            }
        }
        Ok(())
    }

    fn entry_for_employee(
        &self,
        record: &crate::managed_agents::ManagedAgentRecord,
        relay_url: &str,
    ) -> Option<&HireJournalEntry> {
        let goal = record
            .role_context
            .as_ref()
            .and_then(|role| role.goal_id.as_deref());
        self.entries.iter().find(|entry| {
            entry.relay_url.trim_end_matches('/') == relay_url.trim_end_matches('/')
                && (goal.is_some_and(|goal| entry.hire_id.to_string() == goal)
                    || entry
                        .employee_pubkey
                        .as_deref()
                        .is_some_and(|pubkey| pubkey.eq_ignore_ascii_case(&record.pubkey)))
        })
    }

    /// The entry for `hire_id`.
    pub(crate) fn find(&self, hire_id: Uuid) -> Option<&HireJournalEntry> {
        self.entries.iter().find(|entry| entry.hire_id == hire_id)
    }

    /// Insert or replace the entry for its hire.
    pub(crate) fn upsert(&mut self, entry: HireJournalEntry) {
        match self
            .entries
            .iter_mut()
            .find(|existing| existing.hire_id == entry.hire_id)
        {
            Some(existing) => *existing = entry,
            None => self.entries.push(entry),
        }
    }

    /// Unfinished hires on `relay_url`.
    pub(crate) fn unfinished(&self, relay_url: &str) -> Vec<HireJournalEntry> {
        self.entries
            .iter()
            .filter(|entry| !entry.is_finished() && entry.relay_url == relay_url)
            .cloned()
            .collect()
    }

    /// Drop finished hires older than 30 days, then the oldest finished ones
    /// beyond 200 entries. Unfinished hires are never dropped.
    pub(crate) fn prune(&mut self, now: i64) {
        self.entries
            .retain(|entry| !entry.is_finished() || now - entry.updated_at < KEEP_FINISHED_SECS);
        if self.entries.len() <= MAX_ENTRIES {
            return;
        }
        let mut finished: Vec<(i64, Uuid)> = self
            .entries
            .iter()
            .filter(|entry| entry.is_finished())
            .map(|entry| (entry.updated_at, entry.hire_id))
            .collect();
        finished.sort();
        let excess = self.entries.len() - MAX_ENTRIES;
        let dropped: Vec<Uuid> = finished
            .into_iter()
            .take(excess)
            .map(|(_, id)| id)
            .collect();
        self.entries
            .retain(|entry| !dropped.contains(&entry.hire_id));
    }
}

/// Read the journal. Missing means empty; unreadable is an error, so no
/// unfinished hire is ever forgotten.
pub(crate) fn load(path: &Path) -> Result<HireJournal, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("failed to parse {JOURNAL_FILE}: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HireJournal::default()),
        Err(error) => Err(format!("failed to read {JOURNAL_FILE}: {error}")),
    }
}

/// Write the journal durably (temporary file, sync, rename).
pub(crate) fn save(path: &Path, journal: &HireJournal) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("failed to serialize {JOURNAL_FILE}: {error}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(path, &bytes)
}
