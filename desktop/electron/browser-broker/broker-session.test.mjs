import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBrokerClient } from "./broker-client.mjs";
import { createBroker } from "./broker-core.mjs";
import { createBrokerServer } from "./broker-server.mjs";
import { createCapabilityStore } from "./capability.mjs";
import { createFakePageDriver, until } from "./fake-page-driver.test.mjs";
import { browserSessionCredential } from "./session-identity.mjs";

const master = "m".repeat(64); // Public fake, same length as a derived credential.
const session = {
  agentId: "a".repeat(64),
  taskId: "thread:11111111-1111-4111-8111-111111111111:" + "b".repeat(64),
  communityOrigin: "https://relay.example",
};

async function fixture(t, capabilityOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-scope-"));
  const capabilities = createCapabilityStore(capabilityOptions);
  const driver = createFakePageDriver();
  const broker = createBroker({ capabilities, driver });
  driver.attach(broker);
  driver.addTab({ id: "tab", url: "https://shop.example", title: "Fixture" });
  const server = createBrokerServer({
    broker,
    capabilities,
    secret: master,
    socketPath: path.join(dir, "s", "b.sock"),
  });
  await server.start();
  t.after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const grant = (context = session, options = {}) =>
    server.issueGrant({
      ...context,
      businessId: "business",
      tabId: "tab",
      allowedOrigins: ["https://shop.example"],
      ...options,
    });
  async function client(context = session) {
    const client = createBrokerClient({
      socketPath: server.socketPath,
      secret: browserSessionCredential(master, context),
      agent: context.agentId,
      taskId: context.taskId,
      communityOrigin: context.communityOrigin,
    });
    t.after(() => client.close());
    client.start();
    await until(() => client.isReady(), 1000);
    return client;
  }
  return { server, broker, capabilities, grant, client };
}

async function hello(socketPath, fields) {
  const socket = net.connect(socketPath);
  socket.setEncoding("utf8");
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No hello reply")), 1000);
      let buffer = "";
      socket.on("error", reject);
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (!buffer.includes("\n")) return;
        clearTimeout(timer);
        resolve(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
      });
      socket.write(JSON.stringify({ id: 0, type: "hello", ...fields }) + "\n");
    });
  } finally {
    socket.destroy();
  }
}

test("the launch master cannot authenticate as a browser session credential", async (t) => {
  const f = await fixture(t);
  const reply = await hello(f.server.socketPath, {
    agent: session.agentId,
    taskId: session.taskId,
    communityOrigin: session.communityOrigin,
    secret: master,
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "auth");
  assert.ok(!JSON.stringify(reply).includes(master));
});

test("legacy agent-only hello is refused even with the launch master", async (t) => {
  const f = await fixture(t);
  const reply = await hello(f.server.socketPath, {
    agent: session.agentId,
    secret: master,
  });
  assert.equal(reply.ok, false);
  assert.equal(reply.code, "auth");
});

test("a derived credential cannot authenticate a changed agent, task or community", async (t) => {
  const f = await fixture(t);
  const secret = browserSessionCredential(master, session);
  for (const change of [
    { agentId: "c".repeat(64) },
    { taskId: session.taskId.slice(0, -64) + "d".repeat(64) },
    { communityOrigin: "https://another-relay.example" },
  ]) {
    const context = { ...session, ...change };
    const reply = await hello(f.server.socketPath, {
      agent: context.agentId,
      taskId: context.taskId,
      communityOrigin: context.communityOrigin,
      secret,
    });
    assert.equal(reply.ok, false);
    assert.equal(reply.code, "auth");
  }
});

for (const [label, change] of [
  ["agent", { agentId: "c".repeat(64) }],
  ["task", { taskId: session.taskId.slice(0, -64) + "d".repeat(64) }],
  ["community", { communityOrigin: "https://another-relay.example" }],
]) {
  test(`an authenticated other ${label} cannot consume this session's grant`, async (t) => {
    const f = await fixture(t);
    const owner = await f.client();
    const other = await f.client({ ...session, ...change });
    assert.deepEqual(await owner.listTools(), []);
    f.grant();
    assert.ok((await owner.listTools()).length > 0);
    assert.equal((await owner.callTool("browser_tabs", {})).ok, true);
    assert.deepEqual(await other.listTools(), []);
    assert.equal((await other.callTool("browser_tabs", {})).code, "no_grant");
  });
}

test("changing the approved task fences the old session and revocation cannot revive it", async (t) => {
  const f = await fixture(t);
  const next = {
    ...session,
    taskId: session.taskId.slice(0, -64) + "d".repeat(64),
  };
  const first = await f.client();
  const second = await f.client(next);
  const previous = f.grant();
  assert.ok((await first.listTools()).length > 0);
  const replacement = f.grant(next);
  assert.deepEqual(await first.listTools(), []);
  assert.equal((await first.callTool("browser_tabs", {})).code, "no_grant");
  assert.ok((await second.listTools()).length > 0);
  f.broker.revoke(previous.id);
  assert.ok((await second.listTools()).length > 0);
  f.broker.revoke(replacement.id);
  assert.deepEqual(await second.listTools(), []);
});

test("invalid person scope cannot revoke an existing valid grant", async (t) => {
  const f = await fixture(t);
  const owner = await f.client();
  f.grant();
  assert.ok((await owner.listTools()).length > 0);
  for (const change of [
    { agentId: "not-public-identity" },
    { taskId: "page-instructions-are-not-a-task" },
    { communityOrigin: "https://person:fixture-secret@relay.example" },
  ]) {
    assert.throws(() => f.grant({ ...session, ...change }), /Invalid browser/);
    assert.ok((await owner.listTools()).length > 0);
  }
});

test("expiry fences the matching tuple while another agent's live grant survives", async (t) => {
  let clock = 0;
  const f = await fixture(t, { now: () => clock, monotonic: () => clock });
  const otherContext = { ...session, agentId: "c".repeat(64) };
  const first = await f.client();
  const other = await f.client(otherContext);
  f.grant(session, { ttlMs: 10 });
  f.grant(otherContext, { ttlMs: 100 });
  assert.ok((await first.listTools()).length > 0);
  clock = 11;
  assert.deepEqual(await first.listTools(), []);
  assert.equal((await first.callTool("browser_tabs", {})).code, "no_grant");
  assert.ok((await other.listTools()).length > 0);
});
