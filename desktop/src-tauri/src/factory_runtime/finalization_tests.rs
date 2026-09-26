use super::*;

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
    runtime.memberships.cache_verified_membership(
        scope.business_membership_key(),
        expires_at,
        true,
    );
    if let Some(key) = scope.membership_key() {
        runtime
            .memberships
            .cache_verified_membership(key, expires_at, true);
    }
}

#[tokio::test]
async fn persistent_finalization_journal_failure_is_recovered_and_releases_control_capacity() {
    let (_dir, path) = temp_db();
    let run_id = Uuid::new_v4().to_string();
    let foreign_run_id = Uuid::new_v4().to_string();
    let mut scope = test_scope();
    scope.client_channel_id = Some("client-a".to_string());
    let mut sibling_scope = scope.clone();
    sibling_scope.client_channel_id = Some("client-b".to_string());
    seed_in_scope(&path, &run_id, &scope);
    store_transition(
        &path,
        &run_id,
        Some(FactoryRunStatus::Queued),
        FactoryRunStatus::Running,
        None,
    )
    .unwrap();
    seed_in_scope(&path, &foreign_run_id, &sibling_scope);
    store_transition(
        &path,
        &foreign_run_id,
        Some(FactoryRunStatus::Queued),
        FactoryRunStatus::Running,
        None,
    )
    .unwrap();
    assert!(store_record_finalization_recovery(
        &path,
        &foreign_run_id,
        FactoryRunStatus::Done,
        None,
    )
    .unwrap());

    let runtime = FactoryRuntime::default();
    runtime.activate_scope(Some(scope.clone())).unwrap();
    cache_scope_memberships(&runtime, &scope, Instant::now() + FACTORY_MEMBERSHIP_TTL);
    let max_controls = MAX_CONCURRENT_SESSIONS + MAX_QUEUED_RUNS as usize;
    for index in 0..max_controls - 1 {
        runtime
            .register(&format!("capacity-filler-{index}"), scope.clone())
            .unwrap();
    }
    let control = runtime.register(&run_id, scope.clone()).unwrap();
    assert!(!control.cancel.is_cancelled());
    assert!(runtime.register("capacity-full", scope.clone()).is_err());

    let mut journal_attempts = 0;
    let finalization = persist_run_finalization_with_recovery(
        || {
            journal_attempts += 1;
            Err("injected persistent finalization journal failure".to_string())
        },
        || store_record_finalization_recovery(&path, &run_id, FactoryRunStatus::Done, None),
        || store_apply_pending_finalization(&path, &run_id),
    )
    .await;
    assert!(matches!(
        &finalization,
        Ok(FinalizationResult::Deferred(message))
            if message.contains("same-host recovery record saved")
    ));
    assert_eq!(journal_attempts, MAX_FINAL_STATUS_ATTEMPTS);

    let connection = open_store(&path).unwrap();
    let recovery_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM factory_run_finalization_recovery WHERE run_id = ?1",
            [&run_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        recovery_rows, 1,
        "the requested final status must be durable"
    );
    drop(connection);

    assert!(finish_run_result_with(&run_id, &runtime.controls, finalization, |_| {}).is_ok());
    assert!(runtime.control(&run_id).unwrap().is_none());
    runtime
        .register("capacity-reused-after-finalization", scope.clone())
        .expect("durable recovery must release the control slot");

    let snapshot = store_snapshot(&path, &run_id, &scope, 0).unwrap();
    assert_eq!(snapshot.run.status, FactoryRunStatus::Done);
    let connection = open_store(&path).unwrap();
    let recovery_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM factory_run_finalization_recovery WHERE run_id = ?1",
            [&run_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        recovery_rows, 0,
        "snapshot replay must consume the recovery record"
    );
    let foreign_status: String = connection
        .query_row(
            "SELECT status FROM factory_runs WHERE id = ?1",
            [&foreign_run_id],
            |row| row.get(0),
        )
        .unwrap();
    let foreign_recovery_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM factory_run_finalization_recovery WHERE run_id = ?1",
            [&foreign_run_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(foreign_status, "running");
    assert_eq!(
        foreign_recovery_rows, 1,
        "sibling scope recovery stays pending"
    );
    drop(connection);

    let sibling_snapshot = store_snapshot(&path, &foreign_run_id, &sibling_scope, 0).unwrap();
    assert_eq!(sibling_snapshot.run.status, FactoryRunStatus::Done);
}

#[test]
fn finalization_recovery_write_failure_propagates_and_retains_control() {
    let runtime = FactoryRuntime::default();
    let scope = test_scope();
    runtime.activate_scope(Some(scope.clone())).unwrap();
    cache_scope_memberships(&runtime, &scope, Instant::now() + FACTORY_MEMBERSHIP_TTL);
    runtime.register("run-recovery-error", scope).unwrap();

    let result = finish_run_result_with(
        "run-recovery-error",
        &runtime.controls,
        Err("injected durable recovery write failure".to_string()),
        |_| {},
    );

    assert_eq!(
        result.unwrap_err(),
        "injected durable recovery write failure"
    );
    assert!(runtime.control("run-recovery-error").unwrap().is_some());
}
