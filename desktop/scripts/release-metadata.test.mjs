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
    "latest-linux.yml": "Colony-1.2.3-x64-UNSIGNED.AppImage",
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
  "Colony-1.2.3-x64-UNSIGNED.AppImage",
  "latest-mac.yml",
  "latest.yml",
  "latest-linux.yml",
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
    assert.equal(metadata.platforms["linux-x64"].autoUpdate, true);
    assert.equal(metadata.platforms["linux-x64"].signed, false);

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
      path.join(temporaryDirectory, "latest-linux.yml"),
      "version: 1.2.3\nfiles:\n  - url: Colony-1.2.3-x64-UNSIGNED.AppImage\n    sha512: bad-checksum\n    size: 1\n",
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
