use super::*;

pub(super) type RunFinish = (FactoryRunStatus, Option<&'static str>);

pub(super) enum FinalizationResult {
    Applied(FactoryRun, FactoryRunEvent),
    Deferred(String),
    Noop,
}

pub(super) enum QueuedStartOutcome<T> {
    Started(T, tokio::sync::OwnedSemaphorePermit),
    Cancelled,
    Blocked(FinalizationResult),
}

pub(super) async fn persist_run_finalization(
    path: &Path,
    run_id: &str,
    status: FactoryRunStatus,
    error: Option<&str>,
) -> Result<FinalizationResult, String> {
    if !store_record_finalization(path, run_id, status, error)? {
        return Ok(FinalizationResult::Noop);
    }
    let mut last_error = None;
    for attempt in 0..MAX_FINAL_STATUS_ATTEMPTS {
        match store_apply_pending_finalization(path, run_id) {
            Ok(Some((run, event))) => return Ok(FinalizationResult::Applied(run, event)),
            Ok(None) => return Ok(FinalizationResult::Noop),
            Err(failure) => {
                last_error = Some(failure);
                if attempt + 1 < MAX_FINAL_STATUS_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(40 * (attempt + 1) as u64)).await;
                }
            }
        }
    }
    Ok(FinalizationResult::Deferred(last_error.unwrap_or_else(
        || "Factory final status remains pending".to_string(),
    )))
}

async fn persist_queued_start_failure(
    path: &Path,
    run_id: &str,
) -> Result<FinalizationResult, String> {
    persist_run_finalization(
        path,
        run_id,
        FactoryRunStatus::Blocked,
        Some("Factory run could not start because local storage remained unavailable"),
    )
    .await
}

pub(super) fn finish_status_after_capture(
    prompt_status: RunFinish,
    capture: Result<(), String>,
) -> RunFinish {
    match capture {
        Ok(()) => prompt_status,
        Err(_) => (
            FactoryRunStatus::Error,
            Some("Factory output capture stopped unexpectedly"),
        ),
    }
}

pub(super) async fn retry_queued_start<F, T>(
    permits: Arc<Semaphore>,
    mut persist: F,
    cancel: CancellationToken,
) -> Result<Option<(T, tokio::sync::OwnedSemaphorePermit)>, String>
where
    F: FnMut() -> Result<Option<T>, String>,
{
    for attempt in 0..MAX_QUEUED_START_ATTEMPTS {
        if cancel.is_cancelled() {
            return Ok(None);
        }
        let permit = tokio::select! {
            _ = cancel.cancelled() => return Ok(None),
            result = Arc::clone(&permits).acquire_owned() => {
                result.map_err(|error| format!("Factory session permit was closed: {error}"))?
            },
        };
        match persist() {
            Ok(Some(value)) => return Ok(Some((value, permit))),
            Ok(None) => return Ok(None),
            Err(error) => {
                drop(permit);
                if attempt == MAX_QUEUED_START_ATTEMPTS - 1 {
                    return Err(error);
                }
                if attempt < 3 {
                    eprintln!("colony-desktop: retrying Factory run start persistence: {error}");
                }
                let delay_ms = 40_u64
                    .saturating_mul(2_u64.saturating_pow(attempt.min(7)))
                    .min(800);
                tokio::select! {
                    _ = cancel.cancelled() => return Ok(None),
                    _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => {}
                }
            }
        }
    }
    Err("Factory run could not start after bounded persistence retries".to_string())
}

pub(super) async fn retry_queued_start_or_recover<F, T>(
    permits: Arc<Semaphore>,
    persist: F,
    cancel: CancellationToken,
    path: &Path,
    run_id: &str,
) -> Result<QueuedStartOutcome<T>, String>
where
    F: FnMut() -> Result<Option<T>, String>,
{
    match retry_queued_start(permits, persist, cancel).await {
        Ok(Some((value, permit))) => Ok(QueuedStartOutcome::Started(value, permit)),
        Ok(None) => Ok(QueuedStartOutcome::Cancelled),
        Err(error) => {
            eprintln!("colony-desktop: Factory run start persistence exhausted retries: {error}");
            persist_queued_start_failure(path, run_id)
                .await
                .map(QueuedStartOutcome::Blocked)
        }
    }
}

pub(super) async fn finish_run(
    app: &AppHandle,
    path: &Path,
    run_id: &str,
    event_authority: &FactoryEventAuthority,
    control: Option<&RunControl>,
    status: FactoryRunStatus,
    error: Option<&str>,
) -> bool {
    let finalization = persist_run_finalization(path, run_id, status, error).await;
    finish_run_result(app, event_authority, control, finalization)
}

pub(super) fn finish_run_result(
    app: &AppHandle,
    event_authority: &FactoryEventAuthority,
    control: Option<&RunControl>,
    finalization: Result<FinalizationResult, String>,
) -> bool {
    match finalization {
        Ok(FinalizationResult::Applied(_run, event)) => {
            publish(app, event_authority, control, &event);
            true
        }
        Ok(FinalizationResult::Deferred(failure)) => {
            eprintln!(
                "colony-desktop: Factory finalization is journaled for same-host recovery: {failure}"
            );
            true
        }
        Ok(FinalizationResult::Noop) => true,
        Err(failure) => {
            eprintln!(
                "colony-desktop: Factory finalization journal could not be written: {failure}"
            );
            false
        }
    }
}
