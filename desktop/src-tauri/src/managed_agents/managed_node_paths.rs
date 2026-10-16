use std::path::PathBuf;

pub(crate) fn buzz_managed_npm_prefix() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("Colony").join("node-tools"))
}

const BUZZ_MANAGED_NODE_VERSION: &str = "v24.18.0";

pub(crate) fn buzz_managed_node_root() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("Colony").join("runtimes").join("node"))
}

pub(crate) fn buzz_managed_node_bin_dir() -> Option<PathBuf> {
    let (platform, bin_subdir): (&str, Option<&str>) =
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => ("darwin-arm64", Some("bin")),
            ("macos", "x86_64") => ("darwin-x64", Some("bin")),
            ("linux", "x86_64") => ("linux-x64", Some("bin")),
            ("linux", "aarch64") => ("linux-arm64", Some("bin")),
            // Windows zips have node.exe + npm.cmd at the archive root — no bin/ subdir
            ("windows", "x86_64") => ("win-x64", None),
            ("windows", "aarch64") => ("win-arm64", None),
            _ => return None,
        };
    buzz_managed_node_root().map(|root| {
        let dir = root.join(BUZZ_MANAGED_NODE_VERSION).join(platform);
        match bin_subdir {
            Some(sub) => dir.join(sub),
            None => dir,
        }
    })
}

pub(crate) fn buzz_managed_node_bin_path() -> Option<PathBuf> {
    buzz_managed_node_bin_dir().map(|bin| {
        #[cfg(windows)]
        {
            bin.join("node.exe")
        }
        #[cfg(not(windows))]
        {
            bin.join("node")
        }
    })
}

pub(crate) const MANAGED_OPENCODE_VERSION: &str = "v1.19.2";

/// Runtimes whose binary Colony downloads itself instead of running an installer.
pub(crate) fn managed_binary_runtime(runtime_id: &str) -> bool {
    runtime_id == "opencode"
}

pub(crate) fn managed_opencode_platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "x86_64") => Some("linux-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("windows", "x86_64") => Some("windows-x64"),
        ("windows", "aarch64") => Some("windows-arm64"),
        _ => None,
    }
}

/// Colony's own OpenCode folder for this platform (Start free).
pub(crate) fn buzz_managed_opencode_dir() -> Option<PathBuf> {
    let platform = managed_opencode_platform()?;
    dirs::data_dir().map(|dir| {
        dir.join("Colony")
            .join("runtimes")
            .join("opencode")
            .join(MANAGED_OPENCODE_VERSION)
            .join(platform)
    })
}

pub(crate) fn buzz_managed_npm_bin_dir() -> Option<PathBuf> {
    buzz_managed_npm_prefix().map(|prefix| {
        #[cfg(windows)]
        {
            prefix
        }
        #[cfg(not(windows))]
        {
            prefix.join("bin")
        }
    })
}

pub(crate) fn buzz_managed_command_path(command: &str, basename: &str) -> Option<PathBuf> {
    managed_command_path_in(
        command,
        basename,
        buzz_managed_opencode_dir(),
        buzz_managed_npm_bin_dir(),
        buzz_managed_node_bin_dir(),
    )
}

/// Resolve a Colony-managed command from the given folders. Colony's own
/// OpenCode folder is searched first, so Start free never runs another copy.
fn managed_command_path_in(
    command: &str,
    basename: &str,
    opencode_dir: Option<PathBuf>,
    npm_bin_dir: Option<PathBuf>,
    node_bin_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    if command.contains(std::path::MAIN_SEPARATOR)
        || !matches!(
            command,
            "codex-acp" | "claude-agent-acp" | "claude-code-acp" | "node" | "npm" | "opencode"
        )
    {
        return None;
    }

    let mut dirs = Vec::new();
    if command == "opencode" {
        dirs.extend(opencode_dir);
    }
    dirs.extend(npm_bin_dir);
    dirs.extend(node_bin_dir);

    dirs.into_iter()
        .map(|dir| dir.join(basename))
        .find(|candidate| is_executable_file(candidate))
}

fn is_executable_file(path: &std::path::Path) -> bool {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    fn executable(dir: &std::path::Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    #[test]
    fn managed_command_path_prefers_managed_opencode() {
        let opencode_dir = tempfile::tempdir().unwrap();
        let npm_dir = tempfile::tempdir().unwrap();
        let ours = executable(opencode_dir.path(), "opencode");
        executable(npm_dir.path(), "opencode");
        assert_eq!(
            managed_command_path_in(
                "opencode",
                "opencode",
                Some(opencode_dir.path().to_path_buf()),
                Some(npm_dir.path().to_path_buf()),
                None,
            ),
            Some(ours)
        );
        // Without Colony's copy, nothing in our folders stands in for it but npm's.
        assert!(managed_command_path_in("opencode", "opencode", None, None, None).is_none());
        // Commands off the allow-list never resolve here.
        assert!(managed_command_path_in(
            "not-a-colony-tool",
            "opencode",
            Some(opencode_dir.path().to_path_buf()),
            None,
            None,
        )
        .is_none());
    }

    #[test]
    fn managed_opencode_folder_is_only_searched_for_opencode() {
        let opencode_dir = tempfile::tempdir().unwrap();
        executable(opencode_dir.path(), "codex-acp");
        assert!(managed_command_path_in(
            "codex-acp",
            "codex-acp",
            Some(opencode_dir.path().to_path_buf()),
            None,
            None,
        )
        .is_none());
    }

    #[test]
    fn managed_opencode_dir_is_versioned_under_colony_runtimes() {
        let Some(dir) = buzz_managed_opencode_dir() else {
            return;
        };
        let text = dir.to_string_lossy().replace('\\', "/");
        assert!(
            text.contains("/Colony/runtimes/opencode/v1.19.2/"),
            "{text}"
        );
    }
}
