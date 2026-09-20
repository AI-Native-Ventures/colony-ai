use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU16, AtomicU64, AtomicU8},
        Arc, Mutex,
    },
};

use nostr::Keys;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as AsyncMutex;

use crate::huddle::HuddleState;
pub(crate) use crate::identity_storage::{IdentityStorage, RecoveryState, ResolvedIdentity};
use crate::managed_agents::config_bridge::SessionConfigCache;
use crate::managed_agents::{ManagedAgentPairRuntime, ManagedAgentRuntimeKey};
pub(crate) use colony_identity_kernel::{IdentityKeyStore, KeyringProbe, ProfileScope};

pub struct AppState {
    pub keys: Mutex<Keys>,
    /// Durable backend holding `keys`. Updated after the key write and before
    /// recovery flags are cleared so `get_identity` reports a consistent state.
    pub(crate) identity_storage: AtomicU8,
    pub http_client: reqwest::Client,
    /// A no-redirect client for authenticated relay media fetches (download,
    /// clipboard copy, snapshot, editor). Every caller pre-validates the URL
    /// origin, but the app-wide `http_client` follows redirects by default, so
    /// a relay `/media/` URL returning a 3xx to an off-origin or private host
    /// would forward the minted media Authorization header across origins —
    /// a redirect-hop SSRF. This client treats any 3xx as a non-success
    /// response (surfaced as an error) so the auth token never leaves the
    /// validated relay origin.
    pub media_fetch_client: reqwest::Client,
    pub relay_url_override: Mutex<Option<String>>,
    /// User-configured communities, supplied by narrow workspace IPC, never learned
    /// from profile URLs. Only these origins may supply portable agent media.
    pub agent_avatar_communities: Mutex<Vec<String>>,
    pub workspace_apply_lock: Arc<AsyncMutex<()>>,
    pub workspace_apply_generation: AtomicU64,
    /// Defers managed-agent restore until `apply_workspace` installs relay and identity.
    pub managed_agent_restore_pending: AtomicBool,
    /// Experiment state applied to managed-agent starts and profile reconciliation.
    pub managed_agent_experiments: crate::managed_agents::ManagedAgentExperimentState,
    /// Shared shutdown signal checked by launch-time agent restoration.
    pub shutdown_started: AtomicBool,
    /// Serializes every managed-runtime transition that changes the protected
    /// PID set: spawn/register, adoption, stop, shutdown, and sweep snapshots.
    /// Never perform network I/O while holding this lock.
    pub managed_agent_runtime_transition: Mutex<()>,
    pub managed_agents_store_lock: Mutex<()>,
    pub channel_templates_store_lock: Mutex<()>,
    pub managed_agent_processes: Mutex<HashMap<ManagedAgentRuntimeKey, ManagedAgentPairRuntime>>,
    pub provider_deploy_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub huddle_state: Mutex<HuddleState>,
    pub huddle_audio: crate::huddle::tts_settings::HuddleAudioSettingsState,
    /// Tauri app handle — stored after setup so huddle commands can emit
    /// `huddle-state-changed` events without needing the handle threaded
    /// through every call site.
    ///
    /// Set once during `setup()` in `lib.rs`; never cleared.
    pub app_handle: Mutex<Option<AppHandle>>,
    /// Port of the localhost media streaming proxy (set during setup).
    pub media_proxy_port: AtomicU16,
    /// Set when identity resolution detected a "keyring-locked" state: the
    /// keyring is unreachable this boot but a migration marker shows the key
    /// lives there. An ephemeral key is generated so the app can open; all
    /// signing commands check this flag via [`AppState::signing_keys`] and
    /// return `Err` so no events are published under the inaccessible identity.
    /// Mutually exclusive with `identity_lost` (guaranteed by `RecoveryState`
    /// at the resolve boundary).
    ///
    /// Ordering: writers store with `Ordering::Release` after `state.keys` is
    /// updated, so a reader observing `false` with `Ordering::Acquire` is
    /// guaranteed to see the updated keys. Writers: `setup()` (initial
    /// resolution via `resolve_persisted_identity`) and `import_identity`
    /// (clears the flag when the user successfully imports a new key).
    pub keyring_locked: AtomicBool,
    /// Set when identity resolution detected a "lost" state: the migration
    /// marker was present but the keyring was empty and no plaintext fallback
    /// existed. An ephemeral key was generated to let the app boot; the
    /// frontend checks this flag via `get_identity` and routes to the nsec
    /// re-import step instead of the normal onboarding profile flow.
    ///
    /// Ordering: writers store with `Ordering::Release` after `state.keys` is
    /// updated, so a reader observing `false` with `Ordering::Acquire` is
    /// guaranteed to see the updated keys. Writers: `setup()` (initial
    /// resolution) and `import_identity`/`persist_current_identity`
    /// (user-initiated key import).
    pub identity_lost: AtomicBool,
    /// Serializes runtime identity mutations (`import_identity` and
    /// `persist_current_identity`) so a stale ephemeral key can never overwrite
    /// a newer imported key during concurrent calls. Deliberately separate from
    /// `keys` so readers (signing, get_identity, etc.) are not blocked during
    /// keyring I/O.
    pub identity_mutation: Mutex<()>,
    /// Set when the boot-time Phase 2 reset attempted a wipe but verification
    /// failed. The sentinel is preserved so the next relaunch retries. All
    /// identity-dependent setup is skipped; the frontend shows a reset-failed
    /// recovery screen via `get_identity`.
    ///
    /// Ordering: written once in `setup()` with `Ordering::Release`; read in
    /// `get_identity` with `Ordering::Acquire`.
    pub reset_failed: AtomicBool,
    /// Cached ACP session config from running agents, keyed by canonical
    /// `(agent pubkey, relay URL)` runtime identity.
    /// Populated when the harness emits `session_config_captured` observer events.
    pub session_config_cache: Mutex<HashMap<ManagedAgentRuntimeKey, SessionConfigCache>>,
    /// IOKit power assertion state — prevents idle sleep while agents run.
    pub prevent_sleep: Arc<Mutex<crate::prevent_sleep::PreventSleepState>>,
    /// In-process mesh-llm node started by Buzz Desktop.
    #[cfg(feature = "mesh-llm")]
    pub mesh_llm_runtime: AsyncMutex<Option<crate::mesh_llm::DesktopMeshRuntime>>,
    #[cfg(feature = "mesh-llm")]
    pub mesh_recovery: crate::mesh_llm::MeshRecoveryState,
    /// Runtime-owned shared-compute coordinator. It publishes member-signed
    /// discovery status and reconciles MeshLLM's admission roster; MeshLLM
    /// itself owns direct QUIC/iroh connection establishment.
    #[cfg(feature = "mesh-llm")]
    pub mesh_coordinator: AsyncMutex<Option<crate::mesh_llm::MeshCoordinator>>,
    /// `(creator_pubkey_hex, channel_id)` pairs for channels the *named*
    /// identity created via `create_channel` and has not yet observed its own
    /// kind:39002 membership entry for. The relay provisions that entry
    /// asynchronously (#1761), so without this overlay a freshly created
    /// channel's owner reads back as `is_member=false` until the snapshot
    /// propagates, disabling their own composer. Entries are bound to the
    /// creating identity so an in-process identity swap (`import_identity`,
    /// workspace apply) can never inherit another identity's stale
    /// membership. Populated only by this process's own `create_channel`
    /// calls — a relay can never write into it — so it carries no
    /// trust-boundary risk. `get_channels` clears an entry once the real
    /// kind:39002 is observed for the current identity, keeping the set
    /// bounded and letting a later leave correctly flip the channel back to
    /// `is_member=false`.
    pub pending_owned_channels: Mutex<std::collections::HashSet<(String, String)>>,
    /// NIP-11 `self` pubkeys keyed by relay WS URL, each with its fetch
    /// instant. A relay's signing identity is effectively static, yet every
    /// send-time agent revalidation used to re-GET the document — one of the
    /// dominant costs of agent-mention send latency. Entries expire after
    /// `identity_archive::RELAY_SELF_CACHE_TTL` so a relay-side key rotation
    /// still converges. Keyed by URL, so switching communities can never serve
    /// another relay's identity; only verified `Some` values are stored (an
    /// outage or a document without `self` must stay retryable).
    pub relay_self_cache: Mutex<HashMap<String, (std::time::Instant, String)>>,
    pub archive_db: crate::archive::ArchiveDb,
}

/// Parse the `BUZZ_PRIVATE_KEY` env var into identity keys. `Some` means the
/// env var was present and valid and MUST win over any persisted/keyring key
/// (the dev/CI/harness override). `None` means absent or malformed — callers
/// fall through to persisted resolution. A malformed value is logged and
/// treated as absent rather than left on an ephemeral identity.
fn identity_from_env() -> Option<Keys> {
    match std::env::var("BUZZ_PRIVATE_KEY") {
        Ok(nsec) => match Keys::parse(nsec.trim()) {
            Ok(keys) => Some(keys),
            Err(error) => {
                eprintln!("buzz-desktop: invalid BUZZ_PRIVATE_KEY: {error}");
                None
            }
        },
        Err(std::env::VarError::NotUnicode(_)) => {
            eprintln!("buzz-desktop: BUZZ_PRIVATE_KEY contains invalid UTF-8");
            None
        }
        Err(std::env::VarError::NotPresent) => None,
    }
}

/// Build the no-redirect HTTP client used for authenticated relay media
/// fetches (download / copy).
///
/// This client is a security boundary, not a convenience: it carries a minted
/// media `Authorization` header, so it MUST NOT follow redirects. A relay 3xx
/// to an off-origin or private host would otherwise forward that header across
/// origins (a redirect-hop SSRF). `redirect::Policy::none()` returns the 3xx
/// verbatim so the caller can reject it.
///
/// Returned as a `Result` so the fail-closed invariant is testable — callers
/// must never substitute a redirect-following client on build failure. Shares
/// the localhost `resolve`/pool config with the app-wide `http_client`.
pub fn build_media_fetch_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .resolve("localhost", std::net::SocketAddr::from(([127, 0, 0, 1], 0)))
        .pool_idle_timeout(std::time::Duration::from_secs(10))
        .pool_max_idle_per_host(1)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

pub fn build_app_state() -> AppState {
    // Env var takes precedence (dev/CI). If absent, resolve_persisted_identity()
    // in setup() will replace the ephemeral placeholder with a persisted key.
    let (keys, identity_storage) = match identity_from_env() {
        Some(keys) => {
            eprintln!(
                "buzz-desktop: configured identity pubkey {}",
                keys.public_key().to_hex()
            );
            (keys, IdentityStorage::Environment)
        }
        None => (Keys::generate(), IdentityStorage::Ephemeral),
    };

    AppState {
        keys: Mutex::new(keys),
        identity_storage: AtomicU8::new(identity_storage as u8),
        http_client: reqwest::Client::builder()
            .resolve("localhost", std::net::SocketAddr::from(([127, 0, 0, 1], 0)))
            .pool_idle_timeout(std::time::Duration::from_secs(300))
            .pool_max_idle_per_host(2)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new()),
        media_fetch_client: build_media_fetch_client().expect(
            "media_fetch_client must build with redirect::Policy::none(); a \
             redirect-following fallback would forward the minted media auth \
             header across origins (redirect-hop SSRF)",
        ),
        relay_url_override: Mutex::new(None),
        agent_avatar_communities: Mutex::new(Vec::new()),
        workspace_apply_lock: Arc::new(AsyncMutex::new(())),
        workspace_apply_generation: AtomicU64::new(0),
        managed_agent_restore_pending: AtomicBool::new(false),
        managed_agent_experiments: crate::managed_agents::ManagedAgentExperimentState::default(),
        shutdown_started: AtomicBool::new(false),
        managed_agent_runtime_transition: Mutex::new(()),
        identity_mutation: Mutex::new(()),
        managed_agents_store_lock: Mutex::new(()),
        channel_templates_store_lock: Mutex::new(()),
        managed_agent_processes: Mutex::new(HashMap::new()),
        provider_deploy_locks: Mutex::new(HashMap::new()),
        session_config_cache: Mutex::new(HashMap::new()),
        huddle_state: Mutex::new(HuddleState::default()),
        huddle_audio: Default::default(),
        app_handle: Mutex::new(None),
        media_proxy_port: AtomicU16::new(0),
        prevent_sleep: Default::default(),
        keyring_locked: AtomicBool::new(false),
        identity_lost: AtomicBool::new(false),
        reset_failed: AtomicBool::new(false),
        #[cfg(feature = "mesh-llm")]
        mesh_llm_runtime: AsyncMutex::new(None),
        #[cfg(feature = "mesh-llm")]
        mesh_recovery: crate::mesh_llm::MeshRecoveryState::default(),
        #[cfg(feature = "mesh-llm")]
        mesh_coordinator: AsyncMutex::new(None),
        pending_owned_channels: Mutex::new(std::collections::HashSet::new()),
        relay_self_cache: Mutex::new(HashMap::new()),
        archive_db: crate::archive::ArchiveDb::default(),
    }
}

#[path = "app_state_accessors.rs"]
mod accessors;

/// Resolve the user's identity key from the app data directory and wire
/// the resulting [`RecoveryState`] into `AppState`.
///
/// Priority: `BUZZ_PRIVATE_KEY` env var (already handled in `build_app_state`)
/// → keyring → `{app_data_dir}/identity.key` file → generate + save.
///
/// On success, writes the resolved keys into `state.keys` (with the mutex)
/// before storing the recovery flags (Release), so any thread that reads
/// either flag as `false` with Acquire is guaranteed to see the updated keys.
///
/// Sets `state.identity_lost` on `RecoveryState::Lost` (keyring empty after
/// migration — key gone externally) and `state.keyring_locked` on
/// `RecoveryState::KeyringLocked` (keyring unreachable — key still in keyring
/// but inaccessible this boot). Both states boot with an ephemeral key; the
/// frontend shows different recovery screens for each.
pub fn resolve_persisted_identity(app: &AppHandle, state: &AppState) -> Result<(), String> {
    // Only skip file-based resolution if the env var was present AND parsed
    // successfully. A malformed env var should fall through to the persisted
    // key rather than leaving the app on an ephemeral identity.
    if identity_from_env().is_some() {
        return Ok(());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("create app data dir: {e}"))?;

    let resolved = load_or_create_identity(&data_dir)?;
    // Write keys and storage before setting the recovery flags (Release) so
    // any thread that reads a flag as false with Acquire sees consistent data.
    {
        let mut active_keys = state.keys.lock().map_err(|e| e.to_string())?;
        *active_keys = resolved.keys;
        state.set_identity_storage(resolved.storage);
    }
    state.identity_lost.store(
        resolved.recovery == RecoveryState::Lost,
        std::sync::atomic::Ordering::Release,
    );
    state.keyring_locked.store(
        resolved.recovery == RecoveryState::KeyringLocked,
        std::sync::atomic::Ordering::Release,
    );
    Ok(())
}

#[path = "app_state_keyring.rs"]
mod keyring_config;
pub(crate) use keyring_config::keyring_service;

#[path = "app_state_pending_channels.rs"]
mod pending_channels;

/// Names and helpers retained at the Tauri adapter boundary so existing
/// callsites/tests keep their behavior while the implementation lives in the
/// host-neutral kernel.
#[cfg(test)]
pub(crate) const IDENTITY_KEY_NAME: &str = colony_identity_kernel::IDENTITY_KEY_NAME;
pub(crate) const MIGRATION_MARKER_NAME: &str = colony_identity_kernel::MIGRATION_MARKER_NAME;

impl IdentityKeyStore for crate::secret_store::SecretStore {
    fn probe(&self, name: &str) -> KeyringProbe {
        crate::secret_store::SecretStore::probe(self, name)
    }

    fn load(&self, name: &str) -> Result<Option<String>, String> {
        crate::secret_store::SecretStore::load(self, name)
    }

    fn store(&self, name: &str, value: &str) -> Result<(), String> {
        crate::secret_store::SecretStore::store(self, name, value)
    }

    fn delete(&self, name: &str) -> Result<(), String> {
        crate::secret_store::SecretStore::delete(self, name)
    }

    fn verify_stored(&self, key: &str, expected: &str) -> Result<bool, String> {
        crate::secret_store::SecretStore::verify_stored_raw(self, key, expected)
    }
}

fn profile_scope(legacy_path: &std::path::Path, data_dir: &std::path::Path) -> ProfileScope {
    ProfileScope::new(
        data_dir.to_path_buf(),
        legacy_path.to_path_buf(),
        keyring_service().to_string(),
        keyring_config::migration_marker_name(keyring_service(), MIGRATION_MARKER_NAME),
    )
}

fn load_or_create_identity(data_dir: &std::path::Path) -> Result<ResolvedIdentity, String> {
    let legacy_path = data_dir.join(colony_identity_kernel::IDENTITY_FILE_NAME);
    let profile = profile_scope(&legacy_path, data_dir);

    // Keep the existing no-keyring build behavior: it uses only the 0600
    // file and does not interpret a keyring migration marker. The headless
    // consumer contract is explicit, but this adapter must not change the
    // baseline feature policy while the extraction is incremental.
    #[cfg(not(feature = "system-keyring"))]
    {
        let keys = colony_identity_kernel::load_file_or_generate(&profile)?;
        return Ok(ResolvedIdentity {
            keys,
            recovery: RecoveryState::None,
            storage: IdentityStorage::LocalFile,
        });
    }

    #[cfg(feature = "system-keyring")]
    {
        let store = crate::secret_store::SecretStore::shared(keyring_service());
        colony_identity_kernel::resolve_identity_with_store(store, &profile)
    }
}

#[cfg(test)]
fn resolve_identity_with_store(
    store: &impl IdentityKeyStore,
    legacy_path: &std::path::Path,
    data_dir: &std::path::Path,
) -> Result<ResolvedIdentity, String> {
    let profile = profile_scope(legacy_path, data_dir);
    colony_identity_kernel::resolve_identity_with_store(store, &profile)
}

#[cfg(test)]
fn persist_identity_to_keyring(
    store: &impl IdentityKeyStore,
    keys: &Keys,
    legacy_path: &std::path::Path,
    data_dir: &std::path::Path,
) -> Result<(), String> {
    let profile = profile_scope(legacy_path, data_dir);
    colony_identity_kernel::persist_identity_to_keyring(store, keys, &profile)
}

fn persist_imported_identity_impl(
    store: &impl IdentityKeyStore,
    keys: &Keys,
    legacy_path: &std::path::Path,
    data_dir: &std::path::Path,
) -> Result<IdentityStorage, String> {
    let profile = profile_scope(legacy_path, data_dir);
    colony_identity_kernel::persist_imported_identity(store, keys, &profile)
}

/// Public Tauri adapter used by import and mobile recovery commands.
pub(crate) fn persist_imported_identity(
    store: &crate::secret_store::SecretStore,
    keys: &Keys,
    legacy_path: &std::path::Path,
    data_dir: &std::path::Path,
) -> Result<IdentityStorage, String> {
    persist_imported_identity_impl(store, keys, legacy_path, data_dir)
}

#[cfg(test)]
fn migration_marker_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    ProfileScope::for_keyring_service(data_dir.to_path_buf(), keyring_service())
        .migration_marker_path()
}

#[cfg(test)]
fn write_migration_marker(path: &std::path::Path) -> Result<(), String> {
    colony_identity_kernel::write_migration_marker_at(path)
}

#[cfg(test)]
pub(crate) use colony_identity_kernel::{
    cleanup_leftover_identity_file, load_key_file, save_key_file,
};

#[cfg(test)]
#[path = "app_state_tests.rs"]
mod tests;
