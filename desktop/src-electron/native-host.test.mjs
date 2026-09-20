import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createBinding,
  encodeFrame,
  FrameDecoder,
  LIMITS,
  PROFILE_ID,
  PROTOCOL,
  REGISTRY_DIGEST,
} from "./host-protocol.mjs";
import { NativeHost } from "./native-host.mjs";

const SESSION_ID = "session-native-test";
const BUILD_ID = "node-native-test";

function frame(type, generationId, fields = {}) {
  return {
    type,
    protocolVersion: PROTOCOL.version,
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId,
    ...fields,
  };
}

function response(requestId, generationId, outcome = "ok", fields = {}) {
  return frame("RESPONSE", generationId, {
    requestId,
    outcome,
    ...(outcome === "ok"
      ? { payload: { relayUrl: "ws://localhost:3000" } }
      : { error: { code: outcome } }),
    ...fields,
  });
}

function createFakeSpawn({
  delayResponse = false,
  malformed = false,
  backpressured = false,
} = {}) {
  let child;
  const delayedRequests = [];
  let requestCount = 0;
  let exited = false;
  let stdinEnded = false;
  let writeAfterEnd = 0;
  let writeCount = 0;
  const spawnCalls = [];

  function emitExit(code = 0) {
    if (exited) return;
    exited = true;
    child.stdout.end();
    child.stderr.end();
    child.emit("exit", code, null);
    child.emit("close", code, null);
  }

  function send(value) {
    queueMicrotask(() => {
      if (!exited)
        child.stdout.write(encodeFrame(value, { direction: "host" }));
    });
  }

  function sendBatch(values) {
    const bytes = Buffer.concat(
      values.map((value) => encodeFrame(value, { direction: "host" })),
    );
    queueMicrotask(() => {
      if (!exited) child.stdout.write(bytes);
    });
  }

  const spawn = (executablePath, args, options) => {
    spawnCalls.push({ executablePath, args, options });
    child = new EventEmitter();
    child.pid = 9001;
    child.stdin = backpressured ? new EventEmitter() : new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const decoder = new FrameDecoder({ direction: "main" });
    const handleInput = (input) => {
      if (input.type === "HELLO") {
        if (malformed) {
          queueMicrotask(() => {
            if (!exited)
              child.stdout.write(Buffer.from("@colony-native:{not-json\n"));
          });
          return;
        }
        send(
          frame("READY", 1, {
            payload: { capabilities: ["health-safe"] },
            registryDigest: REGISTRY_DIGEST,
          }),
        );
        send(
          frame("EVENT", 1, {
            event: "host_lifecycle",
            payload: { state: "ready" },
            sequence: 1,
          }),
        );
      } else if (input.type === "REQUEST") {
        requestCount += 1;
        if (delayResponse && input.generationId === 1) {
          delayedRequests.push(input);
        } else {
          send(response(input.requestId, input.generationId));
        }
      } else if (input.type === "CANCEL") {
        send(response(input.requestId, input.generationId, "cancelled"));
      } else if (input.type === "REHELLO") {
        for (const delayedRequest of delayedRequests.splice(0)) {
          send(
            response(
              delayedRequest.requestId,
              delayedRequest.generationId,
              "outcome_unknown",
              {
                error: { code: "renderer_rebound" },
                payload: undefined,
              },
            ),
          );
        }
        send(
          frame("REBOUND", input.generationId, {
            registryDigest: REGISTRY_DIGEST,
          }),
        );
        send(
          frame("EVENT", input.generationId, {
            event: "host_lifecycle",
            payload: { state: "rebound" },
            sequence: input.generationId,
          }),
        );
      }
    };
    const receiveInput = (chunk) => {
      for (const input of decoder.push(chunk)) handleInput(input);
    };
    if (backpressured) {
      child.stdin.write = (chunk) => {
        writeCount += 1;
        if (stdinEnded) {
          writeAfterEnd += 1;
          throw new Error("write after end");
        }
        receiveInput(chunk);
        return false;
      };
      child.stdin.end = () => {
        if (stdinEnded) return child.stdin;
        stdinEnded = true;
        child.stdin.emit("finish");
        return child.stdin;
      };
      child.stdin.destroy = () => {
        stdinEnded = true;
      };
    } else {
      child.stdin.on("data", receiveInput);
    }
    child.stdin.on("finish", () => emitExit(0));
    child.kill = () => emitExit(0);
    return child;
  };

  return {
    spawn,
    get child() {
      return child;
    },
    get delayedRequestCount() {
      return delayedRequests.length;
    },
    get requestCount() {
      return requestCount;
    },
    get stdinEnded() {
      return stdinEnded;
    },
    get writeAfterEnd() {
      return writeAfterEnd;
    },
    get writeCount() {
      return writeCount;
    },
    spawnCalls,
    emit(value) {
      send(value);
    },
    emitBatch(values) {
      sendBatch(values);
    },
    emitExit,
  };
}

function hostWith(fake, options = {}) {
  return new NativeHost({
    executablePath: "/test/colony-native-host",
    sessionId: SESSION_ID,
    buildId: BUILD_ID,
    spawnImpl: fake.spawn,
    ...options,
  });
}

test("NativeHost binds one private stdio child, buffers ready lifecycle, and serves health-safe request", async () => {
  const fake = createFakeSpawn();
  const host = hostWith(fake);
  const events = [];
  const detach = host.onLifecycle((event) => events.push(event));
  const binding = await host.start();
  const result = await host.requestHealthSafe();

  assert.deepEqual(
    binding,
    createBinding({
      profileId: PROFILE_ID,
      sessionId: SESSION_ID,
      generationId: 1,
    }),
  );
  assert.equal(result.outcome, "ok");
  assert.equal(result.payload.relayUrl, "ws://localhost:3000");
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.state, "ready");
  assert.deepEqual(fake.spawnCalls[0].options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(fake.spawnCalls[0].options.windowsHide, true);
  await host.dispose();
  detach();
});

test("NativeHost settles a delayed request once on timeout and ignores its late response", async () => {
  const fake = createFakeSpawn({ delayResponse: true });
  const host = hostWith(fake);
  await host.start();
  await assert.rejects(
    host.requestHealthSafe({ deadlineMs: 20 }),
    (error) => error.code === "timeout",
  );
  assert.equal(host.pending.size, 0);
  fake.emit(response("late", 1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.state, "ready");
  await host.dispose();
});

test("NativeHost redacts non-protocol host error codes before rejection", async () => {
  const fake = createFakeSpawn({ delayResponse: true });
  const host = hostWith(fake);
  await host.start();
  const request = host.requestHealthSafe({ requestId: "unsafe-error-code" });
  fake.emit(
    response("unsafe-error-code", 1, "error", {
      error: { code: "/private/path-with-secret" },
      payload: undefined,
    }),
  );
  await assert.rejects(request, (error) => error.code === "error");
  await host.dispose();
});

test("NativeHost stops a mixed fatal frame batch before buffering later events", async () => {
  const fake = createFakeSpawn();
  const host = hostWith(fake);
  const events = [];
  host.onLifecycle((event) => events.push(event));
  await host.start();
  const eventsBeforeFatal = events.length;
  fake.emitBatch([
    frame("READY", 1, {
      payload: { capabilities: ["health-safe"] },
      registryDigest: REGISTRY_DIGEST,
    }),
    frame("EVENT", 1, {
      event: "host_lifecycle",
      payload: { state: "ready" },
      sequence: 99,
    }),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.state, "failed");
  assert.equal(events.length, eventsBeforeFatal);
  const lateEvents = [];
  host.onLifecycle((event) => lateEvents.push(event));
  assert.deepEqual(lateEvents, []);
  await host.dispose();
});

test("NativeHost rejects duplicate request IDs without replaying the first call", async () => {
  const fake = createFakeSpawn({ delayResponse: true });
  const host = hostWith(fake);
  await host.start();
  const first = host.requestHealthSafe({ requestId: "duplicate-request" });
  await assert.rejects(
    host.requestHealthSafe({ requestId: "duplicate-request" }),
    (error) => error.code === "duplicate_request_id",
  );
  assert.equal(fake.requestCount, 1);
  await host.dispose();
  await Promise.allSettled([first]);
});

test("NativeHost rebind fences old pending work, serializes the barrier, and drops stale responses", async () => {
  const fake = createFakeSpawn({ delayResponse: true });
  const host = hostWith(fake);
  const events = [];
  host.onLifecycle((event) => events.push(event));
  await host.start();
  const oldRequest = host.requestHealthSafe();
  const rebound = await host.rebind(2);
  await assert.rejects(
    oldRequest,
    (error) => error.code === "renderer_rebound",
  );
  assert.equal(rebound.generationId, 2);
  assert.equal(host.getBindingState().generationId, 2);
  const fresh = await host.requestHealthSafe();
  assert.equal(fresh.generationId, 2);
  fake.emit(response("old-late", 1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.pending.size, 0);
  assert.deepEqual(
    events.map((event) => [event.generationId, event.payload.state]),
    [
      [1, "ready"],
      [2, "rebound"],
    ],
  );
  await host.dispose();
});

test("NativeHost closes fail-closed on malformed child frames without logging payloads", async () => {
  const fake = createFakeSpawn({ malformed: true });
  const host = hostWith(fake);
  await assert.rejects(host.start(), (error) => error.code === "invalid_json");
  assert.equal(host.pending.size, 0);
  await host.dispose();
});

test("NativeHost rejects host death exactly once for pending calls", async () => {
  const fake = createFakeSpawn({ delayResponse: true });
  const host = hostWith(fake);
  await host.start();
  const pending = host.requestHealthSafe();
  fake.child.kill();
  await assert.rejects(pending, (error) => error.code === "host_unavailable");
  assert.equal(host.state, "failed");
  assert.equal(host.pending.size, 0);
  await host.dispose();
});

test("NativeHost publishes terminal state to idle observers and fences late subscriptions", async () => {
  const fake = createFakeSpawn();
  const host = hostWith(fake);
  const states = [];
  const detachState = host.onState((snapshot) => states.push(snapshot.state));
  await host.start();

  fake.emitExit(1);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(host.state, "failed");
  assert.deepEqual(states, ["idle", "starting", "ready", "failed"]);

  const lateStates = [];
  const detachLateState = host.onState((snapshot) =>
    lateStates.push(snapshot.state),
  );
  assert.deepEqual(lateStates, ["failed"]);

  const lateEvents = [];
  host.onLifecycle((event) => lateEvents.push(event));
  fake.emit(
    frame("EVENT", 1, {
      event: "host_lifecycle",
      payload: { state: "ready" },
      sequence: 99,
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lateEvents, []);

  detachState();
  detachLateState();
  await host.dispose();
});

test("NativeHost disposal fences a backpressured pump and late drain", async () => {
  const fake = createFakeSpawn({ backpressured: true, delayResponse: true });
  const host = hostWith(fake);
  await host.start();
  const pending = host.requestHealthSafe({
    requestId: "queued-before-dispose",
  });
  const pendingOutcome = assert.rejects(
    pending,
    (error) => error.code === "host_disposed",
  );
  await host.dispose();
  fake.child.stdin.emit("drain");
  await new Promise((resolve) => setImmediate(resolve));
  await pendingOutcome;
  assert.equal(fake.stdinEnded, true);
  assert.equal(fake.writeAfterEnd, 0);
  assert.equal(host.state, "closed");
});

test("NativeHost bounds request admission and does not retry effectful work", async () => {
  const fake = createFakeSpawn({ delayResponse: true });
  const host = hostWith(fake);
  await host.start();
  const requests = [];
  for (let index = 0; index < LIMITS.inFlightLimit; index += 1) {
    requests.push(host.requestHealthSafe({ requestId: `pending-${index}` }));
  }
  await assert.rejects(
    host.requestHealthSafe({ requestId: "over-limit" }),
    (error) => error.code === "host_busy",
  );
  assert.equal(fake.requestCount, LIMITS.inFlightLimit);
  await host.dispose();
  await Promise.allSettled(requests);
});
