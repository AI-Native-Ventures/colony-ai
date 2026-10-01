import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { parse as parseYaml } from "yaml";

function parseArgs(args) {
  const values = {};
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument ${JSON.stringify(arg)}.`);
    values[match[1]] = match[2];
  }
  for (const key of ["assets-dir", "version", "mac-signed", "windows-signed"]) {
    if (!Object.hasOwn(values, key)) throw new Error(`Missing --${key}.`);
  }
  if (!semver.valid(values.version)) {
    throw new Error("Release version must use semantic versioning.");
  }
  for (const key of ["mac-signed", "windows-signed"]) {
    if (values[key] !== "true" && values[key] !== "false") {
      throw new Error(`--${key} must be true or false.`);
    }
  }
  return {
    assetsDir: path.resolve(values["assets-dir"]),
    version: semver.valid(values.version),
    macSigned: values["mac-signed"] === "true",
    windowsSigned: values["windows-signed"] === "true",
  };
}

function findOne(names, pattern, label) {
  const matches = names.filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(`Expected one ${label}, found ${matches.length}.`);
  }
  return matches[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashFile(filePath, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest(encoding)));
  });
}

async function sha256(filePath) {
  return hashFile(filePath, "sha256", "hex");
}

async function verifyUpdaterFeed({
  assetsDir,
  fileName,
  version,
  artifactName,
}) {
  const feed = parseYaml(
    await readFile(path.join(assetsDir, fileName), "utf8"),
  );
  if (feed?.version !== version || !Array.isArray(feed.files)) {
    throw new Error(`${fileName} has invalid version or file metadata.`);
  }
  const entry = feed.files.find((file) => file?.url === artifactName);
  if (!entry || typeof entry.sha512 !== "string" || !entry.sha512) {
    throw new Error(`${fileName} does not reference ${artifactName}.`);
  }
  const artifactPath = path.join(assetsDir, artifactName);
  const [artifactStat, artifactHash] = await Promise.all([
    stat(artifactPath),
    hashFile(artifactPath, "sha512", "base64"),
  ]);
  if (
    entry.sha512 !== artifactHash ||
    (entry.size !== undefined && entry.size !== artifactStat.size)
  ) {
    throw new Error(
      `${fileName} checksum or size does not match ${artifactName}.`,
    );
  }
  return feed;
}

export async function writeReleaseMetadata({
  assetsDir,
  version,
  macSigned,
  windowsSigned,
}) {
  const normalizedVersion = semver.valid(version);
  if (!normalizedVersion) {
    throw new Error("Release version must use semantic versioning.");
  }

  const files = (await readdir(assetsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(
      (name) => name !== "checksums.txt" && name !== "update-metadata.json",
    )
    .sort();
  const versionPrefix = `Colony-${escapeRegExp(normalizedVersion)}-`;
  const macDmg = findOne(
    files,
    new RegExp(`^${versionPrefix}arm64-(SIGNED|UNSIGNED)\\.dmg$`),
    "macOS DMG",
  );
  const macZip = findOne(
    files,
    new RegExp(`^${versionPrefix}arm64-(SIGNED|UNSIGNED)\\.zip$`),
    "macOS update archive",
  );
  const windowsInstaller = findOne(
    files,
    new RegExp(`^${versionPrefix}x64-(SIGNED|UNSIGNED)\\.exe$`),
    "Windows installer",
  );
  const linuxAppImage = findOne(
    files,
    new RegExp(`^${versionPrefix}x64-UNSIGNED\\.AppImage$`, "i"),
    "Linux AppImage",
  );
  const macUpdateMetadata = findOne(
    files,
    /^latest-mac\.yml$/,
    "macOS update metadata",
  );
  const windowsUpdateMetadata = findOne(
    files,
    /^latest\.yml$/,
    "Windows update metadata",
  );
  const linuxUpdateMetadata = findOne(
    files,
    /^latest-linux\.yml$/,
    "Linux update metadata",
  );

  const signedByName = new Map([
    [macDmg, macSigned],
    [macZip, macSigned],
    [windowsInstaller, windowsSigned],
    [linuxAppImage, false],
  ]);
  if (macDmg.includes("UNSIGNED") === macSigned) {
    throw new Error("macOS installer label does not match its signing state.");
  }
  if (windowsInstaller.includes("UNSIGNED") === windowsSigned) {
    throw new Error(
      "Windows installer label does not match its signing state.",
    );
  }
  if (!linuxAppImage.includes("UNSIGNED")) {
    throw new Error("Linux AppImage must be labelled UNSIGNED.");
  }

  await Promise.all([
    verifyUpdaterFeed({
      assetsDir,
      fileName: macUpdateMetadata,
      version: normalizedVersion,
      artifactName: macZip,
    }),
    verifyUpdaterFeed({
      assetsDir,
      fileName: windowsUpdateMetadata,
      version: normalizedVersion,
      artifactName: windowsInstaller,
    }),
    verifyUpdaterFeed({
      assetsDir,
      fileName: linuxUpdateMetadata,
      version: normalizedVersion,
      artifactName: linuxAppImage,
    }),
  ]);

  const assets = await Promise.all(
    files.map(async (name) => {
      const filePath = path.join(assetsDir, name);
      const fileStat = await stat(filePath);
      const platform =
        name === macDmg || name === macZip || name === macUpdateMetadata
          ? "darwin-arm64"
          : name === windowsInstaller ||
              name === windowsUpdateMetadata ||
              name === "latest.yml"
            ? "win32-x64"
            : name === linuxAppImage || name === linuxUpdateMetadata
              ? "linux-x64"
              : "shared";
      return {
        name,
        platform,
        size: fileStat.size,
        sha256: await sha256(filePath),
        signed: signedByName.get(name) ?? false,
      };
    }),
  );

  const metadata = {
    schemaVersion: 1,
    version: normalizedVersion,
    tag: `desktop-v${normalizedVersion}`,
    platforms: {
      "darwin-arm64": {
        signed: macSigned,
        autoUpdate: macSigned,
        installer: macDmg,
        updateArchive: macZip,
        updateMetadata: macUpdateMetadata,
      },
      "win32-x64": {
        signed: windowsSigned,
        autoUpdate: true,
        installer: windowsInstaller,
        updateMetadata: windowsUpdateMetadata,
      },
      "linux-x64": {
        signed: false,
        autoUpdate: true,
        installer: linuxAppImage,
        updateMetadata: linuxUpdateMetadata,
      },
    },
    assets,
  };

  const metadataPath = path.join(assetsDir, "update-metadata.json");
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  const checksumNames = [...files, "update-metadata.json"].sort();
  const checksumLines = await Promise.all(
    checksumNames.map(
      async (name) => `${await sha256(path.join(assetsDir, name))}  ${name}`,
    ),
  );
  await writeFile(
    path.join(assetsDir, "checksums.txt"),
    `${checksumLines.join("\n")}\n`,
  );
  return metadata;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = parseArgs(process.argv.slice(2));
  await writeReleaseMetadata(options);
}
