import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { createEgressProxy } from "./egress-proxy.mjs";
import { until } from "./fake-page-driver.test.mjs";

/** An upstream "internet" on loopback. The proxy is told to reach it through an injected connect. */
async function startUpstream() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url,
      host: req.headers.host,
      via: req.headers["proxy-connection"],
    });
    res.writeHead(200, { "content-type": "text/plain", "x-upstream": "1" });
    res.end(`hello ${req.url}`);
  });
  const echo = net.createServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => echo.listen(0, "127.0.0.1", resolve));
  return {
    requests,
    httpPort: server.address().port,
    echoPort: echo.address().port,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
      await new Promise((resolve) => echo.close(() => resolve()));
    },
  };
}

async function setup(t, { answers, exceptions = [], maxConnections } = {}) {
  const upstream = await startUpstream();
  const connects = [];
  const resolves = [];
  const denied = [];
  const proxy = createEgressProxy({
    resolver: async (host) => {
      resolves.push(host);
      return typeof answers === "function"
        ? answers(host, resolves.length)
        : (answers?.[host] ?? [{ address: "93.184.216.34", family: 4 }]);
    },
    getPrivateExceptions: () => exceptions,
    // Whatever pinned address the proxy chose, land on our loopback upstream.
    connect: ({ host, port, family }) => {
      connects.push({ host, port, family });
      return net.connect({
        host: "127.0.0.1",
        port: port === 80 ? upstream.httpPort : upstream.echoPort,
      });
    },
    onDenied: (event) => denied.push(event),
    maxConnections,
  });
  const port = await proxy.start();
  let closed = false;
  const close = async () => {
    if (closed) return;
    await proxy.stop();
    await upstream.close();
    closed = true;
  };
  t.after(close);
  return {
    proxy,
    port,
    upstream,
    connects,
    resolves,
    denied,
    close,
  };
}

function rawConnect(port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let data = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        socket.destroy();
        reject(error);
      } else resolve({ data, socket });
    };
    const timer = setTimeout(
      () => finish(new Error("CONNECT response deadline exceeded")),
      10_000,
    );
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.length > 16 * 1024)
        finish(new Error("CONNECT response exceeded its bound"));
      else if (data.includes("\r\n\r\n")) finish();
    });
    socket.on("error", finish);
    socket.on("connect", () =>
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
    );
    socket.on("close", () =>
      finish(new Error("CONNECT closed before a complete reply")),
    );
  });
}

function proxiedGet(port, url) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path: url,
        headers: { host: new URL(url).host, "proxy-connection": "keep-alive" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("CONNECT to a public name tunnels bytes through the pinned IP, not the name", async (t) => {
  const env = await setup(t);
  const { data, socket } = await rawConnect(env.port, "shop.example:443");
  assert.ok(data.startsWith("HTTP/1.1 200"));
  socket.destroy();
  assert.deepEqual(env.connects, [
    { host: "93.184.216.34", port: 443, family: 4 },
  ]);
  assert.deepEqual(env.resolves, ["shop.example"]);
  assert.equal(env.proxy.stats.allowed, 1);
  await env.close();
});

test("bytes flow both ways through an allowed tunnel", async (t) => {
  const env = await setup(t);
  const socket = net.connect(env.port, "127.0.0.1");
  socket.setEncoding("utf8");
  let data = "";
  socket.on("data", (chunk) => {
    data += chunk;
  });
  await new Promise((resolve) => socket.on("connect", resolve));
  socket.write(
    "CONNECT shop.example:443 HTTP/1.1\r\nHost: shop.example:443\r\n\r\n",
  );
  await until(() => data.includes("200 Connection Established"));
  socket.write("ping-through-tunnel");
  await until(() => data.includes("ping-through-tunnel"));
  socket.destroy();
  await env.close();
});

test("a name that resolves to a private address is refused and never connected", async (t) => {
  const env = await setup(t, {
    answers: {
      "evil.example": [{ address: "10.0.0.9", family: 4 }],
      "meta.example": [{ address: "169.254.169.254", family: 4 }],
    },
  });
  for (const target of ["evil.example:443", "meta.example:80"]) {
    const { data } = await rawConnect(env.port, target);
    assert.ok(data.startsWith("HTTP/1.1 403"), `${target}: ${data}`);
  }
  assert.equal(env.connects.length, 0);
  assert.deepEqual(
    env.denied.map((event) => event.code),
    ["private_network_denied", "private_network_denied"],
  );
  assert.deepEqual(
    env.denied.map((event) => event.host),
    ["evil.example", "meta.example"],
  );
  await env.close();
});

test("a mixed public and private answer is refused", async (t) => {
  const env = await setup(t, {
    answers: {
      "mixed.example": [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    },
  });
  const { data } = await rawConnect(env.port, "mixed.example:443");
  assert.ok(data.startsWith("HTTP/1.1 403"));
  assert.equal(env.connects.length, 0);
  await env.close();
});

test("DNS rebinding cannot change the target after the check", async (t) => {
  const env = await setup(t, {
    answers: (_host, call) =>
      call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "127.0.0.1", family: 4 }],
  });
  const first = await rawConnect(env.port, "rebind.example:443");
  assert.ok(first.data.startsWith("HTTP/1.1 200"));
  first.socket.destroy();
  assert.equal(env.connects[0].host, "93.184.216.34");
  assert.equal(env.resolves.length, 1);
  const second = await rawConnect(env.port, "rebind.example:443");
  assert.ok(second.data.startsWith("HTTP/1.1 403"));
  assert.equal(env.connects.length, 1);
  await env.close();
});

test("literal private addresses, localhost and bad ports are refused without resolving", async (t) => {
  const env = await setup(t);
  for (const target of [
    "127.0.0.1:8080",
    "[::1]:8080",
    "192.168.1.1:80",
    "169.254.169.254:80",
    "localhost:3000",
    "router:80",
    "printer.local:631",
  ]) {
    const { data } = await rawConnect(env.port, target);
    assert.ok(data.startsWith("HTTP/1.1 403"), `${target}: ${data}`);
  }
  assert.equal(env.connects.length, 0);
  assert.equal(env.resolves.length, 0);
  for (const bad of ["nonsense", "host:99999", "host:0", ":80"]) {
    const { data } = await rawConnect(env.port, bad);
    assert.ok(
      data.startsWith("HTTP/1.1 400") || data.startsWith("HTTP/1.1 403"),
      `${bad}: ${data}`,
    );
  }
  await env.close();
});

test("an explicit private exception opens exactly that host and port", async (t) => {
  const env = await setup(t, {
    exceptions: ["localhost:3000"],
    answers: { localhost: [{ address: "127.0.0.1", family: 4 }] },
  });
  const ok = await rawConnect(env.port, "localhost:3000");
  assert.ok(ok.data.startsWith("HTTP/1.1 200"));
  ok.socket.destroy();
  const other = await rawConnect(env.port, "localhost:3001");
  assert.ok(other.data.startsWith("HTTP/1.1 403"));
  const meta = await rawConnect(env.port, "169.254.169.254:80");
  assert.ok(meta.data.startsWith("HTTP/1.1 403"));
  await env.close();
});

test("exceptions are read live so revoking one takes effect immediately", async () => {
  let exceptions = ["localhost:3000"];
  const upstream = await startUpstream();
  const proxy = createEgressProxy({
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
    getPrivateExceptions: () => exceptions,
    connect: () => net.connect({ host: "127.0.0.1", port: upstream.echoPort }),
  });
  const port = await proxy.start();
  const open = await rawConnect(port, "localhost:3000");
  assert.ok(open.data.startsWith("HTTP/1.1 200"));
  open.socket.destroy();
  exceptions = [];
  const closed = await rawConnect(port, "localhost:3000");
  assert.ok(closed.data.startsWith("HTTP/1.1 403"));
  await proxy.stop();
  await upstream.close();
});

test("a resolver failure is a refusal, not a crash", async (t) => {
  const env = await setup(t, {
    answers: () => {
      throw new Error("ENOTFOUND");
    },
  });
  const { data } = await rawConnect(env.port, "nope.example:443");
  assert.ok(data.startsWith("HTTP/1.1 403"));
  assert.equal(env.denied[0].code, "dns_failed");
  await env.close();
});

test("plain HTTP is forwarded to the pinned address with an origin-form path", async (t) => {
  const env = await setup(t);
  const result = await proxiedGet(env.port, "http://shop.example/cart?x=1");
  assert.equal(result.status, 200);
  assert.equal(result.body, "hello /cart?x=1");
  assert.equal(result.headers["x-upstream"], "1");
  assert.equal(env.upstream.requests[0].host, "shop.example");
  assert.equal(env.upstream.requests[0].via, undefined);
  assert.deepEqual(env.connects, [
    { host: "93.184.216.34", port: 80, family: 4 },
  ]);
  await env.close();
});

test("plain HTTP to a private target is refused and non http requests are rejected", async (t) => {
  const env = await setup(t, {
    answers: { "evil.example": [{ address: "10.1.1.1", family: 4 }] },
  });
  assert.equal(
    (await proxiedGet(env.port, "http://evil.example/")).status,
    403,
  );
  assert.equal((await proxiedGet(env.port, "http://127.0.0.1/")).status, 403);
  assert.equal((await proxiedGet(env.port, "http://localhost/")).status, 403);
  assert.equal(env.connects.length, 0);
  const origin = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: env.port, path: "/not-a-proxy-request" },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(origin, 400);
  // https requests must arrive as CONNECT; an absolute https URI is refused.
  assert.equal(
    (await proxiedGet(env.port, "https://shop.example/x")).status,
    400,
  );
  assert.equal(
    (await proxiedGet(env.port, "ftp://shop.example/x")).status,
    400,
  );
  assert.equal(env.connects.length, 0);
  await env.close();
});

test("the connection cap holds", async (t) => {
  const env = await setup(t, { maxConnections: 1 });
  const first = await rawConnect(env.port, "a.example:443");
  assert.ok(first.data.startsWith("HTTP/1.1 200"));
  const second = await rawConnect(env.port, "b.example:443");
  assert.ok(second.data.startsWith("HTTP/1.1 503") || second.data === "");
  first.socket.destroy();
  await env.close();
});

test("stop closes every open tunnel", async (t) => {
  const env = await setup(t);
  const { socket } = await rawConnect(env.port, "shop.example:443");
  let closed = false;
  socket.on("close", () => {
    closed = true;
  });
  await env.proxy.stop();
  await until(() => closed);
  await env.upstream.close();
});
