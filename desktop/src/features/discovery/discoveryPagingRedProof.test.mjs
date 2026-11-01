import assert from "node:assert/strict";
import test from "node:test";

import { buildDiscoverySearchPlan } from "./discoverySearch.ts";
import { createDiscoveryController } from "./realDiscoveryProvider.ts";

const OWNER = "a".repeat(64);

function place(n) {
  return {
    placeId: `p${n}`,
    name: `Restaurant ${n}`,
    category: "Restaurant",
    subtypes: null,
    address: null,
    city: "Johannesburg",
    state: null,
    country: "South Africa",
    phone: null,
    website: null,
    email: null,
    rating: null,
    reviews: null,
    latitude: null,
    longitude: null,
    mapsUrl: null,
    description: null,
    businessStatus: null,
  };
}

test("no search plan asks the provider for a skip that is not a multiple of 20", () => {
  for (const pickedTags of [[], ["steak", "sushi", "pizza"]]) {
    for (const cursor of [0, 7, 14, 21]) {
      const plan = buildDiscoverySearchPlan({
        verticalName: "Restaurants",
        location: "Johannesburg",
        skip: cursor,
        pickedTags,
        tagCursors: pickedTags.map(() => cursor),
      });
      for (const { request } of plan.requests) {
        assert.equal(request.skip % 20, 0, `skip ${request.skip}`);
        assert.equal(request.limit, 20, `limit ${request.limit}`);
      }
    }
  }
});

test("a provider that repeats its results ends the run early and says why", async () => {
  const searches = [];
  const posts = [];
  const storage = new Map();
  const controller = createDiscoveryController({
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
    },
    storageKey: "red-proof",
    nowSeconds: () => 1_700_000_000,
    newId: () => "camp-1",
    sleep: async () => {},
    getOwnerPubkey: async () => OWNER,
    resolveContext: async () => ({
      channelId: "sales",
      communityId: "community-1",
      pubkey: OWNER,
      displayName: "Lerato",
      existingProspectIds: new Set(),
      existingNames: new Set(),
    }),
    // The same 20 restaurants for every request, as the provider answered to
    // skips that were not a multiple of 20.
    search: async (request) => {
      searches.push(request);
      return {
        provider: "outscraper",
        places: Array.from({ length: 20 }, (_, index) => place(index + 1)),
        estimatedCostUsd: 0.06,
        nextSkip: request.skip + 20,
      };
    },
    prospectId: async (candidate) => `id-${candidate.placeId}`,
    publishProspect: async () => {},
    postToSales: async ({ content }) => {
      posts.push(content);
    },
    leadLink: (id) => `buzz://lead/${id}`,
  });
  await controller.start({
    name: "Restaurants prospects",
    audience: "businesses",
    industryId: "food",
    industryName: "Food",
    verticalId: "restaurants",
    verticalName: "Restaurants",
    location: "Johannesburg",
    target: 100,
    criteria: "",
    pickedTags: ["steak", "sushi", "pizza"],
  });
  await controller.whenIdle();

  assert.ok(searches.length < 10, `paid for ${searches.length} pages`);
  const done = controller.getCurrent();
  assert.equal(done.count, 20);
  assert.match(done.endNote ?? "", /^Google has no more restaurants /);
  assert.match(posts[0] ?? "", /Google has no more restaurants /);
});
