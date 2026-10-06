import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
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
  readMigrationRecords,
  runForeignScripts,
  snapshot,
} from "./observe.mjs";
import { simulateMigration } from "./simulate.mjs";

const contract = defaultContract();
const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

const LOG_COLONY = [
  "buzz-desktop: nest-folder: chosen=.colony reason=both-colony-has-nest path=/x/.colony",
];
const LOG_BUZZ = [
  "buzz-desktop: nest-folder: chosen=.buzz reason=legacy-folder-kept path=/x/.buzz",
];

/**
 * Run a case against the simulated migration. `act(home)` stands in for the app's first launch,
 * `second(home)` for the second one. Returns the input of evaluateCase.
 */
async function build(kind, variant, { act, second, logs = LOG_COLONY } = {}) {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-checks-"),
  );
  scratch.push(dir);
  const fixture = await buildFixture({
    root: path.join(dir, "fixture"),
    variant,
  });
  const home = fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(home, fixture.foreignScripts);
  await act?.(home);
  const after = await snapshot({ home });
  if (second) await second(home);
  const after2 = await snapshot({ home });
  const records = await readMigrationRecords(home, contract);
  const scriptsAfter = await runForeignScripts(home, fixture.foreignScripts);
  const result = {
    kind,
    before,
    after,
    after2,
    observations: {
      hostLogLines: logs,
      ...records,
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
  return { fixture, home, result };
}

const statuses = (rows) =>
  Object.fromEntries(rows.map((row) => [row.id, row.status]));
const ranFor = async (...args) =>
  evaluateCase((await build(...args)).result, contract);

test("a correct migration passes every check; only the checks that need a signed-in profile stay NOT OBSERVED", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: (home) => simulateMigration(home),
  });
  const byId = statuses(rows);
  for (const id of [
    "FOREIGN-IDENTICAL",
    "FOREIGN-SCRIPTS-RUN",
    "NO-LOSS",
    "RENAME-NOT-COPY",
    "MOVED-ALL",
    "OLD-ONLY-FOREIGN",
    "NO-POLLUTION",
    "GENERATED-LINKS",
    "ARCHIVE-INTACT",
    "LINKS-MEANING",
    "MODELS-INTACT",
    "JOURNAL-DURABLE",
    "NEST-REPORTED",
    "SECOND-LAUNCH-NOOP",
  ])
    assert.equal(
      byId[id],
      PASS,
      `${id}: ${rows.find((r) => r.id === id)?.detail}`,
    );
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

test("UI evidence turns the two profile checks into PASS", async () => {
  const { result } = await build("migrate", "owner", {
    act: (home) => simulateMigration(home),
  });
  result.observations.ui = {
    filesTab: { listed: 12, path: "/x/.colony" },
    agentsRestored: { restored: true, cwd: "/x/.colony" },
  };
  const byId = statuses(evaluateCase(result, contract).rows);
  assert.equal(byId["FILES-TAB"], PASS);
  assert.equal(byId["AGENTS-RESTORE"], PASS);
  result.observations.ui.agentsRestored.cwd = "/x/.buzz";
  assert.equal(
    statuses(evaluateCase(result, contract).rows)["AGENTS-RESTORE"],
    FAIL,
  );
});

test("falsifiable: foreign bytes changed, foreign script broken", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: async (home) => {
      await simulateMigration(home);
      await writeFile(
        path.join(home, ".buzz/.venv-tts/bin/say"),
        "#!/bin/sh\necho changed\n",
      );
      await chmod(path.join(home, ".buzz/.venv-tts/bin/say"), 0o755);
    },
  });
  const byId = statuses(rows);
  assert.equal(byId["FOREIGN-IDENTICAL"], FAIL);
  assert.equal(byId["FOREIGN-SCRIPTS-RUN"], FAIL);
});

test("falsifiable: a lost owned file fails NO-LOSS and MOVED-ALL", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: async (home) => {
      await simulateMigration(home);
      await rm(path.join(home, ".colony/RESEARCH/TELEMETRY_TEARDOWN.md"));
    },
  });
  const byId = statuses(rows);
  assert.equal(byId["NO-LOSS"], FAIL);
  assert.equal(byId["MOVED-ALL"], FAIL);
});

test("falsifiable: copy instead of rename fails RENAME-NOT-COPY", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: async (home) => {
      await simulateMigration(home);
      const file = path.join(home, ".colony/models/pocket-tts/anna.wav");
      const bytes = await readFile(file);
      await rm(file);
      await writeFile(file, bytes);
      await chmod(file, 0o644);
    },
  });
  assert.equal(statuses(rows)["RENAME-NOT-COPY"], FAIL);
});

test("falsifiable: moving archive.db without its -wal loses history and is caught", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: async (home) => {
      await simulateMigration(home);
      await rm(path.join(home, ".colony/archive/archive.db-wal"));
      await rm(path.join(home, ".colony/archive/archive.db-shm"));
    },
  });
  const archive = rows.find((r) => r.id === "ARCHIVE-INTACT");
  assert.equal(archive.status, FAIL);
  assert.match(archive.detail, /archived events are gone/u);
});

test("falsifiable: archive files left behind split history", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: async (home) => {
      await simulateMigration(home);
      await mkdir(path.join(home, ".buzz/archive"), { recursive: true });
      await writeFile(path.join(home, ".buzz/archive/archive.db-wal"), "x");
    },
  });
  assert.equal(statuses(rows)["ARCHIVE-INTACT"], FAIL);
});

test("falsifiable: links not rewritten dangle, a copied link tree fails", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: async (home) => {
      await simulateMigration(home);
      const link = path.join(home, ".colony/REPOS/kit-absolute");
      await rm(link);
      const { symlink } = await import("node:fs/promises");
      await symlink(`${home}/.buzz/REPOS/colony-social-kit`, link);
    },
  });
  assert.equal(statuses(rows)["LINKS-MEANING"], FAIL);
});

test("falsifiable: .repos-dir pointing into the old nest after the move fails REPOS-DIR; rewriting passes", async () => {
  const ok = await ranFor("migrate", "repos-dir-inside", {
    act: (home) => simulateMigration(home),
  });
  assert.equal(statuses(ok.rows)["REPOS-DIR"], PASS);
  const bad = await ranFor("migrate", "repos-dir-inside", {
    act: async (home) => {
      await simulateMigration(home);
      await writeFile(
        path.join(home, ".colony/.repos-dir"),
        `${home}/.buzz/REPOS\n`,
      );
    },
  });
  assert.equal(statuses(bad.rows)["REPOS-DIR"], FAIL);
});

test("repos-symlinked: REPOS moves as a link to the same outside target, .repos-dir unchanged", async () => {
  const { rows, diff } = await ranFor("migrate", "repos-symlinked", {
    act: (home) => simulateMigration(home),
  });
  const byId = statuses(rows);
  assert.equal(byId["MOVED-ALL"], PASS);
  assert.equal(byId["REPOS-DIR"], PASS);
  assert.equal(byId["RENAME-NOT-COPY"], PASS);
  assert.equal(
    diff.owned.rewrittenLinks.length,
    0,
    "an outside link target is carried over unchanged",
  );
});

test("falsifiable: no journal, an unrecorded move, a wrong nest log line, a second launch that changes things", async () => {
  const none = await ranFor("migrate", "owner", {
    act: (home) => simulateMigration(home, { journal: false, sentinel: false }),
  });
  assert.equal(statuses(none.rows)["JOURNAL-DURABLE"], FAIL);
  const wrong = await ranFor("migrate", "owner", {
    act: (home) => simulateMigration(home),
    logs: LOG_BUZZ,
  });
  assert.equal(statuses(wrong.rows)["NEST-REPORTED"], FAIL);
  const rerun = await ranFor("migrate", "owner", {
    act: (home) => simulateMigration(home),
    second: (home) => simulateMigration(home),
  });
  assert.equal(
    statuses(rerun.rows)["SECOND-LAUNCH-NOOP"],
    FAIL,
    "the simulated rerun rewrites the sentinel, which must be caught",
  );
  const stray = await ranFor("migrate", "owner", {
    act: (home) => simulateMigration(home),
    second: (home) => writeFile(path.join(home, ".colony/GUIDES/new.md"), "x"),
  });
  assert.equal(statuses(stray.rows)["SECOND-LAUNCH-NOOP"], FAIL);
});

test("falsifiable: a download left in models/ fails MODELS-INTACT", async () => {
  const { rows } = await ranFor("migrate", "owner", {
    act: async (home) => {
      await simulateMigration(home);
      await mkdir(path.join(home, ".colony/models/pocket-tts.download"), {
        recursive: true,
      });
      await writeFile(
        path.join(home, ".colony/models/pocket-tts.download/part"),
        "x",
      );
    },
  });
  assert.equal(statuses(rows)["MODELS-INTACT"], FAIL);
});

test("crash: a kill after three entries then a resume passes, and the kill is recognised as mid-migration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-crash-"));
  scratch.push(dir);
  const crashFixture = await buildFixture({
    root: path.join(dir, "fixture"),
    variant: "owner",
  });
  const home = crashFixture.home;
  const before = await snapshot({ home });
  await simulateMigration(home, { stopAfter: 3 });
  const afterKill = await snapshot({ home });
  await simulateMigration(home);
  const after = await snapshot({ home });
  const records = await readMigrationRecords(home, contract);
  const scripts = await runForeignScripts(home, crashFixture.foreignScripts);
  const input = {
    kind: "crash",
    before,
    after,
    after2: await snapshot({ home }),
    afterKill,
    observations: {
      hostLogLines: LOG_COLONY,
      ...records,
      killed: { journalLines: 3 },
      foreignScripts: { before: scripts, after: scripts },
    },
  };
  const byId = statuses(evaluateCase(input, contract).rows);
  assert.equal(byId["KILL-LANDED"], PASS);
  assert.equal(byId["KILL-NO-LOSS"], PASS);
  assert.equal(byId["RESUME-MOVED-ALL"], PASS);
  assert.equal(byId["RESUME-OLD-ONLY-FOREIGN"], PASS);
  assert.equal(byId["SECOND-LAUNCH-NOOP"], PASS);
  // Falsifiable: a kill that landed before the first move did not exercise the resume path.
  const dir2 = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-crash-"),
  );
  scratch.push(dir2);
  const early = await buildFixture({
    root: path.join(dir2, "fixture"),
    variant: "owner",
  });
  const beforeEarly = await snapshot({ home: early.home });
  const killedEarly = await snapshot({ home: early.home });
  await simulateMigration(early.home);
  const afterEarly = await snapshot({ home: early.home });
  const earlyRows = evaluateCase(
    {
      ...input,
      before: beforeEarly,
      afterKill: killedEarly,
      after: afterEarly,
      after2: afterEarly,
      observations: {
        ...input.observations,
        ...(await readMigrationRecords(early.home, contract)),
      },
    },
    contract,
  ).rows;
  assert.equal(statuses(earlyRows)["KILL-LANDED"], NOT_OBSERVED);
  // Falsifiable: a resume that lost an entry fails KILL-NO-LOSS only if the loss happened before the kill snapshot.
  await rm(path.join(home, ".colony/OUTBOX/DAY1_VIDEO_PACK.md"));
  const lossAfter = await snapshot({ home });
  assert.equal(
    statuses(
      evaluateCase({ ...input, after: lossAfter, after2: lossAfter }, contract)
        .rows,
    )["RESUME-MOVED-ALL"],
    FAIL,
  );
});

test("without a kill observation the crash case reports NOT OBSERVED, never PASS", async () => {
  const { result } = await build("crash", "owner", {
    act: (home) => simulateMigration(home),
  });
  const byId = statuses(evaluateCase(result, contract).rows);
  assert.equal(byId["KILL-LANDED"], NOT_OBSERVED);
});

test("both folders: conflicting entries are kept and noticed; overwriting one is caught", async () => {
  const ok = await ranFor("both", "both-colony-has-nest", {
    act: (home) => simulateMigration(home),
  });
  const byId = statuses(ok.rows);
  assert.equal(
    byId["CONFLICTS-KEPT"],
    PASS,
    ok.rows.find((r) => r.id === "CONFLICTS-KEPT")?.detail,
  );
  assert.equal(byId["NON-CONFLICTING-MOVED"], PASS);
  assert.equal(byId.NOTICE, PASS);
  assert.equal(byId["FOREIGN-IDENTICAL"], PASS);
  const overwritten = await ranFor("both", "both-colony-has-nest", {
    act: async (home) => {
      await simulateMigration(home);
      await rm(path.join(home, ".colony/AGENTS.md"));
      await rename(
        path.join(home, ".buzz/AGENTS.md"),
        path.join(home, ".colony/AGENTS.md"),
      );
    },
  });
  assert.equal(statuses(overwritten.rows)["CONFLICTS-KEPT"], FAIL);
  const silent = await ranFor("both", "both-colony-has-nest", {
    act: (home) => simulateMigration(home, { sentinel: false, journal: false }),
  });
  assert.equal(
    statuses(silent.rows)["NOTICE"],
    FAIL,
    "a skip with no notice is a failure",
  );
});

test("both folders, unrelated ~/.colony: its own file is never touched", async () => {
  const ok = await ranFor("both-unrelated", "both-unrelated-colony", {
    act: (home) => simulateMigration(home),
  });
  assert.equal(statuses(ok.rows)["UNRELATED-KEPT"], PASS);
  const bad = await ranFor("both-unrelated", "both-unrelated-colony", {
    act: async (home) => {
      await simulateMigration(home);
      await writeFile(
        path.join(home, ".colony/unrelated-tool.cfg"),
        "setting=2\n",
      );
    },
  });
  assert.equal(statuses(bad.rows)["UNRELATED-KEPT"], FAIL);
});

test("colony-only and empty HOME: nothing migrated, nothing created in ~/.buzz", async () => {
  const only = await ranFor("colony-only", "colony-only", { logs: LOG_COLONY });
  assert.equal(verdictOf(only.rows), PASS);
  const created = await ranFor("colony-only", "colony-only", {
    act: (home) => mkdir(path.join(home, ".buzz")),
  });
  assert.equal(statuses(created.rows)["NO-OLD-FOLDER"], FAIL);
  const empty = await ranFor("empty", "empty", {
    act: (home) => mkdir(path.join(home, ".colony")),
  });
  assert.equal(verdictOf(empty.rows), PASS);
  const stale = await ranFor("empty", "empty", {
    act: async (home) => {
      await mkdir(path.join(home, ".colony"));
      await mkdir(path.join(home, ".buzz"));
    },
  });
  assert.equal(statuses(stale.rows)["NO-OLD-FOLDER"], FAIL);
  const idle = await ranFor("empty", "empty");
  assert.equal(statuses(idle.rows)["FRESH-NEW-FOLDER"], NOT_OBSERVED);
});

test("read-only parent: nothing moves and the app still works; moving anyway is caught", async () => {
  const ok = await ranFor("readonly", "owner", {
    logs: LOG_BUZZ,
    act: undefined,
  });
  const withWindow = { ...ok, rows: ok.rows };
  assert.equal(statuses(withWindow.rows)["FALLBACK-UNTOUCHED"], PASS);
  assert.equal(statuses(withWindow.rows)["APP-STILL-WORKS"], NOT_OBSERVED);
  const built = await build("readonly", "owner", { logs: LOG_BUZZ });
  built.result.observations.windowReached = true;
  built.result.observations.sentinel = {
    path: "x",
    text: "Colony could not move your folder, staying on .buzz",
    lines: 1,
  };
  assert.equal(
    verdictOf(
      evaluateCase(built.result, contract).rows.filter(
        (r) => r.id !== "FOREIGN-SCRIPTS-RUN",
      ),
    ),
    PASS,
  );
  built.result.observations.windowReached = false;
  assert.equal(
    statuses(evaluateCase(built.result, contract).rows)["APP-STILL-WORKS"],
    FAIL,
  );
  const moved = await ranFor("readonly", "owner", {
    logs: LOG_BUZZ,
    act: (home) => simulateMigration(home),
  });
  assert.equal(statuses(moved.rows)["FALLBACK-UNTOUCHED"], FAIL);
});

test("running agent: nothing moves while the agent is alive; moving under it is caught", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-agent-"));
  scratch.push(dir);
  const fixture = await buildFixture({
    root: path.join(dir, "fixture"),
    variant: "owner",
  });
  const home = fixture.home;
  const before = await snapshot({ home });
  const alive = await snapshot({ home });
  await simulateMigration(home);
  const after = await snapshot({ home });
  const records = await readMigrationRecords(home, contract);
  const scripts = await runForeignScripts(home, fixture.foreignScripts);
  const input = {
    kind: "running-agent",
    before,
    after,
    afterWhileAlive: alive,
    observations: {
      hostLogLines: [
        "buzz-desktop: nest-migration: deferred, agent running, will retry next launch",
      ],
      ...records,
      agent: { pid: 4242, aliveAtManifest: true, strategyLine: "deferred" },
      foreignScripts: { before: scripts, after: scripts },
    },
  };
  const byId = statuses(evaluateCase(input, contract).rows);
  assert.equal(byId["NO-MOVE-UNDER-AGENT"], PASS);
  assert.equal(byId["LATER-MOVED-ALL"], PASS);
  const movedUnder = evaluateCase(
    { ...input, afterWhileAlive: after },
    contract,
  ).rows;
  assert.equal(statuses(movedUnder)["NO-MOVE-UNDER-AGENT"], FAIL);
  const none = evaluateCase(
    { ...input, observations: { ...input.observations, agent: undefined } },
    contract,
  ).rows;
  assert.equal(statuses(none)["NO-MOVE-UNDER-AGENT"], NOT_OBSERVED);
});

test("kill switch off: nothing migrated; migrating anyway is caught", async () => {
  const ok = await ranFor("flag-off", "owner", { logs: LOG_BUZZ });
  assert.equal(statuses(ok.rows)["KILL-SWITCH"], PASS);
  const moved = await ranFor("flag-off", "owner", {
    logs: LOG_BUZZ,
    act: (home) => simulateMigration(home),
  });
  assert.equal(statuses(moved.rows)["KILL-SWITCH"], FAIL);
});

test("reset: owned entries wiped, foreign untouched; a surviving owned entry or a deleted foreign entry is caught", async () => {
  const wipe = async (home, { keep, killForeign } = {}) => {
    await simulateMigration(home);
    for (const name of contract.ownedTopLevel)
      if (name !== keep)
        await rm(path.join(home, ".colony", name), {
          recursive: true,
          force: true,
        });
    if (killForeign)
      await rm(path.join(home, ".buzz", killForeign), {
        recursive: true,
        force: true,
      });
  };
  const withReset = async (options) => {
    const built = await build("reset", "owner", {
      act: (home) => wipe(home, options),
    });
    built.result.observations.reset = { performed: true, chosen: ".colony" };
    return evaluateCase(built.result, contract).rows;
  };
  const ok = statuses(await withReset({}));
  assert.equal(ok["RESET-OWNED-WIPED"], PASS);
  assert.equal(ok["FOREIGN-IDENTICAL"], PASS);
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
  const skipped = await build("reset", "owner", {
    act: (home) => simulateMigration(home),
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
