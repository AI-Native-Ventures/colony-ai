//! A bounded first hello through the same ACP client used for normal turns.
use std::{
    future::Future,
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

/// The whole test's budget across every attempt. Free models can queue for minutes.
const DEFAULT_TIMEOUT_SECS: u64 = 300;
/// Silence after the hello prompt before an attempt is abandoned for a fresh one.
/// A stuck free-model request rarely recovers; a new request usually answers in seconds.
const SILENCE_SECS: u64 = 45;
/// Fresh attempts are bounded so a persistently failing provider stops.
const MAX_ATTEMPTS: u32 = 4;
/// A retry needs room to start an agent and wait out a reply.
const MIN_RETRY_ROOM: Duration = Duration::from_secs(15);
const PROMPT: &str = "This is a connection test. Do not use tools or read files. Reply in one or two short sentences: say hello, then ask what we shall work on first.";

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

const MODEL_UNAVAILABLE: &str = "Selected model is unavailable or this harness does not support model switching. Choose another model.";
const AI_BUSY: &str =
    "Your AI is busy and did not answer. Try again in a minute, or choose another connection.";
const INCOMPLETE_REPLY: &str =
    "The agent did not complete a reply. Check sign-in and usage, then try again.";
/// Slack added to an attempt's age when looking for OpenCode's quota error in its log.
const LOG_LOOKBACK_SLACK: Duration = Duration::from_secs(5);

/// Limits for one connection test, shared by every attempt.
#[derive(Clone, Copy)]
struct ProbeLimits {
    /// Absolute end of the whole test.
    deadline: tokio::time::Instant,
    /// The whole test's budget, named in the failure copy.
    total: Duration,
    /// Silence after the prompt that abandons one attempt.
    silence: Duration,
}

impl ProbeLimits {
    fn new(total: Duration, silence: Duration) -> Self {
        Self {
            deadline: tokio::time::Instant::now() + total,
            total,
            silence,
        }
    }
}

/// One attempt's JSON outcome, and whether a fresh attempt may still succeed.
struct Attempt {
    outcome: Value,
    retry: bool,
}

/// A slow or briefly failing provider, as opposed to a setup problem a retry cannot fix.
fn transient(error: &anyhow::Error) -> bool {
    match error.downcast_ref::<crate::AcpError>() {
        Some(crate::AcpError::IdleTimeout(_) | crate::AcpError::HardTimeout { .. }) => true,
        Some(crate::AcpError::AgentError {
            code: -32603,
            message,
        }) => message.contains("Internal Server Error"),
        _ => false,
    }
}

fn budget_words(total: Duration) -> String {
    let secs = total.as_secs();
    if secs >= 120 && secs.is_multiple_of(60) {
        format!("{} minutes", secs / 60)
    } else {
        format!("{secs} seconds")
    }
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
    // OpenCode can hand its quota error back as the reply text.
    if crate::provider_failure::is_free_limit_text(&reply) {
        bail!(ConnectionFailure(crate::provider_failure::FREE_LIMIT_COPY));
    }
    if stop != StopReason::EndTurn || reply.trim().is_empty() {
        bail!(ConnectionFailure(INCOMPLETE_REPLY));
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
    limits: &ProbeLimits,
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
                Some(ModelSwitchMethod::ConfigOption {
                    config_id,
                    option_value,
                }) => {
                    client
                        .session_set_config_option(&session.session_id, &config_id, &option_value)
                        .await?;
                }
                Some(ModelSwitchMethod::SetModel { model_id }) => {
                    client
                        .session_set_model(&session.session_id, &model_id)
                        .await?;
                }
                None => bail!(ConnectionFailure(MODEL_UNAVAILABLE)),
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
        format!("You are Scout, Colony's Chief of Staff. This is your first message to the owner, and it will also appear in their private Welcome channel. Do not use tools or read files. Write one or two short sentences: say hi, welcome them to their business by name, and end with one question asking what they want to work on first. No lists, no headings, nothing else.{}", context)
    } else {
        PROMPT.to_owned()
    };
    client.capture_connection_reply(&session.session_id);
    let stop = client
        .session_prompt_with_idle_timeout(
            &session.session_id,
            &prompt,
            limits.silence,
            limits.total,
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
    error_result_with_log(error, false)
}

/// `free_limit_logged` says OpenCode's own log shows the free quota is gone. It
/// only explains a failure that has no other explanation: a silent or generic one.
fn error_result_with_log(error: &anyhow::Error, free_limit_logged: bool) -> Value {
    let failure = error.downcast_ref::<ConnectionFailure>();
    if failure.is_some_and(|failure| failure.0 == MODEL_UNAVAILABLE) {
        // A stable code lets onboarding tell "free model ended" from other failures.
        return json!({"error": MODEL_UNAVAILABLE, "code": "model_unavailable"});
    }
    let acp = error.downcast_ref::<crate::AcpError>();
    let explained = failure.is_some_and(|failure| failure.0 != INCOMPLETE_REPLY)
        || acp
            .and_then(crate::provider_failure::onboarding_notice)
            .is_some();
    if failure.is_some_and(|failure| failure.0 == crate::provider_failure::FREE_LIMIT_COPY)
        || acp.is_some_and(|acp| {
            matches!(acp, crate::AcpError::AgentError { message, .. } if crate::provider_failure::is_free_limit_text(message))
        })
        || (free_limit_logged && !explained)
    {
        // The daily free quota is gone: not "busy", and a retry cannot help.
        return free_limit_outcome();
    }
    let notice = failure.map(ToString::to_string)
        .or_else(|| error.downcast_ref::<crate::AcpError>().and_then(crate::provider_failure::onboarding_notice))
        .or_else(|| transient(error).then(|| AI_BUSY.to_owned()))
        .unwrap_or_else(|| "The agent could not reply. Check this harness's sign-in, model and usage, then try again.".to_owned());
    json!({"error": notice})
}

async fn bounded_probe(
    client: &mut AcpClient,
    desired: Option<&str>,
    limits: &ProbeLimits,
    cancel_path: Option<&Path>,
    progress: Option<&Path>,
    started: Instant,
) -> Attempt {
    let attempt_started = Instant::now();
    let result = tokio::time::timeout_at(limits.deadline, async {
        tokio::select! {
            result = probe_turn(client, desired, limits, progress, started) => result,
            _ = wait_for_cancellation(cancel_path) => Err(ConnectionFailure("Connection test cancelled.").into()),
        }
    }).await;
    client.shutdown().await;
    match result {
        Ok(Ok(reply)) => Attempt {
            outcome: reply,
            retry: false,
        },
        Ok(Err(error)) => {
            let outcome = error_result_with_log(&error, free_limit_logged(attempt_started));
            let retry = transient(&error) && !is_free_limit(&outcome);
            Attempt { outcome, retry }
        }
        Err(_) if free_limit_logged(attempt_started) => Attempt {
            outcome: free_limit_outcome(),
            retry: false,
        },
        Err(_) => Attempt {
            outcome: json!({"error": format!("Your AI did not answer within {}. It may be busy right now. Try again later, or choose another connection.", budget_words(limits.total))}),
            retry: false,
        },
    }
}

/// Did OpenCode log that the free quota is gone since this attempt began?
fn free_limit_logged(attempt_started: Instant) -> bool {
    crate::provider_failure::opencode_log_shows_free_limit(
        attempt_started.elapsed() + LOG_LOOKBACK_SLACK,
    )
}

fn free_limit_outcome() -> Value {
    json!({
        "error": crate::provider_failure::FREE_LIMIT_COPY,
        "code": crate::provider_failure::FREE_LIMIT_CODE,
    })
}

fn is_free_limit(outcome: &Value) -> bool {
    outcome["code"] == crate::provider_failure::FREE_LIMIT_CODE
}

/// Run attempts on fresh agents until one answers, a failure is not transient,
/// the attempt cap is reached, or the shared deadline leaves no room to retry.
async fn probe_with_retries<S, F>(
    mut spawn: S,
    desired: Option<&str>,
    limits: &ProbeLimits,
    cancel_path: Option<&Path>,
    progress: Option<&Path>,
    started: Instant,
) -> Result<Value>
where
    S: FnMut() -> F,
    F: Future<Output = Result<AcpClient>>,
{
    let mut attempt = 1;
    loop {
        let mut client = spawn().await?;
        let result =
            bounded_probe(&mut client, desired, limits, cancel_path, progress, started).await;
        let room = limits
            .deadline
            .saturating_duration_since(tokio::time::Instant::now())
            >= MIN_RETRY_ROOM;
        if !result.retry || attempt >= MAX_ATTEMPTS || !room {
            return Ok(result.outcome);
        }
        attempt += 1;
    }
}

/// Run one tool-free, cancellable proof turn with bounded startup and output.
pub(crate) async fn run(args: ModelsArgs) -> Result<()> {
    let started = Instant::now();
    let agent_args =
        crate::config::normalize_agent_args(&args.agent.agent_command, args.agent.agent_args);
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
    let limits = ProbeLimits::new(
        Duration::from_secs(timeout_secs),
        Duration::from_secs(SILENCE_SECS),
    );
    let command = args.agent.agent_command.as_str();
    let agent_args = agent_args.as_slice();
    let outcome = probe_with_retries(
        move || async move {
            AcpClient::spawn_connection_probe(command, agent_args)
                .await
                .map_err(anyhow::Error::from)
        },
        desired.as_deref(),
        &limits,
        cancel_path.as_deref(),
        progress.as_deref(),
        started,
    )
    .await?;
    println!(
        "{}",
        serde_json::to_string(&outcome).context("encode connection result")?
    );
    Ok(())
}

#[cfg(test)]
#[path = "connection_test_tests.rs"]
mod tests;
