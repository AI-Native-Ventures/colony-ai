import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  await readFile(path.join(desktop, "package.json"), "utf8"),
);
const [platform, arch] = process.argv.slice(2);
const platformTargets = {
  "darwin-arm64": { flag: "mac", targets: ["dmg", "zip"], appBundle: true },
  "win32-x64": { flag: "win", targets: ["nsis"], appBundle: false },
  "linux-x64": { flag: "linux", targets: ["AppImage"], appBundle: false },
};
const target = platformTargets[`${platform}-${arch}`];
if (!target) {
  throw new Error(
    "Installer target must be darwin-arm64, win32-x64, or linux-x64.",
  );
}
if (!semver.valid(packageJson.version)) {
  throw new Error("The desktop package version must use semantic versioning.");
}

const signed = process.env.COLONY_ELECTRON_SIGNED === "1";
const artifactLabel =
  platform === "linux" ? "UNSIGNED" : signed ? "SIGNED" : "UNSIGNED";
const appId = "xyz.block.buzz.app.electron";
const config = {
  appId,
  productName: "Colony",
  asar: true,
  electronUpdaterCompatibility: ">= 2.16",
  artifactName: `Colony-${version}-${arch}-${artifactLabel}.${ext}`,
  directories: { output: path.join(desktop, "dist-electron", "release") },
  publish: [
    {
      provider: "generic",
      url: "https://github.com/AI-Native-Ventures/colony-ai/releases/latest/download/",
    },
  ],
  [target.flag]: {
    target: target.targets,
    icon: path.join(
      desktop,
      "src-tauri",
      "icons",
      platform === "win32"
        ? "icon.ico"
        : platform === "linux"
          ? "icon.png"
          : "icon.icns",
    ),
  },
};

if (platform === "win32") {
  config.win.verifyUpdateCodeSignature = signed;
  config.nsis = { oneClick: true, perMachine: false, allowElevation: true };
}
if (platform === "darwin") {
  config.mac = {
    ...config.mac,
    identity: signed ? undefined : null,
    hardenedRuntime: signed,
    gatekeeperAssess: false,
  };
}
if (platform === "linux") {
  config.linux.category = "Network;InstantMessaging;";
}

const prepackaged = path.join(
  desktop,
  "dist-electron",
  `${platform}-${arch}`,
  ...(target.appBundle ? ["Colony.app"] : []),
);
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "colony-electron-builder-"),
);
const configPath = path.join(temporaryDirectory, "electron-builder.json");

try {
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = [
    "exec",
    "electron-builder",
    "--prepackaged",
    prepackaged,
    "--config",
    configPath,
    "--publish",
    "never",
    `--${target.flag}`,
    ...target.targets,
    `--${arch}`,
  ];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: desktop,
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`electron-builder exited after ${signal}.`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) process.exitCode = exitCode;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
