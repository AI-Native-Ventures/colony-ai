// Test-only stand-in for the product migration (desktop/src-tauri/src/managed_agents/nest_migration/). It follows
// the same observable contract so the differ, the checks and the runner can be proven against a correct
// migration and against deliberately broken ones, with no packaged app: stage entries into ~/.colony.staging
// with a journal written before each rename, publish the staging folder (whole, or merged into an existing
// ~/.colony), skip entries whose destination exists, hold back entries whose links or pointers name the old
// folder, wait for running agents, honour the kill switch, and write notice.json. It is NOT the product
// migration and the proof run never uses it.
import {
  lstat,
  mkdir,
  symlink,
  readFile,
  readdir,
  readlink,
  rename,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { defaultContract } from "./contract.mjs";

const BEST_EFFORT = new Set(["REPOS", "models"]);
const MARKERS = ["AGENTS.md", ".nest-agents-version"];

export const MESSAGES = Object.freeze({
  migrated:
    "Colony moved your agents' files to a new folder, ~/.colony. Other files and tools in your old folder were left exactly as they were.",
  migratedWithSkips:
    "Colony moved your agents' files to ~/.colony. Some items stayed where they were because moving them was not safe. Everything keeps working.",
  leftInPlace:
    "Colony left some of your agents' files where they were because moving them was not safe. Everything keeps working.",
  aborted:
    "Colony could not move your agents' files to the new folder yet, so it is still using the existing folder. Nothing was changed and everything keeps working.",
  failed:
    "Colony could not finish moving your agents' files. They are safe, and Colony will try again the next time it starts.",
});

const exists = async (file) => {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
};

const isEmptyDir = async (dir) => {
  try {
    return (await readdir(dir)).length === 0;
  } catch {
    return false;
  }
};

/** First reason an entry holds a link that would stop meaning the same thing after a rename, or null. */
async function brokenReference(entryPath, oldRoot, topName, moving, depth = 0) {
  let stats;
  try {
    stats = await lstat(entryPath);
  } catch {
    return null;
  }
  if (stats.isSymbolicLink()) {
    const target = await readlink(entryPath);
    const rel = path.relative(oldRoot, entryPath);
    if (path.isAbsolute(target))
      return target === oldRoot || target.startsWith(`${oldRoot}/`)
        ? `absolute-link:${rel}`
        : null;
    const parts = path
      .relative(oldRoot, path.dirname(entryPath))
      .split("/")
      .filter(Boolean);
    for (const part of target.split("/")) {
      if (part === "..") {
        if (parts.length === 0) return null;
        parts.pop();
      } else if (part && part !== ".") parts.push(part);
    }
    return parts[0] === topName || moving.includes(parts[0])
      ? null
      : `relative-link:${rel}`;
  }
  if (stats.isDirectory() && depth < 4 && path.basename(entryPath) !== ".git") {
    for (const child of (await readdir(entryPath)).sort()) {
      const found = await brokenReference(
        path.join(entryPath, child),
        oldRoot,
        topName,
        moving,
        depth + 1,
      );
      if (found) return found;
    }
  }
  return null;
}

/**
 * Run the migration once, as one launch would.
 * @param {string} home fixture HOME
 * @param {object} options
 * @param {string} options.appDataDir the host's app-data folder (journal and notice live below it)
 * @param {boolean} [options.enabled] the kill switch (default true)
 * @param {number[]} [options.liveAgentPids] pids of live agents (default none)
 * @param {{n: number, before: boolean}} [options.crashAt] end the process around the n-th operation
 * @param {() => never} [options.die] called at the crash point
 * @param {object} [options.contract]
 * @returns {{outcome: string, moved: string[], skipped: [string, string][], logLine: string}}
 */
export async function simulateMigration(home, options) {
  const contract = options.contract ?? defaultContract();
  const enabled = options.enabled ?? true;
  const agents = options.liveAgentPids ?? [];
  const from = path.join(home, contract.oldNest);
  const to = path.join(home, contract.newNest);
  const staging = path.join(home, contract.stagingName);
  const stateDir = path.join(options.appDataDir, contract.stateDir);
  let operations = 0;
  const op = async (action) => {
    operations += 1;
    const at = options.crashAt;
    if (at && at.n === operations && at.before) options.die();
    await action();
    if (at && at.n === operations && !at.before) options.die();
  };
  const saveJson = async (name, value) => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, name),
      `${JSON.stringify(value, null, 2)}\n`,
    );
  };
  const loadJournal = async () => {
    try {
      return JSON.parse(
        await readFile(path.join(stateDir, "journal.json"), "utf8"),
      );
    } catch {
      return null;
    }
  };
  const report = (outcome, moved = [], skipped = [], detail = "-") => {
    const text = `${contract.migrationLogPrefix} outcome=${outcome} moved=${moved.length} skipped=${skipped.length} detail=${detail}`;
    return { outcome, moved, skipped, logLine: text };
  };
  const notice = async (key, message) => {
    await saveJson("notice.json", { key, message, acknowledged: false });
  };
  const holdsData = async () => {
    for (const name of contract.ownedTopLevel)
      if (await exists(path.join(from, name))) return true;
    return false;
  };
  const holdsNestMarker = async (folder) => {
    for (const name of MARKERS)
      if (await exists(path.join(folder, name))) return true;
    return false;
  };

  const rollback = async (journal, reason, outcome = "aborted") => {
    journal.phase = "rolling_back";
    await saveJson("journal.json", journal);
    for (const step of journal.steps) {
      if (
        !["moving", "staged", "publishing", "published"].includes(step.status)
      )
        continue;
      for (const place of [
        path.join(staging, step.name),
        path.join(to, step.name),
      ]) {
        if (
          (await exists(place)) &&
          !(await exists(path.join(from, step.name)))
        ) {
          await rename(place, path.join(from, step.name));
          break;
        }
      }
      step.status = "rolled_back";
    }
    journal.phase = "aborted";
    journal.reason = reason;
    await saveJson("journal.json", journal);
    await rmdir(staging).catch(() => undefined);
    // An interrupted run that is rolled back (kill switch, live agents) is not a failure the person needs told.
    if (outcome === "aborted")
      await notice(`aborted:${reason}`, MESSAGES.aborted);
    return report(outcome, [], [], reason);
  };

  const drive = async (journal) => {
    if (journal.phase === "staging") {
      if (!(await exists(staging))) {
        try {
          await op(() => mkdir(staging, { mode: 0o700 }));
        } catch (error) {
          if (error.code === undefined) throw error;
          return rollback(journal, `staging-unavailable:${error.code}`);
        }
      }
      for (const step of journal.steps) {
        if (!["pending", "moving"].includes(step.status)) continue;
        const src = path.join(from, step.name);
        const dst = path.join(staging, step.name);
        const [haveSrc, haveDst] = [await exists(src), await exists(dst)];
        if (!haveSrc && haveDst) {
          step.status = "staged";
          await saveJson("journal.json", journal);
          continue;
        }
        if (!haveSrc) {
          step.status = "skipped";
          step.detail = "vanished";
          await saveJson("journal.json", journal);
          continue;
        }
        step.status = "moving";
        await saveJson("journal.json", journal);
        try {
          await op(() => rename(src, dst));
        } catch (error) {
          if (error.code === undefined) throw error;
          return rollback(journal, `move-failed:${step.name}`);
        }
        step.status = "staged";
        await saveJson("journal.json", journal);
      }
    }
    journal.phase = "publishing";
    await saveJson("journal.json", journal);
    if (!(await exists(to))) {
      journal.publish_whole = true;
      await saveJson("journal.json", journal);
      await op(() => rename(staging, to));
    } else {
      const staged = journal.steps.filter(
        (step) => step.status === "staged" || step.status === "publishing",
      );
      const ordered = [
        ...staged.filter((step) => !MARKERS.includes(step.name)),
        ...staged.filter((step) => MARKERS.includes(step.name)),
      ];
      for (const step of ordered) {
        step.status = "publishing";
        await saveJson("journal.json", journal);
        await op(() =>
          rename(path.join(staging, step.name), path.join(to, step.name)),
        );
        step.status = "published";
        await saveJson("journal.json", journal);
      }
      await rmdir(staging).catch(() => undefined);
    }
    for (const step of journal.steps)
      if (["staged", "publishing"].includes(step.status))
        step.status = "published";
    journal.phase = "done";
    journal.finished_at = new Date().toISOString();
    await saveJson("journal.json", journal);
    const moved = journal.steps
      .filter((step) => step.status === "published")
      .map((step) => step.name);
    const skipped = journal.steps
      .filter((step) => step.status === "skipped")
      .map((step) => [step.name, step.detail ?? ""]);
    await notice(
      skipped.length
        ? `left:${skipped
            .map(([name]) => name)
            .sort()
            .join(",")}`
        : "migrated",
      skipped.length ? MESSAGES.migratedWithSkips : MESSAGES.migrated,
    );
    return report("migrated", moved, skipped, moved.join(","));
  };

  // Resume or roll back a run that stopped in flight.
  const existing = await loadJournal();
  if (
    existing &&
    ["staging", "publishing", "rolling_back"].includes(existing.phase)
  ) {
    if (existing.phase === "rolling_back" || !enabled || agents.length)
      return rollback(existing, "interrupted", "rolled-back");
    return drive(existing);
  }
  if (!enabled) return report("disabled");
  let fromStats;
  try {
    fromStats = await lstat(from);
  } catch {
    return report("not-applicable", [], [], "legacy-folder-absent");
  }
  if (!fromStats.isDirectory())
    return report("not-applicable", [], [], "legacy-folder-not-a-directory");
  if (!(await holdsData()))
    return report(
      existing?.phase === "done" ? "already-migrated" : "nothing-to-migrate",
    );
  if (agents.length) return report("deferred-running-agents");

  // Plan.
  const colonyHasNest = await holdsNestMarker(to);
  const present = [];
  for (const name of contract.ownedTopLevel)
    if (await exists(path.join(from, name))) present.push(name);
  const steps = [];
  for (const name of present) {
    const kind = BEST_EFFORT.has(name) ? "best_effort" : "atomic";
    const src = path.join(from, name);
    const dest = path.join(to, name);
    let free = !(await exists(dest));
    if (!free) {
      const [srcStats, destStats] = [await lstat(src), await lstat(dest)];
      free =
        srcStats.isDirectory() &&
        destStats.isDirectory() &&
        (await isEmptyDir(dest));
    }
    if (!free) {
      if (kind === "atomic" && !colonyHasNest)
        return abortFresh(`target-exists:${name}`);
      steps.push({ name, kind, status: "skipped", detail: "target-exists" });
      continue;
    }
    let hold = null;
    if (name === ".repos-dir") {
      const text = (await readFile(src, "utf8").catch(() => "")).trim();
      if (
        path.isAbsolute(text) &&
        (text === from || text.startsWith(`${from}/`))
      )
        hold = "repos-dir-inside-old-folder";
    } else {
      const found = await brokenReference(src, from, name, present);
      if (found) hold = `would-break-link:${found}`;
    }
    if (hold) {
      if (kind === "atomic") return abortFresh(hold);
      steps.push({ name, kind, status: "skipped", detail: hold });
      continue;
    }
    steps.push({ name, kind, status: "pending" });
  }
  async function abortFresh(reason) {
    await notice(`aborted:${reason}`, MESSAGES.aborted);
    return report("aborted", [], [], reason);
  }
  if (!steps.some((step) => step.status === "pending")) {
    const skipped = steps
      .filter((step) => step.status === "skipped")
      .map((step) => [step.name, step.detail]);
    if (!skipped.length) return report("nothing-to-migrate");
    await notice(
      `left:${skipped
        .map(([name]) => name)
        .sort()
        .join(",")}`,
      MESSAGES.leftInPlace,
    );
    return report(
      "left-in-place",
      [],
      skipped,
      skipped.map(([name, why]) => `${name}(${why})`).join(","),
    );
  }
  const journal = {
    version: 1,
    phase: "staging",
    from: contract.oldNest,
    to: contract.newNest,
    staging: contract.stagingName,
    publish_whole: false,
    started_at: new Date().toISOString(),
    steps,
  };
  await saveJson("journal.json", journal);
  return drive(journal);
}

/**
 * What ensure_nest does for a nest folder the app is about to use: the skill the new folder owns and the links
 * to it from the harness folders. Idempotent. Shared by the fake app and the unit tests.
 */
export async function provisionSkill(folder) {
  const skill = path.join(folder, ".agents", "skills", "colony-cli");
  if (await exists(skill)) return;
  await mkdir(skill, { recursive: true });
  await writeFile(
    path.join(skill, "SKILL.md"),
    "# Colony CLI skill (synthetic)\n",
  );
  for (const harness of [".claude", ".codex", ".goose"]) {
    await mkdir(path.join(folder, harness, "skills"), { recursive: true });
    await symlink(
      "../../.agents/skills/colony-cli",
      path.join(folder, harness, "skills", "colony-cli"),
    );
  }
}
