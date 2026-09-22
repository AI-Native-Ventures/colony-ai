// Pure RelayV2 contract/schema codec. This module owns no socket, process,
// renderer, signing, or reconnect behavior. The registry JSON is a generated
// mirror of the native-owned carrier and is validated before use.

import { TextDecoder } from "node:util";
import relayRegistry from "./relay-v2-registry.generated.json" with {
  type: "json",
};
import {
  canonicalizeJson,
  digestJson,
  PRODUCTION_REGISTRY_DIGEST as IDENTITY_V2_PRODUCTION_REGISTRY_DIGEST,
  TEST_V2_REGISTRY_DIGEST as IDENTITY_V2_TEST_REGISTRY_DIGEST,
  V1_REGISTRY_DIGEST,
} from "./identity-protocol.mjs";

export const RELAY_V2_PROTOCOL_VERSION = 2;
export const RELAY_V2_PROFILE_ID = "relay-v2";
export const RELAY_V2_REGISTRY_DIGEST =
  "bfc07c1c89d19e7c0a8426c5dbb8927d51cd38884d8443361742fc32667f3d65";
export const RELAY_V2_CANONICAL_REGISTRY_BYTES = 15_522;
export const RELAY_V2_MAX_REGISTRY_BYTES = 16_384;
export const RELAY_V2_MAX_FRAME_BYTES = 524_288;

export const RELAY_V2_LEGACY_REGISTRY_DIGESTS = Object.freeze({
  v1: V1_REGISTRY_DIGEST,
  identityV2: IDENTITY_V2_TEST_REGISTRY_DIGEST,
  identityV2Production: IDENTITY_V2_PRODUCTION_REGISTRY_DIGEST,
});

export const RELAY_V2_NATIVE_REGISTRY_PROVENANCE = Object.freeze({
  source: "desktop/src-native-host/relay_v2_registry.json",
  sourceCommit: "c972742536936ef4fff8035dd574841d3a75fbd7",
  sourceBytes: 15_724,
  canonicalBytes: RELAY_V2_CANONICAL_REGISTRY_BYTES,
  canonicalDigest: RELAY_V2_REGISTRY_DIGEST,
});

const ROOT_KEYS = [
  "protocolVersion",
  "profile",
  "capabilities",
  "authority",
  "entries",
  "errors",
  "redactedCodes",
  "filterKinds",
  "inbound",
  "limits",
  "requestSchemas",
  "schemas",
  "signing",
];
const ENTRY_KEYS = [
  "authorization",
  "binary",
  "capability",
  "deadlineClass",
  "deadlineMs",
  "direction",
  "eventSchema",
  "requestSchema",
  "responseSchema",
  "sideEffect",
];
const ENTRY_NAMES = [
  "relay-transport/connect",
  "relay-transport/authenticate",
  "relay-transport/subscribe",
  "relay-transport/close_subscription",
  "relay-transport/publish",
  "relay-transport/close",
  "identity-sign/sign_message",
  "identity-sign/sign_presence",
  "identity-sign/sign_typing",
  "identity-sign/sign_user_status",
];
const AUTHORITY_RENDERER_KEYS = [
  "name",
  "type",
  "minBytes",
  "maxBytes",
  "meaning",
  "maySelectUrl",
  "maySelectProfile",
  "maySelectDigest",
];
const AUTHORITY_MAIN_KEYS = [
  "name",
  "format",
  "bytes",
  "pattern",
  "rendererMayProvide",
  "meaning",
];
const SCHEMA_KEYS = [
  "type",
  "required",
  "properties",
  "enum",
  "const",
  "pattern",
  "minBytes",
  "maxBytes",
  "maxItems",
  "minimum",
  "maximum",
  "items",
  "payloadVariants",
  "$ref",
  "additionalProperties",
];
const SCHEMA_TYPES = [
  "array",
  "boolean",
  "integer",
  "number",
  "object",
  "string",
  "uint",
  "nullable-uint",
  "nullable-event-id",
];
const EXPECTED_FILTER_KINDS = [
  5, 7, 9, 20_001, 20_002, 30_315, 39_005, 40_001, 40_002, 40_003, 40_008,
  40_099, 48_100, 48_101, 48_102, 48_103, 9_005,
];
const OK_CODES = [
  "accepted",
  "rejected",
  "duplicate",
  "invalid_event",
  "not_authorized",
  "rate_limited",
  "server_error",
  "unknown",
];
const CLOSED_CODES = [
  "auth_required",
  "invalid_request",
  "not_authorized",
  "rate_limited",
  "server_error",
  "timeout",
  "unknown",
];
const NOTICE_CODES = [
  "invalid_request",
  "not_authorized",
  "rate_limited",
  "server_error",
  "maintenance",
  "unknown",
];
const SIGNING_KEYS = ["message", "presence", "typing", "user_status"];
const MESSAGE_SIGNING_KEYS = [
  "contentBytes",
  "kind",
  "baseTags",
  "mentionTag",
  "extraTagNames",
  "extraTagMaxItems",
  "extraTagRules",
];
const PUBLIC_ERROR_CODES = [
  "invalid_payload",
  "invalid_registry",
  "wrong_protocol",
  "wrong_context",
  "wrong_digest",
  "invalid_context",
  "invalid_operation",
  "wrong_authority",
  "invalid_filter",
  "invalid_kind",
  "invalid_tags",
  "invalid_code",
  "oversized_frame",
  "unsupported_message_type",
];

export class RelayProtocolError extends Error {
  constructor(code) {
    super(code);
    this.name = "RelayProtocolError";
    this.code = code;
  }
}

function fail(code) {
  throw new RelayProtocolError(code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.hasOwn(value, key);
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function sameKeys(value, expected) {
  return (
    isRecord(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => hasOwn(value, key))
  );
}

function expectKeys(value, expected) {
  if (!sameKeys(value, expected)) fail("invalid_registry");
}

function expectObject(value, code = "invalid_payload") {
  if (!isRecord(value)) fail(code);
  return value;
}

function expectArray(value, code = "invalid_payload") {
  if (!Array.isArray(value)) fail(code);
  return value;
}

function expectString(value, code = "invalid_payload") {
  if (typeof value !== "string") fail(code);
  return value;
}

function expectBoolean(value, code = "invalid_payload") {
  if (typeof value !== "boolean") fail(code);
  return value;
}

function expectUint(value, code = "invalid_payload") {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function expectFiniteNumber(value, code = "invalid_payload") {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code);
  return value;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function expectStringArray(value, code = "invalid_registry") {
  const array = expectArray(value, code);
  for (const item of array) expectString(item, code);
  return array;
}

function noDuplicates(values) {
  return new Set(values).size === values.length;
}

function deepEqual(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const RELAY_V2_REGISTRY_DOCUMENT = deepFreeze(relayRegistry);
export const RELAY_V2_REGISTRY_CANONICAL_JSON = canonicalizeJson(
  RELAY_V2_REGISTRY_DOCUMENT,
);
export const RELAY_V2_REGISTRY_COMPUTED_DIGEST = digestJson(
  RELAY_V2_REGISTRY_DOCUMENT,
);
export const RELAY_V2_LIMITS = deepFreeze({
  ...RELAY_V2_REGISTRY_DOCUMENT.limits,
});
export const RELAY_V2_PUBLIC_ERROR_CODES = Object.freeze(PUBLIC_ERROR_CODES);

function validateAuthority(document) {
  const authority = expectObject(document.authority);
  expectKeys(authority, [
    "rendererInput",
    "mainIssued",
    "resolution",
    "unknown",
  ]);
  const renderer = expectObject(authority.rendererInput);
  expectKeys(renderer, AUTHORITY_RENDERER_KEYS);
  if (
    renderer.name !== "communityId" ||
    renderer.type !== "string" ||
    renderer.minBytes !== 1 ||
    renderer.maxBytes !== 128 ||
    renderer.maySelectUrl !== false ||
    renderer.maySelectProfile !== false ||
    renderer.maySelectDigest !== false
  ) {
    fail("invalid_registry");
  }
  expectString(renderer.meaning, "invalid_registry");

  const mainIssued = expectObject(authority.mainIssued);
  expectKeys(mainIssued, AUTHORITY_MAIN_KEYS);
  if (
    mainIssued.name !== "authorityRef" ||
    mainIssued.format !== "lowercase-hex-32-byte" ||
    mainIssued.bytes !== 32 ||
    mainIssued.pattern !== "^[0-9a-f]{64}$" ||
    mainIssued.rendererMayProvide !== false
  ) {
    fail("invalid_registry");
  }
  expectString(mainIssued.meaning, "invalid_registry");
  if (authority.unknown !== "wrong_authority") fail("invalid_registry");
  expectString(authority.resolution, "invalid_registry");
}

function validateEntries(document) {
  const entries = expectObject(document.entries);
  expectKeys(entries, ENTRY_NAMES);
  const schemas = expectObject(document.schemas);
  for (const name of ENTRY_NAMES) {
    const entry = expectObject(entries[name]);
    expectKeys(entry, ENTRY_KEYS);
    if (!name.includes("/")) fail("invalid_registry");
    expectString(entry.authorization, "invalid_registry");
    if (entry.binary !== false) fail("invalid_registry");
    expectString(entry.capability, "invalid_registry");
    expectString(entry.deadlineClass, "invalid_registry");
    if (expectUint(entry.deadlineMs, "invalid_registry") === 0) {
      fail("invalid_registry");
    }
    expectString(entry.direction, "invalid_registry");
    expectString(entry.sideEffect, "invalid_registry");
    for (const field of ["requestSchema", "responseSchema", "eventSchema"]) {
      const schema = expectString(entry[field], "invalid_registry");
      if (!hasOwn(schemas, schema)) fail("invalid_registry");
    }
  }
}

function validateSchemaDescriptor(
  value,
  schemas,
  references,
  rootSchema = false,
) {
  const schema = expectObject(value, "invalid_registry");
  if (Object.keys(schema).some((key) => !SCHEMA_KEYS.includes(key))) {
    fail("invalid_registry");
  }
  if (hasOwn(schema, "$ref")) {
    if (Object.keys(schema).length !== 1) fail("invalid_registry");
    references.add(expectString(schema.$ref, "invalid_registry"));
    return;
  }
  if (hasOwn(schema, "const") && !hasOwn(schema, "type")) {
    if (Object.keys(schema).length !== 1) fail("invalid_registry");
    return;
  }
  const type = expectString(schema.type, "invalid_registry");
  if (!SCHEMA_TYPES.includes(type) || (rootSchema && type !== "object")) {
    fail("invalid_registry");
  }
  if (
    hasOwn(schema, "additionalProperties") &&
    schema.additionalProperties !== false
  ) {
    fail("invalid_registry");
  }
  if (hasOwn(schema, "required")) {
    const required = expectStringArray(schema.required);
    if (!noDuplicates(required)) fail("invalid_registry");
    if (hasOwn(schema, "properties")) {
      const properties = expectObject(schema.properties);
      if (required.some((key) => !hasOwn(properties, key)))
        fail("invalid_registry");
    }
  }
  if (hasOwn(schema, "properties")) {
    const properties = expectObject(schema.properties);
    for (const descriptor of Object.values(properties)) {
      validateSchemaDescriptor(descriptor, schemas, references);
    }
  }
  if (hasOwn(schema, "items")) {
    validateSchemaDescriptor(schema.items, schemas, references);
  }
  if (hasOwn(schema, "payloadVariants")) {
    const variants = expectObject(schema.payloadVariants);
    for (const descriptor of Object.values(variants)) {
      validateSchemaDescriptor(descriptor, schemas, references);
    }
  }
  if (hasOwn(schema, "enum")) {
    const values = expectArray(schema.enum);
    if (values.length === 0 || !noDuplicates(values)) fail("invalid_registry");
  }
  if (hasOwn(schema, "pattern")) {
    const pattern = expectString(schema.pattern, "invalid_registry");
    if (
      ![
        "^[0-9a-f]{64}$",
        "^[0-9a-f]{128}$",
        "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      ].includes(pattern)
    ) {
      fail("invalid_registry");
    }
  }
  for (const field of [
    "minBytes",
    "maxBytes",
    "maxItems",
    "minimum",
    "maximum",
  ]) {
    if (hasOwn(schema, field)) expectUint(schema[field], "invalid_registry");
  }
  if (
    hasOwn(schema, "minBytes") &&
    hasOwn(schema, "maxBytes") &&
    schema.minBytes > schema.maxBytes
  ) {
    fail("invalid_registry");
  }
  if (
    hasOwn(schema, "minimum") &&
    hasOwn(schema, "maximum") &&
    schema.minimum > schema.maximum
  ) {
    fail("invalid_registry");
  }
}

function validateErrors(document) {
  const errors = expectStringArray(document.errors);
  const expected = [
    "invalid_payload",
    "invalid_connection",
    "stale_generation",
    "future_generation",
    "wrong_authority",
    "auth_required",
    "auth_timeout",
    "auth_rejected",
    "connect_timeout",
    "request_timeout",
    "oversized_frame",
    "malformed_frame",
    "queue_full",
    "relay_closed",
    "publish_rejected",
    "host_unavailable",
    "renderer_rebound",
    "shutdown",
  ];
  if (
    errors.length === 0 ||
    !noDuplicates(errors) ||
    !sameArray(errors, expected)
  ) {
    fail("invalid_registry");
  }
}

function validateRedactedCodes(document) {
  const codes = expectObject(document.redactedCodes);
  expectKeys(codes, ["ok", "closed", "notice"]);
  if (
    !sameArray(expectStringArray(codes.ok), OK_CODES) ||
    !sameArray(expectStringArray(codes.closed), CLOSED_CODES) ||
    !sameArray(expectStringArray(codes.notice), NOTICE_CODES)
  ) {
    fail("invalid_registry");
  }
}

function validateLimits(document) {
  const limits = expectObject(document.limits);
  const expected = [
    "authBudgetMode",
    "authBudgetStart",
    "authDeadlineMs",
    "closeDeadlineMs",
    "connectDeadlineMs",
    "maxChallengeBytes",
    "maxConnectionIdBytes",
    "maxContentBytes",
    "maxFilterBytes",
    "maxFilterCount",
    "maxFilterKinds",
    "maxFilterValueBytes",
    "maxFilterValues",
    "maxInboundFrames",
    "maxReasonBytes",
    "maxRelayUrlBytes",
    "maxSignedEventBytes",
    "maxSubscriptionIdBytes",
    "maxSubscriptions",
    "maxTagCount",
    "maxTagItemBytes",
    "maxTagItems",
    "outboundQueueLimit",
    "publishOkDeadlineMs",
    "relayFrameBytes",
    "requestDeadlineMs",
    "shutdownGraceMs",
  ];
  expectKeys(limits, expected);
  if (
    limits.authBudgetMode !== "single-absolute" ||
    limits.authBudgetStart !== "connection-created"
  ) {
    fail("invalid_registry");
  }
  for (const field of expected) {
    if (
      field !== "authBudgetMode" &&
      field !== "authBudgetStart" &&
      expectUint(limits[field], "invalid_registry") === 0
    ) {
      fail("invalid_registry");
    }
  }
  if (
    limits.maxFilterBytes !== 32_768 ||
    limits.relayFrameBytes !== RELAY_V2_MAX_FRAME_BYTES
  ) {
    fail("invalid_registry");
  }
}

function validateSigning(document) {
  const signing = expectObject(document.signing);
  expectKeys(signing, SIGNING_KEYS);
  const message = expectObject(signing.message);
  expectKeys(message, MESSAGE_SIGNING_KEYS);
  if (
    message.contentBytes !== 262_144 ||
    message.kind !== 9 ||
    message.extraTagMaxItems !== 4
  ) {
    fail("invalid_registry");
  }
  if (
    !sameArray(expectStringArray(message.extraTagNames), [
      "e",
      "h",
      "p",
      "q",
      "broadcast",
    ])
  ) {
    fail("invalid_registry");
  }
  const baseTags = expectArray(message.baseTags);
  if (baseTags.length !== 1) fail("invalid_registry");
  const baseTag = expectObject(baseTags[0]);
  expectKeys(baseTag, ["name", "source", "arity", "required"]);
  if (
    baseTag.name !== "h" ||
    baseTag.source !== "channelId" ||
    baseTag.arity !== 2 ||
    baseTag.required !== true
  ) {
    fail("invalid_registry");
  }
  const mentionTag = expectObject(message.mentionTag);
  expectKeys(mentionTag, ["name", "source", "arity"]);
  if (mentionTag.arity !== 2) fail("invalid_registry");
  expectString(mentionTag.name, "invalid_registry");
  expectString(mentionTag.source, "invalid_registry");
  const rules = expectObject(message.extraTagRules);
  expectKeys(rules, ["e", "h", "p", "q", "broadcast"]);
  const expectedRules = {
    e: ["eventId64", "", "root|reply"],
    h: ["channelId"],
    p: ["pubkey64"],
    q: ["eventId64"],
    broadcast: ["1"],
  };
  for (const key of Object.keys(expectedRules)) {
    if (!deepEqual(rules[key], expectedRules[key])) fail("invalid_registry");
  }

  const presence = expectObject(signing.presence);
  expectKeys(presence, ["contentBytes", "kind", "exactTags"]);
  if (
    presence.contentBytes !== 128 ||
    presence.kind !== 20_001 ||
    !sameArray(presence.exactTags, [])
  ) {
    fail("invalid_registry");
  }

  const typing = expectObject(signing.typing);
  expectKeys(typing, ["contentBytes", "kind", "tagNames", "tagConstruction"]);
  if (
    typing.contentBytes !== 0 ||
    typing.kind !== 20_002 ||
    !sameArray(typing.tagNames, ["e", "h"])
  ) {
    fail("invalid_registry");
  }
  if (
    !deepEqual(typing.tagConstruction, {
      required: [["h", "channelId"]],
      reply: [["e", "parentEventId", "", "reply"]],
      thread: [
        ["e", "rootEventId", "", "root"],
        ["e", "parentEventId", "", "reply"],
      ],
    })
  ) {
    fail("invalid_registry");
  }

  const status = expectObject(signing.user_status);
  expectKeys(status, ["contentBytes", "kind", "tagNames", "tagConstruction"]);
  if (
    status.contentBytes !== 1024 ||
    status.kind !== 30_315 ||
    !sameArray(status.tagNames, ["d", "emoji", "expiration"])
  ) {
    fail("invalid_registry");
  }
  if (
    !deepEqual(status.tagConstruction, {
      required: [["d", "general"]],
      optional: [
        ["emoji", "status.emoji"],
        ["expiration", "decimal(status.expiresAt)"],
      ],
    })
  ) {
    fail("invalid_registry");
  }
}

export function validateRelayV2RegistryDocument(
  document = RELAY_V2_REGISTRY_DOCUMENT,
) {
  const root = expectObject(document);
  expectKeys(root, ROOT_KEYS);
  if (
    root.protocolVersion !== RELAY_V2_PROTOCOL_VERSION ||
    root.profile !== RELAY_V2_PROFILE_ID
  ) {
    fail("invalid_registry");
  }
  const capabilities = expectObject(root.capabilities);
  expectKeys(capabilities, ["ready"]);
  if (
    !sameArray(expectStringArray(capabilities.ready), [
      "relay-transport",
      "identity-sign",
    ])
  ) {
    fail("invalid_registry");
  }
  validateAuthority(root);
  validateEntries(root);
  validateErrors(root);
  validateRedactedCodes(root);
  if (!sameArray(expectArray(root.filterKinds), EXPECTED_FILTER_KINDS))
    fail("invalid_registry");
  const inbound = expectObject(root.inbound);
  expectKeys(inbound, ["classes", "eventKeys"]);
  if (
    !sameArray(expectStringArray(inbound.classes), [
      "AUTH",
      "OK",
      "EVENT",
      "EOSE",
      "CLOSED",
      "NOTICE",
    ])
  ) {
    fail("invalid_registry");
  }
  if (
    !sameArray(expectStringArray(inbound.eventKeys), [
      "id",
      "pubkey",
      "created_at",
      "kind",
      "tags",
      "content",
      "sig",
    ])
  ) {
    fail("invalid_registry");
  }
  validateLimits(root);
  const requestSchemas = expectObject(root.requestSchemas);
  const requestSchemaNames = [
    "authenticate",
    "close",
    "close_subscription",
    "connect",
    "publish",
    "sign_message",
    "sign_presence",
    "sign_typing",
    "sign_user_status",
    "subscribe",
  ];
  expectKeys(requestSchemas, requestSchemaNames);
  for (const fields of Object.values(requestSchemas)) {
    const names = expectStringArray(fields);
    if (!noDuplicates(names)) fail("invalid_registry");
  }
  validateSigning(root);

  const schemas = expectObject(root.schemas);
  if (Object.keys(schemas).length !== 21) fail("invalid_registry");
  const references = new Set();
  for (const schema of Object.values(schemas)) {
    validateSchemaDescriptor(schema, schemas, references, true);
  }
  for (const entry of Object.values(root.entries)) {
    for (const field of ["requestSchema", "responseSchema", "eventSchema"]) {
      references.add(expectString(entry[field], "invalid_registry"));
    }
  }
  const schemaNames = Object.keys(schemas).sort();
  const referenceNames = [...references].sort();
  if (!sameArray(schemaNames, referenceNames)) fail("invalid_registry");
  return root;
}

export function validateRelayV2Registry(document = RELAY_V2_REGISTRY_DOCUMENT) {
  validateRelayV2RegistryDocument(document);
  let digest;
  try {
    digest = digestJson(document);
  } catch {
    fail("invalid_registry");
  }
  if (
    byteLength(canonicalizeJson(document)) !==
      RELAY_V2_CANONICAL_REGISTRY_BYTES ||
    digest !== RELAY_V2_REGISTRY_DIGEST
  ) {
    fail("invalid_registry");
  }
  return document;
}

export function validateRelayV2AuthorityInput(input) {
  const value = expectObject(input, "wrong_authority");
  if (!sameKeys(value, ["communityId"])) fail("wrong_authority");
  const communityId = expectString(value.communityId, "wrong_authority");
  if (byteLength(communityId) < 1 || byteLength(communityId) > 128)
    fail("wrong_authority");
  return value;
}

export function validateRelayV2AuthorityRef(value) {
  const authorityRef = expectString(value, "wrong_authority");
  if (!/^[0-9a-f]{64}$/.test(authorityRef)) fail("wrong_authority");
  return authorityRef;
}

export function validateRelayV2Context(context) {
  const value = expectObject(context, "invalid_context");
  const keys = [
    "protocolVersion",
    "profile",
    "registryDigest",
    "operation",
    "capability",
    "authorityRef",
  ];
  if (hasOwn(value, "connectionId")) keys.push("connectionId");
  if (!sameKeys(value, keys)) fail("invalid_context");
  if (value.protocolVersion !== RELAY_V2_PROTOCOL_VERSION)
    fail("wrong_protocol");
  if (value.profile !== RELAY_V2_PROFILE_ID) fail("wrong_context");
  if (value.registryDigest !== RELAY_V2_REGISTRY_DIGEST) fail("wrong_digest");
  const operation = expectString(value.operation, "invalid_context");
  if (!hasOwn(RELAY_V2_REGISTRY_DOCUMENT.entries, operation))
    fail("invalid_operation");
  expectString(value.capability, "invalid_context");
  validateRelayV2AuthorityRef(value.authorityRef);
  if (hasOwn(value, "connectionId")) validateConnectionId(value.connectionId);
  return value;
}

function validateConnectionId(value) {
  const connectionId = expectString(value, "invalid_payload");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      connectionId,
    )
  ) {
    fail("invalid_payload");
  }
  return connectionId;
}

function validateStringConstraints(schema, value) {
  const bytes = byteLength(value);
  if (hasOwn(schema, "minBytes") && bytes < schema.minBytes) {
    fail("invalid_payload");
  }
  if (hasOwn(schema, "maxBytes") && bytes > schema.maxBytes) {
    fail("oversized_frame");
  }
  if (hasOwn(schema, "pattern")) {
    const patterns = {
      "^[0-9a-f]{64}$": /^[0-9a-f]{64}$/,
      "^[0-9a-f]{128}$": /^[0-9a-f]{128}$/,
      "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$":
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    };
    if (!patterns[schema.pattern]?.test(value)) fail("invalid_payload");
  }
}

function validateInstance(
  schema,
  value,
  schemas,
  stack = new Set(),
  variantDiscriminator = null,
) {
  if (hasOwn(schema, "$ref")) {
    const reference = expectString(schema.$ref, "invalid_registry");
    if (stack.has(reference)) fail("invalid_registry");
    const resolved = schemas[reference];
    if (resolved === undefined) fail("invalid_registry");
    const next = new Set(stack);
    next.add(reference);
    return validateInstance(
      resolved,
      value,
      schemas,
      next,
      variantDiscriminator,
    );
  }
  if (hasOwn(schema, "const") && !deepEqual(value, schema.const))
    fail("invalid_payload");
  if (
    hasOwn(schema, "enum") &&
    !schema.enum.some((candidate) => deepEqual(candidate, value))
  )
    fail("invalid_payload");
  if (hasOwn(schema, "const") && !hasOwn(schema, "type")) return value;

  const type = schema.type;
  switch (type) {
    case "array": {
      const values = expectArray(value);
      if (hasOwn(schema, "maxItems") && values.length > schema.maxItems)
        fail("oversized_frame");
      if (hasOwn(schema, "items")) {
        for (const item of values)
          validateInstance(schema.items, item, schemas, stack);
      }
      break;
    }
    case "boolean":
      expectBoolean(value);
      break;
    case "integer":
      if (!Number.isSafeInteger(value)) fail("invalid_payload");
      break;
    case "number":
      expectFiniteNumber(value);
      break;
    case "object": {
      const object = expectObject(value);
      if (schema.additionalProperties !== false) fail("invalid_registry");
      const hasProperties = hasOwn(schema, "properties");
      const hasVariants = hasOwn(schema, "payloadVariants");
      const properties = hasProperties ? expectObject(schema.properties) : null;
      if (
        properties &&
        Object.keys(object).some((key) => !hasOwn(properties, key))
      )
        fail("invalid_payload");
      if (!properties && !hasVariants && Object.keys(object).length > 0)
        fail("invalid_payload");
      for (const field of schema.required ?? []) {
        if (!hasOwn(object, field)) fail("invalid_payload");
      }
      if (properties) {
        for (const [field, descriptor] of Object.entries(properties)) {
          if (hasOwn(object, field)) {
            const discriminator =
              hasOwn(descriptor, "payloadVariants") && field === "payload"
                ? object.messageType
                : null;
            validateInstance(
              descriptor,
              object[field],
              schemas,
              stack,
              discriminator,
            );
          }
        }
      }
      if (hasVariants) {
        const messageType = expectString(
          variantDiscriminator ?? object.messageType,
        );
        const payload = variantDiscriminator === null ? object.payload : value;
        if (variantDiscriminator === null && !hasOwn(object, "payload")) {
          fail("invalid_payload");
        }
        const variant = schema.payloadVariants[messageType];
        if (variant === undefined) fail("unsupported_message_type");
        validateInstance(variant, payload, schemas, stack);
      }
      break;
    }
    case "string":
      validateStringConstraints(schema, expectString(value));
      break;
    case "uint":
      expectUint(value);
      break;
    case "nullable-uint":
      if (value !== null) expectUint(value);
      break;
    case "nullable-event-id":
      if (
        value !== null &&
        (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
      )
        fail("invalid_payload");
      break;
    default:
      fail("invalid_registry");
  }
  if (
    hasOwn(schema, "maxItems") &&
    Array.isArray(value) &&
    value.length > schema.maxItems
  )
    fail("oversized_frame");
  if (
    hasOwn(schema, "minimum") &&
    typeof value === "number" &&
    value < schema.minimum
  )
    fail("invalid_payload");
  if (
    hasOwn(schema, "maximum") &&
    typeof value === "number" &&
    value > schema.maximum
  )
    fail("invalid_payload");
  return value;
}

export function validateRelayV2OperationKind(operation, kind) {
  const policyName = {
    "identity-sign/sign_message": "message",
    "identity-sign/sign_presence": "presence",
    "identity-sign/sign_typing": "typing",
    "identity-sign/sign_user_status": "user_status",
  }[operation];
  if (policyName === undefined) fail("invalid_kind");
  if (RELAY_V2_REGISTRY_DOCUMENT.signing[policyName].kind !== kind)
    fail("invalid_kind");
  return kind;
}

export function validateRelayV2Filter(filter) {
  const schemas = RELAY_V2_REGISTRY_DOCUMENT.schemas;
  validateInstance(schemas["relay-filter"], filter, schemas);
  if (
    byteLength(canonicalizeJson(filter)) >
    Math.min(RELAY_V2_LIMITS.maxFilterBytes, 32_768)
  ) {
    fail("invalid_filter");
  }
  if (hasOwn(filter, "kinds") && filter.kinds.includes(30_315)) {
    if (
      !sameArray(filter.kinds, [30_315]) ||
      Object.keys(filter).length !== 2 ||
      !deepEqual(filter["#d"], ["general"])
    ) {
      fail("invalid_filter");
    }
  }
  return filter;
}

function validateMessageSigning(payload) {
  const policy = RELAY_V2_REGISTRY_DOCUMENT.signing.message;
  validateRelayV2OperationKind("identity-sign/sign_message", policy.kind);
  const value = expectObject(payload);
  if (byteLength(expectString(value.content)) > policy.contentBytes)
    fail("oversized_frame");
  const channelId = expectString(value.channelId);
  const tags = expectArray(value.extraTags);
  let hCount = 0;
  let broadcastCount = 0;
  for (const tagValue of tags) {
    const tag = expectArray(tagValue);
    if (tag.length === 0 || tag.length > policy.extraTagMaxItems)
      fail("invalid_tags");
    const name = expectString(tag[0]);
    if (
      !policy.extraTagNames.includes(name) ||
      !hasOwn(policy.extraTagRules, name)
    )
      fail("invalid_tags");
    if (name === "e") {
      if (
        tag.length !== 4 ||
        tag[2] !== "" ||
        !["root", "reply"].includes(tag[3]) ||
        !/^[0-9a-f]{64}$/.test(tag[1])
      )
        fail("invalid_tags");
    } else if (name === "h") {
      hCount += 1;
      if (hCount > 1 || tag.length !== 2 || tag[1] !== channelId)
        fail("invalid_tags");
    } else if (name === "p" || name === "q") {
      if (tag.length !== 2 || !/^[0-9a-f]{64}$/.test(tag[1]))
        fail("invalid_tags");
    } else if (name === "broadcast") {
      broadcastCount += 1;
      if (broadcastCount > 1 || !deepEqual(tag, ["broadcast", "1"]))
        fail("invalid_tags");
    } else {
      fail("invalid_tags");
    }
  }
}

function validateTypingSigning(payload) {
  validateRelayV2OperationKind(
    "identity-sign/sign_typing",
    RELAY_V2_REGISTRY_DOCUMENT.signing.typing.kind,
  );
  const value = expectObject(payload);
  if (typeof value.rootEventId === "string" && value.parentEventId === null)
    fail("invalid_tags");
}

export function validateRelayV2InboundMessage(messageType, payload) {
  validateRelayV2Registry();
  const variant =
    RELAY_V2_REGISTRY_DOCUMENT.schemas["relay-message-event"].properties.payload
      .payloadVariants[messageType];
  if (variant === undefined) fail("unsupported_message_type");
  validateInstance(variant, payload, RELAY_V2_REGISTRY_DOCUMENT.schemas);
  return payload;
}

export function validateRelayV2Response(operation, payload) {
  validateRelayV2Registry();
  const entry = RELAY_V2_REGISTRY_DOCUMENT.entries[operation];
  if (entry === undefined) fail("invalid_operation");
  const schema = RELAY_V2_REGISTRY_DOCUMENT.schemas[entry.responseSchema];
  validateInstance(schema, payload, RELAY_V2_REGISTRY_DOCUMENT.schemas);
  return payload;
}

export function validateRelayV2InboundEvent(frame) {
  validateRelayV2Registry();
  validateInstance(
    RELAY_V2_REGISTRY_DOCUMENT.schemas["relay-message-event"],
    frame,
    RELAY_V2_REGISTRY_DOCUMENT.schemas,
  );
  return frame;
}

function parseJsonWithoutDuplicateKeys(text) {
  let index = 0;
  const length = text.length;
  const failJson = () => fail("invalid_payload");
  const skipWhitespace = () => {
    while (index < length && /\s/.test(text[index])) index += 1;
  };
  const parseString = () => {
    if (text[index] !== '"') failJson();
    const start = index;
    index += 1;
    let escaped = false;
    while (index < length) {
      const char = text[index++];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          failJson();
        }
      } else if (char < " ") {
        failJson();
      }
    }
    failJson();
  };
  const parseValue = (depth) => {
    if (depth > 64) fail("invalid_payload");
    skipWhitespace();
    const char = text[index];
    if (char === '"') {
      parseString();
      return;
    }
    if (char === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (index < length) {
        skipWhitespace();
        const key = parseString();
        if (keys.has(key)) fail("invalid_payload");
        keys.add(key);
        skipWhitespace();
        if (text[index++] !== ":") failJson();
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") failJson();
      }
      failJson();
    }
    if (char === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (index < length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") failJson();
      }
      failJson();
    }
    const start = index;
    while (index < length && !/[\s,\]}]/.test(text[index])) index += 1;
    const token = text.slice(start, index);
    if (
      !["true", "false", "null"].includes(token) &&
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)
    )
      failJson();
  };
  parseValue(0);
  skipWhitespace();
  if (index !== length) failJson();
  try {
    return JSON.parse(text);
  } catch {
    failJson();
  }
}

export function validateRelayV2InboundFrame(frameBytes) {
  if (!(frameBytes instanceof Uint8Array)) fail("invalid_payload");
  if (frameBytes.byteLength > RELAY_V2_MAX_FRAME_BYTES) fail("oversized_frame");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(frameBytes);
  } catch {
    fail("invalid_payload");
  }
  return validateRelayV2InboundEvent(parseJsonWithoutDuplicateKeys(text));
}

export function validateRelayV2ErrorCode(codeClass, code) {
  const accepted = { ok: OK_CODES, closed: CLOSED_CODES, notice: NOTICE_CODES }[
    codeClass
  ];
  if (!accepted?.includes(code)) fail("invalid_code");
  return code;
}

export function validateRelayV2Request(context, payload) {
  validateRelayV2Registry();
  const value = validateRelayV2Context(context);
  let encoded;
  try {
    encoded = JSON.stringify(payload);
  } catch {
    fail("invalid_payload");
  }
  if (encoded === undefined) fail("invalid_payload");
  if (byteLength(encoded) > RELAY_V2_MAX_FRAME_BYTES) fail("oversized_frame");
  const entry = RELAY_V2_REGISTRY_DOCUMENT.entries[value.operation];
  if (entry.capability !== value.capability) fail("invalid_operation");
  const schema = RELAY_V2_REGISTRY_DOCUMENT.schemas[entry.requestSchema];
  validateInstance(schema, payload, RELAY_V2_REGISTRY_DOCUMENT.schemas);
  if (
    value.operation !== "relay-transport/connect" &&
    !hasOwn(value, "connectionId")
  )
    fail("invalid_context");
  if (
    hasOwn(value, "connectionId") &&
    hasOwn(payload, "connectionId") &&
    payload.connectionId !== value.connectionId
  )
    fail("invalid_context");
  if (value.operation === "relay-transport/connect") {
    if (payload.authorityRef !== value.authorityRef) fail("wrong_authority");
  } else if (value.operation === "relay-transport/subscribe") {
    validateRelayV2Filter(payload.filter);
  } else if (value.operation === "identity-sign/sign_message") {
    validateMessageSigning(payload);
  } else if (value.operation === "identity-sign/sign_presence") {
    validateRelayV2OperationKind(
      value.operation,
      RELAY_V2_REGISTRY_DOCUMENT.signing.presence.kind,
    );
  } else if (value.operation === "identity-sign/sign_typing") {
    validateTypingSigning(payload);
  } else if (value.operation === "identity-sign/sign_user_status") {
    validateRelayV2OperationKind(
      value.operation,
      RELAY_V2_REGISTRY_DOCUMENT.signing.user_status.kind,
    );
  }
  return payload;
}

export function encodeRelayV2RequestPayload(context, payload) {
  validateRelayV2Request(context, payload);
  const encoded = Buffer.from(canonicalizeJson(payload), "utf8");
  if (encoded.byteLength > RELAY_V2_MAX_FRAME_BYTES) fail("oversized_frame");
  return encoded;
}
