import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const PREFIX = "@colony-native:";
const MAX_FRAME = 16 * 1024 * 1024;
const MAX_NATIVE_HOST_LOG_BYTES = 2 * 1024 * 1024;
const MAX_PRIVATE_FRAME = 64 * 1024;

/** Long-running native commands get a longer deadline than ordinary calls. */
const LONG_COMMANDS = new Map([
  ["save_onboarding_memories", 5 * 60_000],
  // Node bootstrap and two bounded connection package operations can outlast
  // the ordinary one-minute RPC window. Keep the response alive through them.
  ["install_acp_runtime", 12 * 60_000],
  // Native Google OAuth allows 180 seconds for the browser and 20 for exchange.
  ["google_desktop_sign_in", 210_000],
]);

export function nativeRequestTimeout(type, command, fallback) {
  if (type !== "invoke") return fallback;
  return Math.max(fallback, LONG_COMMANDS.get(command) ?? 0);
}

/** Private stdio client. Native payloads are never echoed to logs. */
export class NativeHost extends EventEmitter {
  pending = new Map();
  sequence = 0;
  buffer = Buffer.alloc(0);
  ended = false;
  privatePending = new Map();
  privateSequence = 0;
  closingNative = false;

  constructor(
    executable,
    {
      env = process.env,
      spawnProcess = spawn,
      timeout = 60000,
      shutdownGrace = 5000,
      onPrivateRequest,
      privateTimeout = 60_000,
    } = {},
  ) {
    super();
    if (
      (onPrivateRequest !== undefined &&
        typeof onPrivateRequest !== "function") ||
      !Number.isInteger(privateTimeout) ||
      privateTimeout < 1 ||
      privateTimeout > 60_000
    )
      throw new Error("Invalid private native handler");
    this.onPrivateRequest = onPrivateRequest;
    this.privateTimeout = privateTimeout;
    this.timeout = timeout;
    this.shutdownGrace = shutdownGrace;
    this.child = spawnProcess(executable, [], {
      env: { ...env, COLONY_ELECTRON_HOST: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.stderrLog = env.COLONY_NATIVE_HOST_LOG
      ? createWriteStream(env.COLONY_NATIVE_HOST_LOG, {
          flags: "w",
          mode: 0o600,
        })
      : null;
    this.stderrLogBytes = 0;
    this.stderrLog?.on("error", () => {
      this.stderrLog?.destroy();
      this.stderrLog = null;
    });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Consumers await ready, but process failure may arrive before they attach.
    this.ready.catch(() => {});
    this.readyTimer = setTimeout(
      () => this.fail("Native host startup timed out"),
      timeout,
    );
    this.child.stdout.on("data", (data) => this.receive(data));
    // Native stderr is private unless an explicit diagnostic path opts in.
    this.child.stderr.on("data", (data) => {
      if (!this.stderrLog) return;
      const remaining = MAX_NATIVE_HOST_LOG_BYTES - this.stderrLogBytes;
      const captured = data.subarray(0, remaining);
      this.stderrLogBytes += captured.length;
      this.stderrLog.write(captured);
      if (this.stderrLogBytes >= MAX_NATIVE_HOST_LOG_BYTES) {
        this.stderrLog.end();
        this.stderrLog = null;
      }
    });
    this.child.on("error", () => this.fail("Native host could not start"));
    this.exited = new Promise((resolve) =>
      this.child.once("exit", (code, signal) => {
        this.childExited = true;
        this.stderrLog?.end();
        this.stderrLog = null;
        clearTimeout(this.killTimer);
        this.fail(
          `Native host exited (code ${code ?? "none"}, signal ${signal ?? "none"})`,
        );
        resolve();
      }),
    );
    this.child.stdin.on("error", () => this.fail("Native host pipe closed"));
  }

  receive(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    for (;;) {
      const end = this.buffer.indexOf(10);
      if ((end === -1 ? this.buffer.length : end) > MAX_FRAME + PREFIX.length) {
        this.fail("Native response exceeds frame limit");
        return;
      }
      if (end === -1) return;
      const line = this.buffer.subarray(0, end).toString("utf8");
      this.buffer = this.buffer.subarray(end + 1);
      // Legacy stdout diagnostics are not RPC and are deliberately not logged.
      if (!line.startsWith(PREFIX)) continue;
      let message;
      try {
        message = JSON.parse(line.slice(PREFIX.length));
        if (!message || typeof message !== "object") throw new Error();
      } catch {
        this.fail("Malformed native response");
        return;
      }
      if (message.type === "ready") {
        if (message.version !== 1) {
          this.fail("Unsupported native protocol");
          return;
        }
        clearTimeout(this.readyTimer);
        this.resolveReady();
      } else if (message.type === "response") {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (Object.hasOwn(message, "error")) pending.reject(message.error);
        else pending.resolve(message.result);
      } else if (message.type === "private_request") {
        this.dispatchPrivate(message);
      } else if (["event", "channel"].includes(message.type))
        this.emit(message.type, message);
      else {
        this.fail("Unknown native frame");
        return;
      }
    }
  }

  /** Parent-only replies use stdio directly, never event or renderer routing. */
  replyPrivate(id, value) {
    if (this.ended || this.closingNative) return;
    let frame;
    try {
      frame = `${JSON.stringify({ type: "private_response", id, ...value })}\n`;
      if (Buffer.byteLength(frame) > MAX_PRIVATE_FRAME) throw new Error();
    } catch {
      frame = `${JSON.stringify({ type: "private_response", id, error: "private_result_invalid" })}\n`;
    }
    this.child.stdin.write(frame, (error) => {
      if (error) this.fail("Private native response pipe closed");
    });
  }

  dispatchPrivate(message) {
    if (
      !Number.isSafeInteger(message.id) ||
      message.id <= this.privateSequence ||
      typeof message.name !== "string" ||
      !/^[a-z_]{1,64}$/.test(message.name) ||
      !message.payload ||
      typeof message.payload !== "object" ||
      Array.isArray(message.payload) ||
      Object.keys(message).some(
        (key) => !["type", "id", "name", "payload"].includes(key),
      ) ||
      Buffer.byteLength(JSON.stringify(message)) > MAX_PRIVATE_FRAME
    ) {
      this.fail("Invalid private native request");
      return;
    }
    this.privateSequence = message.id;
    if (this.ended || this.closingNative) return;
    if (!this.onPrivateRequest || this.privatePending.size >= 16) {
      this.replyPrivate(message.id, { error: "private_request_unavailable" });
      return;
    }
    const controller = new AbortController();
    const entry = { controller, timedOut: false };
    this.privatePending.set(message.id, entry);
    entry.timer = setTimeout(() => {
      entry.timedOut = true;
      controller.abort();
      this.replyPrivate(message.id, { error: "private_request_timeout" });
      // Retain the slot until the handler exits. A hung handler cannot create
      // an unbounded family of promises by repeatedly timing out.
    }, this.privateTimeout);
    Promise.resolve()
      .then(() =>
        this.onPrivateRequest(message.name, message.payload, controller.signal),
      )
      .then(
        (result) => {
          if (!entry.timedOut && !controller.signal.aborted)
            this.replyPrivate(message.id, { result });
        },
        () => {
          if (!entry.timedOut && !controller.signal.aborted)
            this.replyPrivate(message.id, { error: "private_request_failed" });
        },
      )
      .finally(() => {
        clearTimeout(entry.timer);
        this.privatePending.delete(message.id);
      });
  }

  abortPrivate() {
    for (const entry of this.privatePending.values()) {
      clearTimeout(entry.timer);
      entry.controller.abort();
    }
  }

  fail(message) {
    if (this.ended) return;
    this.ended = true;
    this.abortPrivate();
    this.disconnectReason = message;
    clearTimeout(this.readyTimer);
    const error = new Error(message);
    this.rejectReady(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit("disconnected", message);
    this.child.stdin.destroy();
    if (!this.childExited) {
      this.child.kill("SIGTERM");
      this.killTimer = setTimeout(() => {
        if (!this.childExited) this.child.kill("SIGKILL");
      }, this.shutdownGrace);
      this.killTimer.unref();
    }
  }

  /** Reserve ids before subscribing so early pushes cannot be lost. */
  nextId() {
    return ++this.sequence;
  }

  async request(type, params = {}, id = this.nextId()) {
    await this.ready;
    if (this.ended)
      throw new Error(`Native host is disconnected: ${this.disconnectReason}`);
    if (this.pending.size >= 128) throw new Error("Native host is busy");
    const frame = `${JSON.stringify({ ...params, type, id })}\n`;
    if (Buffer.byteLength(frame) > MAX_FRAME)
      throw new Error("Native request exceeds frame limit");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("Native command timed out; its result is unknown"));
        },
        nativeRequestTimeout(type, params.command, this.timeout),
      );
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(frame, (error) => {
        if (error) this.fail("Native request pipe closed");
      });
    });
  }

  /** Ask Rust to drain its managed processes before terminating the helper. */
  async close() {
    this.closingNative = true;
    this.abortPrivate();
    if (this.childExited) return;
    if (!this.ended) this.child.stdin.end('{"type":"shutdown"}\n');
    const force = setTimeout(() => {
      if (!this.childExited) this.child.kill("SIGKILL");
    }, this.shutdownGrace);
    let deadline;
    try {
      await Promise.race([
        this.exited,
        new Promise((_, reject) => {
          deadline = setTimeout(
            () =>
              reject(
                new Error("Native host termination could not be confirmed"),
              ),
            this.shutdownGrace + 1500,
          );
        }),
      ]);
    } finally {
      clearTimeout(force);
      clearTimeout(deadline);
    }
  }
}
