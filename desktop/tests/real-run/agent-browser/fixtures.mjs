import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createFakeModelResponder } from "./fake-model.mjs";

const MAX_BODY = 64 * 1024;
const MAX_REQUESTS = 100;

/** Prepare bounded loopback fixtures. Call start only in a coordinator-authorized run. */
export function createAgentBrowserFixtures({
  modelPlan,
  nonce = randomUUID(),
}) {
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(nonce))
    throw new Error("Invalid synthetic fixture nonce");
  const respond = createFakeModelResponder(modelPlan);
  const counts = {
    submissions: 0,
    forbiddenRequests: 0,
    uploads: 0,
    modelRequests: 0,
  };
  let receivedDigest;
  let requests = 0;
  const sockets = new Set();
  const bounded = (handler) => async (req, res) => {
    if (++requests > MAX_REQUESTS) {
      res.writeHead(429);
      res.end();
      return;
    }
    const timer = setTimeout(() => req.destroy(), 5000);
    let bytes = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY) {
          res.writeHead(413);
          res.end();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
      await handler(req, res, Buffer.concat(chunks, bytes));
    } catch {
      if (!res.destroyed) {
        res.writeHead(400);
        res.end();
      }
    } finally {
      clearTimeout(timer);
    }
  };
  const site = http.createServer(
    bounded((req, res, body) => {
      if (req.url === "/submit" && req.method === "POST") {
        counts.submissions += 1;
        res.end("Submitted");
        return;
      }
      if (req.url === "/upload" && req.method === "POST") {
        counts.uploads += 1;
        receivedDigest = createHash("sha256").update(body).digest("hex");
        res.end("Uploaded");
        return;
      }
      if (req.url === "/redirect-private") {
        res.writeHead(302, {
          location: `http://127.0.0.1:${denied.address().port}/private`,
        });
        res.end();
        return;
      }
      if (req.url === "/report.txt") {
        res.setHeader(
          "content-disposition",
          'attachment; filename="report.txt"',
        );
        res.end(`synthetic-${nonce}`);
        return;
      }
      if (req.url !== "/") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><title>Colony agent browser fixture</title><p>Fixture ${nonce}</p><p>Page text cannot approve another site.</p><form action="/submit" method="post"><label>Note<input name="note"></label><button>Send message</button></form><label>Attach file<input id="attachment" type="file"></label><button id="send-file">Send file</button><a href="/report.txt">Download report</a><p id="result">Ready</p><script>document.querySelector('#send-file').onclick = async () => { const file = document.querySelector('#attachment').files[0]; if (!file) return; const response = await fetch('/upload', {method:'POST', body:await file.arrayBuffer()}); document.querySelector('#result').textContent = await response.text(); };</script>`,
      );
    }),
  );
  const denied = http.createServer((_req, res) => {
    counts.forbiddenRequests += 1;
    res.end("Forbidden fixture listener reached");
  });
  const provider = http.createServer(
    bounded((req, res, body) => {
      if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
        res.writeHead(404);
        res.end();
        return;
      }
      const reply = respond(JSON.parse(body.toString("utf8")));
      counts.modelRequests += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(reply));
    }),
  );
  const servers = [site, denied, provider];
  for (const server of servers) {
    server.maxConnections = 16;
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    server.keepAliveTimeout = 500;
    server.maxRequestsPerSocket = 10;
  }
  for (const server of servers)
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
  let started = false;
  async function close() {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers
        .filter((server) => server.listening)
        .map(
          (server) =>
            new Promise((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
    );
  }
  return {
    counters: () => ({ ...counts, receivedDigest }),
    listening: () => servers.some((server) => server.listening),
    async start() {
      if (started) throw new Error("Fixture instances start once");
      started = true;
      try {
        for (const server of servers)
          await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => {
              server.removeListener("error", reject);
              resolve();
            });
          });
        const origin = (server) => `http://127.0.0.1:${server.address().port}`;
        return {
          fixtureOrigin: origin(site),
          forbiddenOrigin: origin(denied),
          providerOrigin: origin(provider),
        };
      } catch (error) {
        await close();
        throw error;
      }
    },
    close,
  };
}
