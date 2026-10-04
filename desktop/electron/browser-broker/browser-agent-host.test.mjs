import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBrokerClient } from "./broker-client.mjs";
import { createBrowserAgentHost } from "./browser-agent-host.mjs";
import { createFakePageDriver, until } from "./fake-page-driver.test.mjs";

function tmpSocket() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bah-"));
  return { dir, socketPath: path.join(dir, "s", "b.sock") };
}

test("disabled host creates nothing and refuses every request", async () => {
  const host = await createBrowserAgentHost({ enabled: false });
  assert.equal(host.enabled, false);
  assert.deepEqual(host.env, {});
  await assert.rejects(host.handleRequest("agent-grant", {}), /not enabled/u);
  await host.stop();
  const off = await createBrowserAgentHost();
  assert.deepEqual(off.env, {});
});

test("an enabled host requires a driver", async () => {
  await assert.rejects(createBrowserAgentHost({ enabled: true }), /driver/u);
});

test("enabled host exports exactly the environment buzz-acp expects", async () => {
  const { dir, socketPath } = tmpSocket();
  const driver = createFakePageDriver();
  const host = await createBrowserAgentHost({
    enabled: true,
    driver,
    execPath: "/Applications/Colony.app/Contents/MacOS/Colony",
    scriptPath: "/x/mcp-server.mjs",
    socketPath,
    secret: "k".repeat(32),
  });
  assert.deepEqual(Object.keys(host.env).sort(), [
    "COLONY_BROWSER_BROKER_SECRET",
    "COLONY_BROWSER_BROKER_SOCKET",
    "COLONY_BROWSER_MCP_COMMAND",
    "COLONY_BROWSER_MCP_RUN_AS_NODE",
    "COLONY_BROWSER_MCP_SCRIPT",
  ]);
  assert.equal(host.env.COLONY_BROWSER_MCP_RUN_AS_NODE, "1");
  assert.equal(host.env.COLONY_BROWSER_BROKER_SOCKET, socketPath);
  await host.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the person facing API creates, widens, confirms and revokes grants", async () => {
  const { dir, socketPath } = tmpSocket();
  const driver = createFakePageDriver();
  driver.addTab({
    id: "tab-1",
    url: "https://shop.example/cart",
    title: "Cart",
    controlOwner: "human",
    page: {
      text: "x",
      elements: [{ backend: 12, role: "button", name: "Pay now", extra: {} }],
    },
  });
  const secret = "k".repeat(32);
  const host = await createBrowserAgentHost({
    enabled: true,
    driver,
    execPath: "/bin/node",
    scriptPath: "/x/mcp.mjs",
    socketPath,
    secret,
    chooseFile: async () => ({
      path: "/Users/me/a.pdf",
      name: "a.pdf",
      size: 5,
    }),
  });
  const events = [];
  host.onEvent((event) => events.push(event));
  const client = createBrokerClient({ socketPath, secret, agent: "agent-a" });
  client.start();
  await until(() => client.isReady());
  assert.deepEqual(await client.listTools(), []);

  const grant = await host.handleRequest("agent-grant", {
    agentId: "agent-a",
    taskId: "task-1",
    businessId: "biz-1",
    tabId: "tab-1",
    allowedOrigins: ["https://shop.example"],
  });
  assert.ok(!JSON.stringify(grant).toLowerCase().includes("token"));
  assert.equal(driver.tabs.get("tab-1").controlOwner, "agent");
  await until(async () => (await client.listTools()).length > 0);

  const result = await client.callTool("browser_snapshot", { tab: "tab-1" });
  assert.equal(result.ok, true);
  const ref = /\[ref=(e\d+)\]/u.exec(result.snapshot)[1];

  const pendingClick = client.callTool("browser_click", { tab: "tab-1", ref });
  const request = await until(() =>
    events.find((event) => event.type === "confirmation-requested"),
  );
  assert.equal((await host.handleRequest("agent-pending", {})).length, 1);
  assert.deepEqual(
    await host.handleRequest("agent-confirm", { actionId: request.actionId }),
    { resolved: true },
  );
  assert.equal((await pendingClick).ok, true);

  const widened = await host.handleRequest("agent-approve-origin", {
    grantId: grant.id,
    url: "https://pay.example/checkout",
  });
  assert.ok(widened.allowedOrigins.includes("https://pay.example"));
  await assert.rejects(
    host.handleRequest("agent-approve-origin", {
      grantId: grant.id,
      url: "http://127.0.0.1:9",
    }),
  );

  const upload = await host.handleRequest("agent-choose-upload", {
    grantId: grant.id,
  });
  assert.deepEqual([upload.name, upload.size], ["a.pdf", 5]);
  assert.ok(upload.uploadId.startsWith("u-"));
  assert.ok(!JSON.stringify(upload).includes("/Users/me"));

  const log = await host.handleRequest("agent-log", { grantId: grant.id });
  assert.ok(log.length >= 2);
  assert.ok(!JSON.stringify(log).includes("/Users/me"));

  assert.deepEqual(
    await host.handleRequest("agent-revoke", { grantId: grant.id }),
    { revoked: true },
  );
  await until(async () => (await client.listTools()).length === 0);
  assert.equal(driver.tabs.get("tab-1").controlOwner, "human");
  client.close();
  await host.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("invalid requests are rejected before reaching the broker", async () => {
  const { dir, socketPath } = tmpSocket();
  const host = await createBrowserAgentHost({
    enabled: true,
    driver: createFakePageDriver(),
    execPath: "/bin/node",
    scriptPath: "/x/mcp.mjs",
    socketPath,
    secret: "k".repeat(32),
  });
  for (const [action, payload] of [
    ["agent-grant", {}],
    [
      "agent-grant",
      {
        agentId: "a",
        taskId: "t",
        businessId: "b",
        tabId: "x",
        allowedOrigins: ["file:///etc"],
      },
    ],
    ["agent-revoke", {}],
    ["agent-confirm", { actionId: 5 }],
    ["agent-approve-origin", { grantId: "g" }],
    ["agent-evaluate", {}],
    [5, {}],
    ["agent-grant", []],
  ]) {
    await assert.rejects(
      host.handleRequest(action, payload),
      Error,
      String(action),
    );
  }
  assert.deepEqual(
    await host
      .handleRequest("agent-choose-upload", { grantId: "g" })
      .catch(() => "rejected"),
    "rejected",
  );
  await host.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("stopping the host revokes every grant and closes the channel", async () => {
  const { dir, socketPath } = tmpSocket();
  const driver = createFakePageDriver();
  driver.addTab({
    id: "tab-1",
    url: "https://shop.example/",
    controlOwner: "human",
  });
  const host = await createBrowserAgentHost({
    enabled: true,
    driver,
    execPath: "/bin/node",
    scriptPath: "/x/mcp.mjs",
    socketPath,
    secret: "k".repeat(32),
  });
  const grant = await host.handleRequest("agent-grant", {
    agentId: "agent-a",
    taskId: "t",
    businessId: "biz-1",
    tabId: "tab-1",
    allowedOrigins: ["https://shop.example"],
  });
  await host.stop();
  assert.equal(host.capabilities.getGrant(grant.id).state, "revoked");
  assert.equal(fs.existsSync(socketPath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
