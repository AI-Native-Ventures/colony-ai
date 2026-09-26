use std::{path::Path, path::PathBuf, time::Duration};

use tokio::sync::broadcast;

use super::{compact_update, store_append_event, FactoryRunEvent, MAX_CAPTURE_MARKER_ATTEMPTS};

async fn capture_event(
    path: &Path,
    run_id: &str,
    observer_event: buzz_acp::ObserverEvent,
) -> Result<Option<FactoryRunEvent>, String> {
    if observer_event.kind != "acp_read" {
        return Ok(None);
    }
    let message = observer_event.payload;
    if message.get("method").and_then(serde_json::Value::as_str) != Some("session/update") {
        return Ok(None);
    }
    let Some(update) = message
        .get("params")
        .and_then(|params| params.get("update"))
    else {
        return Ok(None);
    };
    let kind = update
        .get("sessionUpdate")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("unknown");
    if !matches!(
        kind,
        "agent_message_chunk"
            | "tool_call"
            | "tool_call_update"
            | "plan"
            | "available_commands_update"
            | "current_mode_update"
            | "config_option_update"
    ) {
        return Ok(None);
    }
    let payload = compact_update(update);
    for attempt in 0..3 {
        match store_append_event(path, run_id, kind, &payload) {
            Ok(event) => return Ok(event),
            Err(error) if attempt < 2 => {
                tokio::time::sleep(Duration::from_millis(40 * (attempt + 1))).await;
                eprintln!("colony-desktop: retrying Factory transcript persistence: {error}");
            }
            Err(error) => return Err(error),
        }
    }
    Ok(None)
}

async fn retry_capture_marker<M>(
    path: &Path,
    run_id: &str,
    reason: &str,
    mut persist_marker: M,
) -> Result<Option<FactoryRunEvent>, String>
where
    M: FnMut(&Path, &str, &str) -> Result<Option<FactoryRunEvent>, String>,
{
    let mut last_error = None;
    for attempt in 0..MAX_CAPTURE_MARKER_ATTEMPTS {
        match persist_marker(path, run_id, reason) {
            Ok(event) => return Ok(event),
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < MAX_CAPTURE_MARKER_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(40 * u64::from(attempt + 1))).await;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "Factory transcript marker could not be persisted".into()))
}

pub(super) async fn capture_observer_stream<F, M>(
    mut observer_rx: broadcast::Receiver<buzz_acp::ObserverEvent>,
    path: PathBuf,
    run_id: String,
    mut publish_event: F,
    persist_marker: M,
) -> Result<(), String>
where
    F: FnMut(FactoryRunEvent),
    M: FnMut(&Path, &str, &str) -> Result<Option<FactoryRunEvent>, String>,
{
    let mut persist_marker = persist_marker;
    loop {
        let event = match observer_rx.recv().await {
            Ok(event) => event,
            Err(broadcast::error::RecvError::Closed) => return Ok(()),
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                let error = format!("Factory transcript observer lagged by {skipped} events");
                match retry_capture_marker(&path, &run_id, &error, &mut persist_marker).await {
                    Ok(Some(marker)) => publish_event(marker),
                    Ok(None) => {}
                    Err(marker_error) => eprintln!(
                        "colony-desktop: Factory transcript gap marker retries exhausted: {marker_error}"
                    ),
                }
                return Err(error);
            }
        };
        match capture_event(&path, &run_id, event).await {
            Ok(Some(event)) => publish_event(event),
            Ok(None) => {}
            Err(error) => {
                match retry_capture_marker(&path, &run_id, &error, &mut persist_marker).await {
                    Ok(Some(marker)) => publish_event(marker),
                    Ok(None) => {}
                    Err(marker_error) => eprintln!(
                        "colony-desktop: Factory transcript error marker retries exhausted: {marker_error}"
                    ),
                }
                return Err(error);
            }
        }
    }
}
