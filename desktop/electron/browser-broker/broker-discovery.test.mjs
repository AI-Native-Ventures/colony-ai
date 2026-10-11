import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createBrokerClient } from "./broker-client.mjs";
import { createMcpServer } from "./mcp-server.mjs";
import { toolDescriptors } from "./tool-definitions.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(options = {}) {
  const socket = new EventEmitter();
  const writes = [];
  const timers = new Set();
  socket.setEncoding = () => {};
  socket.destroy = () => socket.emit("close");
  socket.write = (line) => {
    const request = JSON.parse(line);
    writes.push(request);
    if (request.type === "tools") {
      queueMicrotask(() => {
        socket.emit(
          "data",
          `${JSON.stringify({ id: request.id, ok: true, tools: toolDescriptors() })}\n`,
        );
      });
    }
  };
  const client = createBrokerClient({
    socketPath: "/fixture/discovery",
    secret: "fixture-only",
    agent: "fixture-agent",
    connectSocket: () => socket,
    setTimer(callback, delay) {
      const timer = { callback, delay };
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => timers.delete(timer),
    ...options,
  });
  const output = new PassThrough();
  const frames = [];
  output.on("data", (line) => frames.push(JSON.parse(line)));
  const server = createMcpServer({ client, output });
  client.start();
  socket.emit("connect");
  return {
    client,
    server,
    frames,
    writes,
    timers,
    socket,
    hello: () => socket.emit("data", '{"type":"hello","ok":true}\n'),
    list: () =>
      server.handleLine(
        JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }),
      ),
  };
}

test("MCP tools/list waits for slow broker hello and returns all fifteen tools", async () => {
  const f = fixture();
  try {
    const listing = f.list();
    await flush();
    assert.deepEqual(
      f.frames,
      [],
      "connecting must not become an authoritative empty list",
    );
    assert.deepEqual(
      f.writes.map((r) => r.type),
      ["hello"],
    );
    assert.equal(
      (await f.client.callTool("browser_click", {})).code,
      "no_grant",
    );
    f.hello();
    await listing;
    assert.equal(f.frames[0].result.tools.length, 15);
    assert.deepEqual(
      f.frames[0].result.tools.map((t) => t.name),
      toolDescriptors().map((t) => t.name),
    );
    assert.equal(f.timers.size, 0, "hello and discovery deadlines are retired");
  } finally {
    f.client.close();
  }
});

test("MCP discovery has a bounded hello deadline and returns an error, never an empty list", async () => {
  const f = fixture();
  try {
    const listing = f.list();
    await flush();
    const deadlines = [...f.timers].filter((t) => t.delay === 5000);
    assert.equal(
      deadlines.length,
      2,
      "socket and discovery each have a five-second bound",
    );
    for (const deadline of deadlines) deadline.callback();
    await listing;
    assert.equal(f.frames[0].error.code, -32603);
    assert.equal(f.frames[0].result, undefined);
  } finally {
    f.client.close();
  }
});

test("closing during hello settles discovery and cleans its timers", async () => {
  const f = fixture();
  const listing = f.client.listTools();
  const rejected = assert.rejects(listing, /channel closed/u);
  f.client.close();
  await rejected;
  assert.equal(f.timers.size, 0);
});

test("hello discovery waiters obey the pending-request resource cap", async () => {
  const f = fixture({ maxPending: 2 });
  try {
    const first = assert.rejects(f.client.listTools(), /channel closed/u);
    const second = assert.rejects(f.client.listTools(), /channel closed/u);
    await assert.rejects(f.client.listTools(), /resource limit/u);
    f.client.close();
    await Promise.all([first, second]);
    assert.equal(f.timers.size, 0);
  } finally {
    f.client.close();
  }
});

test("a failed authenticated tools reply propagates instead of publishing empty discovery", async () => {
  const f = fixture();
  try {
    f.hello();
    f.socket.write = (line) => {
      const request = JSON.parse(line);
      queueMicrotask(() =>
        f.socket.emit(
          "data",
          `${JSON.stringify({ id: request.id, ok: false, code: "connection_lost" })}\n`,
        ),
      );
    };
    await f.list();
    assert.equal(f.frames[0].error.code, -32603);
    assert.equal(f.frames[0].result, undefined);
  } finally {
    f.client.close();
  }
});
