import assert from "node:assert/strict";
import test from "node:test";
import {
  createOpenRouterService,
  pkceChallenge,
  pkcePair,
  parseExchangeKey,
  parseModels,
  parseAccount,
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
  let config = { env_vars: { KEEP: "yes" }, provider: null, model: null };
  const service = createOpenRouterService({
    openExternal: async (url) => {
      authUrl = new URL(url);
    },
    fetchImpl: async (url, init) => {
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
    ...options,
  });
  return {
    service,
    saves,
    get exchanges() {
      return exchanges;
    },
    async callback(params = {}) {
      while (!authUrl) await new Promise((resolve) => setTimeout(resolve, 1));
      const url = new URL(authUrl.searchParams.get("callback_url"));
      url.searchParams.set("code", "fixture-code");
      for (const [name, value] of Object.entries(params))
        url.searchParams.set(name, value);
      return fetch(url);
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
  const result = await pending;
  assert.equal(result.status, "connected");
  assert.equal(result.model, "vendor/free:free");
  assert.equal(result.balance, null);
  assert.equal(result.freeRemaining, 38);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].env_vars.KEEP, "yes");
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
  const expected = callback.searchParams.get("state");
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
  await f.callback({ error: "provider-private-error" });
  assert.deepEqual(await pending, { status: "cancelled" });
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
      if (url.endsWith("/credits")) return new Response("", { status: 403 });
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
  assert.equal(result.status, "connected");
  assert.equal(result.model, "vendor/free:free");
  assert.equal(result.freeRemaining, null);
  assert.equal(result.balance, null);
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

test("paid selection persists the catalogue model and uses measured credits", async () => {
  const f = fixture({
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) return Response.json(catalogue);
      if (url.endsWith("/auth/keys"))
        return Response.json({ key: "fixture-credential" });
      if (url.endsWith("/key"))
        return Response.json({
          data: { ...keyInfo.data, limit_remaining: 5, is_free_tier: false },
        });
      return Response.json({ data: { total_credits: 15, total_usage: 2.5 } });
    },
  });
  const pending = f.service.connect();
  await f.callback();
  assert.equal((await pending).model, "vendor/free:free");
  const selected = await f.service.select("vendor/paid");
  assert.equal(selected.status, "connected");
  assert.equal(selected.balance, 12.5);
  assert.equal(f.saves.length, 2);
  assert.equal(f.saves[1].model, "vendor/paid");
});

test("credits read failure cannot erase an authoritative exhausted free quota", async () => {
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
      return new Response("", { status: 503 });
    },
  });
  const pending = f.service.connect();
  await f.callback();
  const result = await pending;
  assert.equal(result.status, "limit");
  assert.equal(result.freeRemaining, 0);
  assert.equal(result.balance, null);
  assert.match(result.metadataWarning, /unavailable/);
});
