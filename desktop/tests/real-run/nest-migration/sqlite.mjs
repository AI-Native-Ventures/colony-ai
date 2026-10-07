// SQLite helpers for the proof harness, built on the sqlite3 command line tool (present on macOS and on the
// CI runners). Reading never touches the original: a database is copied (main file and -wal) into a private
// temp folder and counted there, because opening a WAL database in place can checkpoint it and delete the
// -wal and -shm files, which would change the very state being measured.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Genuine archived_events table, copied from desktop/src-tauri/src/archive/store.rs (SCHEMA). */
export const ARCHIVED_EVENTS_DDL = `CREATE TABLE IF NOT EXISTS archived_events (
    identity_pubkey TEXT NOT NULL,
    relay_url       TEXT NOT NULL,
    id              TEXT NOT NULL,
    kind            INTEGER NOT NULL,
    pubkey          TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    raw_json        TEXT NOT NULL,
    archived_at     INTEGER NOT NULL,
    PRIMARY KEY (identity_pubkey, relay_url, id)
);`;

async function sqlite(args) {
  try {
    const { stdout } = await execFileAsync("sqlite3", args, {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new Error(
      `sqlite3 ${args.join(" ").slice(0, 160)} failed: ${error.message}`,
    );
  }
}

/** True when the sqlite3 command line tool can run. */
export async function sqliteAvailable() {
  try {
    await execFileAsync("sqlite3", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a database without modifying it. Returns the row count and a hash of the sorted ids of `table`, plus
 * the integrity check result. `walBytes` and `shmPresent` describe the sidecar files next to the original.
 */
export async function readDatabase(dbPath, table = "archived_events") {
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  const info = {
    path: dbPath,
    walBytes: (await exists(walPath)) ? (await stat(walPath)).size : null,
    shmPresent: await exists(shmPath),
  };
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-db-"),
  );
  try {
    const copy = path.join(scratch, "copy.db");
    await copyFile(dbPath, copy);
    if (info.walBytes !== null) await copyFile(walPath, `${copy}-wal`);
    const count = Number(
      (await sqlite([copy, `SELECT COUNT(*) FROM ${table};`])).trim(),
    );
    const ids = (await sqlite([copy, `SELECT id FROM ${table} ORDER BY id;`]))
      .split("\n")
      .filter(Boolean);
    const integrity = (await sqlite([copy, "PRAGMA integrity_check;"])).trim();
    return {
      ...info,
      rows: count,
      idsSha256: createHash("sha256").update(ids.join("\n")).digest("hex"),
      ids,
      integrity,
    };
  } catch (error) {
    return { ...info, error: String(error.message ?? error) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Row count of the main database file alone, ignoring any -wal. Proves a WAL really carries rows. */
export async function readMainFileOnly(dbPath, table = "archived_events") {
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-db-"),
  );
  try {
    const copy = path.join(scratch, "copy.db");
    await copyFile(dbPath, copy);
    return Number(
      (await sqlite([copy, `SELECT COUNT(*) FROM ${table};`])).trim(),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Create a real SQLite database whose newest rows live only in the write-ahead log. A sqlite3 shell holds the
 * database open, writes `baseRows` and checkpoints them into the main file, writes `walRows` more with
 * automatic checkpointing off, then is killed with SIGKILL so it never checkpoints on close. The -wal and -shm
 * files stay on disk, exactly as after a crash of the app.
 */
export async function createWalDatabase({
  dbPath,
  readyMarker,
  baseRows,
  walRows,
  makeRow,
}) {
  const statements = [
    "PRAGMA journal_mode=WAL;",
    "PRAGMA wal_autocheckpoint=0;",
    ARCHIVED_EVENTS_DDL,
  ];
  const batch = (from, to) => {
    const lines = ["BEGIN;"];
    for (let index = from; index < to; index++) lines.push(makeRow(index));
    lines.push("COMMIT;");
    return lines;
  };
  statements.push(...batch(0, baseRows));
  statements.push("PRAGMA wal_checkpoint(TRUNCATE);");
  statements.push(...batch(baseRows, baseRows + walRows));
  statements.push(`.shell touch '${readyMarker.replace(/'/gu, "'\\''")}'`);

  const child = spawn("sqlite3", [dbPath], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let failure = "";
  child.stderr.on("data", (chunk) => {
    failure += chunk;
  });
  child.stdin.write(`${statements.join("\n")}\n`);
  // Keep stdin open: closing it would make the shell exit cleanly and checkpoint the WAL.
  const deadline = Date.now() + 20000;
  while (!(await exists(readyMarker))) {
    if (child.exitCode !== null || Date.now() > deadline)
      throw new Error(
        `sqlite3 did not reach the ready marker: ${failure.slice(0, 300)}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
}
