//! Colony's own pinned MinGit for Windows PCs that have no Git for Windows.
//!
//! The Colony Agent runs shell commands through bash. A fresh Windows PC has no
//! bash, so on first need Colony downloads Git for Windows' minimal build
//! (MinGit) into its own app-data folder and points the agent at it. Nothing is
//! installed system wide and no admin prompt appears.
//!
//! This file holds the pure parts (where it lives, which artifact is pinned,
//! which shell the agent gets) so every branch is unit tested on every
//! platform, including the Windows CI runner.
// Only the Windows host reads most of this outside tests.
#![cfg_attr(not(windows), allow(dead_code))]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Git for Windows release the pinned MinGit zip comes from.
pub(crate) const MANAGED_GIT_VERSION: &str = "2.56.0.4";
pub(crate) const MANAGED_GIT_RELEASE_TAG: &str = "v2.56.0.windows.4";

/// Name of the file written last inside a finished install. A folder without it
/// is a partial download and is never used.
pub(crate) const MANAGED_GIT_MARKER: &str = ".colony-managed-git";

/// The environment variable the agent's shell tool already reads first.
pub(crate) const GIT_BASH_ENV: &str = "GIT_BASH";

/// A pinned MinGit zip. The digest is the release asset's SHA256, checked
/// before anything is unpacked.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ManagedGitArtifact {
    pub platform: &'static str,
    pub filename: &'static str,
    pub sha256: &'static str,
}

/// Only the 64-bit build ships in the Windows app (Windows on ARM runs it under
/// emulation), so that is the only artifact pinned.
pub(crate) const MANAGED_GIT_ARTIFACTS: &[ManagedGitArtifact] = &[ManagedGitArtifact {
    platform: "windows-x64",
    filename: "MinGit-2.56.0.4-64-bit.zip",
    sha256: "e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877",
}];

pub(crate) fn managed_git_download_url(artifact: ManagedGitArtifact) -> String {
    format!(
        "https://github.com/git-for-windows/git/releases/download/{MANAGED_GIT_RELEASE_TAG}/{}",
        artifact.filename
    )
}

/// The platform label Colony can install MinGit for, `None` everywhere else.
pub(crate) fn managed_git_platform() -> Option<&'static str> {
    platform_label(std::env::consts::OS, std::env::consts::ARCH)
}

fn platform_label(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("windows", "x86_64") => Some("windows-x64"),
        _ => None,
    }
}

pub(crate) fn managed_git_artifact() -> Option<ManagedGitArtifact> {
    let platform = managed_git_platform()?;
    MANAGED_GIT_ARTIFACTS
        .iter()
        .copied()
        .find(|artifact| artifact.platform == platform)
}

/// Whether Colony can download its own shell tools on this PC.
pub(crate) fn managed_git_install_supported() -> bool {
    managed_git_artifact().is_some() && managed_git_dir().is_some()
}

/// Colony's own MinGit folder for this platform and pinned version.
pub(crate) fn managed_git_dir() -> Option<PathBuf> {
    let platform = managed_git_platform()?;
    dirs::data_dir().map(|dir| managed_git_dir_in(&dir, platform))
}

pub(crate) fn managed_git_dir_in(data_dir: &Path, platform: &str) -> PathBuf {
    data_dir
        .join("Colony")
        .join("runtimes")
        .join("mingit")
        .join(MANAGED_GIT_VERSION)
        .join(platform)
}

/// The bash inside a MinGit folder, `Some` only for a finished, intact install.
pub(crate) fn managed_git_bash_in(dir: &Path) -> Option<PathBuf> {
    let marker = std::fs::read_to_string(dir.join(MANAGED_GIT_MARKER)).ok()?;
    if marker.trim() != expected_marker() {
        return None;
    }
    let bash = dir.join("usr").join("bin").join("bash.exe");
    let git = dir.join("cmd").join("git.exe");
    (bash.is_file() && git.is_file()).then_some(bash)
}

/// What the marker file must contain for this pinned version.
pub(crate) fn expected_marker() -> String {
    format!("mingit {MANAGED_GIT_VERSION}")
}

/// Colony's own bash, when it was installed and is intact.
pub(crate) fn managed_git_bash() -> Option<PathBuf> {
    managed_git_dir().and_then(|dir| managed_git_bash_in(&dir))
}

/// Which shell the Colony Agent gets on Windows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WindowsShell {
    /// Git Bash (or the user's own shell override) is already on this PC.
    System,
    /// Colony's own MinGit is installed and the agent is pointed at it.
    Managed(PathBuf),
    /// No bash anywhere, but Colony can download its own on first need.
    Downloadable,
    /// No bash and nothing Colony can download here: the person installs Git.
    Missing,
}

/// A bash that is already on the PC always wins, so a person who installs Git
/// for Windows later gets it without any step. Colony's own copy is next, and a
/// download is only offered when neither exists.
pub(crate) fn plan_windows_shell(
    system_bash_found: bool,
    managed_bash: Option<PathBuf>,
    download_supported: bool,
) -> WindowsShell {
    if system_bash_found {
        return WindowsShell::System;
    }
    match managed_bash {
        Some(path) => WindowsShell::Managed(path),
        None if download_supported => WindowsShell::Downloadable,
        None => WindowsShell::Missing,
    }
}

/// Point the agent's shell at Colony's own bash when no other bash is found.
/// `GIT_BASH` is the override the agent's shell tool reads before any search,
/// and the host forwards it to the tool process.
pub(crate) fn apply_managed_git_bash(
    env: &mut BTreeMap<String, String>,
    system_bash_found: bool,
    managed_bash: Option<PathBuf>,
) {
    if let WindowsShell::Managed(path) = plan_windows_shell(system_bash_found, managed_bash, false)
    {
        env.insert(GIT_BASH_ENV.to_string(), path.display().to_string());
    }
}

/// Windows only: if the agent env finds no bash, add Colony's own. A no-op on
/// every other platform.
pub(crate) fn apply_managed_shell(env: &mut BTreeMap<String, String>) {
    #[cfg(windows)]
    {
        let system_bash_found = super::git_bash::git_bash_available(env);
        apply_managed_git_bash(env, system_bash_found, managed_git_bash());
    }
    #[cfg(not(windows))]
    let _ = env;
}

#[cfg(test)]
#[path = "managed_git_paths_tests.rs"]
mod tests;
