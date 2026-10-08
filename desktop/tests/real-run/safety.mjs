import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const STEP_NAMES = [
  "Account",
  "Account verification",
  "Business",
  "Read website",
  "Create business",
  "Connect Claude Code",
  "Test connection",
  "Open my Colony",
  "Welcome channel",
  "Scout intro",
  "Team",
  "Scout pages",
  "Teammate mentions",
  "Business reply",
  "Reply file references",
];

export function redact(value) {
  return String(value)
    .replace(/(?:nsec1|ncryptsec1)[a-z0-9]+/giu, "[redacted signing material]")
    .replace(/\b[0-9a-f]{64}\b/giu, "[redacted identifier]")
    .replace(/\b(?:Bearer|Nostr)\s+\S+/giu, "[redacted authorization]")
    .replace(/\beyJ[A-Za-z0-9._-]+/gu, "[redacted token]")
    .replace(/\b(?:sk-|sk_)[A-Za-z0-9_-]+/gu, "[redacted credential]");
}

export function brandingFindings(text) {
  const names = ["Buzz", "Fizz", "Honey", "Pollen"];
  return names
    .flatMap((name, index) =>
      new RegExp(`\\b${name}\\b`, "iu").test(text)
        ? [`legacy-name-${index + 1}`]
        : [],
    )
    .concat(text.includes("\u{1f41d}") ? ["legacy-symbol"] : []);
}

export function teammateVerdict(suggestions, teammates, ownerName) {
  const normalize = (name) => name.trim().toLowerCase();
  const allowed = new Set(teammates.map(normalize));
  const entries = suggestions.map(normalize).filter(Boolean);
  if (!entries.length || !allowed.size)
    return {
      status: "BLOCKED",
      reason: "No complete teammate and suggestion evidence.",
    };
  const outsiders = entries.filter(
    (name) => !allowed.has(name) || name === normalize(ownerName),
  );
  return { status: outsiders.length ? "FAIL" : "PASS", outsiders };
}

export function outsideRepo(directory, repo) {
  const resolved = realpathSync(directory);
  const relative = path.relative(realpathSync(repo), resolved);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  ) {
    throw new Error(
      "Report and private data must stay outside the repository.",
    );
  }
  return resolved;
}

// The released host still uses shared stores. Deny them at the process boundary.
// This does not create, unlock, migrate or modify any keychain.
export function sandboxPolicy(userDataDir, probePath, home = homedir()) {
  const q = (s) => JSON.stringify(s);
  const profile = createHash("sha256")
    .update(userDataDir)
    .digest("hex")
    .slice(0, 16);
  const support = path.join(home, "Library", "Application Support");
  const nativeDir = path.join(
    support,
    `xyz.block.buzz.app.electron.${profile}`,
  );
  const forbidden = [
    path.join(home, "Library", "Keychains"),
    "/Library/Keychains",
    path.join(home, ".buzz"),
    path.join(home, ".buzz-dev"),
    path.join(support, "xyz.block.buzz.app"),
    path.join(support, "xyz.block.buzz.app.dev"),
    path.join(support, "Colony Electron"),
    path.join(support, "Colony Electron Dev"),
    ...(probePath ? [probePath] : []),
  ];
  return {
    profile,
    nativeDir,
    policy: [
      "(version 1)",
      "(allow default)",
      ...[
        ...new Set(
          forbidden.flatMap((p) => {
            try {
              return [p, realpathSync(p)];
            } catch {
              return [p];
            }
          }),
        ),
      ].map((p) => `(deny file-read* file-write* (subpath ${q(p)}))`),
      '(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.SecurityServer") (global-name "com.apple.security.agent") (global-name "com.apple.SecurityAgent") (global-name-regex #"^com\\.apple\\.(securityd|SecurityServer|SecurityAgent|security\\.agent)(\\.|$)"))',
      '(deny process-exec (literal "/usr/bin/security") (literal "/System/Library/CoreServices/SecurityAgent.app/Contents/MacOS/SecurityAgent"))',
    ].join("\n"),
  };
}

export function cleanEnvironment(source, userDataDir, relayUrl) {
  // Deliberately discard inherited credentials and native/test overrides.
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (source[key]) env[key] = source[key];
  }
  return {
    ...env,
    BUZZ_RELAY_URL: relayUrl,
    COLONY_ELECTRON_USER_DATA: userDataDir,
    COLONY_ELECTRON_BACKGROUND: "1",
  };
}

// Real HOME and signed-in Claude Code, but the app tree cannot reach the OS keychain
// service. The packaged host stores its identity in the shared "buzz-desktop"
// keychain slot (not profile scoped), so a throwaway profile would adopt or overwrite
// the owner's identity. With securityd unreachable the host falls back to its 0600
// file inside the throwaway profile. /usr/bin/security alone runs unsandboxed so
// Claude Code can read its own existing sign-in exactly as it normally does.
// Nothing here creates, unlocks or modifies a keychain.
export function realEnvSandboxPolicy(home = homedir(), probePath = "") {
  const q = (s) => JSON.stringify(s);
  const support = path.join(home, "Library", "Application Support");
  const forbidden = [
    ...[
      ".buzz",
      ".buzz-dev",
      ".colony",
      ".colony-dev",
      ".claude",
      ".codex",
      ".config/opencode",
    ].map((entry) => path.join(home, entry)),
    path.join(home, "Library", "Keychains"),
    "/Library/Keychains",
    path.join(support, "xyz.block.buzz.app"),
    path.join(support, "xyz.block.buzz.app.dev"),
    path.join(support, "Colony Electron"),
    path.join(support, "Colony Electron Dev"),
    ...(probePath ? [probePath] : []),
  ];
  return [
    "(version 1)",
    "(allow default)",
    ...[
      ...new Set(
        forbidden.flatMap((p) => {
          try {
            return [p, realpathSync(p)];
          } catch {
            return [p];
          }
        }),
      ),
    ].map((p) => `(deny file-read* file-write* (subpath ${q(p)}))`),
    '(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.SecurityServer") (global-name "com.apple.security.agent") (global-name "com.apple.SecurityAgent") (global-name-regex #"^com\\.apple\\.(securityd|SecurityServer|SecurityAgent|security\\.agent)(\\.|$)"))',
    '(deny process-exec (literal "/usr/bin/security") (literal "/System/Library/CoreServices/SecurityAgent.app/Contents/MacOS/SecurityAgent"))',
  ].join("\n");
}

// Real-environment launch: the real HOME so a signed-in Claude Code is found. Only an
// allowlist is forwarded, so inherited credentials and native/test overrides stay out.
// Both the env var and the CLI flag are set because the packaged main process calls
// app.setPath("userData") from COLONY_ELECTRON_USER_DATA and would otherwise fall back
// to the real "Colony Electron" profile.
export function realEnvironment(source, userDataDir, relayUrl) {
  const env = {};
  for (const key of [
    "PATH",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (source[key]) env[key] = source[key];
  }
  // Final 1.0.5 gate: the app tree never gets the owner's real HOME. Every profile gets a
  // throwaway HOME next to its user-data directory (privateDir/home), so the owner's real ~/.buzz
  // and ~/.colony are never read, migrated or written. GATE_REAL_HOME=1 would restore the old
  // behaviour but then COLONY_NEST_MIGRATION must be exactly "0" (guard below).
  const throwaway = path.join(path.dirname(userDataDir), "home");
  const useReal = source.GATE_REAL_HOME === "1";
  // GATE_HOME_SEED_FROM: a pre-built throwaway HOME (the owner-shaped ~/.buzz fixture) moved in as this
  // profile's HOME on its first launch. Never moves anything out of the real home: the seed lives in tmp.
  if (!useReal && source.GATE_HOME_SEED_FROM && !existsSync(throwaway)) {
    renameSync(source.GATE_HOME_SEED_FROM, throwaway);
  }
  if (!useReal) {
    mkdirSync(path.join(throwaway, "Library", "Application Support"), {
      recursive: true,
      mode: 0o700,
    });
  }
  // GATE_MIGRATION_UNSET=1 leaves the flag out (the build's compiled default), allowed only on a throwaway HOME.
  const migration =
    source.GATE_MIGRATION_UNSET === "1"
      ? undefined
      : (source.COLONY_NEST_MIGRATION ?? "0");
  const launchEnv = {
    ...env,
    HOME: useReal ? source.HOME : throwaway,
    BUZZ_RELAY_URL: relayUrl,
    COLONY_ELECTRON_USER_DATA: userDataDir,
    COLONY_ELECTRON_BACKGROUND: "1",
    ...(migration === undefined ? {} : { COLONY_NEST_MIGRATION: migration }),
  };
  assertHomeMigrationGuard(launchEnv);
  console.log(
    `LAUNCH GUARD HOME=${launchEnv.HOME} COLONY_NEST_MIGRATION=${launchEnv.COLONY_NEST_MIGRATION ?? "(unset, build default)"}`,
  );
  return launchEnv;
}

// Refuses to start any launch whose HOME is the owner's real home unless the migration flag is
// exactly "0". Throws, so no app process is created.
export function assertHomeMigrationGuard(env, realHome = homedir()) {
  const canonical = (value) => {
    try {
      return realpathSync(value);
    } catch {
      return path.resolve(String(value ?? ""));
    }
  };
  if (!env.HOME) throw new Error("Launch guard: HOME is not set");
  if (
    canonical(env.HOME) === canonical(realHome) &&
    env.COLONY_NEST_MIGRATION !== "0"
  )
    throw new Error(
      "Launch guard: HOME is the real home and COLONY_NEST_MIGRATION is not exactly 0. Refusing to start.",
    );
}

// Words that only appear in the owner's personal Claude configuration. A first reply
// containing any of them leaked unrelated personal context.
export const PERSONAL_CONFIG_MARKERS = [
  "gstack",
  "graphify",
  "caveman",
  "superpowers",
  "adhd",
  "basheer",
  "phiri",
  "ainative.ventures",
  "html-first",
  "em-dash",
  "logo.dev",
  "clearbit",
  "llm_provider",
  "hermit",
  "merchandmove",
  "anastellar",
];

export function personalConfigFindings(text) {
  const lower = String(text).toLowerCase();
  return PERSONAL_CONFIG_MARKERS.filter((marker) => lower.includes(marker));
}

export function businessMentionVerdict(reply, businessName, website) {
  const text = String(reply).toLowerCase();
  let host = "";
  try {
    host = new URL(website).hostname.replace(/^www\./u, "").toLowerCase();
  } catch {
    host = "";
  }
  const name = String(businessName ?? "").toLowerCase();
  const hits = [
    ...(name && text.includes(name) ? [`name:${businessName}`] : []),
    ...(host && text.includes(host) ? [`website:${host}`] : []),
  ];
  return { status: hits.length ? "PASS" : "FAIL", hits };
}

export const SETUP_NOTICE = /connect your ai|settings\s*>\s*agents/iu;

export function fileReferenceVerdict(paths, links) {
  if (!paths.length)
    return {
      status: "BLOCKED",
      reason:
        "Actual reply has no file reference. This gate was not exercised.",
    };
  if (
    links.some((link) => link.tag === "a" && (!link.href || link.href === "#"))
  ) {
    return {
      status: "FAIL",
      reason: "A file-like anchor has no usable target.",
    };
  }
  if (links.length)
    return {
      status: "BLOCKED",
      reason:
        "Interactive file references are present. Opening was not exercised, so clickability is unproven.",
    };
  return {
    status: "PASS",
    reason: `${paths.length} file-like references rendered as plain text, with no interactive claim.`,
  };
}

export function assertSafeDiagnostics(environment) {
  if (environment.DEBUG || environment.PWDEBUG) {
    throw new Error(
      "Disable DEBUG and PWDEBUG before running: automation diagnostics can expose secret input values.",
    );
  }
}
