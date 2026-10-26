import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appBundleFromExecutable,
  assessBundleLocation,
  createMacSelfUpdater,
} from "./mac-self-update.mjs";
import { HELPER_MESSAGES, renderSwapHelper } from "./mac-update-helper.mjs";

const isRoot = process.getuid?.() === 0;

test("the app bundle is found from the running executable", () => {
  assert.equal(
    appBundleFromExecutable("/Applications/Colony.app/Contents/MacOS/Colony"),
    "/Applications/Colony.app",
  );
  assert.equal(
    appBundleFromExecutable("/Users/a b/Apps/Colony.app/Contents/MacOS/Colony"),
    "/Users/a b/Apps/Colony.app",
  );
  assert.equal(appBundleFromExecutable("/usr/local/bin/electron"), null);
  assert.equal(
    appBundleFromExecutable("/x/Colony.app/Contents/Resources/Colony"),
    null,
  );
  assert.equal(
    appBundleFromExecutable("Colony.app/Contents/MacOS/Colony"),
    null,
  );
  assert.equal(appBundleFromExecutable(undefined), null);
});

async function makeBundle() {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-location-"));
  const bundle = path.join(root, "Colony.app");
  await mkdir(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  return { root, bundle };
}

test("a writable, user-owned app in a writable folder can replace itself", async () => {
  const { root, bundle } = await makeBundle();
  try {
    assert.deepEqual(await assessBundleLocation({ bundlePath: bundle }), {
      ok: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an app under App Translocation falls back to the manual card", async () => {
  const result = await assessBundleLocation({
    bundlePath:
      "/private/var/folders/ab/xyz/T/AppTranslocation/0F1E2D3C/d/Colony.app",
  });
  assert.deepEqual(result, { ok: false, reason: "translocated" });
});

test("an app on a read-only disk image falls back to the manual card", async () => {
  const denied = Object.assign(new Error("read-only"), { code: "EROFS" });
  const result = await assessBundleLocation({
    bundlePath: "/Volumes/Colony 3.0.2/Colony.app",
    fs: {
      access: async () => {
        throw denied;
      },
    },
  });
  assert.deepEqual(result, { ok: false, reason: "disk-image" });
});

test("a folder the user cannot write to falls back to the manual card", async () => {
  const result = await assessBundleLocation({
    bundlePath: "/Applications/Colony.app",
    fs: {
      access: async (target) => {
        if (target === "/Applications") throw new Error("EACCES");
      },
    },
  });
  assert.deepEqual(result, { ok: false, reason: "not-writable" });
});

test("an app owned by someone else falls back to the manual card", async () => {
  const result = await assessBundleLocation({
    bundlePath: "/Applications/Colony.app",
    uid: 501,
    fs: {
      access: async () => {},
      stat: async () => ({ isDirectory: () => true, uid: 0 }),
    },
  });
  assert.deepEqual(result, { ok: false, reason: "not-writable" });
});

test("a real read-only folder falls back to the manual card", {
  skip: isRoot,
}, async () => {
  const { root, bundle } = await makeBundle();
  try {
    await chmod(root, 0o555);
    const result = await assessBundleLocation({ bundlePath: bundle });
    assert.deepEqual(result, { ok: false, reason: "not-writable" });
  } finally {
    await chmod(root, 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

// --- the detached helper, run for real with `sh` ---------------------------

async function makeSwapRig({ spaces = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-swap-"));
  const base = path.join(root, spaces ? "My Apps's" : "apps");
  const bundle = path.join(base, "Colony.app");
  const stageDir = path.join(base, ".colony-update-3.0.91-abcd1234");
  const staged = path.join(stageDir, "extracted", "Colony.app");
  const previous = path.join(stageDir, "previous", "Colony.app");
  const userData = path.join(root, "userData", "updates");
  const tools = path.join(root, "tools");
  await Promise.all(
    [bundle, staged, userData, tools].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );
  await writeFile(path.join(bundle, "version.txt"), "3.0.90");
  await writeFile(path.join(staged, "version.txt"), "3.0.91");
  // Stand-ins for the system tools: each records its arguments.
  const record = path.join(root, "calls.log");
  for (const [name, exit] of [
    ["open", 0],
    ["xattr", 0],
    ["codesign", 0],
  ]) {
    await writeFile(
      path.join(tools, name),
      `#!/bin/sh\necho "${name} $*" >> '${record}'\nexit \${${name.toUpperCase()}_EXIT:-${exit}}\n`,
      { mode: 0o755 },
    );
  }
  // A `mv` that can be made to fail for one move, to exercise the rollback.
  await writeFile(
    path.join(tools, "mv"),
    `#!/bin/sh
if [ -n "$FAIL_MV_FROM" ] && [ "$1" = "$FAIL_MV_FROM" ]; then exit 1; fi
exec /bin/mv "$@"
`,
    { mode: 0o755 },
  );
  const resultPath = path.join(userData, "last-install.json");
  const logPath = path.join(userData, "helper.log");
  const script = (pid, extra = {}) =>
    renderSwapHelper({
      pid,
      bundlePath: bundle,
      stagedPath: staged,
      previousPath: previous,
      stageDir,
      resultPath,
      logPath,
      fromVersion: "3.0.90",
      toVersion: "3.0.91",
      openCommand: path.join(tools, "open"),
      xattrCommand: path.join(tools, "xattr"),
      codesignCommand: path.join(tools, "codesign"),
      ...extra,
    });
  const run = async (scriptText, env = {}) => {
    const scriptPath = path.join(root, "swap.sh");
    await writeFile(scriptPath, scriptText, { mode: 0o700 });
    return new Promise((resolve) => {
      const child = spawn("/bin/sh", [scriptPath], {
        env: { PATH: `${tools}:/usr/bin:/bin`, ...env },
        stdio: "ignore",
      });
      child.once("exit", (code) => resolve(code));
    });
  };
  const calls = async () =>
    (await readFile(record, "utf8").catch(() => ""))
      .trim()
      .split("\n")
      .filter(Boolean);
  const version = (dir) => readFile(path.join(dir, "version.txt"), "utf8");
  const result = async () => JSON.parse(await readFile(resultPath, "utf8"));
  const exists = (target) =>
    stat(target).then(
      () => true,
      () => false,
    );
  return {
    root,
    bundle,
    staged,
    stageDir,
    previous,
    script,
    run,
    calls,
    version,
    result,
    exists,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("the helper swaps the bundle, clears quarantine, relaunches and cleans up", async () => {
  const rig = await makeSwapRig();
  try {
    const exitCode = await rig.run(rig.script(99999991));
    assert.equal(exitCode, 0);
    assert.equal(await rig.version(rig.bundle), "3.0.91");
    assert.equal(await rig.exists(rig.stageDir), false);
    const calls = await rig.calls();
    assert.ok(
      calls.some((line) => line.startsWith("xattr -dr com.apple.quarantine ")),
    );
    assert.ok(
      calls.some((line) =>
        line.startsWith("codesign --verify --deep --strict "),
      ),
    );
    assert.deepEqual(calls.at(-1), `open ${rig.bundle}`);
    assert.deepEqual(await rig.result(), {
      status: "installed",
      from: "3.0.90",
      to: "3.0.91",
      message: "",
    });
  } finally {
    await rig.cleanup();
  }
});

test("a local test build relaunches with its throwaway profile, a release with a plain environment", async () => {
  const withEnv = await makeSwapRig();
  try {
    const script = withEnv.script(99999991, {
      relaunchEnv: { COLONY_ELECTRON_USER_DATA: "/tmp/it's a profile" },
    });
    assert.equal(await withEnv.run(script), 0);
    assert.deepEqual(
      (await withEnv.calls()).at(-1),
      `open --env COLONY_ELECTRON_USER_DATA=/tmp/it's a profile ${withEnv.bundle}`,
    );
  } finally {
    await withEnv.cleanup();
  }
  assert.throws(
    () =>
      renderSwapHelper({
        pid: 99999991,
        bundlePath: "/a/Colony.app",
        stagedPath: "/a/s/Colony.app",
        previousPath: "/a/s/p/Colony.app",
        stageDir: "/a/.colony-update-x",
        resultPath: "/r.json",
        logPath: "/l.log",
        fromVersion: "1.0.0",
        toVersion: "1.0.1",
        relaunchEnv: { "bad name": "x" },
      }),
    /Relaunch environment is not valid/,
  );
});

test("the helper copes with spaces and quotes in the install path", async () => {
  const rig = await makeSwapRig({ spaces: true });
  try {
    assert.equal(await rig.run(rig.script(99999991)), 0);
    assert.equal(await rig.version(rig.bundle), "3.0.91");
  } finally {
    await rig.cleanup();
  }
});

test("the helper waits for Colony to exit before it touches the bundle", async () => {
  const rig = await makeSwapRig();
  const running = spawn("/bin/sleep", ["2"], { stdio: "ignore" });
  try {
    const startedAt = Date.now();
    const finished = rig.run(rig.script(running.pid));
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(await rig.version(rig.bundle), "3.0.90", "swapped too early");
    assert.equal(await rig.exists(rig.staged), true);
    assert.equal(await finished, 0);
    assert.ok(Date.now() - startedAt >= 1_500, "did not wait for the app");
    assert.equal(await rig.version(rig.bundle), "3.0.91");
  } finally {
    running.kill();
    await rig.cleanup();
  }
});

test("the helper leaves everything alone when Colony never quits", async () => {
  const rig = await makeSwapRig();
  const running = spawn("/bin/sleep", ["5"], { stdio: "ignore" });
  try {
    const exitCode = await rig.run(
      rig.script(running.pid, { waitSeconds: 0.4 }),
    );
    assert.equal(exitCode, 1);
    assert.equal(await rig.version(rig.bundle), "3.0.90");
    assert.equal(await rig.exists(rig.staged), true);
    assert.deepEqual(await rig.calls(), []);
    const outcome = await rig.result();
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.message, HELPER_MESSAGES.didNotQuit);
  } finally {
    running.kill();
    await rig.cleanup();
  }
});

test("a failed swap restores the old bundle and reopens it", async () => {
  const rig = await makeSwapRig();
  try {
    // The move of the new app into place fails; the old app must come back.
    const exitCode = await rig.run(rig.script(99999991), {
      FAIL_MV_FROM: rig.staged,
    });
    assert.equal(exitCode, 1);
    assert.equal(await rig.version(rig.bundle), "3.0.90");
    const outcome = await rig.result();
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.message, HELPER_MESSAGES.moveIn);
    assert.deepEqual((await rig.calls()).at(-1), `open ${rig.bundle}`);
    assert.equal(await rig.exists(rig.stageDir), false);
  } finally {
    await rig.cleanup();
  }
});

test("a new bundle that fails its signature check is rolled back", async () => {
  const rig = await makeSwapRig();
  try {
    const exitCode = await rig.run(rig.script(99999991), {
      CODESIGN_EXIT: "1",
    });
    assert.equal(exitCode, 1);
    assert.equal(await rig.version(rig.bundle), "3.0.90");
    const outcome = await rig.result();
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.message, HELPER_MESSAGES.badSignature);
    assert.deepEqual((await rig.calls()).at(-1), `open ${rig.bundle}`);
  } finally {
    await rig.cleanup();
  }
});

test("a current app that cannot be moved aside stays untouched", {
  skip: isRoot,
}, async () => {
  const rig = await makeSwapRig();
  try {
    await mkdir(path.join(rig.stageDir, "previous"), { recursive: true });
    await chmod(path.join(rig.stageDir, "previous"), 0o555);
    const exitCode = await rig.run(rig.script(99999991));
    assert.equal(exitCode, 1);
    assert.equal(await rig.version(rig.bundle), "3.0.90");
    assert.equal((await rig.result()).message, HELPER_MESSAGES.moveAside);
  } finally {
    await chmod(path.join(rig.stageDir, "previous"), 0o755).catch(() => {});
    await rig.cleanup();
  }
});

test("the helper refuses to remove a folder that is not an update stage", async () => {
  const rig = await makeSwapRig();
  try {
    const keep = path.join(rig.root, "apps", "precious");
    await mkdir(keep);
    await writeFile(path.join(keep, "file.txt"), "keep");
    await rig.run(rig.script(99999991, { stageDir: keep }));
    assert.equal(await readFile(path.join(keep, "file.txt"), "utf8"), "keep");
    assert.ok(
      (await readdir(path.join(rig.root, "apps"))).includes("precious"),
    );
  } finally {
    await rig.cleanup();
  }
});

// --- staging, against a local server and stand-in system commands -----------

const BUNDLE_ID = "xyz.block.buzz.app.electron";

function serve(bytes) {
  const server = createServer((request, response) => {
    if (request.url === "/missing.zip") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-length": bytes.byteLength });
    response.end(bytes);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      }),
    );
  });
}

async function makeInstalledApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-stage-"));
  const bundle = path.join(root, "Apps", "Colony.app");
  await mkdir(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  await writeFile(
    path.join(bundle, "Contents", "Info.plist"),
    JSON.stringify({ CFBundleIdentifier: BUNDLE_ID }),
  );
  return { root, bundle, parent: path.dirname(bundle) };
}

function commandsExtracting(apps) {
  return async (file, args) => {
    if (file === "/usr/bin/ditto") {
      for (const name of apps) {
        const dir = path.join(args[3], name, "Contents", "MacOS");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, "Colony"), "x", { mode: 0o755 });
        await writeFile(
          path.join(args[3], name, "Contents", "Info.plist"),
          JSON.stringify({
            CFBundleIdentifier: BUNDLE_ID,
            CFBundleShortVersionString: "3.0.91",
            CFBundleExecutable: "Colony",
          }),
        );
      }
      return { stdout: "" };
    }
    if (file === "/usr/bin/plutil") {
      const plist = JSON.parse(await readFile(args.at(-1), "utf8"));
      return { stdout: `${plist[args[1]]}\n` };
    }
    return { stdout: "" };
  };
}

function updaterFor(install, overrides = {}) {
  return createMacSelfUpdater({
    executablePath: path.join(install.bundle, "Contents", "MacOS", "Colony"),
    userDataDir: path.join(install.root, "userData"),
    currentVersion: "3.0.90",
    requestQuit: async () => {},
    fetchImpl: fetch,
    allowInsecureLoopback: true,
    ...overrides,
  });
}

test("a production updater never downloads over plain http", async () => {
  const bytes = Buffer.from("archive");
  const server = await serve(bytes);
  const install = await makeInstalledApp();
  try {
    const updater = updaterFor(install, {
      allowInsecureLoopback: false,
      runCommand: commandsExtracting(["Colony.app"]),
    });
    await assert.rejects(
      updater.stage({
        version: "3.0.91",
        archiveUrl: `${server.url}/a.zip`,
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
      /not secure/,
    );
    assert.deepEqual(
      (await readdir(install.parent)).filter((name) =>
        name.startsWith(".colony-update-"),
      ),
      [],
    );
  } finally {
    await server.close();
    await rm(install.root, { recursive: true, force: true });
  }
});

test("a download that returns an error status is refused with a plain message", async () => {
  const server = await serve(Buffer.from("x"));
  const install = await makeInstalledApp();
  try {
    await assert.rejects(
      updaterFor(install, {
        runCommand: commandsExtracting(["Colony.app"]),
      }).stage({
        version: "3.0.91",
        archiveUrl: `${server.url}/missing.zip`,
        size: 1,
        sha256: "0".repeat(64),
      }),
      /could not be downloaded \(status 404\)/,
    );
  } finally {
    await server.close();
    await rm(install.root, { recursive: true, force: true });
  }
});

test("an archive that holds more than one app is refused", async () => {
  const bytes = Buffer.from("archive");
  const server = await serve(bytes);
  const install = await makeInstalledApp();
  try {
    await assert.rejects(
      updaterFor(install, {
        runCommand: commandsExtracting(["Colony.app", "Other.app"]),
      }).stage({
        version: "3.0.91",
        archiveUrl: `${server.url}/a.zip`,
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
      /not a single Colony app/,
    );
  } finally {
    await server.close();
    await rm(install.root, { recursive: true, force: true });
  }
});

test("download progress climbs to 100 and a good archive is staged beside the app", async () => {
  const bytes = Buffer.alloc(300_000, 7);
  const server = await serve(bytes);
  const install = await makeInstalledApp();
  try {
    const seen = [];
    const updater = updaterFor(install, {
      runCommand: commandsExtracting(["Colony.app"]),
    });
    await updater.stage({
      version: "3.0.91",
      archiveUrl: `${server.url}/a.zip`,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      onProgress: (percent) => seen.push(percent),
    });
    assert.equal(seen.at(-1), 100);
    assert.deepEqual(
      seen,
      [...seen].sort((a, b) => a - b),
    );
    assert.equal(updater.hasStaged(), true);
    const [stage] = (await readdir(install.parent)).filter((name) =>
      name.startsWith(".colony-update-3.0.91-"),
    );
    assert.ok(stage, "the stage folder sits in the same folder as the app");
    // The archive is deleted once unpacked; only the checked app remains.
    assert.deepEqual(await readdir(path.join(install.parent, stage)), [
      "extracted",
    ]);
    await updater.discardStaged();
    assert.equal(updater.hasStaged(), false);
    assert.deepEqual(
      (await readdir(install.parent)).filter((name) =>
        name.startsWith(".colony-update-"),
      ),
      [],
    );
  } finally {
    await server.close();
    await rm(install.root, { recursive: true, force: true });
  }
});

test("old stage folders are cleaned up at start and fresh ones are left alone", async () => {
  const install = await makeInstalledApp();
  try {
    const old = path.join(install.parent, ".colony-update-3.0.80-aaaa");
    const fresh = path.join(install.parent, ".colony-update-3.0.91-bbbb");
    const unrelated = path.join(install.parent, ".something-else");
    for (const dir of [old, fresh, unrelated]) await mkdir(dir);
    const longAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await utimes(old, longAgo, longAgo);
    await utimes(unrelated, longAgo, longAgo);
    await updaterFor(install).cleanupStale();
    const left = await readdir(install.parent);
    assert.ok(!left.includes(".colony-update-3.0.80-aaaa"));
    assert.ok(left.includes(".colony-update-3.0.91-bbbb"));
    assert.ok(left.includes(".something-else"));
  } finally {
    await rm(install.root, { recursive: true, force: true });
  }
});

test("the helper's result is read once, and a damaged result is ignored", async () => {
  const install = await makeInstalledApp();
  try {
    const updater = updaterFor(install);
    const updates = path.join(install.root, "userData", "updates");
    await mkdir(updates, { recursive: true });
    const resultPath = path.join(updates, "last-install.json");

    await writeFile(
      resultPath,
      JSON.stringify({
        status: "installed",
        from: "3.0.90",
        to: "3.0.91",
        message: "",
      }),
    );
    assert.deepEqual(await updater.takeLastResult(), {
      status: "installed",
      from: "3.0.90",
      to: "3.0.91",
      message: "",
    });
    assert.equal(await updater.takeLastResult(), null);

    await writeFile(resultPath, "{ not json");
    assert.equal(await updater.takeLastResult(), null);
    assert.equal(await stat(resultPath).catch(() => null), null);
  } finally {
    await rm(install.root, { recursive: true, force: true });
  }
});
