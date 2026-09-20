import assert from "node:assert/strict";
import test from "node:test";

import { PROFILE_ID, REGISTRY_DIGEST } from "./host-protocol.mjs";
import { RendererHost } from "./renderer-host.mjs";

const SESSION_ID = "session-renderer-test";

function lifecycle(generationId, state, sequence = generationId) {
  return {
    type: "EVENT",
    protocolVersion: 1,
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId,
    event: "host_lifecycle",
    payload: { state },
    sequence,
  };
}

class FakeTransport {
  protocol = { subscriptionLimit: 8 };
  binding = { profileId: PROFILE_ID, sessionId: SESSION_ID, generationId: 1 };
  listeners = new Set();
  stateListeners = new Set();
  requests = [];
  rebindCalls = [];
  pendingRequests = new Map();
  rebindResolvers = [];
  disposed = false;
  transportState = "idle";

  constructor({ autoCompleteRebind = true, requestError = null } = {}) {
    this.autoCompleteRebind = autoCompleteRebind;
    this.requestError = requestError;
  }

  onLifecycle(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener) {
    this.stateListeners.add(listener);
    listener(this.stateSnapshot());
    return () => this.stateListeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  stateSnapshot(state = this.transportState) {
    return {
      state,
      profileId: this.binding?.profileId ?? PROFILE_ID,
      sessionId: this.binding?.sessionId ?? SESSION_ID,
      generationId: this.binding?.generationId ?? null,
      registryDigest: this.binding ? REGISTRY_DIGEST : null,
    };
  }

  emitState(state) {
    this.transportState = state;
    for (const listener of this.stateListeners) listener(this.stateSnapshot());
  }

  async start() {
    this.emit(lifecycle(1, "ready", 1));
    this.emitState("ready");
    return { ...this.binding, registryDigest: REGISTRY_DIGEST };
  }

  request({ generationId, requestId = `request-${this.requests.length}` }) {
    if (this.requestError) return Promise.reject(this.requestError);
    if (generationId !== this.binding.generationId) {
      return Promise.reject(
        Object.assign(new Error("stale"), { code: "stale_generation" }),
      );
    }
    this.requests.push({ generationId, requestId });
    if (generationId === 1 && this.pendingRequests.size === 0) {
      return new Promise((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject, generationId });
      });
    }
    return Promise.resolve({
      type: "RESPONSE",
      generationId,
      requestId,
      outcome: "ok",
      payload: { relayUrl: "ws://localhost:3000" },
    });
  }

  rebind(generationId) {
    this.rebindCalls.push(generationId);
    return new Promise((resolve, reject) => {
      this.rebindResolvers.push({ generationId, resolve, reject });
      if (this.autoCompleteRebind)
        queueMicrotask(() => this.#completeNextRebind());
    });
  }

  completeRebind() {
    this.#completeNextRebind();
  }

  rejectRebind(error) {
    const next = this.rebindResolvers.shift();
    if (next) next.reject(error);
  }

  #completeNextRebind() {
    const next = this.rebindResolvers.shift();
    if (!next) return;
    for (const [requestId, pending] of this.pendingRequests) {
      this.pendingRequests.delete(requestId);
      pending.reject(
        Object.assign(new Error("rebound"), { code: "renderer_rebound" }),
      );
    }
    this.binding = {
      profileId: PROFILE_ID,
      sessionId: SESSION_ID,
      generationId: next.generationId,
      registryDigest: REGISTRY_DIGEST,
    };
    this.emitState("ready");
    this.emit({
      type: "REBOUND",
      protocolVersion: 1,
      profileId: PROFILE_ID,
      sessionId: SESSION_ID,
      generationId: next.generationId,
      registryDigest: REGISTRY_DIGEST,
    });
    this.emit(lifecycle(next.generationId, "rebound", next.generationId));
    next.resolve({ ...this.binding });
  }

  async dispose() {
    this.disposed = true;
  }
}

test("RendererHost replays the initial ready lifecycle after listener installation", async () => {
  const transport = new FakeTransport();
  const host = new RendererHost({ transport });
  await host.start();
  const events = [];
  host.onLifecycle((event) => events.push(event));

  assert.deepEqual(
    events.map((event) => event.payload.state),
    ["ready"],
  );
  assert.deepEqual(host.bindingState(), {
    state: "bound",
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId: 1,
    transportGenerationId: 1,
    relayClientEpoch: 0,
    registryDigest: REGISTRY_DIGEST,
  });
});
test("RendererHost fences the old renderer promise and admits health only after REBOUND", async () => {
  const transport = new FakeTransport();
  const host = new RendererHost({ transport });
  await host.start();
  const oldRequest = host.request();
  const barrier = host.reset();

  await assert.rejects(
    oldRequest,
    (error) => error.code === "renderer_rebound",
  );
  await barrier;
  const fresh = await host.request();
  assert.equal(fresh.generationId, 2);
  assert.deepEqual(transport.rebindCalls, [2]);
  assert.equal(host.bindingState().generationId, 2);
  assert.equal(host.bindingState().relayClientEpoch, 1);
});

test("RendererHost observes idle native-host death and fences the old binding", async () => {
  const transport = new FakeTransport();
  const host = new RendererHost({ transport });
  await host.start();
  transport.emitState("failed");

  assert.equal(host.bindingState().state, "unavailable");
  assert.equal(host.bindingState().generationId, null);
  await assert.rejects(
    host.request(),
    (error) => error.code === "host_unavailable",
  );

  const lateEvents = [];
  host.onLifecycle((event) => lateEvents.push(event));
  transport.emit(lifecycle(1, "ready", 99));
  assert.deepEqual(lateEvents, []);
  await host.dispose();
});

test("RendererHost redacts an unlisted regex-valid transport error code", async () => {
  const transport = new FakeTransport({
    requestError: Object.assign(new Error("secret"), {
      code: "private_token_value",
    }),
  });
  const host = new RendererHost({ transport });
  await host.start();
  await assert.rejects(
    host.request(),
    (error) => error.code === "host_unavailable",
  );
  await host.dispose();
});

test("RendererHost serializes repeated reloads and never admits a request between barriers", async () => {
  const transport = new FakeTransport();
  const host = new RendererHost({ transport });
  await host.start();
  const first = host.reset();
  const second = host.reset();
  await assert.rejects(
    host.request(),
    (error) => error.code === "renderer_rebinding",
  );
  await Promise.all([first, second]);
  assert.deepEqual(transport.rebindCalls, [2, 3]);
  assert.equal(host.bindingState().generationId, 3);
  assert.equal(host.bindingState().relayClientEpoch, 2);
  await host.request();
});

test("RendererHost drops stale lifecycle events after reload and retains only current generation", async () => {
  const transport = new FakeTransport();
  const host = new RendererHost({ transport });
  await host.start();
  const events = [];
  host.onLifecycle((event) => events.push(event));
  await host.reset();
  transport.emit(lifecycle(1, "ready", 99));
  transport.emit(lifecycle(2, "rebound", 2));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(
    events.map((event) => [event.generationId, event.payload.state]),
    [
      [1, "ready"],
      [2, "rebound"],
      [2, "rebound"],
    ],
  );
  await host.dispose();
  assert.equal(transport.disposed, true);
});

test("RendererHost disposal fences a late rebind acknowledgement", async () => {
  const transport = new FakeTransport({ autoCompleteRebind: false });
  const host = new RendererHost({ transport });
  await host.start();
  const barrier = host.reset();
  const dispose = host.dispose();
  transport.completeRebind();

  const results = await Promise.allSettled([barrier, dispose]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(results[0].status, "rejected");
  assert.equal(host.bindingState().state, "closed");
  assert.equal(host.bindingState().generationId, null);
  assert.equal(host.bindingState().relayClientEpoch, 2);
});

test("RendererHost disposal fences a late rebind error", async () => {
  const transport = new FakeTransport({ autoCompleteRebind: false });
  const host = new RendererHost({ transport });
  await host.start();
  const barrier = host.reset();
  const dispose = host.dispose();
  transport.rejectRebind(
    Object.assign(new Error("late"), { code: "io_error" }),
  );

  const results = await Promise.allSettled([barrier, dispose]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(results[0].status, "rejected");
  assert.equal(host.bindingState().state, "closed");
  assert.equal(host.bindingState().generationId, null);
  assert.equal(host.bindingState().relayClientEpoch, 2);
});
