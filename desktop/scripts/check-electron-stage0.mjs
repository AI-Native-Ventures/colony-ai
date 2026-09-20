import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { extractFile, listPackage, statFile } from "@electron/asar";

import { loadManifest } from "../src-electron/host-protocol.mjs";
import { getStage0TargetFromArguments } from "../src-electron/stage0-platform.mjs";

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
  "src-electron/stage0-platform.mjs",
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

function checkAsar(archivePath, flavor, target) {
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
    "src-electron/stage0-platform.mjs",
    "src-electron/feasibility/index.html",
    "src-electron/feasibility/renderer.mjs",
  ]);
  if (expected.instrumentation) {
    requiredPackageFiles.add("src-electron/test-subframe-preload.cjs");
  }
  const entryByCanonicalPath = new Map(
    listPackage(archivePath).map((entry) => [
      entry.replace(/^[/\\]/, "").replaceAll("\\", "/"),
      entry,
    ]),
  );
  const entries = [...entryByCanonicalPath.keys()];
  const rawEntry = (entry) => entryByCanonicalPath.get(entry) ?? entry;
  const lookupEntry = (entry) => rawEntry(entry).replace(/^[/\\]+/, "");
  const extractEntry = (entry) => extractFile(archivePath, lookupEntry(entry));
  const fileEntries = entries.filter((entry) => {
    const metadata = statFile(archivePath, lookupEntry(entry));
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
  const packageJson = JSON.parse(extractEntry("package.json").toString("utf8"));
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
  if (packageJson.stage0Platform !== target.platform) {
    fail(`ASAR platform is ${packageJson.stage0Platform ?? "missing"}`);
  }
  if (packageJson.stage0Arch !== target.arch) {
    fail(`ASAR architecture is ${packageJson.stage0Arch ?? "missing"}`);
  }
  if (packageJson.stage0TargetTriple !== target.targetTriple) {
    fail(
      `ASAR target triple is ${packageJson.stage0TargetTriple ?? "missing"}`,
    );
  }
  if (packageJson.stage0HelperName !== target.helperName) {
    fail(`ASAR helper name is ${packageJson.stage0HelperName ?? "missing"}`);
  }
  if (packageJson.main !== "src-electron/main.mjs") {
    fail(`ASAR entry point is ${packageJson.main ?? "missing"}`);
  }
  const flavorSource = extractEntry("src-electron/stage0-flavor.mjs").toString(
    "utf8",
  );
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
        extractEntry(entry).toString("utf8"),
        normalPackageForbiddenTokens,
      );
    }
    if (entrySet.has("src-electron/test-subframe-preload.cjs")) {
      fail("normal ASAR contains the instrumented subframe preload");
    }
  }
  for (const entry of fileEntries) {
    scanText(`ASAR:${entry}`, extractEntry(entry).toString("utf8"));
  }
}

function readPeMachine(filePath) {
  const descriptor = openSync(filePath, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    if (readSync(descriptor, dosHeader, 0, dosHeader.length, 0) !== 64) {
      return null;
    }
    if (dosHeader.readUInt16LE(0) !== 0x5a4d) return null;
    const peOffset = dosHeader.readUInt32LE(60);
    const peHeader = Buffer.alloc(6);
    if (readSync(descriptor, peHeader, 0, peHeader.length, peOffset) !== 6) {
      return null;
    }
    if (peHeader.toString("ascii", 0, 4) !== "PE\0\0") return null;
    return peHeader.readUInt16LE(4);
  } finally {
    closeSync(descriptor);
  }
}

function findWindowsApp(packageRoot, appName) {
  const expectedExecutable = `${appName}.exe`;
  const matches = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const absolute = path.join(directory, entry);
      const info = statSync(absolute);
      if (info.isDirectory()) {
        if (!entry.includes("node_modules")) visit(absolute);
      } else if (entry === expectedExecutable) {
        matches.push({
          appRoot: path.dirname(absolute),
          appExecutable: absolute,
        });
      }
    }
  };
  visit(packageRoot);
  if (matches.length !== 1) {
    fail(`expected one Windows app executable, found ${matches.length}`);
  }
  return matches[0];
}

function findExecutableFiles(directory) {
  const matches = [];
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const info = statSync(absolute);
      if (info.isDirectory()) {
        if (!entry.includes("node_modules")) visit(absolute);
      } else if (entry.toLowerCase().endsWith(".exe")) {
        matches.push(absolute);
      }
    }
  };
  visit(directory);
  return matches;
}

function checkMacBundle(bundleRoot, flavor, target) {
  const expected = packageFlavors[flavor];
  const apps = findApps(bundleRoot);
  if (apps.length !== 1) fail(`expected one app bundle, found ${apps.length}`);
  const appRoot = apps[0];
  const resources = path.join(appRoot, "Contents", "Resources");
  const archive = path.join(resources, "app.asar");
  const helper = path.join(resources, target.helperName);
  if (!existsSync(archive)) fail("missing Contents/Resources/app.asar");
  if (!existsSync(helper)) fail("missing external colony-native-host resource");
  const helperInfo = statSync(helper);
  if (!helperInfo.isFile() || (helperInfo.mode & 0o111) === 0) {
    fail("native helper is not an executable regular file");
  }
  checkAsar(archive, flavor, target);
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

function checkWindowsBundle(bundleRoot, flavor, target) {
  const { appRoot, appExecutable } = findWindowsApp(
    bundleRoot,
    target.executableName,
  );
  const resources = path.join(appRoot, "resources");
  const archive = path.join(resources, "app.asar");
  const helper = path.join(resources, target.helperName);
  if (!existsSync(archive)) fail("missing resources/app.asar");
  if (!existsSync(helper))
    fail(`missing external ${target.helperName} resource`);
  for (const executable of [appExecutable, helper]) {
    if (
      !statSync(executable).isFile() ||
      readPeMachine(executable) !== 0x8664
    ) {
      fail(`Windows x64 PE resource check failed for ${executable}`);
    }
  }
  const executableFiles = findExecutableFiles(bundleRoot);
  const allowedExecutables = new Set([appExecutable, helper]);
  for (const executable of executableFiles) {
    if (!allowedExecutables.has(executable)) {
      fail(`unexpected Windows executable resource ${executable}`);
    }
  }
  if (executableFiles.length !== 2) {
    fail(
      `expected one app and one helper executable, found ${executableFiles.length}`,
    );
  }
  checkAsar(archive, flavor, target);
  return { appRoot, archive, helper, appExecutable };
}

function checkBundle(bundleRoot, flavor, target) {
  if (target.bundleKind === "app") {
    return checkMacBundle(bundleRoot, flavor, target);
  }
  if (target.bundleKind === "directory") {
    return checkWindowsBundle(bundleRoot, flavor, target);
  }
  fail(`unsupported package bundle kind ${target.bundleKind}`);
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
  const target = getStage0TargetFromArguments();
  scanSource();
  if (!packageArgument) {
    console.log("electron_stage0_source_guard=passed");
    return;
  }
  const packageRoot = path.resolve(packageArgument);
  if (!existsSync(packageRoot))
    fail(`package path does not exist: ${packageRoot}`);
  const result = checkBundle(packageRoot, flavor, target);
  console.log(
    JSON.stringify({
      electron_stage0_package_guard: "passed",
      platform: target.platform,
      arch: target.arch,
      targetTriple: target.targetTriple,
      app: result.appRoot,
      appExecutable: result.appExecutable ?? null,
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
