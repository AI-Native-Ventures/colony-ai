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
            agents.indexOf(note) > agents.indexOf("<!-- END BUZZ MANAGED")
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
            diff.newSideExisting.differences.length ||
            diff.newSideExisting.missing.length
          ? fail(
              "CONFLICTS-KEPT",
              keptLabel,
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
              keptLabel,
              `${diff.owned.conflicts.length} conflicting entries (${first(conflictNames, 3)}): the new folder's bytes unchanged, the old source intact.`,
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
