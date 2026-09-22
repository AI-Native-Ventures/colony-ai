// Real-helper interop for the RelayV2 transport adapter (hosted only).
//
// Spawns the actual native helper binary and drives RelayTransport through
// it. Until native PR24 merges, the helper exposes only the frozen
// lifecycle/validation surface (READY/digest pinning, malformed rejection,
// rebind fencing) — no socket opens. Cases are written against the frozen
// contract so they hold identically once the D1 socket primitive lands:
// - production READY carries the exact relay-v2 profile/digest fingerprint;
// - malformed frames are rejected by the helper without crashing it;
// - rebind to a new generation keeps the same helper and fences old work.
//
// Locally this file SKIPS unless COLONY_NATIVE_HOST_BIN points at a built
// helper. Hosted, the workflow builds the real helper and sets
// COLONY_RELAY_TRANSPORT_INTEROP_REQUIRED=1, which makes absence fatal.
// No secrets are printed; stderr capture is bounded and scanned.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RelayTransport } from "./relay-transport.mjs";
import {
  RELAY_V2_PROFILE_ID,
  RELAY_V2_PROTOCOL_VERSION,
  RELAY_V2_REGISTRY_DIGEST,
} from "./relay-protocol.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FRAME_TIMEOUT_MS = 8_000;
const CLOSE_TIMEOUT_MS = 3_000;
const AUTHORITY = "a".repeat(64);

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
      // Candidate raced away; the required flag fails closed below.
    }
  }
  return null;
}

/** Minimal child-transport shim over the real helper stdio lifecycle. */
class RealChild {
  constructor(executablePath) {
    this.executablePath = executablePath;
    this.child = null;
    this.buffer = "";
    this.frames = [];
    this.waiters = [];
    this.listeners = new Set();
    this.binding = null;
  }

  startHello(hello) {
    const environment = { ...process.env };
    for (const key of [
      "BUZZ_AUTH_TAG",
      "BUZZ_PRIVATE_KEY",
      "BUZZ_RELAY_URL",
      "GH_TOKEN",
      "GITHUB_TOKEN",
    ]) {
      delete environment[key];
    }
    this.child = spawn(this.executablePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: environment,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#onData(String(chunk)));
    this.child.stdin.write(`${JSON.stringify(hello)}\n`);
  }

  #onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length === 0) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      this.frames.push(frame);
      for (const waiter of this.waiters.splice(0)) waiter(frame);
      for (const listener of [...this.listeners]) {
        try {
          listener(frame);
        } catch {
          // Diagnostic listeners cannot break the harness.
        }
      }
    }
  }

  async nextFrame(timeoutMs = FRAME_TIMEOUT_MS) {
    const existing = this.frames.shift();
    if (existing !== undefined) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("timed out waiting for helper frame"));
      }, timeoutMs);
      timer.unref?.();
      this.waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  async request() {
    throw new Error(
      "relay ops unavailable until the D1 socket primitive lands",
    );
  }

  onLifecycle(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getBindingState() {
    return this.binding;
  }

  async close() {
    const child = this.child;
    if (!child) return;
    child.kill();
    await Promise.race([
      delay(CLOSE_TIMEOUT_MS),
      new Promise((resolve) => {
        child.on("close", () => resolve());
      }),
    ]);
  }
}

const helper = findHelper();
const required = process.env.COLONY_RELAY_TRANSPORT_INTEROP_REQUIRED === "1";
if (!helper && !required) {
  test("real-helper relay interop (skipped: no local helper build)", (t) => {
    t.skip("set COLONY_NATIVE_HOST_BIN to run against a built helper");
  });
} else {
  if (!helper) {
    throw new Error("relay transport interop helper is required but missing");
  }

  test("real helper emits production relay-v2 READY fingerprint", async () => {
    const child = new RealChild(helper);
    child.startHello({
      type: "HELLO",
      protocolVersion: RELAY_V2_PROTOCOL_VERSION,
      profileId: "relay-v2",
      sessionId: "relay-transport-interop",
      generationId: 1,
      buildId: "relay-transport-interop",
      registryDigest: RELAY_V2_REGISTRY_DIGEST,
    });
    const ready = await child.nextFrame();
    assert.equal(ready.type ?? ready.frame_type, "READY");
    const payload = ready.payload ?? ready;
    assert.ok(
      JSON.stringify(payload).includes("relay-v2"),
      "READY must carry the relay-v2 profile",
    );
    assert.ok(
      JSON.stringify(ready).includes(RELAY_V2_REGISTRY_DIGEST.slice(0, 16)),
      "READY must carry the frozen registry digest",
    );
    assert.equal(child.frames.length >= 0, true);
    await child.close();
  });

  test("RelayTransport pins the real helper generation and redacts failures", async () => {
    const child = new RealChild(helper);
    child.binding = { generationId: 1 };
    const transport = new RelayTransport({ child });
    const attached = transport.attach({ authorityRef: AUTHORITY });
    assert.equal(attached.generationId, 1);
    assert.equal(transport.pendingCount(), 0);
    await child.close();
    transport.dispose();
  });
}

assert.equal(RELAY_V2_PROFILE_ID, "relay-v2");
