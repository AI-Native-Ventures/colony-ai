import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  MAX_ACTIVE_BROWSER_DOWNLOADS,
  MAX_BROWSER_DOWNLOAD_BYTES,
  browserPartition,
  downloadFileName,
} from "./browser-host-policy.mjs";

export function createBrowserSessionStore({
  session,
  userDataPath,
  maxActiveDownloads = MAX_ACTIVE_BROWSER_DOWNLOADS,
  maxDownloadBytes = MAX_BROWSER_DOWNLOAD_BYTES,
  getTabForContents,
  emitTabEvent,
  hasTab,
}) {
  const setupBySession = new WeakMap();
  const activeDownloads = new Map();

  function configureDownloads(browserSession, partitionHash) {
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

      const directory = path.join(
        userDataPath,
        "browser-downloads",
        partitionHash,
      );
      const destination = path.join(
        directory,
        downloadFileName(item.getFilename()),
      );
      try {
        item.setSavePath(destination);
      } catch {
        event.preventDefault();
        item.cancel();
        emitTabEvent(tab, "download-blocked", { reason: "save-failed" });
        return;
      }
      activeDownloads.set(item, tab);
      emitTabEvent(tab, "download", { state: "started" });

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
        if (hasTab(tab.id))
          emitTabEvent(tab, "download", {
            state:
              state === "completed"
                ? "completed"
                : state === "interrupted"
                  ? "interrupted"
                  : "cancelled",
          });
      });
    });
  }

  async function forScope(businessId, clientId) {
    const partition = browserPartition(businessId, clientId);
    const browserSession = session.fromPartition(partition);
    const partitionHash = partition.slice("persist:colony-browser-".length);
    let setup = setupBySession.get(browserSession);
    if (!setup) {
      setup = (async () => {
        const directory = path.join(
          userDataPath,
          "browser-downloads",
          partitionHash,
        );
        await mkdir(directory, { recursive: true });
        browserSession.setPermissionRequestHandler(
          (_contents, _permission, callback) => callback(false),
        );
        browserSession.setPermissionCheckHandler(() => false);
        browserSession.setDevicePermissionHandler?.(() => false);
        browserSession.setDisplayMediaRequestHandler?.((_request, callback) =>
          callback(null),
        );
        configureDownloads(browserSession, partitionHash);
      })();
      setupBySession.set(browserSession, setup);
    }
    try {
      await setup;
    } catch (error) {
      if (setupBySession.get(browserSession) === setup)
        setupBySession.delete(browserSession);
      throw error;
    }
    return browserSession;
  }

  function cancelTabDownloads(tabId) {
    for (const [item, tab] of activeDownloads) {
      if (tab.id !== tabId) continue;
      activeDownloads.delete(item);
      item.cancel();
    }
  }

  return { forScope, cancelTabDownloads };
}
