import assert from "node:assert/strict";
import test from "node:test";

import {
  createCancel,
  createHello,
  createRehello,
  createRequest,
  decodeFrame,
  encodeFrame,
  FrameDecoder,
  LIMITS,
  loadManifest,
  MANIFEST,
  PROFILE_ID,
  PROTOCOL,
  REGISTRY_DIGEST,
  redactedProtocolCode,
  validateEnvelope,
} from "./host-protocol.mjs";

const SESSION_ID = "session-protocol-test";
const BUILD_ID = "node-contract";

function expectProtocolError(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function binding(generationId = 1) {
  return { profileId: PROFILE_ID, sessionId: SESSION_ID, generationId };
}

function hostFrame(type, generationId = 1, fields = {}) {
  return {
    type,
    protocolVersion: PROTOCOL.version,
    ...binding(generationId),
    ...fields,
  };
}

test("manifest exposes the frozen namespace, limits, registry, and digest", () => {
  assert.equal(
    MANIFEST.sourceRevision,
    "ef2aa1ae38fadcc0bc22b8bf6ed96b35933146be",
  );
  assert.equal(
    MANIFEST.namespace.applicationId,
    "xyz.ainative.ventures.colony.dev",
  );
  assert.equal(
    MANIFEST.namespace.userDataRelativePath,
    "Colony/dev/0000000000000001",
  );
  assert.equal(
    MANIFEST.namespace.keychainService,
    "xyz.ainative.ventures.colony.dev.0000000000000001",
  );
  assert.equal(
    MANIFEST.namespace.helperIdentity,
    "colony-native.dev.0000000000000001",
  );
  assert.equal(MANIFEST.namespace.deepLinkScheme, "colony-dev");
  assert.equal(
    REGISTRY_DIGEST,
    "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49",
  );
  assert.equal(LIMITS.frameLimitBytes, 16 * 1024 * 1024);
  assert.equal(LIMITS.jsonPayloadLimitBytes, 8 * 1024 * 1024);
  assert.equal(LIMITS.jsonDepthLimit, 32);
  assert.equal(LIMITS.inFlightLimit, 128);
  assert.equal(LIMITS.outboundQueueLimit, 64);
  assert.equal(Object.isFrozen(MANIFEST), true);
  assert.equal(Object.isFrozen(MANIFEST.protocol.registry), true);
});

test("manifest validation rejects drift and loadManifest returns an immutable copy", () => {
  const copy = JSON.parse(JSON.stringify(MANIFEST));
  copy.protocol.frameLimitBytes += 1;
  expectProtocolError(
    () => loadManifest(copy),
    "invalid_manifest_frameLimitBytes",
  );
  expectProtocolError(
    () =>
      loadManifest({
        ...MANIFEST,
        namespace: { ...MANIFEST.namespace, profileId: "old" },
      }),
    "invalid_manifest_profileId",
  );
});

test("all current wire frame shapes encode and decode through the byte prefix", () => {
  const hello = createHello({
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    buildId: BUILD_ID,
  });
  const rehello = createRehello({
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId: 2,
    buildId: BUILD_ID,
  });
  const request = createRequest({
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId: 1,
    requestId: "request-1",
    capability: "health-safe",
    method: "get_default_relay_url",
    payload: {},
  });
  const cancel = createCancel({
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId: 1,
    requestId: "request-1",
  });
  const ready = hostFrame("READY", 1, {
    payload: { capabilities: ["health-safe"] },
    registryDigest: REGISTRY_DIGEST,
  });
  const rebound = hostFrame("REBOUND", 2, { registryDigest: REGISTRY_DIGEST });
  const response = hostFrame("RESPONSE", 1, {
    requestId: "request-1",
    outcome: "ok",
    payload: { relayUrl: "ws://localhost:3000" },
  });
  const event = hostFrame("EVENT", 1, {
    event: "host_lifecycle",
    payload: { state: "ready" },
    sequence: 1,
  });

  for (const [frame, direction] of [
    [hello, "main"],
    [rehello, "main"],
    [request, "main"],
    [cancel, "main"],
    [ready, "host"],
    [rebound, "host"],
    [response, "host"],
    [event, "host"],
  ]) {
    const encoded = encodeFrame(frame, { direction });
    assert.equal(encoded.subarray(0, 15).toString(), "@colony-native:");
    assert.equal(encoded.at(-1), 0x0a);
    const decoded = decodeFrame(encoded.subarray(0, -1), { direction });
    assert.deepEqual(decoded, frame);
  }
});

test("FrameDecoder handles split and batched writes without text-size truncation", () => {
  const hello = encodeFrame(
    createHello({
      profileId: PROFILE_ID,
      sessionId: SESSION_ID,
      buildId: BUILD_ID,
    }),
    { direction: "main" },
  );
  const request = encodeFrame(
    createRequest({
      profileId: PROFILE_ID,
      sessionId: SESSION_ID,
      generationId: 1,
      requestId: "batched",
      capability: "health-safe",
      method: "get_default_relay_url",
      payload: {},
    }),
    { direction: "main" },
  );
  const decoder = new FrameDecoder({ direction: "any" });
  const splitAt = Math.floor(hello.length / 2);
  assert.deepEqual(decoder.push(hello.subarray(0, splitAt)), []);
  assert.deepEqual(
    decoder.push(Buffer.concat([hello.subarray(splitAt), request])),
    [
      createHello({
        profileId: PROFILE_ID,
        sessionId: SESSION_ID,
        buildId: BUILD_ID,
      }),
      createRequest({
        profileId: PROFILE_ID,
        sessionId: SESSION_ID,
        generationId: 1,
        requestId: "batched",
        capability: "health-safe",
        method: "get_default_relay_url",
        payload: {},
      }),
    ],
  );
  decoder.finish();
});

test("FrameDecoder rejects an oversized completion before copying a partial frame", () => {
  const frameLimitBytes = 64;
  const decoder = new FrameDecoder({ direction: "any", frameLimitBytes });
  decoder.push(Buffer.from("@colony-native:{"));
  const hugeCompletion = Buffer.concat([
    Buffer.alloc(frameLimitBytes, 0x20),
    Buffer.from("\n"),
  ]);
  const originalConcat = Buffer.concat;
  let concatCalls = 0;
  let largestCopy = 0;
  Buffer.concat = (chunks, totalLength) => {
    concatCalls += 1;
    const copiedBytes = chunks.reduce(
      (total, chunk) => total + chunk.length,
      0,
    );
    largestCopy = Math.max(largestCopy, copiedBytes);
    return originalConcat(chunks, totalLength);
  };
  try {
    expectProtocolError(() => decoder.push(hugeCompletion), "frame_too_large");
  } finally {
    Buffer.concat = originalConcat;
  }
  assert.equal(concatCalls, 0);
  assert.equal(largestCopy, 0);
});

test("malformed, oversized, deep, invalid-prefix, and invalid-UTF8 frames fail before dispatch", () => {
  expectProtocolError(
    () => decodeFrame(Buffer.from("missing-prefix")),
    "invalid_prefix",
  );
  expectProtocolError(
    () => decodeFrame(Buffer.from("@colony-native:{not-json}")),
    "invalid_json",
  );
  expectProtocolError(
    () =>
      decodeFrame(
        Buffer.concat([Buffer.from("@colony-native:"), Buffer.from([0xff])]),
      ),
    "invalid_utf8",
  );
  const oversized = Buffer.concat([
    Buffer.from("@colony-native:"),
    Buffer.alloc(LIMITS.jsonPayloadLimitBytes + 1, 0x20),
  ]);
  expectProtocolError(() => decodeFrame(oversized), "json_too_large");

  let deepValue = 0;
  for (let depth = 0; depth < 33; depth += 1) deepValue = [deepValue];
  const deepFrame = Buffer.from(
    `@colony-native:${JSON.stringify({
      type: "HELLO",
      protocolVersion: 1,
      profileId: PROFILE_ID,
      sessionId: SESSION_ID,
      generationId: 1,
      buildId: BUILD_ID,
      payload: deepValue,
    })}`,
  );
  expectProtocolError(() => decodeFrame(deepFrame), "json_too_deep");

  const decoder = new FrameDecoder({ direction: "any" });
  expectProtocolError(
    () => decoder.push(Buffer.alloc(LIMITS.frameLimitBytes)),
    "frame_too_large",
  );
});

test("redactedProtocolCode only preserves the finite public error vocabulary", () => {
  assert.equal(
    redactedProtocolCode({ code: "renderer_rebound" }, "error"),
    "renderer_rebound",
  );
  assert.equal(
    redactedProtocolCode({ code: "future_generation" }, "error"),
    "future_generation",
  );
  assert.equal(
    redactedProtocolCode({ code: "private_token_value" }, "error"),
    "error",
  );
  assert.equal(
    redactedProtocolCode({ code: "private_token_value" }, "host_unavailable"),
    "host_unavailable",
  );
});

test("binding and schema checks reject stale or untrusted frames deterministically", () => {
  const current = binding(2);
  const request = createRequest({
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId: 2,
    requestId: "request-2",
    capability: "health-safe",
    method: "get_default_relay_url",
    payload: {},
  });
  expectProtocolError(
    () =>
      validateEnvelope(
        { ...request, sessionId: "other" },
        { direction: "main", binding: current },
      ),
    "wrong_binding",
  );
  assert.doesNotThrow(() =>
    validateEnvelope(
      { ...request, capability: "domain" },
      { direction: "main" },
    ),
  );
  expectProtocolError(
    () =>
      createRequest({
        profileId: PROFILE_ID,
        sessionId: SESSION_ID,
        generationId: 2,
        requestId: "unknown-capability",
        capability: "domain",
        method: "get_default_relay_url",
        payload: {},
      }),
    "unknown_capability",
  );
  expectProtocolError(
    () =>
      createRequest({
        profileId: PROFILE_ID,
        sessionId: SESSION_ID,
        generationId: 2,
        requestId: "bad-payload",
        capability: "health-safe",
        method: "get_default_relay_url",
        payload: { extra: true },
      }),
    "invalid_payload",
  );
  expectProtocolError(
    () =>
      validateEnvelope({ ...request, generationId: 0 }, { direction: "main" }),
    "invalid_generation_id",
  );
});
