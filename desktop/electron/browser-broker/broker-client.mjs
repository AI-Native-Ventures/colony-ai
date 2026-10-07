import net from "node:net";

/**
 * Client side of the broker channel, used by the stdio MCP server. Newline
 * delimited JSON, request ids, reconnect with backoff. A mutating tool call is
 * NEVER retried after a lost connection: the caller gets `connection_lost`.
 */

export const REQUEST_TIMEOUT_MS = 90_000;
const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 15_000;

export function createBrokerClient({
  socketPath,
  secret,
  agent,
  connectSocket = (target) => net.connect(target),
  onToolsChanged = () => {},
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let socket = null;
  let ready = false;
  let closed = false;
  let backoff = BACKOFF_START_MS;
  let nextId = 1;
  let buffer = "";
  let reconnectTimer = null;
  const pending = new Map();

  function failAll(code) {
    for (const [id, entry] of pending) {
      clearTimer(entry.timer);
      entry.resolve({ ok: false, code });
      pending.delete(id);
    }
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
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
      return;
    }
    if (message.type === "tools-changed") {
      onToolsChanged();
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimer(entry.timer);
    entry.resolve(message);
  }

  function connect() {
    if (closed || !socketPath || !secret || !agent) return;
    ready = false;
    buffer = "";
    const current = connectSocket(socketPath);
    socket = current;
    current.setEncoding?.("utf8");
    current.on("connect", () => {
      current.write(
        `${JSON.stringify({ id: 0, type: "hello", agent, secret })}\n`,
      );
    });
    current.on("data", (chunk) => {
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
              backoff = BACKOFF_START_MS;
              onToolsChanged();
            }
          } catch {
            // ignore
          }
          continue;
        }
        onLine(line);
      }
    });
    const lost = () => {
      if (socket !== current) return;
      socket = null;
      const wasReady = ready;
      ready = false;
      failAll("connection_lost");
      if (wasReady) onToolsChanged();
      scheduleReconnect();
    };
    current.on("close", lost);
    current.on("error", lost);
  }

  function request(type, payload = {}) {
    if (!ready || !socket)
      return Promise.resolve({ ok: false, code: "no_connection" });
    const id = nextId;
    nextId += 1;
    return new Promise((resolve) => {
      const timer = setTimer(() => {
        pending.delete(id);
        resolve({ ok: false, code: "timeout" });
      }, requestTimeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, timer });
      socket.write(`${JSON.stringify({ id, type, ...payload })}\n`);
    });
  }

  return {
    start: connect,
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
      clearTimer(reconnectTimer);
      failAll("connection_lost");
      socket?.destroy();
    },
  };
}
