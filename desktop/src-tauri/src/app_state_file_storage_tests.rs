//! Unsigned Mac builds: secrets in owner-only files, no Keychain.
//!
//! The owner was signed out after every Mac update because an ad-hoc signed
//! build cannot read the Keychain item the previous release created. These
//! tests pin the file-only path that unsigned builds ship with, and the
//! hand-over to a signed (keyring) build later. They use an in-memory fake,
//! never the real Keychain.

use super::*;
use crate::secret_store::KeyringProbe;
use nostr::ToBech32;
use std::cell::RefCell;
use std::collections::HashMap;

fn assert_key_eq(a: &Keys, b: &Keys) {
    assert_eq!(a.public_key().to_hex(), b.public_key().to_hex());
}

/// In-memory identity store with a fixed probe result.
struct FakeKeychain {
    probe: KeyringProbe,
    slot: RefCell<HashMap<String, String>>,
}

impl FakeKeychain {
    fn new(probe: KeyringProbe, seed: Option<&str>) -> Self {
        let slot = seed
            .map(|value| HashMap::from([(IDENTITY_KEY_NAME.to_string(), value.to_string())]))
            .unwrap_or_default();
        Self {
            probe,
            slot: RefCell::new(slot),
        }
    }
}

impl IdentityKeyStore for FakeKeychain {
    fn probe(&self, _name: &str) -> KeyringProbe {
        self.probe
    }
    fn load(&self, name: &str) -> Result<Option<String>, String> {
        Ok(self.slot.borrow().get(name).cloned())
    }
    fn store(&self, name: &str, value: &str) -> Result<(), String> {
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

/// An install an older, Keychain-backed build already migrated: the migration
/// marker exists, `identity.key` does not.
fn keychain_era_profile() -> (tempfile::TempDir, ProfileScope) {
    let dir = tempfile::tempdir().unwrap();
    let legacy_path = dir.path().join("identity.key");
    write_migration_marker(&migration_marker_path(dir.path())).unwrap();
    let profile = profile_scope(&legacy_path, dir.path());
    (dir, profile)
}

#[test]
fn file_only_build_keeps_the_signed_in_key_across_updates() {
    let (_dir, profile) = keychain_era_profile();

    // First boot of the fixed build: the Keychain key is out of reach, so it
    // boots like a fresh install and the sign-in flow can complete. Not a
    // locked or lost dead end.
    let first = resolve_identity_from_file(&profile).unwrap();
    assert_eq!(first.storage, IdentityStorage::LocalFile);
    assert_eq!(first.recovery, RecoveryState::None);
    assert!(profile.legacy_identity_path().exists());

    // The owner signs in once: the restored key is written to identity.key.
    let restored = Keys::generate();
    let storage = persist_identity_to_file(&restored, &profile).unwrap();
    assert_eq!(storage, IdentityStorage::LocalFile);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(profile.legacy_identity_path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "identity.key must be owner-only");
    }

    // The update: a new process over the same data directory resolves the same
    // public key from the file.
    let after_update = resolve_identity_from_file(&profile).unwrap();
    assert_key_eq(&restored, &after_update.keys);
    assert_eq!(after_update.storage, IdentityStorage::LocalFile);
    assert_eq!(after_update.recovery, RecoveryState::None);
    assert_ne!(
        first.keys.public_key(),
        after_update.keys.public_key(),
        "the throwaway first-boot key is replaced by the restored one"
    );
}

#[test]
fn signed_build_adopts_the_file_key_into_the_keychain_and_drops_the_file() {
    // Apple signing arrives later. The file key an unsigned build kept must
    // move into the Keychain with the same public key, and the plaintext file
    // must go. Uses the in-memory fake, never the real Keychain.
    let (_dir, profile) = keychain_era_profile();
    let restored = Keys::generate();
    persist_identity_to_file(&restored, &profile).unwrap();

    let store = FakeKeychain::new(KeyringProbe::ReachableButEmpty, None);
    let resolved =
        resolve_identity_with_store(&store, profile.legacy_identity_path(), profile.data_dir())
            .unwrap();

    assert_key_eq(&restored, &resolved.keys);
    assert_eq!(resolved.storage, IdentityStorage::SystemKeyring);
    let nsec = restored.secret_key().to_bech32().unwrap();
    assert_eq!(
        store
            .slot
            .borrow()
            .get(IDENTITY_KEY_NAME)
            .map(String::as_str),
        Some(nsec.as_str())
    );
    assert!(
        !profile.legacy_identity_path().exists(),
        "the file is removed once the Keychain holds the key"
    );
    assert!(profile.migration_marker_path().exists());
}

#[test]
fn signed_build_replaces_a_stale_keychain_key_with_the_file_key() {
    // The Keychain still holds the item an old ad-hoc build wrote, readable
    // now that the app is properly signed. If it differs from the key the
    // owner restored into identity.key, the restored key wins.
    let (_dir, profile) = keychain_era_profile();
    let restored = Keys::generate();
    persist_identity_to_file(&restored, &profile).unwrap();
    let stale = Keys::generate().secret_key().to_bech32().unwrap();

    let store = FakeKeychain::new(KeyringProbe::Present, Some(&stale));
    let resolved =
        resolve_identity_with_store(&store, profile.legacy_identity_path(), profile.data_dir())
            .unwrap();

    assert_key_eq(&restored, &resolved.keys);
    assert_eq!(resolved.storage, IdentityStorage::SystemKeyring);
}

#[test]
fn signed_build_with_unreadable_keychain_keeps_using_the_file_key() {
    // A Keychain item the new signature is not trusted for must never push the
    // owner back to a sign-in: the file key keeps working and adoption retries
    // on a later boot.
    let (_dir, profile) = keychain_era_profile();
    let restored = Keys::generate();
    persist_identity_to_file(&restored, &profile).unwrap();

    let store = FakeKeychain::new(KeyringProbe::Unreachable, None);
    let resolved =
        resolve_identity_with_store(&store, profile.legacy_identity_path(), profile.data_dir())
            .unwrap();

    assert_key_eq(&restored, &resolved.keys);
    assert_eq!(resolved.storage, IdentityStorage::LocalFile);
    assert_eq!(resolved.recovery, RecoveryState::None);
    assert!(profile.legacy_identity_path().exists());
}

/// The adapters the app actually calls, in the build that ships on unsigned
/// Macs. Compiled out of keyring builds so these never reach a real Keychain.
#[cfg(not(feature = "system-keyring"))]
#[test]
fn unsigned_build_adapters_survive_an_update_without_the_keychain() {
    let dir = tempfile::tempdir().unwrap();
    let legacy_path = dir.path().join("identity.key");
    write_migration_marker(&migration_marker_path(dir.path())).unwrap();

    let first = load_or_create_identity(dir.path()).unwrap();
    assert_eq!(first.storage, IdentityStorage::LocalFile);

    let restored = Keys::generate();
    let storage = persist_imported_identity(&restored, &legacy_path, dir.path()).unwrap();
    assert_eq!(storage, IdentityStorage::LocalFile);

    let after_update = load_or_create_identity(dir.path()).unwrap();
    assert_key_eq(&restored, &after_update.keys);
    assert_eq!(after_update.storage, IdentityStorage::LocalFile);
    assert_eq!(after_update.recovery, RecoveryState::None);
}
