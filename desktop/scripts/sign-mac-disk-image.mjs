import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The app inside the Mac disk image is signed, notarized and stapled when it is
// packaged. electron-builder then wraps it in a disk image and leaves that
// wrapper unsigned, so the file people download from the website carries no
// signature and no Apple ticket of its own. This script closes that gap for
// signed releases: sign the disk image, have Apple notarize it, staple the
// ticket, and prove the result before the file can be uploaded.

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

/** Longest Apple may take before the step fails instead of hanging the job. */
export const NOTARY_WAIT = "30m";
/** Apple can take a moment to serve a ticket it has just issued. */
export const STAPLE_ATTEMPTS = 5;
export const STAPLE_RETRY_MS = 15_000;

const SIGNED_DISK_IMAGE = /^Colony-.+-arm64-SIGNED\.dmg$/;
const MAC_UPDATE_FEED = "latest-mac.yml";

const REQUIRED_ENVIRONMENT = {
  identity: "COLONY_APPLE_DEVELOPER_IDENTITY",
  notaryKeyPath: "COLONY_APPLE_NOTARY_KEY_PATH",
  notaryKeyId: "COLONY_APPLE_NOTARY_KEY_ID",
  notaryIssuerId: "COLONY_APPLE_NOTARY_ISSUER_ID",
};

/** Read the signing settings the workflow prepared, naming any that are missing. */
export function readSigningEnvironment(env) {
  const missing = Object.values(REQUIRED_ENVIRONMENT).filter(
    (name) => !env[name],
  );
  if (missing.length > 0) {
    throw new Error(
      `Signing the Mac disk image needs ${missing.join(", ")}, which the workflow did not set.`,
    );
  }
  return {
    identity: env[REQUIRED_ENVIRONMENT.identity],
    notaryKeyPath: env[REQUIRED_ENVIRONMENT.notaryKeyPath],
    notaryKeyId: env[REQUIRED_ENVIRONMENT.notaryKeyId],
    notaryIssuerId: env[REQUIRED_ENVIRONMENT.notaryIssuerId],
    keychainPath: env.COLONY_TEMP_KEYCHAIN_PATH || undefined,
  };
}

/** Pick the one signed Mac disk image a release build produces. */
export function findSignedDiskImage(fileNames) {
  const matches = fileNames.filter((name) => SIGNED_DISK_IMAGE.test(name));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one signed Mac disk image, found ${matches.length}.`,
    );
  }
  return matches[0];
}

/** The codesign call that signs the disk image with the Developer ID identity. */
export function signCommand({ diskImagePath, identity, keychainPath }) {
  return [
    "codesign",
    [
      "--force",
      "--timestamp",
      "--sign",
      identity,
      ...(keychainPath ? ["--keychain", keychainPath] : []),
      diskImagePath,
    ],
  ];
}

function notaryCredentials({ notaryKeyPath, notaryKeyId, notaryIssuerId }) {
  return [
    "--key",
    notaryKeyPath,
    "--key-id",
    notaryKeyId,
    "--issuer",
    notaryIssuerId,
  ];
}

/** The notarytool call that submits the disk image and waits a bounded time. */
export function notarizeCommand({ diskImagePath, ...credentials }) {
  return [
    "xcrun",
    [
      "notarytool",
      "submit",
      diskImagePath,
      ...notaryCredentials(credentials),
      "--wait",
      "--timeout",
      NOTARY_WAIT,
      "--output-format",
      "json",
    ],
  ];
}

/** The notarytool call that fetches Apple's reasons for a refused submission. */
export function notaryLogCommand({ submissionId, ...credentials }) {
  return [
    "xcrun",
    ["notarytool", "log", submissionId, ...notaryCredentials(credentials)],
  ];
}

/** Read notarytool's JSON answer. Anything but a clear status is an error. */
export function parseNotaryResult(stdout) {
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error("Apple's notary service returned an unreadable answer.");
  }
  if (typeof result?.status !== "string" || !result.status) {
    throw new Error("Apple's notary service returned no status.");
  }
  return {
    id: typeof result.id === "string" ? result.id : undefined,
    status: result.status,
  };
}

/** The checks that must all pass on the finished disk image. */
export function verifyCommands(diskImagePath) {
  return [
    ["codesign", ["--verify", "--strict", "--verbose=2", diskImagePath]],
    ["xcrun", ["stapler", "validate", diskImagePath]],
    [
      "spctl",
      [
        "--assess",
        "--type",
        "open",
        "--context",
        "context:primary-signature",
        "--verbose=2",
        diskImagePath,
      ],
    ],
  ];
}

/**
 * Stapling rewrites the disk image, so any checksum taken earlier would be
 * wrong. The installer config keeps a signed disk image out of the Mac update
 * feed for that reason; fail here if it ever reappears there.
 */
export function assertFeedOmitsDiskImage(feedText, diskImageName) {
  if (feedText.includes(diskImageName)) {
    throw new Error(
      `${MAC_UPDATE_FEED} lists ${diskImageName}, whose checksum changed when it was stapled.`,
    );
  }
}

async function defaultRun(command, args) {
  return execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024 });
}

async function notarize({ run, diskImagePath, settings, log }) {
  const [command, args] = notarizeCommand({ diskImagePath, ...settings });
  let stdout;
  try {
    ({ stdout } = await run(command, args));
  } catch (error) {
    // notarytool can exit non-zero and still print its JSON answer.
    if (typeof error?.stdout !== "string" || !error.stdout.trim()) throw error;
    stdout = error.stdout;
  }
  const result = parseNotaryResult(stdout);
  if (result.status === "Accepted") return result;

  if (result.id) {
    const [logCommand, logArgs] = notaryLogCommand({
      submissionId: result.id,
      ...settings,
    });
    try {
      const { stdout: reasons } = await run(logCommand, logArgs);
      log(reasons);
    } catch (error) {
      log(`Could not fetch Apple's notary log: ${error.message}`);
    }
  }
  throw new Error(
    `Apple did not notarize the Mac disk image (status: ${result.status}).`,
  );
}

async function staple({ run, diskImagePath, wait, log }) {
  let lastError;
  for (let attempt = 1; attempt <= STAPLE_ATTEMPTS; attempt += 1) {
    try {
      await run("xcrun", ["stapler", "staple", diskImagePath]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === STAPLE_ATTEMPTS) break;
      log(
        `Stapling attempt ${attempt} of ${STAPLE_ATTEMPTS} failed, trying again.`,
      );
      await wait(STAPLE_RETRY_MS);
    }
  }
  throw new Error(
    `Could not staple Apple's ticket to the Mac disk image after ${STAPLE_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

/**
 * Sign, notarize, staple and verify the signed Mac disk image in `releaseDir`.
 * Every step is fatal: a disk image that is not fully proven is never returned.
 */
export async function signMacDiskImage({
  releaseDir,
  env,
  run = defaultRun,
  wait = delay,
  log = console.log,
}) {
  const settings = readSigningEnvironment(env);
  const fileNames = await readdir(releaseDir);
  const diskImageName = findSignedDiskImage(fileNames);
  const diskImagePath = path.join(releaseDir, diskImageName);

  if (fileNames.includes(`${diskImageName}.blockmap`)) {
    throw new Error(
      `${diskImageName}.blockmap describes the disk image before it is stapled and must not be built.`,
    );
  }
  assertFeedOmitsDiskImage(
    await readFile(path.join(releaseDir, MAC_UPDATE_FEED), "utf8"),
    diskImageName,
  );

  await run(...signCommand({ diskImagePath, ...settings }));
  log(`Signed ${diskImageName}.`);
  const { id } = await notarize({ run, diskImagePath, settings, log });
  log(`Apple notarized ${diskImageName}${id ? ` (${id})` : ""}.`);
  await staple({ run, diskImagePath, wait, log });
  log(`Stapled Apple's ticket to ${diskImageName}.`);

  for (const [command, args] of verifyCommands(diskImagePath)) {
    await run(command, args);
  }
  log(`Verified ${diskImageName}: signature, ticket and Gatekeeper.`);
  return diskImagePath;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const releaseDir = path.join(desktop, "dist-electron", "release");
  await access(releaseDir);
  await signMacDiskImage({ releaseDir, env: process.env });
}
