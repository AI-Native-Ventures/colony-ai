import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "vite";
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
// Vite/Rolldown's content-addressed chunk graph is tied to this output path.
// Keep the reviewed path and remove it before every sequential flavor build.
const rendererBuildDirectory = path.join(desktopDirectory, ".stage0-ui-dist");
const appName =
  target.executableName ??
  (flavor === "normal" ? "Buzz Stage0 Normal" : "Buzz Stage0 Instrumented");
const appId =
  flavor === "normal"
    ? "xyz.ainative.ventures.colony.stage0.normal"
    : "xyz.ainative.ventures.colony.stage0.instrumented";
const reactViteMode = "production";

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

async function installedPackageVersion(packageName) {
  let directory = path.dirname(fileURLToPath(import.meta.resolve(packageName)));
  while (true) {
    try {
      const packageJson = JSON.parse(
        await readFile(path.join(directory, "package.json"), "utf8"),
      );
      if (packageJson.name === packageName) return packageJson.version;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) {
      throw new Error(`could not find package.json for ${packageName}`);
    }
    directory = parentDirectory;
  }
}

function prefixedEnvironmentValues(environment, prefix) {
  return Object.fromEntries(
    Object.entries(environment)
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function emitReactViteInputDiagnostics(outDirectory) {
  try {
    const modeEnv = loadEnv(reactViteMode, desktopDirectory, "");
    const protectedFeaturesEnabled =
      (process.env.VITE_BUZZ_BESTIE ?? modeEnv.VITE_BUZZ_BESTIE) === "1";
    const version = async (packageName) => {
      try {
        return await installedPackageVersion(packageName);
      } catch (error) {
        return `unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    const [viteVersion, reactPluginVersion, routerPluginVersion] =
      await Promise.all([
        version("vite"),
        version("@vitejs/plugin-react"),
        version("@tanstack/router-plugin"),
      ]);
    process.stderr.write(
      `React Vite inputs: ${JSON.stringify({
        command: "build",
        mode: reactViteMode,
        node: process.version,
        NODE_ENV: process.env.NODE_ENV ?? null,
        versions: {
          vite: viteVersion,
          reactPlugin: reactPluginVersion,
          routerPlugin: routerPluginVersion,
        },
        processEnv: {
          ...prefixedEnvironmentValues(process.env, "VITE_"),
          CI: process.env.CI ?? null,
          TAURI_DEV_HOST: process.env.TAURI_DEV_HOST ?? null,
        },
        loadEnv: prefixedEnvironmentValues(modeEnv, "VITE_"),
        protectedFeaturesEnabled,
        base: "./",
        outDirectory,
      })}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`React Vite inputs unavailable: ${message}\n`);
  }
}

function writeReactBuildInputDiagnostic(message) {
  try {
    process.stderr.write(`${message}\n`);
  } catch {
    // Diagnostics must never affect the packaging result.
  }
}

async function collectReactBuildInputFiles() {
  const files = [];
  const visit = async (directory, relativeDirectory) => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath });
      }
    }
  };

  await visit(path.join(desktopDirectory, "src"), "src");
  const topLevelEntries = await readdir(desktopDirectory, {
    withFileTypes: true,
  });
  for (const entry of topLevelEntries) {
    if (
      entry.isFile() &&
      (entry.name === "index.html" ||
        entry.name.startsWith("vite.config.") ||
        entry.name.startsWith("tsconfig"))
    ) {
      files.push({
        absolutePath: path.join(desktopDirectory, entry.name),
        relativePath: entry.name,
      });
    }
  }
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

async function emitReactBuildInputFingerprints() {
  try {
    const inputFiles = await collectReactBuildInputFiles();
    const sourceHash = createHash("sha256");
    for (const file of inputFiles) {
      sourceHash.update(file.relativePath);
      sourceHash.update("\0");
      sourceHash.update(await readFile(file.absolutePath));
      sourceHash.update("\0");
    }

    const lockfilePath = path.resolve(desktopDirectory, "..", "pnpm-lock.yaml");
    const lockfileHash = createHash("sha256")
      .update(await readFile(lockfilePath))
      .digest("hex");
    const pnpmDirectory = path.join(desktopDirectory, "node_modules", ".pnpm");
    const pnpmEntryCount = (
      await readdir(pnpmDirectory, { withFileTypes: true })
    ).length;
    const dependencyStateHash = createHash("sha256")
      .update(lockfileHash)
      .update("\0")
      .update(String(pnpmEntryCount))
      .digest("hex");

    writeReactBuildInputDiagnostic(
      `React build input fingerprints: ${JSON.stringify({
        sourceTreeSha256: sourceHash.digest("hex"),
        sourceFileCount: inputFiles.length,
        dependencyStateSha256: dependencyStateHash,
        pnpmLockSha256: lockfileHash,
        pnpmEntryCount,
      })}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeReactBuildInputDiagnostic(
      `React build input fingerprints unavailable: ${message}`,
    );
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

// Temporary evidence: inventory the renderer output before staging so a
// duplicate can be attributed to Vite output or to the staging copy.
async function emitReactRendererBuildInventory(directory) {
  const files = [];
  const visit = async (currentDirectory) => {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath);
      } else if (entry.isFile()) {
        files.push(
          path.relative(directory, filePath).split(path.sep).join("/"),
        );
      }
    }
  };
  await visit(directory);
  files.sort();
  process.stderr.write(
    `React renderer output before staging: directory=${directory} file_count=${files.length}\n${files.map((file) => `    ${file}`).join("\n")}\n`,
  );
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
    await emitReactViteInputDiagnostics(rendererBuildDirectory);
    await emitReactBuildInputFingerprints();
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
    await emitReactRendererBuildInventory(rendererBuildDirectory);
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
