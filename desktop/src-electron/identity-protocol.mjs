// Pure production-v2 identity schema/registry codec. This mirrors
// desktop/src-native-host/src/v2.rs::registry_document_for(true) at the
// reviewed 83234390 source; it intentionally owns no transport or process
// lifecycle behavior.

import { createHash } from "node:crypto";

const MAX_ID_BYTES = 128;
const MAX_ROOT_BYTES = 4096;
const MAX_RELAY_URL_BYTES = 2048;
const MAX_METADATA_STRING_BYTES = 128;
const MAX_METADATA_BYTES = 1024;

export const IDENTITY_PROTOCOL_VERSION = 2;
export const TEST_V2_REGISTRY_DIGEST =
  "1032c9f29dee5495099ebf951133bf3cf80c144e39476af39bb67fe62dee3565";
export const V1_REGISTRY_DIGEST =
  "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49";
export const PRODUCTION_REGISTRY_DIGEST =
  "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";
export const PRODUCTION_IDENTITY_MANIFEST_DIGEST =
  "ff46bc9729c8e3dce602d5e1effb84d5aa6fff0b00231404c340b8e61aaa1e3d";

export const PRODUCTION_CAPABILITIES = Object.freeze([
  "health-safe",
  "identity-mode",
  "identity-read",
]);
export const IDENTITY_STORAGE_VALUES = Object.freeze([
  "ephemeral",
  "system-keyring",
  "local-file",
  "environment",
]);
export const IDENTITY_METADATA_FIELDS = Object.freeze([
  "display_name",
  "locked",
  "lost",
  "pubkey",
  "reset_failed",
  "storage",
]);
export const IDENTITY_ERROR_CODES = Object.freeze([
  "cancelled",
  "duplicate_request_id",
  "future_generation",
  "host_busy",
  "host_unavailable",
  "identity_unavailable",
  "invalid_payload",
  "renderer_rebound",
  "stale_generation",
  "timeout",
  "unknown_capability",
  "unknown_method",
]);
export const IDENTITY_LIMITS = Object.freeze({
  binaryPayloadLimitBytes: 8 * 1024 * 1024,
  defaultDeadlineMs: 10_000,
  frameLimitBytes: 16 * 1024 * 1024,
  inFlightLimit: 128,
  jsonDepthLimit: 32,
  jsonPayloadLimitBytes: 8 * 1024 * 1024,
  outboundQueueLimit: 64,
  rebindAckDeadlineMs: 10_000,
  shutdownGraceMs: 250,
});
export const IDENTITY_METADATA_LIMITS = Object.freeze({
  maxBytes: MAX_METADATA_BYTES,
  maxStringBytes: MAX_METADATA_STRING_BYTES,
});

export const PRODUCTION_IDENTITY_PROFILES = Object.freeze({
  normal: Object.freeze({
    profileId: "0000000000000001",
    userDataRelativePath: "Colony/dev/0000000000000001/normal",
  }),
  instrumented: Object.freeze({
    profileId: "0000000000000001.instrumented",
    userDataRelativePath: "Colony/dev/0000000000000001/instrumented",
  }),
});

const FRAME_TYPES = Object.freeze([
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
const LIFECYCLE_STATES = new Set(["ready", "rebound"]);
const IDENTITY_ERROR_CODE_SET = new Set(IDENTITY_ERROR_CODES);
const STORAGE_SET = new Set(IDENTITY_STORAGE_VALUES);
const REQUESTS = Object.freeze({
  "health-safe:get_default_relay_url": Object.freeze({
    capability: "health-safe",
    method: "get_default_relay_url",
    responseSchema: "relay-url",
  }),
  "identity-mode:is_shared_identity": Object.freeze({
    capability: "identity-mode",
    method: "is_shared_identity",
    responseSchema: "boolean",
  }),
  "identity-read:get_identity": Object.freeze({
    capability: "identity-read",
    method: "get_identity",
    responseSchema: "identity-snapshot",
  }),
});

export class IdentityProtocolError extends Error {
  constructor(code) {
    super(code);
    this.name = "IdentityProtocolError";
    this.code = code;
  }
}

function fail(code) {
  throw new IdentityProtocolError(code);
}

function expect(condition, code) {
  if (!condition) fail(code);
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Object.hasOwn(value, key);
}

function expectExactKeys(value, requiredKeys, code) {
  expect(isRecord(value), code);
  const allowed = new Set(requiredKeys);
  const actual = Object.keys(value);
  expect(actual.length === requiredKeys.length, code);
  for (const key of actual) {
    expect(allowed.has(key), code);
  }
}

function expectOptionalKeys(value, requiredKeys, optionalKeys, code) {
  expect(isRecord(value), code);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const actual = Object.keys(value);
  expect(
    actual.every((key) => allowed.has(key)),
    code,
  );
  for (const key of requiredKeys) expect(hasOwn(value, key), code);
  expect(actual.length >= requiredKeys.length, code);
}

function expectString(value, code, { allowEmpty = false, maxBytes } = {}) {
  expect(typeof value === "string", code);
  expect(allowEmpty || value.length > 0, code);
  expect(
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 0x20 || codePoint === 0x7f;
    }),
    code,
  );
  if (maxBytes !== undefined) {
    expect(Buffer.byteLength(value, "utf8") <= maxBytes, code);
  }
}

function expectPositiveInteger(value, code) {
  expect(Number.isSafeInteger(value) && value > 0, code);
}

function expectDigest(value, code) {
  expect(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), code);
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function isAbsolutePath(value) {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value) ||
    value.startsWith("//")
  );
}

function hasParentPathSegment(value) {
  return normalizePath(value)
    .split("/")
    .some((segment) => segment === "..");
}

function hasPathSuffix(value, suffix) {
  const pathSegments = normalizePath(value).split("/").filter(Boolean);
  const suffixSegments = suffix.split("/");
  return (
    pathSegments.length >= suffixSegments.length &&
    pathSegments.slice(-suffixSegments.length).join("/") === suffix
  );
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

/**
 * Canonical JSON used by the Rust registry digest: recursive UTF-8 key order,
 * preserved array order, and no insignificant whitespace.
 */
export function canonicalizeJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    expect(Number.isFinite(value), "invalid_canonical_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((child) => canonicalizeJson(child)).join(",")}]`;
  }
  expect(isRecord(value), "invalid_canonical_value");
  const entries = Object.entries(value).sort(([left], [right]) =>
    compareUtf8(left, right),
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalizeJson(child)}`)
    .join(",")}}`;
}

export function digestJson(value) {
  return createHash("sha256")
    .update(Buffer.from(canonicalizeJson(value), "utf8"))
    .digest("hex");
}

const PRODUCTION_REGISTRY_SOURCE = {
  capabilities: {
    ready: PRODUCTION_CAPABILITIES,
  },
  entries: {
    get_default_relay_url: {
      authorization: "bound-session",
      binary: false,
      capability: "health-safe",
      deadlineClass: "standard",
      deadlineMs: 10_000,
      direction: "renderer-to-host",
      eventSchema: "host-lifecycle-event",
      requestSchema: "empty-object",
      responseSchema: "relay-url",
      sideEffect: "none",
    },
    get_identity: {
      authorization: "bound-session",
      binary: false,
      capability: "identity-read",
      deadlineClass: "standard",
      deadlineMs: 10_000,
      direction: "renderer-to-host",
      eventSchema: "host-lifecycle-event",
      requestSchema: "empty-object",
      responseSchema: "identity-snapshot",
      sideEffect: "none",
    },
    is_shared_identity: {
      authorization: "bound-session",
      binary: false,
      capability: "identity-mode",
      deadlineClass: "standard",
      deadlineMs: 10_000,
      direction: "renderer-to-host",
      eventSchema: "host-lifecycle-event",
      requestSchema: "empty-object",
      responseSchema: "boolean",
      sideEffect: "none",
    },
  },
  limits: {
    binaryPayloadLimitBytes: 8 * 1024 * 1024,
    defaultDeadlineMs: 10_000,
    frameLimitBytes: 16 * 1024 * 1024,
    inFlightLimit: 128,
    jsonDepthLimit: 32,
    jsonPayloadLimitBytes: 8 * 1024 * 1024,
    outboundQueueLimit: 64,
    rebindAckDeadlineMs: 10_000,
    shutdownGraceMs: 250,
  },
  outbound: {
    lifecycleEvent: {
      event: "host_lifecycle",
      schema: "host-lifecycle-event",
      states: ["ready", "rebound"],
    },
    ready: {
      capabilities: PRODUCTION_CAPABILITIES,
      schema: "ready",
    },
    rebound: { schema: "rebound" },
  },
  frameSchemas: {
    CANCEL: "cancel",
    EVENT: "host-lifecycle-event",
    HELLO: "hello",
    READY: "ready",
    REBOUND: "rebound",
    REHELLO: "rehello",
    REQUEST: "request",
    RESPONSE: "response",
  },
  protocolVersion: 2,
  schemas: {
    cancel: {
      fields: [
        "generationId",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "requestId",
        "sessionId",
        "type",
      ],
      required: [
        "generationId",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "requestId",
        "sessionId",
        "type",
      ],
    },
    "empty-object": { fields: [], required: [] },
    hello: {
      fields: [
        "buildId",
        "generationId",
        "identityLaunch",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
      nestedSchemas: { identityLaunch: "identity-launch" },
      required: [
        "buildId",
        "generationId",
        "identityLaunch",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
    },
    "identity-launch": {
      fields: [
        "flavor",
        "identityMode",
        "platform",
        "profileId",
        "resetProvenance",
        "sharedIdentity",
        "userDataRoot",
        "identityManifestDigest",
      ],
      required: [
        "flavor",
        "identityMode",
        "platform",
        "profileId",
        "resetProvenance",
        "sharedIdentity",
        "userDataRoot",
        "identityManifestDigest",
      ],
      types: { identityManifestDigest: "string" },
    },
    "identity-snapshot": {
      enums: { storage: IDENTITY_STORAGE_VALUES },
      fields: IDENTITY_METADATA_FIELDS,
      required: IDENTITY_METADATA_FIELDS,
      types: {
        display_name: "string",
        locked: "boolean",
        lost: "boolean",
        pubkey: "string",
        reset_failed: "boolean",
        storage: "string",
      },
    },
    "host-lifecycle-event": {
      enums: { event: ["host_lifecycle"], type: ["EVENT"] },
      fields: [
        "event",
        "generationId",
        "payload",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sequence",
        "sessionId",
        "type",
      ],
      payloadSchema: "lifecycle-payload",
      required: [
        "event",
        "generationId",
        "payload",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sequence",
        "sessionId",
        "type",
      ],
      types: {
        event: "string",
        generationId: "integer",
        payload: "object",
        profileId: "string",
        protocolVersion: "integer",
        registryDigest: "string",
        sequence: "integer",
        sessionId: "string",
        type: "string",
      },
    },
    "lifecycle-payload": {
      enums: { state: ["ready", "rebound"] },
      fields: ["state"],
      required: ["state"],
      types: { state: "string" },
    },
    ready: {
      enums: { type: ["READY"] },
      fields: [
        "generationId",
        "payload",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
      payloadSchema: "ready-payload",
      required: [
        "generationId",
        "payload",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
      types: {
        generationId: "integer",
        payload: "object",
        profileId: "string",
        protocolVersion: "integer",
        registryDigest: "string",
        sessionId: "string",
        type: "string",
      },
    },
    "ready-payload": {
      exactArrays: { capabilities: PRODUCTION_CAPABILITIES },
      fields: ["capabilities"],
      required: ["capabilities"],
      types: { capabilities: "array" },
    },
    rehello: {
      fields: [
        "buildId",
        "generationId",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
      required: [
        "buildId",
        "generationId",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
    },
    "relay-url": {
      fields: ["relayUrl"],
      required: ["relayUrl"],
      types: { relayUrl: "string" },
    },
    boolean: {
      fields: ["value"],
      required: ["value"],
      types: { value: "boolean" },
    },
    request: {
      fields: [
        "capability",
        "generationId",
        "method",
        "payload",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "requestId",
        "sessionId",
        "type",
      ],
      required: [
        "capability",
        "generationId",
        "method",
        "payload",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "requestId",
        "sessionId",
        "type",
      ],
    },
    response: {
      enums: {
        outcome: ["cancelled", "error", "ok", "outcome_unknown"],
        type: ["RESPONSE"],
      },
      errorSchema: "error-envelope",
      fields: [
        "error",
        "generationId",
        "outcome",
        "payload",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "requestId",
        "sessionId",
        "type",
      ],
      payloadSchemas: ["boolean", "identity-snapshot", "relay-url"],
      required: [
        "generationId",
        "outcome",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "requestId",
        "sessionId",
        "type",
      ],
      types: {
        error: "object",
        generationId: "integer",
        outcome: "string",
        payload: "object",
        profileId: "string",
        protocolVersion: "integer",
        registryDigest: "string",
        requestId: "string",
        sessionId: "string",
        type: "string",
      },
    },
    "error-envelope": {
      enums: { code: IDENTITY_ERROR_CODES },
      fields: ["code"],
      required: ["code"],
      types: { code: "string" },
    },
    rebound: {
      enums: { type: ["REBOUND"] },
      fields: [
        "generationId",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
      required: [
        "generationId",
        "profileId",
        "protocolVersion",
        "registryDigest",
        "sessionId",
        "type",
      ],
      types: {
        generationId: "integer",
        profileId: "string",
        protocolVersion: "integer",
        registryDigest: "string",
        sessionId: "string",
        type: "string",
      },
    },
  },
};

export const PRODUCTION_REGISTRY_DOCUMENT = deepFreeze(
  PRODUCTION_REGISTRY_SOURCE,
);
export const PRODUCTION_REGISTRY_CANONICAL_JSON = canonicalizeJson(
  PRODUCTION_REGISTRY_DOCUMENT,
);
export const PRODUCTION_REGISTRY_COMPUTED_DIGEST = digestJson(
  PRODUCTION_REGISTRY_DOCUMENT,
);

function validateId(value, code) {
  expectString(value, code, { maxBytes: MAX_ID_BYTES });
}

function validateCommon(frame, code) {
  expect(isRecord(frame), code);
  expectString(frame.type, "invalid_frame_type", { maxBytes: MAX_ID_BYTES });
  expect(
    frame.protocolVersion === IDENTITY_PROTOCOL_VERSION,
    "invalid_protocol_version",
  );
  validateId(frame.profileId, "invalid_profile_id");
  validateId(frame.sessionId, "invalid_session_id");
  expectPositiveInteger(frame.generationId, "invalid_generation_id");
  expectDigest(frame.registryDigest, "invalid_registry_digest");
  expect(
    frame.registryDigest === PRODUCTION_REGISTRY_DIGEST,
    "registry_mismatch",
  );
}

function validateBinding(frame, binding, expectedGeneration) {
  if (binding !== null && binding !== undefined) {
    expect(isRecord(binding), "invalid_binding");
    expect(frame.profileId === binding.profileId, "wrong_binding");
    expect(frame.sessionId === binding.sessionId, "wrong_binding");
    if (binding.generationId !== undefined) {
      expect(frame.generationId === binding.generationId, "wrong_generation");
    }
  }
  if (expectedGeneration !== null && expectedGeneration !== undefined) {
    expect(frame.generationId === expectedGeneration, "wrong_generation");
  }
}

function validateIdentitySnapshot(payload) {
  expectExactKeys(
    payload,
    IDENTITY_METADATA_FIELDS,
    "invalid_identity_metadata",
  );
  expectString(payload.pubkey, "invalid_identity_metadata", {
    maxBytes: MAX_METADATA_STRING_BYTES,
  });
  expectString(payload.display_name, "invalid_identity_metadata", {
    maxBytes: MAX_METADATA_STRING_BYTES,
  });
  expect(STORAGE_SET.has(payload.storage), "invalid_identity_metadata");
  expect(typeof payload.lost === "boolean", "invalid_identity_metadata");
  expect(typeof payload.locked === "boolean", "invalid_identity_metadata");
  expect(
    typeof payload.reset_failed === "boolean",
    "invalid_identity_metadata",
  );
  expect(
    Buffer.byteLength(canonicalizeJson(payload), "utf8") <= MAX_METADATA_BYTES,
    "identity_metadata_too_large",
  );
}

function validateResponsePayload(payload, schema) {
  if (schema === "boolean") {
    expectExactKeys(payload, ["value"], "invalid_success_payload");
    expect(typeof payload.value === "boolean", "invalid_success_payload");
    return;
  }
  if (schema === "identity-snapshot") {
    validateIdentitySnapshot(payload);
    return;
  }
  if (schema === "relay-url") {
    expectExactKeys(payload, ["relayUrl"], "invalid_success_payload");
    expectString(payload.relayUrl, "invalid_success_payload", {
      maxBytes: MAX_RELAY_URL_BYTES,
    });
    return;
  }
  fail("invalid_success_payload");
}

function responseSchemaFor(capability, method) {
  expect(
    capability !== undefined && method !== undefined,
    "invalid_response_schema",
  );
  expectString(capability, "unknown_capability", { maxBytes: MAX_ID_BYTES });
  expectString(method, "unknown_method", { maxBytes: MAX_ID_BYTES });
  const request = REQUESTS[`${capability}:${method}`];
  if (request === undefined) {
    const knownCapability = Object.values(REQUESTS).some(
      (candidate) => candidate.capability === capability,
    );
    fail(knownCapability ? "unknown_method" : "unknown_capability");
  }
  return request.responseSchema;
}

function validateLaunchDescriptor(launch) {
  expectExactKeys(
    launch,
    [
      "profileId",
      "flavor",
      "platform",
      "userDataRoot",
      "identityMode",
      "sharedIdentity",
      "resetProvenance",
      "identityManifestDigest",
    ],
    "invalid_identity_launch",
  );
  validateId(launch.profileId, "invalid_identity_launch");
  expect(
    launch.flavor === "normal" || launch.flavor === "instrumented",
    "invalid_identity_launch",
  );
  const profile = PRODUCTION_IDENTITY_PROFILES[launch.flavor];
  expect(launch.profileId === profile.profileId, "invalid_identity_launch");
  expect(
    launch.platform === "macos" ||
      launch.platform === "windows" ||
      launch.platform === "linux",
    "invalid_identity_launch",
  );
  expectString(launch.userDataRoot, "invalid_identity_launch", {
    maxBytes: MAX_ROOT_BYTES,
  });
  expect(isAbsolutePath(launch.userDataRoot), "invalid_identity_launch");
  expect(!hasParentPathSegment(launch.userDataRoot), "invalid_identity_launch");
  expect(
    hasPathSuffix(launch.userDataRoot, profile.userDataRelativePath),
    "invalid_identity_launch",
  );
  expect(launch.identityMode === "explicit", "invalid_identity_launch");
  expect(launch.sharedIdentity === false, "invalid_identity_launch");
  expect(
    launch.resetProvenance === "not_attempted_fresh",
    "invalid_identity_launch",
  );
  expectDigest(launch.identityManifestDigest, "invalid_identity_launch");
  expect(
    launch.identityManifestDigest === PRODUCTION_IDENTITY_MANIFEST_DIGEST,
    "identity_manifest_mismatch",
  );
  return launch;
}

export function validateIdentityLaunchDescriptor(launch) {
  return validateLaunchDescriptor(launch);
}

export function validateIdentityRequest(frame) {
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
      "registryDigest",
    ],
    "invalid_request_schema",
  );
  validateCommon(frame, "invalid_request");
  expect(frame.type === "REQUEST", "invalid_request_schema");
  validateId(frame.requestId, "invalid_request_id");
  responseSchemaFor(frame.capability, frame.method);
  expectExactKeys(frame.payload, [], "invalid_payload");
  return frame;
}

export function validateIdentityResponse(
  frame,
  {
    binding = null,
    expectedCapability,
    expectedGeneration = null,
    expectedMethod,
  } = {},
) {
  expectOptionalKeys(
    frame,
    [
      "type",
      "protocolVersion",
      "profileId",
      "sessionId",
      "generationId",
      "requestId",
      "outcome",
      "registryDigest",
    ],
    ["payload", "error"],
    "invalid_response_schema",
  );
  validateCommon(frame, "invalid_response");
  expect(frame.type === "RESPONSE", "invalid_response_schema");
  validateId(frame.requestId, "invalid_request_id");
  expect(
    frame.outcome === "ok" ||
      frame.outcome === "error" ||
      frame.outcome === "cancelled" ||
      frame.outcome === "outcome_unknown",
    "invalid_outcome",
  );
  const hasPayload = hasOwn(frame, "payload");
  const hasError = hasOwn(frame, "error");
  if (frame.outcome === "ok") {
    expect(!hasError, "invalid_success_error");
    expect(hasPayload, "invalid_success_payload");
    const schema = responseSchemaFor(expectedCapability, expectedMethod);
    validateResponsePayload(frame.payload, schema);
  } else {
    expect(!hasPayload, "invalid_error_payload");
    expect(hasError, "missing_error");
    expectExactKeys(frame.error, ["code"], "invalid_error");
    expectString(frame.error.code, "invalid_error_code", {
      maxBytes: MAX_ID_BYTES,
    });
    expect(IDENTITY_ERROR_CODE_SET.has(frame.error.code), "invalid_error_code");
  }
  validateBinding(frame, binding, expectedGeneration);
  return frame;
}

export function validateProductionRegistry(
  document = PRODUCTION_REGISTRY_DOCUMENT,
) {
  expect(isRecord(document), "invalid_registry");
  expect(
    digestJson(document) === PRODUCTION_REGISTRY_DIGEST,
    "registry_mismatch",
  );
  return document;
}

export function validateIdentityFrame(
  frame,
  {
    direction = "any",
    binding = null,
    expectedGeneration = null,
    responseCapability,
    responseMethod,
  } = {},
) {
  expect(isRecord(frame), "invalid_frame");
  expect(FRAME_TYPES.includes(frame.type), "unknown_frame");
  if (direction === "main")
    expect(MAIN_FRAME_TYPES.has(frame.type), "unexpected_host_frame");
  if (direction === "host")
    expect(HOST_FRAME_TYPES.has(frame.type), "unexpected_main_frame");
  expect(
    direction === "any" || direction === "main" || direction === "host",
    "invalid_direction",
  );

  switch (frame.type) {
    case "HELLO":
      expectExactKeys(
        frame,
        [
          "type",
          "protocolVersion",
          "profileId",
          "sessionId",
          "generationId",
          "buildId",
          "registryDigest",
          "identityLaunch",
        ],
        "invalid_hello_schema",
      );
      validateCommon(frame, "invalid_hello");
      expect(frame.generationId === 1, "invalid_hello_generation");
      validateId(frame.buildId, "missing_build_id");
      validateIdentityLaunchDescriptor(frame.identityLaunch);
      expect(
        frame.identityLaunch.profileId === frame.profileId,
        "invalid_identity_launch",
      );
      break;
    case "REHELLO":
      expectExactKeys(
        frame,
        [
          "type",
          "protocolVersion",
          "profileId",
          "sessionId",
          "generationId",
          "buildId",
          "registryDigest",
        ],
        "invalid_rehello_schema",
      );
      validateCommon(frame, "invalid_rehello");
      validateId(frame.buildId, "missing_build_id");
      break;
    case "REQUEST":
      validateIdentityRequest(frame);
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
          "registryDigest",
        ],
        "invalid_cancel_schema",
      );
      validateCommon(frame, "invalid_cancel");
      validateId(frame.requestId, "invalid_request_id");
      break;
    case "READY":
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
      validateCommon(frame, "invalid_ready");
      expectExactKeys(frame.payload, ["capabilities"], "invalid_ready_payload");
      expect(
        JSON.stringify(frame.payload.capabilities) ===
          JSON.stringify(PRODUCTION_CAPABILITIES),
        "invalid_ready_payload",
      );
      break;
    case "REBOUND":
      expectExactKeys(
        frame,
        [
          "type",
          "protocolVersion",
          "profileId",
          "sessionId",
          "generationId",
          "registryDigest",
        ],
        "invalid_rebound_schema",
      );
      validateCommon(frame, "invalid_rebound");
      break;
    case "EVENT":
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
          "registryDigest",
        ],
        "invalid_event_schema",
      );
      validateCommon(frame, "invalid_event");
      expect(frame.event === "host_lifecycle", "unknown_event");
      expectExactKeys(frame.payload, ["state"], "invalid_event_payload");
      expect(LIFECYCLE_STATES.has(frame.payload.state), "invalid_event_state");
      expectPositiveInteger(frame.sequence, "invalid_sequence");
      break;
    case "RESPONSE":
      validateIdentityResponse(frame, {
        expectedCapability: responseCapability,
        expectedMethod: responseMethod,
      });
      break;
    default:
      fail("unknown_frame");
  }
  validateBinding(frame, binding, expectedGeneration);
  return frame;
}

export function createIdentityRequest({
  profileId,
  sessionId,
  generationId,
  requestId,
  capability,
  method,
}) {
  const frame = {
    type: "REQUEST",
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    profileId,
    sessionId,
    generationId,
    requestId,
    capability,
    method,
    payload: {},
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
  };
  validateIdentityFrame(frame, { direction: "main" });
  return frame;
}
