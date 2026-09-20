"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const IPC_HEALTH = "colony-stage0:health:get-default-relay-url";
const PUBLIC_ERROR_CODES = new Set([
  "invalid_ipc_sender",
  "untrusted_sender",
  "untrusted_origin",
  "invalid_ipc_payload",
  "host_unavailable",
  "renderer_rebinding",
  "renderer_rebound",
  "protocol_error",
]);

function errorFrom(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  const code =
    [...PUBLIC_ERROR_CODES].find((candidate) => text.includes(candidate)) ??
    "protocol_error";
  const value = new Error(code);
  value.code = code;
  return value;
}

async function health() {
  try {
    return await ipcRenderer.invoke(IPC_HEALTH, {});
  } catch (error) {
    throw errorFrom(error);
  }
}

if (process.isMainFrame === false) {
  contextBridge.exposeInMainWorld(
    "__colonyStage0Test",
    Object.freeze({ health }),
  );
}
