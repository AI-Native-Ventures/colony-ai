//! `team-companies.json`: the companies this computer may run, with the set
//! of reasons each one is paused for.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// The last durable companies file and any failed load. A failed read never
/// turns the default empty cache into permission to bypass the team fence.
#[derive(Default)]
pub(crate) struct CompaniesCache {
    file: CompaniesFile,
    error: Option<String>,
}

impl CompaniesCache {
    /// Keep a load failure until the file can be read successfully.
    pub(crate) fn remember_load(
        &mut self,
        result: Result<CompaniesFile, String>,
    ) -> Result<(), String> {
        match result {
            Ok(file) => {
                self.file = file;
                self.error = None;
                Ok(())
            }
            Err(error) => {
                self.error = Some(error.clone());
                Err(error)
            }
        }
    }

    /// The known file, or the unresolved load failure.
    pub(crate) fn file(&self) -> Result<&CompaniesFile, String> {
        match &self.error {
            Some(error) => Err(error.clone()),
            None => Ok(&self.file),
        }
    }
}

use super::{normalize_relay, PauseReason, TeamCompany};

/// File name inside `<app data>/team`.
pub(crate) const COMPANIES_FILE: &str = "team-companies.json";
/// Most companies one computer keeps.
pub(crate) const MAX_COMPANIES: usize = 5;
const FILE_VERSION: u8 = 1;
/// Refusal for a relay that is not a saved company.
pub(crate) const NOT_SET_UP: &str = "This company is not set up on this computer.";

/// One saved company.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredCompany {
    /// Normalized relay URL.
    pub(crate) relay_url: String,
    /// Lowercase hex public key of the person who saved it.
    pub(crate) owner_pubkey: String,
    /// Active pause reasons, sorted, each once. Empty means running.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) pause_reasons: Vec<PauseReason>,
}

impl StoredCompany {
    /// Whether any pause reason holds the team.
    pub(crate) fn is_paused(&self) -> bool {
        !self.pause_reasons.is_empty()
    }
}

/// The whole file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompaniesFile {
    /// File format version.
    pub(crate) version: u8,
    /// Saved companies in the order the interface gave them.
    #[serde(default)]
    pub(crate) companies: Vec<StoredCompany>,
}

impl Default for CompaniesFile {
    fn default() -> Self {
        Self {
            version: FILE_VERSION,
            companies: Vec::new(),
        }
    }
}

impl CompaniesFile {
    /// The saved company at `relay_url`.
    pub(crate) fn find(&self, relay_url: &str) -> Option<&StoredCompany> {
        let relay = normalize_relay(relay_url).ok()?;
        self.companies
            .iter()
            .find(|company| company.relay_url == relay)
    }

    /// The company this computer runs in phase 0: the first saved company
    /// owned by `identity`.
    pub(crate) fn active(&self, identity: &str) -> Option<&StoredCompany> {
        self.companies
            .iter()
            .find(|company| company.owner_pubkey.eq_ignore_ascii_case(identity))
    }

    /// Replace the saved list. A company that stays keeps its pause reasons.
    /// Returns the companies that were removed. A rejected list changes
    /// nothing.
    pub(crate) fn replace(
        &mut self,
        incoming: Vec<TeamCompany>,
    ) -> Result<Vec<StoredCompany>, String> {
        let mut next = normalize(incoming)?;
        for company in &mut next {
            if let Some(kept) = self.companies.iter().find(|existing| {
                existing.relay_url == company.relay_url
                    && existing.owner_pubkey == company.owner_pubkey
            }) {
                company.pause_reasons = kept.pause_reasons.clone();
            }
        }
        let removed = self
            .companies
            .iter()
            .filter(|existing| {
                !next
                    .iter()
                    .any(|company| company.relay_url == existing.relay_url)
            })
            .cloned()
            .collect();
        self.companies = next;
        Ok(removed)
    }

    /// Add `reason`. Returns whether anything changed.
    pub(crate) fn add_pause(
        &mut self,
        relay_url: &str,
        reason: PauseReason,
    ) -> Result<bool, String> {
        let company = self.find_mut(relay_url)?;
        if company.pause_reasons.contains(&reason) {
            return Ok(false);
        }
        company.pause_reasons.push(reason);
        company.pause_reasons.sort();
        Ok(true)
    }

    /// Remove `reason`. Returns whether anything changed.
    pub(crate) fn remove_pause(
        &mut self,
        relay_url: &str,
        reason: PauseReason,
    ) -> Result<bool, String> {
        let company = self.find_mut(relay_url)?;
        let before = company.pause_reasons.len();
        company.pause_reasons.retain(|held| *held != reason);
        Ok(company.pause_reasons.len() != before)
    }

    fn find_mut(&mut self, relay_url: &str) -> Result<&mut StoredCompany, String> {
        let relay = normalize_relay(relay_url)?;
        self.companies
            .iter_mut()
            .find(|company| company.relay_url == relay)
            .ok_or_else(|| NOT_SET_UP.to_string())
    }
}

/// Validate and normalize the list the interface saves: 64-hex owners,
/// normalized relays, one entry per relay (the first wins), at most
/// [`MAX_COMPANIES`].
pub(crate) fn normalize(incoming: Vec<TeamCompany>) -> Result<Vec<StoredCompany>, String> {
    let mut out: Vec<StoredCompany> = Vec::new();
    for company in incoming {
        let relay_url = normalize_relay(&company.relay_url)?;
        let owner_pubkey = company.owner_pubkey.trim().to_ascii_lowercase();
        if owner_pubkey.len() != 64 || !owner_pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("company owner must be a 64-character hex public key".to_string());
        }
        if out.iter().any(|saved| saved.relay_url == relay_url) {
            continue;
        }
        out.push(StoredCompany {
            relay_url,
            owner_pubkey,
            pause_reasons: Vec::new(),
        });
    }
    if out.len() > MAX_COMPANIES {
        return Err(format!(
            "at most {MAX_COMPANIES} companies can be saved on one computer"
        ));
    }
    Ok(out)
}

/// Read the file. Missing means no companies; unreadable is an error.
pub(crate) fn load(path: &Path) -> Result<CompaniesFile, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CompaniesFile::default())
        }
        Err(error) => return Err(format!("failed to read {COMPANIES_FILE}: {error}")),
    };
    let mut file: CompaniesFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse {COMPANIES_FILE}: {error}"))?;
    for company in &mut file.companies {
        company.pause_reasons.sort();
        company.pause_reasons.dedup();
    }
    Ok(file)
}

/// Write the file durably (temporary file, sync, rename).
pub(crate) fn save(path: &Path, file: &CompaniesFile) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(file)
        .map_err(|error| format!("failed to serialize {COMPANIES_FILE}: {error}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(path, &bytes)
}
