//! The team computer record: reading the head and deciding whether this
//! computer may start a saved company's employees. No I/O here.

use std::collections::HashMap;

use buzz_core_pkg::kind::KIND_TEAM_COMPUTER_HEAD;
use buzz_core_pkg::team_computer::TEAM_COMPUTER_D_TAG;
use serde::Deserialize;

use super::companies::{CompaniesFile, StoredCompany};
use super::computer::ComputerIdentity;
use super::{normalize_relay, TeamComputerInfo, TeamComputerStatus};
use crate::managed_agents::{BackendKind, ManagedAgentRecord};

/// Seconds between heartbeats. The relay refuses heartbeats less than 60
/// seconds apart (`rate-limited:`), so two minutes stays clear of that limit.
pub(crate) const HEARTBEAT_EVERY_SECS: u64 = 120;

/// Refusal while this computer has not yet confirmed it holds the team.
pub(crate) const CHECKING_REFUSAL: &str =
    "Checking which computer runs your team. Try again in a moment.";
/// Refusal while the company has any pause reason.
pub(crate) const PAUSED_REFUSAL: &str = "Your team is paused. Resume it to start your employees.";

/// Lenient read of the relay-signed head (kind 30658). Keys this build does
/// not know are ignored, so a newer relay never stops the team.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HeadView {
    #[serde(default)]
    pub(crate) computer_id: String,
    #[serde(default)]
    pub(crate) computer_name: String,
    #[serde(default)]
    pub(crate) last_seen_at: i64,
    /// Relay time the holder released the team; absent while it is held.
    #[serde(default)]
    pub(crate) released_at: Option<i64>,
}

impl HeadView {
    /// The computer that holds the team, or `None` once it was released.
    pub(crate) fn holder(&self) -> Option<TeamComputerInfo> {
        if self.released_at.is_some() || self.computer_id.trim().is_empty() {
            return None;
        }
        Some(TeamComputerInfo {
            computer_id: self.computer_id.clone(),
            computer_name: self.computer_name.clone(),
            last_seen_at: self.last_seen_at,
        })
    }
}

/// Read and verify one team computer head returned by the relay.
pub(crate) fn parse_head(event: &nostr::Event, relay_self: &str) -> Result<HeadView, String> {
    if u32::from(event.kind.as_u16()) != KIND_TEAM_COMPUTER_HEAD {
        return Err("not a team computer record".to_string());
    }
    if !event.pubkey.to_hex().eq_ignore_ascii_case(relay_self) {
        return Err("the team computer record is not signed by the relay".to_string());
    }
    event
        .verify()
        .map_err(|_| "the team computer record has a bad signature".to_string())?;
    let coordinate = event
        .tags
        .iter()
        .find(|tag| tag.kind().to_string() == "d")
        .and_then(|tag| tag.content());
    if coordinate != Some(TEAM_COMPUTER_D_TAG) {
        return Err("the team computer record has the wrong coordinate".to_string());
    }
    serde_json::from_str(&event.content)
        .map_err(|_| "the team computer record is unreadable".to_string())
}

/// What this computer last learned about one company's record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClaimView {
    /// The holding computer, `None` when released or never claimed.
    pub(crate) holder: Option<TeamComputerInfo>,
    /// When this computer read or changed the record, Unix seconds.
    pub(crate) fetched_at: i64,
}

/// The bridge status for one company.
pub(crate) fn status_from(view: Option<&ClaimView>, this_computer_id: &str) -> TeamComputerStatus {
    let holder = view.and_then(|view| view.holder.clone());
    let is_this_computer = holder
        .as_ref()
        .is_some_and(|holder| holder.computer_id == this_computer_id);
    TeamComputerStatus {
        this_computer_id: this_computer_id.to_string(),
        holder,
        is_this_computer,
    }
}

/// Why this computer may not start an employee of `company` right now, in
/// plain words, or `None` when it may.
pub(crate) fn spawn_refusal(
    company: &StoredCompany,
    view: Option<&ClaimView>,
    this_computer_id: Option<&str>,
) -> Option<String> {
    let (Some(view), Some(me)) = (view, this_computer_id) else {
        return Some(CHECKING_REFUSAL.to_string());
    };
    match view.holder.as_ref() {
        Some(holder) if holder.computer_id == me => {
            company.is_paused().then(|| PAUSED_REFUSAL.to_string())
        }
        Some(holder) => Some(format!(
            "Your team runs on {}. Move it here to run it on this computer.",
            holder.computer_name
        )),
        None => Some(CHECKING_REFUSAL.to_string()),
    }
}

/// What a cleared team spawn exports to the employee.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TeamSpawn {
    /// This computer's install id (`COLONY_TEAM_COMPUTER_ID`).
    pub(crate) computer_id: String,
}

/// The fence for one spawn on `relay_url`: `Ok(None)` when the relay is not a
/// saved company (nothing changes for it), `Ok(Some)` when this computer runs
/// that company's team, and the plain refusal otherwise.
pub(crate) fn clearance_for(
    companies: &CompaniesFile,
    claims: &HashMap<String, ClaimView>,
    computer: Option<&ComputerIdentity>,
    relay_url: &str,
) -> Result<Option<TeamSpawn>, String> {
    let Ok(relay) = normalize_relay(relay_url) else {
        return Ok(None);
    };
    let Some(company) = companies
        .companies
        .iter()
        .find(|company| company.relay_url == relay)
    else {
        return Ok(None);
    };
    let computer_id = computer.map(|identity| identity.computer_id.clone());
    if let Some(refusal) = spawn_refusal(company, claims.get(&relay), computer_id.as_deref()) {
        return Err(refusal);
    }
    Ok(computer_id.map(|computer_id| TeamSpawn { computer_id }))
}

/// Launch restore candidates: local agents marked start-on-launch, or none
/// when this computer may not run the open company's team.
pub(crate) fn launch_candidates(records: &[ManagedAgentRecord], fenced: bool) -> Vec<String> {
    if fenced {
        return Vec::new();
    }
    records
        .iter()
        .filter(|record| record.start_on_app_launch && record.backend == BackendKind::Local)
        .map(|record| record.pubkey.clone())
        .collect()
}
