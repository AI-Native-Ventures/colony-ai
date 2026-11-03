use super::{
    known_acp_runtime_exact, managed_binary_runtime, runtime_can_auto_install,
    runtime_command_candidates,
};

#[test]
fn unavailable_catalog_rows_retain_declared_runtime_commands() {
    let codex = known_acp_runtime_exact("codex").unwrap();
    assert_eq!(
        runtime_command_candidates(codex),
        vec!["codex-acp".to_string()]
    );
}

#[test]
fn auto_installability_requires_the_prerequisites_to_finish_setup() {
    let claude = known_acp_runtime_exact("claude").unwrap();
    let codex = known_acp_runtime_exact("codex").unwrap();

    assert!(runtime_can_auto_install(claude, false));
    assert!(!runtime_can_auto_install(claude, true));
    assert_eq!(
        runtime_can_auto_install(codex, false),
        managed_binary_runtime("codex"),
        "Codex is installable only where Colony has a managed runtime"
    );
}
