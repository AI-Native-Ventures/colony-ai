import { packager } from "@electron/packager";
import { extractFile } from "@electron/asar";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createPackagerOptions,
  electronPackagePaths,
  nativeHostFilename,
  parseElectronPackageArgs,
  sidecarFilenames,
} from "./electron-package-config.mjs";
import { build } from "esbuild";

const exec = promisify(execFile);
const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(desktop);
const { platform, arch, host, sidecarDir } = parseElectronPackageArgs(
  process.argv.slice(2),
);
const hostFilename = nativeHostFilename(platform);
const defaultReleaseDir = host ? undefined : await cargoReleaseDir();
const hostPath = path.resolve(
  host ?? path.join(defaultReleaseDir, hostFilename),
);
const sidecarSourceDir = path.resolve(sidecarDir ?? path.dirname(hostPath));
const sidecarPaths = sidecarFilenames(platform).map((filename) =>
  path.join(sidecarSourceDir, filename),
);
const distPath = path.join(desktop, "dist");
const sourceElectronPath = path.join(desktop, "electron");
const packageJsonPath = path.join(desktop, "package.json");
const tauriConfigPath = path.join(desktop, "src-tauri", "tauri.conf.json");
const packagePaths = electronPackagePaths({ desktop, platform, arch });
const sourceTauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
const productName =
  process.env.COLONY_ELECTRON_PRODUCT_NAME || sourceTauriConfig.productName;
const packagerGeneratedPath = path.join(
  packagePaths.packagerOutputDir,
  `${productName}-${platform}-${arch}`,
);

async function requireFile(filePath, label) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(`${label} does not exist: ${filePath}`);
    throw error;
  }
  if (!fileStat.isFile() || fileStat.size === 0)
    throw new Error(`${label} must be a non-empty file: ${filePath}`);
  return fileStat;
}

async function cargoReleaseDir() {
  const { stdout } = await exec(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      path.join(desktop, "src-tauri", "Cargo.toml"),
      "--format-version",
      "1",
      "--no-deps",
    ],
    { cwd: repo, windowsHide: true },
  );
  return path.join(JSON.parse(stdout).target_directory, "release");
}

async function makeArchive(outputDir, archivePath) {
  await rm(archivePath, { force: true });

  if (platform === "linux") {
    await exec(
      "tar",
      [
        "-czf",
        archivePath,
        "-C",
        path.dirname(outputDir),
        path.basename(outputDir),
      ],
      { cwd: repo, windowsHide: true },
    );
    return;
  }

  if (platform === "darwin") {
    await exec(
      "ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", outputDir, archivePath],
      { cwd: repo, windowsHide: true },
    );
    return;
  }

  await exec(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Compress-Archive -LiteralPath $env:COLONY_PACKAGE_DIRECTORY -DestinationPath $env:COLONY_PACKAGE_ARCHIVE -Force",
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        COLONY_PACKAGE_DIRECTORY: outputDir,
        COLONY_PACKAGE_ARCHIVE: archivePath,
      },
      windowsHide: true,
    },
  );
}

const desktopStat = await stat(desktop);
if (!desktopStat.isDirectory())
  throw new Error(`Not a desktop directory: ${desktop}`);
const distStat = await stat(distPath).catch((error) => {
  if (error.code === "ENOENT")
    throw new Error(
      `Build the frontend before packaging: ${distPath} is missing.`,
    );
  throw error;
});
if (!distStat.isDirectory())
  throw new Error(
    `Build the frontend before packaging: ${distPath} is not a directory.`,
  );
await requireFile(path.join(distPath, "index.html"), "Renderer entry point");
const hostStat = await requireFile(hostPath, "Native host");
if (platform !== "win32" && !(hostStat.mode & 0o111))
  throw new Error(`Native host is not executable: ${hostPath}`);
if (platform === "win32" && !hostPath.toLowerCase().endsWith(".exe"))
  throw new Error(
    `Windows native host must have an .exe extension: ${hostPath}`,
  );
const sidecarStats = await Promise.all(
  sidecarPaths.map((sidecarPath) => requireFile(sidecarPath, "Sidecar")),
);
if (platform !== "win32") {
  for (const [index, sidecarStat] of sidecarStats.entries()) {
    if (!(sidecarStat.mode & 0o111))
      throw new Error(`Sidecar is not executable: ${sidecarPaths[index]}`);
  }
}

const desktopPackage = JSON.parse(await readFile(packageJsonPath, "utf8"));
const tauriConfig = sourceTauriConfig;
if (!tauriConfig.productName)
  throw new Error(`Missing productName in ${tauriConfigPath}`);
const electronVersion = desktopPackage.devDependencies?.electron;
if (!electronVersion)
  throw new Error(`Missing Electron version in ${packageJsonPath}`);

const signed = process.env.COLONY_ELECTRON_SIGNED === "1";
let osxSign;
let osxNotarize;
if (platform === "darwin" && signed) {
  const appleIdentity = process.env.COLONY_APPLE_DEVELOPER_IDENTITY;
  const appleApiKey = process.env.COLONY_APPLE_NOTARY_KEY_PATH;
  const appleApiKeyId = process.env.COLONY_APPLE_NOTARY_KEY_ID;
  const appleApiIssuer = process.env.COLONY_APPLE_NOTARY_ISSUER_ID;
  if (!appleIdentity || !appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    throw new Error(
      "Signed macOS releases require signing and notarization credentials.",
    );
  }
  osxSign = {
    identity: appleIdentity,
    hardenedRuntime: true,
    entitlements: path.join(sourceElectronPath, "entitlements.mac.plist"),
    entitlementsInherit: path.join(
      sourceElectronPath,
      "entitlements.mac.plist",
    ),
    signatureFlags: "runtime",
    timestamp: true,
    continueOnError: false,
  };
  osxNotarize = { appleApiKey, appleApiKeyId, appleApiIssuer };
}

await mkdir(packagePaths.packagerOutputDir, { recursive: true });
await rm(packagerGeneratedPath, { recursive: true, force: true });
await rm(packagePaths.outputDir, { recursive: true, force: true });
await rm(packagePaths.archivePath, { force: true });

const stageRoot = await mkdtemp(
  path.join(os.tmpdir(), "colony-electron-package-"),
);
const stageDir = path.join(stageRoot, "app");
const stagedElectronPath = path.join(stageDir, "electron");
const stagedDistPath = path.join(stageDir, "dist");
const stagedTauriConfigPath = path.join(
  stageDir,
  "src-tauri",
  "tauri.conf.json",
);
const stagedHostPath = path.join(stageRoot, hostFilename);
const stagedSidecarPaths = sidecarPaths.map((sidecarPath) =>
  path.join(stageRoot, path.basename(sidecarPath)),
);

try {
  await mkdir(stageDir, { recursive: true });
  await cp(sourceElectronPath, stagedElectronPath, {
    recursive: true,
    filter: (source) =>
      source === sourceElectronPath ||
      (!/\.test\.mjs$/i.test(source) && path.basename(source) !== "README.md"),
  });
  const releaseCapabilities = {
    schemaVersion: 1,
    release: process.env.COLONY_ELECTRON_RELEASE === "1",
    platformKey: `${platform}-${arch}`,
    autoUpdate: process.env.COLONY_ELECTRON_AUTO_UPDATE === "1",
    signed: process.env.COLONY_ELECTRON_SIGNED === "1",
    publisherName: process.env.COLONY_ELECTRON_PUBLISHER_NAME || null,
  };
  const stagedUpdateConfigPath = path.join(stageRoot, "app-update.yml");
  const releaseResources = [];
  if (process.env.COLONY_ELECTRON_RELEASE === "1") {
    const updateConfig = [
      "provider: generic",
      'url: "https://github.com/AI-Native-Ventures/colony-ai/releases/latest/download/"',
      ...(releaseCapabilities.publisherName
        ? [
            "publisherName:",
            `  - ${JSON.stringify(releaseCapabilities.publisherName)}`,
          ]
        : []),
      "",
    ].join("\n");
    await writeFile(stagedUpdateConfigPath, updateConfig);
    releaseResources.push(stagedUpdateConfigPath);
  }
  await writeFile(
    path.join(stagedElectronPath, "release-capabilities.json"),
    `${JSON.stringify(releaseCapabilities, null, 2)}\n`,
  );
  await build({
    entryPoints: [
      path.join(sourceElectronPath, "electron-updater-runtime.mjs"),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["electron"],
    outfile: path.join(stagedElectronPath, "electron-updater-runtime.mjs"),
    logLevel: "warning",
  });
  await cp(distPath, stagedDistPath, { recursive: true });
  await mkdir(path.dirname(stagedTauriConfigPath), { recursive: true });
  await writeFile(
    stagedTauriConfigPath,
    `${JSON.stringify({ ...tauriConfig, productName }, null, 2)}\n`,
  );
  await copyFile(hostPath, stagedHostPath, fsConstants.COPYFILE_FICLONE);
  await Promise.all(
    sidecarPaths.map((sidecarPath, index) =>
      copyFile(
        sidecarPath,
        stagedSidecarPaths[index],
        fsConstants.COPYFILE_FICLONE,
      ),
    ),
  );

  const stagedPackageJson = {
    ...desktopPackage,
    main: "electron/main.mjs",
  };
  await writeFile(
    path.join(stageDir, "package.json"),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
  );

  const options = createPackagerOptions({
    dir: stageDir,
    out: packagePaths.packagerOutputDir,
    productName,
    appVersion: desktopPackage.version,
    electronVersion,
    platform,
    arch,
    extraResource: [stagedHostPath, ...stagedSidecarPaths, ...releaseResources],
    osxSign,
    osxNotarize,
  });
  const packagedPaths = await packager(options);
  if (packagedPaths.length !== 1)
    throw new Error(
      `Expected one Electron package, received ${packagedPaths.length}.`,
    );
  await rename(packagedPaths[0], packagePaths.outputDir);

  const appResourcesPath =
    platform === "darwin"
      ? path.join(
          packagePaths.outputDir,
          `${productName}.app`,
          "Contents",
          "Resources",
        )
      : path.join(packagePaths.outputDir, "resources");
  const appAsarPath = path.join(appResourcesPath, "app.asar");
  await requireFile(appAsarPath, "Packaged application archive");
  if (
    process.env.COLONY_ELECTRON_RELEASE === "1" &&
    !(await stat(path.join(appResourcesPath, "app-update.yml")).catch(
      () => null,
    ))
  ) {
    throw new Error("Packaged release is missing app-update.yml.");
  }
  const packagedTauriConfig = extractFile(
    appAsarPath,
    "src-tauri/tauri.conf.json",
  );
  const stagedTauriConfig = await readFile(stagedTauriConfigPath);
  if (!packagedTauriConfig.equals(stagedTauriConfig))
    throw new Error("Packaged app is missing the staged Tauri configuration.");

  const packagedRuntimePaths = [
    path.join(appResourcesPath, hostFilename),
    ...sidecarFilenames(platform).map((filename) =>
      path.join(appResourcesPath, filename),
    ),
  ];
  const packagedRuntimeStats = await Promise.all(
    packagedRuntimePaths.map((runtimePath, index) =>
      requireFile(
        runtimePath,
        index === 0 ? "Packaged native host" : "Packaged sidecar",
      ),
    ),
  );
  if (platform !== "win32") {
    for (const [index, runtimeStat] of packagedRuntimeStats.entries()) {
      if (!(runtimeStat.mode & 0o111))
        throw new Error(
          `Packaged runtime binary is not executable: ${packagedRuntimePaths[index]}`,
        );
    }
  }

  await makeArchive(packagePaths.outputDir, packagePaths.archivePath);
  const archiveStat = await stat(packagePaths.archivePath);
  const sizeMiB = (archiveStat.size / (1024 * 1024)).toFixed(1);
  console.log(`Package directory: ${packagePaths.outputDir}`);
  console.log(
    `Package archive: ${packagePaths.archivePath} (${archiveStat.size} bytes, ${sizeMiB} MiB)`,
  );
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}
