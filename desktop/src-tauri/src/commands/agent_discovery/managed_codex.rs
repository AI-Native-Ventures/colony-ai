//! Colony's pinned Codex CLI and ACP adapter, installed into app data.
//!
//! `npm ci` verifies every package against the checked-in lockfile integrity
//! values. The staged directory is promoted only after both pinned packages
//! and their command shims are present. No machine-wide npm prefix is used.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::managed_agents::{InstallStepResult, MANAGED_CODEX_RUNTIME_VERSION};

const CODEX_ACP_VERSION: &str = "2.1.1";
const CODEX_CLI_VERSION: &str = "0.159.1";
const PACKAGE_JSON: &str = include_str!("codex-runtime.package.json");
const PACKAGE_LOCK: &str = include_str!("codex-runtime.package-lock.json");

fn install_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn failed_step(stderr: String) -> Box<InstallStepResult> {
    Box::new(InstallStepResult {
        step: "codex".to_string(),
        command: format!("Colony Codex runtime {MANAGED_CODEX_RUNTIME_VERSION}"),
        success: false,
        stdout: String::new(),
        stderr,
        exit_code: None,
        hint: Some(
            "Colony could not set up Codex. Check your connection and app-data permissions, then retry.".to_string(),
        ),
    })
}

fn unsupported_step() -> Box<InstallStepResult> {
    Box::new(InstallStepResult {
        step: "codex-unsupported".to_string(),
        command: format!("Colony Codex runtime {MANAGED_CODEX_RUNTIME_VERSION}"),
        success: false,
        stdout: String::new(),
        stderr: format!(
            "Colony does not provide Codex for {}-{} yet",
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
        exit_code: None,
        hint: Some("Choose an installed harness that Colony can start.".to_string()),
    })
}

/// Install the pinned Codex CLI and ACP adapter if the managed copy is absent.
pub(super) fn ensure_managed_codex_blocking(
    reporter: &super::install_report::InstallReporter,
) -> Result<(), Box<InstallStepResult>> {
    let (Some(platform), Some(final_dir)) = (
        crate::managed_agents::managed_codex_platform(),
        crate::managed_agents::buzz_managed_codex_dir(),
    ) else {
        return Err(unsupported_step());
    };
    ensure_managed_codex_with_node(
        &final_dir,
        platform,
        super::managed_node::ensure_managed_node_runtime_blocking,
        |staging_dir| {
            let command = npm_ci_command(staging_dir);
            super::run_install_command_with_retry("codex", &command, reporter)
        },
    )
}

fn ensure_managed_codex_with_node(
    final_dir: &Path,
    platform: &str,
    ensure_node: impl FnOnce() -> Result<(), Box<InstallStepResult>>,
    run_install: impl FnOnce(&Path) -> InstallStepResult,
) -> Result<(), Box<InstallStepResult>> {
    ensure_node()?;
    if managed_codex_runtime_ready(final_dir) {
        return Ok(());
    }

    let _guard = install_lock()
        .lock()
        .map_err(|_| failed_step("Codex install lock poisoned".to_string()))?;
    if managed_codex_runtime_ready(final_dir) {
        return Ok(());
    }

    provision_missing_runtime(final_dir, platform, run_install)
}

fn provision_missing_runtime(
    final_dir: &Path,
    platform: &str,
    run_install: impl FnOnce(&Path) -> InstallStepResult,
) -> Result<(), Box<InstallStepResult>> {
    if managed_codex_runtime_ready(final_dir) {
        return Ok(());
    }

    let parent = final_dir
        .parent()
        .ok_or_else(|| failed_step("Codex runtime folder has no parent".to_string()))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| failed_step(format!("create Codex runtime folder: {error}")))?;
    let staging_dir = staging_dir(parent, platform);
    remove_staging(&staging_dir).map_err(failed_step)?;
    std::fs::create_dir_all(&staging_dir)
        .map_err(|error| failed_step(format!("create Codex staging folder: {error}")))?;
    std::fs::write(staging_dir.join("package.json"), PACKAGE_JSON)
        .map_err(|error| failed_step(format!("write Codex package manifest: {error}")))?;
    std::fs::write(staging_dir.join("package-lock.json"), PACKAGE_LOCK)
        .map_err(|error| failed_step(format!("write Codex package lock: {error}")))?;

    let result = run_install(&staging_dir);
    if !result.success {
        if let Err(error) = remove_staging(&staging_dir) {
            return Err(Box::new(InstallStepResult {
                stderr: format!(
                    "{}\nCould not remove the failed staging folder: {error}",
                    result.stderr
                ),
                ..result
            }));
        }
        return Err(Box::new(result));
    }

    if let Err(error) = validate_runtime_tree(&staging_dir) {
        let cleanup_error = remove_staging(&staging_dir).err();
        let stderr = cleanup_error.map_or(error.clone(), |cleanup| {
            format!("{error}\nCould not remove the failed staging folder: {cleanup}")
        });
        return Err(failed_step(stderr));
    }

    // Another Colony process can finish the same pinned install while this
    // process is downloading. Keep its complete runtime and discard our stage.
    if managed_codex_runtime_ready(final_dir) {
        remove_staging(&staging_dir).map_err(failed_step)?;
        return Ok(());
    }

    if final_dir.exists() {
        std::fs::remove_dir_all(final_dir)
            .map_err(|error| failed_step(format!("replace incomplete Codex runtime: {error}")))?;
    }
    if let Err(error) = std::fs::rename(&staging_dir, final_dir) {
        let cleanup = remove_staging(&staging_dir).err();
        let detail = cleanup.map_or_else(
            || format!("promote Codex runtime: {error}"),
            |cleanup| format!("promote Codex runtime: {error}; {cleanup}"),
        );
        return Err(failed_step(detail));
    }

    validate_runtime_tree(final_dir).map_err(failed_step)
}

fn staging_dir(parent: &Path, platform: &str) -> PathBuf {
    parent.join(format!(".{platform}.tmp-{}", std::process::id()))
}

fn remove_staging(path: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove Codex staging folder: {error}")),
    }
}

fn npm_ci_command(staging_dir: &Path) -> String {
    format!(
        "npm ci --prefix {} --ignore-scripts --no-audit --no-fund --include=optional",
        shell_quote(staging_dir)
    )
}

fn shell_quote(path: &Path) -> String {
    let value = path.to_string_lossy();
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn managed_codex_runtime_ready(dir: &Path) -> bool {
    validate_runtime_tree(dir).is_ok()
}

fn validate_runtime_tree(dir: &Path) -> Result<(), String> {
    let adapter = dir.join("node_modules/@agentclientprotocol/codex-acp/package.json");
    let cli = dir.join("node_modules/@openai/codex/package.json");
    if package_version(&adapter)? != CODEX_ACP_VERSION {
        return Err(format!(
            "Codex ACP adapter must be version {CODEX_ACP_VERSION}"
        ));
    }
    if package_version(&cli)? != CODEX_CLI_VERSION {
        return Err(format!("Codex CLI must be version {CODEX_CLI_VERSION}"));
    }
    let platform = crate::managed_agents::managed_codex_platform()
        .ok_or_else(|| "Colony does not provide Codex for this platform".to_string())?;
    let platform_cli = dir.join(format!(
        "node_modules/@openai/codex-{platform}/package.json"
    ));
    let expected_platform_version = format!("{CODEX_CLI_VERSION}-{platform}");
    if package_version(&platform_cli)? != expected_platform_version {
        return Err(format!(
            "Codex CLI platform package must be version {expected_platform_version}"
        ));
    }
    for command in ["codex-acp", "codex"] {
        if !command_shim_exists(&dir.join("node_modules/.bin"), command) {
            return Err(format!("Codex runtime is missing the {command} command"));
        }
    }
    Ok(())
}

fn package_version(path: &Path) -> Result<String, String> {
    let contents = std::fs::read_to_string(path)
        .map_err(|error| format!("read {}: {error}", path.display()))?;
    let package: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("parse {}: {error}", path.display()))?;
    package
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("{} has no package version", path.display()))
}

fn command_shim_exists(bin_dir: &Path, command: &str) -> bool {
    #[cfg(windows)]
    let suffixes = ["cmd", "ps1", "exe"];
    #[cfg(not(windows))]
    let suffixes = [""];
    suffixes.iter().any(|suffix| {
        let name = if suffix.is_empty() {
            command.to_string()
        } else {
            format!("{command}.{suffix}")
        };
        let path = bin_dir.join(name);
        let Ok(metadata) = path.metadata() else {
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
    })
}

#[cfg(test)]
#[path = "managed_codex_tests.rs"]
mod tests;
