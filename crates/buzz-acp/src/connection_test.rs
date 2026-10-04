//! A bounded first hello through the same ACP client used for normal turns.
use std::{
    path::Path,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use crate::{
    acp::{
        extract_model_config_options, extract_model_state, resolve_model_switch_method,
        ModelSwitchMethod,
    },
    config::ModelsArgs,
    AcpClient, StopReason,
};

const DEFAULT_TIMEOUT_SECS: u64 = 40;
const PROMPT: &str = "This is a connection test. Do not use tools or read files. Reply with a short hello and ask what we shall work on first.";

fn effective_model(raw: &Value) -> Option<String> {
    extract_model_config_options(raw)
        .iter()
        .find_map(|option| {
            option
                .get("currentValue")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .or_else(|| {
            extract_model_state(raw).and_then(|state| {
                state
                    .get("currentModelId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            })
        })
}

#[derive(Debug)]
struct ConnectionFailure(&'static str);
impl std::fmt::Display for ConnectionFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for ConnectionFailure {}

fn completed_reply(reply: String, stop: StopReason) -> Result<String> {
    if stop != StopReason::EndTurn || reply.trim().is_empty() {
        bail!(ConnectionFailure(
            "The agent did not complete a reply. Check sign-in and usage, then try again."
        ));
    }
    let text = reply.to_lowercase();
    if [
        "invalid api key",
        "invalid_api_key",
        "please run /login",
        "not logged in",
        "authentication failed",
        "authentication required",
    ]
    .iter()
    .any(|phrase| text.contains(phrase))
    {
        bail!(ConnectionFailure(
            "The harness reported an authentication failure. Sign in again, then retry the test."
        ));
    }
    if [
        "credit balance is too low",
        "credit balance too low",
        "insufficient credits",
        "insufficient_quota",
        "usage limit reached",
        "out of credits",
    ]
    .iter()
    .any(|phrase| text.contains(phrase))
    {
        bail!(ConnectionFailure("The harness reported no usage available. Add usage at the provider or choose another connection, then retry the test."));
    }
    Ok(reply)
}

async fn wait_for_cancellation(path: Option<&Path>) {
    loop {
        if path.is_some_and(Path::exists) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn probe_turn(
    client: &mut AcpClient,
    desired: Option<&str>,
    progress: Option<&Path>,
    started: Instant,
) -> Result<Value> {
    let initialize_started = Instant::now();
    client.initialize().await?;
    let initialize_ms = initialize_started.elapsed().as_millis();
    let session_started = Instant::now();
    let session = client
        .session_new_full(
            &crate::current_working_directory()?,
            vec![],
            None,
            Some("Colony connection test"),
        )
        .await?;
    let session_ms = session_started.elapsed().as_millis();
    let startup_ms = started.elapsed().as_millis();
    let model = if let Some(desired) = desired {
        if effective_model(&session.raw).as_deref() != Some(desired) {
            match resolve_model_switch_method(&session.raw, desired) {
                Some(ModelSwitchMethod::ConfigOption { config_id, option_value }) => { client.session_set_config_option(&session.session_id, &config_id, &option_value).await?; }
                Some(ModelSwitchMethod::SetModel { model_id }) => { client.session_set_model(&session.session_id, &model_id).await?; }
                None => bail!(ConnectionFailure("Selected model is unavailable or this harness does not support model switching. Choose another model.")),
            }
        }
        Some(desired.to_owned())
    } else {
        effective_model(&session.raw)
    };
    if let Some(path) = progress {
        std::fs::write(path, "waiting").context("record connection progress")?;
    }
    let context = std::env::var("COLONY_CONNECTION_BUSINESS")
        .ok()
        .map(|raw| crate::business_context::context(&raw))
        .transpose()?;
    let prompt = if let Some(context) = context {
        format!("You are Scout, Colony's Chief of Staff. This is your first introduction to the owner, and will also appear in their private Welcome channel. Do not use tools or read files. Briefly introduce yourself, welcome them to their business by name, and ask what they want to work on first.{}", context)
    } else {
        PROMPT.to_owned()
    };
    client.capture_connection_reply(&session.session_id);
    let stop = client
        .session_prompt_with_idle_timeout(
            &session.session_id,
            &prompt,
            Duration::from_secs(20),
            Duration::from_secs(30),
        )
        .await?;
    if client.connection_tool_requested() {
        bail!(ConnectionFailure("The harness requested a tool during the hello test. Retry without tools or choose another connection."));
    }
    let reply = completed_reply(client.take_connection_reply(), stop)?;
    Ok(
        json!({ "reply": reply, "model": model, "startupMs": startup_ms, "totalMs": started.elapsed().as_millis(), "spawnMs": startup_ms.saturating_sub(initialize_ms + session_ms), "initializeMs": initialize_ms, "sessionMs": session_ms, "firstTokenMs": client.first_token_ms() }),
    )
}

fn error_result(error: &anyhow::Error) -> Value {
    let notice = error.downcast_ref::<ConnectionFailure>().map(ToString::to_string)
        .or_else(|| error.downcast_ref::<crate::AcpError>().and_then(crate::provider_failure::onboarding_notice))
        .unwrap_or_else(|| "The agent could not reply. Check this harness's sign-in, model and usage, then try again.".to_owned());
    json!({"error": notice})
}

async fn bounded_probe(
    client: &mut AcpClient,
    desired: Option<&str>,
    timeout_secs: u64,
    cancel_path: Option<&Path>,
    progress: Option<&Path>,
    started: Instant,
) -> Value {
    let result = tokio::time::timeout(Duration::from_secs(timeout_secs), async {
        tokio::select! {
            result = probe_turn(client, desired, progress, started) => result,
            _ = wait_for_cancellation(cancel_path) => Err(ConnectionFailure("Connection test cancelled.").into()),
        }
    }).await;
    client.shutdown().await;
    match result {
        Ok(Ok(reply)) => reply,
        Ok(Err(error)) => error_result(&error),
        Err(_) => {
            json!({"error": format!("The agent did not reply within {timeout_secs} seconds. Check sign-in and usage, then try again.")})
        }
    }
}

/// Run one tool-free, cancellable proof turn with bounded startup and output.
pub(crate) async fn run(args: ModelsArgs) -> Result<()> {
    let started = Instant::now();
    let agent_args =
        crate::config::normalize_agent_args(&args.agent.agent_command, args.agent.agent_args);
    let mut client =
        AcpClient::spawn_connection_probe(&args.agent.agent_command, &agent_args).await?;
    let timeout_secs = std::env::var("COLONY_CONNECTION_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| (1..=DEFAULT_TIMEOUT_SECS).contains(value))
        .unwrap_or(DEFAULT_TIMEOUT_SECS);
    let path = |name| std::env::var_os(name).map(std::path::PathBuf::from);
    let cancel_path = path("COLONY_CONNECTION_CANCEL_PATH");
    let progress = path("COLONY_CONNECTION_PROGRESS_PATH");
    let desired = std::env::var("COLONY_CONNECTION_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let outcome = bounded_probe(
        &mut client,
        desired.as_deref(),
        timeout_secs,
        cancel_path.as_deref(),
        progress.as_deref(),
        started,
    )
    .await;
    println!(
        "{}",
        serde_json::to_string(&outcome).context("encode connection result")?
    );
    Ok(())
}

#[cfg(test)]
#[path = "connection_test_tests.rs"]
mod tests;
