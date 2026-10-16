use super::*;

#[test]
fn artifact_table_pins_every_supported_platform() {
    let platforms: Vec<&str> = OPENCODE_ARTIFACTS.iter().map(|a| a.platform).collect();
    assert_eq!(
        platforms,
        [
            "darwin-arm64",
            "darwin-x64",
            "linux-x64",
            "linux-arm64",
            "windows-x64",
            "windows-arm64"
        ]
    );
    for artifact in OPENCODE_ARTIFACTS {
        assert_eq!(artifact.sha256.len(), 64, "{}", artifact.platform);
        assert!(artifact.sha256.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(artifact.filename.starts_with("opencode-"));
    }
}

#[test]
fn every_managed_platform_has_an_artifact() {
    // The path helper and the artifact table must agree, or a supported
    // platform would resolve a folder that can never be installed.
    if let Some(platform) = crate::managed_agents::managed_opencode_platform() {
        assert!(OPENCODE_ARTIFACTS.iter().any(|a| a.platform == platform));
    }
}

#[test]
fn download_url_uses_pinned_release() {
    assert_eq!(
        download_url(OPENCODE_ARTIFACTS[0]),
        "https://github.com/anomalyco/opencode/releases/download/v1.19.2/opencode-darwin-arm64.zip"
    );
}

#[test]
fn unsupported_platform_step_has_hint() {
    let step = opencode_unsupported_step("linux", "riscv64");
    assert!(!step.success);
    assert!(step.stderr.contains("linux-riscv64"), "{}", step.stderr);
    assert_eq!(
        step.hint.as_deref(),
        Some("Choose Use your own AI to connect Claude Code, Codex or OpenRouter instead.")
    );
}

#[test]
fn managed_binary_runtime_is_opencode_only() {
    assert!(crate::managed_agents::managed_binary_runtime("opencode"));
    assert!(!crate::managed_agents::managed_binary_runtime("codex"));
    assert!(!crate::managed_agents::managed_binary_runtime("buzz-agent"));
}

#[test]
fn installed_binary_check_requires_executable_file() {
    let dir = tempfile::tempdir().unwrap();
    assert!(!opencode_binary_ready(dir.path()));
    let bin = dir.path().join(opencode_binary_name());
    std::fs::write(&bin, b"x").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert!(!opencode_binary_ready(dir.path()));
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    assert!(opencode_binary_ready(dir.path()));
}
