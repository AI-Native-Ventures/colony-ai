// A relay rejection addressed to one event must settle that event's pending
// publish *and* arm the rate-limit gate.
//
// History: the relay rejected an over-quota EVENT with a bare
// `["NOTICE", "rate-limited: ..."]`. A NOTICE carries no event id, and
// `pendingEvents` is keyed by event id, so nothing settled — the publish sat
// until PUBLISH_TIMEOUT_MS (25s) and surfaced as a message stuck on
// "Sending…". Startup quota exhaustion made that routine in the first seconds
// after launch. The relay now rejects on the OK channel instead, so the gate
// arming that used to live in the NOTICE branch has to happen here too.
import assert from "node:assert/strict";
import test from "node:test";

let fakeNow = 0;
const pendingTimers = new Map();
let nextTimerId = 1;
const sendAttempts = [];
const deliveredFrames = [];
const sendTimes = [];
let invokeError = null;
let sendTransport = async (args) => {
  deliveredFrames.push(args);
  sendTimes.push(fakeNow);
};

globalThis.window = {
  setTimeout: (fn, ms) => {
    const id = nextTimerId++;
    pendingTimers.set(id, { fn, fireAt: fakeNow + ms });
    return id;
  },
  clearTimeout: (id) => pendingTimers.delete(id),
  __TAURI_INTERNALS__: {
    invoke: async (command, args) => {
      if (command === "get_channels" && invokeError) throw invokeError;
      if (command === "plugin:websocket|send") {
        sendAttempts.push(args);
        return sendTransport(args);
      }
    },
  },
};
Date.now = () => fakeNow;

const { RelayClient } = await import("./relayClientSession.ts");
const { invokeTauri } = await import("./tauri.ts");
const { activateRateLimit, isRateLimited, resetRateLimitGate } = await import(
  "./relayRateLimitGate.ts"
);
const { resetRelayWebSocketOperationPacer } = await import(
  "./relayWebSocketOperationPacer.ts"
);

function reset() {
  resetRateLimitGate();
  resetRelayWebSocketOperationPacer();
  fakeNow = 0;
  invokeError = null;
  pendingTimers.clear();
  nextTimerId = 1;
  sendAttempts.length = 0;
  deliveredFrames.length = 0;
  sendTimes.length = 0;
  sendTransport = async (args) => {
    deliveredFrames.push(args);
    sendTimes.push(fakeNow);
  };
}

function connectedClient() {
  const client = new RelayClient();
  client.wsId = 7;
  return client;
}

function eventFrames() {
  return deliveredFrames.filter(
    ({ message }) => JSON.parse(message.data)[0] === "EVENT",
  );
}

function requestFrames() {
  return sendAttempts.filter(
    ({ message }) => JSON.parse(message.data)[0] === "REQ",
  );
}

async function flushUntil(predicate, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail("condition did not become true before the microtask limit");
}

async function flushMicrotasks(attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await Promise.resolve();
  }
}

async function advanceTimersBy(ms) {
  const target = fakeNow + ms;
  for (let step = 0; step < 10_000; step++) {
    await flushMicrotasks();
    const next = [...pendingTimers.entries()]
      .filter(([, timer]) => timer.fireAt <= target)
      .sort((left, right) => left[1].fireAt - right[1].fireAt)[0];
    if (!next) break;
    const [id, timer] = next;
    pendingTimers.delete(id);
    fakeNow = timer.fireAt;
    timer.fn();
    await flushMicrotasks();
  }
  fakeNow = target;
  await flushMicrotasks();
}

async function advanceTimersUntil(predicate, maxMs = 5_000) {
  const deadline = fakeNow + maxMs;
  for (let step = 0; step < 10_000 && !predicate(); step++) {
    await flushMicrotasks();
    if (predicate()) return;
    const next = [...pendingTimers.entries()]
      .filter(([, timer]) => timer.fireAt <= deadline)
      .sort((left, right) => left[1].fireAt - right[1].fireAt)[0];
    if (!next) break;
    const [id, timer] = next;
    pendingTimers.delete(id);
    fakeNow = timer.fireAt;
    timer.fn();
    await flushMicrotasks();
  }
  assert.ok(predicate(), "expected operation did not run before fake deadline");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

/**
 * Registers a pending publish the way `publishEvent` does, without needing a
 * socket: the OK dispatch under test only reads `pendingEvents`.
 */
function armPendingPublish(client, eventId) {
  const event = { id: eventId };
  const settled = new Promise((resolve, reject) => {
    client.pendingEvents.set(eventId, {
      event,
      resolve,
      reject,
      timeout: window.setTimeout(() => {}, 25_000),
    });
  });
  // Keep the rejection from surfacing as an unhandled rejection.
  return settled.then(
    (value) => ({ status: "resolved", value }),
    (error) => ({ status: "rejected", error }),
  );
}

/** Feeds a raw relay frame through the real inbound dispatch path. */
function deliver(client, frame) {
  return client.handleWsMessage(
    { type: "Text", data: JSON.stringify(frame) },
    client.connectionGeneration,
  );
}

test("a rate-limited OK rejection settles the pending publish", async () => {
  resetRateLimitGate();
  pendingTimers.clear();
  const client = new RelayClient();
  const eventId = "a".repeat(64);
  const settled = armPendingPublish(client, eventId);

  await deliver(client, [
    "OK",
    eventId,
    false,
    "rate-limited: quota exceeded; retry in 4s",
  ]);

  const outcome = await settled;
  assert.equal(
    outcome.status,
    "rejected",
    "an over-quota publish must fail fast, not hang until the 25s publish timeout",
  );
  assert.match(outcome.error.message, /rate-limited/);
  assert.equal(
    client.pendingEvents.has(eventId),
    false,
    "the pending entry must be cleared",
  );
});

test("a rate-limited OK rejection arms the rate-limit gate", async () => {
  resetRateLimitGate();
  pendingTimers.clear();
  const client = new RelayClient();
  const eventId = "b".repeat(64);
  const settled = armPendingPublish(client, eventId);

  assert.equal(isRateLimited(), false, "gate starts closed");

  await deliver(client, [
    "OK",
    eventId,
    false,
    "rate-limited: quota exceeded; retry in 4s",
  ]);
  await settled;

  assert.equal(
    isRateLimited(),
    true,
    "back-pressure now arrives on the OK channel — without arming here the " +
      "client fails the send and immediately retries into the same quota",
  );
});

test("an ordinary OK rejection does not arm the gate", async () => {
  resetRateLimitGate();
  pendingTimers.clear();
  const client = new RelayClient();
  const eventId = "c".repeat(64);
  const settled = armPendingPublish(client, eventId);

  await deliver(client, ["OK", eventId, false, "invalid: bad signature"]);
  const outcome = await settled;

  assert.equal(outcome.status, "rejected");
  assert.equal(
    isRateLimited(),
    false,
    "only `rate-limited:` rejections signal back-pressure",
  );
});

test("an accepted OK still resolves the pending publish", async () => {
  reset();
  const client = new RelayClient();
  const eventId = "d".repeat(64);
  const settled = armPendingPublish(client, eventId);

  await deliver(client, ["OK", eventId, true, ""]);
  const outcome = await settled;

  assert.equal(outcome.status, "resolved");
  assert.equal(outcome.value.id, eventId);
});

test("a publish started during an ordinary outage reconnects once and settles", async () => {
  reset();
  const client = new RelayClient();
  const event = { id: "0".repeat(64), kind: 1 };
  let reconnects = 0;
  client.ensureConnected = async () => {
    reconnects++;
    client.connectionGeneration++;
    client.wsId = 8;
    return client.connectionGeneration;
  };

  const published = client.publishEvent(event, "timed out", "send failed");
  await flushUntil(() => eventFrames().length === 1);

  assert.equal(reconnects, 1);
  assert.equal(sendAttempts.length, 1);
  assert.equal(client.pendingEvents.has(event.id), true);

  await deliver(client, ["OK", event.id, true, ""]);
  assert.equal(await published, event);
  assert.equal(client.pendingEvents.size, 0);
});

test("a community switch while gated cannot publish through its replacement socket", async () => {
  reset();
  activateRateLimit(4);
  const client = connectedClient();
  const event = { id: "e".repeat(64), kind: 1 };

  const published = client.publishEvent(event, "timed out", "send failed");
  await Promise.resolve();
  assert.equal(client.pendingEvents.size, 0);

  client.disconnect();
  resetRateLimitGate();
  client.wsId = 8;

  await assert.rejects(published, /community switch/);
  assert.equal(client.pendingEvents.size, 0);
  assert.equal(eventFrames().length, 0);
});

test("a community switch after send failure cannot retry through its replacement socket", async () => {
  reset();
  const client = connectedClient();
  const event = { id: "f".repeat(64), kind: 1 };
  const reconnect = deferred();
  client.ensureConnected = async () => {
    await reconnect.promise;
    return client.connectionGeneration;
  };
  sendTransport = async () => {
    throw new Error("old socket failed");
  };

  const published = client.publishEvent(event, "timed out", "send failed");
  const outcome = published.then(
    () => ({ status: "resolved" }),
    (error) => ({ status: "rejected", error }),
  );
  await flushUntil(() => client.connectionGeneration === 1);
  assert.equal(sendAttempts.length, 1);
  assert.equal(eventFrames().length, 0);
  assert.equal(
    client.connectionGeneration,
    1,
    "the failed send reset its socket",
  );
  assert.equal(
    client.pendingEvents.has(event.id),
    true,
    "the original publish remains owned while reconnect is pending",
  );

  client.disconnect();
  client.wsId = 8;
  const settledBeforeReconnect = await outcome;
  assert.equal(
    settledBeforeReconnect.status,
    "rejected",
    "community switch must settle the publish without waiting for reconnect",
  );
  assert.match(settledBeforeReconnect.error.message, /community switch/);

  reconnect.resolve();
  await published.catch(() => {});
  await Promise.resolve();
  assert.equal(client.pendingEvents.size, 0);
  assert.equal(
    sendAttempts.length,
    1,
    "the replacement socket must not be used",
  );
  assert.equal(eventFrames().length, 0);
});

// Drive the actual invoke rejection and publisher, not a classifier helper.
// Restoring HTTP -> WS gate propagation must fail before any timer advances.
for (const message of [
  "relay rate-limited: retry in 50s",
  "relay rate-limited: quota exceeded",
  "relay rate-limited: retry in 1000000s",
]) {
  test(`HTTP backoff does not withhold a WS publish: ${message}`, async () => {
    reset();
    invokeError = message;
    await assert.rejects(invokeTauri("get_channels"), { message });
    const client = connectedClient();
    const event = { id: "9".repeat(64), kind: 9 };
    const published = client.publishEvent(event, "timed out", "send failed");
    try {
      await flushUntil(() => eventFrames().length === 1);
      assert.equal(isRateLimited(), false);
      await deliver(client, ["OK", event.id, true, ""]);
      assert.equal(await published, event);
      assert.equal(client.pendingEvents.size, 0);
    } finally {
      // Also drain safely when the pre-fix gate coupling is restored.
      resetRateLimitGate();
      await flushUntil(() => eventFrames().length === 1);
      await deliver(client, ["OK", event.id, true, ""]);
      await published;
    }
  });
}

test("HTTP failure does not clear an existing WS backoff", async () => {
  reset();
  const client = connectedClient();
  await deliver(client, [
    "NOTICE",
    "rate-limited: quota exceeded; retry in 4s",
  ]);
  invokeError = "relay rate-limited: retry in 50s";
  await assert.rejects(invokeTauri("get_channels"), { message: invokeError });
  const event = { id: "8".repeat(64), kind: 9 };
  const published = client.publishEvent(event, "timed out", "send failed");
  await Promise.resolve();
  assert.equal(eventFrames().length, 0);
  assert.equal(isRateLimited(), true);
  assert.ok([...pendingTimers.values()].some(({ fireAt }) => fireAt === 4_000));
  assert.ok(
    ![...pendingTimers.values()].some(({ fireAt }) => fireAt === 50_000),
  );
  resetRateLimitGate();
  await flushUntil(() => eventFrames().length === 1);
  await deliver(client, ["OK", event.id, true, ""]);
  assert.equal(await published, event);
});

test("initial live subscriptions share the production relay operation pacer", async () => {
  reset();
  const client = connectedClient();
  const subscriptions = [
    client.subscribeLive({ kinds: [1], limit: 10 }, () => {}),
    client.subscribeLive({ kinds: [2], limit: 10 }, () => {}),
    client.subscribeLive({ kinds: [3], limit: 10 }, () => {}),
  ];

  await advanceTimersUntil(() => requestFrames().length === 3);

  assert.deepEqual(
    sendTimes,
    [0, 125, 250],
    "REQ frames from concurrent startup subscriptions must be spaced at 8/s",
  );
  for (const { message } of requestFrames()) {
    const [, subId] = JSON.parse(message.data);
    await deliver(client, ["EOSE", subId]);
  }
  await Promise.all(subscriptions);
});

test("a rate-limited publish retries the same signed event after the relay hint", async () => {
  reset();
  const originalRandom = Math.random;
  Math.random = () => 0.25;
  try {
    const client = connectedClient();
    const event = {
      id: "a1".repeat(32),
      kind: 9,
      content: "keep this signed event pending",
      tags: [["h", "channel-id"]],
    };
    let outcome = "pending";
    const published = client.publishEvent(event, "timed out", "send failed");
    void published.then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );

    await flushUntil(() => eventFrames().length === 1);
    const firstFrame = JSON.parse(eventFrames()[0].message.data)[1];
    await deliver(client, [
      "OK",
      event.id,
      false,
      "rate-limited: quota exceeded; retry in 4s",
    ]);

    assert.equal(outcome, "pending");
    await advanceTimersBy(3_999);
    assert.equal(eventFrames().length, 1, "do not retry before the relay hint");
    await advanceTimersBy(1);
    assert.equal(eventFrames().length, 1, "apply positive retry jitter");
    await advanceTimersBy(124);
    assert.equal(eventFrames().length, 1);
    await advanceTimersBy(1);
    await flushUntil(() => eventFrames().length === 2);

    const retryFrame = JSON.parse(eventFrames()[1].message.data)[1];
    assert.deepEqual(retryFrame, firstFrame);
    assert.equal(retryFrame.id, event.id);
    assert.equal(sendTimes[1] - sendTimes[0], 4_125);
    assert.equal(outcome, "pending");

    await deliver(client, ["OK", event.id, true, ""]);
    assert.equal(await published, event);
    await flushMicrotasks();
    assert.equal(outcome, "resolved");
    assert.equal(client.pendingEvents.size, 0);
  } finally {
    Math.random = originalRandom;
  }
});

test("rate-limited publish stops at its 30 second automatic wait budget", async () => {
  reset();
  const client = connectedClient();
  const event = { id: "b2".repeat(32), kind: 9, content: "bounded retry" };
  const published = client.publishEvent(event, "timed out", "send failed");
  await flushUntil(() => eventFrames().length === 1);
  await deliver(client, [
    "OK",
    event.id,
    false,
    "rate-limited: quota exceeded; retry in 45s",
  ]);

  await advanceTimersBy(30_000);

  await assert.rejects(published, /rate-limited: quota exceeded/);
  assert.equal(eventFrames().length, 1, "do not publish before the relay hint");
  assert.equal(client.pendingEvents.size, 0);
  resetRateLimitGate();
});

test("rate-limited publish exposes the existing failure path after bounded retries", async () => {
  reset();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const client = connectedClient();
    const event = {
      id: "c3".repeat(32),
      kind: 9,
      content: "manual retry remains",
    };
    const published = client.publishEvent(event, "timed out", "send failed");

    for (let attempt = 0; attempt <= 3; attempt++) {
      await flushUntil(() => eventFrames().length === attempt + 1);
      const frame = JSON.parse(eventFrames()[attempt].message.data)[1];
      assert.equal(frame.id, event.id);
      await deliver(client, [
        "OK",
        event.id,
        false,
        "rate-limited: quota exceeded; retry in 1s",
      ]);
      if (attempt < 3) {
        await advanceTimersBy(1_000);
      }
    }

    await assert.rejects(published, /rate-limited: quota exceeded/);
    assert.equal(eventFrames().length, 4);
    assert.deepEqual(sendTimes, [0, 1_000, 2_000, 3_000]);
    assert.equal(client.pendingEvents.size, 0);
  } finally {
    Math.random = originalRandom;
    resetRateLimitGate();
  }
});
