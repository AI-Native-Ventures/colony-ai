use super::*;

fn temp_db() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("factory-runs.sqlite3");
    (dir, path)
}

fn seed(path: &Path, run_id: &str) {
    let checkout = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    store_create(
        path,
        run_id,
        Some("project-1"),
        Some("repo-1"),
        &checkout.to_string_lossy(),
        "agent-1",
        "codex",
        None,
        "inspect the repository",
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
