// Throwaway HOME for the packaged-app brand proof (see fresh-home-proof.mjs).
//
// The app and everything it starts (native host, harness, agents) get HOME pointing at a fresh
// directory that holds no ~/.buzz and no ~/.colony, so the folder choice for a NEW install is
// observed for real. The real user's folders are never read or written: HOME is replaced in the
// launch environment, and the sandbox policy additionally denies the real folders by absolute
// path in case something resolves the home directory some other way.
//
// Pure helpers plus small filesystem helpers; unit tests in fresh-home.test.mjs.

import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readlink,
  realpath,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertHomeMigrationGuard } from "./safety.mjs";

/** Entries under the REAL home that the app tree must never reach. */
export const REAL_HOME_FORBIDDEN = [
  ".buzz",
  ".buzz-dev",
  ".colony",
  ".colony-dev",
  "Library/Keychains",
  "Library/Application Support/xyz.block.buzz.app",
  "Library/Application Support/xyz.block.buzz.app.dev",
  "Library/Application Support/Colony Electron",
  "Library/Application Support/Colony Electron Dev",
];

/** Only these variables are forwarded from the harness environment. HOME is deliberately absent. */
const FORWARDED = [
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
];

/**
 * Launch environment for the app under test.
 * HOME is the throwaway directory, never the harness's own. Inherited credentials, native-host
 * and test overrides are dropped. CLAUDE_CONFIG_DIR is set only when the operator passes one.
 */
export function freshHomeEnvironment(
  source,
  { home, userDataDir, relayUrl, claudeConfigDir },
) {
  if (!home || !path.isAbsolute(home))
    throw new Error("freshHomeEnvironment needs an absolute throwaway HOME");
  const env = {};
  for (const key of FORWARDED) if (source[key]) env[key] = source[key];
  // The migration flag is always explicit (final 1.0.5 gate): "0" unless the operator sets it.
  const launchEnv = {
    ...env,
    HOME: home,
    BUZZ_RELAY_URL: relayUrl,
    COLONY_ELECTRON_USER_DATA: userDataDir,
    COLONY_ELECTRON_BACKGROUND: "1",
    COLONY_NEST_MIGRATION: source.COLONY_NEST_MIGRATION ?? "0",
    ...(claudeConfigDir ? { CLAUDE_CONFIG_DIR: claudeConfigDir } : {}),
  };
  assertHomeMigrationGuard(launchEnv);
  console.log(
    `LAUNCH GUARD HOME=${launchEnv.HOME} COLONY_NEST_MIGRATION=${launchEnv.COLONY_NEST_MIGRATION}`,
  );
  return launchEnv;
}

const quote = (value) => JSON.stringify(value);
// Compare real paths where they exist (macOS /var is a link to /private/var), plain paths otherwise.
const canonical = (candidate) => {
  try {
    return realpathSync(candidate);
  } catch {
    return path.resolve(candidate);
  }
};
const withReal = (candidate) => {
  try {
    return [candidate, realpathSync(candidate)];
  } catch {
    return [candidate];
  }
};

/**
 * macOS sandbox profile for the app tree: everything allowed except the real user's Colony and
 * Buzz folders, the keychains and the shared application-data folders; the security daemon is
 * unreachable (the host then falls back to its 0600 file in the throwaway profile); only
 * /usr/bin/security may run unsandboxed so Claude Code can read its own existing sign-in.
 * Nothing here creates, unlocks or modifies a keychain.
 */
export function freshHomeSandboxPolicy(realHome) {
  const forbidden = REAL_HOME_FORBIDDEN.map((entry) =>
    path.join(realHome, entry),
  );
  return [
    "(version 1)",
    "(allow default)",
    ...[...new Set([...forbidden, "/Library/Keychains"].flatMap(withReal))].map(
      (entry) => `(deny file-read* file-write* (subpath ${quote(entry)}))`,
    ),
    '(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.SecurityServer") (global-name "com.apple.security.agent") (global-name "com.apple.SecurityAgent") (global-name-regex #"^com\\.apple\\.(securityd|SecurityServer|SecurityAgent|security\\.agent)(\\.|$)"))',
    '(allow process-exec (literal "/usr/bin/security") (with no-sandbox))',
  ].join("\n");
}

/**
 * Refuse a HOME that could touch the real user's data: the real home itself, anything inside the
 * real home's protected entries, a relative path, or a directory that already carries either
 * product folder (the run would prove nothing about a fresh install).
 */
export function assertFreshHome({ home, realHome, existing = [] }) {
  if (!home || !path.isAbsolute(home))
    throw new Error("The throwaway HOME must be an absolute path");
  const resolved = canonical(home);
  const real = canonical(realHome);
  if (resolved === real) throw new Error("The throwaway HOME is the real HOME");
  for (const entry of REAL_HOME_FORBIDDEN) {
    const protectedPath = path.join(real, entry);
    if (
      resolved === protectedPath ||
      resolved.startsWith(`${protectedPath}${path.sep}`)
    )
      throw new Error(`The throwaway HOME is inside ${protectedPath}`);
  }
  if (resolved.startsWith(`${real}${path.sep}`))
    throw new Error(
      "The throwaway HOME is inside the real HOME, so a relative lookup could reach real data",
    );
  for (const name of [".buzz", ".colony"])
    if (existing.includes(name))
      throw new Error(`The throwaway HOME already contains ${name}`);
  return resolved;
}

/** Sorted top-level entry names of `dir`. Names only, never contents. */
export async function topLevelNames(dir) {
  return (await readdir(dir)).sort();
}

/**
 * Names (relative paths, directories end with "/") under `dir`, depth and count bounded.
 * Used as evidence of what the app created; never reads file contents.
 */
export async function treeNames(dir, { maxDepth = 3, maxEntries = 200 } = {}) {
  const out = [];
  const walk = async (current, depth) => {
    if (depth > maxDepth || out.length >= maxEntries) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= maxEntries) return;
      const rel = path.relative(dir, path.join(current, entry.name));
      if (entry.isDirectory()) {
        out.push(`${rel}/`);
        await walk(path.join(current, entry.name), depth + 1);
      } else out.push(rel);
    }
  };
  await walk(dir, 1);
  return out;
}

/**
 * Create the throwaway HOME outside the real home, mode 0700, with only the folders macOS apps
 * expect (Library). It contains no ~/.buzz and no ~/.colony; the assertion enforces that.
 */
export async function createFreshHome({
  realHome = os.homedir(),
  parent = os.tmpdir(),
} = {}) {
  const home = await realpath(
    await mkdtemp(path.join(parent, "colony-fresh-home-")),
  );
  await chmod(home, 0o700);
  await mkdir(path.join(home, "Library", "Application Support"), {
    recursive: true,
    mode: 0o700,
  });
  const before = await topLevelNames(home);
  assertFreshHome({ home, realHome, existing: before });
  return { home, before };
}

/**
 * Find entries named exactly one of `names` under each root (symlinks are reported, not followed).
 * Returns relative paths with the link target's file name, never contents. Depth and count bounded.
 */
export async function findNamed(
  roots,
  names,
  { maxDepth = 8, maxEntries = 20000 } = {},
) {
  const found = [];
  let seen = 0;
  const walk = async (root, dir, depth) => {
    if (depth > maxDepth || seen >= maxEntries) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen >= maxEntries) return;
      seen += 1;
      const full = path.join(dir, entry.name);
      if (names.includes(entry.name)) {
        let target = "";
        if (entry.isSymbolicLink()) {
          try {
            target = path.basename(await readlink(full));
          } catch {
            target = "?";
          }
        }
        found.push({
          root,
          rel: path.relative(root, full),
          kind: entry.isSymbolicLink()
            ? "link"
            : entry.isDirectory()
              ? "dir"
              : "file",
          target,
        });
      }
      if (entry.isDirectory() && !entry.isSymbolicLink())
        await walk(root, full, depth + 1);
    }
  };
  for (const root of roots) await walk(root, root, 1);
  return found;
}
