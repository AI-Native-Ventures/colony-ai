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
  assertLgplFfmpegConfiguration,
  createPackagerOptions,
  electronPackagePaths,
  ffmpegBundle,
  ffmpegNoticeText,
  ffmpegResourceFilenames,
  nativeHostFilename,
  parseElectronPackageArgs,
  releaseCapabilities,
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

test("an unsigned Mac release build can update itself and has no test override", () => {
  const capabilities = releaseCapabilities({
    platform: "darwin",
    arch: "arm64",
    env: { COLONY_ELECTRON_RELEASE: "1", COLONY_ELECTRON_AUTO_UPDATE: "0" },
  });
  assert.equal(capabilities.selfUpdate, true);
  assert.equal(capabilities.autoUpdate, false);
  assert.equal(capabilities.signed, false);
  assert.equal(capabilities.release, true);
  assert.equal(capabilities.updateTestOverride, false);
  assert.equal(capabilities.schemaVersion, 1);
});

test("signed Mac and Windows release builds do not self-update", () => {
  const signedMac = releaseCapabilities({
    platform: "darwin",
    arch: "arm64",
    env: {
      COLONY_ELECTRON_RELEASE: "1",
      COLONY_ELECTRON_SIGNED: "1",
      COLONY_ELECTRON_AUTO_UPDATE: "1",
    },
  });
  assert.equal(signedMac.selfUpdate, false);
  assert.equal(signedMac.autoUpdate, true);
  const windows = releaseCapabilities({
    platform: "win32",
    arch: "x64",
    env: { COLONY_ELECTRON_RELEASE: "1", COLONY_ELECTRON_AUTO_UPDATE: "1" },
  });
  assert.equal(windows.selfUpdate, false);
});

test("a plain local package never self-updates or accepts an override", () => {
  const capabilities = releaseCapabilities({
    platform: "darwin",
    arch: "arm64",
    env: {},
  });
  assert.equal(capabilities.selfUpdate, false);
  assert.equal(capabilities.updateTestOverride, false);
  assert.equal(capabilities.release, false);
});

test("the update test override exists only in a non-release Mac test build", () => {
  const capabilities = releaseCapabilities({
    platform: "darwin",
    arch: "arm64",
    env: { COLONY_ELECTRON_UPDATE_TEST: "1" },
  });
  assert.equal(capabilities.updateTestOverride, true);
  assert.equal(capabilities.release, false);
  assert.equal(capabilities.selfUpdate, true);
  assert.throws(
    () =>
      releaseCapabilities({
        platform: "darwin",
        arch: "arm64",
        env: { COLONY_ELECTRON_RELEASE: "1", COLONY_ELECTRON_UPDATE_TEST: "1" },
      }),
    /release build cannot enable the update test override/,
  );
});

test("the release native host is built with the Colony Agent gateway flag and the build proves it", () => {
  const workflow = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../.github/workflows/electron-package.yml",
    ),
    "utf8",
  );
  const build = workflow.slice(
    workflow.indexOf("- name: Build native host"),
    workflow.indexOf("- name: Verify the production relay is baked"),
  );
  // The flag belongs to the release branch only; other packages stay unchanged.
  assert.match(
    build,
    /if \[ "\$RELEASE_BUILD" = "true" \]; then[\s\S]*export COLONY_CREDITS_GATEWAY=1[\s\S]*\n\s*fi\n/,
  );
  assert.equal(build.split("COLONY_CREDITS_GATEWAY").length - 1, 1);
  // The release job must grep the built host for the compiled marker.
  const verify = workflow.slice(
    workflow.indexOf("- name: Verify the Colony Agent gateway flag"),
  );
  assert.match(verify, /if: inputs\.release/);
  assert.match(verify, /colony-credits-gateway-build=on/);
  // The key never reaches a client build.
  assert.doesNotMatch(
    workflow,
    /OPENROUTER_MASTER_KEY|COLONY_CREDITS_UPSTREAM_KEY/,
  );
});

const ffmpegBundleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "ffmpeg-bundle",
);

test("macOS arm64 and Windows x64 packages carry ffmpeg, its notice and its licence", () => {
  assert.deepEqual(ffmpegResourceFilenames("darwin", "arm64"), [
    "ffmpeg",
    "ffmpeg-NOTICE.txt",
    "ffmpeg-COPYING.LGPLv2.1.txt",
  ]);
  assert.deepEqual(ffmpegResourceFilenames("win32", "x64"), [
    "ffmpeg.exe",
    "ffmpeg-NOTICE.txt",
    "ffmpeg-COPYING.LGPLv2.1.txt",
  ]);
  // Elsewhere the app looks for an ffmpeg on the machine.
  assert.deepEqual(ffmpegResourceFilenames("darwin", "x64"), []);
  assert.deepEqual(ffmpegResourceFilenames("linux", "x64"), []);
});

test("the bundled ffmpeg names the executable the host looks for", () => {
  // media_transcode.rs `bundled_ffmpeg_in` joins `ffmpeg` and the OS suffix.
  assert.equal(ffmpegBundle("darwin", "arm64").executable, "ffmpeg");
  assert.equal(ffmpegBundle("win32", "x64").executable, "ffmpeg.exe");
  const hostSource = readFileSync(
    path.resolve(
      ffmpegBundleDirectory,
      "..",
      "src-tauri",
      "src",
      "commands",
      "media_transcode.rs",
    ),
    "utf8",
  );
  assert.match(
    hostSource,
    /format!\("ffmpeg\{\}", std::env::consts::EXE_SUFFIX\)/,
  );
});

test("package arguments accept the ffmpeg folder", () => {
  assert.equal(
    parseElectronPackageArgs([
      "--platform=win32",
      "--arch=x64",
      "--ffmpeg-dir=C:/runner/ffmpeg",
    ]).ffmpegDir,
    "C:/runner/ffmpeg",
  );
});

test("the ffmpeg manifest pins a signed source release", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(ffmpegBundleDirectory, "manifest.json"), "utf8"),
  );
  assert.match(manifest.version, /^\d+\.\d+(\.\d+)?$/);
  assert.equal(manifest.license, "LGPL-2.1-or-later");
  assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.source.signingKeyFingerprint, /^[0-9A-F]{40}$/);
  assert.equal(
    manifest.source.url,
    `https://ffmpeg.org/releases/ffmpeg-${manifest.version}.tar.xz`,
  );
  assert.equal(manifest.source.signatureUrl, `${manifest.source.url}.asc`);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    "darwin-arm64",
    "win32-x64",
  ]);
});

test("the ffmpeg build recipe stays LGPL-only and checks its source", () => {
  const recipe = readFileSync(
    path.join(ffmpegBundleDirectory, "build.sh"),
    "utf8",
  );
  for (const required of [
    "--disable-gpl",
    "--disable-nonfree",
    "--disable-autodetect",
    "--disable-network",
    "--enable-videotoolbox",
    "--enable-mediafoundation",
    "checksum mismatch",
  ]) {
    assert.ok(recipe.includes(required), `build.sh is missing ${required}`);
  }
  assert.doesNotMatch(
    recipe,
    /--enable-(gpl|nonfree|version3|libx264|libx265|libfdk)/,
  );
});

test("only an LGPL-only ffmpeg configuration passes", () => {
  const lgpl =
    "ffmpeg version 8.1\nconfiguration: --disable-gpl --disable-nonfree --enable-videotoolbox\n";
  assert.equal(
    assertLgplFfmpegConfiguration(lgpl),
    "--disable-gpl --disable-nonfree --enable-videotoolbox",
  );
  for (const bad of [
    "configuration: --enable-gpl --enable-libx264",
    "configuration: --disable-gpl --enable-nonfree --enable-libfdk-aac",
    "configuration: --enable-videotoolbox",
  ]) {
    assert.throws(() => assertLgplFfmpegConfiguration(bad));
  }
  assert.throws(
    () => assertLgplFfmpegConfiguration("ffmpeg version 8.1\n"),
    /no configuration line/,
  );
});

test("the ffmpeg notice carries the licence, the source and the offer", () => {
  const bundle = ffmpegBundle("darwin", "arm64");
  const notice = ffmpegNoticeText({
    bundle,
    configuration: "--disable-gpl --enable-videotoolbox",
  });
  assert.match(
    notice,
    /GNU Lesser\nGeneral Public License, version 2\.1 or later/,
  );
  assert.ok(notice.includes(bundle.licenseFilename));
  assert.ok(notice.includes(bundle.source.url));
  assert.ok(notice.includes(bundle.source.sha256));
  assert.ok(notice.includes("--disable-gpl --enable-videotoolbox"));
  assert.match(notice, /ask for a copy/);
});
