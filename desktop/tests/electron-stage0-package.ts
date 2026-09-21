import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ElectronApplication } from "@playwright/test";

import { hasRequiredLinuxSandboxIsolation } from "./electron-stage0-sandbox.mjs";

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

const linuxSandboxNamespaces = ["pid", "net", "mnt", "user"] as const;
type LinuxSandboxNamespace = (typeof linuxSandboxNamespaces)[number];

function readProcNamespace(
  pid: number,
  namespace: LinuxSandboxNamespace,
): string | null {
  try {
    return fs.readlinkSync(`/proc/${pid}/ns/${namespace}`);
  } catch {
    return null;
  }
}

function readProcRootIdentity(pid: number): string | null {
  try {
    const root = fs.statSync(`/proc/${pid}/root`);
    return `${root.dev}:${root.ino}`;
  } catch {
    return null;
  }
}

function readProcStatus(pid: number): string {
  return fs.readFileSync(`/proc/${pid}/status`, "utf8");
}

function readProcStatusField(status: string, field: string): string | null {
  return new RegExp(`^${field}:\\s+([^\\n]+)`, "m").exec(status)?.[1] ?? null;
}

function readProcParentPid(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingCommand = stat.lastIndexOf(")");
    if (closingCommand < 0) return null;
    const fields = stat
      .slice(closingCommand + 2)
      .trim()
      .split(/\s+/);
    const parentPid = Number(fields[1]);
    return Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null;
  } catch {
    return null;
  }
}

function readProcCommandName(pid: number): string | null {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() || null;
  } catch {
    return null;
  }
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
    const metrics = app
      .getAppMetrics()
      .map((metric) => ({ type: metric.type, pid: metric.pid }))
      .filter((metric) => Number.isInteger(metric.pid) && metric.pid > 0);
    return {
      mainPid: process.pid,
      rendererPid: window.webContents.getOSProcessId(),
      tabMetricPids,
      metrics,
    };
  });
  assert.ok(renderer.rendererPid > 0, "expected a renderer OS process");
  assert.ok(renderer.mainPid > 0, "expected an Electron main OS process");
  assert.notEqual(
    renderer.rendererPid,
    renderer.mainPid,
    `renderer PID must differ from Electron main: ${JSON.stringify(renderer)}`,
  );
  assert.ok(
    renderer.tabMetricPids.includes(renderer.rendererPid),
    `renderer PID was not identified as a Tab metric: ${JSON.stringify(renderer)}`,
  );
  const rendererStatus = readProcStatus(renderer.rendererPid);
  const mainStatus = readProcStatus(renderer.mainPid);
  const rendererNamespaces = Object.fromEntries(
    linuxSandboxNamespaces.map((namespace) => [
      namespace,
      readProcNamespace(renderer.rendererPid, namespace),
    ]),
  ) as Record<LinuxSandboxNamespace, string | null>;
  const mainNamespaces = Object.fromEntries(
    linuxSandboxNamespaces.map((namespace) => [
      namespace,
      readProcNamespace(renderer.mainPid, namespace),
    ]),
  ) as Record<LinuxSandboxNamespace, string | null>;
  assert.ok(
    linuxSandboxNamespaces.every(
      (namespace) =>
        rendererNamespaces[namespace] !== null &&
        mainNamespaces[namespace] !== null,
    ),
    `renderer/main namespace identities were not readable: ${JSON.stringify({ rendererNamespaces, mainNamespaces })}`,
  );
  const namespaceDifferences = linuxSandboxNamespaces.filter(
    (namespace) => rendererNamespaces[namespace] !== mainNamespaces[namespace],
  );
  const rendererRoot = readProcRootIdentity(renderer.rendererPid);
  const mainRoot = readProcRootIdentity(renderer.mainPid);
  const rootDiffers =
    rendererRoot !== null && mainRoot !== null && rendererRoot !== mainRoot;
  const rendererParentPid = readProcParentPid(renderer.rendererPid);
  const rendererParentMetric = renderer.metrics.find(
    (metric) => metric.pid === rendererParentPid,
  );
  const status = rendererStatus;
  const observation = {
    pid: renderer.rendererPid,
    mainPid: renderer.mainPid,
    uid: readProcStatusField(status, "Uid")?.split(/\s+/)[0] ?? null,
    mainUid: readProcStatusField(mainStatus, "Uid")?.split(/\s+/)[0] ?? null,
    noNewPrivs: readProcStatusField(status, "NoNewPrivs"),
    seccomp: readProcStatusField(status, "Seccomp"),
    capEff: readProcStatusField(status, "CapEff"),
    nspid: readProcStatusField(status, "NSpid"),
    parentPid: rendererParentPid,
    parentMetricType: rendererParentMetric?.type ?? null,
    parentCommand: rendererParentPid
      ? readProcCommandName(rendererParentPid)
      : null,
    tabMetricPids: renderer.tabMetricPids,
    metricTypes: renderer.metrics,
    namespaceDifferences,
    rendererNamespaces,
    mainNamespaces,
    rootDiffers,
    seccompBpf: readProcStatusField(status, "Seccomp") === "2",
  };
  assert.notEqual(
    observation.uid,
    "0",
    `renderer must run as non-root: ${JSON.stringify(observation)}`,
  );
  const layer1NamespaceIsolation = hasRequiredLinuxSandboxIsolation(
    namespaceDifferences,
    rootDiffers,
  );
  assert.ok(
    layer1NamespaceIsolation,
    `Chromium layer-1 renderer isolation was not observed: ${JSON.stringify(observation)}`,
  );
  assert.equal(
    observation.noNewPrivs,
    "1",
    `renderer did not report NoNewPrivs=1: ${JSON.stringify(observation)}`,
  );
  assert.equal(
    observation.seccomp,
    "2",
    `renderer did not report an active Seccomp-BPF filter: ${JSON.stringify(observation)}`,
  );
  console.log(
    `linux_sandbox=active ${JSON.stringify({
      ...observation,
      layer1NamespaceIsolation,
    })}`,
  );
}
