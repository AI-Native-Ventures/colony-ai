import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createBrokerClient } from "./broker-client.mjs";

function fixture(options = {}) {
  const sockets = [];
  const timers = [];
  let changes = 0;
  const client = createBrokerClient({
    socketPath: "/fixture/socket",
    secret: "fixture-only",
    agent: "agent-one",
    ...options,
    connectSocket() {
      const socket = new EventEmitter();
      socket.writes = [];
      socket.destroyed = false;
      socket.setEncoding = () => {};
      socket.write = (line) => {
        if (socket.failWrite) throw new Error("fixture write failure");
        socket.writes.push(JSON.parse(line));
      };
      socket.destroy = () => {
        socket.destroyed = true;
        socket.emit("close");
      };
      sockets.push(socket);
      return socket;
    },
    onToolsChanged: () => {
      changes += 1;
    },
    setTimer(callback, delay) {
      const timer = { callback, delay, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      if (timer) timer.active = false;
    },
  });
  const hello = (socket = sockets.at(-1)) => {
    socket.emit("connect");
    socket.emit("data", '{"type":"hello","ok":true}\n');
  };
  const tick = (delay) => {
    const timer = timers.find((entry) => entry.active && entry.delay === delay);
    assert.ok(timer, `a ${delay}ms production timer exists`);
    timer.active = false;
    timer.callback();
  };
  return { client, sockets, timers, hello, tick, changes: () => changes };
}

test("start is idempotent and retired connect/data callbacks cannot authenticate a replacement", () => {
  const f = fixture();
  try {
    f.client.start();
    f.client.start();
    assert.equal(f.sockets.length, 1);
    const old = f.sockets[0];
    old.emit("error", new Error("fixture loss"));
    f.tick(500);
    assert.equal(f.sockets.length, 2);
    f.hello(old);
    assert.equal(f.client.isReady(), false);
    assert.equal(old.writes.length, 0, "retired connect must not send hello");
    f.hello();
    assert.equal(f.client.isReady(), true);
  } finally {
    f.client.close();
  }
});

test("pending request cap rejects excess work before writing it", async () => {
  const f = fixture({ maxPending: 2 });
  f.client.start();
  f.hello();
  const first = f.client.callTool("browser_tabs", {});
  const second = f.client.callTool("browser_tabs", {});
  const third = f.client.callTool("browser_tabs", {});
  try {
    assert.equal(f.sockets[0].writes.length, 3, "hello plus two requests");
  } finally {
    f.client.close();
  }
  const results = await Promise.all([first, second, third]);
  assert.equal(results[2].code, "resource_limit");
  assert.equal(results[0].code, "connection_lost");
});

test("reply byte cap fences the socket and settles pending work without replay", async () => {
  const f = fixture({ maxReplyBytes: 128 });
  f.client.start();
  f.hello();
  const pending = f.client.callTool("browser_tabs", {});
  try {
    f.sockets[0].emit("data", "é".repeat(70));
    assert.equal(f.sockets[0].destroyed, true);
    assert.equal(f.client.isReady(), false);
    assert.equal((await pending).code, "connection_lost");
    f.tick(500);
    f.hello();
    assert.equal(f.sockets[1].writes.length, 1, "only hello, no replay");
  } finally {
    f.client.close();
    await pending;
  }
});

test("silent handshake has a deadline and destroys the unauthenticated socket", () => {
  const f = fixture({ helloTimeoutMs: 40 });
  try {
    f.client.start();
    f.tick(40);
    assert.equal(f.sockets[0].destroyed, true);
    assert.equal(f.client.isReady(), false);
    f.tick(500);
    assert.equal(f.sockets.length, 2);
  } finally {
    f.client.close();
  }
});

test("reconnect budget reaches one terminal notification and cannot be restarted", () => {
  const f = fixture({ maxReconnectAttempts: 2 });
  try {
    f.client.start();
    f.sockets[0].emit("error", new Error("fixture loss"));
    f.tick(500);
    f.sockets[1].emit("error", new Error("fixture loss"));
    f.tick(1000);
    f.sockets[2].emit("error", new Error("fixture loss"));
    assert.equal(f.timers.filter((timer) => timer.active).length, 0);
    assert.equal(f.changes(), 1, "one terminal tools notification");
    f.client.start();
    assert.equal(f.sockets.length, 3);
    f.sockets[2].emit("data", '{"type":"hello","ok":true}\n');
    assert.equal(f.client.isReady(), false);
  } finally {
    f.client.close();
  }
});

test("write failure resolves the tool failure and retires its timer", async () => {
  const f = fixture();
  try {
    f.client.start();
    f.hello();
    f.sockets[0].failWrite = true;
    const result = await f.client.callTool("browser_tabs", {});
    assert.equal(result.code, "connection_lost");
    assert.equal(f.client.isReady(), false);
    assert.equal(
      f.timers.filter((timer) => timer.active && timer.delay === 90000).length,
      0,
    );
  } finally {
    f.client.close();
  }
});

test("invalid broker replies fail pending work instead of throwing from a socket callback", async () => {
  const f = fixture();
  f.client.start();
  f.hello();
  const pending = f.client.callTool("browser_tabs", {});
  try {
    assert.doesNotThrow(() => f.sockets[0].emit("data", "null\n"));
    assert.equal(f.sockets[0].destroyed, true);
    assert.equal((await pending).code, "connection_lost");
  } finally {
    f.client.close();
    await pending;
  }
});

test("a write that closes then throws cannot access a retired global socket", async () => {
  const f = fixture();
  try {
    f.client.start();
    f.hello();
    f.sockets[0].write = () => {
      f.sockets[0].destroy();
      throw new Error("fixture closed write");
    };
    assert.equal(
      (await f.client.callTool("browser_tabs", {})).code,
      "connection_lost",
    );
  } finally {
    f.client.close();
  }
});
