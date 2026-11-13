import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseStoredState,
  serializeState,
  upsertCampaign,
} from "./discoveryCampaignStore.ts";
import {
  discoveryCoverageKey,
  DiscoverySearchError,
} from "./discoverySearch.ts";
import { resetVerticalTagsForTest, setVerticalTags } from "./taxonomy.ts";
import {
  buildEndNote,
  buildResultsMessage,
  createDiscoveryController,
  FIRST_START_ERROR,
  MAX_PAGES,
  PUBLISH_BACKOFF_MS,
  PUBLISH_CONCURRENCY,
  SEARCH_BACKOFF_MS,
} from "./realDiscoveryProvider.ts";

const OWNER = "a".repeat(64);
const verticalTags = JSON.parse(
  fs.readFileSync(
    new URL("./data/vertical-tags.json", import.meta.url),
    "utf8",
  ),
);

const INPUT = {
  name: "Independent brands",
  audience: "businesses",
  industryId: "home-living",
  industryName: "Home & Living",
  verticalId: "home-decor",
  verticalName: "Home Decor & Gift Shops",
  location: "South Africa",
  locationSelection: {
    label: "South Africa",
    latitude: -30.5595,
    longitude: 22.9375,
    countryCode: "ZA",
    region: "ZA",
    kind: "country",
    boundingBox: null,
  },
  target: 50,
  criteria: "",
};

function selectedLocation(label) {
  return { ...INPUT.locationSelection, label };
}

function place(n) {
  return {
    placeId: `p${n}`,
    name: `Shop ${n}`,
    category: "Home goods store",
    subtypes: null,
    address: `${n} Main Road`,
    city: "Johannesburg",
    state: "Gauteng",
    country: "South Africa",
    phone: "+27 11 555 0100",
    website: `https://shop${n}.example`,
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

/** A search page of `count` places numbered from `from`. */
function page(from, count, nextSkip) {
  return {
    provider: "outscraper",
    places: Array.from({ length: count }, (_, index) => place(from + index)),
    estimatedCostUsd: 0.06,
    nextSkip,
  };
}

/** The standard two-page result: 20 places, then 10 more and the end. */
function twoPages(request) {
  if (request.skip === 0) return page(1, 20, 20);
  if (request.skip === 20) return page(21, 10, null);
  return page(0, 0, null);
}

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
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function waitFor(predicate, label = "condition") {
  for (let index = 0; index < 500; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function abortError() {
  return new DOMException("The search was stopped.", "AbortError");
}

function harness(options = {}) {
  const storageMap = options.storageMap ?? new Map();
  const storage = options.storage ?? {
    getItem: (key) => storageMap.get(key) ?? null,
    setItem: (key, value) => {
      storageMap.set(key, value);
    },
  };
  const log = { searches: [], publishes: [], posts: [], sleeps: [] };
  const context = {
    channelId: "sales-channel",
    communityId: "community-1",
    pubkey: options.pubkey ?? OWNER,
    displayName: "Lerato",
    existingProspectIds: new Set(options.existing ?? []),
    existingNames: new Set(options.existingNames ?? []),
  };
  let ids = 0;
  const respond = options.pages ?? twoPages;
  const deps = {
    storage,
    storageKey: "test-key",
    nowSeconds: () => 1_700_000_000,
    newId: () => {
      ids += 1;
      return `camp-${ids}`;
    },
    sleep: async (ms, signal) => {
      log.sleeps.push(ms);
      if (signal.aborted) throw abortError();
    },
    getOwnerPubkey: async () => context.pubkey,
    resolveContext: async () => context,
    search: async (request, signal) => {
      log.searches.push(request);
      return options.search
        ? options.search(request, signal, log)
        : respond(request);
    },
    prospectId: async (candidate) =>
      `id-${candidate.placeId ?? candidate.name}`,
    publishProspect: async (input) => {
      if (options.publish) await options.publish(input, log);
      log.publishes.push(input.changes);
    },
    postToSales: async (input) => {
      if (options.post) await options.post(input, log);
      log.posts.push(input.content);
    },
    leadLink: (id) => `buzz://lead/${id}`,
  };
  const controller = createDiscoveryController(deps);
  return { controller, deps, log, context, storageMap };
}

function stored(storageMap) {
  return parseStoredState(storageMap.get("test-key") ?? null);
}

test("a run saves each business, posts the best fits in Sales and stops at the approved budget", async () => {
  const { controller, log, storageMap } = harness();
  const created = await controller.start({ ...INPUT, target: 25 });
  // start resolves as soon as the first page is in, before it is saved.
  assert.equal(created.status, "running");
  assert.equal(created.count, 0);
  assert.equal(created.runBy.name, "Lerato");
  assert.equal(created.simulated, false);
  await controller.whenIdle();

  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 20);
  assert.equal(done.prospectIds.length, 20);
  assert.equal(done.postedInSales, true);
  assert.equal(done.budgetUsd, 0.075);
  assert.equal(done.spentUsd, 0.06);
  assert.equal(done.endReason, "approved_budget");
  assert.equal(log.publishes.length, 20);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0],
  );
  assert.equal(log.searches[0].query, "Home Decor & Gift Shops");
  assert.equal(log.searches[0].country, "ZA");
  for (const changes of log.publishes) {
    assert.ok(changes.externalIds.includes("campaign:camp-1"));
    assert.equal(changes.industry, "Home & Living");
    assert.equal(changes.qualification, "unreviewed");
  }

  assert.equal(log.posts.length, 1);
  const lines = log.posts[0].split("\n");
  assert.equal(
    lines[0],
    'Found 20 prospects for "Independent brands" (Home Decor & Gift Shops · South Africa). The results you approved were used after 1 page. Keep searching for the other 5? Find more continues this search at no extra cost. Best fits:',
  );
  assert.equal(lines.length, 6);
  assert.match(lines[1], /^- \[Shop 1\]\(buzz:\/\/lead\/id-p1\)$/);

  const saved = stored(storageMap);
  assert.equal(saved.campaigns[0].status, "complete");
  assert.equal(saved.campaigns[0].count, 20);
  assert.equal(saved.currentId, "camp-1");
});

test("picked tags take turns with full pages, deduplicate places and persist cursors", async () => {
  const { controller, log, storageMap } = harness({
    search: async (request) => {
      const tagged = request.query.startsWith("wedding guest ");
      if (tagged) {
        return {
          provider: "outscraper",
          places: [
            { ...place(1), name: "Wedding Guest House 1" },
            { ...place(2), name: "Wedding Guest House 2" },
          ],
          estimatedCostUsd: 0.02,
          nextSkip: null,
        };
      }
      return {
        provider: "outscraper",
        places: [
          { ...place(2), name: "Wedding Guest House duplicate" },
          { ...place(3), name: "Bridal Suite Guest House" },
        ],
        estimatedCostUsd: 0.02,
        nextSkip: null,
      };
    },
  });

  setVerticalTags(verticalTags);
  try {
    await controller.start({
      ...INPUT,
      verticalId: "guesthouses-and-inns",
      verticalName: "Guesthouses and inns",
      target: 100,
      pickedTags: ["wedding guest", "bridal suite"],
    });
    await controller.whenIdle();
  } finally {
    resetVerticalTagsForTest();
  }

  assert.deepEqual(
    log.searches.map(({ query, limit, skip }) => [query, limit, skip]),
    [
      ["wedding guest Guesthouses and inns", 20, 0],
      ["bridal suite Guesthouses and inns", 20, 0],
    ],
  );
  assert.equal(log.publishes.length, 3);
  assert.deepEqual(log.publishes[0].discoveryTags, [
    { tag: "wedding guest", kind: "customer", picked: true },
  ]);

  const current = controller.getCurrent();
  assert.deepEqual(current.pickedTags, ["wedding guest", "bridal suite"]);
  const saved = stored(storageMap).campaigns[0];
  assert.deepEqual(saved.tagCursors, [null, null]);
  assert.deepEqual(
    saved.coverage.map(({ nextSkip, terminalReason }) => [
      nextSkip,
      terminalReason,
    ]),
    [
      [20, "provider_end"],
      [20, "provider_end"],
    ],
  );
});

/** Every request a run makes must be a full page at a multiple of 20. */
function assertPagedByTwenty(searches) {
  for (const request of searches) {
    assert.equal(request.limit, 20, "full pages only");
    assert.equal(request.skip % 20, 0, `skip ${request.skip}`);
  }
}

test("owner incident: a provider that repeats its results with three tags stops after a few pages, not 25", async () => {
  // The same 20 restaurants come back for every request, as Outscraper did for
  // skips that were not a multiple of 20. 25 pages were paid for and 41 kept.
  const { controller, log, storageMap } = harness({
    pages: () => page(1, 20, 20),
  });
  await controller.start({
    ...INPUT,
    verticalName: "Restaurants",
    location: "Johannesburg",
    locationSelection: selectedLocation("Johannesburg"),
    target: 100,
    pickedTags: ["steak", "sushi", "pizza"],
  });
  await controller.whenIdle();

  assertPagedByTwenty(log.searches);
  // Page 1 saves 20. Each other tag then repeats it once and is ended, and the
  // first tag is asked once more before it is ended too.
  assert.equal(log.searches.length, 4);
  assert.ok(log.searches.length < MAX_PAGES / 5);
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 20);
  assert.equal(
    done.endNote,
    "The provider returned only places already seen in this campaign on page 4. The search stopped before another paid request. Find more retries this campaign from its next saved page, or search a nearby area.",
  );
  assert.match(log.posts[0], /^Found 20 prospects /);
  assert.ok(log.posts[0].includes(done.endNote), "the Sales message says why");
  assert.ok(!log.posts[0].includes("\u2014"), "no em dash");
  assert.deepEqual(stored(storageMap).campaigns[0].tagCursors, [
    null,
    null,
    null,
  ]);
});

test("an all-repeat provider page ends without a further paid request", async () => {
  const { controller, log } = harness({ pages: () => page(1, 20, 20) });
  await controller.start({
    ...INPUT,
    verticalName: "Restaurants",
    location: "Johannesburg",
    locationSelection: selectedLocation("Johannesburg"),
    target: 100,
  });
  await controller.whenIdle();
  assertPagedByTwenty(log.searches);
  assert.equal(log.searches.length, 2);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20],
  );
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 20);
  assert.equal(
    done.endNote,
    "The provider returned only places already seen in this campaign on page 2. The search stopped before another paid request. Find more retries this campaign from its next saved page, or search a nearby area.",
  );
  assert.equal(done.runLog.at(-1).repeatedInCampaign, 20);
  assert.equal(done.runLog.at(-1).stopReason, "provider_repeat");
});

test("a page made only of existing Leads continues to the next provider page", async () => {
  const { controller, log } = harness({
    existing: Array.from({ length: 20 }, (_, index) => `id-p${index + 1}`),
    pages: (request) =>
      request.skip === 0 ? page(1, 20, 20) : page(21, 3, null),
  });
  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20],
  );
  assert.equal(controller.getCurrent().count, 3);
  assert.equal(controller.getCurrent().status, "complete");
  assert.equal(controller.getCurrent().endReason, "provider_end");
});

test("a relay cursor continues past a normalized short page", async () => {
  const { controller, log } = harness({
    pages: (request) =>
      request.skip === 0 ? page(1, 3, 20) : page(21, 3, null),
  });
  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();

  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20],
  );
  assert.equal(controller.getCurrent().count, 6);
  assert.equal(controller.getCurrent().endReason, "provider_end");
});

test("owner incident: partial provider overlap keeps paging, saves each new prospect once, and ends only when the relay ends", async () => {
  // This mirrors the reported real-provider shape. Page one contains nine
  // businesses already in Leads. Page two shifts two places back from page
  // one, contains eight new businesses, and contains ten more existing
  // businesses. That overlap is normal Google Maps pagination, not a loop.
  const existing = [
    ...Array.from({ length: 9 }, (_, index) => `id-p${index + 1}`),
    ...Array.from({ length: 10 }, (_, index) => `id-p${index + 29}`),
  ];
  const { controller, log } = harness({
    existing,
    pages: (request) => {
      if (request.skip === 0) return page(1, 20, 20);
      if (request.skip === 20) {
        return {
          provider: "outscraper",
          places: [
            place(19),
            place(20),
            ...Array.from({ length: 8 }, (_, index) => place(index + 21)),
            ...Array.from({ length: 10 }, (_, index) => place(index + 29)),
          ],
          estimatedCostUsd: 0.06,
          nextSkip: 40,
        };
      }
      if (request.skip === 40) return page(39, 20, null);
      if (request.skip === 60 || request.skip === 80) {
        return { ...page(0, 0, null), estimatedCostUsd: 0 };
      }
      assert.fail(`unexpected provider request at skip ${request.skip}`);
    },
  });

  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();

  assert.deepEqual(
    // Once the second page shows the provider moving forward, the remaining
    // approved pages are asked for together. The ones past the provider's
    // end come back empty: nothing is saved from them and nothing is charged.
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80],
  );
  const done = controller.getCurrent();
  assert.equal(done.spentUsd, 0.18);
  assert.equal(done.count, 39);
  assert.equal(done.skippedDuplicates, 19);
  assert.equal(done.endReason, "provider_end");
  assert.deepEqual(
    done.runLog.map((entry) => [
      entry.page,
      entry.skip,
      entry.placesReturned,
      entry.newProspectsSaved,
      entry.alreadyInLeads,
      entry.repeatedInCampaign,
      entry.costUsd,
      entry.stopReason,
    ]),
    [
      [1, 0, 20, 11, 9, 0, 0.06, null],
      [2, 20, 20, 8, 10, 2, 0.06, null],
      [3, 40, 20, 20, 0, 0, 0.06, "provider_end"],
    ],
  );
});

test("a legacy provider-repeat campaign resumes in place from its consumed cursor", async () => {
  const storageMap = new Map();
  const location = selectedLocation("Johannesburg");
  const queryKey = discoveryCoverageKey({
    verticalId: INPUT.verticalId,
    location: location.label,
    locationSelection: location,
  });
  // This is the persisted shape from the owner report: two paid pages, 11 new
  // prospects, a consumed cursor, and the old false provider_repeat terminal.
  storageMap.set(
    "test-key",
    JSON.stringify({
      version: 2,
      ownerPubkey: OWNER,
      currentId: "real-estate-stuck",
      campaigns: [
        {
          id: "real-estate-stuck",
          name: "Real Estate Agents and Brokers prospects",
          audience: "businesses",
          industryId: "real-estate",
          industryName: "Real Estate",
          verticalId: INPUT.verticalId,
          verticalName: "Real Estate Agents and Brokers",
          pickedTags: [],
          location: location.label,
          locationSelection: location,
          target: 100,
          count: 11,
          budgetUsd: 0.3,
          criteria: "",
          status: "complete",
          prospectIds: Array.from(
            { length: 11 },
            (_, index) => `id-p${index + 10}`,
          ),
          created: true,
          runBy: { name: "Lerato", pubkey: OWNER },
          failureReason: null,
          postedInSales: false,
          createdAt: 1_700_000_000,
          skippedDuplicates: 29,
          seenProviderPlaceIds: Array.from(
            { length: 40 },
            (_, index) => `p${index + 1}`,
          ),
          spentUsd: 0.12,
          endReason: "provider_repeat",
          coverage: [
            {
              queryKey,
              nextSkip: 40,
              terminalReason: "provider_repeat",
            },
          ],
          skip: 40,
          tagCursors: [],
          pendingTagCursors: null,
          pagesFetched: 2,
          exhausted: true,
          pendingPost: false,
          postState: "none",
          stopNotePosted: false,
          topFits: [],
          pendingPage: null,
        },
      ],
    }),
  );
  const { controller, log } = harness({
    storageMap,
    pages: (request) => {
      assert.equal(request.skip, 40);
      return page(41, 20, null);
    },
  });

  const continuation = controller.getContinuation();
  assert.deepEqual(
    {
      campaignId: continuation.campaignId,
      state: continuation.state,
      minimumAdditionalBudgetUsd: continuation.minimumAdditionalBudgetUsd,
      spentUsd: continuation.spentUsd,
    },
    {
      campaignId: "real-estate-stuck",
      state: "ready",
      minimumAdditionalBudgetUsd: 0,
      spentUsd: 0.12,
    },
  );

  await controller.continueCampaign();
  await controller.whenIdle();

  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [40],
  );
  assert.equal(controller.getCampaigns().length, 1);
  const resumed = controller.getCurrent();
  assert.equal(resumed.id, "real-estate-stuck");
  assert.equal(resumed.count, 31);
  assert.equal(resumed.pagesFetched, 3);
  assert.equal(resumed.endReason, "provider_end");
  assert.deepEqual(resumed.runLog, [
    {
      page: 3,
      skip: 40,
      placesReturned: 20,
      newProspectsSaved: 20,
      alreadyInLeads: 0,
      repeatedInCampaign: 0,
      costUsd: 0.06,
      stopReason: "provider_end",
    },
  ]);
});

test("Find more needs no new approval and keeps the same campaign instead of creating one", async () => {
  const existing = Array.from(
    { length: 100 },
    (_, index) => `id-p${index + 1}`,
  );
  const { controller, log } = harness({
    existing,
    pages: (request) => {
      if (request.skip < 100)
        return page(request.skip + 1, 20, request.skip + 20);
      if (request.skip === 100) return page(101, 5, null);
      if (request.skip > 100 && request.skip <= 180) {
        return { ...page(0, 0, null), estimatedCostUsd: 0 };
      }
      assert.fail(`unexpected provider request at skip ${request.skip}`);
    },
  });
  const started = await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();

  const exhausted = controller.getCurrent();
  assert.equal(exhausted.id, started.id);
  assert.equal(exhausted.count, 0);
  assert.equal(exhausted.endReason, "approved_budget");
  assert.equal(
    exhausted.endNote,
    "The results you approved were used after 5 pages. 100 were already in your Leads and are not charged. Keep searching for the other 100? Find more continues this search at no extra cost.",
  );
  const continuation = controller.getContinuation();
  // Results the owner already has are not charged, so continuing towards the
  // same target is never a new approval.
  assert.equal(continuation.state, "ready");

  await controller.continueCampaign();
  await controller.whenIdle();

  assert.deepEqual(
    // The five continued pages are asked for together; the provider ends at
    // skip 100 and the four pages past it come back empty and free.
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80, 100, 120, 140, 160, 180],
  );
  assert.equal(controller.getCampaigns().length, 1);
  const resumed = controller.getCurrent();
  assert.equal(resumed.id, started.id);
  assert.equal(resumed.pagesFetched, 6);
  assert.equal(resumed.spentUsd, 0.36);
  assert.equal(resumed.count, 5);
  assert.equal(resumed.endReason, "provider_end");
});

test("owner incident: 100 requested where 41 results are already Leads stops to ask, then continues free to the target", async () => {
  // Johannesburg, 12 Nov 2026: 100 results paid for, 41 already in Leads and 9
  // repeats, so 50 new. The owner: results he already has must not use his
  // budget, and the search must ask before it goes on.
  const existing = Array.from({ length: 41 }, (_, index) => `id-p${index + 1}`);
  const { controller, log } = harness({
    existing,
    pages: (request) => {
      // The fourth page repeats nine new places the third page already gave.
      if (request.skip === 60) {
        return {
          ...page(61, 20, 80),
          places: [...page(42, 9, 0).places, ...page(61, 11, 0).places],
        };
      }
      if (request.skip < 400) {
        return page(request.skip + 1, 20, request.skip + 20);
      }
      return page(0, 0, null);
    },
  });
  const started = await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();

  const asked = controller.getCurrent();
  assert.equal(asked.status, "complete");
  assert.equal(asked.count, 50);
  assert.equal(asked.skippedDuplicates, 41);
  assert.equal(asked.endReason, "approved_budget");
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80],
    "the run stops after the 100 results that were approved",
  );
  assert.equal(
    asked.endNote,
    "The results you approved were used after 5 pages. 41 were already in your Leads and are not charged. Keep searching for the other 50? Find more continues this search at no extra cost.",
  );
  assert.equal(controller.getContinuation().state, "ready");

  await controller.continueCampaign();
  await controller.whenIdle();

  const done = controller.getCurrent();
  assert.equal(done.id, started.id);
  assert.equal(controller.getCampaigns().length, 1);
  assert.equal(done.count, 100);
  assert.equal(done.endReason, "target_reached");
  assert.equal(done.endNote, null);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80, 100, 120, 140],
  );
});

test("owner incident: 24 existing leads keep paging and never claim Google has no more", async () => {
  const { controller, log } = harness({
    existing: Array.from({ length: 24 }, (_, index) => `id-p${index + 1}`),
    pages: (request) =>
      request.skip === 0
        ? page(1, 20, 20)
        : request.skip === 20
          ? page(21, 20, 40)
          : request.skip === 40
            ? page(41, 3, null)
            : { ...page(0, 0, null), estimatedCostUsd: 0 },
  });
  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();

  assert.deepEqual(
    // Once the second page shows the provider moving forward, the remaining
    // approved pages are asked for together. The ones past the provider's
    // end come back empty: nothing is saved from them and nothing is charged.
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80],
  );
  const current = controller.getCurrent();
  assert.equal(current.pagesFetched, 3);
  assert.equal(current.spentUsd, 0.18);
  assert.equal(current.count, 19);
  assert.equal(current.skippedDuplicates, 24);
  assert.equal(current.endReason, "provider_end");
  assert.match(
    current.endNote,
    /^The relay returned nextSkip null after 3 pages /,
  );
  assert.ok(!current.endNote.includes("Google has no more"));
});

test("a new campaign for the same type and selected place starts after durable coverage", async () => {
  const { controller, log } = harness({
    pages: (request) => {
      if (request.skip === 0) return page(1, 20, 20);
      if (request.skip === 20) return page(21, 20, 40);
      if (request.skip === 40) return page(41, 3, null);
      return page(0, 0, null);
    },
  });
  // Small targets are retained here only to exercise the state machine's
  // target stop. The approved dialog itself allows 100 through 500.
  await controller.start({ ...INPUT, target: 40 });
  await controller.whenIdle();
  const first = controller.getCurrent();
  assert.equal(first.coverage[0].nextSkip, 40);

  await controller.start({
    ...INPUT,
    name: "Independent brands, more",
    target: 100,
  });
  await controller.whenIdle();
  const second = controller.getCurrent();
  assert.equal(second.count, 3);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40],
  );
  assert.equal(second.coverage[0].nextSkip, 60);
});

test("a new local session starts after this device's durable coverage", async () => {
  const storageMap = new Map();
  const initial = harness({
    storageMap,
    pages: (request) =>
      request.skip === 0
        ? page(1, 20, 20)
        : request.skip === 20
          ? page(21, 20, 40)
          : page(0, 0, null),
  });
  await initial.controller.start({ ...INPUT, target: 40 });
  await initial.controller.whenIdle();
  initial.controller.dispose();

  const resumed = harness({
    storageMap,
    pages: (request) =>
      request.skip === 40 ? page(41, 3, null) : page(0, 0, null),
  });
  await resumed.controller.start({
    ...INPUT,
    name: "Independent brands, after restart",
    target: 100,
  });
  await resumed.controller.whenIdle();

  assert.deepEqual(
    resumed.log.searches.map((request) => request.skip),
    [40],
  );
  assert.equal(resumed.controller.getCurrent().count, 3);
});

test("owner incident: coverage saved while the relay ignored the page offset does not block a new search", async () => {
  // Until 12 Nov 2026 the relay sent the provider an offset it ignored, so
  // every page was page one again. Campaigns saved then recorded pages 20 to
  // 160 as covered and the query as ended, although none was ever fetched. A
  // new search for the same type and place was born finished with 0 found.
  const storageMap = new Map();
  const before = harness({ storageMap });
  await before.controller.start({ ...INPUT, target: 40 });
  await before.controller.whenIdle();
  before.controller.dispose();

  const saved = JSON.parse(storageMap.get("test-key"));
  const legacy = saved.campaigns[0];
  delete legacy.trustedCoverage;
  legacy.pagesFetched = 9;
  legacy.skip = 180;
  legacy.exhausted = true;
  legacy.endReason = "provider_repeat";
  legacy.coverage = [
    {
      queryKey: discoveryCoverageKey({
        verticalId: INPUT.verticalId,
        tag: null,
        location: INPUT.location,
        locationSelection: INPUT.locationSelection,
      }),
      nextSkip: 180,
      terminalReason: "provider_repeat",
    },
  ];
  storageMap.set("test-key", JSON.stringify(saved));

  const { controller, log } = harness({
    storageMap,
    // The 20 places of the old page one are already Leads.
    existing: Array.from({ length: 20 }, (_, index) => `id-p${index + 1}`),
    pages: (request) => {
      if (request.skip === 0) return page(1, 20, 20);
      if (request.skip === 20) return page(101, 20, 40);
      if (request.skip === 40) return page(121, 5, null);
      return page(0, 0, null);
    },
  });
  await controller.start({ ...INPUT, name: "Same search again", target: 100 });
  await controller.whenIdle();

  assert.deepEqual(
    log.searches.map((request) => request.skip).slice(0, 3),
    [0, 20, 40],
    "the new search pages from the start instead of trusting the old record",
  );
  const current = controller.getCurrent();
  assert.equal(current.pagesFetched, 3);
  assert.equal(current.count, 25);
  assert.equal(current.endReason, "provider_end");
});

test("a query that is used up at the provider's 400 places ends honestly with 20 pages", async () => {
  // Like the relay: full pages with a next skip until skip 380, then none.
  const { controller, log } = harness({
    pages: (request) =>
      page(
        request.skip + 1,
        20,
        request.skip + 20 < 400 ? request.skip + 20 : null,
      ),
  });
  await controller.start({
    ...INPUT,
    verticalName: "Restaurants",
    location: "Johannesburg",
    locationSelection: selectedLocation("Johannesburg"),
    target: 500,
  });
  await controller.whenIdle();
  assertPagedByTwenty(log.searches);
  assert.equal(log.searches.length, 20);
  const done = controller.getCurrent();
  assert.equal(done.count, 400);
  assert.equal(done.status, "complete");
  assert.match(
    done.endNote,
    /^The relay offered no next page after 20 pages because this query reached the provider's 400-place ceiling in Johannesburg\./,
  );
  assert.ok(log.posts[0].includes(done.endNote));
});

test("an old relay that keeps offering pages past 400 places is not asked for them", async () => {
  const { controller, log } = harness({
    pages: (request) => page(request.skip + 1, 20, request.skip + 20),
  });
  await controller.start({ ...INPUT, target: 500 });
  await controller.whenIdle();
  assertPagedByTwenty(log.searches);
  assert.ok(log.searches.every((request) => request.skip < 400));
});

test("a stored campaign with off-step cursors from an older build pages by 20 when resumed", async () => {
  const { controller, log } = harness({
    pages: (request) => page(request.skip + 1, 20, request.skip + 20),
  });
  setVerticalTags(verticalTags);
  try {
    await controller.start({
      ...INPUT,
      verticalId: "guesthouses-and-inns",
      verticalName: "Guesthouses and inns",
      target: 100,
      pickedTags: ["wedding guest", "bridal suite", "farm stay"],
    });
    await controller.pause();
    await controller.resume();
    await controller.whenIdle();
  } finally {
    resetVerticalTagsForTest();
  }
  assertPagedByTwenty(log.searches);
});

test("the end note tells why a run finished short, and is empty when the target was met", () => {
  const base = {
    count: 41,
    target: 100,
    exhausted: true,
    pagesFetched: 5,
    verticalName: "Restaurants",
    location: "Johannesburg",
    pickedTags: ["steak"],
    endReason: "provider_end",
  };
  assert.equal(
    buildEndNote(base),
    "The relay returned nextSkip null after 5 pages for restaurants with these tags in Johannesburg. The provider did not offer another page. Search a nearby area or use another tag.",
  );
  assert.equal(
    buildEndNote({ ...base, pickedTags: [] }),
    "The relay returned nextSkip null after 5 pages for restaurants in Johannesburg. The provider did not offer another page. Search a nearby area or use another tag.",
  );
  assert.equal(buildEndNote({ ...base, count: 100 }), null);
  assert.equal(
    buildEndNote({ ...base, verticalName: "IT support" }),
    "The relay returned nextSkip null after 5 pages for IT support with these tags in Johannesburg. The provider did not offer another page. Search a nearby area or use another tag.",
  );
  assert.equal(
    buildEndNote({
      ...base,
      endReason: "approved_budget",
      pagesFetched: MAX_PAGES,
    }),
    `This search reached its limit of ${MAX_PAGES} pages. Search a nearby area or use another business type.`,
  );
  assert.equal(
    buildEndNote({
      ...base,
      count: 50,
      endReason: "approved_budget",
      skippedDuplicates: 41,
    }),
    "The results you approved were used after 5 pages. 41 were already in your Leads and are not charged. Keep searching for the other 50? Find more continues this search at no extra cost.",
  );
  assert.equal(
    buildEndNote({
      ...base,
      count: 99,
      endReason: "approved_budget",
      pagesFetched: 1,
      skippedDuplicates: 1,
    }),
    "The results you approved were used after 1 page. 1 was already in your Leads and is not charged. Keep searching for the other 1? Find more continues this search at no extra cost.",
  );
  assert.equal(
    buildEndNote({ ...base, count: 80, endReason: "approved_budget" }),
    "The results you approved were used after 5 pages. Keep searching for the other 20? Find more continues this search at no extra cost.",
  );
  for (const note of [
    buildEndNote(base),
    buildEndNote({ ...base, exhausted: false }),
    buildEndNote({ ...base, endReason: null }),
  ]) {
    assert.ok(!note.includes("\u2014"), "no em dash");
    assert.ok(!note.includes("Google has no more"));
  }
});

test("the end note is stored with the campaign and read back", async () => {
  const { controller, storageMap } = harness({ pages: () => page(1, 5, null) });
  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();
  const saved = stored(storageMap).campaigns[0];
  assert.match(
    saved.endNote,
    /^The relay returned nextSkip null after 1 pages /,
  );
  assert.equal(controller.getCurrent().endNote, saved.endNote);
});

test("a server that cannot search fails start with its words and creates nothing", async () => {
  const reason =
    "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.";
  const { controller, log, storageMap } = harness({
    search: async () => {
      throw new DiscoverySearchError(reason, {
        code: "discovery_not_configured",
        status: 503,
      });
    },
  });
  await assert.rejects(
    controller.start(INPUT),
    (error) => error.message === reason,
  );
  assert.equal(controller.getCurrent(), null);
  assert.deepEqual(controller.getCampaigns(), []);
  assert.equal(stored(storageMap).campaigns.length, 0);
  assert.equal(log.publishes.length, 0);
  assert.equal(log.posts.length, 0);
  // The first page is never retried: a person is waiting on the dialog.
  assert.equal(log.searches.length, 1);
});

test("a missing location or an out-of-range target is refused before any search", async () => {
  const { controller, log } = harness();
  await assert.rejects(controller.start({ ...INPUT, location: "  " }), {
    message: FIRST_START_ERROR,
  });
  await assert.rejects(controller.start({ ...INPUT, target: 0 }), {
    message: FIRST_START_ERROR,
  });
  await assert.rejects(controller.start({ ...INPUT, target: 501 }), {
    message: FIRST_START_ERROR,
  });
  assert.equal(log.searches.length, 0);
});

test("businesses already in Leads and repeats in a page are saved once and counted", async () => {
  const { controller, log } = harness({
    existing: ["id-p1", "id-p2"],
    pages: () => {
      const result = page(1, 6, null);
      result.places.push(place(5));
      return result;
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 4);
  assert.equal(done.skippedDuplicates, 2);
  assert.deepEqual(
    log.publishes.map((changes) => changes.prospectId),
    ["id-p3", "id-p4", "id-p5", "id-p6"],
  );
});

test("a business already in Leads under the same name is skipped even with a different record id", async () => {
  const { controller, log } = harness({
    existingNames: ["shop 2", "shop 4"],
    pages: () => page(1, 5, null),
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.count, 3);
  assert.equal(done.skippedDuplicates, 2);
  assert.deepEqual(
    log.publishes.map((changes) => changes.displayName),
    ["Shop 1", "Shop 3", "Shop 5"],
  );
});

test("the run stops at the target even in the middle of a page", async () => {
  const { controller, log } = harness();
  await controller.start({ ...INPUT, target: 5 });
  await controller.whenIdle();
  assert.equal(controller.getCurrent().count, 5);
  assert.equal(controller.getCurrent().status, "complete");
  assert.equal(log.publishes.length, 5);
  assert.equal(log.searches.length, 1);
});

test("fewer results than the target still completes with what was found", async () => {
  const { controller, log } = harness({ pages: () => page(1, 8, null) });
  await controller.start(INPUT);
  await controller.whenIdle();
  assert.equal(controller.getCurrent().status, "complete");
  assert.equal(controller.getCurrent().count, 8);
  assert.equal(log.searches.length, 1);
  assert.match(log.posts[0], /^Found 8 prospects /);
});

test("a search that finds nothing completes quietly without a Sales post", async () => {
  const { controller, log } = harness({ pages: () => page(1, 0, null) });
  await controller.start(INPUT);
  await controller.whenIdle();
  assert.equal(controller.getCurrent().status, "complete");
  assert.equal(controller.getCurrent().count, 0);
  assert.equal(controller.getCurrent().postedInSales, false);
  assert.equal(log.posts.length, 0);
});

test("pause stops at the cursor, a late page writes nothing but is kept, and resume saves it without paying for it again", async () => {
  const late = deferred();
  const { controller, log } = harness({
    search: async (request, _signal, searchLog) => {
      const firstOffsetTwo =
        searchLog.searches.filter((entry) => entry.skip === 20).length === 1;
      if (request.skip === 20 && firstOffsetTwo) return late.promise;
      return twoPages(request);
    },
  });
  await controller.start(INPUT);
  await waitFor(() => log.searches.length === 2, "the second page request");
  await waitFor(() => controller.getCurrent().count === 20, "page one saved");

  await controller.pause();
  assert.equal(controller.getCurrent().status, "paused");

  // The page that was in flight arrives after the pause: nothing may be saved.
  late.resolve(page(21, 10, null));
  await settle();
  assert.equal(controller.getCurrent().count, 20);
  assert.equal(log.publishes.length, 20);
  assert.equal(controller.getCurrent().status, "paused");

  await controller.resume();
  await controller.whenIdle();
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20],
  );
  assert.equal(controller.getCurrent().status, "complete");
  assert.equal(controller.getCurrent().count, 30);
  assert.equal(log.posts.length, 1);
});

test("cancel keeps what was found and cannot be resumed", async () => {
  const never = deferred();
  const { controller, log } = harness({
    search: async (request) =>
      request.skip === 20 ? never.promise : twoPages(request),
  });
  await controller.start(INPUT);
  await waitFor(() => controller.getCurrent().count === 20, "page one saved");
  await controller.cancel();
  assert.equal(controller.getCurrent().status, "cancelled");
  assert.equal(controller.getCurrent().count, 20);
  never.resolve(page(21, 10, null));
  await settle();
  assert.equal(controller.getCurrent().count, 20);
  await controller.resume();
  await controller.retry();
  assert.equal(controller.getCurrent().status, "cancelled");
  assert.equal(log.posts.length, 0);
});

test("a busy provider is retried with backoff, then the page goes through", async () => {
  let failures = 0;
  const { controller, log } = harness({
    search: async (request) => {
      if (request.skip === 20 && failures < SEARCH_BACKOFF_MS.length) {
        failures += 1;
        throw new DiscoverySearchError(
          "The provider is busy. Try again in a minute.",
          {
            code: "discovery_provider_busy",
          },
        );
      }
      return twoPages(request);
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  assert.equal(controller.getCurrent().status, "complete");
  assert.deepEqual(log.sleeps, [...SEARCH_BACKOFF_MS]);
});

test("a final search failure fails the run with its reason, keeps results, and retry continues at the cursor", async () => {
  let broken = true;
  const credits =
    "The prospect search provider has no credits left. The server owner needs to top up Outscraper.";
  const { controller, log } = harness({
    search: async (request) => {
      if (request.skip === 20 && broken) {
        throw new DiscoverySearchError(credits, {
          code: "discovery_provider_credits",
        });
      }
      return twoPages(request);
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  const failed = controller.getCurrent();
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureReason, credits);
  assert.equal(failed.count, 20);
  // Not transient: no quiet retries.
  assert.deepEqual(log.sleeps, []);
  // One short note that the search stopped, with the results so far.
  assert.equal(log.posts.length, 1);
  assert.match(
    log.posts[0],
    /^The search "Independent brands" stopped after finding 20 prospects\. Best fits so far:/,
  );

  broken = false;
  await controller.retry();
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.failureReason, null);
  assert.equal(done.count, 30);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 20],
  );
  // The stopped note is not repeated; the final summary follows once.
  assert.equal(log.posts.length, 2);
  assert.match(log.posts[1], /^Found 30 prospects /);
});

test("transient failures that never clear end as a failed run after the backoff", async () => {
  const { controller, log } = harness({
    search: async (request) => {
      if (request.skip === 20) {
        throw new DiscoverySearchError(
          "Could not reach the server. Check your connection and retry.",
          {
            code: "network",
          },
        );
      }
      return twoPages(request);
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  assert.equal(controller.getCurrent().status, "failed");
  assert.match(
    controller.getCurrent().failureReason,
    /Could not reach the server/,
  );
  assert.deepEqual(log.sleeps, [...SEARCH_BACKOFF_MS]);
});

test("a save that keeps failing stops the run without advancing the cursor, and retry saves nothing twice", async () => {
  let broken = true;
  const { controller, log } = harness({
    pages: () => page(1, 20, null),
    publish: async ({ changes }) => {
      if (broken && changes.prospectId === "id-p3") {
        throw new Error("The update could not be saved.");
      }
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  const failed = controller.getCurrent();
  assert.equal(failed.status, "failed");
  assert.match(failed.failureReason, /could not be saved/);
  // The saves sent together with the failing one landed and are on the
  // campaign.
  assert.equal(failed.count, PUBLISH_CONCURRENCY - 1);
  assert.deepEqual(log.sleeps, [...PUBLISH_BACKOFF_MS]);
  assert.equal(log.searches.length, 1);

  broken = false;
  await controller.retry();
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 20);
  // The page that was found is saved from where it is kept: no second search
  // is paid for, and the businesses saved before the failure were recognised
  // as this campaign's own, not saved again.
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0],
  );
  const ids = log.publishes.map((changes) => changes.prospectId);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 20);
  assert.equal(done.skippedDuplicates, 0);
});

test("the relay's 'already exists' means someone else saved it first on a first try, and our own earlier try after a retry", async () => {
  const attempts = new Map();
  const { controller, log } = harness({
    pages: () => page(1, 3, null),
    publish: async ({ changes }) => {
      const count = (attempts.get(changes.prospectId) ?? 0) + 1;
      attempts.set(changes.prospectId, count);
      if (changes.prospectId === "id-p1") {
        throw new Error("prospect party identity already exists");
      }
      if (changes.prospectId === "id-p2" && count === 1) {
        throw new Error(
          "The update timed out. Retry to check whether it was saved.",
        );
      }
      if (changes.prospectId === "id-p2") {
        throw new Error("prospect party identity already exists");
      }
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  // p1: a duplicate. p2: our first try landed, so it counts. p3: normal.
  assert.equal(done.skippedDuplicates, 1);
  assert.deepEqual(done.prospectIds, ["id-p2", "id-p3"]);
  assert.equal(done.count, 2);
  assert.equal(log.publishes.length, 1);
});

test("owner incident: the pages a run is already allowed to fetch are requested together, not one by one", async () => {
  // 12 Nov 2026: 100 prospects took 75 seconds because each 20 result page
  // waited for the one before it, although all five were approved up front.
  const gates = new Map();
  const { controller, log } = harness({
    search: (request) => {
      if (request.skip === 0) return page(1, 20, 20);
      const gate = deferred();
      gates.set(request.skip, gate);
      return gate.promise;
    },
  });
  await controller.start({ ...INPUT, target: 100 });

  // The second page is asked for alone: it proves the provider moves forward.
  await waitFor(() => gates.size === 1, "the second page in flight");
  await settle();
  assert.deepEqual([...gates.keys()], [20]);
  gates.get(20).resolve(page(21, 20, 40));

  // Then every remaining approved page is asked for at once.
  await waitFor(() => gates.size === 4, "the three remaining pages in flight");
  assert.deepEqual(
    [...gates.keys()].sort((left, right) => left - right),
    [20, 40, 60, 80],
  );
  assert.equal(controller.getCurrent().status, "running");

  // The provider answers out of order. Pages are still saved in order.
  gates.get(80).resolve(page(81, 20, 100));
  gates.get(60).resolve(page(61, 20, 80));
  gates.get(40).resolve(page(41, 20, 60));
  await controller.whenIdle();

  const done = controller.getCurrent();
  assert.equal(done.count, 100);
  assert.equal(done.endReason, "target_reached");
  assert.deepEqual(
    done.runLog.map((entry) => entry.skip),
    [0, 20, 40, 60, 80],
  );
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80],
    "no page is asked for twice",
  );
});

test("owner incident: a provider that repeats its first page is never asked ahead", async () => {
  // The relay fault of 12 Nov 2026: every offset returned the first page.
  // Asking ahead must not multiply that into five paid copies.
  const { controller, log } = harness({
    pages: (request) => page(1, 20, request.skip + 20),
  });
  await controller.start({ ...INPUT, target: 200 });
  await controller.whenIdle();

  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20],
    "the run stops at the first repeated page with nothing requested ahead",
  );
  assert.equal(controller.getCurrent().endReason, "provider_repeat");
});

test("pages are never requested beyond what was approved", async () => {
  const { controller, log } = harness({
    pages: (request) => page(request.skip + 1, 20, request.skip + 20),
  });
  // 60 approved results are three pages, however many could be asked ahead.
  await controller.start({ ...INPUT, target: 60 });
  await controller.whenIdle();

  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40],
  );
  assert.equal(controller.getCurrent().count, 60);
});

test("pages asked ahead past the end of the results cost nothing and save nothing", async () => {
  // The provider has 50 results. Pages at 60 and 80 were asked for together
  // with the page at 40; they come back empty, as the real provider does.
  const { controller, log } = harness({
    pages: (request) => {
      if (request.skip < 40)
        return page(request.skip + 1, 20, request.skip + 20);
      if (request.skip === 40) return page(41, 10, null);
      return { ...page(0, 0, null), estimatedCostUsd: 0 };
    },
  });
  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();

  const done = controller.getCurrent();
  assert.equal(done.count, 50);
  assert.equal(done.endReason, "provider_end");
  assert.equal(done.spentUsd, 0.18);
  assert.deepEqual(
    done.runLog.map((entry) => [entry.skip, entry.placesReturned]),
    [
      [0, 20],
      [20, 20],
      [40, 10],
    ],
    "only pages up to the provider's end are saved and logged",
  );
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80],
  );
});

test("a page fetched ahead is kept when a save fails, and Retry does not pay for it again", async () => {
  let failSaves = true;
  const { controller, log } = harness({
    pages: (request) => page(request.skip + 1, 20, request.skip + 20),
    publish: async (input) => {
      if (failSaves && input.changes.displayName === "Shop 41") {
        throw new Error("The relay did not accept the record.");
      }
    },
  });
  await controller.start({ ...INPUT, target: 80 });
  await controller.whenIdle();

  // Pages 0 and 20 are saved in turn, then 40 and 60 are asked for together.
  // A lead on the page at skip 40 is refused, so the run fails there while
  // the page at skip 60 has already arrived.
  const failed = controller.getCurrent();
  assert.equal(failed.status, "failed");
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60],
  );

  failSaves = false;
  await controller.retry();
  await controller.whenIdle();

  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 80);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60],
    "the page fetched ahead (skip 60) is used, not bought again",
  );
});

test("pausing keeps the pages already asked ahead, and Resume saves them without asking again", async () => {
  const gates = new Map();
  const { controller, log } = harness({
    search: (request) => {
      if (request.skip < 40)
        return page(request.skip + 1, 20, request.skip + 20);
      const gate = deferred();
      gates.set(request.skip, gate);
      return gate.promise;
    },
  });
  await controller.start({ ...INPUT, target: 100 });
  await waitFor(() => gates.size === 3, "pages 40, 60 and 80 in flight");
  await controller.pause();
  assert.equal(controller.getCurrent().status, "paused");

  // The provider answers after the pause. Those pages were paid for.
  for (const skip of [40, 60, 80]) {
    gates.get(skip).resolve(page(skip + 1, 20, skip + 20));
  }
  await settle();
  assert.equal(
    controller.getCurrent().count,
    40,
    "nothing is saved while paused",
  );

  await controller.resume();
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.count, 100);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20, 40, 60, 80],
    "no page is asked for a second time after Resume",
  );
});

test("a run never goes past the page cap or approved budget", async () => {
  // Three tags never run out inside 25 pages. Each full page has one business
  // that is already in Leads, so the target of 500 is not reached either.
  const offsets = { steak: 0, sushi: 100_000, pizza: 200_000 };
  const existing = [];
  for (const offset of Object.values(offsets)) {
    for (let skip = 0; skip < MAX_PAGES * 20; skip += 20) {
      existing.push(`id-p${offset + skip}`);
    }
  }
  const { controller, log } = harness({
    existing,
    pages: (request) => {
      const tag = request.query.split(" ")[0];
      return page(offsets[tag] + request.skip, 20, request.skip + 20);
    },
  });
  await controller.start({
    ...INPUT,
    target: 500,
    pickedTags: ["steak", "sushi", "pizza"],
  });
  await controller.whenIdle();
  assertPagedByTwenty(log.searches);
  assert.equal(log.searches.length, MAX_PAGES);
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 19 * MAX_PAGES);
  assert.equal(done.endReason, "approved_budget");
  assert.equal(
    done.endNote,
    "This search reached its limit of 25 pages. Search a nearby area or use another business type.",
  );
  assert.equal(controller.getContinuation().state, "unavailable");
  assert.ok(log.posts[0].includes(done.endNote));
});

test("after a restart a running campaign is paused and resumes from its stored cursor", async () => {
  const never = deferred();
  const first = harness({
    search: async (request) =>
      request.skip === 20 ? never.promise : twoPages(request),
  });
  await first.controller.start(INPUT);
  await waitFor(
    () => first.controller.getCurrent().count === 20,
    "page one saved",
  );
  assert.equal(first.controller.getCurrent().status, "running");
  first.controller.dispose();

  const second = harness({ storageMap: first.storageMap });
  const restored = second.controller.getCurrent();
  assert.equal(restored.id, "camp-1");
  assert.equal(restored.status, "paused");
  assert.equal(restored.count, 20);

  await second.controller.resume();
  await second.controller.whenIdle();
  assert.deepEqual(
    second.log.searches.map((request) => request.skip),
    [20],
  );
  assert.equal(second.controller.getCurrent().status, "complete");
  assert.equal(second.controller.getCurrent().count, 30);
  assert.equal(second.log.posts.length, 1);
});

test("a run still completes in memory when storage refuses every write", async () => {
  const { controller } = harness({
    storage: {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    },
  });
  await controller.start({ ...INPUT, target: 10 });
  await controller.whenIdle();
  assert.equal(controller.getCurrent().status, "complete");
  assert.equal(controller.getCurrent().count, 10);
});

test("a failed Sales post leaves a retry record that is tried once on the next open and never twice", async () => {
  let failPost = true;
  const { controller, log } = harness({
    pages: () => page(1, 4, null),
    post: async () => {
      if (failPost) throw new Error("offline");
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  const afterRun = controller.getCurrent();
  assert.equal(afterRun.status, "complete");
  assert.equal(afterRun.postedInSales, false);
  assert.equal(log.posts.length, 0);

  failPost = false;
  controller.subscribe(() => {});
  await settle();
  assert.equal(controller.getCurrent().postedInSales, true);
  assert.equal(log.posts.length, 1);

  controller.subscribe(() => {});
  await controller.select("camp-1");
  await settle();
  assert.equal(log.posts.length, 1);
});

test("a post that was mid-send when the app closed is not repeated", async () => {
  const storageMap = new Map();
  const seeded = harness({ storageMap });
  await seeded.controller.start({ ...INPUT, target: 3 });
  await seeded.controller.whenIdle();
  seeded.controller.dispose();

  const saved = stored(storageMap);
  const crashed = {
    ...saved.campaigns[0],
    postedInSales: false,
    postState: "sending",
    pendingPost: true,
  };
  storageMap.set("test-key", serializeState(upsertCampaign(saved, crashed)));

  const again = harness({ storageMap });
  again.controller.subscribe(() => {});
  await settle();
  assert.equal(again.log.posts.length, 0);
});

test("starting or selecting another campaign pauses the one that is running", async () => {
  const never = deferred();
  const { controller } = harness({
    search: async (request) => {
      if (request.skip === 20) return never.promise;
      // The second campaign searches elsewhere, so its places are all new.
      return request.location === "Cape Town"
        ? page(101, 20, 20)
        : page(1, 20, 20);
    },
  });
  await controller.start(INPUT);
  await waitFor(
    () => controller.getCurrent().count === 20,
    "first campaign page one",
  );
  const second = await controller.start({
    ...INPUT,
    name: "Second",
    location: "Cape Town",
    locationSelection: selectedLocation("Cape Town"),
  });
  assert.equal(second.id, "camp-2");
  assert.equal(
    controller.getCampaigns().find((entry) => entry.id === "camp-1").status,
    "paused",
  );
  await waitFor(
    () => controller.getCurrent().count === 20,
    "second campaign page one",
  );

  await controller.select("camp-1");
  assert.equal(controller.getCurrent().id, "camp-1");
  assert.equal(
    controller.getCampaigns().find((entry) => entry.id === "camp-2").status,
    "paused",
  );
  assert.deepEqual(
    controller.getCampaigns().map((entry) => entry.id),
    ["camp-2", "camp-1"],
  );
});

test("a different signed-in identity starts with an empty list", async () => {
  const storageMap = new Map();
  const seeded = harness({ storageMap });
  await seeded.controller.start({ ...INPUT, target: 3 });
  await seeded.controller.whenIdle();
  seeded.controller.dispose();
  assert.equal(stored(storageMap).campaigns.length, 1);

  const other = harness({ storageMap, pubkey: "b".repeat(64) });
  await settle();
  assert.deepEqual(other.controller.getCampaigns(), []);
  assert.equal(other.controller.getCurrent(), null);
  assert.equal(stored(storageMap).ownerPubkey, "b".repeat(64));
});

test("listeners hear every change to the current campaign and can unsubscribe", async () => {
  const { controller } = harness({ pages: () => page(1, 3, null) });
  const heard = [];
  const stop = controller.subscribe((campaign) =>
    heard.push(campaign?.count ?? null),
  );
  await controller.start(INPUT);
  await controller.whenIdle();
  assert.ok(heard.length > 3);
  assert.equal(heard.at(-1), 3);
  stop();
  const before = heard.length;
  await controller.select("camp-1");
  await controller.pause();
  assert.equal(heard.length, before);
});

test("the Sales message escapes link text and handles one prospect and none", () => {
  const link = (id) => `buzz://lead/${id}`;
  assert.equal(
    buildResultsMessage(
      {
        name: 'The "best" list',
        verticalName: "Cafes",
        location: "Cape Town",
        count: 1,
        topFits: [{ id: "u1", name: "Bean [there]\\done", fit: 90 }],
      },
      "final",
      link,
    ),
    "Found 1 prospect for \"The 'best' list\" (Cafes · Cape Town). Best fits:\n- [Bean there done](buzz://lead/u1)",
  );
  assert.equal(
    buildResultsMessage(
      { name: "X", verticalName: "V", location: "L", count: 2, topFits: [] },
      "stopped",
      link,
    ),
    'The search "X" stopped after finding 2 prospects.',
  );
});

test("a disposed controller ignores a search that comes back later", async () => {
  const late = deferred();
  const { controller, log } = harness({
    search: async (request) =>
      request.skip === 20 ? late.promise : twoPages(request),
  });
  await controller.start(INPUT);
  await waitFor(() => controller.getCurrent().count === 20, "page one saved");
  controller.dispose();
  late.resolve(page(21, 10, null));
  await settle();
  assert.equal(controller.getCurrent().count, 20);
  assert.equal(log.publishes.length, 20);
});

test("a page the relay refused to save is kept, and Retry saves it without searching (and paying) again", async () => {
  let refusing = true;
  const { controller, log, storageMap } = harness({
    pages: () => page(1, 5, null),
    publish: async () => {
      if (refusing) {
        throw new Error(
          "invalid: business command scope: business record d-tag does not match its namespace",
        );
      }
    },
  });
  await controller.start(INPUT);
  await controller.whenIdle();
  assert.equal(controller.getCurrent().status, "failed");
  assert.equal(controller.getCurrent().count, 0);
  assert.equal(log.searches.length, 1);

  // Durable: the found places are on the stored campaign, cursor unmoved.
  const kept = stored(storageMap).campaigns[0];
  assert.equal(kept.pendingPage.places.length, 5);
  assert.equal(kept.skip, 0);

  refusing = false;
  await controller.retry();
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 5);
  assert.equal(log.searches.length, 1);
  assert.equal(log.publishes.length, 5);
  assert.equal(stored(storageMap).campaigns[0].pendingPage, null);
});

test("found places survive a restart: Resume saves them before any new search", async () => {
  const storageMap = new Map();
  const first = harness({
    storageMap,
    pages: () => page(1, 20, 20),
    publish: async () => {
      throw new Error("The update could not be saved.");
    },
  });
  await first.controller.start(INPUT);
  await first.controller.whenIdle();
  assert.equal(first.controller.getCurrent().status, "failed");
  first.controller.dispose();

  const second = harness({
    storageMap,
    search: async (request) => {
      if (request.skip === 20) return page(21, 2, null);
      assert.fail("the kept page must be saved before searching again");
    },
  });
  // A restart pauses a failed or running list; select it and retry.
  await second.controller.select(stored(storageMap).currentId);
  await second.controller.retry();
  await second.controller.whenIdle();
  const done = second.controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 22);
  assert.deepEqual(
    second.log.searches.map((request) => request.skip),
    [20],
  );
});

test("a page is cleared from the campaign once every place on it is saved", async () => {
  const { controller, storageMap } = harness({ pages: () => page(1, 3, null) });
  await controller.start(INPUT);
  await controller.whenIdle();
  assert.equal(controller.getCurrent().status, "complete");
  assert.equal(stored(storageMap).campaigns[0].pendingPage, null);
});
