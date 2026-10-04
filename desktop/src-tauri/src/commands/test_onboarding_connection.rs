//! First-run connection proof, using the selected adapter and launch environment.
use crate::managed_agents::{normalize_agent_args, resolve_command, GlobalAgentConfig};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    process::Command,
    sync::{LazyLock, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

static CONNECTION_TEST: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

// A cancellation file belongs to a single fresh probe directory. No user files are read.
static LATEST_REQUEST: Mutex<Option<(String, CancellationToken)>> = Mutex::new(None);
static ACTIVE_TEST: Mutex<Option<(String, PathBuf)>> = Mutex::new(None);
const CONNECTION_TIMEOUT_SECS: u64 = 40;
const CONNECTION_OUTER_TIMEOUT_SECS: u64 = CONNECTION_TIMEOUT_SECS + 20;

/// Cancel only the named active attempt; stale UI cleanup cannot stop a newer test.
#[tauri::command]
pub fn cancel_onboarding_connection_test(request_id: String) -> Result<(), String> {
    let latest = LATEST_REQUEST
        .lock()
        .map_err(|_| "Connection cancellation is unavailable.")?;
    if let Some((id, token)) = latest.as_ref() {
        if id == &request_id {
            token.cancel();
        }
    }
    let active = ACTIVE_TEST
        .lock()
        .map_err(|_| "Connection cancellation is unavailable.")?;
    if let Some((id, path)) = active.as_ref() {
        if id == &request_id {
            std::fs::write(path, [])
                .map_err(|_| "Could not cancel the connection test. Try again.")?;
        }
    }
    Ok(())
}

struct ActiveTestGuard(String);
impl Drop for ActiveTestGuard {
    fn drop(&mut self) {
        if let Ok(mut latest) = LATEST_REQUEST.lock() {
            if latest.as_ref().is_some_and(|(id, _)| id == &self.0) {
                *latest = None;
            }
        }
        if let Ok(mut active) = ACTIVE_TEST.lock() {
            if active.as_ref().is_some_and(|(id, _)| id == &self.0) {
                *active = None;
            }
        }
    }
}

async fn acquire_connection_test(
    cancel: CancellationToken,
) -> Result<tokio::sync::MutexGuard<'static, ()>, String> {
    tokio::time::timeout(Duration::from_secs(CONNECTION_OUTER_TIMEOUT_SECS), async {
        loop {
            if cancel.is_cancelled() {
                return Err("Connection test cancelled.".to_owned());
            }
            if let Ok(guard) = CONNECTION_TEST.try_lock() {
                break Ok::<_, String>(guard);
            }
            {
                let active = ACTIVE_TEST
                    .lock()
                    .map_err(|_| "Connection cancellation is unavailable.")?;
                if let Some((_, path)) = active.as_ref() {
                    std::fs::write(path, [])
                        .map_err(|_| "Could not stop the previous connection test.")?;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .map_err(|_| "The previous connection test could not stop. Try again.")?
}

/// Send a bounded first hello through the selected runtime's real ACP turn path.
#[tauri::command]
pub async fn test_onboarding_connection(
    app: AppHandle,
    config: GlobalAgentConfig,
    request_id: String,
    business: Option<serde_json::Value>,
) -> Result<Value, String> {
    let cancel = CancellationToken::new();
    {
        let mut latest = LATEST_REQUEST
            .lock()
            .map_err(|_| "Connection cancellation is unavailable.")?;
        if let Some((_, previous)) = latest.take() {
            previous.cancel();
        }
        *latest = Some((request_id.clone(), cancel.clone()));
    }
    let _active = ActiveTestGuard(request_id.clone());
    let _test = acquire_connection_test(cancel.clone()).await?;
    let workdir =
        tempfile::tempdir().map_err(|_| "Could not create a temporary connection workspace.")?;
    let cancel_path = workdir.path().join("cancel");
    *ACTIVE_TEST
        .lock()
        .map_err(|_| "Connection cancellation is unavailable.")? =
        Some((request_id.clone(), cancel_path.clone()));
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
    if let Some(business) = business {
        let context = serde_json::to_string(&business).map_err(|_| "Invalid business context.")?;
        if context.len() > 8192 {
            return Err("Business description is too long. Shorten it and try again.".into());
        }
        command.env("COLONY_CONNECTION_BUSINESS", context);
    } else {
        command.env_remove("COLONY_CONNECTION_BUSINESS");
    }
    command.env("BUZZ_ACP_AGENT_COMMAND", resolved_agent);
    command.env(
        "BUZZ_ACP_AGENT_ARGS",
        normalize_agent_args(agent, vec![]).join(","),
    );
    command.current_dir(workdir.path());

    if let Some(path) = crate::managed_agents::readiness::cli_probe::augmented_path() {
        command.env("PATH", path);
    }
    crate::managed_agents::apply_runtime_default_env(&mut command, runtime.default_env);
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
    command.env_remove("BUZZ_ACP_MODEL");
    if let Some(model) = &config.model {
        command.env("BUZZ_ACP_MODEL", model);
    }
    crate::managed_agents::apply_runtime_startup_model_env(
        &mut command,
        runtime.id == "claude",
        config.model.as_deref(),
    );
    command.env_remove("COLONY_CONNECTION_MODEL");
    if let Some(model) = &config.model {
        command.env("COLONY_CONNECTION_MODEL", model);
    }
    let progress_path = workdir.path().join("progress");
    command.env("COLONY_CONNECTION_PROGRESS_PATH", &progress_path);
    command.env("COLONY_CONNECTION_CANCEL_PATH", &cancel_path);
    command.env(
        "COLONY_CONNECTION_TIMEOUT_SECS",
        CONNECTION_TIMEOUT_SECS.to_string(),
    );
    crate::build_identity::apply_demo_config_home(&mut command)?;
    crate::managed_agents::configure_runtime_cli(&mut command, Some(runtime));
    let mut worker = tokio::task::spawn_blocking(move || {
        crate::managed_agents::output_with_timeout(
            command,
            Duration::from_secs(CONNECTION_OUTER_TIMEOUT_SECS),
        )
    });
    let mut cancellation_sent = false;
    let mut waiting_sent = false;
    let mut progress_error = None;
    let output = loop {
        tokio::select! {
            output = &mut worker => break output.map_err(|_| "The connection test could not start. Try again.")?,
            _ = cancel.cancelled(), if !cancellation_sent => {
                if std::fs::write(&cancel_path, []).is_err() {
                    progress_error = Some("Could not cancel the connection test. It will stop at its bounded deadline.");
                }
                cancellation_sent = true;
            }
            _ = tokio::time::sleep(Duration::from_millis(50)), if !waiting_sent => {
                if tokio::fs::read_to_string(&progress_path).await.ok().as_deref() == Some("waiting") {
                    waiting_sent = true;
                    if app.emit("onboarding-connection-progress", json!({"requestId": request_id, "phase": "waiting"})).is_err() {
                        progress_error = Some("Connection progress could not be displayed. Retry the test.");
                    }
                }
            }
        }
    };
    if let Some(error) = progress_error {
        return Err(error.to_owned());
    }
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
    let result: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "The agent returned an invalid connection result. Try again.".to_owned())?;
    if cancel.is_cancelled() {
        return Err("Connection test cancelled.".into());
    }
    if result.get("error").is_none()
        && result
            .get("reply")
            .and_then(Value::as_str)
            .is_some_and(|reply| !reply.trim().is_empty())
    {
        crate::managed_agents::verified_connection::record(&config)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    #[tokio::test]
    async fn retry_preempts_the_active_attempt_and_serializes_launches() {
        let _serial = SERIAL.lock().await;
        let old = CONNECTION_TEST.lock().await;
        let dir = tempfile::tempdir().expect("workspace");
        let path = dir.path().join("cancel");
        *ACTIVE_TEST.lock().expect("active lock") = Some(("old".into(), path.clone()));
        let _active = ActiveTestGuard("old".into());
        let retry = tokio::spawn(acquire_connection_test(CancellationToken::new()));
        tokio::time::timeout(Duration::from_secs(1), async {
            while !path.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("retry must cancel old attempt");
        assert!(
            !retry.is_finished(),
            "a second process cannot launch before cleanup"
        );
        drop(old);
        drop(retry.await.expect("retry join").expect("retry lock"));
        assert_eq!(CONNECTION_OUTER_TIMEOUT_SECS, CONNECTION_TIMEOUT_SECS + 20);
    }

    #[tokio::test]
    async fn stale_cancel_does_not_cancel_a_new_attempt() {
        let _serial = SERIAL.lock().await;
        let dir = tempfile::tempdir().expect("workspace");
        let path = dir.path().join("cancel");
        *ACTIVE_TEST.lock().expect("active lock") = Some(("new".into(), path.clone()));
        let _active = ActiveTestGuard("new".into());
        cancel_onboarding_connection_test("old".into()).expect("stale cancel");
        assert!(!path.exists());
        cancel_onboarding_connection_test("new".into()).expect("current cancel");
        assert!(path.exists());
    }
}
