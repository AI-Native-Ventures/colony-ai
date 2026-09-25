//! SQLite persistence, idempotency, retention, and storage bounds for Factory runs.

use std::{fs, path::Path, sync::OnceLock, time::Duration};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use super::*;

pub(super) fn open_store(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create Factory data directory: {error}"))?;
        #[cfg(unix)]
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("failed to protect Factory data directory: {error}"))?;
    }
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to protect Factory database: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    let page_size: i64 = connection
        .pragma_query_value(None, "page_size", |row| row.get(0))
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(
            None,
            "max_page_count",
            (MAX_FACTORY_STORAGE_BYTES / page_size.max(1)).max(1),
        )
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_size_limit", 4 * 1024 * 1024_i64)
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "wal_autocheckpoint", 512_i64)
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| error.to_string())?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS factory_runs (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                repository_id TEXT,
                checkout_path TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                harness_id TEXT NOT NULL,
                parent_run_id TEXT REFERENCES factory_runs(id),
                status TEXT NOT NULL CHECK (status IN ('queued','running','waiting','blocked','error','done','cancelled')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                acp_session_id TEXT,
                error TEXT,
                operation_key TEXT,
                request_hash TEXT
            );
            CREATE INDEX IF NOT EXISTS factory_runs_updated ON factory_runs(updated_at DESC);
            CREATE INDEX IF NOT EXISTS factory_runs_parent ON factory_runs(parent_run_id);
            CREATE TABLE IF NOT EXISTS factory_run_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL REFERENCES factory_runs(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS factory_run_events_cursor ON factory_run_events(run_id, sequence);
            CREATE TABLE IF NOT EXISTS factory_run_drafts (
                run_id TEXT PRIMARY KEY REFERENCES factory_runs(id) ON DELETE CASCADE,
                draft TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS factory_runtime_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|error| error.to_string())?;
    let mut columns = connection
        .prepare("PRAGMA table_info(factory_runs)")
        .map_err(|error| error.to_string())?;
    let column_names = columns
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    drop(columns);
    if !column_names.iter().any(|column| column == "operation_key") {
        connection
            .execute_batch("ALTER TABLE factory_runs ADD COLUMN operation_key TEXT")
            .map_err(|error| error.to_string())?;
    }
    if !column_names.iter().any(|column| column == "request_hash") {
        connection
            .execute_batch("ALTER TABLE factory_runs ADD COLUMN request_hash TEXT")
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS factory_runs_operation_key
             ON factory_runs(operation_key) WHERE operation_key IS NOT NULL;",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn raw_run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRun> {
    Ok(RawRun {
        id: row.get(0)?,
        project_id: row.get(1)?,
        repository_id: row.get(2)?,
        checkout_path: row.get(3)?,
        agent_id: row.get(4)?,
        harness_id: row.get(5)?,
        parent_run_id: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        acp_session_id: row.get(10)?,
        error: row.get(11)?,
    })
}

const RUN_COLUMNS: &str = "id, project_id, repository_id, checkout_path, agent_id, harness_id, parent_run_id, status, created_at, updated_at, acp_session_id, error";

pub(super) fn stored_payload_bytes(tx: &Transaction<'_>) -> Result<i64, String> {
    tx.query_row(
        "SELECT
            (SELECT COALESCE(SUM(length(CAST(kind AS BLOB)) + length(CAST(payload_json AS BLOB)) + ?1), 0)
             FROM factory_run_events)
            + (SELECT COALESCE(SUM(length(CAST(draft AS BLOB))), 0) FROM factory_run_drafts)
            + (SELECT COUNT(*) * ?2 FROM factory_runs)",
        params![EVENT_STORAGE_OVERHEAD_BYTES, RUN_STORAGE_OVERHEAD_BYTES],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

pub(super) fn ensure_storage_capacity(
    used_bytes: i64,
    added_bytes: i64,
    limit_bytes: i64,
) -> Result<(), String> {
    if used_bytes.saturating_add(added_bytes) > limit_bytes {
        Err("Factory runtime storage quota reached".to_string())
    } else {
        Ok(())
    }
}

pub(super) fn create_request_hash(
    project_id: Option<&str>,
    repository_id: Option<&str>,
    checkout_path: &str,
    agent_id: &str,
    parent_run_id: Option<&str>,
    prompt: &str,
) -> Result<String, String> {
    let canonical = serde_json::to_vec(&(
        project_id,
        repository_id,
        checkout_path,
        agent_id,
        parent_run_id,
        prompt,
    ))
    .map_err(|error| error.to_string())?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

pub(super) fn prune_terminal_history(
    tx: &Transaction<'_>,
    protected_run_id: Option<&str>,
    retained_terminal_runs: i64,
) -> Result<(), String> {
    loop {
        let terminal_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM factory_runs WHERE status IN ('error','done','cancelled')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if terminal_count <= retained_terminal_runs {
            return Ok(());
        }
        let candidate: Option<String> = tx
            .query_row(
                "SELECT run.id FROM factory_runs AS run
                 WHERE run.status IN ('error','done','cancelled')
                   AND (?1 IS NULL OR run.id <> ?1)
                   AND NOT EXISTS (
                       SELECT 1 FROM factory_runs AS child WHERE child.parent_run_id = run.id
                   )
                 ORDER BY run.updated_at ASC, run.created_at ASC
                 LIMIT 1",
                [protected_run_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let Some(run_id) = candidate else {
            return Ok(());
        };
        tx.execute("DELETE FROM factory_runs WHERE id = ?1", [run_id])
            .map_err(|error| error.to_string())?;
    }
}

pub(super) fn read_run(connection: &Connection, run_id: &str) -> Result<FactoryRun, String> {
    let sql = format!("SELECT {RUN_COLUMNS} FROM factory_runs WHERE id = ?1");
    let raw = connection
        .query_row(&sql, [run_id], raw_run_from_row)
        .map_err(|error| error.to_string())?;
    FactoryRun::try_from(raw)
}

pub(super) fn read_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<FactoryRunEvent> {
    let payload: String = row.get(4)?;
    let payload = serde_json::from_str(&payload).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(FactoryRunEvent {
        sequence: row.get(0)?,
        run_id: row.get(1)?,
        created_at: row.get(2)?,
        kind: row.get(3)?,
        payload,
    })
}

pub(super) fn insert_event(
    tx: &Transaction<'_>,
    run_id: &str,
    kind: &str,
    payload: &serde_json::Value,
    bounded: bool,
) -> Result<Option<FactoryRunEvent>, String> {
    let storage_limit_bytes = if matches!(kind, "status" | "transcript_capture_error") {
        MAX_FACTORY_STORAGE_BYTES
    } else {
        MAX_FACTORY_PAYLOAD_BYTES
    };
    insert_event_with_storage_limit(tx, run_id, kind, payload, bounded, storage_limit_bytes)
}

pub(super) fn insert_event_with_storage_limit(
    tx: &Transaction<'_>,
    run_id: &str,
    kind: &str,
    payload: &serde_json::Value,
    bounded: bool,
    storage_limit_bytes: i64,
) -> Result<Option<FactoryRunEvent>, String> {
    let mut payload_json = serde_json::to_string(payload).map_err(|error| error.to_string())?;
    let total: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB)) + length(CAST(kind AS BLOB)) + ?2), 0) FROM factory_run_events WHERE run_id = ?1",
            params![run_id, EVENT_STORAGE_OVERHEAD_BYTES],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let event_size = payload_json.len() as i64 + kind.len() as i64 + EVENT_STORAGE_OVERHEAD_BYTES;
    ensure_storage_capacity(stored_payload_bytes(tx)?, event_size, storage_limit_bytes)?;
    if bounded && total + event_size > MAX_TRANSCRIPT_BYTES {
        let already_truncated: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM factory_run_events WHERE run_id = ?1 AND kind = 'transcript_truncated')",
                [run_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if already_truncated {
            return Ok(None);
        }
        payload_json = "{\"reason\":\"per-run transcript limit reached\"}".to_string();
        return insert_event_with_storage_limit(
            tx,
            run_id,
            "transcript_truncated",
            &serde_json::from_str(&payload_json).map_err(|error| error.to_string())?,
            false,
            storage_limit_bytes,
        );
    }
    let created_at = now_iso();
    tx.execute(
        "INSERT INTO factory_run_events (run_id, created_at, kind, payload_json) VALUES (?1, ?2, ?3, ?4)",
        params![run_id, created_at, kind, payload_json],
    )
    .map_err(|error| error.to_string())?;
    Ok(Some(FactoryRunEvent {
        sequence: tx.last_insert_rowid(),
        run_id: run_id.to_string(),
        created_at,
        kind: kind.to_string(),
        payload: payload.clone(),
    }))
}

pub(super) fn current_host_id() -> &'static str {
    static HOST_ID: OnceLock<String> = OnceLock::new();
    HOST_ID.get_or_init(|| Uuid::new_v4().to_string())
}

pub(super) fn recover_store(path: &Path, host_id: &str) -> Result<(), String> {
    let mut connection = open_store(path)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let previous_host: Option<String> = tx
        .query_row(
            "SELECT value FROM factory_runtime_meta WHERE key = 'host_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if previous_host
        .as_deref()
        .is_some_and(|value| value != host_id)
    {
        let mut statement = tx
            .prepare(&format!("SELECT {RUN_COLUMNS} FROM factory_runs WHERE status IN ('queued','running','waiting')"))
            .map_err(|error| error.to_string())?;
        let raws = statement
            .query_map([], raw_run_from_row)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(statement);
        for raw in raws {
            let run_id = raw.id.clone();
            let run_status = FactoryRunStatus::Blocked;
            let explanation = "Native host restarted before this run settled. Its saved transcript is available; start a new run to continue.";
            tx.execute(
                "UPDATE factory_runs SET status = ?2, updated_at = ?3, error = ?4 WHERE id = ?1",
                params![run_id, run_status.as_str(), now_iso(), explanation],
            )
            .map_err(|error| error.to_string())?;
            let event = insert_event(
                &tx,
                &run_id,
                "status",
                &serde_json::json!({ "status": run_status, "reason": explanation }),
                false,
            )?;
            let _ = event;
        }
    }
    tx.execute(
        "INSERT INTO factory_runtime_meta (key, value) VALUES ('host_id', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [host_id],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

pub(super) fn ensure_recovered(path: &Path) -> Result<(), String> {
    recover_store(path, current_host_id())
}

pub(super) struct StoreCreateResult {
    pub(super) run: FactoryRun,
    pub(super) events: Vec<FactoryRunEvent>,
    pub(super) is_new: bool,
}

pub(super) fn schedule_new_store_create<F>(
    created: StoreCreateResult,
    schedule: F,
) -> Result<FactoryRun, String>
where
    F: FnOnce(&FactoryRun, Vec<FactoryRunEvent>) -> Result<(), String>,
{
    if created.is_new {
        schedule(&created.run, created.events)?;
    }
    Ok(created.run)
}

pub(super) fn store_find_operation(
    path: &Path,
    operation_key: &str,
    request_hash: &str,
) -> Result<Option<FactoryRun>, String> {
    let connection = open_store(path)?;
    let existing: Option<(String, Option<String>)> = connection
        .query_row(
            "SELECT id, request_hash FROM factory_runs WHERE operation_key = ?1",
            [operation_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some((run_id, existing_hash)) = existing else {
        return Ok(None);
    };
    if existing_hash.as_deref() != Some(request_hash) {
        return Err("Factory operation key was reused with a different request".to_string());
    }
    read_run(&connection, &run_id).map(Some)
}

pub(super) fn store_create(
    path: &Path,
    run_id: &str,
    operation_key: &str,
    request_hash: &str,
    project_id: Option<&str>,
    repository_id: Option<&str>,
    checkout_path: &str,
    agent_id: &str,
    harness_id: &str,
    parent_run_id: Option<&str>,
    prompt: &str,
) -> Result<StoreCreateResult, String> {
    let mut connection = open_store(path)?;
    let tx = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let existing: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT id, request_hash FROM factory_runs WHERE operation_key = ?1",
            [operation_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some((existing_run_id, existing_hash)) = existing {
        if existing_hash.as_deref() != Some(request_hash) {
            return Err("Factory operation key was reused with a different request".to_string());
        }
        let run = read_run(&tx, &existing_run_id)?;
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(StoreCreateResult {
            run,
            events: Vec::new(),
            is_new: false,
        });
    }
    prune_terminal_history(&tx, parent_run_id, MAX_RETAINED_TERMINAL_RUNS)?;
    let stored_runs: i64 = tx
        .query_row("SELECT COUNT(*) FROM factory_runs", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if stored_runs >= MAX_STORED_RUNS {
        return Err(
            "Factory run history is full; remove archived work before creating another run"
                .to_string(),
        );
    }
    let pending: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM factory_runs WHERE status IN ('queued','running','waiting')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if pending >= (MAX_CONCURRENT_SESSIONS as i64 + MAX_QUEUED_RUNS) {
        return Err("Factory run queue is full".to_string());
    }
    if let Some(parent) = parent_run_id {
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM factory_runs WHERE id = ?1)",
                [parent],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !exists {
            return Err("parent Factory run was not found".to_string());
        }
    }
    let now = now_iso();
    tx.execute(
        "INSERT INTO factory_runs (id, project_id, repository_id, checkout_path, agent_id, harness_id, parent_run_id, status, created_at, updated_at, operation_key, request_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?8, ?9, ?10)",
        params![run_id, project_id, repository_id, checkout_path, agent_id, harness_id, parent_run_id, now, operation_key, request_hash],
    )
    .map_err(|error| error.to_string())?;
    let prompt_event = insert_event(
        &tx,
        run_id,
        "user_prompt",
        &serde_json::json!({ "text": prompt }),
        true,
    )?
    .ok_or_else(|| "Factory prompt exceeded the transcript limit".to_string())?;
    let run = FactoryRun {
        id: run_id.to_string(),
        project_id: project_id.map(str::to_string),
        repository_id: repository_id.map(str::to_string),
        checkout_path: checkout_path.to_string(),
        agent_id: agent_id.to_string(),
        harness_id: harness_id.to_string(),
        parent_run_id: parent_run_id.map(str::to_string),
        status: FactoryRunStatus::Queued,
        created_at: now.clone(),
        updated_at: now,
        acp_session_id: None,
        error: None,
    };
    tx.commit().map_err(|error| error.to_string())?;
    Ok(StoreCreateResult {
        run,
        events: vec![prompt_event],
        is_new: true,
    })
}

pub(super) fn store_list(path: &Path) -> Result<Vec<FactoryRun>, String> {
    let connection = open_store(path)?;
    let sql = format!("SELECT {RUN_COLUMNS} FROM factory_runs ORDER BY updated_at DESC LIMIT 200");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], raw_run_from_row)
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let raw = row.map_err(|error| error.to_string())?;
        FactoryRun::try_from(raw)
    })
    .collect()
}

pub(super) fn store_snapshot(
    path: &Path,
    run_id: &str,
    after_sequence: i64,
) -> Result<FactoryRunSnapshot, String> {
    let connection = open_store(path)?;
    let run = read_run(&connection, run_id)?;
    let mut statement = connection
        .prepare("SELECT sequence, run_id, created_at, kind, payload_json FROM factory_run_events WHERE run_id = ?1 AND sequence > ?2 ORDER BY sequence ASC LIMIT ?3")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![run_id, after_sequence.max(0), MAX_EVENTS_PER_SNAPSHOT],
            read_event,
        )
        .map_err(|error| error.to_string())?;
    let events = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let last_sequence = events
        .last()
        .map(|event| event.sequence)
        .unwrap_or(after_sequence.max(0));
    let has_more = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM factory_run_events WHERE run_id = ?1 AND sequence > ?2)",
            params![run_id, last_sequence],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let draft = connection
        .query_row(
            "SELECT draft FROM factory_run_drafts WHERE run_id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    Ok(FactoryRunSnapshot {
        run,
        events,
        draft,
        has_more,
    })
}

pub(super) fn store_append_event(
    path: &Path,
    run_id: &str,
    kind: &str,
    payload: &serde_json::Value,
) -> Result<Option<FactoryRunEvent>, String> {
    store_append_event_with_storage_limit(path, run_id, kind, payload, MAX_FACTORY_PAYLOAD_BYTES)
}

pub(super) fn store_append_event_with_storage_limit(
    path: &Path,
    run_id: &str,
    kind: &str,
    payload: &serde_json::Value,
    storage_limit_bytes: i64,
) -> Result<Option<FactoryRunEvent>, String> {
    let mut connection = open_store(path)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let status: String = tx
        .query_row(
            "SELECT status FROM factory_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let status = FactoryRunStatus::parse(&status)?;
    if status.is_terminal() || status == FactoryRunStatus::Blocked {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    let event =
        insert_event_with_storage_limit(&tx, run_id, kind, payload, true, storage_limit_bytes)?;
    if event.is_some() {
        tx.execute(
            "UPDATE factory_runs SET updated_at = ?2 WHERE id = ?1",
            params![run_id, now_iso()],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(event)
}

pub(super) fn store_append_capture_marker(
    path: &Path,
    run_id: &str,
    reason: &str,
) -> Result<Option<FactoryRunEvent>, String> {
    let mut connection = open_store(path)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM factory_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(status) = status else {
        return Err("Factory run was not found".to_string());
    };
    if FactoryRunStatus::parse(&status)?.is_terminal() {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    let event = insert_event(
        &tx,
        run_id,
        "transcript_capture_error",
        &serde_json::json!({ "reason": reason }),
        false,
    )?;
    if event.is_some() {
        tx.execute(
            "UPDATE factory_runs SET updated_at = ?2 WHERE id = ?1",
            params![run_id, now_iso()],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(event)
}

pub(super) fn store_set_acp_session(
    path: &Path,
    run_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let connection = open_store(path)?;
    connection
        .execute(
            "UPDATE factory_runs SET acp_session_id = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('running','waiting')",
            params![run_id, session_id, now_iso()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn store_transition(
    path: &Path,
    run_id: &str,
    expected: Option<FactoryRunStatus>,
    next: FactoryRunStatus,
    error: Option<&str>,
) -> Result<Option<(FactoryRun, FactoryRunEvent)>, String> {
    let mut connection = open_store(path)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let current: String = tx
        .query_row(
            "SELECT status FROM factory_runs WHERE id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let current = FactoryRunStatus::parse(&current)?;
    if current.is_terminal() || current == FactoryRunStatus::Blocked {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    if expected.is_some_and(|value| current != value) {
        tx.commit().map_err(|error| error.to_string())?;
        return Ok(None);
    }
    let updated_at = now_iso();
    tx.execute(
        "UPDATE factory_runs SET status = ?2, updated_at = ?3, error = ?4 WHERE id = ?1",
        params![run_id, next.as_str(), updated_at, error],
    )
    .map_err(|error| error.to_string())?;
    let event = insert_event(
        &tx,
        run_id,
        "status",
        &serde_json::json!({ "status": next, "error": error }),
        false,
    )?
    .ok_or_else(|| "failed to persist Factory status event".to_string())?;
    if next.is_terminal() {
        prune_terminal_history(&tx, Some(run_id), MAX_RETAINED_TERMINAL_RUNS)?;
    }
    let run = read_run(&tx, run_id)?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(Some((run, event)))
}

pub(super) fn store_set_draft(
    path: &Path,
    run_id: &str,
    draft: &str,
) -> Result<FactoryRunDraft, String> {
    store_set_draft_with_storage_limit(path, run_id, draft, MAX_FACTORY_PAYLOAD_BYTES)
}

pub(super) fn store_set_draft_with_storage_limit(
    path: &Path,
    run_id: &str,
    draft: &str,
    storage_limit_bytes: i64,
) -> Result<FactoryRunDraft, String> {
    if draft.len() > MAX_DRAFT_BYTES {
        return Err("Factory run draft exceeds 1 MiB".to_string());
    }
    let mut connection = open_store(path)?;
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM factory_runs WHERE id = ?1)",
            [run_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("Factory run was not found".to_string());
    }
    let previous_draft_bytes: Option<i64> = tx
        .query_row(
            "SELECT length(CAST(draft AS BLOB)) FROM factory_run_drafts WHERE run_id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let projected_bytes =
        stored_payload_bytes(&tx)? - previous_draft_bytes.unwrap_or(0) + draft.len() as i64;
    ensure_storage_capacity(projected_bytes, 0, storage_limit_bytes)?;
    let updated_at = now_iso();
    tx
        .execute(
            "INSERT INTO factory_run_drafts (run_id, draft, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(run_id) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at",
            params![run_id, draft, updated_at],
        )
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(FactoryRunDraft {
        run_id: run_id.to_string(),
        draft: draft.to_string(),
        updated_at,
    })
}

pub(super) fn store_get_draft(
    path: &Path,
    run_id: &str,
) -> Result<Option<FactoryRunDraft>, String> {
    let connection = open_store(path)?;
    connection
        .query_row(
            "SELECT run_id, draft, updated_at FROM factory_run_drafts WHERE run_id = ?1",
            [run_id],
            |row| {
                Ok(FactoryRunDraft {
                    run_id: row.get(0)?,
                    draft: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}
