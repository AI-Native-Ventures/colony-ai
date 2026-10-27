// Checks a built ffmpeg bundle before it is cached or packaged:
//
//   node verify.mjs <platform-key> <directory>
//
// The binary must run, be an LGPL-only build, and offer exactly what Colony
// needs: AAC and JPEG encoding, the platform's H.264 encoder, and only the
// file and pipe protocols.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { assertLgplFfmpegConfiguration } from "../scripts/electron-package-config.mjs";

const run = promisify(execFile);
const manifest = (await import("./manifest.json", { with: { type: "json" } }))
  .default;

const [platformKey, directory] = process.argv.slice(2);
const entry = manifest.platforms[platformKey];
if (!entry || !directory) {
  console.error("usage: node verify.mjs <darwin-arm64|win32-x64> <directory>");
  process.exit(2);
}

const binary = path.resolve(directory, entry.executable);
const size = (await stat(binary)).size;
const ffmpeg = (args) =>
  run(binary, ["-hide_banner", ...args], { windowsHide: true }).then(
    ({ stdout, stderr }) => stdout + stderr,
  );

const version = await ffmpeg(["-version"]);
if (!version.includes(`ffmpeg version ${manifest.version}`))
  throw new Error(
    `Expected ffmpeg ${manifest.version}, got: ${version.split("\n")[0]}`,
  );
assertLgplFfmpegConfiguration(version);

const encoders = await ffmpeg(["-encoders"]);
for (const required of ["aac", "mjpeg", entry.h264Encoder]) {
  if (!new RegExp(`^ [VA][.\\w]* ${required}\\s`, "m").test(encoders))
    throw new Error(`The bundled ffmpeg has no ${required} encoder.`);
}
for (const forbidden of ["libx264", "libx265", "libfdk_aac"]) {
  if (encoders.includes(forbidden))
    throw new Error(
      `The bundled ffmpeg offers ${forbidden}, which is not LGPL.`,
    );
}

const protocols = await ffmpeg(["-protocols"]);
const listed = protocols
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^[a-z0-9_]+$/.test(line));
const unexpected = listed.filter((name) => !["file", "pipe"].includes(name));
if (unexpected.length > 0)
  throw new Error(
    `The bundled ffmpeg opens more than files: ${unexpected.join(", ")}`,
  );

console.log(
  `${path.basename(fileURLToPath(import.meta.url))}: ${platformKey} ffmpeg ${manifest.version} ok, ${(size / 1024 / 1024).toFixed(1)} MiB, H.264 via ${entry.h264Encoder}`,
);
