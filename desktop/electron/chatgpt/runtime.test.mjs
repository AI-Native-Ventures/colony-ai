import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createChatGptRuntime } from "./runtime.mjs";
import { deferred, fixture } from "./test-support.mjs";

test("disabled runtime creates no files, listener or state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-plan-boot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const userData = path.join(root, "unused-profile");
  const runtime = createChatGptRuntime(
    { userData, env: {} },
    { createRelay: () => assert.fail("disabled relay was started") },
  );
  await runtime.start();
  assert.equal(runtime.service.policy.enabled, false);
  assert.throws(() => runtime.relay, /plan_not_ready/);
  assert.throws(() => runtime.state, /plan_not_ready/);
  await runtime.close();
  await assert.rejects(stat(userData), { code: "ENOENT" });
});

test("runtime starts once with the service's private store and stops inference", async (t) => {
  const f = await fixture(t);
  const runtime = createChatGptRuntime(
    { userData: f.userData, env: f.env, store: f.store, now: f.now },
    { createService: () => f.service },
  );
  t.after(() => runtime.close());
  const starting = runtime.start();
  assert.equal(runtime.start(), starting);
  await starting;
  const accountId = await f.connect();
  const grant = await runtime.relay.grant({
    backend: "local",
    communityId: "community-a",
    agentId: "agent-a",
    accountId,
  });
  assert.equal((await runtime.state.status(accountId)).state, "ready");
  const closing = runtime.close();
  assert.equal(runtime.close(), closing);
  assert.throws(() => runtime.relay, /plan_not_ready/);
  await closing;
  await assert.rejects(fetch(`${grant.baseUrl}/responses`));
  await assert.rejects(
    f.service.authorizeInference(accountId),
    /service_stopped/,
  );
  await assert.rejects(runtime.start(), /plan_not_ready/);
});

test("shutdown fences a late listener bind and waits for its closure", async () => {
  const bound = deferred();
  const events = [];
  const relay = { close: async () => events.push("relay-close") };
  const runtime = createChatGptRuntime(
    { userData: path.resolve("unused-fixture") },
    {
      createService: () => ({
        policy: { enabled: true },
        start: async () => events.push("service-start"),
        stop: () => events.push("service-stop"),
      }),
      createRelay: () => {
        events.push("relay-bind");
        return bound.promise;
      },
    },
  );
  const starting = runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  let finished = false;
  const closing = runtime.close().then(() => {
    finished = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(events.at(-1), "service-stop");
  bound.resolve(relay);
  await Promise.all([starting, closing]);
  assert.equal(
    events.indexOf("service-stop") < events.indexOf("relay-close"),
    true,
  );
  assert.throws(() => runtime.relay, /plan_not_ready/);
});

test("startup and listener cleanup failures propagate rather than report readiness", async () => {
  let stopped = 0;
  const service = {
    policy: { enabled: true },
    start: async () => {},
    stop: () => stopped++,
  };
  const failed = createChatGptRuntime(
    { userData: path.resolve("unused-fixture") },
    {
      createService: () => service,
      createRelay: () => Promise.reject(new Error("fixture-bind-failure")),
    },
  );
  await assert.rejects(failed.start(), /fixture-bind-failure/);
  assert.equal(stopped, 1);
  assert.throws(() => failed.state, /plan_not_ready/);
  await failed.close();

  const cleanup = createChatGptRuntime(
    { userData: path.resolve("unused-fixture") },
    {
      createService: () => service,
      createRelay: async () => ({
        close: () => Promise.reject(new Error("fixture-close-failure")),
      }),
    },
  );
  await cleanup.start();
  await assert.rejects(cleanup.close(), /fixture-close-failure/);
});
