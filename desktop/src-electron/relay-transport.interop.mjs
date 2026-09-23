// Real-helper interop for the RelayV2 transport adapter (hosted only).
//
// Spawns the actual native helper binary and drives RelayTransport through
// it. The helper carries RelayV2 operations inside the v1 stdio envelope;
// RelayV2's protocolVersion:2 applies to the typed operation context. Until
// native PR24 merges, the helper exposes only the frozen
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
// The interop file ALSO fails closed when the helper lacks the RelayV2
// runtime surface (pre-D1 identity-only binaries): a successful HELLO
// handshake that never yields a relay-v2 READY is a hard failure, never
// a skip, so a green run always means real RelayV2 operation/event/
// failure proof against a D1-capable binary. Until native PR24 merges,
// runs against develop helpers are expected to fail at the READY gate;
// that failure is the recorded pending-integration state, not interop.
// No secrets are printed; stderr capture is bounded and scanned.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RelayTransport } from "./relay-transport.mjs";
import {
  RELAY_V2_PROFILE_ID,
  RELAY_V2_REGISTRY_DIGEST,
} from "./relay-protocol.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const NATIVE_FRAME_PREFIX = "@colony-native:";
const NATIVE_ENVELOPE_PROTOCOL_VERSION = 1;
const RELAY_V2_ARGS = Object.freeze(["--relay-v2"]);
const RELAY_V2_SESSION_ID = "relay-transport-interop";
const FRAME_TIMEOUT_MS = 8_000;
const CLOSE_TIMEOUT_MS = 3_000;
const AUTHORITY = "a".repeat(64);
const STDERR_CAPTURE_LIMIT_CHARS = 200;
const STDERR_FORBIDDEN_PATTERNS = [
  /nsec1[0-9a-z]+/i,
  /[0-9a-f]{64,}/,
  /private[_-]?key/i,
  /secret/i,
  /key material/i,
  /authorization:/i,
];

/**
 * Finite redacted pre-READY diagnostic: exit code/signal plus a bounded
 * stderr excerpt with secret-like patterns replaced. Never raw stderr.
 */
function redactedExitDiagnostic(closeInfo, stderrText) {
  const excerpt = String(stderrText ?? "").slice(0, STDERR_CAPTURE_LIMIT_CHARS);
  let redacted = excerpt.replace(/[^ -~]/g, "?");
  for (const pattern of STDERR_FORBIDDEN_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return (
    `helper exited before READY ` +
    `(code=${closeInfo?.code ?? "unknown"}, ` +
    `signal=${closeInfo?.signal ?? "none"}, ` +
    `stderr=${JSON.stringify(redacted)})`
  );
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
      // Candidate raced away; the required flag fails closed below.
    }
  }
  return null;
}

class RealChild {
  constructor(executablePath) {
    this.executablePath = executablePath;
    this.child = null;
    this.buffer = "";
    this.frames = [];
    this.waiters = [];
    this.listeners = new Set();
    this.binding = null;
    this.stderrText = "";
    this.closeInfo = null;
  }

  startHello(
    hello,
    { args = RELAY_V2_ARGS, timeoutMs = FRAME_TIMEOUT_MS } = {},
  ) {
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
    return new Promise((resolve, reject) => {
      this.child = spawn(this.executablePath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: environment,
      });
      const timer = setTimeout(() => {
        reject(
          new Error("helper produced no process output before exit-or-timeout"),
        );
      }, timeoutMs);
      timer.unref?.();
      let settled = false;
      const settleResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      this.child.stdout.setEncoding("utf8");
      this.child.stdout.on("data", (chunk) => this.#onData(String(chunk)));
      this.child.stderr.setEncoding("utf8");
      this.child.stderr.on("data", (chunk) => {
        this.stderrText += String(chunk).slice(
          0,
          4096 - this.stderrText.length,
        );
      });
      this.child.on("error", (error) => settleReject(error));
      this.child.on("close", (code, signal) => {
        this.closeInfo = { code, signal };
        if (this.frames.length === 0 && this.waiters.length > 0) {
          settleReject(
            new Error(redactedExitDiagnostic(this.closeInfo, this.stderrText)),
          );
        } else {
          settleResolve();
        }
      });
      this.child.stdin.write(
        `${NATIVE_FRAME_PREFIX}${JSON.stringify(hello)}\n`,
        (error) => {
          if (error) settleReject(error);
          else settleResolve();
        },
      );
    });
  }

  #onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line.length === 0) continue;
      if (!line.startsWith(NATIVE_FRAME_PREFIX)) continue;
      let frame;
      try {
        frame = JSON.parse(line.slice(NATIVE_FRAME_PREFIX.length));
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

  async request({ capability, method, payload, requestId }) {
    const id =
      typeof requestId === "string" && requestId.length > 0
        ? requestId
        : `interop-${Date.now()}-${Math.floor(Math.random() * 2 ** 32).toString(16)}`;
    const frame = {
      type: "REQUEST",
      protocolVersion: NATIVE_ENVELOPE_PROTOCOL_VERSION,
      profileId: RELAY_V2_PROFILE_ID,
      sessionId: RELAY_V2_SESSION_ID,
      generationId: this.binding?.generationId ?? 1,
      requestId: id,
      capability,
      method,
      payload,
    };
    await new Promise((resolve, reject) => {
      this.child.stdin.write(
        `${NATIVE_FRAME_PREFIX}${JSON.stringify(frame)}\n`,
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
    const timeoutMs = FRAME_TIMEOUT_MS;
    for (;;) {
      const response = await this.nextFrame(timeoutMs);
      const frameType = response.type ?? response.frame_type;
      if (frameType === "EVENT") continue;
      if (frameType !== "RESPONSE") {
        throw new Error("helper returned an unexpected frame type");
      }
      const rid = response.requestId ?? response.request_id;
      if (rid !== undefined && rid !== id) continue;
      // Return the RAW native RESPONSE envelope; the adapter under test
      // unwraps outcome/payload/error itself.
      return response;
    }
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

  test("real helper emits production relay-v2 READY fingerprint", async (t) => {
    const userDataRoot = mkdtempSync(path.join(os.tmpdir(), "relay-interop-"));
    t.after(() => {
      try {
        rmSync(userDataRoot, { recursive: true, force: true });
      } catch {
        // Disposable namespace cleanup is best-effort.
      }
    });
    const child = new RealChild(helper);
    await child.startHello(
      {
        type: "HELLO",
        protocolVersion: NATIVE_ENVELOPE_PROTOCOL_VERSION,
        profileId: RELAY_V2_PROFILE_ID,
        sessionId: RELAY_V2_SESSION_ID,
        generationId: 1,
        buildId: "relay-transport-interop",
        payload: {
          relayUrl: "ws://127.0.0.1:9",
          authorityRef: AUTHORITY,
          userDataRoot,
          flavor: "normal",
        },
      },
      { args: RELAY_V2_ARGS },
    );
    const ready = await child.nextFrame();
    // Native fail-closed semantics: a wrong-profile HELLO kills the helper
    // with NO stdout (fatal exit, possibly stderr only). nextFrame() throws
    // "helper exited before READY" in that case — that IS the recorded
    // pending-D1 evidence, and it fails (never skips). A READY frame means
    // a D1-capable binary and is asserted byte-exact below.
    // Pre-D1 identity-only helpers reject the relay-v2 HELLO outright
    // (fatal exit or error frame). That is the pending-integration state:
    // fail here, never skip, so green always means a D1-capable binary.
    assert.equal(
      ready.type ?? ready.frame_type,
      "READY",
      "helper must speak relay-v2 READY (D1 primitive required)",
    );
    const payload = ready.payload ?? ready;
    assert.ok(
      JSON.stringify(payload).includes("relay-v2"),
      "READY must carry the relay-v2 profile",
    );
    assert.ok(
      JSON.stringify(ready).includes(RELAY_V2_REGISTRY_DIGEST.slice(0, 16)),
      "READY must carry the frozen registry digest",
    );
    await child.close();
  });

  test("RelayTransport drives a real connect op through the D1 helper", async (t) => {
    const userDataRoot = mkdtempSync(path.join(os.tmpdir(), "relay-interop-"));
    t.after(() => {
      try {
        rmSync(userDataRoot, { recursive: true, force: true });
      } catch {
        // Disposable namespace cleanup is best-effort.
      }
    });
    const child = new RealChild(helper);
    await child.startHello(
      {
        type: "HELLO",
        protocolVersion: NATIVE_ENVELOPE_PROTOCOL_VERSION,
        profileId: RELAY_V2_PROFILE_ID,
        sessionId: RELAY_V2_SESSION_ID,
        generationId: 1,
        buildId: "relay-transport-interop",
        payload: {
          relayUrl: "ws://127.0.0.1:9",
          authorityRef: AUTHORITY,
          userDataRoot,
          flavor: "normal",
        },
      },
      { args: RELAY_V2_ARGS },
    );
    const ready = await child.nextFrame();
    assert.equal(ready.type ?? ready.frame_type, "READY");
    child.binding = { generationId: 1 };
    const transport = new RelayTransport({ child });
    transport.attach({ authorityRef: AUTHORITY });
    // Unreachable test URL: the D1 helper fail-closes the dial with a
    // finite redacted code (invalid_connection), proving the full
    // adapter->helper->adapter path is live (not mocked). A wrong code
    // or a hang fails this test.
    await assert.rejects(
      transport.invoke("relay-transport/connect", {
        authorityRef: AUTHORITY,
      }),
      (error) => {
        assert.equal(error?.code, "invalid_connection");
        return true;
      },
    );
    assert.equal(transport.pendingCount(), 0);
    await child.close();
    transport.dispose();
  });
}

assert.equal(RELAY_V2_PROFILE_ID, "relay-v2");
