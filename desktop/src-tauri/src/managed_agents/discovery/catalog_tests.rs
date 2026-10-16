use super::{KnownAcpRuntime, KNOWN_ACP_RUNTIMES};

fn opencode() -> &'static KnownAcpRuntime {
    KNOWN_ACP_RUNTIMES
        .iter()
        .find(|runtime| runtime.id == "opencode")
        .expect("opencode runtime")
}

#[test]
fn opencode_is_a_known_runtime_with_acp_command() {
    let runtime = opencode();
    assert_eq!(runtime.commands, &["opencode"]);
    assert_eq!(runtime.label, "OpenCode");
    assert!(runtime.cli_install_commands.is_empty(), "no install script");
    assert!(runtime.auth_probe_args.is_none(), "no sign-in");
    assert!(runtime.supports_acp_model_switching);
}

#[test]
fn opencode_default_env_disables_updates_and_sharing_only() {
    assert_eq!(
        opencode().default_env,
        &[(
            "OPENCODE_CONFIG_CONTENT",
            r#"{"autoupdate":false,"share":"disabled"}"#
        )]
    );
}

#[test]
fn opencode_is_no_longer_a_preset() {
    assert!(super::super::presets::preset_harness_ids()
        .iter()
        .all(|id| *id != "opencode"));
}

#[test]
fn opencode_default_args_are_acp() {
    use super::super::normalize_agent_args;
    assert_eq!(
        normalize_agent_args("opencode", vec![]),
        vec!["acp".to_string()]
    );
    assert_eq!(
        normalize_agent_args(
            "/Users/x/Library/Application Support/Colony/runtimes/opencode/v1.19.2/darwin-arm64/opencode",
            vec![],
        ),
        vec!["acp".to_string()]
    );
}
