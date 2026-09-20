import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function main() {
  await rm(outputDirectory, { recursive: true, force: true });
  run(process.execPath, [
    path.join(desktopDirectory, "scripts", "stage-electron-stage0.mjs"),
    `--flavor=${flavor}`,
    `--platform=${target.platform}`,
    `--arch=${target.arch}`,
    `--target=${target.targetTriple}`,
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
}

main().catch((error) => {
  console.error(`electron Stage 0 packaging failed: ${error.message}`);
  process.exitCode ||= 1;
});
