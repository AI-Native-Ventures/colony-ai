//! A bounded first hello through the same ACP client used for normal turns.
use std::time::{Duration, Instant};

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
    Ok(reply)
}

pub(crate) async fn run(args: ModelsArgs) -> Result<()> {
    let started = Instant::now();
    let agent_args =
        crate::config::normalize_agent_args(&args.agent.agent_command, args.agent.agent_args);
    let mut client = AcpClient::spawn(&args.agent.agent_command, &agent_args, &[], false).await?;
    let result = tokio::time::timeout(Duration::from_secs(40), async {
        client.initialize().await?;
        let session = client.session_new_full(&crate::current_working_directory()?, vec![], None, Some("Colony connection test")).await?;
        let startup_ms = started.elapsed().as_millis();
        let desired = std::env::var("BUZZ_ACP_MODEL").ok().filter(|value| !value.trim().is_empty());
        let model = if let Some(desired) = desired {
            if effective_model(&session.raw).as_deref() != Some(desired.as_str()) {
                match resolve_model_switch_method(&session.raw, &desired) {
                    Some(ModelSwitchMethod::ConfigOption { config_id, option_value }) => { client.session_set_config_option(&session.session_id, &config_id, &option_value).await?; }
                    Some(ModelSwitchMethod::SetModel { model_id }) => { client.session_set_model(&session.session_id, &model_id).await?; }
                    None => bail!(ConnectionFailure("Selected model is unavailable or this harness does not support model switching. Choose another model.")),
                }
            }
            Some(desired)
        } else { effective_model(&session.raw) };
        client.capture_connection_reply(&session.session_id);
        let stop = client.session_prompt_with_idle_timeout(&session.session_id,
            "This is a connection test. Do not use tools or read files. Reply with a short hello and ask what we shall work on first.",
            Duration::from_secs(20), Duration::from_secs(30)).await?;
        let reply = completed_reply(client.take_connection_reply(), stop)?;
        Ok::<Value, anyhow::Error>(json!({ "reply": reply, "model": model, "startupMs": startup_ms, "totalMs": started.elapsed().as_millis() }))
    }).await;
    client.shutdown().await;
    let outcome = match result {
        Ok(Ok(reply)) => reply,
        Ok(Err(error)) => {
            // Use the normal provider notice without exposing upstream payloads.
            let notice = error.downcast_ref::<ConnectionFailure>().map(ToString::to_string).or_else(|| error.downcast_ref::<crate::AcpError>().and_then(crate::provider_failure::notice))
                .unwrap_or_else(|| "The agent could not reply. Check this harness's sign-in, model and usage, then try again.".to_owned());
            json!({ "error": notice })
        }
        Err(_) => {
            json!({ "error": "The agent did not reply within 40 seconds. Check sign-in and usage, then try again." })
        }
    };
    println!(
        "{}",
        serde_json::to_string(&outcome).context("encode connection result")?
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn success_requires_a_completed_nonempty_turn() {
        assert!(completed_reply("".into(), StopReason::EndTurn).is_err());
        assert!(completed_reply("hello".into(), StopReason::Cancelled).is_err());
        assert_eq!(
            completed_reply("hello".into(), StopReason::EndTurn)
                .ok()
                .as_deref(),
            Some("hello")
        );
    }
    #[test]
    fn model_is_taken_from_negotiated_session_not_a_fixture() {
        assert_eq!(
            effective_model(
                &json!({"configOptions":[{"category":"model","currentValue":"actual-model"}]})
            )
            .as_deref(),
            Some("actual-model")
        );
        assert_eq!(effective_model(&json!({})), None);
    }
}
