//! Colony's own pinned MinGit for Windows PCs that have no Git for Windows.
//!
//! The Colony Agent runs its shell commands through bash. On first need Colony
//! downloads Git for Windows' minimal build from the official release, checks
//! it against a pinned SHA256, and unpacks it into Colony's own app-data
//! folder. It never runs an installer, never needs admin rights and never
//! touches a Git the person installed themselves.
use std::cell::Cell;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use super::install_capture::LineObserver;
use super::install_report::InstallReporter;
use super::managed_archive::{download_verified, extract_archive};
use crate::managed_agents::{
    expected_marker, managed_git_artifact, managed_git_bash, managed_git_dir,
    managed_git_download_url, InstallStepResult, ManagedGitArtifact, MANAGED_GIT_MARKER,
    MANAGED_GIT_VERSION,
};

/// The zip is about 38 MB. This only bounds a wrong or hostile response.
const MINGIT_MAX_BYTES: u64 = 80 * 1024 * 1024;
/// Enough for a 38 MB download at about 500 kbit/s, and short enough that the
/// host answers before the app's 12 minute wait for `install_acp_runtime` ends.
const MINGIT_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MB: u64 = 1024 * 1024;

/// Step id the UI uses to hide Try again: an unsupported PC cannot succeed.
pub(super) const MANAGED_GIT_UNSUPPORTED_STEP: &str = "git-bash-unsupported";
pub(super) const MANAGED_GIT_STEP: &str = "git-bash";

const INSTALL_GIT_HINT: &str =
    "Install Git for Windows from https://git-scm.com/download/win and restart Colony.";
const LABEL: &str = "shell tools";

/// Files the unpacked folder must contain before it replaces anything.
const REQUIRED_FILES: &[&str] = &[
    "cmd/git.exe",
    "usr/bin/sh.exe",
    "usr/bin/msys-2.0.dll",
    "LICENSE.txt",
];

fn command_label() -> String {
    format!("Colony shell tools (MinGit {MANAGED_GIT_VERSION})")
}

pub(super) fn unsupported_step() -> InstallStepResult {
    InstallStepResult {
        step: MANAGED_GIT_UNSUPPORTED_STEP.to_string(),
        command: command_label(),
        success: false,
        stdout: String::new(),
        stderr: "Colony cannot set up its shell tools on this PC yet.".to_string(),
        exit_code: None,
        hint: Some(INSTALL_GIT_HINT.to_string()),
    }
}

pub(super) fn managed_git_ready_step() -> InstallStepResult {
    InstallStepResult {
        step: MANAGED_GIT_STEP.to_string(),
        command: command_label(),
        success: true,
        stdout: "The shell tools are ready.".to_string(),
        stderr: String::new(),
        exit_code: None,
        hint: None,
    }
}

fn failed_step(stderr: String) -> InstallStepResult {
    InstallStepResult {
        step: MANAGED_GIT_STEP.to_string(),
        command: command_label(),
        success: false,
        stdout: String::new(),
        stderr,
        exit_code: None,
        hint: Some(format!(
            "Check your internet connection and try again. If it keeps failing, {}",
            lower_first(INSTALL_GIT_HINT)
        )),
    }
}

fn lower_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Whether the Colony Agent has no bash on this PC and Colony should fetch its
/// own. Always false off Windows.
#[cfg(windows)]
pub(super) fn managed_git_wanted() -> bool {
    use crate::managed_agents::{managed_git_install_supported, plan_windows_shell, WindowsShell};
    plan_windows_shell(
        crate::managed_agents::git_bash::resolve_git_bash_path().is_some(),
        managed_git_bash(),
        managed_git_install_supported(),
    ) == WindowsShell::Downloadable
}

#[cfg(not(windows))]
pub(super) fn managed_git_wanted() -> bool {
    false
}

fn install_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
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
            "Downloading {LABEL}: {} of {} MB",
            done.div_ceil(MB),
            total.div_ceil(MB)
        ),
        None => format!("Downloading {LABEL}: {} MB", done.div_ceil(MB)),
    })
}

/// Install Colony's pinned MinGit if it is not already in place.
pub(super) fn ensure_managed_git_blocking(
    reporter: &InstallReporter,
) -> Result<(), Box<InstallStepResult>> {
    let (Some(artifact), Some(final_dir)) = (managed_git_artifact(), managed_git_dir()) else {
        return Err(Box::new(unsupported_step()));
    };
    if managed_git_bash().is_some() {
        return Ok(());
    }
    let _guard = install_lock()
        .lock()
        .map_err(|_| Box::new(failed_step("shell tools install lock poisoned".into())))?;
    if managed_git_bash().is_some() {
        return Ok(());
    }
    reporter.start_attempt();
    let observer = reporter.line_observer();
    if let Some(observer) = observer.as_ref() {
        observer("Setting up shell tools for the Colony Agent (one time, about 40 MB)");
    }
    install(
        &final_dir,
        artifact,
        &managed_git_download_url(artifact),
        observer.as_ref(),
    )
    .map_err(|err| Box::new(failed_step(err)))?;
    if managed_git_bash().is_some() {
        Ok(())
    } else {
        Err(Box::new(failed_step(
            "The shell tools were unpacked but bash is missing".into(),
        )))
    }
}

/// Download, check and unpack into `final_dir`. `final_dir` is only replaced
/// once the whole tree is in place, so a failed attempt leaves any earlier
/// install untouched.
pub(super) fn install(
    final_dir: &Path,
    artifact: ManagedGitArtifact,
    url: &str,
    observer: Option<&LineObserver>,
) -> Result<(), String> {
    let parent = final_dir
        .parent()
        .ok_or("The shell tools folder has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create shell tools folder: {e}"))?;
    let temp_dir = parent.join(format!("{}.tmp", artifact.platform));
    let archive_path = parent.join(format!("{}.download", artifact.filename));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).map_err(|e| format!("remove stale temp dir: {e}"))?;
    }
    let last = Cell::new(0);
    let report = |done: u64, total: Option<u64>| {
        if let (Some(observer), Some(line)) = (observer, progress_line(done, total, &last)) {
            observer(&line);
        }
    };
    let result = download_verified(
        url,
        &archive_path,
        artifact.sha256,
        MINGIT_MAX_BYTES,
        LABEL,
        MINGIT_DOWNLOAD_TIMEOUT,
        &report,
    )
    .and_then(|()| {
        if let Some(observer) = observer {
            observer("Unpacking shell tools");
        }
        unpack_into_place(final_dir, &temp_dir, &archive_path, artifact.filename)
    });
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&temp_dir);
    result
}

fn unpack_into_place(
    final_dir: &Path,
    temp_dir: &Path,
    archive_path: &Path,
    filename: &str,
) -> Result<(), String> {
    std::fs::create_dir_all(temp_dir).map_err(|e| format!("create temp dir: {e}"))?;
    extract_archive(archive_path, temp_dir, filename, LABEL)?;
    complete_tree(temp_dir)?;
    if final_dir.exists() {
        std::fs::remove_dir_all(final_dir).map_err(|e| format!("replace old shell tools: {e}"))?;
    }
    rename_with_retry(temp_dir, final_dir).map_err(|e| format!("install shell tools: {e}"))
}

/// Check the unpacked tree, add the two files Colony owns, and write the
/// marker last so a half-finished folder is never mistaken for an install.
fn complete_tree(dir: &Path) -> Result<(), String> {
    for required in REQUIRED_FILES {
        if !dir.join(required).is_file() {
            return Err(format!("The shell tools download is missing {required}"));
        }
    }
    // MinGit ships GNU bash under the name sh.exe. Run under that name, bash
    // switches to POSIX mode and drops features the agent's commands use, so
    // Colony keeps a copy named bash.exe, which is what the agent looks for.
    let bin = dir.join("usr").join("bin");
    std::fs::copy(bin.join("sh.exe"), bin.join("bash.exe"))
        .map_err(|e| format!("create bash.exe: {e}"))?;
    std::fs::write(dir.join("COLONY-NOTICE.txt"), notice_text())
        .map_err(|e| format!("write the shell tools notice: {e}"))?;
    std::fs::write(dir.join(MANAGED_GIT_MARKER), expected_marker())
        .map_err(|e| format!("write the shell tools marker: {e}"))
}

/// Kept next to Git's own LICENSE.txt, which stays in the folder untouched.
fn notice_text() -> String {
    format!(
        "These files are MinGit {MANAGED_GIT_VERSION}, the minimal build of Git for Windows,\n\
         downloaded by Colony from the official release:\n\
         https://github.com/git-for-windows/git/releases\n\
         \n\
         Git for Windows is free software under the GNU General Public License\n\
         version 2 and other open licenses. The full texts are in LICENSE.txt and in\n\
         ucrt64/share/licenses. Source code: https://github.com/git-for-windows/git\n\
         and https://github.com/msys2/MSYS2-packages\n\
         \n\
         Colony adds two files and changes nothing else:\n\
         - usr/bin/bash.exe is a copy of usr/bin/sh.exe (both are GNU bash).\n\
         - {MANAGED_GIT_MARKER} marks a finished install.\n"
    )
}

/// Windows virus scanners often hold freshly unpacked programs for a moment,
/// which makes renaming their folder fail with "access denied". Wait and retry.
fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    rename_with_retry_using(from, to, 6, Duration::from_millis(500))
}

fn rename_with_retry_using(
    from: &Path,
    to: &Path,
    attempts: u32,
    pause: Duration,
) -> std::io::Result<()> {
    let mut attempt = 1;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) if attempt >= attempts => return Err(error),
            Err(_) => {
                attempt += 1;
                std::thread::sleep(pause);
            }
        }
    }
}

#[cfg(test)]
#[path = "managed_git_tests.rs"]
mod tests;
