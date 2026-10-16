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
        if let Some(opencode_dir) = buzz_managed_opencode_dir() {
            dirs.push(opencode_dir);
        }
    }
    if let Some(managed_bin) = buzz_managed_npm_bin_dir() {
        dirs.push(managed_bin);
    }
    if let Some(managed_node_bin) = buzz_managed_node_bin_dir() {
        dirs.push(managed_node_bin);
    }

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

    #[test]
    fn managed_command_path_prefers_managed_opencode() {
        assert!(buzz_managed_command_path("not-a-colony-tool", "not-a-colony-tool").is_none());
        let Some(dir) = buzz_managed_opencode_dir() else {
            return;
        };
        let basename = if cfg!(windows) {
            "opencode.exe"
        } else {
            "opencode"
        };
        let candidate = dir.join(basename);
        assert_eq!(
            buzz_managed_command_path("opencode", basename),
            is_executable_file(&candidate).then_some(candidate)
        );
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
