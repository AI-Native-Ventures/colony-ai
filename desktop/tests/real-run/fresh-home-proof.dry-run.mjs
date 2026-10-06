// Wiring check for fresh-home-proof.mjs without a packaged app: runs the REAL driver with
// @playwright/test replaced by a stub (dry-run/playwright-stub.mjs) and scripted page answers, then
// checks the report and verdict. A clean script must PASS, a leaky one must FAIL with the old name
// listed. This proves the driver's orchestration, judging and report writing; it proves nothing
// about the product. Local only, takes about half a minute.
// usage (from desktop/): node tests/real-run/fresh-home-proof.dry-run.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function run(fixture) {
  const dir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "colony-dry-run-")),
  );
  const app = path.join(dir, "Fake.app");
  await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
  await writeFile(path.join(app, "Contents", "MacOS", "Colony"), "");
  const out = path.join(dir, "out");
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      path.join(here, "dry-run", "register.mjs"),
      path.join(here, "fresh-home-proof.mjs"),
      "--app",
      app,
      "--out",
      out,
      "--prompts",
      "1",
      "--intro-timeout-ms",
      "3000",
      "--deadline-min",
      "5",
      "--no-load-gate",
      "--expect-version",
      "1.0.6",
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: os.homedir(),
        TMPDIR: process.env.TMPDIR,
        COLONY_REAL_RUN: "1",
        DRYRUN_FIXTURE: fixture,
      },
      encoding: "utf8",
      timeout: 120000,
    },
  );
  const results = JSON.parse(
    await readFile(path.join(out, "results.json"), "utf8"),
  );
  const html = await readFile(path.join(out, "index.html"), "utf8");
  return { dir, result, results, html };
}

const clean = await run("brand-capture-clean.json");
try {
  const failed = clean.results.rows.filter(
    (r) => r.status !== "PASS" && r.status !== "INFO",
  );
  assert.equal(clean.results.verdict, "PASS", JSON.stringify(failed, null, 1));
  assert.equal(clean.result.status, 0, clean.result.stderr);
  for (const id of [
    "H0",
    "H1",
    "H2",
    "H3",
    "H4",
    "S-chat",
    "S-transcript",
    "S-session-panel",
    "S-activity-page",
    "S-activity-strip",
    "S-details-popover",
    "S-transcript-expanded",
    "P-cov",
  ])
    assert.equal(
      clean.results.rows.find((r) => r.id === id)?.status,
      "PASS",
      id,
    );
  assert.match(clean.html, /class="verdict pass">PASS/u);
  assert.ok(clean.results.home.after.includes(".colony"));
  console.log("dry run, clean script: PASS as expected");
} finally {
  await rm(clean.dir, { recursive: true, force: true });
}

const leaky = await run("brand-capture-leaky.json");
try {
  assert.equal(leaky.results.verdict, "FAIL");
  assert.equal(leaky.result.status, 1);
  for (const id of [
    "S-chat",
    "S-transcript",
    "S-session-panel",
    "S-activity-page",
    "S-activity-strip",
    "S-details-popover",
  ])
    assert.equal(
      leaky.results.rows.find((r) => r.id === id)?.status,
      "FAIL",
      id,
    );
  assert.equal(
    leaky.results.rows.find((r) => r.id === "S-transcript-expanded")?.status,
    "PASS",
  );
  assert.match(leaky.html, /class="verdict fail">FAIL/u);
  assert.match(leaky.html, /buzz mem get core/u);
  console.log("dry run, leaky script: FAIL as expected, old name listed");
} finally {
  await rm(leaky.dir, { recursive: true, force: true });
}
