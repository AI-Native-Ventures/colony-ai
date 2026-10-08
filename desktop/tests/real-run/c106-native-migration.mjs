// Optional build-default migration sanity without launching the full Electron app.
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { APP, OUT, Rec, progress } from "./ai-lib.mjs";
import { assertThrowawayRoot } from "./nest-migration/fixture.mjs";
import {
  buildLaunchEnv,
  sandboxPolicy,
  killTree,
  sleep,
} from "./nest-migration/launch.mjs";
import { runProof } from "./nest-migration/proof.mjs";

export async function launchNative({
  app,
  fixtureRoot,
  home,
  userDataDir,
  privateDir,
  relayUrl,
  extraEnv,
}) {
  await assertThrowawayRoot(fixtureRoot, { requireMarker: true });
  if (path.dirname(home) !== (await realpath(fixtureRoot)))
    throw new Error("Native HOME must be the marked fixture home");
  privateDir = await realpath(privateDir);
  const executable = path.join(
    app,
    "Contents",
    "Resources",
    "colony-native-host",
  );
  const probe = path.join(privateDir, "synthetic-denied-probe");
  await writeFile(probe, "synthetic sandbox probe\n", { mode: 0o600 });
  const policy = path.join(privateDir, "native-sandbox.sb");
  await writeFile(
    policy,
    `${sandboxPolicy()}\n(deny file-read* (literal ${JSON.stringify(probe)}))\n`,
    { mode: 0o600 },
  );
  const guard = path.join(privateDir, "native-launch-guard.sh");
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    guard,
    `#!/bin/sh\n[ "$HOME" = ${quote(home)} ] || exit 91\nif /bin/cat ${quote(probe)} >/dev/null 2>${quote(probe + ".error")}; then exit 92; fi\n/usr/bin/grep -q 'Operation not permitted' ${quote(probe + ".error")} || exit 93\necho 'SANDBOX PROBE PASS: synthetic read denied; throwaway HOME; native host only' >&2\nexec ${quote(executable)}\n`,
    { mode: 0o700 },
  );
  const env = buildLaunchEnv({
    home,
    userDataDir,
    relayUrl,
    hostLog: path.join(privateDir, "host.log"),
    extra: {
      ...extraEnv,
      COLONY_ELECTRON_HOST: "1",
      COLONY_ELECTRON_PACKAGED: "1",
      COLONY_ELECTRON_PROFILE_ID: createHash("sha256")
        .update(userDataDir)
        .digest("hex")
        .slice(0, 16),
    },
  });
  if (env.COLONY_NEST_MIGRATION !== undefined)
    throw new Error("This driver only permits the build default");
  console.log(
    `NATIVE LAUNCH GUARD HOME=${home} COLONY_NEST_MIGRATION=(build default)`,
  );
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-f", policy, "/bin/sh", guard],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let log = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-524288);
    });
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  const isRunning = () => child.exitCode === null && child.signalCode === null;
  const probeEnd = Date.now() + 4000;
  while (
    !log.includes("SANDBOX PROBE PASS") &&
    isRunning() &&
    Date.now() < probeEnd
  )
    await sleep(20);
  if (!log.includes("SANDBOX PROBE PASS")) {
    if (isRunning()) await killTree(child.pid);
    throw new Error(
      `Native launch blocked before exec: sandbox probe absent, exit=${child.exitCode}`,
    );
  }
  return {
    pid: child.pid,
    exited,
    isRunning,
    window: async () => undefined,
    version: async () =>
      (
        await promisify(execFile)("/usr/libexec/PlistBuddy", [
          "-c",
          "Print :CFBundleShortVersionString",
          path.join(app, "Contents", "Info.plist"),
        ])
      ).stdout.trim(),
    hostLogLines: async () => log.split("\n").filter(Boolean),
    kill: () => killTree(child.pid),
    quit: async () => {
      if (isRunning()) child.kill("SIGTERM");
      await Promise.race([exited, sleep(3000)]);
      if (isRunning()) await killTree(child.pid);
      await writeFile(path.join(privateDir, "captured-native.log"), log, {
        mode: 0o600,
      });
    },
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
    throw new Error("Local opt-in required");
  const rec = new Rec("G1-NATIVE-MIGRATION");
  const result = await runProof({
    driver: { kind: "native", app: APP, launch: launchNative },
    out: path.join(OUT, "migration"),
    cases: ["owner", "held-back", "crash", "stale"],
    flagMode: "default",
    crashAt: "5:after",
    nestLineTimeoutMs: 15000,
    stableTimeoutMs: 15000,
    title: "1.0.6 bundled native host migration sanity",
    onCase: (result) => {
      if (result.blocked)
        for (const row of result.rows) row.status = "NOT OBSERVED";
      for (const row of result.rows)
        rec.row(`${result.id}:${row.id}`, row.label, row.status, row.detail);
      console.log(
        `MIGRATION CASE ${result.id} ${result.rows.filter((row) => row.status === "FAIL").length} failed rows`,
      );
    },
  });
  rec.notes.report = "migration/index.html";
  rec.notes.method =
    "Bundled native host only; full Electron build-default migration remains NOT OBSERVED. Synthetic fixtures only; no owner contents copied. HTTP/HTTPS blocked to prevent incidental model downloads.";
  rec.notes.cases = result.data.cases;
  await rec.write();
  await progress(
    "[G1-NATIVE-MIGRATION] full-app-default NOT OBSERVED: full app launch guard keeps migration disabled; native-only sanity is reported separately",
  );
}
