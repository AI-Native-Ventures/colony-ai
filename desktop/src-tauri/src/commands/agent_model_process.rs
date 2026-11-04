use std::{
    collections::BTreeMap,
    path::PathBuf,
    process::{Command, Output},
    time::Duration,
};

use crate::managed_agents::{
    build_buzz_agent_provider_defaults, default_agent_workdir, known_acp_runtime,
    redact_env_values_in, AgentModelsResponse, ModelListSource,
};

use super::agent_models::normalize_agent_models;

#[path = "agent_model_catalog.rs"]
mod catalog;

const MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(12);
const CODEX_CATALOG_TIMEOUT: Duration = Duration::from_secs(8);

pub(super) fn uses_native_model_list_source(agent_command: &str) -> bool {
    known_acp_runtime(agent_command)
        .is_some_and(|runtime| !matches!(runtime.model_list_source(), ModelListSource::Acp))
}

pub(super) async fn run_agent_models_command(
    resolved_acp: PathBuf,
    agent_command: String,
    agent_args: Vec<String>,
    persisted_model: Option<String>,
    merged_env: BTreeMap<String, String>,
    refresh: bool,
) -> Result<AgentModelsResponse, String> {
    let source = known_acp_runtime(&agent_command)
        .map(|runtime| runtime.model_list_source())
        .unwrap_or(ModelListSource::Acp);
    let model_for_fallback = persisted_model.clone();
    let native_env = merged_env.clone();
    let env_for_redaction = merged_env.clone();

    let (acp_response, native_response) = tokio::task::spawn_blocking(move || {
        let acp_response = run_acp_model_list(
            resolved_acp,
            &agent_command,
            agent_args,
            persisted_model.clone(),
            merged_env,
            &env_for_redaction,
        );
        let native_response = match source {
            ModelListSource::CodexCli | ModelListSource::OpenCodeCli => Some(
                run_native_model_list(&agent_command, source, refresh, persisted_model, native_env),
            ),
            ModelListSource::Acp | ModelListSource::ClaudeCode => None,
        };
        (acp_response, native_response)
    })
    .await
    .map_err(|error| format!("model discovery task failed: {error}"))?;

    match source {
        ModelListSource::ClaudeCode => match acp_response {
            Ok(mut response) => {
                catalog::merge_claude_code_aliases(&mut response);
                Ok(response)
            }
            Err(_) => Ok(catalog::fallback_claude_model_catalog(model_for_fallback)),
        },
        ModelListSource::CodexCli => match (native_response, acp_response) {
            (Some(Ok(native)), Ok(acp)) => Ok(catalog::merge_model_responses(native, acp)),
            (Some(Ok(native)), Err(_)) => Ok(native),
            (Some(Err(_)), Ok(acp)) => Ok(catalog::merge_model_responses(
                acp,
                catalog::fallback_codex_model_catalog(model_for_fallback),
            )),
            (Some(Err(_)), Err(_)) | (None, Err(_)) => {
                Ok(catalog::fallback_codex_model_catalog(model_for_fallback))
            }
            (None, Ok(acp)) => Ok(acp),
        },
        ModelListSource::OpenCodeCli => match (native_response, acp_response) {
            (Some(Ok(native)), Ok(acp)) => Ok(catalog::merge_model_responses(native, acp)),
            (Some(Ok(native)), Err(_)) => Ok(native),
            (Some(Err(_)), Ok(acp)) => Ok(catalog::merge_model_responses(
                acp,
                catalog::fallback_opencode_model_catalog(model_for_fallback),
            )),
            (Some(Err(_)), Err(_)) => {
                Ok(catalog::fallback_opencode_model_catalog(model_for_fallback))
            }
            (None, Err(error)) => Err(error),
            (None, Ok(acp)) => Ok(acp),
        },
        ModelListSource::Acp => acp_response,
    }
}

fn run_acp_model_list(
    resolved_acp: PathBuf,
    agent_command: &str,
    agent_args: Vec<String>,
    persisted_model: Option<String>,
    merged_env: BTreeMap<String, String>,
    env_for_redaction: &BTreeMap<String, String>,
) -> Result<AgentModelsResponse, String> {
    let mut command = Command::new(&resolved_acp);
    if let Some(home) = default_agent_workdir() {
        command.current_dir(home);
    }
    if let Some(path) = crate::managed_agents::readiness::cli_probe::augmented_path() {
        command.env("PATH", path);
    }
    command
        .arg("models")
        .arg("--json")
        .env("BUZZ_ACP_AGENT_COMMAND", agent_command)
        .env("BUZZ_ACP_AGENT_ARGS", agent_args.join(","));
    if let Some(meta) = known_acp_runtime(agent_command) {
        for (key, value) in meta.default_env {
            if std::env::var(key).is_err() {
                command.env(key, value);
            }
        }
    }
    build_buzz_agent_provider_defaults(&mut command);
    for (key, value) in &merged_env {
        command.env(key, value);
    }
    crate::build_identity::apply_demo_config_home(&mut command)?;
    crate::managed_agents::configure_runtime_cli(&mut command, known_acp_runtime(agent_command));
    crate::util::configure_no_window(&mut command);

    let output = crate::managed_agents::output_with_timeout(command, MODEL_LIST_TIMEOUT)
        .ok_or_else(|| "buzz-acp model query timed out or exceeded its output limit".to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_redacted = redact_env_values_in(stderr.as_ref(), env_for_redaction);
        return Err(format!(
            "buzz-acp models failed (exit {}): {stderr_redacted}",
            output.status.code().unwrap_or(-1)
        ));
    }

    let raw: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("failed to parse model JSON: {error}"))?;
    Ok(normalize_agent_models(&raw, persisted_model))
}

fn run_native_model_list(
    agent_command: &str,
    source: ModelListSource,
    refresh: bool,
    selected_model: Option<String>,
    merged_env: BTreeMap<String, String>,
) -> Result<AgentModelsResponse, String> {
    let runtime = known_acp_runtime(agent_command)
        .ok_or_else(|| "model catalog source has no known runtime".to_string())?;
    let binary = match source {
        ModelListSource::CodexCli => runtime.underlying_cli.unwrap_or("codex"),
        ModelListSource::OpenCodeCli => agent_command,
        ModelListSource::Acp | ModelListSource::ClaudeCode => {
            return Err("runtime has no native CLI model list".to_string());
        }
    };
    let executable = crate::managed_agents::resolve_command(binary)
        .ok_or_else(|| format!("{binary} CLI is not available"))?;
    match source {
        ModelListSource::CodexCli => run_codex_model_list(executable, selected_model),
        ModelListSource::OpenCodeCli => {
            run_opencode_model_list(executable, refresh, selected_model, merged_env)
        }
        ModelListSource::Acp | ModelListSource::ClaudeCode => {
            Err("runtime has no native CLI model list".to_string())
        }
    }
}

fn run_codex_model_list(
    executable: PathBuf,
    selected_model: Option<String>,
) -> Result<AgentModelsResponse, String> {
    let temporary_home = tempfile::tempdir()
        .map_err(|_| "could not create isolated Codex model-list home".to_string())?;
    let codex_home = temporary_home.path().join(".codex");
    std::fs::create_dir_all(&codex_home)
        .map_err(|_| "could not prepare isolated Codex model-list home".to_string())?;

    let mut command = Command::new(executable);
    command.env_clear();
    command
        .env("HOME", temporary_home.path())
        .env("CODEX_HOME", &codex_home)
        .args(["debug", "models", "--bundled"]);
    #[cfg(windows)]
    command.env("USERPROFILE", temporary_home.path());
    if let Some(path) = crate::managed_agents::readiness::cli_probe::augmented_path() {
        command.env("PATH", path);
    } else if let Some(path) = std::env::var_os("PATH") {
        command.env("PATH", path);
    }
    crate::util::configure_no_window(&mut command);

    let output = run_bounded_cli(command, "Codex", CODEX_CATALOG_TIMEOUT)?;
    let raw = String::from_utf8_lossy(&output.stdout);
    catalog::parse_codex_model_catalog(raw.as_ref(), selected_model)
}

fn run_opencode_model_list(
    executable: PathBuf,
    refresh: bool,
    selected_model: Option<String>,
    merged_env: BTreeMap<String, String>,
) -> Result<AgentModelsResponse, String> {
    let mut command = Command::new(executable);
    command.env_clear();
    for key in [
        "PATH",
        "HOME",
        "USER",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_CACHE_HOME",
        "OPENCODE_CONFIG",
        "OPENCODE_CONFIG_DIR",
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_DISABLE_FREE_MODELS",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    for (key, value) in merged_env {
        command.env(key, value);
    }
    if let Some(path) = crate::managed_agents::readiness::cli_probe::augmented_path() {
        command.env("PATH", path);
    }
    if let Some(home) = default_agent_workdir() {
        command.current_dir(home);
    }
    command.arg("models");
    if refresh {
        command.arg("--refresh");
    }
    crate::util::configure_no_window(&mut command);

    let output = run_bounded_cli(command, "OpenCode", MODEL_LIST_TIMEOUT)?;
    let raw = String::from_utf8_lossy(&output.stdout);
    catalog::parse_opencode_model_list(raw.as_ref(), selected_model)
}

fn run_bounded_cli(command: Command, label: &str, timeout: Duration) -> Result<Output, String> {
    let output = crate::managed_agents::output_with_timeout(command, timeout).ok_or_else(|| {
        format!("{label} model-list query timed out or exceeded its output limit")
    })?;
    if !output.status.success() {
        return Err(format!(
            "{label} model-list query failed (exit {})",
            output.status.code().unwrap_or(-1)
        ));
    }
    Ok(output)
}
