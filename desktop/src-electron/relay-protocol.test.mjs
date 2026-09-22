import assert from "node:assert/strict";
import test from "node:test";

import {
  RELAY_V2_CANONICAL_REGISTRY_BYTES,
  RELAY_V2_LEGACY_REGISTRY_DIGESTS,
  RELAY_V2_LIMITS,
  RELAY_V2_NATIVE_REGISTRY_PROVENANCE,
  RELAY_V2_PROFILE_ID,
  RELAY_V2_PROTOCOL_VERSION,
  RELAY_V2_REGISTRY_CANONICAL_JSON,
  RELAY_V2_REGISTRY_COMPUTED_DIGEST,
  RELAY_V2_REGISTRY_DIGEST,
  RELAY_V2_REGISTRY_DOCUMENT,
  RelayProtocolError,
  encodeRelayV2RequestPayload,
  validateRelayV2AuthorityInput,
  validateRelayV2AuthorityRef,
  validateRelayV2Context,
  validateRelayV2ErrorCode,
  validateRelayV2Filter,
  validateRelayV2InboundEvent,
  validateRelayV2InboundFrame,
  validateRelayV2InboundMessage,
  validateRelayV2OperationKind,
  validateRelayV2Registry,
  validateRelayV2RegistryDocument,
  validateRelayV2Request,
  validateRelayV2Response,
} from "./relay-protocol.mjs";

const AUTHORITY = "a".repeat(64);
const CONNECTION = "01234567-89ab-cdef-0123-456789abcdef";
const EVENT_ID = "b".repeat(64);
const PUBKEY = "c".repeat(64);
const SIGNATURE = "d".repeat(128);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof RelayProtocolError);
    assert.equal(error.code, code);
    return true;
  });
}

function context(operation, capability, connectionId = CONNECTION) {
  const value = {
    protocolVersion: RELAY_V2_PROTOCOL_VERSION,
    profile: RELAY_V2_PROFILE_ID,
    registryDigest: RELAY_V2_REGISTRY_DIGEST,
    operation,
    capability,
    authorityRef: AUTHORITY,
  };
  if (connectionId !== null) value.connectionId = connectionId;
  return value;
}

function requestPayload(operation) {
  switch (operation) {
    case "relay-transport/connect":
      return { authorityRef: AUTHORITY };
    case "relay-transport/authenticate":
      return { connectionId: CONNECTION, challengeRef: "challenge-1" };
    case "relay-transport/subscribe":
      return {
        connectionId: CONNECTION,
        subscriptionId: "sub-1",
        filter: { "#h": ["channel-1"], limit: 20 },
      };
    case "relay-transport/close_subscription":
      return { connectionId: CONNECTION, subscriptionId: "sub-1" };
    case "relay-transport/publish":
      return { connectionId: CONNECTION, eventHandle: "event-handle" };
    case "relay-transport/close":
      return { connectionId: CONNECTION, reason: "done" };
    case "identity-sign/sign_message":
      return {
        connectionId: CONNECTION,
        channelId: "channel-1",
        content: "hello",
        mentionPubkeys: [],
        extraTags: [],
      };
    case "identity-sign/sign_presence":
      return { connectionId: CONNECTION, status: "online" };
    case "identity-sign/sign_typing":
      return {
        connectionId: CONNECTION,
        channelId: "channel-1",
        parentEventId: null,
        rootEventId: null,
      };
    case "identity-sign/sign_user_status":
      return {
        connectionId: CONNECTION,
        text: "working",
        emoji: "bee",
        expiresAt: null,
      };
    default:
      throw new Error(`missing fixture for ${operation}`);
  }
}

function inboundFrame(messageType, payload) {
  return {
    connectionId: CONNECTION,
    generation: 1,
    messageType,
    payload,
  };
}

function signedEvent() {
  return {
    id: EVENT_ID,
    pubkey: PUBKEY,
    created_at: 1,
    kind: 9,
    tags: [],
    content: "hello",
    sig: SIGNATURE,
  };
}

test("native-owned registry mirror is independently anchored", () => {
  assert.equal(
    RELAY_V2_REGISTRY_CANONICAL_JSON.length,
    RELAY_V2_CANONICAL_REGISTRY_BYTES,
  );
  assert.equal(RELAY_V2_REGISTRY_COMPUTED_DIGEST, RELAY_V2_REGISTRY_DIGEST);
  assert.equal(RELAY_V2_NATIVE_REGISTRY_PROVENANCE.canonicalBytes, 15_522);
  assert.equal(
    RELAY_V2_NATIVE_REGISTRY_PROVENANCE.canonicalDigest,
    RELAY_V2_REGISTRY_DIGEST,
  );
  validateRelayV2Registry();
});

test("old identity registry authorities remain distinct and unchanged", () => {
  assert.deepEqual(RELAY_V2_LEGACY_REGISTRY_DIGESTS, {
    v1: "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49",
    identityV2:
      "1032c9f29dee5495099ebf951133bf3cf80c144e39476af39bb67fe62dee3565",
    identityV2Production:
      "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204",
  });
  assert.notEqual(
    RELAY_V2_REGISTRY_DIGEST,
    RELAY_V2_LEGACY_REGISTRY_DIGESTS.identityV2Production,
  );
});

test("registry schema, references, unknown keywords, and digest mutations fail closed", () => {
  const unknownRoot = clone(RELAY_V2_REGISTRY_DOCUMENT);
  unknownRoot.unexpected = true;
  expectCode(
    () => validateRelayV2RegistryDocument(unknownRoot),
    "invalid_registry",
  );

  const unknownKeyword = clone(RELAY_V2_REGISTRY_DOCUMENT);
  unknownKeyword.schemas["relay-connect"].unknownKeyword = true;
  expectCode(
    () => validateRelayV2RegistryDocument(unknownKeyword),
    "invalid_registry",
  );

  const missingReference = clone(RELAY_V2_REGISTRY_DOCUMENT);
  missingReference.schemas["relay-subscribe"].properties.filter.$ref =
    "missing-schema";
  expectCode(
    () => validateRelayV2RegistryDocument(missingReference),
    "invalid_registry",
  );

  const semanticMutation = clone(RELAY_V2_REGISTRY_DOCUMENT);
  semanticMutation.limits.maxFilterBytes = 31_999;
  expectCode(
    () => validateRelayV2Registry(semanticMutation),
    "invalid_registry",
  );
});

test("all frozen request operations validate through the bounded production seam", () => {
  const operations = [
    ["relay-transport/connect", "relay-transport", null],
    ["relay-transport/authenticate", "relay-transport", CONNECTION],
    ["relay-transport/subscribe", "relay-transport", CONNECTION],
    ["relay-transport/close_subscription", "relay-transport", CONNECTION],
    ["relay-transport/publish", "relay-transport", CONNECTION],
    ["relay-transport/close", "relay-transport", CONNECTION],
    ["identity-sign/sign_message", "identity-sign", CONNECTION],
    ["identity-sign/sign_presence", "identity-sign", CONNECTION],
    ["identity-sign/sign_typing", "identity-sign", CONNECTION],
    ["identity-sign/sign_user_status", "identity-sign", CONNECTION],
  ];
  for (const [operation, capability, connectionId] of operations) {
    const payload = requestPayload(operation);
    const result = validateRelayV2Request(
      context(operation, capability, connectionId),
      payload,
    );
    assert.equal(result, payload);
  }
});

test("response schemas remain finite and operation-bound", () => {
  validateRelayV2Response("relay-transport/connect", {
    connectionId: CONNECTION,
  });
  validateRelayV2Response("relay-transport/subscribe", {
    connectionId: CONNECTION,
    subscriptionId: "sub-1",
  });
  validateRelayV2Response("relay-transport/publish", {
    accepted: true,
    connectionId: CONNECTION,
    eventHandle: "event-handle",
  });
  expectCode(
    () =>
      validateRelayV2Response("relay-transport/connect", {
        connectionId: CONNECTION,
        extra: true,
      }),
    "invalid_payload",
  );
  expectCode(
    () => validateRelayV2Response("relay-transport/missing", {}),
    "invalid_operation",
  );
});

test("context and authority are trusted-main only", () => {
  validateRelayV2AuthorityInput({ communityId: "community-1" });
  validateRelayV2AuthorityRef(AUTHORITY);
  expectCode(
    () =>
      validateRelayV2AuthorityInput({
        communityId: "x",
        relayUrl: "wss://example",
      }),
    "wrong_authority",
  );
  expectCode(
    () =>
      validateRelayV2AuthorityInput({
        communityId: "x",
        registryDigest: RELAY_V2_REGISTRY_DIGEST,
      }),
    "wrong_authority",
  );
  expectCode(
    () => validateRelayV2AuthorityRef("F".repeat(64)),
    "wrong_authority",
  );
  expectCode(
    () =>
      validateRelayV2Context({
        ...context("relay-transport/connect", "relay-transport"),
        relayUrl: "wss://example",
      }),
    "invalid_context",
  );
  expectCode(
    () =>
      validateRelayV2Request(
        context("relay-transport/connect", "relay-transport"),
        { authorityRef: "f".repeat(64) },
      ),
    "wrong_authority",
  );
});

test("wrong protocol, profile, digest, capability, operation, and connection are rejected", () => {
  const good = context("relay-transport/authenticate", "relay-transport");
  expectCode(
    () => validateRelayV2Context({ ...good, protocolVersion: 1 }),
    "wrong_protocol",
  );
  expectCode(
    () => validateRelayV2Context({ ...good, profile: "identity-v2" }),
    "wrong_context",
  );
  expectCode(
    () => validateRelayV2Context({ ...good, registryDigest: "0".repeat(64) }),
    "wrong_digest",
  );
  expectCode(
    () =>
      validateRelayV2Context({ ...good, operation: "relay-transport/missing" }),
    "invalid_operation",
  );
  expectCode(
    () =>
      validateRelayV2Request(
        context("relay-transport/connect", "identity-sign", null),
        { authorityRef: AUTHORITY },
      ),
    "invalid_operation",
  );
  expectCode(
    () =>
      validateRelayV2Request(good, {
        connectionId: "fedcba98-7654-3210-fedc-ba9876543210",
        challengeRef: "challenge-1",
      }),
    "invalid_context",
  );
  expectCode(
    () =>
      validateRelayV2Request(
        { ...good, connectionId: "fedcba98-7654-3210-fedc-ba9876543210" },
        requestPayload("relay-transport/authenticate"),
      ),
    "invalid_context",
  );
});

test("filters enforce byte bounds and the exact 30315 general status coordinate", () => {
  validateRelayV2Filter({ kinds: [30_315], "#d": ["general"] });
  expectCode(
    () => validateRelayV2Filter({ kinds: [30_315] }),
    "invalid_filter",
  );
  expectCode(
    () => validateRelayV2Filter({ kinds: [30_315, 9], "#d": ["general"] }),
    "invalid_filter",
  );
  expectCode(
    () => validateRelayV2Filter({ kinds: [30_315], "#d": ["other"] }),
    "invalid_filter",
  );
  expectCode(() => validateRelayV2Filter({ ids: ["A"] }), "oversized_frame");
  const oversized = {
    ids: Array.from({ length: 64 }, () => EVENT_ID),
    authors: Array.from({ length: 64 }, () => PUBKEY),
    "#h": Array.from({ length: 64 }, () => "h".repeat(128)),
    "#e": Array.from({ length: 64 }, () => "e".repeat(128)),
    "#p": Array.from({ length: 64 }, () => "p".repeat(128)),
  };
  expectCode(() => validateRelayV2Filter(oversized), "invalid_filter");
});

test("signing policy enforces finite kind and tag construction", () => {
  validateRelayV2OperationKind("identity-sign/sign_message", 9);
  validateRelayV2OperationKind("identity-sign/sign_user_status", 30_315);
  expectCode(
    () => validateRelayV2OperationKind("identity-sign/sign_message", 10),
    "invalid_kind",
  );
  const valid = requestPayload("identity-sign/sign_message");
  valid.extraTags = [
    ["e", EVENT_ID, "", "root"],
    ["h", "channel-1"],
    ["p", PUBKEY],
    ["q", EVENT_ID],
    ["broadcast", "1"],
  ];
  validateRelayV2Request(
    context("identity-sign/sign_message", "identity-sign"),
    valid,
  );
  for (const extraTags of [
    [["broadcast", "0"]],
    [["e", "A", "", "root"]],
    [["h", "wrong-channel"]],
    [["unknown", "value"]],
  ]) {
    expectCode(
      () =>
        validateRelayV2Request(
          context("identity-sign/sign_message", "identity-sign"),
          { ...requestPayload("identity-sign/sign_message"), extraTags },
        ),
      "invalid_tags",
    );
  }
  expectCode(
    () =>
      validateRelayV2Request(
        context("identity-sign/sign_typing", "identity-sign"),
        {
          ...requestPayload("identity-sign/sign_typing"),
          rootEventId: EVENT_ID,
          parentEventId: null,
        },
      ),
    "invalid_tags",
  );
});

test("all six inbound message classes validate only through the full event envelope", () => {
  const fixtures = {
    AUTH: { challengeRef: "challenge-1" },
    OK: { eventId: EVENT_ID, accepted: true, messageCode: "accepted" },
    EVENT: { subscriptionId: "sub-1", event: signedEvent() },
    EOSE: { subscriptionId: "sub-1" },
    CLOSED: { subscriptionId: "sub-1", reasonCode: "timeout" },
    NOTICE: { code: "maintenance" },
  };
  for (const [messageType, payload] of Object.entries(fixtures)) {
    validateRelayV2InboundEvent(inboundFrame(messageType, payload));
    validateRelayV2InboundMessage(messageType, payload);
  }
  expectCode(
    () => validateRelayV2InboundEvent(inboundFrame("MALFORMED", {})),
    "invalid_payload",
  );
  expectCode(
    () => validateRelayV2InboundMessage("MALFORMED", {}),
    "unsupported_message_type",
  );
  expectCode(
    () => validateRelayV2InboundEvent(inboundFrame("OK", fixtures.EOSE)),
    "invalid_payload",
  );
  expectCode(
    () =>
      validateRelayV2InboundEvent({
        ...inboundFrame("EOSE", fixtures.EOSE),
        extra: true,
      }),
    "invalid_payload",
  );
  expectCode(
    () =>
      validateRelayV2InboundEvent(
        inboundFrame("OK", { ...fixtures.OK, raw: "relay prose" }),
      ),
    "invalid_payload",
  );
});

test("inbound byte codec rejects duplicate keys, malformed UTF-8, and frame overflow", () => {
  const valid = Buffer.from(
    JSON.stringify(inboundFrame("EOSE", { subscriptionId: "sub-1" })),
  );
  assert.deepEqual(
    validateRelayV2InboundFrame(valid),
    inboundFrame("EOSE", { subscriptionId: "sub-1" }),
  );
  const duplicate = Buffer.from(
    `{"connectionId":"${CONNECTION}","generation":1,"messageType":"EOSE","payload":{"subscriptionId":"one","subscriptionId":"two"}}`,
  );
  expectCode(() => validateRelayV2InboundFrame(duplicate), "invalid_payload");
  expectCode(
    () => validateRelayV2InboundFrame(Uint8Array.from([0xff])),
    "invalid_payload",
  );
  expectCode(
    () =>
      validateRelayV2InboundFrame(
        new Uint8Array(RELAY_V2_LIMITS.relayFrameBytes + 1),
      ),
    "oversized_frame",
  );
});

test("encoding validates before producing a bounded canonical payload", () => {
  const payload = requestPayload("relay-transport/authenticate");
  const encoded = encodeRelayV2RequestPayload(
    context("relay-transport/authenticate", "relay-transport"),
    payload,
  );
  assert.equal(
    encoded.toString("utf8"),
    '{"challengeRef":"challenge-1","connectionId":"01234567-89ab-cdef-0123-456789abcdef"}',
  );
  expectCode(
    () =>
      encodeRelayV2RequestPayload(
        context("relay-transport/authenticate", "relay-transport"),
        { ...payload, extra: true },
      ),
    "invalid_payload",
  );
});

test("public relay codes are finite and raw server prose never becomes a code", () => {
  for (const [codeClass, code] of [
    ["ok", "accepted"],
    ["closed", "timeout"],
    ["notice", "maintenance"],
  ]) {
    validateRelayV2ErrorCode(codeClass, code);
  }
  expectCode(
    () => validateRelayV2ErrorCode("ok", "raw relay prose"),
    "invalid_code",
  );
  expectCode(
    () => validateRelayV2ErrorCode("notice", "accepted"),
    "invalid_code",
  );
});
