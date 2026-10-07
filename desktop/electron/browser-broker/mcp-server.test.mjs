import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createBroker } from "./broker-core.mjs";
import { createBrokerServer } from "./broker-server.mjs";
import { createCapabilityStore } from "./capability.mjs";
import { createFakePageDriver, until } from "./fake-page-driver.test.mjs";
import { createMcpServer, main, toMcpResult } from "./mcp-server.mjs";
import { toolDescriptors } from "./tool-definitions.mjs";

const SERVER_FILE = fileURLToPath(new URL("./mcp-server.mjs", import.meta.url));

function harness({ tools = [], callResult = { ok: true, tab: "t1" } } = {}) {
  const output = new PassThrough();
  const frames = [];
  let buffer = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      frames.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  const state = { tools, callResult, calls: [] };
  const client = {
    listTools: async () => state.tools,
    callTool: async (name, args) => {
      state.calls.push({ name, args });
      return state.callResult;
    },
  };
  const server = createMcpServer({ client, output });
  const send = async (message) => {
    await server.handleLine(
      typeof message === "string" ? message : JSON.stringify(message),
    );
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { server, send, frames, state };
}

const initialize = (version = "2025-06-18") => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
});

test("initialize negotiates a supported version and advertises listChanged tools", async () => {
  const { send, frames } = harness();
  await send(initialize("2025-03-26"));
  assert.equal(frames[0].result.protocolVersion, "2025-03-26");
  assert.deepEqual(frames[0].result.capabilities, {
    tools: { listChanged: true },
  });
  assert.equal(frames[0].result.serverInfo.name, "colony-browser");
  assert.ok(/untrusted/u.test(frames[0].result.instructions));
  await send(initialize("1999-01-01"));
  assert.equal(frames[1].result.protocolVersion, "2025-11-25");
});

test("tools/list is empty without a grant and lists tools with one", async () => {
  const env = harness();
  await env.send(initialize());
  await env.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(env.frames[1].result.tools, []);
  env.state.tools = toolDescriptors();
  await env.send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.equal(env.frames[2].result.tools.length, toolDescriptors().length);
  assert.ok(
    env.frames[2].result.tools.every(
      (tool) => tool.name && tool.inputSchema && tool.description,
    ),
  );
});

test("list_changed is sent only after the client says it is initialized", async () => {
  const env = harness();
  env.server.notifyToolsChanged();
  await env.send(initialize());
  env.server.notifyToolsChanged();
  assert.equal(
    env.frames.filter((f) => f.method === "notifications/tools/list_changed")
      .length,
    0,
  );
  await env.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  env.server.notifyToolsChanged();
  const notice = env.frames.at(-1);
  assert.equal(notice.method, "notifications/tools/list_changed");
  assert.equal("id" in notice, false);
});

test("tools/call forwards the name and arguments and maps results", async () => {
  const env = harness({ callResult: { ok: true, tab: "t1", clicked: "e4" } });
  await env.send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "browser_click", arguments: { tab: "t1", ref: "e4" } },
  });
  assert.deepEqual(env.state.calls, [
    { name: "browser_click", args: { tab: "t1", ref: "e4" } },
  ]);
  const result = env.frames[0].result;
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    tab: "t1",
    clicked: "e4",
  });
});

test("failures become isError results with a code and no internals", async () => {
  const env = harness({
    callResult: {
      ok: false,
      code: "origin_approval_required",
      message: "The person must approve this site first.",
      origin: "https://x.example",
    },
  });
  await env.send({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "browser_navigate",
      arguments: { tab: "t1", url: "https://x.example" },
    },
  });
  const result = env.frames[0].result;
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    code: "origin_approval_required",
    message: "The person must approve this site first.",
    origin: "https://x.example",
  });
  assert.deepEqual(toMcpResult(undefined).isError, true);
  assert.equal(
    JSON.parse(toMcpResult({ ok: false }).content[0].text).code,
    "driver_error",
  );
});

test("snapshots, text reads and screenshots map to the right content blocks", () => {
  const snapshot = toMcpResult({
    ok: true,
    tab: "t1",
    snapshot: "<untrusted-page-content>x</untrusted-page-content>",
    generation: 2,
  });
  assert.equal(snapshot.content.length, 2);
  assert.deepEqual(JSON.parse(snapshot.content[0].text), {
    tab: "t1",
    generation: 2,
  });
  assert.equal(
    snapshot.content[1].text,
    "<untrusted-page-content>x</untrusted-page-content>",
  );
  const read = toMcpResult({
    ok: true,
    tab: "t1",
    text: "wrapped",
    truncated: false,
  });
  assert.equal(read.content[1].text, "wrapped");
  const shot = toMcpResult({
    ok: true,
    tab: "t1",
    mimeType: "image/png",
    data: "QUJD",
    bytes: 3,
  });
  assert.deepEqual(shot.content[1], {
    type: "image",
    data: "QUJD",
    mimeType: "image/png",
  });
  assert.ok(!shot.content[0].text.includes("QUJD"));
});

test("protocol errors use the JSON-RPC codes and notifications are never answered", async () => {
  const env = harness();
  await env.send("{not json");
  assert.equal(env.frames[0].error.code, -32700);
  await env.send("[]");
  assert.equal(env.frames[1].error.code, -32600);
  await env.send({ jsonrpc: "2.0", id: 9, method: "resources/list" });
  assert.equal(env.frames[2].error.code, -32601);
  assert.equal(env.frames[2].id, 9);
  await env.send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: {} });
  assert.equal(env.frames[3].error.code, -32602);
  await env.send({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: { name: "x", arguments: [] },
  });
  assert.equal(env.frames[4].error.code, -32602);
  const count = env.frames.length;
  await env.send({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: {},
  });
  await env.send({ jsonrpc: "2.0", method: "unknown/notification" });
  await env.send("");
  assert.equal(env.frames.length, count);
  await env.send({ jsonrpc: "2.0", id: 12, method: "ping" });
  assert.deepEqual(env.frames.at(-1).result, {});
});

test("an internal failure is reported without its message", async () => {
  const output = new PassThrough();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(String(chunk)));
  const server = createMcpServer({
    client: {
      listTools: async () => {
        throw new Error("secret internal detail /Users/x");
      },
      callTool: async () => ({}),
    },
    output,
  });
  await server.handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  );
  const reply = JSON.parse(chunks.join(""));
  assert.equal(reply.error.code, -32603);
  assert.ok(!JSON.stringify(reply).includes("secret internal"));
});

test("end to end over a real socket and a real child process", {
  timeout: 30_000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-"));
  const socketPath = path.join(dir, "sock", "b.sock");
  const secret = "e".repeat(32);
  const capabilities = createCapabilityStore();
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
      text: "x",
      elements: [
        { backend: 11, role: "button", name: "Add to cart", extra: {} },
      ],
    },
  });
  const server = createBrokerServer({
    broker,
    capabilities,
    secret,
    socketPath,
  });
  await server.start();
  const child = spawn(process.execPath, [SERVER_FILE], {
    env: {
      PATH: process.env.PATH,
      COLONY_BROWSER_BROKER_SOCKET: socketPath,
      COLONY_BROWSER_BROKER_SECRET: secret,
      COLONY_BROWSER_AGENT_ID: "agent-a",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const frames = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      frames.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    send(initialize());
    await until(() => frames.find((f) => f.id === 1), 10_000);
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    await until(() => server.connectionCount() === 1, 10_000);
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(
      (await until(() => frames.find((f) => f.id === 2))).result.tools,
      [],
    );

    server.issueGrant({
      agentId: "agent-a",
      taskId: "t",
      businessId: "biz-1",
      tabId: "tab-1",
      allowedOrigins: ["https://shop.example"],
    });
    await until(
      () => frames.find((f) => f.method === "notifications/tools/list_changed"),
      10_000,
    );
    send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const listed = await until(() => frames.find((f) => f.id === 3));
    assert.equal(listed.result.tools.length, toolDescriptors().length);
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "browser_snapshot", arguments: { tab: "tab-1" } },
    });
    const snap = await until(() => frames.find((f) => f.id === 4));
    assert.equal(snap.result.isError, undefined);
    assert.ok(
      snap.result.content.some((block) => block.text.includes("Add to cart")),
    );
    send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "browser_navigate",
        arguments: { tab: "tab-1", url: "file:///etc/passwd" },
      },
    });
    const denied = await until(() => frames.find((f) => f.id === 5));
    assert.equal(denied.result.isError, true);
    assert.equal(
      JSON.parse(denied.result.content[0].text).code,
      "scheme_denied",
    );
    assert.equal(stderr.join(""), "");
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("without broker environment the server still starts and offers no tools", {
  timeout: 15_000,
}, async () => {
  const child = spawn(process.execPath, [SERVER_FILE], {
    env: { PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const frames = [];
  child.stdout.setEncoding("utf8");
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (const line of buffer.split("\n").slice(0, -1))
      frames.push(JSON.parse(line));
    buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
  });
  child.stdin.write(`${JSON.stringify(initialize())}\n`);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
  );
  const listed = await until(() => frames.find((f) => f.id === 2), 10_000);
  assert.deepEqual(listed.result.tools, []);
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
});

function streamHarness(options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const writes = [];
  output.on("data", (chunk) => writes.push(chunk.toString()));
  const exits = [];
  const resolvers = [];
  const calls = [];
  let closes = 0;
  const client = {
    start() {},
    close() {
      closes += 1;
    },
    listTools: async () => [],
    callTool(name, args) {
      calls.push({ name, args });
      return new Promise((resolve) => resolvers.push(resolve));
    },
  };
  const runtime = main({
    env: {},
    input,
    output,
    createClient: () => client,
    exit: (code) => exits.push(code),
    ...options,
  });
  return {
    input,
    calls,
    writes,
    exits,
    resolvers,
    closes: () => closes,
    stop() {
      runtime.stop?.();
      runtime.client.close();
      // The pre-fix entrypoint owns an EOF process.exit listener, so do not
      // send EOF while proving the baseline failure inside this test runner.
      input.removeAllListeners();
      input.pause();
    },
  };
}

test("production stdio entrypoint caps concurrent requests and fences late output", async () => {
  const h = streamHarness({ maxPending: 2 });
  try {
    h.input.write(
      [1, 2, 3]
        .map((id) =>
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: { name: "browser_tabs", arguments: {} },
          }),
        )
        .join("\n") + "\n",
    );
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.exits, [1]);
    assert.equal(h.closes(), 1);
    for (const resolve of h.resolvers) resolve({ ok: true, tabs: [] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.writes, [], "retired results never reach stdout");
  } finally {
    h.stop();
  }
});

test("production stdio entrypoint counts unfinished frames in UTF8 bytes", () => {
  const h = streamHarness({ maxFrame: 128 });
  try {
    h.input.write("é".repeat(70));
    assert.deepEqual(h.exits, [1]);
    assert.equal(h.closes(), 1);
    assert.equal(h.calls.length, 0);
    h.input.write("more invalid input\n");
    assert.deepEqual(h.exits, [1], "termination is idempotent");
  } finally {
    h.stop();
  }
});

test("production stdio entrypoint bounds output before queuing a large reply", async () => {
  const h = streamHarness({ maxQueuedOutputBytes: 64 });
  try {
    h.input.write(`${JSON.stringify(initialize())}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.exits, [1]);
    assert.deepEqual(h.writes, []);
    assert.equal(h.closes(), 1);
  } finally {
    h.stop();
  }
});
