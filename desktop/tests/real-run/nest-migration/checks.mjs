// The checks encoded from the design page "Gate 3: PR 2 on seeded HOMEs", the migration rules in the brief and
// Worker M1's contract (briefs-20261004/nest-migration-contract-M1.md). Each check turns observations into one
// row: PASS, FAIL or NOT OBSERVED. A check never reports PASS without an observation behind it: missing
// evidence is NOT OBSERVED, which the report shows as a gap and never as success. Pure functions, unit tested
// without any app (checks.test.mjs).
import { defaultContract } from "./contract.mjs";
import { compareStable, diffNests } from "./diff.mjs";
import { parseMigrationLines } from "./observe.mjs";
import {
  FAIL,
  NOT_OBSERVED,
  PASS,
  archiveChecks,
  crashRows,
  describeDifference,
  fail,
  first,
  foreignChecks,
  heldBackRows,
  journalChecks,
  linkChecks,
  modelChecks,
  movedAllChecks,
  noLossChecks,
  noopChecks,
  nothingMoved,
  noticeChecks,
  outcomeChecks,
  ownedNamesBefore,
  parseNestFolderLine,
  pass,
  pollutionChecks,
  provisionedChecks,
  renameChecks,
  reportedChecks,
  reposDirChecks,
  resetCompletes,
  scriptChecks,
  stagingChecks,
  uiChecks,
  unseen,
} from "./check-rows.mjs";


// ---- Delta gate: precise AGENTS.md assertions (coordinator 00:34) ----
const COLONY_BEGIN = /<!--\s*BEGIN\s+COLONY\s+MANAGED/gu;
const COLONY_END = /<!--\s*END\s+COLONY\s+MANAGED/gu;
const BUZZ_MARK = /<!--\s*(BEGIN|END)\s+BUZZ\s+MANAGED/gu;
const countOf = (text, re) => (text.match(re) ?? []).length;

/** Text above the first BEGIN marker, below the last END marker, and the marker counts. */
export function managedParts(text) {
  const begin = text.search(/<!--\s*BEGIN\s+(COLONY|BUZZ)\s+MANAGED/u);
  const ends = [...text.matchAll(/<!--\s*END\s+(COLONY|BUZZ)\s+MANAGED\s*-->/gu)];
  const last = ends[ends.length - 1];
  return {
    above: begin >= 0 ? text.slice(0, begin) : null,
    below: last ? text.slice(last.index + last[0].length) : null,
    colonyBegin: countOf(text, COLONY_BEGIN),
    colonyEnd: countOf(text, COLONY_END),
    buzzMarkers: countOf(text, BUZZ_MARK),
  };
}

/** Plain line diff (LCS), enough for a 70 line file. Lines only in `a` start with "- ", only in `b` with "+ ". */
export function lineDiff(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  const table = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i -= 1)
    for (let j = y.length - 1; j >= 0; j -= 1)
      table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push(`- ${x[i]}`); i += 1; }
    else { out.push(`+ ${y[j]}`); j += 1; }
  }
  while (i < x.length) { out.push(`- ${x[i]}`); i += 1; }
  while (j < y.length) { out.push(`+ ${y[j]}`); j += 1; }
  return out.join("\n");
}

/**
 * Precise verdict for an AGENTS.md the host refreshed: owner text above the managed section and below it byte identical to
 * the original, exactly one managed section with COLONY markers, no old marker. The change itself is printed as a line diff.
 */
export function agentsMdVerdict(originalText, nowText) {
  if (typeof originalText !== "string" || typeof nowText !== "string")
    return { ok: false, seen: false, detail: "AGENTS.md text was not captured before or after." };
  const a = managedParts(originalText);
  const b = managedParts(nowText);
  const aboveSame = a.above !== null && a.above === b.above;
  const belowSame = a.below !== null && a.below === b.below;
  const one = b.colonyBegin === 1 && b.colonyEnd === 1 && b.buzzMarkers === 0;
  const ok = aboveSame && belowSame && one;
  const quote = (t) => JSON.stringify((t ?? "").slice(0, 400));
  return {
    ok,
    seen: true,
    detail: `Text above the managed section byte identical: ${aboveSame}; text below it byte identical: ${belowSame}; COLONY section count ${b.colonyBegin} begin and ${b.colonyEnd} end, old BUZZ markers ${b.buzzMarkers}. Notes above, quoted: ${quote(b.above)}. Notes below, quoted: ${quote(b.below)}. Before/after line diff of the whole file:\n${lineDiff(originalText, nowText)}`,
  };
}
const STRICT_CHECKS = process.env.NEST_STRICT === "1";
export { FAIL, NOT_OBSERVED, PASS, parseNestFolderLine };

/**
 * Evaluate one case.
 * @param {object} result
 * @param {string} result.kind migrate | migrate-stale | crash | both | both-unrelated | aborted | held-back |
 *   colony-only | empty | readonly | running-agent | reset | flag-off
 * @param {object} result.before manifest before the first launch (with .databases and .files)
 * @param {object} result.after manifest after the first launch finished
 * @param {object} [result.after2] manifest after the second launch
 * @param {object} [result.afterKill] manifest right after the migration was killed
 * @param {object} result.observations
 */
export function evaluateCase(result, baseContract = defaultContract()) {
  const { kind, before, after, observations = {} } = result;
  // Reset is the one flow that removes the old generated skill entries, so they are not foreign there.
  const contract =
    kind === "reset"
      ? { ...baseContract, generatedPolicy: "remove" }
      : baseContract;
  const diff = diffNests({ before, after, contract });
  const rows = [];
  const withOld = [
    "migrate",
    "migrate-stale",
    "crash",
    "both",
    "both-unrelated",
    "aborted",
    "held-back",
    "readonly",
    "running-agent",
    "reset",
    "flag-off",
  ].includes(kind);
  const lines = observations.hostLogLines ?? [];
  const found = parseMigrationLines(lines, contract);
  const names = ownedNamesBefore(before, contract);
  const secondLines = observations.hostLogLines2;
  const noop = (outcomes) =>
    noopChecks(after, result.after2, secondLines, outcomes, contract);

  if (kind === "colony-only" || kind === "empty") {
    const lineOk = found.every((f) =>
      ["not-applicable", "nothing-to-migrate"].includes(f.outcome),
    );
    const stable = compareStable(before, after, contract);
    const bad = [
      ...stable.removed.map((p) => `${p} (removed)`),
      ...stable.changed.map(describeDifference),
    ];
    if (kind === "colony-only")
      rows.push(
        bad.length
          ? fail(
              "NOTHING-MIGRATED",
              "Only ~/.colony exists: nothing in it changes",
              first(bad),
            )
          : pass(
              "NOTHING-MIGRATED",
              "Only ~/.colony exists: nothing in it changes",
              "Every entry in ~/.colony unchanged.",
            ),
      );
    else {
      const created = after.entries.some((e) => e.path === contract.newNest);
      rows.push(
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
      );
    }
    const noJournalLabel =
      "Nothing is staged or journaled when there is nothing to migrate";
    rows.push(
      diff.oldRoot.after
        ? fail(
            "NO-OLD-FOLDER",
            "~/.buzz is never created",
            "~/.buzz exists after the run.",
          )
        : pass(
            "NO-OLD-FOLDER",
            "~/.buzz is never created",
            "~/.buzz absent before and after.",
          ),
      diff.stagingLeft || observations.journal
        ? fail(
            "NO-JOURNAL",
            noJournalLabel,
            "A staging folder or journal exists.",
          )
        : pass(
            "NO-JOURNAL",
            noJournalLabel,
            "No staging folder and no journal.",
          ),
      lineOk
        ? pass(
            "NO-MIGRATION",
            "The migration does not run",
            found.length
              ? `Logged ${found.map((f) => f.outcome).join(", ")}.`
              : "No migration line logged.",
          )
        : fail(
            "NO-MIGRATION",
            "The migration does not run",
            `Logged ${found.map((f) => f.outcome).join(", ")}.`,
          ),
      reportedChecks(observations, ".colony", contract),
    );
    return { rows, diff };
  }

  if (withOld) rows.push(foreignChecks(diff), scriptChecks(observations));
  // Reset deletes Colony-owned entries on purpose, so "nothing lost" does not apply to it.
  if (withOld && kind !== "reset") rows.push(noLossChecks(diff));

  if (kind === "migrate") {
    rows.push(
      ...movedAllChecks(diff, after, contract),
      renameChecks(diff),
      stagingChecks(diff, contract),
      pollutionChecks(diff),
      provisionedChecks(diff),
      (() => {
        const v = agentsMdVerdict(
          before.files?.[`${contract.oldNest}/AGENTS.md`],
          after.files?.[`${contract.newNest}/AGENTS.md`],
        );
        const label =
          "AGENTS.md after the move: owner notes above and below the managed section byte identical, one COLONY section, no old marker";
        return !v.seen ? unseen("AGENTS-NOTES-BYTES", label, v.detail) : v.ok ? pass("AGENTS-NOTES-BYTES", label, v.detail) : fail("AGENTS-NOTES-BYTES", label, v.detail);
      })(),
      archiveChecks(before, after, contract),
      linkChecks(diff, after),
      reposDirChecks(before, after, contract),
      modelChecks(diff, observations),
      journalChecks(observations, diff, "done"),
      noticeChecks(observations, "migrated"),
      outcomeChecks(lines, "migrated", { moved: names.length, skipped: 0 }),
      reportedChecks(observations, ".colony", contract),
      ...uiChecks(observations),
      noop(["already-migrated"]),
    );
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
    const movedLabel =
      "Every owned entry moved; only AGENTS.md and its version stamp may be refreshed by the host";
    const notesLabel =
      "Notes the owner wrote below the managed markers survive the move and the refresh";
    const markersLabel =
      "After the refresh AGENTS.md holds one managed section with the Colony markers and no old marker";
    const endMarker = "<!-- END COLONY MANAGED -->";
    const beginMarker = "<!-- BEGIN COLONY MANAGED";
    const count = (text, needle) => text.split(needle).length - 1;
    rows.push(
      problems.length
        ? fail("MOVED-ALL-EXCEPT-REFRESHED", movedLabel, first(problems))
        : pass(
            "MOVED-ALL-EXCEPT-REFRESHED",
            movedLabel,
            `${diff.owned.movedClean.length} moved clean, ${diff.owned.altered.length} refreshed by the host.`,
          ),
      agents === undefined || !note
        ? unseen(
            "USER-NOTES-KEPT",
            notesLabel,
            "AGENTS.md or the note text was not captured.",
          )
        : agents.includes(note) &&
            agents.indexOf(endMarker) >= 0 &&
            agents.indexOf(note) > agents.indexOf(endMarker)
          ? pass(
              "USER-NOTES-KEPT",
              notesLabel,
              "The owner's note is still below the end marker in the new AGENTS.md.",
            )
          : fail(
              "USER-NOTES-KEPT",
              notesLabel,
              "The owner's note is missing or moved above the end marker.",
            ),
      agents === undefined
        ? unseen(
            "COLONY-MARKERS-ONLY",
            markersLabel,
            "AGENTS.md was not captured.",
          )
        : count(agents, beginMarker) === 1 &&
            count(agents, endMarker) === 1 &&
            !/<!-- (BEGIN|END) BUZZ MANAGED/.test(agents)
          ? pass(
              "COLONY-MARKERS-ONLY",
              markersLabel,
              "One Colony section, no old marker left behind.",
            )
          : fail(
              "COLONY-MARKERS-ONLY",
              markersLabel,
              `Colony begin markers ${count(agents, beginMarker)}, end markers ${count(agents, endMarker)}, old marker present ${/<!-- (BEGIN|END) BUZZ MANAGED/.test(agents)}.`,
            ),
      archiveChecks(before, after, contract),
      stagingChecks(diff, contract),
      outcomeChecks(lines, "migrated"),
      reportedChecks(observations, ".colony", contract),
    );
  }

  if (kind === "crash") {
    rows.push(
      ...crashRows(result, contract, observations),
      ...movedAllChecks(diff, after, contract).map((r) => ({
        ...r,
        id: `RESUME-${r.id}`,
        label: `After relaunch: ${r.label}`,
      })),
      renameChecks(diff),
      stagingChecks(diff, contract),
      archiveChecks(before, after, contract),
      linkChecks(diff, after),
      pollutionChecks(diff),
      journalChecks(observations, diff, "done"),
      outcomeChecks(lines, "migrated", {}, "RESUME-OUTCOME"),
      noop(["already-migrated"]),
    );
  }

  if (kind === "both") {
    const sourceBad = diff.owned.conflicts.filter(
      (c) => !c.sourceIntact || !c.destinationKept,
    );
    const conflictNames = diff.owned.conflicts.map((c) => c.path.split("/")[1]);
    const keptLabel =
      "Entries that exist in both folders are never overwritten";
    // Delta gate: the destination AGENTS.md may have its managed block refreshed by the host (markers rewritten in place)
    // only if everything outside the managed section is byte identical, and the migration itself overwrote nothing.
    const destAgents = `${contract.newNest}/AGENTS.md`;
    const destVerdict = agentsMdVerdict(before.files?.[destAgents], after.files?.[destAgents]);
    const journalSteps = observations.journal?.json?.steps ?? [];
    const agentsStep = journalSteps.find((step) => step.name === "AGENTS.md");
    const migrationOverwroteNothing = sourceBad.length === 0 && (!agentsStep || agentsStep.status !== "published");
    const narrowedDiffs = STRICT_CHECKS
      ? diff.newSideExisting.differences
      : diff.newSideExisting.differences.filter(
          (item) => !(item.path === destAgents && destVerdict.ok && migrationOverwroteNothing),
        );
    const refreshedNote =
      !STRICT_CHECKS && destVerdict.seen && narrowedDiffs.length !== diff.newSideExisting.differences.length
        ? ` The destination ${destAgents} was refreshed by the host, not overwritten by the migration (journal step AGENTS.md: ${agentsStep?.status ?? "none"}, conflicts with source intact and destination kept: ${diff.owned.conflicts.length}). ${destVerdict.detail}`
        : "";
    const movedLabel =
      "Entries without a conflict still move, an empty placeholder is replaced";
    rows.push(
      diff.owned.conflicts.length === 0
        ? unseen(
            "CONFLICTS-KEPT",
            keptLabel,
            "The fixture produced no conflicting entry.",
          )
        : sourceBad.length ||
            narrowedDiffs.length ||
            diff.newSideExisting.missing.length
          ? fail(
              "CONFLICTS-KEPT",
              keptLabel,
              first([
                ...sourceBad.map(
                  (c) => `${c.path} (source or destination gone)`,
                ),
                ...narrowedDiffs.map(describeDifference),
                ...diff.newSideExisting.missing,
              ]),
            )
          : pass(
              "CONFLICTS-KEPT",
              keptLabel,
              `${diff.owned.conflicts.length} conflicting entries (${first(conflictNames, 3)}): the new folder's bytes unchanged, the old source intact.${refreshedNote}`,
            ),
      diff.owned.movedClean.length > 0
        ? pass(
            "NON-CONFLICTING-MOVED",
            movedLabel,
            `${diff.owned.movedClean.length} entries moved clean.`,
          )
        : fail("NON-CONFLICTING-MOVED", movedLabel, "Nothing moved."),
      stagingChecks(diff, contract),
      pollutionChecks(diff),
      archiveChecks(before, after, contract),
      journalChecks(observations, diff, "done"),
      noticeChecks(
        observations,
        "left:",
        "A plain-language notice says some items stayed where they were",
      ),
      outcomeChecks(lines, "migrated", { skipped: conflictNames.length }),
      reportedChecks(observations, ".colony", contract),
      noop(["left-in-place"]),
    );
  }

  if (kind === "both-unrelated") {
    const keptLabel = "An unrelated ~/.colony is never overwritten";
    rows.push(
      diff.newSideExisting.differences.length ||
        diff.newSideExisting.missing.length
        ? fail(
            "UNRELATED-KEPT",
            keptLabel,
            first([
              ...diff.newSideExisting.differences.map(describeDifference),
              ...diff.newSideExisting.missing,
            ]),
          )
        : pass("UNRELATED-KEPT", keptLabel, "Its own entries are unchanged."),
      ...movedAllChecks(diff, after, contract),
      renameChecks(diff),
      stagingChecks(diff, contract),
      pollutionChecks(diff),
      archiveChecks(before, after, contract),
      journalChecks(observations, diff, "done"),
      outcomeChecks(lines, "migrated", { moved: names.length }),
      reportedChecks(observations, ".colony", contract),
      noop(["already-migrated"]),
    );
  }

  if (kind === "aborted") {
    const stopLabel =
      "A hold on a small entry stops the whole migration: nothing moves";
    rows.push(
      nothingMoved(diff) && !diff.stagingLeft
        ? pass(
            "NOTHING-MOVED",
            stopLabel,
            "No owned entry moved or changed; no staging folder.",
          )
        : fail(
            "NOTHING-MOVED",
            stopLabel,
            `${diff.owned.movedClean.length + diff.owned.staged.length} entries moved or staged.`,
          ),
      outcomeChecks(lines, "aborted", {
        moved: 0,
        detail: observations.expectDetail ?? "repos-dir-inside-old-folder",
      }),
      noticeChecks(
        observations,
        "aborted:",
        "A plain-language notice says Colony is still using the existing folder",
      ),
      reportedChecks(observations, ".buzz", contract),
      noop(["aborted"]),
    );
  }

  if (kind === "held-back")
    rows.push(
      ...heldBackRows(
        diff,
        after,
        before,
        contract,
        { ...observations, after2: result.after2 },
        lines,
        names,
      ),
    );

  if (kind === "readonly") {
    const untouchedLabel =
      "A read-only parent: the new folder cannot be created and nothing is touched";
    const workLabel = "The app keeps working on the old folder";
    rows.push(
      nothingMoved(diff) && !diff.stagingLeft
        ? pass(
            "FALLBACK-UNTOUCHED",
            untouchedLabel,
            "No owned entry moved or changed; no staging folder.",
          )
        : fail(
            "FALLBACK-UNTOUCHED",
            untouchedLabel,
            `${diff.owned.movedClean.length + diff.owned.staged.length} entries moved or staged, staging left: ${diff.stagingLeft}.`,
          ),
      observations.windowReached
        ? pass("APP-STILL-WORKS", workLabel, "Main window reached.")
        : observations.windowReached === false
          ? fail(
              "APP-STILL-WORKS",
              workLabel,
              "The app did not reach its main window.",
            )
          : unseen(
              "APP-STILL-WORKS",
              workLabel,
              "Window readiness was not observed.",
            ),
      outcomeChecks(lines, ["aborted", "failed"], { moved: 0 }),
      noticeChecks(
        observations,
        undefined,
        "A plain-language notice says Colony is still using the existing folder",
      ),
      reportedChecks(observations, ".buzz", contract),
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
      const during = result.afterWhileAlive
        ? diffNests({ before, after: result.afterWhileAlive, contract })
        : null;
      const movedCount = during
        ? during.owned.movedClean.length +
          during.owned.staged.length +
          during.owned.altered.length
        : null;
      rows.push(
        movedCount === null
          ? unseen(
              "NO-MOVE-UNDER-AGENT",
              label,
              "No manifest was taken while the agent was alive.",
            )
          : !agent.aliveAtManifest
            ? unseen(
                "NO-MOVE-UNDER-AGENT",
                label,
                "The agent had already exited when the manifest was taken.",
              )
            : movedCount > 0 || during.stagingLeft
              ? fail(
                  "NO-MOVE-UNDER-AGENT",
                  label,
                  `${movedCount} entries moved or staged while pid ${agent.pid} held the old nest as its working directory.`,
                )
              : pass(
                  "NO-MOVE-UNDER-AGENT",
                  label,
                  `Pid ${agent.pid} alive with the old nest as cwd and .scratch/held.lock open; nothing moved. Host line: ${agent.strategyLine ?? "none"}`,
                ),
        outcomeChecks(
          agent.firstLaunchLines ?? [],
          "deferred-running-agents",
          {},
          "DEFERRED-OUTCOME",
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
      stagingChecks(diff, contract),
      outcomeChecks(lines, "migrated", {}, "LATER-OUTCOME"),
    );
  }

  if (kind === "flag-off") {
    const offLabel = "With the kill switch off nothing is migrated";
    rows.push(
      nothingMoved(diff) && !diff.stagingLeft
        ? pass(
            "KILL-SWITCH",
            offLabel,
            "No entry moved; the old folder is unchanged.",
          )
        : fail(
            "KILL-SWITCH",
            offLabel,
            `${diff.owned.movedClean.length + diff.owned.staged.length} entries moved or staged.`,
          ),
      outcomeChecks(lines, "disabled", {}),
      reportedChecks(observations, ".buzz", contract),
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
          reset?.reason ?? "Reset was not driven.",
        ),
      );
    } else {
      const chosen = reset.chosen ?? contract.newNest;
      const remaining = after.entries
        .filter((e) => e.path.startsWith(`${chosen}/`))
        .map((e) => e.path.slice(chosen.length + 1))
        .filter(
          (rel) =>
            contract.ownedTopLevel.includes(rel.split("/")[0]) ||
            contract.generatedSkillLinks.some(
              (g) => rel === g || rel.startsWith(`${g}/`),
            ),
        );
      rows.push(
        remaining.length
          ? fail(
              "RESET-OWNED-WIPED",
              label,
              `Owned entries survived Reset in ${chosen}: ${first(remaining)}`,
            )
          : pass(
              "RESET-OWNED-WIPED",
              label,
              `No allow-listed entry and no generated skill left in ${chosen}.`,
            ),
        resetCompletes(reset),
      );
    }
  }

  return { rows, diff };
}

/** Overall verdict of a list of rows: FAIL beats NOT OBSERVED beats PASS. */
export function verdictOf(rows) {
  if (rows.some((r) => r.status === FAIL)) return FAIL;
  if (rows.some((r) => r.status === NOT_OBSERVED)) return NOT_OBSERVED;
  return PASS;
}
