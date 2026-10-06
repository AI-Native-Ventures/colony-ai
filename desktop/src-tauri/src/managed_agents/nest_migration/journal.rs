//! Durable state for the nest migration: the journal that is written before
//! every move, and the one-time notice shown to the person afterwards.
//!
//! Both live in the app-data directory (never inside the folders being moved)
//! and are rewritten atomically (temp file, fsync, rename), so a crash leaves
//! either the old or the new content, never a torn file. The filesystem stays
//! the source of truth on resume: the journal says what was planned and how far
//! the run got, and every step is re-checked against the real folders.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Journal file name inside the migration state directory.
pub(super) const JOURNAL_FILE: &str = "journal.json";
/// Notice file name inside the migration state directory.
pub(super) const NOTICE_FILE: &str = "notice.json";
/// Name a journal that cannot be parsed is renamed to, so it is kept for
/// inspection and never blocks the next run.
const CORRUPT_JOURNAL_FILE: &str = "journal.json.unreadable";

const JOURNAL_VERSION: u32 = 1;

/// How far a run got.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Phase {
    /// Entries are being moved into the staging folder.
    Staging,
    /// Staged entries are being moved into the new folder.
    Publishing,
    /// A failure or the kill switch sent entries back to the old folder.
    RollingBack,
    /// Finished: every moved entry is in the new folder.
    Done,
    /// Finished without keeping any move: everything is back where it was.
    Aborted,
}

impl Phase {
    /// A run that stopped here must be resumed or rolled back before anything
    /// else touches the folders.
    pub(super) fn is_in_flight(self) -> bool {
        matches!(self, Self::Staging | Self::Publishing | Self::RollingBack)
    }
}

/// How much a failed move matters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StepKind {
    /// Small, stateful, and useless when split (history, knowledge, markers).
    /// One failure sends the whole batch back.
    Atomic,
    /// Large or re-creatable (repositories, downloaded models). A failure
    /// leaves just that entry in the old folder.
    BestEffort,
}

/// Where one entry is in its move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum StepStatus {
    Pending,
    /// Written before the entry is renamed into the staging folder.
    Moving,
    Staged,
    /// Written before the entry is renamed from staging into the new folder.
    Publishing,
    Published,
    /// Left in the old folder, see `detail`.
    Skipped,
    RolledBack,
}

/// One allow-listed entry and its progress.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Step {
    pub(super) name: String,
    pub(super) kind: StepKind,
    pub(super) status: StepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) detail: Option<String>,
}

impl Step {
    pub(super) fn pending(name: &str, kind: StepKind) -> Self {
        Self {
            name: name.to_string(),
            kind,
            status: StepStatus::Pending,
            detail: None,
        }
    }

    pub(super) fn skipped(name: &str, kind: StepKind, why: &str) -> Self {
        Self {
            name: name.to_string(),
            kind,
            status: StepStatus::Skipped,
            detail: Some(why.to_string()),
        }
    }

    pub(super) fn skip(&mut self, why: &str) {
        self.status = StepStatus::Skipped;
        self.detail = Some(why.to_string());
    }
}

/// The durable record of one migration run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Journal {
    pub(super) version: u32,
    pub(super) phase: Phase,
    /// Old folder name under the home directory.
    pub(super) from: String,
    /// New folder name under the home directory.
    pub(super) to: String,
    /// Staging folder name under the home directory.
    pub(super) staging: String,
    /// Set before the staging folder is renamed to the new folder in one step.
    /// A run that finds this set, staging gone and the new folder present knows
    /// the commit happened even if its last journal write was lost.
    pub(super) publish_whole: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) reason: Option<String>,
    pub(super) started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) finished_at: Option<String>,
    pub(super) steps: Vec<Step>,
}

impl Journal {
    pub(super) fn new(from: &str, to: &str, staging: &str, steps: Vec<Step>) -> Self {
        Self {
            version: JOURNAL_VERSION,
            phase: Phase::Staging,
            from: from.to_string(),
            to: to.to_string(),
            staging: staging.to_string(),
            publish_whole: false,
            reason: None,
            started_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            steps,
        }
    }

    pub(super) fn finish(&mut self, phase: Phase) {
        self.phase = phase;
        self.finished_at = Some(chrono::Utc::now().to_rfc3339());
    }
}

/// What reading the journal found.
pub(super) enum Loaded {
    Missing,
    Valid(Box<Journal>),
    /// The file exists but could not be read or parsed.
    Corrupt(String),
}

fn journal_path(dir: &Path) -> PathBuf {
    dir.join(JOURNAL_FILE)
}

/// Read the journal from `dir`.
pub(super) fn load(dir: &Path) -> Loaded {
    let bytes = match fs::read(journal_path(dir)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Loaded::Missing,
        Err(error) => return Loaded::Corrupt(format!("read journal: {error}")),
    };
    match serde_json::from_slice::<Journal>(&bytes) {
        Ok(journal) if journal.version == JOURNAL_VERSION => Loaded::Valid(Box::new(journal)),
        Ok(journal) => Loaded::Corrupt(format!("unknown journal version {}", journal.version)),
        Err(error) => Loaded::Corrupt(format!("parse journal: {error}")),
    }
}

/// Write the journal durably. Creates `dir` when needed.
pub(super) fn save(dir: &Path, journal: &Journal) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let payload =
        serde_json::to_vec_pretty(journal).map_err(|e| format!("serialize journal: {e}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(&journal_path(dir), &payload)
}

/// Move an unreadable journal out of the way (never delete it) so the next run
/// can start clean. Best effort.
pub(super) fn set_aside_corrupt(dir: &Path) {
    let _ = fs::rename(journal_path(dir), dir.join(CORRUPT_JOURNAL_FILE));
}

/// The one-time, plain-language message shown after a run that matters to the
/// person. `key` identifies the situation so the same message is shown once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NestMigrationNotice {
    /// Identifies the situation; the same key is never shown twice.
    pub key: String,
    /// Plain-language text for the person.
    pub message: String,
    /// True once the person has seen it.
    pub acknowledged: bool,
}

fn notice_path(dir: &Path) -> PathBuf {
    dir.join(NOTICE_FILE)
}

fn read_notice(dir: &Path) -> Option<NestMigrationNotice> {
    let bytes = fs::read(notice_path(dir)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Record a notice. A notice with the same `key` as the stored one is left
/// untouched, so a message the person already dismissed does not come back on
/// every launch.
pub(super) fn record_notice(dir: &Path, key: &str, message: &str) -> Result<(), String> {
    if read_notice(dir).is_some_and(|existing| existing.key == key) {
        return Ok(());
    }
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let notice = NestMigrationNotice {
        key: key.to_string(),
        message: message.to_string(),
        acknowledged: false,
    };
    let payload =
        serde_json::to_vec_pretty(&notice).map_err(|e| format!("serialize notice: {e}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(&notice_path(dir), &payload)
}

/// The notice that has not been shown yet, if any.
pub(crate) fn pending_notice(dir: &Path) -> Option<NestMigrationNotice> {
    read_notice(dir).filter(|notice| !notice.acknowledged)
}

/// Mark the stored notice as shown. A missing notice is not an error.
pub(crate) fn acknowledge_notice(dir: &Path) -> Result<(), String> {
    let Some(mut notice) = read_notice(dir) else {
        return Ok(());
    };
    if notice.acknowledged {
        return Ok(());
    }
    notice.acknowledged = true;
    let payload =
        serde_json::to_vec_pretty(&notice).map_err(|e| format!("serialize notice: {e}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(&notice_path(dir), &payload)
}
