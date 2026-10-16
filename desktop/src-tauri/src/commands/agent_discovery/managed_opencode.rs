//! Colony's own pinned OpenCode for "Start free". Downloaded from the
//! OpenCode GitHub release, checked against a pinned SHA256, unpacked into
//! Colony's app-data folder. Never runs OpenCode's install script and never
//! touches an OpenCode the user installed themselves.
use std::cell::Cell;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use super::install_capture::LineObserver;
use super::install_report::InstallReporter;
use super::managed_archive::{download_verified, extract_archive};
use crate::managed_agents::{
    buzz_managed_opencode_dir, managed_opencode_platform, InstallStepResult,
    MANAGED_OPENCODE_VERSION,
};

const OPENCODE_MAX_BYTES: u64 = 80 * 1024 * 1024;
/// Generous enough for a 62 MB archive on a slow connection (about 300 kbit/s).
const OPENCODE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub(super) struct OpenCodeArtifact {
    pub platform: &'static str,
    pub filename: &'static str,
    pub sha256: &'static str,
}

/// Digests from the GitHub release assets of OpenCode v1.19.2. x64 uses the
/// `-baseline` builds so CPUs without AVX2 work.
pub(super) const OPENCODE_ARTIFACTS: &[OpenCodeArtifact] = &[
    OpenCodeArtifact {
        platform: "darwin-arm64",
        filename: "opencode-darwin-arm64.zip",
        sha256: "1c9da110bbf3e13c480e0a2e55f61b09ebdb33cfc67029b61ffbb9f8566d67cd",
    },
    OpenCodeArtifact {
        platform: "darwin-x64",
        filename: "opencode-darwin-x64-baseline.zip",
        sha256: "cae984e29ddb6a3c8ff906107552cad2f10569a3846af6a76882181f601cc006",
    },
    OpenCodeArtifact {
        platform: "linux-x64",
        filename: "opencode-linux-x64-baseline.tar.gz",
        sha256: "0f41386deb25608b3bfa4a17795f61782008d5e118eeba5093ade4e052be7ee2",
    },
    OpenCodeArtifact {
        platform: "linux-arm64",
        filename: "opencode-linux-arm64.tar.gz",
        sha256: "3f73a474065b4b7c4a64cef2395a6123ae1039c2e41f0acbe29ae6521b50df66",
    },
    OpenCodeArtifact {
        platform: "windows-x64",
        filename: "opencode-windows-x64-baseline.zip",
        sha256: "fb67adf313ebca3f82c8059df334b8ad1d0523ceec3216c4cffc3b9d35941c77",
    },
    OpenCodeArtifact {
        platform: "windows-arm64",
        filename: "opencode-windows-arm64.zip",
        sha256: "a4c6ce2e1bc0ed17acaa8c840b1c2c28f0e732b0b859dfeeab98feaa894aa182",
    },
];

pub(super) fn download_url(artifact: OpenCodeArtifact) -> String {
    format!(
        "https://github.com/anomalyco/opencode/releases/download/{MANAGED_OPENCODE_VERSION}/{}",
        artifact.filename
    )
}

pub(super) fn opencode_binary_name() -> &'static str {
    if cfg!(windows) {
        "opencode.exe"
    } else {
        "opencode"
    }
}

pub(super) fn opencode_binary_ready(dir: &std::path::Path) -> bool {
    let Ok(metadata) = dir.join(opencode_binary_name()).metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

const OPENCODE_HINT: &str =
    "Choose Use your own AI to connect Claude Code, Codex or OpenRouter instead.";

/// Step id the UI uses to hide Retry: an unsupported platform cannot succeed.
pub(super) const OPENCODE_UNSUPPORTED_STEP: &str = "opencode-unsupported";

pub(super) fn opencode_unsupported_step(os: &str, arch: &str) -> InstallStepResult {
    InstallStepResult {
        step: OPENCODE_UNSUPPORTED_STEP.to_string(),
        command: format!("Colony OpenCode {MANAGED_OPENCODE_VERSION}"),
        success: false,
        stdout: String::new(),
        stderr: format!("Start free is not available on {os}-{arch} yet."),
        exit_code: None,
        hint: Some(OPENCODE_HINT.to_string()),
    }
}

fn opencode_failed_step(stderr: String) -> InstallStepResult {
    InstallStepResult {
        step: "opencode".to_string(),
        command: format!("Colony OpenCode {MANAGED_OPENCODE_VERSION}"),
        success: false,
        stdout: String::new(),
        stderr,
        exit_code: None,
        hint: Some(format!(
            "Check your internet connection and try again. {OPENCODE_HINT}"
        )),
    }
}

fn install_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn unsupported_here() -> Box<InstallStepResult> {
    Box::new(opencode_unsupported_step(
        std::env::consts::OS,
        std::env::consts::ARCH,
    ))
}

/// Progress line for the install screen, at most every 4 MB and at the end.
pub(super) fn progress_line(done: u64, total: Option<u64>, last: &Cell<u64>) -> Option<String> {
    let finished = total == Some(done);
    if done < last.get() + 4 * MB && !finished {
        return None;
    }
    last.set(done);
    Some(match total {
        Some(total) => format!(
            "Downloading OpenCode: {} of {} MB",
            done.div_ceil(MB),
            total.div_ceil(MB)
        ),
        None => format!("Downloading OpenCode: {} MB", done.div_ceil(MB)),
    })
}

/// Install Colony's pinned OpenCode if it is not already in place.
pub(super) fn ensure_managed_opencode_blocking(
    reporter: &InstallReporter,
) -> Result<(), Box<InstallStepResult>> {
    let (Some(platform), Some(final_dir)) =
        (managed_opencode_platform(), buzz_managed_opencode_dir())
    else {
        return Err(unsupported_here());
    };
    if opencode_binary_ready(&final_dir) {
        return Ok(());
    }
    let Some(artifact) = OPENCODE_ARTIFACTS
        .iter()
        .copied()
        .find(|artifact| artifact.platform == platform)
    else {
        return Err(unsupported_here());
    };
    let _guard = install_lock().lock().map_err(|_| {
        Box::new(opencode_failed_step(
            "OpenCode install lock poisoned".into(),
        ))
    })?;
    if opencode_binary_ready(&final_dir) {
        return Ok(());
    }
    reporter.start_attempt();
    let observer = reporter.line_observer();
    install(&final_dir, artifact, observer.as_ref())
        .map_err(|err| Box::new(opencode_failed_step(err)))?;
    if opencode_binary_ready(&final_dir) {
        Ok(())
    } else {
        Err(Box::new(opencode_failed_step(
            "OpenCode was unpacked but its program is missing".into(),
        )))
    }
}

fn install(
    final_dir: &std::path::Path,
    artifact: OpenCodeArtifact,
    observer: Option<&LineObserver>,
) -> Result<(), String> {
    let parent = final_dir
        .parent()
        .ok_or("OpenCode install folder has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create OpenCode folder: {e}"))?;
    let temp_dir = parent.join(format!("{}.tmp", artifact.platform));
    let archive_path = parent.join(format!("{}.download", artifact.filename));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).map_err(|e| format!("remove stale temp dir: {e}"))?;
    }
    let result = unpack_into_place(final_dir, &temp_dir, &archive_path, artifact, observer);
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&temp_dir);
    result
}

fn unpack_into_place(
    final_dir: &std::path::Path,
    temp_dir: &std::path::Path,
    archive_path: &std::path::Path,
    artifact: OpenCodeArtifact,
    observer: Option<&LineObserver>,
) -> Result<(), String> {
    let last = Cell::new(0);
    let report = |done: u64, total: Option<u64>| {
        if let (Some(observer), Some(line)) = (observer, progress_line(done, total, &last)) {
            observer(&line);
        }
    };
    download_verified(
        &download_url(artifact),
        archive_path,
        artifact.sha256,
        OPENCODE_MAX_BYTES,
        "OpenCode",
        OPENCODE_DOWNLOAD_TIMEOUT,
        &report,
    )?;
    if let Some(observer) = observer {
        observer("Unpacking OpenCode");
    }
    std::fs::create_dir_all(temp_dir).map_err(|e| format!("create temp dir: {e}"))?;
    extract_archive(archive_path, temp_dir, artifact.filename, "OpenCode")?;
    let binary = temp_dir.join(opencode_binary_name());
    if !binary.is_file() {
        return Err("OpenCode archive did not contain its program".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("make OpenCode executable: {e}"))?;
    }
    if final_dir.exists() {
        std::fs::remove_dir_all(final_dir).map_err(|e| format!("replace old OpenCode: {e}"))?;
    }
    std::fs::rename(temp_dir, final_dir).map_err(|e| format!("install OpenCode: {e}"))
}

#[cfg(test)]
#[path = "managed_opencode_tests.rs"]
mod tests;
