import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type Stage0Flavor = "normal" | "instrumented";

type Stage0PackagePaths = {
  packageRoot: string;
  appRoot: string;
  appBinary: string;
  hostResource: string;
  platform: "darwin" | "win32";
  arch: "arm64" | "x64";
  targetTriple: string;
  helperName: string;
};

function visitDirectories(root: string, callback: (directory: string) => void) {
  if (!fs.existsSync(root)) return;
  callback(root);
  for (const entry of fs.readdirSync(root)) {
    const absolute = path.join(root, entry);
    if (fs.statSync(absolute).isDirectory()) {
      visitDirectories(absolute, callback);
    }
  }
}

function findSingleAppBundle(root: string, expectedName: string) {
  const candidates: string[] = [];
  visitDirectories(root, (directory) => {
    if (path.basename(directory) === expectedName) candidates.push(directory);
  });
  assert.equal(
    candidates.length,
    1,
    `expected one packaged app bundle, found ${candidates.length}`,
  );
  return candidates[0];
}

function findSingleWindowsExecutable(root: string, expectedName: string) {
  const candidates: string[] = [];
  visitDirectories(root, (directory) => {
    const executable = path.join(directory, expectedName);
    if (fs.existsSync(executable) && fs.statSync(executable).isFile()) {
      candidates.push(executable);
    }
  });
  assert.equal(
    candidates.length,
    1,
    `expected one packaged Windows executable, found ${candidates.length}`,
  );
  return candidates[0];
}

export function getStage0PackagePaths(
  flavor: Stage0Flavor,
): Stage0PackagePaths {
  const appName =
    flavor === "normal" ? "Buzz Stage0 Normal" : "Buzz Stage0 Instrumented";
  const packageRoot = path.resolve(
    process.env[
      flavor === "normal"
        ? "COLONY_STAGE0_NORMAL_ROOT"
        : "COLONY_STAGE0_INSTRUMENTED_ROOT"
    ] ?? path.join(desktopDirectory, `dist-electron-${flavor}`),
  );
  if (process.platform === "darwin" && process.arch === "arm64") {
    const appRoot = findSingleAppBundle(packageRoot, `${appName}.app`);
    const appBinary = path.join(appRoot, "Contents", "MacOS", appName);
    const helperName = "colony-native-host";
    return {
      packageRoot,
      appRoot,
      appBinary,
      hostResource: path.join(appRoot, "Contents", "Resources", helperName),
      platform: "darwin",
      arch: "arm64",
      targetTriple: "aarch64-apple-darwin",
      helperName,
    };
  }
  if (process.platform === "win32" && process.arch === "x64") {
    const appBinary = findSingleWindowsExecutable(packageRoot, "Buzz.exe");
    const appRoot = path.dirname(appBinary);
    const helperName = "colony-native-host.exe";
    return {
      packageRoot,
      appRoot,
      appBinary,
      hostResource: path.join(appRoot, "resources", helperName),
      platform: "win32",
      arch: "x64",
      targetTriple: "x86_64-pc-windows-msvc",
      helperName,
    };
  }
  throw new Error(
    `unsupported packaged Stage 0 test host: ${process.platform}/${process.arch}`,
  );
}
