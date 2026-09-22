import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";
import { getStage0PackagePaths } from "./electron-stage0-package";

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const packagePaths = getStage0PackagePaths("instrumented");
const { appBinary, hostResource } = packagePaths;

test.beforeAll(() => {
  assert.ok(fs.existsSync(appBinary), `missing packaged app: ${appBinary}`);
  assert.ok(
    fs.existsSync(hostResource),
    `missing helper resource: ${hostResource}`,
  );
});

// Proof strategy (hosted only): the spec stages the REAL adapter module plus
// a lane-owned proof entrypoint (ordinary Electron main-process module with
// static imports) into a scratch directory with a lane-local package.json,
// then spawns the pinned `electron` binary against that directory. The proof
// process imports the real adapter, instantiates it with the REAL Electron
// `clipboard`, exercises the full adapter API (plain write/read, html
// alternate, missing-backend error vocabulary), and writes a JSON report the
// spec asserts. No dynamic import() inside serialized evaluate, no
// adapter-logic copies, no renderer surface, no shared entrypoints, no
// developer-machine clipboard: fresh hosted GUI session, unique per-run
// token.
test("real adapter proves against the real Electron clipboard backend", async () => {
  const electronPath = process.env.COLONY_SHELL_CLIPBOARD_ELECTRON;
  assert.ok(
    typeof electronPath === "string" && electronPath.length > 0,
    "COLONY_SHELL_CLIPBOARD_ELECTRON must point at the pinned electron binary",
  );
  assert.ok(
    fs.existsSync(electronPath),
    `missing electron binary: ${electronPath}`,
  );
  const scratch = fs.mkdtempSync(
    path.join(os.tmpdir(), "colony-shell-clipboard-"),
  );
  const reportPath = path.join(scratch, "report.json");
  for (const file of [
    "shell-clipboard.mjs",
    "shell-clipboard.proof.mjs",
    "shell-clipboard.proof-main.mjs",
  ]) {
    fs.copyFileSync(
      path.join(desktopDirectory, "src-electron", file),
      path.join(scratch, file),
    );
  }
  fs.writeFileSync(
    path.join(scratch, "package.json"),
    `${JSON.stringify({ name: "colony-shell-clipboard-proof", private: true, type: "module", main: "shell-clipboard.proof-main.mjs" }, null, 2)}\n`,
    "utf8",
  );
  const result = spawnSync(electronPath, [scratch], {
    env: {
      ...process.env,
      COLONY_SHELL_CLIPBOARD_REPORT: reportPath,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(
    result.status,
    0,
    `proof main exited status=${result.status} signal=${result.signal} ` +
      `error=${String(result.error)} stdout=${String(result.stdout).slice(-2000)} ` +
      `stderr=${String(result.stderr).slice(-2000)}`,
  );
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.ok, true);
  assert.equal(report.plainRoundTrip, true);
  assert.equal(report.htmlAlternateRoundTrip, true);
  assert.equal(
    report.backendErrorVocabulary,
    "clipboard error: clipboard backend unavailable",
  );
  assert.match(report.token, /^colony-clipboard-proof-/);
});
