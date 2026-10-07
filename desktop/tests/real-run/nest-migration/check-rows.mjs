// Row builders for the nest migration proof: one function per check, each turning observations into a row
// (PASS, FAIL or NOT OBSERVED). evaluateCase in checks.mjs composes them per case. Kept apart so each file
// stays well under the repository's size ceiling.
import { defaultContract } from "./contract.mjs";
import { compareStable, diffNests } from "./diff.mjs";
import { parseMigrationLines } from "./observe.mjs";

export const PASS = "PASS";
export const FAIL = "FAIL";
export const NOT_OBSERVED = "NOT OBSERVED";

export const row = (id, label, status, detail) => ({
  id,
  label,
  status,
  detail,
});
export const pass = (id, label, detail) => row(id, label, PASS, detail);
export const fail = (id, label, detail) => row(id, label, FAIL, detail);
export const unseen = (id, label, detail) =>
  row(id, label, NOT_OBSERVED, detail);
export const first = (items, count = 4) =>
  `${items.slice(0, count).join("; ")}${items.length > count ? `; and ${items.length - count} more` : ""}`;
export const describeDifference = (item) =>
  `${item.path} (${item.differences.map((d) => d.field).join(", ")})`;
export const topNames = (paths) => [
  ...new Set(paths.map((p) => p.split("/")[1]).filter(Boolean)),
];

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

/** Top-level owned names of the old nest as the fixture had them before the run. */
export function ownedNamesBefore(before, contract) {
  const prefix = `${contract.oldNest}/`;
  return [
    ...new Set(
      before.entries
        .filter((entry) => entry.path.startsWith(prefix))
        .map((entry) => entry.path.slice(prefix.length).split("/")[0])
        .filter((name) => contract.ownedTopLevel.includes(name)),
    ),
  ];
}

/** Entries of the old nest that are still owned names after the run. */
export function ownedLeftInOld(after, contract) {
  return after.entries
    .filter((entry) => {
      const prefix = `${contract.oldNest}/`;
      if (!entry.path.startsWith(prefix)) return false;
      const top = entry.path.slice(prefix.length).split("/")[0];
      return contract.ownedTopLevel.includes(top);
    })
    .map((entry) => entry.path);
}

export function foreignChecks(diff) {
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
        `${diff.foreign.identical} of ${diff.foreign.total} foreign entries identical (including .scratch, the venvs, the notes and the old generated skill entries).`,
      );
}

export function scriptChecks(observations) {
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

export function noLossChecks(diff) {
  const label =
    "Nothing lost: every old entry exists exactly once, at the old, staging or new place";
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

export function renameChecks(diff) {
  const label =
    "Moves were renames: same inode and device, never copy-then-delete";
  const moved =
    diff.owned.movedClean.length +
    diff.owned.staged.length +
    diff.owned.altered.length;
  if (moved === 0)
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
        `${diff.owned.movedClean.length + diff.owned.staged.length} moved entries kept their inode.`,
      );
}

export function movedAllChecks(diff, after, contract) {
  const label =
    "Every Colony-owned entry is present in the new folder, byte-identical";
  if (diff.owned.total === 0)
    return [
      unseen("MOVED-ALL", label, "The old folder held no owned entries."),
    ];
  const problems = [
    ...diff.owned.leftInPlace.map((p) => `${p} (left in the old folder)`),
    ...diff.owned.altered.map(describeDifference),
    ...diff.owned.lost.map((p) => `${p} (lost)`),
    ...diff.owned.conflicts.map((c) => `${c.path} (conflict)`),
    ...diff.owned.staged.map((p) => `${p} (still in staging)`),
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

export function stagingChecks(diff, contract) {
  const label = "The staging folder exists only while a run is in flight";
  return diff.stagingLeft
    ? fail(
        "NO-STAGING-LEFT",
        label,
        `${contract.stagingName} is still there after the run.`,
      )
    : pass("NO-STAGING-LEFT", label, `${contract.stagingName} is gone.`);
}

export function pollutionChecks(diff) {
  const label =
    "The old folder gains nothing and the new folder holds only Colony-owned entries";
  const bad = [
    ...diff.addedToOld.map((p) => `${p} (new in old folder)`),
    ...diff.unexpectedInNew.map(
      (p) => `${p} (not Colony-owned, in new folder)`,
    ),
  ];
  return bad.length
    ? fail("NO-POLLUTION", label, first(bad))
    : pass("NO-POLLUTION", label, "No unexpected entry in either folder.");
}

export function provisionedChecks(diff) {
  const label =
    "The new folder provisions its own skill; the old generated skill entries stay untouched";
  return diff.generated.regenerated.length
    ? pass(
        "GENERATED-PROVISIONED",
        label,
        `New folder has ${first(diff.generated.regenerated, 3)}. The old entries are covered by FOREIGN-IDENTICAL.`,
      )
    : fail(
        "GENERATED-PROVISIONED",
        label,
        "The new folder has no generated skill entry.",
      );
}

export function archiveChecks(before, after, contract) {
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
  const present = new Set(now.ids);
  const missing = was.ids.filter((id) => !present.has(id));
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

export function linkChecks(diff, after) {
  const label =
    "Symlinks keep their meaning: relative and outside links unchanged, none left dangling";
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
    `${links.length} links checked after the move, same text, none dangling that resolved before.`,
  );
}

export function reposDirChecks(before, after, contract) {
  const label =
    ".repos-dir moves unchanged and still names a folder that exists";
  const was = before.files?.[`${contract.oldNest}/.repos-dir`];
  if (was === undefined)
    return unseen("REPOS-DIR", label, "The fixture has no .repos-dir.");
  const now = after.files?.[`${contract.newNest}/.repos-dir`];
  if (now === undefined)
    return fail("REPOS-DIR", label, ".repos-dir is not in the new folder.");
  return now.trim() === was.trim()
    ? pass("REPOS-DIR", label, `Unchanged: ${now.trim()}`)
    : fail("REPOS-DIR", label, `Changed from ${was.trim()} to ${now.trim()}`);
}

export function modelChecks(diff, observations) {
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

/** journal.json: the durable record. For a finished run every moved entry is `published` and the phase is `done`. */
export function journalChecks(observations, diff, expectPhase) {
  const label = "A durable journal.json records the run and every moved entry";
  const record = observations.journal;
  if (!record?.json)
    return fail(
      "JOURNAL-DURABLE",
      label,
      "No readable <app data>/nest-migration/journal.json after the run.",
    );
  const journal = record.json;
  if (expectPhase && journal.phase !== expectPhase)
    return fail(
      "JOURNAL-DURABLE",
      label,
      `Journal phase is ${journal.phase}, expected ${expectPhase}.`,
    );
  if (expectPhase === "done") {
    const published = new Set(
      (journal.steps ?? [])
        .filter((s) => s.status === "published")
        .map((s) => s.name),
    );
    const names = topNames([
      ...diff.owned.movedClean,
      ...diff.owned.altered.map((i) => i.path),
    ]);
    const unlisted = names.filter((name) => !published.has(name));
    if (unlisted.length)
      return fail(
        "JOURNAL-DURABLE",
        label,
        `Moved but not recorded as published: ${first(unlisted)}`,
      );
    return pass(
      "JOURNAL-DURABLE",
      label,
      `${record.path}: phase done, ${published.size} steps published, all ${names.length} moved top-level entries recorded.`,
    );
  }
  return pass(
    "JOURNAL-DURABLE",
    label,
    `${record.path}: phase ${journal.phase}, ${(journal.steps ?? []).length} steps.`,
  );
}

/** notice.json: the plain-language, non-blocking notice. It must never name the old product. */
export function noticeChecks(
  observations,
  keyPrefix,
  label = "A plain-language notice is recorded for the person",
) {
  const record = observations.notice;
  if (!record?.json?.message)
    return fail("NOTICE", label, "No readable notice.json with a message.");
  const { key, message, acknowledged } = record.json;
  if (/buzz/iu.test(message))
    return fail(
      "NOTICE",
      label,
      `The notice names the old product: ${message}`,
    );
  if (keyPrefix && !String(key).startsWith(keyPrefix))
    return fail(
      "NOTICE",
      label,
      `Notice key is ${key}, expected it to start with ${keyPrefix}. Message: ${message}`,
    );
  if (acknowledged !== false)
    return fail(
      "NOTICE",
      label,
      `The notice is already acknowledged (${acknowledged}) before the person saw it.`,
    );
  return pass("NOTICE", label, `key ${key}: "${message}"`);
}

export function outcomeChecks(
  lines,
  expected,
  { moved, skipped, detail } = {},
  id = "OUTCOME",
) {
  const label = `The migration logs outcome=${Array.isArray(expected) ? expected.join(" or ") : expected}`;
  const found = parseMigrationLines(lines ?? []);
  if (!found.length)
    return unseen(id, label, "No nest-migration result line in the host log.");
  const last = found[found.length - 1];
  const ok = Array.isArray(expected)
    ? expected.includes(last.outcome)
    : last.outcome === expected;
  const problems = [];
  if (!ok) problems.push(`got outcome=${last.outcome}`);
  if (ok && moved !== undefined && last.moved !== moved)
    problems.push(`moved=${last.moved}, expected ${moved}`);
  if (ok && skipped !== undefined && last.skipped !== skipped)
    problems.push(`skipped=${last.skipped}, expected ${skipped}`);
  if (ok && detail && !last.detail.includes(detail))
    problems.push(`detail "${last.detail}" lacks "${detail}"`);
  const line = `outcome=${last.outcome} moved=${last.moved} skipped=${last.skipped} detail=${last.detail}`;
  return problems.length
    ? fail(id, label, `${problems.join("; ")} (line: ${line})`)
    : pass(id, label, line);
}

export function noopChecks(
  afterFirst,
  afterSecond,
  lines2,
  expectedOutcomes,
  contract,
) {
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
  if (bad.length)
    return fail(
      "SECOND-LAUNCH-NOOP",
      label,
      `${bad.length} differences between launch 1 and 2: ${first(bad)}`,
    );
  const found = parseMigrationLines(lines2 ?? []);
  const last = found[found.length - 1];
  if (!last)
    return unseen(
      "SECOND-LAUNCH-NOOP",
      label,
      "The tree is identical after launch 2, but the host log has no migration line to confirm the outcome.",
    );
  return expectedOutcomes.includes(last.outcome)
    ? pass(
        "SECOND-LAUNCH-NOOP",
        label,
        `Tree identical after launch 2 (${afterSecond.entries.length} entries, archive compared by existence); launch 2 logged outcome=${last.outcome}.`,
      )
    : fail(
        "SECOND-LAUNCH-NOOP",
        label,
        `Tree identical, but launch 2 logged outcome=${last.outcome}, expected ${expectedOutcomes.join(" or ")}.`,
      );
}

export function reportedChecks(observations, expected, contract) {
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

export function uiChecks(observations) {
  const files = observations.ui?.filesTab;
  const agents = observations.ui?.agentsRestored;
  const filesLabel = "Files tab lists the migrated entries";
  const agentsLabel =
    "Agents restore with the new folder as their working directory";
  const noProfile =
    "Needs a signed-in profile (--profile-dir). Not driven in this run.";
  let filesRow;
  if (!files) filesRow = unseen("FILES-TAB", filesLabel, noProfile);
  else if (files.names?.length)
    filesRow = pass(
      "FILES-TAB",
      filesLabel,
      `The Files tab shows ${files.names.join(", ")}.`,
    );
  else
    filesRow = unseen(
      "FILES-TAB",
      filesLabel,
      files.opened
        ? `The Files tab opened but shows none of the migrated names, so it cannot judge them (it may list conversations only). Sample: ${files.sample}`
        : `The Files tab could not be opened: ${files.error}`,
    );
  let agentsRow;
  if (!agents) agentsRow = unseen("AGENTS-RESTORE", agentsLabel, noProfile);
  else if (!agents.restored)
    agentsRow = unseen("AGENTS-RESTORE", agentsLabel, agents.note);
  else if (
    agents.cwds?.every((cwd) => cwd?.includes("/.colony")) ??
    agents.cwd?.includes("/.colony")
  )
    agentsRow = pass(
      "AGENTS-RESTORE",
      agentsLabel,
      `Agent pid ${agents.pids?.join(", ")} restored with cwd ${agents.cwd}.`,
    );
  else
    agentsRow = fail(
      "AGENTS-RESTORE",
      agentsLabel,
      `An agent restored with cwd ${agents.cwd}, not the new folder.`,
    );
  return [filesRow, agentsRow];
}

export const nothingMoved = (diff) =>
  diff.owned.movedClean.length +
    diff.owned.staged.length +
    diff.owned.altered.length ===
    0 && diff.owned.lost.length === 0;

/** Reset must finish. A verification failure caused by the nest folder is a product defect, a keychain one is the sandbox. */
export function resetCompletes(reset) {
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

export function crashRows(result, contract, observations) {
  const { before } = result;
  const rows = [];
  const killed = observations.killed;
  const killLabel =
    "The kill landed mid-migration: some entries staged, the journal written before each move";
  if (!killed || !result.afterKill) {
    rows.push(
      unseen(
        "KILL-LANDED",
        killLabel,
        "The process was not stopped between two journal entries.",
      ),
    );
  } else {
    const killDiff = diffNests({ before, after: result.afterKill, contract });
    const inFlight =
      killDiff.owned.staged.length + killDiff.owned.movedClean.length;
    const pending = killDiff.owned.leftInPlace.length;
    const hook =
      killed.exitCode === contract.env.crashExitCode || killed.seamLine;
    rows.push(
      hook && inFlight > 0 && pending > 0
        ? pass(
            "KILL-LANDED",
            killLabel,
            `Exit code ${killed.exitCode} from the crash seam (${killed.crashAt}); ${inFlight} owned entries staged or moved and ${pending} still in the old folder at the kill.`,
          )
        : unseen(
            "KILL-LANDED",
            killLabel,
            `${hook ? "The seam fired" : `Process ended by ${killed.by} (exit ${killed.exitCode})`}, but ${inFlight === 0 ? "before the first entry moved" : pending === 0 ? "after the last entry moved" : "without the crash seam"}, so the resume path was not exercised.`,
          ),
    );
    // The journal is written before each move: any entry that left the old folder has a non-pending step.
    const journal = killed.journal?.json;
    const movedAway = topNames([
      ...killDiff.owned.staged,
      ...killDiff.owned.movedClean,
    ]);
    const stepOf = new Map(
      (journal?.steps ?? []).map((step) => [step.name, step.status]),
    );
    const unjournaled = movedAway.filter(
      (name) => !stepOf.has(name) || stepOf.get(name) === "pending",
    );
    const journalLabel = "The journal was written before each move";
    rows.push(
      !journal
        ? fail(
            "KILL-JOURNAL-FIRST",
            journalLabel,
            "No journal.json existed at the kill.",
          )
        : unjournaled.length
          ? fail(
              "KILL-JOURNAL-FIRST",
              journalLabel,
              `Entries left the old folder without a journal step: ${first(unjournaled)}`,
            )
          : pass(
              "KILL-JOURNAL-FIRST",
              journalLabel,
              `Journal phase ${journal.phase}; every one of the ${movedAway.length} entries that left the old folder has a step (${[
                ...stepOf,
              ]
                .map(([n, s]) => `${n}:${s}`)
                .slice(0, 4)
                .join(", ")}...).`,
            ),
    );
    const bad = [
      ...killDiff.owned.lost.map((p) => `${p} (lost)`),
      ...killDiff.owned.altered.map(describeDifference),
      ...killDiff.owned.copied.map((p) => `${p} (copied)`),
      ...killDiff.foreign.differences.map(describeDifference),
      ...killDiff.foreign.missing.map((p) => `${p} (foreign missing)`),
    ];
    const lossLabel =
      "At the kill every entry is in exactly one place and foreign entries are untouched";
    rows.push(
      bad.length
        ? fail("KILL-NO-LOSS", lossLabel, first(bad))
        : pass(
            "KILL-NO-LOSS",
            lossLabel,
            "No loss, no duplication, no copy, foreign identical.",
          ),
    );
  }
  return rows;
}

/**
 * A REPOS that stays in the old folder must stay in use: the new folder holds a `.repos-dir` naming the old
 * REPOS, and once the host has booted, its REPOS is a link to those clones. A new folder with an empty REPOS
 * beside clones left behind is the split state this row exists to catch.
 */
export function reposPointerRows(after, observations, contract) {
  const label =
    "The new folder points at the REPOS that stayed behind, so agents keep their clones";
  const pointer = after.files?.[`${contract.newNest}/.repos-dir`];
  const named = typeof pointer === "string" ? pointer.trim() : "";
  const oldRepos = `/${contract.oldNest}/REPOS`;
  const pointed = named.startsWith("/") && named.endsWith(oldRepos);
  const link = after.entries.find(
    (e) => e.path === `${contract.newNest}/REPOS`,
  );
  const message = String(observations.notice?.json?.message ?? "");
  return [
    pointed
      ? pass(
          "REPOS-POINTER",
          label,
          `${contract.newNest}/.repos-dir names ${named}.`,
        )
      : fail(
          "REPOS-POINTER",
          label,
          pointer === undefined
            ? `${contract.newNest}/.repos-dir is missing: the new nest would start with an empty REPOS.`
            : `${contract.newNest}/.repos-dir holds ${JSON.stringify(named)}, not the old REPOS.`,
        ),
    !link
      ? unseen(
          "REPOS-IN-USE",
          "After the host booted, the new folder's REPOS is the old clones",
          `${contract.newNest}/REPOS does not exist (the host's REPOS boot step was not observed).`,
        )
      : link.target?.endsWith(oldRepos) && link.resolves
        ? pass(
            "REPOS-IN-USE",
            "After the host booted, the new folder's REPOS is the old clones",
            `${link.path} -> ${link.target} resolves.`,
          )
        : fail(
            "REPOS-IN-USE",
            "After the host booted, the new folder's REPOS is the old clones",
            `${link.path} is ${link.target ? `a link to ${link.target}` : "not a link"}: an empty REPOS beside clones that stayed behind.`,
          ),
    /repositories/iu.test(message) && /still use/iu.test(message)
      ? pass(
          "NOTICE-HONEST",
          "The notice says the repositories folder stayed and is still used",
          message,
        )
      : fail(
          "NOTICE-HONEST",
          "The notice says the repositories folder stayed and is still used",
          `Notice reads: ${message || "(none)"}`,
        ),
  ];
}

export function heldBackRows(
  diff,
  after,
  before,
  contract,
  observations,
  lines,
  names,
) {
  const heldBack = diff.owned.leftInPlace.filter(
    (p) => p === ".buzz/REPOS" || p.startsWith(".buzz/REPOS/"),
  );
  const others = diff.owned.leftInPlace.filter((p) => !heldBack.includes(p));
  const link = after.entries.find((e) => e.path === ".buzz/REPOS/kit-absolute");
  const heldLabel =
    "An entry with a link that names the old folder is held back whole, intact, and everything else moves";
  return [
    heldBack.length &&
    !others.length &&
    !diff.owned.altered.length &&
    !diff.owned.lost.length
      ? pass(
          "HELD-BACK",
          heldLabel,
          `${heldBack.length} paths of REPOS stayed in the old folder untouched; ${diff.owned.movedClean.length} other entries moved clean.`,
        )
      : fail(
          "HELD-BACK",
          heldLabel,
          `held ${heldBack.length}, other entries left ${first(others)}, altered ${diff.owned.altered.length}, lost ${diff.owned.lost.length}`,
        ),
    link?.resolves
      ? pass(
          "LINKS-MEANING",
          "The held-back link still resolves",
          `${link.path} -> ${link.target} resolves.`,
        )
      : fail(
          "LINKS-MEANING",
          "The held-back link still resolves",
          link
            ? `${link.path} -> ${link.target} dangles.`
            : "The link is gone.",
        ),
    renameChecks(diff),
    stagingChecks(diff, contract),
    pollutionChecks(diff),
    archiveChecks(before, after, contract),
    journalChecks(observations, diff, "done"),
    reposPointerRows(after, observations, contract),
    noticeChecks(
      observations,
      "migrated-repos-in-place",
      "A plain-language notice says the repositories folder stayed and agents still use it",
    ),
    outcomeChecks(lines, "migrated", { skipped: 1, moved: names.length - 1 }),
    reportedChecks(observations, ".colony", contract),
    noopChecks(
      after,
      observations.after2,
      observations.hostLogLines2,
      ["already-migrated"],
      contract,
    ),
  ].flat();
}
