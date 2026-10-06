import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  FAIL,
  NOT_OBSERVED,
  PASS,
  evaluateCase,
  parseNestFolderLine,
  verdictOf,
} from "./checks.mjs";
import { defaultContract } from "./contract.mjs";
import { buildFixture } from "./fixture.mjs";
import {
  parseMigrationLines,
  pinFixture,
  readMigrationRecords,
  runForeignScripts,
  snapshot,
} from "./observe.mjs";
import {
  provisionSkill,
  resolveReposAtBoot,
  simulateMigration,
} from "./simulate.mjs";

const contract = defaultContract();
const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

/** Build a fixture and pin its files, as the runner does, so inode numbers cannot be reused. */
async function buildPinned(options) {
  const fixture = await buildFixture(options);
  await pinFixture(fixture, contract);
  return fixture;
}

const appDataOf = (home) =>
  path.join(home, "Library", "Application Support", "xyz.block.buzz.app");
const nestLine = (chosen, reason = "both-colony-has-nest") =>
  `buzz-desktop: nest-folder: chosen=${chosen} reason=${reason} path=/x/${chosen}`;

class Crash extends Error {}
const die = () => {
  throw new Crash("crash seam");
};

/** One launch of the simulated host: migrate, provision the new folder, return the log lines it would print. */
async function launch(home, options = {}) {
  const { chosen = ".colony", provision = true, ...sim } = options;
  let report;
  try {
    report = await simulateMigration(home, {
      appDataDir: appDataOf(home),
      ...sim,
    });
  } catch (error) {
    if (!(error instanceof Crash)) throw error;
    return {
      lines: [`${contract.migrationLogPrefix} crash seam: ending the process`],
      crashed: true,
    };
  }
  if (provision && chosen === ".colony") {
    await provisionSkill(path.join(home, ".colony"));
    await resolveReposAtBoot(path.join(home, ".colony"));
  }
  return { report, lines: [report.logLine, nestLine(chosen)] };
}

/**
 * Run a case against the simulated host. `act(home)` is the first launch (returns {lines, ...}), `second(home)` the
 * second. Returns the input of evaluateCase.
 */
async function build(kind, variant, { act, second, chosen } = {}) {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-checks-"),
  );
  scratch.push(dir);
  const fixture = await buildPinned({
    root: path.join(dir, "fixture"),
    variant,
  });
  const home = fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(home, fixture.foreignScripts);
  const first = (await act?.(home)) ?? {
    lines: chosen ? [nestLine(chosen)] : [],
  };
  const after = await snapshot({ home });
  const next = second ? await second(home) : null;
  const after2 = await snapshot({ home });
  const records = await readMigrationRecords(home, contract);
  const scriptsAfter = await runForeignScripts(home, fixture.foreignScripts);
  return {
    fixture,
    home,
    result: {
      kind,
      before,
      after,
      after2,
      observations: {
        hostLogLines: first.lines,
        hostLogLines2: next?.lines,
        ...records,
        foreignScripts: { before: scriptsBefore, after: scriptsAfter },
      },
    },
  };
}

const statuses = (rows) =>
  Object.fromEntries(rows.map((r) => [r.id, r.status]));
const detail = (rows, id) => rows.find((r) => r.id === id)?.detail;
const run = async (...args) =>
  evaluateCase((await build(...args)).result, contract);
const happy = { act: (home) => launch(home), second: (home) => launch(home) };

test("a correct migration passes every check; only the checks that need a signed-in profile stay NOT OBSERVED", async () => {
  const { rows } = await run("migrate", "owner", happy);
  const byId = statuses(rows);
  for (const id of [
    "FOREIGN-IDENTICAL",
    "FOREIGN-SCRIPTS-RUN",
    "NO-LOSS",
    "RENAME-NOT-COPY",
    "MOVED-ALL",
    "OLD-ONLY-FOREIGN",
    "NO-STAGING-LEFT",
    "NO-POLLUTION",
    "GENERATED-PROVISIONED",
    "ARCHIVE-INTACT",
    "LINKS-MEANING",
    "MODELS-INTACT",
    "JOURNAL-DURABLE",
    "NOTICE",
    "OUTCOME",
    "NEST-REPORTED",
    "SECOND-LAUNCH-NOOP",
  ])
    assert.equal(byId[id], PASS, `${id}: ${detail(rows, id)}`);
  assert.equal(byId["FILES-TAB"], NOT_OBSERVED);
  assert.equal(byId["AGENTS-RESTORE"], NOT_OBSERVED);
  assert.equal(
    byId["REPOS-DIR"],
    NOT_OBSERVED,
    "the owner fixture has no .repos-dir",
  );
  assert.equal(verdictOf(rows), NOT_OBSERVED);
  assert.equal(
    rows.some((r) => r.status === FAIL),
    false,
  );
});

test("UI evidence: names in the Files tab and agents running with the new cwd are PASS, the wrong cwd is FAIL, an opened tab that cannot judge is NOT OBSERVED", async () => {
  const { result } = await build("migrate", "owner", happy);
  const rowsFor = (ui) => {
    result.observations.ui = ui;
    return statuses(evaluateCase(result, contract).rows);
  };
  const ok = rowsFor({
    filesTab: { opened: true, names: ["AGENTS.md", "OUTBOX"], sample: "x" },
    agentsRestored: {
      restored: true,
      pids: [1],
      cwd: "/x/.colony",
      cwds: ["/x/.colony"],
    },
  });
  assert.equal(ok["FILES-TAB"], PASS);
  assert.equal(ok["AGENTS-RESTORE"], PASS);
  const wrong = rowsFor({
    filesTab: { opened: true, names: [], sample: "Conversations" },
    agentsRestored: {
      restored: true,
      pids: [1],
      cwd: "/x/.buzz",
      cwds: ["/x/.buzz"],
    },
  });
  assert.equal(wrong["AGENTS-RESTORE"], FAIL);
  assert.equal(wrong["FILES-TAB"], NOT_OBSERVED);
  const mixed = rowsFor({
    agentsRestored: {
      restored: true,
      pids: [1, 2],
      cwd: "/x/.colony",
      cwds: ["/x/.colony", "/x/.buzz"],
    },
  });
  assert.equal(
    mixed["AGENTS-RESTORE"],
    FAIL,
    "one agent left on the old folder is a failure",
  );
  const none = rowsFor({
    agentsRestored: { restored: false, note: "no agent" },
    filesTab: { opened: false, error: "timeout" },
  });
  assert.equal(none["AGENTS-RESTORE"], NOT_OBSERVED);
  assert.equal(none["FILES-TAB"], NOT_OBSERVED);
});

test("repos-symlinked: REPOS moves as a link to the same outside target and .repos-dir is unchanged", async () => {
  const { rows } = await run("migrate", "repos-symlinked", happy);
  const byId = statuses(rows);
  for (const id of [
    "MOVED-ALL",
    "REPOS-DIR",
    "RENAME-NOT-COPY",
    "LINKS-MEANING",
    "OUTCOME",
  ])
    assert.equal(byId[id], PASS, `${id}: ${detail(rows, id)}`);
  const bad = await run("migrate", "repos-symlinked", {
    act: async (home) => {
      const out = await launch(home);
      await writeFile(
        path.join(home, ".colony/.repos-dir"),
        "/somewhere/else\n",
      );
      return out;
    },
    second: (home) => launch(home),
  });
  assert.equal(statuses(bad.rows)["REPOS-DIR"], FAIL);
});

test("falsifiable: foreign bytes changed breaks FOREIGN-IDENTICAL and the foreign script", async () => {
  const { rows } = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await writeFile(
        path.join(home, ".buzz/.venv-tts/bin/say"),
        "#!/bin/sh\necho changed\n",
      );
      await chmod(path.join(home, ".buzz/.venv-tts/bin/say"), 0o755);
      return out;
    },
    second: (home) => launch(home),
  });
  const byId = statuses(rows);
  assert.equal(byId["FOREIGN-IDENTICAL"], FAIL);
  assert.equal(byId["FOREIGN-SCRIPTS-RUN"], FAIL);
});

test("falsifiable: .scratch moved, a deleted old generated skill entry, a lost owned file, a copy instead of a rename", async () => {
  const scratchMoved = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await rename(
        path.join(home, ".buzz/.scratch"),
        path.join(home, ".colony/.scratch"),
      );
      return out;
    },
  });
  assert.equal(statuses(scratchMoved.rows)["FOREIGN-IDENTICAL"], FAIL);
  const skill = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await rm(path.join(home, ".buzz/.claude/skills/buzz-cli"));
      return out;
    },
  });
  assert.equal(statuses(skill.rows)["FOREIGN-IDENTICAL"], FAIL);
  const lost = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await rm(path.join(home, ".colony/RESEARCH/TELEMETRY_TEARDOWN.md"));
      return out;
    },
  });
  assert.equal(statuses(lost.rows)["NO-LOSS"], FAIL);
  assert.equal(statuses(lost.rows)["MOVED-ALL"], FAIL);
  const copied = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      const file = path.join(home, ".colony/models/pocket-tts/anna.wav");
      const bytes = await readFile(file);
      await rm(file);
      await writeFile(file, bytes);
      await chmod(file, 0o644);
      return out;
    },
  });
  assert.equal(statuses(copied.rows)["RENAME-NOT-COPY"], FAIL);
});

test("falsifiable: a foreign file rewritten in place with its own bytes and its old mtime restored is caught by ctime", async () => {
  const { rows } = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      const file = path.join(home, ".buzz/gate-note.md");
      const { mtime, atime } = await stat(file);
      await writeFile(file, await readFile(file));
      await utimes(file, atime, mtime);
      return out;
    },
  });
  assert.equal(statuses(rows)["FOREIGN-IDENTICAL"], FAIL);
});

test("falsifiable: archive.db moved without its -wal loses history, archive files left behind split it", async () => {
  const lostWal = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await rm(path.join(home, ".colony/archive/archive.db-wal"));
      await rm(path.join(home, ".colony/archive/archive.db-shm"));
      return out;
    },
  });
  const archive = lostWal.rows.find((r) => r.id === "ARCHIVE-INTACT");
  assert.equal(archive.status, FAIL);
  assert.match(archive.detail, /archived events are gone/u);
  const split = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await mkdir(path.join(home, ".buzz/archive"), { recursive: true });
      await writeFile(path.join(home, ".buzz/archive/archive.db-wal"), "x");
      return out;
    },
  });
  assert.equal(statuses(split.rows)["ARCHIVE-INTACT"], FAIL);
});

test("falsifiable: a link that dangles after the move, a model download left behind, a staging folder left behind", async () => {
  const link = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      const target = path.join(home, ".colony/REPOS/kit-latest");
      await rm(target);
      const { symlink } = await import("node:fs/promises");
      await symlink("../../.buzz/nowhere", target);
      return out;
    },
  });
  assert.equal(statuses(link.rows)["LINKS-MEANING"], FAIL);
  const models = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await mkdir(path.join(home, ".colony/models/pocket-tts.download"), {
        recursive: true,
      });
      await writeFile(
        path.join(home, ".colony/models/pocket-tts.download/part"),
        "x",
      );
      return out;
    },
  });
  assert.equal(statuses(models.rows)["MODELS-INTACT"], FAIL);
  const staging = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await mkdir(path.join(home, ".colony.staging"));
      return out;
    },
  });
  assert.equal(statuses(staging.rows)["NO-STAGING-LEFT"], FAIL);
});

test("falsifiable: no journal, no notice, a notice that names the old product, an acknowledged notice", async () => {
  const noJournal = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await rm(path.join(appDataOf(home), "nest-migration", "journal.json"));
      return out;
    },
  });
  assert.equal(statuses(noJournal.rows)["JOURNAL-DURABLE"], FAIL);
  const edit = async (change) =>
    run("migrate", "owner", {
      act: async (home) => {
        const out = await launch(home);
        const file = path.join(
          appDataOf(home),
          "nest-migration",
          "notice.json",
        );
        const notice = JSON.parse(await readFile(file, "utf8"));
        if (change === "remove") await rm(file);
        else await writeFile(file, JSON.stringify({ ...notice, ...change }));
        return out;
      },
    });
  assert.equal(statuses((await edit("remove")).rows).NOTICE, FAIL);
  assert.equal(
    statuses((await edit({ message: "Colony moved your Buzz files" })).rows)
      .NOTICE,
    FAIL,
  );
  assert.equal(
    statuses((await edit({ acknowledged: true })).rows).NOTICE,
    FAIL,
  );
});

test("falsifiable: wrong nest log line, wrong outcome, second launch that changes things or logs the wrong outcome", async () => {
  const wrong = await run("migrate", "owner", {
    act: async (home) => ({ ...(await launch(home, { chosen: ".buzz" })) }),
    second: (home) => launch(home),
  });
  assert.equal(statuses(wrong.rows)["NEST-REPORTED"], FAIL);
  const outcome = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      return {
        lines: [
          out.lines[0].replace("outcome=migrated", "outcome=left-in-place"),
          out.lines[1],
        ],
      };
    },
  });
  assert.equal(statuses(outcome.rows).OUTCOME, FAIL);
  const stray = await run("migrate", "owner", {
    act: (home) => launch(home),
    second: async (home) => {
      await writeFile(path.join(home, ".colony/GUIDES/new.md"), "x");
      return launch(home);
    },
  });
  assert.equal(statuses(stray.rows)["SECOND-LAUNCH-NOOP"], FAIL);
  const badOutcome = await run("migrate", "owner", {
    act: (home) => launch(home),
    second: async () => ({
      lines: [
        `${contract.migrationLogPrefix} outcome=migrated moved=10 skipped=0 detail=x`,
      ],
    }),
  });
  assert.equal(statuses(badOutcome.rows)["SECOND-LAUNCH-NOOP"], FAIL);
  const noLine = await run("migrate", "owner", {
    act: (home) => launch(home),
    second: async () => ({ lines: [] }),
  });
  assert.equal(statuses(noLine.rows)["SECOND-LAUNCH-NOOP"], NOT_OBSERVED);
});

test("falsifiable: an owned entry left behind, or a new folder without its own skill", async () => {
  const left = await run("migrate", "owner", {
    act: async (home) => {
      const out = await launch(home);
      await rename(
        path.join(home, ".colony/models"),
        path.join(home, ".buzz/models"),
      );
      return out;
    },
  });
  assert.equal(statuses(left.rows)["MOVED-ALL"], FAIL);
  assert.equal(statuses(left.rows)["OLD-ONLY-FOREIGN"], FAIL);
  const bare = await run("migrate", "owner", {
    act: (home) => launch(home, { provision: false }),
  });
  assert.equal(statuses(bare.rows)["GENERATED-PROVISIONED"], FAIL);
});

test("the stale-version case allows only AGENTS.md and its stamp to change, and keeps the owner's notes below the markers", async () => {
  const { result } = await build("migrate-stale", "owner-stale-version", {
    act: async (home) => {
      const out = await launch(home);
      // The host refreshes the managed region and stamp after the move, keeping what follows the end marker.
      const file = path.join(home, ".colony/AGENTS.md");
      const text = await readFile(file, "utf8");
      await writeFile(
        file,
        text.replace(
          "Agents read this file at the start of every session.",
          "Refreshed text.",
        ),
      );
      await writeFile(path.join(home, ".colony/.nest-agents-version"), "7\n");
      return out;
    },
  });
  result.observations.userNote = "Keep release notes in OUTBOX.";
  const byId = statuses(evaluateCase(result, contract).rows);
  assert.equal(byId["MOVED-ALL-EXCEPT-REFRESHED"], PASS);
  assert.equal(byId["USER-NOTES-KEPT"], PASS);
  assert.equal(byId["FOREIGN-IDENTICAL"], PASS);
  result.after.files[".colony/AGENTS.md"] = "# replaced entirely\n";
  assert.equal(
    statuses(evaluateCase(result, contract).rows)["USER-NOTES-KEPT"],
    FAIL,
  );
});

test("crash: a stop after four entries are staged, then a resume, passes; the kill is recognised as mid-migration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-crash-"));
  scratch.push(dir);
  const fixture = await buildPinned({
    root: path.join(dir, "fixture"),
    variant: "owner",
  });
  const home = fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(home, fixture.foreignScripts);
  const crashed = await launch(home, { crashAt: { n: 5, before: false }, die });
  assert.equal(crashed.crashed, true);
  const afterKill = await snapshot({ home });
  const killRecords = await readMigrationRecords(home, contract);
  const resumed = await launch(home);
  const after = await snapshot({ home });
  const records = await readMigrationRecords(home, contract);
  const again = await launch(home);
  const after2 = await snapshot({ home });
  const scriptsAfter = await runForeignScripts(home, fixture.foreignScripts);
  const input = {
    kind: "crash",
    before,
    after,
    after2,
    afterKill,
    observations: {
      hostLogLines: resumed.lines,
      hostLogLines2: again.lines,
      ...records,
      killed: {
        by: "crash seam",
        exitCode: 86,
        seamLine: true,
        crashAt: "5:after",
        journal: killRecords.journal,
      },
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
  const byId = statuses(evaluateCase(input, contract).rows);
  for (const id of [
    "KILL-LANDED",
    "KILL-JOURNAL-FIRST",
    "KILL-NO-LOSS",
    "RESUME-MOVED-ALL",
    "RESUME-OLD-ONLY-FOREIGN",
    "RESUME-OUTCOME",
    "JOURNAL-DURABLE",
    "SECOND-LAUNCH-NOOP",
  ])
    assert.equal(byId[id], PASS, `${id}`);
  // Falsifiable: a journal that was not written before the move.
  const noJournal = {
    ...input,
    observations: {
      ...input.observations,
      killed: { ...input.observations.killed, journal: null },
    },
  };
  assert.equal(
    statuses(evaluateCase(noJournal, contract).rows)["KILL-JOURNAL-FIRST"],
    FAIL,
  );
  const pendingOnly = {
    ...input,
    observations: {
      ...input.observations,
      killed: {
        ...input.observations.killed,
        journal: {
          json: {
            phase: "staging",
            steps: killRecords.journal.json.steps.map((s) => ({
              ...s,
              status: "pending",
            })),
          },
        },
      },
    },
  };
  assert.equal(
    statuses(evaluateCase(pendingOnly, contract).rows)["KILL-JOURNAL-FIRST"],
    FAIL,
  );
  // Falsifiable: the seam never fired.
  const unfired = {
    ...input,
    observations: {
      ...input.observations,
      killed: {
        by: "not stopped",
        exitCode: null,
        seamLine: false,
        journal: killRecords.journal,
      },
    },
  };
  assert.equal(
    statuses(evaluateCase(unfired, contract).rows)["KILL-LANDED"],
    NOT_OBSERVED,
  );
  // Falsifiable: a stop before the first move did not exercise the resume path.
  const early = { ...input, afterKill: before };
  assert.equal(
    statuses(evaluateCase(early, contract).rows)["KILL-LANDED"],
    NOT_OBSERVED,
  );
});

test("without a kill observation the crash case reports NOT OBSERVED, never PASS", async () => {
  const { result } = await build("crash", "owner", happy);
  assert.equal(
    statuses(evaluateCase(result, contract).rows)["KILL-LANDED"],
    NOT_OBSERVED,
  );
});

test("both folders: conflicts are kept and noticed, placeholders replaced; overwriting one is caught", async () => {
  const ok = await run("both", "both-colony-has-nest", {
    act: (home) => launch(home),
    second: (home) => launch(home),
  });
  const byId = statuses(ok.rows);
  for (const id of [
    "CONFLICTS-KEPT",
    "NON-CONFLICTING-MOVED",
    "NOTICE",
    "OUTCOME",
    "JOURNAL-DURABLE",
    "FOREIGN-IDENTICAL",
    "SECOND-LAUNCH-NOOP",
    "NEST-REPORTED",
  ])
    assert.equal(byId[id], PASS, `${id}: ${detail(ok.rows, id)}`);
  const overwritten = await run("both", "both-colony-has-nest", {
    act: async (home) => {
      const out = await launch(home);
      await rm(path.join(home, ".colony/AGENTS.md"));
      await rename(
        path.join(home, ".buzz/AGENTS.md"),
        path.join(home, ".colony/AGENTS.md"),
      );
      return out;
    },
  });
  assert.equal(statuses(overwritten.rows)["CONFLICTS-KEPT"], FAIL);
});

test("both folders, unrelated ~/.colony: its own file is never touched and everything moves in", async () => {
  const ok = await run("both-unrelated", "both-unrelated-colony", {
    act: (home) => launch(home),
    second: (home) => launch(home),
  });
  const byId = statuses(ok.rows);
  assert.equal(byId["UNRELATED-KEPT"], PASS);
  assert.equal(byId["MOVED-ALL"], PASS, detail(ok.rows, "MOVED-ALL"));
  const bad = await run("both-unrelated", "both-unrelated-colony", {
    act: async (home) => {
      const out = await launch(home);
      await writeFile(
        path.join(home, ".colony/unrelated-tool.cfg"),
        "setting=2\n",
      );
      return out;
    },
  });
  assert.equal(statuses(bad.rows)["UNRELATED-KEPT"], FAIL);
});

test("aborted (.repos-dir inside the old nest): nothing moves, a notice says so; moving anyway is caught", async () => {
  const ok = await run("aborted", "repos-dir-inside", {
    act: (home) => launch(home, { chosen: ".buzz" }),
    second: (home) => launch(home, { chosen: ".buzz" }),
  });
  const byId = statuses(ok.rows);
  for (const id of [
    "NOTHING-MOVED",
    "OUTCOME",
    "NOTICE",
    "NEST-REPORTED",
    "SECOND-LAUNCH-NOOP",
    "FOREIGN-IDENTICAL",
  ])
    assert.equal(byId[id], PASS, `${id}: ${detail(ok.rows, id)}`);
  // A migration that ignored the pointer and moved everything.
  const moved = await run("aborted", "repos-dir-inside", {
    act: async (home) => {
      await rm(path.join(home, ".buzz/.repos-dir"));
      return launch(home);
    },
  });
  assert.equal(statuses(moved.rows)["NOTHING-MOVED"], FAIL);
});

test("held back (REPOS with an absolute link into the old nest): REPOS stays whole, the rest moves, a notice says so", async () => {
  const ok = await run("held-back", "repos-link-into-nest", {
    act: (home) => launch(home),
    second: (home) => launch(home),
  });
  const byId = statuses(ok.rows);
  for (const id of [
    "HELD-BACK",
    "LINKS-MEANING",
    "REPOS-POINTER",
    "REPOS-IN-USE",
    "NOTICE-HONEST",
    "NOTICE",
    "OUTCOME",
    "JOURNAL-DURABLE",
    "SECOND-LAUNCH-NOOP",
    "FOREIGN-IDENTICAL",
  ])
    assert.equal(byId[id], PASS, `${id}: ${detail(ok.rows, id)}`);
  const broken = await run("held-back", "repos-link-into-nest", {
    act: async (home) => {
      const out = await launch(home);
      await rm(path.join(home, ".buzz/REPOS/kit-absolute"));
      return out;
    },
  });
  assert.equal(statuses(broken.rows)["HELD-BACK"], FAIL);
  // A migration that held REPOS back but forgot the pointer: the new nest would start with an empty
  // REPOS beside clones that stayed behind.
  const split = await run("held-back", "repos-link-into-nest", {
    act: async (home) => {
      const out = await launch(home);
      await rm(path.join(home, ".colony/.repos-dir"));
      await rm(path.join(home, ".colony/REPOS"), { force: true });
      return out;
    },
  });
  assert.equal(statuses(split.rows)["REPOS-POINTER"], FAIL);
});

test("colony-only and empty HOME: no migration, nothing created in ~/.buzz, no journal", async () => {
  const only = await run("colony-only", "colony-only", { chosen: ".colony" });
  assert.equal(
    verdictOf(only.rows),
    PASS,
    JSON.stringify(only.rows.filter((r) => r.status !== PASS)),
  );
  const created = await run("colony-only", "colony-only", {
    act: async (home) => {
      await mkdir(path.join(home, ".buzz"));
      return { lines: [nestLine(".colony")] };
    },
  });
  assert.equal(statuses(created.rows)["NO-OLD-FOLDER"], FAIL);
  const empty = await run("empty", "empty", {
    act: async (home) => {
      await mkdir(path.join(home, ".colony"));
      return { lines: [nestLine(".colony", "fresh-install")] };
    },
  });
  assert.equal(verdictOf(empty.rows), PASS);
  const journaled = await run("empty", "empty", {
    act: async (home) => {
      await mkdir(path.join(home, ".colony"));
      await mkdir(path.join(appDataOf(home), "nest-migration"), {
        recursive: true,
      });
      await writeFile(
        path.join(appDataOf(home), "nest-migration", "journal.json"),
        "{}",
      );
      return { lines: [nestLine(".colony", "fresh-install")] };
    },
  });
  assert.equal(statuses(journaled.rows)["NO-JOURNAL"], FAIL);
  const ran = await run("empty", "empty", {
    act: async (home) => {
      await mkdir(path.join(home, ".colony"));
      return {
        lines: [
          `${contract.migrationLogPrefix} outcome=migrated moved=3 skipped=0 detail=x`,
          nestLine(".colony", "fresh-install"),
        ],
      };
    },
  });
  assert.equal(statuses(ran.rows)["NO-MIGRATION"], FAIL);
  const idle = await run("empty", "empty");
  assert.equal(statuses(idle.rows)["FRESH-NEW-FOLDER"], NOT_OBSERVED);
});

test("read-only parent: the migration aborts with nothing touched, the app keeps working; moving anyway is caught", {
  skip: process.getuid?.() === 0 ? "root ignores directory modes" : false,
}, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-ro-"));
  scratch.push(dir);
  const fixture = await buildPinned({
    root: path.join(dir, "fixture"),
    variant: "owner",
  });
  const home = fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(home, fixture.foreignScripts);
  await chmod(home, 0o555);
  let lines;
  try {
    lines = (await launch(home, { chosen: ".buzz" })).lines;
  } finally {
    await chmod(home, 0o755);
  }
  const after = await snapshot({ home });
  const records = await readMigrationRecords(home, contract);
  const scriptsAfter = await runForeignScripts(home, fixture.foreignScripts);
  const input = {
    kind: "readonly",
    before,
    after,
    observations: {
      hostLogLines: lines,
      ...records,
      windowReached: true,
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
  assert.match(
    lines[0],
    /outcome=aborted moved=0 skipped=0 detail=staging-unavailable:EACCES/u,
  );
  const byId = statuses(evaluateCase(input, contract).rows);
  for (const id of [
    "FALLBACK-UNTOUCHED",
    "APP-STILL-WORKS",
    "OUTCOME",
    "NOTICE",
    "NEST-REPORTED",
    "FOREIGN-IDENTICAL",
  ])
    assert.equal(
      byId[id],
      PASS,
      `${id}: ${detail(evaluateCase(input, contract).rows, id)}`,
    );
  input.observations.windowReached = false;
  assert.equal(
    statuses(evaluateCase(input, contract).rows)["APP-STILL-WORKS"],
    FAIL,
  );
  const movedAnyway = await run("readonly", "owner", {
    act: (home2) => launch(home2, { chosen: ".colony" }),
  });
  assert.equal(statuses(movedAnyway.rows)["FALLBACK-UNTOUCHED"], FAIL);
});

test("running agent: nothing moves while the agent is alive and the host defers; moving under it is caught", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-agent-"));
  scratch.push(dir);
  const fixture = await buildPinned({
    root: path.join(dir, "fixture"),
    variant: "owner",
  });
  const home = fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(home, fixture.foreignScripts);
  const deferred = await launch(home, {
    chosen: ".buzz",
    liveAgentPids: [4242],
  });
  assert.equal(deferred.report.outcome, "deferred-running-agents");
  const alive = await snapshot({ home });
  const migrated = await launch(home);
  const after = await snapshot({ home });
  const records = await readMigrationRecords(home, contract);
  const scriptsAfter = await runForeignScripts(home, fixture.foreignScripts);
  const input = {
    kind: "running-agent",
    before,
    after,
    afterWhileAlive: alive,
    observations: {
      hostLogLines: migrated.lines,
      ...records,
      agent: {
        pid: 4242,
        aliveAtManifest: true,
        strategyLine: deferred.lines[0],
        firstLaunchLines: deferred.lines,
      },
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
  const byId = statuses(evaluateCase(input, contract).rows);
  for (const id of [
    "NO-MOVE-UNDER-AGENT",
    "DEFERRED-OUTCOME",
    "LATER-MOVED-ALL",
    "LATER-OUTCOME",
    "FOREIGN-IDENTICAL",
  ])
    assert.equal(
      byId[id],
      PASS,
      `${id}: ${detail(evaluateCase(input, contract).rows, id)}`,
    );
  assert.equal(
    statuses(evaluateCase({ ...input, afterWhileAlive: after }, contract).rows)[
      "NO-MOVE-UNDER-AGENT"
    ],
    FAIL,
  );
  const wrongOutcome = {
    ...input,
    observations: {
      ...input.observations,
      agent: {
        ...input.observations.agent,
        firstLaunchLines: [
          `${contract.migrationLogPrefix} outcome=migrated moved=10 skipped=0 detail=x`,
        ],
      },
    },
  };
  assert.equal(
    statuses(evaluateCase(wrongOutcome, contract).rows)["DEFERRED-OUTCOME"],
    FAIL,
  );
  const none = {
    ...input,
    observations: { ...input.observations, agent: undefined },
  };
  assert.equal(
    statuses(evaluateCase(none, contract).rows)["NO-MOVE-UNDER-AGENT"],
    NOT_OBSERVED,
  );
});

test("kill switch off: outcome=disabled and nothing moves; migrating anyway is caught", async () => {
  const ok = await run("flag-off", "owner", {
    act: (home) => launch(home, { chosen: ".buzz", enabled: false }),
  });
  const byId = statuses(ok.rows);
  assert.equal(byId["KILL-SWITCH"], PASS);
  assert.equal(byId.OUTCOME, PASS);
  const moved = await run("flag-off", "owner", {
    act: (home) => launch(home, { chosen: ".colony", enabled: true }),
  });
  assert.equal(statuses(moved.rows)["KILL-SWITCH"], FAIL);
});

test("kill switch off rolls back an interrupted run: entries return to the old folder", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-rollback-"),
  );
  scratch.push(dir);
  const fixture = await buildPinned({
    root: path.join(dir, "fixture"),
    variant: "owner",
  });
  const home = fixture.home;
  const before = await snapshot({ home });
  await launch(home, { crashAt: { n: 5, before: false }, die });
  const rolled = await launch(home, { chosen: ".buzz", enabled: false });
  assert.equal(rolled.report.outcome, "rolled-back");
  const after = await snapshot({ home });
  const { rows } = evaluateCase(
    {
      kind: "flag-off",
      before,
      after,
      observations: {
        hostLogLines: [nestLine(".buzz")],
        foreignScripts: { before: [], after: [] },
      },
    },
    contract,
  );
  assert.equal(
    statuses(rows)["KILL-SWITCH"],
    PASS,
    detail(rows, "KILL-SWITCH"),
  );
});

test("reset: owned entries and generated skills wiped, foreign untouched; a surviving owned entry or a deleted foreign entry is caught", async () => {
  const wipe = async (home, { keep, killForeign } = {}) => {
    const out = await launch(home);
    for (const name of contract.ownedTopLevel)
      if (name !== keep)
        await rm(path.join(home, ".colony", name), {
          recursive: true,
          force: true,
        });
    await rm(path.join(home, ".colony/.agents"), {
      recursive: true,
      force: true,
    });
    for (const dir of [".claude", ".codex", ".goose"])
      await rm(path.join(home, ".colony", dir), {
        recursive: true,
        force: true,
      });
    if (killForeign)
      await rm(path.join(home, ".buzz", killForeign), {
        recursive: true,
        force: true,
      });
    return out;
  };
  const withReset = async (
    options,
    reset = { performed: true, chosen: ".colony" },
  ) => {
    const built = await build("reset", "owner", {
      act: (home) => wipe(home, options),
    });
    built.result.observations.reset = reset;
    return evaluateCase(built.result, contract).rows;
  };
  const ok = statuses(await withReset({}));
  assert.equal(ok["RESET-OWNED-WIPED"], PASS);
  assert.equal(ok["FOREIGN-IDENTICAL"], PASS);
  assert.equal(ok["RESET-COMPLETES"], PASS);
  assert.equal(
    statuses(await withReset({ keep: "REPOS" }))["RESET-OWNED-WIPED"],
    FAIL,
  );
  assert.equal(
    statuses(await withReset({ killForeign: ".venv-tts" }))[
      "FOREIGN-IDENTICAL"
    ],
    FAIL,
  );
  const stuck = statuses(
    await withReset(
      {},
      {
        performed: true,
        chosen: ".colony",
        failedLine:
          "buzz-desktop reset: verification failed (keychain_wiped=true, nest_gone=false)",
      },
    ),
  );
  assert.equal(stuck["RESET-COMPLETES"], FAIL);
  const keychain = statuses(
    await withReset(
      {},
      {
        performed: true,
        chosen: ".colony",
        failedLine:
          "buzz-desktop reset: verification failed (keychain_wiped=false, nest_gone=true)",
      },
    ),
  );
  assert.equal(keychain["RESET-COMPLETES"], NOT_OBSERVED);
  const skipped = await build("reset", "owner", {
    act: (home) => launch(home),
  });
  assert.equal(
    statuses(evaluateCase(skipped.result, contract).rows)["RESET-OWNED-WIPED"],
    NOT_OBSERVED,
  );
});

test("parseNestFolderLine reads the host's line, the latest one wins, and a path with spaces survives", () => {
  assert.deepEqual(
    parseNestFolderLine(
      [
        "noise",
        "buzz-desktop: nest-folder: chosen=.buzz reason=legacy-folder-kept path=/Users/a b/.buzz",
        "2026-10-06T10:00:00Z buzz-desktop: nest-folder: chosen=.colony reason=both-colony-has-nest path=/Users/a b/.colony",
      ],
      contract,
    ),
    {
      chosen: ".colony",
      reason: "both-colony-has-nest",
      path: "/Users/a b/.colony",
    },
  );
  assert.equal(parseNestFolderLine(["nothing here"], contract), null);
});

test("parseMigrationLines reads every outcome line with its counts and detail", () => {
  assert.deepEqual(
    parseMigrationLines(
      [
        "noise",
        "buzz-desktop: nest-migration: outcome=deferred-running-agents moved=0 skipped=0 detail=-",
        "buzz-desktop: nest-migration: skipped: a reset is pending",
        "buzz-desktop: nest-migration: outcome=migrated moved=10 skipped=1 detail=archive,GUIDES",
      ],
      contract,
    ),
    [
      { outcome: "deferred-running-agents", moved: 0, skipped: 0, detail: "-" },
      { outcome: "migrated", moved: 10, skipped: 1, detail: "archive,GUIDES" },
    ],
  );
});

test("verdictOf: FAIL beats NOT OBSERVED beats PASS", () => {
  assert.equal(verdictOf([{ status: PASS }, { status: PASS }]), PASS);
  assert.equal(
    verdictOf([{ status: PASS }, { status: NOT_OBSERVED }]),
    NOT_OBSERVED,
  );
  assert.equal(
    verdictOf([{ status: NOT_OBSERVED }, { status: FAIL }, { status: PASS }]),
    FAIL,
  );
});
