import { packager } from "@electron/packager";
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
} from "./electron-package-config.mjs";

const exec = promisify(execFile);
const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(desktop);
const { platform, arch, host } = parseElectronPackageArgs(
  process.argv.slice(2),
);
const hostFilename = nativeHostFilename(platform);
const hostPath = path.resolve(
  host ?? path.join(desktop, "src-tauri", "target", "release", hostFilename),
);
const distPath = path.join(desktop, "dist");
const sourceElectronPath = path.join(desktop, "electron");
const packageJsonPath = path.join(desktop, "package.json");
const tauriConfigPath = path.join(desktop, "src-tauri", "tauri.conf.json");
const packagePaths = electronPackagePaths({ desktop, platform, arch });
const packagerGeneratedPath = path.join(
  packagePaths.packagerOutputDir,
  `${JSON.parse(await readFile(tauriConfigPath, "utf8")).productName}-${platform}-${arch}`,
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

const [desktopPackage, tauriConfig] = await Promise.all([
  readFile(packageJsonPath, "utf8").then(JSON.parse),
  readFile(tauriConfigPath, "utf8").then(JSON.parse),
]);
if (!tauriConfig.productName)
  throw new Error(`Missing productName in ${tauriConfigPath}`);
const electronVersion = desktopPackage.devDependencies?.electron;
if (!electronVersion)
  throw new Error(`Missing Electron version in ${packageJsonPath}`);

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
const stagedHostPath = path.join(stageRoot, hostFilename);

try {
  await mkdir(stageDir, { recursive: true });
  await cp(sourceElectronPath, stagedElectronPath, {
    recursive: true,
    filter: (source) =>
      source === sourceElectronPath ||
      (!/\.test\.mjs$/i.test(source) && path.basename(source) !== "README.md"),
  });
  await cp(distPath, stagedDistPath, { recursive: true });
  await copyFile(hostPath, stagedHostPath, fsConstants.COPYFILE_FICLONE);

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
    productName: tauriConfig.productName,
    appVersion: desktopPackage.version,
    electronVersion,
    platform,
    arch,
    extraResource: [stagedHostPath],
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
          `${tauriConfig.productName}.app`,
          "Contents",
          "Resources",
        )
      : path.join(packagePaths.outputDir, "resources");
  await requireFile(
    path.join(appResourcesPath, "app.asar"),
    "Packaged application archive",
  );
  await requireFile(
    path.join(appResourcesPath, hostFilename),
    "Packaged native host",
  );

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
