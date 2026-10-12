//! The supervisor loop and the full-disk watch.
//!
//! Every two seconds: reap exited harnesses (the canonical reaper records each
//! exit code on its record), restart the employees the book expects, send
//! every new exit through the credits seam before the crash policy, report
//! problems, and emit status changes.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::supervisor::{DownDecision, Settled};
use super::{
    emit_problem, now_unix, problem_detail, running_company, shutting_down, with_book,
    EmployeeProblem, ProblemKind,
};
use crate::app_state::AppState;
use crate::managed_agents::{
    credits_pause, current_instance_id, load_managed_agents, save_managed_agents,
    sync_managed_agent_processes, ManagedAgentRecord,
};

const TICK: Duration = Duration::from_secs(2);
/// Part C's stable log text while the wake ledger cannot be saved.
pub(crate) const LEDGER_FAILURE_TEXT: &str = "wake ledger could not be saved";
/// A full disk is reported again at most this often per employee.
pub(crate) const DISK_PROBLEM_REPEAT_SECS: i64 = 600;
/// Most log bytes read per employee per tick.
pub(crate) const MAX_LOG_SCAN_BYTES: u64 = 64 * 1024;

/// Start the loop (once, from activation).
pub(crate) fn spawn_supervisor_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut disk = DiskWatch::default();
        loop {
            tokio::time::sleep(TICK).await;
            if shutting_down(&app) {
                return;
            }
            if let Err(error) = tick(&app, &mut disk).await {
                eprintln!("team runner: supervisor tick failed: {error}");
            }
        }
    });
}

fn report(app: &AppHandle, pubkey: &str, kind: ProblemKind, name: &str) {
    emit_problem(
        app,
        &EmployeeProblem {
            agent_pubkey: Some(pubkey.to_string()),
            kind,
            detail: problem_detail(kind, name),
        },
    );
}

async fn tick(app: &AppHandle, disk: &mut DiskWatch) -> Result<(), String> {
    let Some(company) = running_company(app) else {
        return Ok(());
    };
    let relay = company.relay_url;
    let (records, live) = {
        let (app, relay) = (app.clone(), relay.clone());
        tauri::async_runtime::spawn_blocking(move || reap(&app, &relay))
            .await
            .map_err(|error| error.to_string())??
    };
    let now = now_unix();
    let name_of = |pubkey: &str| {
        records
            .iter()
            .find(|record| record.pubkey.eq_ignore_ascii_case(pubkey))
            .map(super::status::display_name)
            .unwrap_or_else(|| "An employee".to_string())
    };

    let (new_exits, mut restarts) = with_book(app, |book| {
        let (mut new_exits, mut restarts) = (Vec::new(), Vec::new());
        for pubkey in book.expected_on(&relay) {
            if live.contains_key(&pubkey) {
                book.note_up(&pubkey, now);
                continue;
            }
            let Some(generation) = book.generation(&pubkey, &relay) else {
                continue;
            };
            match book.observe_down(&pubkey, now) {
                DownDecision::NewExit => new_exits.push((pubkey, generation)),
                DownDecision::RestartNow => restarts.push((pubkey, generation)),
                DownDecision::Wait | DownDecision::Ignore => {}
            }
        }
        (new_exits, restarts)
    })?;

    for (pubkey, generation) in new_exits {
        let exit_code = records
            .iter()
            .find(|record| record.pubkey.eq_ignore_ascii_case(&pubkey))
            .and_then(|record| record.last_exit_code);
        let handling = credits_pause::on_harness_exit(app, &relay, &pubkey, exit_code).await;
        match with_book(app, |book| {
            book.settle_exit_if_current(&pubkey, &relay, generation, now, handling)
        })? {
            Some(Settled::Crashed { .. }) => {
                report(app, &pubkey, ProblemKind::Crashed, &name_of(&pubkey))
            }
            Some(Settled::CrashLoop) => {
                report(app, &pubkey, ProblemKind::CrashLoop, &name_of(&pubkey))
            }
            Some(Settled::RestartNow) => restarts.push((pubkey, generation)),
            Some(Settled::Paused) | None => {}
        }
    }

    for (pubkey, generation) in restarts {
        let started = {
            let (app, pubkey, relay) = (app.clone(), pubkey.clone(), relay.clone());
            tauri::async_runtime::spawn_blocking(move || {
                crate::managed_agents::start_managed_agent_runtime_pair_supervised(
                    pubkey, relay, generation, app,
                )
            })
            .await
        };
        if !matches!(started, Ok(Ok(_))) {
            match with_book(app, |book| {
                book.start_failed_if_current(&pubkey, &relay, generation, now_unix())
            })? {
                Some(Settled::CrashLoop) => {
                    report(app, &pubkey, ProblemKind::CrashLoop, &name_of(&pubkey))
                }
                Some(_) => report(app, &pubkey, ProblemKind::StartFailed, &name_of(&pubkey)),
                None => {}
            }
        }
    }

    for (pubkey, log_path) in &live {
        if disk.check(pubkey, log_path, now) {
            report(app, pubkey, ProblemKind::DiskFull, &name_of(pubkey));
        }
    }
    super::status::emit_changes(app, &relay);
    Ok(())
}

/// Reap exited harnesses and list the pairs still alive on `relay` with
/// their log files.
fn reap(
    app: &AppHandle,
    relay: &str,
) -> Result<(Vec<ManagedAgentRecord>, HashMap<String, PathBuf>), String> {
    let state = app.state::<AppState>();
    let _store = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut records = load_managed_agents(app)?;
    let mut runtimes = state
        .managed_agent_processes
        .lock()
        .map_err(|error| error.to_string())?;
    let (changed, _exited) =
        sync_managed_agent_processes(&mut records, &mut runtimes, &current_instance_id(app));
    let live = runtimes
        .iter()
        .filter(|(key, _)| key.relay_url == relay)
        .map(|(key, runtime)| (key.pubkey.clone(), runtime.log_path.clone()))
        .collect();
    drop(runtimes);
    if changed {
        save_managed_agents(app, &records)?;
    }
    Ok((records, live))
}

/// Which bytes to read: everything new since `offset`, at most the newest
/// 64 KiB, and from the start when the log was replaced or truncated.
pub(crate) fn read_window(len: u64, offset: u64) -> (u64, u64) {
    let start = if len < offset { 0 } else { offset };
    let fresh = len - start;
    if fresh > MAX_LOG_SCAN_BYTES {
        (len - MAX_LOG_SCAN_BYTES, MAX_LOG_SCAN_BYTES)
    } else {
        (start, fresh)
    }
}

/// Whether `chunk` holds part C's wake ledger failure text.
pub(crate) fn contains_ledger_failure(chunk: &[u8]) -> bool {
    chunk
        .windows(LEDGER_FAILURE_TEXT.len())
        .any(|window| window == LEDGER_FAILURE_TEXT.as_bytes())
}

#[derive(Debug, Default)]
struct LogCursor {
    path: PathBuf,
    offset: u64,
    last_problem_at: Option<i64>,
}

/// Per-employee log cursors for the full-disk watch.
#[derive(Debug, Default)]
pub(crate) struct DiskWatch {
    cursors: HashMap<String, LogCursor>,
}

impl DiskWatch {
    /// Whether `pubkey`'s log gained the failure text since the last check and
    /// no full disk was reported for it in the last ten minutes. A log seen
    /// for the first time is read from its current end: older lines may come
    /// from an earlier run.
    pub(crate) fn check(&mut self, pubkey: &str, log_path: &Path, now: i64) -> bool {
        self.check_with(pubkey, log_path, now, read_range)
    }

    /// Production cursor logic with a reader seam for transient I/O failures.
    pub(crate) fn check_with(
        &mut self,
        pubkey: &str,
        log_path: &Path,
        now: i64,
        read: impl FnOnce(&Path, u64, u64) -> std::io::Result<Vec<u8>>,
    ) -> bool {
        let Ok(metadata) = std::fs::metadata(log_path) else {
            return false;
        };
        let len = metadata.len();
        let cursor = self.cursors.entry(pubkey.to_string()).or_default();
        if cursor.path != log_path {
            cursor.path = log_path.to_path_buf();
            cursor.offset = len;
            return false;
        }
        if len == cursor.offset {
            return false;
        }
        // Keep enough overlap to find a warning split between two appends.
        let offset = if len < cursor.offset {
            0
        } else {
            cursor
                .offset
                .saturating_sub((LEDGER_FAILURE_TEXT.len() - 1) as u64)
        };
        let (start, take) = read_window(len, offset);
        let Ok(chunk) = read(log_path, start, take) else {
            return false;
        };
        cursor.offset = start + chunk.len() as u64;
        if !contains_ledger_failure(&chunk) {
            return false;
        }
        if cursor
            .last_problem_at
            .is_some_and(|at| now - at < DISK_PROBLEM_REPEAT_SECS)
        {
            return false;
        }
        cursor.last_problem_at = Some(now);
        true
    }
}

fn read_range(path: &Path, start: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut chunk = Vec::new();
    file.take(len).read_to_end(&mut chunk)?;
    Ok(chunk)
}
