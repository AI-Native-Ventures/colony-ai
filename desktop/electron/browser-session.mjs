import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_ACTIVE_BROWSER_DOWNLOADS,
  MAX_BROWSER_DOWNLOAD_BYTES,
  MAX_BROWSER_PROFILES,
  browserProfileIdentity,
  isBlockedBrowserUrl,
  numberedDownloadName,
  safeDownloadName,
} from "./browser-host-policy.mjs";

const PROFILE_MANIFEST_VERSION = 1;
const PROFILE_HASH_PATTERN = /^[a-f0-9]{40}$/u;
/** How many "name (n).ext" spellings are tried before a download is refused. */
const MAX_DOWNLOAD_NAME_ATTEMPTS = 200;
/** Finished downloads that can still be revealed in the file manager. */
const MAX_REMEMBERED_DOWNLOADS = 50;

/**
 * Create the destination file exclusively (so two downloads, or an existing
 * file, can never be overwritten) and return its path. The empty file is ours:
 * it is removed again if the download does not complete.
 */
function reserveDownloadPath(directory, fileName) {
  const safeName = safeDownloadName(fileName);
  mkdirSync(directory, { recursive: true });
  for (let attempt = 0; attempt < MAX_DOWNLOAD_NAME_ATTEMPTS; attempt += 1) {
    const candidate = path.join(
      directory,
      numberedDownloadName(safeName, attempt),
    );
    try {
      closeSync(openSync(candidate, "wx", 0o600));
      return candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("No free download file name");
}

export function createBrowserSessionStore({
  session,
  userDataPath,
  maxProfiles = MAX_BROWSER_PROFILES,
  maxActiveDownloads = MAX_ACTIVE_BROWSER_DOWNLOADS,
  maxDownloadBytes = MAX_BROWSER_DOWNLOAD_BYTES,
  /** The person's Downloads folder; downloads are saved here and nowhere else. */
  downloadsPath,
  /** Reveal a saved file in the system file manager. */
  showItemInFolder = () => {},
  getTabForContents,
  emitTabEvent,
  hasTab,
}) {
  if (typeof downloadsPath !== "string" || !path.isAbsolute(downloadsPath))
    throw new Error("Browser downloads need an absolute downloads folder");
  const setupBySession = new WeakMap();
  const sessionsByProfile = new Map();
  const activeTabsByProfile = new Map();
  const activeDownloads = new Map();
  const savedDownloads = new Map();
  const manifestPath = path.join(userDataPath, "browser-profiles.json");
  let profiles;
  let manifestLoad;
  let registryQueue = Promise.resolve();

  function inRegistryQueue(operation) {
    const result = registryQueue.then(operation, operation);
    registryQueue = result.catch(() => undefined);
    return result;
  }

  async function loadProfiles() {
    if (profiles) return profiles;
    if (!manifestLoad) {
      manifestLoad = (async () => {
        let source;
        try {
          source = await readFile(manifestPath, "utf8");
        } catch (error) {
          if (error?.code === "ENOENT") {
            profiles = new Map();
            return profiles;
          }
          throw error;
        }
        const manifest = JSON.parse(source);
        if (
          manifest?.version !== PROFILE_MANIFEST_VERSION ||
          !Array.isArray(manifest.profiles) ||
          manifest.profiles.length > maxProfiles
        ) {
          throw new Error(
            "Browser profile registry is invalid or over capacity",
          );
        }
        const loaded = new Map();
        for (const record of manifest.profiles) {
          if (
            !record ||
            typeof record !== "object" ||
            !PROFILE_HASH_PATTERN.test(record.profileHash) ||
            !PROFILE_HASH_PATTERN.test(record.businessHash) ||
            loaded.has(record.profileHash)
          ) {
            throw new Error("Browser profile registry is invalid");
          }
          loaded.set(record.profileHash, {
            businessHash: record.businessHash,
          });
        }
        profiles = loaded;
        return profiles;
      })();
    }
    return manifestLoad;
  }

  async function persistProfiles(nextProfiles) {
    await mkdir(userDataPath, { recursive: true });
    const temporaryPath = path.join(
      userDataPath,
      `.browser-profiles-${randomUUID()}.tmp`,
    );
    const manifest = {
      version: PROFILE_MANIFEST_VERSION,
      profiles: [...nextProfiles].map(([profileHash, record]) => ({
        profileHash,
        businessHash: record.businessHash,
      })),
    };
    try {
      await writeFile(temporaryPath, JSON.stringify(manifest), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, manifestPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
    profiles = nextProfiles;
    manifestLoad = Promise.resolve(profiles);
  }

  function configureDownloads(browserSession, profileHash) {
    browserSession.on("will-download", (event, item, webContents) => {
      const tab = getTabForContents(webContents.id);
      if (!tab || activeDownloads.size >= maxActiveDownloads) {
        event.preventDefault();
        if (tab)
          emitTabEvent(tab, "download-blocked", { reason: "download-limit" });
        return;
      }

      const cancelForSize = (preventDefault = false) => {
        if (preventDefault) event.preventDefault();
        item.cancel();
        emitTabEvent(tab, "download-blocked", {
          reason: "download-size-limit",
        });
      };
      if (item.getTotalBytes() > maxDownloadBytes) {
        cancelForSize(true);
        return;
      }

      let destination;
      try {
        destination = reserveDownloadPath(downloadsPath, item.getFilename());
        item.setSavePath(destination);
      } catch {
        event.preventDefault();
        item.cancel();
        if (destination) {
          try {
            unlinkSync(destination);
          } catch {
            // Already gone.
          }
        }
        emitTabEvent(tab, "download-blocked", { reason: "save-failed" });
        return;
      }
      const downloadId = randomUUID();
      const fileName = path.basename(destination);
      activeDownloads.set(item, { tab, profileHash });
      emitTabEvent(tab, "download", {
        state: "started",
        downloadId,
        fileName,
      });

      item.on("updated", () => {
        if (
          activeDownloads.has(item) &&
          item.getReceivedBytes() > maxDownloadBytes
        ) {
          cancelForSize();
        }
      });
      item.once("done", (_event, state) => {
        activeDownloads.delete(item);
        const completed = state === "completed";
        if (completed) {
          savedDownloads.set(downloadId, destination);
          while (savedDownloads.size > MAX_REMEMBERED_DOWNLOADS)
            savedDownloads.delete(savedDownloads.keys().next().value);
        } else {
          // Never leave our placeholder or a partial file in Downloads.
          try {
            unlinkSync(destination);
          } catch {
            // Already gone.
          }
        }
        if (hasTab(tab.id))
          emitTabEvent(tab, "download", {
            state: completed
              ? "completed"
              : state === "interrupted"
                ? "interrupted"
                : "cancelled",
            downloadId,
            fileName,
          });
      });
    });
  }

  function ensureSessionSetup(browserSession, profileHash) {
    let setup = setupBySession.get(browserSession);
    if (!setup) {
      setup = Promise.resolve().then(async () => {
        browserSession.setPermissionRequestHandler(
          (_contents, _permission, callback) => callback(false),
        );
        browserSession.setPermissionCheckHandler(() => false);
        browserSession.setDevicePermissionHandler?.(() => false);
        browserSession.setDisplayMediaRequestHandler?.((_request, callback) =>
          callback(null),
        );
        // Every page load, redirect hop and subresource of this profile: link-local
        // and cloud metadata hosts are never reachable from a page.
        browserSession.webRequest.onBeforeRequest(
          { urls: ["<all_urls>"] },
          (details, callback) =>
            callback({ cancel: isBlockedBrowserUrl(details.url) }),
        );
        configureDownloads(browserSession, profileHash);
      });
      // Keep a rejected setup promise too. Retrying partial setup could attach
      // duplicate permission or download handlers to the same Electron session.
      setupBySession.set(browserSession, setup);
    }
    return setup;
  }

  async function forScope(businessId, clientId, pendingTabId) {
    const identity = browserProfileIdentity(businessId, clientId);
    return inRegistryQueue(async () => {
      const currentProfiles = await loadProfiles();
      const existingSession = sessionsByProfile.get(identity.profileHash);
      if (
        !currentProfiles.has(identity.profileHash) &&
        currentProfiles.size >= maxProfiles
      )
        throw new Error(
          "Browser profile limit reached. Close and explicitly forget an unused profile, then restart the app.",
        );
      if (!existingSession && sessionsByProfile.size >= maxProfiles)
        throw new Error(
          "Browser session limit reached. Restart the app before opening another profile.",
        );
      if (!currentProfiles.has(identity.profileHash)) {
        const nextProfiles = new Map(currentProfiles);
        nextProfiles.set(identity.profileHash, {
          businessHash: identity.businessHash,
        });
        await persistProfiles(nextProfiles);
      } else if (
        currentProfiles.get(identity.profileHash).businessHash !==
        identity.businessHash
      ) {
        throw new Error("Browser profile registry hash collision");
      }

      let browserSession = existingSession;
      if (!browserSession) {
        browserSession = session.fromPartition(identity.partition);
        if (!browserSession)
          throw new Error("Electron did not create the browser session");
        sessionsByProfile.set(identity.profileHash, browserSession);
      }
      await ensureSessionSetup(browserSession, identity.profileHash);
      if (pendingTabId) retainTab(identity.profileHash, pendingTabId);
      return {
        session: browserSession,
        profileHash: identity.profileHash,
        businessHash: identity.businessHash,
      };
    });
  }

  function retainTab(profileHash, tabId) {
    const tabIds = activeTabsByProfile.get(profileHash) ?? new Set();
    tabIds.add(tabId);
    activeTabsByProfile.set(profileHash, tabIds);
  }

  function releaseTab(profileHash, tabId) {
    const tabIds = activeTabsByProfile.get(profileHash);
    if (!tabIds) return;
    tabIds.delete(tabId);
    if (tabIds.size === 0) activeTabsByProfile.delete(profileHash);
  }

  function cancelTabDownloads(tabId) {
    for (const [item, download] of activeDownloads) {
      if (download.tab.id === tabId) item.cancel();
    }
  }

  function assertProfileCanBeForgotten(profileHash) {
    if (activeTabsByProfile.has(profileHash))
      throw new Error(
        "Close all browser tabs for this profile before forgetting it",
      );
    for (const download of activeDownloads.values()) {
      if (download.profileHash === profileHash)
        throw new Error(
          "Wait for browser downloads to stop before forgetting this profile",
        );
    }
  }

  async function clearProfileData(profileHash) {
    assertProfileCanBeForgotten(profileHash);
    let browserSession = sessionsByProfile.get(profileHash);
    if (!browserSession) {
      if (sessionsByProfile.size >= maxProfiles)
        throw new Error(
          "Restart the app before forgetting a profile that has not been opened in this process",
        );
      browserSession = session.fromPartition(
        `persist:colony-browser-${profileHash}`,
      );
      if (!browserSession)
        throw new Error(
          "Electron did not create the browser session for cleanup",
        );
      sessionsByProfile.set(profileHash, browserSession);
    }
    await browserSession.clearStorageData();
    await browserSession.clearCache();
    await browserSession.clearAuthCache();
    // Files already saved to the person's Downloads folder are theirs and are
    // never deleted when a profile is forgotten.
  }

  async function forgetProfilesLocked(profileHashes) {
    const currentProfiles = await loadProfiles();
    const selected = [...new Set(profileHashes)].filter((profileHash) =>
      currentProfiles.has(profileHash),
    );
    for (const profileHash of selected)
      assertProfileCanBeForgotten(profileHash);
    for (const profileHash of selected) await clearProfileData(profileHash);
    if (selected.length > 0) {
      const nextProfiles = new Map(currentProfiles);
      for (const profileHash of selected) nextProfiles.delete(profileHash);
      await persistProfiles(nextProfiles);
    }
    return { forgottenProfiles: selected.length };
  }

  function forgetProfiles(profileHashes) {
    return inRegistryQueue(() => forgetProfilesLocked(profileHashes));
  }

  async function forgetBusiness(businessId) {
    const { businessHash } = browserProfileIdentity(businessId, null);
    return inRegistryQueue(async () => {
      const currentProfiles = await loadProfiles();
      const profileHashes = [...currentProfiles]
        .filter(([, record]) => record.businessHash === businessHash)
        .map(([profileHash]) => profileHash);
      return forgetProfilesLocked(profileHashes);
    });
  }

  /** Wait (bounded) for cancelled downloads of these profiles to finish. */
  async function waitForDownloadsToStop(profileHashes, timeoutMs = 3_000) {
    const wanted = new Set(profileHashes);
    const deadline = Date.now() + timeoutMs;
    while (
      [...activeDownloads.values()].some((download) =>
        wanted.has(download.profileHash),
      ) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Forget every stored profile: sign out and account delete. Callers close the
   * tabs first; downloads they cancelled get a moment to stop. Files already
   * saved to Downloads stay, as for any forget.
   */
  function forgetAll() {
    return inRegistryQueue(async () => {
      const profileHashes = [...(await loadProfiles()).keys()];
      await waitForDownloadsToStop(profileHashes);
      return forgetProfilesLocked(profileHashes);
    });
  }

  async function forgetClient(businessId, clientId) {
    const { profileHash } = browserProfileIdentity(businessId, clientId);
    return forgetProfiles([profileHash]);
  }

  /** Show a finished download in the file manager. Ids are opaque to callers. */
  function revealDownload(downloadId) {
    const destination =
      typeof downloadId === "string" ? savedDownloads.get(downloadId) : null;
    if (!destination)
      throw new Error("That download is no longer available to show");
    showItemInFolder(destination);
    return { revealed: true };
  }

  return {
    forScope,
    revealDownload,
    retainTab,
    releaseTab,
    cancelTabDownloads,
    forgetBusiness,
    forgetClient,
    forgetAll,
  };
}
