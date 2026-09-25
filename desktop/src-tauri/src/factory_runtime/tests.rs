use super::*;
use rusqlite::Connection;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn temp_db() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("factory-runs.sqlite3");
    (dir, path)
}

fn test_scope() -> FactoryScope {
    FactoryScope {
        relay_url: "wss://factory.example".to_string(),
        identity_pubkey: "a".repeat(64),
        business_community_id: "business-one".to_string(),
        client_channel_id: None,
    }
}

fn seed(path: &Path, run_id: &str) {
    seed_in_scope(path, run_id, &test_scope());
}

fn seed_in_scope(path: &Path, run_id: &str, scope: &FactoryScope) {
    let checkout = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let checkout = checkout.to_string_lossy().to_string();
    let prompt = "inspect the repository";
    let operation_key = Uuid::new_v4().to_string();
    let request_hash = create_request_hash(
        scope,
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
        scope,
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

fn cache_scope_memberships(runtime: &FactoryRuntime, scope: &FactoryScope, expires_at: Instant) {
    let mut entries = runtime.memberships.entries.lock().unwrap();
    entries.insert(scope.business_membership_key(), (expires_at, true));
    if let Some(key) = scope.membership_key() {
        entries.insert(key, (expires_at, true));
    }
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
    store_set_draft(&path, &run_id, &test_scope(), "unsent follow-up").unwrap();

    drop(open_store(&path).unwrap());
    let snapshot = store_snapshot(&path, &run_id, &test_scope(), 0).unwrap();
    assert_eq!(snapshot.run.id, run.id);
    assert_eq!(snapshot.run.scope, test_scope());
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
    let snapshot = store_snapshot(&path, &run_id, &test_scope(), 0).unwrap();
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
        &test_scope(),
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
        &test_scope(),
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
        &test_scope(),
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
        &test_scope(),
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
        &test_scope(),
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

    let runs = store_list(&path, &test_scope()).unwrap();
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
    assert!(store_set_draft_with_storage_limit(
        &path,
        &run_id,
        &test_scope(),
        "draft over quota",
        low_limit,
    )
    .is_err());

    let snapshot = store_snapshot(&path, &run_id, &test_scope(), 0).unwrap();
    assert!(snapshot
        .events
        .iter()
        .all(|event| event.kind != "agent_message_chunk"));
    assert_eq!(snapshot.draft, None);
}

#[test]
fn factory_scope_run_cap_recovers_without_touching_foreign_blocked_runs() {
    let (_dir, path) = temp_db();
    let source_scope = test_scope();
    let mut other_business_scope = source_scope.clone();
    other_business_scope.business_community_id = "business-two".to_string();
    let mut other_client_scope = source_scope.clone();
    other_client_scope.client_channel_id = Some("client-channel-two".to_string());
    let first_blocked_id = Uuid::new_v4().to_string();
    let connection = open_store(&path).unwrap();
    let tx = connection.unchecked_transaction().unwrap();
    for index in 0..MAX_STORED_RUNS_PER_SCOPE {
        let run_id = if index == 0 {
            first_blocked_id.clone()
        } else {
            Uuid::new_v4().to_string()
        };
        let values = source_scope.db_values();
        tx.execute(
            "INSERT INTO factory_runs (
                id, project_id, repository_id, checkout_path, agent_id, harness_id,
                parent_run_id, status, created_at, updated_at,
                relay_url, identity_pubkey, business_community_id, client_channel_id
             ) VALUES (?1, NULL, NULL, '/', 'agent', 'codex', NULL, 'blocked',
                       '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z', ?2, ?3, ?4, ?5)",
            rusqlite::params![run_id, values.0, values.1, values.2, values.3],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    drop(connection);

    let checkout = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let checkout = checkout.to_string_lossy().to_string();
    let create_in_scope = |scope: &FactoryScope, operation: &str| {
        let request_hash =
            create_request_hash(scope, None, None, &checkout, "agent-1", None, "new task").unwrap();
        store_create(
            &path,
            scope,
            &Uuid::new_v4().to_string(),
            &scoped_operation_key(scope, operation).unwrap(),
            &request_hash,
            None,
            None,
            &checkout,
            "agent-1",
            "codex",
            None,
            "new task",
        )
    };

    let other_business_run =
        create_in_scope(&other_business_scope, "other-business-operation").unwrap();
    let other_client_run = create_in_scope(&other_client_scope, "other-client-operation").unwrap();
    assert_eq!(other_business_run.run.scope, other_business_scope);
    assert_eq!(other_client_run.run.scope, other_client_scope);
    assert!(create_in_scope(&source_scope, "at-cap-operation").is_err());
    assert!(store_delete_run_scoped(&path, &first_blocked_id, &other_business_scope).is_err());
    assert_eq!(
        store_snapshot(&path, &first_blocked_id, &source_scope, 0)
            .unwrap()
            .run
            .status,
        FactoryRunStatus::Blocked
    );

    store_delete_run_scoped(&path, &first_blocked_id, &source_scope).unwrap();
    let recovered = create_in_scope(&source_scope, "recovered-cap-operation").unwrap();
    assert_eq!(recovered.run.scope, source_scope);
}

#[tokio::test]
async fn queued_start_retries_transient_store_failures_until_running_is_persisted() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    seed(&path, &run_id);
    let attempts = AtomicUsize::new(0);
    let cancel = CancellationToken::new();
    let permits = Arc::new(Semaphore::new(1));
    let result = retry_queued_start(
        permits,
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
    let (result, permit) = result.unwrap();
    assert_eq!(result.0.status, FactoryRunStatus::Running);
    drop(permit);
    assert_eq!(
        store_snapshot(&path, &run_id, &test_scope(), 0)
            .unwrap()
            .run
            .status,
        FactoryRunStatus::Running
    );
}

#[tokio::test]
async fn factory_queued_start_persistent_failure_blocks_run_and_releases_session_permit() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let (_dir, path) = temp_db();
    let failed_run_id = Uuid::new_v4().to_string();
    let later_run_id = Uuid::new_v4().to_string();
    seed(&path, &failed_run_id);
    seed(&path, &later_run_id);

    let permits = Arc::new(Semaphore::new(1));
    let attempts = Arc::new(AtomicUsize::new(0));
    let first_attempt = Arc::new(tokio::sync::Notify::new());
    let observed_attempt = Arc::clone(&first_attempt);
    let observed_attempts = Arc::clone(&attempts);
    let failure_permits = Arc::clone(&permits);
    let failure_path = path.clone();
    let failure_run_id = failed_run_id.clone();
    let persistent_failure = tokio::spawn(async move {
        retry_queued_start_or_recover(
            failure_permits,
            move || -> Result<Option<()>, String> {
                if observed_attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                    observed_attempt.notify_one();
                }
                Err("injected persistent status write failure".to_string())
            },
            CancellationToken::new(),
            &failure_path,
            &failure_run_id,
        )
        .await
    });
    first_attempt.notified().await;
    assert_eq!(
        permits.available_permits(),
        1,
        "the session permit must be available during retry backoff"
    );
    let result = tokio::time::timeout(Duration::from_secs(3), persistent_failure)
        .await
        .expect("persistent start failures must reach a bounded outcome")
        .unwrap();
    assert!(matches!(
        result.unwrap(),
        QueuedStartOutcome::Blocked(FinalizationResult::Applied(ref run, _))
            if run.status == FactoryRunStatus::Blocked
    ));
    assert_eq!(
        attempts.load(Ordering::SeqCst),
        MAX_QUEUED_START_ATTEMPTS as usize
    );
    assert_eq!(permits.available_permits(), 1);

    assert_eq!(
        store_snapshot(&path, &failed_run_id, &test_scope(), 0)
            .unwrap()
            .run
            .status,
        FactoryRunStatus::Blocked
    );

    let later = retry_queued_start(
        Arc::clone(&permits),
        || {
            store_transition(
                &path,
                &later_run_id,
                Some(FactoryRunStatus::Queued),
                FactoryRunStatus::Running,
                None,
            )
        },
        CancellationToken::new(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(later.0 .0.status, FactoryRunStatus::Running);
    assert_eq!(permits.available_permits(), 0);
    drop(later.1);
    assert_eq!(permits.available_permits(), 1);
}

#[tokio::test]
async fn factory_queued_start_retry_cancels_while_waiting_for_session_permit() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let permits = Arc::new(Semaphore::new(0));
    let attempts = Arc::new(AtomicUsize::new(0));
    let cancel = CancellationToken::new();
    let worker_cancel = cancel.clone();
    let worker_attempts = Arc::clone(&attempts);
    let worker = tokio::spawn(retry_queued_start(
        Arc::clone(&permits),
        move || -> Result<Option<()>, String> {
            worker_attempts.fetch_add(1, Ordering::SeqCst);
            Ok(Some(()))
        },
        worker_cancel,
    ));
    tokio::time::sleep(Duration::from_millis(20)).await;
    cancel.cancel();

    let result = tokio::time::timeout(Duration::from_secs(1), worker)
        .await
        .expect("cancellation must interrupt waiting for a session permit")
        .unwrap()
        .unwrap();
    assert!(result.is_none());
    assert_eq!(attempts.load(Ordering::SeqCst), 0);
    assert_eq!(permits.available_permits(), 0);
}

#[tokio::test]
async fn failed_final_status_write_is_journaled_and_same_host_list_recovers_without_restart() {
    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    let foreign_run_id = Uuid::new_v4().to_string();
    let mut foreign_scope = test_scope();
    foreign_scope.business_community_id = "business-two".to_string();
    seed(&path, &run_id);
    seed_in_scope(&path, &foreign_run_id, &foreign_scope);
    store_transition(
        &path,
        &run_id,
        Some(FactoryRunStatus::Queued),
        FactoryRunStatus::Running,
        None,
    )
    .unwrap();
    let connection = open_store(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER reject_terminal_run_status BEFORE UPDATE OF status ON factory_runs
             WHEN NEW.status IN ('error','done','cancelled')
             BEGIN SELECT RAISE(FAIL, 'injected final status write failure'); END;",
        )
        .unwrap();
    drop(connection);

    store_transition(
        &path,
        &foreign_run_id,
        Some(FactoryRunStatus::Queued),
        FactoryRunStatus::Running,
        None,
    )
    .unwrap();
    assert!(
        store_record_finalization(&path, &foreign_run_id, FactoryRunStatus::Done, None,).unwrap()
    );

    let result = persist_run_finalization(&path, &run_id, FactoryRunStatus::Done, None)
        .await
        .unwrap();
    assert!(matches!(result, FinalizationResult::Deferred(_)));
    let visible = store_snapshot(&path, &run_id, &test_scope(), 0).unwrap();
    assert_eq!(visible.run.status, FactoryRunStatus::Blocked);
    assert!(visible
        .run
        .error
        .as_deref()
        .is_some_and(|error| error.contains("storage recovery")));

    let connection = open_store(&path).unwrap();
    connection
        .execute_batch("DROP TRIGGER reject_terminal_run_status;")
        .unwrap();
    drop(connection);

    let recovered = store_list(&path, &test_scope()).unwrap();
    let recovered = recovered.iter().find(|run| run.id == run_id).unwrap();
    assert_eq!(recovered.status, FactoryRunStatus::Done);
    let connection = open_store(&path).unwrap();
    let journal_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM factory_run_finalizations WHERE run_id = ?1",
            [&run_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(journal_rows, 0);
    let foreign_journal_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM factory_run_finalizations WHERE run_id = ?1",
            [&foreign_run_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(foreign_journal_rows, 1);
    drop(connection);
    assert_eq!(
        store_snapshot(&path, &foreign_run_id, &foreign_scope, 0)
            .unwrap()
            .run
            .status,
        FactoryRunStatus::Done
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
    let snapshot = store_snapshot(&path, &run_id, &test_scope(), 0).unwrap();
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
    let snapshot = store_snapshot(&path, &run_id, &test_scope(), 0).unwrap();
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
    let scope = test_scope();
    cache_scope_memberships(&runtime, &scope, Instant::now() + FACTORY_MEMBERSHIP_TTL);
    runtime.activate_scope(Some(scope.clone())).unwrap();
    let run_id = Uuid::new_v4().to_string();
    let subscription_id = Uuid::new_v4().to_string();
    let control = runtime.register(&run_id, scope.clone()).unwrap();
    let (cancel, receiver) = runtime
        .attach_if_live(&subscription_id, &run_id, &scope)
        .unwrap()
        .expect("registered run should accept an attachment");
    drop(receiver);
    assert!(runtime.detach(&subscription_id, &scope).unwrap());
    assert!(!control.cancel.is_cancelled());
    assert!(cancel.is_cancelled());
    assert!(runtime.control(&run_id).unwrap().is_some());
}

fn assert_cross_scope_isolation(local_scope: FactoryScope, foreign_scope: FactoryScope) {
    let (_dir, path) = temp_db();
    let local_run_id = Uuid::new_v4().to_string();
    let foreign_run_id = Uuid::new_v4().to_string();
    seed_in_scope(&path, &local_run_id, &local_scope);
    seed_in_scope(&path, &foreign_run_id, &foreign_scope);
    store_append_event(
        &path,
        &local_run_id,
        "agent_message_chunk",
        &serde_json::json!({ "text": "local output" }),
    )
    .unwrap();
    store_append_event(
        &path,
        &foreign_run_id,
        "agent_message_chunk",
        &serde_json::json!({ "text": "foreign output" }),
    )
    .unwrap();
    store_set_draft(&path, &foreign_run_id, &foreign_scope, "foreign draft").unwrap();

    let visible = store_list(&path, &local_scope).unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, local_run_id);
    let local_snapshot = store_snapshot(&path, &local_run_id, &local_scope, 0).unwrap();
    assert!(local_snapshot
        .events
        .iter()
        .any(|event| { event.scope == local_scope && event.payload["text"] == "local output" }));
    assert!(store_snapshot(&path, &foreign_run_id, &local_scope, 0).is_err());
    assert!(store_set_draft(&path, &foreign_run_id, &local_scope, "cross-scope write").is_err());
    assert!(store_get_draft(&path, &foreign_run_id, &local_scope)
        .unwrap()
        .is_none());
    assert!(store_transition_scoped(
        &path,
        &foreign_run_id,
        &local_scope,
        None,
        FactoryRunStatus::Cancelled,
        None,
    )
    .is_err());
    assert_eq!(
        store_snapshot(&path, &foreign_run_id, &foreign_scope, 0)
            .unwrap()
            .run
            .status,
        FactoryRunStatus::Queued,
    );

    let checkout = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    let checkout = checkout.to_string_lossy().to_string();
    let parent_hash = create_request_hash(
        &local_scope,
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        Some(&foreign_run_id),
        "subtask",
    )
    .unwrap();
    assert!(store_create(
        &path,
        &local_scope,
        &Uuid::new_v4().to_string(),
        &scoped_operation_key(&local_scope, "subtask-operation").unwrap(),
        &parent_hash,
        Some("project-1"),
        Some("repo-1"),
        &checkout,
        "agent-1",
        "codex",
        Some(&foreign_run_id),
        "subtask",
    )
    .is_err());

    let runtime = FactoryRuntime::default();
    for scope in [&local_scope, &foreign_scope] {
        cache_scope_memberships(&runtime, scope, Instant::now() + FACTORY_MEMBERSHIP_TTL);
    }
    runtime.activate_scope(Some(local_scope.clone())).unwrap();
    let local_control = runtime
        .register(&local_run_id, local_scope.clone())
        .unwrap();
    let (local_cancel, receiver) = runtime
        .attach_if_live("local-subscription", &local_run_id, &local_scope)
        .unwrap()
        .unwrap();
    drop(receiver);
    assert!(runtime
        .attach_if_live("foreign-subscription", &local_run_id, &foreign_scope)
        .is_err());
    let authority = runtime.event_authority();
    let mut leaked = false;
    assert!(!authority.while_active(&foreign_scope, || leaked = true));
    assert!(!leaked);

    runtime.activate_scope(Some(foreign_scope.clone())).unwrap();
    let foreign_control = runtime
        .register(&foreign_run_id, foreign_scope.clone())
        .unwrap();
    let (foreign_cancel, foreign_receiver) = runtime
        .attach_if_live("foreign-subscription", &foreign_run_id, &foreign_scope)
        .unwrap()
        .unwrap();
    drop(foreign_receiver);
    runtime.activate_scope(Some(local_scope.clone())).unwrap();
    assert!(runtime
        .attach_if_live("cross-scope-reattach", &foreign_run_id, &local_scope)
        .is_err());
    assert!(foreign_cancel.is_cancelled());
    assert!(!foreign_control.cancel.is_cancelled());
    assert!(local_cancel.is_cancelled());
    assert!(!local_control.cancel.is_cancelled());
}

#[test]
fn factory_business_scope_isolation_covers_list_read_cancel_reattach_and_events() {
    let local = test_scope();
    let mut foreign = local.clone();
    foreign.business_community_id = "business-two".to_string();
    assert_cross_scope_isolation(local, foreign);
}

#[test]
fn factory_business_scope_authorization_requires_identity_and_membership_match() {
    let response: FactoryBusinessMembershipResponse = serde_json::from_value(serde_json::json!({
        "owner_pubkey": "a".repeat(64),
        "communities": [
            { "id": "business-one" },
            { "id": "business-two" }
        ]
    }))
    .unwrap();

    assert!(
        response_contains_business_membership(&response, &"a".repeat(64), "business-one").unwrap()
    );
    assert!(
        !response_contains_business_membership(&response, &"b".repeat(64), "business-one").unwrap()
    );
    assert!(
        !response_contains_business_membership(&response, &"a".repeat(64), "business-three")
            .unwrap()
    );

    let oversized: FactoryBusinessMembershipResponse = serde_json::from_value(serde_json::json!({
        "owner_pubkey": "a".repeat(64),
        "communities": (0..=MAX_BUSINESS_MEMBERSHIP_COMMUNITIES)
            .map(|index| serde_json::json!({ "id": format!("business-{index}") }))
            .collect::<Vec<_>>()
    }))
    .unwrap();
    assert!(
        response_contains_business_membership(&oversized, &"a".repeat(64), "business-one").is_err()
    );
}

#[test]
fn factory_client_scope_isolation_covers_list_read_cancel_reattach_and_events() {
    let mut local = test_scope();
    local.client_channel_id = Some("client-channel-one".to_string());
    let mut foreign = local.clone();
    foreign.client_channel_id = Some("client-channel-two".to_string());
    assert_cross_scope_isolation(local, foreign);
}

#[tokio::test]
async fn factory_client_membership_revocation_after_workspace_load_is_denied_on_reattach() {
    let runtime = FactoryRuntime::default();
    let scope = FactoryScope {
        client_channel_id: Some("client-channel-one".to_string()),
        ..test_scope()
    };
    runtime.activate_scope(Some(scope.clone())).unwrap();
    verify_cached_business_membership(&runtime, &scope, true, || async { Ok(true) })
        .await
        .unwrap();
    let membership_queries = std::sync::atomic::AtomicUsize::new(0);
    verify_cached_client_membership(&runtime, &scope, true, || async {
        membership_queries.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(true)
    })
    .await
    .unwrap();
    assert!(runtime
        .memberships
        .has_fresh_membership(&scope, Instant::now()));

    let revoked = verify_cached_client_membership(&runtime, &scope, true, || async {
        membership_queries.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(false)
    })
    .await
    .is_err();
    assert!(revoked);
    assert_eq!(
        membership_queries.load(std::sync::atomic::Ordering::SeqCst),
        2
    );
    assert!(runtime.active_scope().is_err());
    assert!(!runtime
        .memberships
        .has_fresh_membership(&scope, Instant::now()));
}

#[tokio::test]
async fn factory_business_only_revocation_invalidates_scope_and_cancels_workers() {
    assert_business_revocation_invalidates_scope(false).await;
}

#[tokio::test]
async fn factory_client_scope_business_revocation_invalidates_scope_and_cancels_workers() {
    assert_business_revocation_invalidates_scope(true).await;
}

async fn assert_business_revocation_invalidates_scope(with_client_channel: bool) {
    assert_eq!(FACTORY_MEMBERSHIP_TTL, Duration::from_secs(30));
    let runtime = FactoryRuntime::default();
    let mut scope = test_scope();
    if with_client_channel {
        scope.client_channel_id = Some("client-channel-one".to_string());
    }
    runtime.activate_scope(Some(scope.clone())).unwrap();
    cache_scope_memberships(&runtime, &scope, Instant::now() + FACTORY_MEMBERSHIP_TTL);
    let run_id = Uuid::new_v4().to_string();
    let subscription_id = Uuid::new_v4().to_string();
    let control = runtime.register(&run_id, scope.clone()).unwrap();
    let (attachment_cancel, receiver) = runtime
        .attach_if_live(&subscription_id, &run_id, &scope)
        .unwrap()
        .unwrap();
    drop(receiver);

    let membership_queries = std::sync::atomic::AtomicUsize::new(0);
    authorize_active_factory_scope(
        &runtime,
        &scope,
        false,
        || async {
            membership_queries.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(true)
        },
        || async {
            if with_client_channel {
                verify_cached_client_membership(&runtime, &scope, false, || async { Ok(true) })
                    .await
            } else {
                Ok(())
            }
        },
    )
    .await
    .unwrap();
    assert_eq!(
        membership_queries.load(std::sync::atomic::Ordering::SeqCst),
        0
    );

    {
        let mut entries = runtime.memberships.entries.lock().unwrap();
        entries.insert(
            scope.business_membership_key(),
            (Instant::now() - Duration::from_secs(1), true),
        );
    }
    let revoked = authorize_active_factory_scope(
        &runtime,
        &scope,
        false,
        || async {
            membership_queries.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(false)
        },
        || async { Ok(()) },
    )
    .await;

    assert!(revoked.is_err());
    assert_eq!(
        membership_queries.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    assert!(runtime.active_scope().is_err());
    assert!(control.cancel.is_cancelled());
    assert!(attachment_cancel.is_cancelled());
    assert!(runtime
        .memberships
        .entries
        .lock()
        .unwrap()
        .get(&scope.business_membership_key())
        .is_none());
    if let Some(client_key) = scope.membership_key() {
        assert!(runtime
            .memberships
            .entries
            .lock()
            .unwrap()
            .get(&client_key)
            .is_none());
    }
    assert!(runtime.attachments.lock().unwrap().is_empty());

    for operation in [
        "list",
        "snapshot",
        "reattach",
        "draft read",
        "draft write",
        "cancel",
        "create",
    ] {
        assert!(
            authorize_active_factory_scope(
                &runtime,
                &scope,
                false,
                || async { Ok(true) },
                || async { Ok(()) },
            )
            .await
            .is_err(),
            "revoked membership must deny the protected {operation} path"
        );
    }
}

#[tokio::test]
async fn factory_membership_cache_uses_explicit_thirty_second_freshness_window() {
    let cache = MembershipCache {
        entries: Arc::new(Mutex::new(HashMap::new())),
        generations: Arc::new(Mutex::new(HashMap::new())),
        next_generation: Arc::new(AtomicU64::new(0)),
    };
    let scope = test_scope();
    let now = Instant::now();
    assert!(cache
        .verify_for_bind(scope.business_membership_key(), now, || async { Ok(true) })
        .await
        .unwrap());
    assert!(cache.has_fresh_membership(&scope, now + Duration::from_secs(29)));
    assert!(!cache.has_fresh_membership(&scope, now + Duration::from_secs(30)));
}

#[tokio::test]
async fn factory_membership_verification_rejects_stale_in_flight_results() {
    use tokio::sync::Notify;

    let cache = MembershipCache {
        entries: Arc::new(Mutex::new(HashMap::new())),
        generations: Arc::new(Mutex::new(HashMap::new())),
        next_generation: Arc::new(AtomicU64::new(0)),
    };
    let scope = FactoryScope {
        client_channel_id: Some("client-channel-one".to_string()),
        ..test_scope()
    };
    let key = scope.membership_key().unwrap();
    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let stale_cache = cache.clone();
    let stale_key = key.clone();
    let stale_started = Arc::clone(&started);
    let stale_release = Arc::clone(&release);
    let stale = tokio::spawn(async move {
        stale_cache
            .verify_for_bind(stale_key, Instant::now(), || async move {
                stale_started.notify_one();
                stale_release.notified().await;
                Ok(true)
            })
            .await
    });
    started.notified().await;

    assert!(!cache
        .verify_for_bind(key, Instant::now(), || async { Ok(false) })
        .await
        .unwrap());
    release.notify_one();
    assert!(stale.await.unwrap().is_err());
    assert!(!cache.has_fresh_membership(&scope, Instant::now()));
}

#[test]
fn factory_pre_scope_rows_are_inaccessible_after_scope_migration() {
    let (_dir, path) = temp_db();
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE factory_runs (
                id TEXT PRIMARY KEY, project_id TEXT, repository_id TEXT,
                checkout_path TEXT NOT NULL, agent_id TEXT NOT NULL, harness_id TEXT NOT NULL,
                parent_run_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, acp_session_id TEXT, error TEXT,
                operation_key TEXT, request_hash TEXT
             );
             INSERT INTO factory_runs VALUES (
                'legacy-run', NULL, NULL, '/', 'agent', 'codex', NULL, 'done',
                '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z', NULL, NULL, NULL, NULL
             );",
        )
        .unwrap();
    drop(connection);

    let scope = test_scope();
    let runs = store_list(&path, &scope).unwrap();
    assert!(runs.is_empty());
    assert!(store_snapshot(&path, "legacy-run", &scope, 0).is_err());
}

#[test]
fn factory_creation_requires_verified_project_repository_membership_and_client_channel() {
    use nostr::{EventBuilder, Keys, Kind, Tag};

    let owner = Keys::generate();
    let owner_pubkey = owner.public_key().to_hex();
    let repository_address = format!("30617:{owner_pubkey}:engine");
    let project = EventBuilder::new(Kind::Custom(30621), "")
        .tags([
            Tag::parse(["d", "factory"]).unwrap(),
            Tag::parse(["a", repository_address.as_str()]).unwrap(),
            Tag::parse(["buzz-channel", "client-channel-one"]).unwrap(),
        ])
        .sign_with_keys(&owner)
        .unwrap();

    assert!(event_matches_coordinate(
        &project,
        30621,
        &owner_pubkey,
        "factory",
    ));
    assert!(!event_matches_coordinate(
        &project,
        30621,
        &"b".repeat(64),
        "factory",
    ));
    assert!(!event_matches_coordinate(
        &project,
        30621,
        &owner_pubkey,
        "another-project",
    ));
    assert!(project_lists_repository(&project, &repository_address));
    assert!(!project_lists_repository(&project, "30617:other:repo"));

    let repo = EventBuilder::new(Kind::Custom(30617), "")
        .tags([
            Tag::parse(["d", "engine"]).unwrap(),
            Tag::parse(["buzz-channel", "client-channel-one"]).unwrap(),
        ])
        .sign_with_keys(&owner)
        .unwrap();
    let mut scope = test_scope();
    scope.client_channel_id = Some("client-channel-one".to_string());
    assert!(client_scope_contains_announcements(
        &scope,
        Some(&project),
        Some(&repo),
    ));
    scope.client_channel_id = Some("client-channel-two".to_string());
    assert!(!client_scope_contains_announcements(
        &scope,
        Some(&project),
        Some(&repo),
    ));
}
