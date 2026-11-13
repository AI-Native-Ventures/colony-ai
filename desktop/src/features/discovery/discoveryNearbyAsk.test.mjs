// When the place the owner chose runs out before the target, the search stops
// and asks. It never enters a nearby area by itself. One yes covers the nearby
// areas, nearest first, in the same campaign.
//
// Owner incident, 13 Nov 2026: "Real Estate Agents and Brokers" in Durban,
// 200 asked. Maps listed 107 there, so the run ended at 68 new leads and the
// only way on was a row of links that each started a separate campaign.
import assert from "node:assert/strict";
import test from "node:test";

import { parseStoredState } from "./discoveryCampaignStore.ts";
import { createDiscoveryController } from "./realDiscoveryProvider.ts";

const OWNER = "a".repeat(64);

function suburb(label, latitude, longitude) {
  return {
    label,
    latitude,
    longitude,
    countryCode: "ZA",
    region: "KwaZulu-Natal",
    kind: "suburb",
    boundingBox: null,
  };
}

const DURBAN = "Durban, KwaZulu-Natal, South Africa";
const UMHLANGA = "Umhlanga, KwaZulu-Natal, South Africa";
const PINETOWN = "Pinetown, KwaZulu-Natal, South Africa";
const BALLITO = "Ballito, KwaZulu-Natal, South Africa";

const INPUT = {
  name: "Durban estate agents",
  audience: "businesses",
  industryId: "real-estate",
  industryName: "Real Estate",
  verticalId: "real-estate-agents-and-brokers",
  verticalName: "Real Estate Agents and Brokers",
  location: DURBAN,
  locationSelection: {
    label: DURBAN,
    latitude: -29.8587,
    longitude: 31.0218,
    countryCode: "ZA",
    region: "KwaZulu-Natal",
    kind: "city",
    boundingBox: null,
    // The order the geocoder offered them in, which is not by distance.
    nearby: [
      suburb(BALLITO, -29.539, 31.2144),
      suburb(UMHLANGA, -29.7256, 31.0849),
      suburb(PINETOWN, -29.8167, 30.85),
    ],
  },
  target: 200,
  criteria: "",
};

/** How many businesses Maps lists for the search in each area. */
const LISTED = {
  [DURBAN]: 107,
  [UMHLANGA]: 30,
  [PINETOWN]: 60,
  [BALLITO]: 100,
};

function place(area, n) {
  const short = area.split(",")[0];
  return {
    placeId: `${short}-${n}`,
    name: `${short} Estates ${n}`,
    category: "Real estate agency",
    subtypes: null,
    address: `${n} Main Road`,
    city: short,
    state: "KwaZulu-Natal",
    country: "South Africa",
    phone: "+27 31 555 0100",
    website: null,
    email: null,
    rating: 4.5,
    reviews: 10,
    latitude: null,
    longitude: null,
    mapsUrl: null,
    description: null,
    businessStatus: null,
  };
}

/** One 20-place page of an area's list, as the relay returns it. */
function areaPage(request, listed = LISTED) {
  const total = listed[request.location] ?? 0;
  const from = request.skip;
  const count = Math.max(0, Math.min(20, total - from));
  return {
    provider: "outscraper",
    places: Array.from({ length: count }, (_, index) =>
      place(request.location, from + index + 1),
    ),
    estimatedCostUsd: count > 0 ? 0.06 : 0,
    nextSkip: from + 20 < total ? from + 20 : null,
  };
}

function harness(options = {}) {
  const storageMap = options.storageMap ?? new Map();
  const log = { searches: [], publishes: [], posts: [] };
  const context = {
    channelId: "sales-channel",
    communityId: "community-1",
    pubkey: OWNER,
    displayName: "Basheer",
    existingProspectIds: new Set(),
    existingNames: new Set(),
  };
  let ids = options.firstId ?? 0;
  const controller = createDiscoveryController({
    storage: {
      getItem: (key) => storageMap.get(key) ?? null,
      setItem: (key, value) => {
        storageMap.set(key, value);
      },
    },
    storageKey: "test-key",
    nowSeconds: () => 1_700_000_000,
    newId: () => {
      ids += 1;
      return `camp-${ids}`;
    },
    sleep: async () => {},
    getOwnerPubkey: async () => OWNER,
    resolveContext: async () => context,
    search: async (request) => {
      log.searches.push(request);
      return areaPage(request, options.listed);
    },
    prospectId: async (candidate) => `id-${candidate.placeId}`,
    publishProspect: async (input) => {
      log.publishes.push(input.changes);
    },
    postToSales: async (input) => {
      log.posts.push(input.content);
    },
    leadLink: (id) => `buzz://lead/${id}`,
  });
  return { controller, log, storageMap };
}

function stored(storageMap) {
  return parseStoredState(storageMap.get("test-key") ?? null);
}

/** The areas asked for, in order, each named once per run of requests. */
function areasAsked(log) {
  const areas = [];
  for (const request of log.searches) {
    if (areas.at(-1) !== request.location) areas.push(request.location);
  }
  return areas;
}

/** Page offsets that returned businesses for one area, in the order asked. */
function pagesAsked(log, area) {
  return log.searches
    .filter((request) => request.location === area)
    .map((request) => request.skip);
}

test("the chosen place runs out: the search stops and asks, and searches no other area", async () => {
  const { controller, log, storageMap } = harness();
  await controller.start(INPUT);
  await controller.whenIdle();

  const ended = controller.getCurrent();
  assert.equal(ended.status, "complete");
  assert.equal(ended.endReason, "provider_end");
  assert.equal(ended.count, 107);
  assert.deepEqual(
    areasAsked(log),
    [DURBAN],
    "no nearby area is searched without the owner's yes",
  );
  assert.deepEqual(ended.areasSearched, [DURBAN]);
  assert.deepEqual(
    ended.nearbyAreasLeft,
    [UMHLANGA, PINETOWN, BALLITO],
    "nearby areas are offered nearest first",
  );
  assert.equal(stored(storageMap).campaigns[0].nearbyApproved, false);

  const ask = controller.getContinuation();
  assert.equal(ask.state, "ready");
  assert.deepEqual(ask.nearbyAreas, [UMHLANGA, PINETOWN, BALLITO]);
  assert.equal(ask.remainingTarget, 93);

  // Opening the app again must not turn the question into a yes.
  const reopened = harness({ storageMap });
  await reopened.controller.whenIdle();
  assert.equal(reopened.controller.getCurrent().status, "complete");
  assert.deepEqual(reopened.log.searches, []);
});

test("one yes continues in the same campaign through the nearby areas, nearest first", async () => {
  const { controller, log, storageMap } = harness();
  await controller.start(INPUT);
  await controller.whenIdle();
  const campaignId = controller.getCurrent().id;
  log.searches.length = 0;

  await controller.continueCampaign();
  await controller.whenIdle();

  // The yes covers the pages the other 93 need: five. Two finish Umhlanga,
  // three finish Pinetown, then the approved results are used.
  const paused = controller.getCurrent();
  assert.equal(paused.id, campaignId, "no second campaign is created");
  assert.equal(stored(storageMap).campaigns.length, 1);
  assert.equal(paused.status, "complete");
  assert.equal(paused.endReason, "approved_budget");
  assert.equal(paused.count, 107 + 30 + 60);
  assert.deepEqual(
    areasAsked(log),
    [UMHLANGA, PINETOWN],
    "Umhlanga ran out and Pinetown followed without a second question",
  );
  assert.equal(pagesAsked(log, UMHLANGA)[0], 0, "a new area starts at page 1");
  assert.equal(pagesAsked(log, PINETOWN)[0], 0);
  assert.deepEqual(
    paused.areasSearched,
    [DURBAN, UMHLANGA, PINETOWN],
    "Ballito is next, but no page was fetched there, so it is not listed",
  );
  assert.deepEqual(
    paused.runLog.map((entry) => entry.area),
    [
      ...Array(6).fill(DURBAN),
      ...Array(2).fill(UMHLANGA),
      ...Array(3).fill(PINETOWN),
    ],
  );

  // The approved results are used, so it asks again. That yes continues in
  // Ballito until the 200 are found.
  log.searches.length = 0;
  await controller.continueCampaign();
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.id, campaignId);
  assert.equal(done.status, "complete");
  assert.equal(done.endReason, "target_reached");
  assert.equal(done.count, 200);
  assert.deepEqual(areasAsked(log), [BALLITO]);
  assert.equal(pagesAsked(log, BALLITO)[0], 0);
  assert.deepEqual(done.areasSearched, [DURBAN, UMHLANGA, PINETOWN, BALLITO]);

  const ids = log.publishes.map((changes) => changes.prospectId);
  assert.equal(new Set(ids).size, ids.length, "nothing is saved twice");
  assert.equal(ids.length, 200);
});

test("after a restart the campaign continues in the nearby area it had reached", async () => {
  // Pinetown lists 100 here, so the approved pages run out in the middle of it.
  const listed = { ...LISTED, [PINETOWN]: 100 };
  const first = harness({ listed });
  await first.controller.start(INPUT);
  await first.controller.whenIdle();
  await first.controller.continueCampaign();
  await first.controller.whenIdle();
  assert.deepEqual(first.controller.getCurrent().areasSearched, [
    DURBAN,
    UMHLANGA,
    PINETOWN,
  ]);
  first.controller.dispose();

  const second = harness({
    storageMap: first.storageMap,
    firstId: 10,
    listed,
  });
  await second.controller.whenIdle();
  const reopened = second.controller.getCurrent();
  assert.deepEqual(reopened.areasSearched, [DURBAN, UMHLANGA, PINETOWN]);
  assert.equal(reopened.endReason, "approved_budget");
  assert.deepEqual(second.log.searches, [], "reopening searches nothing");

  await second.controller.continueCampaign();
  await second.controller.whenIdle();
  assert.equal(second.log.searches[0].location, PINETOWN);
  assert.equal(second.log.searches[0].skip, 60);
  assert.equal(second.log.searches[0].coordinates.latitude, -29.8167);
  assert.ok(
    second.log.searches.every((request) => request.location !== DURBAN),
    "Durban is not searched again",
  );
});

test("when every nearby area has run out too, the search says so and offers nothing more", async () => {
  // 107 + 30 + 20 + 10 is fewer than the 200 asked for.
  const listed = { ...LISTED, [PINETOWN]: 20, [BALLITO]: 10 };
  const { controller, log } = harness({ listed });
  await controller.start(INPUT);
  await controller.whenIdle();
  await controller.continueCampaign();
  await controller.whenIdle();

  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.endReason, "provider_end");
  assert.equal(done.count, 167);
  assert.deepEqual(areasAsked(log).slice(1), [UMHLANGA, PINETOWN, BALLITO]);
  assert.deepEqual(done.nearbyAreasLeft, []);
  const ask = controller.getContinuation();
  assert.equal(ask.state, "unavailable");
  assert.equal(ask.nearbyAreas, undefined);
  assert.match(ask.message, /or its nearby areas/);
  await assert.rejects(controller.continueCampaign(), /nearby areas/);
});

test("a place with no nearby areas ends as before, with nothing to continue into", async () => {
  const { controller, log } = harness();
  await controller.start({
    ...INPUT,
    locationSelection: { ...INPUT.locationSelection, nearby: undefined },
  });
  await controller.whenIdle();

  const done = controller.getCurrent();
  assert.equal(done.endReason, "provider_end");
  assert.deepEqual(done.nearbyAreasLeft, []);
  assert.equal(controller.getContinuation().state, "unavailable");
  assert.deepEqual(areasAsked(log), [DURBAN]);
});

test("a nearby area an earlier search already finished is not bought again", async () => {
  const { controller, log } = harness();
  // The owner searched Umhlanga by itself first, to its end.
  await controller.start({
    ...INPUT,
    name: "Umhlanga estate agents",
    location: UMHLANGA,
    locationSelection: suburb(UMHLANGA, -29.7256, 31.0849),
    target: 100,
  });
  await controller.whenIdle();
  assert.equal(controller.getCurrent().endReason, "provider_end");

  await controller.start(INPUT);
  await controller.whenIdle();
  log.searches.length = 0;
  await controller.continueCampaign();
  await controller.whenIdle();

  assert.ok(
    log.searches.every((request) => request.location !== UMHLANGA),
    "Umhlanga was covered to its end, so the yes goes straight to Pinetown",
  );
  assert.equal(log.searches[0].location, PINETOWN);
  assert.ok(
    !controller.getCurrent().areasSearched.includes(UMHLANGA),
    "an area this campaign fetched nothing from is not listed as searched",
  );
});
