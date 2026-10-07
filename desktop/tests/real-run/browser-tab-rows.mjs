// Pure parts of the packaged-app browser tab proof (browser-tab.mjs and
// browser-tab-ui.mjs): which addresses must be refused, what a Downloads
// folder may contain afterwards, and a bounded file-tree scan. Nothing here
// launches an app or touches the person's files, so it has node tests
// (browser-tab-rows.test.mjs) that fail when a judgement is weakened.
import { readdirSync } from "node:fs";
import path from "node:path";

/** Schemes and shapes the visible tab never opens. `base` is the fixture site. */
export function refusedAddresses(base) {
  const port = new URL(base).port;
  return [
    "file:///etc/hosts",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "chrome://settings",
    "devtools://devtools/bundled/inspector.html",
    `view-source:${base}/probe`,
    "ftp://127.0.0.1:1/",
    `blob:${base}/00000000-0000-4000-8000-000000000000`,
    "about:srcdoc",
    "buzz://message?channel=00000000-0000-4000-8000-000000000000",
    "colony://settings",
    `http://user:pass@127.0.0.1:${port}/probe`,
  ];
}

/**
 * Link-local and cloud metadata addresses, in the spellings a page or a typed
 * address could use. Every one is refused by the host policy (PR 263). Ordinary
 * private and LAN addresses are NOT in this list: they stay open on purpose.
 */
export const METADATA_ADDRESSES = [
  "http://169.254.169.254/latest/meta-data/",
  "https://169.254.169.254:8443/",
  "http://169.254.0.1/",
  "http://2852039166/",
  "http://0xa9fea9fe/",
  "http://[fd00:ec2::254]/latest/meta-data/",
  "http://[::ffff:169.254.169.254]/",
  "http://[fe80::1]/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://METADATA.GOOGLE.INTERNAL./",
];

/** Names the proof's own downloads may have, collision suffixes included. */
export const FIXTURE_DOWNLOAD =
  /^(report|colony-real-run-escape)( \(\d+\))?\.txt$/u;

/** The proof's traversal download is named so that an escape is easy to find. */
export const ESCAPE_MARKER = "colony-real-run-escape";

export function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** Names present now that were not there before. */
export function newNames(before, after) {
  const known = new Set(before);
  return [...after].filter((name) => !known.has(name)).sort();
}

/**
 * Judge a Downloads folder after the proof's downloads. Everything new must be
 * one of the proof's own files, none may be an empty placeholder, a partial
 * download, or hidden, and the expected number must have arrived.
 */
export function downloadsVerdict({ added, sizes, expectedCount }) {
  const problems = [];
  const foreign = added.filter((name) => !FIXTURE_DOWNLOAD.test(name));
  if (foreign.length) problems.push(`unexpected files: ${foreign.join(", ")}`);
  const partial = added.filter((name) =>
    /\.(crdownload|download|part)$/u.test(name),
  );
  if (partial.length)
    problems.push(`partial downloads left: ${partial.join(", ")}`);
  const empty = added.filter((name) => sizes[name] === 0);
  if (empty.length)
    problems.push(`empty placeholders left: ${empty.join(", ")}`);
  if (added.length !== expectedCount)
    problems.push(`expected ${expectedCount} new files, found ${added.length}`);
  return { ok: problems.length === 0, problems };
}

/**
 * Walk a directory tree for files whose name contains `marker`. Bounded in
 * depth and entry count, never follows symbolic links, never throws on a
 * folder it cannot read.
 */
export function findByName(
  root,
  marker,
  { maxDepth = 8, maxEntries = 50_000 } = {},
) {
  const hits = [];
  let seen = 0;
  const walk = (directory, depth) => {
    if (depth > maxDepth || seen > maxEntries) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) return;
      const full = path.join(directory, entry.name);
      if (entry.name.includes(marker)) hits.push(full);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return { hits, truncated: seen > maxEntries };
}

/** Files named like the traversal download that are not inside `allowed`. */
export function escapedFiles(hits, allowed) {
  return hits.filter((file) => !isInside(allowed, file));
}

/** Names of cookies that the app session holds for the fixture origin. */
export function cookieNames(cookies) {
  return cookies.map((cookie) => cookie.name);
}

/** A stuck community the proof seeds into a throwaway profile. */
export function stuckCommunity(id) {
  return {
    id,
    name: "Real run stuck community",
    // Nothing listens on port 1: the community can never connect, so the app
    // lands on its "Remove this community from this device" screen. No relay
    // is contacted and no account is used.
    relayUrl: "ws://127.0.0.1:1",
    addedAt: "2026-10-07T00:00:00.000Z",
  };
}
