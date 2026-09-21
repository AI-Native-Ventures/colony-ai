//! Profile ownership fencing for the explicit production identity carrier.
//!
//! This module is deliberately a boundary around the unchanged B1
//! `HeadlessIdentityStore`.  It owns only metadata: a stable sibling lock, a
//! versioned sidecar, confined profile-parent creation, and an exact
//! macOS-keychain presence probe supplied by `colony-identity-store`.  It
//! never reads a keyring blob, legacy namespace, or identity file.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use colony_identity_store::{probe_identity_presence, MetadataPresence};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SCHEMA: &str = "colony.identity-ownership";
const SCHEMA_VERSION: u64 = 1;
const PROTOCOL_VERSION: u64 = 2;
const ANCHOR_KIND: &str = "app-data";
const LOCK_TIMEOUT: Duration = Duration::from_secs(2);
const LOCK_RETRY: Duration = Duration::from_millis(10);
const MAX_RECORD_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnershipError {
    /// The selected platform has no proven metadata-only adapter yet.
    Unavailable,
    /// Another process owns the bounded lock window.
    Busy,
    /// The sidecar/path/manifest relationship is malformed or unsafe.
    Invalid,
    /// Existing root or service metadata means this namespace is occupied.
    Occupied,
    /// A prior process reserved the namespace but did not commit initialization.
    Incomplete,
    /// A durable sidecar transition failed after B1 was allowed to run.
    Persistence,
}

impl OwnershipError {
    pub fn is_unavailable(self) -> bool {
        matches!(self, Self::Unavailable)
    }
}

#[derive(Debug, Clone)]
struct OwnershipContext {
    anchor: PathBuf,
    root: PathBuf,
    parent: PathBuf,
    sidecar: PathBuf,
    lock: PathBuf,
    profile_id: String,
    flavor: String,
    platform: String,
    relative_root: String,
    keychain_service: String,
    identity_manifest_digest: String,
    build_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GuardState {
    Reserved,
    Initialized,
}

/// The ownership lock remains held through B1 initialization and the
/// initialized-sidecar commit.
pub struct OwnershipGuard {
    context: OwnershipContext,
    _lock: StableLock,
    state: GuardState,
}

impl OwnershipGuard {
    /// Commit the durable storage outcome after unchanged B1 initialization.
    ///
    /// An existing initialized profile may legitimately report B1's ephemeral
    /// recovery metadata while the keyring is locked or lost.  In that case
    /// the prior initialized ownership record is retained and B1's snapshot
    /// remains authoritative.  A fresh reservation must have durable storage
    /// before it can become initialized.
    pub fn commit_initialized(self, storage: &str) -> Result<(), OwnershipError> {
        let Some(storage) = StorageKind::from_runtime(storage) else {
            if self.state == GuardState::Initialized && storage == "ephemeral" {
                return Ok(());
            }
            return Err(OwnershipError::Persistence);
        };

        let record = make_record(&self.context, OwnershipState::Initialized, storage);
        write_record(&self.context, &record)?;
        Ok(())
    }
}

/// Derive and reserve one manifest-bound profile before B1 may touch storage.
pub fn preflight(
    anchor: &Path,
    relative_root: &str,
    profile_id: &str,
    flavor: &str,
    platform: &str,
    keychain_service: &str,
    identity_manifest_digest: &str,
    build_id: &str,
) -> Result<OwnershipGuard, OwnershipError> {
    if platform != "macos" || !cfg!(target_os = "macos") {
        return Err(OwnershipError::Unavailable);
    }

    let context = derive_context(
        anchor,
        relative_root,
        profile_id,
        flavor,
        platform,
        keychain_service,
        identity_manifest_digest,
        build_id,
    )?;
    prepare_parent(&context)?;
    let lock = acquire_lock(&context.lock)?;

    // The parent and all derived paths are checked again after acquiring the
    // stable inode.  This is a confinement check, not a same-user tamper
    // boundary, but it prevents a normal race from escaping the anchor.
    validate_parent(&context)?;
    let record = read_record(&context)?;
    match record {
        Some(record) => match validate_record(&context, &record)? {
            OwnershipState::Reserved => Err(OwnershipError::Incomplete),
            OwnershipState::Initialized => {
                if !matches!(root_status(&context.root), RootStatus::Present) {
                    return Err(OwnershipError::Invalid);
                }
                Ok(OwnershipGuard {
                    context,
                    _lock: lock,
                    state: GuardState::Initialized,
                })
            }
        },
        None => {
            match root_status(&context.root) {
                RootStatus::Present | RootStatus::Invalid => {
                    return Err(OwnershipError::Occupied);
                }
                RootStatus::Absent => {}
            }

            match probe_identity_presence(&context.keychain_service) {
                MetadataPresence::NotFound => {
                    let reserved =
                        make_record(&context, OwnershipState::Reserved, StorageKind::None);
                    write_record(&context, &reserved)?;
                    Ok(OwnershipGuard {
                        context,
                        _lock: lock,
                        state: GuardState::Reserved,
                    })
                }
                MetadataPresence::Unavailable => Err(OwnershipError::Unavailable),
                MetadataPresence::Present
                | MetadataPresence::Locked
                | MetadataPresence::PermissionDenied
                | MetadataPresence::Error => Err(OwnershipError::Occupied),
            }
        }
    }
}

fn derive_context(
    anchor: &Path,
    relative_root: &str,
    profile_id: &str,
    flavor: &str,
    platform: &str,
    keychain_service: &str,
    identity_manifest_digest: &str,
    build_id: &str,
) -> Result<OwnershipContext, OwnershipError> {
    if profile_id.is_empty()
        || !safe_component(profile_id)
        || !matches!(flavor, "normal" | "instrumented")
        || !safe_component(flavor)
        || platform != "macos"
        || keychain_service.is_empty()
        || keychain_service.len() > 128
        || !safe_service(keychain_service)
        || !is_hex_digest(identity_manifest_digest)
        || build_id.is_empty()
        || build_id.len() > 128
        || build_id.chars().any(|character| character.is_control())
    {
        return Err(OwnershipError::Invalid);
    }

    let anchor = canonical_anchor(anchor)?;
    let relative = safe_relative_path(relative_root)?;
    let root = anchor.join(&relative);
    let parent = root.parent().ok_or(OwnershipError::Invalid)?.to_path_buf();
    if !parent.starts_with(&anchor) || !root.starts_with(&anchor) {
        return Err(OwnershipError::Invalid);
    }

    let sidecar = parent.join(format!(".{profile_id}.identity-ownership-v1.json"));
    let lock = parent.join(format!(".{profile_id}.identity-ownership-v1.lock"));
    Ok(OwnershipContext {
        anchor,
        root,
        parent,
        sidecar,
        lock,
        profile_id: profile_id.to_string(),
        flavor: flavor.to_string(),
        platform: platform.to_string(),
        relative_root: relative_root.to_string(),
        keychain_service: keychain_service.to_string(),
        identity_manifest_digest: identity_manifest_digest.to_string(),
        build_id: build_id.to_string(),
    })
}

fn canonical_anchor(anchor: &Path) -> Result<PathBuf, OwnershipError> {
    if !anchor.is_absolute() {
        return Err(OwnershipError::Invalid);
    }
    let metadata = fs::symlink_metadata(anchor).map_err(|_| OwnershipError::Invalid)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(OwnershipError::Invalid);
    }
    let canonical = fs::canonicalize(anchor).map_err(|_| OwnershipError::Invalid)?;
    if canonical != anchor {
        return Err(OwnershipError::Invalid);
    }
    Ok(canonical)
}

fn safe_relative_path(relative: &str) -> Result<PathBuf, OwnershipError> {
    if relative.is_empty() || relative.len() > 512 {
        return Err(OwnershipError::Invalid);
    }
    let mut path = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(value) if value.to_str().map(safe_component).unwrap_or(false) => {
                path.push(value)
            }
            _ => return Err(OwnershipError::Invalid),
        }
    }
    if path.as_os_str().is_empty() {
        return Err(OwnershipError::Invalid);
    }
    Ok(path)
}

fn safe_component(value: &str) -> bool {
    value.len() <= 96
        && !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
}

fn safe_service(value: &str) -> bool {
    value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
}

fn prepare_parent(context: &OwnershipContext) -> Result<(), OwnershipError> {
    let relative_parent = context
        .parent
        .strip_prefix(&context.anchor)
        .map_err(|_| OwnershipError::Invalid)?;
    let mut current = context.anchor.clone();
    for component in relative_parent.components() {
        let Component::Normal(value) = component else {
            return Err(OwnershipError::Invalid);
        };
        let next = current.join(value);
        match fs::symlink_metadata(&next) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(OwnershipError::Invalid);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if create_private_directory(&next).is_err() {
                    match fs::symlink_metadata(&next) {
                        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {
                        }
                        _ => return Err(OwnershipError::Invalid),
                    }
                }
            }
            Err(_) => return Err(OwnershipError::Invalid),
        }
        validate_existing_directory(&context.anchor, &next)?;
        current = next;
    }
    validate_parent(context)
}

fn validate_parent(context: &OwnershipContext) -> Result<(), OwnershipError> {
    if !context.parent.starts_with(&context.anchor) {
        return Err(OwnershipError::Invalid);
    }
    validate_existing_directory(&context.anchor, &context.parent)
}

fn validate_existing_directory(anchor: &Path, path: &Path) -> Result<(), OwnershipError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| OwnershipError::Invalid)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(OwnershipError::Invalid);
    }
    let canonical = fs::canonicalize(path).map_err(|_| OwnershipError::Invalid)?;
    if !canonical.starts_with(anchor) {
        return Err(OwnershipError::Invalid);
    }
    Ok(())
}

fn create_private_directory(path: &Path) -> Result<(), OwnershipError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700);
        builder.create(path).map_err(|_| OwnershipError::Invalid)
    }
    #[cfg(not(unix))]
    {
        fs::create_dir(path).map_err(|_| OwnershipError::Invalid)
    }
}

fn acquire_lock(path: &Path) -> Result<StableLock, OwnershipError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(OwnershipError::Invalid)
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(OwnershipError::Invalid),
    }

    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|_| OwnershipError::Invalid)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(OwnershipError::Invalid)
        }
        Ok(_) => {}
        Err(_) => return Err(OwnershipError::Invalid),
    }

    let deadline = Instant::now() + LOCK_TIMEOUT;
    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(StableLock(file)),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(OwnershipError::Busy);
                }
                thread::sleep(LOCK_RETRY);
            }
            Err(_) => return Err(OwnershipError::Busy),
        }
    }
}

struct StableLock(File);

impl Drop for StableLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum OwnershipState {
    Reserved,
    Initialized,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum StorageKind {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "system-keyring")]
    SystemKeyring,
    #[serde(rename = "local-file")]
    LocalFile,
}

impl StorageKind {
    fn from_runtime(value: &str) -> Option<Self> {
        match value {
            "system-keyring" => Some(Self::SystemKeyring),
            "local-file" => Some(Self::LocalFile),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnershipRecord {
    schema: String,
    #[serde(rename = "schemaVersion")]
    schema_version: u64,
    state: OwnershipState,
    namespace: NamespaceRecord,
    #[serde(rename = "rootRelation")]
    root_relation: RootRelation,
    storage: StorageRecord,
    provenance: ProvenanceRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NamespaceRecord {
    platform: String,
    flavor: String,
    #[serde(rename = "profileId")]
    profile_id: String,
    #[serde(rename = "relativeRoot")]
    relative_root: String,
    #[serde(rename = "keychainService")]
    keychain_service: String,
    #[serde(rename = "anchorKind")]
    anchor_kind: String,
    #[serde(rename = "stableNamespaceDigest")]
    stable_namespace_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RootRelation {
    #[serde(rename = "anchorKind")]
    anchor_kind: String,
    #[serde(rename = "relativeRoot")]
    relative_root: String,
    #[serde(rename = "derivedRoot")]
    derived_root: String,
    #[serde(rename = "sidecarParent")]
    sidecar_parent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StorageRecord {
    #[serde(rename = "lastDurableStorage")]
    last_durable_storage: StorageKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProvenanceRecord {
    #[serde(rename = "identityManifestDigest")]
    identity_manifest_digest: String,
    #[serde(rename = "protocolVersion")]
    protocol_version: u64,
    #[serde(rename = "buildId")]
    build_id: String,
    #[serde(rename = "recordedAtUtc")]
    recorded_at_utc: String,
}

fn make_record(
    context: &OwnershipContext,
    state: OwnershipState,
    storage: StorageKind,
) -> OwnershipRecord {
    OwnershipRecord {
        schema: SCHEMA.to_string(),
        schema_version: SCHEMA_VERSION,
        state,
        namespace: NamespaceRecord {
            platform: context.platform.clone(),
            flavor: context.flavor.clone(),
            profile_id: context.profile_id.clone(),
            relative_root: context.relative_root.clone(),
            keychain_service: context.keychain_service.clone(),
            anchor_kind: ANCHOR_KIND.to_string(),
            stable_namespace_digest: stable_namespace_digest(context),
        },
        root_relation: RootRelation {
            anchor_kind: ANCHOR_KIND.to_string(),
            relative_root: context.relative_root.clone(),
            derived_root: path_string(&context.root),
            sidecar_parent: path_string(&context.parent),
        },
        storage: StorageRecord {
            last_durable_storage: storage,
        },
        provenance: ProvenanceRecord {
            identity_manifest_digest: context.identity_manifest_digest.clone(),
            protocol_version: PROTOCOL_VERSION,
            build_id: context.build_id.clone(),
            recorded_at_utc: now_rfc3339(),
        },
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn read_record(context: &OwnershipContext) -> Result<Option<OwnershipRecord>, OwnershipError> {
    let metadata = match fs::symlink_metadata(&context.sidecar) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(OwnershipError::Invalid),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(OwnershipError::Invalid);
    }

    let file = File::open(&context.sidecar).map_err(|_| OwnershipError::Invalid)?;
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| OwnershipError::Invalid)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(OwnershipError::Invalid);
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| OwnershipError::Invalid)
}

fn validate_record(
    context: &OwnershipContext,
    record: &OwnershipRecord,
) -> Result<OwnershipState, OwnershipError> {
    if record.schema != SCHEMA
        || record.schema_version != SCHEMA_VERSION
        || record.namespace.platform != context.platform
        || record.namespace.flavor != context.flavor
        || record.namespace.profile_id != context.profile_id
        || record.namespace.relative_root != context.relative_root
        || record.namespace.keychain_service != context.keychain_service
        || record.namespace.anchor_kind != ANCHOR_KIND
        || record.root_relation.anchor_kind != ANCHOR_KIND
        || record.root_relation.relative_root != context.relative_root
        || record.root_relation.derived_root != path_string(&context.root)
        || record.root_relation.sidecar_parent != path_string(&context.parent)
        || record.provenance.protocol_version != PROTOCOL_VERSION
        || !is_hex_digest(&record.provenance.identity_manifest_digest)
        || record.provenance.build_id.is_empty()
        || record.provenance.build_id.len() > 128
        || !is_rfc3339_utc(&record.provenance.recorded_at_utc)
        || record.namespace.stable_namespace_digest != stable_namespace_digest(context)
    {
        return Err(OwnershipError::Invalid);
    }

    match record.state {
        OwnershipState::Reserved if record.storage.last_durable_storage == StorageKind::None => {
            Ok(OwnershipState::Reserved)
        }
        OwnershipState::Initialized
            if matches!(
                record.storage.last_durable_storage,
                StorageKind::SystemKeyring | StorageKind::LocalFile
            ) =>
        {
            Ok(OwnershipState::Initialized)
        }
        _ => Err(OwnershipError::Invalid),
    }
}

fn write_record(
    context: &OwnershipContext,
    record: &OwnershipRecord,
) -> Result<(), OwnershipError> {
    match fs::symlink_metadata(&context.sidecar) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(OwnershipError::Invalid)
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(OwnershipError::Persistence),
    }

    let bytes = serde_json::to_vec(record).map_err(|_| OwnershipError::Persistence)?;
    let mut file =
        AtomicWriteFile::open(&context.sidecar).map_err(|_| OwnershipError::Persistence)?;
    file.write_all(&bytes)
        .map_err(|_| OwnershipError::Persistence)?;
    file.commit().map_err(|_| OwnershipError::Persistence)?;
    sync_parent(&context.parent)
}

fn sync_parent(parent: &Path) -> Result<(), OwnershipError> {
    #[cfg(unix)]
    {
        File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| OwnershipError::Persistence)
    }
    #[cfg(not(unix))]
    {
        let _ = parent;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootStatus {
    Absent,
    Present,
    Invalid,
}

fn root_status(root: &Path) -> RootStatus {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return RootStatus::Absent,
        Err(_) => return RootStatus::Invalid,
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return RootStatus::Invalid;
    }
    match fs::canonicalize(root) {
        Ok(canonical) if canonical == root => RootStatus::Present,
        _ => RootStatus::Invalid,
    }
}

fn stable_namespace_digest(context: &OwnershipContext) -> String {
    let bytes = format!(
        "{{\"anchorKind\":\"{}\",\"flavor\":\"{}\",\"keychainService\":\"{}\",\"platform\":\"{}\",\"profileId\":\"{}\",\"relativeRoot\":\"{}\",\"schemaVersion\":{}}}",
        ANCHOR_KIND,
        context.flavor,
        context.keychain_service,
        context.platform,
        context.profile_id,
        context.relative_root,
        SCHEMA_VERSION,
    )
    .into_bytes();
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn is_hex_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_rfc3339_utc(value: &str) -> bool {
    let bytes = value.as_bytes();
    if value.len() != 20
        || !value.ends_with('Z')
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || !value.bytes().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19) || byte.is_ascii_digit()
        })
    {
        return false;
    }

    let Some(month) = two_digits(bytes, 5) else {
        return false;
    };
    let Some(day) = two_digits(bytes, 8) else {
        return false;
    };
    let Some(hour) = two_digits(bytes, 11) else {
        return false;
    };
    let Some(minute) = two_digits(bytes, 14) else {
        return false;
    };
    let Some(second) = two_digits(bytes, 17) else {
        return false;
    };
    (1..=12).contains(&month) && (1..=31).contains(&day) && hour < 24 && minute < 60 && second < 60
}

fn two_digits(value: &[u8], start: usize) -> Option<u32> {
    let high = value.get(start)?.checked_sub(b'0')?;
    let low = value.get(start + 1)?.checked_sub(b'0')?;
    if high > 9 || low > 9 {
        return None;
    }
    Some(u32::from(high) * 10 + u32::from(low))
}

fn now_rfc3339() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

// Howard Hinnant's public-domain civil date conversion, kept local so this
// metadata sidecar does not acquire a time/runtime dependency.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted / 146_097
    } else {
        (shifted - 146_096) / 146_097
    };
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(anchor: &Path) -> OwnershipContext {
        let root = anchor.join("Colony/dev/profile/normal");
        let parent = root.parent().expect("test root has parent").to_path_buf();
        OwnershipContext {
            anchor: anchor.to_path_buf(),
            root,
            parent: parent.clone(),
            sidecar: parent.join(".profile.identity-ownership-v1.json"),
            lock: parent.join(".profile.identity-ownership-v1.lock"),
            profile_id: "profile".to_string(),
            flavor: "normal".to_string(),
            platform: "macos".to_string(),
            relative_root: "Colony/dev/profile/normal".to_string(),
            keychain_service: "xyz.example.profile".to_string(),
            identity_manifest_digest: "a".repeat(64),
            build_id: "test".to_string(),
        }
    }

    #[test]
    fn stable_digest_excludes_build_provenance() {
        let anchor = PathBuf::from("/tmp/colony-ownership-test");
        let first = context(&anchor);
        let mut second = first.clone();
        second.build_id = "new-build".to_string();
        second.identity_manifest_digest = "b".repeat(64);
        assert_eq!(
            stable_namespace_digest(&first),
            stable_namespace_digest(&second)
        );
    }

    #[test]
    fn reserved_record_cannot_claim_durable_storage() {
        let context = context(Path::new("/tmp/colony-ownership-test"));
        let mut record = make_record(&context, OwnershipState::Reserved, StorageKind::None);
        assert_eq!(
            validate_record(&context, &record).expect("reserved record validates"),
            OwnershipState::Reserved
        );
        record.storage.last_durable_storage = StorageKind::LocalFile;
        assert_eq!(
            validate_record(&context, &record),
            Err(OwnershipError::Invalid)
        );
    }

    #[test]
    fn timestamp_is_utc_rfc3339_shape() {
        let timestamp = now_rfc3339();
        assert_eq!(timestamp.len(), 20);
        assert!(timestamp.ends_with('Z'));
        assert_eq!(&timestamp[4..5], "-");
        assert_eq!(&timestamp[10..11], "T");
    }

    #[test]
    fn stable_record_uses_sorted_digest_input() {
        let context = context(Path::new("/tmp/colony-ownership-test"));
        let record = make_record(&context, OwnershipState::Reserved, StorageKind::None);
        let json = serde_json::to_value(record).expect("record serializes");
        assert!(json.get("rootRelation").is_some());
        assert!(json.get("provenance").is_some());
    }
}
