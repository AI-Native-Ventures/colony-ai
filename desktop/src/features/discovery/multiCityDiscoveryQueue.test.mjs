import assert from "node:assert/strict";
import test from "node:test";

import { emptyCampaignQualificationSettings } from "./qualificationCampaign.ts";
import {
  campaignNameForCity,
  groupProviderBudgetUsd,
  uniqueLocations,
} from "./multiCityDiscovery.ts";
import { createMultiCityDiscoveryCoordinator } from "./multiCityDiscoveryQueue.ts";
import {
  getMultiCityDiscoveryCoordinator,
  resetMultiCityDiscoveryRuntime,
} from "./multiCityDiscoveryRuntime.ts";
import { DiscoverySearchError } from "./discoverySearch.ts";
import {
  isPassingStartError,
  START_ATTEMPT_TIMEOUT_MS,
  START_INTERRUPTED_MESSAGE,
  START_RETRY_DELAYS_SECONDS,
  START_TIMEOUT_MESSAGE,
} from "./multiCityDiscoveryQueue.ts";

function place(label, latitude, longitude) {
  return {
    label,
    latitude,
    longitude,
    countryCode: "ZA",
    region: "Gauteng",
    kind: "city",
    boundingBox: null,
  };
}

const JOHANNESBURG = place(
  "Johannesburg, Gauteng, South Africa",
  -26.2041,
  28.0473,
);
const CAPE_TOWN = place(
  "Cape Town, Western Cape, South Africa",
  -33.9249,
  18.4241,
);
const DURBAN = place("Durban, KwaZulu-Natal, South Africa", -29.8587, 31.0218);
const PRETORIA = place("Pretoria, Gauteng, South Africa", -25.7479, 28.2293);

function input(locations = [JOHANNESBURG, CAPE_TOWN, DURBAN]) {
  return {
    name: "Home furnishing prospects",
    locations,
    target: 100,
    criteria: "Independent shops",
    qualification: emptyCampaignQualificationSettings(),
    audience: "businesses",
    industryId: "home-living",
    industryName: "Home & Living",
    verticalId: "home-furnishings-retailers",
    verticalName: "Home furnishings retailers",
    pickedTags: [],
    runBy: { name: "Aya", pubkey: null },
  };
}

function inMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function fakeProvider(plan) {
  const campaigns = [];
  const listeners = new Set();
  const startedInputs = [];
  const continuedCampaignIds = [];
  const retriedCampaignIds = [];
  const continuationReady = new Set();
  let currentId = null;
  let sequence = 0;

  function current() {
    return campaigns.find((campaign) => campaign.id === currentId) ?? null;
  }

  function publish() {
    for (const listener of listeners) listener(current());
  }

  function patch(id, update) {
    const index = campaigns.findIndex((campaign) => campaign.id === id);
    if (index < 0) return;
    campaigns[index] = { ...campaigns[index], ...update };
    publish();
  }

  return {
    startedInputs,
    continuedCampaignIds,
    retriedCampaignIds,
    listenerCount: () => listeners.size,
    finish(id, status = "complete", failureReason = null, details = {}) {
      patch(id, { status, failureReason, ...details });
    },
    setContinuationReady(id, ready = true) {
      if (ready) continuationReady.add(id);
      else continuationReady.delete(id);
    },
    provider: {
      getCurrent: () => current(),
      getCampaigns: () => campaigns.map((campaign) => ({ ...campaign })),
      getContinuation: () => {
        const campaign = current();
        return campaign ? this.getContinuationFor(campaign.id) : null;
      },
      getContinuationFor(id) {
        const campaign = campaigns.find((entry) => entry.id === id);
        if (!campaign || !continuationReady.has(id)) return null;
        return {
          campaignId: id,
          state: "ready",
          message: null,
          remainingTarget: Math.max(0, campaign.target - campaign.count),
          pagesAtProviderCeiling: 1,
          spentUsd: 0,
          approvedBudgetUsd: campaign.budgetUsd,
          minimumAdditionalBudgetUsd: 0,
          recommendedAdditionalBudgetUsd: 0,
          estimatedPages: 1,
          estimatedCostUsd: 0,
        };
      },
      async select(id) {
        if (!campaigns.some((campaign) => campaign.id === id)) return;
        currentId = id;
        publish();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async start(campaignInput, signal) {
        startedInputs.push(campaignInput);
        const result = await plan(campaignInput, startedInputs.length, signal);
        if (result instanceof Error) throw result;
        sequence += 1;
        const campaign = {
          ...campaignInput,
          id: `campaign-${sequence}`,
          count: 0,
          budgetUsd: 3,
          status: result?.status ?? "running",
          prospectIds: [],
          created: true,
          failureReason: result?.failureReason ?? null,
        };
        campaigns.unshift(campaign);
        currentId = campaign.id;
        publish();
        return { ...campaign };
      },
      async continueCampaignFor(id) {
        continuedCampaignIds.push(id);
        const campaign = campaigns.find((entry) => entry.id === id);
        if (!campaign || !continuationReady.has(id)) {
          throw new Error("This search has no next page.");
        }
        patch(id, { status: "running", endReason: null });
      },
      async continueCampaign() {
        const campaign = current();
        if (campaign) await this.continueCampaignFor(campaign.id);
      },
      async pause() {
        if (current()?.status === "running")
          patch(currentId, { status: "paused" });
      },
      async resume() {
        if (current()?.status === "paused")
          patch(currentId, { status: "running" });
      },
      async resumeCampaign(id) {
        if (
          campaigns.find((campaign) => campaign.id === id)?.status === "paused"
        ) {
          patch(id, { status: "running" });
        }
      },
      async cancel() {
        if (["running", "paused"].includes(current()?.status)) {
          patch(currentId, { status: "cancelled" });
        }
      },
      async retry() {
        if (current()?.status === "failed")
          patch(currentId, { status: "running" });
      },
      async retryCampaign(id) {
        retriedCampaignIds.push(id);
        if (
          campaigns.find((campaign) => campaign.id === id)?.status === "failed"
        ) {
          patch(id, { status: "running", failureReason: null });
        }
      },
    },
  };
}

async function waitFor(assertion, label) {
  const deadline = Date.now() + 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? "timed out"}`);
}

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("stopped", "AbortError"));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => reject(new DOMException("stopped", "AbortError")),
      { once: true },
    );
  });
}

test("multi-city queue starts three cities together and replaces a finished slot in order", async () => {
  const fake = fakeProvider(async () => ({ status: "running" }));
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "queue",
    groupId: () => "group-1",
    cityId: (() => {
      let index = 0;
      return () => `city-${++index}`;
    })(),
  });

  await coordinator.startGroup(
    input([JOHANNESBURG, CAPE_TOWN, DURBAN, PRETORIA]),
  );
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 3),
    "the first three city starts",
  );
  assert.deepEqual(
    fake.startedInputs.map((entry) => entry.location),
    [JOHANNESBURG.label, CAPE_TOWN.label, DURBAN.label],
  );
  assert.equal(
    fake.startedInputs[0].name,
    "Home furnishing prospects · Johannesburg",
  );

  fake.finish("campaign-1");
  await waitFor(
    () =>
      assert.deepEqual(
        fake.startedInputs.map((entry) => entry.location),
        [JOHANNESBURG.label, CAPE_TOWN.label, DURBAN.label, PRETORIA.label],
      ),
    "the fourth city takes the finished slot",
  );
  coordinator.dispose();
});

test("ten cities start exactly three and a completed city starts only the next one", async () => {
  const cities = Array.from({ length: 10 }, (_, index) =>
    place(`City ${index + 1}, Gauteng, South Africa`, -26 - index, 28 + index),
  );
  const fake = fakeProvider(async () => ({ status: "running" }));
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "ten-city-queue",
  });
  await coordinator.startGroup(input(cities));
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 3),
    "only the first three of ten starts",
  );
  assert.deepEqual(
    fake.startedInputs.map((entry) => entry.location),
    cities.slice(0, 3).map((city) => city.label),
  );
  fake.finish("campaign-1");
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 4),
    "the fourth city replaces the completed one",
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fake.startedInputs.length, 4, "one completion starts one city");
  coordinator.dispose();
});

test("an interrupted nine-city 500-per-city group keeps explicit retry records", async () => {
  const storage = inMemoryStorage();
  const cities = Array.from({ length: 9 }, (_, index) =>
    place(`City ${index + 1}, South Africa`, -26 - index, 28 + index),
  );
  const fake = fakeProvider(async (_campaignInput, _attempt, signal) =>
    waitForAbort(signal),
  );
  const initial = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "owner-nine-city-group",
  });
  await initial.startGroup({ ...input(cities), target: 500 });
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 3),
    "the owner group's first three starts",
  );
  initial.dispose();

  // This is the exact durable shape written by develop's interrupted-start
  // reconciliation: its first three in-flight cities became silent
  // not_started records while the other six remained queued.
  const stored = JSON.parse(storage.getItem("owner-nine-city-group"));
  for (const city of stored.groups[0].cities.slice(0, 3)) {
    city.state = "not_started";
    city.reason = null;
    city.retryRequested = false;
  }
  storage.setItem("owner-nine-city-group", JSON.stringify(stored));

  const restored = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "owner-nine-city-group",
  });
  const group = restored.getGroups()[0];
  assert.ok(group);
  assert.deepEqual(
    group.cities.slice(0, 3).map((city) => ({
      campaignId: city.campaignId,
      reason: city.reason,
      state: city.state,
    })),
    Array.from({ length: 3 }, () => ({
      campaignId: null,
      reason: START_INTERRUPTED_MESSAGE,
      state: "failed",
    })),
  );
  assert.deepEqual(
    group.cities.slice(3).map((city) => city.state),
    Array.from({ length: 6 }, () => "waiting"),
  );
  restored.dispose();
});

test("a stalled city start reaches a bounded visible retry state", async () => {
  const timeouts = [];
  const fake = fakeProvider(async (_campaignInput, _attempt, signal) =>
    waitForAbort(signal),
  );
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "bounded-start",
    sleep: async () => {},
    startTimeout: async (milliseconds, signal) => {
      if (signal.aborted) throw new DOMException("stopped", "AbortError");
      timeouts.push(milliseconds);
    },
  });
  await coordinator.startGroup(input([JOHANNESBURG, CAPE_TOWN]));
  await waitFor(
    () =>
      assert.deepEqual(
        coordinator.getGroups()[0]?.cities.map((city) => city.state),
        ["failed", "failed"],
      ),
    "the bounded start failures",
  );
  const cities = coordinator.getGroups()[0]?.cities;
  assert.deepEqual(
    cities?.map((city) => city.reason),
    [START_TIMEOUT_MESSAGE, START_TIMEOUT_MESSAGE],
  );
  assert.equal(fake.startedInputs.length, 8);
  assert.deepEqual(
    timeouts,
    Array.from({ length: 8 }, () => START_ATTEMPT_TIMEOUT_MS),
  );
  coordinator.dispose();
});

test("two selected cities begin together", async () => {
  const fake = fakeProvider(async () => ({ status: "running" }));
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "two-city-queue",
  });
  await coordinator.startGroup(input([JOHANNESBURG, CAPE_TOWN]));
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 2),
    "both selected cities begin immediately",
  );
  coordinator.dispose();
});

test("a pause keeps its slot, a different completion fills only its free slot, and cancel replaces its own slot", async () => {
  const fake = fakeProvider(async () => ({ status: "running" }));
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "queue",
    groupId: () => "group-1",
    cityId: (() => {
      let index = 0;
      return () => `city-${++index}`;
    })(),
  });

  await coordinator.startGroup(
    input([JOHANNESBURG, CAPE_TOWN, DURBAN, PRETORIA]),
  );
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 3),
    "the initial three city starts",
  );

  await coordinator.performAction("campaign-1", "pause");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    fake.startedInputs.length,
    3,
    "a pause buys no replacement page",
  );

  fake.finish("campaign-2");
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 4),
    "one completed running city frees one slot beside the paused city",
  );
  assert.equal(
    fake.startedInputs[3]?.location,
    PRETORIA.label,
    "the next city remains ordered",
  );
  coordinator.dispose();

  const cancelFake = fakeProvider(async () => ({ status: "running" }));
  const cancelCoordinator = createMultiCityDiscoveryCoordinator({
    provider: cancelFake.provider,
    storage: inMemoryStorage(),
    storageKey: "cancel-queue",
  });
  await cancelCoordinator.startGroup(
    input([JOHANNESBURG, CAPE_TOWN, DURBAN, PRETORIA]),
  );
  await waitFor(
    () => assert.equal(cancelFake.startedInputs.length, 3),
    "the three cancellable city starts",
  );
  await cancelCoordinator.performAction("campaign-1", "cancel");
  await waitFor(
    () => assert.equal(cancelFake.startedInputs.length, 4),
    "cancelling a city frees exactly one slot",
  );
  cancelCoordinator.dispose();
});

test("resuming an interrupted group restores its scheduler without an automatic restart", async () => {
  const storage = inMemoryStorage();
  const fake = fakeProvider(async () => ({ status: "running" }));
  const initial = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "restart-queue",
  });
  await initial.startGroup(input([JOHANNESBURG, CAPE_TOWN, DURBAN, PRETORIA]));
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 3),
    "the initial city starts",
  );
  await initial.performAction("campaign-1", "pause");
  initial.dispose();

  // The finished campaign is a persisted external fact while the app is away.
  // Reconstructing the coordinator must not spend on Pretoria by itself.
  fake.finish("campaign-2");
  const restored = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "restart-queue",
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    fake.startedInputs.length,
    3,
    "restart did not start a paid city",
  );

  await restored.performAction("campaign-1", "resume");
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 4),
    "the owner resume lets the fourth city take the open slot",
  );
  restored.dispose();
});

test("a city-only start failure is recorded and the queue continues", async () => {
  const fake = fakeProvider(async (_input, call) => {
    if (call === 1) return new Error("No matching businesses in this area.");
    return { status: "running" };
  });
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "queue",
    groupId: () => "group-1",
  });

  await coordinator.startGroup(
    input([JOHANNESBURG, CAPE_TOWN, DURBAN, PRETORIA]),
  );
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 4),
    "the next city starts after one city alone fails",
  );
  await waitFor(() => {
    const fourthCity = (
      coordinator.getGroup("group-1") ?? coordinator.getGroups()[0]
    )?.cities[3];
    assert.ok(fourthCity?.campaignId, "the fourth city campaign is recorded");
    assert.equal(fourthCity.state, "waiting");
  }, "the fourth city campaign is recorded after its start settles");
  const group = coordinator.getGroup("group-1") ?? coordinator.getGroups()[0];
  assert.ok(group);
  assert.deepEqual(
    fake.startedInputs.map((entry) => entry.location).slice(0, 3),
    [JOHANNESBURG.label, CAPE_TOWN.label, DURBAN.label],
  );
  assert.equal(group.cities[0].state, "failed");
  assert.ok(group.cities[3].campaignId);
  coordinator.dispose();
});

test("a global start failure blocks remaining cities and restored groups do not restart", async () => {
  const storage = inMemoryStorage();
  let blocked = true;
  const fake = fakeProvider(async (_input, call) =>
    blocked && call > 1
      ? new Error("Discovery server is not configured for this community.")
      : { status: "running" },
  );
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "queue",
    groupId: () => "group-1",
  });

  await coordinator.startGroup(input([JOHANNESBURG, CAPE_TOWN]));
  await waitFor(
    () => assert.ok(coordinator.getGroup("group-1")?.blockedReason),
    "the global failure block",
  );
  const group = coordinator.getGroup("group-1");
  assert.ok(group);
  assert.match(group.blockedReason ?? "", /not configured/i);
  assert.equal(group.cities[0].campaignId, "campaign-1");
  assert.equal(
    fake.provider.getCampaigns()[0]?.status,
    "running",
    "a setup error does not stop a city that was already running",
  );
  assert.equal(fake.startedInputs.length, 2);
  coordinator.dispose();

  const restored = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "queue",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.startedInputs.length, 2);
  blocked = false;
  await restored.retryGroup("group-1");
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 3),
    "the owner-requested retry",
  );
  restored.dispose();
});

test("passing start errors retry at 5, 20, and 60 seconds, while permanent errors do not", async () => {
  const waits = [];
  assert.equal(
    isPassingStartError(new Error("Timed out while loading channel history.")),
    true,
  );
  assert.equal(
    isPassingStartError(
      new DiscoverySearchError("The provider is unavailable.", {
        code: "discovery_provider_unavailable",
      }),
    ),
    true,
  );
  assert.equal(isPassingStartError(new TypeError("Failed to fetch")), true);
  assert.equal(isPassingStartError(new Error("socket hang up")), true);
  assert.equal(
    isPassingStartError(
      new DiscoverySearchError("Gateway timeout.", { status: 504 }),
    ),
    true,
  );
  for (const message of [
    "Discovery server is not configured for this community.",
    "The prospect search provider has no credits left.",
    "Your monthly prospect limit has been reached.",
    "You are signed out.",
    "You are not allowed to use Sales.",
  ]) {
    assert.equal(isPassingStartError(new Error(message)), false, message);
  }

  const fake = fakeProvider(async (campaignInput) => {
    if (campaignInput.location === JOHANNESBURG.label) {
      const attempts = fake.startedInputs.filter(
        (entry) => entry.location === JOHANNESBURG.label,
      ).length;
      if (attempts <= 3) {
        return new Error("Timed out while loading channel history.");
      }
    }
    return { status: "running" };
  });
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "queue",
    sleep: async (ms, signal) => {
      if (signal.aborted) throw new DOMException("stopped", "AbortError");
      waits.push(ms);
    },
  });

  await coordinator.startGroup(input([JOHANNESBURG, CAPE_TOWN]));
  await waitFor(
    () =>
      assert.equal(
        fake.startedInputs.filter(
          (entry) => entry.location === JOHANNESBURG.label,
        ).length,
        4,
      ),
    "all three passing-error retries",
  );
  assert.deepEqual(
    waits,
    START_RETRY_DELAYS_SECONDS.map((seconds) => seconds * 1_000),
  );
  const group = coordinator.getGroups()[0];
  assert.equal(group.cities[0].campaignId, "campaign-2");
  assert.equal(group.cities[0].state, "waiting");
  coordinator.dispose();
});

test("a failed city shows a fresh-start retry, while a failed campaign retries the same campaign", async () => {
  let failFirstStart = true;
  const fake = fakeProvider(async (campaignInput) => {
    if (campaignInput.location === JOHANNESBURG.label && failFirstStart) {
      failFirstStart = false;
      return new Error("No matching businesses in this area.");
    }
    return { status: "running" };
  });
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "queue",
  });
  await coordinator.startGroup(input([JOHANNESBURG, CAPE_TOWN]));
  await waitFor(
    () => assert.equal(coordinator.getGroups()[0].cities[0].state, "failed"),
    "the pre-campaign failure",
  );
  const groupId = coordinator.getGroups()[0].groupId;
  await coordinator.retryCity(
    groupId,
    coordinator.getGroups()[0].cities[0].cityId,
  );
  await waitFor(
    () =>
      assert.equal(
        coordinator.getGroups()[0].cities[0].campaignId,
        "campaign-2",
      ),
    "a new campaign after the start failure",
  );
  const firstCampaign = coordinator.getGroups()[0].cities[0].campaignId;
  fake.finish(firstCampaign, "failed", "The provider stopped.");
  await waitFor(
    () =>
      assert.equal(
        coordinator.getGroups()[0].cities[0].campaignId,
        firstCampaign,
      ),
    "the existing campaign remains attached",
  );
  await coordinator.retryCity(
    groupId,
    coordinator.getGroups()[0].cities[0].cityId,
  );
  await waitFor(
    () => assert.deepEqual(fake.retriedCampaignIds, [firstCampaign]),
    "the campaign retry",
  );
  assert.equal(
    coordinator.getGroups()[0].cities[0].campaignId,
    firstCampaign,
    "a campaign failure never creates a second campaign",
  );
  coordinator.dispose();
});

test("automatic continuation keeps a city slot, uses at most three attempts, and skips terminal reasons", async () => {
  const fake = fakeProvider(async () => ({ status: "running" }));
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "queue",
  });
  await coordinator.startGroup(
    input([JOHANNESBURG, CAPE_TOWN, DURBAN, PRETORIA]),
  );
  await waitFor(
    () => assert.equal(fake.startedInputs.length, 3),
    "the three occupied slots",
  );
  const firstId = "campaign-1";
  fake.setContinuationReady(firstId);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    fake.finish(firstId, "complete", null, {
      count: 20,
      target: 100,
      endReason: "approved_budget",
    });
    await waitFor(
      () => assert.equal(fake.continuedCampaignIds.length, attempt),
      `automatic continuation ${attempt}`,
    );
    assert.equal(
      fake.startedInputs.length,
      3,
      "a continuation holds its slot instead of launching a fourth city",
    );
  }
  fake.finish(firstId, "complete", null, {
    count: 20,
    target: 100,
    endReason: "approved_budget",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.continuedCampaignIds.length, 3);

  const secondId = "campaign-2";
  fake.setContinuationReady(secondId);
  fake.finish(secondId, "complete", null, {
    count: 20,
    target: 100,
    endReason: "provider_end",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    fake.continuedCampaignIds.filter((id) => id === secondId).length,
    0,
    "provider-end completion remains done",
  );
  coordinator.dispose();
});

test("duplicate places are ignored and total provider budget includes every city", () => {
  const locations = uniqueLocations([
    JOHANNESBURG,
    { ...JOHANNESBURG },
    CAPE_TOWN,
  ]);
  assert.deepEqual(
    locations.map((location) => location.label),
    [JOHANNESBURG.label, CAPE_TOWN.label],
  );
  assert.equal(
    groupProviderBudgetUsd({ target: 100, cities: [{}, {}, {}] }, 0.01),
    3,
  );
});

test("city campaign names retain the short city name within the relay limit", () => {
  const name = "A".repeat(120);
  const cityName = campaignNameForCity(
    name,
    "Cape Town, Western Cape, South Africa",
  );

  assert.equal(cityName.length, 120);
  assert.match(cityName, / · Cape Town$/);
});

test("community reset disposes the old multi-city coordinator", () => {
  resetMultiCityDiscoveryRuntime();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const storage = inMemoryStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
    writable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
    writable: true,
  });
  const fake = fakeProvider(async () => ({ status: "running" }));

  try {
    storage.setItem("buzz-active-community-id", "community-one");
    const first = getMultiCityDiscoveryCoordinator(fake.provider);
    assert.ok(first);
    assert.equal(fake.listenerCount(), 1);

    storage.setItem("buzz-active-community-id", "community-two");
    const second = getMultiCityDiscoveryCoordinator(fake.provider);
    assert.ok(second);
    assert.notEqual(second, first);
    assert.equal(fake.listenerCount(), 1);

    resetMultiCityDiscoveryRuntime();
    assert.equal(fake.listenerCount(), 0);
  } finally {
    resetMultiCityDiscoveryRuntime();
    if (originalWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", originalWindow);
    if (originalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", originalStorage);
  }
});
