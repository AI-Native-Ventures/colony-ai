//! User installation locations shared by discovery and child-process PATHs.
use std::io::Read;
use std::path::{Path, PathBuf};

/// Common user prefixes, including app-bundled Codex CLI resources.
pub(crate) fn user_binary_paths(home: &Path) -> Vec<PathBuf> {
    let mut paths = [
        ".local/bin",
        ".local/share/mise/shims",
        ".volta/bin",
        ".asdf/shims",
        ".bun/bin",
        ".local/share/pnpm",
        ".pnpm",
        ".npm-global/bin",
        ".npm-packages/bin",
        ".npm/bin",
        ".codex/bin",
        ".codex/packages/standalone/current/bin",
    ]
    .into_iter()
    .map(|path| {
        path.split('/')
            .fold(home.to_path_buf(), |prefix, component| {
                prefix.join(component)
            })
    })
    .collect::<Vec<_>>();
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/Applications/Codex.app/Contents/Resources"));
        paths.push(home.join("Applications/Codex.app/Contents/Resources"));
        paths.push(home.join("Library/pnpm"));
    }
    #[cfg(windows)]
    {
        paths.push(home.join("scoop").join("shims"));
        if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
            paths.push(local.join("pnpm"));
            paths.push(local.join("Volta").join("bin"));
        }
        if let Some(programs) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
            paths.push(programs.join("nodejs"));
        }
    }
    for key in ["PNPM_HOME", "NVM_BIN"] {
        if let Some(path) = std::env::var_os(key)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
        {
            paths.push(path);
        }
    }
    for key in ["NPM_CONFIG_PREFIX", "npm_config_prefix"] {
        if let Some(path) = std::env::var_os(key)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
        {
            paths.push(npm_bin_dir(path));
        }
    }
    // Read only a bounded local config to find a custom npm prefix. Never log
    // its contents: other entries may contain registry credentials.
    if let Ok(file) = std::fs::File::open(home.join(".npmrc")) {
        let mut config = String::new();
        if file.take(64 * 1024).read_to_string(&mut config).is_ok() && config.len() < 64 * 1024 {
            if let Some(prefix) = npm_prefix(&config, home) {
                paths.push(npm_bin_dir(prefix));
            }
        }
    }
    paths
}

fn npm_bin_dir(prefix: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        prefix
    }
    #[cfg(not(windows))]
    {
        prefix.join("bin")
    }
}

fn npm_prefix(config: &str, home: &Path) -> Option<PathBuf> {
    config.lines().rev().find_map(|line| {
        let (key, value) = line.trim().split_once('=')?;
        if key.trim() != "prefix" {
            return None;
        }
        let value = value.trim().trim_matches(['\'', '"']);
        let value = if let Some(relative) = value.strip_prefix("~/") {
            home.join(relative)
        } else if let Some(relative) = value.strip_prefix("${HOME}/") {
            home.join(relative)
        } else {
            PathBuf::from(value)
        };
        value.is_absolute().then_some(value)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_custom_npm_prefix_without_interpreting_other_config() {
        let directory = tempfile::tempdir().unwrap();
        let home = directory.path();
        let expected = home.join(".npm-custom");
        for text in [
            "prefix=~/.npm-custom".to_string(),
            "prefix=${HOME}/.npm-custom".to_string(),
            format!("prefix='{}'", expected.display()),
        ] {
            assert_eq!(npm_prefix(&text, home), Some(expected.clone()));
        }
        assert_eq!(npm_prefix("prefix=relative", home), None);
        assert_eq!(
            npm_prefix("#prefix=/comment\nregistry=https://example.com", home),
            None
        );
    }
    #[test]
    fn user_prefix_resolution_uses_platform_npm_shim_directory() {
        let _guard = crate::managed_agents::lock_path_mutex();
        let home = tempfile::tempdir().unwrap();
        let prefix = home.path().join("custom-npm");
        let previous = std::env::var_os("NPM_CONFIG_PREFIX");
        std::env::set_var("NPM_CONFIG_PREFIX", &prefix);
        let paths = user_binary_paths(home.path());
        match previous {
            Some(value) => std::env::set_var("NPM_CONFIG_PREFIX", value),
            None => std::env::remove_var("NPM_CONFIG_PREFIX"),
        }
        #[cfg(windows)]
        assert!(paths.contains(&prefix));
        #[cfg(not(windows))]
        assert!(paths.contains(&prefix.join("bin")));
    }
    #[cfg(windows)]
    #[test]
    fn windows_user_managers_have_native_paths_without_shell_discovery() {
        let _guard = crate::managed_agents::lock_path_mutex();
        let home = tempfile::tempdir().unwrap();
        let local = home.path().join("AppData").join("Local");
        let programs = home.path().join("Program Files");
        let previous = ["LOCALAPPDATA", "ProgramFiles"].map(|key| (key, std::env::var_os(key)));
        std::env::set_var("LOCALAPPDATA", &local);
        std::env::set_var("ProgramFiles", &programs);
        let paths = user_binary_paths(home.path());
        for (key, value) in previous {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        for expected in [
            local.join("pnpm"),
            local.join("Volta").join("bin"),
            home.path().join("scoop").join("shims"),
            programs.join("nodejs"),
        ] {
            assert!(paths.contains(&expected), "missing {expected:?}");
        }
        assert!(paths
            .iter()
            .take(12)
            .all(|path| !path.to_string_lossy().contains('/')));
    }
    #[cfg(unix)]
    #[test]
    fn gui_process_can_find_a_codex_install_without_shell_path() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join(".codex/packages/standalone/current/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let binary = bin.join("codex");
        std::fs::write(&binary, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(user_binary_paths(home.path())
            .iter()
            .any(|dir| super::super::is_executable_file(&dir.join("codex"))));

        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!super::super::is_executable_file(&binary));
    }
}

#[cfg(all(test, unix))]
#[test]
fn production_resolver_finds_standalone_codex_and_npm_prefix_without_shell_spawn() {
    let _guard = crate::managed_agents::lock_path_mutex();
    super::login_shell_spawn_probe::run_in_isolated_process(|| {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("HOME", home.path());
        std::env::set_var("XDG_DATA_HOME", home.path().join("data"));
        std::env::set_var("PATH", "");
        for key in [
            "NVM_BIN",
            "PNPM_HOME",
            "NPM_CONFIG_PREFIX",
            "npm_config_prefix",
        ] {
            std::env::remove_var(key);
        }
        let command = format!("colony-standalone-probe-{}", uuid::Uuid::new_v4());
        let standalone = home
            .path()
            .join(".codex/packages/standalone/current/bin")
            .join(&command);
        let prefix = home.path().join("custom-npm");
        let npm_command = format!("colony-prefix-probe-{}", uuid::Uuid::new_v4());
        let npm_cli = prefix.join("bin").join(&npm_command);
        for binary in [&standalone, &npm_cli] {
            std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
            std::fs::write(binary, "#!/bin/sh\nexit 0\n").unwrap();
            std::fs::set_permissions(binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::env::set_var("NPM_CONFIG_PREFIX", &prefix);
        super::clear_resolve_cache();
        super::login_shell_spawn_probe::reset();
        assert_eq!(super::resolve_command(&command), Some(standalone));
        assert_eq!(super::resolve_command(&npm_command), Some(npm_cli));
        assert_eq!(super::login_shell_spawn_probe::count(), 0);
    });
}
