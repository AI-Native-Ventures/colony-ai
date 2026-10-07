// Manifest of a HOME tree: one record per entry, taken with lstat so a symlink is recorded as a symlink and
// never followed. A manifest taken before a run and one taken after are compared by diff.mjs.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
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
    // bigint stats: nanosecond timestamps and exact inode numbers, so a rewrite is visible at any granularity.
    stats = await lstat(absolute, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const type = typeOf(stats);
  const entry = {
    path: relative,
    type,
    mode: octal(Number(stats.mode)),
    ino: stats.ino.toString(),
    dev: stats.dev.toString(),
    // A directory's size, link count and times are filesystem bookkeeping that change when children move, so
    // they are not recorded for directories.
    size: type === "dir" ? null : Number(stats.size),
    nlink: type === "dir" ? null : Number(stats.nlink),
    mtimeNs: type === "dir" ? null : stats.mtimeNs.toString(),
    ctimeNs: type === "dir" ? null : stats.ctimeNs.toString(),
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

/**
 * Pin every regular file under `roots` with a hard link in `pinDir` (inside the proof's own temp root, outside
 * the nest). While a pin exists its inode number cannot be handed to another file, so the manifest's inode
 * comparison is sound on filesystems that reuse freed inodes at once (ext4 does): a copy-then-delete or a
 * delete-then-write can never keep the original inode number, and the original's link count (nest path plus
 * pin) differs from the copy's. Files under `skip` (volatile paths such as the archive) are not pinned.
 * Take the "before" manifest after pinning, because creating a link also updates the file's ctime.
 * @returns {Promise<number>} how many files were pinned
 */
export async function pinFiles(home, roots, pinDir, skip = () => false) {
  await mkdir(pinDir, { recursive: true });
  let count = 0;
  const visit = async (relative) => {
    let stats;
    try {
      stats = await lstat(path.join(home, relative));
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stats.isDirectory()) {
      for (const child of (await readdir(path.join(home, relative))).sort())
        await visit(`${relative}/${child}`);
    } else if (stats.isFile() && !skip(relative)) {
      await link(path.join(home, relative), path.join(pinDir, String(count)));
      count += 1;
    }
  };
  for (const root of roots) await visit(root);
  // Kernel timestamps come from a coarse clock (a tick of up to 10 ms). Let it advance past the links' own
  // ctime stamps, so any later touch of a pinned file gets a strictly later ctime and cannot tie.
  await new Promise((resolve) => setTimeout(resolve, 25));
  return count;
}

/** Remove the pins. Call after the "after" manifest is taken, because removing a link updates ctime. */
export async function unpinFiles(pinDir) {
  await rm(pinDir, { recursive: true, force: true });
}
