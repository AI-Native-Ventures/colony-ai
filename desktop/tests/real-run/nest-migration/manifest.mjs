// Manifest of a HOME tree: one record per entry, taken with lstat so a symlink is recorded as a symlink and
// never followed. A manifest taken before a run and one taken after are compared by diff.mjs.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { readDatabase } from "./sqlite.mjs";

/** Files larger than this are listed without a hash. Fixtures are small, so this only guards misuse. */
export const HASH_LIMIT_BYTES = 256 * 1024 * 1024;

/** SHA-256 of a file, streamed. */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

const typeOf = (stats) =>
  stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "dir"
      : stats.isFile()
        ? "file"
        : "other";

const octal = (mode) => (mode & 0o7777).toString(8).padStart(4, "0");

/**
 * Record one path. Never follows symlinks.
 * @returns the entry, or null when the path does not exist.
 */
export async function recordEntry(home, relative, { hash = true } = {}) {
  const absolute = path.join(home, relative);
  let stats;
  try {
    stats = await lstat(absolute);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const type = typeOf(stats);
  const entry = {
    path: relative,
    type,
    mode: octal(stats.mode),
    ino: stats.ino,
    dev: stats.dev,
    // A directory's size is filesystem bookkeeping and changes when children move, so it is not recorded.
    size: type === "dir" ? null : stats.size,
    mtimeMs: type === "dir" ? null : Math.round(stats.mtimeMs),
  };
  if (type === "symlink") {
    entry.target = await readlink(absolute);
    // Does the link still point at something, and where does it end up. Recorded so a link rewrite can be
    // judged by meaning (it must still resolve to the same content) and not only by its text.
    try {
      await stat(absolute);
      entry.resolves = true;
      entry.resolved = await realpath(absolute);
    } catch {
      entry.resolves = false;
      entry.resolved = null;
    }
  }
  if (type === "file" && hash) {
    if (stats.size > HASH_LIMIT_BYTES) entry.sha256 = null;
    else entry.sha256 = await sha256File(absolute);
  }
  return entry;
}

/**
 * Walk `roots` (paths relative to home) and return every entry below and including them, sorted by path.
 * A symlink is listed and not entered. A missing root is skipped, which is how "absent" is recorded.
 */
export async function buildManifest(home, roots, options = {}) {
  const entries = [];
  const visit = async (relative) => {
    const entry = await recordEntry(home, relative, options);
    if (!entry) return;
    entries.push(entry);
    if (entry.type !== "dir") return;
    const children = (await readdir(path.join(home, relative))).sort();
    for (const child of children) await visit(`${relative}/${child}`);
  };
  for (const root of roots) await visit(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    home,
    roots,
    takenAt: new Date().toISOString(),
    entries,
  };
}

/** Index a manifest by path. */
export function indexManifest(manifest) {
  return new Map(manifest.entries.map((entry) => [entry.path, entry]));
}

/**
 * Read the databases named by `databases` (paths relative to home) without modifying them and attach the
 * result to the manifest. A database that is not there is recorded as absent.
 */
export async function attachDatabases(manifest, databases) {
  const result = {};
  for (const relative of databases) {
    const absolute = path.join(manifest.home, relative);
    const present = manifest.entries.some((entry) => entry.path === relative);
    result[relative] = present
      ? await readDatabase(absolute)
      : { path: relative, absent: true };
  }
  return { ...manifest, databases: result };
}

/** One hash over a list of entries, so two trees can be compared at a glance in a report. */
export function treeHash(entries) {
  const hash = createHash("sha256");
  for (const entry of entries)
    hash.update(
      [
        entry.path,
        entry.type,
        entry.mode,
        entry.size ?? "",
        entry.sha256 ?? "",
        entry.target ?? "",
      ].join("\u0000"),
    );
  return hash.digest("hex");
}
