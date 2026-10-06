// The proof run: for each case, build a throwaway HOME, snapshot it, launch the app under test with HOME pointing
// at it, let the migration settle, quit, snapshot, relaunch, snapshot again, and hand the evidence to the checks.
// The driver is a parameter, so the same flow runs against a packaged Buzz.app or Colony.app (the coordinator's
// proof run) and against the fake app that proves this harness itself (proof.test.mjs).
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateCase } from "./checks.mjs";
import { loadContract } from "./contract.mjs";
import { buildFixture } from "./fixture.mjs";
import {
  findManagedAgents,
  launchFake,
  launchPackaged,
  preparePrivateDirs,
  sleep,
} from "./launch.mjs";
import { buildManifest, treeHash, unpinFiles } from "./manifest.mjs";
import {
  pinFixture,
  readMigrationRecords,
  runForeignScripts,
  snapshot,
} from "./observe.mjs";
import { writeReport } from "./report.mjs";

/** Every case the runner knows. `kind` selects the flow and the checks, `variant` the fixture. */
export const CASES = Object.freeze({
  owner: {
    kind: "migrate",
    variant: "owner",
    title: "Owner-shaped HOME, only ~/.buzz",
    description:
      "The baseline: the owner's real folder shape with archive.db and its WAL, REPOS links, foreign venvs and notes.",
  },
  "repos-symlinked": {
    kind: "migrate",
    variant: "repos-symlinked",
    title: "REPOS is a symlink to an outside folder",
    description:
      "REPOS moves as a link with the same target and .repos-dir stays valid.",
  },
  "repos-dir-inside": {
    kind: "aborted",
    variant: "repos-dir-inside",
    title: ".repos-dir points inside the old nest",
    description:
      "A pointer that would dangle after the move holds the whole small set back: nothing moves, the app stays on ~/.buzz and a notice says so.",
  },
  "held-back": {
    kind: "held-back",
    variant: "repos-link-into-nest",
    title: "REPOS holds an absolute link into the old nest",
    description:
      "REPOS is held back whole and intact, everything else moves, and a notice says some items stayed where they were.",
  },
  crash: {
    kind: "crash",
    variant: "owner",
    title: "Kill mid-migration, then relaunch",
    description:
      "The migration is killed after journal entries. The relaunch resumes without loss or duplication and a further launch is a no-op.",
  },
  both: {
    kind: "both",
    variant: "both-colony-has-nest",
    title: "Both ~/.buzz and ~/.colony exist (conflicts)",
    description:
      "~/.colony already holds a nest. Conflicting entries are never overwritten and a notice is surfaced.",
  },
  "both-unrelated": {
    kind: "both-unrelated",
    variant: "both-unrelated-colony",
    title: "Both exist, ~/.colony is unrelated",
    description:
      "An unrelated ~/.colony is never overwritten and never strands the old install.",
  },
  "colony-only": {
    kind: "colony-only",
    variant: "colony-only",
    title: "Only ~/.colony exists",
    description: "Nothing is migrated and ~/.buzz is not created.",
  },
  empty: {
    kind: "empty",
    variant: "empty",
    title: "Empty HOME (fresh install)",
    description:
      "Nothing is migrated; the app uses ~/.colony and never creates ~/.buzz.",
  },
  readonly: {
    kind: "readonly",
    variant: "owner",
    title: "Read-only parent folder",
    description:
      "HOME is read-only, so the new folder cannot be created. The app keeps working on ~/.buzz and nothing is touched.",
    homeMode: 0o555,
  },
  "running-agent": {
    kind: "running-agent",
    variant: "owner",
    title: "A running agent at update",
    description:
      "A process holds the old nest as its working directory and an open file. Nothing may move under it. After it stops, the next launch migrates.",
  },
  "flag-off": {
    kind: "flag-off",
    variant: "owner",
    title: "Kill switch off",
    description:
      "With the migration disabled the app keeps using ~/.buzz and nothing moves.",
  },
  stale: {
    kind: "migrate-stale",
    variant: "owner-stale-version",
    title: "Old version stamps: the host refreshes AGENTS.md",
    description:
      "The version stamps are older than the build's templates, so the host refreshes AGENTS.md and the skill after the move. Notes below the managed markers must survive.",
  },
  reset: {
    kind: "reset",
    variant: "owner",
    title: "Reset after a migration",
    description:
      "Reset wipes only Colony-owned entries of the chosen folder, ~/.colony. Foreign entries in ~/.buzz are untouched.",
  },
  "reset-legacy": {
    kind: "reset",
    variant: "owner",
    title: "Reset on an install that did not migrate",
    description:
      "With the migration off the chosen folder is ~/.buzz. Reset wipes only its Colony-owned entries and leaves .venv-tts, .venv-chatterbox and the notes.",
    flagOff: true,
  },
});

export const DEFAULT_CASES = Object.keys(CASES);

const iso = () => new Date().toISOString();

/** Poll `probe` until it returns something truthy or the timeout passes. */
export async function waitFor(
  probe,
  { timeoutMs = 30000, intervalMs = 100 } = {},
) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await probe();
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

/** Path of the host's app-data folder under a fixture home (Tauri resolves it from HOME on macOS). */
export function hostAppDataDir(home, userDataDir, base = "xyz.block.buzz.app") {
  const profile = createHash("sha256")
    .update(userDataDir)
    .digest("hex")
    .slice(0, 16);
  return path.join(
    home,
    "Library",
    "Application Support",
    `${base}.electron.${profile}`,
  );
}

/** Path of the boot-reset sentinel for that app-data folder (reset.rs sentinel_path). */
export function resetSentinelPath(appDataDir) {
  return path.join(
    path.dirname(appDataDir),
    `.${path.basename(appDataDir)}.reset-pending`,
  );
}

/** Start a process that stands in for a running agent: working directory is the nest, one file held open. */
export async function startStandInAgent({
  nest,
  appDataDir,
  markerEnv = "BUZZ_MANAGED_AGENT",
}) {
  const script = `
    const fs = require("node:fs");
    fs.mkdirSync(".scratch", { recursive: true });
    fs.openSync(".scratch/held.lock", "w");
    process.stdout.write("ready\\n");
    setInterval(() => {}, 1000);
  `;
  // The migration only counts a process as an agent when it carries this install's ownership marker.
  const child = spawn(process.execPath, ["-e", script], {
    cwd: nest,
    env: { PATH: process.env.PATH, [markerEnv]: path.basename(appDataDir) },
    stdio: ["ignore", "pipe", "ignore"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("stand-in agent exited early")));
  });
  const pidDir = path.join(appDataDir, "agents", "agent-pids");
  await mkdir(pidDir, { recursive: true });
  const pidFile = path.join(pidDir, `${"ab".repeat(32)}.pid`);
  await writeFile(pidFile, `${child.pid}\n`);
  return {
    pid: child.pid,
    pidFile,
    isAlive: () => {
      try {
        process.kill(child.pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    async stop() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
      });
      await rm(pidFile, { force: true });
    },
  };
}

/** Everything a flow needs. */
function makeContext(options) {
  const contract = loadContract(options.contract);
  return {
    contract,
    work: options.work,
    relayUrl: options.relayUrl ?? "ws://127.0.0.1:9",
    flagMode: options.flagMode ?? "env",
    crashAt: options.crashAt ?? "5:after",
    profileDir: options.profileDir ?? null,
    driver: options.driver,
    extraEnv: options.extraEnv ?? {},
    settleMs: options.settleMs ?? 1500,
    nestLineTimeoutMs: options.nestLineTimeoutMs ?? 90000,
    stableTimeoutMs: options.stableTimeoutMs ?? 60000,
  };
}

/** Env that turns the migration on, off, or leaves the build's own default. */
function flagEnv(ctx, on) {
  if (ctx.flagMode === "default")
    return on ? {} : { [ctx.contract.env.flag]: ctx.contract.env.flagOff };
  return {
    [ctx.contract.env.flag]: on
      ? ctx.contract.env.flagOn
      : ctx.contract.env.flagOff,
  };
}

async function startApp(ctx, state, label, extraEnv) {
  const common = {
    fixtureRoot: state.fixture.root,
    home: state.fixture.home,
    userDataDir: state.priv.userDataDir,
    privateDir: state.priv.privateDir,
    extraEnv: { ...ctx.extraEnv, ...extraEnv },
  };
  const app =
    ctx.driver.kind === "fake"
      ? await launchFake({ ...common, script: ctx.driver.script })
      : await launchPackaged({
          ...common,
          app: ctx.driver.app,
          relayUrl: ctx.relayUrl,
        });
  state.log(`launch ${label} pid ${app.pid}`);
  if (ctx.appVersion === undefined)
    ctx.appVersion = await app.version().catch(() => null);
  return app;
}

/** Wait until the host has logged its folder choice and the HOME tree has stopped changing. */
async function settle(ctx, state, app, label) {
  const hasLine = () =>
    app
      .hostLogLines()
      .then((lines) =>
        lines.some((l) => l.includes(ctx.contract.nestFolderLogPrefix)),
      );
  const logged = await waitFor(hasLine, { timeoutMs: ctx.nestLineTimeoutMs });
  state.log(`${label}: nest-folder line ${logged ? "seen" : "NOT seen"}`);
  const signature = async () =>
    treeHash(
      (
        await buildManifest(
          state.fixture.home,
          [".buzz", ".colony", ".colony.staging"],
          { hash: false },
        )
      ).entries,
    );
  let last = await signature();
  let stableSince = Date.now();
  const end = Date.now() + ctx.stableTimeoutMs;
  while (Date.now() < end) {
    await sleep(300);
    const now = await signature();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= ctx.settleMs) break;
  }
  state.log(`${label}: tree stable`);
  return Boolean(logged);
}

async function newState(ctx, id, spec) {
  const caseDir = path.join(ctx.work, id);
  await mkdir(caseDir, { recursive: true });
  const fixture = await buildFixture({
    root: path.join(caseDir, "fixture"),
    variant: spec.variant,
  });
  const priv = await preparePrivateDirs(caseDir, "app", ctx.profileDir);
  priv.userDataDir = await realpath(priv.userDataDir);
  const timeline = [];
  const state = {
    id,
    spec,
    fixture,
    priv,
    timeline,
    log: (text) => timeline.push(`${iso()} ${text}`),
    appData: hostAppDataDir(fixture.home, priv.userDataDir),
  };
  state.log(`fixture ${spec.variant} at ${fixture.home}`);
  state.pinDir = path.join(fixture.root, ".pins");
  state.pinned = await pinFixture(fixture, ctx.contract, state.pinDir);
  state.log(
    `pinned ${state.pinned} files with hard links so inode numbers cannot be reused`,
  );
  return state;
}

async function observeWindow(app) {
  try {
    const page = await app.window(30000);
    return page ? true : undefined;
  } catch {
    return false;
  }
}

/** Snapshot, plus the foreign scripts, the migration's records and the host log. */
async function observe(ctx, state, app) {
  const records = await readMigrationRecords(state.fixture.home, ctx.contract);
  return { records, lines: await app.hostLogLines() };
}

async function flowMigrate(ctx, state) {
  const home = state.fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  const app = await startApp(ctx, state, "1", flowEnvFor(ctx, state, true));
  await settle(ctx, state, app, "launch 1");
  const windowReached = await observeWindow(app);
  const first = await observe(ctx, state, app);
  const ui = await collectUi(ctx, state, app);
  await app.quit();
  const after = await snapshot({ home });
  const second = await startApp(ctx, state, "2", flowEnvFor(ctx, state, true));
  await settle(ctx, state, second, "launch 2");
  const lines2 = await second.hostLogLines();
  await second.quit();
  const after2 = await snapshot({ home });
  const scriptsAfter = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  return {
    before,
    after,
    after2,
    observations: {
      hostLogLines: first.lines,
      hostLogLines2: lines2,
      ...first.records,
      windowReached,
      ui,
      userNote: state.fixture.userNote,
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
}

function flowEnvFor(ctx, state, on) {
  return state.spec.flagOff || !on ? flagEnv(ctx, false) : flagEnv(ctx, true);
}

/**
 * UI and process evidence needs a signed-in profile. Without one nothing is driven and the checks stay NOT
 * OBSERVED. With one: wait for the sidebar, look for managed agent processes below the app and read their
 * working directory (agents restore at boot), and try the Files tab of the work area for the migrated names.
 */
async function collectUi(ctx, state, app) {
  if (!ctx.profileDir || !app.page) return undefined;
  const ui = {};
  try {
    await app.page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
    ui.sidebar = true;
  } catch {
    ui.sidebar = false;
    return ui;
  }
  const identifier = path.basename(state.appData);
  const agents = await waitFor(
    async () => {
      const found = await findManagedAgents(
        app.pid,
        ctx.contract.agentMarkerEnv,
        identifier,
      );
      return found.length ? found : null;
    },
    { timeoutMs: 60000, intervalMs: 1000 },
  );
  ui.agentsRestored = agents
    ? {
        restored: true,
        pids: agents.map((a) => a.pid),
        cwd: agents[0].cwd,
        cwds: agents.map((a) => a.cwd),
      }
    : {
        restored: false,
        note: "no managed agent process appeared within 60 s",
      };
  try {
    await app.page
      .locator('[data-testid="channel-welcome" i]')
      .first()
      .click({ timeout: 8000 });
    await app.page
      .getByTestId("channel-work-area-trigger")
      .click({ timeout: 8000 });
    await app.page.getByTestId("work-area-panel").waitFor({ timeout: 8000 });
    if (
      !(await app.page
        .getByTestId("work-area-files")
        .isVisible()
        .catch(() => false))
    ) {
      await app.page.getByTestId("work-area-add-tab").click({ timeout: 6000 });
      await app.page
        .getByTestId("work-area-add-files")
        .click({ timeout: 6000 });
    }
    await app.page.getByTestId("work-area-files").waitFor({ timeout: 8000 });
    const text = (
      await app.page.getByTestId("work-area-files").innerText()
    ).replace(/\s+/gu, " ");
    const names = ctx.contract.ownedTopLevel.filter((name) =>
      text.includes(name),
    );
    ui.filesTab = { opened: true, names, sample: text.slice(0, 200) };
  } catch (error) {
    ui.filesTab = {
      opened: false,
      error: String(error.message ?? error).slice(0, 160),
    };
  }
  return ui;
}

async function flowCrash(ctx, state) {
  const home = state.fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  const env = {
    ...flagEnv(ctx, true),
    [ctx.contract.env.crashAt]: ctx.crashAt,
  };
  const app = await startApp(ctx, state, `1 (crash seam ${ctx.crashAt})`, env);
  // The seam ends the host process by itself (exit code 86) and logs a line first. Under Electron the host is a
  // child of the app, so wait for the line or the exit, then stop whatever is left of the app.
  const seamSeen = await waitFor(
    async () =>
      !app.isRunning() ||
      (await app.hostLogLines()).some((l) => l.includes("crash seam")),
    { timeoutMs: ctx.nestLineTimeoutMs, intervalMs: 20 },
  );
  const crashLines = await app.hostLogLines();
  const seamLine = crashLines.some((l) => l.includes("crash seam"));
  let exitCode = null;
  if (!app.isRunning()) exitCode = (await app.exited).code;
  else await app.kill();
  state.log(
    `launch 1 ended: seam line ${seamLine}, exit code ${exitCode}, waited ${seamSeen ? "ok" : "timeout"}`,
  );
  const killRecords = await readMigrationRecords(home, ctx.contract);
  const afterKill = await snapshot({ home });
  const killed = {
    by: seamLine ? "crash seam" : "not stopped by the seam",
    exitCode,
    seamLine,
    crashAt: ctx.crashAt,
    journal: killRecords.journal,
  };
  const second = await startApp(ctx, state, "2 (resume)", flagEnv(ctx, true));
  await settle(ctx, state, second, "launch 2");
  const resumed = await observe(ctx, state, second);
  await second.quit();
  const after = await snapshot({ home });
  const third = await startApp(ctx, state, "3", flagEnv(ctx, true));
  await settle(ctx, state, third, "launch 3");
  const lines3 = await third.hostLogLines();
  await third.quit();
  const after2 = await snapshot({ home });
  const scriptsAfter = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  return {
    before,
    after,
    after2,
    afterKill,
    observations: {
      hostLogLines: resumed.lines,
      hostLogLines2: lines3,
      ...resumed.records,
      killed,
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
}

async function flowSingle(ctx, state, { on, chmodHome = null }) {
  const home = state.fixture.home;
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(
    home,
    state.fixture.foreignScripts ?? [],
  );
  let app;
  try {
    if (chmodHome) await chmod(home, chmodHome);
    app = await startApp(
      ctx,
      state,
      "1",
      on ? flagEnv(ctx, true) : flagEnv(ctx, false),
    );
    await settle(ctx, state, app, "launch 1");
    const windowReached = await observeWindow(app);
    const first = await observe(ctx, state, app);
    await app.quit();
    if (chmodHome) await chmod(home, 0o755);
    const after = await snapshot({ home });
    const scriptsAfter = await runForeignScripts(
      home,
      state.fixture.foreignScripts ?? [],
    );
    return {
      before,
      after,
      observations: {
        hostLogLines: first.lines,
        ...first.records,
        windowReached,
        foreignScripts: { before: scriptsBefore, after: scriptsAfter },
      },
    };
  } finally {
    if (chmodHome) await chmod(home, 0o755).catch(() => undefined);
  }
}

async function flowRunningAgent(ctx, state) {
  const home = state.fixture.home;
  const nest = path.join(home, ctx.contract.oldNest);
  const before = await snapshot({ home });
  const scriptsBefore = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  const agent = await startStandInAgent({
    nest,
    appDataDir: state.appData,
    markerEnv: ctx.contract.agentMarkerEnv,
  });
  state.log(
    `stand-in agent pid ${agent.pid}, cwd ${nest}, holding .scratch/held.lock`,
  );
  let afterWhileAlive;
  let strategyLine;
  let firstLines = [];
  let aliveAtManifest = false;
  try {
    const app = await startApp(
      ctx,
      state,
      "1 (agent running)",
      flagEnv(ctx, true),
    );
    await settle(ctx, state, app, "launch 1");
    aliveAtManifest = agent.isAlive();
    afterWhileAlive = await snapshot({ home });
    const lines = await app.hostLogLines();
    firstLines = lines;
    strategyLine = lines.find(
      (l) =>
        l.includes(ctx.contract.migrationLogPrefix) &&
        /agent|running|defer|quiesc/iu.test(l),
    );
    await app.quit();
  } finally {
    await agent.stop();
  }
  const afterFirstRun = await snapshot({ home });
  const second = await startApp(
    ctx,
    state,
    "2 (agent stopped)",
    flagEnv(ctx, true),
  );
  await settle(ctx, state, second, "launch 2");
  const resumed = await observe(ctx, state, second);
  await second.quit();
  const after = await snapshot({ home });
  const scriptsAfter = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  return {
    before,
    after,
    afterWhileAlive,
    afterFirstRun,
    observations: {
      hostLogLines: [...firstLines, ...resumed.lines],
      ...resumed.records,
      agent: {
        pid: agent.pid,
        aliveAtManifest,
        strategyLine,
        firstLaunchLines: firstLines,
      },
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
}

async function flowReset(ctx, state) {
  const home = state.fixture.home;
  const scriptsBefore = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  if (!state.spec.flagOff) {
    // First reach the migrated state, then request the reset.
    const app = await startApp(ctx, state, "1 (migrate)", flagEnv(ctx, true));
    await settle(ctx, state, app, "launch 1");
    await app.quit();
  }
  const before = await snapshot({ home });
  await mkdir(path.dirname(state.appData), { recursive: true });
  await writeFile(resetSentinelPath(state.appData), "");
  state.log(`reset sentinel written at ${resetSentinelPath(state.appData)}`);
  const app = await startApp(
    ctx,
    state,
    "reset",
    state.spec.flagOff ? flagEnv(ctx, false) : flagEnv(ctx, true),
  );
  await settle(ctx, state, app, "reset launch");
  const observed = await observe(ctx, state, app);
  await app.quit();
  const after = await snapshot({ home });
  const scriptsAfter = await runForeignScripts(
    home,
    state.fixture.foreignScripts,
  );
  const chosen = state.spec.flagOff
    ? ctx.contract.oldNest
    : ctx.contract.newNest;
  const failedLine = observed.lines.find((l) =>
    /reset: verification failed/u.test(l),
  );
  return {
    before,
    after,
    observations: {
      hostLogLines: observed.lines,
      ...observed.records,
      reset: { performed: true, chosen, failedLine },
      foreignScripts: { before: scriptsBefore, after: scriptsAfter },
    },
  };
}

const FLOWS = {
  migrate: flowMigrate,
  crash: flowCrash,
  "migrate-stale": flowMigrate,
  aborted: flowMigrate,
  "held-back": flowMigrate,
  both: flowMigrate,
  "both-unrelated": flowMigrate,
  "colony-only": (ctx, state) => flowSingle(ctx, state, { on: true }),
  empty: (ctx, state) => flowSingle(ctx, state, { on: true }),
  readonly: (ctx, state) =>
    flowSingle(ctx, state, { on: true, chmodHome: 0o555 }),
  "flag-off": (ctx, state) => flowSingle(ctx, state, { on: false }),
  "running-agent": flowRunningAgent,
  reset: flowReset,
};

/** Run one case and return the section the report renders. */
export async function runCase(ctx, id) {
  const spec = CASES[id];
  if (!spec) throw new Error(`unknown case ${id}`);
  const state = await newState(ctx, id, spec);
  let evidence;
  let blocked;
  try {
    evidence = await FLOWS[spec.kind](ctx, state);
  } catch (error) {
    blocked = `The flow stopped: ${String(error.message ?? error).slice(0, 400)}`;
    state.log(blocked);
  } finally {
    // Removing a pin updates the file's ctime, so it happens only after the last manifest was taken.
    await unpinFiles(state.pinDir);
  }
  if (!evidence) {
    return {
      id,
      title: spec.title,
      description: spec.description,
      variant: spec.variant,
      kind: spec.kind,
      blocked,
      rows: [
        {
          id: "RUN",
          label: "The case ran to the end",
          status: "FAIL",
          detail: blocked,
        },
      ],
      timeline: state.timeline,
    };
  }
  const { rows, diff } = evaluateCase(
    { kind: spec.kind, ...evidence },
    ctx.contract,
  );
  return {
    id,
    title: spec.title,
    description: spec.description,
    variant: spec.variant,
    kind: spec.kind,
    rows,
    timeline: state.timeline,
    evidence: {
      diff: {
        foreign: {
          ...diff.foreign,
          differences: diff.foreign.differences.slice(0, 20),
        },
        owned: { ...diff.owned, movedClean: diff.owned.movedClean.length },
        generated: diff.generated,
        addedToOld: diff.addedToOld,
        unexpectedInNew: diff.unexpectedInNew,
        createdInNew: diff.createdInNew,
      },
      hostLogLines: (evidence.observations.hostLogLines ?? []).slice(-60),
      journal: evidence.observations.journal,
      notice: evidence.observations.notice,
      database: state.fixture.database,
    },
  };
}

/**
 * Run the selected cases and write the report.
 * @param {object} options
 * @param {{kind: "packaged", app: string} | {kind: "fake", script: string}} options.driver
 * @param {string} options.out report directory
 * @param {string[]} [options.cases]
 * @param {string} [options.work] working folder for fixtures (default: a new folder under the OS temp dir)
 */
export async function runProof(options) {
  const work =
    options.work ??
    (await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-run-")));
  const ctx = makeContext({ ...options, work });
  const startedAt = iso();
  const cases = [];
  for (const id of options.cases ?? DEFAULT_CASES) {
    const result = await runCase(ctx, id);
    cases.push(result);
    options.onCase?.(result);
  }
  const data = {
    title: options.title ?? "Colony nest migration: seeded-HOME proof",
    startedAt,
    finishedAt: iso(),
    app: {
      path: ctx.driver.app ?? ctx.driver.script,
      version: ctx.appVersion ?? "not read",
    },
    method: [
      "Each case builds a throwaway HOME from synthetic files shaped like the owner's real ~/.buzz (names, kinds and modes from a read-only listing; no private contents were read or copied).",
      "The app is launched with HOME pointing at that fixture, inside a sandbox that denies the real home's ~/.buzz and ~/.colony and the keychain services.",
      "Before and after manifests record path, type, size, mode, inode, mtime and sha256 for every entry, link targets without following links, and row counts for archive.db read from a copy so the original and its -wal and -shm are never opened.",
      `The migration flag is ${ctx.flagMode === "env" ? `set explicitly through ${ctx.contract.env.flag}` : "left at the build's own default"}.`,
      ctx.profileDir
        ? "A copy of a signed-in profile was used, so UI evidence was attempted."
        : "No signed-in profile was supplied, so checks that need the Files tab or restored agents are NOT OBSERVED.",
      `Work folder: ${work}`,
    ],
    contract: ctx.contract,
    cases,
  };
  const file = await writeReport(options.out, data);
  return { file, data };
}
