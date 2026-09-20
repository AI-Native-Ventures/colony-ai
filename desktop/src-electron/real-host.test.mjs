import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  createHello,
  encodeFrame,
  FrameDecoder,
  LIMITS,
  PROFILE_ID,
  PROTOCOL,
  REGISTRY_DIGEST,
} from "./host-protocol.mjs";
import { NativeHost } from "./native-host.mjs";

const BINARY = process.env.COLONY_NATIVE_HOST_BIN;
const REAL_HOST_OPTIONS = {
  skip: BINARY ? false : "COLONY_NATIVE_HOST_BIN is not set; hosted Rust interop only",
};

function createHost(spawnEnv = {}) {
  return new NativeHost({
    executablePath: BINARY,
    spawnEnv,
    buildId: "hosted-node-real-host",
  });
}

async function closeHost(host) {
  await host.dispose().catch(() => {});
}

test("real Rust host serves the health-safe request and preserves one process across repeated rebinds", REAL_HOST_OPTIONS, async () => {
  const host = createHost({ BUZZ_RELAY_URL: "  wss://real-host.example/  " });
  const events = [];
  host.onLifecycle((event) => events.push(event));
  try {
    const binding = await host.start();
    const response = await host.requestHealthSafe();
    assert.equal(binding.profileId, PROFILE_ID);
    assert.equal(binding.generationId, 1);
    assert.equal(response.payload.relayUrl, "wss://real-host.example/");
    assert.equal(events[0].payload.state, "ready");
    const pid = host.child.pid;

    const generation2 = await host.rebind(2);
    const generation3 = await host.rebind(3);
    const fresh = await host.requestHealthSafe();
    assert.equal(generation2.generationId, 2);
    assert.equal(generation3.generationId, 3);
    assert.equal(fresh.generationId, 3);
    assert.equal(host.child.pid, pid);
    assert.deepEqual(
      events.map((event) => [event.generationId, event.payload.state]),
      [[1, "ready"], [2, "rebound"], [3, "rebound"]],
    );
  } finally {
    await closeHost(host);
  }
});

test("real Rust host fences a delayed old request before REBOUND and never replays it", REAL_HOST_OPTIONS, async () => {
  const host = createHost({
    COLONY_STAGE0_FAULT: "delay-response",
    BUZZ_RELAY_URL: "wss://delayed.example/",
  });
  try {
    await host.start();
    const oldRequest = host.requestHealthSafe({ deadlineMs: 5_000 });
    const oldRequestOutcome = assert.rejects(
      oldRequest,
      (error) => error.code === "renderer_rebound",
    );
    const rebound = await host.rebind(2);
    await oldRequestOutcome;
    assert.equal(rebound.generationId, 2);
    const fresh = await host.requestHealthSafe();
    assert.equal(fresh.generationId, 2);
    assert.equal(fresh.payload.relayUrl, "wss://delayed.example/");
  } finally {
    await closeHost(host);
  }
});

test("real Rust startup failures are bounded and redacted into stable protocol codes", REAL_HOST_OPTIONS, async () => {
  const unavailable = new NativeHost({
    executablePath: `${BINARY}.missing`,
    buildId: "hosted-node-real-host",
  });
  await assert.rejects(unavailable.start(), (error) => error.code === "host_unavailable");
  await closeHost(unavailable);

  const early = createHost({ COLONY_STAGE0_FAULT: "exit-before-ready" });
  await assert.rejects(early.start(), (error) => error.code === "host_unavailable");
  await closeHost(early);

  const malformed = createHost({ COLONY_STAGE0_FAULT: "malformed-frame" });
  await assert.rejects(malformed.start(), (error) => error.code === "invalid_json");
  await closeHost(malformed);
});

test("real Rust host death settles pending work once", REAL_HOST_OPTIONS, async () => {
  const host = createHost({ COLONY_STAGE0_FAULT: "delay-response" });
  try {
    await host.start();
    const pending = host.requestHealthSafe({ deadlineMs: 5_000 });
    host.child.kill("SIGTERM");
    await assert.rejects(pending, (error) => error.code === "host_unavailable");
    assert.equal(host.pending.size, 0);
  } finally {
    await closeHost(host);
  }
});

function spawnRawHost() {
  const child = spawn(BINARY, [], { stdio: ["pipe", "pipe", "ignore"] });
  const decoder = new FrameDecoder({ direction: "host" });
  const bufferedFrames = [];
  const waiters = [];
  let streamError = null;
  child.stdout.on("data", (chunk) => {
    try {
      bufferedFrames.push(...decoder.push(chunk));
    } catch (error) {
      streamError = error;
    }
    while (bufferedFrames.length > 0 && waiters.length > 0) {
      waiters.shift().resolve(bufferedFrames.shift());
    }
  });
  child.stdout.on("end", () => {
    while (waiters.length > 0) {
      waiters.shift().reject(streamError ?? new Error("real host closed before a frame"));
    }
  });
  child.readFrame = () => {
    if (bufferedFrames.length > 0) return Promise.resolve(bufferedFrames.shift());
    if (streamError) return Promise.reject(streamError);
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };
  return child;
}

test("real Rust host accepts slow partial writes and fails closed at the frame limit", REAL_HOST_OPTIONS, async () => {
  const child = spawnRawHost();
  try {
    const hello = encodeFrame(
      createHello({
        profileId: PROFILE_ID,
        sessionId: "raw-real-host",
        buildId: "raw-node-test",
      }),
      { direction: "main" },
    );
    for (const byte of hello) {
      child.stdin.write(Buffer.from([byte]));
      await new Promise((resolve) => setImmediate(resolve));
    }
    const ready = await child.readFrame();
    assert.equal(ready.type, "READY");
    const event = await child.readFrame();
    assert.equal(event.event, "host_lifecycle");

    const oversized = Buffer.concat([
      Buffer.from(PROTOCOL.framePrefix),
      Buffer.alloc(LIMITS.frameLimitBytes, 0x20),
      Buffer.from("\n"),
    ]);
    child.stdin.write(oversized);
    const [code] = await once(child, "exit");
    assert.equal(code, 2);
  } finally {
    child.kill();
  }
});
