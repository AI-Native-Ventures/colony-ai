import { _electron as electron } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Evidence } from "./report.mjs";
import {
  assertSafeDiagnostics,
  cleanEnvironment,
  outsideRepo,
  sandboxPolicy,
} from "./safety.mjs";
import { driveFirstRun } from "./steps.mjs";

assertSafeDiagnostics(process.env);
const exec = promisify(execFile);
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const options = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, args) => {
    if (index % 2 === 0 && value.startsWith("--"))
      pairs.push([value.slice(2), args[index + 1]]);
    return pairs;
  }, []),
);
if (process.env.CI || process.env.COLONY_REAL_RUN !== "1") {
  throw new Error(
    "Real first-run proof is local-only and requires COLONY_REAL_RUN=1.",
  );
}
if (process.platform !== "darwin")
  throw new Error("This no-keychain process sandbox requires macOS.");
if (!options.app || !options.output || !options.relay)
  throw new Error("Supply --app, --output and --relay.");
const relay = new URL(options.relay);
if (
  relay.protocol !== "https:" ||
  relay.username ||
  relay.password ||
  relay.search ||
  relay.hash
) {
  throw new Error("Use a plain HTTPS relay origin without credentials.");
}
const replyTimeoutMs = Number(options["reply-timeout-ms"] ?? 120000);
if (
  !Number.isInteger(replyTimeoutMs) ||
  replyTimeoutMs < 1000 ||
  replyTimeoutMs > 300000
) {
  throw new Error("Reply deadline must be 1000 to 300000 milliseconds.");
}
const output = path.resolve(options.output);
await mkdir(output, { recursive: true });
outsideRepo(output, repo);
try {
  await readFile(path.join(output, "results.json"));
  throw new Error("Existing baseline report: choose a new output directory.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const appPath = path.resolve(options.app);
const executable = path.join(appPath, "Contents", "MacOS", "Colony");
const resources = path.join(appPath, "Contents", "Resources");
const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const privateDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-real-run-private-")),
);
await chmod(privateDir, 0o700);
const userDataDir = path.join(privateDir, "user-data");
await mkdir(userDataDir, { mode: 0o700 });
const probeDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-real-run-deny-probe-")),
);
const { nativeDir, profile, policy } = sandboxPolicy(userDataDir, probeDir);
const sandboxPath = path.join(privateDir, "sandbox.sb");
await writeFile(sandboxPath, policy, { mode: 0o600 });
const quote = (value) => `'${value.replace(/'/gu, `'\\''`)}'`;
const launcher = path.join(privateDir, "launch.sh");
await writeFile(
  launcher,
  `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(sandboxPath)} ${quote(executable)} "$@"\n`,
  { mode: 0o700 },
);
const evidence = new Evidence(output, {
  mode: "Restricted packaged baseline",
  appPath,
  scope:
    "Unchanged artifact and native IPC, real relay and disposable account. Process sandbox denies keychain access and existing home agent/application data. Normal storage and signed-in provider authentication remain unproven.",
  artifact: {
    asarSha256: await digest(path.join(resources, "app.asar")),
    nativeHostSha256: await digest(path.join(resources, "colony-native-host")),
  },
  chromiumSandbox:
    "Disabled because macOS rejects nested sandbox initialization. Mandatory outer process policy remains inherited by children.",
  sourceBase: "6e04386b1bd0dfc2494eae730e41b7fbe3eeda5a",
  relay: relay.origin,
  privateProfile: { userDataDir, nativeDir, profile },
  replyTimeoutMs,
});
await evidence.write();
let driverFailure = false;
process.on("unhandledRejection", () => {
  driverFailure = true;
  evidence.metadata.driverFailure =
    "Playwright launch driver rejected; full proof is blocked.";
  void evidence.write();
});
let application;
let page;
try {
  // Prove this child cannot read a harmless synthetic path outside its profile.
  const probe =
    'const fs=require("fs");try{fs.readdirSync(process.argv[1]);process.exit(9)}catch(e){process.exit(e.code==="EPERM"||e.code==="EACCES"?0:8)}';
  await exec(
    "/usr/bin/sandbox-exec",
    ["-f", sandboxPath, process.execPath, "-e", probe, probeDir],
    { timeout: 10000 },
  );
  evidence.metadata.sandboxDenyProbe = "PASS";
  await evidence.write();
  application = await electron.launch({
    executablePath: launcher,
    args: ["--no-sandbox", `--user-data-dir=${userDataDir}`],
    env: cleanEnvironment(process.env, userDataDir, relay.origin),
    timeout: 45000,
  });
  const provenance = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    userDataDir: app.getPath("userData"),
  }));
  evidence.metadata.runtime = provenance;
  if (!provenance.packaged || provenance.userDataDir !== userDataDir)
    throw new Error("Packaged profile isolation assertion failed.");
  page = await application.firstWindow({ timeout: 20000 });
  await page.setViewportSize({ width: 1728, height: 1117 });
  await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
  await driveFirstRun({
    page,
    evidence,
    website: options.website ?? "https://example.com",
    replyTimeoutMs,
    inspectWithoutAi: options["inspect-without-ai"] === "1",
  });
} catch (error) {
  evidence.metadata.failureCategory = error.name;
  // Never persist raw automation exceptions: locator arguments can contain secrets.
  evidence.metadata.failureSummary =
    "A required startup or first-run operation failed. Raw exception arguments withheld.";
  const account = evidence.rows.find((item) => item.name === "Account");
  let row = account;
  if (account.status !== "BLOCKED") {
    row = {
      name: "Unexpected prerequisite",
      status: "FAIL",
      reason:
        "An uncaptured first-run prerequisite failed. Downstream steps remain blocked.",
      sinceStartMs: Date.now() - evidence.started,
    };
    evidence.rows.push(row);
  } else {
    row.reason =
      "Restricted packaged startup did not reach Account within the launch gate. No native/mock substitution was made.";
  }
  evidence.metadata.prerequisiteFailure =
    "Raw exception and process logs withheld to avoid credential disclosure. Sandbox restrictions may be causal.";
  if (page && !page.isClosed()) await evidence.capture(row.name, page, row);
} finally {
  if (application) {
    try {
      await Promise.race([
        application.close(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Close deadline")), 10000),
        ),
      ]);
    } catch {
      application.process().kill("SIGTERM");
    }
  }
  await evidence.write();
}
const failed =
  driverFailure ||
  evidence.rows.some((row) => row.status !== "PASS") ||
  evidence.scans.some((scan) => scan.status !== "PASS");
console.log(`Real-run report written: ${output}/index.html`);
console.log(
  `Reached ${evidence.rows.filter((row) => row.screenshot).length} steps; full first-run proof ${failed ? "NOT PROVEN" : "PASS under reported constraints"}.`,
);
process.exitCode = failed ? 1 : 0;
