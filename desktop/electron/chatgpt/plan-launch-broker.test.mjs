import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPlanLaunchBroker } from "./plan-launch-broker.mjs";
import { createChatGptRuntime } from "./runtime.mjs";
import { deferred, fixture } from "./test-support.mjs";

const files = {
  adapterVersion: "2.1.1",
  codexVersion: "0.159.1",
  adapterPath: path.resolve("fake-bundle/codex-acp"),
  codexPath: path.resolve("fake-bundle/codex"),
};

async function setup(t, overrides = {}) {
  const f = await fixture(t);
  const runtime = createChatGptRuntime(
    { userData: f.userData, env: f.env, store: f.store, now: f.now },
    { createService: () => f.service },
  );
  await runtime.start();
  const accountId = await f.connect();
  const scheduled = [];
  const broker = createPlanLaunchBroker({
    runtime,
    userData: f.userData,
    appVersion: "1.0.5",
    resolveRuntime: async () => files,
    timers: {
      set(callback, ms) {
        const timer = { callback, ms };
        scheduled.push(timer);
        return timer;
      },
      clear(timer) {
        if (timer) timer.cleared = true;
      },
    },
    ...overrides,
  });
  t.after(async () => {
    broker.close();
    await runtime.close();
  });
  const scope = {
    communityId: "community-a",
    agentId: "agent-a",
    accountId,
    generation: "a".repeat(32),
  };
  const prepare = (extra = {}, signal) =>
    broker.request(
      "plan_prepare",
      { ...scope, backend: "local", model: "fake-model", ...extra },
      signal,
    );
  const receiptScope = (receipt, extra = {}) => ({
    ...scope,
    leaseId: receipt.leaseId,
    ...extra,
  });
  const request = (receipt) => {
    const config = JSON.parse(receipt.env.CODEX_CONFIG);
    return fetch(
      `${config.model_providers.colony_chatgpt_plan.base_url}/responses`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${receipt.env.COLONY_CHATGPT_RELAY_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "fake-model",
          store: false,
          stream: true,
          input: [{ role: "user", content: "hello" }],
        }),
      },
    );
  };
  return {
    f,
    runtime,
    broker,
    scope,
    scheduled,
    prepare,
    receiptScope,
    request,
  };
}

test("receipt uses main attribution and contains no OAuth credential", async (t) => {
  const s = await setup(t);
  const receipt = await s.prepare();
  assert.equal(receipt.adapterPath, files.adapterPath);
  assert.equal(receipt.env.CODEX_PATH, files.codexPath);
  assert.equal(receipt.env.MODEL_PROVIDER, "colony_chatgpt_plan");
  assert.deepEqual(receipt.clientInfo, {
    name: "Colony",
    title: "Colony",
    version: "1.0.5",
  });
  const account = (await s.f.read()).accounts[0];
  for (const token of [
    account.access_token,
    account.refresh_token,
    account.id_token,
  ])
    assert.equal(JSON.stringify(receipt).includes(token), false);
  const response = await s.request(receipt);
  assert.equal(response.status, 200);
  await response.text();
  assert.deepEqual(
    await s.broker.request("plan_commit", s.receiptScope(receipt)),
    { committed: true },
  );
  assert.equal(s.scheduled.at(-1).cleared, true);
  assert.deepEqual(
    await s.broker.request("plan_release", s.receiptScope(receipt)),
    { released: true },
  );
  assert.equal((await s.request(receipt)).status, 403);
  assert.deepEqual(
    await s.broker.request("plan_release", s.receiptScope(receipt)),
    { released: false },
  );
});

test("unacknowledged receipt expires and cannot be committed", async (t) => {
  const s = await setup(t);
  const receipt = await s.prepare();
  const expiry = s.scheduled.at(-1);
  assert.equal(expiry.ms, 30_000);
  expiry.callback();
  await assert.rejects(
    s.broker.request("plan_commit", s.receiptScope(receipt)),
    /plan_receipt_expired/,
  );
  assert.equal((await s.request(receipt)).status, 403);
});

test("a retired generation cannot revoke its replacement", async (t) => {
  const s = await setup(t);
  const first = await s.prepare();
  await s.broker.request("plan_commit", s.receiptScope(first));
  const generation = "b".repeat(32);
  const second = await s.prepare({ generation });
  assert.equal((await s.request(first)).status, 403);
  assert.deepEqual(
    await s.broker.request("plan_release", s.receiptScope(first)),
    { released: false },
  );
  await assert.rejects(
    s.broker.request("plan_commit", s.receiptScope(second)),
    /plan_receipt_expired/,
  );
  await s.broker.request("plan_commit", s.receiptScope(second, { generation }));
  const response = await s.request(second);
  assert.equal(response.status, 200);
  await response.text();
});

test("cancelled prepare and shutdown fence delayed runtime resolution", async (t) => {
  const pending = deferred();
  const s = await setup(t, { resolveRuntime: () => pending.promise });
  const controller = new AbortController();
  const preparing = s.prepare({}, controller.signal);
  const rejected = assert.rejects(preparing, /plan_launch_cancelled/);
  controller.abort();
  pending.resolve(files);
  await rejected;
  assert.equal(s.f.fake.counters.responses ?? 0, 0);
  assert.equal(s.scheduled[0].cleared, true);
  s.broker.close();
  await assert.rejects(s.prepare(), /feature_disabled/);
});

test("late grant after cancellation is revoked even after its receipt is removed", async (t) => {
  const s = await setup(t);
  const pending = deferred();
  const started = deferred();
  const grant = s.runtime.relay.grant.bind(s.runtime.relay);
  let captured;
  let grants = 0;
  s.runtime.relay.grant = async (scope) => {
    const value = await grant(scope);
    if (++grants === 1) {
      captured = value;
      started.resolve();
      await pending.promise;
    }
    return value;
  };
  t.after(() => pending.resolve());
  const controller = new AbortController();
  const preparing = s.prepare({}, controller.signal);
  const rejected = assert.rejects(preparing, /plan_launch_cancelled/);
  await started.promise;
  controller.abort();
  await assert.rejects(
    s.prepare({ generation: "b".repeat(32) }),
    /plan_launch_busy/,
  );
  pending.resolve();
  await rejected;
  const denied = await s.request({
    env: {
      CODEX_CONFIG: JSON.stringify({
        model_providers: {
          colony_chatgpt_plan: { base_url: captured.baseUrl },
        },
      }),
      COLONY_CHATGPT_RELAY_KEY: captured.key,
    },
  });
  assert.equal(denied.status, 403);
  const next = await s.prepare({ generation: "b".repeat(32) });
  const startup = await readFile(
    path.join(next.env.CODEX_HOME, "config.toml"),
    "utf8",
  );
  const baseUrl = JSON.parse(next.env.CODEX_CONFIG).model_providers
    .colony_chatgpt_plan.base_url;
  assert.equal(startup.includes(baseUrl), true);
  assert.equal(startup.includes(captured.baseUrl), false);
});

test("invalid or ambient launch overrides and remote backend are refused", async (t) => {
  const s = await setup(t);
  for (const extra of [
    { env: { ACCESS_TOKEN: "fake-token" } },
    { codexPath: files.codexPath },
    { appVersion: "owner-supplied" },
    { accountId: "unknown" },
    { generation: "bad" },
  ])
    await assert.rejects(s.prepare(extra), /invalid_plan_launch/);
  await assert.rejects(
    s.prepare({ backend: "remote" }),
    /remote_plan_disallowed/,
  );
  await assert.rejects(
    s.prepare({ model: "hidden-model" }),
    /model_not_entitled/,
  );
  await assert.rejects(
    s.broker.request("renderer_event", {}),
    /invalid_plan_operation/,
  );
  const receipt = await s.prepare();
  await assert.rejects(s.prepare(), /duplicate_plan_generation/);
  s.broker.close();
  assert.equal((await s.request(receipt)).status, 403);
});

test("wrong runtime versions fail before any plan grant", async (t) => {
  const s = await setup(t, {
    resolveRuntime: async () => ({ ...files, codexVersion: "0.159.2" }),
  });
  s.runtime.relay.grant = () => assert.fail("wrong runtime obtained a grant");
  await assert.rejects(s.prepare(), /plan_runtime_unavailable/);
});

test("account retirement invalidates receipts before the same account reconnects", async (t) => {
  const s = await setup(t);
  const receipt = await s.prepare();
  await s.broker.request("plan_commit", s.receiptScope(receipt));
  await s.f.service.disconnect(s.scope.accountId);
  assert.equal((await s.request(receipt)).status, 403);
  const reconnected = await s.f.service.connect({
    accountId: s.scope.accountId,
  });
  assert.equal(reconnected.activeAccountId, s.scope.accountId);
  await assert.rejects(
    s.broker.request("plan_commit", s.receiptScope(receipt)),
    /plan_receipt_expired/,
  );
  const next = await s.prepare({ generation: "b".repeat(32) });
  const response = await s.request(next);
  assert.equal(response.status, 200);
  await response.text();
});

test("typed private failures preserve circuit codes and redact unexpected exceptions", async (t) => {
  const s = await setup(t);
  await s.runtime.state.fail(
    s.scope.accountId,
    "subscription_sharing_usage_limit_exceeded",
  );
  s.runtime.relay.models = () => assert.fail("blocked account queried models");
  const payload = { ...s.scope, backend: "local", model: "fake-model" };
  assert.deepEqual(
    await s.broker.handlePrivateRequest("plan_prepare", payload),
    {
      ok: false,
      code: "subscription_sharing_usage_limit_exceeded",
    },
  );
  const failed = createPlanLaunchBroker({
    runtime: s.runtime,
    userData: s.f.userData,
    appVersion: "1.0.5",
    resolveRuntime: () => {
      throw new Error("fake-sensitive-token");
    },
  });
  t.after(() => failed.close());
  assert.deepEqual(await failed.handlePrivateRequest("plan_prepare", payload), {
    ok: false,
    code: "plan_launch_failed",
  });
});

test("disabled broker never resolves runtime or creates a receipt", async () => {
  const broker = createPlanLaunchBroker({
    runtime: { service: { policy: { enabled: false } } },
    resolveRuntime: () => assert.fail("disabled runtime resolved"),
  });
  await assert.rejects(broker.request("plan_prepare", {}), /feature_disabled/);
  broker.close();
});

test("in-flight preparations reserve the fixed receipt capacity", {
  timeout: 5_000,
}, async () => {
  const pending = deferred();
  let resolutions = 0;
  const expiries = [];
  const broker = createPlanLaunchBroker({
    runtime: {
      service: { policy: { enabled: true }, onRetire: () => () => {} },
    },
    resolveRuntime: () => {
      resolutions++;
      return pending.promise;
    },
    timers: {
      set(callback) {
        expiries.push(callback);
        return callback;
      },
      clear() {},
    },
  });
  const prepare = (index) =>
    broker.request("plan_prepare", {
      communityId: "community-a",
      agentId: `agent-${index}`,
      accountId: "a".repeat(64),
      generation: "a".repeat(32),
      backend: "local",
      model: "fake-model",
    });
  const preparations = Array.from({ length: 64 }, (_, index) =>
    prepare(index).then(
      () => assert.fail("invalid runtime admitted"),
      (error) => error.code,
    ),
  );
  await assert.rejects(prepare(65), /relay_capacity/);
  for (const expire of expiries) expire();
  await assert.rejects(prepare(65), /relay_capacity/);
  assert.equal(resolutions, 64);
  pending.resolve({ ...files, adapterVersion: "bad" });
  assert.deepEqual(
    await Promise.all(preparations),
    Array(64).fill("plan_runtime_unavailable"),
  );
  broker.close();
});
