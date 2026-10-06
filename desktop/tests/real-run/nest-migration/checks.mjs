// The checks encoded from the design page "Gate 3: PR 2 on seeded HOMEs" and the migration rules.
// Each check turns observations into one row: PASS, FAIL or NOT OBSERVED. A check never reports PASS without
// an observation behind it: missing evidence is NOT OBSERVED, which the report shows as a gap and never as
// success. Pure functions, unit tested without any app (checks.test.mjs).
import { defaultContract } from "./contract.mjs";
import { compareStable, diffNests } from "./diff.mjs";

export const PASS = "PASS";
export const FAIL = "FAIL";
export const NOT_OBSERVED = "NOT OBSERVED";

const row = (id, label, status, detail) => ({ id, label, status, detail });
const pass = (id, label, detail) => row(id, label, PASS, detail);
const fail = (id, label, detail) => row(id, label, FAIL, detail);
const unseen = (id, label, detail) => row(id, label, NOT_OBSERVED, detail);
const first = (items, count = 4) =>
  `${items.slice(0, count).join("; ")}${items.length > count ? `; and ${items.length - count} more` : ""}`;
const describeDifference = (item) =>
  `${item.path} (${item.differences.map((d) => d.field).join(", ")})`;

/** Parse the one-line folder choice the host logs: `<prefix> chosen=<name> reason=<reason> path=<abs>`. */
export function parseNestFolderLine(lines, contract = defaultContract()) {
  for (const line of [...lines].reverse()) {
    const at = line.indexOf(contract.nestFolderLogPrefix);
    if (at < 0) continue;
    const match = /chosen=(\S+) reason=(\S+) path=(.*)$/u.exec(line.slice(at));
    if (match)
      return { chosen: match[1], reason: match[2], path: match[3].trim() };
  }
  return null;
}

/** Entries of the old nest that are still owned names after the run. */
function ownedLeftInOld(after, contract) {
  return after.entries
    .filter((entry) => {
      const prefix = `${contract.oldNest}/`;
      if (!entry.path.startsWith(prefix)) return false;
      const top = entry.path.slice(prefix.length).split("/")[0];
      return contract.ownedTopLevel.includes(top);
    })
    .map((entry) => entry.path);
}

function foreignChecks(diff) {
  const label =
    "Foreign entries are identical after the run (path, type, mode, size, sha256, link target, inode, mtime)";
  if (diff.foreign.total === 0)
    return unseen(
      "FOREIGN-IDENTICAL",
      label,
      "The fixture has no foreign entries in the old folder to compare.",
    );
  const bad = [
    ...diff.foreign.missing.map((p) => `${p} (missing)`),
    ...diff.foreign.differences.map(describeDifference),
  ];
  return bad.length
    ? fail(
        "FOREIGN-IDENTICAL",
        label,
        `${bad.length} of ${diff.foreign.total} changed: ${first(bad)}`,
      )
    : pass(
        "FOREIGN-IDENTICAL",
        label,
        `${diff.foreign.identical} of ${diff.foreign.total} foreign entries identical.`,
      );
}

function scriptChecks(observations) {
  const label =
    "Foreign venv scripts that name their own absolute path still run from it";
  const scripts = observations.foreignScripts;
  if (!scripts?.before?.length || !scripts?.after?.length)
    return unseen(
      "FOREIGN-SCRIPTS-RUN",
      label,
      "The scripts were not run before and after.",
    );
  const broken = scripts.after.filter(
    (item, index) => !item.ok || item.stdout !== scripts.before[index]?.stdout,
  );
  return broken.length
    ? fail(
        "FOREIGN-SCRIPTS-RUN",
        label,
        `Broken after the run: ${first(broken.map((b) => b.path))}`,
      )
    : pass(
        "FOREIGN-SCRIPTS-RUN",
        label,
        `${scripts.after.length} scripts ran from their original absolute paths with the same output.`,
      );
}

function noLossChecks(diff) {
  const label =
    "Nothing lost: every old entry exists exactly once, at the old or the new place";
  const bad = [
    ...diff.owned.lost.map((p) => `${p} (lost)`),
    ...diff.owned.altered
      .filter((item) => item.differences[0].field === "duplicated")
      .map((item) => `${item.path} (present twice)`),
    ...diff.newSideExisting.missing.map(
      (p) => `${p} (new-folder entry missing)`,
    ),
    ...diff.foreign.missing.map((p) => `${p} (foreign missing)`),
  ];
  return bad.length
    ? fail("NO-LOSS", label, first(bad))
    : pass(
        "NO-LOSS",
        label,
        `${diff.owned.total} owned and ${diff.foreign.total} foreign entries accounted for.`,
      );
}

function renameChecks(diff) {
  const label =
    "Moves were renames: same inode and device, never copy-then-delete";
  if (diff.owned.movedClean.length + diff.owned.altered.length === 0)
    return unseen(
      "RENAME-NOT-COPY",
      label,
      "No entry moved, so rename behaviour was not exercised.",
    );
  return diff.owned.copied.length
    ? fail(
        "RENAME-NOT-COPY",
        label,
        `Inode changed: ${first(diff.owned.copied)}`,
      )
    : pass(
        "RENAME-NOT-COPY",
        label,
        `${diff.owned.movedClean.length} moved entries kept their inode.`,
      );
}

function movedAllChecks(diff, after, contract) {
  const label =
    "Every Colony-owned entry is present in the new folder, byte-identical";
  const problems = [
    ...diff.owned.leftInPlace.map((p) => `${p} (left in the old folder)`),
    ...diff.owned.altered.map(describeDifference),
    ...diff.owned.lost.map((p) => `${p} (lost)`),
    ...diff.owned.conflicts.map((c) => `${c.path} (conflict)`),
  ];
  if (diff.owned.total === 0)
    return [
      unseen("MOVED-ALL", label, "The old folder held no owned entries."),
    ];
  const rows = [
    problems.length
      ? fail(
          "MOVED-ALL",
          label,
          `${problems.length} problems: ${first(problems)}`,
        )
      : pass(
          "MOVED-ALL",
          label,
          `${diff.owned.movedClean.length} of ${diff.owned.total} owned entries moved clean.`,
        ),
  ];
  const stray = ownedLeftInOld(after, contract);
  rows.push(
    stray.length
      ? fail(
          "OLD-ONLY-FOREIGN",
          "The old folder keeps only foreign entries",
          `Owned entries still there: ${first(stray)}`,
        )
      : pass(
          "OLD-ONLY-FOREIGN",
          "The old folder keeps only foreign entries",
          "No allow-listed name remains in the old folder.",
        ),
  );
  return rows;
}

function pollutionChecks(diff) {
  const bad = [
    ...diff.addedToOld.map((p) => `${p} (new in old folder)`),
    ...diff.unexpectedInNew.map(
      (p) => `${p} (not Colony-owned, in new folder)`,
    ),
  ];
  return bad.length
    ? fail(
        "NO-POLLUTION",
        "The old folder gains nothing and the new folder holds only Colony-owned entries",
        first(bad),
      )
    : pass(
        "NO-POLLUTION",
        "The old folder gains nothing and the new folder holds only Colony-owned entries",
        "No unexpected entry in either folder.",
      );
}

function generatedChecks(diff, contract) {
  const label =
    "Generated skill entries: only the exact old entries removed, regenerated under the new name in the new folder";
  const expected = contract.generatedSkillLinks
    .map((link) => `${contract.oldNest}/${link}`)
    .sort();
  const removed = [...diff.generated.removed].sort();
  const extra = removed.filter((p) => !expected.includes(p));
  if (extra.length)
    return fail(
      "GENERATED-LINKS",
      label,
      `Removed more than the generated entries: ${first(extra)}`,
    );
  if (diff.generated.regenerated.length === 0)
    return fail(
      "GENERATED-LINKS",
      label,
      "No colony-cli skill was generated in the new folder.",
    );
  return pass(
    "GENERATED-LINKS",
    label,
    `${removed.length} old generated entries removed, ${diff.generated.regenerated.length} regenerated, foreign skills untouched.`,
  );
}

function archiveChecks(before, after, contract) {
  const label =
    "Archive history intact: DB, -wal and -shm moved together, same rows, integrity ok";
  const key = `${contract.oldNest}/archive/archive.db`;
  const was = before.databases?.[key];
  if (!was || was.absent)
    return unseen("ARCHIVE-INTACT", label, "The fixture has no archive.db.");
  const now = after.databases?.[`${contract.newNest}/archive/archive.db`];
  const leftovers = after.entries
    .filter((entry) => entry.path.startsWith(`${contract.oldNest}/archive/`))
    .map((entry) => entry.path);
  if (!now || now.absent)
    return fail(
      "ARCHIVE-INTACT",
      label,
      "archive.db is not in the new folder.",
    );
  if (now.error)
    return fail(
      "ARCHIVE-INTACT",
      label,
      `archive.db could not be read: ${now.error}`,
    );
  if (leftovers.length)
    return fail(
      "ARCHIVE-INTACT",
      label,
      `Archive files left behind, which splits history: ${first(leftovers)}`,
    );
  const missing = was.ids.filter((id) => !new Set(now.ids).has(id));
  if (missing.length)
    return fail(
      "ARCHIVE-INTACT",
      label,
      `${missing.length} archived events are gone (rows ${was.rows} to ${now.rows}).`,
    );
  if (now.integrity !== "ok")
    return fail(
      "ARCHIVE-INTACT",
      label,
      `integrity_check says ${now.integrity}`,
    );
  return pass(
    "ARCHIVE-INTACT",
    label,
    `${was.rows} rows before (wal ${was.walBytes} bytes), ${now.rows} after; every event id present; integrity ok.`,
  );
}

function linkChecks(diff, after) {
  const label =
    "Symlinks keep their meaning: relative links unchanged, absolute links into the moved tree rewritten, none left dangling";
  const links = after.entries.filter(
    (entry) =>
      entry.type === "symlink" &&
      (entry.path === ".colony/REPOS" ||
        entry.path.startsWith(".colony/REPOS/")),
  );
  if (!links.length)
    return unseen(
      "LINKS-MEANING",
      label,
      "No symlink in the moved REPOS folder.",
    );
  if (diff.owned.unresolvedLinks.length)
    return fail(
      "LINKS-MEANING",
      label,
      `Links that resolved before now dangle: ${first(diff.owned.unresolvedLinks.map((l) => `${l.path} -> ${l.target}`))}`,
    );
  const bad = diff.owned.altered.filter((item) =>
    links.some((l) => l.path === item.path),
  );
  if (bad.length)
    return fail("LINKS-MEANING", label, first(bad.map(describeDifference)));
  return pass(
    "LINKS-MEANING",
    label,
    `${links.length} links checked, ${diff.owned.rewrittenLinks.length} rewritten (${first(
      diff.owned.rewrittenLinks.map((l) => l.path),
      2,
    )}), none dangling that resolved before.`,
  );
}

function reposDirChecks(before, after, contract) {
  const label =
    ".repos-dir stays valid: a path inside the old folder is rewritten to the new folder";
  const was = before.files?.[`${contract.oldNest}/.repos-dir`];
  if (was === undefined)
    return unseen("REPOS-DIR", label, "The fixture has no .repos-dir.");
  const now = after.files?.[`${contract.newNest}/.repos-dir`];
  if (now === undefined)
    return fail("REPOS-DIR", label, ".repos-dir is not in the new folder.");
  const oldPrefix = `${before.home}/${contract.oldNest}`;
  const insideOld =
    was.trim() === oldPrefix || was.trim().startsWith(`${oldPrefix}/`);
  if (insideOld && now.trim().startsWith(oldPrefix))
    return fail(
      "REPOS-DIR",
      label,
      `Still points into the old folder: ${now.trim()}`,
    );
  if (!insideOld && now.trim() !== was.trim())
    return fail(
      "REPOS-DIR",
      label,
      `An outside path changed: ${was.trim()} to ${now.trim()}`,
    );
  return pass(
    "REPOS-DIR",
    label,
    insideOld
      ? `Rewritten to ${now.trim()}`
      : `Outside path unchanged: ${now.trim()}`,
  );
}

function modelChecks(diff, observations) {
  const label =
    "Huddle models not re-downloaded: model files moved byte-identical, no download or backup leftovers";
  const models = [
    ...diff.owned.movedClean,
    ...diff.owned.altered.map((i) => i.path),
  ].filter((p) => p.includes("/models/"));
  if (!models.length)
    return unseen(
      "MODELS-INTACT",
      label,
      "No model file in the fixture moved.",
    );
  const bad = [
    ...diff.owned.altered
      .filter((i) => i.path.includes("/models/"))
      .map(describeDifference),
    ...diff.createdInNew.filter((p) => p.includes("/models/")),
    ...(observations.hostLogLines ?? []).filter(
      (l) => /download/iu.test(l) && /model/iu.test(l),
    ),
  ];
  return bad.length
    ? fail("MODELS-INTACT", label, first(bad))
    : pass(
        "MODELS-INTACT",
        label,
        `${models.length} model files moved identical; no download activity in the host log.`,
      );
}

function journalChecks(observations, diff) {
  const label = "A durable journal and sentinel exist and list what moved";
  const { journal, sentinel } = observations;
  if (!journal && !sentinel)
    return fail(
      "JOURNAL-DURABLE",
      label,
      "Neither a journal nor a sentinel was found at any declared path.",
    );
  const names = diff.owned.movedClean
    .map((p) => p.split("/")[1])
    .filter((name, index, all) => all.indexOf(name) === index);
  const text = `${journal?.text ?? ""}\n${sentinel?.text ?? ""}`;
  const unlisted = names.filter((name) => !text.includes(name));
  return unlisted.length
    ? fail(
        "JOURNAL-DURABLE",
        label,
        `Moved but not recorded: ${first(unlisted)}`,
      )
    : pass(
        "JOURNAL-DURABLE",
        label,
        `Journal ${journal?.path ?? "none"}, sentinel ${sentinel?.path ?? "none"}; ${names.length} moved top-level entries are recorded.`,
      );
}

function noopChecks(afterFirst, afterSecond, contract) {
  const label = "Second launch is a no-op";
  if (!afterSecond)
    return unseen(
      "SECOND-LAUNCH-NOOP",
      label,
      "The app was not launched a second time.",
    );
  const stable = compareStable(afterFirst, afterSecond, contract);
  const bad = [
    ...stable.added.map((p) => `${p} (added)`),
    ...stable.removed.map((p) => `${p} (removed)`),
    ...stable.changed.map(describeDifference),
  ];
  return bad.length
    ? fail(
        "SECOND-LAUNCH-NOOP",
        label,
        `${bad.length} differences between launch 1 and 2: ${first(bad)}`,
      )
    : pass(
        "SECOND-LAUNCH-NOOP",
        label,
        `Tree identical after launch 2 (${afterSecond.entries.length} entries, archive compared by existence). Sentinel and journal unchanged.`,
      );
}

function reportedChecks(observations, expected, contract) {
  const label = `The app reports ${expected} as the nest (host log line)`;
  const choice = parseNestFolderLine(observations.hostLogLines ?? [], contract);
  if (!choice)
    return unseen(
      "NEST-REPORTED",
      label,
      "No nest-folder line in the host log.",
    );
  return choice.chosen === expected
    ? pass(
        "NEST-REPORTED",
        label,
        `chosen=${choice.chosen} reason=${choice.reason} path=${choice.path}`,
      )
    : fail(
        "NEST-REPORTED",
        label,
        `chosen=${choice.chosen} reason=${choice.reason}, expected ${expected}`,
      );
}

function uiChecks(observations) {
  const files = observations.ui?.filesTab;
  const agents = observations.ui?.agentsRestored;
  return [
    files
      ? files.listed > 0 && files.path?.includes(".colony")
        ? pass(
            "FILES-TAB",
            "Files tab lists the files of the new folder",
            `${files.listed} entries listed, root ${files.path}`,
          )
        : fail(
            "FILES-TAB",
            "Files tab lists the files of the new folder",
            JSON.stringify(files),
          )
      : unseen(
          "FILES-TAB",
          "Files tab lists the files of the new folder",
          "Needs a signed-in profile (--profile-dir). Not driven in this run.",
        ),
    agents
      ? agents.restored && agents.cwd?.includes(".colony")
        ? pass(
            "AGENTS-RESTORE",
            "Agents restore with the new folder as their working directory",
            JSON.stringify(agents),
          )
        : fail(
            "AGENTS-RESTORE",
            "Agents restore with the new folder as their working directory",
            JSON.stringify(agents),
          )
      : unseen(
          "AGENTS-RESTORE",
          "Agents restore with the new folder as their working directory",
          "Needs a signed-in profile with a managed agent (--profile-dir). Not driven in this run.",
        ),
  ];
}

const accountedFor = (diff) =>
  diff.owned.movedClean.length +
    diff.owned.leftInPlace.length +
    diff.owned.conflicts.length ===
  diff.owned.total;

/**
 * Evaluate one case.
 * @param {object} result
 * @param {string} result.kind migrate | crash | both | both-unrelated | colony-only | empty | readonly | running-agent | reset | flag-off
 * @param {object} result.before manifest before the first launch (with .databases and .files)
 * @param {object} result.after manifest after the first launch finished
 * @param {object} [result.after2] manifest after the second launch
 * @param {object} [result.afterKill] manifest right after the migration was killed
 * @param {object} result.observations
 */
export function evaluateCase(result, contract = defaultContract()) {
  const { kind, before, after, observations = {} } = result;
  const diff = diffNests({ before, after, contract });
  const rows = [];
  const withOld = [
    "migrate",
    "migrate-stale",
    "crash",
    "both",
    "both-unrelated",
    "readonly",
    "running-agent",
    "reset",
    "flag-off",
  ].includes(kind);

  if (kind === "colony-only") {
    const stable = compareStable(before, after, contract);
    const bad = [
      ...stable.removed.map((p) => `${p} (removed)`),
      ...stable.changed.map(describeDifference),
    ];
    rows.push(
      bad.length
        ? fail(
            "NOTHING-MIGRATED",
            "Only ~/.colony exists: nothing changes",
            first(bad),
          )
        : pass(
            "NOTHING-MIGRATED",
            "Only ~/.colony exists: nothing changes",
            "Every entry in ~/.colony unchanged.",
          ),
      diff.oldRoot.after
        ? fail(
            "NO-OLD-FOLDER",
            "~/.buzz is not created",
            "~/.buzz exists after the run.",
          )
        : pass(
            "NO-OLD-FOLDER",
            "~/.buzz is not created",
            "~/.buzz absent before and after.",
          ),
      !observations.journal && !observations.sentinel
        ? pass(
            "NO-JOURNAL",
            "No migration record is written when there is nothing to migrate",
            "No journal and no sentinel.",
          )
        : fail(
            "NO-JOURNAL",
            "No migration record is written when there is nothing to migrate",
            "A journal or sentinel exists.",
          ),
      reportedChecks(observations, ".colony", contract),
    );
    return { rows, diff };
  }

  if (kind === "empty") {
    const created = after.entries.some((e) => e.path === contract.newNest);
    rows.push(
      diff.oldRoot.after
        ? fail(
            "NO-OLD-FOLDER",
            "A fresh install never creates ~/.buzz",
            "~/.buzz exists after the run.",
          )
        : pass(
            "NO-OLD-FOLDER",
            "A fresh install never creates ~/.buzz",
            "~/.buzz absent before and after.",
          ),
      created
        ? pass(
            "FRESH-NEW-FOLDER",
            "A fresh install uses ~/.colony",
            "~/.colony exists after the run.",
          )
        : unseen(
            "FRESH-NEW-FOLDER",
            "A fresh install uses ~/.colony",
            "~/.colony was not created; the app may not have reached nest setup.",
          ),
      after.entries.some((e) => e.path.startsWith(".colony.staging"))
        ? fail(
            "NO-STAGING",
            "Nothing is staged for a fresh install",
            "A .colony.staging folder exists.",
          )
        : pass(
            "NO-STAGING",
            "Nothing is staged for a fresh install",
            "No staging folder.",
          ),
      !observations.journal && !observations.sentinel
        ? pass(
            "NO-JOURNAL",
            "Nothing is migrated for a fresh install",
            "No journal and no sentinel.",
          )
        : fail(
            "NO-JOURNAL",
            "Nothing is migrated for a fresh install",
            "A journal or sentinel exists.",
          ),
      reportedChecks(observations, ".colony", contract),
    );
    return { rows, diff };
  }

  if (withOld) {
    rows.push(foreignChecks(diff), scriptChecks(observations));
    // Reset deletes Colony-owned entries on purpose, so "nothing lost" does not apply to it.
    if (kind !== "reset") rows.push(noLossChecks(diff));
  }

  if (kind === "migrate") {
    rows.push(
      ...movedAllChecks(diff, after, contract),
      renameChecks(diff),
      pollutionChecks(diff),
      generatedChecks(diff, contract),
      archiveChecks(before, after, contract),
      linkChecks(diff, after),
      reposDirChecks(before, after, contract),
      modelChecks(diff, observations),
      journalChecks(observations, diff),
      reportedChecks(observations, ".colony", contract),
      ...uiChecks(observations),
      noopChecks(after, result.after2, contract),
    );
  }

  if (kind === "crash") {
    const killed = observations.killed;
    const killLabel =
      "The kill landed mid-migration: some entries moved, some not, journal written";
    if (!killed || !result.afterKill) {
      rows.push(
        unseen(
          "KILL-LANDED",
          killLabel,
          "The process was not killed between two journal entries (needs the crash hook, see contract.env.crashAfter).",
        ),
      );
    } else {
      const killDiff = diffNests({ before, after: result.afterKill, contract });
      const mid =
        killDiff.owned.movedClean.length > 0 &&
        killDiff.owned.leftInPlace.length > 0;
      rows.push(
        mid
          ? pass(
              "KILL-LANDED",
              killLabel,
              `${killDiff.owned.movedClean.length} owned entries moved and ${killDiff.owned.leftInPlace.length} still in the old folder at the kill; journal lines: ${killed.journalLines}.`,
            )
          : unseen(
              "KILL-LANDED",
              killLabel,
              `The kill landed ${killDiff.owned.movedClean.length === 0 ? "before the first" : "after the last"} move, so the resume path was not exercised.`,
            ),
      );
      const bad = [
        ...killDiff.owned.lost.map((p) => `${p} (lost)`),
        ...killDiff.owned.altered.map(describeDifference),
        ...killDiff.owned.copied.map((p) => `${p} (copied)`),
        ...killDiff.foreign.differences.map(describeDifference),
        ...killDiff.foreign.missing.map((p) => `${p} (foreign missing)`),
      ];
      rows.push(
        bad.length || !accountedFor(killDiff)
          ? fail(
              "KILL-NO-LOSS",
              "At the kill every entry is in exactly one place and foreign entries are untouched",
              first(bad.length ? bad : ["entries unaccounted for"]),
            )
          : pass(
              "KILL-NO-LOSS",
              "At the kill every entry is in exactly one place and foreign entries are untouched",
              "No loss, no duplication, no copy, foreign identical.",
            ),
      );
    }
    rows.push(
      ...movedAllChecks(diff, after, contract).map((r) => ({
        ...r,
        id: `RESUME-${r.id}`,
        label: `After relaunch: ${r.label}`,
      })),
      renameChecks(diff),
      archiveChecks(before, after, contract),
      linkChecks(diff, after),
      pollutionChecks(diff),
      journalChecks(observations, diff),
      noopChecks(after, result.after2, contract),
    );
  }

  if (kind === "both") {
    const sourceBad = diff.owned.conflicts.filter(
      (c) => !c.sourceIntact || !c.destinationKept,
    );
    rows.push(
      diff.owned.conflicts.length === 0
        ? unseen(
            "CONFLICTS-KEPT",
            "Entries that exist in both folders are never overwritten",
            "The fixture produced no conflicting entry.",
          )
        : sourceBad.length ||
            diff.newSideExisting.differences.length ||
            diff.newSideExisting.missing.length
          ? fail(
              "CONFLICTS-KEPT",
              "Entries that exist in both folders are never overwritten",
              first([
                ...sourceBad.map(
                  (c) => `${c.path} (source or destination gone)`,
                ),
                ...diff.newSideExisting.differences.map(describeDifference),
                ...diff.newSideExisting.missing,
              ]),
            )
          : pass(
              "CONFLICTS-KEPT",
              "Entries that exist in both folders are never overwritten",
              `${diff.owned.conflicts.length} conflicting entries (${first(
                diff.owned.conflicts.map((c) => c.path),
                3,
              )}): destination bytes unchanged, source intact.`,
            ),
      diff.owned.movedClean.length > 0
        ? pass(
            "NON-CONFLICTING-MOVED",
            "Entries without a conflict still move",
            `${diff.owned.movedClean.length} entries moved clean.`,
          )
        : fail(
            "NON-CONFLICTING-MOVED",
            "Entries without a conflict still move",
            "Nothing moved.",
          ),
      noticeCheck(
        observations,
        diff.owned.conflicts.map((c) => c.path.split("/")[1]),
      ),
      pollutionChecks(diff),
      archiveChecks(before, after, contract),
      reportedChecks(observations, ".colony", contract),
      noopChecks(after, result.after2, contract),
    );
  }

  if (kind === "both-unrelated") {
    rows.push(
      diff.newSideExisting.differences.length ||
        diff.newSideExisting.missing.length
        ? fail(
            "UNRELATED-KEPT",
            "An unrelated ~/.colony is never overwritten",
            first([
              ...diff.newSideExisting.differences.map(describeDifference),
              ...diff.newSideExisting.missing,
            ]),
          )
        : pass(
            "UNRELATED-KEPT",
            "An unrelated ~/.colony is never overwritten",
            "Its own entries are unchanged.",
          ),
      accountedFor(diff)
        ? pass(
            "STRATEGY-RECORDED",
            "The migration either merged into it or left everything with a notice",
            `${diff.owned.movedClean.length} moved, ${diff.owned.leftInPlace.length} left in place.`,
          )
        : fail(
            "STRATEGY-RECORDED",
            "The migration either merged into it or left everything with a notice",
            "Entries unaccounted for.",
          ),
      diff.owned.leftInPlace.length
        ? noticeCheck(observations, [".colony"])
        : unseen(
            "NOTICE",
            "A plain-language notice is surfaced when an entry is skipped",
            "Nothing was skipped.",
          ),
    );
  }

  if (kind === "readonly") {
    const moved = diff.owned.movedClean.length + diff.owned.altered.length;
    rows.push(
      moved === 0 && diff.owned.lost.length === 0
        ? pass(
            "FALLBACK-UNTOUCHED",
            "A read-only parent: the migration cannot start and nothing is touched",
            "No owned entry moved or changed.",
          )
        : fail(
            "FALLBACK-UNTOUCHED",
            "A read-only parent: the migration cannot start and nothing is touched",
            `${moved} entries moved or changed.`,
          ),
      observations.windowReached
        ? pass(
            "APP-STILL-WORKS",
            "The app keeps working on the old folder",
            "Main window reached.",
          )
        : observations.windowReached === false
          ? fail(
              "APP-STILL-WORKS",
              "The app keeps working on the old folder",
              "The app did not reach its main window.",
            )
          : unseen(
              "APP-STILL-WORKS",
              "The app keeps working on the old folder",
              "Window readiness was not observed.",
            ),
      reportedChecks(observations, ".buzz", contract),
      noticeCheck(observations, [".buzz", "colony"]),
    );
  }

  if (kind === "running-agent") {
    const agent = observations.agent;
    const label = "Never move under a running agent";
    if (!agent) {
      rows.push(
        unseen("NO-MOVE-UNDER-AGENT", label, "No agent process was started."),
      );
    } else {
      const moveWhileAlive = result.afterWhileAlive
        ? diffNests({ before, after: result.afterWhileAlive, contract }).owned
        : null;
      const movedCount = moveWhileAlive
        ? moveWhileAlive.movedClean.length + moveWhileAlive.altered.length
        : null;
      rows.push(
        movedCount === null
          ? unseen(
              "NO-MOVE-UNDER-AGENT",
              label,
              "No manifest was taken while the agent was alive.",
            )
          : agent.aliveAtManifest && movedCount > 0
            ? fail(
                "NO-MOVE-UNDER-AGENT",
                label,
                `${movedCount} entries moved while pid ${agent.pid} held the nest as its working directory.`,
              )
            : agent.aliveAtManifest
              ? pass(
                  "NO-MOVE-UNDER-AGENT",
                  label,
                  `Pid ${agent.pid} alive with cwd in the old nest and holding .scratch/held.lock; nothing moved (migration deferred). Host strategy line: ${agent.strategyLine ?? "none logged"}`,
                )
              : unseen(
                  "NO-MOVE-UNDER-AGENT",
                  label,
                  "The agent had already exited when the manifest was taken.",
                ),
      );
    }
    rows.push(
      ...movedAllChecks(diff, after, contract).map((r) => ({
        ...r,
        id: `LATER-${r.id}`,
        label: `After the agent stopped and the app relaunched: ${r.label}`,
      })),
      renameChecks(diff),
      noticeCheck(
        observations,
        ["agent", "running", "next"],
        "A plain-language notice says the move waits for the running agent",
      ),
    );
  }

  if (kind === "flag-off") {
    rows.push(
      diff.owned.movedClean.length + diff.owned.altered.length === 0 &&
        diff.owned.lost.length === 0
        ? pass(
            "KILL-SWITCH",
            "With the kill switch off nothing is migrated",
            "No entry moved; the old folder is unchanged.",
          )
        : fail(
            "KILL-SWITCH",
            "With the kill switch off nothing is migrated",
            `${diff.owned.movedClean.length} entries moved.`,
          ),
      reportedChecks(observations, ".buzz", contract),
      diff.oldRoot.after
        ? pass(
            "OLD-FOLDER-USED",
            "The app keeps using the old folder",
            "Old folder present.",
          )
        : fail(
            "OLD-FOLDER-USED",
            "The app keeps using the old folder",
            "Old folder gone.",
          ),
    );
  }

  if (kind === "reset") {
    const reset = observations.reset;
    const label = "Reset wipes only Colony-owned entries of the chosen folder";
    if (!reset?.performed) {
      rows.push(
        unseen(
          "RESET-OWNED-WIPED",
          label,
          reset?.reason ??
            "Reset was not driven (needs a signed-in profile, see --profile-dir).",
        ),
      );
    } else {
      const chosen = reset.chosen ?? contract.newNest;
      const left = after.entries
        .filter(
          (e) =>
            e.path.startsWith(`${chosen}/`) &&
            contract.ownedTopLevel.includes(
              e.path.slice(chosen.length + 1).split("/")[0],
            ),
        )
        .map((e) => e.path);
      rows.push(
        left.length
          ? fail(
              "RESET-OWNED-WIPED",
              label,
              `Owned entries survived Reset in ${chosen}: ${first(left)}`,
            )
          : pass(
              "RESET-OWNED-WIPED",
              label,
              `No allow-listed entry left in ${chosen}.`,
            ),
        resetCompletes(reset),
      );
    }
  }

  if (kind === "migrate-stale") {
    const refreshable = new Set([
      `${contract.newNest}/AGENTS.md`,
      `${contract.newNest}/.nest-agents-version`,
    ]);
    const problems = [
      ...diff.owned.leftInPlace.map((p) => `${p} (left in the old folder)`),
      ...diff.owned.lost.map((p) => `${p} (lost)`),
      ...diff.owned.altered
        .filter((item) => !refreshable.has(item.path))
        .map(describeDifference),
    ];
    const agents = after.files?.[`${contract.newNest}/AGENTS.md`];
    const note = observations.userNote;
    rows.push(
      noLossChecks(diff),
      problems.length
        ? fail(
            "MOVED-ALL-EXCEPT-REFRESHED",
            "Every owned entry moved; only AGENTS.md and its version stamp may be refreshed by the host",
            first(problems),
          )
        : pass(
            "MOVED-ALL-EXCEPT-REFRESHED",
            "Every owned entry moved; only AGENTS.md and its version stamp may be refreshed by the host",
            `${diff.owned.movedClean.length} moved clean, ${diff.owned.altered.length} refreshed by the host.`,
          ),
      agents === undefined || !note
        ? unseen(
            "USER-NOTES-KEPT",
            "Notes the owner wrote below the managed markers survive the move and the refresh",
            "AGENTS.md or the note text was not captured.",
          )
        : agents.includes(note) &&
            agents.indexOf(note) > agents.indexOf("<!-- END BUZZ MANAGED")
          ? pass(
              "USER-NOTES-KEPT",
              "Notes the owner wrote below the managed markers survive the move and the refresh",
              "The owner's note is still below the end marker in the new AGENTS.md.",
            )
          : fail(
              "USER-NOTES-KEPT",
              "Notes the owner wrote below the managed markers survive the move and the refresh",
              "The owner's note is missing or moved above the end marker.",
            ),
      archiveChecks(before, after, contract),
      reportedChecks(observations, ".colony", contract),
    );
  }

  return { rows, diff };
}

/** Reset must finish. A verification failure caused by the nest folder is a product defect, a keychain one is the sandbox. */
function resetCompletes(reset) {
  const label =
    "Reset completes: it does not keep the sentinel and retry at every launch";
  if (!reset.failedLine)
    return pass(
      "RESET-COMPLETES",
      label,
      "The host logged no verification failure.",
    );
  if (/nest_gone=false/u.test(reset.failedLine))
    return fail(
      "RESET-COMPLETES",
      label,
      `Reset reports failure because the nest folder still exists, so it would retry forever: ${reset.failedLine}`,
    );
  return unseen(
    "RESET-COMPLETES",
    label,
    `Verification failed for another reason (the sandbox denies the keychain): ${reset.failedLine}`,
  );
}

function noticeCheck(
  observations,
  needles,
  label = "A plain-language, non-blocking notice names what was skipped",
) {
  const text = `${observations.sentinel?.text ?? ""}\n${observations.journal?.text ?? ""}\n${(observations.hostLogLines ?? []).filter((l) => /nest-migration/iu.test(l)).join("\n")}`;
  if (!text.trim())
    return fail(
      "NOTICE",
      label,
      "No sentinel, journal or migration log line carries any notice.",
    );
  const hit = needles.filter((needle) =>
    text.toLowerCase().includes(String(needle).toLowerCase()),
  );
  return hit.length
    ? pass("NOTICE", label, `Notice mentions: ${first(hit)}.`)
    : fail(
        "NOTICE",
        label,
        `The record does not mention any of: ${first(needles)}.`,
      );
}

/** Overall verdict of a list of rows: FAIL beats NOT OBSERVED beats PASS. */
export function verdictOf(rows) {
  if (rows.some((r) => r.status === FAIL)) return FAIL;
  if (rows.some((r) => r.status === NOT_OBSERVED)) return NOT_OBSERVED;
  return PASS;
}
