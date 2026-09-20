import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ElectronApplication } from "@playwright/test";

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
  platform: "darwin" | "win32" | "linux";
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

function findSingleLinuxExecutable(root: string, expectedName: string) {
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
    `expected one packaged Linux executable, found ${candidates.length}`,
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
  if (process.platform === "linux" && process.arch === "x64") {
    const appBinary = findSingleLinuxExecutable(packageRoot, appName);
    const appRoot = path.dirname(appBinary);
    const helperName = "colony-native-host";
    return {
      packageRoot,
      appRoot,
      appBinary,
      hostResource: path.join(appRoot, "resources", helperName),
      platform: "linux",
      arch: "x64",
      targetTriple: "x86_64-unknown-linux-gnu",
      helperName,
    };
  }
  throw new Error(
    `unsupported packaged Stage 0 test host: ${process.platform}/${process.arch}`,
  );
}

export async function assertActiveLinuxSandbox(
  application: ElectronApplication,
) {
  if (process.platform !== "linux") return;
  const renderer = await application.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.isVisible(),
    );
    if (!window) throw new Error("expected an Electron renderer window");
    const tabMetricPids = app
      .getAppMetrics()
      .filter((metric) => metric.type === "Tab")
      .map((metric) => metric.pid);
    return {
      rendererPid: window.webContents.getOSProcessId(),
      tabMetricPids,
    };
  });
  assert.ok(renderer.rendererPid > 0, "expected a renderer OS process");
  assert.ok(
    renderer.tabMetricPids.includes(renderer.rendererPid),
    `renderer PID was not identified as a Tab metric: ${JSON.stringify(renderer)}`,
  );
  const statusPath = `/proc/${renderer.rendererPid}/status`;
  assert.ok(
    fs.existsSync(statusPath),
    `missing renderer status: ${renderer.rendererPid}`,
  );
  const status = fs.readFileSync(statusPath, "utf8");
  const observation = {
    pid: renderer.rendererPid,
    uid: /^Uid:\s+(\d+)/m.exec(status)?.[1] ?? null,
    noNewPrivs: /^NoNewPrivs:\s+(\d+)/m.exec(status)?.[1] ?? null,
    seccomp: /^Seccomp:\s+(\d+)/m.exec(status)?.[1] ?? null,
    tabMetricPids: renderer.tabMetricPids,
  };
  assert.notEqual(
    observation.uid,
    "0",
    `renderer must run as non-root: ${JSON.stringify(observation)}`,
  );
  // These are process-level sandbox signals, not a claim that one status bit
  // proves every Chromium namespace/seccomp property.
  assert.ok(
    observation.noNewPrivs === "1" || observation.seccomp === "2",
    `Electron renderer sandbox signal not observed: ${JSON.stringify(observation)}`,
  );
  console.log(`linux_sandbox=active ${JSON.stringify(observation)}`);
}
