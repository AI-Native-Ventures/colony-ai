import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants as fsConstants, createWriteStream } from "node:fs";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { renderSwapHelper } from "./mac-update-helper.mjs";

const execFileAsync = promisify(execFile);
const posix = path.posix;

export const STAGE_DIR_PREFIX = ".colony-update-";
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const STALE_STAGE_MS = 60 * 60 * 1000;
const DOWNLOAD_STALL_MS = 30_000;
const RESULT_FILE = "last-install.json";
const LOG_FILE = "helper.log";

/** A refusal with a short plain message that is safe to show as it is. */
export class UpdateRefusedError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "UpdateRefusedError";
    this.code = code;
  }
}

/** "/Applications/Colony.app/Contents/MacOS/Colony" -> "/Applications/Colony.app". */
export function appBundleFromExecutable(executablePath) {
  if (typeof executablePath !== "string" || !posix.isAbsolute(executablePath))
    return null;
  const parts = posix.normalize(executablePath).split("/");
  const macOsIndex = parts.lastIndexOf("MacOS");
  if (
    macOsIndex < 2 ||
    parts[macOsIndex - 1] !== "Contents" ||
    !parts[macOsIndex - 2].endsWith(".app") ||
    parts.length !== macOsIndex + 2
  ) {
    return null;
  }
  return parts.slice(0, macOsIndex - 1).join("/");
}

/**
 * Whether this running app can replace itself: it must be a normal .app that
 * the user owns, in a folder the user can write to, and not on a disk image or
 * under App Translocation (a randomized, read-only copy macOS makes of an app
 * that was opened straight from a download).
 */
export async function assessBundleLocation({
  bundlePath,
  uid = process.getuid?.(),
  fs = fsPromises,
}) {
  if (!bundlePath?.endsWith(".app")) {
    return { ok: false, reason: "not-a-bundle" };
  }
  if (bundlePath.includes("/AppTranslocation/")) {
    return { ok: false, reason: "translocated" };
  }
  const location = bundlePath.startsWith("/Volumes/")
    ? "disk-image"
    : "not-writable";
  try {
    await fs.access(posix.dirname(bundlePath), fsConstants.W_OK);
    await fs.access(bundlePath, fsConstants.W_OK);
    const bundleStat = await fs.stat(bundlePath);
    if (!bundleStat.isDirectory()) return { ok: false, reason: "not-a-bundle" };
    if (uid !== undefined && bundleStat.uid !== uid) {
      return { ok: false, reason: "not-writable" };
    }
  } catch {
    return { ok: false, reason: location };
  }
  return { ok: true };
}

function runSystemCommand(file, args) {
  return execFileAsync(file, args, { maxBuffer: 4 * 1024 * 1024 });
}

async function readPlistValue(runCommand, plistPath, key) {
  const { stdout } = await runCommand("/usr/bin/plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    plistPath,
  ]);
  return String(stdout).trim();
}

/**
 * Checks an extracted app against what this install and the manifest say it
 * must be. Nothing is swapped in unless every check passes.
 */
export async function verifyExtractedApp({
  appPath,
  expectedBundleId,
  expectedVersion,
  runCommand = runSystemCommand,
  fs = fsPromises,
}) {
  const infoPlist = posix.join(appPath, "Contents", "Info.plist");
  let bundleId;
  let version;
  let executable;
  try {
    [bundleId, version, executable] = await Promise.all([
      readPlistValue(runCommand, infoPlist, "CFBundleIdentifier"),
      readPlistValue(runCommand, infoPlist, "CFBundleShortVersionString"),
      readPlistValue(runCommand, infoPlist, "CFBundleExecutable"),
    ]);
  } catch (error) {
    throw new UpdateRefusedError(
      "bad-bundle",
      "The downloaded update is not a Colony app, so it was not installed.",
      { cause: error },
    );
  }
  if (bundleId !== expectedBundleId) {
    throw new UpdateRefusedError(
      "bundle-id",
      "The downloaded update is not Colony, so it was not installed.",
    );
  }
  if (version !== expectedVersion) {
    throw new UpdateRefusedError(
      "version",
      "The downloaded update is not the version it should be, so it was not installed.",
    );
  }
  try {
    await fs.access(
      posix.join(appPath, "Contents", "MacOS", executable),
      fsConstants.X_OK,
    );
  } catch (error) {
    throw new UpdateRefusedError(
      "bad-bundle",
      "The downloaded update is incomplete, so it was not installed.",
      { cause: error },
    );
  }
  try {
    await runCommand("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      appPath,
    ]);
  } catch (error) {
    throw new UpdateRefusedError(
      "signature",
      "The downloaded update failed its signature check, so it was not installed.",
      { cause: error },
    );
  }
}

/** Streams the archive to disk, hashing as it goes, and refuses a wrong size. */
async function downloadArchive({
  url,
  destination,
  size,
  sha256,
  fetchImpl,
  allowedProtocols,
  onProgress,
}) {
  const controller = new AbortController();
  let stallTimer = null;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), DOWNLOAD_STALL_MS);
  };
  const fail = (code, message, cause) =>
    new UpdateRefusedError(code, message, cause ? { cause } : undefined);
  let output = null;
  try {
    if (!allowedProtocols.includes(new URL(url).protocol)) {
      throw fail(
        "network",
        "The update address is not secure, so nothing was downloaded.",
      );
    }
    armStall();
    let response;
    try {
      response = await fetchImpl(url, { signal: controller.signal });
    } catch (error) {
      throw fail(
        "network",
        "The update could not be downloaded. Check your connection and try again.",
        error,
      );
    }
    if (!response.ok || !response.body) {
      throw fail(
        "network",
        `The update could not be downloaded (status ${response.status}).`,
      );
    }
    const finalProtocol = new URL(response.url || url).protocol;
    if (!allowedProtocols.includes(finalProtocol)) {
      throw fail(
        "network",
        "The update download was redirected to an insecure address, so it was not used.",
      );
    }
    const declared = response.headers?.get?.("content-length");
    if (declared && Number(declared) !== size) {
      throw fail(
        "size",
        "The downloaded update was not the expected size, so it was not installed.",
      );
    }

    const hash = createHash("sha256");
    output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    const outputFailure = new Promise((_, reject) =>
      output.once("error", reject),
    );
    outputFailure.catch(() => {});
    const reader = response.body.getReader();
    let received = 0;
    let lastPercent = -1;
    try {
      while (true) {
        const { done, value } = await Promise.race([
          reader.read(),
          outputFailure,
        ]);
        if (done) break;
        armStall();
        received += value.byteLength;
        if (received > size) {
          await reader.cancel();
          throw fail(
            "size",
            "The downloaded update was not the expected size, so it was not installed.",
          );
        }
        hash.update(value);
        if (!output.write(value)) {
          await Promise.race([
            new Promise((resolve) => output.once("drain", resolve)),
            outputFailure,
          ]);
        }
        const percent = Math.floor((received / size) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          onProgress?.(percent);
        }
      }
    } catch (error) {
      if (error instanceof UpdateRefusedError) throw error;
      if (controller.signal.aborted) {
        throw fail(
          "network",
          "The update download stalled. Check your connection and try again.",
          error,
        );
      }
      throw fail(
        "network",
        "The update could not be downloaded. Check your connection and try again.",
        error,
      );
    }
    await new Promise((resolve, reject) => {
      output.once("error", reject);
      output.end(resolve);
    });
    output = null;
    if (received !== size) {
      throw fail(
        "size",
        "The downloaded update was not the expected size, so it was not installed.",
      );
    }
    if (hash.digest("hex") !== sha256) {
      throw fail(
        "checksum",
        "The downloaded update did not match its checksum, so it was not installed.",
      );
    }
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
    if (output) output.destroy();
  }
}

function mapUnexpected(error, fallback) {
  if (error instanceof UpdateRefusedError) return error;
  return new UpdateRefusedError("unexpected", fallback, { cause: error });
}

/**
 * Updates an unsigned (ad-hoc signed) Mac build by itself: download, verify,
 * extract, check, then swap the bundle in place once the app has quit.
 */
export function createMacSelfUpdater({
  executablePath,
  userDataDir,
  currentVersion,
  requestQuit,
  pid = process.pid,
  uid = process.getuid?.(),
  fetchImpl = globalThis.fetch,
  runCommand = runSystemCommand,
  spawnImpl = spawn,
  fs = fsPromises,
  allowInsecureLoopback = false,
  now = () => Date.now(),
  helperCommands = {},
  relaunchEnv = {},
}) {
  const bundlePath = appBundleFromExecutable(executablePath);
  const updatesDir = userDataDir ? posix.join(userDataDir, "updates") : null;
  const allowedProtocols = allowInsecureLoopback
    ? ["https:", "http:"]
    : ["https:"];
  let staged = null;

  async function assess() {
    if (!bundlePath || !updatesDir) {
      return { ok: false, reason: "not-a-bundle" };
    }
    return assessBundleLocation({ bundlePath, uid, fs });
  }

  async function removeStage(stageDir) {
    if (!stageDir) return;
    await fs.rm(stageDir, { recursive: true, force: true });
  }

  async function discardStaged() {
    const current = staged;
    staged = null;
    if (current) await removeStage(current.stageDir);
  }

  /** Removes stage folders an earlier run left behind (never a fresh one). */
  async function cleanupStale() {
    if (!bundlePath) return;
    const parent = posix.dirname(bundlePath);
    let entries;
    try {
      entries = await fs.readdir(parent);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter(
          (name) =>
            name.startsWith(STAGE_DIR_PREFIX) &&
            posix.join(parent, name) !== staged?.stageDir,
        )
        .map(async (name) => {
          const target = posix.join(parent, name);
          try {
            const info = await fs.stat(target);
            if (now() - info.mtimeMs < STALE_STAGE_MS) return;
            await fs.rm(target, { recursive: true, force: true });
          } catch {
            // A folder we cannot read or remove is left for the next start.
          }
        }),
    );
  }

  /**
   * Downloads, verifies and extracts the update beside the running app.
   * Throws UpdateRefusedError for anything that must not be installed.
   */
  async function stage({ version, archiveUrl, size, sha256, onProgress }) {
    if (!bundlePath) {
      throw new UpdateRefusedError(
        "not-a-bundle",
        "Colony cannot update itself from here.",
      );
    }
    await discardStaged();
    const stageDir = posix.join(
      posix.dirname(bundlePath),
      `${STAGE_DIR_PREFIX}${version}-${randomBytes(4).toString("hex")}`,
    );
    try {
      await fs.mkdir(stageDir, { mode: 0o700 });
      const archivePath = posix.join(stageDir, "update.zip");
      await downloadArchive({
        url: archiveUrl,
        destination: archivePath,
        size,
        sha256,
        fetchImpl,
        allowedProtocols,
        onProgress,
      });

      const extractedDir = posix.join(stageDir, "extracted");
      await fs.mkdir(extractedDir, { mode: 0o700 });
      try {
        await runCommand("/usr/bin/ditto", [
          "-x",
          "-k",
          archivePath,
          extractedDir,
        ]);
      } catch (error) {
        throw new UpdateRefusedError(
          "extract",
          "The downloaded update could not be unpacked, so it was not installed.",
          { cause: error },
        );
      }
      await fs.rm(archivePath, { force: true });

      const entries = (await fs.readdir(extractedDir)).filter(
        (name) => name !== "__MACOSX" && !name.startsWith("."),
      );
      const apps = entries.filter((name) => name.endsWith(".app"));
      if (apps.length !== 1 || entries.length !== 1) {
        throw new UpdateRefusedError(
          "bad-bundle",
          "The downloaded update is not a single Colony app, so it was not installed.",
        );
      }
      const appPath = posix.join(extractedDir, apps[0]);
      const info = await fs.lstat(appPath);
      if (!info.isDirectory()) {
        throw new UpdateRefusedError(
          "bad-bundle",
          "The downloaded update is not a Colony app, so it was not installed.",
        );
      }

      const expectedBundleId = await readPlistValue(
        runCommand,
        posix.join(bundlePath, "Contents", "Info.plist"),
        "CFBundleIdentifier",
      );
      await verifyExtractedApp({
        appPath,
        expectedBundleId,
        expectedVersion: version,
        runCommand,
        fs,
      });
      staged = { stageDir, appPath, version, expectedBundleId };
    } catch (error) {
      await removeStage(stageDir).catch(() => {});
      throw mapUnexpected(
        error,
        "The update could not be prepared, so it was not installed.",
      );
    }
  }

  /**
   * Hands the swap to a detached helper and asks the app to quit. The helper
   * waits for the quit, so one click is one swap.
   */
  async function apply() {
    if (!staged || !bundlePath || !updatesDir) {
      throw new UpdateRefusedError(
        "nothing-staged",
        "There is no prepared update to install.",
      );
    }
    const current = staged;
    let child = null;
    try {
      const location = await assess();
      if (!location.ok) {
        throw new UpdateRefusedError(
          "location",
          "Colony can no longer replace itself from here, so the update was not installed.",
        );
      }
      // The folder sat on disk since it was checked; check it again before use.
      await verifyExtractedApp({
        appPath: current.appPath,
        expectedBundleId: current.expectedBundleId,
        expectedVersion: current.version,
        runCommand,
        fs,
      });

      await fs.mkdir(updatesDir, { recursive: true, mode: 0o700 });
      const resultPath = posix.join(updatesDir, RESULT_FILE);
      await fs.rm(resultPath, { force: true });
      const script = renderSwapHelper({
        pid,
        bundlePath,
        stagedPath: current.appPath,
        previousPath: posix.join(
          current.stageDir,
          "previous",
          posix.basename(bundlePath),
        ),
        stageDir: current.stageDir,
        resultPath,
        logPath: posix.join(updatesDir, LOG_FILE),
        fromVersion: currentVersion,
        toVersion: current.version,
        relaunchEnv,
        ...helperCommands,
      });
      const scriptPath = posix.join(current.stageDir, "swap.sh");
      await fs.writeFile(scriptPath, script, { mode: 0o700 });

      child = spawnImpl("/bin/sh", [scriptPath], {
        detached: true,
        stdio: "ignore",
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      await requestQuit();
    } catch (error) {
      // A helper that is still waiting must not swap later behind the user's back.
      if (child) {
        try {
          child.kill("SIGTERM");
        } catch {
          // Already gone.
        }
      }
      throw mapUnexpected(
        error,
        "The update could not be started, so it was not installed.",
      );
    }
  }

  /** The outcome the helper left for this launch, read once and cleared. */
  async function takeLastResult() {
    if (!updatesDir) return null;
    const resultPath = posix.join(updatesDir, RESULT_FILE);
    let text;
    try {
      text = await fs.readFile(resultPath, "utf8");
    } catch {
      return null;
    }
    await fs.rm(resultPath, { force: true }).catch(() => {});
    try {
      const result = JSON.parse(text);
      if (
        (result.status === "installed" || result.status === "failed") &&
        typeof result.message === "string"
      ) {
        return {
          status: result.status,
          from: String(result.from ?? ""),
          to: String(result.to ?? ""),
          message: result.message,
        };
      }
    } catch {
      // A damaged result file is treated as no result.
    }
    return null;
  }

  return {
    assess,
    stage,
    apply,
    cleanupStale,
    discardStaged,
    takeLastResult,
    hasStaged: () => staged !== null,
  };
}
