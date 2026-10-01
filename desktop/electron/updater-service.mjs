import semver from "semver";

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_METADATA_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/latest/download/update-metadata.json";
export const UPDATE_RELEASE_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/latest";
export const UPDATE_ASSETS_URL =
  "https://github.com/AI-Native-Ventures/colony-ai/releases/latest/download/";

const MAX_METADATA_BYTES = 256 * 1024;
const METADATA_TIMEOUT_MS = 10_000;
const BLOCKED_BACKGROUND_STATES = new Set([
  "checking",
  "available",
  "downloading",
  "installing",
  "ready",
  "manual-required",
]);

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

export function createElectronUpdaterService({
  autoUpdater,
  currentVersion,
  currentBuild,
  platformKey,
  metadataUrl = UPDATE_METADATA_URL,
  releaseUrl = UPDATE_RELEASE_URL,
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

  async function check({ background = false } = {}) {
    if (stopped) return status;
    if (background && BLOCKED_BACKGROUND_STATES.has(status.state))
      return status;
    if (checkInFlight) return checkInFlight;

    checkInFlight = (async () => {
      setStatus({ state: "checking" });
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
    void check({ background: true });
    timer = setIntervalImpl(() => {
      void check({ background: true });
    }, checkIntervalMs);
    return status;
  }

  async function installAndRelaunch() {
    if (
      stopped ||
      status.state !== "ready" ||
      installRequested ||
      !autoUpdater
    ) {
      return false;
    }
    installRequested = true;
    setStatus({ state: "installing" });
    autoUpdater.quitAndInstall(false, true);
    return true;
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
