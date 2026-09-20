//! Host-neutral identity resolution and persistence primitives.
//!
//! This crate deliberately contains no Tauri, webview, relay, or application
//! state dependencies. The Tauri desktop adapter supplies the OS keyring
//! implementation and keeps the existing environment/path policy; a future
//! headless host can supply an explicit profile and the same store contract.

use std::{
    io::Write,
    path::{Path, PathBuf},
};

use nostr::{Keys, PublicKey, ToBech32};

/// Durable location of the active human identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum IdentityStorage {
    Ephemeral = 0,
    SystemKeyring = 1,
    LocalFile = 2,
    Environment = 3,
}

impl IdentityStorage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ephemeral => "ephemeral",
            Self::SystemKeyring => "system-keyring",
            Self::LocalFile => "local-file",
            Self::Environment => "environment",
        }
    }
}

/// Recovery state produced by identity resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryState {
    None,
    Lost,
    KeyringLocked,
}

/// Identity and persistence metadata produced by startup resolution.
#[derive(Debug, Clone)]
pub struct ResolvedIdentity {
    pub keys: Keys,
    pub recovery: RecoveryState,
    pub storage: IdentityStorage,
}

/// Metadata projection used by the Tauri command and the future headless host.
/// It contains no private key material.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentitySnapshot {
    pub pubkey: String,
    pub display_name: String,
    pub storage: String,
    pub lost: bool,
    pub locked: bool,
    pub reset_failed: bool,
}

/// Explicit scope for one identity profile.
///
/// The legacy file path is explicit rather than derived so the existing Tauri
/// adapter can preserve its test and migration paths exactly. A future host
/// must construct this from a fresh, collision-checked profile namespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileScope {
    data_dir: PathBuf,
    legacy_identity_path: PathBuf,
    keyring_service: String,
    migration_marker_name: String,
}

impl ProfileScope {
    /// Construct an explicit profile scope.
    pub fn new(
        data_dir: impl Into<PathBuf>,
        legacy_identity_path: impl Into<PathBuf>,
        keyring_service: impl Into<String>,
        migration_marker_name: impl Into<String>,
    ) -> Self {
        Self {
            data_dir: data_dir.into(),
            legacy_identity_path: legacy_identity_path.into(),
            keyring_service: keyring_service.into(),
            migration_marker_name: migration_marker_name.into(),
        }
    }

    /// Construct the normal `identity.key` scope for a keyring service.
    pub fn for_keyring_service(data_dir: impl Into<PathBuf>, service: impl Into<String>) -> Self {
        let data_dir = data_dir.into();
        let service = service.into();
        let marker = migration_marker_name(&service, MIGRATION_MARKER_NAME);
        Self::new(
            data_dir.clone(),
            data_dir.join(IDENTITY_FILE_NAME),
            service,
            marker,
        )
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn legacy_identity_path(&self) -> &Path {
        &self.legacy_identity_path
    }

    pub fn keyring_service(&self) -> &str {
        &self.keyring_service
    }

    pub fn migration_marker_path(&self) -> PathBuf {
        self.data_dir.join(&self.migration_marker_name)
    }
}

/// Keyring probe result used by the resolution state machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyringProbe {
    /// The keyring is reachable and already has the identity entry.
    Present,
    /// The keyring is reachable but has no identity entry.
    ReachableButEmpty,
    /// The keyring backend is unavailable for this boot.
    Unreachable,
    /// The current identity blob was fetched but cannot be decoded.
    ///
    /// This is distinct from an unavailable/locked backend. A strict headless
    /// adapter uses it to enter the existing corrupt-profile recovery order;
    /// the legacy Tauri adapter may continue mapping its decoder failures to
    /// `Unreachable` for compatibility.
    CorruptCurrentBlob,
}

/// Normalized headless probe state exposed by the strict adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeadlessProbe {
    /// The identity entry exists and decoded successfully.
    Present,
    /// The backend is reachable but has no identity entry.
    Missing,
    /// A pre-existing backend blob was fetched but failed strict decoding.
    CorruptCurrentBlob,
    /// The backend could not be reached for this operation.
    Unreachable,
    /// The backend reported a locked credential store.
    Locked,
}

/// Direct read-back result for a strict headless write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeadlessReadback {
    /// The durable value is byte-equivalent at the secret-key boundary.
    Exact,
    /// The backend has no identity entry after the write.
    Missing,
    /// The backend returned a different identity.
    Mismatch,
    /// The backend returned bytes that do not decode as a current blob.
    CorruptCurrentBlob,
    /// The backend could not be read after the write.
    Unreachable,
    /// The backend was locked during the read-back.
    Locked,
}

/// Terminal errors produced by strict headless initialization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeadlessResolutionError {
    /// The raw value written for a newly generated K1 could not be decoded.
    /// It must not be cleaned up or replaced during this attempt.
    FreshWriteReadbackCorrupt,
    /// The raw value written for K1 decoded to a different secret/public key.
    FreshWriteReadbackMismatch,
    /// The backend reported that the just-written value was absent.
    FreshWriteReadbackMissing,
    /// The backend could not be read back after accepting the write.
    FreshWriteReadbackUnavailable,
    /// The backend was locked after accepting the write.
    FreshWriteReadbackLocked,
    /// A non-secret persistence or profile operation failed.
    Persistence(String),
}

impl std::fmt::Display for HeadlessResolutionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FreshWriteReadbackCorrupt => formatter.write_str("identity_readback_corrupt"),
            Self::FreshWriteReadbackMismatch => formatter.write_str("identity_readback_mismatch"),
            Self::FreshWriteReadbackMissing => formatter.write_str("identity_readback_missing"),
            Self::FreshWriteReadbackUnavailable => {
                formatter.write_str("identity_readback_unavailable")
            }
            Self::FreshWriteReadbackLocked => formatter.write_str("identity_readback_locked"),
            Self::Persistence(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for HeadlessResolutionError {}

/// Key-store operations needed by identity resolution.
///
/// Implementations must keep secret values inside the store boundary. The
/// resolver only logs public keys and generic operation errors, never values.
pub trait IdentityKeyStore {
    fn probe(&self, name: &str) -> KeyringProbe;
    fn load(&self, name: &str) -> Result<Option<String>, String>;
    fn store(&self, name: &str, value: &str) -> Result<(), String>;
    fn delete(&self, name: &str) -> Result<(), String>;
    /// Verify directly against durable storage, bypassing any in-process cache.
    fn verify_stored(&self, key: &str, expected: &str) -> Result<bool, String>;

    /// Return a typed direct read-back outcome for a strict headless write.
    ///
    /// Existing Tauri implementations inherit the conservative mapping so
    /// their behavior remains unchanged. The headless adapter overrides this
    /// to distinguish missing, locked, unavailable, mismatch, and corrupt raw
    /// values without inspecting secrets or backend error strings.
    fn verify_stored_headless(&self, key: &str, expected: &str) -> HeadlessReadback {
        match self.verify_stored(key, expected) {
            Ok(true) => HeadlessReadback::Exact,
            Ok(false) => HeadlessReadback::Mismatch,
            Err(_) => HeadlessReadback::Unreachable,
        }
    }

    /// Store a fresh headless identity and verify it through the backend's
    /// direct read path. Adapters with a service lock should override this so
    /// the write and raw read-back share one lock scope; compatibility stores
    /// retain the conservative store-then-verify default.
    fn store_and_verify_headless(
        &self,
        key: &str,
        expected: &str,
    ) -> Result<HeadlessReadback, String> {
        self.store(key, expected)?;
        Ok(self.verify_stored_headless(key, expected))
    }
}

pub const IDENTITY_KEY_NAME: &str = "identity";
pub const IDENTITY_FILE_NAME: &str = "identity.key";
pub const MIGRATION_MARKER_NAME: &str = "identity.migrated";

/// Derive the existing marker naming policy used by Tauri's keyring adapter.
pub fn migration_marker_name(service: &str, default_name: &str) -> String {
    if service == "buzz-desktop" || service == "buzz-desktop-dev" {
        default_name.to_string()
    } else {
        format!("identity.{service}.migrated")
    }
}

/// Project already-resolved state into the metadata returned to the frontend.
pub fn project_identity(
    keys: &Keys,
    storage: IdentityStorage,
    lost: bool,
    locked: bool,
    reset_failed: bool,
) -> Result<IdentitySnapshot, String> {
    let pubkey = keys.public_key();
    Ok(IdentitySnapshot {
        pubkey: pubkey.to_hex(),
        display_name: truncated_display_name(&pubkey)?,
        storage: storage.as_str().to_string(),
        lost,
        locked,
        reset_failed,
    })
}

/// Encode a public key for the existing first-8/last-4 display policy.
pub fn truncated_display_name(pubkey: &PublicKey) -> Result<String, String> {
    let bech32 = pubkey
        .to_bech32()
        .map_err(|error| format!("bech32 encode failed: {error}"))?;
    Ok(if bech32.len() > 12 {
        format!("{}…{}", &bech32[..8], &bech32[bech32.len() - 4..])
    } else {
        bech32
    })
}

/// Resolve the identity using an explicit profile and key-store adapter.
///
/// This is the upstream state machine moved out of AppState. In particular,
/// it preserves the existing 0600 file fallback for a genuine first launch or
/// keyring write failure, while marker-only installs enter Lost or
/// KeyringLocked recovery rather than silently rotating the identity.
pub fn resolve_identity_with_store(
    store: &impl IdentityKeyStore,
    profile: &ProfileScope,
) -> Result<ResolvedIdentity, String> {
    resolve_identity_with_mode(store, profile, false).map_err(ResolveError::into_message)
}

/// Resolve an identity using the strict headless write/read-back contract.
///
/// This shares the resolver state machine with the Tauri compatibility path.
/// The only intentional policy difference is a fresh keyring write: the
/// headless path verifies the raw backend before writing its marker, and a
/// corrupt/missing/locked/unavailable read-back is terminal for that attempt.
/// In particular, a corrupt read-back after K1 is never routed through the
/// pre-existing corrupt-profile cleanup/regeneration path.
pub fn resolve_identity_with_headless_store(
    store: &impl IdentityKeyStore,
    profile: &ProfileScope,
) -> Result<ResolvedIdentity, HeadlessResolutionError> {
    resolve_identity_with_mode(store, profile, true).map_err(ResolveError::into_headless)
}

#[derive(Debug)]
enum ResolveError {
    Legacy(String),
    Headless(HeadlessResolutionError),
}

impl From<String> for ResolveError {
    fn from(error: String) -> Self {
        Self::Legacy(error)
    }
}

impl ResolveError {
    fn into_message(self) -> String {
        match self {
            Self::Legacy(error) => error,
            Self::Headless(error) => error.to_string(),
        }
    }

    fn into_headless(self) -> HeadlessResolutionError {
        match self {
            Self::Headless(error) => error,
            Self::Legacy(error) => HeadlessResolutionError::Persistence(error),
        }
    }
}

fn resolve_identity_with_mode(
    store: &impl IdentityKeyStore,
    profile: &ProfileScope,
    strict_headless: bool,
) -> Result<ResolvedIdentity, ResolveError> {
    let legacy_path = profile.legacy_identity_path();

    match store.probe(IDENTITY_KEY_NAME) {
        KeyringProbe::Present => {
            if let Some(nsec) = store.load(IDENTITY_KEY_NAME)? {
                match Keys::parse(nsec.trim()) {
                    Ok(keyring_keys) => {
                        eprintln!(
                            "buzz-desktop: persisted identity pubkey {}",
                            keyring_keys.public_key().to_hex()
                        );
                        if legacy_path.exists() {
                            match load_key_file(legacy_path) {
                                Ok(file_keys)
                                    if file_keys.public_key() != keyring_keys.public_key() =>
                                {
                                    eprintln!(
                                        "buzz-desktop: identity.key differs from keyring; adopting imported key {}",
                                        file_keys.public_key().to_hex()
                                    );
                                    let storage = if let Err(error) =
                                        persist_identity_to_keyring(store, &file_keys, profile)
                                    {
                                        eprintln!(
                                            "buzz-desktop: keyring adoption failed ({error}); using file key, will retry next boot"
                                        );
                                        IdentityStorage::LocalFile
                                    } else {
                                        IdentityStorage::SystemKeyring
                                    };
                                    return Ok(ResolvedIdentity {
                                        keys: file_keys,
                                        recovery: RecoveryState::None,
                                        storage,
                                    });
                                }
                                Err(error) => {
                                    eprintln!(
                                        "buzz-desktop: leftover identity.key is corrupt ({error}); keyring is authoritative, removing"
                                    );
                                    ensure_marker_then_cleanup(profile);
                                }
                                Ok(_) => ensure_marker_then_cleanup(profile),
                            }
                        }
                        if !legacy_path.exists() && !profile.migration_marker_path().exists() {
                            if let Err(error) = write_migration_marker(profile) {
                                eprintln!(
                                    "buzz-desktop: keyring present but marker missing; self-heal marker write failed ({error}), continuing"
                                );
                            }
                        }
                        return Ok(ResolvedIdentity {
                            keys: keyring_keys,
                            recovery: RecoveryState::None,
                            storage: IdentityStorage::SystemKeyring,
                        });
                    }
                    Err(error) => {
                        return recover_from_keyring(
                            store,
                            profile,
                            &error.to_string(),
                            strict_headless,
                            false,
                        );
                    }
                }
            }
        }
        KeyringProbe::ReachableButEmpty => {
            if legacy_path.exists() {
                if let Some(keys) = migrate_identity_file(store, profile)? {
                    return Ok(ResolvedIdentity {
                        keys,
                        recovery: RecoveryState::None,
                        storage: IdentityStorage::SystemKeyring,
                    });
                }
            } else if profile.migration_marker_path().exists() {
                let ephemeral = Keys::generate();
                eprintln!(
                    "buzz-desktop: identity lost — keyring was empty despite migration marker; using ephemeral public key {}, awaiting user re-import",
                    ephemeral.public_key().to_hex()
                );
                return Ok(ResolvedIdentity {
                    keys: ephemeral,
                    recovery: RecoveryState::Lost,
                    storage: IdentityStorage::Ephemeral,
                });
            }
        }
        KeyringProbe::Unreachable => {
            if !legacy_path.exists() && profile.migration_marker_path().exists() {
                let ephemeral = Keys::generate();
                eprintln!(
                    "buzz-desktop: keyring unreachable but migration marker present; booting keyring-locked recovery with ephemeral public key {}",
                    ephemeral.public_key().to_hex()
                );
                return Ok(ResolvedIdentity {
                    keys: ephemeral,
                    recovery: RecoveryState::KeyringLocked,
                    storage: IdentityStorage::Ephemeral,
                });
            }
            let keys = load_file_or_generate(profile)?;
            return Ok(ResolvedIdentity {
                keys,
                recovery: RecoveryState::None,
                storage: IdentityStorage::LocalFile,
            });
        }
        KeyringProbe::CorruptCurrentBlob => {
            return recover_from_keyring(
                store,
                profile,
                "current identity blob decode failed",
                strict_headless,
                true,
            );
        }
    }

    let (keys, storage) = if strict_headless {
        generate_and_persist_headless(store, profile).map_err(ResolveError::Headless)?
    } else {
        generate_and_persist(store, profile)?
    };
    Ok(ResolvedIdentity {
        keys,
        recovery: RecoveryState::None,
        storage,
    })
}

fn recover_from_keyring(
    store: &impl IdentityKeyStore,
    profile: &ProfileScope,
    error: &str,
    strict_headless: bool,
    preexisting_corrupt_blob: bool,
) -> Result<ResolvedIdentity, ResolveError> {
    eprintln!(
        "buzz-desktop: corrupt nsec in keyring ({error}), looking for a recovery path before clearing"
    );
    let mut preexisting_blob_cleared = false;
    let has_valid_file = profile.legacy_identity_path().exists()
        && load_key_file(profile.legacy_identity_path()).is_ok();
    if has_valid_file {
        // A valid same-profile file is the first recovery authority. A strict
        // adapter may replace a pre-existing corrupt blob only for this
        // explicit file-recovery path; a marker-only profile must retain the
        // corrupt evidence and enter Lost below without deletion or rotation.
        if strict_headless && preexisting_corrupt_blob {
            match store.delete(IDENTITY_KEY_NAME) {
                Ok(()) => preexisting_blob_cleared = true,
                Err(error) => {
                    eprintln!("buzz-desktop: failed to clear corrupt keyring value: {error}");
                }
            }
        }
        if let Some(keys) = migrate_identity_file(store, profile)? {
            return Ok(ResolvedIdentity {
                keys,
                recovery: RecoveryState::None,
                storage: IdentityStorage::SystemKeyring,
            });
        }
    }
    if profile.migration_marker_path().exists() {
        let ephemeral = Keys::generate();
        eprintln!(
            "buzz-desktop: identity lost — keyring value failed to parse and no valid identity.key backup exists; using ephemeral public key {}, awaiting user re-import",
            ephemeral.public_key().to_hex()
        );
        return Ok(ResolvedIdentity {
            keys: ephemeral,
            recovery: RecoveryState::Lost,
            storage: IdentityStorage::Ephemeral,
        });
    }
    // Only a profile with neither a valid file nor a migration marker may
    // clean up a pre-existing corrupt blob before generating K1. Marker-only
    // recovery intentionally returns above without deletion or rotation.
    if !preexisting_blob_cleared {
        if let Err(error) = store.delete(IDENTITY_KEY_NAME) {
            eprintln!("buzz-desktop: failed to clear corrupt keyring value: {error}");
        }
    }
    let (keys, storage) = if strict_headless {
        generate_and_persist_headless(store, profile).map_err(ResolveError::Headless)?
    } else {
        generate_and_persist(store, profile)?
    };
    Ok(ResolvedIdentity {
        keys,
        recovery: RecoveryState::None,
        storage,
    })
}

/// Load the 0600 identity file, quarantining corruption, or generate/save a
/// fresh key when the profile has no durable identity yet.
pub fn load_file_or_generate(profile: &ProfileScope) -> Result<Keys, String> {
    let path = profile.legacy_identity_path();
    if path.exists() {
        match load_key_file(path) {
            Ok(keys) => {
                eprintln!(
                    "buzz-desktop: persisted identity pubkey {}",
                    keys.public_key().to_hex()
                );
                return Ok(keys);
            }
            Err(error) => quarantine_corrupt_key(path, profile.data_dir(), &error),
        }
    }
    let keys = Keys::generate();
    save_key_file(path, &keys)?;
    eprintln!(
        "buzz-desktop: generated and saved identity pubkey {}",
        keys.public_key().to_hex()
    );
    Ok(keys)
}

fn migrate_identity_file(
    store: &impl IdentityKeyStore,
    profile: &ProfileScope,
) -> Result<Option<Keys>, String> {
    let path = profile.legacy_identity_path();
    let keys = match load_key_file(path) {
        Ok(keys) => keys,
        Err(error) => {
            eprintln!("buzz-desktop: corrupt identity.key during migration ({error}), skipping");
            return Ok(None);
        }
    };
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|error| format!("encode nsec: {error}"))?;
    store.store(IDENTITY_KEY_NAME, &nsec)?;
    match store.verify_stored(IDENTITY_KEY_NAME, &nsec) {
        Ok(true) => {}
        Ok(false) => return Err("keyring read-back verify failed for identity key".to_string()),
        Err(error) => return Err(format!("keyring read-back verify failed: {error}")),
    }
    if let Err(error) = write_migration_marker(profile) {
        eprintln!(
            "buzz-desktop: keyring import ok but failed to write migration marker ({error}); keeping identity.key"
        );
        return Ok(Some(keys));
    }
    if let Err(error) = std::fs::remove_file(path) {
        eprintln!("buzz-desktop: keyring import ok but failed to delete identity.key: {error}");
    } else {
        eprintln!("buzz-desktop: migrated identity key into OS keyring");
    }
    Ok(Some(keys))
}

/// Persist a key in the keyring with read-back verification and marker-before-
/// delete ordering. Callers may retain the file fallback when this fails.
pub fn persist_identity_to_keyring(
    store: &impl IdentityKeyStore,
    keys: &Keys,
    profile: &ProfileScope,
) -> Result<(), String> {
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|error| format!("encode nsec: {error}"))?;
    store.store(IDENTITY_KEY_NAME, &nsec)?;
    match store.verify_stored(IDENTITY_KEY_NAME, &nsec) {
        Ok(true) => {}
        Ok(false) => return Err("keyring read-back verify failed".to_string()),
        Err(error) => return Err(format!("keyring read-back verify failed: {error}")),
    }
    if let Err(error) = write_migration_marker(profile) {
        if !profile.legacy_identity_path().exists() {
            save_key_file(profile.legacy_identity_path(), keys).map_err(|write_error| {
                format!(
                    "keyring ok but neither migration marker nor identity.key fallback could be written (marker: {error}; file: {write_error})"
                )
            })?;
        }
        eprintln!(
            "buzz-desktop: keyring ok but marker write failed ({error}); keeping identity.key fallback"
        );
        return Ok(());
    }
    cleanup_leftover_identity_file(profile.legacy_identity_path());
    Ok(())
}

/// Persist an imported/current key, using the existing keyring-first then
/// 0600-file fallback policy.
pub fn persist_imported_identity(
    store: &impl IdentityKeyStore,
    keys: &Keys,
    profile: &ProfileScope,
) -> Result<IdentityStorage, String> {
    match persist_identity_to_keyring(store, keys, profile) {
        Ok(()) => Ok(IdentityStorage::SystemKeyring),
        Err(error) => {
            eprintln!(
                "buzz-desktop: keyring write failed during import ({error}), falling back to identity.key"
            );
            save_key_file(profile.legacy_identity_path(), keys)?;
            Ok(IdentityStorage::LocalFile)
        }
    }
}

fn generate_and_persist(
    store: &impl IdentityKeyStore,
    profile: &ProfileScope,
) -> Result<(Keys, IdentityStorage), String> {
    let keys = Keys::generate();
    let storage = store_key_preferring_keyring(store, &keys, profile)?;
    if storage == IdentityStorage::SystemKeyring {
        if let Err(error) = write_migration_marker(profile) {
            eprintln!(
                "buzz-desktop: stored identity in keyring but failed to write migration marker ({error}); saving identity.key fallback"
            );
            save_key_file(profile.legacy_identity_path(), &keys)?;
        }
    }
    eprintln!(
        "buzz-desktop: generated and saved identity pubkey {}",
        keys.public_key().to_hex()
    );
    Ok((keys, storage))
}

/// Generate and persist a fresh identity for the strict headless consumer.
///
/// The legacy Tauri path intentionally remains in `generate_and_persist`.
/// Here, a successful store is only provisional until the raw backend has been
/// decoded and compared against K1. A corrupt/missing/locked/unavailable
/// read-back is terminal for this attempt: no marker, delete, cleanup, or K2
/// generation is allowed.
fn generate_and_persist_headless(
    store: &impl IdentityKeyStore,
    profile: &ProfileScope,
) -> Result<(Keys, IdentityStorage), HeadlessResolutionError> {
    let keys = Keys::generate();
    let nsec = keys.secret_key().to_bech32().map_err(|error| {
        HeadlessResolutionError::Persistence(format!("encode identity: {error}"))
    })?;

    let readback = match store.store_and_verify_headless(IDENTITY_KEY_NAME, &nsec) {
        Ok(readback) => readback,
        Err(error) => {
            // Preserve the existing first-launch write-failure fallback. This
            // is before the backend has reported a successful K1
            // write/read-back attempt, so a same-profile 0600 file remains an
            // honest authority.
            persist_headless_file_fallback(
                profile,
                &keys,
                &format!("identity keyring write failed ({error})"),
            )?;
            return Ok((keys, IdentityStorage::LocalFile));
        }
    };

    match readback {
        HeadlessReadback::Exact => {}
        HeadlessReadback::Missing => {
            return Err(HeadlessResolutionError::FreshWriteReadbackMissing)
        }
        HeadlessReadback::Mismatch => {
            return Err(HeadlessResolutionError::FreshWriteReadbackMismatch)
        }
        HeadlessReadback::CorruptCurrentBlob => {
            return Err(HeadlessResolutionError::FreshWriteReadbackCorrupt)
        }
        HeadlessReadback::Unreachable => {
            return Err(HeadlessResolutionError::FreshWriteReadbackUnavailable)
        }
        HeadlessReadback::Locked => return Err(HeadlessResolutionError::FreshWriteReadbackLocked),
    }

    if let Err(error) = write_migration_marker(profile) {
        // Preserve the existing marker-failure fallback, but never report the
        // keyring as authoritative without its marker. The same K1 is written
        // to the profile file and returned as local-file storage.
        persist_headless_file_fallback(
            profile,
            &keys,
            &format!("identity marker write failed ({error})"),
        )?;
        return Ok((keys, IdentityStorage::LocalFile));
    }

    cleanup_leftover_identity_file(profile.legacy_identity_path());
    Ok((keys, IdentityStorage::SystemKeyring))
}

fn persist_headless_file_fallback(
    profile: &ProfileScope,
    keys: &Keys,
    reason: &str,
) -> Result<(), HeadlessResolutionError> {
    save_key_file(profile.legacy_identity_path(), keys).map_err(|file_error| {
        HeadlessResolutionError::Persistence(format!(
            "{reason}; file fallback write failed ({file_error})"
        ))
    })?;

    let persisted = load_key_file(profile.legacy_identity_path()).map_err(|_| {
        HeadlessResolutionError::Persistence(format!("{reason}; file fallback read-back failed"))
    })?;
    if !same_key_material(keys, &persisted) {
        return Err(HeadlessResolutionError::Persistence(format!(
            "{reason}; file fallback read-back mismatch"
        )));
    }
    Ok(())
}

fn same_key_material(expected: &Keys, actual: &Keys) -> bool {
    expected.public_key() == actual.public_key()
        && expected.secret_key().as_secret_bytes() == actual.secret_key().as_secret_bytes()
}

fn store_key_preferring_keyring(
    store: &impl IdentityKeyStore,
    keys: &Keys,
    profile: &ProfileScope,
) -> Result<IdentityStorage, String> {
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|error| format!("encode nsec: {error}"))?;
    match store.store(IDENTITY_KEY_NAME, &nsec) {
        Ok(()) => Ok(IdentityStorage::SystemKeyring),
        Err(error) => {
            eprintln!("buzz-desktop: keyring write failed ({error}), using file fallback");
            save_key_file(profile.legacy_identity_path(), keys)?;
            Ok(IdentityStorage::LocalFile)
        }
    }
}

fn write_migration_marker(profile: &ProfileScope) -> Result<(), String> {
    write_migration_marker_at(&profile.migration_marker_path())
}

/// Atomically write a migration marker at an explicit path.
pub fn write_migration_marker_at(marker_path: &Path) -> Result<(), String> {
    use atomic_write_file::AtomicWriteFile;

    let mut file = AtomicWriteFile::open(marker_path)
        .map_err(|error| format!("open migration marker for atomic write: {error}"))?;
    file.write_all(b"1")
        .map_err(|error| format!("write migration marker: {error}"))?;
    file.commit()
        .map_err(|error| format!("commit migration marker: {error}"))
}

fn ensure_marker_then_cleanup(profile: &ProfileScope) {
    let marker_ok = profile.migration_marker_path().exists()
        || write_migration_marker(profile)
            .map_err(|error| {
                eprintln!(
                    "buzz-desktop: keyring present but marker missing; failed to write marker ({error}), keeping identity.key"
                );
            })
            .is_ok();
    if marker_ok {
        cleanup_leftover_identity_file(profile.legacy_identity_path());
    }
}

/// Remove a stale plaintext file once the keyring is authoritative.
pub fn cleanup_leftover_identity_file(path: &Path) {
    if !path.exists() {
        return;
    }
    match std::fs::remove_file(path) {
        Ok(()) => eprintln!("buzz-desktop: removed leftover identity.key (key is in keyring)"),
        Err(error) => eprintln!("buzz-desktop: failed to remove leftover identity.key: {error}"),
    }
}

fn quarantine_corrupt_key(key_path: &Path, data_dir: &Path, error: &str) {
    if !key_path.exists() {
        return;
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let bad_path = data_dir.join(format!("identity.key.bad.{timestamp}"));
    eprintln!(
        "buzz-desktop: corrupt identity.key ({error}), quarantining to {}",
        bad_path.display()
    );
    if std::fs::rename(key_path, &bad_path).is_err() {
        let _ = std::fs::remove_file(key_path);
    }
}

pub fn load_key_file(path: &Path) -> Result<Keys, String> {
    let content =
        std::fs::read_to_string(path).map_err(|error| format!("read identity.key: {error}"))?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("empty identity.key".to_string());
    }
    Keys::parse(trimmed).map_err(|error| format!("parse identity.key: {error}"))
}

/// Atomically write an nsec to an owner-readable identity file.
pub fn save_key_file(path: &Path, keys: &Keys) -> Result<(), String> {
    use atomic_write_file::AtomicWriteFile;

    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|error| format!("encode nsec: {error}"))?;
    let mut file = AtomicWriteFile::open(path)
        .map_err(|error| format!("open identity.key for atomic write: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("set identity.key permissions: {error}"))?;
    }
    file.write_all(nsec.as_bytes())
        .map_err(|error| format!("write identity.key: {error}"))?;
    file.commit()
        .map_err(|error| format!("commit identity.key: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, cell::RefCell, collections::HashMap};

    struct FakeStore {
        probe: KeyringProbe,
        slot: RefCell<HashMap<String, String>>,
        fail_store: bool,
    }

    impl FakeStore {
        fn empty() -> Self {
            Self {
                probe: KeyringProbe::ReachableButEmpty,
                slot: RefCell::new(HashMap::new()),
                fail_store: false,
            }
        }

        fn unreachable() -> Self {
            Self {
                probe: KeyringProbe::Unreachable,
                slot: RefCell::new(HashMap::new()),
                fail_store: false,
            }
        }

        fn failing() -> Self {
            Self {
                probe: KeyringProbe::ReachableButEmpty,
                slot: RefCell::new(HashMap::new()),
                fail_store: true,
            }
        }
    }

    impl IdentityKeyStore for FakeStore {
        fn probe(&self, _name: &str) -> KeyringProbe {
            self.probe
        }

        fn load(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.slot.borrow().get(name).cloned())
        }

        fn store(&self, name: &str, value: &str) -> Result<(), String> {
            if self.fail_store {
                return Err("simulated keyring write failure".to_string());
            }
            self.slot
                .borrow_mut()
                .insert(name.to_string(), value.to_string());
            Ok(())
        }

        fn delete(&self, name: &str) -> Result<(), String> {
            self.slot.borrow_mut().remove(name);
            Ok(())
        }

        fn verify_stored(&self, name: &str, expected: &str) -> Result<bool, String> {
            Ok(self
                .slot
                .borrow()
                .get(name)
                .is_some_and(|value| value == expected))
        }
    }

    fn scope(path: &Path) -> ProfileScope {
        ProfileScope::for_keyring_service(path, "buzz-desktop-dev.identity-kernel-test")
    }

    #[test]
    fn fresh_keyring_profile_restarts_with_same_public_key() {
        let dir = tempfile::tempdir().expect("temp profile");
        let profile = scope(dir.path());
        let first = FakeStore::empty();
        let resolved = resolve_identity_with_store(&first, &profile).expect("first resolve");
        let stored = first
            .slot
            .borrow()
            .get(IDENTITY_KEY_NAME)
            .cloned()
            .expect("identity stored");

        let reboot = FakeStore {
            probe: KeyringProbe::Present,
            slot: RefCell::new(HashMap::from([(IDENTITY_KEY_NAME.to_string(), stored)])),
            fail_store: false,
        };
        let resolved_again =
            resolve_identity_with_store(&reboot, &profile).expect("repeat resolve");
        assert_eq!(
            resolved.keys.public_key(),
            resolved_again.keys.public_key(),
            "repeat initialization must not rotate the identity"
        );
    }

    #[test]
    fn independent_profiles_do_not_cross_read() {
        let first_dir = tempfile::tempdir().expect("first profile");
        let second_dir = tempfile::tempdir().expect("second profile");
        let first = resolve_identity_with_store(&FakeStore::empty(), &scope(first_dir.path()))
            .expect("first resolve");
        let second =
            resolve_identity_with_store(&FakeStore::unreachable(), &scope(second_dir.path()))
                .expect("second resolve");
        assert_ne!(first.keys.public_key(), second.keys.public_key());
        assert!(
            second_dir.path().join(IDENTITY_FILE_NAME).exists(),
            "the isolated unreachable profile may use its own 0600 fallback, but must not read the first profile"
        );
    }

    #[test]
    fn metadata_projection_does_not_initialize_or_persist() {
        let keys = Keys::generate();
        let snapshot = project_identity(&keys, IdentityStorage::Ephemeral, true, false, false)
            .expect("metadata projection");
        assert_eq!(snapshot.storage, "ephemeral");
        assert!(snapshot.lost);
        assert!(!snapshot.locked);
        assert_eq!(snapshot.pubkey, keys.public_key().to_hex());
    }

    #[test]
    fn marker_only_unreachable_profile_enters_locked_recovery() {
        let dir = tempfile::tempdir().expect("temp profile");
        let profile = scope(dir.path());
        std::fs::write(profile.migration_marker_path(), b"1").expect("marker");
        let resolved = resolve_identity_with_store(&FakeStore::unreachable(), &profile)
            .expect("locked recovery");
        assert_eq!(resolved.recovery, RecoveryState::KeyringLocked);
        assert!(!profile.legacy_identity_path().exists());
    }

    #[test]
    fn keyring_write_failure_preserves_existing_file_fallback() {
        let dir = tempfile::tempdir().expect("temp profile");
        let profile = scope(dir.path());
        let resolved =
            resolve_identity_with_store(&FakeStore::failing(), &profile).expect("file fallback");
        assert_eq!(resolved.storage, IdentityStorage::LocalFile);
        let from_file = load_key_file(profile.legacy_identity_path()).expect("fallback key");
        assert_eq!(resolved.keys.public_key(), from_file.public_key());
    }

    struct HeadlessReadbackFake {
        probe: KeyringProbe,
        slot: RefCell<HashMap<String, String>>,
        readback: Cell<HeadlessReadback>,
        generated_values: RefCell<Vec<String>>,
        store_calls: Cell<usize>,
        delete_calls: Cell<usize>,
    }

    impl HeadlessReadbackFake {
        fn new(probe: KeyringProbe, readback: HeadlessReadback) -> Self {
            Self {
                probe,
                slot: RefCell::new(HashMap::new()),
                readback: Cell::new(readback),
                generated_values: RefCell::new(Vec::new()),
                store_calls: Cell::new(0),
                delete_calls: Cell::new(0),
            }
        }
    }

    impl IdentityKeyStore for HeadlessReadbackFake {
        fn probe(&self, _name: &str) -> KeyringProbe {
            self.probe
        }

        fn load(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.slot.borrow().get(name).cloned())
        }

        fn store(&self, name: &str, value: &str) -> Result<(), String> {
            self.store_calls.set(self.store_calls.get() + 1);
            self.generated_values.borrow_mut().push(value.to_string());
            self.slot
                .borrow_mut()
                .insert(name.to_string(), value.to_string());
            Ok(())
        }

        fn delete(&self, name: &str) -> Result<(), String> {
            self.delete_calls.set(self.delete_calls.get() + 1);
            self.slot.borrow_mut().remove(name);
            Ok(())
        }

        fn verify_stored(&self, name: &str, expected: &str) -> Result<bool, String> {
            Ok(self
                .slot
                .borrow()
                .get(name)
                .is_some_and(|value| value == expected))
        }

        fn verify_stored_headless(&self, _name: &str, _expected: &str) -> HeadlessReadback {
            self.readback.get()
        }
    }

    #[test]
    fn fresh_write_readback_corrupt_is_terminal_without_k2_or_cleanup() {
        let dir = tempfile::tempdir().expect("temp profile");
        let profile = scope(dir.path());
        let store = HeadlessReadbackFake::new(
            KeyringProbe::ReachableButEmpty,
            HeadlessReadback::CorruptCurrentBlob,
        );

        let error = resolve_identity_with_headless_store(&store, &profile)
            .expect_err("fresh corrupt read-back must not initialize");
        assert_eq!(error, HeadlessResolutionError::FreshWriteReadbackCorrupt);
        assert_eq!(
            store.generated_values.borrow().len(),
            1,
            "only K1 may be generated"
        );
        assert_eq!(store.store_calls.get(), 1, "only K1 may be written");
        assert_eq!(
            store.delete_calls.get(),
            0,
            "fresh read-back failure must not delete"
        );
        assert!(!profile.migration_marker_path().exists());
        assert!(!profile.legacy_identity_path().exists());
    }

    #[test]
    fn fresh_write_readback_mismatch_is_terminal_without_marker() {
        let dir = tempfile::tempdir().expect("temp profile");
        let profile = scope(dir.path());
        let store =
            HeadlessReadbackFake::new(KeyringProbe::ReachableButEmpty, HeadlessReadback::Mismatch);

        let error = resolve_identity_with_headless_store(&store, &profile)
            .expect_err("fresh mismatch must not initialize");
        assert_eq!(error, HeadlessResolutionError::FreshWriteReadbackMismatch);
        assert_eq!(store.store_calls.get(), 1);
        assert_eq!(store.delete_calls.get(), 0);
        assert!(!profile.migration_marker_path().exists());
    }

    #[test]
    fn initial_corrupt_probe_keeps_existing_recovery_order() {
        let dir = tempfile::tempdir().expect("temp profile");
        let profile = scope(dir.path());
        let file_keys = Keys::generate();
        save_key_file(profile.legacy_identity_path(), &file_keys).expect("file identity");
        let store =
            HeadlessReadbackFake::new(KeyringProbe::CorruptCurrentBlob, HeadlessReadback::Exact);

        let resolved = resolve_identity_with_headless_store(&store, &profile)
            .expect("pre-existing corrupt blob should recover the valid file");
        assert_eq!(resolved.keys.public_key(), file_keys.public_key());
        assert_eq!(store.store_calls.get(), 1);
        assert!(profile.migration_marker_path().exists());
    }

    #[test]
    fn initial_corrupt_probe_can_cleanup_before_regeneration() {
        let dir = tempfile::tempdir().expect("temp profile");
        let profile = scope(dir.path());
        let store =
            HeadlessReadbackFake::new(KeyringProbe::CorruptCurrentBlob, HeadlessReadback::Exact);

        let resolved = resolve_identity_with_headless_store(&store, &profile)
            .expect("initial corrupt blob may use cleanup recovery");
        assert_eq!(resolved.storage, IdentityStorage::SystemKeyring);
        assert_eq!(
            store.delete_calls.get(),
            1,
            "cleanup may delete pre-existing blob"
        );
        assert_eq!(
            store.store_calls.get(),
            1,
            "cleanup recovery generates only K1"
        );
        assert!(profile.migration_marker_path().exists());
    }
}
