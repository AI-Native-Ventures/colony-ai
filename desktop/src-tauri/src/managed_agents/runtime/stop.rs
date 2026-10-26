use std::collections::HashMap;

use tauri::AppHandle;

use super::{
    append_log_marker, current_instance_id, now_iso, process_belongs_to_us,
    process_has_buzz_marker, process_is_running, terminate_process, ManagedAgentPairRuntime,
    ManagedAgentRecord, ManagedAgentRuntimeKey,
};

pub(crate) fn managed_agent_runtime_keys<T>(
    runtimes: &HashMap<ManagedAgentRuntimeKey, T>,
    pubkey: &str,
) -> Vec<ManagedAgentRuntimeKey> {
    runtimes
        .keys()
        .filter(|key| key.pubkey.eq_ignore_ascii_case(pubkey))
        .cloned()
        .collect()
}

#[cfg(test)]
pub(crate) fn managed_agent_runtime_relay_urls<T>(
    runtimes: &HashMap<ManagedAgentRuntimeKey, T>,
    pubkey: &str,
) -> Vec<String> {
    managed_agent_runtime_keys(runtimes, pubkey)
        .into_iter()
        .map(|key| key.relay_url)
        .collect()
}

/// Longest reason text written to a log; a caller-supplied reason is data.
const MAX_STOP_REASON_CHARS: usize = 160;

/// One line in the pair's log and one on the host's stderr saying who asked
/// for the stop, written BEFORE the harness is signalled.
///
/// GATE-304 (26 Oct): Scout's harness was stopped 5.5 s after it started and
/// nothing in either log named the caller, so the cause could only be guessed.
/// The line goes first so a harness that is killed mid-stop, or a host that
/// dies right after, still leaves it. A harness that gets a signal with no
/// such line before it was not stopped by this app.
pub(crate) fn stop_request_line(name: &str, pubkey: &str, reason: &str, at: &str) -> String {
    let reason: String = reason
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_STOP_REASON_CHARS)
        .collect();
    format!("=== stop requested for {name} ({pubkey}) at {at}: {reason} ===")
}

fn log_stop_request(
    log_path: &std::path::Path,
    record: &ManagedAgentRecord,
    key: &ManagedAgentRuntimeKey,
    reason: &str,
) {
    let line = stop_request_line(&record.name, &record.pubkey, reason, &now_iso());
    if let Err(error) = append_log_marker(log_path, &line) {
        eprintln!(
            "buzz-desktop: failed to append stop request for {} on {}: {error}",
            record.pubkey, key.relay_url
        );
    }
    eprintln!("buzz-desktop: {line} (relay {})", key.relay_url);
}

/// Stop the single tracked runtime pair at `key`, if present.
///
/// Terminates the child, records the exit code, removes the pair receipt,
/// and appends a stop marker to the pair log. On teardown failure the
/// runtime is reinserted so the pair stays visible and stoppable instead of
/// becoming an invisible orphan. Touches no other pair for the agent and
/// does no record-level stop bookkeeping: callers own that. `reason` names
/// the caller in the pair log and on stderr before the harness is signalled.
pub(super) fn stop_managed_agent_pair<R: tauri::Runtime>(
    app: &AppHandle<R>,
    record: &mut ManagedAgentRecord,
    runtimes: &mut HashMap<ManagedAgentRuntimeKey, ManagedAgentPairRuntime>,
    key: &ManagedAgentRuntimeKey,
    reason: &str,
) -> Result<(), String> {
    let Some(mut runtime) = runtimes.remove(key) else {
        return Ok(());
    };
    log_stop_request(&runtime.log_path, record, key, reason);
    let result = (|| -> Result<(), String> {
        #[cfg(unix)]
        terminate_process(runtime.child.id())?;
        #[cfg(windows)]
        match runtime.job.take() {
            Some(job) => drop(job),
            None => runtime
                .child
                .kill()
                .map_err(|error| format!("failed to kill agent process: {error}"))?,
        }
        #[cfg(not(any(unix, windows)))]
        runtime
            .child
            .kill()
            .map_err(|error| format!("failed to kill agent process: {error}"))?;
        let status = runtime
            .child
            .wait()
            .map_err(|error| format!("failed to wait for agent shutdown: {error}"))?;
        record.last_exit_code = status.code();
        super::super::remove_agent_runtime_receipt(app, key);
        if let Err(error) = append_log_marker(
            &runtime.log_path,
            &format!(
                "=== stopped {} ({}) at {} ===",
                record.name,
                record.pubkey,
                now_iso()
            ),
        ) {
            eprintln!(
                "buzz-desktop: failed to append stop marker for {} on {}: {error}",
                record.pubkey, key.relay_url
            );
        }
        Ok(())
    })();
    if let Err(error) = result {
        // Keep failed teardown visible/manageable instead of orphaning it.
        runtimes.insert(key.clone(), runtime);
        return Err(error);
    }
    Ok(())
}

/// Terminate a legacy scalar-PID child (pre-pair records) and remove the
/// agent-scoped pid file. Pair receipts are restored separately.
fn stop_legacy_scalar_pid<R: tauri::Runtime>(
    app: &AppHandle<R>,
    record: &mut ManagedAgentRecord,
) -> Result<(), String> {
    if let Some(pid) = record.runtime_pid.take() {
        if process_is_running(pid)
            && process_belongs_to_us(pid)
            && process_has_buzz_marker(pid, &current_instance_id(app))
        {
            terminate_process(pid)?;
        }
        record.updated_at = now_iso();
    }
    super::super::remove_agent_pid_file(app, &record.pubkey);
    Ok(())
}

/// Stop the runtime pair this record resolves to for the active workspace
/// (explicit relay pin, else the active workspace relay) — the pair-scoped
/// counterpart of [`stop_managed_agent_process`], which drains every pair.
///
/// Community-scoped surfaces (profile panel, Agents tab, auto-restart) stop
/// through here so stopping an agent in one community never tears down its
/// pairs in other communities. Clears the matching agent session cache
/// (pair-scoped when a pair key resolves). When no pair is tracked for this
/// workspace, only legacy scalar-PID cleanup runs.
pub fn stop_managed_agent_workspace_pair(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    runtimes: &mut HashMap<ManagedAgentRuntimeKey, ManagedAgentPairRuntime>,
    reason: &str,
) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<crate::app_state::AppState>();
    match super::workspace_pair_key(app, record) {
        Some(pair_key) if runtimes.contains_key(&pair_key) => {
            stop_managed_agent_pair(app, record, runtimes, &pair_key, reason)?;
            state.clear_agent_session_cache(&pair_key);
            super::super::remove_agent_pid_file(app, &record.pubkey);
            let now = now_iso();
            record.runtime_pid = None;
            record.updated_at = now.clone();
            record.last_stopped_at = Some(now);
            record.last_error = None;
            record.last_error_code = None;
        }
        Some(pair_key) => {
            // No tracked pair here — a pubkey-wide cache clear would disturb
            // live pairs in other communities, so stay pair-scoped.
            stop_legacy_scalar_pid(app, record)?;
            state.clear_agent_session_cache(&pair_key);
        }
        None => {
            stop_legacy_scalar_pid(app, record)?;
            state.clear_agent_session_caches(&record.pubkey);
        }
    }
    Ok(())
}

pub fn stop_managed_agent_process<R: tauri::Runtime>(
    app: &AppHandle<R>,
    record: &mut ManagedAgentRecord,
    runtimes: &mut HashMap<ManagedAgentRuntimeKey, ManagedAgentPairRuntime>,
    reason: &str,
) -> Result<(), String> {
    let keys = managed_agent_runtime_keys(runtimes, &record.pubkey);
    if keys.is_empty() {
        return stop_legacy_scalar_pid(app, record);
    }

    let mut errors = Vec::new();
    for key in keys {
        if let Err(error) = stop_managed_agent_pair(app, record, runtimes, &key, reason) {
            errors.push(format!("{}: {error}", key.relay_url));
        }
    }

    let now = now_iso();
    record.runtime_pid = None;
    record.updated_at = now.clone();
    record.last_stopped_at = Some(now);
    record.last_error = None;
    record.last_error_code = None;
    super::super::remove_agent_pid_file(app, &record.pubkey);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to stop one or more managed-agent runtimes: {}",
            errors.join("; ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stop_request_line_names_the_agent_the_time_and_the_caller() {
        let line = stop_request_line(
            "Scout",
            &"ab".repeat(32),
            "welcome starter reconcile: launch fields changed",
            "2026-10-26T12:14:54+00:00",
        );
        assert!(line.starts_with("=== stop requested for Scout ("), "{line}");
        assert!(line.contains("2026-10-26T12:14:54+00:00"), "{line}");
        assert!(
            line.ends_with("welcome starter reconcile: launch fields changed ==="),
            "{line}"
        );
    }

    #[test]
    fn a_stop_reason_is_data_so_control_characters_and_length_are_bounded() {
        let hostile = format!("line one\nline two\r\u{7}{}", "x".repeat(1_000));
        let line = stop_request_line("Scout", "pk", &hostile, "now");
        assert!(!line.contains('\n') && !line.contains('\r'), "{line:?}");
        assert!(!line.contains('\u{7}'), "{line:?}");
        assert!(line.chars().count() < 160 + 120, "{}", line.chars().count());
    }

    #[test]
    fn pair_preserving_restart_targets_exact_original_relays() {
        let agent = "aa".repeat(32);
        let other = "bb".repeat(32);
        let first = ManagedAgentRuntimeKey::new(&agent, "wss://one.example").unwrap();
        let second = ManagedAgentRuntimeKey::new(&agent, "wss://two.example").unwrap();
        let unrelated = ManagedAgentRuntimeKey::new(other, "wss://fallback.example").unwrap();
        let runtimes = HashMap::from([(first, ()), (second, ()), (unrelated, ())]);

        let mut relays = managed_agent_runtime_relay_urls(&runtimes, &agent);
        relays.sort();
        assert_eq!(
            relays,
            vec![
                "wss://one.example".to_string(),
                "wss://two.example".to_string()
            ]
        );
    }

    #[test]
    fn pair_scoped_selection_targets_only_the_exact_pair() {
        // stop_managed_agent_workspace_pair resolves one key and removes only
        // that map entry: the same agent's pair on another relay and other
        // agents' pairs must survive a pair-scoped stop.
        let agent = "aa".repeat(32);
        let other = "bb".repeat(32);
        let viewed = ManagedAgentRuntimeKey::new(&agent, "wss://one.example").unwrap();
        let elsewhere = ManagedAgentRuntimeKey::new(&agent, "wss://two.example").unwrap();
        let unrelated = ManagedAgentRuntimeKey::new(other, "wss://one.example").unwrap();
        let mut runtimes = HashMap::from([
            (viewed.clone(), ()),
            (elsewhere.clone(), ()),
            (unrelated.clone(), ()),
        ]);

        // Non-canonical spelling of the viewed workspace relay resolves to
        // the same canonical key that spawn stamped.
        let resolved = ManagedAgentRuntimeKey::new(&agent, "WSS://One.Example:443/").unwrap();
        assert_eq!(resolved, viewed);
        assert!(runtimes.remove(&resolved).is_some());
        assert!(runtimes.contains_key(&elsewhere));
        assert!(runtimes.contains_key(&unrelated));
    }

    #[test]
    fn agent_wide_selection_drains_every_pair_only_for_that_agent() {
        let agent = "aa".repeat(32);
        let other = "bb".repeat(32);
        let first = ManagedAgentRuntimeKey::new(&agent, "wss://one.example").unwrap();
        let second = ManagedAgentRuntimeKey::new(&agent, "wss://two.example").unwrap();
        let unrelated = ManagedAgentRuntimeKey::new(other, "wss://one.example").unwrap();
        let runtimes = HashMap::from([(first.clone(), ()), (second.clone(), ()), (unrelated, ())]);

        let mut selected = managed_agent_runtime_keys(&runtimes, &agent);
        selected.sort_by(|left, right| left.relay_url.cmp(&right.relay_url));
        assert_eq!(selected, vec![first, second]);
    }
}
