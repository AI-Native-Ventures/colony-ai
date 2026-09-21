const SAFE_IPC_ERROR_CODES = new Set([
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

export class IpcSecurityError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "IpcSecurityError";
    this.code = code;
  }
}

function securityError(code) {
  return new IpcSecurityError(code);
}

export function publicIpcErrorCode(value, fallback = "protocol_error") {
  return SAFE_IPC_ERROR_CODES.has(value) ? value : fallback;
}

export function isExactPayload(value, expected = {}) {
  if (expected === undefined) return value === undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) return false;
  return expectedKeys.every(
    (key) => Object.hasOwn(value, key) && value[key] === expected[key],
  );
}

export function validateIpcSender({ event, webContents, trustedUrl }) {
  if (!event || !webContents || event.sender !== webContents) {
    throw securityError("invalid_ipc_sender");
  }
  const frame = event.senderFrame;
  const topFrame = frame?.top;
  const isTopFrame =
    frame &&
    (frame === topFrame ||
      (Number.isInteger(frame.routingId) &&
        Number.isInteger(topFrame?.routingId) &&
        frame.routingId === topFrame.routingId &&
        frame.processId === topFrame.processId));
  if (!isTopFrame) {
    throw securityError("untrusted_sender");
  }
  if (typeof trustedUrl !== "string" || frame.url !== trustedUrl) {
    throw securityError("untrusted_origin");
  }
  return frame;
}

export function validateExactIpcCall({
  event,
  webContents,
  trustedUrl,
  payload,
  expectedPayload = {},
}) {
  validateIpcSender({ event, webContents, trustedUrl });
  if (!isExactPayload(payload, expectedPayload)) {
    throw securityError("invalid_ipc_payload");
  }
}

export function isTrustedNavigation({ candidateUrl, trustedUrl, isMainFrame }) {
  return (
    isMainFrame === true &&
    typeof candidateUrl === "string" &&
    candidateUrl === trustedUrl
  );
}
