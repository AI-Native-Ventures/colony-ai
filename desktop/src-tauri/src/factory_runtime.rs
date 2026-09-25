//! Durable Factory runs owned by the native host rather than renderer panes.

use std::{
    collections::HashMap,
    fs,
    future::Future,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
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
const FACTORY_MEMBERSHIP_TTL: Duration = Duration::from_secs(30);
const MAX_MEMBERSHIP_CACHE_ENTRIES: usize = 512;

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

/// Native-owned authorization scope for persisted Factory runs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryScope {
    pub relay_url: String,
    pub identity_pubkey: String,
    pub business_community_id: String,
    pub client_channel_id: Option<String>,
}

impl FactoryScope {
    fn db_values(&self) -> (&str, &str, &str, &str) {
        (
            &self.relay_url,
            &self.identity_pubkey,
            &self.business_community_id,
            self.client_channel_id.as_deref().unwrap_or(""),
        )
    }

    fn membership_key(&self) -> Option<FactoryMembershipKey> {
        self.client_channel_id
            .as_ref()
            .map(|channel_id| FactoryMembershipKey {
                relay_url: self.relay_url.clone(),
                identity_pubkey: self.identity_pubkey.clone(),
                channel_id: channel_id.clone(),
            })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct FactoryMembershipKey {
    relay_url: String,
    identity_pubkey: String,
    channel_id: String,
}

#[derive(Debug, Deserialize)]
struct FactoryBusinessMembershipResponse {
    owner_pubkey: String,
    communities: Vec<FactoryBusinessMembership>,
}

#[derive(Debug, Deserialize)]
struct FactoryBusinessMembership {
    id: String,
}

fn response_contains_business_membership(
    response: &FactoryBusinessMembershipResponse,
    identity_pubkey: &str,
    business_community_id: &str,
) -> bool {
    response.owner_pubkey.eq_ignore_ascii_case(identity_pubkey)
        && response
            .communities
            .iter()
            .any(|community| community.id == business_community_id)
}

#[derive(Clone)]
struct MembershipCache {
    entries: Arc<Mutex<HashMap<FactoryMembershipKey, (Instant, bool)>>>,
    generations: Arc<Mutex<HashMap<FactoryMembershipKey, u64>>>,
    next_generation: Arc<AtomicU64>,
}

impl MembershipCache {
    async fn verify_with<F, Fut>(
        &self,
        key: FactoryMembershipKey,
        force_refresh: bool,
        now: Instant,
        verify: F,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<bool, String>>,
    {
        if !force_refresh {
            if let Some((_, is_member)) = self
                .entries
                .lock()
                .map_err(|error| error.to_string())?
                .get(&key)
                .copied()
                .filter(|(expires_at, _)| *expires_at > now)
            {
                return Ok(is_member);
            }
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        {
            let mut generations = self.generations.lock().map_err(|error| error.to_string())?;
            generations.insert(key.clone(), generation);
            self.entries
                .lock()
                .map_err(|error| error.to_string())?
                .remove(&key);
        }

        let is_member = match verify().await {
            Ok(is_member) => is_member,
            Err(error) => {
                let mut generations = self
                    .generations
                    .lock()
                    .map_err(|failure| failure.to_string())?;
                if generations.get(&key) == Some(&generation) {
                    generations.remove(&key);
                }
                return Err(error);
            }
        };
        let mut generations = self.generations.lock().map_err(|error| error.to_string())?;
        if generations.get(&key) != Some(&generation) {
            return Err("Factory membership verification was superseded".to_string());
        }
        let mut entries = self.entries.lock().map_err(|error| error.to_string())?;
        entries.retain(|_, (expires_at, _)| *expires_at > now);
        if entries.len() >= MAX_MEMBERSHIP_CACHE_ENTRIES {
            entries.clear();
        }
        entries.insert(key.clone(), (now + FACTORY_MEMBERSHIP_TTL, is_member));
        generations.remove(&key);
        Ok(is_member)
    }

    async fn verify_for_bind<F, Fut>(
        &self,
        key: FactoryMembershipKey,
        now: Instant,
        verify: F,
    ) -> Result<bool, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<bool, String>>,
    {
        self.verify_with(key, true, now, verify).await
    }

    fn has_fresh_membership(&self, scope: &FactoryScope, now: Instant) -> bool {
        let Some(key) = scope.membership_key() else {
            return true;
        };
        self.entries
            .lock()
            .ok()
            .and_then(|entries| entries.get(&key).copied())
            .is_some_and(|(expires_at, is_member)| expires_at > now && is_member)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryRun {
    pub id: String,
    pub scope: FactoryScope,
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
    pub scope: FactoryScope,
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
    scope: FactoryScope,
}

struct ScopedAttachment {
    cancel: CancellationToken,
    scope: FactoryScope,
}

#[derive(Clone)]
struct FactoryEventAuthority {
    active_scope: Arc<Mutex<Option<FactoryScope>>>,
    memberships: MembershipCache,
}

impl FactoryEventAuthority {
    fn is_active(&self, scope: &FactoryScope) -> bool {
        self.active_scope
            .lock()
            .ok()
            .is_some_and(|active| active.as_ref() == Some(scope))
            && self.memberships.has_fresh_membership(scope, Instant::now())
    }

    fn while_active(&self, scope: &FactoryScope, send: impl FnOnce()) -> bool {
        let Ok(active) = self.active_scope.lock() else {
            return false;
        };
        if active.as_ref() != Some(scope)
            || !self.memberships.has_fresh_membership(scope, Instant::now())
        {
            return false;
        }
        send();
        true
    }
}

fn native_scope_is_current(app: &AppHandle, scope: &FactoryScope) -> bool {
    let state = app.state::<crate::app_state::AppState>();
    let Ok(keys) = state.signing_keys() else {
        return false;
    };
    crate::relay::relay_ws_url_with_override(&state) == scope.relay_url
        && keys
            .public_key()
            .to_hex()
            .eq_ignore_ascii_case(&scope.identity_pubkey)
}

/// Clear Factory access while the serialized native workspace switch applies.
pub(crate) fn clear_workspace_scope(app: &AppHandle) -> Result<(), String> {
    app.state::<FactoryRuntime>().activate_scope(None)
}

/// Bind Factory to the relay and identity already installed by `apply_workspace`.
/// A renderer cannot bind a scope by calling a Factory command or supplying an
/// identity. Optional client channels are proved through an authenticated
/// native NIP-42 query before the scope becomes active.
pub(crate) async fn bind_workspace_scope(
    app: &AppHandle,
    requested_relay_url: &str,
    business_community_id: Option<String>,
    client_channel_id: Option<String>,
) -> Result<(), String> {
    let runtime = app.state::<FactoryRuntime>();
    runtime.activate_scope(None)?;
    let state = app.state::<crate::app_state::AppState>();
    let relay_url = crate::relay::relay_ws_url_with_override(&state);
    if relay_url != requested_relay_url {
        return Err("Factory workspace relay changed during context binding".to_string());
    }
    let keys = state.signing_keys()?;
    let Some(business_community_id) = business_community_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        if client_channel_id.is_some() {
            return Err("client channel requires an active business workspace".to_string());
        }
        return Ok(());
    };
    if business_community_id.len() > 128 {
        return Err("invalid business community id".to_string());
    }
    let client_channel_id = client_channel_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if client_channel_id
        .as_ref()
        .is_some_and(|value| value.len() > 128)
    {
        return Err("invalid client channel id".to_string());
    }
    let scope = FactoryScope {
        relay_url,
        identity_pubkey: keys.public_key().to_hex(),
        business_community_id,
        client_channel_id,
    };
    verify_business_community_membership(
        &state,
        &scope.identity_pubkey,
        &scope.business_community_id,
    )
    .await?;
    verify_client_channel_membership(&state, app, &runtime, &scope, keys, true).await?;
    if !native_scope_is_current(app, &scope) {
        runtime.activate_scope(None)?;
        return Err(
            "Factory workspace relay or identity changed during context binding".to_string(),
        );
    }
    runtime.activate_scope(Some(scope))
}

async fn verify_business_community_membership(
    state: &crate::app_state::AppState,
    identity_pubkey: &str,
    business_community_id: &str,
) -> Result<(), String> {
    let response: FactoryBusinessMembershipResponse =
        crate::relay::get_relay_json(state, "/api/communities/mine?scope=member").await?;
    if !response_contains_business_membership(&response, identity_pubkey, business_community_id) {
        return Err("current identity is not a member of the business community".to_string());
    }
    Ok(())
}

async fn verify_client_channel_membership(
    state: &crate::app_state::AppState,
    app: &AppHandle,
    runtime: &FactoryRuntime,
    scope: &FactoryScope,
    keys: nostr::Keys,
    force_refresh: bool,
) -> Result<(), String> {
    if scope.client_channel_id.is_none() {
        return Ok(());
    }
    let native_relay_client = app.state::<crate::native_relay_client::NativeRelayClient>();
    let verify = || async {
        let relay_pubkey = crate::commands::fetch_relay_self_at(state, &scope.relay_url)
            .await?
            .ok_or_else(|| "relay does not advertise a signing identity".to_string())?;
        let expected_relay_pubkey = relay_pubkey.clone();
        let channel_id = scope.client_channel_id.clone().unwrap_or_default();
        let session = native_relay_client
            .session(scope.relay_url.clone(), keys)
            .await;
        let events = session
            .fetch_events(
                serde_json::json!({
                    "authors": [relay_pubkey],
                    "kinds": [39002],
                    "#d": [channel_id],
                    "limit": 1
                }),
                Duration::from_secs(10),
            )
            .await?;
        let pubkey = scope.identity_pubkey.to_ascii_lowercase();
        let verified = tauri::async_runtime::spawn_blocking(move || {
            events.into_iter().any(|event| {
                event.kind == nostr::Kind::Custom(39002)
                    && event.verify().is_ok()
                    && event
                        .pubkey
                        .to_hex()
                        .eq_ignore_ascii_case(&expected_relay_pubkey)
                    && event.tags.iter().any(|tag| {
                        let values = tag.as_slice();
                        values.first().is_some_and(|name| name == "d")
                            && values.get(1).is_some_and(|value| value == &channel_id)
                    })
                    && event.tags.iter().any(|tag| {
                        let values = tag.as_slice();
                        values.first().is_some_and(|name| name == "p")
                            && values
                                .get(1)
                                .is_some_and(|member| member.eq_ignore_ascii_case(&pubkey))
                    })
            })
        })
        .await
        .map_err(|error| format!("Factory membership verification failed: {error}"))?;
        Ok(verified)
    };
    verify_cached_client_membership(runtime, scope, force_refresh, verify).await
}

async fn verify_cached_client_membership<F, Fut>(
    runtime: &FactoryRuntime,
    scope: &FactoryScope,
    force_refresh: bool,
    verify: F,
) -> Result<(), String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<bool, String>>,
{
    let Some(key) = scope.membership_key() else {
        return Ok(());
    };
    let now = Instant::now();
    let is_member = if force_refresh {
        runtime
            .memberships
            .verify_for_bind(key, now, verify)
            .await?
    } else {
        runtime
            .memberships
            .verify_with(key, false, now, verify)
            .await?
    };
    if !is_member {
        let active = runtime
            .active_scope
            .lock()
            .map_err(|error| error.to_string())?;
        let scope_is_active = active.as_ref() == Some(scope);
        drop(active);
        if scope_is_active {
            runtime.activate_scope(None)?;
        }
        return Err("current identity is not a member of the client channel".to_string());
    }
    Ok(())
}

async fn require_factory_scope(
    state: &crate::app_state::AppState,
    app: &AppHandle,
    runtime: &FactoryRuntime,
    force_membership_refresh: bool,
) -> Result<FactoryScope, String> {
    let scope = runtime.active_scope()?;
    if !native_scope_is_current(app, &scope) {
        runtime.activate_scope(None)?;
        return Err("Factory workspace scope no longer matches the native identity".to_string());
    }
    if scope.client_channel_id.is_some() {
        let keys = state.signing_keys()?;
        if let Err(error) = verify_client_channel_membership(
            state,
            app,
            runtime,
            &scope,
            keys,
            force_membership_refresh,
        )
        .await
        {
            if error.contains("not a member") {
                runtime.activate_scope(None)?;
            }
            return Err(error);
        }
    }
    if !runtime.event_authority().is_active(&scope) || !native_scope_is_current(app, &scope) {
        return Err("Factory workspace scope changed during authorization".to_string());
    }
    Ok(scope)
}

fn parse_coordinate(value: &str, allowed_kinds: &[u16]) -> Result<(u16, String, String), String> {
    let mut parts = value.splitn(3, ':');
    let kind = parts
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|kind| allowed_kinds.contains(kind))
        .ok_or_else(|| "invalid Factory project or repository address".to_string())?;
    let owner = parts
        .next()
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "invalid Factory project or repository owner".to_string())?
        .to_ascii_lowercase();
    let d_tag = parts
        .next()
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or_else(|| "invalid Factory project or repository d tag".to_string())?
        .to_string();
    Ok((kind, owner, d_tag))
}

fn event_matches_coordinate(event: &nostr::Event, kind: u16, owner: &str, d_tag: &str) -> bool {
    event.kind == nostr::Kind::Custom(kind)
        && event.pubkey.to_hex().eq_ignore_ascii_case(owner)
        && event.verify().is_ok()
        && event.tags.iter().any(|tag| {
            let values = tag.as_slice();
            values.first().is_some_and(|name| name == "d")
                && values.get(1).is_some_and(|value| value == d_tag)
        })
}

fn project_lists_repository(project: &nostr::Event, repository_address: &str) -> bool {
    project.tags.iter().any(|tag| {
        let values = tag.as_slice();
        values.first().is_some_and(|name| name == "a")
            && values
                .get(1)
                .is_some_and(|value| value == repository_address)
    })
}

fn event_channel(event: &nostr::Event) -> Option<&str> {
    event.tags.iter().find_map(|tag| {
        let values = tag.as_slice();
        (values.first().is_some_and(|name| name == "buzz-channel"))
            .then(|| values.get(1).map(String::as_str))
            .flatten()
    })
}

fn client_scope_contains_announcements(
    scope: &FactoryScope,
    project: Option<&nostr::Event>,
    repository: Option<&nostr::Event>,
) -> bool {
    let Some(channel_id) = scope.client_channel_id.as_deref() else {
        return true;
    };
    project.is_none_or(|event| event_channel(event) == Some(channel_id))
        && repository.is_none_or(|event| event_channel(event) == Some(channel_id))
}

async fn fetch_verified_coordinate(
    session: &crate::native_relay_client::SessionLease,
    kind: u16,
    owner: &str,
    d_tag: &str,
) -> Result<nostr::Event, String> {
    let owner = owner.to_string();
    let d_tag = d_tag.to_string();
    let events = session
        .fetch_events(
            serde_json::json!({
                "authors": [owner],
                "kinds": [kind],
                "#d": [d_tag],
                "limit": 1
            }),
            Duration::from_secs(10),
        )
        .await?;
    tauri::async_runtime::spawn_blocking(move || {
        events
            .into_iter()
            .find(|event| event_matches_coordinate(event, kind, &owner, &d_tag))
            .ok_or_else(|| {
                "Factory project or repository was not found on the active relay".to_string()
            })
    })
    .await
    .map_err(|error| format!("Factory project verification failed: {error}"))?
}

async fn validate_project_repository_scope(
    scope: &FactoryScope,
    input: &FactoryRunCreateInput,
    app: &AppHandle,
    keys: nostr::Keys,
) -> Result<(), String> {
    if input.project_id.is_none() && input.repository_id.is_none() {
        return Ok(());
    }
    let native_relay_client = app.state::<crate::native_relay_client::NativeRelayClient>();
    let session = native_relay_client
        .session(scope.relay_url.clone(), keys)
        .await;
    let mut project_event = None;
    let mut legacy_repository_from_project = None;
    let mut legacy_repository_event = None;
    if let Some(project_id) = input.project_id.as_deref() {
        let (kind, owner, d_tag) = parse_coordinate(project_id, &[30617, 30621])?;
        let event = fetch_verified_coordinate(&session, kind, &owner, &d_tag).await?;
        if kind == 30621 {
            project_event = Some(event);
        } else {
            legacy_repository_from_project = Some(format!("30617:{owner}:{d_tag}"));
            legacy_repository_event = Some(event);
        }
    }

    let mut repository_event = legacy_repository_event;
    let mut repository_address = legacy_repository_from_project.clone();
    if let Some(repository_id) = input.repository_id.as_deref() {
        let canonical = if repository_id.starts_with("30617:") {
            repository_id.to_string()
        } else {
            format!("30617:{repository_id}")
        };
        let (kind, owner, d_tag) = parse_coordinate(&canonical, &[30617])?;
        let event = fetch_verified_coordinate(&session, kind, &owner, &d_tag).await?;
        let address = format!("30617:{owner}:{d_tag}");
        if legacy_repository_from_project
            .as_ref()
            .is_some_and(|legacy| legacy != &address)
        {
            return Err("Factory legacy project and repository ids do not match".to_string());
        }
        repository_address = Some(address);
        repository_event = Some(event);
    }
    if let (Some(project), Some(repository_address)) =
        (project_event.as_ref(), repository_address.as_ref())
    {
        if !project_lists_repository(project, repository_address) {
            return Err("Factory repository is not a member of the selected project".to_string());
        }
    }

    if !client_scope_contains_announcements(
        scope,
        project_event.as_ref(),
        repository_event.as_ref(),
    ) {
        return Err(
            "Factory project or repository is outside the active client channel".to_string(),
        );
    }
    Ok(())
}

pub(crate) struct FactoryRuntime {
    controls: Arc<Mutex<HashMap<String, RunControl>>>,
    attachments: Arc<Mutex<HashMap<String, ScopedAttachment>>>,
    permits: Arc<Semaphore>,
    active_scope: Arc<Mutex<Option<FactoryScope>>>,
    memberships: MembershipCache,
}

impl FactoryRuntime {
    fn register(&self, run_id: &str, scope: FactoryScope) -> Result<RunControl, String> {
        let active = self
            .active_scope
            .lock()
            .map_err(|error| error.to_string())?;
        if active.as_ref() != Some(&scope)
            || !self
                .memberships
                .has_fresh_membership(&scope, Instant::now())
        {
            return Err("Factory workspace scope changed before run scheduling".to_string());
        }
        let mut controls = self.controls.lock().map_err(|error| error.to_string())?;
        if controls.len() >= MAX_CONCURRENT_SESSIONS as usize + MAX_QUEUED_RUNS as usize {
            return Err("Factory run queue is full".to_string());
        }
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        let control = RunControl {
            cancel: CancellationToken::new(),
            events,
            scope,
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
        scope: &FactoryScope,
    ) -> Result<Option<(CancellationToken, broadcast::Receiver<FactoryRunEvent>)>, String> {
        let Some(control) = self.control(run_id)? else {
            return Ok(None);
        };
        if &control.scope != scope || !self.event_authority().is_active(scope) {
            return Err("Factory run was not found".to_string());
        }
        let mut attachments = self.attachments.lock().map_err(|error| error.to_string())?;
        if attachments.contains_key(subscription_id) {
            return Err("Factory subscription id is already in use".to_string());
        }
        if attachments.len() >= MAX_ATTACHMENTS {
            return Err("Factory event subscriber limit reached".to_string());
        }
        let token = CancellationToken::new();
        attachments.insert(
            subscription_id.to_string(),
            ScopedAttachment {
                cancel: token.clone(),
                scope: scope.clone(),
            },
        );
        Ok(Some((token, control.events.subscribe())))
    }

    fn detach(&self, subscription_id: &str, scope: &FactoryScope) -> Result<bool, String> {
        let mut attachments = self.attachments.lock().map_err(|error| error.to_string())?;
        if !attachments
            .get(subscription_id)
            .is_some_and(|attachment| &attachment.scope == scope)
        {
            return Ok(false);
        }
        if let Some(attachment) = attachments.remove(subscription_id) {
            attachment.cancel.cancel();
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn activate_scope(&self, scope: Option<FactoryScope>) -> Result<(), String> {
        let mut active = self
            .active_scope
            .lock()
            .map_err(|error| error.to_string())?;
        if active.as_ref() != scope.as_ref() {
            let mut attachments = self.attachments.lock().map_err(|error| error.to_string())?;
            for attachment in attachments.values() {
                attachment.cancel.cancel();
            }
            attachments.clear();
            *active = scope;
        }
        Ok(())
    }

    fn active_scope(&self) -> Result<FactoryScope, String> {
        self.active_scope
            .lock()
            .map_err(|error| error.to_string())?
            .clone()
            .ok_or_else(|| {
                "Factory is unavailable until a business workspace is active".to_string()
            })
    }

    fn while_scope_active<T>(
        &self,
        app: &AppHandle,
        scope: &FactoryScope,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        if !native_scope_is_current(app, scope) {
            return Err(
                "Factory workspace scope no longer matches the native identity".to_string(),
            );
        }
        let active = self
            .active_scope
            .lock()
            .map_err(|error| error.to_string())?;
        if active.as_ref() != Some(scope)
            || !self.memberships.has_fresh_membership(scope, Instant::now())
        {
            return Err("Factory workspace scope changed during authorization".to_string());
        }
        operation()
    }

    fn event_authority(&self) -> FactoryEventAuthority {
        FactoryEventAuthority {
            active_scope: Arc::clone(&self.active_scope),
            memberships: self.memberships.clone(),
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
            active_scope: Arc::new(Mutex::new(None)),
            memberships: MembershipCache {
                entries: Arc::new(Mutex::new(HashMap::new())),
                generations: Arc::new(Mutex::new(HashMap::new())),
                next_generation: Arc::new(AtomicU64::new(0)),
            },
        }
    }
}

#[derive(Debug)]
struct RawRun {
    id: String,
    relay_url: String,
    identity_pubkey: String,
    business_community_id: String,
    client_channel_id: Option<String>,
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
            scope: FactoryScope {
                relay_url: raw.relay_url,
                identity_pubkey: raw.identity_pubkey,
                business_community_id: raw.business_community_id,
                client_channel_id: raw.client_channel_id,
            },
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

fn publish(
    app: &AppHandle,
    authority: &FactoryEventAuthority,
    control: Option<&RunControl>,
    event: &FactoryRunEvent,
) {
    if control.is_some_and(|control| control.scope != event.scope)
        || !native_scope_is_current(app, &event.scope)
    {
        return;
    }
    authority.while_active(&event.scope, || {
        if let Some(control) = control {
            let _ = control.events.send(event.clone());
        }
        // The persisted cursor is authoritative; an unavailable renderer can reattach later.
        let _ = app.emit(EVENT_NAME, event);
    });
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
    event_authority: FactoryEventAuthority,
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
    publish(&app, &event_authority, Some(&control), &event);

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
                    &event_authority,
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
    let capture_authority = event_authority.clone();
    let event_run_id = run.id.clone();
    let (storage_error_tx, mut storage_error_rx) = tokio::sync::oneshot::channel();
    let event_task = tokio::spawn(async move {
        let result = capture_observer_stream(observer_rx, event_path, event_run_id, |event| {
            publish(&event_app, &capture_authority, Some(&event_control), &event);
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
                &event_authority,
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
                &event_authority,
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
            &event_authority,
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
        &event_authority,
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
    event_authority: &FactoryEventAuthority,
    control: Option<&RunControl>,
    status: FactoryRunStatus,
    error: Option<&str>,
) {
    for attempt in 0..3 {
        match store_transition(path, run_id, None, status, error) {
            Ok(Some((_run, event))) => {
                publish(app, event_authority, control, &event);
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
    state: State<'_, crate::app_state::AppState>,
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
    let scope = require_factory_scope(&state, &app, &runtime, false).await?;
    let checkout = canonical_checkout(&input.checkout_path)?;
    let parent_run_id = input
        .parent_run_id
        .as_deref()
        .map(|value| Uuid::parse_str(value).map(|id| id.to_string()))
        .transpose()
        .map_err(|_| "invalid parent Factory run id".to_string())?;
    let requested_agent_id = input.agent_id.trim().to_string();
    validate_project_repository_scope(&scope, &input, &app, state.signing_keys()?).await?;
    let request_hash = create_request_hash(
        &scope,
        input.project_id.as_deref(),
        input.repository_id.as_deref(),
        &checkout.to_string_lossy(),
        &requested_agent_id,
        parent_run_id.as_deref(),
        &input.prompt,
    )?;
    let operation_key = scoped_operation_key(&scope, &input.operation_key)?;
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    if let Some(existing) = store_find_operation(&path, &scope, &operation_key, &request_hash)? {
        return Ok(existing);
    }
    let (agent_id, harness_id, launch) = resolve_launch(&app, &requested_agent_id, &checkout)?;
    let id = Uuid::new_v4().to_string();
    let created = runtime.while_scope_active(&app, &scope, || {
        store_create(
            &path,
            &scope,
            &id,
            &operation_key,
            &request_hash,
            input.project_id.as_deref(),
            input.repository_id.as_deref(),
            &checkout.to_string_lossy(),
            &agent_id,
            &harness_id,
            parent_run_id.as_deref(),
            &input.prompt,
        )
    });
    let created = created?;
    let prompt = input.prompt;
    let event_authority = runtime.event_authority();
    let permits = Arc::clone(&runtime.permits);
    let controls = Arc::clone(&runtime.controls);
    schedule_new_store_create(created, move |run, events| {
        let control = match runtime.register(&run.id, scope.clone()) {
            Ok(control) => control,
            Err(error) => {
                finish_run(
                    &app,
                    &path,
                    &run.id,
                    &event_authority,
                    None,
                    FactoryRunStatus::Error,
                    Some("Factory run could not be scheduled"),
                );
                return Err(error);
            }
        };
        for event in events {
            publish(&app, &event_authority, Some(&control), &event);
        }
        tauri::async_runtime::spawn(run_worker(
            app.clone(),
            path.clone(),
            run.clone(),
            prompt,
            launch,
            control,
            permits,
            controls,
            event_authority,
        ));
        Ok(())
    })
}

#[tauri::command]
pub(crate) async fn factory_run_list(
    app: AppHandle,
    state: State<'_, crate::app_state::AppState>,
    runtime: State<'_, FactoryRuntime>,
) -> Result<Vec<FactoryRun>, String> {
    let scope = require_factory_scope(&state, &app, &runtime, false).await?;
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    runtime.while_scope_active(&app, &scope, || store_list(&path, &scope))
}

#[tauri::command]
pub(crate) async fn factory_run_snapshot(
    run_id: String,
    after_sequence: Option<i64>,
    app: AppHandle,
    state: State<'_, crate::app_state::AppState>,
    runtime: State<'_, FactoryRuntime>,
) -> Result<FactoryRunSnapshot, String> {
    let scope = require_factory_scope(&state, &app, &runtime, false).await?;
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    runtime.while_scope_active(&app, &scope, || {
        store_snapshot(&path, &run_id, &scope, after_sequence.unwrap_or(0).max(0))
    })
}

#[tauri::command]
pub(crate) async fn factory_run_reattach(
    run_id: String,
    after_sequence: Option<i64>,
    subscription_id: String,
    on_event: Channel<FactoryRunEvent>,
    app: AppHandle,
    state: State<'_, crate::app_state::AppState>,
    runtime: State<'_, FactoryRuntime>,
) -> Result<FactoryRunSnapshot, String> {
    let scope = require_factory_scope(&state, &app, &runtime, true).await?;
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let subscription_id = Uuid::parse_str(&subscription_id)
        .map_err(|_| "invalid Factory event subscription id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    let after_sequence = after_sequence.unwrap_or(0).max(0);
    let snapshot = match runtime.while_scope_active(&app, &scope, || {
        store_snapshot(&path, &run_id, &scope, after_sequence)
    }) {
        Ok(snapshot) => snapshot,
        Err(error) => return Err(error),
    };
    let live = runtime.attach_if_live(&subscription_id, &run_id, &scope)?;
    if let Some((cancel, mut receiver)) = live {
        let attachments = Arc::clone(&runtime.attachments);
        let event_authority = runtime.event_authority();
        let event_app = app.clone();
        let event_scope = scope.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    event = receiver.recv() => match event {
                        Ok(event) if event.sequence > after_sequence => {
                            let mut delivered = false;
                            if !native_scope_is_current(&event_app, &event_scope)
                                || !event_authority.while_active(&event_scope, || {
                                    delivered = on_event.send(event).is_ok();
                                })
                                || !delivered
                            {
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
                                scope: event_scope.clone(),
                            };
                            if native_scope_is_current(&event_app, &event_scope) {
                                event_authority.while_active(&event_scope, || {
                                    let _ = on_event.send(notice);
                                });
                            }
                            break;
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
            if let Ok(mut attachments) = attachments.lock() {
                if attachments
                    .get(&subscription_id)
                    .is_some_and(|attachment| attachment.scope == event_scope)
                {
                    attachments.remove(&subscription_id);
                }
            }
        });
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn factory_run_detach(
    subscription_id: String,
    app: AppHandle,
    runtime: State<'_, FactoryRuntime>,
) -> Result<bool, String> {
    let subscription_id = Uuid::parse_str(&subscription_id)
        .map_err(|_| "invalid Factory event subscription id".to_string())?
        .to_string();
    let scope = runtime.active_scope()?;
    if !native_scope_is_current(&app, &scope) {
        return Err("Factory workspace scope no longer matches the native identity".to_string());
    }
    runtime.detach(&subscription_id, &scope)
}

#[tauri::command]
pub(crate) async fn factory_run_cancel(
    run_id: String,
    app: AppHandle,
    state: State<'_, crate::app_state::AppState>,
    runtime: State<'_, FactoryRuntime>,
) -> Result<FactoryRun, String> {
    let scope = require_factory_scope(&state, &app, &runtime, false).await?;
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    ensure_recovered(&path)?;
    let transition = runtime.while_scope_active(&app, &scope, || {
        store_transition_scoped(
            &path,
            &run_id,
            &scope,
            None,
            FactoryRunStatus::Cancelled,
            None,
        )
    })?;
    let Some((run, event)) = transition else {
        return runtime.while_scope_active(&app, &scope, || {
            store_snapshot(&path, &run_id, &scope, 0).map(|snapshot| snapshot.run)
        });
    };
    let control = runtime.control(&run_id)?;
    if let Some(control) = control.as_ref().filter(|control| control.scope == scope) {
        control.cancel.cancel();
    }
    publish(&app, &runtime.event_authority(), control.as_ref(), &event);
    Ok(run)
}

#[tauri::command]
pub(crate) async fn factory_run_set_draft(
    input: FactoryRunDraftInput,
    app: AppHandle,
    state: State<'_, crate::app_state::AppState>,
    runtime: State<'_, FactoryRuntime>,
) -> Result<FactoryRunDraft, String> {
    let scope = require_factory_scope(&state, &app, &runtime, false).await?;
    let run_id = Uuid::parse_str(&input.run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    runtime.while_scope_active(&app, &scope, || {
        store_set_draft(&path, &run_id, &scope, &input.draft)
    })
}

#[tauri::command]
pub(crate) async fn factory_run_get_draft(
    run_id: String,
    app: AppHandle,
    state: State<'_, crate::app_state::AppState>,
    runtime: State<'_, FactoryRuntime>,
) -> Result<Option<FactoryRunDraft>, String> {
    let scope = require_factory_scope(&state, &app, &runtime, false).await?;
    let run_id = Uuid::parse_str(&run_id)
        .map_err(|_| "invalid Factory run id".to_string())?
        .to_string();
    let path = app_db_path(&app)?;
    runtime.while_scope_active(&app, &scope, || store_get_draft(&path, &run_id, &scope))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests;
