import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createJsonLines, MAX_QUEUED_OUTPUT_BYTES } from "./json-lines.mjs";

/**
 * Local channel between the Electron main process (broker) and the stdio MCP
 * servers that managed agents launch. Newline delimited JSON over a Unix
 * domain socket (a named pipe on Windows).
 *
 * Authentication has three layers:
 *   1. the socket lives in a 0700 directory and is 0600 (same OS user only)
 *   2. `hello` must carry the per-launch broker secret (constant time compare)
 *   3. every action still needs a capability token the person created; the
 *      server keeps tokens in memory, keyed by the authenticated agent id, and
 *      never sends one over the wire.
 *
 * Residual risk (documented in the design): the agent id is asserted by the
 * runtime that starts the MCP server, so a hostile sibling agent that can read
 * another agent's environment could impersonate it.
 */

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const MAX_CONNECTIONS = 16;
const HELLO_TIMEOUT_MS = 5_000;
const MAX_HELLO_FAILURES = 3;

const digest = (value) => createHash("sha256").update(String(value)).digest();

export function safeEqual(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

/** Short path: macOS limits Unix socket paths to 104 bytes. */
export function defaultSocketPath({
  platform = process.platform,
  tmpdir = os.tmpdir(),
  uid = process.getuid?.() ?? 0,
  random = randomBytes(6).toString("hex"),
} = {}) {
  if (platform === "win32") return `\\\\.\\pipe\\colony-browser-${random}`;
  return path.join(tmpdir, `colony-${uid}`, `b-${random}.sock`);
}

/** Create the socket directory, refusing one that is not ours and private. */
export function prepareSocketDir(socketPath) {
  if (socketPath.startsWith("\\\\.\\pipe\\")) return;
  const dir = path.dirname(socketPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Socket directory is not a plain directory");
  if (uid !== undefined && stat.uid !== uid)
    throw new Error("Socket directory is owned by another user");
  if ((stat.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

function write(socket, message) {
  if (socket.destroyed || socket.writableEnded) return;
  const line = `${JSON.stringify(message)}\n`;
  if (
    socket.writableLength + Buffer.byteLength(line) >
    MAX_QUEUED_OUTPUT_BYTES
  ) {
    socket.destroy();
    return;
  }
  socket.write(line);
}

export function createBrokerServer({
  broker,
  capabilities,
  secret,
  socketPath = defaultSocketPath(),
  maxConnections = MAX_CONNECTIONS,
  maxFrame = MAX_FRAME_BYTES,
  helloTimeoutMs = HELLO_TIMEOUT_MS,
  maxPending = 16,
} = {}) {
  if (typeof secret !== "string" || secret.length < 16)
    throw new Error("A broker secret of at least 16 characters is required");
  const connections = new Set();
  const tokens = new Map();
  let server = null;

  function connectionsFor(agent) {
    return [...connections].filter((connection) => connection.agent === agent);
  }

  function pushToolsChanged(agent) {
    for (const connection of connectionsFor(agent))
      write(connection.socket, { type: "tools-changed" });
  }

  capabilities.onChange((event) => {
    if (["revoked", "expired", "taken-over"].includes(event.type)) {
      if (tokens.get(event.agentId) !== undefined) tokens.delete(event.agentId);
      pushToolsChanged(event.agentId);
    }
  });

  /** Host API: create the grant and hand its token to the agent's channel. */
  function issueGrant(request) {
    const { grant, token } = capabilities.issue(request);
    tokens.set(grant.agentId, token);
    pushToolsChanged(grant.agentId);
    return grant;
  }

  async function handle(connection, message) {
    const { socket } = connection;
    const id = message?.id;
    if (
      typeof message !== "object" ||
      message === null ||
      Array.isArray(message)
    )
      throw new Error("bad frame");
    if (!connection.agent) {
      if (message.type !== "hello") throw new Error("hello required");
      const agent = message.agent;
      if (
        typeof agent !== "string" ||
        agent.length === 0 ||
        agent.length > 256 ||
        !safeEqual(message.secret ?? "", secret)
      ) {
        connection.failures += 1;
        write(socket, { id, ok: false, code: "auth" });
        if (connection.failures >= MAX_HELLO_FAILURES) socket.destroy();
        else socket.end();
        return;
      }
      connection.agent = agent;
      clearTimeout(connection.helloTimer);
      write(socket, { id, type: "hello", ok: true });
      return;
    }
    const token = tokens.get(connection.agent);
    if (message.type === "tools") {
      write(socket, {
        id,
        ok: true,
        tools: token ? broker.toolsFor(token) : [],
      });
      return;
    }
    if (message.type === "call") {
      if (!token) {
        write(socket, {
          id,
          ok: true,
          result: {
            ok: false,
            code: "no_grant",
            message: "No browser access has been granted for this task.",
          },
        });
        return;
      }
      const result = await broker.call(token, message.tool, message.args);
      write(socket, { id, ok: true, result });
      return;
    }
    write(socket, { id, ok: false, code: "unknown_type" });
  }

  function accept(socket) {
    if (connections.size >= maxConnections) {
      socket.destroy();
      return;
    }
    const connection = {
      socket,
      agent: null,
      failures: 0,
      pending: 0,
      helloTimer: setTimeout(() => socket.destroy(), helloTimeoutMs),
    };
    connection.helloTimer.unref?.();
    connections.add(connection);
    const lines = createJsonLines({
      maxBytes: maxFrame,
      onError: () => socket.destroy(),
      onLine(line) {
        if (line.trim().length === 0) return true;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          write(socket, { ok: false, code: "bad_frame" });
          socket.destroy();
          return false;
        }
        if (connection.pending >= maxPending) {
          write(socket, { id: message?.id, ok: false, code: "resource_limit" });
          socket.end();
          return false;
        }
        connection.pending += 1;
        void handle(connection, message)
          .catch(() => {
            write(socket, { id: message?.id, ok: false, code: "bad_frame" });
            socket.destroy();
          })
          .finally(() => {
            connection.pending -= 1;
          });
        return true;
      },
    });
    socket.on("data", (chunk) => lines.push(chunk));
    const close = () => {
      lines.stop();
      clearTimeout(connection.helloTimer);
      connections.delete(connection);
    };
    socket.on("close", close);
    socket.on("error", close);
  }

  async function start() {
    prepareSocketDir(socketPath);
    if (!socketPath.startsWith("\\\\.\\pipe\\"))
      fs.rmSync(socketPath, { force: true });
    server = net.createServer(accept);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    if (!socketPath.startsWith("\\\\.\\pipe\\"))
      fs.chmodSync(socketPath, 0o600);
    return socketPath;
  }

  async function stop() {
    tokens.clear();
    for (const connection of connections) connection.socket.destroy();
    connections.clear();
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
    if (!socketPath.startsWith("\\\\.\\pipe\\"))
      fs.rmSync(socketPath, { force: true });
  }

  return {
    start,
    stop,
    issueGrant,
    socketPath,
    connectionCount: () => connections.size,
  };
}
