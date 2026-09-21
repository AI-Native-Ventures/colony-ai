import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  lstatSync,
  realpathSync,
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
  "--no-sandbox",
  "sandbox: false",
  "ELECTRON_DISABLE_SANDBOX",
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
  "__BUZZ_E2E__",
  "maybeInstallE2eTauriMocks",
  "src/main.tsx",
];
// The upstream React bundle contains shared Tauri adapter modules because the
// browser/Tauri product still owns those capabilities. Electron must not
// execute them, but rejecting their package names would make a real upstream
// build impossible. Keep the generated bundle guard focused on development
// mocks and sandbox-disabling launch paths; the packaged spec proves the
// Electron runtime has no Tauri internals and remains on the onboarding gate.
const reactRendererForbiddenTokens = [
  "__BUZZ_E2E__",
  "maybeInstallE2eTauriMocks",
  "src/main.tsx",
  "--no-sandbox",
  "sandbox: false",
  "ELECTRON_DISABLE_SANDBOX",
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
  "src-electron/identity-protocol.mjs",
  "src-electron/identity-launch.mjs",
  "src-electron/renderer-host.mjs",
  "src-electron/stage0-platform.mjs",
  "src-electron/stage0-renderer.feasibility.mjs",
  "src-electron/stage0-renderer.react.mjs",
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

export function canonicalizeAsarEntry(rawEntry) {
  if (typeof rawEntry !== "string" || rawEntry.length === 0) {
    throw new Error("unsafe ASAR entry: empty or non-string path");
  }
  if (rawEntry.includes("\0")) {
    throw new Error("unsafe ASAR entry: NUL byte");
  }
  if (/^[\\/]{2}/.test(rawEntry)) {
    throw new Error("unsafe ASAR entry: multiple leading separators");
  }
  const withoutObservedLeadingSeparator = /^[\\/]/.test(rawEntry)
    ? rawEntry.slice(1)
    : rawEntry;
  if (/^[A-Za-z]:/.test(withoutObservedLeadingSeparator)) {
    throw new Error("unsafe ASAR entry: drive-qualified path");
  }
  const normalized = withoutObservedLeadingSeparator.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("//")
  ) {
    throw new Error("unsafe ASAR entry: unsupported absolute or empty segment");
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment === "." || segment === ".." || segment === "",
    )
  ) {
    throw new Error("unsafe ASAR entry: dot or empty path segment");
  }
  return normalized;
}

export function canonicalizeAsarEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) {
    throw new Error("unsafe ASAR entry list: expected an array");
  }
  const entryByCanonicalPath = new Map();
  for (const rawEntry of rawEntries) {
    const canonical = canonicalizeAsarEntry(rawEntry);
    if (entryByCanonicalPath.has(canonical)) {
      throw new Error(`ASAR canonical collision: ${canonical}`);
    }
    entryByCanonicalPath.set(canonical, rawEntry);
  }
  return entryByCanonicalPath;
}

export function isApprovedAsarFileEntry(entry, uiMode) {
  const isGeneratedReactTauriChunk =
    uiMode === "react" &&
    /^src-electron\/renderer\/assets\/tauri-[A-Za-z0-9_-]+\.js$/.test(entry);
  return (
    !entry.startsWith("src/") &&
    !entry.startsWith("src-tauri/") &&
    (!entry.includes("tauri") || isGeneratedReactTauriChunk) &&
    !entry.includes("node_modules") &&
    !entry.endsWith(".dmg")
  );
}

export function scanText(
  label,
  text,
  additionalForbiddenTokens = [],
  allowedForbiddenTokens = [],
) {
  const allowed = new Set(allowedForbiddenTokens);
  for (const token of [...forbiddenTokens, ...additionalForbiddenTokens]) {
    if (!allowed.has(token) && text.includes(token))
      fail(`${label} contains forbidden token ${token}`);
  }
}

function allowedReactRendererTokens(uiMode, entry) {
  return uiMode === "react" && entry.startsWith("src-electron/renderer/")
    ? ["buzz://", "__TAURI_INTERNALS__"]
    : [];
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

function readDirectoryEntries(directory, packageRoot) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    fail(`unable to read package directory ${directory}`);
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      assertContainedPath(
        packageRoot,
        path.join(directory, entry.name),
        `package entry ${entry.name}`,
      );
    }
  }
  return entries;
}

function assertContainedPath(packageRoot, candidate, label) {
  let rootRealPath;
  try {
    rootRealPath = realpathSync(packageRoot);
  } catch {
    fail(`package root is not readable: ${packageRoot}`);
  }

  let candidateRealPath;
  try {
    candidateRealPath = realpathSync(candidate);
  } catch {
    fail(`${label} is missing or unreadable: ${candidate}`);
  }

  const relativePath = path.relative(rootRealPath, candidateRealPath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    fail(`${label} escapes package root`);
  }
  return candidateRealPath;
}

export function assertContainedRegularFile(packageRoot, candidate, label) {
  const candidateRealPath = assertContainedPath(packageRoot, candidate, label);

  let info;
  try {
    info = lstatSync(candidateRealPath);
  } catch {
    fail(`${label} is missing or unreadable: ${candidate}`);
  }
  if (!info.isFile()) {
    fail(`${label} is not a regular file: ${candidate}`);
  }
  return { path: candidateRealPath, info };
}

function findApps(packageRoot) {
  const results = [];
  const visit = (directory) => {
    for (const entry of readDirectoryEntries(directory, packageRoot)) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.name.endsWith(".app") && entry.isDirectory()) {
        results.push(absolute);
        continue;
      }
      if (entry.isDirectory() && !entry.name.includes("node_modules"))
        visit(absolute);
    }
  };
  visit(packageRoot);
  return results;
}

export function inspectAsarEntries(archivePath) {
  const entryByCanonicalPath = canonicalizeAsarEntries(
    listPackage(archivePath),
  );
  const entries = [...entryByCanonicalPath.keys()];
  const rawEntry = (entry) => entryByCanonicalPath.get(entry) ?? entry;
  // Keep the archive library's native separator for lookup. Canonical slash
  // normalization is only for validation and collision detection.
  const lookupEntry = (entry) => rawEntry(entry).replace(/^[/\\]/, "");
  const extractEntry = (entry) => extractFile(archivePath, lookupEntry(entry));
  const metadataByEntry = new Map();
  for (const entry of entries) {
    const metadata = statFile(archivePath, lookupEntry(entry), false);
    if (!metadata || typeof metadata !== "object") {
      fail(`ASAR entry has invalid metadata: ${entry}`);
    }
    if ("link" in metadata) {
      fail(`ASAR link metadata is not permitted: ${entry}`);
    }
    metadataByEntry.set(entry, metadata);
  }
  const fileEntries = entries.filter(
    (entry) => !("files" in metadataByEntry.get(entry)),
  );
  return {
    entryByCanonicalPath,
    entries,
    extractEntry,
    fileEntries,
    lookupEntry,
    metadataByEntry,
  };
}

function checkAsar(archivePath, flavor, target, uiMode) {
  const expected = packageFlavors[flavor];
  const expectedRendererEntry =
    uiMode === "react"
      ? "src-electron/renderer/index.html"
      : "src-electron/feasibility/index.html";
  const requiredPackageFiles = new Set([
    "package.json",
    "electron-stage0-manifest.json",
    "src-electron/main.mjs",
    "src-electron/preload.cjs",
    "src-electron/stage0-flavor.mjs",
    "src-electron/host-protocol.mjs",
    "src-electron/native-host.mjs",
    "src-electron/identity-protocol.mjs",
    "src-electron/identity-launch.mjs",
    "src-electron/renderer-host.mjs",
    "src-electron/stage0-renderer.mjs",
    "src-electron/ipc-security.mjs",
    "src-electron/stage0-platform.mjs",
    expectedRendererEntry,
  ]);
  if (uiMode === "feasibility") {
    requiredPackageFiles.add("src-electron/feasibility/renderer.mjs");
  }
  if (expected.instrumentation) {
    requiredPackageFiles.add("src-electron/test-subframe-preload.cjs");
  }
  const { entries, extractEntry, fileEntries, metadataByEntry } =
    inspectAsarEntries(archivePath);
  const entrySet = new Set(entries);
  for (const required of requiredPackageFiles) {
    if (!entrySet.has(required)) fail(`ASAR is missing ${required}`);
    const metadata = metadataByEntry.get(required);
    if (!metadata || "files" in metadata || "link" in metadata) {
      fail(`ASAR required entry is not a regular file: ${required}`);
    }
  }
  for (const entry of fileEntries) {
    if (!isApprovedAsarFileEntry(entry, uiMode)) {
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
  if (packageJson.stage0UiMode !== uiMode) {
    fail(`ASAR UI mode is ${packageJson.stage0UiMode ?? "missing"}`);
  }
  if (packageJson.stage0RendererEntry !== expectedRendererEntry) {
    fail(
      `ASAR renderer entry is ${packageJson.stage0RendererEntry ?? "missing"}`,
    );
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
  const rendererSource = extractEntry(
    "src-electron/stage0-renderer.mjs",
  ).toString("utf8");
  if (
    !rendererSource.includes(`STAGE0_UI_MODE = "${uiMode}"`) ||
    !rendererSource.includes(
      `STAGE0_RENDERER_ENTRY = "${uiMode === "react" ? "renderer/index.html" : "feasibility/index.html"}"`,
    )
  ) {
    fail("staged renderer mode disagrees with package metadata");
  }
  const rendererHtml = extractEntry(expectedRendererEntry).toString("utf8");
  if (uiMode === "react") {
    if (!rendererHtml.includes('<div id="root"></div>')) {
      fail("React renderer entry is missing the root mount");
    }
    if (
      rendererHtml.includes("src/main.tsx") ||
      rendererHtml.includes("feasibility/index.html") ||
      rendererHtml.includes('src="/src/')
    ) {
      fail(
        "React renderer entry still references a development/feasibility asset",
      );
    }
    if (entrySet.has("src-electron/feasibility/index.html")) {
      fail("React ASAR contains the feasibility renderer");
    }
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
        allowedReactRendererTokens(uiMode, entry),
      );
    }
    if (entrySet.has("src-electron/test-subframe-preload.cjs")) {
      fail("normal ASAR contains the instrumented subframe preload");
    }
  }
  for (const entry of fileEntries) {
    const text = extractEntry(entry).toString("utf8");
    if (uiMode === "react" && entry.startsWith("src-electron/renderer/")) {
      scanText(
        `React ASAR:${entry}`,
        text,
        reactRendererForbiddenTokens,
        allowedReactRendererTokens(uiMode, entry),
      );
    } else {
      scanText(`ASAR:${entry}`, text);
    }
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
    for (const entry of readDirectoryEntries(directory, packageRoot)) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.includes("node_modules")) visit(absolute);
      } else if (entry.isFile() && entry.name === expectedExecutable) {
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

export function findLinuxApp(packageRoot, appName) {
  const matches = [];
  const visit = (directory) => {
    for (const entry of readDirectoryEntries(directory, packageRoot)) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.includes("node_modules")) visit(absolute);
      } else if (entry.isFile() && entry.name === appName) {
        matches.push({
          appRoot: path.dirname(absolute),
          appExecutable: absolute,
        });
      }
    }
  };
  visit(packageRoot);
  if (matches.length !== 1) {
    fail(`expected one Linux app executable, found ${matches.length}`);
  }
  return matches[0];
}

function findExecutableFiles(directory) {
  const matches = [];
  const visit = (current) => {
    for (const entry of readDirectoryEntries(current, directory)) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.includes("node_modules")) visit(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".exe")) {
        matches.push(absolute);
      }
    }
  };
  visit(directory);
  return matches;
}

function checkMacBundle(bundleRoot, flavor, target, uiMode) {
  const expected = packageFlavors[flavor];
  const apps = findApps(bundleRoot);
  if (apps.length !== 1) fail(`expected one app bundle, found ${apps.length}`);
  const appRoot = apps[0];
  const resources = path.join(appRoot, "Contents", "Resources");
  const archive = path.join(resources, "app.asar");
  const helper = path.join(resources, target.helperName);
  const archiveInfo = assertContainedRegularFile(
    bundleRoot,
    archive,
    "Contents/Resources/app.asar",
  );
  const helperInfo = assertContainedRegularFile(
    bundleRoot,
    helper,
    "native helper",
  );
  if ((helperInfo.info.mode & 0o111) === 0) {
    fail("native helper is not an executable regular file");
  }
  const appExecutable = path.join(
    appRoot,
    "Contents",
    "MacOS",
    expected.appName,
  );
  const appExecutableInfo = assertContainedRegularFile(
    bundleRoot,
    appExecutable,
    "packaged Electron executable",
  );
  const infoPlistInfo = assertContainedRegularFile(
    bundleRoot,
    path.join(appRoot, "Contents", "Info.plist"),
    "Info.plist",
  );
  checkAsar(archiveInfo.path, flavor, target, uiMode);
  const infoPlist = readFileSync(infoPlistInfo.path, "utf8");
  scanText("bundle metadata", infoPlist);
  if (!infoPlist.includes(expected.bundleId)) {
    fail(`bundle metadata does not include ${expected.bundleId}`);
  }
  return {
    appRoot,
    archive: archiveInfo.path,
    helper: helperInfo.path,
    appExecutable: appExecutableInfo.path,
  };
}

function checkWindowsBundle(bundleRoot, flavor, target, uiMode) {
  const { appRoot, appExecutable } = findWindowsApp(
    bundleRoot,
    target.executableName,
  );
  const resources = path.join(appRoot, "resources");
  const archive = path.join(resources, "app.asar");
  const helper = path.join(resources, target.helperName);
  const archiveInfo = assertContainedRegularFile(
    bundleRoot,
    archive,
    "resources/app.asar",
  );
  const helperInfo = assertContainedRegularFile(
    bundleRoot,
    helper,
    target.helperName,
  );
  const appExecutableInfo = assertContainedRegularFile(
    bundleRoot,
    appExecutable,
    "packaged Electron executable",
  );
  for (const executable of [appExecutableInfo.path, helperInfo.path]) {
    if (readPeMachine(executable) !== 0x8664) {
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
  checkAsar(archiveInfo.path, flavor, target, uiMode);
  return {
    appRoot,
    archive: archiveInfo.path,
    helper: helperInfo.path,
    appExecutable: appExecutableInfo.path,
  };
}

export function readElfMachine(filePath) {
  const descriptor = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(20);
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) {
      return null;
    }
    if (
      header[0] !== 0x7f ||
      header[1] !== 0x45 ||
      header[2] !== 0x4c ||
      header[3] !== 0x46 ||
      header[4] !== 2 ||
      header[5] !== 1
    ) {
      return null;
    }
    return header.readUInt16LE(18);
  } finally {
    closeSync(descriptor);
  }
}

function checkLinuxBundle(bundleRoot, flavor, target, uiMode) {
  const expected = packageFlavors[flavor];
  const { appRoot, appExecutable } = findLinuxApp(bundleRoot, expected.appName);
  const resources = path.join(appRoot, "resources");
  const archive = path.join(resources, "app.asar");
  const helper = path.join(resources, target.helperName);
  const chromeSandbox = path.join(appRoot, "chrome-sandbox");
  const archiveInfo = assertContainedRegularFile(
    bundleRoot,
    archive,
    "resources/app.asar",
  );
  const helperInfo = assertContainedRegularFile(
    bundleRoot,
    helper,
    target.helperName,
  );
  const appExecutableInfo = assertContainedRegularFile(
    bundleRoot,
    appExecutable,
    "packaged Electron executable",
  );
  for (const [executable, info] of [
    [appExecutableInfo.path, appExecutableInfo.info],
    [helperInfo.path, helperInfo.info],
  ]) {
    if ((info.mode & 0o111) === 0) {
      fail(`Linux x64 executable permission check failed for ${executable}`);
    }
    if (readElfMachine(executable) !== 0x3e) {
      fail(`Linux x86_64 ELF check failed for ${executable}`);
    }
  }
  const sandboxInfo = assertContainedRegularFile(
    bundleRoot,
    chromeSandbox,
    "Electron chrome-sandbox helper",
  );
  if (
    sandboxInfo.info.uid !== 0 ||
    (sandboxInfo.info.mode & 0o7777) !== 0o4755
  ) {
    fail("Electron chrome-sandbox must be root-owned with mode 4755");
  }
  if (readElfMachine(sandboxInfo.path) !== 0x3e) {
    fail("Electron chrome-sandbox is not an x86_64 ELF");
  }
  checkAsar(archiveInfo.path, flavor, target, uiMode);
  return {
    appRoot,
    archive: archiveInfo.path,
    helper: helperInfo.path,
    appExecutable: appExecutableInfo.path,
    chromeSandbox: sandboxInfo.path,
  };
}

function checkBundle(bundleRoot, flavor, target, uiMode) {
  if (target.bundleKind === "app") {
    return checkMacBundle(bundleRoot, flavor, target, uiMode);
  }
  if (target.bundleKind === "directory") {
    if (target.platform === "win32") {
      return checkWindowsBundle(bundleRoot, flavor, target, uiMode);
    }
    if (target.platform === "linux") {
      return checkLinuxBundle(bundleRoot, flavor, target, uiMode);
    }
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
  const uiArgument = process.argv.find((value) => value.startsWith("--ui="));
  const uiMode = uiArgument?.slice("--ui=".length) ?? "feasibility";
  if (uiMode !== "feasibility" && uiMode !== "react") {
    fail(`unsupported UI mode ${uiMode}`);
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
  const result = checkBundle(packageRoot, flavor, target, uiMode);
  console.log(
    JSON.stringify({
      electron_stage0_package_guard: "passed",
      platform: target.platform,
      arch: target.arch,
      targetTriple: target.targetTriple,
      uiMode,
      app: result.appRoot,
      appExecutable: result.appExecutable ?? null,
      asar: result.archive,
      helper: result.helper,
    }),
  );
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
