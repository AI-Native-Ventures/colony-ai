import semver from "semver";

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_METADATA_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/latest/download/update-metadata.json";
// Where a person goes to download Colony by hand. Every manual update card and
// link points here, never at GitHub.
export const UPDATE_DOWNLOAD_URL = "https://colony.global/#download";
export const UPDATE_TEST_METADATA_ENV = "COLONY_UPDATE_TEST_METADATA_URL";

const MAX_METADATA_BYTES = 256 * 1024;
const METADATA_TIMEOUT_MS = 10_000;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
// "manual-required" is not here on purpose: its card names a version, so a
// background check must keep that version current.
const BLOCKED_BACKGROUND_STATES = new Set([
  "checking",
  "available",
  "downloading",
  "installing",
  "ready",
]);

/**
 * The manifest URL for this build. It is always the official release URL,
 * except in a packaged test build (never a release build) that was started
 * with COLONY_UPDATE_TEST_METADATA_URL pointing at a loopback server.
 */
export function resolveUpdateMetadataUrl({ capabilities, env }) {
  const override = env?.[UPDATE_TEST_METADATA_ENV];
  if (
    !override ||
    capabilities?.updateTestOverride !== true ||
    capabilities?.release !== false
  ) {
    return UPDATE_METADATA_URL;
  }
  let url;
  try {
    url = new URL(override);
  } catch {
    url = null;
  }
  if (url?.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      "The update test address must be a loopback address such as http://127.0.0.1:8123/.",
    );
  }
  return url.href;
}

export function isNewerVersion(candidate, current) {
  const candidateVersion = semver.valid(candidate);
  const currentVersion = semver.valid(current);
  if (!candidateVersion || !currentVersion) {
    throw new Error("Update version must use semantic versioning.");
  }
  return semver.gt(candidateVersion, currentVersion);
}

async function readLimitedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_METADATA_BYTES) {
      throw new Error("Update metadata is too large.");
    }
    return JSON.parse(text);
  }

  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_METADATA_BYTES) {
      await reader.cancel();
      throw new Error("Update metadata is too large.");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

function validateManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    manifest.schemaVersion !== 1 ||
    !semver.valid(manifest.version) ||
    !manifest.platforms ||
    typeof manifest.platforms !== "object"
  ) {
    throw new Error("Update metadata is invalid.");
  }
  return { ...manifest, version: semver.valid(manifest.version) };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// Matched by name: the updater may be bundled apart from the module that
// creates the refusal, so `instanceof` cannot be trusted across the two.
function isRefusal(error) {
  return error?.name === "UpdateRefusedError";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The macOS update archive the manifest names, with its size and sha256. */
function findMacArchive(manifest, release) {
  const invalid = () => {
    const error = new Error(
      "The update information is not valid, so it was not installed.",
    );
    error.name = "UpdateRefusedError";
    return error;
  };
  const name = release.updateArchive;
  const expectedName = new RegExp(
    `^Colony-${escapeRegExp(manifest.version)}-arm64-UNSIGNED\\.zip$`,
  );
  if (typeof name !== "string" || !expectedName.test(name)) throw invalid();
  const asset = Array.isArray(manifest.assets)
    ? manifest.assets.find(
        (entry) => entry?.name === name && entry.platform === "darwin-arm64",
      )
    : undefined;
  if (
    asset?.signed !== false ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > MAX_ARCHIVE_BYTES ||
    typeof asset.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(asset.sha256)
  ) {
    throw invalid();
  }
  return { name, size: asset.size, sha256: asset.sha256 };
}

export function createElectronUpdaterService({
  autoUpdater,
  currentVersion,
  currentBuild,
  platformKey,
  metadataUrl = UPDATE_METADATA_URL,
  releaseUrl = UPDATE_DOWNLOAD_URL,
  macSelfUpdater = null,
  fetchImpl = globalThis.fetch,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  checkIntervalMs = UPDATE_CHECK_INTERVAL_MS,
  onStatus = () => {},
}) {
  if (!semver.valid(currentVersion)) {
    throw new Error("The packaged app version must use semantic versioning.");
  }

  let status = { state: "idle" };
  let expectedVersion = null;
  let checkInFlight = null;
  let timer = null;
  let started = false;
  let stopped = false;
  let installRequested = false;
  let macUpdateStaged = false;
  const updaterListeners = [];

  function setStatus(next) {
    if (stopped) return status;
    status = next;
    onStatus(status);
    return status;
  }

  function handleUpdateAvailable(info) {
    if (stopped || !expectedVersion || info?.version !== expectedVersion)
      return;
    setStatus({ state: "available", version: expectedVersion });
  }

  function handleDownloadProgress() {
    if (stopped || !expectedVersion) return;
    setStatus({ state: "downloading" });
  }

  function handleUpdateDownloaded(info) {
    if (stopped || !expectedVersion || info?.version !== expectedVersion)
      return;
    setStatus({ state: "ready" });
  }

  function handleUpdaterError(error) {
    if (stopped) return;
    setStatus({ state: "error", message: errorMessage(error) });
  }

  function attachUpdater() {
    if (!currentBuild?.autoUpdate || !autoUpdater) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    const listeners = [
      [
        "checking-for-update",
        () => {
          if (!stopped) setStatus({ state: "checking" });
        },
      ],
      ["update-available", handleUpdateAvailable],
      ["download-progress", handleDownloadProgress],
      ["update-downloaded", handleUpdateDownloaded],
      [
        "update-cancelled",
        () => {
          if (!stopped)
            setStatus({
              state: "error",
              message: "Update download was cancelled.",
            });
        },
      ],
      ["error", handleUpdaterError],
    ];
    for (const [event, listener] of listeners) {
      autoUpdater.on(event, listener);
      updaterListeners.push([event, listener]);
    }
  }

  async function loadManifest() {
    const response = await fetchImpl(metadataUrl, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Update check failed with status ${response.status}.`);
    }
    return validateManifest(await readLimitedJson(response));
  }

  function manualRequired(version) {
    return setStatus({ state: "manual-required", version, releaseUrl });
  }

  function refusedStatus(error) {
    const message = isRefusal(error)
      ? error.message
      : "The update could not be prepared, so it was not installed.";
    return setStatus({ state: "error", message, releaseUrl });
  }

  // Unsigned Mac build: download, verify and stage the new app, then wait for
  // the person's click. Anything that cannot be proven safe ends in a card with
  // the manual download link, and the running app is never touched.
  async function runMacSelfUpdate(manifest, release) {
    const version = manifest.version;
    const location = await macSelfUpdater.assess();
    if (stopped) return status;
    if (!location.ok) {
      expectedVersion = version;
      return manualRequired(version);
    }
    let archive;
    try {
      archive = findMacArchive(manifest, release);
    } catch (error) {
      expectedVersion = null;
      return refusedStatus(error);
    }
    setStatus({ state: "available", version });
    setStatus({ state: "downloading", percent: 0 });
    try {
      await macSelfUpdater.stage({
        version,
        archiveUrl: new URL(archive.name, new URL("./", metadataUrl)).href,
        size: archive.size,
        sha256: archive.sha256,
        onProgress: (percent) => {
          if (!stopped && status.state === "downloading") {
            setStatus({ state: "downloading", percent });
          }
        },
      });
    } catch (error) {
      expectedVersion = null;
      return refusedStatus(error);
    }
    if (stopped) {
      await macSelfUpdater.discardStaged().catch(() => {});
      return status;
    }
    macUpdateStaged = true;
    return setStatus({ state: "ready", version });
  }

  async function check({ background = false } = {}) {
    if (stopped) return status;
    if (background && BLOCKED_BACKGROUND_STATES.has(status.state))
      return status;
    if (checkInFlight) return checkInFlight;

    // A card that already names a version is refreshed in place: no flicker
    // through "checking", and a failed refresh leaves the card as it was.
    const refreshingManual = background && status.state === "manual-required";
    checkInFlight = (async () => {
      if (!refreshingManual) setStatus({ state: "checking" });
      try {
        const manifest = await loadManifest();
        if (stopped) return status;
        if (!isNewerVersion(manifest.version, currentVersion)) {
          expectedVersion = null;
          setStatus({ state: "up-to-date" });
          return status;
        }

        const release = manifest.platforms[platformKey];
        if (!release) {
          expectedVersion = null;
          setStatus({ state: "unavailable" });
          return status;
        }
        if (
          typeof release.signed !== "boolean" ||
          typeof release.autoUpdate !== "boolean"
        ) {
          throw new Error("Update platform metadata is invalid.");
        }

        const signatureChanged =
          Boolean(currentBuild?.signed) !== Boolean(release.signed);
        if (
          macSelfUpdater &&
          currentBuild?.selfUpdate === true &&
          release.selfUpdate === true &&
          platformKey === "darwin-arm64" &&
          !currentBuild.signed &&
          !signatureChanged
        ) {
          expectedVersion = manifest.version;
          return await runMacSelfUpdate(manifest, release);
        }
        if (
          !currentBuild?.autoUpdate ||
          release.autoUpdate !== true ||
          signatureChanged
        ) {
          expectedVersion = manifest.version;
          setStatus({
            state: "manual-required",
            version: manifest.version,
            releaseUrl,
          });
          return status;
        }

        expectedVersion = manifest.version;
        const result = await autoUpdater.checkForUpdates();
        if (stopped) return status;
        const updateInfo = result?.updateInfo;
        if (!updateInfo || updateInfo.version !== expectedVersion) {
          expectedVersion = null;
          throw new Error(
            "Update metadata does not match the published release.",
          );
        }
        if (!isNewerVersion(updateInfo.version, currentVersion)) {
          expectedVersion = null;
          setStatus({ state: "up-to-date" });
          return status;
        }

        if (
          status.state !== "available" ||
          status.version !== expectedVersion
        ) {
          setStatus({ state: "available", version: expectedVersion });
        }
        void autoUpdater.downloadUpdate().catch(handleUpdaterError);
        return status;
      } catch (error) {
        if (stopped) return status;
        if (refreshingManual) return status;
        expectedVersion = null;
        setStatus({ state: "error", message: errorMessage(error) });
        return status;
      } finally {
        checkInFlight = null;
      }
    })();

    return checkInFlight;
  }

  async function start() {
    if (started || stopped) return status;
    started = true;
    attachUpdater();
    timer = setIntervalImpl(() => {
      void check({ background: true });
    }, checkIntervalMs);
    const lastInstall = await macSelfUpdater
      ?.takeLastResult()
      .catch(() => null);
    void macSelfUpdater?.cleanupStale().catch(() => {});
    if (lastInstall?.status === "failed") {
      // Say so now; the update is tried again at the next interval or Retry.
      setStatus({ state: "error", message: lastInstall.message, releaseUrl });
    } else {
      void check({ background: true });
    }
    return status;
  }

  async function installAndRelaunch() {
    if (stopped || status.state !== "ready" || installRequested) return false;
    if (macUpdateStaged) return installMacUpdate();
    if (!autoUpdater) return false;
    installRequested = true;
    setStatus({ state: "installing" });
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  async function installMacUpdate() {
    installRequested = true;
    setStatus({ state: "installing" });
    try {
      await macSelfUpdater.apply();
      return true;
    } catch (error) {
      installRequested = false;
      macUpdateStaged = false;
      refusedStatus(error);
      return false;
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearIntervalImpl(timer);
    timer = null;
    for (const [event, listener] of updaterListeners) {
      autoUpdater?.removeListener(event, listener);
    }
    updaterListeners.length = 0;
  }

  return {
    check,
    installAndRelaunch,
    start,
    stop,
    snapshot: () => status,
  };
}
