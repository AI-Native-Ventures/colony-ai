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
const sourceFiles = [
  "electron-stage0-manifest.json",
  "src-electron/main.mjs",
  "src-electron/preload.cjs",
  "src-electron/host-protocol.mjs",
  "src-electron/native-host.mjs",
  "src-electron/renderer-host.mjs",
  "src-electron/ipc-security.mjs",
  "src-electron/feasibility/index.html",
  "src-electron/feasibility/renderer.mjs",
];
const requiredPackageFiles = new Set([
  "package.json",
  "electron-stage0-manifest.json",
  "src-electron/main.mjs",
  "src-electron/preload.cjs",
  "src-electron/host-protocol.mjs",
  "src-electron/native-host.mjs",
  "src-electron/renderer-host.mjs",
  "src-electron/ipc-security.mjs",
  "src-electron/feasibility/index.html",
  "src-electron/feasibility/renderer.mjs",
]);

function fail(message) {
  throw new Error(`electron stage0 check failed: ${message}`);
}

function scanText(label, text) {
  for (const token of forbiddenTokens) {
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

function checkAsar(archivePath) {
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
  if (packageJson.main !== "src-electron/main.mjs") {
    fail(`ASAR entry point is ${packageJson.main ?? "missing"}`);
  }
  if (packageJson.name !== "colony-stage0") {
    fail(`ASAR package name is ${packageJson.name ?? "missing"}`);
  }
  for (const entry of fileEntries) {
    scanText(`ASAR:${entry}`, extractFile(archivePath, entry).toString("utf8"));
  }
}

function checkBundle(bundleRoot) {
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
  checkAsar(archive);
  const appExecutable = path.join(appRoot, "Contents", "MacOS", "Buzz Stage0");
  if (!existsSync(appExecutable)) fail("missing packaged Electron executable");
  scanText(
    "bundle metadata",
    readFileSync(path.join(appRoot, "Contents", "Info.plist"), "utf8"),
  );
  return { appRoot, archive, helper };
}

function main() {
  const packageArgument = process.argv[2];
  scanSource();
  if (!packageArgument) {
    console.log("electron_stage0_source_guard=passed");
    return;
  }
  const packageRoot = path.resolve(packageArgument);
  if (!existsSync(packageRoot))
    fail(`package path does not exist: ${packageRoot}`);
  const result = checkBundle(packageRoot);
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
