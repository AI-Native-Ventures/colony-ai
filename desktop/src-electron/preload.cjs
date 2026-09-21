"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const IPC = Object.freeze({
  HEALTH: "colony-stage0:health:get-default-relay-url",
  IDENTITY_SHARED: "colony-stage0:identity:is-shared-identity",
  IDENTITY_GET: "colony-stage0:identity:get-identity",
  LIFECYCLE_SUBSCRIBE: "colony-stage0:lifecycle:subscribe",
  LIFECYCLE_UNSUBSCRIBE: "colony-stage0:lifecycle:unsubscribe",
  BINDING_STATE: "colony-stage0:binding-state",
  LIFECYCLE_EVENT: "colony-stage0:lifecycle:event",
});
const PUBLIC_ERROR_CODES = new Set([
  "invalid_ipc_sender",
  "untrusted_sender",
  "untrusted_origin",
  "invalid_ipc_payload",
  "host_unavailable",
  "identity_unavailable",
  "identity_manifest_mismatch",
  "invalid_identity_launch",
  "unknown_capability",
  "unknown_method",
  "invalid_payload",
  "cancelled",
  "duplicate_request_id",
  "future_generation",
  "host_busy",
  "renderer_rebound",
  "stale_generation",
  "timeout",
  "renderer_rebinding",
  "renderer_rebound",
  "startup_timeout",
  "rebind_timeout",
  "invalid_json",
  "frame_too_large",
  "protocol_error",
  "error",
]);
const lifecycleListeners = new Set();
let lifecycleSubscription = null;

function errorCodeFromSerialized(error, fallback) {
  const values = [error?.code, error?.message].filter(
    (value) => typeof value === "string",
  );
  for (const value of values) {
    if (PUBLIC_ERROR_CODES.has(value)) return value;
    for (const code of PUBLIC_ERROR_CODES) {
      if (value.endsWith(`: ${code}`)) return code;
    }
  }
  return fallback;
}

function errorFrom(error, fallback = "protocol_error") {
  const code = errorCodeFromSerialized(error, fallback);
  const value = new Error(code);
  value.name = "Stage0Error";
  value.code = code;
  return value;
}

async function invoke(channel, payload) {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (error) {
    throw errorFrom(error);
  }
}

const api = Object.freeze({
  health: Object.freeze({
    getDefaultRelayUrl: () => invoke(IPC.HEALTH, {}),
  }),
  identity: Object.freeze({
    isSharedIdentity: () => invoke(IPC.IDENTITY_SHARED, {}),
    getIdentity: () => invoke(IPC.IDENTITY_GET, {}),
  }),
  onLifecycle: (callback) => {
    if (typeof callback !== "function") {
      throw errorFrom({ code: "invalid_ipc_payload" });
    }
    const listener = (_event, frame) => {
      try {
        callback(Object.freeze(frame));
      } catch {
        // Renderer callbacks are diagnostic and cannot tear down the bridge.
      }
    };
    lifecycleListeners.add({ callback, listener });
    ipcRenderer.on(IPC.LIFECYCLE_EVENT, listener);
    if (!lifecycleSubscription) {
      lifecycleSubscription = invoke(IPC.LIFECYCLE_SUBSCRIBE, {})
        .then((replay) => {
          for (const frame of replay?.frames ?? []) {
            for (const entry of lifecycleListeners) entry.listener(null, frame);
          }
        })
        .catch(() => {
          // The renderer observes the bounded state through bindingState().
        });
    }
    return true;
  },
  bindingState: () => invoke(IPC.BINDING_STATE, {}),
});

contextBridge.exposeInMainWorld("stage0", api);

// Sandbox preload teardown is the final cleanup seam for a renderer reload or
// destroy. No child-process or transport object crosses this boundary.
window.addEventListener(
  "beforeunload",
  () => {
    for (const { listener } of lifecycleListeners) {
      ipcRenderer.removeListener(IPC.LIFECYCLE_EVENT, listener);
    }
    lifecycleListeners.clear();
    lifecycleSubscription = null;
    void invoke(IPC.LIFECYCLE_UNSUBSCRIBE, {}).catch(() => {});
  },
  { once: true },
);
