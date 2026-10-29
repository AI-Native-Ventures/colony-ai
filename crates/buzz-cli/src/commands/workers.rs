//! Agent-first commands for budgeted worker runs.
//!
//! A worker run is a one-shot model call with no tools, started by an
//! employee for research, drafts or variations. `spawn` writes a `running`
//! company record, launches `buzz-agent run-once`, and writes the ending
//! record. A `running` record whose deadline passed reads as failed, so a
//! crashed launcher never leaves a run looking alive.

use std::path::{Path, PathBuf};
use std::time::Duration;

use buzz_core::company_records::COMPANY_RECORD_SCHEMA_VERSION;
use buzz_core::company_workers::{
    truncate_worker_output, validate_worker_action, validate_worker_head, worker_d_tag,
    worker_effective_failure_reason, worker_effective_status, WorkerRun, WorkerRunAction,
    WorkerRunHead, WorkerStatus, MAX_WORKER_FAILURE_REASON_CHARS, MAX_WORKER_LABEL_CHARS,
    WORKER_DEADLINE_GRACE_SECS,
};
use buzz_core::kind::KIND_WORKER_RUN_HEAD;
use nostr::{Event, Kind};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::client::BuzzClient;
use crate::error::CliError;
use crate::WorkersCmd;

/// Most workers one employee may have running at once.
const MAX_RUNNING_WORKERS: usize = 5;
/// Largest `--max-output-tokens`.
const MAX_OUTPUT_TOKENS_LIMIT: u32 = 16_000;
/// Largest brief, in bytes.
const MAX_BRIEF_BYTES: usize = 65_536;
/// How many times an ending record is attempted before the error is reported.
const WRITE_ATTEMPTS: u32 = 3;
/// Seconds a slot file outlives its worker's deadline before it is pruned.
const SLOT_PRUNE_GRACE_SECS: i64 = 60;
/// Run folders older than this are removed when a new worker starts.
const RUN_DIR_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Most heads `list` reads.
const LIST_LIMIT: u32 = 200;

pub async fn dispatch(command: WorkersCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        WorkersCmd::Spawn {
            label,
            brief,
            brief_file,
            model,
            max_output_tokens,
            max_rounds,
            timeout_secs,
            wait,
        } => {
            let brief = read_brief(brief, brief_file)?;
            let args = SpawnArgs {
                label,
                brief,
                model,
                max_output_tokens,
                max_rounds,
                timeout_secs,
            };
            spawn(client, &args, wait).await
        }
        WorkersCmd::List { mine } => list(client, mine).await,
        WorkersCmd::Get { id } => get(client, &id).await,
        WorkersCmd::Cancel { id } => cancel(client, &id).await,
        WorkersCmd::Supervise { spec } => supervise_detached(client, Path::new(&spec)).await,
    }
}

// ── Arguments ────────────────────────────────────────────────────────────────

/// Validated inputs of `colony workers spawn`.
#[derive(Debug, Clone)]
pub(crate) struct SpawnArgs {
    pub label: String,
    pub brief: String,
    pub model: Option<String>,
    pub max_output_tokens: u32,
    pub max_rounds: u32,
    pub timeout_secs: u32,
}

impl SpawnArgs {
    pub(crate) fn validate(&self) -> Result<(), CliError> {
        let label = self.label.trim();
        if label.is_empty() || self.label.chars().count() > MAX_WORKER_LABEL_CHARS {
            return Err(CliError::Usage(format!(
                "--label must be 1 to {MAX_WORKER_LABEL_CHARS} characters"
            )));
        }
        if self.brief.trim().is_empty() {
            return Err(CliError::Usage("the brief is empty".into()));
        }
        if self.brief.len() > MAX_BRIEF_BYTES {
            return Err(CliError::Usage(format!(
                "the brief is {} bytes; at most {MAX_BRIEF_BYTES}",
                self.brief.len()
            )));
        }
        if self
            .model
            .as_deref()
            .is_some_and(|model| model.trim().is_empty() || model.chars().count() > 120)
        {
            return Err(CliError::Usage(
                "--model must be 1 to 120 characters".into(),
            ));
        }
        if self.max_output_tokens == 0 || self.max_output_tokens > MAX_OUTPUT_TOKENS_LIMIT {
            return Err(CliError::Usage(format!(
                "--max-output-tokens must be 1 to {MAX_OUTPUT_TOKENS_LIMIT}"
            )));
        }
        if !(1..=8).contains(&self.max_rounds) {
            return Err(CliError::Usage("--max-rounds must be 1 to 8".into()));
        }
        if !(30..=900).contains(&self.timeout_secs) {
            return Err(CliError::Usage("--timeout-secs must be 30 to 900".into()));
        }
        Ok(())
    }
}

fn read_brief(brief: Option<String>, brief_file: Option<String>) -> Result<String, CliError> {
    match (brief, brief_file) {
        (Some(_), Some(_)) => Err(CliError::Usage(
            "give --brief or --brief-file, not both".into(),
        )),
        (None, None) => Err(CliError::Usage("give --brief or --brief-file".into())),
        (Some(text), None) => Ok(text),
        (None, Some(path)) if path == "-" => {
            use std::io::Read;
            std::io::read_to_string(std::io::stdin().lock().take(MAX_BRIEF_BYTES as u64 + 1))
                .map_err(|error| CliError::Usage(format!("could not read the brief: {error}")))
        }
        (None, Some(path)) => std::fs::read_to_string(&path)
            .map_err(|error| CliError::Usage(format!("could not read {path}: {error}"))),
    }
}

// ── Local state ──────────────────────────────────────────────────────────────

/// Everything the supervising process needs, saved beside the brief.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkerSpec {
    pub run: WorkerRun,
    pub max_output_tokens: u32,
    pub max_rounds: u32,
    pub timeout_secs: u32,
    pub model_override: Option<String>,
    pub dir: PathBuf,
    pub slot: PathBuf,
}

/// Folder holding one employee's worker state.
fn worker_state_dir(parent_pubkey: &str) -> PathBuf {
    let root = std::env::var_os("COLONY_WORKERS_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let home = dirs::home_dir()?;
            [".colony", ".buzz"]
                .iter()
                .map(|name| home.join(name))
                .find(|path| path.is_dir())
                .map(|nest| nest.join("workers"))
        })
        .unwrap_or_else(|| std::env::temp_dir().join("colony-workers"));
    root.join(parent_pubkey)
}

/// One of an employee's running-worker slots. Dropping the guard frees it.
pub(crate) struct SlotGuard {
    path: Option<PathBuf>,
}

impl SlotGuard {
    /// Take over a slot file another process created.
    fn adopt(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }

    /// Leave the slot file in place for the supervising process to free.
    fn hand_over(mut self) {
        self.path = None;
    }
}

impl Drop for SlotGuard {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn count_slots(running_dir: &Path, now: i64, prune: bool) -> usize {
    let Ok(entries) = std::fs::read_dir(running_dir) else {
        return 0;
    };
    let mut live = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let deadline = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|value| value.get("deadlineAt").and_then(Value::as_i64));
        match deadline {
            Some(deadline) if deadline + SLOT_PRUNE_GRACE_SECS >= now => live += 1,
            _ if prune => {
                let _ = std::fs::remove_file(&path);
            }
            _ => {}
        }
    }
    live
}

fn acquire_slot(
    state_dir: &Path,
    worker_id: &str,
    deadline_at: i64,
    now: i64,
) -> Result<SlotGuard, CliError> {
    use std::io::Write;
    let running_dir = state_dir.join("running");
    std::fs::create_dir_all(&running_dir).map_err(local_error)?;
    let too_many = || {
        CliError::Usage(format!(
            "{MAX_RUNNING_WORKERS} workers are already running. Wait for one to finish or cancel one."
        ))
    };
    if count_slots(&running_dir, now, true) >= MAX_RUNNING_WORKERS {
        return Err(too_many());
    }
    let path = running_dir.join(format!("{worker_id}.json"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(local_error)?;
    file.write_all(json!({ "deadlineAt": deadline_at }).to_string().as_bytes())
        .map_err(local_error)?;
    let guard = SlotGuard { path: Some(path) };
    // Two starts can pass the first check together; the one that finds the
    // folder over its limit after claiming a slot gives it back.
    if count_slots(&running_dir, now, false) > MAX_RUNNING_WORKERS {
        return Err(too_many());
    }
    Ok(guard)
}

fn prune_old_runs(runs_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(runs_dir) else {
        return;
    };
    for entry in entries.flatten().take(1_000) {
        let age = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok());
        if age.is_some_and(|age| age > RUN_DIR_MAX_AGE) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn local_error(error: std::io::Error) -> CliError {
    CliError::Other(format!("worker state error: {error}"))
}

// ── Seams ────────────────────────────────────────────────────────────────────

/// Reads and writes worker records.
pub(crate) trait WorkerStore {
    /// The current head event id and head of one worker, if it exists.
    async fn head(&self, worker_id: &str) -> Result<Option<(String, WorkerRunHead)>, CliError>;
    /// Write one worker action.
    async fn write(&self, action: &WorkerRunAction) -> Result<(), CliError>;
}

/// What one launch of `buzz-agent run-once` needs.
pub(crate) struct LaunchRequest<'a> {
    pub prompt_file: &'a Path,
    pub output_file: &'a Path,
    pub max_rounds: u32,
    pub max_output_tokens: u32,
    pub timeout_secs: u32,
    pub model_override: Option<&'a str>,
}

/// The result line `buzz-agent run-once` prints.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct LaunchReport {
    pub status: String,
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
    #[serde(default)]
    pub error: Option<String>,
}

/// Runs the model call. `Err` is the reason the run could not complete.
pub(crate) trait WorkerLauncher {
    async fn launch(&self, request: &LaunchRequest<'_>) -> Result<LaunchReport, String>;
}

/// Delays used while supervising a run.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Timing {
    /// How often a running worker checks whether it was cancelled.
    pub poll: Duration,
    /// Base delay between attempts to write the ending record.
    pub retry: Duration,
}

impl Timing {
    pub(crate) const fn production() -> Self {
        Self {
            poll: Duration::from_secs(10),
            retry: Duration::from_secs(2),
        }
    }
}

// ── Start and supervise ──────────────────────────────────────────────────────

/// Claim a slot, save the brief and spec, and write the `running` record.
pub(crate) async fn start_worker<S: WorkerStore>(
    store: &S,
    state_dir: &Path,
    parent_pubkey: &str,
    args: &SpawnArgs,
    now: i64,
) -> Result<(WorkerSpec, SlotGuard), CliError> {
    args.validate()?;
    let worker_id = Uuid::new_v4().to_string();
    let deadline_at = now + i64::from(args.timeout_secs);
    let slot = acquire_slot(state_dir, &worker_id, deadline_at, now)?;
    let runs_dir = state_dir.join("runs");
    prune_old_runs(&runs_dir);
    let dir = runs_dir.join(&worker_id);
    std::fs::create_dir_all(&dir).map_err(local_error)?;

    let run = WorkerRun {
        worker_id: worker_id.clone(),
        parent_pubkey: parent_pubkey.to_owned(),
        label: args.label.trim().to_owned(),
        model: args
            .model
            .clone()
            .or_else(|| env_value("BUZZ_AGENT_MODEL"))
            .or_else(|| env_value("COLONY_CREDITS_MODEL"))
            .unwrap_or_else(|| "provider default".to_owned()),
        status: WorkerStatus::Running,
        started_at: now,
        deadline_at,
        finished_at: None,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: None,
        output_text: None,
        failure_reason: None,
    };
    let action = WorkerRunAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        run: run.clone(),
        expected_head_event_id: None,
    };
    validate_worker_action(&action)
        .map_err(|error| CliError::Usage(format!("invalid worker: {error}")))?;

    let spec = WorkerSpec {
        run,
        max_output_tokens: args.max_output_tokens,
        max_rounds: args.max_rounds,
        timeout_secs: args.timeout_secs,
        model_override: args.model.clone(),
        dir: dir.clone(),
        slot: slot_path(state_dir, &worker_id),
    };
    let saved = std::fs::write(dir.join("brief.txt"), &args.brief)
        .and_then(|()| std::fs::write(dir.join("spec.json"), serde_json::to_vec(&spec)?))
        .map_err(local_error);
    if let Err(error) = saved {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(error);
    }
    if let Err(error) = store.write(&action).await {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(error);
    }
    Ok((spec, slot))
}

fn slot_path(state_dir: &Path, worker_id: &str) -> PathBuf {
    state_dir.join("running").join(format!("{worker_id}.json"))
}

fn env_value(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Run the model call, then write the ending record. Returns the run as the
/// relay now holds it.
pub(crate) async fn supervise_worker<S: WorkerStore, L: WorkerLauncher>(
    store: &S,
    launcher: &L,
    spec: &WorkerSpec,
    clock: &dyn Fn() -> i64,
    timing: Timing,
) -> Result<WorkerRun, CliError> {
    let prompt_file = spec.dir.join("brief.txt");
    let output_file = spec.dir.join("output.txt");
    let request = LaunchRequest {
        prompt_file: &prompt_file,
        output_file: &output_file,
        max_rounds: spec.max_rounds,
        max_output_tokens: spec.max_output_tokens,
        timeout_secs: spec.timeout_secs,
        model_override: spec.model_override.as_deref(),
    };
    let launched = tokio::select! {
        result = launcher.launch(&request) => Some(result),
        () = wait_until_ended(store, &spec.run.worker_id, timing.poll) => None,
    };
    let Some(launched) = launched else {
        // Someone ended the run (cancel) while the model call was in flight.
        return match store.head(&spec.run.worker_id).await? {
            Some((_, head)) => Ok(head.run),
            None => Err(CliError::NotFound("worker record not found".into())),
        };
    };
    let ended = ended_run(&spec.run, launched, &output_file, clock());
    conclude(store, &spec.run.worker_id, ended, timing).await
}

/// Resolves once the worker's record is no longer `running`.
async fn wait_until_ended<S: WorkerStore>(store: &S, worker_id: &str, poll: Duration) {
    loop {
        tokio::time::sleep(poll).await;
        if let Ok(Some((_, head))) = store.head(worker_id).await {
            if head.run.status != WorkerStatus::Running {
                return;
            }
        }
    }
}

/// Turn a launch result into the record that ends the run.
fn ended_run(
    started: &WorkerRun,
    launched: Result<LaunchReport, String>,
    output_file: &Path,
    now: i64,
) -> WorkerRun {
    let mut run = started.clone();
    run.finished_at = Some(now.max(started.started_at));
    let fail = |run: &mut WorkerRun, reason: &str| {
        run.status = WorkerStatus::Failed;
        run.output_text = None;
        run.failure_reason = Some(clip_reason(reason));
    };
    match launched {
        Err(reason) => fail(&mut run, &reason),
        Ok(report) => {
            run.input_tokens = report.input_tokens;
            run.output_tokens = report.output_tokens;
            if report.status != "done" {
                let reason = report
                    .error
                    .unwrap_or_else(|| "The worker reported a failure without a reason.".into());
                fail(&mut run, &reason);
            } else {
                match std::fs::read_to_string(output_file) {
                    Ok(text) if !text.trim().is_empty() => {
                        run.status = WorkerStatus::Done;
                        run.output_text = Some(truncate_worker_output(
                            &text,
                            &output_file.display().to_string(),
                        ));
                    }
                    Ok(_) => fail(&mut run, "The worker returned no text."),
                    Err(error) => fail(
                        &mut run,
                        &format!("The worker's output could not be read: {error}"),
                    ),
                }
            }
        }
    }
    if run.status == WorkerStatus::Done
        && run
            .finished_at
            .is_some_and(|at| at > run.deadline_at + WORKER_DEADLINE_GRACE_SECS)
    {
        fail(&mut run, "The worker finished after its deadline.");
    }
    run
}

fn clip_reason(reason: &str) -> String {
    let reason = reason.trim();
    let reason = if reason.is_empty() {
        "The worker failed."
    } else {
        reason
    };
    reason
        .chars()
        .take(MAX_WORKER_FAILURE_REASON_CHARS)
        .collect()
}

/// Write the ending record against the current head, unless the run was
/// already ended by someone else. A failed write is retried, then reported:
/// the record stays `running` and readers show it failed after its deadline.
async fn conclude<S: WorkerStore>(
    store: &S,
    worker_id: &str,
    ended: WorkerRun,
    timing: Timing,
) -> Result<WorkerRun, CliError> {
    let mut last_error = CliError::Other("the worker's ending record was not written".into());
    for attempt in 0..WRITE_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(timing.retry * 3u32.pow(attempt - 1)).await;
        }
        let (head_id, head) = match store.head(worker_id).await {
            Ok(Some(found)) => found,
            Ok(None) => return Err(CliError::NotFound("worker record not found".into())),
            Err(error) => {
                last_error = error;
                continue;
            }
        };
        if head.run.status != WorkerStatus::Running {
            return Ok(head.run);
        }
        let action = WorkerRunAction {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            run: ended.clone(),
            expected_head_event_id: Some(head_id),
        };
        match store.write(&action).await {
            Ok(()) => return Ok(ended),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

// ── Production seams ─────────────────────────────────────────────────────────

struct RelayStore<'a> {
    client: &'a BuzzClient,
}

impl WorkerStore for RelayStore<'_> {
    async fn head(&self, worker_id: &str) -> Result<Option<(String, WorkerRunHead)>, CliError> {
        let d_tag = worker_d_tag(worker_id)
            .map_err(|error| CliError::Usage(format!("invalid worker id: {error}")))?;
        let relay = relay_self(self.client).await?;
        let filter = json!({
            "kinds": [KIND_WORKER_RUN_HEAD],
            "authors": [relay],
            "#d": [d_tag],
        });
        let mut events = self.client.query_paginated(filter, 2).await?;
        if events.len() > 1 {
            return Err(CliError::Other(
                "relay returned duplicate worker heads".into(),
            ));
        }
        match events.pop() {
            None => Ok(None),
            Some(raw) => {
                let (event_id, head) = parse_head(raw, &relay)?;
                if head.run.worker_id != worker_id {
                    return Err(CliError::Other(
                        "worker head does not match its d-tag".into(),
                    ));
                }
                Ok(Some((event_id, head)))
            }
        }
    }

    async fn write(&self, action: &WorkerRunAction) -> Result<(), CliError> {
        let builder = buzz_sdk::company_workers::build_worker_run_action(action)
            .map_err(crate::validate::sdk_err)?;
        let event = self.client.sign_event(builder)?;
        let response = self.client.submit_event(event).await?;
        crate::commands::parse_write_response(&response, "worker run changed before it was written")
            .map(|_| ())
    }
}

struct ProcessLauncher;

impl WorkerLauncher for ProcessLauncher {
    async fn launch(&self, request: &LaunchRequest<'_>) -> Result<LaunchReport, String> {
        let binary = agent_binary();
        let mut command = tokio::process::Command::new(&binary);
        command
            .arg("run-once")
            .arg("--prompt-file")
            .arg(request.prompt_file)
            .arg("--output-file")
            .arg(request.output_file)
            .arg("--max-rounds")
            .arg(request.max_rounds.to_string())
            .arg("--max-output-tokens")
            .arg(request.max_output_tokens.to_string())
            .arg("--timeout-secs")
            .arg(request.timeout_secs.to_string())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(model) = request.model_override {
            command.env("BUZZ_AGENT_MODEL", model);
        }
        let child = command.spawn().map_err(|error| {
            format!(
                "The worker process could not start ({}): {error}",
                binary.display()
            )
        })?;
        let grace = Duration::from_secs(u64::from(request.timeout_secs) + 10);
        let output = match tokio::time::timeout(grace, child.wait_with_output()).await {
            Err(_) => {
                return Err(format!(
                    "The worker did not finish within {} seconds.",
                    request.timeout_secs
                ))
            }
            Ok(Err(error)) => return Err(format!("The worker process failed: {error}")),
            Ok(Ok(output)) => output,
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(report) = stdout
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .and_then(|line| serde_json::from_str::<LaunchReport>(line).ok())
        {
            return Ok(report);
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .trim()
            .chars()
            .rev()
            .take(300)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .filter(|c| !c.is_control() || *c == '\n')
            .collect();
        Err(format!(
            "The worker exited ({}) without a result. {}",
            output.status, tail
        ))
    }
}

/// The `buzz-agent` next to this program, or the one on PATH. The sibling is
/// found by name, not by resolving links: `buzz-agent` may be a multicall link
/// whose name picks its personality.
fn agent_binary() -> PathBuf {
    if let Some(path) = std::env::var_os("COLONY_WORKER_AGENT_BIN").filter(|v| !v.is_empty()) {
        return PathBuf::from(path);
    }
    // The shell tool runs this program through a symlink in a temporary shim
    // folder, so the real folder is the one that holds `buzz-agent`.
    let invoked = std::env::args_os().next().map(PathBuf::from);
    let exe = std::env::current_exe().ok();
    let resolved = exe
        .as_ref()
        .and_then(|path| std::fs::canonicalize(path).ok());
    for candidate in [invoked, exe, resolved].into_iter().flatten() {
        if let Some(dir) = candidate.parent() {
            for name in ["buzz-agent", "buzz-agent.exe"] {
                let sibling = dir.join(name);
                if sibling.is_file() {
                    return sibling;
                }
            }
        }
    }
    PathBuf::from("buzz-agent")
}

/// Start `colony workers supervise` detached from this process.
fn detach_supervisor(spec_path: &Path) -> Result<(), String> {
    let program = std::env::args_os()
        .next()
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .ok_or_else(|| "The worker could not find its own program.".to_owned())?;
    let mut command = std::process::Command::new(program);
    command
        .args(["workers", "supervise", "--spec"])
        .arg(spec_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NO_WINDOW
        command.creation_flags(0x0000_0008 | 0x0800_0000);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("The worker could not be started in the background: {error}"))
}

// ── Commands ─────────────────────────────────────────────────────────────────

async fn spawn(client: &BuzzClient, args: &SpawnArgs, wait: bool) -> Result<(), CliError> {
    let store = RelayStore { client };
    let parent = client.keys().public_key().to_hex();
    let state_dir = worker_state_dir(&parent);
    let (spec, slot) = start_worker(&store, &state_dir, &parent, args, now()).await?;
    let worker_id = spec.run.worker_id.clone();

    if wait {
        let result =
            supervise_worker(&store, &ProcessLauncher, &spec, &now, Timing::production()).await;
        drop(slot);
        let run = result?;
        println!("{}", run_summary(&worker_id, &run, true));
        return Ok(());
    }

    match detach_supervisor(&spec.dir.join("spec.json")) {
        Ok(()) => {
            slot.hand_over();
            println!(
                "{}",
                json!({
                    "accepted": true,
                    "worker_id": worker_id,
                    "status": WorkerStatus::Running,
                    "deadline_at": spec.run.deadline_at,
                })
            );
            Ok(())
        }
        Err(reason) => {
            // The record already says running; end it now with the reason.
            let ended = ended_run(&spec.run, Err(reason.clone()), &spec.dir, now());
            drop(slot);
            conclude(&store, &worker_id, ended, Timing::production()).await?;
            Err(CliError::Other(reason))
        }
    }
}

async fn supervise_detached(client: &BuzzClient, spec_path: &Path) -> Result<(), CliError> {
    let text = std::fs::read_to_string(spec_path).map_err(local_error)?;
    let spec: WorkerSpec = serde_json::from_str(&text)
        .map_err(|error| CliError::Usage(format!("invalid worker spec: {error}")))?;
    let slot = SlotGuard::adopt(spec.slot.clone());
    let store = RelayStore { client };
    let result =
        supervise_worker(&store, &ProcessLauncher, &spec, &now, Timing::production()).await;
    drop(slot);
    match result {
        Ok(_) => Ok(()),
        Err(error) => {
            // Nobody is reading this process's output; leave the reason on disk.
            let _ = std::fs::write(spec.dir.join("supervisor-error.txt"), error.to_string());
            Err(error)
        }
    }
}

async fn list(client: &BuzzClient, mine: bool) -> Result<(), CliError> {
    let relay = relay_self(client).await?;
    let mut filter = json!({
        "kinds": [KIND_WORKER_RUN_HEAD],
        "authors": [relay.clone()],
    });
    if mine {
        filter["#p"] = json!([client.keys().public_key().to_hex()]);
    }
    let events = client.query_paginated(filter, LIST_LIMIT).await?;
    let now = now();
    let mut heads = events
        .into_iter()
        .map(|raw| parse_head(raw, &relay))
        .collect::<Result<Vec<_>, CliError>>()?;
    heads.sort_by(|a, b| b.1.run.started_at.cmp(&a.1.run.started_at));
    let workers: Vec<Value> = heads
        .iter()
        .map(|(event_id, head)| worker_view(event_id, head, now, false))
        .collect();
    println!("{}", json!({ "workers": workers }));
    Ok(())
}

async fn get(client: &BuzzClient, id: &str) -> Result<(), CliError> {
    let store = RelayStore { client };
    let worker_id = parse_worker_id(id)?;
    let (event_id, head) = store
        .head(&worker_id)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("worker {worker_id} not found")))?;
    println!("{}", worker_view(&event_id, &head, now(), true));
    Ok(())
}

async fn cancel(client: &BuzzClient, id: &str) -> Result<(), CliError> {
    let store = RelayStore { client };
    let worker_id = parse_worker_id(id)?;
    let (head_id, head) = store
        .head(&worker_id)
        .await?
        .ok_or_else(|| CliError::NotFound(format!("worker {worker_id} not found")))?;
    if head.run.status != WorkerStatus::Running {
        return Err(CliError::Conflict("worker run already ended".into()));
    }
    let mut run = head.run.clone();
    run.status = WorkerStatus::Cancelled;
    run.finished_at = Some(now().max(run.started_at));
    let action = WorkerRunAction {
        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
        run: run.clone(),
        expected_head_event_id: Some(head_id),
    };
    store.write(&action).await?;
    println!("{}", run_summary(&worker_id, &run, false));
    Ok(())
}

// ── Output and relay reads ───────────────────────────────────────────────────

fn parse_worker_id(value: &str) -> Result<String, CliError> {
    let id = Uuid::parse_str(value.trim())
        .map_err(|_| CliError::Usage(format!("invalid worker id: {value}")))?;
    Ok(id.hyphenated().to_string())
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn run_summary(worker_id: &str, run: &WorkerRun, with_output: bool) -> Value {
    let mut value = json!({
        "accepted": true,
        "worker_id": worker_id,
        "status": run.status,
        "finished_at": run.finished_at,
        "input_tokens": run.input_tokens,
        "output_tokens": run.output_tokens,
        "failure_reason": run.failure_reason,
    });
    if with_output {
        value["output_text"] = json!(run.output_text);
    }
    value
}

fn worker_view(event_id: &str, head: &WorkerRunHead, now: i64, with_output: bool) -> Value {
    let run = &head.run;
    let mut value = json!({
        "event_id": event_id,
        "worker_id": run.worker_id,
        "parent_pubkey": run.parent_pubkey,
        "label": run.label,
        "model": run.model,
        "status": worker_effective_status(run, now),
        "started_at": run.started_at,
        "deadline_at": run.deadline_at,
        "finished_at": run.finished_at,
        "input_tokens": run.input_tokens,
        "output_tokens": run.output_tokens,
        "cost_usd": run.cost_usd,
        "failure_reason": worker_effective_failure_reason(run, now),
    });
    if with_output {
        value["output_text"] = json!(run.output_text);
    } else {
        value["has_output"] = json!(run.output_text.is_some());
    }
    value
}

fn parse_head(raw: Value, relay_self: &str) -> Result<(String, WorkerRunHead), CliError> {
    let event = serde_json::from_value::<Event>(raw)
        .map_err(|error| CliError::Other(format!("worker head is malformed: {error}")))?;
    if event.kind != Kind::Custom(KIND_WORKER_RUN_HEAD as u16)
        || event.pubkey.to_hex() != relay_self
    {
        return Err(CliError::Other(
            "worker head has an unexpected kind or author".into(),
        ));
    }
    event
        .verify()
        .map_err(|error| CliError::Other(format!("worker head signature is invalid: {error}")))?;
    let head = serde_json::from_str::<WorkerRunHead>(&event.content)
        .map_err(|error| CliError::Other(format!("worker head content is invalid: {error}")))?;
    validate_worker_head(&head)
        .map_err(|error| CliError::Other(format!("worker head is invalid: {error}")))?;
    let d_tag = worker_d_tag(&head.run.worker_id)
        .map_err(|error| CliError::Other(format!("worker head id is invalid: {error}")))?;
    let tag_matches = event
        .tags
        .iter()
        .any(|tag| tag.kind().to_string() == "d" && tag.content() == Some(d_tag.as_str()));
    if !tag_matches {
        return Err(CliError::Other(
            "worker head tags do not match its worker id".into(),
        ));
    }
    Ok((event.id.to_hex(), head))
}

async fn relay_self(client: &BuzzClient) -> Result<String, CliError> {
    let raw = client.get_public("/").await?;
    let nip11: Value = serde_json::from_str(&raw)
        .map_err(|error| CliError::Other(format!("relay info is not valid JSON: {error}")))?;
    let value = nip11
        .get("self")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::Other("relay info document is missing self".into()))?;
    nostr::PublicKey::from_hex(value)
        .map(|pubkey| pubkey.to_hex())
        .map_err(|_| CliError::Other("relay self key is invalid".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    const PARENT: &str = "ab";

    fn parent() -> String {
        PARENT.repeat(32)
    }

    fn args() -> SpawnArgs {
        SpawnArgs {
            label: "Research: Melville guesthouses".into(),
            brief: "List ten guesthouses in Melville.".into(),
            model: None,
            max_output_tokens: 4_000,
            max_rounds: 4,
            timeout_secs: 600,
        }
    }

    /// An in-memory relay that, like the real one, refuses a write whose
    /// expected head is not the current head and never rewrites an ended run.
    #[derive(Default)]
    struct FakeStore {
        heads: Mutex<HashMap<String, (String, WorkerRunHead)>>,
        writes: Mutex<Vec<WorkerRunAction>>,
        counter: Mutex<u64>,
        fail_writes: Mutex<u32>,
    }

    impl FakeStore {
        fn set_status(&self, worker_id: &str, status: WorkerStatus) {
            let mut heads = self.heads.lock().unwrap();
            let entry = heads.get_mut(worker_id).expect("head exists");
            entry.1.run.status = status;
            entry.1.run.finished_at = Some(entry.1.run.started_at + 5);
        }
    }

    impl WorkerStore for FakeStore {
        async fn head(&self, worker_id: &str) -> Result<Option<(String, WorkerRunHead)>, CliError> {
            Ok(self.heads.lock().unwrap().get(worker_id).cloned())
        }

        async fn write(&self, action: &WorkerRunAction) -> Result<(), CliError> {
            validate_worker_action(action).expect("the CLI only writes valid actions");
            {
                let mut failures = self.fail_writes.lock().unwrap();
                if *failures > 0 {
                    *failures -= 1;
                    return Err(CliError::Other("relay unavailable".into()));
                }
            }
            let mut heads = self.heads.lock().unwrap();
            let current = heads.get(&action.run.worker_id);
            let current_id = current.map(|(id, _)| id.as_str());
            if action.expected_head_event_id.as_deref() != current_id {
                return Err(CliError::Conflict("worker run changed".into()));
            }
            if current.is_some_and(|(_, head)| head.run.status != WorkerStatus::Running) {
                return Err(CliError::Conflict("worker run already ended".into()));
            }
            let mut counter = self.counter.lock().unwrap();
            *counter += 1;
            let event_id = format!("{:064x}", *counter);
            heads.insert(
                action.run.worker_id.clone(),
                (
                    event_id.clone(),
                    WorkerRunHead {
                        schema_version: COMPANY_RECORD_SCHEMA_VERSION,
                        run: action.run.clone(),
                        updated_by_pubkey: parent(),
                        updated_at: 1,
                        source_action_event_id: event_id,
                    },
                ),
            );
            self.writes.lock().unwrap().push(action.clone());
            Ok(())
        }
    }

    enum Script {
        Done {
            text: &'static str,
            input: u64,
            output: u64,
        },
        Fail(&'static str),
        Report(&'static str, &'static str),
        Hang,
    }

    struct FakeLauncher(Script);

    impl WorkerLauncher for FakeLauncher {
        async fn launch(&self, request: &LaunchRequest<'_>) -> Result<LaunchReport, String> {
            match &self.0 {
                Script::Done {
                    text,
                    input,
                    output,
                } => {
                    std::fs::write(request.output_file, text).unwrap();
                    Ok(LaunchReport {
                        status: "done".into(),
                        input_tokens: *input,
                        output_tokens: *output,
                        error: None,
                    })
                }
                Script::Fail(reason) => Err((*reason).to_owned()),
                Script::Report(status, error) => Ok(LaunchReport {
                    status: (*status).to_owned(),
                    input_tokens: 10,
                    output_tokens: 0,
                    error: Some((*error).to_owned()),
                }),
                Script::Hang => std::future::pending().await,
            }
        }
    }

    fn timing() -> Timing {
        Timing {
            poll: Duration::from_millis(20),
            retry: Duration::from_millis(1),
        }
    }

    #[tokio::test]
    async fn spawn_records_running_then_done() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .expect("start");
        {
            let writes = store.writes.lock().unwrap();
            assert_eq!(writes.len(), 1);
            assert_eq!(writes[0].run.status, WorkerStatus::Running);
            assert_eq!(writes[0].expected_head_event_id, None);
            assert_eq!(writes[0].run.deadline_at, 1_600);
        }
        assert_eq!(
            std::fs::read_to_string(spec.dir.join("brief.txt")).unwrap(),
            "List ten guesthouses in Melville."
        );

        let launcher = FakeLauncher(Script::Done {
            text: "Ten guesthouses.",
            input: 800,
            output: 300,
        });
        let run = supervise_worker(&store, &launcher, &spec, &|| 1_100, timing())
            .await
            .expect("supervise");
        assert_eq!(run.status, WorkerStatus::Done);
        assert_eq!(run.output_text.as_deref(), Some("Ten guesthouses."));
        assert_eq!((run.input_tokens, run.output_tokens), (800, 300));

        let writes = store.writes.lock().unwrap();
        assert_eq!(writes.len(), 2);
        assert_eq!(writes[1].run.status, WorkerStatus::Done);
        assert_eq!(writes[1].run.finished_at, Some(1_100));
        assert_eq!(
            writes[1].expected_head_event_id.as_deref(),
            Some(format!("{:064x}", 1).as_str()),
            "the ending record must name the head the running record produced"
        );
    }

    #[tokio::test]
    async fn spawn_crash_records_failed_with_reason() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        let launcher = FakeLauncher(Script::Fail(
            "The worker exited (exit status: 101) without a result.",
        ));
        let run = supervise_worker(&store, &launcher, &spec, &|| 1_050, timing())
            .await
            .unwrap();
        assert_eq!(run.status, WorkerStatus::Failed);
        assert!(run
            .failure_reason
            .as_deref()
            .is_some_and(|reason| reason.contains("exit status: 101")));
        assert_eq!(run.output_text, None);
        let head = store
            .heads
            .lock()
            .unwrap()
            .get(&run.worker_id)
            .cloned()
            .unwrap();
        assert_eq!(head.1.run.status, WorkerStatus::Failed);
    }

    #[tokio::test]
    async fn a_reported_failure_and_an_empty_answer_both_end_failed() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        let launcher = FakeLauncher(Script::Report("failed", "llm: rate limited"));
        let run = supervise_worker(&store, &launcher, &spec, &|| 1_050, timing())
            .await
            .unwrap();
        assert_eq!(run.status, WorkerStatus::Failed);
        assert_eq!(run.failure_reason.as_deref(), Some("llm: rate limited"));
        assert_eq!(run.input_tokens, 10);

        let (spec, _slot2) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        let launcher = FakeLauncher(Script::Done {
            text: "  \n",
            input: 1,
            output: 1,
        });
        let run = supervise_worker(&store, &launcher, &spec, &|| 1_050, timing())
            .await
            .unwrap();
        assert_eq!(run.status, WorkerStatus::Failed);
        assert_eq!(
            run.failure_reason.as_deref(),
            Some("The worker returned no text.")
        );
    }

    #[tokio::test]
    async fn a_run_that_finishes_after_its_deadline_ends_failed() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        let launcher = FakeLauncher(Script::Done {
            text: "Too late.",
            input: 1,
            output: 1,
        });
        let late = 1_600 + WORKER_DEADLINE_GRACE_SECS + 1;
        let run = supervise_worker(&store, &launcher, &spec, &|| late, timing())
            .await
            .unwrap();
        assert_eq!(run.status, WorkerStatus::Failed);
        assert_eq!(
            run.failure_reason.as_deref(),
            Some("The worker finished after its deadline.")
        );
    }

    #[tokio::test]
    async fn long_output_is_cut_with_the_path_of_the_full_text() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        let big: &'static str = Box::leak("word ".repeat(10_000).into_boxed_str());
        let launcher = FakeLauncher(Script::Done {
            text: big,
            input: 1,
            output: 1,
        });
        let run = supervise_worker(&store, &launcher, &spec, &|| 1_050, timing())
            .await
            .unwrap();
        let text = run.output_text.expect("output");
        assert!(text.len() <= buzz_core::company_workers::MAX_WORKER_OUTPUT_BYTES);
        assert!(text.contains("[output cut, full text in "));
        assert!(text.contains("output.txt"));
        assert_eq!(
            std::fs::read_to_string(spec.dir.join("output.txt")).unwrap(),
            big
        );
    }

    #[tokio::test]
    async fn spawn_rejects_sixth_concurrent_worker() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let mut started = Vec::new();
        for _ in 0..MAX_RUNNING_WORKERS {
            started.push(
                start_worker(&store, state.path(), &parent(), &args(), 1_000)
                    .await
                    .expect("within the limit"),
            );
        }
        let error = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .map(|_| ())
            .expect_err("the sixth worker is refused");
        assert!(matches!(&error, CliError::Usage(message) if message.contains("5 workers")));
        assert_eq!(
            store.writes.lock().unwrap().len(),
            MAX_RUNNING_WORKERS,
            "a refused worker writes no record"
        );

        // A finished worker frees its slot.
        drop(started.pop());
        start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .expect("a slot is free again");
    }

    #[tokio::test]
    async fn a_worker_past_its_deadline_no_longer_holds_a_slot() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let mut started = Vec::new();
        for _ in 0..MAX_RUNNING_WORKERS {
            started.push(
                start_worker(&store, state.path(), &parent(), &args(), 1_000)
                    .await
                    .unwrap(),
            );
        }
        // Their supervisors died: slot files stay, but their deadlines passed.
        for (_, slot) in started.drain(..) {
            slot.hand_over();
        }
        start_worker(&store, state.path(), &parent(), &args(), 5_000)
            .await
            .expect("stale slots are pruned");
    }

    #[tokio::test]
    async fn max_output_tokens_over_16000_is_refused() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let mut too_many = args();
        too_many.max_output_tokens = MAX_OUTPUT_TOKENS_LIMIT + 1;
        assert!(too_many.validate().is_err());
        let error = start_worker(&store, state.path(), &parent(), &too_many, 1_000)
            .await
            .map(|_| ())
            .expect_err("refused");
        assert!(matches!(error, CliError::Usage(_)));
        assert!(store.writes.lock().unwrap().is_empty());
        let mut at_limit = args();
        at_limit.max_output_tokens = MAX_OUTPUT_TOKENS_LIMIT;
        assert!(at_limit.validate().is_ok());
    }

    #[test]
    fn the_other_budgets_are_bounded_too() {
        let mut bad = args();
        bad.timeout_secs = 901;
        assert!(bad.validate().is_err());
        bad.timeout_secs = 29;
        assert!(bad.validate().is_err());
        let mut bad = args();
        bad.max_rounds = 9;
        assert!(bad.validate().is_err());
        let mut bad = args();
        bad.brief = "   ".into();
        assert!(bad.validate().is_err());
        let mut bad = args();
        bad.label = "x".repeat(MAX_WORKER_LABEL_CHARS + 1);
        assert!(bad.validate().is_err());
    }

    #[tokio::test]
    async fn a_cancelled_run_is_not_overwritten_when_the_model_call_finishes() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        store.set_status(&spec.run.worker_id, WorkerStatus::Cancelled);
        let launcher = FakeLauncher(Script::Done {
            text: "Answer nobody wants.",
            input: 1,
            output: 1,
        });
        let run = supervise_worker(&store, &launcher, &spec, &|| 1_050, timing())
            .await
            .unwrap();
        assert_eq!(run.status, WorkerStatus::Cancelled);
        assert_eq!(
            store.writes.lock().unwrap().len(),
            1,
            "only the running record"
        );
    }

    #[tokio::test]
    async fn cancelling_stops_a_model_call_that_is_still_running() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        store.set_status(&spec.run.worker_id, WorkerStatus::Cancelled);
        let run = tokio::time::timeout(
            Duration::from_secs(5),
            supervise_worker(
                &store,
                &FakeLauncher(Script::Hang),
                &spec,
                &|| 1_050,
                timing(),
            ),
        )
        .await
        .expect("the supervisor notices the cancel")
        .unwrap();
        assert_eq!(run.status, WorkerStatus::Cancelled);
    }

    #[tokio::test]
    async fn a_failed_ending_write_is_retried_then_reported() {
        let state = tempfile::tempdir().unwrap();
        let store = FakeStore::default();
        let (spec, _slot) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        let launcher = FakeLauncher(Script::Done {
            text: "Fine.",
            input: 1,
            output: 1,
        });

        *store.fail_writes.lock().unwrap() = 1;
        let run = supervise_worker(&store, &launcher, &spec, &|| 1_050, timing())
            .await
            .expect("one failure is retried");
        assert_eq!(run.status, WorkerStatus::Done);

        let (spec, _slot2) = start_worker(&store, state.path(), &parent(), &args(), 1_000)
            .await
            .unwrap();
        *store.fail_writes.lock().unwrap() = WRITE_ATTEMPTS;
        let error = supervise_worker(&store, &launcher, &spec, &|| 1_050, timing())
            .await
            .expect_err("a relay that never answers is an error, not a silent success");
        assert!(error.to_string().contains("relay unavailable"));
        let head = store
            .heads
            .lock()
            .unwrap()
            .get(&spec.run.worker_id)
            .cloned()
            .unwrap();
        assert_eq!(head.1.run.status, WorkerStatus::Running);
    }

    #[test]
    fn list_views_show_a_stale_running_worker_as_failed() {
        let run = WorkerRun {
            worker_id: Uuid::new_v4().to_string(),
            parent_pubkey: parent(),
            label: "Research".into(),
            model: "colony-credits".into(),
            status: WorkerStatus::Running,
            started_at: 1_000,
            deadline_at: 1_600,
            finished_at: None,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: None,
            output_text: None,
            failure_reason: None,
        };
        let head = WorkerRunHead {
            schema_version: COMPANY_RECORD_SCHEMA_VERSION,
            run,
            updated_by_pubkey: parent(),
            updated_at: 1_000,
            source_action_event_id: "cd".repeat(32),
        };
        let fresh = worker_view(&"ef".repeat(32), &head, 1_500, false);
        assert_eq!(fresh["status"], "running");
        let stale = worker_view(&"ef".repeat(32), &head, 1_601, false);
        assert_eq!(stale["status"], "failed");
        assert!(stale["failure_reason"].as_str().is_some());
    }

    #[test]
    fn brief_needs_exactly_one_source() {
        assert!(read_brief(None, None).is_err());
        assert!(read_brief(Some("a".into()), Some("b".into())).is_err());
        assert_eq!(read_brief(Some("hello".into()), None).unwrap(), "hello");
    }
}
