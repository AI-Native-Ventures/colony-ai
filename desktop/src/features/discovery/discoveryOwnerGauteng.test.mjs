// A province must not come back with five businesses.
//
// Owner incident, 14 Nov 2026, Colony 3.0.57: "Furniture & Upholstery Repair
// Businesses" in Gauteng, 200 asked, "Found 5 of 200. Gauteng has no more."
// His page log: one page, 8 places, provider_end. The same day Sandton gave
// 20 then 0, Kempton Park 15, Johannesburg 25.
//
// Measured on the live provider that evening:
// - the catalogue label as written, whole province: 2 places;
// - the label pinned to one window around the province's centre point (what
//   the app sent): 8 to 20, all around Midrand, then the end;
// - "upholstery" or "upholsterers" for the whole province: full pages, still
//   a full page at offset 100, across Pretoria, Johannesburg, Randburg,
//   Alberton, Boksburg.
//
// These tests replay that search against a Maps that answers the way the
// real one did, through the same controller the app runs.
import assert from "node:assert/strict";
import test from "node:test";

import { parseStoredState } from "./discoveryCampaignStore.ts";
import { createDiscoveryController } from "./realDiscoveryProvider.ts";

const OWNER = "a".repeat(64);
const GAUTENG = "Gauteng, South Africa";
const LABEL = "Furniture & Upholstery Repair Businesses";

const INPUT = {
  name: `${LABEL} prospects in Gauteng`,
  audience: "businesses",
  industryId: "furniture",
  industryName: "Furniture",
  verticalId: "furniture-and-upholstery-repair-businesses",
  verticalName: LABEL,
  location: GAUTENG,
  // Exactly what the place picker stored for him: a region, one centre
  // point (it is in Midrand), no nearby areas.
  locationSelection: {
    label: GAUTENG,
    latitude: -25.9363439,
    longitude: 28.0813105,
    countryCode: "ZA",
    region: null,
    kind: "region",
    boundingBox: null,
  },
  target: 200,
  criteria: "",
};

function range(prefix, from, to) {
  return Array.from(
    { length: to - from + 1 },
    (_, index) => `${prefix}${from + index}`,
  );
}

/**
 * What Maps lists across the province for each plain word, best first. The
 * words overlap the way real ones do: the top of "upholsterers" is the same
 * businesses "Furniture Upholstery Repair" already found.
 */
const PROVINCE = {
  "furniture upholstery repair": range("A", 1, 60),
  upholsterers: [...range("A", 1, 20), ...range("U", 1, 130)],
  "furniture reupholstery": [...range("A", 21, 40), ...range("R", 1, 20)],
  "furniture repairers": range("F", 1, 60),
  "furniture restoration": range("S", 1, 30),
};
/** The 8 businesses around the centre point that the old request found. */
const AROUND_THE_CENTRE = range("A", 1, 8);

function place(id) {
  return {
    placeId: id,
    name: `Upholstery ${id}`,
    category: "Upholstery shop",
    subtypes: null,
    address: `${id} Main Road`,
    city: "Johannesburg",
    state: "Gauteng",
    country: "South Africa",
    phone: "+27 11 555 0100",
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

function page(ids, skip) {
  const slice = ids.slice(skip, skip + 20);
  return {
    provider: "outscraper",
    places: slice.map(place),
    estimatedCostUsd: Math.round(slice.length * 0.003 * 10_000) / 10_000,
    nextSkip: skip + 20 < ids.length ? skip + 20 : null,
  };
}

/** Maps as measured: a point pins the search to one window; a label finds 2. */
function maps(request, listed = PROVINCE) {
  if (request.coordinates) return page(AROUND_THE_CENTRE, request.skip);
  if (request.query === LABEL) return page(range("A", 1, 2), request.skip);
  return page(listed[request.query.toLowerCase()] ?? [], request.skip);
}

function harness(options = {}) {
  const storageMap = new Map();
  const log = { searches: [], publishes: [] };
  const context = {
    channelId: "sales-channel",
    communityId: "community-1",
    pubkey: OWNER,
    displayName: "Basheer",
    existingProspectIds: new Set(),
    existingNames: new Set(),
  };
  let ids = 0;
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
      return maps(request, options.listed);
    },
    prospectId: async (candidate) => `id-${candidate.placeId}`,
    publishProspect: async (input) => {
      log.publishes.push(input.changes);
    },
    postToSales: async () => {},
    leadLink: (id) => `buzz://lead/${id}`,
  });
  return { controller, log, storageMap };
}

function wordsAsked(log) {
  const words = [];
  for (const request of log.searches) {
    if (words.at(-1) !== request.query) words.push(request.query);
  }
  return words;
}

test("a province search reaches its 200 instead of stopping at the few around its centre point", async () => {
  const { controller, log, storageMap } = harness();
  await controller.start(INPUT);
  await controller.whenIdle();

  // The first approval buys ten pages: all of the first word, then the
  // second word past its repeated first page.
  const first = controller.getCurrent();
  assert.ok(
    first.count >= 150,
    `the first approved pages found ${first.count}, not the 5 of the incident`,
  );
  assert.equal(first.endReason, "approved_budget");
  assert.ok(
    log.searches.every((request) => request.coordinates === undefined),
    "no search is pinned to one point of the province",
  );
  assert.ok(
    log.searches.every((request) => request.query !== LABEL),
    "Maps is never asked for the catalogue's formal label",
  );
  assert.ok(log.searches.every((request) => request.location === GAUTENG));
  assert.deepEqual(wordsAsked(log), [
    "Furniture Upholstery Repair",
    "upholsterers",
  ]);

  // Saying yes to more results finishes it, in the same campaign and
  // province. Each yes approves the pages the missing leads need, so the
  // tail of one word and the start of the next can take a second yes.
  for (let yes = 0; yes < 3; yes += 1) {
    if (controller.getCurrent().endReason === "target_reached") break;
    await controller.continueCampaign();
    await controller.whenIdle();
  }
  const done = controller.getCurrent();
  assert.equal(done.id, first.id);
  assert.equal(done.count, 200);
  assert.equal(done.endReason, "target_reached");
  assert.ok(log.searches.every((request) => request.location === GAUTENG));
  assert.ok(log.searches.every((request) => request.coordinates === undefined));
  const saved = log.publishes.map((changes) => changes.prospectId);
  assert.equal(new Set(saved).size, saved.length, "nothing is saved twice");
  assert.equal(saved.length, 200);

  const stored = parseStoredState(storageMap.get("test-key")).campaigns[0];
  assert.deepEqual(stored.searchWords, [
    "Furniture Upholstery Repair",
    "upholsterers",
    "furniture reupholstery",
    "furniture repairers",
    "furniture restoration",
  ]);
  assert.ok(
    stored.pageLog.every((entry) => typeof entry.word === "string"),
    "every page records the word Maps was asked for",
  );
});

test("one page of businesses already found does not end a word that has new ones behind it", async () => {
  const { controller, log } = harness();
  await controller.start(INPUT);
  await controller.whenIdle();
  const upholsterers = log.searches
    .filter((request) => request.query === "upholsterers")
    .map((request) => request.skip);
  assert.equal(upholsterers[0], 0);
  assert.ok(
    upholsterers.includes(20),
    "its first page repeated the first word's businesses and it went on",
  );
});

test("when every word runs out before the target the search ends honestly, each word asked once", async () => {
  const listed = {
    "furniture upholstery repair": range("A", 1, 12),
    upholsterers: [...range("A", 1, 12), ...range("U", 1, 5)],
    "furniture reupholstery": range("A", 1, 6),
    "furniture repairers": range("F", 1, 9),
    "furniture restoration": [],
  };
  const { controller, log } = harness({ listed });
  await controller.start(INPUT);
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 12 + 5 + 9);
  assert.equal(done.endReason, "provider_end");
  assert.deepEqual(wordsAsked(log), [
    "Furniture Upholstery Repair",
    "upholsterers",
    "furniture reupholstery",
    "furniture repairers",
    "furniture restoration",
  ]);
  assert.deepEqual(
    log.searches.map((request) => `${request.query} @${request.skip}`),
    [
      "Furniture Upholstery Repair @0",
      "upholsterers @0",
      "furniture reupholstery @0",
      "furniture repairers @0",
      "furniture restoration @0",
    ],
    "five short lists are five requests: none asked twice, none asked ahead",
  );
});
