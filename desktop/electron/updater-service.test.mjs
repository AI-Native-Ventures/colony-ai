import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createElectronUpdaterService,
  isNewerVersion,
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
      releaseUrl:
        "https://github.com/AI-Native-Ventures/colony-ai/releases/latest",
    });
    assert.equal(updater.checkCount, 0);
    assert.deepEqual(updater.installCalls, []);
  } finally {
    service.stop();
    await close(server);
  }
});
