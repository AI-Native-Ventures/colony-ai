import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FAIL, NOT_OBSERVED, PASS, verdictOf } from "./checks.mjs";
import {
  buildLaunchEnv,
  findManagedAgents,
  parseLsofCwd,
  sandboxPolicy,
} from "./launch.mjs";
import {
  CASES,
  DEFAULT_CASES,
  hostAppDataDir,
  resetSentinelPath,
  runProof,
} from "./proof.mjs";
import { renderReport } from "./report.mjs";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "fake-app.mjs");
const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

const FAST = {
  settleMs: 250,
  stableTimeoutMs: 15000,
  nestLineTimeoutMs: 15000,
};

async function proof(cases, extraEnv = {}) {
  const base = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-run-test-"),
  );
  scratch.push(base);
  const result = await runProof({
    driver: { kind: "fake", script },
    out: path.join(base, "report"),
    work: path.join(base, "work"),
    cases,
    extraEnv,
    ...FAST,
  });
  const byCase = Object.fromEntries(result.data.cases.map((c) => [c.id, c]));
  const status = (caseId, rowId) =>
    byCase[caseId].rows.find((r) => r.id === rowId)?.status;
  return { ...result, byCase, status, base };
}

test("every case is described and has a flow", () => {
  assert.equal(DEFAULT_CASES.length, 15);
  for (const [id, spec] of Object.entries(CASES)) {
    assert.ok(spec.title && spec.description && spec.variant && spec.kind, id);
  }
});

test("the full proof against a correct fake app: no FAIL anywhere, and only the profile-only checks stay NOT OBSERVED", async () => {
  const { data, byCase, file } = await proof(DEFAULT_CASES);
  const failing = data.cases.flatMap((c) =>
    c.rows
      .filter((r) => r.status === FAIL)
      .map((r) => `${c.id}/${r.id}: ${r.detail}`),
  );
  assert.deepEqual(failing, []);
  const gaps = data.cases.flatMap((c) =>
    c.rows
      .filter((r) => r.status === NOT_OBSERVED)
      .map((r) => `${c.id}/${r.id}`),
  );
  const allowed = new Set([
    "owner/FILES-TAB",
    "owner/AGENTS-RESTORE",
    "owner/REPOS-DIR",
    "repos-symlinked/FILES-TAB",
    "repos-symlinked/AGENTS-RESTORE",
  ]);
  const unexpected = gaps.filter((gap) => !allowed.has(gap));
  assert.deepEqual(
    unexpected,
    [],
    "a check that should have been observed was not",
  );
  assert.equal(
    byCase.crash.rows.find((r) => r.id === "KILL-LANDED").status,
    PASS,
  );
  assert.equal(
    byCase["running-agent"].rows.find((r) => r.id === "NO-MOVE-UNDER-AGENT")
      .status,
    PASS,
  );
  const html = await readFile(file, "utf8");
  assert.match(html, /Colony nest migration: seeded-HOME proof/u);
  assert.match(html, /<td class="no">NOT OBSERVED<\/td>/u);
});

test("falsifiable: the runner turns each migration defect into a FAIL on the right check", async () => {
  const copy = await proof(["owner"], { FAKE_BREAK: "copy" });
  assert.equal(copy.status("owner", "RENAME-NOT-COPY"), FAIL);
  const touch = await proof(["owner"], { FAKE_BREAK: "touch-foreign" });
  assert.equal(touch.status("owner", "FOREIGN-IDENTICAL"), FAIL);
  const lost = await proof(["owner"], { FAKE_BREAK: "delete-owned" });
  assert.equal(lost.status("owner", "NO-LOSS"), FAIL);
  const noJournal = await proof(["owner"], { FAKE_BREAK: "no-journal" });
  assert.equal(noJournal.status("owner", "JOURNAL-DURABLE"), FAIL);
  const scratch = await proof(["owner"], { FAKE_BREAK: "move-scratch" });
  assert.equal(scratch.status("owner", "FOREIGN-IDENTICAL"), FAIL);
  const overwrite = await proof(["both"], { FAKE_BREAK: "overwrite" });
  assert.equal(overwrite.status("both", "CONFLICTS-KEPT"), FAIL);
  assert.equal(verdictOf(overwrite.byCase.both.rows), FAIL);
});

test("falsifiable: moving under a running agent, ignoring the kill switch, and a Reset that wipes foreign entries or never completes", async () => {
  const agent = await proof(["running-agent"], { FAKE_BREAK: "ignore-agent" });
  assert.equal(agent.status("running-agent", "NO-MOVE-UNDER-AGENT"), FAIL);
  const flag = await proof(["flag-off"], { FAKE_BREAK: "ignore-flag" });
  assert.equal(flag.status("flag-off", "KILL-SWITCH"), FAIL);
  const wipe = await proof(["reset-legacy"], { FAKE_BREAK: "reset-wipes-all" });
  assert.equal(wipe.status("reset-legacy", "FOREIGN-IDENTICAL"), FAIL);
  const never = await proof(["reset-legacy"], {
    FAKE_BREAK: "reset-never-completes",
  });
  assert.equal(never.status("reset-legacy", "RESET-COMPLETES"), FAIL);
});

test("with the build's default flag (off) the migration does not run, which the owner case reports as a failure", async () => {
  const base = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-run-test-"),
  );
  scratch.push(base);
  const result = await runProof({
    driver: { kind: "fake", script },
    out: path.join(base, "report"),
    work: path.join(base, "work"),
    cases: ["owner"],
    flagMode: "default",
    ...FAST,
  });
  const owner = result.data.cases[0];
  assert.equal(owner.rows.find((r) => r.id === "MOVED-ALL").status, FAIL);
});

test("a case whose flow cannot start is reported as a FAIL row with the reason, not skipped", async () => {
  const base = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-run-test-"),
  );
  scratch.push(base);
  const result = await runProof({
    driver: { kind: "fake", script: path.join(base, "does-not-exist.mjs") },
    out: path.join(base, "report"),
    work: path.join(base, "work"),
    cases: ["colony-only"],
    ...FAST,
    nestLineTimeoutMs: 1500,
    stableTimeoutMs: 2000,
  });
  const section = result.data.cases[0];
  const nothing = section.rows.find(
    (row) => row.status === FAIL || row.status === NOT_OBSERVED,
  );
  assert.ok(nothing, "a missing app must never read as all PASS");
  assert.notEqual(verdictOf(section.rows), PASS);
});

test("the command line runs against the fake app and exits 0, writing index.html and results.json", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-cli-"));
  scratch.push(base);
  const { stdout } = await run(process.execPath, [
    path.join(here, "run.mjs"),
    "--fake-app",
    "--out",
    path.join(base, "r"),
    "--cases",
    "colony-only,empty",
    "--work",
    path.join(base, "w"),
  ]);
  assert.match(stdout, /report .*index\.html: \d+ PASS, 0 FAIL/u);
  const results = JSON.parse(
    await readFile(path.join(base, "r", "results.json"), "utf8"),
  );
  assert.equal(results.cases.length, 2);
  await assert.rejects(
    run(process.execPath, [path.join(here, "run.mjs")]),
    /usage/u,
  );
});

test("launch environment: HOME is the fixture, inherited credentials stay out, the real home is denied in the sandbox", () => {
  const env = buildLaunchEnv({
    home: "/fixture/home",
    userDataDir: "/priv/user-data",
    relayUrl: "ws://127.0.0.1:9",
    hostLog: "/priv/host.log",
    source: {
      HOME: "/Users/real",
      PATH: "/bin",
      GH_TOKEN: "secret",
      BUZZ_PRIVATE_KEY: "secret",
      ANTHROPIC_API_KEY: "secret",
      USER: "u",
    },
  });
  assert.equal(env.HOME, "/fixture/home");
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.BUZZ_PRIVATE_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.COLONY_NATIVE_HOST_LOG, "/priv/host.log");
  const policy = sandboxPolicy("/Users/real");
  assert.match(
    policy,
    /deny file-read\* file-write\* \(subpath "\/Users\/real\/\.buzz"\)/u,
  );
  assert.match(
    policy,
    /deny file-read\* file-write\* \(subpath "\/Users\/real\/\.colony"\)/u,
  );
  assert.match(policy, /Keychains/u);
  assert.match(
    policy,
    /regex #"\^\/Users\/real\/Library\/Application Support\/xyz\\\.block\\\.buzz\\\.app\\\.electron\\\."/u,
  );
  assert.match(
    policy,
    /deny file-write\* \(literal "\/Users\/real\/\.local\/bin\/buzz"\)/u,
  );
  assert.match(policy, /securityd/u);
});

test("the reset sentinel and host app-data folder follow the host's own derivation", () => {
  const dir = hostAppDataDir("/h", "/priv/user-data");
  assert.match(
    dir,
    /^\/h\/Library\/Application Support\/xyz\.block\.buzz\.app\.electron\.[0-9a-f]{16}$/u,
  );
  assert.equal(
    resetSentinelPath(dir),
    `/h/Library/Application Support/.${path.basename(dir)}.reset-pending`,
  );
});

test("the report escapes markup, never prints an em dash, and ranks FAIL over NOT OBSERVED over PASS", () => {
  const html = renderReport({
    title: "t",
    app: { path: "/a<b>", version: "1" },
    startedAt: "s",
    finishedAt: "f",
    method: ["m — dash"],
    contract: { x: "<script>" },
    cases: [
      {
        id: "one",
        title: "T",
        description: "D",
        variant: "v",
        rows: [
          { id: "A", label: "l", status: PASS, detail: "ok" },
          { id: "B", label: "l", status: NOT_OBSERVED, detail: "gap" },
        ],
      },
      {
        id: "two",
        title: "T",
        description: "D",
        variant: "v",
        rows: [{ id: "C", label: "l", status: FAIL, detail: "<b>bad</b>" }],
      },
    ],
  });
  assert.equal(html.includes("—"), false);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /class="verdict fail">FAIL/u);
  assert.match(html, /&lt;b&gt;bad&lt;\/b&gt;/u);
});

test("parseLsofCwd keeps the n lines, and findManagedAgents sees only descendants that carry the ownership marker, with their cwd", async () => {
  assert.deepEqual(parseLsofCwd("p123\nfcwd\nn/Users/a b/.colony\n"), [
    "/Users/a b/.colony",
  ]);
  const { spawn } = await import("node:child_process");
  const { realpath, mkdir } = await import("node:fs/promises");
  const base = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-agents-"),
  );
  scratch.push(base);
  const cwd = path.join(base, ".colony");
  await mkdir(cwd);
  const spawnSleeper = (env) =>
    spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd,
      env: { PATH: process.env.PATH, ...env },
      stdio: "ignore",
    });
  const marked = spawnSleeper({ BUZZ_MANAGED_AGENT: "xyz.test.id" });
  const other = spawnSleeper({ BUZZ_MANAGED_AGENT: "another.install" });
  const plain = spawnSleeper({});
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const found = await findManagedAgents(
      process.pid,
      "BUZZ_MANAGED_AGENT",
      "xyz.test.id",
    );
    assert.deepEqual(
      found.map((a) => a.pid),
      [marked.pid],
    );
    assert.equal(found[0].cwd, await realpath(cwd));
    assert.deepEqual(
      await findManagedAgents(process.pid, "BUZZ_MANAGED_AGENT", "nobody"),
      [],
    );
  } finally {
    for (const child of [marked, other, plain]) child.kill("SIGKILL");
  }
});

test("on macOS the sandbox policy parses and really blocks a stand-in real home's nest folders", {
  skip: process.platform === "darwin" ? false : "sandbox-exec is macOS only",
}, async () => {
  const { writeFile, mkdir, realpath } = await import("node:fs/promises");
  const base = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-sbx-")),
  );
  scratch.push(base);
  const standIn = path.join(base, "realhome");
  await mkdir(path.join(standIn, ".buzz"), { recursive: true });
  await mkdir(path.join(standIn, ".colony"), { recursive: true });
  await mkdir(
    path.join(
      standIn,
      "Library/Application Support/xyz.block.buzz.app.electron.0123456789abcdef",
    ),
    { recursive: true },
  );
  await mkdir(path.join(standIn, "other"), { recursive: true });
  const policy = path.join(base, "policy.sb");
  await writeFile(policy, sandboxPolicy(standIn));
  const sandboxed = (...args) =>
    run("/usr/bin/sandbox-exec", ["-f", policy, ...args]);
  await sandboxed("/usr/bin/true");
  await sandboxed("/bin/ls", path.join(standIn, "other"));
  for (const blocked of [
    ".buzz",
    ".colony",
    "Library/Application Support/xyz.block.buzz.app.electron.0123456789abcdef",
  ])
    await assert.rejects(
      sandboxed("/bin/ls", path.join(standIn, blocked)),
      /Operation not permitted/u,
      blocked,
    );
});
