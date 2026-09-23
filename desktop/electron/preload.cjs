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
