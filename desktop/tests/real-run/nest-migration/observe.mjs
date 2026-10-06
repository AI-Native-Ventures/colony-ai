// Observation helpers: take a full snapshot of a HOME (manifest, databases, small text files) and read the
// migration's own durable records. Everything here only reads.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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
 * Read the migration's journal and sentinel from the first declared path that exists. Returns
 * `{ journal, sentinel }` where each is `{ path, text, lines }` or null.
 */
export async function readMigrationRecords(home, contract = defaultContract()) {
  const read = async (candidates) => {
    for (const relative of candidates) {
      try {
        const text = (await readFile(path.join(home, relative), "utf8")).slice(
          0,
          RECORD_LIMIT,
        );
        return {
          path: relative,
          text,
          lines: text.split("\n").filter(Boolean).length,
        };
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  };
  return {
    journal: await read(contract.journalPaths),
    sentinel: await read(contract.sentinelPaths),
  };
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
