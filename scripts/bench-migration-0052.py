#!/usr/bin/env python3
"""Measure migration 0052 against disposable local or CI PostgreSQL data."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations/0052_company_records_fts_exclusion.sql"
ROW_COUNTS = (10_000, 100_000, 1_000_000)
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "host.docker.internal"}


def connection_environment() -> dict[str, str]:
    raw_url = os.environ.get("MIGRATION_BENCH_DATABASE_URL", "")
    if not raw_url:
        raise SystemExit("Set MIGRATION_BENCH_DATABASE_URL to a disposable local or CI database.")

    parsed = urlsplit(raw_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise SystemExit("MIGRATION_BENCH_DATABASE_URL must use postgres or postgresql.")
    if parsed.hostname not in ALLOWED_HOSTS:
        raise SystemExit("Refusing a non-local host; this harness cannot target a Fly app or production database.")
    if not parsed.path or not parsed.path.lstrip("/"):
        raise SystemExit("MIGRATION_BENCH_DATABASE_URL must include a database name.")

    env = os.environ.copy()
    for key in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGPASSWORD"):
        env.pop(key, None)
    env["PGHOST"] = parsed.hostname
    env["PGPORT"] = str(parsed.port or 5432)
    env["PGDATABASE"] = unquote(parsed.path.lstrip("/"))
    if parsed.username:
        env["PGUSER"] = unquote(parsed.username)
    if parsed.password is not None:
        env["PGPASSWORD"] = unquote(parsed.password)

    options = parse_qs(parsed.query, keep_blank_values=True)
    query_mapping = {
        "sslmode": "PGSSLMODE",
        "sslrootcert": "PGSSLROOTCERT",
        "sslcert": "PGSSLCERT",
        "sslkey": "PGSSLKEY",
        "connect_timeout": "PGCONNECT_TIMEOUT",
        "target_session_attrs": "PGTARGETSESSIONATTRS",
        "channel_binding": "PGCHANNELBINDING",
    }
    for key, env_key in query_mapping.items():
        values = options.get(key, [])
        if len(values) > 1:
            raise SystemExit(f"MIGRATION_BENCH_DATABASE_URL repeats {key}.")
        if values:
            env[env_key] = values[0]
    return env


def psql(sql: str, env: dict[str, str], *, app_name: str = "migration-0052-bench") -> str:
    call_env = env.copy()
    call_env["PGAPPNAME"] = app_name
    result = subprocess.run(
        ["psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align"],
        input=sql,
        text=True,
        capture_output=True,
        env=call_env,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"psql exited with status {result.returncode}: {result.stderr.strip()[:1200]}"
        )
    return result.stdout.strip()


def setup_sql(row_count: int) -> str:
    partitions = []
    for month in range(1, 13):
        start = f"2026-{month:02d}-01"
        if month == 12:
            end = "2027-01-01"
        else:
            end = f"2026-{month + 1:02d}-01"
        partitions.append(
            f"CREATE TABLE events_2026_{month:02d} PARTITION OF events "
            f"FOR VALUES FROM ('{start}') TO ('{end}');"
        )

    return f"""
SET synchronous_commit = off;
CREATE TABLE events (
    community_id UUID NOT NULL,
    id BYTEA NOT NULL,
    pubkey BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    kind INT NOT NULL,
    tags JSONB NOT NULL,
    content TEXT NOT NULL,
    search_tsv TSVECTOR GENERATED ALWAYS AS (
        CASE WHEN kind = 30179 THEN NULL::tsvector
        ELSE CASE WHEN kind = 30350 THEN NULL::tsvector
        ELSE CASE WHEN kind IN (1059, 30300, 30622, 44100, 44101)
            THEN NULL::tsvector
            ELSE to_tsvector('simple', content)
        END END END
    ) STORED,
    sig BYTEA NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    channel_id UUID,
    deleted_at TIMESTAMPTZ,
    d_tag TEXT,
    not_before BIGINT,
    delivered_at BIGINT,
    PRIMARY KEY (community_id, created_at, id)
) PARTITION BY RANGE (created_at);
{os.linesep.join(partitions)}
CREATE TABLE bench_lock_windows (
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL
);

INSERT INTO events (
    community_id, id, pubkey, created_at, kind, tags, content, sig,
    received_at, channel_id, deleted_at, d_tag, not_before, delivered_at
)
SELECT
    md5('community:' || ((g % 25) + 1)::text)::uuid,
    decode(md5('event-a:' || g::text) || md5('event-b:' || g::text), 'hex'),
    decode(md5('pubkey-a:' || (g % 1000)::text) || md5('pubkey-b:' || (g % 1000)::text), 'hex'),
    TIMESTAMPTZ '2026-01-01' + (g % 330) * INTERVAL '1 day',
    CASE WHEN g % 1000 = 0 THEN 30642 ELSE 1 END,
    jsonb_build_array(jsonb_build_array('t', (g % 100)::text)),
    repeat('Colony searchable event content and product discussion ', 2)
        || g::text || ' ' || md5(g::text),
    decode(
        md5('sig-a:' || g::text) || md5('sig-b:' || g::text)
        || md5('sig-c:' || g::text) || md5('sig-d:' || g::text), 'hex'
    ),
    TIMESTAMPTZ '2026-01-01' + (g % 330) * INTERVAL '1 day',
    md5('channel:' || (g % 100)::text)::uuid,
    NULL,
    NULL,
    NULL,
    NULL
FROM generate_series(1, {row_count}) AS rows(g);

CREATE INDEX idx_events_community_id ON events (community_id, id, created_at DESC);
CREATE INDEX idx_events_community_channel_created
    ON events (community_id, channel_id, created_at DESC, id);
CREATE INDEX idx_events_community_pubkey_kind_created
    ON events (community_id, pubkey, kind, created_at DESC, id);
CREATE INDEX idx_events_community_kind_created
    ON events (community_id, kind, created_at DESC, id);
CREATE INDEX idx_events_community_deleted ON events (community_id, deleted_at);
CREATE INDEX idx_events_addressable
    ON events (community_id, kind, pubkey, channel_id, deleted_at);
CREATE INDEX idx_events_parameterized
    ON events (community_id, kind, pubkey, d_tag, created_at DESC, id)
    WHERE d_tag IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_events_not_before ON events (community_id, not_before)
    WHERE not_before IS NOT NULL AND deleted_at IS NULL AND delivered_at IS NULL;
CREATE INDEX idx_events_search_tsv ON events USING GIN (search_tsv);
ANALYZE events;
"""


LOCK_MONITOR_SQL = """
DO $$
DECLARE
    monitor_deadline TIMESTAMPTZ := clock_timestamp() + INTERVAL '15 minutes';
    lock_started TIMESTAMPTZ;
    lock_finished TIMESTAMPTZ;
    is_locked BOOLEAN;
BEGIN
    LOOP
        SELECT EXISTS (
            SELECT 1
              FROM pg_locks
             WHERE relation = 'events'::regclass
               AND mode = 'AccessExclusiveLock'
               AND granted
        ) INTO is_locked;

        IF is_locked AND lock_started IS NULL THEN
            lock_started := clock_timestamp();
        ELSIF NOT is_locked AND lock_started IS NOT NULL THEN
            lock_finished := clock_timestamp();
            EXIT;
        END IF;

        IF clock_timestamp() > monitor_deadline THEN
            RAISE EXCEPTION 'timed out waiting for the migration lock window to finish';
        END IF;
        PERFORM pg_sleep(0.002);
    END LOOP;

    INSERT INTO bench_lock_windows (started_at, finished_at)
    VALUES (lock_started, lock_finished);
END $$;
"""


def verify_sql(row_count: int) -> str:
    return f"""
DO $$
BEGIN
    IF (SELECT count(*) FROM events) <> {row_count} THEN
        RAISE EXCEPTION 'event row count changed during migration';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE kind = 30642 AND search_tsv IS NULL) THEN
        RAISE EXCEPTION 'company event content is still searchable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM events WHERE kind = 1 AND search_tsv IS NOT NULL) THEN
        RAISE EXCEPTION 'ordinary event content lost its search vector';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_index
         WHERE indexrelid = 'idx_events_search_tsv'::regclass
           AND indisvalid
    ) THEN
        RAISE EXCEPTION 'search GIN index is missing or invalid';
    END IF;
END $$;
SELECT round(extract(epoch FROM finished_at - started_at) * 1000)::bigint
  FROM bench_lock_windows;
"""


def run_size(row_count: int, env: dict[str, str]) -> tuple[float, int]:
    schema = f"migration_0052_bench_{row_count}_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    if not re.fullmatch(r"[a-z0-9_]+", schema):
        raise RuntimeError("generated schema name failed validation")
    psql(f'CREATE SCHEMA "{schema}";', env)

    schema_env = env.copy()
    schema_env["PGOPTIONS"] = f"-c search_path={schema},public"
    try:
        psql(setup_sql(row_count), schema_env)
        monitor_name = f"migration-0052-lock-monitor-{row_count}"
        monitor_env = schema_env.copy()
        monitor_env["PGAPPNAME"] = monitor_name
        monitor = subprocess.Popen(
            [
                "psql",
                "--no-psqlrc",
                "--set=ON_ERROR_STOP=1",
                "--tuples-only",
                "--no-align",
                "--command",
                LOCK_MONITOR_SQL,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=monitor_env,
        )

        ready_deadline = time.monotonic() + 10
        while time.monotonic() < ready_deadline:
            if monitor.poll() is not None:
                _, monitor_error = monitor.communicate()
                raise RuntimeError(f"lock monitor exited early: {monitor_error.strip()[:1200]}")
            active = psql(
                "SELECT count(*) FROM pg_stat_activity "
                f"WHERE application_name = '{monitor_name}';",
                env,
                app_name="migration-0052-bench-readiness",
            )
            if active == "1":
                break
            time.sleep(0.05)
        else:
            monitor.kill()
            monitor.communicate()
            raise RuntimeError("lock monitor did not become ready")

        migration_env = schema_env.copy()
        migration_env["PGAPPNAME"] = f"migration-0052-run-{row_count}"
        started = time.perf_counter()
        migration_result = subprocess.run(
            ["psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--file", str(MIGRATION)],
            text=True,
            capture_output=True,
            env=migration_env,
            check=False,
            timeout=15 * 60,
        )
        elapsed_seconds = time.perf_counter() - started
        if migration_result.returncode != 0:
            raise RuntimeError(
                f"migration 0052 failed for {row_count} rows: "
                f"{migration_result.stderr.strip()[:1200]}"
            )

        try:
            monitor_output, monitor_error = monitor.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            monitor.kill()
            monitor_output, monitor_error = monitor.communicate()
            raise RuntimeError("lock monitor did not observe the end of the ACCESS EXCLUSIVE window")
        if monitor.returncode != 0:
            raise RuntimeError(f"lock monitor failed: {monitor_error.strip()[:1200]}")
        if not monitor_output.strip():
            raise RuntimeError("lock monitor did not record an ACCESS EXCLUSIVE window")

        observed_lock_ms = int(psql(verify_sql(row_count), schema_env).splitlines()[-1])
        if observed_lock_ms <= 0:
            raise RuntimeError("measured ACCESS EXCLUSIVE window was not positive")
        return elapsed_seconds, observed_lock_ms
    finally:
        psql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE;', env)


def main() -> int:
    if not MIGRATION.is_file():
        raise SystemExit(f"Could not find migration file: {MIGRATION}")
    if shutil.which("psql") is None:
        raise SystemExit("psql must be installed to run this migration benchmark.")

    env = connection_environment()
    version = psql("SELECT current_setting('server_version');", env)
    rows = []
    for row_count in ROW_COUNTS:
        elapsed_seconds, lock_ms = run_size(row_count, env)
        rows.append((row_count, elapsed_seconds, lock_ms))

    report = [
        "### Migration 0052 synthetic benchmark",
        "",
        f"PostgreSQL version: `{version}`. The benchmark uses a disposable local or CI database and a partitioned synthetic `events` table.",
        "",
        "| Rows | Migration runtime | ACCESS EXCLUSIVE on `events` |",
        "| ---: | ---: | ---: |",
    ]
    report.extend(
        f"| {row_count:,} | {elapsed_seconds:.3f} s | {lock_ms / 1000:.3f} s |"
        for row_count, elapsed_seconds, lock_ms in rows
    )
    report.extend(
        [
            "",
            "The harness verifies the row count, company-kind exclusion, retained search vectors, and valid GIN index after the migration.",
            "",
        ]
    )
    rendered = "\n".join(report)
    print(rendered)
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write(rendered)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
