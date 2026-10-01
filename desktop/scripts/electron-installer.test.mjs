import assert from "node:assert/strict";
import test from "node:test";

import { createInstallerConfig } from "./electron-installer.mjs";

test("release installer config uses explicit platform targets and artifact labels", () => {
  const mac = createInstallerConfig({
    desktopPath: "/tmp/desktop",
    platform: "darwin",
    arch: "arm64",
    version: "1.2.3",
    signed: true,
  });
  assert.equal(mac.artifactName, `Colony-\${version}-arm64-SIGNED.\${ext}`);
  assert.deepEqual(mac.mac.target, ["dmg", "zip"]);
  assert.equal(mac.mac.identity, undefined);

  const windows = createInstallerConfig({
    desktopPath: "/tmp/desktop",
    platform: "win32",
    arch: "x64",
    version: "1.2.3",
    signed: false,
  });
  assert.equal(windows.artifactName, `Colony-\${version}-x64-UNSIGNED.\${ext}`);
  assert.deepEqual(windows.win.target, ["nsis"]);
  assert.equal(windows.win.verifyUpdateCodeSignature, false);

  const linux = createInstallerConfig({
    desktopPath: "/tmp/desktop",
    platform: "linux",
    arch: "x64",
    version: "1.2.3",
    signed: false,
  });
  assert.equal(linux.artifactName, `Colony-\${version}-x64-UNSIGNED.\${ext}`);
  assert.deepEqual(linux.linux.target, ["AppImage"]);
});

test("release installer config rejects unsupported targets and invalid versions", () => {
  assert.throws(
    () =>
      createInstallerConfig({
        desktopPath: "/tmp/desktop",
        platform: "linux",
        arch: "arm64",
        version: "1.2.3",
        signed: false,
      }),
    /Installer target/,
  );
  assert.throws(
    () =>
      createInstallerConfig({
        desktopPath: "/tmp/desktop",
        platform: "linux",
        arch: "x64",
        version: "latest",
        signed: false,
      }),
    /semantic versioning/,
  );
});
