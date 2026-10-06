// Contract between the .buzz to .colony nest migration (Worker M1, branch feat/nest-migration) and this
// seeded-HOME proof harness. Every name, path, environment variable and log prefix the harness depends on is
// declared here and nowhere else, so a change on the migration side is a one-file change on this side.
//
// Agreed with Worker M1 (branch feat/nest-migration, contract note briefs-20261004/nest-migration-contract-M1.md,
// code desktop/src-tauri/src/managed_agents/nest_migration/). Where M1 deviates from the design page the contract
// follows M1 and the deviation is listed in the PR: .scratch is foreign and is not moved; the old generated
// buzz-cli skill entries stay in the old folder; references that name the old folder hold an entry back instead
// of being rewritten. Host code the names come from:
//   NEST_DIRS and the skill link names   desktop/src-tauri/src/managed_agents/nest.rs
//   REPOS, .repos-dir                    desktop/src-tauri/src/managed_agents/repos.rs
//   archive/archive.db (+ -wal, -shm)    desktop/src-tauri/src/archive/store.rs
//   models/                              desktop/src-tauri/src/huddle/models.rs
//   folder choice and its log line       desktop/src-tauri/src/managed_agents/nest_folder.rs

/** Legacy folder name that existing installs keep their nest in. */
export const OLD_NEST = ".buzz";
/** Folder name that new installs, and migrated installs, use. */
export const NEW_NEST = ".colony";

/**
 * Colony-owned top-level names inside the nest: the closed allow-list, in the migration's move order
 * (nest_migration/mod.rs DATA_ENTRIES, BEST_EFFORT_ENTRIES, MARKER_ENTRIES). Anything else in the folder is
 * foreign and must be left byte-for-byte alone, including .scratch.
 */
export const OWNED_TOP_LEVEL = Object.freeze([
  "archive",
  "GUIDES",
  "RESEARCH",
  "PLANS",
  "WORK_LOGS",
  "OUTBOX",
  ".repos-dir",
  "REPOS",
  "models",
  "AGENTS.md",
  ".nest-agents-version",
]);

/**
 * Entries Colony generates inside harness folders it shares with other tools. The migration leaves them where
 * they are (never delete) and the new folder generates its own. Under the default policy "leave" they are
 * compared like foreign entries, so any change to them fails the run. Reset is the one flow that removes them.
 */
export const GENERATED_SKILL_LINKS = Object.freeze([
  ".agents/skills/buzz-cli",
  ".claude/skills/buzz-cli",
  ".codex/skills/buzz-cli",
  ".goose/skills/buzz-cli",
]);

/** What the generated skill entries are called when the new folder provisions its own (either spelling). */
export const REGENERATED_SKILL_LINKS = Object.freeze(
  [".agents", ".claude", ".codex", ".goose"].flatMap((dir) => [
    `${dir}/skills/buzz-cli`,
    `${dir}/skills/colony-cli`,
  ]),
);

/** Harness folders shared with other tools: never moved, never deleted. */
export const SHARED_HARNESS_DIRS = Object.freeze([
  ".agents",
  ".claude",
  ".codex",
  ".goose",
]);

/** Stand-in for the version stamp so the host never refreshes Colony-written files during a proof run. */
export const NO_REFRESH_VERSION = "999\n";

/**
 * Prefix of the one-line folder choice the host logs at boot (nest_folder.rs LOG_PREFIX). The harness reads
 * it from the native host log (COLONY_NATIVE_HOST_LOG).
 */
export const NEST_FOLDER_LOG_PREFIX = "buzz-desktop: nest-folder:";

/**
 * Prefix of the migration's result line: `<prefix> outcome=<kebab> moved=<n> skipped=<n> detail=<text>`
 * (nest_migration/mod.rs LOG_PREFIX). Outcomes: disabled, not-applicable, nothing-to-migrate,
 * already-migrated, deferred-running-agents, migrated, left-in-place, aborted, rolled-back, failed.
 */
export const MIGRATION_LOG_PREFIX = "buzz-desktop: nest-migration:";

/**
 * Environment variables the migration reads. FLAG turns it on or off without a rebuild (unset means the
 * build's compiled default, OFF until the release commit flips it). CRASH_AT=<n>:<before|after> makes the
 * process exit with code CRASH_EXIT_CODE just before or after the n-th filesystem operation (operation 1
 * creates the staging folder, then one rename per entry), so a packaged run can stop the migration exactly
 * between two entries.
 */
export const MIGRATION_ENV = Object.freeze({
  flag: "COLONY_NEST_MIGRATION",
  flagOn: "1",
  flagOff: "0",
  crashAt: "COLONY_NEST_MIGRATION_CRASH_AT",
  crashExitCode: 86,
});

/** Folder under the host's app-data directory that holds journal.json and notice.json. */
export const STATE_DIR = "nest-migration";

/** Environment entry that marks a process as one of this install's managed agents (runtime/process.rs). */
export const AGENT_MARKER_ENV = "BUZZ_MANAGED_AGENT";

/** The shape of the contract, so a coordinator can override single fields from a JSON file. */
export function defaultContract() {
  return {
    oldNest: OLD_NEST,
    newNest: NEW_NEST,
    stagingName: `${NEW_NEST}.staging`,
    ownedTopLevel: [...OWNED_TOP_LEVEL],
    generatedSkillLinks: [...GENERATED_SKILL_LINKS],
    regeneratedSkillLinks: [...REGENERATED_SKILL_LINKS],
    sharedHarnessDirs: [...SHARED_HARNESS_DIRS],
    generatedPolicy: "leave",
    nestFolderLogPrefix: NEST_FOLDER_LOG_PREFIX,
    migrationLogPrefix: MIGRATION_LOG_PREFIX,
    stateDir: STATE_DIR,
    agentMarkerEnv: AGENT_MARKER_ENV,
    env: { ...MIGRATION_ENV },
    // In the held-back case the migration also writes `.colony/.repos-dir` (an owned name) naming the REPOS that
    // stayed in the old folder, and the host then links `.colony/REPOS` to it: neither is a new artifact to flag,
    // and the differ treats that link as the way the new nest reaches the left-behind folder, not as a copy.
    // Names the migration may add that are neither owned entries nor user data. The staging folder exists only
    // while a run is in flight, and the proof checks it is gone afterwards.
    allowedNewArtifacts:
      process.env.NEST_STRICT === "1"
        ? [`${NEW_NEST}.staging`]
        : [`${NEW_NEST}.staging`, `${NEW_NEST}/.scratch`],
  };
}

/** Merge a partial override onto the default contract. */
export function loadContract(override = {}) {
  const base = defaultContract();
  return {
    ...base,
    ...override,
    env: { ...base.env, ...(override.env ?? {}) },
  };
}

/**
 * Classify a path relative to the nest root.
 * - "owned": a top-level allow-list name, or anything below one.
 * - "generated": an old generated skill entry, or anything below one, when the policy is "remove".
 * - "generated-parent": a folder that only exists to hold generated entries (.codex/skills), when the policy is
 *   "remove". Reset prunes such a folder once the link in it is gone and the folder is empty.
 * - "foreign": everything else, including the contents of the shared harness folders, .scratch and, under
 *   the default policy "leave", the old generated skill entries.
 */
export function classifyNestPath(relativePath, contract = defaultContract()) {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  if (contract.generatedPolicy === "remove") {
    for (const generated of contract.generatedSkillLinks) {
      if (
        relativePath === generated ||
        relativePath.startsWith(`${generated}/`)
      )
        return "generated";
      if (generated.startsWith(`${relativePath}/`)) return "generated-parent";
    }
  }
  return contract.ownedTopLevel.includes(parts[0]) ? "owned" : "foreign";
}
