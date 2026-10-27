import assert from "node:assert/strict";
import test from "node:test";
import { readFreeAiAccess } from "./freeAiAccess.ts";

function fixture(options = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      enabled: async () => options.flag ?? true,
      relay: async () => "https://relay.example/",
      nonce: () => "nonce-1",
      sign: async (input) => {
        calls.push(["sign", input]);
        return { ...input, id: "event-id", sig: "sig" };
      },
      fetch: async (url, init) => {
        calls.push(["fetch", url, init]);
        if (options.fail) throw new Error("offline");
        if (url.endsWith("/capabilities"))
          return {
            ok: (options.capabilityStatus ?? 200) < 400,
            status: options.capabilityStatus ?? 200,
            json: async () => ({
              enabled: true,
              runtime: "colony",
              model: "server-model",
              freeAiConfigured: true,
              ...options.capabilities,
            }),
          };
        return {
          ok: (options.accessStatus ?? 200) < 400,
          status: options.accessStatus ?? 200,
          json: async () => ({ freeAi: options.freeAi ?? true }),
        };
      },
    },
  };
}

test("a build without the native flag makes no network request", async () => {
  const { deps, calls } = fixture({ flag: false });
  assert.equal(await readFreeAiAccess(deps), "off");
  assert.deepEqual(calls, []);
});

test("a relay without the gateway route, or with it off, is off", async () => {
  for (const options of [
    { capabilityStatus: 404 },
    { capabilities: { enabled: false } },
    { capabilities: { runtime: "other" } },
    { capabilities: { model: " " } },
    { capabilities: { model: undefined } },
  ]) {
    assert.equal(
      await readFreeAiAccess(fixture(options).deps),
      "off",
      `${JSON.stringify(options)}`,
    );
  }
});

test("network and server failures are unreachable, never an exception", async () => {
  assert.equal(
    await readFreeAiAccess(fixture({ fail: true }).deps),
    "unreachable",
  );
  assert.equal(
    await readFreeAiAccess(fixture({ capabilityStatus: 503 }).deps),
    "unreachable",
  );
  assert.equal(
    await readFreeAiAccess(fixture({ accessStatus: 401 }).deps),
    "unreachable",
  );
  const broken = fixture();
  broken.deps.sign = async () => {
    throw new Error("no key");
  };
  assert.equal(await readFreeAiAccess(broken.deps), "unreachable");
});

test("a relay with no free account configured skips the signed call", async () => {
  const { deps, calls } = fixture({
    capabilities: { freeAiConfigured: false },
  });
  assert.equal(await readFreeAiAccess(deps), "not-free");
  assert.equal(calls.filter(([kind]) => kind === "sign").length, 0);
  const older = fixture({ capabilities: { freeAiConfigured: undefined } });
  assert.equal(await readFreeAiAccess(older.deps), "not-free");
});

test("the account answer decides free and sends one signed same-origin GET", async () => {
  const free = fixture({ freeAi: true });
  assert.equal(await readFreeAiAccess(free.deps), "free");
  const notFree = fixture({ freeAi: false });
  assert.equal(await readFreeAiAccess(notFree.deps), "not-free");
  const [, signed] = free.calls.find(([kind]) => kind === "sign");
  assert.equal(signed.kind, 27235);
  assert.deepEqual(signed.tags, [
    ["u", "https://relay.example/api/credits-gateway/access"],
    ["method", "GET"],
    ["nonce", "nonce-1"],
  ]);
  const [, url, init] = free.calls.filter(([kind]) => kind === "fetch").at(-1);
  assert.equal(url, "https://relay.example/api/credits-gateway/access");
  assert.equal(init.redirect, "error");
  assert.ok(init.signal);
  assert.match(init.headers.Authorization, /^Nostr [A-Za-z0-9+/=]+$/);
  assert.equal(init.method, undefined);
});
