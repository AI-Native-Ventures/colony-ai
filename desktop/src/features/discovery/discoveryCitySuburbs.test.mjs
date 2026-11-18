// A big city is searched as a whole, then suburb by suburb.
//
// Owner question, 18 Nov 2026: "when I search for businesses in an entire city
// I get less than 200". His last 20 campaigns: 18 ended because Maps had no
// more for the whole-city search (Johannesburg plumbers 96, locksmiths 99).
// Google ends one search at about 100 to 150 places. One page each for
// Sandton, Soweto and Randburg found 48 plumbers the whole-city search missed.
//
// These tests drive the production controller with a stand-in Maps that
// lists places per (word, place) the way the provider does.
import assert from "node:assert/strict";
import test from "node:test";

import { canFindMore, runDescription } from "./CampaignHelpers.ts";
import { MAX_PAGES } from "./discoveryCampaignContinuation.ts";
import { suburbsOf } from "./discoveryCityAreas.ts";
import { parseStoredState } from "./discoveryCampaignStore.ts";
import { createDiscoveryController } from "./realDiscoveryProvider.ts";

const OWNER = "b".repeat(64);
const JHB = "Johannesburg, Gauteng, South Africa";
const KEMPTON = "Kempton Park, Gauteng, South Africa";
const WORD_1 = "Real Estate Agents and Brokers";
const WORD_2 = "Intermediation service activities for real estate";

function place(label, latitude, longitude, kind) {
  return {
    label,
    latitude,
    longitude,
    countryCode: "ZA",
    region: "Gauteng",
    kind,
    boundingBox: null,
  };
}

const JHB_PLACE = {
  ...place(JHB, -26.205, 28.049722, "city"),
  // Offered with the city by the place picker: one is really a suburb of it,
  // one is a separate town outside it.
  nearby: [
    place("Sandton, Gauteng, South Africa", -26.1045, 28.0545, "suburb"),
    place(KEMPTON, -26.0964, 28.2336, "suburb"),
  ],
};

const INPUT = {
  name: "JHB estate agents",
  audience: "businesses",
  industryId: "real-estate",
  industryName: "Real Estate",
  verticalId: "real-estate-agents-and-brokers",
  verticalName: "Real Estate Agents and Brokers",
  location: JHB,
  locationSelection: JHB_PLACE,
  target: 400,
  criteria: "",
};

const SUBURBS = suburbsOf(JHB_PLACE).map((entry) => entry.label);
const SANDTON = SUBURBS[0];
const RANDBURG = SUBURBS[1];

/**
 * What Maps lists for each search, as provider place ids. The whole city
 * lists its top 100 and ends. Sandton's first page is 20 businesses the city
 * search already found, then 15 new ones. Randburg lists 25 new ones.
 */
function listedFor(listed = {}) {
  const city = Array.from({ length: 100 }, (_, i) => `jhb-${i}`);
  return {
    [`${WORD_1}|${JHB}`]: city,
    [`${WORD_1}|${SANDTON}`]: [
      ...city.slice(0, 20),
      ...Array.from({ length: 15 }, (_, i) => `sandton-${i}`),
    ],
    [`${WORD_1}|${RANDBURG}`]: Array.from(
      { length: 25 },
      (_, i) => `randburg-${i}`,
    ),
    [`${WORD_2}|${RANDBURG}`]: Array.from(
      { length: 5 },
      (_, i) => `randburg-word2-${i}`,
    ),
    ...listed,
  };
}

function row(id) {
  return {
    placeId: id,
    name: `Agency ${id}`,
    category: "Real estate agency",
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

function harness(options = {}) {
  const storageMap = options.storageMap ?? new Map();
  const listed = listedFor(options.listed);
  const log = { searches: [], publishes: [] };
  const context = {
    channelId: "sales-channel",
    communityId: "community-1",
    pubkey: OWNER,
    displayName: "Basheer",
    existingProspectIds: new Set(options.existing ?? []),
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
      const all =
        options.everySearchLists?.(request) ??
        listed[`${request.query}|${request.location}`] ??
        [];
      const page = all.slice(request.skip, request.skip + 20);
      return {
        provider: "outscraper",
        places: page.map(row),
        estimatedCostUsd: page.length * 0.003,
        nextSkip: request.skip + 20 < all.length ? request.skip + 20 : null,
      };
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

/** Each (word, place) search asked, once per run of requests, in order. */
function searchesAsked(log) {
  const asked = [];
  for (const request of log.searches) {
    const key = `${request.query} | ${request.location}`;
    if (asked.at(-1) !== key) asked.push(key);
  }
  return asked;
}

test("Johannesburg has suburbs to search; a place with the same name elsewhere does not", () => {
  assert.ok(SUBURBS.length >= 30, `only ${SUBURBS.length} suburbs listed`);
  assert.equal(SANDTON, "Sandton, Johannesburg, Gauteng, South Africa");
  assert.ok(SUBURBS.includes("Soweto, Johannesburg, Gauteng, South Africa"));
  assert.equal(new Set(SUBURBS).size, SUBURBS.length, "no suburb twice");
  for (const suburb of suburbsOf(JHB_PLACE)) {
    assert.equal(suburb.kind, "suburb");
    assert.equal(suburb.countryCode, "ZA");
  }
  // Same name, far away: not this city.
  assert.deepEqual(
    suburbsOf({ ...JHB_PLACE, latitude: -29.0, longitude: 24.0 }),
    [],
  );
  // A suburb chosen by itself is searched by itself.
  assert.deepEqual(
    suburbsOf(place("Sandton, Gauteng, South Africa", -26.1, 28.05, "suburb")),
    [],
  );
  assert.deepEqual(
    suburbsOf({ ...JHB_PLACE, countryCode: "BR" }),
    [],
    "only the country the list is for",
  );
});

test("the whole city runs out: the search goes on suburb by suburb, each word through every suburb, never outside the city", async () => {
  const { controller, log, storageMap } = harness();
  await controller.start(INPUT);
  await controller.whenIdle();

  const ended = controller.getCurrent();
  assert.equal(ended.status, "complete");
  assert.equal(ended.endReason, "provider_end");
  // 100 in the whole city, 15 new in Sandton, 25 + 5 in Randburg.
  assert.equal(ended.count, 145);

  const asked = searchesAsked(log);
  assert.deepEqual(asked.slice(0, 4), [
    `${WORD_1} | ${JHB}`,
    `${WORD_2} | ${JHB}`,
    `${WORD_1} | ${SANDTON}`,
    `${WORD_1} | ${RANDBURG}`,
  ]);
  assert.equal(
    asked.length,
    2 + SUBURBS.length * 2,
    "the whole city with both words, then each word through every suburb",
  );
  assert.equal(asked[2 + SUBURBS.length], `${WORD_2} | ${SANDTON}`);
  assert.ok(
    log.searches.every((request) => !request.location.startsWith("Kempton")),
    "a town outside the city is not searched without the owner's yes",
  );
  assert.ok(
    log.searches.every((request) => request.coordinates === undefined),
    "each place is searched by its name, not from one point",
  );

  // Sandton's first page was all businesses the city search had found. That
  // did not stop the run: its next page held new ones.
  const sandton = log.searches.filter(
    (request) => request.query === WORD_1 && request.location === SANDTON,
  );
  assert.deepEqual(
    sandton.map((request) => request.skip),
    [0, 20],
  );

  const ids = log.publishes.map((changes) => changes.prospectId);
  assert.equal(new Set(ids).size, ids.length, "nothing is saved twice");

  // The card: where it searched, and the one question left.
  assert.equal(ended.suburbsSearched, SUBURBS.length);
  assert.deepEqual(ended.suburbsLeft, []);
  assert.deepEqual(
    ended.nearbyAreasLeft,
    [KEMPTON],
    "Sandton was offered as nearby, but it is a suburb and already searched",
  );
  assert.equal(
    runDescription(ended),
    "Johannesburg and its suburbs have no more. Find more in Kempton Park?",
  );
  assert.equal(canFindMore(ended), true);
  const saved = parseStoredState(storageMap.get("test-key") ?? null);
  assert.equal(saved.campaigns[0].nearbyApproved, false);
});

test("the run stops at the target in the middle of the suburbs", async () => {
  const { controller, log } = harness();
  await controller.start({ ...INPUT, target: 110 });
  await controller.whenIdle();
  // The whole city used the approved results: it asks before going on, and
  // asks again each time the approved results are used (repeats use them).
  assert.equal(controller.getCurrent().endReason, "approved_budget");
  for (let yes = 0; yes < 5; yes += 1) {
    if (controller.getCurrent().endReason !== "approved_budget") break;
    await controller.continueCampaign();
    await controller.whenIdle();
  }
  const ended = controller.getCurrent();
  assert.equal(ended.endReason, "target_reached");
  assert.ok(ended.count >= 110);
  assert.ok(
    log.searches.every((request) => request.location !== RANDBURG),
    "Sandton's new businesses reached the target, so Randburg was not searched",
  );
});

test("a campaign saved before suburbs were searched: Find more goes on to its suburbs, not to a nearby town", async () => {
  // The owner's campaigns from before this build ran out on the whole city
  // and saved no suburb position.
  const first = harness();
  await first.controller.start(INPUT);
  await first.controller.whenIdle();
  const saved = JSON.parse(first.storageMap.get("test-key"));
  const campaign = saved.campaigns[0];
  delete campaign.suburbIndex;
  campaign.wordIndex = 1;
  campaign.count = 100;
  campaign.prospectIds = campaign.prospectIds.slice(0, 100);
  campaign.pageLog = campaign.pageLog.filter((entry) => entry.area === JHB);
  campaign.coverage = campaign.coverage.filter((entry) =>
    entry.queryKey.includes("::johannesburg, gauteng, south africa|"),
  );
  campaign.endReason = "provider_end";
  campaign.exhausted = true;
  campaign.status = "complete";
  const storageMap = new Map([["test-key", JSON.stringify(saved)]]);

  const second = harness({ storageMap });
  await second.controller.whenIdle();
  const old = second.controller.getCurrent();
  assert.equal(old.suburbsSearched, 0);
  assert.equal(old.suburbsLeft.length, SUBURBS.length);
  assert.equal(canFindMore(old), true);
  assert.match(
    runDescription(old),
    /^Johannesburg has no more in one search\. Find more in Sandton, Randburg and \d+ more suburbs\?$/,
  );
  const ask = second.controller.getContinuation();
  assert.equal(ask.state, "ready");
  assert.equal(ask.suburbs.length, SUBURBS.length);
  assert.equal(ask.nearbyAreas, undefined);

  await second.controller.continueCampaign();
  await second.controller.whenIdle();
  assert.equal(second.log.searches[0].location, SANDTON);
  assert.equal(second.log.searches[0].query, WORD_1);
  assert.ok(
    second.log.searches.every((request) => request.location !== JHB),
    "the whole city is not searched again",
  );
  const done = second.controller.getCurrent();
  assert.ok(done.count > 100);
  const resaved = parseStoredState(storageMap.get("test-key") ?? null);
  assert.equal(
    resaved.campaigns[0].nearbyApproved,
    false,
    "going on to the city's suburbs is not a yes to nearby towns",
  );
});

test("a search with businesses everywhere stops at the page cap, however many yeses it gets", async () => {
  // Every search lists 40 businesses the owner already has, so the target is
  // never reached and the approved results are used again and again.
  const listOf = (request) =>
    Array.from(
      { length: 40 },
      (_, i) => `${request.query}-${request.location}-${i}`,
    );
  const existing = [];
  for (const word of [WORD_1, WORD_2]) {
    for (const where of [JHB, ...SUBURBS]) {
      for (const id of listOf({ query: word, location: where })) {
        existing.push(`id-${id}`);
      }
    }
  }
  const { controller, log } = harness({ existing, everySearchLists: listOf });
  await controller.start(INPUT);
  await controller.whenIdle();
  for (let yes = 0; yes < 20; yes += 1) {
    if (controller.getContinuation()?.state !== "ready") break;
    await controller.continueCampaign();
    await controller.whenIdle();
  }
  const done = controller.getCurrent();
  // Pages asked ahead past the end of a list are empty and cost nothing.
  const paid = log.searches.filter((request) => request.skip < 40);
  assert.equal(paid.length, MAX_PAGES, "no page is bought past the cap");
  assert.equal(done.pagesFetched, MAX_PAGES);
  assert.equal(done.count, 0);
  assert.equal(done.endReason, "approved_budget");
  assert.equal(
    done.endNote,
    `This search reached its limit of ${MAX_PAGES} pages. Search a nearby area or use another business type.`,
  );
  assert.equal(controller.getContinuation().state, "unavailable");
  assert.equal(canFindMore(done), false);
});
