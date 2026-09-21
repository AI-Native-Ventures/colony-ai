import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getStage0TargetFromArguments } from "../src-electron/stage0-platform.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptDirectory, "..");

const flavors = new Set(["normal", "instrumented"]);
const uiModes = new Set(["feasibility", "react"]);

function readFlavor() {
  const argument = process.argv.find((value) => value.startsWith("--flavor="));
  const flavor = argument?.slice("--flavor=".length) ?? "normal";
  if (!flavors.has(flavor)) {
    throw new Error(`unsupported stage0 flavor: ${flavor}`);
  }
  return flavor;
}

function readUiMode() {
  const argument = process.argv.find((value) => value.startsWith("--ui="));
  const uiMode = argument?.slice("--ui=".length) ?? "feasibility";
  if (!uiModes.has(uiMode)) {
    throw new Error(`unsupported stage0 UI mode: ${uiMode}`);
  }
  return uiMode;
}

async function assertRegularFile(filePath, label) {
  const info = await lstat(filePath).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`${label} is missing or not a regular file: ${filePath}`);
  }
  return info;
}

async function copyEntry(packageDirectory, sourceRelative, targetRelative) {
  const source = path.join(desktopDirectory, sourceRelative);
  await assertRegularFile(source, sourceRelative);
  const target = path.join(packageDirectory, targetRelative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyTree(sourceDirectory, packageDirectory, targetDirectory) {
  const sourceInfo = await lstat(sourceDirectory).catch(() => null);
  if (!sourceInfo?.isDirectory()) {
    throw new Error(
      `renderer build is missing or not a directory: ${sourceDirectory}`,
    );
  }
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceDirectory, entry.name);
    const target = path.join(packageDirectory, targetDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`renderer build contains a symbolic link: ${source}`);
    }
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true });
      await copyTree(
        source,
        packageDirectory,
        path.join(targetDirectory, entry.name),
      );
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `renderer build contains an unsupported entry: ${source}`,
      );
    }
    await copyFile(source, target);
  }
}

async function main() {
  const flavor = readFlavor();
  const uiMode = readUiMode();
  const target = getStage0TargetFromArguments();
  const helperName = target.helperName;
  const helperInput = process.env.COLONY_NATIVE_HOST_BIN
    ? path.resolve(process.env.COLONY_NATIVE_HOST_BIN)
    : path.join(
        desktopDirectory,
        "src-native-host",
        "target",
        target.targetTriple,
        "release",
        helperName,
      );
  const flavorModule = await import(
    new URL(`../src-electron/stage0-flavor.${flavor}.mjs`, import.meta.url)
  );
  const packageDirectory = path.join(
    desktopDirectory,
    `.stage0-package-${flavor}`,
  );
  const resourceDirectory = path.join(
    desktopDirectory,
    `.stage0-package-resources-${flavor}`,
  );
  const rendererBuildDirectory = path.join(desktopDirectory, ".stage0-ui-dist");
  const rendererSource =
    uiMode === "react"
      ? "src-electron/stage0-renderer.react.mjs"
      : "src-electron/stage0-renderer.feasibility.mjs";
  const files = [
    ["electron-stage0-manifest.json", "electron-stage0-manifest.json"],
    ["src-electron/main.mjs", "src-electron/main.mjs"],
    ["src-electron/preload.cjs", "src-electron/preload.cjs"],
    [
      `src-electron/stage0-flavor.${flavor}.mjs`,
      "src-electron/stage0-flavor.mjs",
    ],
    ...(flavor === "instrumented"
      ? [
          [
            "src-electron/test-subframe-preload.cjs",
            "src-electron/test-subframe-preload.cjs",
          ],
        ]
      : []),
    ["src-electron/host-protocol.mjs", "src-electron/host-protocol.mjs"],
    ["src-electron/native-host.mjs", "src-electron/native-host.mjs"],
    [
      "src-electron/identity-protocol.mjs",
      "src-electron/identity-protocol.mjs",
    ],
    ["src-electron/identity-launch.mjs", "src-electron/identity-launch.mjs"],
    ["src-electron/renderer-host.mjs", "src-electron/renderer-host.mjs"],
    [rendererSource, "src-electron/stage0-renderer.mjs"],
    ["src-electron/stage0-platform.mjs", "src-electron/stage0-platform.mjs"],
    ["src-electron/ipc-security.mjs", "src-electron/ipc-security.mjs"],
    ...(uiMode === "feasibility"
      ? [
          [
            "src-electron/feasibility/index.html",
            "src-electron/feasibility/index.html",
          ],
          [
            "src-electron/feasibility/renderer.mjs",
            "src-electron/feasibility/renderer.mjs",
          ],
        ]
      : []),
  ];
  const helperInfo = await assertRegularFile(helperInput, "native host");
  if (target.platform !== "win32" && (helperInfo.mode & 0o111) === 0) {
    throw new Error(`native host is not executable: ${helperInput}`);
  }
  if (
    target.platform === "win32" &&
    !helperInput.toLowerCase().endsWith(".exe")
  ) {
    throw new Error(`Windows native host must be an .exe: ${helperInput}`);
  }

  await rm(packageDirectory, { recursive: true, force: true });
  await rm(resourceDirectory, { recursive: true, force: true });
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(resourceDirectory, { recursive: true });

  for (const [source, target] of files) {
    await copyEntry(packageDirectory, source, target);
  }
  if (uiMode === "react") {
    await copyTree(
      rendererBuildDirectory,
      packageDirectory,
      "src-electron/renderer",
    );
  }

  const packageJson = {
    name: flavorModule.STAGE0_PACKAGE_NAME,
    version: "0.0.0-stage0",
    private: true,
    type: "module",
    main: "src-electron/main.mjs",
    stage0Flavor: flavorModule.STAGE0_BUILD_FLAVOR,
    stage0ApplicationId: flavorModule.STAGE0_APP_ID,
    stage0UserDataSuffix: flavorModule.STAGE0_USER_DATA_SUFFIX,
    stage0SourceRevision: "ef2aa1ae38fadcc0bc22b8bf6ed96b35933146be",
    stage0Instrumentation: flavorModule.STAGE0_INSTRUMENTATION_ENABLED,
    stage0Platform: target.platform,
    stage0Arch: target.arch,
    stage0TargetTriple: target.targetTriple,
    stage0HelperName: target.helperName,
    stage0UiMode: uiMode,
    stage0RendererEntry:
      uiMode === "react"
        ? "src-electron/renderer/index.html"
        : "src-electron/feasibility/index.html",
  };
  await writeFile(
    path.join(packageDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  const helperOutput = path.join(resourceDirectory, helperName);
  await copyFile(helperInput, helperOutput);
  await chmod(helperOutput, 0o755);

  process.stdout.write(
    `${JSON.stringify({
      appDirectory: packageDirectory,
      helperPath: helperOutput,
      flavor,
      platform: target.platform,
      arch: target.arch,
      targetTriple: target.targetTriple,
      packageName: flavorModule.STAGE0_PACKAGE_NAME,
      uiMode,
      files: files.map(([, target]) => target).concat("package.json"),
    })}\n`,
  );
}

main().catch((error) => {
  console.error(`electron stage0 staging failed: ${error.message}`);
  process.exitCode = 1;
});
