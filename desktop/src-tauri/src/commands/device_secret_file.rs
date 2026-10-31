//! Owner-only file storage for device-scoped company credentials.
//!
//! A build without `system-keyring` (every unsigned Mac build) never touches
//! the OS keychain, because an ad-hoc signed app loses access to its own
//! Keychain items on every release. Its credentials live in one JSON map in the
//! app data directory, written atomically with mode 0600 (the same storage
//! `identity.key` uses).

use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use atomic_write_file::AtomicWriteFile;

use super::company_secrets::DeviceSecretStore;

/// File name inside the app data directory.
pub(super) const DEVICE_SECRETS_FILE: &str = "device-secrets.json";

/// Serializes read-modify-write cycles inside this process.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[cfg_attr(feature = "system-keyring", allow(dead_code))]
pub(super) struct FileSecretStore {
    path: PathBuf,
}

#[cfg_attr(feature = "system-keyring", allow(dead_code))]
impl FileSecretStore {
    pub(super) fn in_dir(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(DEVICE_SECRETS_FILE),
        }
    }

    fn read_map(&self) -> Result<BTreeMap<String, String>, String> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) if text.trim().is_empty() => Ok(BTreeMap::new()),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|_| "device secrets file is not readable".to_owned()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(_) => Err("device secrets file is not readable".to_owned()),
        }
    }

    fn write_map(&self, map: &BTreeMap<String, String>) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| format!("create data dir: {error}"))?;
        }
        let json = serde_json::to_vec(map).map_err(|error| format!("encode secrets: {error}"))?;
        let mut file = AtomicWriteFile::open(&self.path)
            .map_err(|error| format!("open device secrets for atomic write: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|error| format!("set device secrets permissions: {error}"))?;
        }
        file.write_all(&json)
            .map_err(|error| format!("write device secrets: {error}"))?;
        file.commit()
            .map_err(|error| format!("commit device secrets: {error}"))
    }

    fn mutate(&self, change: impl FnOnce(&mut BTreeMap<String, String>)) -> Result<(), String> {
        let _guard = WRITE_LOCK.lock().map_err(|_| "secrets lock poisoned")?;
        let mut map = self.read_map()?;
        change(&mut map);
        self.write_map(&map)
    }
}

#[cfg_attr(feature = "system-keyring", allow(dead_code))]
impl FileSecretStore {
    /// Add the entries whose key is not stored yet, in one atomic write, and
    /// return how many were added. A value already stored is never replaced:
    /// it is newer than anything an older build left behind.
    pub(super) fn store_all_if_absent(
        &self,
        entries: &BTreeMap<String, String>,
    ) -> Result<usize, String> {
        let _guard = WRITE_LOCK.lock().map_err(|_| "secrets lock poisoned")?;
        let mut map = self.read_map()?;
        let before = map.len();
        for (key, value) in entries {
            map.entry(key.clone()).or_insert_with(|| value.clone());
        }
        let added = map.len() - before;
        if added > 0 {
            self.write_map(&map)?;
        }
        Ok(added)
    }
}

impl DeviceSecretStore for FileSecretStore {
    fn store(&self, key: &str, value: &str) -> Result<(), String> {
        self.mutate(|map| {
            map.insert(key.to_owned(), value.to_owned());
        })
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        // Nothing stored yet means nothing to delete: do not create the file.
        if !self.path.exists() {
            return Ok(());
        }
        self.mutate(|map| {
            map.remove(key);
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(dir: &Path) -> BTreeMap<String, String> {
        serde_json::from_str(
            &std::fs::read_to_string(dir.join(DEVICE_SECRETS_FILE)).expect("secrets file"),
        )
        .expect("secrets json")
    }

    #[test]
    fn credentials_survive_a_restart_in_an_owner_only_file() {
        let dir = tempfile::tempdir().expect("data dir");
        FileSecretStore::in_dir(dir.path())
            .store("company-secret:a:1", "first")
            .expect("store first");
        // A new instance over the same directory is what the next update sees.
        FileSecretStore::in_dir(dir.path())
            .store("company-secret:a:2", "second")
            .expect("store second");

        let map = stored(dir.path());
        assert_eq!(
            map.get("company-secret:a:1").map(String::as_str),
            Some("first")
        );
        assert_eq!(
            map.get("company-secret:a:2").map(String::as_str),
            Some("second")
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(DEVICE_SECRETS_FILE))
                .expect("metadata")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "credentials must be owner-only");
        }
    }

    #[test]
    fn delete_removes_only_the_named_credential_and_missing_is_fine() {
        let dir = tempfile::tempdir().expect("data dir");
        let store = FileSecretStore::in_dir(dir.path());
        store.delete("never-stored").expect("delete with no file");
        assert!(
            !dir.path().join(DEVICE_SECRETS_FILE).exists(),
            "deleting from nothing must not create a file"
        );

        store.store("keep", "1").expect("store keep");
        store.store("drop", "2").expect("store drop");
        store.delete("drop").expect("delete drop");
        store.delete("drop").expect("delete again");

        let map = stored(dir.path());
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("keep").map(String::as_str), Some("1"));
    }

    #[test]
    fn an_unreadable_file_is_an_error_and_is_left_untouched() {
        let dir = tempfile::tempdir().expect("data dir");
        let path = dir.path().join(DEVICE_SECRETS_FILE);
        std::fs::write(&path, b"not json").expect("seed corrupt file");

        let error = FileSecretStore::in_dir(dir.path())
            .store("k", "sentinel-9f3a")
            .expect_err("a corrupt file must not be overwritten");
        assert!(
            !error.contains("sentinel-9f3a"),
            "the secret never appears in errors"
        );
        assert_eq!(std::fs::read(&path).expect("read back"), b"not json");
    }
}
