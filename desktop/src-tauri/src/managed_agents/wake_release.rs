//! Hand mentions back to a stopped harness's wake ledger.
//!
//! The harness records a wake event as handled right before its turn sees it,
//! so a harness that is stopped after it queued a mention and before the turn
//! began leaves the mention marked handled and unanswered: the next harness
//! replays the window, finds the id in the ledger and skips it (GATE-304,
//! 26 Oct: the mention was queued 1.6 s before the harness was stopped and was
//! never answered, even after Scout was started again).
//!
//! The person's app can see on the relay that such a mention was never
//! answered. This module lets it hand the mention back: the id leaves the
//! handled list and the floor drops to the mention, which is what the harness
//! itself does for a turn that stopped before doing its work
//! (`WakeLedger::forget_events`). It only ever touches the ledger of a harness
//! that is not running, because a running harness owns the file.

use std::collections::HashSet;
use std::io::Write;
use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::{
    append_log_marker, current_instance_id, find_managed_agent_mut, load_managed_agents,
    managed_agent_runtime_log_path, managed_agent_wake_ledger_path, process_is_running,
    read_all_agent_runtime_receipts, valid_agent_runtime_receipt, workspace_pair_key,
};
use crate::app_state::AppState;

/// Largest ledger read; the harness refuses anything bigger as damaged.
const MAX_LEDGER_BYTES: usize = 256 * 1024;
/// Most ids one call hands back.
const MAX_EVENT_IDS: usize = 64;

fn is_event_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Remove `event_ids` from the handled list of the ledger file at `path` and
/// lower its floor to the oldest of them. Returns how many ids were handed
/// back; `0` (and no write) when the file is missing or holds none of them.
pub(crate) fn release_events_in_ledger(path: &Path, event_ids: &[String]) -> Result<usize, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(format!("failed to read the wake ledger: {error}")),
    };
    if bytes.len() > MAX_LEDGER_BYTES {
        return Err("the wake ledger is larger than its limit".to_string());
    }
    let mut file: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("the wake ledger is not readable: {error}"))?;
    let wanted: HashSet<String> = event_ids.iter().map(|id| id.to_ascii_lowercase()).collect();

    let mut lowest: Option<u64> = None;
    let released = {
        let handled = file
            .get_mut("handled")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "the wake ledger has no handled list".to_string())?;
        let before = handled.len();
        handled.retain(|entry| {
            let id = entry.get("id").and_then(Value::as_str).unwrap_or_default();
            if !wanted.contains(id) {
                return true;
            }
            if let Some(created_at) = entry.get("createdAt").and_then(Value::as_u64) {
                lowest = Some(lowest.map_or(created_at, |current| current.min(created_at)));
            }
            false
        });
        before - handled.len()
    };
    if released == 0 {
        return Ok(0);
    }
    if let Some(lowest) = lowest {
        let floor = file
            .get("floor")
            .and_then(Value::as_u64)
            .map_or(lowest, |floor| floor.min(lowest));
        file["floor"] = Value::from(floor);
    }

    // Same write the harness makes: a temporary file renamed over the old one,
    // so a crash never leaves a torn ledger.
    let encoded = serde_json::to_vec(&file)
        .map_err(|error| format!("failed to encode the wake ledger: {error}"))?;
    let temp = path.with_extension("tmp");
    let mut out = std::fs::File::create(&temp)
        .map_err(|error| format!("failed to write the wake ledger: {error}"))?;
    out.write_all(&encoded)
        .and_then(|()| out.sync_all())
        .map_err(|error| format!("failed to write the wake ledger: {error}"))?;
    drop(out);
    std::fs::rename(&temp, path)
        .map_err(|error| format!("failed to replace the wake ledger: {error}"))?;
    Ok(released)
}

/// Hand mentions the person's app found unanswered back to an agent's harness
/// for the community on screen, so the next harness answers them.
///
/// Refused while a harness runs for the pair: stop the agent first. Returns how
/// many of `event_ids` the ledger held as handled.
#[tauri::command]
pub fn release_wake_events(
    pubkey: String,
    event_ids: Vec<String>,
    app: AppHandle,
) -> Result<usize, String> {
    if event_ids.len() > MAX_EVENT_IDS {
        return Err(format!("at most {MAX_EVENT_IDS} events can be handed back"));
    }
    if let Some(bad) = event_ids.iter().find(|id| !is_event_id(id)) {
        return Err(format!("not an event id: {bad}"));
    }
    let state = app.state::<AppState>();
    // Held across the check and the write so no harness is spawned in between.
    let _transition = state
        .managed_agent_runtime_transition
        .lock()
        .map_err(|error| error.to_string())?;
    let _store = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut records = load_managed_agents(&app)?;
    let record = find_managed_agent_mut(&mut records, &pubkey)?;
    let key = workspace_pair_key(&app, record)
        .ok_or_else(|| "this agent has no runtime pair for the current community".to_string())?;

    let tracked_alive = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?
        .get_mut(&key)
        .is_some_and(|runtime| runtime.child.try_wait().ok().flatten().is_none());
    let instance_id = current_instance_id(&app);
    let prior_session_alive =
        read_all_agent_runtime_receipts(&app)
            .into_iter()
            .any(|(path, receipt)| {
                receipt.key == key
                    && valid_agent_runtime_receipt(&path, &receipt, &instance_id)
                    && process_is_running(receipt.pid)
            });
    if tracked_alive || prior_session_alive {
        return Err("stop the agent before handing mentions back to it".to_string());
    }

    let ledger = managed_agent_wake_ledger_path(&app, &key)?;
    let released = release_events_in_ledger(&ledger, &event_ids)?;
    eprintln!(
        "buzz-desktop: handed {released} of {} mention(s) back to the wake ledger of {} on {}",
        event_ids.len(),
        record.pubkey,
        key.relay_url
    );
    if let Ok(log) = managed_agent_runtime_log_path(&app, &key) {
        let _ = append_log_marker(
            &log,
            &format!(
                "=== handed {released} unanswered mention(s) back for replay at {} ===",
                crate::util::now_iso()
            ),
        );
    }
    Ok(released)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIRST: &str = "6bf4fee6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const LATER: &str = "b9a71dfebbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const OLD: &str = "90d4c919cccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    fn ledger_json() -> String {
        serde_json::json!({
            "version": 1,
            "relayUrl": "wss://relay.example",
            "agentPubkey": "ab".repeat(32),
            "floor": 1_792_999_011u64,
            "evictedFloor": 0,
            "handled": [
                { "id": OLD, "createdAt": 1_792_997_431u64 },
                { "id": FIRST, "createdAt": 1_793_016_887u64 },
                { "id": LATER, "createdAt": 1_793_017_921u64 },
            ],
        })
        .to_string()
    }

    fn write_ledger() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("wake").join("ledger.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, ledger_json()).unwrap();
        (dir, path)
    }

    fn read(path: &Path) -> Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    fn handled_ids(file: &Value) -> Vec<String> {
        file["handled"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["id"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn a_handed_back_mention_leaves_the_handled_list_and_the_others_stay() {
        let (_dir, path) = write_ledger();
        let released = release_events_in_ledger(&path, &[FIRST.to_string()]).unwrap();
        assert_eq!(released, 1);
        let file = read(&path);
        assert_eq!(handled_ids(&file), vec![OLD.to_string(), LATER.to_string()]);
    }

    #[test]
    fn the_floor_drops_to_the_oldest_mention_handed_back_never_rises() {
        let (_dir, path) = write_ledger();
        release_events_in_ledger(&path, &[OLD.to_string(), FIRST.to_string()]).unwrap();
        assert_eq!(read(&path)["floor"].as_u64(), Some(1_792_997_431));

        let (_dir, path) = write_ledger();
        // The floor was already below this mention: it stays where it was.
        release_events_in_ledger(&path, &[FIRST.to_string()]).unwrap();
        assert_eq!(read(&path)["floor"].as_u64(), Some(1_792_999_011));
    }

    #[test]
    fn ids_the_ledger_never_handled_change_nothing_and_write_nothing() {
        let (_dir, path) = write_ledger();
        let before = std::fs::read(&path).unwrap();
        let unknown = "d".repeat(64);
        assert_eq!(release_events_in_ledger(&path, &[unknown]).unwrap(), 0);
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }

    #[test]
    fn a_missing_ledger_is_nothing_to_hand_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("none.json");
        assert_eq!(
            release_events_in_ledger(&path, &[FIRST.to_string()]).unwrap(),
            0
        );
        assert!(!path.exists());
    }

    #[test]
    fn an_unreadable_ledger_is_an_error_not_an_empty_answer() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.json");
        std::fs::write(&path, b"{ not json").unwrap();
        assert!(release_events_in_ledger(&path, &[FIRST.to_string()]).is_err());
    }

    #[test]
    fn ids_match_whatever_their_case_and_the_file_keeps_its_other_fields() {
        let (_dir, path) = write_ledger();
        release_events_in_ledger(&path, &[FIRST.to_ascii_uppercase()]).unwrap();
        let file = read(&path);
        assert_eq!(file["version"].as_u64(), Some(1));
        assert_eq!(file["relayUrl"].as_str(), Some("wss://relay.example"));
        assert_eq!(file["evictedFloor"].as_u64(), Some(0));
        assert!(!handled_ids(&file).contains(&FIRST.to_string()));
    }

    #[test]
    fn only_full_hex_event_ids_are_accepted() {
        assert!(is_event_id(FIRST));
        assert!(!is_event_id("6bf4fee6"));
        assert!(!is_event_id(&"g".repeat(64)));
    }
}
