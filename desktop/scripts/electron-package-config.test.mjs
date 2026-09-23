import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  ELECTRON_BUNDLE_ID,
  createPackagerOptions,
  electronPackagePaths,
  nativeHostFilename,
  parseElectronPackageArgs,
} from "./electron-package-config.mjs";

test("package arguments require a supported platform and architecture", () => {
  assert.deepEqual(
    parseElectronPackageArgs([
      "--platform=darwin",
      "--arch=arm64",
      "--host=/tmp/native host=release",
    ]),
    {
      platform: "darwin",
      arch: "arm64",
      host: "/tmp/native host=release",
    },
  );

  assert.throws(
    () => parseElectronPackageArgs(["--arch=x64"]),
    /--platform is required/,
  );
  assert.throws(
    () => parseElectronPackageArgs(["--platform=linux"]),
    /--arch is required/,
  );
  assert.throws(
    () => parseElectronPackageArgs(["--platform=freebsd", "--arch=x64"]),
    /Unsupported platform/,
  );
  assert.throws(
    () => parseElectronPackageArgs(["--platform=linux", "--arch=ia32"]),
    /Unsupported architecture/,
  );
});

test("package arguments reject duplicates, unknown flags, and an empty host", () => {
  assert.throws(
    () =>
      parseElectronPackageArgs([
        "--platform=linux",
        "--platform=darwin",
        "--arch=x64",
      ]),
    /specified more than once/,
  );
  assert.throws(
    () =>
      parseElectronPackageArgs(["--platform=linux", "--arch=x64", "--verbose"]),
    /Unknown argument/,
  );
  assert.throws(
    () =>
      parseElectronPackageArgs(["--platform=linux", "--arch=x64", "--host="]),
    /--host cannot be empty/,
  );
});

test("each platform gets the requested output directory and archive format", () => {
  const base = { desktop: "/checkout/desktop", arch: "x64" };
  const outputRoot = path.join(base.desktop, "dist-electron");

  assert.deepEqual(electronPackagePaths({ ...base, platform: "darwin" }), {
    outputDir: path.join(outputRoot, "darwin-x64"),
    archivePath: path.join(outputRoot, "darwin-x64.zip"),
    packagerOutputDir: outputRoot,
  });
  assert.equal(
    electronPackagePaths({ ...base, platform: "win32" }).archivePath,
    path.join(outputRoot, "win32-x64.zip"),
  );
  assert.equal(
    electronPackagePaths({ ...base, platform: "linux" }).archivePath,
    path.join(outputRoot, "linux-x64.tar.gz"),
  );
  assert.equal(nativeHostFilename("darwin"), "colony-native-host");
  assert.equal(nativeHostFilename("win32"), "colony-native-host.exe");
});

test("packager config keeps Buzz identity and places runtime files in asar", () => {
  const options = createPackagerOptions({
    dir: "/tmp/staged-app",
    out: "/checkout/desktop/dist-electron",
    productName: "Buzz",
    appVersion: "0.5.23",
    electronVersion: "44.4.3",
    platform: "darwin",
    arch: "arm64",
    extraResource: ["/tmp/staged-app/colony-native-host"],
  });

  assert.equal(options.name, "Buzz");
  assert.equal(options.executableName, "Buzz");
  assert.equal(options.appBundleId, ELECTRON_BUNDLE_ID);
  assert.equal(options.asar, true);
  assert.equal(options.platform, "darwin");
  assert.equal(options.arch, "arm64");
  assert.deepEqual(options.extraResource, [
    "/tmp/staged-app/colony-native-host",
  ]);
});
