import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_ID_BYTES = 128;
const EXPECTED_SOURCE_REVISION = "ef2aa1ae38fadcc0bc22b8bf6ed96b35933146be";
const EXPECTED_PROFILE_ID = "0000000000000001";
const EXPECTED_REGISTRY_DIGEST =
  "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49";
const EXPECTED_FRAME_TYPES = Object.freeze([
  "HELLO",
  "READY",
  "REHELLO",
  "REBOUND",
  "REQUEST",
  "RESPONSE",
  "EVENT",
  "CANCEL",
]);
const MAIN_FRAME_TYPES = new Set(["HELLO", "REHELLO", "REQUEST", "CANCEL"]);
const HOST_FRAME_TYPES = new Set(["READY", "REBOUND", "RESPONSE", "EVENT"]);
const EXPECTED_FAULT_INPUTS = Object.freeze([
  "host-unavailable",
  "exit-before-ready",
  "malformed-frame",
  "delay-response",
]);

export const DEFAULT_MANIFEST_URL = new URL(
  "../electron-stage0-manifest.json",
  import.meta.url,
);

export class HostProtocolError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "HostProtocolError";
    this.code = code;
  }
}

function protocolError(code) {
  return new HostProtocolError(code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function expect(condition, code) {
  if (!condition) {
    throw protocolError(code);
  }
}

function expectString(
  value,
  code,
  { allowEmpty = false, maxBytes = Infinity } = {},
) {
  expect(typeof value === "string", code);
  expect(allowEmpty || value.length > 0, code);
  expect(Buffer.byteLength(value, "utf8") <= maxBytes, code);
  expect(![...value].some((character) => character.charCodeAt(0) < 0x20), code);
}

function expectPositiveInteger(value, code) {
  expect(Number.isSafeInteger(value) && value > 0, code);
}

function expectExactKeys(value, keys, code = "invalid_schema") {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    expect(allowed.has(key), code);
  }
}

function expectNumber(value, code, minimum = 1) {
  expect(Number.isSafeInteger(value) && value >= minimum, code);
}

function validateNamespace(namespace) {
  expect(isRecord(namespace), "invalid_manifest_namespace");
  const expected = {
    channel: "dev",
    profileId: EXPECTED_PROFILE_ID,
    applicationId: "xyz.ainative.ventures.colony.dev",
    userDataRelativePath: "Colony/dev/0000000000000001",
    keychainService: "xyz.ainative.ventures.colony.dev.0000000000000001",
    helperIdentity: "colony-native.dev.0000000000000001",
    deepLinkScheme: "colony-dev",
  };
  expectExactKeys(
    namespace,
    Object.keys(expected),
    "invalid_manifest_namespace",
  );
  for (const [key, expectedValue] of Object.entries(expected)) {
    expect(namespace[key] === expectedValue, `invalid_manifest_${key}`);
  }
}

function validateProtocol(protocol) {
  expect(isRecord(protocol), "invalid_manifest_protocol");
  const expectedLimits = {
    version: 1,
    framePrefix: "@colony-native:",
    frameLimitBytes: 16 * 1024 * 1024,
    jsonPayloadLimitBytes: 8 * 1024 * 1024,
    jsonDepthLimit: 32,
    binaryPayloadLimitBytes: 8 * 1024 * 1024,
    inFlightLimit: 128,
    subscriptionLimit: 1024,
    outboundQueueLimit: 64,
    defaultDeadlineMs: 10_000,
    shutdownGraceMs: 250,
    rebindAckDeadlineMs: 10_000,
    binaryEncoding: "base64-with-decoded-byte-length",
  };
  for (const [key, expectedValue] of Object.entries(expectedLimits)) {
    expect(protocol[key] === expectedValue, `invalid_manifest_${key}`);
  }
  expect(
    protocol.registryDigest === EXPECTED_REGISTRY_DIGEST,
    "invalid_manifest_registry_digest",
  );
  expectExactKeys(
    protocol.registry,
    ["health-safe"],
    "invalid_manifest_registry",
  );
  expect(
    isRecord(protocol.registry?.["health-safe"]),
    "invalid_manifest_registry",
  );
  expectExactKeys(
    protocol.registry["health-safe"],
    ["request", "event"],
    "invalid_manifest_registry",
  );
  expect(
    protocol.registry["health-safe"].request === "get_default_relay_url" &&
      protocol.registry["health-safe"].event === "host_lifecycle",
    "invalid_manifest_registry",
  );
  expect(
    Array.isArray(protocol.frames) &&
      JSON.stringify(protocol.frames) === JSON.stringify(EXPECTED_FRAME_TYPES),
    "invalid_manifest_frames",
  );
}

export function validateManifest(input) {
  expect(isRecord(input), "invalid_manifest");
  expect(input.stage === "0", "invalid_manifest_stage");
  expect(
    input.sourceRevision === EXPECTED_SOURCE_REVISION,
    "invalid_manifest_source",
  );
  expect(isRecord(input.electron), "invalid_manifest_electron");
  expect(
    input.electron.version === "44.4.3",
    "invalid_manifest_electron_version",
  );
  expect(
    input.electron.packagerVersion === "20.3.0",
    "invalid_manifest_packager_version",
  );
  validateNamespace(input.namespace);
  validateProtocol(input.protocol);
  expect(
    JSON.stringify(input.faultInputs) === JSON.stringify(EXPECTED_FAULT_INPUTS),
    "invalid_manifest_fault_inputs",
  );
  return input;
}

export function loadManifest(source = DEFAULT_MANIFEST_URL) {
  let value = source;
  if (source instanceof URL || typeof source === "string") {
    const path = source instanceof URL ? fileURLToPath(source) : source;
    value = JSON.parse(readFileSync(path, "utf8"));
  }
  validateManifest(value);
  return deepFreeze(clone(value));
}

export const MANIFEST = loadManifest();
export const PROFILE_ID = MANIFEST.namespace.profileId;
export const PROTOCOL = MANIFEST.protocol;
export const FRAME_PREFIX = PROTOCOL.framePrefix;
export const FRAME_TYPES = EXPECTED_FRAME_TYPES;
export const FAULT_INPUTS = EXPECTED_FAULT_INPUTS;
export const REGISTRY_DIGEST = PROTOCOL.registryDigest;
export const LIMITS = Object.freeze({
  frameLimitBytes: PROTOCOL.frameLimitBytes,
  jsonPayloadLimitBytes: PROTOCOL.jsonPayloadLimitBytes,
  jsonDepthLimit: PROTOCOL.jsonDepthLimit,
  binaryPayloadLimitBytes: PROTOCOL.binaryPayloadLimitBytes,
  inFlightLimit: PROTOCOL.inFlightLimit,
  subscriptionLimit: PROTOCOL.subscriptionLimit,
  outboundQueueLimit: PROTOCOL.outboundQueueLimit,
  defaultDeadlineMs: PROTOCOL.defaultDeadlineMs,
  shutdownGraceMs: PROTOCOL.shutdownGraceMs,
  rebindAckDeadlineMs: PROTOCOL.rebindAckDeadlineMs,
});

export function validateId(value, code = "invalid_id") {
  expectString(value, code, { maxBytes: MAX_ID_BYTES });
  return value;
}

export function jsonDepthExceeds(input, maxDepth = LIMITS.jsonDepthLimit) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const byte of input) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (byte === 0x5c) {
        escaped = true;
      } else if (byte === 0x22) {
        inString = false;
      }
      continue;
    }
    if (byte === 0x22) {
      inString = true;
    } else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      if (depth > maxDepth) return true;
    } else if (byte === 0x7d || byte === 0x5d) {
      depth = Math.max(0, depth - 1);
    }
  }
  return false;
}

function validateCommon(frame) {
  expect(isRecord(frame), "invalid_frame");
  expectString(frame.type, "invalid_frame_type", { maxBytes: MAX_ID_BYTES });
  expect(FRAME_TYPES.includes(frame.type), "unknown_frame");
  expect(
    frame.protocolVersion === PROTOCOL.version,
    "invalid_protocol_version",
  );
  validateId(frame.profileId, "invalid_profile_id");
  validateId(frame.sessionId, "invalid_session_id");
  expectPositiveInteger(frame.generationId, "invalid_generation_id");
}

function validateReadyLike(frame) {
  expectExactKeys(
    frame,
    [
      "type",
      "protocolVersion",
      "profileId",
      "sessionId",
      "generationId",
      "payload",
      "registryDigest",
    ],
    "invalid_ready_schema",
  );
  expect(frame.registryDigest === REGISTRY_DIGEST, "invalid_registry_digest");
  if (frame.type === "READY") {
    expect(
      isRecord(frame.payload) &&
        Array.isArray(frame.payload.capabilities) &&
        frame.payload.capabilities.length === 1 &&
        frame.payload.capabilities[0] === "health-safe",
      "invalid_ready_payload",
    );
  } else {
    expect(
      frame.payload === undefined || frame.payload === null,
      "invalid_rebound_payload",
    );
  }
}

function validateResponse(frame) {
  expectExactKeys(
    frame,
    [
      "type",
      "protocolVersion",
      "profileId",
      "sessionId",
      "generationId",
      "requestId",
      "outcome",
      "payload",
      "error",
    ],
    "invalid_response_schema",
  );
  validateId(frame.requestId, "invalid_request_id");
  expect(
    ["ok", "error", "outcome_unknown", "cancelled"].includes(frame.outcome),
    "invalid_outcome",
  );
  if (frame.error !== undefined) {
    expect(isRecord(frame.error), "invalid_error");
    expectExactKeys(frame.error, ["code"], "invalid_error");
    expectString(frame.error.code, "invalid_error_code", {
      maxBytes: MAX_ID_BYTES,
    });
  }
  if (frame.outcome === "ok") {
    expect(frame.error === undefined, "invalid_success_error");
    expect(isRecord(frame.payload), "invalid_success_payload");
  } else {
    expect(frame.error !== undefined, "missing_error");
  }
}

function validateEvent(frame) {
  expectExactKeys(
    frame,
    [
      "type",
      "protocolVersion",
      "profileId",
      "sessionId",
      "generationId",
      "payload",
      "event",
      "sequence",
    ],
    "invalid_event_schema",
  );
  expect(frame.event === "host_lifecycle", "unknown_event");
  expect(isRecord(frame.payload), "invalid_event_payload");
  expect(
    ["ready", "rebound"].includes(frame.payload.state),
    "invalid_event_state",
  );
  expectNumber(frame.sequence, "invalid_sequence");
}

export function validateEnvelope(
  frame,
  { direction = "any", binding = null, expectedGeneration = null } = {},
) {
  validateCommon(frame);
  if (direction === "main") {
    expect(MAIN_FRAME_TYPES.has(frame.type), "unexpected_host_frame");
  } else if (direction === "host") {
    expect(HOST_FRAME_TYPES.has(frame.type), "unexpected_main_frame");
  }
  if (binding) {
    expect(
      frame.profileId === binding.profileId &&
        frame.sessionId === binding.sessionId,
      "wrong_binding",
    );
  }
  if (expectedGeneration !== null) {
    expect(frame.generationId === expectedGeneration, "wrong_generation");
  }
  switch (frame.type) {
    case "HELLO":
      expect(frame.generationId === 1, "invalid_hello_generation");
      validateId(frame.buildId, "missing_build_id");
      expectExactKeys(
        frame,
        [
          "type",
          "protocolVersion",
          "profileId",
          "sessionId",
          "generationId",
          "buildId",
        ],
        "invalid_hello_schema",
      );
      break;
    case "REHELLO":
      validateId(frame.buildId, "missing_build_id");
      expectExactKeys(
        frame,
        [
          "type",
          "protocolVersion",
          "profileId",
          "sessionId",
          "generationId",
          "buildId",
        ],
        "invalid_rehello_schema",
      );
      break;
    case "REQUEST":
      expectExactKeys(
        frame,
        [
          "type",
          "protocolVersion",
          "profileId",
          "sessionId",
          "generationId",
          "requestId",
          "capability",
          "method",
          "payload",
        ],
        "invalid_request_schema",
      );
      validateId(frame.requestId, "invalid_request_id");
      expectString(frame.capability, "invalid_capability", {
        maxBytes: MAX_ID_BYTES,
      });
      expectString(frame.method, "invalid_method", { maxBytes: MAX_ID_BYTES });
      expect(isRecord(frame.payload), "invalid_request_payload");
      break;
    case "CANCEL":
      expectExactKeys(
        frame,
        [
          "type",
          "protocolVersion",
          "profileId",
          "sessionId",
          "generationId",
          "requestId",
        ],
        "invalid_cancel_schema",
      );
      validateId(frame.requestId, "invalid_request_id");
      break;
    case "READY":
    case "REBOUND":
      validateReadyLike(frame);
      break;
    case "RESPONSE":
      validateResponse(frame);
      break;
    case "EVENT":
      validateEvent(frame);
      break;
    default:
      throw protocolError("unknown_frame");
  }
  return frame;
}

export function validateHealthRequest({ capability, method, payload }) {
  expect(capability === "health-safe", "unknown_capability");
  expect(method === "get_default_relay_url", "unknown_method");
  expect(
    isRecord(payload) && Object.keys(payload).length === 0,
    "invalid_payload",
  );
}

export function encodeFrame(frame, { direction = "any" } = {}) {
  validateEnvelope(frame, { direction });
  const json = JSON.stringify(frame);
  const jsonBytes = Buffer.byteLength(json, "utf8");
  expect(jsonBytes <= LIMITS.jsonPayloadLimitBytes, "json_too_large");
  const total = Buffer.byteLength(FRAME_PREFIX, "utf8") + jsonBytes + 1;
  expect(total <= LIMITS.frameLimitBytes, "frame_too_large");
  return Buffer.from(`${FRAME_PREFIX}${json}\n`, "utf8");
}

export function decodeFrame(input, { direction = "any", binding = null } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  expect(bytes.length + 1 <= LIMITS.frameLimitBytes, "frame_too_large");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw protocolError("invalid_utf8");
  }
  expect(text.startsWith(FRAME_PREFIX), "invalid_prefix");
  const jsonText = text.slice(FRAME_PREFIX.length);
  expect(jsonText.length > 0, "invalid_json");
  expect(
    Buffer.byteLength(jsonText, "utf8") <= LIMITS.jsonPayloadLimitBytes,
    "json_too_large",
  );
  expect(
    !jsonDepthExceeds(Buffer.from(jsonText), LIMITS.jsonDepthLimit),
    "json_too_deep",
  );
  let frame;
  try {
    frame = JSON.parse(jsonText);
  } catch {
    throw protocolError("invalid_json");
  }
  return validateEnvelope(frame, { direction, binding });
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  constructor({
    frameLimitBytes = LIMITS.frameLimitBytes,
    direction = "any",
    binding = null,
  } = {}) {
    this.frameLimitBytes = frameLimitBytes;
    this.direction = direction;
    this.binding = binding;
  }

  setBinding(binding) {
    this.binding = binding;
  }

  push(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const frames = [];
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(0x0a, offset);
      if (newline < 0) {
        const remaining = bytes.length - offset;
        if (this.#buffer.length + remaining >= this.frameLimitBytes) {
          throw protocolError("frame_too_large");
        }
        if (remaining > 0) {
          this.#buffer = Buffer.concat([this.#buffer, bytes.subarray(offset)]);
        }
        break;
      }
      const chunkLine = bytes.subarray(offset, newline);
      const line =
        this.#buffer.length === 0
          ? chunkLine
          : Buffer.concat([this.#buffer, chunkLine]);
      this.#buffer = Buffer.alloc(0);
      if (line.length === 0) {
        throw protocolError("invalid_json");
      }
      if (line.length + 1 > this.frameLimitBytes) {
        throw protocolError("frame_too_large");
      }
      frames.push(
        decodeFrame(line, { direction: this.direction, binding: this.binding }),
      );
      offset = newline + 1;
    }
    return frames;
  }

  finish() {
    if (this.#buffer.length !== 0) {
      throw protocolError("invalid_json");
    }
  }
}

export function createBinding({
  profileId = PROFILE_ID,
  sessionId,
  generationId,
}) {
  validateId(profileId, "invalid_profile_id");
  validateId(sessionId, "invalid_session_id");
  expectPositiveInteger(generationId, "invalid_generation_id");
  return Object.freeze({ profileId, sessionId, generationId });
}

export function createHello({ profileId = PROFILE_ID, sessionId, buildId }) {
  const binding = createBinding({ profileId, sessionId, generationId: 1 });
  validateId(buildId, "missing_build_id");
  return {
    type: "HELLO",
    protocolVersion: PROTOCOL.version,
    ...binding,
    buildId,
  };
}

export function createRehello({
  profileId = PROFILE_ID,
  sessionId,
  generationId,
  buildId,
}) {
  const binding = createBinding({ profileId, sessionId, generationId });
  validateId(buildId, "missing_build_id");
  return {
    type: "REHELLO",
    protocolVersion: PROTOCOL.version,
    ...binding,
    buildId,
  };
}

export function createRequest({
  profileId = PROFILE_ID,
  sessionId,
  generationId,
  requestId,
  capability,
  method,
  payload,
}) {
  const binding = createBinding({ profileId, sessionId, generationId });
  validateId(requestId, "invalid_request_id");
  validateHealthRequest({ capability, method, payload });
  return {
    type: "REQUEST",
    protocolVersion: PROTOCOL.version,
    ...binding,
    requestId,
    capability,
    method,
    payload,
  };
}

export function createCancel({
  profileId = PROFILE_ID,
  sessionId,
  generationId,
  requestId,
}) {
  const binding = createBinding({ profileId, sessionId, generationId });
  validateId(requestId, "invalid_request_id");
  return {
    type: "CANCEL",
    protocolVersion: PROTOCOL.version,
    ...binding,
    requestId,
  };
}

export function redactedProtocolCode(error, fallback = "protocol_error") {
  if (error instanceof HostProtocolError) return error.code;
  if (
    error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]+$/.test(error.code)
  ) {
    return error.code;
  }
  return fallback;
}
