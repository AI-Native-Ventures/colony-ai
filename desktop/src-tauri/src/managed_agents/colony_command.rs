//! The `colony` command agents run.
//!
//! The bundled CLI sidecar is named `buzz` on disk, and that name keeps working
//! so older agents, scripts, and saved memory do not break. Agents are taught
//! `colony` instead. At boot Colony links `colony` to the sidecar inside an
//! app-private directory that is already on every managed agent's PATH (see
//! [`agent_command_dir`]). The dev-MCP shell shim answers to the same name for
//! agents that run through it, and the CLI prints the name it was invoked as.

use std::path::{Path, PathBuf};

/// The command name agents are taught.
#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) const AGENT_COMMAND: &str = "colony";

/// File name of the bundled CLI sidecar next to the app executable.
#[cfg_attr(not(unix), allow(dead_code))]
const SIDECAR_NAME: &str = "buzz";

/// The app-private directory that holds the `colony` link.
///
/// This is the managed npm bin directory: it lives under the app's own data
/// folder and `build_augmented_path` already puts it on the PATH of every
/// managed agent, ahead of the executable's own folder.
pub(crate) fn agent_command_dir() -> Option<PathBuf> {
    super::buzz_managed_npm_bin_dir()
}

/// Whether this build owns the shared `colony` link.
///
/// `colony` is one fixed name in a directory every build on the machine shares,
/// so a dev or demo build, which has its own nest and CLI identity, must never
/// repoint the link a production build relies on.
pub(crate) fn owns_agent_command_link(is_dev: bool, demo_slug: Option<&str>) -> bool {
    !is_dev && demo_slug.is_none()
}

/// Link `colony` to the bundled CLI so agents can run it.
///
/// Runs at every boot, so an app update or move repoints the link. Does nothing
/// when this build does not own the link or the CLI is not bundled (dev builds
/// without sidecars). Callers log a returned error and carry on: the next boot
/// retries, and agents that run through the dev-MCP shim still get `colony`.
pub fn ensure_agent_command_link(exe_parent: &Path, is_dev: bool) -> Result<(), String> {
    if !owns_agent_command_link(is_dev, crate::build_identity::demo_slug()) {
        return Ok(());
    }
    let dir = agent_command_dir().ok_or("cannot resolve the managed tools directory")?;
    link_agent_command(exe_parent, &dir)
}

/// Point `<link_dir>/colony` at `<exe_parent>/buzz`.
///
/// - No-op when the sidecar is absent.
/// - Leaves a correct link untouched.
/// - Replaces a stale link atomically (stage, then rename), so a running agent
///   never sees the command missing.
/// - Refuses to replace anything that is not a symlink, and says so.
#[cfg(unix)]
pub(crate) fn link_agent_command(exe_parent: &Path, link_dir: &Path) -> Result<(), String> {
    use std::{fs, io};

    let sidecar = exe_parent.join(SIDECAR_NAME);
    if !sidecar.exists() {
        return Ok(());
    }
    fs::create_dir_all(link_dir).map_err(|e| format!("create {}: {e}", link_dir.display()))?;

    let link = link_dir.join(AGENT_COMMAND);
    match link.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            if crate::util::symlink_points_to(&link, &sidecar) {
                return Ok(());
            }
        }
        Ok(_) => {
            return Err(format!(
                "{} exists and is not a symlink; leaving it in place",
                link.display()
            ));
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("stat {}: {e}", link.display())),
    }

    let staging = link_dir.join(format!(".{AGENT_COMMAND}.{}.tmp", std::process::id()));
    match fs::remove_file(&staging) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("remove {}: {e}", staging.display())),
    }
    crate::util::create_symlink(&sidecar, &staging)
        .map_err(|e| format!("symlink {}: {e}", staging.display()))?;
    fs::rename(&staging, &link).map_err(|e| {
        let _ = fs::remove_file(&staging);
        format!("replace {}: {e}", link.display())
    })
}

/// No-op on non-Unix platforms: the sidecar there is `buzz.exe`, and agents that
/// run through the dev-MCP shim get `colony` from its own multicall copy.
#[cfg(not(unix))]
pub(crate) fn link_agent_command(_exe_parent: &Path, _link_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;

    fn sidecar_dir(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(SIDECAR_NAME), "binary").unwrap();
        dir
    }

    #[test]
    fn colony_is_linked_to_the_bundled_cli() {
        let tmp = tempfile::tempdir().unwrap();
        let exe_parent = sidecar_dir(tmp.path(), "MacOS");
        let link_dir = tmp.path().join("tools/bin");

        link_agent_command(&exe_parent, &link_dir).unwrap();

        let link = link_dir.join("colony");
        assert!(link.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(fs::read_link(&link).unwrap(), exe_parent.join("buzz"));
        assert_eq!(fs::read_to_string(&link).unwrap(), "binary");
    }

    #[test]
    fn linking_twice_leaves_one_correct_link_and_no_staging_file() {
        let tmp = tempfile::tempdir().unwrap();
        let exe_parent = sidecar_dir(tmp.path(), "MacOS");
        let link_dir = tmp.path().join("bin");

        link_agent_command(&exe_parent, &link_dir).unwrap();
        link_agent_command(&exe_parent, &link_dir).unwrap();

        let names: Vec<String> = fs::read_dir(&link_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["colony".to_string()]);
    }

    #[test]
    fn an_app_update_repoints_the_link() {
        let tmp = tempfile::tempdir().unwrap();
        let old_app = sidecar_dir(tmp.path(), "old/MacOS");
        let new_app = sidecar_dir(tmp.path(), "new/MacOS");
        let link_dir = tmp.path().join("bin");

        link_agent_command(&old_app, &link_dir).unwrap();
        link_agent_command(&new_app, &link_dir).unwrap();

        assert_eq!(
            fs::read_link(link_dir.join("colony")).unwrap(),
            new_app.join("buzz")
        );
    }

    #[test]
    fn a_dangling_link_from_a_removed_app_is_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let link_dir = tmp.path().join("bin");
        fs::create_dir_all(&link_dir).unwrap();
        std::os::unix::fs::symlink("/nonexistent/Colony.app/buzz", link_dir.join("colony"))
            .unwrap();
        let exe_parent = sidecar_dir(tmp.path(), "MacOS");

        link_agent_command(&exe_parent, &link_dir).unwrap();

        assert_eq!(
            fs::read_link(link_dir.join("colony")).unwrap(),
            exe_parent.join("buzz")
        );
    }

    #[test]
    fn nothing_is_created_when_the_cli_is_not_bundled() {
        let tmp = tempfile::tempdir().unwrap();
        let exe_parent = tmp.path().join("target/debug");
        fs::create_dir_all(&exe_parent).unwrap();
        let link_dir = tmp.path().join("bin");

        link_agent_command(&exe_parent, &link_dir).unwrap();

        assert!(!link_dir.exists(), "no directory should be created");
    }

    #[test]
    fn a_regular_file_named_colony_is_never_clobbered() {
        let tmp = tempfile::tempdir().unwrap();
        let exe_parent = sidecar_dir(tmp.path(), "MacOS");
        let link_dir = tmp.path().join("bin");
        fs::create_dir_all(&link_dir).unwrap();
        fs::write(link_dir.join("colony"), "user installed").unwrap();

        let error = link_agent_command(&exe_parent, &link_dir).unwrap_err();

        assert!(error.contains("not a symlink"), "{error}");
        assert_eq!(
            fs::read_to_string(link_dir.join("colony")).unwrap(),
            "user installed"
        );
    }

    #[test]
    fn only_production_builds_own_the_shared_link() {
        assert!(owns_agent_command_link(false, None));
        assert!(!owns_agent_command_link(true, None));
        assert!(!owns_agent_command_link(false, Some("acme")));
        assert!(!owns_agent_command_link(true, Some("acme")));
    }

    #[test]
    fn the_link_directory_is_on_the_path_every_agent_gets() {
        // Binds the directory the link is written to to the PATH agents are
        // spawned with: if either side moves, `colony` stops resolving.
        let _guard = crate::managed_agents::lock_path_mutex();
        let dir = agent_command_dir().expect("managed tools directory resolves");
        let path = crate::managed_agents::runtime::build_augmented_path(
            Some(PathBuf::from("/home/agent")),
            Some(PathBuf::from("/app/sidecars")),
            None,
            None,
        )
        .expect("agent PATH is built");

        let entries: Vec<PathBuf> = std::env::split_paths(&path).collect();
        let position = entries
            .iter()
            .position(|entry| entry == &dir)
            .unwrap_or_else(|| panic!("{} missing from agent PATH {path}", dir.display()));
        let sidecars = entries
            .iter()
            .position(|entry| entry == Path::new("/app/sidecars"))
            .expect("sidecar directory is on the agent PATH");
        assert!(
            position < sidecars,
            "the colony link must win over the sidecar folder: {path}"
        );
    }
}
