import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
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
