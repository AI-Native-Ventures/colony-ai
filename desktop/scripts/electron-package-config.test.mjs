import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";
import {
  APP_ICON_BASENAME,
  ELECTRON_BUNDLE_ID,
  adhocSignArguments,
  createPackagerOptions,
  electronPackagePaths,
  nativeHostFilename,
  parseElectronPackageArgs,
  sidecarFilenames,
  verifySignatureArguments,
} from "./electron-package-config.mjs";

test("Vite exposes the public Google client ID without exposing its secret", async () => {
  const desktopDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const viteConfigPath = path.join(desktopDirectory, "vite.config.ts");
  const previousClientId = process.env.COLONY_GOOGLE_DESKTOP_CLIENT_ID;
  const previousClientSecret = process.env.COLONY_GOOGLE_DESKTOP_CLIENT_SECRET;
  const generatedClientId = "generated-test-google-desktop-client-id";
  const generatedClientSecret = "generated-test-google-desktop-client-secret";

  try {
    process.env.COLONY_GOOGLE_DESKTOP_CLIENT_ID = generatedClientId;
    process.env.COLONY_GOOGLE_DESKTOP_CLIENT_SECRET = generatedClientSecret;

    const loaded = await loadConfigFromFile(
      { command: "build", mode: "test" },
      viteConfigPath,
      desktopDirectory,
      "silent",
    );

    assert.ok(loaded, "Vite config should load");
    const rendererDefines = loaded.config.define ?? {};
    assert.equal(
      rendererDefines["import.meta.env.COLONY_GOOGLE_DESKTOP_CLIENT_ID"],
      JSON.stringify(generatedClientId),
    );
    assert.equal(
      rendererDefines["import.meta.env.COLONY_GOOGLE_DESKTOP_CLIENT_SECRET"],
      undefined,
    );
    assert.ok(!JSON.stringify(rendererDefines).includes(generatedClientSecret));
  } finally {
    if (previousClientId === undefined) {
      delete process.env.COLONY_GOOGLE_DESKTOP_CLIENT_ID;
    } else {
      process.env.COLONY_GOOGLE_DESKTOP_CLIENT_ID = previousClientId;
    }
    if (previousClientSecret === undefined) {
      delete process.env.COLONY_GOOGLE_DESKTOP_CLIENT_SECRET;
    } else {
      process.env.COLONY_GOOGLE_DESKTOP_CLIENT_SECRET = previousClientSecret;
    }
  }
});

test("package arguments require a supported platform and architecture", () => {
  assert.deepEqual(
    parseElectronPackageArgs([
      "--platform=darwin",
      "--arch=arm64",
      "--host=/tmp/native host=release",
      "--sidecar-dir=/tmp/native runtime",
    ]),
    {
      platform: "darwin",
      arch: "arm64",
      host: "/tmp/native host=release",
      sidecarDir: "/tmp/native runtime",
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

test("Windows package metadata uses the configured product name", () => {
  const options = createPackagerOptions({
    dir: "/tmp/staged-app",
    out: "/checkout/desktop/dist-electron",
    productName: "Buzz",
    appVersion: "0.5.23",
    electronVersion: "44.4.3",
    platform: "win32",
    arch: "x64",
    extraResource: ["/tmp/staged-app/colony-native-host.exe"],
  });

  assert.deepEqual(options.win32metadata, { CompanyName: "Buzz" });
});

test("macOS package declares why the app needs microphone access", () => {
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

  assert.deepEqual(options.extendInfo, {
    NSMicrophoneUsageDescription:
      "Your microphone is used to send and receive audio in huddles.",
  });
});

test("macOS package declares the deep-link schemes in Info.plist", () => {
  const base = {
    dir: "/tmp/staged-app",
    out: "/checkout/desktop/dist-electron",
    productName: "Colony",
    appVersion: "1.0.5",
    electronVersion: "44.4.3",
    arch: "arm64",
    extraResource: ["/tmp/staged-app/colony-native-host"],
    deepLinkSchemes: ["colony", "buzz"],
  };

  // macOS only routes a scheme to an app that declares it in Info.plist.
  assert.deepEqual(
    createPackagerOptions({ ...base, platform: "darwin" }).protocols,
    [{ name: "Colony link", schemes: ["colony", "buzz"] }],
  );
  assert.equal(
    createPackagerOptions({ ...base, platform: "linux" }).protocols,
    undefined,
  );
  assert.equal(
    createPackagerOptions({ ...base, platform: "darwin", deepLinkSchemes: [] })
      .protocols,
    undefined,
  );
});

test("sidecar staging includes real runtime binaries for each platform", () => {
  assert.deepEqual(sidecarFilenames("darwin"), [
    "buzz-acp",
    "buzz-agent",
    "buzz-dev-mcp",
    "git-credential-nostr",
    "buzz",
    "buzz-backend-kubernetes",
  ]);
  assert.deepEqual(sidecarFilenames("linux"), sidecarFilenames("darwin"));
  assert.deepEqual(sidecarFilenames("win32"), [
    "buzz-acp.exe",
    "buzz-agent.exe",
    "buzz-dev-mcp.exe",
    "git-credential-nostr.exe",
    "buzz.exe",
  ]);
  assert.throws(() => sidecarFilenames("freebsd"), /Unsupported platform/);
});

test("the packager is given the Colony icon so apps do not ship the Electron one", () => {
  const options = createPackagerOptions({
    dir: "/tmp/staged-app",
    out: "/checkout/desktop/dist-electron",
    productName: "Colony",
    appVersion: "1.0.1",
    electronVersion: "44.4.3",
    platform: "darwin",
    arch: "arm64",
    extraResource: [],
    icon: "/checkout/desktop/src-tauri/icons/icon",
  });

  assert.equal(options.icon, "/checkout/desktop/src-tauri/icons/icon");
  assert.equal(APP_ICON_BASENAME, "icon");
});

test("unsigned macOS bundles are re-signed ad hoc over the whole bundle and verified strictly", () => {
  assert.deepEqual(adhocSignArguments("/out/Colony.app"), [
    "--force",
    "--deep",
    "--sign",
    "-",
    "/out/Colony.app",
  ]);
  assert.deepEqual(verifySignatureArguments("/out/Colony.app"), [
    "--verify",
    "--deep",
    "--strict",
    "/out/Colony.app",
  ]);
});

test("the committed app icons are the Colony icon set at usable sizes", () => {
  const icons = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src-tauri",
    "icons",
  );
  const png = readFileSync(path.join(icons, "icon.png"));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);

  const ico = readFileSync(path.join(icons, "icon.ico"));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 6, "icon.ico carries the standard sizes");

  const icns = readFileSync(path.join(icons, "icon.icns"));
  assert.equal(icns.subarray(0, 4).toString(), "icns");

  const source = readFileSync(path.join(icons, "colony-icon.svg"), "utf8");
  assert.match(
    source,
    /#f4f2e8/,
    "the committed source is the Colony ant mark",
  );
});
