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
    .map(|path| home.join(path))
    .collect::<Vec<_>>();
    #[cfg(target_os = "macos")]
    {
        paths.push(PathBuf::from("/Applications/Codex.app/Contents/Resources"));
        paths.push(home.join("Applications/Codex.app/Contents/Resources"));
        paths.push(home.join("Library/pnpm"));
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
            paths.push(path.join("bin"));
        }
    }
    // Read only a bounded local config to find a custom npm prefix. Never log
    // its contents: other entries may contain registry credentials.
    if let Ok(file) = std::fs::File::open(home.join(".npmrc")) {
        let mut config = String::new();
        if file.take(64 * 1024).read_to_string(&mut config).is_ok() && config.len() < 64 * 1024 {
            if let Some(prefix) = npm_prefix(&config, home) {
                paths.push(prefix.join("bin"));
            }
        }
    }
    paths
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
        let home = Path::new("/home/test");
        for text in [
            "prefix=~/.npm-custom",
            "prefix=${HOME}/.npm-custom",
            "prefix='/home/test/.npm-custom'",
        ] {
            assert_eq!(npm_prefix(text, home), Some(home.join(".npm-custom")));
        }
        assert_eq!(npm_prefix("prefix=relative", home), None);
        assert_eq!(
            npm_prefix("#prefix=/comment\nregistry=https://example.com", home),
            None
        );
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
        let standalone = home
            .path()
            .join(".codex/packages/standalone/current/bin/codex");
        let prefix = home.path().join("custom-npm");
        let npm_cli = prefix.join("bin/colony-prefix-probe");
        for binary in [&standalone, &npm_cli] {
            std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
            std::fs::write(binary, "#!/bin/sh\nexit 0\n").unwrap();
            std::fs::set_permissions(binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::env::set_var("NPM_CONFIG_PREFIX", &prefix);
        super::clear_resolve_cache();
        super::login_shell_spawn_probe::reset();
        assert_eq!(super::resolve_command("codex"), Some(standalone));
        assert_eq!(super::resolve_command("colony-prefix-probe"), Some(npm_cli));
        assert_eq!(super::login_shell_spawn_probe::count(), 0);
    });
}
