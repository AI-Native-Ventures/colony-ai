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
    listenerCount: () => listeners.size,
    finish(id, status = "complete", failureReason = null) {
      patch(id, { status, failureReason });
    },
    provider: {
      getCurrent: () => current(),
      getCampaigns: () => campaigns.map((campaign) => ({ ...campaign })),
      getContinuation: () => null,
      async select(id) {
        if (!campaigns.some((campaign) => campaign.id === id)) return;
        currentId = id;
        publish();
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async start(campaignInput) {
        startedInputs.push(campaignInput);
        const result = await plan(campaignInput, startedInputs.length);
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
      async pause() {
        if (current()?.status === "running")
          patch(currentId, { status: "paused" });
      },
      async resume() {
        if (current()?.status === "paused")
          patch(currentId, { status: "running" });
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

test("multi-city queue starts cities in order and continues after a completed city", async () => {
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

  const group = await coordinator.startGroup(input());
  assert.deepEqual(
    fake.startedInputs.map((entry) => entry.location),
    [JOHANNESBURG.label],
  );
  assert.equal(group.cities[0].campaignId, "campaign-1");
  assert.equal(
    fake.startedInputs[0].name,
    "Home furnishing prospects · Johannesburg",
  );

  fake.finish("campaign-1");
  await waitFor(
    () =>
      assert.deepEqual(
        fake.startedInputs.map((entry) => entry.location),
        [JOHANNESBURG.label, CAPE_TOWN.label],
      ),
    "the next city starts after the first completes",
  );
  coordinator.dispose();
});

test("a city-only start failure is recorded and the queue continues", async () => {
  const fake = fakeProvider(async (_input, call) => {
    if (call === 1) return { status: "complete" };
    if (call === 2) return new Error("No matching businesses in this area.");
    return { status: "running" };
  });
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage: inMemoryStorage(),
    storageKey: "queue",
  });

  const group = await coordinator.startGroup(input());
  assert.deepEqual(
    fake.startedInputs.map((entry) => entry.location),
    [JOHANNESBURG.label, CAPE_TOWN.label, DURBAN.label],
  );
  assert.equal(group.cities[1].state, "failed");
  assert.equal(group.cities[2].campaignId, "campaign-2");
  coordinator.dispose();
});

test("a global start failure blocks remaining cities and restored groups do not restart", async () => {
  const storage = inMemoryStorage();
  let blocked = true;
  const fake = fakeProvider(async () =>
    blocked
      ? new Error("Discovery server is not configured for this community.")
      : { status: "running" },
  );
  const coordinator = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "queue",
    groupId: () => "group-1",
  });

  const group = await coordinator.startGroup(input([JOHANNESBURG, CAPE_TOWN]));
  assert.match(group.blockedReason ?? "", /not configured/i);
  assert.deepEqual(
    group.cities.map((city) => city.state),
    ["not_started", "not_started"],
  );
  assert.equal(fake.startedInputs.length, 1);
  coordinator.dispose();

  const restored = createMultiCityDiscoveryCoordinator({
    provider: fake.provider,
    storage,
    storageKey: "queue",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.startedInputs.length, 1);
  blocked = false;
  await restored.retryGroup("group-1");
  assert.equal(fake.startedInputs.length, 2);
  restored.dispose();
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
