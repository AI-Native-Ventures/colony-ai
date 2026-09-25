"use strict";

// Sandboxed preload: the only bridge between the renderer and the Electron
// main process. It forwards generic native requests and pushes; the renderer
// shim (src/shared/api/electronTauriShim.ts) turns them into Tauri's IPC
// contract. No Node or Electron object crosses this boundary.
const { contextBridge, ipcRenderer } = require("electron");

const LABEL_ARG = "--colony-window-label=";
const windowLabel =
  process.argv
    .find((arg) => arg.startsWith(LABEL_ARG))
    ?.slice(LABEL_ARG.length) ?? "main";
const listeners = new Map();
const browserListeners = new Set();
let sequence = 0;

ipcRenderer.on("colony:event", (_event, message) => {
  for (const callback of listeners.values()) {
    try {
      callback(message);
    } catch {
      // A throwing renderer listener must not starve the others.
    }
  }
});

ipcRenderer.on("colony:browser-event", (_event, message) => {
  for (const callback of browserListeners) {
    try {
      callback(message);
    } catch {
      // A throwing browser listener must not starve the others.
    }
  }
});

async function browserRequest(action, payload = {}) {
  const reply = await ipcRenderer.invoke("colony:browser", action, payload);
  if (!reply.ok)
    throw new Error(String(reply.error || "Browser operation failed"));
  return reply.result;
}

contextBridge.exposeInMainWorld("colonyDesktop", {
  platform: process.platform,
  windowLabel,
  request: async (type, payload) => {
    const reply = await ipcRenderer.invoke("colony:request", type, payload);
    if (!reply.ok) throw reply.error;
    return reply.result;
  },
  subscribe: (callback) => {
    if (typeof callback !== "function") throw new Error("Invalid listener");
    const id = ++sequence;
    listeners.set(id, callback);
    return () => listeners.delete(id);
  },
});

contextBridge.exposeInMainWorld("colonyBrowserHost", {
  createTab: (options) => browserRequest("create", options),
  listTabs: () => browserRequest("list"),
  attach: (tabId, bounds, visible) =>
    browserRequest("attach", { tabId, bounds, visible }),
  detach: (tabId) => browserRequest("detach", { tabId }),
  navigate: (tabId, url) => browserRequest("navigate", { tabId, url }),
  back: (tabId) => browserRequest("back", { tabId }),
  forward: (tabId) => browserRequest("forward", { tabId }),
  reload: (tabId) => browserRequest("reload", { tabId }),
  stop: (tabId) => browserRequest("stop", { tabId }),
  setControlOwner: (tabId, controlOwner) =>
    browserRequest("control-owner", { tabId, controlOwner }),
  closeTab: (tabId) => browserRequest("close", { tabId }),
  closeBusiness: (businessId) =>
    browserRequest("close-business", { businessId }),
  closeClient: (businessId, clientId) =>
    browserRequest("close-client", { businessId, clientId }),
  forgetBusiness: (businessId) =>
    browserRequest("forget-business", { businessId }),
  forgetClient: (businessId, clientId) =>
    browserRequest("forget-client", { businessId, clientId }),
  onEvent: (callback) => {
    if (typeof callback !== "function")
      throw new Error("Invalid browser listener");
    browserListeners.add(callback);
    return () => browserListeners.delete(callback);
  },
});
