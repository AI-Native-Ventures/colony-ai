import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { extractFile, listPackage, statFile } from "@electron/asar";

import { loadManifest } from "../src-electron/host-protocol.mjs";

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const forbiddenTokens = [
  "@tauri-apps/",
  "__TAURI_INTERNALS__",
  "tauri::Builder",
  "AppHandle",
  "InvokeRequest",
  "src-tauri",
  "tauri.conf.json",
  "buzz://",
  "xyz.block.buzz.app",
  "xyz.block.buzz",
  "fallback-tauri",
];
const normalPackageForbiddenTokens = [
  "COLONY_STAGE0_TEST",
  "COLONY_STAGE0_FAULT",
  "COLONY_STAGE0_HOST_MODE",
  "COLONY_STAGE0_HOST_PATH",
  "test-subframe-preload.cjs",
  "allow-untrusted-ipc",
  "disable-rebind-fence",
  "stage0-instrumented",
  'STAGE0_BUILD_FLAVOR = "instrumented"',
];
const sourceFiles = [
  "electron-stage0-manifest.json",
  "src-electron/main.mjs",
  "src-electron/preload.cjs",
  "src-electron/stage0-flavor.normal.mjs",
  "src-electron/stage0-flavor.instrumented.mjs",
  "src-electron/test-subframe-preload.cjs",
  "src-electron/host-protocol.mjs",
  "src-electron/native-host.mjs",
  "src-electron/renderer-host.mjs",
  "src-electron/ipc-security.mjs",
  "src-electron/feasibility/index.html",
  "src-electron/feasibility/renderer.mjs",
];
const packageFlavors = Object.freeze({
  normal: Object.freeze({
    packageName: "colony-stage0",
    appName: "Buzz Stage0 Normal",
    bundleId: "xyz.ainative.ventures.colony.stage0.normal",
    userDataSuffix: "normal",
    instrumentation: false,
  }),
  instrumented: Object.freeze({
    packageName: "colony-stage0-instrumented",
    appName: "Buzz Stage0 Instrumented",
    bundleId: "xyz.ainative.ventures.colony.stage0.instrumented",
    userDataSuffix: "instrumented",
    instrumentation: true,
  }),
});

function fail(message) {
  throw new Error(`electron stage0 check failed: ${message}`);
}

function scanText(label, text, additionalForbiddenTokens = []) {
  for (const token of [...forbiddenTokens, ...additionalForbiddenTokens]) {
    if (text.includes(token))
      fail(`${label} contains forbidden token ${token}`);
  }
}

function scanSource() {
  for (const relativePath of sourceFiles) {
    const absolutePath = path.join(desktopDirectory, relativePath);
    if (!existsSync(absolutePath))
      fail(`missing approved source ${relativePath}`);
    scanText(relativePath, readFileSync(absolutePath, "utf8"));
  }
  loadManifest(path.join(desktopDirectory, "electron-stage0-manifest.json"));
}

function findApps(packageRoot) {
  const results = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      const info = statSync(absolute);
      if (entry.endsWith(".app") && info.isDirectory()) {
        results.push(absolute);
        continue;
      }
      if (info.isDirectory() && !entry.includes("node_modules"))
        visit(absolute);
    }
  };
  visit(packageRoot);
  return results;
}

function checkAsar(archivePath, flavor) {
  const expected = packageFlavors[flavor];
  const requiredPackageFiles = new Set([
    "package.json",
    "electron-stage0-manifest.json",
    "src-electron/main.mjs",
    "src-electron/preload.cjs",
    "src-electron/stage0-flavor.mjs",
    "src-electron/host-protocol.mjs",
    "src-electron/native-host.mjs",
    "src-electron/renderer-host.mjs",
    "src-electron/ipc-security.mjs",
    "src-electron/feasibility/index.html",
    "src-electron/feasibility/renderer.mjs",
  ]);
  if (expected.instrumentation) {
    requiredPackageFiles.add("src-electron/test-subframe-preload.cjs");
  }
  const entries = listPackage(archivePath).map((entry) =>
    entry.replace(/^\//, ""),
  );
  const fileEntries = entries.filter((entry) => {
    const metadata = statFile(archivePath, entry);
    return !("files" in metadata) && !("link" in metadata);
  });
  const entrySet = new Set(entries);
  for (const required of requiredPackageFiles) {
    if (!entrySet.has(required)) fail(`ASAR is missing ${required}`);
  }
  for (const entry of fileEntries) {
    if (
      entry.startsWith("src/") ||
      entry.startsWith("src-tauri/") ||
      entry.includes("tauri") ||
      entry.includes("node_modules") ||
      entry.endsWith(".dmg")
    ) {
      fail(`ASAR contains an unapproved entry ${entry}`);
    }
  }
  if (fileEntries.filter((entry) => entry.endsWith(".html")).length !== 1) {
    fail("ASAR must contain exactly one HTML UI entry");
  }
  const packageJson = JSON.parse(
    extractFile(archivePath, "package.json").toString("utf8"),
  );
  if (packageJson.stage0Flavor !== flavor) {
    fail(`ASAR flavor is ${packageJson.stage0Flavor ?? "missing"}`);
  }
  if (packageJson.name !== expected.packageName) {
    fail(`ASAR package name is ${packageJson.name ?? "missing"}`);
  }
  if (packageJson.stage0Instrumentation !== expected.instrumentation) {
    fail("ASAR instrumentation metadata disagrees with its flavor");
  }
  if (packageJson.stage0ApplicationId !== expected.bundleId) {
    fail(
      `ASAR application id is ${packageJson.stage0ApplicationId ?? "missing"}`,
    );
  }
  if (packageJson.stage0UserDataSuffix !== expected.userDataSuffix) {
    fail(
      `ASAR user-data suffix is ${packageJson.stage0UserDataSuffix ?? "missing"}`,
    );
  }
  if (
    packageJson.stage0SourceRevision !==
    "ef2aa1ae38fadcc0bc22b8bf6ed96b35933146be"
  ) {
    fail("ASAR source revision disagrees with the pinned manifest");
  }
  if (packageJson.main !== "src-electron/main.mjs") {
    fail(`ASAR entry point is ${packageJson.main ?? "missing"}`);
  }
  const flavorSource = extractFile(
    archivePath,
    "src-electron/stage0-flavor.mjs",
  ).toString("utf8");
  if (
    !flavorSource.includes(`STAGE0_BUILD_FLAVOR = "${flavor}"`) ||
    !flavorSource.includes(
      `STAGE0_INSTRUMENTATION_ENABLED = ${expected.instrumentation}`,
    )
  ) {
    fail("staged flavor metadata disagrees with package metadata");
  }
  if (!expected.instrumentation) {
    const normalFlavorAssertions = [
      "STAGE0_INSTRUMENTATION_ENABLED = false",
      "mutationEnv: null",
      "mutationNames: Object.freeze([])",
      "disableRebindMutation: null",
      "allowUntrustedIpcMutation: null",
      "hostModeEnv: null",
      "faultEnv: null",
      "subframeEnabled: false",
      "subframePreload: null",
      "subframePreloadId: null",
      "subframeFixtureHash: null",
      "stateGlobal: null",
      "killGlobal: null",
    ];
    for (const assertion of normalFlavorAssertions) {
      if (!flavorSource.includes(assertion)) {
        fail(`normal flavor is not immutable: missing ${assertion}`);
      }
    }
    for (const entry of fileEntries) {
      scanText(
        `normal ASAR:${entry}`,
        extractFile(archivePath, entry).toString("utf8"),
        normalPackageForbiddenTokens,
      );
    }
    if (entrySet.has("src-electron/test-subframe-preload.cjs")) {
      fail("normal ASAR contains the instrumented subframe preload");
    }
  }
  for (const entry of fileEntries) {
    scanText(`ASAR:${entry}`, extractFile(archivePath, entry).toString("utf8"));
  }
}

function checkBundle(bundleRoot, flavor) {
  const expected = packageFlavors[flavor];
  const apps = findApps(bundleRoot);
  if (apps.length !== 1) fail(`expected one app bundle, found ${apps.length}`);
  const appRoot = apps[0];
  const resources = path.join(appRoot, "Contents", "Resources");
  const archive = path.join(resources, "app.asar");
  const helper = path.join(resources, "colony-native-host");
  if (!existsSync(archive)) fail("missing Contents/Resources/app.asar");
  if (!existsSync(helper)) fail("missing external colony-native-host resource");
  const helperInfo = statSync(helper);
  if (!helperInfo.isFile() || (helperInfo.mode & 0o111) === 0) {
    fail("native helper is not an executable regular file");
  }
  checkAsar(archive, flavor);
  const appExecutable = path.join(
    appRoot,
    "Contents",
    "MacOS",
    expected.appName,
  );
  if (!existsSync(appExecutable)) fail("missing packaged Electron executable");
  const infoPlist = readFileSync(
    path.join(appRoot, "Contents", "Info.plist"),
    "utf8",
  );
  scanText("bundle metadata", infoPlist);
  if (!infoPlist.includes(expected.bundleId)) {
    fail(`bundle metadata does not include ${expected.bundleId}`);
  }
  return { appRoot, archive, helper };
}

function main() {
  const packageArgument = process.argv[2];
  const flavorArgument = process.argv.find((value) =>
    value.startsWith("--flavor="),
  );
  const flavor = flavorArgument?.slice("--flavor=".length) ?? "normal";
  if (!Object.hasOwn(packageFlavors, flavor)) {
    fail(`unsupported flavor ${flavor}`);
  }
  scanSource();
  if (!packageArgument) {
    console.log("electron_stage0_source_guard=passed");
    return;
  }
  const packageRoot = path.resolve(packageArgument);
  if (!existsSync(packageRoot))
    fail(`package path does not exist: ${packageRoot}`);
  const result = checkBundle(packageRoot, flavor);
  console.log(
    JSON.stringify({
      electron_stage0_package_guard: "passed",
      app: result.appRoot,
      asar: result.archive,
      helper: result.helper,
    }),
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
