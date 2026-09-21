import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IDENTITY_LIMITS,
  IDENTITY_METADATA_FIELDS,
  IDENTITY_PROTOCOL_VERSION,
  PRODUCTION_CAPABILITIES,
  PRODUCTION_IDENTITY_MANIFEST_DIGEST,
  PRODUCTION_REGISTRY_DIGEST,
  TEST_V2_REGISTRY_DIGEST,
  validateIdentityFrame,
} from "./identity-protocol.mjs";

const FRAME_PREFIX = "@colony-native:";
const FRAME_LIMIT_BYTES = IDENTITY_LIMITS.frameLimitBytes;
const STDOUT_BUFFER_LIMIT_BYTES = FRAME_LIMIT_BYTES;
const STDERR_CAPTURE_LIMIT_BYTES = 16 * 1024;
const FRAME_TIMEOUT_MS = 4_000;
const CLOSE_TIMEOUT_MS = 2_000;
const PROFILE_ID = "0000000000000001";
const SESSION_ID = "identity-codec-interop";
const RUST_PRODUCTION_REGISTRY_DIGEST =
  "452990462a124746a15d6ba7cdd0353e0183e7a3aa300e5b8b596e0439692204";
const RUST_PRODUCTION_MANIFEST_DIGEST =
  "ff46bc9729c8e3dce602d5e1effb84d5aa6fff0b00231404c340b8e61aaa1e3d";
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SENSITIVE_ENV_KEYS = [
  "BUZZ_AUTH_TAG",
  "BUZZ_PRIVATE_KEY",
  "BUZZ_RELAY_URL",
  "COLONY_IDENTITY_CODEC_INTEROP_REQUIRED",
  "COLONY_NATIVE_HOST_BIN",
  "COLONY_STAGE0_FAULT",
  "COLONY_STAGE0_TEST_DEADLINE_MS",
  "GH_TOKEN",
  "GITHUB_TOKEN",
];

function platformName() {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  return "linux";
}

function helperCandidates() {
  const configured = process.env.COLONY_NATIVE_HOST_BIN;
  if (configured) return [configured];
  const base = path.join(
    REPO_ROOT,
    "desktop",
    "src-native-host",
    "target",
    "release",
    "colony-native-host",
  );
  return process.platform === "win32" ? [`${base}.exe`, base] : [base];
}

function findHelper() {
  for (const candidate of helperCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // The candidate can disappear between existsSync and statSync. The
      // hosted job will fail closed through the required-helper flag.
    }
  }
  return null;
}

function requiredHelper() {
  const helper = findHelper();
  if (helper || process.env.COLONY_IDENTITY_CODEC_INTEROP_REQUIRED !== "1") {
    return helper;
  }
  throw new Error("identity codec interop helper is required but missing");
}

function safeEnvironment(patch = {}) {
  const environment = { ...process.env };
  for (const key of SENSITIVE_ENV_KEYS) delete environment[key];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
  return environment;
}

function binding(generationId = 1) {
  return {
    profileId: PROFILE_ID,
    sessionId: SESSION_ID,
    generationId,
  };
}

function productionHello(userDataRoot, overrides = {}) {
  const launch = {
    profileId: PROFILE_ID,
    flavor: "normal",
    platform: platformName(),
    userDataRoot,
    identityMode: "explicit",
    sharedIdentity: false,
    resetProvenance: "not_attempted_fresh",
    identityManifestDigest: PRODUCTION_IDENTITY_MANIFEST_DIGEST,
  };
  return {
    type: "HELLO",
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    ...binding(),
    buildId: "identity-codec-interop",
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
    identityLaunch: { ...launch, ...(overrides.identityLaunch ?? {}) },
    ...overrides,
  };
}

function productionRehello(generationId) {
  return {
    type: "REHELLO",
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    ...binding(generationId),
    buildId: "identity-codec-interop",
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
  };
}

function productionRequest({
  requestId,
  generationId = 1,
  capability,
  method,
}) {
  return {
    type: "REQUEST",
    protocolVersion: IDENTITY_PROTOCOL_VERSION,
    ...binding(generationId),
    requestId,
    capability,
    method,
    payload: {},
    registryDigest: PRODUCTION_REGISTRY_DIGEST,
  };
}

function assertSafeText(text, label, limitBytes = STDERR_CAPTURE_LIMIT_BYTES) {
  assert.ok(
    Buffer.byteLength(text, "utf8") <= limitBytes,
    `${label} is bounded`,
  );
  for (const forbidden of [
    FRAME_PREFIX,
    "nsec",
    "private",
    "secret",
    "key material",
    "backend",
    "userDataRoot",
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      `${label} must not contain ${forbidden}`,
    );
  }
}

function assertSafeFrame(frame) {
  assertSafeText(JSON.stringify(frame), "native frame", FRAME_LIMIT_BYTES);
}

function assertExpectedFatalExit(closeInfo, label) {
  assert.equal(closeInfo.code, 2, `${label} must exit with protocol code 2`);
  assert.equal(closeInfo.signal, null, `${label} must not be signal-killed`);
  assert.equal(
    closeInfo.forced,
    false,
    `${label} must not require cleanup kill`,
  );
}

class NativeChild {
  #child;

  #stdoutBuffer = Buffer.alloc(0);

  #frames = [];

  #waiters = [];

  #stderrChunks = [];

  #stderrBytes = 0;

  #closed = false;

  #closing = false;

  #closeInfo = null;

  #protocolFailure = null;

  #forcedKill = false;

  constructor(helper, environmentPatch = {}, spawnProcess = spawn) {
    this.#child = spawnProcess(helper, ["--identity-v2-file-test"], {
      cwd: REPO_ROOT,
      env: safeEnvironment(environmentPatch),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    this.#child.stderr.on("data", (chunk) => this.#onStderr(chunk));
    this.#child.on("error", (error) => {
      this.#protocolFailure ??= new Error("native helper process error");
      this.#settleWaiters(this.#protocolFailure);
      if (!this.#closed) this.#closed = true;
      void error;
    });
    this.#child.on("close", (code, signal) => {
      this.#closed = true;
      this.#closeInfo = {
        code,
        signal,
        forced: this.#forcedKill,
      };
      this.#settleWaiters(
        this.#protocolFailure ??
          new Error("native helper closed before a frame"),
      );
    });
  }

  #settleWaiters(error) {
    const waiters = this.#waiters.splice(0);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  #kill() {
    if (this.#closed) return;
    this.#forcedKill = true;
    this.#child.kill();
  }

  #onStdout(chunk) {
    if (this.#closed || this.#protocolFailure) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.#stdoutBuffer.length + bytes.length > STDOUT_BUFFER_LIMIT_BYTES) {
      this.#protocolFailure = new Error(
        "native stdout exceeded bounded frame buffer",
      );
      this.#settleWaiters(this.#protocolFailure);
      this.#kill();
      return;
    }
    this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, bytes]);
    while (true) {
      const newline = this.#stdoutBuffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = this.#stdoutBuffer.subarray(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.subarray(newline + 1);
      if (line.length === 0 || line.length + 1 > FRAME_LIMIT_BYTES) {
        this.#protocolFailure = new Error(
          "native frame exceeded protocol bounds",
        );
        this.#settleWaiters(this.#protocolFailure);
        this.#kill();
        return;
      }
      const text = line.toString("utf8");
      if (!text.startsWith(FRAME_PREFIX)) {
        this.#protocolFailure = new Error("native frame prefix rejected");
        this.#settleWaiters(this.#protocolFailure);
        this.#kill();
        return;
      }
      let frame;
      try {
        frame = JSON.parse(text.slice(FRAME_PREFIX.length));
      } catch {
        this.#protocolFailure = new Error("native frame JSON rejected");
        this.#settleWaiters(this.#protocolFailure);
        this.#kill();
        return;
      }
      assertSafeFrame(frame);
      if (this.#frames.length >= 128) {
        this.#protocolFailure = new Error("native frame queue exceeded bound");
        this.#settleWaiters(this.#protocolFailure);
        this.#kill();
        return;
      }
      const waiter = this.#waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(frame);
      } else {
        this.#frames.push(frame);
      }
    }
  }

  #onStderr(chunk) {
    if (this.#stderrBytes >= STDERR_CAPTURE_LIMIT_BYTES) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = STDERR_CAPTURE_LIMIT_BYTES - this.#stderrBytes;
    const kept = bytes.subarray(0, remaining);
    this.#stderrChunks.push(kept);
    this.#stderrBytes += kept.length;
  }

  #write(payload) {
    if (this.#closed || this.#closing || this.#child.stdin.destroyed) {
      return Promise.reject(new Error("native helper input is closed"));
    }
    if (payload.length > FRAME_LIMIT_BYTES) {
      return Promise.reject(
        new Error("outbound frame exceeds protocol bounds"),
      );
    }
    return new Promise((resolve, reject) => {
      let callbackDone = false;
      let drained = true;
      let settled = false;
      const timer = setTimeout(
        () => finish(new Error("native helper write timed out")),
        FRAME_TIMEOUT_MS,
      );
      const cleanup = () => {
        clearTimeout(timer);
        this.#child.stdin.off("drain", onDrain);
        this.#child.stdin.off("error", onError);
      };
      const finish = (error) => {
        if (settled || (error === undefined && (!callbackDone || !drained)))
          return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onDrain = () => {
        drained = true;
        finish();
      };
      const onError = () => finish(new Error("native helper input failed"));
      this.#child.stdin.once("error", onError);
      try {
        drained = this.#child.stdin.write(payload, () => {
          callbackDone = true;
          finish();
        });
        if (!drained) this.#child.stdin.once("drain", onDrain);
        finish();
      } catch {
        finish(new Error("native helper input failed"));
      }
    });
  }

  async sendRaw(jsonText) {
    const jsonBytes = Buffer.byteLength(jsonText, "utf8");
    const frameBytes = Buffer.byteLength(FRAME_PREFIX, "utf8") + jsonBytes + 1;
    if (frameBytes > FRAME_LIMIT_BYTES) {
      throw new Error("outbound frame exceeds protocol bounds");
    }
    const payload = Buffer.from(`${FRAME_PREFIX}${jsonText}\n`, "utf8");
    assert.equal(payload.length, frameBytes);
    await this.#write(payload);
  }

  async send(frame) {
    validateIdentityFrame(frame, { direction: "main" });
    await this.sendRaw(JSON.stringify(frame));
  }

  nextFrame(timeoutMs = FRAME_TIMEOUT_MS) {
    if (this.#frames.length > 0) return Promise.resolve(this.#frames.shift());
    if (this.#protocolFailure) return Promise.reject(this.#protocolFailure);
    if (this.#closed) return Promise.reject(new Error("native helper closed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.findIndex(
          (waiter) => waiter.resolve === resolve,
        );
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error("native helper frame timed out"));
      }, timeoutMs);
      this.#waiters.push({ resolve, reject, timer });
    });
  }

  waitForClose(timeoutMs = CLOSE_TIMEOUT_MS) {
    if (this.#closed && this.#closeInfo)
      return Promise.resolve(this.#closeInfo);
    return new Promise((resolve, reject) => {
      const onClose = (code, signal) => {
        clearTimeout(timer);
        this.#child.off("close", onClose);
        resolve({ code, signal, forced: this.#forcedKill });
      };
      const timer = setTimeout(() => {
        this.#child.off("close", onClose);
        reject(new Error("native helper close timed out"));
      }, timeoutMs);
      this.#child.once("close", onClose);
    });
  }

  async close() {
    if (this.#closed && this.#closeInfo) return this.#closeInfo;
    this.#closing = true;
    if (!this.#child.stdin.destroyed) this.#child.stdin.end();
    try {
      return await this.waitForClose(CLOSE_TIMEOUT_MS);
    } catch {
      this.#kill();
      try {
        return await this.waitForClose(CLOSE_TIMEOUT_MS);
      } catch {
        return { code: null, signal: null, forced: true };
      }
    }
  }

  stderrText() {
    return Buffer.concat(this.#stderrChunks).toString("utf8");
  }
}

class FakeStdin extends EventEmitter {
  destroyed = false;

  writes = [];

  #onEnd;

  constructor(onEnd) {
    super();
    this.#onEnd = onEnd;
  }

  write(payload, callback) {
    if (this.destroyed) throw new Error("fake stdin is closed");
    this.writes.push(Buffer.from(payload));
    callback();
    return true;
  }

  end() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.#onEnd();
  }
}

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();

  stderr = new EventEmitter();

  stdin;

  #killed = false;

  constructor() {
    super();
    this.stdin = new FakeStdin(() => {
      queueMicrotask(() => this.emit("close", 0, null));
    });
  }

  kill(signal = "SIGKILL") {
    if (this.#killed) return;
    this.#killed = true;
    this.stdin.destroyed = true;
    queueMicrotask(() => this.emit("close", null, signal));
  }
}

function fakeSpawnHandle() {
  const handle = { child: null };
  handle.spawn = () => {
    handle.child = new FakeChild();
    return handle.child;
  };
  return handle;
}

test("interop frame checks use newline-inclusive UTF-8 byte boundaries", async () => {
  const targetJsonBytes =
    FRAME_LIMIT_BYTES - Buffer.byteLength(FRAME_PREFIX, "utf8") - 1;
  const jsonOverhead = Buffer.byteLength('{"padding":""}', "utf8");
  const exactJson = JSON.stringify({
    padding: "x".repeat(targetJsonBytes - jsonOverhead),
  });
  assert.equal(Buffer.byteLength(exactJson, "utf8"), targetJsonBytes);

  const outboundHandle = fakeSpawnHandle();
  const outbound = new NativeChild("fake", {}, outboundHandle.spawn);
  try {
    await outbound.sendRaw(exactJson);
    assert.equal(outboundHandle.child.stdin.writes.length, 1);
    assert.equal(
      outboundHandle.child.stdin.writes[0].length,
      FRAME_LIMIT_BYTES,
    );
    await assert.rejects(
      () => outbound.sendRaw(`${exactJson}x`),
      /outbound frame exceeds protocol bounds/,
    );

    const unicodeJson = JSON.stringify({ text: "é".repeat(64) });
    assert.notEqual(unicodeJson.length, Buffer.byteLength(unicodeJson, "utf8"));
    await outbound.sendRaw(unicodeJson);
    assert.equal(
      outboundHandle.child.stdin.writes[1].length,
      Buffer.byteLength(`${FRAME_PREFIX}${unicodeJson}\n`, "utf8"),
    );
  } finally {
    await outbound.close();
  }

  const inboundHandle = fakeSpawnHandle();
  const inbound = new NativeChild("fake", {}, inboundHandle.spawn);
  const exactWire = Buffer.from(`${FRAME_PREFIX}${exactJson}\n`, "utf8");
  inboundHandle.child.stdout.emit("data", exactWire.subarray(0, 17));
  inboundHandle.child.stdout.emit("data", exactWire.subarray(17));
  const parsed = await inbound.nextFrame();
  assert.equal(parsed.padding.length, targetJsonBytes - jsonOverhead);
  await inbound.close();

  const overcapHandle = fakeSpawnHandle();
  const overcap = new NativeChild("fake", {}, overcapHandle.spawn);
  overcapHandle.child.stdout.emit(
    "data",
    Buffer.alloc(FRAME_LIMIT_BYTES, 0x78),
  );
  overcapHandle.child.stdout.emit("data", Buffer.from("\n"));
  await assert.rejects(
    () => overcap.nextFrame(),
    /native stdout exceeded bounded frame buffer/,
  );
  await overcap.close();
});

test("fatal close evidence rejects forced, signaled, and timeout-cleanup metadata", () => {
  for (const closeInfo of [
    { code: 2, signal: null, forced: true },
    { code: null, signal: "SIGTERM", forced: false },
    { code: 2, signal: null, forced: true },
  ]) {
    assert.throws(() => assertExpectedFatalExit(closeInfo, "fatal case"));
  }
});

async function withProfileRoot(label, callback) {
  const base = await mkdtemp(
    path.join(os.tmpdir(), `colony-identity-codec-${label}-`),
  );
  const root = path.join(base, "Colony", "dev", PROFILE_ID, "normal");
  try {
    return await callback({ base, root });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
}

async function hostFrame(child, options) {
  const frame = await child.nextFrame();
  assertSafeFrame(frame);
  validateIdentityFrame(frame, {
    direction: "host",
    binding: options.binding,
    responseCapability: options.capability,
    expectedGeneration: options.expectedGeneration,
    responseMethod: options.method,
  });
  return frame;
}

async function startBoundChild(helper, root, environmentPatch) {
  const child = new NativeChild(helper, environmentPatch);
  try {
    const hello = productionHello(root);
    assert.equal(
      hello.identityLaunch.identityManifestDigest,
      PRODUCTION_IDENTITY_MANIFEST_DIGEST,
    );
    await child.send(hello);
    const ready = await hostFrame(child, { binding: binding() });
    const lifecycle = await hostFrame(child, { binding: binding() });
    assert.equal(ready.type, "READY");
    assert.deepEqual(ready.payload.capabilities, PRODUCTION_CAPABILITIES);
    assert.equal(ready.registryDigest, PRODUCTION_REGISTRY_DIGEST);
    assert.equal(lifecycle.type, "EVENT");
    assert.equal(lifecycle.event, "host_lifecycle");
    assert.equal(lifecycle.payload.state, "ready");
    return child;
  } catch (error) {
    await child.close();
    throw error;
  }
}

test("real identity-file-only helper emits production READY, lifecycle, and named responses", async (t) => {
  const helper = requiredHelper();
  if (!helper) {
    t.skip("real native helper is hosted-only for this suite");
    return;
  }
  assert.equal(PRODUCTION_REGISTRY_DIGEST, RUST_PRODUCTION_REGISTRY_DIGEST);
  assert.equal(
    PRODUCTION_IDENTITY_MANIFEST_DIGEST,
    RUST_PRODUCTION_MANIFEST_DIGEST,
  );
  await withProfileRoot("named", async ({ root }) => {
    const child = await startBoundChild(helper, root);
    let finished;
    try {
      await child.send(
        productionRequest({
          requestId: "shared-identity",
          capability: "identity-mode",
          method: "is_shared_identity",
        }),
      );
      const shared = await hostFrame(child, {
        binding: binding(),
        capability: "identity-mode",
        method: "is_shared_identity",
      });
      assert.equal(shared.outcome, "ok");
      assert.equal(shared.payload.value, false);

      await child.send(
        productionRequest({
          requestId: "identity-read",
          capability: "identity-read",
          method: "get_identity",
        }),
      );
      const identity = await hostFrame(child, {
        binding: binding(),
        capability: "identity-read",
        method: "get_identity",
      });
      assert.equal(identity.outcome, "ok");
      assert.deepEqual(
        Object.keys(identity.payload).sort(),
        [...IDENTITY_METADATA_FIELDS].sort(),
      );
      assert.equal(typeof identity.payload.pubkey, "string");
      assert.ok(identity.payload.pubkey.length > 0);
      assert.equal(Object.hasOwn(identity.payload, "nsec"), false);

      await child.send(
        productionRequest({
          requestId: "health",
          capability: "health-safe",
          method: "get_default_relay_url",
        }),
      );
      const health = await hostFrame(child, {
        binding: binding(),
        capability: "health-safe",
        method: "get_default_relay_url",
      });
      assert.equal(health.outcome, "ok");
      assert.equal(typeof health.payload.relayUrl, "string");
      finished = await child.close();
    } finally {
      if (!finished) finished = await child.close();
    }
    assert.equal(finished.forced, false);
    assert.equal(finished.code, 0);
    assertSafeText(child.stderrText(), "native stderr");
  });
});

test("real helper rebind fences delayed old-generation work and accepts a fresh request", async (t) => {
  const helper = requiredHelper();
  if (!helper) {
    t.skip("real native helper is hosted-only for this suite");
    return;
  }
  await withProfileRoot("rebind", async ({ root }) => {
    const child = await startBoundChild(helper, root, {
      COLONY_STAGE0_FAULT: "delay-response",
    });
    let finished;
    try {
      await child.send(
        productionRequest({
          requestId: "pending-before-rebind",
          capability: "health-safe",
          method: "get_default_relay_url",
        }),
      );
      await child.send(productionRehello(2));

      const terminal = await hostFrame(child, {
        binding: binding(1),
        capability: "health-safe",
        expectedGeneration: 1,
        method: "get_default_relay_url",
      });
      assert.equal(terminal.requestId, "pending-before-rebind");
      assert.equal(terminal.outcome, "outcome_unknown");
      assert.equal(terminal.error.code, "renderer_rebound");

      const rebound = await hostFrame(child, { binding: binding(2) });
      assert.equal(rebound.type, "REBOUND");
      const reboundLifecycle = await hostFrame(child, { binding: binding(2) });
      assert.equal(reboundLifecycle.type, "EVENT");
      assert.equal(reboundLifecycle.payload.state, "rebound");

      await child.send(
        productionRequest({
          requestId: "stale-generation",
          generationId: 1,
          capability: "health-safe",
          method: "get_default_relay_url",
        }),
      );
      const stale = await hostFrame(child, {
        binding: binding(2),
        capability: "health-safe",
        method: "get_default_relay_url",
      });
      assert.equal(stale.requestId, "stale-generation");
      assert.equal(stale.error.code, "stale_generation");

      await child.send(
        productionRequest({
          requestId: "fresh-generation",
          generationId: 2,
          capability: "identity-read",
          method: "get_identity",
        }),
      );
      const fresh = await hostFrame(child, {
        binding: binding(2),
        capability: "identity-read",
        method: "get_identity",
      });
      assert.equal(fresh.requestId, "fresh-generation");
      assert.equal(fresh.outcome, "ok");
      assert.equal(typeof fresh.payload.pubkey, "string");
      finished = await child.close();
    } finally {
      if (!finished) finished = await child.close();
    }
    assert.equal(finished.forced, false);
    assert.equal(finished.code, 0);
    assertSafeText(child.stderrText(), "native stderr");
  });
});

test("real helper rejects malformed, mixed-registry, and stale-manifest launch frames", async (t) => {
  const helper = requiredHelper();
  if (!helper) {
    t.skip("real native helper is hosted-only for this suite");
    return;
  }
  const cases = [
    {
      label: "unknown-field",
      expectedCode: "invalid_json",
      mutate(frame) {
        frame.unexpected = true;
        return frame;
      },
    },
    {
      label: "mixed-registry",
      expectedCode: "registry_mismatch",
      mutate(frame) {
        frame.registryDigest = TEST_V2_REGISTRY_DIGEST;
        return frame;
      },
    },
    {
      label: "stale-manifest",
      expectedCode: "identity_manifest_mismatch",
      mutate(frame) {
        frame.identityLaunch.identityManifestDigest = "0".repeat(64);
        return frame;
      },
    },
  ];
  for (const candidate of cases) {
    await withProfileRoot(candidate.label, async ({ base, root }) => {
      const child = new NativeChild(helper);
      try {
        const frame = candidate.mutate(productionHello(root));
        await child.sendRaw(JSON.stringify(frame));
        const finished = await child.waitForClose(FRAME_TIMEOUT_MS);
        assertExpectedFatalExit(finished, candidate.label);
        assertSafeText(child.stderrText(), `${candidate.label} native stderr`);
        assert.equal(child.stderrText().includes(candidate.expectedCode), true);
        assert.equal(existsSync(root), false);
        assert.equal(
          existsSync(path.join(base, "Colony", "dev", PROFILE_ID)),
          false,
        );
      } finally {
        await child.close();
      }
    });
  }
});
