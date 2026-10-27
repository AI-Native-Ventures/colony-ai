import { readFileSync } from "node:fs";
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
      "--sidecar-dir": "sidecarDir",
      "--ffmpeg-dir": "ffmpegDir",
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

export function sidecarFilenames(platform) {
  assertPlatform(platform);
  const extension = platform === "win32" ? ".exe" : "";
  const binaries = [
    "buzz-acp",
    "buzz-agent",
    "buzz-dev-mcp",
    "git-credential-nostr",
    "buzz",
  ];
  if (platform !== "win32") binaries.push("buzz-backend-kubernetes");
  return binaries.map((binary) => `${binary}${extension}`);
}

const ffmpegManifest = JSON.parse(
  readFileSync(
    new URL("../ffmpeg-bundle/manifest.json", import.meta.url),
    "utf8",
  ),
);

/**
 * The ffmpeg that ships inside the app for a platform, or null where none does
 * (the app then looks for one on the machine). The build recipe and pinned
 * source are in desktop/ffmpeg-bundle; the app resolves `executable` next to
 * its native host (see `bundled_ffmpeg_in` in media_transcode.rs).
 */
export function ffmpegBundle(platform, arch) {
  assertPlatform(platform);
  assertArchitecture(arch);
  const platformKey = `${platform}-${arch}`;
  const entry = ffmpegManifest.platforms[platformKey];
  if (!entry) return null;
  return {
    platformKey,
    version: ffmpegManifest.version,
    license: ffmpegManifest.license,
    source: ffmpegManifest.source,
    executable: entry.executable,
    h264Encoder: entry.h264Encoder,
    noticeFilename: "ffmpeg-NOTICE.txt",
    licenseFilename: "ffmpeg-COPYING.LGPLv2.1.txt",
  };
}

/** Files the packaged app carries in its resources folder for ffmpeg. */
export function ffmpegResourceFilenames(platform, arch) {
  const bundle = ffmpegBundle(platform, arch);
  return bundle
    ? [bundle.executable, bundle.noticeFilename, bundle.licenseFilename]
    : [];
}

// What a bundled build may be configured with. A GPL or nonfree ffmpeg, or one
// that links an external codec library, would change what Colony may ship.
const FORBIDDEN_FFMPEG_CONFIGURATION =
  /--enable-(gpl|nonfree|version3|libx264|libx265|libfdk[-_]aac|libxvid)\b/;

/** Throws unless the `configuration:` line of `ffmpeg -version` is LGPL-only. */
export function assertLgplFfmpegConfiguration(versionOutput) {
  const line = versionOutput
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("configuration:"));
  if (!line) throw new Error("ffmpeg -version printed no configuration line.");
  const forbidden = FORBIDDEN_FFMPEG_CONFIGURATION.exec(line);
  if (forbidden)
    throw new Error(
      `The bundled ffmpeg is not an LGPL-only build (${forbidden[0]}).`,
    );
  if (!line.includes("--disable-gpl"))
    throw new Error(
      "The bundled ffmpeg was not configured with --disable-gpl.",
    );
  return line.slice("configuration:".length).trim();
}

/** The notice shipped beside the ffmpeg binary: licence, source, how it is built. */
export function ffmpegNoticeText({ bundle, configuration }) {
  const encoder =
    bundle.h264Encoder === "h264_videotoolbox"
      ? "Apple VideoToolbox"
      : "Windows Media Foundation";
  return [
    `FFmpeg ${bundle.version}`,
    "",
    "Colony includes FFmpeg, a separate program it runs to prepare voice notes,",
    "videos and HEIC photos for upload. FFmpeg is licensed under the GNU Lesser",
    "General Public License, version 2.1 or later. The licence text is in",
    `${bundle.licenseFilename}, next to this file.`,
    "",
    "This build is LGPL only. It was configured without --enable-gpl and",
    "--enable-nonfree and links no external codec library, so it contains no",
    `x264 or x265. H.264 video is encoded by the operating system (${encoder});`,
    "AAC audio is encoded by FFmpeg's own encoder. FFmpeg is a trademark of",
    "Fabrice Bellard, originator of the FFmpeg project.",
    "",
    "Source code",
    "-----------",
    `This is the unmodified FFmpeg ${bundle.version} release:`,
    `  ${bundle.source.url}`,
    `  SHA-256 ${bundle.source.sha256}`,
    `  signed with the FFmpeg release key ${bundle.source.signingKeyFingerprint}`,
    "The build script and its settings are in the Colony repository:",
    "  desktop/ffmpeg-bundle/build.sh and manifest.json",
    "If you cannot get the source from those places, ask for a copy at",
    "https://colony.global and it will be sent to you.",
    "",
    "Build configuration",
    "-------------------",
    configuration,
    "",
    "Because FFmpeg runs as its own program, you may replace the ffmpeg file in",
    "this folder with another build of your own.",
    "",
  ].join("\n");
}

// Colony app icon, without extension: the packager appends .icns or .ico.
export const APP_ICON_BASENAME = "icon";

// A bundle that is modified after Electron signs it (renamed executable, new
// Info.plist, extra resources) carries a stale seal, and macOS then reports the
// app as "damaged" with no way to open it. Unsigned builds are re-signed ad hoc
// over the whole bundle so the seal is valid and Gatekeeper offers Open Anyway.
export function adhocSignArguments(appPath) {
  return ["--force", "--deep", "--sign", "-", appPath];
}

export function verifySignatureArguments(appPath) {
  return ["--verify", "--deep", "--strict", appPath];
}

/**
 * What the packaged app is told about itself (release-capabilities.json).
 *
 * `selfUpdate` is the unsigned Mac build that replaces its own bundle.
 * `updateTestOverride` lets a local test build read its update manifest from a
 * loopback server; it exists only when COLONY_ELECTRON_UPDATE_TEST=1 and never
 * together with a release, so a shipped build cannot be pointed elsewhere.
 */
export function releaseCapabilities({ platform, arch, env }) {
  assertPlatform(platform);
  assertArchitecture(arch);
  const release = env.COLONY_ELECTRON_RELEASE === "1";
  const signed = env.COLONY_ELECTRON_SIGNED === "1";
  const updateTestOverride = env.COLONY_ELECTRON_UPDATE_TEST === "1";
  if (release && updateTestOverride) {
    throw new Error(
      "A release build cannot enable the update test override (COLONY_ELECTRON_UPDATE_TEST).",
    );
  }
  return {
    schemaVersion: 1,
    release,
    platformKey: `${platform}-${arch}`,
    autoUpdate: env.COLONY_ELECTRON_AUTO_UPDATE === "1",
    signed,
    publisherName: env.COLONY_ELECTRON_PUBLISHER_NAME || null,
    selfUpdate:
      platform === "darwin" && !signed && (release || updateTestOverride),
    updateTestOverride,
  };
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
  icon,
  osxSign,
  osxNotarize,
  deepLinkSchemes = [],
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
    ...(icon ? { icon } : {}),
    ...(platform === "darwin"
      ? {
          extendInfo: {
            NSMicrophoneUsageDescription:
              "Your microphone is used to send and receive audio in huddles.",
          },
        }
      : {}),
    // macOS only routes a URL scheme to an app that declares it in Info.plist
    // (CFBundleURLTypes); setAsDefaultProtocolClient cannot add it at runtime.
    ...(platform === "darwin" && deepLinkSchemes.length > 0
      ? {
          protocols: [
            { name: `${productName} link`, schemes: deepLinkSchemes },
          ],
        }
      : {}),
    ...(platform === "darwin" && osxSign ? { osxSign } : {}),
    ...(platform === "darwin" && osxNotarize ? { osxNotarize } : {}),
    ...(platform === "win32"
      ? { win32metadata: { CompanyName: productName } }
      : {}),
  };
}
