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
        StoreCreateRequest {
            scope: &test_scope(),
            run_id: &Uuid::new_v4().to_string(),
            operation_key: &operation_key,
            request_hash: &hash,
            project_id: Some("project-1"),
            repository_id: Some("repo-1"),
            checkout_path: &checkout,
            agent_id: "agent-1",
            harness_id: "codex",
            parent_run_id: None,
            prompt: "inspect repository",
        },
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
        StoreCreateRequest {
            scope: &test_scope(),
            run_id: &Uuid::new_v4().to_string(),
            operation_key: &operation_key,
            request_hash: &hash,
            project_id: Some("project-1"),
            repository_id: Some("repo-1"),
            checkout_path: &checkout,
            agent_id: "agent-1",
            harness_id: "codex",
            parent_run_id: None,
            prompt: "inspect repository",
        },
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
        StoreCreateRequest {
            scope: &test_scope(),
            run_id: &Uuid::new_v4().to_string(),
            operation_key: &operation_key,
            request_hash: &changed_payload_hash,
            project_id: Some("project-1"),
            repository_id: Some("repo-1"),
            checkout_path: &checkout,
            agent_id: "agent-1",
            harness_id: "codex",
            parent_run_id: None,
            prompt: "different task",
        },
    )
    .is_err());
}
