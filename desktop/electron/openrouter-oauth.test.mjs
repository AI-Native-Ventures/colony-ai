import assert from "node:assert/strict";
import test from "node:test";
import { createServer, request } from "node:http";
import {
  createOpenRouterService,
  pkceChallenge,
  pkcePair,
  parseExchangeKey,
  parseModels,
  parseAccount,
  parseCredits,
  keyFingerprint,
} from "./openrouter-oauth.mjs";

test("S256 matches RFC 7636 and verifiers have independent entropy", () => {
  assert.equal(
    pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  const a = pkcePair();
  const b = pkcePair();
  assert.match(a.verifier, /^[A-Za-z0-9_-]{64}$/);
  assert.notEqual(a.verifier, b.verifier);
  assert.equal(a.challenge, pkceChallenge(a.verifier));
});

test("exchange parser rejects missing, empty and malformed key responses", () => {
  for (const value of [
    null,
    {},
    { key: " " },
    { key: 123 },
    { key: "bad\nvalue" },
    { key: "x".repeat(4097) },
  ])
    assert.throws(() => parseExchangeKey(value));
  assert.equal(
    parseExchangeKey({ key: "fixture-credential" }),
    "fixture-credential",
  );
});
const catalogue = {
  data: [
    {
      id: "vendor/paid",
      name: "Paid",
      pricing: { prompt: "1", completion: "1" },
      supported_parameters: ["tools"],
    },
    {
      id: "vendor/free:free",
      name: "Free",
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools"],
      context_length: 32000,
    },
    {
      id: "vendor/no-tools:free",
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: [],
    },
  ],
};
const keyInfo = {
  data: {
    usage: 1.5,
    limit: 5,
    limit_remaining: 0,
    is_free_tier: true,
    free_model_daily_requests: { limit: 50, remaining: 38 },
  },
};

test("catalogue requires tool-capable models and real zero pricing", () => {
  const models = parseModels(catalogue);
  assert.equal(models.length, 2);
  assert.equal(models[1].free, true);
  assert.equal(parseAccount(keyInfo).freeRemaining, 38);
  assert.equal(parseAccount({ data: {} }).freeRemaining, null);
  assert.throws(() => parseModels({ data: [] }));
});

function fixture(options = {}) {
  let authUrl;
  let exchanges = 0;
  const saves = [];
  let config = options.initialConfig ?? {
    env_vars: { KEEP: "yes", OPENROUTER_BASE_URL: "https://foreign.invalid" },
    provider: null,
    model: null,
  };
  let fronts = 0;
  const servers = [];
  const requests = [];
  const fixtureFetch = async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.redirect, "error");
    if (url.endsWith("/auth/keys")) {
      exchanges++;
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      assert.equal(body.code_challenge_method, "S256");
      assert.equal(
        pkceChallenge(body.code_verifier),
        authUrl.searchParams.get("code_challenge"),
      );
      return Response.json({ key: "fixture-credential" });
    }
    if (url.endsWith("/key")) return Response.json(keyInfo);
    if (url.endsWith("/credits")) return new Response("", { status: 403 });
    if (url.endsWith("/models")) return Response.json(catalogue);
    throw new Error("Unexpected request");
  };
  const providerUrls = [];
  const service = createOpenRouterService({
    bringToFront: () => {
      fronts++;
    },
    openExternal: async (url) => {
      authUrl = new URL(url);
    },
    createServerImpl: (...args) => {
      const server = createServer(...args);
      servers.push(server);
      if (options.keepListener) {
        const close = server.close.bind(server);
        let closes = 0;
        server.close = (...args) => (++closes === 1 ? server : close(...args));
      }
      return server;
    },
    invoke: async (command, args) => {
      if (command === "get_global_agent_config") return config;
      if (command === "set_global_agent_config") {
        config = args.config;
        saves.push(config);
        return { failed_restart_count: 0 };
      }
      if (command === "test_ai_connection") return "connected";
      throw new Error("Unexpected native command");
    },
    timeoutMs: 5000,
    ...options,
    fetchImpl: async (url, init) => {
      providerUrls.push(url);
      assert.equal(new URL(url).origin, "https://openrouter.ai");
      assert.ok(
        [
          "https://openrouter.ai/api/v1/credits",
          "https://openrouter.ai/api/v1/key",
          "https://openrouter.ai/api/v1/models",
          "https://openrouter.ai/api/v1/auth/keys",
        ].includes(url),
        "only exact documented provider URLs are allowed",
      );
      return (options.fetchImpl ?? fixtureFetch)(url, init);
    },
  });
  return {
    service,
    providerUrls,
    saves,
    get fronts() {
      return fronts;
    },
    servers,
    requests,
    get config() {
      return config;
    },
    async auth() {
      const deadline = Date.now() + 1000;
      while (!authUrl && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 1));
      assert.ok(authUrl, "browser authorization must start");
      return authUrl;
    },
    get exchanges() {
      return exchanges;
    },
    async callback(params = {}) {
      const auth = await this.auth();
      const callback = auth.searchParams.get("callback_url");
      assert.equal(
        new URL(callback).search,
        "",
        "provider appends its own query",
      );
      const query = new URLSearchParams({
        code: "fixture-code",
        state: auth.searchParams.get("state"),
        ...params,
      });
      // Fake provider follows the documented redirect, appending code and state.
      return fetch(`${callback}?${query}`);
    },
  };
}

test("mismatched state cannot exchange or persist; valid callback is consumed once", async () => {
  const f = fixture();
  const pending = f.service.connect();
  assert.equal((await f.callback({ state: "foreign" })).status, 400);
  assert.equal(f.exchanges, 0);
  assert.equal(f.saves.length, 0);
  const response = await f.callback();
  assert.equal(response.status, 200);
  assert.equal(f.fronts, 1);
  const result = await pending;
  assert.equal(result.status, "connected");
  assert.equal(result.model, "vendor/free:free");
  assert.equal(result.usage, 1.5);
  assert.equal(result.freeRemaining, 38);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].env_vars.KEEP, "yes");
  assert.equal(f.saves[0].env_vars.OPENROUTER_BASE_URL, undefined);
  assert.equal(f.servers[0].address(), null);
  assert.equal(f.saves[0].preferred_runtime, "buzz-agent");
  assert.equal(JSON.stringify(result).includes("fixture-credential"), false);
  await assert.rejects(f.callback());
  assert.equal(f.exchanges, 1);
});

test("cancel and timeout retire the listener without saving", async () => {
  const f = fixture();
  const pending = f.service.connect();
  await f.callback({ state: "wrong" });
  f.service.cancel();
  assert.equal((await pending).status, "cancelled");
  assert.equal(f.saves.length, 0);
  await assert.rejects(f.callback());
  const timed = fixture({ timeoutMs: 20 });
  assert.equal((await timed.service.connect()).status, "error");
  assert.equal(timed.saves.length, 0);
});

test("a free-tier account never enables paid models and selections are validated", async () => {
  const f = fixture();
  const pending = f.service.connect();
  await f.callback();
  await pending;
  assert.equal((await f.service.select("vendor/paid")).status, "error");
  assert.equal((await f.service.select("invented/model")).status, "error");
  assert.equal((await f.service.test()).testResult, "connected");
});

test("missing, duplicate and multibyte state cannot consume the production callback", async () => {
  let auth;
  const f = fixture({
    openExternal: async (url) => {
      auth = new URL(url);
    },
  });
  const pending = f.service.connect();
  while (!auth) await new Promise((resolve) => setTimeout(resolve, 1));
  const callback = new URL(auth.searchParams.get("callback_url"));
  const expected = auth.searchParams.get("state");
  callback.searchParams.delete("state");
  assert.equal((await fetch(callback)).status, 400);
  callback.searchParams.set("state", "é".repeat(expected.length));
  assert.equal((await fetch(callback)).status, 400);
  callback.searchParams.set("state", expected);
  callback.searchParams.append("state", expected);
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(f.exchanges, 0);
  f.service.cancel();
  assert.equal((await pending).status, "cancelled");
});

test("provider denial is cancelled and does not reflect provider-controlled error text", async () => {
  const f = fixture();
  const pending = f.service.connect();
  const auth = await f.auth();
  await fetch(`${auth.searchParams.get("callback_url")}?error=denied`);
  assert.deepEqual(await pending, { status: "cancelled" });
  assert.equal(f.fronts, 1);
  assert.equal(f.exchanges, 0);
  assert.equal(f.saves.length, 0);
});

test("failed exchange cannot save or reveal its response", async () => {
  const f = fixture({
    fetchImpl: async (url) =>
      url.endsWith("/models")
        ? Response.json(catalogue)
        : Response.json(
            { secret: "fixture-private-response" },
            { status: 403 },
          ),
  });
  const pending = f.service.connect();
  await f.callback();
  const result = await pending;
  assert.equal(result.status, "error");
  assert.equal(f.saves.length, 0);
  assert.equal(
    JSON.stringify(result).includes("fixture-private-response"),
    false,
  );
});

test("cancel during exchange fences a late response before persistence", {
  timeout: 2000,
}, async () => {
  let release;
  let requested;
  let keyReads = 0;
  const arrived = new Promise((resolve) => {
    requested = resolve;
  });
  const f = fixture({
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/key")) {
        keyReads++;
        return Response.json(keyInfo);
      }
      requested();
      return new Promise((resolve) => {
        release = () => resolve(Response.json({ key: "fixture-credential" }));
      });
    },
  });
  const pending = f.service.connect();
  await f.callback();
  await arrived;
  f.service.cancel();
  release();
  assert.equal((await pending).status, "cancelled");
  assert.equal(f.saves.length, 0);
  assert.equal(keyReads, 0);
});

test("concurrent authorization does not replace the verifier of an active attempt", async () => {
  const f = fixture();
  const pending = f.service.connect();
  await assert.rejects(f.service.connect(), /already running/);
  await f.callback();
  assert.equal((await pending).status, "connected");
  assert.equal(f.saves.length, 1);
});

test("metadata failure preserves the exchanged credential with an explicit unknown quota", async () => {
  const f = fixture({
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/auth/keys"))
        return Response.json({ key: "fixture-credential" });
      return new Response("", { status: 503 });
    },
  });
  const pending = f.service.connect();
  await f.callback();
  const result = await pending;
  assert.equal(result.status, "linked");
  assert.equal(result.model, "vendor/free:free");
  assert.equal(result.freeRemaining, null);
  assert.equal(result.usage, null);
  assert.match(result.metadataWarning, /unavailable/);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].env_vars.OPENROUTER_API_KEY, "fixture-credential");
  assert.equal(JSON.stringify(result).includes("fixture-credential"), false);
});

test("unknown account tier cannot authorize paid selection", async () => {
  const f = fixture({
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/auth/keys"))
        return Response.json({ key: "fixture-credential" });
      if (url.endsWith("/key")) return Response.json({ data: {} });
      return new Response("", { status: 403 });
    },
  });
  const pending = f.service.connect();
  await f.callback();
  assert.equal((await pending).model, "vendor/free:free");
  assert.equal((await f.service.select("vendor/paid")).status, "error");
  assert.equal(f.saves.length, 1);
});

test("paid selection persists the model using key tier and spending allowance", async () => {
  const f = fixture({
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/auth/keys"))
        return Response.json({ key: "fixture-credential" });
      if (url.endsWith("/key"))
        return Response.json({
          data: { ...keyInfo.data, limit_remaining: 5, is_free_tier: false },
        });
      throw new Error("Unexpected endpoint");
    },
  });
  const pending = f.service.connect();
  await f.callback();
  assert.equal((await pending).model, "vendor/free:free");
  const selected = await f.service.select("vendor/paid");
  assert.equal(selected.status, "connected");
  assert.equal(selected.limitRemaining, 5);
  assert.equal(selected.usage, 1.5);
  assert.equal(f.saves.length, 2);
  assert.equal(f.saves[1].model, "vendor/paid");
});

test("exhausted free quota stays authoritative when account credits are unavailable", async () => {
  const f = fixture({
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/auth/keys"))
        return Response.json({ key: "fixture-credential" });
      if (url.endsWith("/key"))
        return Response.json({
          data: {
            ...keyInfo.data,
            free_model_daily_requests: { limit: 50, remaining: 0 },
          },
        });
      throw new Error("Unexpected endpoint");
    },
  });
  const pending = f.service.connect();
  await f.callback();
  const result = await pending;
  assert.equal(result.status, "limit");
  assert.equal(result.freeRemaining, 0);
  assert.equal(result.usage, 1.5);
  assert.equal(result.metadataWarning, null);
});

function rawCallback(url, { method = "GET", path, host } = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: path ?? `${target.pathname}${target.search}`,
        method,
        headers: { Host: host ?? target.host },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function savedConfig(env = {}) {
  return {
    provider: "openrouter",
    model: "vendor/free:free",
    env_vars: { OPENROUTER_API_KEY: "fixture-credential", ...env },
  };
}

test("bare callback, documented top-level state, label and IPv4 bind", async () => {
  const f = fixture();
  const pending = f.service.connect();
  const auth = await f.auth();
  assert.equal(new URL(auth.searchParams.get("callback_url")).search, "");
  assert.equal(
    new URL(auth.searchParams.get("callback_url")).hostname,
    "localhost",
  );
  assert.match(auth.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(auth.searchParams.get("key_label"), "Colony");
  assert.equal(f.servers[0].address().address, "127.0.0.1");
  await f.callback();
  assert.equal((await pending).status, "connected");
});

test("same-length wrong state, method, path, Host and malformed codes are rejected", async () => {
  const f = fixture();
  const pending = f.service.connect();
  const auth = await f.auth();
  const url = new URL(auth.searchParams.get("callback_url"));
  const state = auth.searchParams.get("state");
  url.searchParams.set("state", state);
  url.searchParams.set("code", "fixture-code");
  const wrong = new URL(url);
  wrong.searchParams.set(
    "state",
    (state[0] === "A" ? "B" : "A") + state.slice(1),
  );
  assert.equal((await rawCallback(wrong)).status, 400);
  for (const opts of [
    { method: "POST" },
    { path: `/other${url.search}` },
    { host: "foreign.invalid" },
  ])
    assert.equal((await rawCallback(url, opts)).status, 400);
  const duplicate = new URL(url);
  duplicate.searchParams.append("code", "second-code");
  assert.equal((await rawCallback(duplicate)).status, 400);
  const oversized = new URL(url);
  oversized.searchParams.set("code", "x".repeat(4097));
  assert.equal((await rawCallback(oversized)).status, 400);
  assert.equal(f.exchanges, 0);
  assert.equal(f.saves.length, 0);
  const accepted = await rawCallback(url, { host: `127.0.0.1:${url.port}` });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers["x-content-type-options"], "nosniff");
  assert.equal(accepted.headers["referrer-policy"], "no-referrer");
  assert.equal((await pending).status, "connected");
});

test("consumed guard rejects replay while the exchange is still pending", async () => {
  let release;
  let arrived;
  const exchanging = new Promise((resolve) => {
    arrived = resolve;
  });
  const f = fixture({
    keepListener: true,
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/key")) return Response.json(keyInfo);
      if (url.endsWith("/credits")) return new Response("", { status: 403 });
      arrived();
      return new Promise((resolve) => {
        release = () => resolve(Response.json({ key: "fixture-credential" }));
      });
    },
  });
  const pending = f.service.connect();
  await f.callback();
  await exchanging;
  assert.equal((await f.callback()).status, 400);
  release();
  assert.equal((await pending).status, "connected");
  assert.equal(f.saves.length, 1);
});

test("cancel during atomic save is refused and completes one save", async () => {
  let release;
  let arrived;
  const saving = new Promise((resolve) => {
    arrived = resolve;
  });
  const f = fixture({
    invoke: async (command) => {
      if (command === "get_global_agent_config") return savedConfig();
      arrived();
      return new Promise((resolve) => {
        release = () => resolve({ failed_restart_count: 0 });
      });
    },
  });
  const pending = f.service.connect();
  await f.callback();
  await saving;
  assert.equal(f.service.cancel(), false);
  release();
  assert.equal((await pending).status, "connected");
});

test("cancel retires an attempt immediately so a remount can read status", async () => {
  const f = fixture();
  const pending = f.service.connect();
  await f.auth();
  assert.equal(f.service.cancel(), true);
  assert.deepEqual(await f.service.status(), { status: "unlinked" });
  assert.equal((await pending).status, "cancelled");
});

test("status is unlinked only without a saved key and reads a valid saved connection", async () => {
  const empty = fixture();
  assert.deepEqual(await empty.service.status(), { status: "unlinked" });
  assert.equal(empty.requests.length, 0);
  const saved = fixture({ initialConfig: savedConfig() });
  assert.equal((await saved.service.status()).status, "connected");
  assert.equal(saved.requests.length, 3);
  assert.equal(
    saved.requests.some((r) => r.url.endsWith("/credits")),
    true,
  );
});

for (const status of [0, 500, 503, 401, 403]) {
  test(`saved status preserves linking or requests reauthorization on ${status}`, async () => {
    let calls = 0;
    const f = fixture({
      initialConfig: savedConfig(),
      fetchImpl: async () => {
        calls++;
        if (!status) throw new Error("offline");
        return new Response("", { status });
      },
    });
    const result = await f.service.status();
    assert.equal(
      result.status,
      status === 401 || status === 403 ? "reauth" : "linked",
    );
    if (result.status === "linked") {
      assert.equal(result.model, "vendor/free:free");
      assert.equal(result.provider, "openrouter");
      assert.equal(result.limitRemaining, null);
      assert.match(result.metadataWarning, /saved/);
    }
    assert.equal(f.saves.length, 0);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes("fixture-credential"), false);
  });
}

for (const status of [401, 403]) {
  test(`fresh rejected key on ${status} cannot be saved as connected`, async () => {
    const f = fixture({
      fetchImpl: async (url) => {
        if (url.endsWith("/models")) return Response.json(catalogue);
        if (url.endsWith("/auth/keys"))
          return Response.json({ key: "fixture-credential" });
        return new Response("", { status });
      },
    });
    const pending = f.service.connect();
    await f.callback();
    assert.equal((await pending).status, "reauth");
    assert.equal(f.saves.length, 0);
  });
}

test("custom base URLs are unmanaged without provider calls or inference", async () => {
  const f = fixture({
    initialConfig: savedConfig({
      OPENROUTER_BASE_URL: "https://foreign.invalid",
    }),
  });
  for (const action of [
    () => f.service.status(),
    () => f.service.test(),
    () => f.service.select("vendor/free:free"),
  ])
    assert.equal((await action()).status, "unmanaged");
  assert.equal(f.requests.length, 0);
  assert.equal(f.saves.length, 0);
});

test("insufficient-balance inference flips the production linked status to limit", async () => {
  const f = fixture({
    invoke: async (command) =>
      command === "get_global_agent_config"
        ? savedConfig()
        : "insufficient-balance",
  });
  const result = await f.service.test();
  assert.equal(result.status, "limit");
  assert.equal(result.testResult, "insufficient-balance");
});

test("cancel fences a late native inference response", async () => {
  let release;
  let arrived;
  const testing = new Promise((resolve) => {
    arrived = resolve;
  });
  const f = fixture({
    invoke: async (command) => {
      if (command === "get_global_agent_config") return savedConfig();
      arrived();
      return new Promise((resolve) => {
        release = () => resolve("connected");
      });
    },
  });
  const pending = f.service.test();
  await testing;
  assert.equal(f.service.cancel(), true);
  assert.equal((await f.service.status()).status, "connected");
  release();
  assert.equal((await pending).status, "cancelled");
});

test("non-OK provider response bodies are cancelled", async () => {
  let cancelled = 0;
  const f = fixture({
    initialConfig: savedConfig(),
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
        { status: 503 },
      ),
  });
  assert.equal((await f.service.status()).status, "linked");
  assert.equal(cancelled, 1);
});

test("retired config read cannot issue provider requests after a new mount", async () => {
  let release;
  let arrived;
  let reads = 0;
  const reading = new Promise((resolve) => {
    arrived = resolve;
  });
  const f = fixture({
    invoke: async () => {
      if (++reads > 1) return savedConfig();
      arrived();
      return new Promise((resolve) => {
        release = () => resolve(savedConfig());
      });
    },
  });
  const pending = f.service.status();
  await reading;
  assert.equal(f.service.cancel(), true);
  assert.equal((await f.service.status()).status, "connected");
  release();
  assert.equal((await pending).status, "cancelled");
  assert.equal(f.requests.length, 3);
});

test("credits parsing subtracts usage exactly and rejects absent or invalid totals", () => {
  assert.equal(
    parseCredits({ data: { total_credits: 20, total_usage: 7.5 } }),
    12.5,
  );
  assert.equal(
    parseCredits({ data: { total_credits: 1, total_usage: 2 } }),
    -1,
  );
  for (const data of [
    {},
    { total_credits: 20 },
    { total_credits: "20", total_usage: 1 },
    { total_credits: Infinity, total_usage: 1 },
    { total_credits: 20, total_usage: -1 },
  ])
    assert.throws(() => parseCredits({ data }));
});

function balanceFixture(credits, options = {}) {
  const probes = [];
  let config = savedConfig();
  const f = fixture({
    fetchImpl: async (url, init) => {
      if (url.endsWith("/credits")) {
        probes.push(init);
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "error");
        return credits(init, probes.length);
      }
      if (url.endsWith("/key"))
        return Response.json({
          data: { ...keyInfo.data, is_free_tier: false, limit_remaining: 3.5 },
        });
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/auth/keys"))
        return Response.json({ key: "fixture-credential" });
      throw new Error("Unexpected endpoint");
    },
    invoke: async (command, args) => {
      if (command === "get_global_agent_config") return config;
      if (command === "set_global_agent_config") {
        config = args.config;
        return {};
      }
      if (command === "test_ai_connection") return "connected";
      throw new Error("Unexpected command");
    },
    ...options,
  });
  return {
    ...f,
    probes,
    changeKey: (key = "second-fixture") => {
      config = savedConfig({ OPENROUTER_API_KEY: key });
    },
  };
}

test("successful credits connect and refresh show balance, save and test keep it without new probes", async () => {
  const f = balanceFixture((_, calls) =>
    Response.json({
      data: { total_credits: 20, total_usage: calls === 1 ? 7.5 : 8 },
    }),
  );
  const pending = f.service.connect();
  await f.callback();
  assert.equal((await pending).balance, 12.5);
  assert.equal(f.probes.length, 1);
  assert.equal((await f.service.select("vendor/paid")).balance, 12.5);
  assert.equal((await f.service.test()).balance, 12.5);
  assert.equal(f.probes.length, 1);
  const refreshed = await f.service.status();
  assert.equal(refreshed.balance, 12);
  assert.equal(refreshed.status, "connected");
  assert.equal(f.probes.length, 2);
  assert.equal(JSON.stringify(refreshed).includes("fixture-credential"), false);
});

for (const failure of ["401", "403"]) {
  test(`credits ${failure} falls back to key quota and is cached per key for five minutes`, async () => {
    let clock = 1000;
    const f = balanceFixture(
      () => {
        if (failure === "network") throw new Error("fixture offline");
        if (failure === "malformed")
          return Response.json({ data: { total_credits: 20 } });
        return new Response("", { status: Number(failure) });
      },
      { now: () => clock },
    );
    const first = await f.service.status();
    assert.equal(first.status, "connected");
    assert.equal(first.balance, null);
    assert.equal(first.usage, 1.5);
    assert.equal(first.limit, 5);
    assert.equal(first.limitRemaining, 3.5);
    assert.equal(first.freeRemaining, 38);
    assert.equal(f.probes.length, 1);
    assert.equal((await f.service.status()).balance, null);
    assert.equal((await f.service.select("vendor/paid")).status, "connected");
    assert.equal(f.probes.length, 1);
    clock += 4 * 60 * 1000 + 59 * 1000;
    await f.service.status();
    assert.equal(f.probes.length, 1);
    clock += 1000;
    await f.service.status();
    assert.equal(f.probes.length, 2);
    f.changeKey();
    await f.service.status();
    assert.equal(f.probes.length, 3);
  });
}

test("failed refresh clears an earlier balance rather than presenting stale account credits", async () => {
  const f = balanceFixture((_, calls) =>
    calls === 1
      ? Response.json({ data: { total_credits: 20, total_usage: 7.5 } })
      : new Response("", { status: 403 }),
  );
  assert.equal((await f.service.status()).balance, 12.5);
  assert.equal((await f.service.status()).balance, null);
  assert.equal((await f.service.test()).balance, null);
  assert.equal(f.probes.length, 2);
});

test("cancelling a balance probe cannot poison the next refresh cache", async () => {
  let release;
  let arrived;
  const probing = new Promise((resolve) => {
    arrived = resolve;
  });
  const f = balanceFixture((_, calls) => {
    if (calls > 1)
      return Response.json({ data: { total_credits: 20, total_usage: 7.5 } });
    arrived();
    return new Promise((resolve) => {
      release = () => resolve(new Response("", { status: 403 }));
    });
  });
  const pending = f.service.status();
  await probing;
  assert.equal(f.service.cancel(), true);
  release();
  assert.equal((await pending).status, "cancelled");
  assert.equal((await f.service.status()).balance, 12.5);
  assert.equal(f.probes.length, 2);
});

test("zero account balance never overrides key-based paid-model eligibility", async () => {
  const f = balanceFixture(() =>
    Response.json({ data: { total_credits: 20, total_usage: 20 } }),
  );
  assert.equal((await f.service.status()).balance, 0);
  const result = await f.service.select("vendor/paid");
  assert.equal(result.status, "connected");
  assert.equal(result.balance, 0);
  assert.equal(f.probes.length, 1);
});

test("balance cache is bounded and evicted keys are probed again", async () => {
  const f = balanceFixture(() => new Response("", { status: 403 }));
  await f.service.status();
  for (let i = 0; i < 32; i++) {
    f.changeKey(`fixture-rotation-${i}`);
    await f.service.status();
  }
  assert.equal(f.probes.length, 33);
  f.changeKey("fixture-credential");
  await f.service.status();
  assert.equal(f.probes.length, 34);
});

test("provider requests use exact HTTPS URLs and credits carry the saved bearer key", async () => {
  const f = balanceFixture(() =>
    Response.json({ data: { total_credits: 20, total_usage: 7.5 } }),
  );
  const pending = f.service.connect();
  await f.callback();
  assert.equal((await pending).status, "connected");
  assert.deepEqual([...new Set(f.providerUrls)].sort(), [
    "https://openrouter.ai/api/v1/auth/keys",
    "https://openrouter.ai/api/v1/credits",
    "https://openrouter.ai/api/v1/key",
    "https://openrouter.ai/api/v1/models",
  ]);
  assert.equal(f.probes[0].headers.Authorization, "Bearer fixture-credential");
});

test("key fingerprints are deterministic SHA256 hex without the credential", () => {
  const key = "fixture-credential";
  const fingerprint = keyFingerprint(key);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes(key), false);
  assert.equal(keyFingerprint(key), fingerprint);
  assert.notEqual(keyFingerprint("other-fixture"), fingerprint);
});

for (const failure of ["network", "500", "malformed"]) {
  test(`transient credits ${failure} retries on the next refresh`, async () => {
    const f = balanceFixture((_, calls) => {
      if (calls > 1)
        return Response.json({ data: { total_credits: 20, total_usage: 7.5 } });
      if (failure === "network") throw new Error("fixture offline");
      if (failure === "malformed")
        return Response.json({ data: { total_credits: 20 } });
      return new Response("", { status: 500 });
    });
    const first = await f.service.status();
    assert.equal(first.status, "connected");
    assert.equal(first.balance, null);
    assert.equal(first.usage, 1.5);
    assert.equal((await f.service.status()).balance, 12.5);
    assert.equal(f.probes.length, 2);
  });
}

for (const creditsTimeoutMs of [undefined, 20]) {
  test(`hanging credits probe times out at ${creditsTimeoutMs ?? 5000} ms while models load in parallel`, {
    timeout: 6500,
  }, async () => {
    let aborted = false;
    const f = balanceFixture(
      (init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(init.signal.reason);
            },
            { once: true },
          );
        }),
      creditsTimeoutMs === undefined ? {} : { creditsTimeoutMs },
    );
    const started = Date.now();
    const pending = f.service.status();
    // Allow config and key reads to complete while credits remain pending.
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(f.providerUrls.includes("https://openrouter.ai/api/v1/models"));
    assert.equal(aborted, false);
    const result = await pending;
    assert.equal(aborted, true);
    assert.equal(result.status, "connected");
    assert.equal(result.balance, null);
    assert.ok(Date.now() - started >= (creditsTimeoutMs ?? 5000) - 5);
    assert.ok(Date.now() - started < (creditsTimeoutMs ?? 5000) + 1000);
  });
}
