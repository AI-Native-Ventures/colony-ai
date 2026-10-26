import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBrokerClient } from "./broker-client.mjs";
import { createBroker } from "./broker-core.mjs";
import {
  createBrokerServer,
  defaultSocketPath,
  prepareSocketDir,
  safeEqual,
} from "./broker-server.mjs";
import { createCapabilityStore } from "./capability.mjs";
import { createFakePageDriver, until } from "./fake-page-driver.test.mjs";
import { toolNames } from "./tool-definitions.mjs";
import { browserSessionCredential } from "./session-identity.mjs";

const SECRET = "s".repeat(32);
const AGENT_A = "a".repeat(64);
const AGENT_B = "b".repeat(64);
const TASK = "conversation:11111111-1111-4111-8111-111111111111";
const COMMUNITY = "https://relay.example";
function hello(agent = AGENT_A, id = 1) {
  return {
    id,
    type: "hello",
    agent,
    taskId: TASK,
    communityOrigin: COMMUNITY,
    secret: browserSessionCredential(SECRET, {
      agentId: agent,
      taskId: TASK,
      communityOrigin: COMMUNITY,
    }),
  };
}

async function start({ capabilityOptions, ...options } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-"));
  const socketPath = path.join(dir, "sock", "b.sock");
  const capabilities = createCapabilityStore(capabilityOptions);
  const driver = createFakePageDriver();
  const broker = createBroker({
    capabilities,
    driver,
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  driver.attach(broker);
  driver.addTab({
    id: "tab-1",
    url: "https://shop.example/cart",
    title: "Cart",
    page: {
      text: "hi",
      elements: [
        { backend: 11, role: "button", name: "Add to cart", extra: {} },
      ],
    },
  });
  const server = createBrokerServer({
    broker,
    capabilities,
    secret: SECRET,
    socketPath,
    ...options,
  });
  await server.start();
  const cleanup = async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const grant = (agentId = AGENT_A, extra = {}) =>
    server.issueGrant({
      agentId,
      taskId: TASK,
      communityOrigin: COMMUNITY,
      businessId: "biz-1",
      tabId: "tab-1",
      allowedOrigins: ["https://shop.example"],
      ...extra,
    });
  return { server, capabilities, broker, driver, socketPath, grant, cleanup };
}

/** Raw NDJSON client for protocol level tests. */
function raw(socketPath) {
  const socket = net.connect(socketPath);
  socket.setEncoding("utf8");
  const frames = [];
  let buffer = "";
  let closed = false;
  socket.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      frames.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  socket.on("close", () => {
    closed = true;
  });
  socket.on("error", () => {
    closed = true;
  });
  return {
    socket,
    frames,
    send: (message) => socket.write(`${JSON.stringify(message)}\n`),
    isClosed: () => closed,
    waitClosed: () => until(() => closed),
    next: (predicate = () => true) => until(() => frames.find(predicate)),
  };
}

function connectClient(
  socketPath,
  agent = AGENT_A,
  secret = hello(agent).secret,
) {
  const changes = { count: 0 };
  const client = createBrokerClient({
    socketPath,
    secret,
    agent,
    taskId: TASK,
    communityOrigin: COMMUNITY,
    onToolsChanged: () => {
      changes.count += 1;
    },
  });
  client.start();
  return { client, changes };
}

test("safeEqual compares secrets without length leaks", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});

test("socket path is short and private by construction", () => {
  const unix = defaultSocketPath({
    platform: "darwin",
    tmpdir: "/var/folders/ab/cd/T",
    uid: 501,
    random: "aabbccddeeff",
  });
  assert.equal(unix, "/var/folders/ab/cd/T/colony-501/b-aabbccddeeff.sock");
  assert.ok(Buffer.byteLength(unix) < 104);
  assert.equal(
    defaultSocketPath({ platform: "win32", random: "x" }),
    "\\\\.\\pipe\\colony-browser-x",
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-"));
  const target = path.join(dir, "nested", "b.sock");
  prepareSocketDir(target);
  assert.equal(fs.statSync(path.dirname(target)).mode & 0o777, 0o700);
  fs.chmodSync(path.dirname(target), 0o755);
  prepareSocketDir(target);
  assert.equal(fs.statSync(path.dirname(target)).mode & 0o777, 0o700);
  fs.symlinkSync(os.tmpdir(), path.join(dir, "link"));
  assert.throws(() => prepareSocketDir(path.join(dir, "link", "b.sock")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the server refuses to start without a real secret", () => {
  assert.throws(() =>
    createBrokerServer({ broker: {}, capabilities: {}, secret: "short" }),
  );
  assert.throws(() => createBrokerServer({ broker: {}, capabilities: {} }));
});

test("the socket and its directory are private to the user", async () => {
  const env = await start();
  const mode = fs.statSync(env.socketPath).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(fs.statSync(path.dirname(env.socketPath)).mode & 0o777, 0o700);
  await env.cleanup();
});

test("a wrong secret is rejected and the connection closes", async () => {
  const env = await start();
  const client = raw(env.socketPath);
  client.send({
    id: 1,
    type: "hello",
    agent: AGENT_A,
    taskId: TASK,
    communityOrigin: COMMUNITY,
    secret: "x".repeat(32),
  });
  const reply = await client.next((frame) => frame.id === 1);
  assert.deepEqual([reply.ok, reply.code], [false, "auth"]);
  assert.ok(!JSON.stringify(reply).includes(SECRET));
  await client.waitClosed();
  await env.cleanup();
});

test("anything before hello closes the connection", async () => {
  const env = await start();
  const client = raw(env.socketPath);
  client.send({ id: 1, type: "tools" });
  await client.waitClosed();
  assert.equal(env.server.connectionCount(), 0);
  await env.cleanup();
});

test("malformed and oversized frames close the connection", async () => {
  const env = await start({ maxFrame: 1_000 });
  const bad = raw(env.socketPath);
  bad.socket.write("{not json\n");
  await bad.waitClosed();
  const big = raw(env.socketPath);
  big.socket.write("x".repeat(5_000));
  await big.waitClosed();
  await env.cleanup();
});

test("a silent connection is dropped after the hello deadline", async () => {
  const env = await start({ helloTimeoutMs: 40 });
  const client = raw(env.socketPath);
  await client.waitClosed();
  await env.cleanup();
});

test("the connection cap holds", async () => {
  const env = await start({ maxConnections: 2 });
  const a = raw(env.socketPath);
  const b = raw(env.socketPath);
  a.send(hello(AGENT_A));
  b.send(hello(AGENT_B));
  await a.next((f) => f.type === "hello");
  await b.next((f) => f.type === "hello");
  const c = raw(env.socketPath);
  await c.waitClosed();
  await env.cleanup();
});

test("tools are empty until a grant, appear with a push, and vanish on revoke", async () => {
  const env = await start();
  const { client, changes } = connectClient(env.socketPath);
  await until(() => client.isReady());
  assert.deepEqual(await client.listTools(), []);
  const before = changes.count;
  const grant = env.grant();
  await until(() => changes.count > before);
  assert.deepEqual(
    (await client.listTools()).map((tool) => tool.name),
    toolNames(),
  );
  const result = await client.callTool("browser_snapshot", { tab: "tab-1" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.snapshot.includes("Add to cart"));
  const afterGrant = changes.count;
  env.broker.revoke(grant.id);
  await until(() => changes.count > afterGrant);
  assert.deepEqual(await client.listTools(), []);
  const denied = await client.callTool("browser_snapshot", { tab: "tab-1" });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "no_grant");
  client.close();
  await env.cleanup();
});

test("a grant for one agent is invisible to every other agent", async () => {
  const env = await start();
  const a = connectClient(env.socketPath, AGENT_A);
  const b = connectClient(env.socketPath, AGENT_B);
  await until(() => a.client.isReady() && b.client.isReady());
  env.grant(AGENT_A);
  await until(async () => (await a.client.listTools()).length > 0);
  assert.deepEqual(await b.client.listTools(), []);
  assert.equal((await b.client.callTool("browser_tabs", {})).code, "no_grant");
  assert.equal((await a.client.callTool("browser_tabs", {})).ok, true);
  a.client.close();
  b.client.close();
  await env.cleanup();
});

test("take over and expiry also remove the tools and push the change", async () => {
  const env = await start();
  const { client, changes } = connectClient(env.socketPath);
  await until(() => client.isReady());
  const grant = env.grant();
  await until(async () => (await client.listTools()).length > 0);
  const before = changes.count;
  env.broker.takeOver(grant.id);
  await until(() => changes.count > before);
  assert.deepEqual(await client.listTools(), []);
  client.close();
  await env.cleanup();
});

test("tokens never cross the wire", async () => {
  const env = await start();
  const client = raw(env.socketPath);
  client.send(hello());
  await client.next((f) => f.type === "hello");
  env.grant();
  client.send({ id: 2, type: "tools" });
  client.send({ id: 3, type: "call", tool: "browser_tabs", args: {} });
  await client.next((f) => f.id === 3);
  const wire = JSON.stringify(client.frames);
  assert.ok(!/token/iu.test(wire.replace(/tools-changed/gu, "")));
  assert.ok(!wire.includes(SECRET));
  await env.cleanup();
});

test("the client reconnects after the server restarts and never retries a call", async () => {
  const env = await start();
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  env.grant();
  await until(async () => (await client.listTools()).length > 0);
  env.driver.hold("snapshot");
  const inflight = client.callTool("browser_snapshot", { tab: "tab-1" });
  await until(() => env.driver.count("snapshot") === 1);
  await env.server.stop();
  const lost = await inflight;
  assert.equal(lost.ok, false);
  assert.equal(lost.code, "connection_lost");
  assert.ok(/not retried/u.test(lost.message));
  assert.equal(env.driver.count("snapshot"), 1);
  client.close();
  fs.rmSync(path.dirname(path.dirname(env.socketPath)), {
    recursive: true,
    force: true,
  });
});

test("production socket entrypoint bounds complete concurrent frames before dispatch", async (t) => {
  const env = await start({ maxPending: 2 });
  const client = raw(env.socketPath);
  let calls = 0;
  const held = [];
  env.broker.call = () => {
    calls += 1;
    return new Promise((resolve) => held.push(resolve));
  };
  t.after(async () => {
    for (const resolve of held) resolve({ ok: false, code: "fenced" });
    client.socket.destroy();
    await env.cleanup();
  });
  client.send(hello(AGENT_A, 0));
  await client.next((frame) => frame.type === "hello");
  env.grant();
  client.socket.write(
    [1, 2, 3]
      .map((id) =>
        JSON.stringify({
          id,
          type: "call",
          tool: "browser_tabs",
          args: {},
        }),
      )
      .join("\n") + "\n",
  );
  const result = await client.next((frame) => frame.id === 3);
  assert.equal(result.code, "resource_limit");
  assert.equal(calls, 2);
  await client.waitClosed();
});

// ---- default access: the first browser call opens the browser ---------------

const ASK = { agentId: AGENT_A, taskId: TASK, communityOrigin: COMMUNITY };

test("under default access the tools are listed before any grant", async () => {
  const env = await start({ defaultAccess: true });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  assert.deepEqual(
    (await client.listTools()).map((tool) => tool.name),
    toolNames(),
  );
  client.close();
  await env.cleanup();
});

test("without default access nothing is listed or asked for", async () => {
  const requests = [];
  const env = await start({ onAccessRequested: (r) => requests.push(r) });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  assert.deepEqual(await client.listTools(), []);
  const denied = await client.callTool("browser_tabs", {});
  assert.equal(denied.code, "no_grant");
  assert.deepEqual(requests, []);
  client.close();
  await env.cleanup();
});

test("a first call asks the app for a browser and runs once the grant exists", async () => {
  const requests = [];
  const env = await start({
    defaultAccess: true,
    onAccessRequested: (request) => requests.push(request),
  });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  const first = client.callTool("browser_tabs", {});
  await until(() => requests.length === 1);
  assert.deepEqual(requests[0], { ...ASK, resume: false });
  env.grant();
  const result = await first;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    result.tabs.map((tab) => tab.id),
    ["tab-1"],
  );
  // The next call uses the grant and asks for nothing.
  assert.equal((await client.callTool("browser_tabs", {})).ok, true);
  assert.equal(requests.length, 1);
  client.close();
  await env.cleanup();
});

test("calls made together share one request", async () => {
  const requests = [];
  const env = await start({
    defaultAccess: true,
    onAccessRequested: (request) => requests.push(request),
  });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  const calls = [
    client.callTool("browser_tabs", {}),
    client.callTool("browser_tabs", {}),
    client.callTool("browser_connect", {}),
  ];
  await until(() => requests.length === 1);
  env.grant();
  for (const result of await Promise.all(calls))
    assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(requests.length, 1);
  client.close();
  await env.cleanup();
});

test("when no browser can be opened the call ends with the approval guidance", async () => {
  const requests = [];
  const env = await start({
    defaultAccess: true,
    accessWaitMs: 30,
    onAccessRequested: (request) => requests.push(request),
  });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  const result = await client.callTool("browser_tabs", {});
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_grant");
  assert.match(result.message, /Ask the person to approve the Colony browser/u);
  // A later call asks again: the app may be ready now.
  const again = client.callTool("browser_tabs", {});
  await until(() => requests.length === 2);
  env.grant();
  assert.equal((await again).ok, true);
  client.close();
  await env.cleanup();
});

test("a failing app handler still ends the call cleanly", async () => {
  const env = await start({
    defaultAccess: true,
    accessWaitMs: 30,
    onAccessRequested: () => {
      throw new Error("renderer exploded with /Users/secret/path");
    },
  });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  const result = await client.callTool("browser_tabs", {});
  assert.equal(result.code, "no_grant");
  assert.ok(!JSON.stringify(result).includes("secret"));
  client.close();
  await env.cleanup();
});

test("the person's Stop is respected: the next call asks with resume and is not granted silently", async () => {
  const requests = [];
  const env = await start({
    defaultAccess: true,
    accessWaitMs: 30,
    onAccessRequested: (request) => requests.push(request),
  });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  const grant = env.grant();
  assert.equal((await client.callTool("browser_tabs", {})).ok, true);
  env.broker.revoke(grant.id, "person revoked");
  const after = await client.callTool("browser_tabs", {});
  assert.equal(after.code, "no_grant");
  assert.deepEqual(requests, [{ ...ASK, resume: true }]);
  assert.match(after.message, /stopped/u);
  // Only the person allowing it again brings the browser back.
  const waiting = client.callTool("browser_tabs", {});
  await until(() => requests.length === 2);
  env.grant();
  assert.equal((await waiting).ok, true);
  client.close();
  await env.cleanup();
});

test("taking over and closing the tab are also stops, but expiry is not", async () => {
  for (const [end, resume] of [
    [(env, grant) => env.broker.takeOver(grant.id), true],
    [(env, grant) => env.broker.revoke(grant.id, "tab closed"), true],
    [(env, grant) => env.broker.revoke(grant.id, "replaced"), false],
    [(env, grant) => env.broker.revoke(grant.id, "expired"), false],
  ]) {
    const requests = [];
    const env = await start({
      defaultAccess: true,
      accessWaitMs: 20,
      onAccessRequested: (request) => requests.push(request),
    });
    const { client } = connectClient(env.socketPath);
    await until(() => client.isReady());
    const grant = env.grant();
    end(env, grant);
    await client.callTool("browser_tabs", {});
    assert.equal(requests[0].resume, resume);
    client.close();
    await env.cleanup();
  }
});

test("a grant that runs out is renewed by the next call without asking the person", async () => {
  const clock = { wall: 1_000_000, mono: 5_000 };
  const requests = [];
  const env = await start({
    defaultAccess: true,
    capabilityOptions: {
      now: () => clock.wall,
      monotonic: () => clock.mono,
    },
    accessWaitMs: 50,
    onAccessRequested: (request) => requests.push(request),
  });
  const { client } = connectClient(env.socketPath);
  await until(() => client.isReady());
  env.grant(AGENT_A, { ttlMs: 1_000 });
  clock.wall += 5_000;
  clock.mono += 5_000;
  const renewed = client.callTool("browser_tabs", {});
  await until(() => requests.length === 1);
  assert.equal(requests[0].resume, false);
  env.grant();
  assert.equal((await renewed).ok, true);
  client.close();
  await env.cleanup();
});

test("another agent's grant never answers this agent's request", async () => {
  const requests = [];
  const env = await start({
    defaultAccess: true,
    accessWaitMs: 40,
    onAccessRequested: (request) => requests.push(request),
  });
  const { client } = connectClient(env.socketPath, AGENT_A);
  await until(() => client.isReady());
  const waiting = client.callTool("browser_tabs", {});
  await until(() => requests.length === 1);
  env.grant(AGENT_B);
  assert.equal((await waiting).code, "no_grant");
  client.close();
  await env.cleanup();
});
