import { chmod, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopDirectory = path.resolve(scriptDirectory, "..");
const packageDirectory = path.join(desktopDirectory, ".stage0-package");
const resourceDirectory = path.join(
  desktopDirectory,
  ".stage0-package-resources",
);
const helperName = "colony-native-host";
const helperInput = process.env.COLONY_NATIVE_HOST_BIN
  ? path.resolve(process.env.COLONY_NATIVE_HOST_BIN)
  : path.join(
      desktopDirectory,
      "src-native-host",
      "target",
      "aarch64-apple-darwin",
      "release",
      helperName,
    );

const files = [
  ["electron-stage0-manifest.json", "electron-stage0-manifest.json"],
  ["src-electron/main.mjs", "src-electron/main.mjs"],
  ["src-electron/preload.cjs", "src-electron/preload.cjs"],
  ["src-electron/host-protocol.mjs", "src-electron/host-protocol.mjs"],
  ["src-electron/native-host.mjs", "src-electron/native-host.mjs"],
  ["src-electron/renderer-host.mjs", "src-electron/renderer-host.mjs"],
  ["src-electron/ipc-security.mjs", "src-electron/ipc-security.mjs"],
  [
    "src-electron/feasibility/index.html",
    "src-electron/feasibility/index.html",
  ],
  [
    "src-electron/feasibility/renderer.mjs",
    "src-electron/feasibility/renderer.mjs",
  ],
];

async function assertRegularFile(filePath, label) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) {
    throw new Error(`${label} is missing or not a regular file: ${filePath}`);
  }
  return info;
}

async function copyEntry(sourceRelative, targetRelative) {
  const source = path.join(desktopDirectory, sourceRelative);
  await assertRegularFile(source, sourceRelative);
  const target = path.join(packageDirectory, targetRelative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function main() {
  const helperInfo = await assertRegularFile(helperInput, "native host");
  if ((helperInfo.mode & 0o111) === 0) {
    throw new Error(`native host is not executable: ${helperInput}`);
  }

  await rm(packageDirectory, { recursive: true, force: true });
  await rm(resourceDirectory, { recursive: true, force: true });
  await mkdir(packageDirectory, { recursive: true });
  await mkdir(resourceDirectory, { recursive: true });

  for (const [source, target] of files) {
    await copyEntry(source, target);
  }

  const packageJson = {
    name: "colony-stage0",
    version: "0.0.0-stage0",
    private: true,
    type: "module",
    main: "src-electron/main.mjs",
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
      files: files.map(([, target]) => target).concat("package.json"),
    })}\n`,
  );
}

main().catch((error) => {
  console.error(`electron stage0 staging failed: ${error.message}`);
  process.exitCode = 1;
});
