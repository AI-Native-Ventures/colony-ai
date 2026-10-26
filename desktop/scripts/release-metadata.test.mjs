import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeReleaseMetadata } from "./release-metadata.mjs";

async function makeAssets(directory, names) {
  for (const name of names) {
    if (name.endsWith(".yml")) continue;
    await writeFile(path.join(directory, name), `asset:${name}`);
  }
  const feeds = {
    "latest-mac.yml": "Colony-1.2.3-arm64-UNSIGNED.zip",
    "latest.yml": "Colony-1.2.3-x64-UNSIGNED.exe",
  };
  for (const [feedName, artifactName] of Object.entries(feeds)) {
    const artifact = await readFile(path.join(directory, artifactName));
    const sha512 = createHash("sha512").update(artifact).digest("base64");
    await writeFile(
      path.join(directory, feedName),
      `version: 1.2.3\nfiles:\n  - url: ${artifactName}\n    sha512: ${sha512}\n`,
    );
  }
}

const validAssets = [
  "Colony-1.2.3-arm64-UNSIGNED.dmg",
  "Colony-1.2.3-arm64-UNSIGNED.zip",
  "Colony-1.2.3-x64-UNSIGNED.exe",
  "latest-mac.yml",
  "latest.yml",
];

test("release metadata records all installers, update feeds and SHA-256 checksums", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "colony-release-metadata-"),
  );
  try {
    await makeAssets(temporaryDirectory, validAssets);
    const metadata = await writeReleaseMetadata({
      assetsDir: temporaryDirectory,
      version: "1.2.3",
      macSigned: false,
      windowsSigned: false,
    });

    assert.equal(metadata.schemaVersion, 1);
    assert.equal(metadata.tag, "desktop-v1.2.3");
    assert.deepEqual(metadata.platforms["darwin-arm64"], {
      signed: false,
      autoUpdate: false,
      selfUpdate: true,
      installer: "Colony-1.2.3-arm64-UNSIGNED.dmg",
      updateArchive: "Colony-1.2.3-arm64-UNSIGNED.zip",
      updateMetadata: "latest-mac.yml",
    });
    assert.deepEqual(metadata.platforms["win32-x64"], {
      signed: false,
      autoUpdate: true,
      installer: "Colony-1.2.3-x64-UNSIGNED.exe",
      updateMetadata: "latest.yml",
    });
    // Colony ships for Mac and Windows only.
    assert.deepEqual(Object.keys(metadata.platforms), [
      "darwin-arm64",
      "win32-x64",
    ]);

    const installer = metadata.assets.find(
      (asset) => asset.name === "Colony-1.2.3-x64-UNSIGNED.exe",
    );
    assert.equal(
      installer.sha256,
      createHash("sha256")
        .update("asset:Colony-1.2.3-x64-UNSIGNED.exe")
        .digest("hex"),
    );
    const checksums = await readFile(
      path.join(temporaryDirectory, "checksums.txt"),
      "utf8",
    );
    assert.match(checksums, / {2}update-metadata\.json\n/);
    assert.doesNotMatch(checksums, / {2}checksums\.txt/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("release metadata rejects missing installer assets and mismatched signing labels", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "colony-release-metadata-"),
  );
  try {
    await makeAssets(temporaryDirectory, validAssets);
    await assert.rejects(
      writeReleaseMetadata({
        assetsDir: temporaryDirectory,
        version: "1.2.3",
        macSigned: true,
        windowsSigned: false,
      }),
      /macOS installer label does not match its signing state/,
    );
    await assert.rejects(
      writeReleaseMetadata({
        assetsDir: temporaryDirectory,
        version: "not-a-version",
        macSigned: false,
        windowsSigned: false,
      }),
      /semantic versioning/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("release metadata rejects updater feeds with mismatched installer hashes", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "colony-release-metadata-"),
  );
  try {
    await makeAssets(temporaryDirectory, validAssets);
    await writeFile(
      path.join(temporaryDirectory, "latest.yml"),
      "version: 1.2.3\nfiles:\n  - url: Colony-1.2.3-x64-UNSIGNED.exe\n    sha512: bad-checksum\n    size: 1\n",
    );
    await assert.rejects(
      writeReleaseMetadata({
        assetsDir: temporaryDirectory,
        version: "1.2.3",
        macSigned: false,
        windowsSigned: false,
      }),
      /checksum or size does not match/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("an unsigned Mac release lists the update archive for in-app self-update and still reads as manual to older clients", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "colony-release-metadata-"),
  );
  try {
    await makeAssets(temporaryDirectory, validAssets);
    const metadata = await writeReleaseMetadata({
      assetsDir: temporaryDirectory,
      version: "1.2.3",
      macSigned: false,
      windowsSigned: false,
    });
    const mac = metadata.platforms["darwin-arm64"];
    assert.equal(mac.selfUpdate, true);
    // Clients before selfUpdate only read these two flags: they must keep
    // concluding "manual download".
    assert.equal(mac.signed, false);
    assert.equal(mac.autoUpdate, false);
    // The archive a new client downloads is named here and carries size and sha256.
    const archive = metadata.assets.find(
      (asset) => asset.name === mac.updateArchive,
    );
    assert.deepEqual(archive, {
      name: "Colony-1.2.3-arm64-UNSIGNED.zip",
      platform: "darwin-arm64",
      size: Buffer.byteLength("asset:Colony-1.2.3-arm64-UNSIGNED.zip"),
      sha256: createHash("sha256")
        .update("asset:Colony-1.2.3-arm64-UNSIGNED.zip")
        .digest("hex"),
      signed: false,
    });
    const onDisk = JSON.parse(
      await readFile(
        path.join(temporaryDirectory, "update-metadata.json"),
        "utf8",
      ),
    );
    assert.deepEqual(onDisk, metadata);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("a signed Mac release keeps electron-updater and does not offer self-update", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "colony-release-metadata-"),
  );
  try {
    const names = [
      "Colony-1.2.3-arm64-SIGNED.dmg",
      "Colony-1.2.3-arm64-SIGNED.zip",
      "Colony-1.2.3-x64-UNSIGNED.exe",
      "latest-mac.yml",
      "latest.yml",
    ];
    for (const name of names) {
      if (!name.endsWith(".yml")) {
        await writeFile(path.join(temporaryDirectory, name), `asset:${name}`);
      }
    }
    for (const [feed, artifact] of [
      ["latest-mac.yml", "Colony-1.2.3-arm64-SIGNED.zip"],
      ["latest.yml", "Colony-1.2.3-x64-UNSIGNED.exe"],
    ]) {
      const bytes = await readFile(path.join(temporaryDirectory, artifact));
      await writeFile(
        path.join(temporaryDirectory, feed),
        `version: 1.2.3\nfiles:\n  - url: ${artifact}\n    sha512: ${createHash("sha512").update(bytes).digest("base64")}\n`,
      );
    }
    const metadata = await writeReleaseMetadata({
      assetsDir: temporaryDirectory,
      version: "1.2.3",
      macSigned: true,
      windowsSigned: false,
    });
    const mac = metadata.platforms["darwin-arm64"];
    assert.equal(mac.autoUpdate, true);
    assert.equal(mac.selfUpdate, false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
