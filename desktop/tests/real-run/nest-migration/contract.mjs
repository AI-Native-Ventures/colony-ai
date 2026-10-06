// Contract between the .buzz to .colony nest migration (Worker M1, branch feat/nest-migration) and this
// seeded-HOME proof harness. Every name, path, environment variable and log prefix the harness depends on is
// declared here and nowhere else, so a change on the migration side is a one-file change on this side.
//
// Source of truth for the allow-list: design page "PR 2 design: what Colony owns inside ~/.buzz"
// (/Users/mac/worktrees/.lanes/phase2/buzz-naming-20261006/index.html) and the host code:
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
 * Colony-owned top-level names inside the nest: the closed allow-list. Anything else in the folder is
 * foreign and must be left byte-for-byte alone. Twelve names.
 */
export const OWNED_TOP_LEVEL = Object.freeze([
  "AGENTS.md",
  ".nest-agents-version",
  "GUIDES",
  "RESEARCH",
  "PLANS",
  "WORK_LOGS",
  "OUTBOX",
  ".scratch",
  "archive",
  ".repos-dir",
  "REPOS",
  "models",
]);

/**
 * Entries Colony generates inside harness folders it shares with other tools. They are not moved: the
 * migration removes exactly these old entries and regenerates them under the new name in the new folder.
 * The parent folders (.agents, .claude, .codex, .goose) stay in the old nest because other tools write there.
 */
export const GENERATED_SKILL_LINKS = Object.freeze([
  ".agents/skills/buzz-cli",
  ".claude/skills/buzz-cli",
  ".codex/skills/buzz-cli",
  ".goose/skills/buzz-cli",
]);

/** What the generated skill entries are called after regeneration in the new folder. */
export const REGENERATED_SKILL_LINKS = Object.freeze([
  ".agents/skills/colony-cli",
  ".claude/skills/colony-cli",
  ".codex/skills/colony-cli",
  ".goose/skills/colony-cli",
]);

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

/** Prefix of migration progress lines in the native host log. */
export const MIGRATION_LOG_PREFIX = "buzz-desktop: nest-migration:";

/**
 * Environment variables the migration reads. FLAG turns it on or off without a rebuild. CRASH_AFTER makes the
 * process abort after that many journal entries have been written and their moves done, so a packaged run can
 * kill the migration exactly between two entries.
 */
export const MIGRATION_ENV = Object.freeze({
  flag: "COLONY_NEST_MIGRATION",
  flagOn: "1",
  flagOff: "0",
  crashAfter: "COLONY_NEST_MIGRATION_CRASH_AFTER",
});

/** The shape of the contract, so a coordinator can override single fields from a JSON file. */
export function defaultContract() {
  return {
    oldNest: OLD_NEST,
    newNest: NEW_NEST,
    ownedTopLevel: [...OWNED_TOP_LEVEL],
    generatedSkillLinks: [...GENERATED_SKILL_LINKS],
    regeneratedSkillLinks: [...REGENERATED_SKILL_LINKS],
    sharedHarnessDirs: [...SHARED_HARNESS_DIRS],
    nestFolderLogPrefix: NEST_FOLDER_LOG_PREFIX,
    migrationLogPrefix: MIGRATION_LOG_PREFIX,
    env: { ...MIGRATION_ENV },
    // Paths relative to the HOME folder where the migration keeps its durable records. Several candidates
    // are listed because staging, journal and sentinel placement is the migration's choice. The first that
    // exists is read.
    journalPaths: [
      ".colony.staging/journal.jsonl",
      ".colony/.nest-migration/journal.jsonl",
      ".colony/.nest-migration-journal.jsonl",
    ],
    sentinelPaths: [
      ".colony/.nest-migration.json",
      ".colony/.nest-migration/sentinel.json",
    ],
    // Names the migration may add that are neither owned entries nor user data: staging and records.
    allowedNewArtifacts: [
      ".colony.staging",
      ".colony/.nest-migration",
      ".colony/.nest-migration.json",
      ".colony/.nest-migration-journal.jsonl",
    ],
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
 * - "generated": an old generated skill entry, or anything below one.
 * - "foreign": everything else, including the contents of the shared harness folders.
 */
export function classifyNestPath(relativePath, contract = defaultContract()) {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length === 0) return "root";
  for (const generated of contract.generatedSkillLinks) {
    if (relativePath === generated || relativePath.startsWith(`${generated}/`))
      return "generated";
  }
  return contract.ownedTopLevel.includes(parts[0]) ? "owned" : "foreign";
}
