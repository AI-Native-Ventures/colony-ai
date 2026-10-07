//! Boot-time glue: decides whether the migration applies to this launch,
//! gathers its inputs from the running app, runs it, and logs one line.

use super::{
    migration_enabled, parse_crash_at, run_migration, CrashAtFs, MigrationInput, RealFs,
    ENV_CRASH_AT, ENV_FLAG, LOG_PREFIX, STATE_DIR,
};
use crate::managed_agents::{ManagedAgentRuntimeReceipt, MarkerProbe};
use std::fs;
use std::path::{Path, PathBuf};

/// Where the journal and notice live for this install.
pub(crate) fn state_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(STATE_DIR)
}

/// Where running agents leave their receipts (read-only here: nothing is
/// created on a launch that has nothing to migrate).
fn agent_receipts_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("agents").join("agent-pids")
}

/// Agents found alive, and agent records that could not be read at all.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct LiveAgents {
    /// Pids of Colony-managed agents alive and owned by this install.
    pub(super) pids: Vec<u32>,
    /// Records (or the folder holding them) that failed to read. Whether an
    /// agent is alive is unknown for these, so they count like a live agent.
    pub(super) unreadable: usize,
}

/// Whether one pid named by an agent record must stop the move. Fails CLOSED:
/// only a pid that is dead, or alive with an environment that was read in full
/// and is clearly not this install's, may be ignored.
///
/// | alive (`kill(pid, 0)`) | environment probe                      | blocks the move |
/// |------------------------|----------------------------------------|-----------------|
/// | no (dead, or another user's pid) | any                          | no              |
/// | yes                    | `Ours` (marker present)                | **yes**         |
/// | yes                    | `Unknown` (empty: mid-`execve`/zombie; read error; unsupported platform) | **yes** |
/// | yes                    | `Foreign` (read in full, no marker: pid reused) | no     |
/// | yes                    | `Gone` (exited between the two checks) | no              |
pub(super) fn agent_blocks_move(
    pid: u32,
    instance_id: &str,
    is_running: &dyn Fn(u32) -> bool,
    probe: &dyn Fn(u32, &str) -> MarkerProbe,
) -> bool {
    if !is_running(pid) {
        return false;
    }
    match probe(pid, instance_id) {
        MarkerProbe::Ours | MarkerProbe::Unknown => true,
        MarkerProbe::Foreign | MarkerProbe::Gone => false,
    }
}

/// Find the Colony-managed agents that must stop the move: those named by a
/// record of `instance_id` for which [`agent_blocks_move`] says yes.
///
/// Reads the receipts the app writes for every agent it spawns (`*.json`) and
/// the older pid files (`*.pid`). A file that is readable but not a receipt is
/// stale, not an agent. A file that cannot be read at all is reported, never
/// skipped silently.
pub(super) fn live_agent_pids_in(
    dir: &Path,
    instance_id: &str,
    is_running: &dyn Fn(u32) -> bool,
    probe: &dyn Fn(u32, &str) -> MarkerProbe,
) -> LiveAgents {
    let mut found = LiveAgents::default();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return found,
        Err(_) => {
            found.unreadable = 1;
            return found;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let kind = path.extension().and_then(|ext| ext.to_str());
        if !matches!(kind, Some("json" | "pid")) {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            found.unreadable += 1;
            continue;
        };
        let pid = if kind == Some("json") {
            serde_json::from_slice::<ManagedAgentRuntimeReceipt>(&bytes)
                .ok()
                .filter(|receipt| receipt.desktop_instance_id == instance_id)
                .map(|receipt| receipt.pid)
        } else {
            String::from_utf8_lossy(&bytes).trim().parse::<u32>().ok()
        };
        if let Some(pid) = pid {
            if agent_blocks_move(pid, instance_id, is_running, probe) {
                found.pids.push(pid);
            }
        }
    }
    found.pids.sort_unstable();
    found.pids.dedup();
    found
}

/// Why this launch runs no migration, when it does not.
pub(super) const SKIP_RESET_PENDING: &str = "reset-pending";
/// There is no old folder and no unfinished run: a fresh install, or one that
/// already finished and left nothing behind to look at.
pub(super) const SKIP_NOTHING_TO_DO: &str = "nothing-to-do";

/// Decide before touching anything whether this launch has any migration work.
///
/// A pending reset wipes the chosen folder at this same launch, so moving it
/// first would only be wasted work. A home with no old folder and no journal
/// is left completely alone: no read of agent receipts, nothing created.
pub(super) fn skip_reason(
    home: &Path,
    from_name: &str,
    app_data_dir: &Path,
    journal_dir: &Path,
) -> Option<&'static str> {
    if crate::reset::check_sentinel(app_data_dir) {
        return Some(SKIP_RESET_PENDING);
    }
    let has_old_folder = fs::symlink_metadata(home.join(from_name)).is_ok();
    let has_journal = fs::symlink_metadata(journal_dir.join(super::journal::JOURNAL_FILE)).is_ok();
    if has_old_folder || has_journal {
        None
    } else {
        Some(SKIP_NOTHING_TO_DO)
    }
}

fn crash_now() -> ! {
    eprintln!("{LOG_PREFIX} crash seam: ending the process");
    std::process::exit(86)
}

/// Run the migration for this launch. Must be called before the nest folder is
/// chosen (`init_nest_dir`) and before anything reads or creates it.
///
/// Does nothing for dev and demo builds (their folders were always namespaced),
/// for a launch that will reset the nest anyway, and for a home folder with no
/// old folder to move. Never fails the launch: every outcome is a log line, and
/// the app keeps working from whichever folder holds its data.
pub(crate) fn run_at_boot(app: &tauri::AppHandle, app_data_dir: &Path, is_dev: bool) {
    let Some(from_name) = crate::build_identity::legacy_nest_name(is_dev) else {
        return;
    };
    // Whether an agent is alive cannot be told on this platform yet, so the
    // "never move under a running agent" rule could not be kept.
    if cfg!(not(unix)) {
        eprintln!("{LOG_PREFIX} skipped: not supported on this platform");
        return;
    }
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let to_name = crate::build_identity::nest_name(is_dev);
    let journal_dir = state_dir(app_data_dir);
    let enabled = migration_enabled(std::env::var(ENV_FLAG).ok().as_deref());

    if let Some(reason) = skip_reason(&home, from_name, app_data_dir, &journal_dir) {
        if reason == SKIP_RESET_PENDING {
            eprintln!("{LOG_PREFIX} skipped: a reset is pending");
        }
        return;
    }

    let live_agents = live_agent_pids_in(
        &agent_receipts_dir(app_data_dir),
        &crate::managed_agents::current_instance_id(app),
        &crate::managed_agents::process_is_running,
        &crate::managed_agents::probe_buzz_marker,
    );
    if !live_agents.pids.is_empty() || live_agents.unreadable > 0 {
        eprintln!(
            "{LOG_PREFIX} agents to wait for: pids={:?} unreadable_records={}",
            live_agents.pids, live_agents.unreadable
        );
    }
    let input = MigrationInput {
        home: &home,
        journal_dir: &journal_dir,
        from_name,
        to_name: &to_name,
        enabled,
        live_agent_pids: &live_agents.pids,
        unreadable_agent_records: live_agents.unreadable,
    };
    let report = match std::env::var(ENV_CRASH_AT)
        .ok()
        .as_deref()
        .and_then(parse_crash_at)
    {
        Some((at, before)) => run_migration(&input, &CrashAtFs::new(at, before, crash_now)),
        None => run_migration(&input, &RealFs),
    };
    eprintln!("{}", report.log_line());
}
