import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { NativeHost, nativeRequestTimeout } from "./native-host.mjs";
import { RendererHost } from "./renderer-host.mjs";

test("long native commands receive a longer deadline", () => {
  assert.equal(
    nativeRequestTimeout("invoke", "save_onboarding_memories", 60_000),
    300_000,
  );
  assert.equal(
    nativeRequestTimeout("invoke", "install_acp_runtime", 60_000),
    720_000,
  );
  assert.equal(nativeRequestTimeout("invoke", "sign_out", 60_000), 60_000);
  assert.equal(
    nativeRequestTimeout("invoke", "google_desktop_sign_in", 60_000),
    210_000,
  );
  assert.equal(
    nativeRequestTimeout("invoke", "google_desktop_sign_in", 120_000),
    210_000,
  );
  assert.equal(
    nativeRequestTimeout("invoke", "google_desktop_sign_in", 240_000),
    240_000,
  );
  assert.equal(
    nativeRequestTimeout("emit", "save_onboarding_memories", 60_000),
    60_000,
  );
});
function fixture(t, options = {}) {
  const child = new EventEmitter();
  const requests = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      requests.push(JSON.parse(chunk));
      done();
    },
  });
  child.kill = () => {
    queueMicrotask(() => child.emit("exit"));
    return true;
  };
  const host = new NativeHost("test", {
    spawnProcess: () => child,
    timeout: 1000,
    ...options,
  });
  const send = (message) =>
    child.stdout.write(`@colony-native:${JSON.stringify(message)}\n`);
  t.after(() => host.fail("Test cleanup"));
  send({ type: "ready", version: 1 });
  return { host, child, requests, send };
}
test("out of order responses retain native error values", async (t) => {
  const { host, requests, send } = fixture(t);
  const first = host.request("invoke", { command: "a" });
  const second = host.request("invoke", { command: "b" });
  await new Promise((resolve) => setImmediate(resolve));
  send({
    type: "response",
    id: requests[1].id,
    error: "relay rate-limited: retry",
  });
  send({ type: "response", id: requests[0].id, result: { ok: true } });
  await assert.rejects(second, (e) => e === "relay rate-limited: retry");
  assert.deepEqual(await first, { ok: true });
  assert.equal(host.pending.size, 0);
});
test("Google OAuth can finish after Electron's ordinary deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { host, requests, send } = fixture(t);
  const pending = host.request("invoke", {
    command: "google_desktop_sign_in",
    args: { clientId: "generated-test-client" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(120_001);
  assert.equal(host.pending.size, 1);
  send({
    type: "response",
    id: requests[0].id,
    result: "generated-fixture-id-token",
  });
  assert.equal(await pending, "generated-fixture-id-token");
  assert.equal(host.pending.size, 0);
});
test("fragmented frames and legacy diagnostics do not lose pushes", (t) => {
  const { host, child } = fixture(t);
  const events = [];
  host.on("event", (e) => events.push(e));
  child.stdout.write("legacy diagnostic\n@colony-na");
  child.stdout.write('tive:{"type":"event","id":3,"payload":false}\n');
  assert.deepEqual(events, [{ type: "event", id: 3, payload: false }]);
});
test("host exit rejects pending and future commands", async (t) => {
  const { host, child } = fixture(t);
  const pending = host.request("invoke", { command: "a" });
  await new Promise((resolve) => setImmediate(resolve));
  child.emit("exit");
  await assert.rejects(pending, /exited/);
  await assert.rejects(host.request("invoke"), /disconnected/);
  assert.equal(host.pending.size, 0);
});
test("malformed frames fail closed without echoing their contents", (t) => {
  const { host, child } = fixture(t);
  let reason;
  host.on("disconnected", (s) => (reason = s));
  child.stdout.write("@colony-native:null\n");
  assert.equal(reason, "Malformed native response");
});

test("shutdown kills a resistant owned child and waits for exit", async () => {
  const child = new EventEmitter();
  const signals = [];
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") setImmediate(() => child.emit("exit"));
    return true;
  };
  const host = new NativeHost("fixture", {
    spawnProcess: () => child,
    shutdownGrace: 5,
    timeout: 1000,
  });
  child.stdout.write('@colony-native:{"type":"ready","version":1}\n');
  await host.ready;
  await host.close();
  assert.equal(host.childExited, true);
  assert.deepEqual(signals, ["SIGKILL"]);
});

test("installation response survives the ordinary RPC deadline", async (t) => {
  const { host, requests, send } = fixture(t);
  host.timeout = 5;
  const install = host
    .request("invoke", {
      command: "install_acp_runtime",
      args: { runtimeId: "codex" },
    })
    .then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
  const ordinary = host.request("invoke", { command: "get_config" });
  await assert.rejects(ordinary, /timed out/);
  const request = requests.find(
    (frame) => frame.command === "install_acp_runtime",
  );
  assert.equal(host.pending.has(request.id), true);
  send({ type: "response", id: request.id, result: { success: true } });
  assert.deepEqual(await install, { value: { success: true } });
});

test("private launch replies never become renderer events and can finish out of order", async (t) => {
  const completions = [];
  const { host, requests, send } = fixture(t, {
    onPrivateRequest: (name, payload, signal) =>
      new Promise((resolve) => {
        assert.equal(name, "chatgpt_plan_prepare");
        assert.equal(signal.aborted, false);
        completions.push(() =>
          resolve({ key: `local-capability-${payload.agentId}` }),
        );
      }),
  });
  for (const type of ["event", "channel", "private_request"])
    host.on(type, () => assert.fail("private request became an event"));
  send({
    type: "private_request",
    id: 1,
    name: "chatgpt_plan_prepare",
    payload: { agentId: "a" },
  });
  send({
    type: "private_request",
    id: 2,
    name: "chatgpt_plan_prepare",
    payload: { agentId: "b" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  completions[1]();
  completions[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [
    { type: "private_response", id: 2, result: { key: "local-capability-b" } },
    { type: "private_response", id: 1, result: { key: "local-capability-a" } },
  ]);
  assert.equal(host.privatePending.size, 0);
});

test("renderer cannot forge a parent response or request a private launch", async (t) => {
  const { host, requests } = fixture(t, {
    onPrivateRequest: () => assert.fail("renderer invoked private handler"),
  });
  const renderer = new RendererHost(host);
  for (const type of ["private_request", "private_response"])
    await assert.rejects(
      renderer.request(type, {
        id: 1,
        name: "chatgpt_plan_prepare",
        payload: {},
      }),
      /Unsupported native renderer request/,
    );
  assert.deepEqual(requests, []);
});

test("private failures hide exception text and reject duplicate ids", async (t) => {
  const { host, requests, send } = fixture(t, {
    onPrivateRequest: () => {
      throw new Error("secret-fixture-value");
    },
  });
  const frame = {
    type: "private_request",
    id: 1,
    name: "chatgpt_plan_prepare",
    payload: {},
  };
  send(frame);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [
    { type: "private_response", id: 1, error: "private_request_failed" },
  ]);
  send(frame);
  assert.equal(host.ended, true);
  assert.equal(host.disconnectReason, "Invalid private native request");
});

test("private deadlines abort and retain bounded slots until handlers retire", async (t) => {
  const handlers = [];
  const { host, requests, send } = fixture(t, {
    privateTimeout: 5,
    onPrivateRequest: (_name, _payload, signal) =>
      new Promise((resolve) => handlers.push({ resolve, signal })),
  });
  for (let id = 1; id <= 17; id++)
    send({
      type: "private_request",
      id,
      name: "chatgpt_plan_prepare",
      payload: {},
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(handlers.length, 16);
  assert.equal(host.privatePending.size, 16);
  assert.equal(
    handlers.every(({ signal }) => signal.aborted),
    true,
  );
  assert.equal(
    requests.filter((r) => r.error === "private_request_timeout").length,
    16,
  );
  assert.equal(
    requests.find((r) => r.id === 17).error,
    "private_request_unavailable",
  );
  for (const handler of handlers) handler.resolve({ key: "late-capability" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(host.privatePending.size, 0);
  assert.equal(
    requests.some((r) => r.result),
    false,
  );
});

test("host disconnect aborts private work and suppresses late replies", async (t) => {
  let complete;
  let signal;
  const { host, requests, send } = fixture(t, {
    onPrivateRequest: (_name, _payload, abort) =>
      new Promise((resolve) => {
        signal = abort;
        complete = resolve;
      }),
  });
  send({
    type: "private_request",
    id: 1,
    name: "chatgpt_plan_prepare",
    payload: {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  host.fail("fixture disconnect");
  assert.equal(signal.aborted, true);
  complete({ key: "late-capability" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, []);
});

test("private request and response frames have a smaller strict bound", async (t) => {
  const { host, send, requests } = fixture(t, {
    onPrivateRequest: () => ({ value: "x".repeat(64 * 1024) }),
  });
  send({
    type: "private_request",
    id: 1,
    name: "chatgpt_plan_prepare",
    payload: {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests[0].error, "private_result_invalid");
  send({
    type: "private_request",
    id: 2,
    name: "chatgpt_plan_prepare",
    payload: { value: "x".repeat(64 * 1024) },
  });
  assert.equal(host.ended, true);
});
