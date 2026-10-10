import assert from "node:assert/strict";
import test from "node:test";
import {
  colonyCreditsCandidate,
  readCreditsGateway,
} from "./creditsGateway.ts";
import { runOnboardingConnectionTest } from "../onboarding/ui/onboardingConnectionTest.ts";

const snapshot = {
  enabled: true,
  provider: "stripe",
  balanceUsdCents: 1250,
  packs: [],
  intents: [],
  policyUrls: {
    terms: "https://policies.example/terms",
    acceptableUse: "https://policies.example/use",
  },
};
function fixture(options = {}) {
  const calls = [];
  let reads = 0;
  return {
    calls,
    deps: {
      enabled: async () => options.flag ?? true,
      relay: async () =>
        options.changed && reads
          ? "https://other.example"
          : "https://relay.example/",
      fetch: async (url, init) => {
        calls.push(url);
        assert.equal(init.redirect, "error");
        assert.ok(init.signal);
        if (options.fail) throw new Error("offline");
        const gateway = url.endsWith("capabilities");
        return {
          ok: !options.status || options.status === 200,
          status: options.status ?? 200,
          json: async () =>
            gateway
              ? {
                  enabled: true,
                  runtime: "colony",
                  model: "server-model",
                  ...options.gateway,
                }
              : { enabled: true, provider: "stripe", ...options.checkout },
        };
      },
      credits: async () => {
        reads++;
        calls.push("signed-balance");
        return { ...snapshot, ...options.snapshot };
      },
    },
  };
}

test("default-off native gate makes no HTTP or account request", async () => {
  const { calls, deps } = fixture({ flag: false });
  assert.deepEqual(await readCreditsGateway(deps), { configured: false });
  assert.deepEqual(calls, []);
});
test("relay gateway and Stripe are independent required gates before account reads", async () => {
  for (const options of [
    { gateway: { enabled: false } },
    { gateway: { enabled: "true" } },
    { gateway: { runtime: "openai" } },
    { gateway: { model: null } },
    { gateway: { model: " " } },
    { checkout: { enabled: false } },
    { checkout: { provider: "payfast" } },
    { status: 404 },
  ]) {
    const { calls, deps } = fixture(options);
    assert.deepEqual(
      await readCreditsGateway(deps),
      { configured: false },
      JSON.stringify(options),
    );
    assert.ok(!calls.includes("signed-balance"));
  }
});
test("signed snapshot rechecks Stripe and preserves the exact server balance including zero", async () => {
  for (const balanceUsdCents of [0, 1250]) {
    const { deps } = fixture({ snapshot: { balanceUsdCents } });
    const result = await readCreditsGateway(deps);
    assert.equal(result.configured, true);
    assert.equal(result.credits.balanceUsdCents, balanceUsdCents);
  }
  for (const changed of [{ enabled: false }, { provider: "payfast" }])
    assert.deepEqual(
      await readCreditsGateway(fixture({ snapshot: changed }).deps),
      { configured: false },
    );
});
test("network errors, malformed funds/terms and a changed business never look like configured or zero funds", async () => {
  for (const options of [
    { fail: true },
    { status: 503 },
    { changed: true },
    { snapshot: { balanceUsdCents: -1 } },
    { snapshot: { balanceUsdCents: NaN } },
    {
      snapshot: {
        policyUrls: {
          ...snapshot.policyUrls,
          terms: "http://policies.example/terms",
        },
      },
    },
  ])
    await assert.rejects(readCreditsGateway(fixture(options).deps));
});
test("credits selection clears incompatible model and persists only after a real nonempty proof", async () => {
  const original = {
    env_vars: {},
    preferred_runtime: "claude",
    provider: null,
    model: "customer-model",
  };
  const candidate = colonyCreditsCandidate(original);
  assert.deepEqual(candidate, {
    env_vars: {},
    preferred_runtime: "buzz-agent",
    provider: "colony-credits",
    model: null,
  });
  assert.equal(original.model, "customer-model");
  const writes = [];
  const save = async (config) => {
    writes.push(config);
    return { config };
  };
  for (const proof of [
    { error: "Out of credits" },
    { reply: " ", model: null },
    { reply: "hello", model: undefined },
  ])
    await assert.rejects(
      runOnboardingConnectionTest(
        candidate,
        () => true,
        async () => proof,
        save,
      ),
    );
  await assert.rejects(
    runOnboardingConnectionTest(
      candidate,
      () => false,
      async () => ({ reply: "hello", model: "server-model" }),
      save,
    ),
  );
  assert.deepEqual(writes, []);
  const result = await runOnboardingConnectionTest(
    candidate,
    () => true,
    async () => ({ reply: "hello", model: "server-model" }),
    save,
  );
  assert.deepEqual(writes, [candidate]);
  assert.equal(result.config.model, null);
  await assert.rejects(
    runOnboardingConnectionTest(
      candidate,
      () => true,
      async () => ({ reply: "hello", model: "server-model" }),
      async () => {
        throw new Error("save failed");
      },
    ),
    /save failed/,
  );
});

test("selection rechecks availability, funds and generation before invoking the real proof path", async () => {
  const { connectColonyCredits } = await import("./creditsGateway.ts");
  const original = {
    env_vars: {},
    preferred_runtime: "claude",
    provider: null,
    model: "old-model",
  };
  const calls = [];
  const prove = async (config) => {
    calls.push(config);
  };
  const config = async () => {
    calls.push("read-config");
    return original;
  };
  for (const state of [
    { configured: false },
    { configured: true, credits: { ...snapshot, balanceUsdCents: 0 } },
  ])
    await assert.rejects(
      connectColonyCredits(prove, () => true, {
        gateway: async () => state,
        config,
      }),
    );
  assert.deepEqual(calls, []);
  await connectColonyCredits(prove, () => false, {
    gateway: async () => ({ configured: true, credits: snapshot }),
    config,
  });
  assert.deepEqual(calls, []);
  let current = true;
  await connectColonyCredits(prove, () => current, {
    gateway: async () => ({ configured: true, credits: snapshot }),
    config: async () => {
      current = false;
      return original;
    },
  });
  assert.deepEqual(calls, []);
  await connectColonyCredits(prove, () => true, {
    gateway: async () => ({ configured: true, credits: snapshot }),
    config,
  });
  assert.deepEqual(calls, [
    "read-config",
    {
      env_vars: {},
      provider: "colony-credits",
      model: null,
      preferred_runtime: "buzz-agent",
    },
  ]);
});
