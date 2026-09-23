import path from "node:path";

export const ELECTRON_BUNDLE_ID = "xyz.block.buzz.app.electron";

const SUPPORTED_PLATFORMS = new Set(["darwin", "win32", "linux"]);
const SUPPORTED_ARCHITECTURES = new Set(["arm64", "x64"]);

function assertPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(
      `Unsupported platform ${JSON.stringify(platform)}. Use darwin, win32, or linux.`,
    );
  }
}

function assertArchitecture(arch) {
  if (!SUPPORTED_ARCHITECTURES.has(arch)) {
    throw new Error(
      `Unsupported architecture ${JSON.stringify(arch)}. Use arm64 or x64.`,
    );
  }
}

export function parseElectronPackageArgs(args) {
  const options = {};

  for (const argument of args) {
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const value = separator === -1 ? "" : argument.slice(separator + 1);
    const key = {
      "--platform": "platform",
      "--arch": "arch",
      "--host": "host",
    }[flag];

    if (!key) throw new Error(`Unknown argument ${JSON.stringify(argument)}.`);
    if (Object.hasOwn(options, key))
      throw new Error(`${flag} was specified more than once.`);
    if (!value) throw new Error(`${flag} cannot be empty.`);
    options[key] = value;
  }

  if (!options.platform) throw new Error("--platform is required.");
  if (!options.arch) throw new Error("--arch is required.");
  assertPlatform(options.platform);
  assertArchitecture(options.arch);

  return options;
}

export function electronPackagePaths({ desktop, platform, arch }) {
  assertPlatform(platform);
  assertArchitecture(arch);

  const packageName = `${platform}-${arch}`;
  const packagerOutputDir = path.join(desktop, "dist-electron");

  return {
    outputDir: path.join(packagerOutputDir, packageName),
    archivePath: path.join(
      packagerOutputDir,
      `${packageName}${platform === "linux" ? ".tar.gz" : ".zip"}`,
    ),
    packagerOutputDir,
  };
}

export function nativeHostFilename(platform) {
  assertPlatform(platform);
  return `colony-native-host${platform === "win32" ? ".exe" : ""}`;
}

export function createPackagerOptions({
  dir,
  out,
  productName,
  appVersion,
  electronVersion,
  platform,
  arch,
  extraResource,
}) {
  assertPlatform(platform);
  assertArchitecture(arch);

  return {
    dir,
    out,
    name: productName,
    executableName: productName,
    appBundleId: ELECTRON_BUNDLE_ID,
    appVersion,
    electronVersion,
    platform,
    arch,
    asar: true,
    prune: false,
    overwrite: true,
    extraResource,
    ...(platform === "win32"
      ? { win32metadata: { CompanyName: productName } }
      : {}),
  };
}
