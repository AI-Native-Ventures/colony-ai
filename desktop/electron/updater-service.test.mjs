import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMacSelfUpdater } from "./mac-self-update.mjs";
import {
  createElectronUpdaterService,
  isNewerVersion,
  resolveUpdateMetadataUrl,
  UPDATE_DOWNLOAD_URL,
  UPDATE_METADATA_URL,
} from "./updater-service.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

class FakeFeedUpdater extends EventEmitter {
  constructor(feedUrl) {
    super();
    this.feedUrl = feedUrl;
    this.checkCount = 0;
    this.installCalls = [];
  }

  async checkForUpdates() {
    this.checkCount += 1;
    this.emit("checking-for-update");
    const response = await fetch(`${this.feedUrl}/latest-mac.yml`);
    const metadata = await response.text();
    const version = metadata.match(/^version: (.+)$/m)?.[1];
    assert.ok(version, "local update feed should contain a version");
    this.emit("update-available", { version });
    return { updateInfo: { version } };
  }

  async downloadUpdate() {
    const response = await fetch(`${this.feedUrl}/latest-mac.yml`);
    const metadata = await response.text();
    const version = metadata.match(/^version: (.+)$/m)?.[1];
    const fileName = metadata.match(/^\s+- url: (.+)$/m)?.[1];
    const expectedHash = metadata.match(/^\s+sha512: (.+)$/m)?.[1];
    assert.ok(version && fileName && expectedHash);
    this.emit("download-progress", { percent: 40 });
    const artifact = await fetch(`${this.feedUrl}/${fileName}`);
    const bytes = Buffer.from(await artifact.arrayBuffer());
    const actualHash = createHash("sha512").update(bytes).digest("base64");
    assert.equal(
      actualHash,
      expectedHash,
      "local update feed checksum should match",
    );
    this.emit("update-downloaded", { version });
    return [fileName];
  }

  quitAndInstall(...args) {
    this.installCalls.push(args);
  }
}

test("semantic version comparison handles releases and prereleases", () => {
  assert.equal(isNewerVersion("1.1.0", "1.0.9"), true);
  assert.equal(isNewerVersion("1.0.0", "1.0.0-rc.2"), true);
  assert.equal(isNewerVersion("1.0.0-rc.3", "1.0.0-rc.2"), true);
  assert.equal(isNewerVersion("1.0.0", "1.0.0"), false);
  assert.equal(isNewerVersion("1.0.0-rc.1", "1.0.0"), false);
  assert.throws(() => isNewerVersion("latest", "1.0.0"), /semantic versioning/);
});

test("local fake release feed reaches ready and installs only after the user action", async () => {
  const artifact = Buffer.from("verified test update archive");
  const sha512 = createHash("sha512").update(artifact).digest("base64");
  const manifest = {
    schemaVersion: 1,
    version: "1.1.0",
    tag: "desktop-v1.1.0",
    platforms: {
      "darwin-arm64": {
        signed: true,
        autoUpdate: true,
        installer: "Colony-1.1.0-arm64-SIGNED.dmg",
      },
    },
    assets: [],
  };
  const server = createServer((request, response) => {
    if (request.url === "/update-metadata.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(manifest));
      return;
    }
    if (request.url === "/latest-mac.yml") {
      response.writeHead(200, { "content-type": "text/yaml" });
      response.end(
        `version: 1.1.0\nfiles:\n  - url: mac-update.zip\n    sha512: ${sha512}\n    size: ${artifact.byteLength}\n`,
      );
      return;
    }
    if (request.url === "/mac-update.zip") {
      response.writeHead(200, { "content-type": "application/zip" });
      response.end(artifact);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const feedUrl = await listen(server);
  const updater = new FakeFeedUpdater(feedUrl);
  const seenStates = [];
  let resolveReady;
  let rejectTimeout;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const timeout = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const readyTimeout = setTimeout(
    () =>
      rejectTimeout(new Error("Timed out waiting for updater state ready.")),
    2_000,
  );
  let intervalCallback;
  let intervalMs;
  const service = createElectronUpdaterService({
    autoUpdater: updater,
    currentVersion: "1.0.0",
    currentBuild: { autoUpdate: true, signed: true },
    platformKey: "darwin-arm64",
    metadataUrl: `${feedUrl}/update-metadata.json`,
    fetchImpl: fetch,
    setIntervalImpl: (callback, milliseconds) => {
      intervalCallback = callback;
      intervalMs = milliseconds;
      return 7;
    },
    clearIntervalImpl: () => {},
    onStatus: (status) => {
      seenStates.push(status);
      if (status.state === "ready") {
        clearTimeout(readyTimeout);
        resolveReady();
      }
    },
  });

  try {
    await service.start();
    await Promise.race([ready, timeout]);
    assert.equal(intervalMs, 6 * 60 * 60 * 1000);
    assert.equal(typeof intervalCallback, "function");
    assert.deepEqual(
      seenStates.map((status) => status.state),
      ["checking", "checking", "available", "downloading", "ready"],
    );
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, false);
    assert.deepEqual(service.snapshot(), { state: "ready" });
    assert.deepEqual(updater.installCalls, []);

    assert.equal(await service.installAndRelaunch(), true);
    assert.deepEqual(service.snapshot(), { state: "installing" });
    assert.deepEqual(updater.installCalls, [[false, true]]);
    assert.equal(await service.installAndRelaunch(), false);
  } finally {
    clearTimeout(readyTimeout);
    service.stop();
    await close(server);
  }
});

test("unsigned macOS builds expose manual download instead of auto-install", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        version: "1.1.0",
        platforms: {
          "darwin-arm64": {
            signed: true,
            autoUpdate: true,
            installer: "Colony-1.1.0-arm64-SIGNED.dmg",
          },
        },
      }),
    );
  });
  const feedUrl = await listen(server);
  const updater = new FakeFeedUpdater(feedUrl);
  const service = createElectronUpdaterService({
    autoUpdater: updater,
    currentVersion: "1.0.0",
    currentBuild: { autoUpdate: false, signed: false },
    platformKey: "darwin-arm64",
    metadataUrl: feedUrl,
    fetchImpl: fetch,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });

  try {
    const status = await service.check();
    assert.deepEqual(status, {
      state: "manual-required",
      version: "1.1.0",
      releaseUrl: "https://colony.global/#download",
    });
    assert.equal(updater.checkCount, 0);
    assert.deepEqual(updater.installCalls, []);
  } finally {
    service.stop();
    await close(server);
  }
});

test("the manual download link is the Colony download page, not GitHub", () => {
  assert.equal(UPDATE_DOWNLOAD_URL, "https://colony.global/#download");
});

test("a card that already shows a manual update keeps naming the latest version", async () => {
  let published = "3.0.1";
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        version: published,
        platforms: {
          "darwin-arm64": { signed: false, autoUpdate: false },
        },
      }),
    );
  });
  const feedUrl = await listen(server);
  const states = [];
  const service = createElectronUpdaterService({
    autoUpdater: new FakeFeedUpdater(feedUrl),
    currentVersion: "3.0.0",
    currentBuild: { autoUpdate: false, signed: false },
    platformKey: "darwin-arm64",
    metadataUrl: feedUrl,
    fetchImpl: fetch,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    onStatus: (status) => states.push(status.state),
  });
  try {
    await service.check({ background: true });
    assert.equal(service.snapshot().version, "3.0.1");

    published = "3.0.2";
    states.length = 0;
    await service.check({ background: true });
    assert.equal(service.snapshot().state, "manual-required");
    assert.equal(service.snapshot().version, "3.0.2");
    assert.ok(
      !states.includes("checking"),
      "the card must not flicker away while it refreshes",
    );

    // Once the person has installed it by hand, the card goes away.
    published = "3.0.0";
    await service.check({ background: true });
    assert.deepEqual(service.snapshot(), { state: "up-to-date" });
  } finally {
    service.stop();
    await close(server);
  }
});

// --- Mac in-app update (unsigned, ad-hoc signed build) ---------------------

const BUNDLE_ID = "xyz.block.buzz.app.electron";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The update "archive" is a JSON description the fake `ditto` unpacks. */
function archiveBytes({
  version = "3.0.91",
  bundleId = BUNDLE_ID,
  padding = "",
} = {}) {
  return Buffer.from(
    JSON.stringify({
      plist: {
        CFBundleIdentifier: bundleId,
        CFBundleShortVersionString: version,
        CFBundleExecutable: "Colony",
      },
      padding,
    }),
  );
}

function fakeCommands({ codesignFails = false } = {}) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "/usr/bin/ditto") {
      const archive = JSON.parse(await readFile(args[2], "utf8"));
      const app = path.join(args[3], "Colony.app");
      await mkdir(path.join(app, "Contents", "MacOS"), { recursive: true });
      await writeFile(
        path.join(app, "Contents", "Info.plist"),
        JSON.stringify(archive.plist),
      );
      await writeFile(path.join(app, "Contents", "MacOS", "Colony"), "new", {
        mode: 0o755,
      });
      return { stdout: "" };
    }
    if (file === "/usr/bin/plutil") {
      const plist = JSON.parse(await readFile(args.at(-1), "utf8"));
      const value = plist[args[1]];
      if (value === undefined) throw new Error(`no ${args[1]}`);
      return { stdout: `${value}\n` };
    }
    if (file === "/usr/bin/codesign") {
      if (codesignFails) throw new Error("invalid signature");
      return { stdout: "" };
    }
    throw new Error(`unexpected command ${file}`);
  };
  return { run, calls };
}

async function makeMacRig({
  archive = archiveBytes(),
  manifestSize,
  manifestSha,
  signedFlags = { signed: false, autoUpdate: false, selfUpdate: true },
  commands = fakeCommands(),
  executableDir,
  fsOverride,
  currentBuild = { autoUpdate: false, signed: false, selfUpdate: true },
  spawnCalls = [],
  quitCalls = [],
  quitFails = false,
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-mac-rig-"));
  const bundle = path.join(root, "Apps", "Colony.app");
  await mkdir(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  await writeFile(
    path.join(bundle, "Contents", "Info.plist"),
    JSON.stringify({
      CFBundleIdentifier: BUNDLE_ID,
      CFBundleShortVersionString: "3.0.90",
      CFBundleExecutable: "Colony",
    }),
  );
  await writeFile(path.join(bundle, "Contents", "MacOS", "Colony"), "old", {
    mode: 0o755,
  });
  const archiveName = "Colony-3.0.91-arm64-UNSIGNED.zip";
  const manifest = {
    schemaVersion: 1,
    version: "3.0.91",
    tag: "desktop-v3.0.91",
    platforms: {
      "darwin-arm64": {
        ...signedFlags,
        installer: "Colony-3.0.91-arm64-UNSIGNED.dmg",
        updateArchive: archiveName,
        updateMetadata: "latest-mac.yml",
      },
    },
    assets: [
      {
        name: archiveName,
        platform: "darwin-arm64",
        size: manifestSize ?? archive.byteLength,
        sha256: manifestSha ?? sha256Hex(archive),
        signed: false,
      },
    ],
  };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/update-metadata.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(manifest));
      return;
    }
    if (request.url === `/${archiveName}`) {
      response.writeHead(200, {
        "content-type": "application/zip",
        "content-length": archive.byteLength,
      });
      response.end(archive);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const baseUrl = await listen(server);
  const spawned = spawnCalls;
  const updater = createMacSelfUpdater({
    executablePath:
      executableDir ?? path.join(bundle, "Contents", "MacOS", "Colony"),
    userDataDir: path.join(root, "userData"),
    currentVersion: "3.0.90",
    requestQuit: async () => {
      if (quitFails) throw new Error("quit blocked");
      quitCalls.push(Date.now());
    },
    pid: 99999991,
    fetchImpl: fetch,
    runCommand: commands.run,
    spawnImpl: (file, args, options) => {
      const child = new EventEmitter();
      child.unref = () => {};
      child.kill = () => {
        child.killed = true;
      };
      spawned.push({ file, args, options, child });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    },
    allowInsecureLoopback: true,
    log: () => {},
    ...(fsOverride ? { fs: fsOverride } : {}),
  });
  const states = [];
  const service = createElectronUpdaterService({
    autoUpdater: null,
    currentVersion: "3.0.90",
    currentBuild,
    platformKey: "darwin-arm64",
    metadataUrl: `${baseUrl}/update-metadata.json`,
    fetchImpl: fetch,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
    macSelfUpdater: updater,
    onStatus: (status) => states.push(status),
  });
  return {
    root,
    bundle,
    baseUrl,
    requests,
    states,
    service,
    updater,
    spawned,
    quitCalls,
    commands,
    stageFolders: async () =>
      (await readdir(path.dirname(bundle))).filter((name) =>
        name.startsWith(".colony-update-"),
      ),
    cleanup: async () => {
      service.stop();
      await close(server);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("an unsigned Mac build downloads, verifies and stages the update, then installs only when asked", async () => {
  const rig = await makeMacRig();
  try {
    const status = await rig.service.check();
    assert.deepEqual(status, { state: "ready", version: "3.0.91" });
    const states = rig.states.map((entry) => entry.state);
    assert.deepEqual(states.slice(0, 3), [
      "checking",
      "available",
      "downloading",
    ]);
    assert.ok(
      rig.states.some(
        (entry) => entry.state === "downloading" && entry.percent === 100,
      ),
      "download progress is reported",
    );
    assert.equal(states.at(-1), "ready");
    assert.equal(
      rig.spawned.length,
      0,
      "nothing is installed before the click",
    );
    assert.equal(rig.quitCalls.length, 0);
    assert.equal((await rig.stageFolders()).length, 1);
    assert.ok(
      rig.commands.calls.some(
        ([file, ...args]) =>
          file === "/usr/bin/codesign" &&
          args.join(" ").startsWith("--verify --deep --strict"),
      ),
    );

    assert.equal(await rig.service.installAndRelaunch(), true);
    assert.equal(rig.service.snapshot().state, "installing");
    assert.equal(rig.spawned.length, 1);
    assert.equal(rig.spawned[0].file, "/bin/sh");
    assert.equal(rig.spawned[0].options.detached, true);
    assert.equal(rig.quitCalls.length, 1);
    const script = await readFile(rig.spawned[0].args[0], "utf8");
    assert.match(script, /PID=99999991/);
    assert.match(script, new RegExp(`BUNDLE='${rig.bundle}'`));
    // A second click does not start a second swap.
    assert.equal(await rig.service.installAndRelaunch(), false);
    assert.equal(rig.spawned.length, 1);
  } finally {
    await rig.cleanup();
  }
});

const refusals = [
  {
    name: "a checksum that does not match",
    options: { manifestSha: "0".repeat(64) },
    message: /did not match its checksum/,
  },
  {
    name: "a size that does not match the manifest",
    options: { manifestSize: archiveBytes().byteLength + 7 },
    message: /not the expected size/,
  },
  {
    name: "an app whose version is not the manifest version",
    options: { archive: archiveBytes({ version: "3.0.99" }) },
    message: /not the version it should be/,
  },
  {
    name: "an app with a different bundle identifier",
    options: { archive: archiveBytes({ bundleId: "com.example.other" }) },
    message: /is not Colony/,
  },
  {
    name: "an app that fails the code signature check",
    options: { commands: fakeCommands({ codesignFails: true }) },
    message: /failed its signature check/,
  },
];

for (const { name, options, message } of refusals) {
  test(`the update is refused for ${name}`, async () => {
    const rig = await makeMacRig(options);
    try {
      const status = await rig.service.check();
      assert.equal(status.state, "error");
      assert.match(status.message, message);
      assert.equal(status.releaseUrl, "https://colony.global/#download");
      assert.deepEqual(await rig.stageFolders(), [], "nothing is left on disk");
      assert.equal(await rig.service.installAndRelaunch(), false);
      assert.equal(rig.spawned.length, 0);
      assert.equal(rig.quitCalls.length, 0);
      assert.equal(
        await readFile(
          path.join(rig.bundle, "Contents", "MacOS", "Colony"),
          "utf8",
        ),
        "old",
      );
    } finally {
      await rig.cleanup();
    }
  });
}

test("background checks do not keep re-downloading an update that was refused", async () => {
  const rig = await makeMacRig({ manifestSha: "0".repeat(64) });
  try {
    const archiveRequests = () =>
      rig.requests.filter((url) => url.endsWith(".zip")).length;
    assert.equal((await rig.service.check()).state, "error");
    assert.equal(archiveRequests(), 1);
    for (let index = 0; index < 4; index += 1) {
      const status = await rig.service.check({ background: true });
      assert.equal(status.state, "error");
      assert.equal(status.releaseUrl, "https://colony.global/#download");
    }
    // One manual try and one background try, then the background stops.
    assert.equal(archiveRequests(), 2);
    // A manual check still tries again.
    assert.equal((await rig.service.check()).state, "error");
    assert.equal(archiveRequests(), 3);
  } finally {
    await rig.cleanup();
  }
});

test("a check while the swap is being started does nothing", async () => {
  const rig = await makeMacRig();
  try {
    assert.equal((await rig.service.check()).state, "ready");
    assert.equal(await rig.service.installAndRelaunch(), true);
    const before = rig.requests.length;
    assert.equal((await rig.service.check()).state, "installing");
    assert.equal(
      (await rig.service.check({ background: true })).state,
      "installing",
    );
    assert.equal(rig.requests.length, before);
  } finally {
    await rig.cleanup();
  }
});

test("a translocated app falls back to the manual card without downloading", async () => {
  const rig = await makeMacRig({
    executableDir:
      "/private/var/folders/ab/xyz/T/AppTranslocation/0F1E2D3C/d/Colony.app/Contents/MacOS/Colony",
  });
  try {
    const status = await rig.service.check();
    assert.deepEqual(status, {
      state: "manual-required",
      version: "3.0.91",
      releaseUrl: "https://colony.global/#download",
    });
    assert.deepEqual(rig.requests, ["/update-metadata.json"]);
  } finally {
    await rig.cleanup();
  }
});

test("an app in a folder it cannot write to falls back to the manual card", async () => {
  const { access } = await import("node:fs/promises");
  const fsPromises = await import("node:fs/promises");
  const rig = await makeMacRig({
    fsOverride: {
      ...fsPromises,
      access: async (target, mode) => {
        if (target.endsWith("/Apps")) throw new Error("EACCES");
        return access(target, mode);
      },
    },
  });
  try {
    const status = await rig.service.check();
    assert.equal(status.state, "manual-required");
    assert.equal(status.releaseUrl, "https://colony.global/#download");
    assert.deepEqual(rig.requests, ["/update-metadata.json"]);
  } finally {
    await rig.cleanup();
  }
});

test("a 3.0.x client keeps the manual card when the release offers self-update", async () => {
  const rig = await makeMacRig({
    currentBuild: { autoUpdate: false, signed: false },
  });
  try {
    const status = await rig.service.check();
    assert.equal(status.state, "manual-required");
    assert.deepEqual(rig.requests, ["/update-metadata.json"]);
  } finally {
    await rig.cleanup();
  }
});

test("a failed swap reported by the helper shows an error with the manual link at the next start", async () => {
  const rig = await makeMacRig();
  try {
    await mkdir(path.join(rig.root, "userData", "updates"), {
      recursive: true,
    });
    await writeFile(
      path.join(rig.root, "userData", "updates", "last-install.json"),
      JSON.stringify({
        status: "failed",
        from: "3.0.90",
        to: "3.0.91",
        message: "The new version could not be put in place.",
      }),
    );
    await rig.service.start();
    assert.deepEqual(rig.service.snapshot(), {
      state: "error",
      message: "The new version could not be put in place.",
      releaseUrl: "https://colony.global/#download",
    });
    // Read once: a later start does not repeat it.
    assert.equal(await rig.updater.takeLastResult(), null);
  } finally {
    await rig.cleanup();
  }
});

test("the staged app is checked again before the swap starts", async () => {
  const rig = await makeMacRig();
  try {
    assert.equal((await rig.service.check()).state, "ready");
    const [stage] = await rig.stageFolders();
    await writeFile(
      path.join(
        path.dirname(rig.bundle),
        stage,
        "extracted",
        "Colony.app",
        "Contents",
        "Info.plist",
      ),
      JSON.stringify({
        CFBundleIdentifier: BUNDLE_ID,
        CFBundleShortVersionString: "9.9.9",
        CFBundleExecutable: "Colony",
      }),
    );
    assert.equal(await rig.service.installAndRelaunch(), false);
    assert.equal(rig.service.snapshot().state, "error");
    assert.equal(rig.spawned.length, 0);
    assert.equal(rig.quitCalls.length, 0);
    assert.deepEqual(
      await rig.stageFolders(),
      [],
      "the unusable update is removed",
    );
  } finally {
    await rig.cleanup();
  }
});

test("a prepared update that is never applied is removed when the app stops", async () => {
  const rig = await makeMacRig();
  try {
    assert.equal((await rig.service.check()).state, "ready");
    assert.equal((await rig.stageFolders()).length, 1);
    rig.service.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await rig.stageFolders(), []);
  } finally {
    await rig.cleanup();
  }
});

test("an update that was handed to the helper is kept when the app stops", async () => {
  const rig = await makeMacRig();
  try {
    assert.equal((await rig.service.check()).state, "ready");
    assert.equal(await rig.service.installAndRelaunch(), true);
    rig.service.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await rig.stageFolders()).length,
      1,
      "the helper still needs it",
    );
  } finally {
    await rig.cleanup();
  }
});

test("if the app cannot be asked to quit, the waiting helper is stopped", async () => {
  const rig = await makeMacRig({ quitFails: true });
  try {
    assert.equal((await rig.service.check()).state, "ready");
    assert.equal(await rig.service.installAndRelaunch(), false);
    assert.equal(rig.service.snapshot().state, "error");
    assert.equal(
      rig.service.snapshot().releaseUrl,
      "https://colony.global/#download",
    );
    assert.equal(rig.spawned.length, 1);
    assert.equal(rig.spawned[0].child.killed, true);
    assert.deepEqual(await rig.stageFolders(), []);
  } finally {
    await rig.cleanup();
  }
});

test("a ready update is not downloaded again by a background check", async () => {
  const rig = await makeMacRig();
  try {
    assert.equal((await rig.service.check()).state, "ready");
    const before = rig.requests.length;
    await rig.service.check({ background: true });
    assert.equal(rig.requests.length, before);
    assert.deepEqual(rig.service.snapshot(), {
      state: "ready",
      version: "3.0.91",
    });
  } finally {
    await rig.cleanup();
  }
});

// --- where the update comes from -------------------------------------------

test("the metadata URL is the official release URL in a release build", () => {
  assert.equal(
    resolveUpdateMetadataUrl({
      capabilities: { release: true, updateTestOverride: false },
      env: {},
    }),
    UPDATE_METADATA_URL,
  );
});

test("the test override cannot be enabled in a release build", () => {
  const env = { COLONY_UPDATE_TEST_METADATA_URL: "http://127.0.0.1:9/m.json" };
  assert.equal(
    resolveUpdateMetadataUrl({
      capabilities: { release: true, updateTestOverride: true },
      env,
    }),
    UPDATE_METADATA_URL,
  );
  assert.equal(
    resolveUpdateMetadataUrl({
      capabilities: { release: true, updateTestOverride: false },
      env,
    }),
    UPDATE_METADATA_URL,
  );
  assert.equal(
    resolveUpdateMetadataUrl({ capabilities: null, env }),
    UPDATE_METADATA_URL,
  );
});

test("the test override only takes a loopback address in a test build", () => {
  const capabilities = { release: false, updateTestOverride: true };
  assert.equal(
    resolveUpdateMetadataUrl({
      capabilities,
      env: {
        COLONY_UPDATE_TEST_METADATA_URL:
          "http://127.0.0.1:8123/update-metadata.json",
      },
    }),
    "http://127.0.0.1:8123/update-metadata.json",
  );
  for (const bad of [
    "https://example.com/update-metadata.json",
    "http://192.168.1.5:80/update-metadata.json",
    "file:///etc/passwd",
    "not a url",
  ]) {
    assert.throws(
      () =>
        resolveUpdateMetadataUrl({
          capabilities,
          env: { COLONY_UPDATE_TEST_METADATA_URL: bad },
        }),
      /loopback/,
    );
  }
  assert.equal(
    resolveUpdateMetadataUrl({ capabilities, env: {} }),
    UPDATE_METADATA_URL,
  );
});
