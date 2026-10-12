//! This install's id (`team-computer.json`) and the name people see for it.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// File name inside `<app data>/team`.
pub(crate) const COMPUTER_FILE: &str = "team-computer.json";
const MAX_NAME_CHARS: usize = 80;
const FALLBACK_NAME: &str = "This computer";

/// This install's id: a lowercase hyphenated UUID v4, generated once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComputerIdentity {
    /// The id the team computer record names.
    pub(crate) computer_id: String,
}

/// Read or create the install id under one leaf lock. Concurrent commands
/// cannot write different ids to disk or return different ids to the relay.
pub(crate) fn cached_identity(
    cache: &std::sync::Mutex<Option<ComputerIdentity>>,
    path: &Path,
) -> Result<ComputerIdentity, String> {
    let mut cached = cache
        .lock()
        .map_err(|_| "team state is unavailable".to_string())?;
    if let Some(identity) = cached.as_ref() {
        return Ok(identity.clone());
    }
    let identity = load_or_create(path)?;
    *cached = Some(identity.clone());
    Ok(identity)
}

fn is_install_id(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|id| id.get_version_num() == 4 && id.to_string() == value)
}

/// Load this install's id, or create one. A file that cannot be read as an
/// id is kept beside it as `team-computer.json.invalid` and replaced, so the
/// person can move the team back to this computer instead of being stuck.
pub(crate) fn load_or_create(path: &Path) -> Result<ComputerIdentity, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            if let Ok(identity) = serde_json::from_slice::<ComputerIdentity>(&bytes) {
                if is_install_id(&identity.computer_id) {
                    return Ok(identity);
                }
            }
            std::fs::rename(path, path.with_extension("json.invalid"))
                .map_err(|error| format!("failed to set aside {COMPUTER_FILE}: {error}"))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to read {COMPUTER_FILE}: {error}")),
    }
    let identity = ComputerIdentity {
        computer_id: uuid::Uuid::new_v4().to_string(),
    };
    let bytes = serde_json::to_vec_pretty(&identity)
        .map_err(|error| format!("failed to serialize {COMPUTER_FILE}: {error}"))?;
    crate::managed_agents::storage::atomic_write_json_restricted(path, &bytes)?;
    Ok(identity)
}

/// The name people recognize: the Mac's computer name, Windows' computer
/// name, or the host name, cleaned by [`sanitize_name`].
pub(crate) fn this_computer_name() -> String {
    sanitize_name(&raw_computer_name().unwrap_or_default())
}

/// No control characters, trimmed, at most 80 characters, never empty.
pub(crate) fn sanitize_name(raw: &str) -> String {
    let visible: String = raw.chars().filter(|c| !c.is_control()).collect();
    let bounded: String = visible.trim().chars().take(MAX_NAME_CHARS).collect();
    let cleaned = bounded.trim();
    if cleaned.is_empty() {
        FALLBACK_NAME.to_string()
    } else {
        cleaned.to_string()
    }
}

#[cfg(target_os = "macos")]
fn raw_computer_name() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    // Bounded: `scutil` answers at once; a hung one is killed after 2 s.
    let mut child = Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut name = String::new();
    child
        .stdout
        .take()?
        .take(1024)
        .read_to_string(&mut name)
        .ok()?;
    Some(name)
}

#[cfg(windows)]
fn raw_computer_name() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(not(any(target_os = "macos", windows)))]
fn raw_computer_name() -> Option<String> {
    std::fs::read_to_string("/etc/hostname").ok()
}
