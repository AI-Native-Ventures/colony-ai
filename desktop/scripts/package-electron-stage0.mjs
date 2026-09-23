import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectAsarEntries,
  observedReactPackageAsarDigests,
} from "./check-electron-stage0.mjs";
import { getStage0TargetFromArguments } from "../src-electron/stage0-platform.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptDirectory, "..");
const flavor =
  process.argv
    .find((value) => value.startsWith("--flavor="))
    ?.slice("--flavor=".length) ?? "normal";
if (flavor !== "normal" && flavor !== "instrumented") {
  throw new Error(`unsupported Stage 0 flavor: ${flavor}`);
}
const uiMode =
  process.argv
    .find((value) => value.startsWith("--ui="))
    ?.slice("--ui=".length) ?? "feasibility";
if (uiMode !== "feasibility" && uiMode !== "react") {
  throw new Error(`unsupported Stage 0 UI mode: ${uiMode}`);
}

const target = getStage0TargetFromArguments();
const packageDirectory = path.join(
  desktopDirectory,
  `.stage0-package-${flavor}`,
);
const resourceDirectory = path.join(
  desktopDirectory,
  `.stage0-package-resources-${flavor}`,
);
const outputDirectory = path.join(desktopDirectory, `dist-electron-${flavor}`);
const rendererBuildDirectory = path.join(desktopDirectory, ".stage0-ui-dist");
const appName =
  target.executableName ??
  (flavor === "normal" ? "Buzz Stage0 Normal" : "Buzz Stage0 Instrumented");
const appId =
  flavor === "normal"
    ? "xyz.ainative.ventures.colony.stage0.normal"
    : "xyz.ainative.ventures.colony.stage0.instrumented";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDirectory,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(`${path.basename(command)} exited with ${result.status}`);
  }
}

async function emitReactPackageDigestDiagnostics(archivePath) {
  const expected = observedReactPackageAsarDigests[flavor];
  if (!expected) return;

  try {
    const actual = createHash("sha256")
      .update(await readFile(archivePath))
      .digest("hex");
    if (actual === expected) return;

    const { fileEntries, extractEntry } = inspectAsarEntries(archivePath);
    const entries = fileEntries.sort().map((entry) => {
      const digest = createHash("sha256")
        .update(extractEntry(entry))
        .digest("hex");
      return `    ${entry}: ${digest}`;
    });
    process.stderr.write(
      `React app.asar entry digests (expected archive ${expected}, actual ${actual}):\n${entries.join("\n")}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `React app.asar entry digests unavailable after archive mismatch: ${message}\n`,
    );
  }
}

// Temporary evidence: keep the complete React archive manifest on pass and fail
// while we isolate the reviewed-digest mismatch; remove it after that question is closed.
async function emitReactPackageEntryManifest(archivePath) {
  try {
    const actual = createHash("sha256")
      .update(await readFile(archivePath))
      .digest("hex");
    const { fileEntries, extractEntry } = inspectAsarEntries(archivePath);
    const entries = fileEntries.sort().map((entry) => {
      const digest = createHash("sha256")
        .update(extractEntry(entry))
        .digest("hex");
      return `    ${entry}: ${digest}`;
    });
    process.stderr.write(
      `React app.asar entry manifest (archive ${actual}):\n${entries.join("\n")}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `React app.asar entry manifest unavailable: ${message}\n`,
    );
  }
}

const ELECTRON_PUBLIC_PATHS = Object.freeze([
  "/landing/",
  "/buzz.svg",
  "/boot.css",
]);

async function rewriteElectronPublicPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`renderer build contains a symbolic link: ${filePath}`);
    }
    if (entry.isDirectory()) {
      await rewriteElectronPublicPaths(filePath);
      continue;
    }
    if (!entry.isFile() || !/\.(?:html|js|css)$/.test(entry.name)) continue;
    const info = await lstat(filePath);
    if (!info.isFile()) {
      throw new Error(`renderer build is not a regular file: ${filePath}`);
    }
    let text = await readFile(filePath, "utf8");
    for (const publicPath of ELECTRON_PUBLIC_PATHS) {
      const relativePath = `.${publicPath}`;
      text = text
        .replaceAll(`"${publicPath}`, `"${relativePath}`)
        .replaceAll(`'${publicPath}`, `'${relativePath}`)
        .replaceAll(`(${publicPath}`, `(${relativePath}`);
    }
    await writeFile(filePath, text, "utf8");
  }
}

async function main() {
  await rm(outputDirectory, { recursive: true, force: true });
  if (uiMode === "react") {
    await rm(rendererBuildDirectory, { recursive: true, force: true });
    run(process.execPath, [
      path.join(desktopDirectory, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--base",
      "./",
      "--outDir",
      rendererBuildDirectory,
    ]);
    await rewriteElectronPublicPaths(rendererBuildDirectory);
  }
  run(process.execPath, [
    path.join(desktopDirectory, "scripts", "stage-electron-stage0.mjs"),
    `--flavor=${flavor}`,
    `--platform=${target.platform}`,
    `--arch=${target.arch}`,
    `--target=${target.targetTriple}`,
    `--ui=${uiMode}`,
  ]);

  const packagerScript = path.join(
    desktopDirectory,
    "node_modules",
    "@electron",
    "packager",
    "bin",
    "electron-packager.mjs",
  );
  run(process.execPath, [
    packagerScript,
    packageDirectory,
    appName,
    `--platform=${target.platform}`,
    `--arch=${target.arch}`,
    `--out=${outputDirectory}`,
    "--overwrite",
    "--asar",
    `--app-bundle-id=${appId}`,
    `--extra-resource=${path.join(resourceDirectory, target.helperName)}`,
  ]);

  if (uiMode === "react") {
    const packagedAppDirectory = path.join(
      outputDirectory,
      `${appName}-${target.packageSuffix}`,
    );
    const archivePath =
      target.bundleKind === "app"
        ? path.join(
            packagedAppDirectory,
            `${appName}.app`,
            "Contents",
            "Resources",
            "app.asar",
          )
        : path.join(packagedAppDirectory, "resources", "app.asar");
    await emitReactPackageDigestDiagnostics(archivePath);
    await emitReactPackageEntryManifest(archivePath);
  }
}

main().catch((error) => {
  console.error(`electron Stage 0 packaging failed: ${error.message}`);
  process.exitCode ||= 1;
});
