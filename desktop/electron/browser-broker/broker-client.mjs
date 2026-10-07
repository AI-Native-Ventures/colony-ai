import net from "node:net";

/**
 * Client side of the broker channel, used by the stdio MCP server. Newline
 * delimited JSON, request ids, reconnect with backoff. A mutating tool call is
 * NEVER retried after a lost connection: the caller gets `connection_lost`.
 */

export const REQUEST_TIMEOUT_MS = 90_000;
/** Maximum buffered reply bytes, including a partial NDJSON frame. */
export const MAX_REPLY_BYTES = 8 * 1024 * 1024;
/** Maximum requests awaiting a response on one MCP connection. */
export const MAX_PENDING_REQUESTS = 32;
/** Lifetime reconnect budget; a new runtime session creates a new client. */
export const MAX_RECONNECT_ATTEMPTS = 8;
/** Maximum time to authenticate a new socket. */
export const HELLO_TIMEOUT_MS = 5_000;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 15_000;

export function createBrokerClient({
  socketPath,
  secret,
  agent,
  connectSocket = (target) => net.connect(target),
  onToolsChanged = () => {},
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  maxPending = MAX_PENDING_REQUESTS,
  maxReplyBytes = MAX_REPLY_BYTES,
  maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS,
  helloTimeoutMs = HELLO_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let socket = null;
  let ready = false;
  let closed = false;
  let started = false;
  let terminal = false;
  let reconnectAttempts = 0;
  let backoff = BACKOFF_START_MS;
  let nextId = 1;
  let buffer = "";
  let reconnectTimer = null;
  let helloTimer = null;
  const pending = new Map();

  function failAll(code) {
    for (const [id, entry] of pending) {
      clearTimer(entry.timer);
      entry.resolve({ ok: false, code });
      pending.delete(id);
    }
  }

  function scheduleReconnect() {
    if (closed || terminal || reconnectTimer) return;
    if (reconnectAttempts >= maxReconnectAttempts) {
      terminal = true;
      onToolsChanged();
      return;
    }
    reconnectAttempts += 1;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      connect();
    }, backoff);
    reconnectTimer.unref?.();
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }

  function onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return false;
    }
    if (!message || typeof message !== "object" || Array.isArray(message))
      return false;
    if (message.type === "tools-changed") {
      onToolsChanged();
      return true;
    }
    const entry = pending.get(message.id);
    if (!entry) return true;
    pending.delete(message.id);
    clearTimer(entry.timer);
    entry.resolve(message);
    return true;
  }

  function connect() {
    if (closed || terminal || socket || !socketPath || !secret || !agent)
      return;
    ready = false;
    buffer = "";
    let current;
    try {
      current = connectSocket(socketPath);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = current;
    const isCurrent = () => !closed && !terminal && socket === current;
    const lost = () => {
      if (!isCurrent()) return;
      socket = null;
      clearTimer(helloTimer);
      helloTimer = null;
      const wasReady = ready;
      ready = false;
      buffer = "";
      failAll("connection_lost");
      current.destroy();
      if (wasReady) onToolsChanged();
      scheduleReconnect();
    };
    helloTimer = setTimer(lost, helloTimeoutMs);
    helloTimer.unref?.();
    current.setEncoding?.("utf8");
    current.on("connect", () => {
      if (!isCurrent()) return;
      try {
        current.write(
          `${JSON.stringify({ id: 0, type: "hello", agent, secret })}\n`,
        );
      } catch {
        lost();
      }
    });
    current.on("data", (chunk) => {
      if (!isCurrent()) return;
      if (
        Buffer.byteLength(buffer) + Buffer.byteLength(chunk) >
        maxReplyBytes
      ) {
        lost();
        return;
      }
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!ready) {
          try {
            const reply = JSON.parse(line);
            if (reply.type === "hello" && reply.ok) {
              ready = true;
              clearTimer(helloTimer);
              helloTimer = null;
              backoff = BACKOFF_START_MS;
              onToolsChanged();
            }
          } catch {
            // ignore
          }
          continue;
        }
        if (!onLine(line)) {
          lost();
          return;
        }
      }
    });
    current.on("close", lost);
    current.on("error", lost);
  }

  function request(type, payload = {}) {
    if (!ready || !socket)
      return Promise.resolve({ ok: false, code: "no_connection" });
    if (pending.size >= maxPending)
      return Promise.resolve({ ok: false, code: "resource_limit" });
    const id = nextId;
    nextId += 1;
    const current = socket;
    return new Promise((resolve) => {
      const timer = setTimer(() => {
        pending.delete(id);
        resolve({ ok: false, code: "timeout" });
      }, requestTimeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, timer });
      try {
        current.write(`${JSON.stringify({ id, type, ...payload })}\n`);
      } catch {
        // The write may have reached the peer. Retire this connection and
        // settle every call without replaying any of them.
        current.emit("error", new Error("Browser channel write failed"));
      }
    });
  }

  return {
    start() {
      if (started || closed || terminal) return;
      started = true;
      connect();
    },
    isReady: () => ready,
    listTools: async () => {
      const reply = await request("tools");
      return reply.ok && Array.isArray(reply.tools) ? reply.tools : [];
    },
    callTool: async (tool, args) => {
      const reply = await request("call", { tool, args });
      if (reply.ok && reply.result) return reply.result;
      return {
        ok: false,
        code:
          reply.code === "no_connection"
            ? "no_grant"
            : (reply.code ?? "driver_error"),
        message:
          reply.code === "connection_lost"
            ? "The browser connection was lost. The action was not retried."
            : "No browser access is available for this task.",
      };
    },
    close() {
      closed = true;
      ready = false;
      clearTimer(reconnectTimer);
      clearTimer(helloTimer);
      failAll("connection_lost");
      socket?.destroy();
      socket = null;
      buffer = "";
    },
  };
}
