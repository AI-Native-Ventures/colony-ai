//! What the model reads from this server says Colony, and the legacy `buzz`
//! name keeps working for older agents, scripts, and saved memory.

use crate::shell::build_bootstrap_with;
use crate::shim::{is_cli_name, MULTICALL_NAMES};
use std::path::Path;

#[test]
fn bootstrap_points_agents_at_the_colony_command() {
    let text = build_bootstrap_with(Path::new("/work"), "bash", true);
    assert!(text.contains("Colony is connected"), "{text}");
    assert!(text.contains("`colony --help`"), "{text}");
    assert!(
        !text.to_ascii_lowercase().contains("buzz"),
        "bootstrap leaks the old name: {text}"
    );
}

#[test]
fn bootstrap_omits_the_command_hint_when_colony_is_not_configured() {
    let text = build_bootstrap_with(Path::new("/work"), "bash", false);
    assert!(text.starts_with("Working directory: /work\n"), "{text}");
    assert!(!text.contains("colony"), "{text}");
    assert!(
        !text.to_ascii_lowercase().contains("buzz"),
        "bootstrap leaks the old name: {text}"
    );
}

#[test]
fn bootstrap_does_not_name_the_shell_override_variable() {
    let text = build_bootstrap_with(Path::new("/work"), "bash", true);
    assert!(
        text.contains("Shell: bash. Write command strings"),
        "{text}"
    );
    assert!(!text.contains("BUZZ_"), "{text}");
}

#[test]
fn cli_personality_answers_to_colony_and_legacy_buzz_only() {
    for name in MULTICALL_NAMES {
        assert_eq!(
            is_cli_name(name),
            matches!(name, "colony" | "buzz"),
            "unexpected CLI personality decision for {name}"
        );
    }
    assert!(MULTICALL_NAMES.contains(&"colony"));
    assert!(MULTICALL_NAMES.contains(&"buzz"));
    assert!(!is_cli_name("rg"));
    assert!(!is_cli_name("buzz-dev-mcp"));
}

#[cfg(unix)]
#[test]
fn shim_directory_links_colony_and_buzz_to_the_same_binary() {
    use crate::shim::link_multicall_names;

    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("fake-sidecar");
    std::fs::write(&target, b"").expect("write target");
    let shim_dir = dir.path().join("shims");
    std::fs::create_dir(&shim_dir).expect("create shim dir");

    link_multicall_names(&shim_dir, &target).expect("link names");

    let expected = std::fs::canonicalize(&target).expect("canonical target");
    for name in ["colony", "buzz"] {
        let link = shim_dir.join(name);
        assert_eq!(
            std::fs::canonicalize(&link).unwrap_or_else(|e| panic!("{name} link missing: {e}")),
            expected,
            "{name} must resolve to the sidecar binary"
        );
    }
}
