import assert from "node:assert/strict";
import test from "node:test";

import { createQualificationRendererRequestBroker } from "./renderer-bridge.mjs";

function broker({ generation = 7 } = {}) {
  let current = generation;
  const messages = [];
  const timers = new Map();
  let nextTimer = 0;
  const instance = createQualificationRendererRequestBroker({
    currentGeneration: () => current,
    isAvailable: () => true,
    requestId: () => "request-1",
    send: (message) => messages.push(message),
    timers: {
      set(callback) {
        nextTimer += 1;
        timers.set(nextTimer, callback);
        return nextTimer;
      },
      clear(timer) {
        timers.delete(timer);
      },
    },
  });
  return {
    ...instance,
    messages,
    setGeneration(next) {
      current = next;
    },
  };
}

test("renderer broker correlates a current-generation response", async () => {
  const bridge = broker();
  const pending = bridge.request("load_head", { leadId: "lead-a" });
  assert.deepEqual(bridge.messages, [
    {
      type: "shell-event",
      event: "qualify:request",
      payload: {
        requestId: "request-1",
        generation: 7,
        operation: "load_head",
        payload: { leadId: "lead-a" },
      },
    },
  ]);
  assert.deepEqual(
    bridge.respond({
      requestId: "request-1",
      generation: 7,
      ok: true,
      result: { checkedAt: 1 },
    }),
    { accepted: true },
  );
  await assert.doesNotReject(pending);
  assert.deepEqual(await pending, { checkedAt: 1 });
});

test("renderer broker fences a response from a retired generation", async () => {
  const bridge = broker();
  const pending = bridge.request("publish", { action: { runId: "run-a" } });
  bridge.setGeneration(8);
  assert.deepEqual(
    bridge.respond({
      requestId: "request-1",
      generation: 7,
      ok: true,
      result: { eventId: "a".repeat(64) },
    }),
    { accepted: false },
  );
  await assert.rejects(
    pending,
    /Desktop renderer changed; reopen this qualification action/,
  );
});

test("renderer broker rejects every pending request when its window closes", async () => {
  const bridge = broker();
  const pending = bridge.request("load_head", { leadId: "lead-a" });
  bridge.rejectAll("The qualification window closed.");
  await assert.rejects(pending, /The qualification window closed/);
  assert.throws(
    () =>
      bridge.respond({
        requestId: "request-1",
        generation: 7,
        ok: true,
      }),
    /Qualification renderer response is stale/,
  );
});
