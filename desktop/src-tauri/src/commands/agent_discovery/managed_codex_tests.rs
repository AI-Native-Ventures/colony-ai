use super::*;

fn install_result(success: bool) -> InstallStepResult {
    InstallStepResult {
        step: "codex".to_string(),
        command: "npm ci --ignore-scripts".to_string(),
        success,
        stdout: String::new(),
        stderr: if success {
            String::new()
        } else {
            "registry unavailable".to_string()
        },
        exit_code: Some(if success { 0 } else { 1 }),
        hint: None,
    }
}

fn write_runtime_tree(dir: &Path) {
    let platform = crate::managed_agents::managed_codex_platform()
        .expect("tests run on a supported Codex platform");
    for (package, version) in [
        (
            "@agentclientprotocol/codex-acp".to_string(),
            CODEX_ACP_VERSION.to_string(),
        ),
        ("@openai/codex".to_string(), CODEX_CLI_VERSION.to_string()),
        (
            format!("@openai/codex-{platform}"),
            format!("{CODEX_CLI_VERSION}-{platform}"),
        ),
    ] {
        let package_dir = dir.join("node_modules").join(package);
        std::fs::create_dir_all(&package_dir).unwrap();
        std::fs::write(
            package_dir.join("package.json"),
            serde_json::json!({"version": version}).to_string(),
        )
        .unwrap();
    }
    let bin_dir = dir.join("node_modules/.bin");
    std::fs::create_dir_all(&bin_dir).unwrap();
    for command in ["codex-acp", "codex"] {
        let path = bin_dir.join(command);
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
}

#[cfg(unix)]
struct RestoreRuntimeTestEnvironment {
    home: Option<std::ffi::OsString>,
    xdg_data: Option<std::ffi::OsString>,
    path: Option<std::ffi::OsString>,
}

#[cfg(unix)]
impl Drop for RestoreRuntimeTestEnvironment {
    fn drop(&mut self) {
        for (key, value) in [
            ("HOME", self.home.take()),
            ("XDG_DATA_HOME", self.xdg_data.take()),
            ("PATH", self.path.take()),
        ] {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        crate::managed_agents::clear_resolve_cache();
        crate::managed_agents::refresh_login_shell_path();
    }
}

#[test]
fn package_manifest_and_lock_pin_both_packages_and_integrities() {
    let manifest: serde_json::Value = serde_json::from_str(PACKAGE_JSON).unwrap();
    let lock: serde_json::Value = serde_json::from_str(PACKAGE_LOCK).unwrap();
    assert_eq!(
        manifest["dependencies"]["@agentclientprotocol/codex-acp"],
        CODEX_ACP_VERSION
    );
    assert_eq!(manifest["dependencies"]["@openai/codex"], CODEX_CLI_VERSION);
    assert_eq!(
        lock["packages"]["node_modules/@agentclientprotocol/codex-acp"]["integrity"]
            .as_str()
            .unwrap(),
        "sha512-dppZxW3f8kNbTDbR25+lBLtNst5DIC/Sm7GtRF69PI1Ilqv12tDSsIb0hJQW0iNzkx+JdDvX76HOyv5Uibu1qQ=="
    );
    assert_eq!(
        lock["packages"]["node_modules/@openai/codex"]["integrity"]
            .as_str()
            .unwrap(),
        "sha512-tCAmvOk40hcmVDefwV4Jae/i5eAMrl7qUCRYUq1uYiQGZoIIVSCa/b3Fs+0uXG46p4jaG2DzqhG/RIunvnOa1g=="
    );
}

#[test]
fn a_missing_managed_adapter_runs_provisioning_and_promotes_only_a_valid_tree() {
    let temp = tempfile::tempdir().unwrap();
    let final_dir = temp.path().join("runtime");
    assert!(!managed_codex_runtime_ready(&final_dir));
    let mut install_calls = 0;

    let platform = crate::managed_agents::managed_codex_platform().unwrap();
    let result = provision_missing_runtime(&final_dir, platform, |staging| {
        install_calls += 1;
        assert!(staging.join("package.json").is_file());
        assert!(staging.join("package-lock.json").is_file());
        write_runtime_tree(staging);
        install_result(true)
    });

    assert!(result.is_ok());
    assert_eq!(install_calls, 1, "a missing runtime must provision once");
    assert!(managed_codex_runtime_ready(&final_dir));
    assert!(!staging_dir(temp.path(), platform).exists());
}

#[test]
fn runtime_readiness_requires_the_host_cli_payload() {
    let temp = tempfile::tempdir().unwrap();
    write_runtime_tree(temp.path());
    let platform = crate::managed_agents::managed_codex_platform().unwrap();
    std::fs::remove_dir_all(
        temp.path()
            .join(format!("node_modules/@openai/codex-{platform}")),
    )
    .unwrap();

    let error = validate_runtime_tree(temp.path()).unwrap_err();

    assert!(error.contains("package.json"), "{error}");
    assert!(!managed_codex_runtime_ready(temp.path()));
}

#[test]
fn failed_provisioning_propagates_the_cause_and_cleans_its_stage() {
    let temp = tempfile::tempdir().unwrap();
    let final_dir = temp.path().join("runtime");

    let platform = crate::managed_agents::managed_codex_platform().unwrap();
    let error =
        provision_missing_runtime(&final_dir, platform, |_| install_result(false)).unwrap_err();

    assert!(
        error.stderr.contains("registry unavailable"),
        "{}",
        error.stderr
    );
    assert!(!final_dir.exists());
    assert!(!staging_dir(temp.path(), platform).exists());
}

#[test]
fn an_existing_valid_runtime_skips_the_install_command() {
    let temp = tempfile::tempdir().unwrap();
    let final_dir = temp.path().join("runtime");
    std::fs::create_dir_all(&final_dir).unwrap();
    write_runtime_tree(&final_dir);

    let result = provision_missing_runtime(&final_dir, "darwin-arm64", |_| {
        panic!("a valid Colony-owned runtime must not install a second copy")
    });

    assert!(result.is_ok());
}

#[test]
fn an_existing_codex_runtime_recovers_an_orphaned_managed_node_before_ready_return() {
    let temp = tempfile::tempdir().unwrap();
    let final_dir = temp.path().join("runtime");
    std::fs::create_dir_all(&final_dir).unwrap();
    write_runtime_tree(&final_dir);

    let node_bin = temp.path().join("managed-node/bin/node");
    assert!(!node_bin.exists());
    let mut node_recovered = false;
    let platform = crate::managed_agents::managed_codex_platform().unwrap();
    let result = ensure_managed_codex_with_node(
        &final_dir,
        platform,
        || {
            std::fs::create_dir_all(node_bin.parent().unwrap()).unwrap();
            std::fs::write(&node_bin, "recovered managed Node").unwrap();
            node_recovered = true;
            Ok(())
        },
        |_| panic!("a ready Codex runtime must not be installed a second time"),
    );

    assert!(result.is_ok());
    assert!(node_recovered, "managed Node must be repaired first");
    assert!(node_bin.is_file());
}

/// Exercise forced catalog discovery with an app-owned package shim that runs
/// under a fallback PATH Node while Colony's pinned Node is absent. The public
/// catalog must route it to the existing setup action, which repairs Node
/// before taking the valid-package fast path and leaves that package intact.
#[cfg(unix)]
#[test]
fn forced_discovery_routes_fallback_node_codex_shim_through_managed_repair() {
    use crate::managed_agents::discover_acp_runtimes_from;
    use std::os::unix::fs::PermissionsExt;

    let _path_guard = crate::managed_agents::lock_path_mutex();
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    let data = temp.path().join("data");
    let fallback_bin = home.join(".nvm/versions/node/v22.0.0/bin");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&data).unwrap();
    std::fs::create_dir_all(&fallback_bin).unwrap();
    std::fs::create_dir_all(home.join(".nvm/alias")).unwrap();
    std::fs::write(home.join(".nvm/alias/default"), "v22.0.0\n").unwrap();
    let environment = RestoreRuntimeTestEnvironment {
        home: std::env::var_os("HOME"),
        xdg_data: std::env::var_os("XDG_DATA_HOME"),
        path: std::env::var_os("PATH"),
    };
    std::env::set_var("HOME", &home);
    std::env::set_var("XDG_DATA_HOME", &data);
    std::env::set_var(
        "PATH",
        std::env::join_paths([fallback_bin.clone(), Path::new("/usr/bin").to_path_buf()]).unwrap(),
    );
    crate::managed_agents::clear_resolve_cache();

    let platform = crate::managed_agents::managed_codex_platform().unwrap();
    let final_dir = crate::managed_agents::buzz_managed_codex_dir().unwrap();
    std::fs::create_dir_all(&final_dir).unwrap();
    write_runtime_tree(&final_dir);
    let shim = final_dir.join("node_modules/.bin/codex-acp");
    std::fs::write(&shim, "#!/usr/bin/env node\n").unwrap();
    std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();

    let fallback_node = fallback_bin.join("node");
    let fallback_marker = temp.path().join("fallback-node-ran");
    std::fs::write(
        &fallback_node,
        format!(
            "#!/bin/sh\ntest \"$1\" = {} || exit 3\nprintf '@agentclientprotocol/codex-acp {CODEX_ACP_VERSION}\\n'\ntouch {}\n",
            shell_quote(&shim),
            shell_quote(&fallback_marker),
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fallback_node, std::fs::Permissions::from_mode(0o755)).unwrap();
    let managed_node = crate::managed_agents::buzz_managed_node_bin_path().unwrap();
    assert!(
        !managed_node.exists(),
        "the pinned Node fixture starts missing"
    );

    let discovered = discover_acp_runtimes_from(None, true);
    let codex = discovered.iter().find(|entry| entry.id == "codex").unwrap();
    assert_eq!(
        codex.availability,
        crate::managed_agents::AcpAvailabilityStatus::AdapterOutdated,
        "a fallback Node must not mask an orphaned app-owned Codex shim"
    );
    assert_eq!(codex.command.as_deref(), Some("codex-acp"));
    assert_eq!(
        codex.binary_path.as_deref(),
        Some(shim.to_str().unwrap()),
        "forced discovery must resolve the app-owned shim"
    );
    assert!(
        codex.can_auto_install,
        "the catalog must expose setup/repair"
    );
    assert!(
        fallback_marker.is_file(),
        "fallback Node must run the shim probe"
    );
    assert!(managed_codex_runtime_ready(&final_dir));

    let shim_before_repair = std::fs::read(&shim).unwrap();
    let package_before_repair =
        std::fs::read(final_dir.join("node_modules/@agentclientprotocol/codex-acp/package.json"))
            .unwrap();
    let result = ensure_managed_codex_with_node(
        &final_dir,
        platform,
        || {
            std::fs::create_dir_all(managed_node.parent().unwrap()).unwrap();
            std::fs::write(&managed_node, "#!/bin/sh\nprintf 'v24.18.0\\n'\n").unwrap();
            std::fs::set_permissions(&managed_node, std::fs::Permissions::from_mode(0o755))
                .unwrap();
            Ok(())
        },
        |_| panic!("valid Codex packages must not be reinstalled during Node repair"),
    );

    assert!(result.is_ok());
    assert!(crate::commands::agent_discovery::managed_node::managed_node_runtime_ready());
    assert!(managed_codex_runtime_ready(&final_dir));
    assert_eq!(std::fs::read(&shim).unwrap(), shim_before_repair);
    assert_eq!(
        std::fs::read(final_dir.join("node_modules/@agentclientprotocol/codex-acp/package.json"))
            .unwrap(),
        package_before_repair
    );
    drop(environment);
}

#[test]
fn npm_install_is_local_to_the_staging_tree_and_never_global() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Colony's Codex");
    let command = npm_ci_command(&path);
    assert!(command.starts_with("npm ci --prefix '"), "{command}");
    assert!(command.contains("Colony'\\''s Codex"), "{command}");
    assert!(!command.contains("--global") && !command.contains(" -g"));
    assert!(command.ends_with("--ignore-scripts --no-audit --no-fund --include=optional"));
}
