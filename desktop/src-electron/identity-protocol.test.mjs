import assert from "node:assert/strict";
import test from "node:test";

import {
  IDENTITY_ERROR_CODES,
  IDENTITY_METADATA_FIELDS,
  IDENTITY_PROTOCOL_VERSION,
  IdentityProtocolError,
  PRODUCTION_CAPABILITIES,
  PRODUCTION_IDENTITY_MANIFEST_DIGEST,
  PRODUCTION_REGISTRY_DOCUMENT,
  PRODUCTION_REGISTRY_DIGEST,
  PRODUCTION_REGISTRY_COMPUTED_DIGEST,
  TEST_V2_REGISTRY_DIGEST,
  V1_REGISTRY_DIGEST,
  canonicalizeJson,
  createIdentityRequest,
  digestJson,
  validateIdentityFrame,
  validateIdentityLaunchDescriptor,
  validateIdentityRequest,
  validateIdentityResponse,
  validateProductionRegistry,
} from "./identity-protocol.mjs";

const RUST_PRODUCTION_REGISTRY_DIGEST =
  "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";
const RUST_TEST_V2_REGISTRY_DIGEST =
  "1032c9f29dee5495099ebf951133bf3cf80c144e39476af39bb67fe62dee3565";
const RUST_V1_REGISTRY_DIGEST =
  "1242953f4a5baf1995ee18bac140ca16178a06205771d8a65ab0a9a39bb0ac49";

const binding = {
  profileId: "0000000000000001",
  sessionId: "identity-codec-session",
  generationId: 1,
};

const launch = {
  profileId: binding.profileId,
  flavor: "normal",
  platform: "linux",
  userDataRoot: "/tmp/Colony/dev/0000000000000001/normal",
  identityMode: "explicit",
  sharedIdentity: false,
  resetProvenance: "not_attempted_fresh",
  identityManifestDigest: PRODUCTION_IDENTITY_MANIFEST_DIGEST,
};

function hello(overrides = {}) {
  return {
    type: "HELLO",
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    ...binding,
    buildId: "identity-codec-test",
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
    identityLaunch: { ...launch },
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    type: "REQUEST",
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    ...binding,
    requestId: "identity-request",
    capability: "identity-read",
    method: "get_identity",
    payload: {},
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
    ...overrides,
  };
}

function response(payload, overrides = {}) {
  const frame = {
    type: "RESPONSE",
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    ...binding,
    requestId: "identity-request",
    outcome: "ok",
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
    ...overrides,
  };
  if (payload !== undefined && !Object.hasOwn(overrides, "payload")) {
    frame.payload = payload;
  }
  if (frame.payload === undefined) delete frame.payload;
  return frame;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof IdentityProtocolError);
    assert.equal(error.code, code);
    return true;
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("Rust 832 production registry vector is independently anchored", () => {
  assert.equal(
    PRODUCTION_REGISTRY_COMPUTED_DIGEST,
    RUST_PRODUCTION_REGISTRY_DIGEST,
  );
  assert.equal(PRODUCTION_REGISTRY_DIGEST, RUST_PRODUCTION_REGISTRY_DIGEST);
  assert.equal(TEST_V2_REGISTRY_DIGEST, RUST_TEST_V2_REGISTRY_DIGEST);
  assert.equal(V1_REGISTRY_DIGEST, RUST_V1_REGISTRY_DIGEST);
  assert.equal(
    digestJson(PRODUCTION_REGISTRY_DOCUMENT),
    RUST_PRODUCTION_REGISTRY_DIGEST,
  );
});

test("canonicalization sorts UTF-8 object keys and preserves arrays", () => {
  const fixture = {
    z: 1,
    nested: { b: 2, a: 1 },
    array: [{ z: true, a: null }, "kept"],
  };
  assert.equal(
    canonicalizeJson(fixture),
    '{"array":[{"a":null,"z":true},"kept"],"nested":{"a":1,"b":2},"z":1}',
  );
  const reordered = {
    array: [{ a: null, z: true }, "kept"],
    nested: { a: 1, b: 2 },
    z: 1,
  };
  assert.equal(digestJson(reordered), digestJson(fixture));
});

test("registry accepts the frozen production document and rejects stale or malformed variants", () => {
  validateProductionRegistry(PRODUCTION_REGISTRY_DOCUMENT);

  const staleTest = clone(PRODUCTION_REGISTRY_DOCUMENT);
  staleTest.schemas["identity-launch"].fields.pop();
  expectCode(() => validateProductionRegistry(staleTest), "registry_mismatch");

  const missingSchema = clone(PRODUCTION_REGISTRY_DOCUMENT);
  delete missingSchema.schemas.boolean;
  expectCode(
    () => validateProductionRegistry(missingSchema),
    "registry_mismatch",
  );

  const unknownField = clone(PRODUCTION_REGISTRY_DOCUMENT);
  unknownField.entries.get_identity.unknown = true;
  expectCode(
    () => validateProductionRegistry(unknownField),
    "registry_mismatch",
  );
});

test("registry digest changes for method schema, authorization, and deadline mutations", () => {
  for (const mutate of [
    (document) => {
      document.entries.get_identity.responseSchema = "boolean";
    },
    (document) => {
      document.entries.get_identity.authorization = "wrong-boundary";
    },
    (document) => {
      document.entries.get_identity.deadlineMs = 10_001;
    },
  ]) {
    const candidate = clone(PRODUCTION_REGISTRY_DOCUMENT);
    mutate(candidate);
    assert.notEqual(digestJson(candidate), RUST_PRODUCTION_REGISTRY_DIGEST);
  }
});

test("production launch descriptor requires exact profile, mode, root, and manifest digest", () => {
  assert.deepEqual(validateIdentityLaunchDescriptor(launch), launch);

  const wrongManifest = { ...launch, identityManifestDigest: "0".repeat(64) };
  expectCode(
    () => validateIdentityLaunchDescriptor(wrongManifest),
    "identity_manifest_mismatch",
  );

  const parentPath = {
    ...launch,
    userDataRoot: "/tmp/Colony/dev/0000000000000001/other/../normal",
  };
  expectCode(
    () => validateIdentityLaunchDescriptor(parentPath),
    "invalid_identity_launch",
  );

  const extra = { ...launch, secret: "nsec1must-not-cross" };
  expectCode(
    () => validateIdentityLaunchDescriptor(extra),
    "invalid_identity_launch",
  );
});

test("HELLO, READY, REBOUND, and lifecycle frames use the production digest and exact shapes", () => {
  validateIdentityFrame(hello(), { direction: "main" });
  validateIdentityFrame(
    {
      type: "READY",
      protocolVersion: IDENTITY_PROTOCOL_VERSION,
      ...binding,
      payload: { capabilities: [...PRODUCTION_CAPABILITIES] },
      registryDigest: PRODUCTION_REGISTRY_DIGEST,
    },
    { direction: "host", binding },
  );
  validateIdentityFrame(
    {
      type: "REBOUND",
      protocolVersion: IDENTITY_PROTOCOL_VERSION,
      ...binding,
      generationId: 2,
      registryDigest: PRODUCTION_REGISTRY_DIGEST,
    },
    { direction: "host", binding: { ...binding, generationId: 2 } },
  );
  validateIdentityFrame(
    {
      type: "EVENT",
      protocolVersion: IDENTITY_PROTOCOL_VERSION,
      ...binding,
      payload: { state: "ready" },
      event: "host_lifecycle",
      sequence: 1,
      registryDigest: PRODUCTION_REGISTRY_DIGEST,
    },
    { direction: "host", binding },
  );

  expectCode(
    () =>
      validateIdentityFrame({
        ...hello(),
        registryDigest: RUST_TEST_V2_REGISTRY_DIGEST,
      }),
    "registry_mismatch",
  );
  expectCode(
    () => validateIdentityFrame({ ...hello(), protocolVersion: 1 }),
    "invalid_protocol_version",
  );
  const missingLaunch = hello();
  delete missingLaunch.identityLaunch;
  expectCode(
    () => validateIdentityFrame(missingLaunch),
    "invalid_hello_schema",
  );
});

test("named requests accept only the three frozen capability/method pairs and an empty payload", () => {
  const created = createIdentityRequest({
    ...binding,
    requestId: "mode-request",
    capability: "identity-mode",
    method: "is_shared_identity",
  });
  assert.equal(created.registryDigest, PRODUCTION_REGISTRY_DIGEST);
  validateIdentityRequest(created);
  validateIdentityRequest(
    request({
      capability: "identity-mode",
      method: "is_shared_identity",
    }),
  );

  expectCode(
    () =>
      validateIdentityRequest(
        request({ capability: "identity-read", method: "is_shared_identity" }),
      ),
    "unknown_method",
  );
  expectCode(
    () =>
      validateIdentityRequest(
        request({ capability: "secret-tunnel", method: "get_identity" }),
      ),
    "unknown_capability",
  );
  expectCode(
    () =>
      validateIdentityRequest(request({ payload: { nsec: "nsec1secret" } })),
    "invalid_payload",
  );
  expectCode(
    () => validateIdentityRequest({ ...request(), unexpected: true }),
    "invalid_request_schema",
  );
});

test("is_shared_identity and get_identity success payloads are exact and bounded", () => {
  validateIdentityResponse(
    response({ value: false }, { requestId: "mode-request" }),
    {
      expectedCapability: "identity-mode",
      expectedMethod: "is_shared_identity",
    },
  );
  const metadata = {
    display_name: "npub1abc…wxyz",
    locked: false,
    lost: false,
    pubkey: "0".repeat(64),
    reset_failed: false,
    storage: "local-file",
  };
  const identityResponseOptions = {
    expectedCapability: "identity-read",
    expectedMethod: "get_identity",
  };
  validateIdentityResponse(response(metadata), identityResponseOptions);
  assert.deepEqual(
    Object.keys(metadata).sort(),
    [...IDENTITY_METADATA_FIELDS].sort(),
  );

  const missing = { ...metadata };
  delete missing.display_name;
  expectCode(
    () => validateIdentityResponse(response(missing), identityResponseOptions),
    "invalid_identity_metadata",
  );
  expectCode(
    () =>
      validateIdentityResponse(
        response({ ...metadata, extra: true }),
        identityResponseOptions,
      ),
    "invalid_identity_metadata",
  );
  expectCode(
    () =>
      validateIdentityResponse(
        response({ ...metadata, display_name: "x".repeat(129) }),
        identityResponseOptions,
      ),
    "invalid_identity_metadata",
  );
  expectCode(
    () =>
      validateIdentityResponse(
        response({ ...metadata, storage: "unknown" }),
        identityResponseOptions,
      ),
    "invalid_identity_metadata",
  );
  expectCode(
    () =>
      validateIdentityResponse(
        response({ ...metadata, pubkey: "nsec1secret" }),
        identityResponseOptions,
      ),
    "invalid_identity_metadata",
  );
});

test("responses are either one declared payload or one finite code-only error", () => {
  for (const code of IDENTITY_ERROR_CODES) {
    validateIdentityResponse(
      response(undefined, {
        outcome: "error",
        error: { code },
        payload: undefined,
      }),
    );
  }

  expectCode(
    () =>
      validateIdentityResponse(
        response(undefined, {
          outcome: "error",
          error: { code: "secret_n2c" },
        }),
      ),
    "invalid_error_code",
  );
  expectCode(
    () =>
      validateIdentityResponse(
        response({ value: false }, { error: { code: "timeout" } }),
      ),
    "invalid_success_error",
  );
  expectCode(
    () =>
      validateIdentityResponse(
        response(undefined, {
          outcome: "error",
          error: { code: "timeout", detail: "private backend detail" },
        }),
      ),
    "invalid_error",
  );
  expectCode(
    () =>
      validateIdentityResponse(
        response(
          { value: false },
          { outcome: "error", error: { code: "timeout" } },
        ),
      ),
    "invalid_error_payload",
  );
  expectCode(
    () =>
      validateIdentityResponse(response(undefined, { outcome: "cancelled" })),
    "missing_error",
  );
  const missingOutcome = response({ value: false });
  delete missingOutcome.outcome;
  expectCode(
    () => validateIdentityResponse(missingOutcome),
    "invalid_response_schema",
  );
});

test("binding and generation fences reject stale, future, or cross-session frames", () => {
  expectCode(
    () =>
      validateIdentityFrame(
        { ...hello(), sessionId: "other-session" },
        { binding },
      ),
    "wrong_binding",
  );
  expectCode(
    () =>
      validateIdentityFrame(
        { ...request(), generationId: 2 },
        { expectedGeneration: 1 },
      ),
    "wrong_generation",
  );
  expectCode(
    () =>
      validateIdentityFrame(
        {
          type: "REBOUND",
          protocolVersion: IDENTITY_PROTOCOL_VERSION,
          ...binding,
          generationId: 2,
          registryDigest: PRODUCTION_REGISTRY_DIGEST,
          payload: null,
        },
        { direction: "host" },
      ),
    "invalid_rebound_schema",
  );
});
