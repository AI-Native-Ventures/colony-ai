//! Durable Factory runs owned by the native host rather than renderer panes.

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State};
use tokio::sync::{broadcast, Semaphore};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

mod store;
use store::*;

const EVENT_NAME: &str = "factory-run-event";
const MAX_CONCURRENT_SESSIONS: usize = 30;
const MAX_QUEUED_RUNS: i64 = 30;
const MAX_PROMPT_BYTES: usize = 64 * 1024;
const MAX_DRAFT_BYTES: usize = 1024 * 1024;
const MAX_EVENT_BYTES: usize = 64 * 1024;
const MAX_TRANSCRIPT_BYTES: i64 = 8 * 1024 * 1024;
const MAX_FACTORY_STORAGE_BYTES: i64 = 128 * 1024 * 1024;
const MAX_FACTORY_PAYLOAD_BYTES: i64 = 120 * 1024 * 1024;
const MAX_RETAINED_TERMINAL_RUNS: i64 = 100;
const MAX_STORED_RUNS: i64 = 200;
const EVENT_STORAGE_OVERHEAD_BYTES: i64 = 160;
const RUN_STORAGE_OVERHEAD_BYTES: i64 = 512;
const MAX_EVENTS_PER_SNAPSHOT: i64 = 1000;
const EVENT_BUFFER: usize = 256;
const MAX_ATTACHMENTS: usize = 256;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FactoryRunStatus {
    Queued,
    Running,
    Waiting,
    Blocked,
    Error,
    Done,
    Cancelled,
}

impl FactoryRunStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Waiting => "waiting",
            Self::Blocked => "blocked",
            Self::Error => "error",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
        }
    }

    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "waiting" => Ok(Self::Waiting),
            "blocked" => Ok(Self::Blocked),
            "error" => Ok(Self::Error),
            "done" => Ok(Self::Done),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(format!("unknown Factory run status: {value}")),
        }
    }

    fn is_terminal(self) -> bool {
        matches!(self, Self::Error | Self::Done | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryRun {
    pub id: String,
    pub project_id: Option<String>,
    pub repository_id: Option<String>,
    pub checkout_path: String,
    pub agent_id: String,
    pub harness_id: String,
    pub parent_run_id: Option<String>,
    pub status: FactoryRunStatus,
    pub created_at: String,
    pub updated_at: String,
    pub acp_session_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryRunEvent {
    pub sequence: i64,
    pub run_id: String,
    pub created_at: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryRunSnapshot {
    pub run: FactoryRun,
    pub events: Vec<FactoryRunEvent>,
    pub draft: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryRunCreateInput {
    pub operation_key: String,
    pub project_id: Option<String>,
    pub repository_id: Option<String>,
    pub checkout_path: String,
    pub agent_id: String,
    pub parent_run_id: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryRunDraftInput {
    pub run_id: String,
    pub draft: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryRunDraft {
    pub run_id: String,
    pub draft: String,
    pub updated_at: String,
}

#[derive(Clone)]
struct RunControl {
    cancel: CancellationToken,
    events: broadcast::Sender<FactoryRunEvent>,
}

pub(crate) struct FactoryRuntime {
    controls: Arc<Mutex<HashMap<String, RunControl>>>,
    attachments: Arc<Mutex<HashMap<String, CancellationToken>>>,
    permits: Arc<Semaphore>,
}

impl FactoryRuntime {
    fn register(&self, run_id: &str) -> Result<RunControl, String> {
        let mut controls = self.controls.lock().map_err(|error| error.to_string())?;
        if controls.len() >= MAX_CONCURRENT_SESSIONS as usize + MAX_QUEUED_RUNS as usize {
            return Err("Factory run queue is full".to_string());
        }
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        let control = RunControl {
            cancel: CancellationToken::new(),
            events,
        };
        controls.insert(run_id.to_string(), control.clone());
        Ok(control)
    }

    fn control(&self, run_id: &str) -> Result<Option<RunControl>, String> {
        Ok(self
            .controls
            .lock()
            .map_err(|error| error.to_string())?
            .get(run_id)
            .cloned())
    }

    fn attach_if_live(
        &self,
        subscription_id: &str,
        run_id: &str,
    ) -> Result<Option<(CancellationToken, broadcast::Receiver<FactoryRunEvent>)>, String> {
        let Some(control) = self.control(run_id)? else {
            return Ok(None);
        };
        let mut attachments = self.attachments.lock().map_err(|error| error.to_string())?;
        if attachments.contains_key(subscription_id) {
            return Err("Factory subscription id is already in use".to_string());
        }
        if attachments.len() >= MAX_ATTACHMENTS {
            return Err("Factory event subscriber limit reached".to_string());
        }
        let token = CancellationToken::new();
        attachments.insert(subscription_id.to_string(), token.clone());
        Ok(Some((token, control.events.subscribe())))
    }

    fn detach(&self, subscription_id: &str) -> Result<bool, String> {
        let token = self
            .attachments
            .lock()
            .map_err(|error| error.to_string())?
            .remove(subscription_id);
        if let Some(token) = token {
            token.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn remove_control_from_handle(
        controls: &Arc<Mutex<HashMap<String, RunControl>>>,
        run_id: &str,
    ) {
        if let Ok(mut controls) = controls.lock() {
            controls.remove(run_id);
        }
    }
}

impl Default for FactoryRuntime {
    fn default() -> Self {
        Self {
            controls: Arc::new(Mutex::new(HashMap::new())),
            attachments: Arc::new(Mutex::new(HashMap::new())),
            permits: Arc::new(Semaphore::new(MAX_CONCURRENT_SESSIONS)),
        }
    }
}

#[derive(Debug)]
struct RawRun {
    id: String,
    project_id: Option<String>,
    repository_id: Option<String>,
    checkout_path: String,
    agent_id: String,
    harness_id: String,
    parent_run_id: Option<String>,
    status: String,
    created_at: String,
    updated_at: String,
    acp_session_id: Option<String>,
    error: Option<String>,
}

impl TryFrom<RawRun> for FactoryRun {
    type Error = String;

    fn try_from(raw: RawRun) -> Result<Self, Self::Error> {
        Ok(Self {
            id: raw.id,
            project_id: raw.project_id,
            repository_id: raw.repository_id,
            checkout_path: raw.checkout_path,
            agent_id: raw.agent_id,
            harness_id: raw.harness_id,
            parent_run_id: raw.parent_run_id,
            status: FactoryRunStatus::parse(&raw.status)?,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            acp_session_id: raw.acp_session_id,
            error: raw.error,
        })
    }
}

fn app_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join("factory");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create Factory data directory: {error}"))?;
    Ok(directory.join("runs.sqlite3"))
}

fn publish(app: &AppHandle, control: Option<&RunControl>, event: &FactoryRunEvent) {
    if let Some(control) = control {
        let _ = control.events.send(event.clone());
    }
    // The persisted cursor is authoritative; an unavailable renderer can reattach later.
    let _ = app.emit(EVENT_NAME, event);
}

fn validate_optional_id(name: &str, value: Option<&str>) -> Result<(), String> {
    if value.is_some_and(|value| value.trim().is_empty() || value.len() > 128) {
        return Err(format!("invalid {name}"));
    }
    Ok(())
}

fn canonical_checkout(path: &str) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    if !requested.is_absolute() {
        return Err("Factory checkout path must be absolute".to_string());
    }
    let canonical = requested
        .canonicalize()
        .map_err(|error| format!("Factory checkout is unavailable: {error}"))?;
    if !canonical.is_dir() {
        return Err("Factory checkout path is not a directory".to_string());
    }
    Ok(canonical)
}

struct RunLaunchConfig {
    command: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
    system_prompt: Option<String>,
    cwd: PathBuf,
}

fn resolve_launch(
    app: &AppHandle,
    agent_id: &str,
    checkout: &Path,
) -> Result<(String, String, RunLaunchConfig), String> {
    let records = crate::managed_agents::storage::load_factory_agent_records(app)?;
    let record = records
        .iter()
        .find(|record| record.pubkey.eq_ignore_ascii_case(agent_id))
        .ok_or_else(|| "Factory agent was not found".to_string())?;
    if !matches!(record.backend, crate::managed_agents::BackendKind::Local) {
        return Err("Factory runs currently require a local ACP agent".to_string());
    }
    let personas = crate::managed_agents::load_factory_personas(app)?;
    let global = crate::managed_agents::load_global_agent_config(app)?;
    let effective = crate::managed_agents::effective_config::resolve_effective_config(
        record, &personas, &global,
    )
    .require_resolved()?;
    let descriptor =
        crate::managed_agents::resolve_effective_harness_descriptor(record, &personas, &global)?;
    let command = crate::managed_agents::resolve_command(&descriptor.command)
        .ok_or_else(|| "Factory ACP harness executable is unavailable".to_string())?
        .display()
        .to_string();
    let env = descriptor.env.into_iter().collect();
    let harness_id = record
        .runtime
        .as_deref()
        .or_else(|| {
            record.persona_id.as_deref().and_then(|persona_id| {
                personas
                    .iter()
                    .find(|persona| persona.id == persona_id)
                    .and_then(|persona| persona.runtime.as_deref())
            })
        })
        .unwrap_or(&descriptor.command)
        .to_string();
    Ok((
        record.pubkey.clone(),
        harness_id,
        RunLaunchConfig {
            command,
            args: descriptor.args,
            env,
            system_prompt: effective.system_prompt.value,
            cwd: checkout.to_path_buf(),
        },
    ))
}

fn compact_update(update: &serde_json::Value) -> serde_json::Value {
    let text = serde_json::to_string(update).unwrap_or_default();
    if text.len() <= MAX_EVENT_BYTES {
        return update.clone();
    }
    let mut compact = serde_json::json!({
        "sessionUpdate": update.get("sessionUpdate").and_then(serde_json::Value::as_str),
        "truncated": true,
    });
    if let Some(content) = update
        .get("content")
        .and_then(|value| value.get("text"))
        .and_then(serde_json::Value::as_str)
    {
        let safe_text = truncate_utf8(content, MAX_EVENT_BYTES / 2);
        compact["content"] = serde_json::json!({ "text": safe_text });
    }
    compact
}

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    let mut end = value.len().min(max_bytes);
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    &value[..end]
}

async fn capture_event(
    path: &Path,
    run_id: &str,
    observer_event: buzz_acp::ObserverEvent,
) -> Result<Option<FactoryRunEvent>, String> {
    if observer_event.kind != "acp_read" {
        return Ok(None);
    }
    let message = observer_event.payload;
    if message.get("method").and_then(serde_json::Value::as_str) != Some("session/update") {
        return Ok(None);
    }
    let Some(update) = message
        .get("params")
        .and_then(|params| params.get("update"))
    else {
        return Ok(None);
    };
    let kind = update
        .get("sessionUpdate")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    if !matches!(
        kind,
        "agent_message_chunk"
            | "tool_call"
            | "tool_call_update"
            | "plan"
            | "available_commands_update"
            | "current_mode_update"
            | "config_option_update"
    ) {
        return Ok(None);
    }
    let payload = compact_update(update);
    for attempt in 0..3 {
        match store_append_event(path, run_id, kind, &payload) {
            Ok(event) => return Ok(event),
            Err(error) if attempt < 2 => {
                tokio::time::sleep(Duration::from_millis(40 * (attempt + 1))).await;
                eprintln!("colony-desktop: retrying Factory transcript persistence: {error}");
            }
            Err(error) => return Err(error),
        }
    }
    Ok(None)
}

async fn capture_observer_stream<F>(
    mut observer_rx: broadcast::Receiver<buzz_acp::ObserverEvent>,
    path: PathBuf,
    run_id: String,
    mut publish_event: F,
) -> Result<(), String>
where
    F: FnMut(FactoryRunEvent),
{
    loop {
        let event = match observer_rx.recv().await {
            Ok(event) => event,
            Err(broadcast::error::RecvError::Closed) => return Ok(()),
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                let error = format!("Factory transcript observer lagged by {skipped} events");
                if let Ok(Some(marker)) = store_append_capture_marker(&path, &run_id, &error) {
                    publish_event(marker);
                }
                return Err(error);
            }
        };
        match capture_event(&path, &run_id, event).await {
            Ok(Some(event)) => publish_event(event),
            Ok(None) => {}
            Err(error) => {
                if let Ok(Some(marker)) = store_append_capture_marker(&path, &run_id, &error) {
                    publish_event(marker);
                }
                return Err(error);
            }
        }
    }
}

type RunFinish = (FactoryRunStatus, Option<&'static str>);

fn finish_status_after_capture(prompt_status: RunFinish, capture: Result<(), String>) -> RunFinish {
    match capture {
        Ok(()) => prompt_status,
        Err(_) => (
            FactoryRunStatus::Error,
            Some("Factory output capture stopped unexpectedly"),
        ),
    }
}

async fn retry_queued_start<F, T>(mut persist: F, cancel: CancellationToken) -> Option<T>
where
    F: FnMut() -> Result<Option<T>, String>,
{
    let mut attempt = 0_u32;
    loop {
        if cancel.is_cancelled() {
            return None;
        }
        match persist() {
            Ok(value) => return value,
            Err(error) => {
                if attempt < 3 || attempt.is_power_of_two() {
                    eprintln!("colony-desktop: retrying Factory run start persistence: {error}");
                }
                let delay_ms = 40_u64
                    .saturating_mul(2_u64.saturating_pow(attempt.min(7)))
                    .min(5_000);
                attempt = attempt.saturating_add(1);
                tokio::select! {
                    _ = cancel.cancelled() => return None,
                    _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                }
            }
        }
    }
}

async fn run_worker(
    app: AppHandle,
    path: PathBuf,
    run: FactoryRun,
    prompt: String,
    launch: RunLaunchConfig,
    control: RunControl,
    permits: Arc<Semaphore>,
    controls: Arc<Mutex<HashMap<String, RunControl>>>,
) {
    let permit = tokio::select! {
        _ = control.cancel.cancelled() => None,
        result = permits.acquire_owned() => result.ok(),
    };
    let Some(_permit) = permit else {
        FactoryRuntime::remove_control_from_handle(&controls, &run.id);
        return;
    };
    let transition = retry_queued_start(
        || {
            store_transition(
                &path,
                &run.id,
                Some(FactoryRunStatus::Queued),
                FactoryRunStatus::Running,
                None,
            )
        },
        control.cancel.clone(),
    )
    .await;
    let Some((_running, event)) = transition else {
        FactoryRuntime::remove_control_from_handle(&controls, &run.id);
        return;
    };
    publish(&app, Some(&control), &event);

    if control.cancel.is_cancelled() {
        FactoryRuntime::remove_control_from_handle(&controls, &run.id);
        return;
    }
    let mut client =
        match buzz_acp::AcpClient::spawn(&launch.command, &launch.args, &launch.env, false).await {
            Ok(client) => client,
            Err(_) => {
                finish_run(
                    &app,
                    &path,
                    &run.id,
                    Some(&control),
                    FactoryRunStatus::Error,
                    Some("ACP process could not start"),
                );
                FactoryRuntime::remove_control_from_handle(&controls, &run.id);
                return;
            }
        };
    let observer = buzz_acp::ObserverHandle::in_process();
    let observer_rx = observer.subscribe();
    client.set_observer(Some(observer.clone()), 0);
    let event_path = path.clone();
    let event_app = app.clone();
    let event_control = control.clone();
    let event_run_id = run.id.clone();
    let (storage_error_tx, mut storage_error_rx) = tokio::sync::oneshot::channel();
    let event_task = tokio::spawn(async move {
        let result = capture_observer_stream(observer_rx, event_path, event_run_id, |event| {
            publish(&event_app, Some(&event_control), &event);
        })
        .await;
        if let Err(error) = &result {
            let _ = storage_error_tx.send(error.clone());
        }
        result
    });

    let initialized = tokio::select! {
        _ = control.cancel.cancelled() => None,
        result = client.initialize() => Some(result),
    };
    let Some(initialized) = initialized else {
        client.set_observer(None, 0);
        drop(observer);
        let _ = event_task.await;
        client.shutdown().await;
        FactoryRuntime::remove_control_from_handle(&controls, &run.id);
        return;
    };
    let capabilities = match initialized {
        Ok(value) => value,
        Err(_) => {
            client.set_observer(None, 0);
            drop(observer);
            let _ = event_task.await;
            client.shutdown().await;
            finish_run(
                &app,
                &path,
                &run.id,
                Some(&control),
                FactoryRunStatus::Error,
                Some("ACP initialization failed"),
            );
            FactoryRuntime::remove_control_from_handle(&controls, &run.id);
            return;
        }
    };
    let protocol_version = capabilities
        .get("protocolVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1) as u32;
    let agent_name = capabilities
        .pointer("/agentInfo/name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let system_prompt = launch.system_prompt.as_deref();
    let transport = if agent_name == "goose" {
        None
    } else if agent_name == "buzz-pi-acp" {
        system_prompt.map(buzz_acp::SystemPromptTransport::PiMeta)
    } else if agent_name == "@agentclientprotocol/claude-agent-acp" {
        system_prompt.map(buzz_acp::SystemPromptTransport::ClaudeMeta)
    } else if protocol_version >= 2 {
        system_prompt.map(buzz_acp::SystemPromptTransport::Field)
    } else {
        None
    };
    let instruction_in_task = transport.is_none();
    let cwd = launch.cwd.to_string_lossy().into_owned();
    let session_title = format!("Factory {}", &run.id[..8]);
    let session = tokio::select! {
        _ = control.cancel.cancelled() => None,
        result = client.session_new_full(
            &cwd,
            Vec::new(),
            transport,
            Some(&session_title),
        ) => Some(result),
    };
    let Some(session) = session else {
        client.set_observer(None, 0);
        drop(observer);
        let _ = event_task.await;
        client.shutdown().await;
        FactoryRuntime::remove_control_from_handle(&controls, &run.id);
        return;
    };
    let session = match session {
        Ok(session) => session,
        Err(_) => {
            client.set_observer(None, 0);
            drop(observer);
            let _ = event_task.await;
            client.shutdown().await;
            finish_run(
                &app,
                &path,
                &run.id,
                Some(&control),
                FactoryRunStatus::Error,
                Some("ACP session could not be created"),
            );
            FactoryRuntime::remove_control_from_handle(&controls, &run.id);
            return;
        }
    };
    if let Err(error) = store_set_acp_session(&path, &run.id, &session.session_id) {
        let _ = error;
        client.set_observer(None, 0);
        drop(observer);
        let _ = event_task.await;
        client.shutdown().await;
        finish_run(
            &app,
            &path,
            &run.id,
            Some(&control),
            FactoryRunStatus::Error,
            Some("Factory session checkpoint could not be saved"),
        );
        FactoryRuntime::remove_control_from_handle(&controls, &run.id);
        return;
    }
    client.set_observer_context(buzz_acp::ObserverContext {
        session_id: Some(session.session_id.clone()),
        ..Default::default()
    });
    let mut instruction_in_task = instruction_in_task;
    if agent_name == "goose" {
        if let Some(prompt_text) = system_prompt {
            instruction_in_task = client
                .session_set_goose_system_prompt(&session.session_id, prompt_text)
                .await
                .is_err();
        }
    }
    let prompt = if instruction_in_task {
        match system_prompt {
            Some(instructions) if !instructions.trim().is_empty() => {
                format!("Agent instructions:\n{instructions}\n\nTask:\n{prompt}")
            }
            _ => prompt,
        }
    } else {
        prompt
    };

    enum PromptExit {
        Completed(Result<buzz_acp::StopReason, buzz_acp::AcpError>),
        Cancelled,
        OutputPersistenceFailed,
    }
    let result = tokio::select! {
        result = client.session_prompt_with_idle_timeout(
            &session.session_id,
            &prompt,
            Duration::from_secs(300),
            Duration::from_secs(3600),
        ) => PromptExit::Completed(result),
        _ = control.cancel.cancelled() => PromptExit::Cancelled,
        _ = &mut storage_error_rx => PromptExit::OutputPersistenceFailed,
    };
    let status = match result {
        PromptExit::Completed(Ok(buzz_acp::StopReason::EndTurn)) => (FactoryRunStatus::Done, None),
        PromptExit::Completed(Ok(buzz_acp::StopReason::Cancelled)) => {
            (FactoryRunStatus::Cancelled, None)
        }
        PromptExit::Completed(Ok(_)) => (FactoryRunStatus::Done, None),
        PromptExit::Completed(Err(_)) => {
            (FactoryRunStatus::Error, Some("ACP run ended with an error"))
        }
        PromptExit::Cancelled => {
            let _ = client
                .cancel_with_cleanup_grace(&session.session_id, Duration::from_secs(5))
                .await;
            (FactoryRunStatus::Cancelled, None)
        }
        PromptExit::OutputPersistenceFailed => {
            client.shutdown().await;
            (
                FactoryRunStatus::Error,
                Some("Factory output could not be persisted"),
            )
        }
    };
    client.set_observer(None, 0);
    drop(observer);
    let drained = event_task.await;
    client.shutdown().await;
    let capture_result =
        drained.unwrap_or_else(|_| Err("Factory capture task panicked".to_string()));
    let final_status = finish_status_after_capture(status, capture_result);
    finish_run(
        &app,
        &path,
        &run.id,
        Some(&control),
        final_status.0,
        final_status.1,
    );
    FactoryRuntime::remove_control_from_handle(&controls, &run.id);
}

fn finish_run(
    app: &AppHandle,
    path: &Path,
    run_id: &str,
    control: Option<&RunControl>,
    status: FactoryRunStatus,
    error: Option<&str>,
) {
    for attempt in 0..3 {
        match store_transition(path, run_id, None, status, error) {
            Ok(Some((_run, event))) => {
                publish(app, control, &event);
                return;
            }
            Ok(None) => return,
            Err(failure) if attempt < 2 => {
                eprintln!(
                    "colony-desktop: retrying Factory run final status persistence: {failure}"
                );
                std::thread::sleep(Duration::from_millis(40 * (attempt + 1)));
            }
            Err(failure) => {
                eprintln!(
                    "colony-desktop: Factory run final status remains recoverable: {failure}"
                );
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn factory_run_create(
    input: FactoryRunCreateInput,
    app: AppHandle,
    runtime: State<'_, FactoryRuntime>,
) -> Result<FactoryRun, String> {
    if input.prompt.trim().is_empty() || input.prompt.len() > MAX_PROMPT_BYTES {
        return Err("Factory prompt must be non-empty and no longer than 64 KiB".to_string());
    }
    if input.operation_key.trim().is_empty() || input.operation_key.len() > 128 {
        return Err(
            "Factory operation key must be non-empty and no longer than 128 bytes".to_string(),
        );
    }
    validate_optional_id("project id", input.project_id.as_deref())?;
    validate_optional_id("repository id", input.repository_id.as_deref())?;
    let checkout = canonical_checkout(&input.checkout_path)?;
    let parent_run_id = input
        .parent_run_id
        .as_deref()
        .map(|value| Uuid::parse_str(value).map(|id| id.to_string()))
        .transpose()
        .map_err(|_| "invalid parent Factory run id".to_string())?;
    let requested_agent_id = input.agent_id.trim().to_string();
    let request_hash = create_request_hash(
        input.project_id.as_deref(),
        input.repository_id.as_deref(),
        &checkout.to_string_lossy(),
        &requested_agent_id,
        parent_run_id.as_deref(),
        &input.prompt,
    )?;
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    if let Some(existing) = store_find_operation(&path, &input.operation_key, &request_hash)? {
        return Ok(existing);
    }
    let (agent_id, harness_id, launch) = resolve_launch(&app, &requested_agent_id, &checkout)?;
    let id = Uuid::new_v4().to_string();
    let created = store_create(
        &path,
        &id,
        &input.operation_key,
        &request_hash,
        input.project_id.as_deref(),
        input.repository_id.as_deref(),
        &checkout.to_string_lossy(),
        &agent_id,
        &harness_id,
        parent_run_id.as_deref(),
        &input.prompt,
    );
    let created = created?;
    let prompt = input.prompt;
    schedule_new_store_create(created, |run, events| {
        let control = match runtime.register(&run.id) {
            Ok(control) => control,
            Err(error) => {
                finish_run(
                    &app,
                    &path,
                    &run.id,
                    None,
                    FactoryRunStatus::Error,
                    Some("Factory run could not be scheduled"),
                );
                return Err(error);
            }
        };
        for event in events {
            publish(&app, Some(&control), &event);
        }
        tauri::async_runtime::spawn(run_worker(
            app.clone(),
            path.clone(),
            run.clone(),
            prompt,
            launch,
            control,
            Arc::clone(&runtime.permits),
            Arc::clone(&runtime.controls),
        ));
        Ok(())
    })
}

#[tauri::command]
pub(crate) fn factory_run_list(app: AppHandle) -> Result<Vec<FactoryRun>, String> {
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    store_list(&path)
}

#[tauri::command]
pub(crate) fn factory_run_snapshot(
    run_id: String,
    after_sequence: Option<i64>,
    app: AppHandle,
) -> Result<FactoryRunSnapshot, String> {
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    store_snapshot(&path, &run_id, after_sequence.unwrap_or(0).max(0))
}

#[tauri::command]
pub(crate) fn factory_run_reattach(
    run_id: String,
    after_sequence: Option<i64>,
    subscription_id: String,
    on_event: Channel<FactoryRunEvent>,
    app: AppHandle,
    runtime: State<'_, FactoryRuntime>,
) -> Result<FactoryRunSnapshot, String> {
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let subscription_id = Uuid::parse_str(&subscription_id)
        .map_err(|_| "invalid Factory event subscription id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    let after_sequence = after_sequence.unwrap_or(0).max(0);
    let live = runtime.attach_if_live(&subscription_id, &run_id)?;
    let snapshot = match store_snapshot(&path, &run_id, after_sequence) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            if live.is_some() {
                let _ = runtime.detach(&subscription_id);
            }
            return Err(error);
        }
    };
    if let Some((cancel, mut receiver)) = live {
        let attachments = Arc::clone(&runtime.attachments);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    event = receiver.recv() => match event {
                        Ok(event) if event.sequence > after_sequence => {
                            if on_event.send(event).is_err() {
                                break;
                            }
                        }
                        Ok(_) => {}
                        Err(broadcast::error::RecvError::Lagged(_)) => {
                            let notice = FactoryRunEvent {
                                sequence: -1,
                                run_id: run_id.clone(),
                                created_at: now_iso(),
                                kind: "resync_required".to_string(),
                                payload: serde_json::json!({ "reason": "event stream lagged" }),
                            };
                            let _ = on_event.send(notice);
                            break;
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
            if let Ok(mut attachments) = attachments.lock() {
                attachments.remove(&subscription_id);
            }
        });
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn factory_run_detach(
    subscription_id: String,
    runtime: State<'_, FactoryRuntime>,
) -> Result<bool, String> {
    let subscription_id = Uuid::parse_str(&subscription_id)
        .map_err(|_| "invalid Factory event subscription id".to_string())?
        .to_string();
    runtime.detach(&subscription_id)
}

#[tauri::command]
pub(crate) fn factory_run_cancel(
    run_id: String,
    app: AppHandle,
    runtime: State<'_, FactoryRuntime>,
) -> Result<FactoryRun, String> {
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    let Some((run, event)) =
        store_transition(&path, &run_id, None, FactoryRunStatus::Cancelled, None)?
    else {
        return store_snapshot(&path, &run_id, 0).map(|snapshot| snapshot.run);
    };
    let control = runtime.control(&run_id)?;
    if let Some(control) = &control {
        control.cancel.cancel();
    }
    publish(&app, control.as_ref(), &event);
    Ok(run)
}

#[tauri::command]
pub(crate) fn factory_run_set_draft(
    input: FactoryRunDraftInput,
    app: AppHandle,
) -> Result<FactoryRunDraft, String> {
    let run_id = Uuid::parse_str(&input.run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    store_set_draft(&app_db_path(&app)?, &run_id, &input.draft)
}

#[tauri::command]
pub(crate) fn factory_run_get_draft(
    run_id: String,
    app: AppHandle,
) -> Result<Option<FactoryRunDraft>, String> {
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    store_get_draft(&app_db_path(&app)?, &run_id)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests;
