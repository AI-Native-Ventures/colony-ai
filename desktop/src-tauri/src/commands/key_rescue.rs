//! One-time rescue of secrets an older, Keychain-backed Mac build left behind.
//!
//! Unsigned Mac builds keep their secrets in owner-only files (see
//! `app_state::resolve_identity_from_file`) and never read the Keychain. Agents
//! an older build created have their keys only in the Keychain, in one JSON
//! blob (service `buzz-desktop`, account `secrets`). This module moves them out
//! exactly once, and only when the owner clicks "Move my agents' keys":
//!
//! - nothing here runs at boot; [`get_key_rescue_status`] never reads the
//!   Keychain;
//! - [`rescue_legacy_keys`] makes one direct read of that item, writes agent
//!   keys back inline into the 0600 agents file, device credentials into
//!   `device-secrets.json`, and the identity into `identity.key` only when that
//!   file is absent and the key belongs to the signed-in account;
//! - the attempt and its outcome are recorded in `key-rescue.json`, so it is
//!   never offered twice, and the Keychain item is left in place.

use std::{
    collections::{BTreeMap, HashMap},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use atomic_write_file::AtomicWriteFile;
use nostr::{Keys, PublicKey};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zeroize::{Zeroize, Zeroizing};

use super::device_secret_file::FileSecretStore;
use crate::app_state::AppState;
use crate::managed_agents::{agent_keyring_name, ManagedAgentRecord};

/// Account of the single JSON blob inside the Keychain service.
const LEGACY_BLOB_ACCOUNT: &str = "secrets";
/// Prefix of device credentials inside the blob (see `company_secrets`).
const DEVICE_SECRET_PREFIX: &str = "company-secret:";
/// Where the attempt and its outcome are recorded.
const ATTEMPT_FILE: &str = "key-rescue.json";

/// Why the legacy item could not be read.
///
/// Only the macOS reader builds these outside tests.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LegacyReadError {
    /// The owner refused or cancelled the macOS prompt, or access was not
    /// allowed without one.
    Denied,
    /// Any other failure. The text never carries secret material.
    Unavailable(String),
}

/// Reads the legacy Keychain blob. The real reader talks to the Keychain; tests
/// use a fake.
pub(crate) trait LegacyBlobReader {
    /// `Ok(None)` means the item does not exist.
    fn read_blob(&self) -> Result<Option<Zeroizing<String>>, LegacyReadError>;
}

/// Loads and saves the agent records the rest of the app uses.
pub(crate) trait AgentKeyStore {
    fn load(&self) -> Result<Vec<ManagedAgentRecord>, String>;
    fn save(&self, records: &[ManagedAgentRecord]) -> Result<(), String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RescueOutcome {
    /// Every locked agent has its key again (or there was other data to move).
    Rescued,
    /// Some locked agents have their key again, some do not.
    Partial,
    /// The item was read but held nothing for these agents.
    NothingFound,
    /// The owner denied or cancelled the macOS prompt.
    Denied,
    /// No legacy item exists.
    NotFound,
    /// The item could not be read or parsed.
    Unreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityOutcome {
    /// The blob held no identity.
    NotInKeychain,
    /// `identity.key` exists, so the signed-in identity was left alone.
    KeptCurrent,
    /// `identity.key` was absent and the Keychain identity is the signed-in one.
    Restored,
    /// The Keychain identity belongs to another account and was not used.
    DifferentAccount,
}

/// What one rescue did. Holds public keys and counts only, never a secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueAttempt {
    pub attempted_at_unix: u64,
    pub outcome: RescueOutcome,
    pub agents_moved: Vec<String>,
    pub device_secrets_moved: usize,
    pub identity: IdentityOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockedAgent {
    pub pubkey: String,
    pub name: String,
}

/// What the UI needs: whether to show the card, which agents are locked, and
/// how the one attempt went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyRescueStatus {
    pub offer: bool,
    pub locked_agents: Vec<LockedAgent>,
    pub attempt: Option<RescueAttempt>,
}

fn attempt_path(data_dir: &Path) -> PathBuf {
    data_dir.join(ATTEMPT_FILE)
}

/// The recorded attempt. A file that exists but cannot be read counts as an
/// attempt that found nothing usable: when in doubt the card is not offered
/// again.
fn read_attempt(data_dir: &Path) -> Option<RescueAttempt> {
    let text = match std::fs::read_to_string(attempt_path(data_dir)) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => return Some(unreadable_attempt()),
    };
    Some(serde_json::from_str(&text).unwrap_or_else(|_| unreadable_attempt()))
}

fn unreadable_attempt() -> RescueAttempt {
    RescueAttempt {
        attempted_at_unix: 0,
        outcome: RescueOutcome::Unreadable,
        agents_moved: Vec::new(),
        device_secrets_moved: 0,
        identity: IdentityOutcome::NotInKeychain,
    }
}

/// Write a file readable only by the owner, atomically.
fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file =
        AtomicWriteFile::open(path).map_err(|error| format!("open for atomic write: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("set permissions: {error}"))?;
    }
    file.write_all(bytes)
        .map_err(|error| format!("write: {error}"))?;
    file.commit().map_err(|error| format!("commit: {error}"))
}

fn write_attempt(data_dir: &Path, attempt: &RescueAttempt) -> Result<(), String> {
    let json = serde_json::to_vec(attempt).map_err(|error| format!("encode attempt: {error}"))?;
    write_private_file(&attempt_path(data_dir), &json)
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn locked_agents(records: &[ManagedAgentRecord]) -> Vec<LockedAgent> {
    records
        .iter()
        .filter(|record| !record.pubkey.is_empty() && record.private_key_nsec.is_empty())
        .map(|record| LockedAgent {
            pubkey: record.pubkey.clone(),
            name: record.name.clone(),
        })
        .collect()
}

/// Whether an older build migrated the identity into the Keychain and this
/// build has no `identity.key` to show for it.
fn identity_still_in_keychain(data_dir: &Path) -> bool {
    let profile = colony_identity_kernel::ProfileScope::for_keyring_service(
        data_dir,
        crate::app_state::keyring_service(),
    );
    profile.migration_marker_path().exists() && !profile.legacy_identity_path().exists()
}

/// Decide what the UI shows. Never reads the Keychain.
///
/// The card is offered only in a build without a keyring, only while no
/// attempt is recorded, and only when something is actually missing: an agent
/// without a key, or an identity file missing while the Keychain migration
/// marker exists.
pub(crate) fn compute_status(
    data_dir: &Path,
    records: &[ManagedAgentRecord],
    keyless_build: bool,
) -> KeyRescueStatus {
    let locked = locked_agents(records);
    let attempt = read_attempt(data_dir);
    let offer = keyless_build
        // RED PROOF: offered again after an attempt.
        && (!locked.is_empty() || identity_still_in_keychain(data_dir));
    KeyRescueStatus {
        offer,
        locked_agents: locked,
        attempt,
    }
}

/// Parse an nsec and require it to belong to `expected_pubkey` (hex).
fn keys_for(nsec: &str, expected_pubkey: &str) -> Option<Keys> {
    let keys = Keys::parse(nsec.trim()).ok()?;
    keys.public_key()
        .to_hex()
        .eq_ignore_ascii_case(expected_pubkey)
        .then_some(keys)
}

/// Fill the empty-key records from the blob and return the pubkeys filled.
/// A key that does not belong to its record is skipped, never trusted.
fn fill_agent_keys(
    blob: &HashMap<String, String>,
    records: &mut [ManagedAgentRecord],
) -> Vec<String> {
    let mut filled = Vec::new();
    for record in records.iter_mut() {
        if record.pubkey.is_empty() || !record.private_key_nsec.is_empty() {
            continue;
        }
        let Some(nsec) = blob.get(&agent_keyring_name(&record.pubkey)) else {
            continue;
        };
        if keys_for(nsec, &record.pubkey).is_some() {
            record.private_key_nsec = nsec.trim().to_owned();
            filled.push(record.pubkey.clone());
        }
    }
    filled
}

/// Move the Keychain identity into `identity.key` only when that file is
/// absent and the key is the signed-in account's. Never replaces anything.
fn rescue_identity(
    blob: &HashMap<String, String>,
    data_dir: &Path,
    signed_in: &PublicKey,
) -> IdentityOutcome {
    let Some(nsec) = blob.get(colony_identity_kernel::IDENTITY_KEY_NAME) else {
        return IdentityOutcome::NotInKeychain;
    };
    let path = data_dir.join(colony_identity_kernel::IDENTITY_FILE_NAME);
    if path.exists() {
        return IdentityOutcome::KeptCurrent;
    }
    let Some(keys) = keys_for(nsec, &signed_in.to_hex()) else {
        return IdentityOutcome::DifferentAccount;
    };
    let restored = colony_identity_kernel::save_key_file(&path, &keys)
        .and_then(|()| colony_identity_kernel::load_key_file(&path))
        .is_ok_and(|reloaded| reloaded.public_key() == keys.public_key());
    if restored {
        IdentityOutcome::Restored
    } else {
        IdentityOutcome::DifferentAccount
    }
}

fn record_and_return(data_dir: &Path, attempt: RescueAttempt) -> Result<RescueAttempt, String> {
    write_attempt(data_dir, &attempt)?;
    Ok(attempt)
}

fn failed_attempt(outcome: RescueOutcome) -> RescueAttempt {
    RescueAttempt {
        attempted_at_unix: now_unix(),
        outcome,
        agents_moved: Vec::new(),
        device_secrets_moved: 0,
        identity: IdentityOutcome::NotInKeychain,
    }
}

/// Run the one rescue. A recorded attempt is returned as is and nothing is
/// read, so the Keychain prompt cannot appear twice.
pub(crate) fn run_rescue(
    data_dir: &Path,
    signed_in: &PublicKey,
    reader: &impl LegacyBlobReader,
    agents: &impl AgentKeyStore,
) -> Result<RescueAttempt, String> {
    // RED PROOF: a recorded attempt no longer stops a second read.
    let raw = match reader.read_blob() {
        Ok(Some(raw)) => raw,
        Ok(None) => {
            return record_and_return(data_dir, failed_attempt(RescueOutcome::NotFound));
        }
        Err(LegacyReadError::Denied) => {
            return record_and_return(data_dir, failed_attempt(RescueOutcome::Denied));
        }
        Err(LegacyReadError::Unavailable(detail)) => {
            eprintln!("buzz-desktop: key rescue could not read the Keychain item: {detail}");
            return record_and_return(data_dir, failed_attempt(RescueOutcome::Unreadable));
        }
    };
    let Ok(mut blob) = serde_json::from_str::<HashMap<String, String>>(&raw) else {
        return record_and_return(data_dir, failed_attempt(RescueOutcome::Unreadable));
    };
    let result = move_blob_contents(data_dir, signed_in, &blob, agents);
    for value in blob.values_mut() {
        value.zeroize();
    }
    let attempt = result?;
    record_and_return(data_dir, attempt)
}

/// Move what the blob holds into the file stores and describe what happened.
fn move_blob_contents(
    data_dir: &Path,
    signed_in: &PublicKey,
    blob: &HashMap<String, String>,
    agents: &impl AgentKeyStore,
) -> Result<RescueAttempt, String> {
    let mut records = agents.load()?;
    let locked_before = locked_agents(&records).len();
    let filled = fill_agent_keys(blob, &mut records);
    let mut agents_moved = Vec::new();
    if !filled.is_empty() {
        agents.save(&records)?;
        // Read back from the store: only keys that are really there count.
        let reloaded = agents.load()?;
        agents_moved = filled
            .into_iter()
            .filter(|pubkey| {
                reloaded
                    .iter()
                    .any(|record| &record.pubkey == pubkey && !record.private_key_nsec.is_empty())
            })
            .collect();
    }

    let device_entries: BTreeMap<String, String> = blob
        .iter()
        .filter(|(key, _)| key.starts_with(DEVICE_SECRET_PREFIX))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let device_secrets_moved = if device_entries.is_empty() {
        0
    } else {
        FileSecretStore::in_dir(data_dir).store_all_if_absent(&device_entries)?
    };

    let identity = rescue_identity(blob, data_dir, signed_in);

    let outcome = if locked_before > 0 {
        if agents_moved.len() == locked_before {
            RescueOutcome::Rescued
        } else if agents_moved.is_empty() {
            RescueOutcome::NothingFound
        } else {
            RescueOutcome::Partial
        }
    } else if device_secrets_moved > 0 || identity == IdentityOutcome::Restored {
        RescueOutcome::Rescued
    } else {
        RescueOutcome::NothingFound
    };

    Ok(RescueAttempt {
        attempted_at_unix: now_unix(),
        outcome,
        agents_moved,
        device_secrets_moved,
        identity,
    })
}

/// Reads the legacy item through the Security framework, with no `keyring`
/// crate: this build has none.
struct KeychainReader {
    service: String,
}

#[cfg(target_os = "macos")]
impl LegacyBlobReader for KeychainReader {
    fn read_blob(&self) -> Result<Option<Zeroizing<String>>, LegacyReadError> {
        use security_framework::os::macos::passwords::find_generic_password;

        // errSecItemNotFound, errSecUserCanceled, errSecAuthFailed,
        // errSecInteractionNotAllowed.
        const NOT_FOUND: i32 = -25300;
        const DENIED: [i32; 3] = [-128, -25293, -25308];

        match find_generic_password(None, &self.service, LEGACY_BLOB_ACCOUNT) {
            Ok((password, _item)) => {
                let bytes: &[u8] = password.as_ref();
                String::from_utf8(bytes.to_vec())
                    .map(|text| Some(Zeroizing::new(text)))
                    .map_err(|_| LegacyReadError::Unavailable("item is not text".to_owned()))
            }
            Err(error) if error.code() == NOT_FOUND => Ok(None),
            Err(error) if DENIED.contains(&error.code()) => Err(LegacyReadError::Denied),
            Err(error) => Err(LegacyReadError::Unavailable(format!(
                "keychain status {}",
                error.code()
            ))),
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl LegacyBlobReader for KeychainReader {
    fn read_blob(&self) -> Result<Option<Zeroizing<String>>, LegacyReadError> {
        let _ = (&self.service, LEGACY_BLOB_ACCOUNT);
        Ok(None)
    }
}

/// The agent records of this app.
struct AppAgentStore<'a>(&'a AppHandle);

impl AgentKeyStore for AppAgentStore<'_> {
    fn load(&self) -> Result<Vec<ManagedAgentRecord>, String> {
        crate::managed_agents::load_managed_agents(self.0)
    }

    fn save(&self, records: &[ManagedAgentRecord]) -> Result<(), String> {
        crate::managed_agents::save_managed_agents(self.0, records)
    }
}

/// Only one rescue may be in flight, so a double click cannot raise two
/// Keychain prompts.
static RESCUE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("app data dir: {error}"))
}

/// What to show about the one-time key rescue. Never touches the Keychain.
#[tauri::command]
pub fn get_key_rescue_status(app: AppHandle) -> Result<KeyRescueStatus, String> {
    if cfg!(feature = "system-keyring") {
        // A build with a keyring reads agent keys from it. Loading the agents
        // here would do that on every screen, so say there is nothing to do.
        return Ok(KeyRescueStatus {
            offer: false,
            locked_agents: Vec::new(),
            attempt: None,
        });
    }
    let data_dir = app_data_dir(&app)?;
    let records = AppAgentStore(&app).load()?;
    Ok(compute_status(
        &data_dir,
        &records,
        !cfg!(feature = "system-keyring"),
    ))
}

/// The owner's click on "Move my agents' keys": the only place the legacy
/// Keychain item is read, once.
#[tauri::command]
pub async fn rescue_legacy_keys(app: AppHandle) -> Result<KeyRescueStatus, String> {
    if cfg!(feature = "system-keyring") {
        return Err("This build reads the Keychain itself, so there is nothing to move.".into());
    }
    if RESCUE_IN_PROGRESS.swap(true, Ordering::AcqRel) {
        return Err("A key move is already running.".into());
    }
    let result = tokio::task::spawn_blocking(move || -> Result<KeyRescueStatus, String> {
        let data_dir = app_data_dir(&app)?;
        let signed_in = app
            .state::<AppState>()
            .keys
            .lock()
            .map_err(|error| error.to_string())?
            .public_key();
        let reader = KeychainReader {
            service: crate::app_state::keyring_service().to_owned(),
        };
        run_rescue(&data_dir, &signed_in, &reader, &AppAgentStore(&app))?;
        let records = AppAgentStore(&app).load()?;
        Ok(compute_status(
            &data_dir,
            &records,
            !cfg!(feature = "system-keyring"),
        ))
    })
    .await
    .map_err(|error| format!("key move task failed: {error}"))
    .and_then(|inner| inner);
    RESCUE_IN_PROGRESS.store(false, Ordering::Release);
    result
}

#[cfg(test)]
#[path = "key_rescue_tests.rs"]
mod tests;
