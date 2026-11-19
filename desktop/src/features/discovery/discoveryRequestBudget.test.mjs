import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DISCOVERY_AHEAD_REQUESTS_PER_MINUTE,
  MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE,
  createDiscoveryRequestBudget,
} from "./discoveryRequestBudget.ts";
import { createSearchPageRunner } from "./discoveryRunSupport.ts";
import {
  DiscoverySearchError,
  RATE_LIMIT_EXHAUSTED_MESSAGE,
} from "./discoverySearch.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("the controller admits no more than 54 shared searches in a rolling minute", async () => {
  let now = 0;
  const wake = deferred();
  const budget = createDiscoveryRequestBudget({
    nowSeconds: () => now,
    sleep: () => wake.promise,
  });
  budget.registerCampaign("a");
  const signals = Array.from(
    { length: MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE + 1 },
    () => new AbortController(),
  );
  const starts = signals.map((controller) =>
    budget.acquire({
      campaignId: "a",
      kind: "in_turn",
      signal: controller.signal,
    }),
  );
  await Promise.all(starts.slice(0, MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE));
  await settle();
  assert.deepEqual(budget.snapshot(), {
    ahead: 0,
    queued: 1,
    requests: MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE,
  });
  now = 60;
  wake.resolve();
  await starts.at(-1);
  assert.equal(
    budget.snapshot().requests,
    1,
    "the queued request starts only after the old minute leaves the window",
  );
  budget.dispose();
});

test("ahead work uses at most 30 slots and shares them between live campaigns", async () => {
  const budget = createDiscoveryRequestBudget({
    nowSeconds: () => 0,
    sleep: async () => new Promise(() => {}),
  });
  budget.registerCampaign("a");
  budget.registerCampaign("b");
  const admitted = [];
  const requests = Array.from({ length: 20 }, () => ["a", "b"])
    .flat()
    .map((campaignId) =>
      budget
        .acquire({
          campaignId,
          kind: "ahead",
          signal: new AbortController().signal,
        })
        .then(() => admitted.push(campaignId)),
    );
  await settle();
  assert.deepEqual(budget.snapshot(), {
    ahead: MAX_DISCOVERY_AHEAD_REQUESTS_PER_MINUTE,
    queued: 10,
    requests: MAX_DISCOVERY_AHEAD_REQUESTS_PER_MINUTE,
  });
  assert.equal(
    admitted.filter((campaignId) => campaignId === "a").length,
    15,
    "the first city cannot take more than its fair share while city B waits",
  );
  assert.equal(admitted.filter((campaignId) => campaignId === "b").length, 15);
  budget.dispose();
  await Promise.allSettled(requests);
});

test("an in-turn page takes the next available slot before queued ahead work", async () => {
  let now = 0;
  const wake = deferred();
  const budget = createDiscoveryRequestBudget({
    nowSeconds: () => now,
    sleep: () => wake.promise,
  });
  budget.registerCampaign("a");
  const first = Array.from(
    { length: MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE },
    () =>
      budget.acquire({
        campaignId: "a",
        kind: "in_turn",
        signal: new AbortController().signal,
      }),
  );
  await Promise.all(first);
  const order = [];
  const ahead = budget
    .acquire({
      campaignId: "a",
      kind: "ahead",
      signal: new AbortController().signal,
    })
    .then(() => order.push("ahead"));
  const inTurn = budget
    .acquire({
      campaignId: "a",
      kind: "in_turn",
      signal: new AbortController().signal,
    })
    .then(() => order.push("in-turn"));
  now = 61;
  wake.resolve();
  await Promise.all([ahead, inTurn]);
  assert.deepEqual(order, ["in-turn", "ahead"]);
  budget.dispose();
});

test("an aborted queued request leaves the shared budget immediately", async () => {
  const budget = createDiscoveryRequestBudget({
    nowSeconds: () => 0,
    sleep: (_ms, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("stopped", "AbortError")),
          { once: true },
        ),
      ),
  });
  budget.registerCampaign("a");
  await Promise.all(
    Array.from({ length: MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE }, () =>
      budget.acquire({
        campaignId: "a",
        kind: "in_turn",
        signal: new AbortController().signal,
      }),
    ),
  );
  const controller = new AbortController();
  const pending = budget.acquire({
    campaignId: "a",
    kind: "in_turn",
    signal: controller.signal,
  });
  await settle();
  assert.equal(budget.snapshot().queued, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(budget.snapshot().queued, 0);
  budget.dispose();
});

test("a rate-limited page waits at most six times, caps each wait, and leaves monthly limits alone", async () => {
  const waits = [];
  let attempts = 0;
  const runner = createSearchPageRunner({
    budget: { acquire: async () => {} },
    maxRateLimitWaitMs: 65_000,
    maxRateLimitWaits: 6,
    search: async () => {
      attempts += 1;
      if (attempts <= 6) {
        throw new DiscoverySearchError(
          "rate-limited: prospect search quota exceeded; retry in 90s",
          { status: 429 },
        );
      }
      return {
        provider: "test",
        places: [],
        estimatedCostUsd: 0,
        nextSkip: null,
      };
    },
    sleep: async (ms) => {
      waits.push(ms);
    },
    transientBackoffMs: [],
  });
  const signal = new AbortController().signal;
  await runner("city-a", {}, signal, signal, "in_turn");
  assert.equal(attempts, 7);
  assert.deepEqual(waits, Array(6).fill(65_000));

  let failures = 0;
  const exhausted = createSearchPageRunner({
    budget: { acquire: async () => {} },
    maxRateLimitWaitMs: 65_000,
    maxRateLimitWaits: 6,
    search: async () => {
      failures += 1;
      throw new DiscoverySearchError(
        "rate-limited: prospect search quota exceeded; retry in 1s",
        { status: 429 },
      );
    },
    sleep: async () => {},
    transientBackoffMs: [],
  });
  await assert.rejects(
    exhausted("city-a", {}, signal, signal, "in_turn"),
    new RegExp(RATE_LIMIT_EXHAUSTED_MESSAGE),
  );
  assert.equal(failures, 7, "six waits are followed by one plain failure");

  const monthly = new DiscoverySearchError(
    "Your monthly prospect limit has been reached.",
    { code: "monthly_limit", status: 429 },
  );
  const monthlyRunner = createSearchPageRunner({
    budget: { acquire: async () => {} },
    maxRateLimitWaitMs: 65_000,
    maxRateLimitWaits: 6,
    search: async () => {
      throw monthly;
    },
    sleep: async () => assert.fail("monthly limits must not wait and retry"),
    transientBackoffMs: [],
  });
  await assert.rejects(
    monthlyRunner("city-a", {}, signal, signal, "in_turn"),
    (error) => error === monthly,
  );
});

test("a budget wait is abandoned when its run is stopped", async () => {
  const controller = new AbortController();
  const runner = createSearchPageRunner({
    budget: { acquire: async () => {} },
    maxRateLimitWaitMs: 65_000,
    maxRateLimitWaits: 6,
    search: async () => {
      throw new DiscoverySearchError(
        "rate-limited: prospect search quota exceeded; retry in 10s",
        { status: 429 },
      );
    },
    sleep: (_ms, signal) =>
      new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("stopped", "AbortError")),
          { once: true },
        ),
      ),
    transientBackoffMs: [],
  });
  const pending = runner(
    "city-a",
    {},
    controller.signal,
    controller.signal,
    "in_turn",
  );
  await settle();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
