import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createChatGptRelay } from "./inference-relay.mjs";
import {
  codexPlanConfig,
  planPreviewHeaders,
  validatePlanRequest,
} from "./inference-policy.mjs";
import { createPlanState } from "./plan-state.mjs";
import { createPlanSse } from "./sse.mjs";
import { prepareCodexPlanLaunch } from "./codex-plan-launch.mjs";
import { deferred, fixture, waitUntil } from "./test-support.mjs";

const body = (text = "Hello") => ({
  model: "fake-model",
  store: false,
  stream: true,
  input: [{ role: "user", content: text }],
});
const post = (grant, value = body(), headers = {}) =>
  fetch(`${grant.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grant.key}`,
      ...headers,
    },
    body: JSON.stringify(value),
  });
const errorResponse = (code, status) =>
  new Response(JSON.stringify({ error: { code, message: "UNTRUSTED" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
async function setup(t, options = {}) {
  const f = await fixture(t);
  const id = await f.connect();
  const relay = await createChatGptRelay({
    service: f.service,
    store: f.store,
    env: f.env,
    now: f.now,
    ...options,
  });
  t.after(() => relay.close());
  const grant = await relay.grant({
    backend: "local",
    communityId: "one",
    agentId: "agent",
    accountId: id,
  });
  return { ...f, id, relay, grant };
}

test("real OAuth lease rotates once, keeps an active lease, and rejects retired grants", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  const first = await f.service.authorizeInference(id);
  const [a, b] = await Promise.all([
    f.service.authorizeInference(id, { rejectedToken: first.token }),
    f.service.authorizeInference(id, { rejectedToken: first.token }),
  ]);
  assert.notEqual(a.token, first.token);
  assert.equal(a.token, b.token);
  assert.equal(f.fake.counters.refresh, 1);
  await first.assertCurrent();
  await f.service.disconnect(id);
  await assert.rejects(first.assertCurrent(), /stale_result/);
  await assert.rejects(f.service.authorizeInference(id), /plan_not_ready/);
  await f.service.connect({ accountId: id });
  await assert.rejects(first.assertCurrent(), /stale_result/);
  await f.service.authorizeInference(id);
});

test("near-expiry lease uses the P1 refresh owner and honors earliest-refresh fencing", async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  const before = (await f.read()).accounts[0].access_token;
  f.advance(3590_000);
  assert.notEqual((await f.service.authorizeInference(id)).token, before);
  assert.equal(f.fake.counters.refresh, 1);
  await f.edit((s) => {
    s.accounts[0].expires_at = f.now() - 1;
    s.accounts[0].earliest_refresh_at = f.now() + 60_000;
  });
  await assert.rejects(f.service.authorizeInference(id), /plan_not_ready/);
  assert.equal(f.fake.counters.refresh, 1);
});

test("HTTP relay injects the main-only bearer and preview header, strips child account headers", async (t) => {
  const seen = [];
  const f = await setup(t, {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return fetch(url, init);
    },
  });
  const tokens = (await f.read()).accounts[0];
  const response = await post(f.grant, body(), {
    "chatgpt-account-id": "other",
    "openai-organization": "other",
    "openai-project": "other",
    "x-arbitrary-secret": "other",
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /response.completed/);
  assert.equal(seen[0].url, `${f.fake.origin}/v1/responses`);
  assert.equal(
    seen[0].init.headers.Authorization,
    `Bearer ${tokens.access_token}`,
  );
  assert.equal(seen[0].init.headers["x-openai-chatpass-test"], "codex-direct");
  assert.equal(seen[0].init.headers.originator, "Colony");
  for (const key of [
    "chatgpt-account-id",
    "openai-organization",
    "openai-project",
    "x-arbitrary-secret",
  ])
    assert.equal(seen[0].init.headers[key], undefined);
  for (const secret of [
    tokens.access_token,
    tokens.refresh_token,
    tokens.id_token,
    f.grant.key,
  ])
    assert.equal(text.includes(secret), false);
});

test("preview header can be omitted in exactly one policy location", async (t) => {
  assert.deepEqual(
    planPreviewHeaders({ COLONY_CHATGPT_PREVIEW_HEADER: "off" }),
    {},
  );
  assert.throws(
    () => planPreviewHeaders({ COLONY_CHATGPT_PREVIEW_HEADER: "unknown" }),
    /invalid_preview_header/,
  );
  let headers;
  const f = await setup(t, {
    env: { COLONY_CHATGPT_PREVIEW_HEADER: "off" },
    fetchImpl: async (url, init) => {
      headers = init.headers;
      return fetch(url, init);
    },
  });
  await (await post(f.grant)).text();
  assert.equal(headers["x-openai-chatpass-test"], undefined);
});

test("401 refresh retries once with a new bearer and the same preview policy", async (t) => {
  const seen = [];
  const f = await setup(t, {
    fetchImpl: async (url, init) => {
      seen.push(init.headers);
      return seen.length === 1
        ? errorResponse("invalid_token", 401)
        : fetch(url, init);
    },
  });
  const response = await post(f.grant);
  assert.match(await response.text(), /response.completed/);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0].Authorization, seen[1].Authorization);
  assert.equal(f.fake.counters.refresh, 1);
  assert.equal(
    seen[0]["x-openai-chatpass-test"],
    seen[1]["x-openai-chatpass-test"],
  );
});

test("second 401 leaves durable needs-sign-in and pending-revoke, with no retry loop", async (t) => {
  let calls = 0;
  const f = await setup(t, {
    fetchImpl: async () => {
      calls++;
      return errorResponse("invalid_token", 401);
    },
  });
  assert.equal((await post(f.grant)).status, 401);
  const state = await f.read();
  assert.equal(state.accounts[0].state, "needs_sign_in");
  assert.ok(state.accounts[0].pending_revoke);
  assert.equal(state.accounts[0].access_token, undefined);
  assert.equal(calls, 2);
  assert.equal(f.fake.counters.refresh, 1);
  assert.equal((await post(f.grant)).status, 403);
  assert.equal(calls, 2);
});

test("streamed usage limit persists before delivery and blocks every agent and a restarted relay", async (t) => {
  const f = await setup(t);
  const second = await f.relay.grant({
    backend: "local",
    communityId: "one",
    agentId: "worker",
    accountId: f.id,
  });
  const response = await post(f.grant, body("[[limit]]"));
  const text = await response.text();
  assert.match(text, /response.failed/);
  assert.doesNotMatch(text, /response.completed/);
  assert.equal((await f.relay.state.status(f.id)).state, "limit");
  assert.equal((await post(second)).status, 429);
  assert.equal(f.fake.counters.responses, 1);
  const restarted = await createChatGptRelay({
    service: f.service,
    store: f.store,
    now: f.now,
  });
  t.after(() => restarted.close());
  const third = await restarted.grant({
    backend: "local",
    communityId: "two",
    agentId: "other",
    accountId: f.id,
  });
  const denied = await post(third);
  assert.equal(denied.status, 429);
  assert.match(await denied.text(), /This app has reached/);
  assert.equal(f.fake.counters.responses, 1);
  await f.relay.state.checkAgain(f.id);
  assert.match(await (await post(second)).text(), /response.completed/);
  assert.equal(f.fake.counters.responses, 2);
});

test("HTTP limits are sanitized and durable; accounts keep separate circuits", async (t) => {
  let limited = true,
    calls = 0;
  const f = await setup(t, {
    fetchImpl: async (url, init) => {
      calls++;
      return limited
        ? errorResponse("subscription_sharing_usage_limit_exceeded", 429)
        : fetch(url, init);
    },
  });
  const denied = await post(f.grant);
  assert.equal(denied.status, 429);
  assert.doesNotMatch(await denied.text(), /UNTRUSTED/);
  limited = false;
  const otherId = await f.connect();
  const other = await f.relay.grant({
    backend: "local",
    communityId: "one",
    agentId: "other",
    accountId: otherId,
  });
  assert.match(await (await post(other)).text(), /response.completed/);
  assert.equal((await post(f.grant)).status, 429);
  assert.equal(calls, 2);
});

test("usage-unavailable backs off to a terminal pause without deleting credentials", async (t) => {
  const f = await setup(t);
  const before = (await f.read()).accounts[0].refresh_token;
  for (const delay of [30_000, 60_000, 120_000, 300_000, 600_000]) {
    assert.match(
      await (await post(f.grant, body("[[unavail]]"))).text(),
      /response.failed/,
    );
    assert.equal((await post(f.grant)).status, 503);
    f.advance(delay);
  }
  f.advance(24 * 60 * 60 * 1000);
  assert.equal((await post(f.grant)).status, 503);
  assert.equal(f.fake.counters.responses, 5);
  assert.equal((await f.read()).accounts[0].refresh_token, before);
});

test("a later successful or unavailable result cannot erase a durable usage limit", async (t) => {
  const f = await setup(t);
  await f.relay.state.fail(f.id, "subscription_sharing_usage_limit_exceeded");
  await f.relay.state.fail(f.id, "subscription_sharing_usage_unavailable");
  assert.equal((await f.relay.state.status(f.id)).state, "limit");
});

test("two inference slots are shared and saturation makes no upstream call", {
  timeout: 5000,
}, async (t) => {
  const held = deferred();
  let calls = 0;
  const f = await setup(t, {
    fetchImpl: async (url, init) => {
      calls++;
      await held.promise;
      return fetch(url, init);
    },
  });
  const a = post(f.grant),
    b = post(f.grant);
  await waitUntil(() => calls === 2);
  const saturated = await post(f.grant);
  assert.equal(saturated.status, 503);
  assert.match(await saturated.text(), /inference_relay_busy/);
  assert.equal(calls, 2);
  held.resolve();
  await Promise.all(
    [a, b].map(async (r) =>
      assert.match(await (await r).text(), /response.completed/),
    ),
  );
});

test("local account binding survives selection of a different ChatGPT account", async (t) => {
  const seen = [];
  const f = await setup(t, {
    fetchImpl: async (url, init) => {
      seen.push(init.headers.Authorization);
      return fetch(url, init);
    },
  });
  const firstToken = (await f.read()).accounts[0].access_token;
  const otherId = await f.connect();
  await f.service.select(otherId);
  assert.match(await (await post(f.grant)).text(), /response.completed/);
  assert.equal(seen[0], `Bearer ${firstToken}`);
});

test("disconnect fences an in-flight result before any downstream bytes", async (t) => {
  const held = deferred();
  let calls = 0;
  const f = await setup(t, {
    fetchImpl: async () => {
      calls++;
      await held.promise;
      return new Response('data: {"type":"response.completed"}\n\n', {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
  const pending = post(f.grant);
  await waitUntil(() => calls === 1);
  await f.service.disconnect(f.id);
  held.resolve();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /response.completed/);
});

test("private route, capability, Origin, method and raw path all bind the production handler", async (t) => {
  const f = await setup(t);
  for (const headers of [
    { Authorization: "Bearer wrong" },
    { Origin: "https://site.example" },
  ])
    assert.equal((await post(f.grant, body(), headers)).status, 403);
  for (const suffix of [
    "/models",
    "/responses?query=1",
    "/responses/",
    "/%72esponses",
  ])
    assert.equal(
      (
        await fetch(`${f.grant.baseUrl}${suffix}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${f.grant.key}` },
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await fetch(`${f.grant.baseUrl}/responses`, {
        headers: { Authorization: `Bearer ${f.grant.key}` },
      })
    ).status,
    403,
  );
  assert.equal(f.fake.counters.responses, 0);
  f.grant.revoke();
  assert.equal((await post(f.grant)).status, 403);
});

test("remote agents, missing scopes and flag-off never receive relay capabilities", async (t) => {
  const f = await setup(t);
  for (const backend of ["remote", "relay_mesh", undefined])
    await assert.rejects(
      f.relay.grant({
        backend,
        communityId: "one",
        agentId: "a",
        accountId: f.id,
      }),
      /remote_plan_disallowed/,
    );
  const off = f.create({ env: {} });
  await assert.rejects(
    createChatGptRelay({ service: off, store: f.store }),
    /feature_disabled/,
  );
  f.fake.faults.noPlan = true;
  const noPlan = await f.connect();
  await assert.rejects(
    f.relay.grant({
      backend: "local",
      communityId: "one",
      agentId: "a",
      accountId: noPlan,
    }),
    /plan_not_ready/,
  );
});

test("account models are ordered, visible, durable and free of credentials", async (t) => {
  const f = await setup(t);
  assert.deepEqual(await f.relay.models(f.id), [
    { slug: "fake-model", displayName: "Fake model" },
  ]);
  const file = path.join(f.store.root, "plan-runtime.json");
  const text = await readFile(file, "utf8");
  const a = (await f.read()).accounts[0];
  for (const secret of [
    a.access_token,
    a.refresh_token,
    a.id_token,
    a.email,
    f.grant.key,
  ])
    assert.equal(text.includes(secret), false);
  if (process.platform !== "win32")
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.equal(
    (await createPlanState({ store: f.store }).status(f.id)).models[0].slug,
    "fake-model",
  );
});

test("durable circuit write failure cannot become a successful completed response", async (t) => {
  const f = await setup(t);
  f.store.saveRuntime = () => {
    throw new Error("storage_failed");
  };
  await assert.rejects(async () => {
    const response = await post(f.grant, body("[[limit]]"));
    await response.text();
  });
  assert.equal(f.fake.counters.responses, 1);
});

test("request and stream bounds, deadlines and interrupted streams fail without replay", async (t) => {
  const f = await setup(t, { maxBodyBytes: 256 });
  assert.equal((await post(f.grant, body("a".repeat(300)))).status, 413);
  assert.equal(f.fake.counters.responses, 0);
  const cut = await post(f.grant, body("[[cut]]"));
  assert.equal(cut.status, 503);
  assert.equal(f.fake.counters.responses, 1);
});

test("preview body policy fails before dispatch instead of rewriting incompatible tools", async (t) => {
  const f = await setup(t);
  for (const value of [
    { ...body(), store: true },
    { ...body(), stream: false },
    { ...body(), max_output_tokens: 100 },
    { ...body(), input: [{ type: "message", role: "system", content: "no" }] },
    { ...body(), tools: [{ type: "function", name: "get_time" }] },
    {
      ...body(),
      tools: [{ type: "namespace", tools: [{ type: "tool_search" }] }],
    },
  ])
    assert.equal((await post(f.grant, value)).status, 400);
  assert.equal(f.fake.counters.responses, 0);
  assert.doesNotThrow(() =>
    validatePlanRequest({
      ...body(),
      tools: [
        {
          type: "namespace",
          name: "clock",
          tools: [{ type: "function", name: "get_time" }],
        },
      ],
    }),
  );
  assert.doesNotThrow(() =>
    validatePlanRequest({
      ...body(),
      input: [
        ...body().input,
        {
          type: "additional_tools",
          tools: [{ type: "function", name: "get_time" }],
        },
      ],
    }),
  );
});

test("SSE monitor binds completion, failure, UTF8 splits and finite frame bounds", () => {
  const monitor = createPlanSse();
  const wire = Buffer.from(
    'data: {"type":"response.output_text.delta","delta":"é"}\r\n\r\ndata: {"type":"response.completed"}\n\n',
  );
  const split = wire.indexOf(Buffer.from("é")) + 1;
  assert.deepEqual(monitor.feed(wire.subarray(0, split)), []);
  assert.equal(monitor.feed(wire.subarray(split))[0].delta, "é");
  assert.equal(monitor.finish(), "response.completed");
  const incomplete = createPlanSse();
  incomplete.feed(
    Buffer.from(
      'data: {"type":"response.output_text.delta","delta":"text"}\n\n',
    ),
  );
  assert.throws(() => incomplete.finish(), /stream_interrupted/);
  assert.throws(
    () =>
      createPlanSse({ maxFrameBytes: 4 }).feed(Buffer.from("data: too long")),
    /stream_frame_too_large/,
  );
});

test("startup/session provider config cannot use real OpenAI credentials or implicit retries", () => {
  const config = codexPlanConfig({
    baseUrl: `http://127.0.0.1:42/${"a".repeat(43)}/v1`,
    model: "fake-model",
  });
  assert.equal(config.model_provider, "colony_chatgpt_plan");
  assert.equal(config.cli_auth_credentials_store, "file");
  assert.deepEqual(config.model_providers.colony_chatgpt_plan, {
    name: "ChatGPT plan",
    base_url: `http://127.0.0.1:42/${"a".repeat(43)}/v1`,
    env_key: "COLONY_CHATGPT_RELAY_KEY",
    wire_api: "responses",
    requires_openai_auth: false,
    supports_websockets: false,
    request_max_retries: 0,
    stream_max_retries: 0,
  });
  for (const baseUrl of [
    "https://api.openai.com/v1",
    "http://localhost:42/x/v1",
    `http://127.0.0.1:42/${"a".repeat(43)}/v1?x=1`,
  ])
    assert.throws(
      () => codexPlanConfig({ baseUrl, model: "fake-model" }),
      /invalid_relay_url/,
    );
});

test("isolated startup config and session env agree and contain no OAuth credentials", async (t) => {
  const f = await setup(t);
  const options = {
    service: f.service,
    relay: f.relay,
    userData: f.userData,
    backend: "local",
    communityId: "one",
    agentId: "agent",
    accountId: f.id,
    model: "fake-model",
    appVersion: "1.0.6",
    env: {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "old-api",
      CODEX_API_KEY: "old-codex",
      ACCESS_TOKEN: "old-access",
      CODEX_ACCESS_TOKEN: "old-login",
      CODEX_CONFIG: '{"model_provider":"openai"}',
      CODEX_HOME: "old-home",
      DEFAULT_AUTH_REQUEST: "old-auth",
      APP_SERVER_LOGS: "old-logs",
    },
  };
  const launch = await prepareCodexPlanLaunch(options);
  t.after(() => launch.dispose());
  const configFile = path.join(launch.env.CODEX_HOME, "config.toml");
  const saved = await readFile(configFile, "utf8");
  assert.match(saved, /model_provider = "colony_chatgpt_plan"/);
  assert.match(saved, /requires_openai_auth = false/);
  assert.match(saved, /cli_auth_credentials_store = "file"/);
  assert.match(saved, /request_max_retries = 0/);
  assert.match(saved, /stream_max_retries = 0/);
  assert.equal(launch.env.MODEL_PROVIDER, "colony_chatgpt_plan");
  assert.deepEqual(JSON.parse(launch.env.CODEX_CONFIG), launch.config);
  assert.equal(launch.env.NO_BROWSER, "1");
  assert.deepEqual(launch.clientInfo, {
    name: "Colony",
    title: "Colony",
    version: "1.0.6",
  });
  for (const key of [
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "ACCESS_TOKEN",
    "CODEX_ACCESS_TOKEN",
    "DEFAULT_AUTH_REQUEST",
    "APP_SERVER_LOGS",
  ])
    assert.equal(launch.env[key], undefined);
  const account = (await f.read()).accounts[0];
  for (const secret of [
    account.access_token,
    account.refresh_token,
    account.id_token,
  ]) {
    assert.equal(JSON.stringify(launch).includes(secret), false);
    assert.equal(saved.includes(secret), false);
  }
  assert.equal(saved.includes(launch.env.COLONY_CHATGPT_RELAY_KEY), false);
  if (process.platform !== "win32") {
    assert.equal((await lstat(configFile)).mode & 0o777, 0o600);
    assert.equal((await lstat(launch.env.CODEX_HOME)).mode & 0o777, 0o700);
  }
  const resumed = await prepareCodexPlanLaunch(options);
  t.after(() => resumed.dispose());
  assert.equal(resumed.env.CODEX_HOME, launch.env.CODEX_HOME);
  assert.notEqual(
    resumed.env.COLONY_CHATGPT_RELAY_KEY,
    launch.env.COLONY_CHATGPT_RELAY_KEY,
  );
  const elsewhere = await prepareCodexPlanLaunch({
    ...options,
    communityId: "two",
  });
  t.after(() => elsewhere.dispose());
  assert.notEqual(elsewhere.env.CODEX_HOME, launch.env.CODEX_HOME);
  launch.dispose();
  assert.equal(
    (
      await fetch(
        `${launch.config.model_providers.colony_chatgpt_plan.base_url}/responses`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${launch.env.COLONY_CHATGPT_RELAY_KEY}`,
          },
        },
      )
    ).status,
    403,
  );
});

test("launch validation rejects remote or disabled use before writing any private home", async (t) => {
  const f = await setup(t);
  const options = {
    service: f.service,
    relay: f.relay,
    userData: f.userData,
    backend: "remote",
    communityId: "one",
    agentId: "a",
    accountId: f.id,
    model: "fake-model",
    appVersion: "1.0.6",
  };
  await assert.rejects(
    prepareCodexPlanLaunch(options),
    /remote_plan_disallowed/,
  );
  await assert.rejects(
    prepareCodexPlanLaunch({
      ...options,
      backend: "local",
      service: f.create({ env: {} }),
    }),
    /feature_disabled/,
  );
  await assert.rejects(lstat(path.join(f.userData, "codex-plan")), {
    code: "ENOENT",
  });
});

test("upstream redirects cannot carry an injected token to any other path", async (t) => {
  const f = await setup(t);
  f.fake.faults.responseRedirect = true;
  assert.equal((await post(f.grant)).status, 503);
  assert.equal(
    f.fake.requests.some((r) => r.path === "/redirect-target"),
    false,
  );
  assert.equal(f.fake.counters.responses, 1);
});

test("a stalled upstream is aborted at a finite deadline without a replay", {
  timeout: 3000,
}, async (t) => {
  let calls = 0,
    aborted = false;
  const f = await setup(t, {
    timeoutMs: 100,
    fetchImpl: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("aborted"));
          },
          { once: true },
        ),
      );
    },
  });
  const response = await post(f.grant);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /response.completed/);
  assert.equal(aborted, true);
  assert.equal(calls, 1);
  assert.equal((await f.relay.state.status(f.id)).state, "unavailable");
});

test("retired accounts clear derived models durably before status is returned", async (t) => {
  const f = await setup(t);
  await f.relay.models(f.id);
  await f.service.disconnect(f.id);
  const status = await f.relay.state.status(f.id);
  assert.deepEqual(status.models, []);
  assert.notEqual(status.state, "ready");
  const saved = JSON.parse(
    await readFile(path.join(f.store.root, "plan-runtime.json"), "utf8"),
  );
  assert.equal(saved.accounts[f.id], undefined);
});

test("disconnect retires local capabilities even after the same account signs in again", async (t) => {
  const f = await setup(t);
  await f.service.disconnect(f.id);
  await f.service.connect({ accountId: f.id });
  assert.equal((await post(f.grant)).status, 403);
  assert.equal(f.fake.counters.responses, 0);
  const fresh = await f.relay.grant({
    backend: "local",
    communityId: "one",
    agentId: "agent",
    accountId: f.id,
  });
  assert.match(await (await post(fresh)).text(), /response.completed/);
});

test("a grant racing disconnect cannot publish a capability after retirement", async (t) => {
  const f = await setup(t);
  const held = deferred();
  let began = false;
  const authorize = f.service.authorizeInference;
  f.service.authorizeInference = async (...args) => {
    const lease = await authorize(...args);
    began = true;
    await held.promise;
    return lease;
  };
  const pending = f.relay.grant({
    backend: "local",
    communityId: "one",
    agentId: "racing",
    accountId: f.id,
  });
  await waitUntil(() => began);
  await f.service.disconnect(f.id);
  held.resolve();
  await assert.rejects(pending, /stale_result/);
});

test("a completed backoff retry resets availability; stale completion does not erase a new failure", async (t) => {
  const f = await setup(t);
  await (await post(f.grant, body("[[unavail]]"))).text();
  f.advance(30_000);
  assert.match(await (await post(f.grant)).text(), /response.completed/);
  assert.equal((await f.relay.state.status(f.id)).state, "ready");
  await f.relay.state.fail(f.id, "subscription_sharing_usage_unavailable");
  f.advance(30_000);
  const prior = await f.relay.state.assertReady(f.id);
  await f.relay.state.fail(f.id, "subscription_sharing_usage_unavailable");
  await f.relay.state.succeed(f.id, prior);
  assert.equal((await f.relay.state.status(f.id)).state, "unavailable");
});

test("total SSE output and individual frames are bounded in the production relay", async (t) => {
  const f = await setup(t, { maxStreamBytes: 10 });
  const response = await post(f.grant);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /stream_too_large/);
  assert.equal(f.fake.counters.responses, 1);
});
