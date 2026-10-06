// Observation helpers: take a full snapshot of a HOME (manifest, databases, small text files) and read the
// migration's own durable records. Everything here only reads.
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { defaultContract } from "./contract.mjs";
import { attachDatabases, buildManifest } from "./manifest.mjs";

const run = promisify(execFile);
const RECORD_LIMIT = 256 * 1024;

/** Read small text files named by `paths` (relative to home) into `manifest.files`. Missing files are skipped. */
export async function attachFiles(manifest, paths) {
  const files = {};
  for (const relative of paths) {
    try {
      files[relative] = await readFile(
        path.join(manifest.home, relative),
        "utf8",
      );
    } catch {
      /* absent */
    }
  }
  return { ...manifest, files };
}

/** One full snapshot: the entries under `roots`, the database reads and the small files. */
export async function snapshot({
  home,
  roots = [".buzz", ".colony", ".colony.staging"],
  databases = [".buzz/archive/archive.db", ".colony/archive/archive.db"],
  files = [
    ".buzz/.repos-dir",
    ".colony/.repos-dir",
    ".buzz/AGENTS.md",
    ".colony/AGENTS.md",
  ],
}) {
  let manifest = await buildManifest(home, roots);
  manifest = await attachDatabases(manifest, databases);
  return attachFiles(manifest, files);
}

/**
 * Read the migration's durable records: `<app data>/nest-migration/journal.json` and `notice.json`. The host's
 * app-data folder is named after its identifier (profile scoped under Electron), so every folder under
 * `HOME/Library/Application Support` is searched. Returns `{ journal, notice }`, each
 * `{ path, text, json, lines }` or null.
 */
export async function readMigrationRecords(home, contract = defaultContract()) {
  const support = path.join(home, "Library", "Application Support");
  let folders = [];
  try {
    folders = (await readdir(support, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { journal: null, notice: null };
  }
  const read = async (file) => {
    for (const folder of folders) {
      const relative = path.join(
        "Library",
        "Application Support",
        folder,
        contract.stateDir,
        file,
      );
      try {
        const text = (await readFile(path.join(home, relative), "utf8")).slice(
          0,
          RECORD_LIMIT,
        );
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* kept as text */
        }
        return {
          path: relative,
          text,
          json,
          lines: text.split("\n").filter(Boolean).length,
        };
      } catch {
        /* try the next folder */
      }
    }
    return null;
  };
  return {
    journal: await read("journal.json"),
    notice: await read("notice.json"),
  };
}

/**
 * Parse the migration's result lines from a host log. Returns every line as
 * `{ outcome, moved, skipped, detail }` in order, so a launch's last line is the last element.
 */
export function parseMigrationLines(lines, contract = defaultContract()) {
  const found = [];
  for (const line of lines) {
    const at = line.indexOf(contract.migrationLogPrefix);
    if (at < 0) continue;
    const match = /outcome=(\S+) moved=(\d+) skipped=(\d+) detail=(.*)$/u.exec(
      line.slice(at),
    );
    if (match)
      found.push({
        outcome: match[1],
        moved: Number(match[2]),
        skipped: Number(match[3]),
        detail: match[4].trim(),
      });
  }
  return found;
}

/** Run each foreign script by its absolute path and record the exit status and output. */
export async function runForeignScripts(home, relativeScripts) {
  const results = [];
  for (const relative of relativeScripts) {
    const script = path.join(home, relative);
    try {
      const { stdout } = await run(script, [], { timeout: 10000 });
      results.push({ path: relative, ok: true, stdout: stdout.trim() });
    } catch (error) {
      results.push({
        path: relative,
        ok: false,
        stdout: String(error.message).slice(0, 200),
      });
    }
  }
  return results;
}
