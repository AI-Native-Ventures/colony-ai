import http from "node:http";
import net from "node:net";
import {
  checkAddresses,
  checkUrl,
  defaultResolver,
  normalizePrivateExceptions,
} from "./url-policy.mjs";

/**
 * Connect-time egress proxy for a business browser session while an agent
 * grant is active (design section 7). It closes the DNS rebinding gap: the
 * browser never resolves names itself. This proxy resolves once, classifies
 * EVERY answer, and connects to the pinned IP literal, so a second, different
 * DNS answer can never be used.
 *
 * Electron wiring (main process, per business session):
 *   session.setProxy({
 *     proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
 *     // Chromium bypasses proxies for loopback by default; this removes that
 *     // implicit bypass so localhost and 127.0.0.1 are policed too.
 *     proxyBypassRules: "<-loopback>",
 *   });
 *   await session.closeAllConnections();
 * and the reverse when the last grant ends.
 *
 * Only HTTP proxy requests and CONNECT are served. Anything else is refused.
 */

export const MAX_PROXY_CONNECTIONS = 256;
const CONNECT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 120_000;
const MAX_HEADER_BYTES = 64 * 1024;

const HOP_BY_HOP = new Set([
  "connection",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createEgressProxy({
  resolver = defaultResolver,
  getPrivateExceptions = () => [],
  connect = (target) => net.connect(target),
  onDenied = () => {},
  maxConnections = MAX_PROXY_CONNECTIONS,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
} = {}) {
  const sockets = new Set();
  const stats = { allowed: 0, denied: 0, active: 0 };
  let server = null;

  /** Resolve once, check every answer, return the pinned address or a refusal. */
  async function authorize(hostname, port) {
    const host = hostname
      .replace(/^\[|\]$/gu, "")
      .toLowerCase()
      .replace(/\.$/u, "");
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
      return { ok: false, code: "invalid_input" };
    let exceptions;
    try {
      exceptions = normalizePrivateExceptions(getPrivateExceptions());
    } catch {
      exceptions = [];
    }
    const checked = checkUrl(
      `http://${host.includes(":") ? `[${host}]` : host}:${port}/`,
      {
        privateExceptions: exceptions,
      },
    );
    if (!checked.ok) return { ok: false, code: checked.code };
    if (checked.ip)
      return { ok: true, address: checked.ip, family: net.isIP(checked.ip) };
    let answers;
    try {
      answers = await resolver(host);
    } catch {
      return { ok: false, code: "dns_failed" };
    }
    const verdict = checkAddresses(answers, { exception: checked.exception });
    if (!verdict.ok) return { ok: false, code: verdict.code };
    const [first] = verdict.addresses;
    return { ok: true, address: first.address, family: first.family };
  }

  function deny(host, port, code) {
    stats.denied += 1;
    // Host and port only: never a path or query, which can hold secrets.
    try {
      onDenied({ host, port, code });
    } catch {
      // observer failure must not affect the response
    }
  }

  function track(socket) {
    sockets.add(socket);
    stats.active = sockets.size;
    socket.once("close", () => {
      sockets.delete(socket);
      stats.active = sockets.size;
    });
  }

  function onConnect(req, clientSocket, head) {
    track(clientSocket);
    clientSocket.on("error", () => clientSocket.destroy());
    if (sockets.size > maxConnections) {
      clientSocket.end(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
      );
      return;
    }
    const match = /^(\[[0-9a-fA-F:.]+\]|[^:\s]+):(\d{1,5})$/u.exec(
      req.url ?? "",
    );
    if (!match) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    const host = match[1];
    const port = Number(match[2]);
    authorize(host, port)
      .then((verdict) => {
        if (!verdict.ok) {
          deny(host, port, verdict.code);
          clientSocket.end(
            "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n",
          );
          return;
        }
        const upstream = connect({
          host: verdict.address,
          port,
          family: verdict.family,
        });
        track(upstream);
        upstream.setTimeout?.(connectTimeoutMs, () => upstream.destroy());
        upstream.once("error", () => {
          if (!clientSocket.destroyed)
            clientSocket.end(
              "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n",
            );
          upstream.destroy();
        });
        upstream.once("connect", () => {
          stats.allowed += 1;
          upstream.setTimeout?.(idleTimeoutMs, () => {
            upstream.destroy();
            clientSocket.destroy();
          });
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head?.length) upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        clientSocket.once("close", () => upstream.destroy());
        upstream.once("close", () => clientSocket.destroy());
      })
      .catch(() => clientSocket.destroy());
  }

  function onRequest(req, res) {
    const refuse = (status) => {
      res.writeHead(status, { Connection: "close" });
      res.end();
    };
    if (sockets.size > maxConnections) return refuse(503);
    let target;
    try {
      target = new URL(req.url ?? "");
    } catch {
      return refuse(400);
    }
    if (target.protocol !== "http:") return refuse(400);
    const port = target.port ? Number(target.port) : 80;
    authorize(target.hostname, port)
      .then((verdict) => {
        if (!server?.listening || req.aborted || res.destroyed) return;
        if (!verdict.ok) {
          deny(target.hostname, port, verdict.code);
          return refuse(403);
        }
        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (!HOP_BY_HOP.has(name)) headers[name] = value;
        }
        headers.host = target.host;
        const upstream = http.request({
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers,
          createConnection: () =>
            connect({ host: verdict.address, port, family: verdict.family }),
          timeout: connectTimeoutMs,
        });
        stats.allowed += 1;
        // A caller abort or proxy shutdown owns the upstream socket too.
        // Otherwise an unfinished HTTP body survives its revoked client.
        upstream.once("socket", (socket) => track(socket));
        req.once("aborted", () => upstream.destroy());
        res.once("close", () => upstream.destroy());
        upstream.once("response", (response) => {
          const out = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (!HOP_BY_HOP.has(name)) out[name] = value;
          }
          res.writeHead(response.statusCode ?? 502, out);
          response.pipe(res);
        });
        upstream.once("timeout", () => upstream.destroy());
        upstream.once("error", () => {
          if (!res.headersSent) refuse(502);
          else res.destroy();
        });
        req.pipe(upstream);
      })
      .catch(() => refuse(502));
  }

  async function start({ host = "127.0.0.1", port = 0 } = {}) {
    server = http.createServer({ maxHeaderSize: MAX_HEADER_BYTES }, onRequest);
    server.on("connect", onConnect);
    server.on("connection", track);
    server.on("clientError", (_error, socket) => {
      if (socket.writable)
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      else socket.destroy();
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return server.address().port;
  }

  async function stop() {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
      server = null;
    }
  }

  return { start, stop, stats, authorize };
}
