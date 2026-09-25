use super::*;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn temp_db() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("factory-runs.sqlite3");
    (dir, path)
}

fn seed(path: &Path, run_id: &str) {
    let checkout = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let checkout = checkout.to_string_lossy().to_string();
    let prompt = "inspect the repository";
    let operation_key = Uuid::new_v4().to_string();
    let request_hash = create_request_hash(
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        None,
        prompt,
    )
    .unwrap();
    store_create(
        path,
        run_id,
        &operation_key,
        &request_hash,
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        "codex",
        None,
        prompt,
    )
    .unwrap();
}

#[cfg(unix)]
#[test]
fn factory_run_store_is_owner_only() {
    let (_dir, path) = temp_db();
    drop(open_store(&path).unwrap());
    let directory_mode = fs::metadata(path.parent().unwrap())
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    let file_mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(directory_mode, 0o700);
    assert_eq!(file_mode, 0o600);
}

#[test]
fn factory_run_and_transcript_survive_store_reopen() {
    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    seed(&path, &run_id);
    let run = store_transition(
        &path,
        &run_id,
        Some(FactoryRunStatus::Queued),
        FactoryRunStatus::Running,
        None,
    )
    .unwrap()
    .map(|value| value.0)
    .unwrap();
    store_append_event(
        &path,
        &run_id,
        "agent_message_chunk",
        &serde_json::json!({ "text": "persisted output" }),
    )
    .unwrap();
    store_set_draft(&path, &run_id, "unsent follow-up").unwrap();

    drop(open_store(&path).unwrap());
    let snapshot = store_snapshot(&path, &run_id, 0).unwrap();
    assert_eq!(snapshot.run.id, run.id);
    assert_eq!(snapshot.run.status, FactoryRunStatus::Running);
    assert!(snapshot.events.iter().any(|event| {
        event.kind == "agent_message_chunk" && event.payload["text"] == "persisted output"
    }));
    assert_eq!(snapshot.draft.as_deref(), Some("unsent follow-up"));
}

#[test]
fn factory_run_host_restart_recovers_live_run_as_blocked_with_transcript() {
    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    seed(&path, &run_id);
    recover_store(&path, "host-one").unwrap();
    store_transition(
        &path,
        &run_id,
        Some(FactoryRunStatus::Queued),
        FactoryRunStatus::Running,
        None,
    )
    .unwrap();
    store_append_event(
        &path,
        &run_id,
        "agent_message_chunk",
        &serde_json::json!({ "text": "last checkpoint" }),
    )
    .unwrap();

    recover_store(&path, "host-two").unwrap();
    let snapshot = store_snapshot(&path, &run_id, 0).unwrap();
    assert_eq!(snapshot.run.status, FactoryRunStatus::Blocked);
    assert!(snapshot
        .events
        .iter()
        .any(|event| event.payload["text"] == "last checkpoint"));
}

#[test]
fn factory_run_create_retries_same_operation_without_scheduling_twice() {
    let (_dir, path) = temp_db();
    let checkout = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let checkout = checkout.to_string_lossy().to_string();
    let operation_key = Uuid::new_v4().to_string();
    let hash = create_request_hash(
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        None,
        "inspect repository",
    )
    .unwrap();
    let first = store_create(
        &path,
        &Uuid::new_v4().to_string(),
        &operation_key,
        &hash,
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        "codex",
        None,
        "inspect repository",
    )
    .unwrap();
    assert!(first.is_new);
    let first_run_id = first.run.id.clone();
    let starts = std::sync::atomic::AtomicUsize::new(0);
    let scheduled_first = schedule_new_store_create(first, |_, _| {
        starts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    })
    .unwrap();

    let retry = store_create(
        &path,
        &Uuid::new_v4().to_string(),
        &operation_key,
        &hash,
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        "codex",
        None,
        "inspect repository",
    )
    .unwrap();
    assert!(!retry.is_new);
    assert!(retry.events.is_empty());
    let scheduled_retry = schedule_new_store_create(retry, |_, _| {
        starts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    })
    .unwrap();

    assert_eq!(scheduled_first.id, first_run_id);
    assert_eq!(scheduled_retry.id, first_run_id);
    assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 1);
    let changed_payload_hash = create_request_hash(
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        None,
        "different task",
    )
    .unwrap();
    assert!(store_create(
        &path,
        &Uuid::new_v4().to_string(),
        &operation_key,
        &changed_payload_hash,
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        "codex",
        None,
        "different task",
    )
    .is_err());
}

#[test]
fn factory_terminal_history_retains_only_the_configured_completed_run_window() {
    let (_dir, path) = temp_db();
    for _ in 0..(MAX_RETAINED_TERMINAL_RUNS + 5) {
        let run_id = Uuid::new_v4().to_string();
        seed(&path, &run_id);
        store_transition(
            &path,
            &run_id,
            Some(FactoryRunStatus::Queued),
            FactoryRunStatus::Done,
            None,
        )
        .unwrap();
    }

    let runs = store_list(&path).unwrap();
    assert_eq!(runs.len(), MAX_RETAINED_TERMINAL_RUNS as usize);
    assert!(runs.iter().all(|run| run.status == FactoryRunStatus::Done));
}

#[test]
fn factory_store_enforces_aggregate_quota_for_transcripts_and_drafts() {
    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    seed(&path, &run_id);
    let connection = open_store(&path).unwrap();
    let page_size: i64 = connection
        .pragma_query_value(None, "page_size", |row| row.get(0))
        .unwrap();
    let max_page_count: i64 = connection
        .pragma_query_value(None, "max_page_count", |row| row.get(0))
        .unwrap();
    assert!(page_size * max_page_count <= MAX_FACTORY_STORAGE_BYTES);
    let used_bytes: i64 = connection
        .query_row(
            "SELECT COALESCE((SELECT SUM(length(CAST(payload_json AS BLOB)) + length(CAST(kind AS BLOB)) + ?1) FROM factory_run_events), 0) + (SELECT COUNT(*) * ?2 FROM factory_runs)",
            rusqlite::params![EVENT_STORAGE_OVERHEAD_BYTES, RUN_STORAGE_OVERHEAD_BYTES],
            |row| row.get(0),
        )
        .unwrap();
    drop(connection);
    let low_limit = used_bytes + 8;

    assert!(store_append_event_with_storage_limit(
        &path,
        &run_id,
        "agent_message_chunk",
        &serde_json::json!({ "text": "this transcript exceeds the remaining quota" }),
        low_limit,
    )
    .is_err());
    assert!(
        store_set_draft_with_storage_limit(&path, &run_id, "draft over quota", low_limit).is_err()
    );

    let snapshot = store_snapshot(&path, &run_id, 0).unwrap();
    assert!(snapshot
        .events
        .iter()
        .all(|event| event.kind != "agent_message_chunk"));
    assert_eq!(snapshot.draft, None);
}

#[tokio::test]
async fn queued_start_retries_transient_store_failures_until_running_is_persisted() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    seed(&path, &run_id);
    let attempts = AtomicUsize::new(0);
    let cancel = CancellationToken::new();
    let result = retry_queued_start(
        || {
            let attempt = attempts.fetch_add(1, Ordering::SeqCst);
            if attempt < 4 {
                return Err("injected transient SQLite write lock".to_string());
            }
            store_transition(
                &path,
                &run_id,
                Some(FactoryRunStatus::Queued),
                FactoryRunStatus::Running,
                None,
            )
        },
        cancel,
    )
    .await
    .unwrap();

    assert_eq!(attempts.load(Ordering::SeqCst), 5);
    assert_eq!(result.0.status, FactoryRunStatus::Running);
    assert_eq!(
        store_snapshot(&path, &run_id, 0).unwrap().run.status,
        FactoryRunStatus::Running
    );
}

#[tokio::test]
async fn observer_lag_persists_a_gap_marker_and_fails_capture() {
    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    seed(&path, &run_id);
    let observer = buzz_acp::ObserverHandle::in_process();
    let receiver = observer.subscribe();
    // Tokio rounds the requested 1,000-slot channel capacity to 1,024.
    // Overflow the rounded capacity so the receiver deterministically lags.
    for index in 0..1_025 {
        observer.emit(
            "acp_read",
            None,
            &buzz_acp::ObserverContext::default(),
            serde_json::json!({ "method": "ignored", "index": index }),
        );
    }

    let captured = capture_observer_stream(receiver, path.clone(), run_id.clone(), |_| {}).await;
    assert!(captured
        .as_ref()
        .is_err_and(|error| error.contains("observer lagged")));
    let snapshot = store_snapshot(&path, &run_id, 0).unwrap();
    assert!(snapshot
        .events
        .iter()
        .any(|event| event.kind == "transcript_capture_error"));
    assert_eq!(
        finish_status_after_capture((FactoryRunStatus::Done, None), captured).0,
        FactoryRunStatus::Error
    );
}

#[tokio::test]
async fn transcript_persistence_failure_overrides_successful_prompt_completion() {
    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    seed(&path, &run_id);
    let connection = open_store(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER reject_agent_output BEFORE INSERT ON factory_run_events
             WHEN NEW.kind = 'agent_message_chunk'
             BEGIN SELECT RAISE(FAIL, 'injected transcript failure'); END;",
        )
        .unwrap();
    drop(connection);
    let observer = buzz_acp::ObserverHandle::in_process();
    let receiver = observer.subscribe();
    observer.emit(
        "acp_read",
        None,
        &buzz_acp::ObserverContext::default(),
        serde_json::json!({
            "method": "session/update",
            "params": {
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "text": "output must not be lost as done" }
                }
            }
        }),
    );

    let captured = capture_observer_stream(receiver, path.clone(), run_id.clone(), |_| {}).await;
    assert!(captured.is_err());
    let final_status = finish_status_after_capture((FactoryRunStatus::Done, None), captured);
    assert_eq!(final_status.0, FactoryRunStatus::Error);
    let snapshot = store_snapshot(&path, &run_id, 0).unwrap();
    assert!(snapshot
        .events
        .iter()
        .any(|event| event.kind == "transcript_capture_error"));
    assert!(!snapshot.events.iter().any(|event| {
        event.kind == "agent_message_chunk"
            && event.payload["content"]["text"] == "output must not be lost as done"
    }));
}

#[tokio::test]
async fn factory_run_pane_close_does_not_cancel() {
    let runtime = FactoryRuntime::default();
    let run_id = Uuid::new_v4().to_string();
    let subscription_id = Uuid::new_v4().to_string();
    let control = runtime.register(&run_id).unwrap();
    let (cancel, receiver) = runtime
        .attach_if_live(&subscription_id, &run_id)
        .unwrap()
        .expect("registered run should accept an attachment");
    drop(receiver);
    assert!(runtime.detach(&subscription_id).unwrap());
    assert!(!control.cancel.is_cancelled());
    assert!(cancel.is_cancelled());
    assert!(runtime.control(&run_id).unwrap().is_some());
}
