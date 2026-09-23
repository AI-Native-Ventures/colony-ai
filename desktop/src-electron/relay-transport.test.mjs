// Focused RelayTransport adapter vectors (mock child only).
// Real-helper and disposable-relay proof arrive via the hosted interop lane;
// nothing here opens a socket, spawns a process, or contacts a relay.

import assert from "node:assert/strict";
import test from "node:test";

import {
  RELAY_V2_LIMITS,
  RELAY_V2_REGISTRY_DIGEST,
  encodeRelayV2RequestPayload,
} from "./relay-protocol.mjs";
import {
  RELAY_TRANSPORT_OPERATIONS,
  RelayTransport,
  redactedRelayTransportCode,
} from "./relay-transport.mjs";

const AUTHORITY = "a".repeat(64);
const CONNECTION = "01234567-89ab-cdef-0123-456789abcdef";
const EVENT_ID = "e".repeat(64);
const PUBKEY = "f".repeat(64);
const ENVELOPE_PROTOCOL_VERSION = 1;
const PROFILE_ID = "relay-v2";
const SESSION_ID = "relay-transport-interop";

function contextFor(operation) {
  return {
    protocolVersion: 2,
    profile: "relay-v2",
    registryDigest: RELAY_V2_REGISTRY_DIGEST,
    operation,
    capability: operation.split("/")[0],
    authorityRef: AUTHORITY,
  };
}

function payloadFor(operation) {
  switch (operation) {
    case "relay-transport/connect":
      return { authorityRef: AUTHORITY };
    case "relay-transport/authenticate":
      return { connectionId: CONNECTION, challengeRef: "challenge-1" };
    case "relay-transport/subscribe":
      return {
        connectionId: CONNECTION,
        subscriptionId: "sub-1",
        filter: { kinds: [9], limit: 10 },
      };
    case "relay-transport/close_subscription":
      return { connectionId: CONNECTION, subscriptionId: "sub-1" };
    case "relay-transport/publish":
      return { connectionId: CONNECTION, eventHandle: "handle-1" };
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
        text: "heads down",
        emoji: "",
        expiresAt: null,
      };
    default:
      throw new Error(`unknown fixture operation ${operation}`);
  }
}

function responseFor(operation) {
  switch (operation) {
    case "relay-transport/connect":
      return { connectionId: CONNECTION };
    case "relay-transport/authenticate":
      return { authenticated: true, connectionId: CONNECTION };
    case "relay-transport/subscribe":
      return { connectionId: CONNECTION, subscriptionId: "sub-1" };
    case "relay-transport/close_subscription":
      return {
        connectionId: CONNECTION,
        subscriptionId: "sub-1",
        closed: true,
      };
    case "relay-transport/close":
      return {
        connectionId: CONNECTION,
        subscriptionId: CONNECTION,
        closed: true,
      };
    case "relay-transport/publish":
      return {
        accepted: true,
        connectionId: CONNECTION,
        eventHandle: "handle-1",
      };
    case "identity-sign/sign_message":
      return {
        eventHandle: "handle-1",
        signedEvent: {
          id: EVENT_ID,
          pubkey: PUBKEY,
          created_at: 1,
          kind: 9,
          tags: [["h", "channel-1"]],
          content: "hello",
          sig: "c".repeat(128),
        },
      };
    case "identity-sign/sign_presence":
      return {
        eventHandle: "handle-1",
        signedEvent: {
          id: EVENT_ID,
          pubkey: PUBKEY,
          created_at: 1,
          kind: 20001,
          tags: [],
          content: "online",
          sig: "c".repeat(128),
        },
      };
    case "identity-sign/sign_typing":
      return {
        eventHandle: "handle-1",
        signedEvent: {
          id: EVENT_ID,
          pubkey: PUBKEY,
          created_at: 1,
          kind: 20002,
          tags: [["h", "channel-1"]],
          content: "",
          sig: "c".repeat(128),
        },
      };
    case "identity-sign/sign_user_status":
      return {
        eventHandle: "handle-1",
        signedEvent: {
          id: EVENT_ID,
          pubkey: PUBKEY,
          created_at: 1,
          kind: 30315,
          tags: [["d", "general"]],
          content: "heads down",
          sig: "c".repeat(128),
        },
      };
    default:
      throw new Error(`unknown fixture operation ${operation}`);
  }
}

// Mock-child contract, derived field-by-field from native source SHA
// f95b3e93b1f3acc28448c7bfde26c4d68f4d1840
// (protocol.rs Envelope/OutboundFrame, main.rs handle_request_relay and
// send_relay_message_event):
// - REQUEST carries camelCase requestId (Option<String>, echoed back),
//   split capability/method (relay_operation_for maps the pair; full-op
//   strings and unknown pairs fail), and the contract-encoded payload.
// - RESPONSE envelopes use the v1 stdio carrier, echo the full binding and
//   requestId, carry outcome ok/error, payload on ok, and error:{code} on
//   error. outcome missing/other fails closed.
// - relay-message events use an outer EVENT classifier and put the typed
//   {connectionId,generation,messageType,payload} envelope inside payload.
function nativeResponse(call, { outcome = "ok", payload, errorCode } = {}) {
  const frame = {
    type: "RESPONSE",
    protocolVersion: ENVELOPE_PROTOCOL_VERSION,
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId: call.generationId ?? 1,
    requestId: call.requestId,
    outcome,
  };
  if (payload !== undefined) frame.payload = payload;
  if (errorCode !== undefined) frame.error = { code: errorCode };
  return frame;
}

function nativeRelayMessageEvent({
  generationId = 1,
  connectionId = CONNECTION,
  messageType,
  payload,
}) {
  return {
    type: "EVENT",
    protocolVersion: ENVELOPE_PROTOCOL_VERSION,
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId,
    event: "relay_message",
    sequence: 1,
    payload: {
      connectionId,
      generation: generationId,
      messageType,
      payload,
    },
  };
}

function mockChild({ onRequest = null, binding = { generationId: 1 } } = {}) {
  const calls = [];
  const responseFrames = [];
  const listeners = new Set();
  return {
    calls,
    responseFrames,
    listeners,
    request(call) {
      calls.push(call);
      const nativeCall = {
        ...call,
        generationId: binding.generationId ?? 1,
      };
      const response = onRequest
        ? onRequest(nativeCall)
        : Promise.resolve(
            nativeResponse(nativeCall, {
              payload: responseFor(
                `${nativeCall.capability}/${nativeCall.method}`,
              ),
            }),
          );
      return Promise.resolve(response).then((frame) => {
        if (frame?.type === "RESPONSE") responseFrames.push(frame);
        return frame;
      });
    },
    onLifecycle(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getBindingState() {
      return binding;
    },
  };
}

function attached(child, options = {}) {
  const transport = new RelayTransport({ child });
  transport.attach({ authorityRef: AUTHORITY, ...options });
  return transport;
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

test("all ten operations validate before dispatch and accept valid responses", async () => {
  for (const operation of RELAY_TRANSPORT_OPERATIONS) {
    const child = mockChild();
    const transport = attached(child);
    if (operation !== "relay-transport/connect")
      transport.bindConnection(CONNECTION);
    const payload = payloadFor(operation);
    const expected = encodeRelayV2RequestPayload(
      operation === "relay-transport/connect"
        ? contextFor(operation)
        : { ...contextFor(operation), connectionId: CONNECTION },
      payload,
    ).toString("utf8");
    const response = await transport.invoke(operation, payload);
    assert.deepEqual(response, responseFor(operation));
    assert.equal(child.calls.length, 1);
    assert.deepEqual(child.responseFrames[0], {
      type: "RESPONSE",
      protocolVersion: ENVELOPE_PROTOCOL_VERSION,
      profileId: PROFILE_ID,
      sessionId: SESSION_ID,
      generationId: 1,
      requestId: child.calls[0].requestId,
      outcome: "ok",
      payload: responseFor(operation),
    });
    assert.equal(child.calls[0].method, operation.split("/")[1]);
    assert.deepEqual(
      child.calls[0].payload,
      JSON.parse(expected),
      `dispatched payload must equal the contract encoding for ${operation}`,
    );
    transport.dispose();
  }
});

test("unknown operations and wrong authority never reach the child", async () => {
  const child = mockChild();
  const transport = attached(child);
  await expectCode(
    transport.invoke("relay-transport/count", {}),
    "invalid_operation",
  );
  await expectCode(
    transport.invoke("relay-transport/connect", {
      authorityRef: "b".repeat(64),
    }),
    "wrong_authority",
  );
  assert.equal(child.calls.length, 0);
  transport.dispose();
});

test("outbound queue is bounded by the registry limit", async () => {
  const child = mockChild({
    onRequest: () => new Promise(() => {}),
  });
  const transport = attached(child);
  transport.bindConnection(CONNECTION);
  const payload = payloadFor("identity-sign/sign_presence");
  const inFlight = [];
  for (let index = 0; index < RELAY_V2_LIMITS.outboundQueueLimit; index += 1) {
    inFlight.push(transport.invoke("identity-sign/sign_presence", payload));
  }
  await expectCode(
    transport.invoke("identity-sign/sign_presence", payload),
    "queue_full",
  );
  transport.dispose();
  await Promise.allSettled(inFlight);
});

test("stale generation responses settle exactly once as stale", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const child = mockChild({ onRequest: () => gate });
  const transport = attached(child);
  transport.bindConnection(CONNECTION);
  const pending = transport.invoke(
    "identity-sign/sign_presence",
    payloadFor("identity-sign/sign_presence"),
  );
  transport.generation = 2;
  release(
    nativeResponse(child.calls[0], {
      payload: responseFor("identity-sign/sign_presence"),
    }),
  );
  await expectCode(pending, "stale_generation");
  assert.equal(transport.pendingCount(), 0);
  transport.dispose();
});

test("malformed child responses fail closed without payload leakage", async () => {
  const child = mockChild({
    onRequest: () => Promise.resolve({ corrupted: true }),
  });
  const transport = attached(child);
  transport.bindConnection(CONNECTION);
  await expectCode(
    transport.invoke(
      "identity-sign/sign_presence",
      payloadFor("identity-sign/sign_presence"),
    ),
    "invalid_payload",
  );
  transport.dispose();
});

test("native RESPONSE envelope shapes settle exactly per the wire contract", async () => {
  // outcome:"error" with a finite code rejects with that code.
  {
    const child = mockChild({
      onRequest: (call) =>
        nativeResponse(call, {
          outcome: "error",
          errorCode: "request_timeout",
        }),
    });
    const transport = attached(child);
    transport.bindConnection(CONNECTION);
    await expectCode(
      transport.invoke(
        "identity-sign/sign_presence",
        payloadFor("identity-sign/sign_presence"),
      ),
      "request_timeout",
    );
    transport.dispose();
  }
  // outcome:"error" with relay prose fails closed, never passthrough.
  {
    const child = mockChild({
      onRequest: (call) =>
        nativeResponse(call, {
          outcome: "error",
          errorCode: "relay says no",
        }),
    });
    const transport = attached(child);
    transport.bindConnection(CONNECTION);
    await expectCode(
      transport.invoke(
        "identity-sign/sign_presence",
        payloadFor("identity-sign/sign_presence"),
      ),
      "invalid_payload",
    );
    transport.dispose();
  }
  // Unknown outcome fails closed (native only ever emits ok/error).
  {
    const child = mockChild({
      onRequest: (call) =>
        nativeResponse(call, { outcome: "maybe", payload: {} }),
    });
    const transport = attached(child);
    transport.bindConnection(CONNECTION);
    await expectCode(
      transport.invoke(
        "identity-sign/sign_presence",
        payloadFor("identity-sign/sign_presence"),
      ),
      "invalid_payload",
    );
    transport.dispose();
  }
  // Responses arriving after dispose settle with the dispose reason,
  // not with the late response content (exactly-once: dispose wins).
  {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const child = mockChild({ onRequest: () => gate });
    const transport = attached(child);
    transport.bindConnection(CONNECTION);
    const pending = transport.invoke(
      "identity-sign/sign_presence",
      payloadFor("identity-sign/sign_presence"),
    );
    assert.equal(transport.pendingCount(), 1);
    transport.dispose();
    release(
      nativeResponse(child.calls[0], {
        payload: responseFor("identity-sign/sign_presence"),
      }),
    );
    await expectCode(pending, "host_unavailable");
    assert.equal(transport.pendingCount(), 0);
  }
});

test("valid relay events dispatch to subscribers; invalid frames are dropped", async () => {
  const child = mockChild();
  const transport = attached(child);
  transport.bindConnection(CONNECTION);
  const seen = [];
  transport.onRelayEvent((event) => seen.push(event));
  const deliver = [...child.listeners][0];
  deliver(
    nativeRelayMessageEvent({
      messageType: "EOSE",
      payload: { subscriptionId: "sub-1" },
    }),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].messageType, "EOSE");
  deliver(
    nativeRelayMessageEvent({
      messageType: "EOSE",
      payload: { subscriptionId: "sub-1", unexpected: true },
    }),
  );
  deliver(
    nativeRelayMessageEvent({
      generationId: 99,
      messageType: "EOSE",
      payload: { subscriptionId: "sub-1" },
    }),
  );
  assert.equal(seen.length, 1);
  transport.dispose();
});

test("raw inbound frames validate bytes, duplicates, and envelope", async () => {
  const child = mockChild();
  const transport = attached(child);
  transport.bindConnection(CONNECTION);
  const seen = [];
  transport.onRelayEvent((event) => seen.push(event));
  const deliver = [...child.listeners][0];
  const valid = Buffer.from(
    JSON.stringify({
      connectionId: CONNECTION,
      generation: 1,
      messageType: "EOSE",
      payload: { subscriptionId: "sub-1" },
    }),
  );
  deliver({ generationId: 1, rawFrame: new Uint8Array(valid) });
  assert.equal(seen.length, 1);
  const duplicate = Buffer.from(
    `{"connectionId":"${CONNECTION}","generation":1,"messageType":"EOSE","payload":{"subscriptionId":"one","subscriptionId":"two"}}`,
  );
  deliver({ generationId: 1, rawFrame: new Uint8Array(duplicate) });
  deliver({
    generationId: 1,
    rawFrame: new Uint8Array(RELAY_V2_LIMITS.relayFrameBytes + 1),
  });
  assert.equal(seen.length, 1);
  transport.dispose();
});

test("dispose settles pending exactly once and blocks further dispatch", async () => {
  const child = mockChild({ onRequest: () => new Promise(() => {}) });
  const transport = attached(child);
  transport.bindConnection(CONNECTION);
  const pending = transport.invoke(
    "identity-sign/sign_presence",
    payloadFor("identity-sign/sign_presence"),
  );
  transport.dispose("shutdown");
  await expectCode(pending, "shutdown");
  assert.equal(transport.pendingCount(), 0);
  await expectCode(
    transport.invoke(
      "identity-sign/sign_presence",
      payloadFor("identity-sign/sign_presence"),
    ),
    "host_unavailable",
  );
  assert.equal(child.listeners.size, 0);
});

test("error redaction never leaks payload prose", () => {
  assert.equal(
    redactedRelayTransportCode("wrong_authority"),
    "wrong_authority",
  );
  assert.equal(
    redactedRelayTransportCode(new Error("raw relay prose with secret")),
    "host_unavailable",
  );
  assert.equal(
    redactedRelayTransportCode("unsupported_message_type"),
    "invalid_payload",
  );
});
