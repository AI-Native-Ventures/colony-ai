//! First-run connection proof, using the selected adapter and launch environment.
use crate::managed_agents::{
    default_agent_workdir, normalize_agent_args, resolve_command, GlobalAgentConfig,
};
use serde_json::{json, Value};
use std::{process::Command, sync::LazyLock, time::Duration};

static CONNECTION_TEST: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Send a bounded first hello through the selected runtime's real ACP turn path.
#[tauri::command]
pub async fn test_onboarding_connection(config: GlobalAgentConfig) -> Result<Value, String> {
    let _test = CONNECTION_TEST
        .try_lock()
        .map_err(|_| "A connection test is still running. Wait a moment before retrying.")?;
    crate::managed_agents::validate_user_env_keys(&config.env_vars)?;
    let id = config
        .preferred_runtime
        .as_deref()
        .ok_or("Choose an AI harness before testing.")?;
    let runtime = crate::managed_agents::known_acp_runtime_exact(id)
        .ok_or("Connection testing is unavailable for this harness. Choose another connection.")?;
    let (agent, resolved_agent) = runtime
        .commands
        .iter()
        .find_map(|agent| resolve_command(agent).map(|path| (*agent, path)))
        .ok_or("Install this harness's ACP adapter, then check again.")?;
    let acp = resolve_command("buzz-acp")
        .ok_or("The Colony agent harness is missing. Reinstall Colony.")?;
    let mut command = Command::new(acp);
    command.arg("connection-test").arg("--json");
    command.env("BUZZ_ACP_AGENT_COMMAND", resolved_agent);
    command.env(
        "BUZZ_ACP_AGENT_ARGS",
        normalize_agent_args(agent, vec![]).join(","),
    );
    if let Some(cwd) = default_agent_workdir() {
        command.current_dir(cwd);
    }
    if let Some(path) = crate::managed_agents::readiness::cli_probe::augmented_path() {
        command.env("PATH", path);
    }
    for (key, value) in runtime.default_env {
        command.env(key, value);
    }
    crate::managed_agents::build_buzz_agent_provider_defaults(&mut command);
    for (key, value) in crate::managed_agents::runtime_metadata_env_vars(
        runtime.model_env_var,
        runtime.provider_env_var,
        runtime.provider_locked,
        config.model.as_deref(),
        config.provider.as_deref(),
    ) {
        command.env(key, value);
    }
    for (key, value) in &config.env_vars {
        command.env(key, value);
    }
    if runtime.id == "claude" {
        crate::managed_agents::claude_config::apply_claude_model_env(
            &mut command,
            config.model.as_deref(),
        );
    }
    command.env_remove("BUZZ_ACP_MODEL");
    if let Some(model) = &config.model {
        command.env("BUZZ_ACP_MODEL", model);
    }
    crate::build_identity::apply_demo_config_home(&mut command)?;
    crate::managed_agents::configure_runtime_cli(&mut command, Some(runtime));
    let output = tokio::task::spawn_blocking(move || {
        crate::managed_agents::output_with_timeout(command, Duration::from_secs(45))
    })
    .await
    .map_err(|_| "The connection test could not start. Try again.")?;
    let Some(output) = output else {
        return Ok(
            json!({"error":"The agent could not start or timed out. Check sign-in and usage, then try again."}),
        );
    };
    if !output.status.success() {
        return Ok(
            json!({"error":"The agent could not start. Check this harness's sign-in and adapter installation, then try again."}),
        );
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "The agent returned an invalid connection result. Try again.".to_owned())
}
