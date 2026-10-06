// Real network failure for the packaged app's native host. Playwright's context.setOffline only affects the
// renderer, so the avatar upload (made by the native host through the app's local media proxy) never failed in
// the earlier gates. This starts a local HTTP CONNECT proxy that the app is launched against
// (HTTPS_PROXY and friends); block(true) makes every new tunnel fail with 503, block(false) forwards again.
// Loopback is excluded through NO_PROXY so the app's own local servers keep working.
import http from "node:http";
import net from "node:net";

export async function startToggleProxy() {
  let blocked = false;
  const stats = { tunnels: 0, blockedTunnels: 0, plain: 0, blockedPlain: 0 };
  const server = http.createServer((req, res) => {
    // Plain HTTP request through the proxy.
    if (blocked) {
      stats.blockedPlain += 1;
      res.writeHead(503).end("blocked by gate proxy");
      return;
    }
    stats.plain += 1;
    let target;
    try {
      target = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.on("connect", (req, clientSocket, head) => {
    if (blocked) {
      stats.blockedTunnels += 1;
      clientSocket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }
    stats.tunnels += 1;
    const [host, port] = req.url.split(":");
    const upstream = net.connect(Number(port) || 443, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      clientSocket.destroy();
    };
    upstream.on("error", close);
    clientSocket.on("error", close);
    if (blocked) close();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    env: {
      HTTPS_PROXY: url,
      HTTP_PROXY: url,
      https_proxy: url,
      http_proxy: url,
      ALL_PROXY: url,
      NO_PROXY: "127.0.0.1,localhost,::1",
      no_proxy: "127.0.0.1,localhost,::1",
    },
    block(value) {
      blocked = Boolean(value);
    },
    stats: () => ({ ...stats, blocked }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
