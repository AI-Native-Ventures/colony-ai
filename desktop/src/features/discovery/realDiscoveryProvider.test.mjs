import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseStoredState,
  serializeState,
  upsertCampaign,
} from "./discoveryCampaignStore.ts";
import { DiscoverySearchError } from "./discoverySearch.ts";
import { resetVerticalTagsForTest, setVerticalTags } from "./taxonomy.ts";
import {
  buildEndNote,
  buildResultsMessage,
  createDiscoveryController,
  FIRST_START_ERROR,
  MAX_PAGES,
  PUBLISH_BACKOFF_MS,
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
  target: 50,
  criteria: "",
};

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

test("a run searches, saves each business, posts the best fits in Sales and is stored", async () => {
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
  assert.equal(done.count, 25);
  assert.equal(done.prospectIds.length, 25);
  assert.equal(done.postedInSales, true);
  assert.equal(done.budgetUsd, 1.25);
  assert.equal(log.publishes.length, 25);
  assert.deepEqual(
    log.searches.map((request) => request.skip),
    [0, 20],
  );
  assert.equal(log.searches[0].query, "Home Decor & Gift Shops");
  assert.equal(log.searches[0].country, "South Africa");
  for (const changes of log.publishes) {
    assert.ok(changes.externalIds.includes("campaign:camp-1"));
    assert.equal(changes.industry, "Home & Living");
    assert.equal(changes.qualification, "unreviewed");
  }

  assert.equal(log.posts.length, 1);
  const lines = log.posts[0].split("\n");
  assert.equal(
    lines[0],
    'Found 25 prospects for "Independent brands" (Home Decor & Gift Shops · South Africa). Best fits:',
  );
  assert.equal(lines.length, 6);
  assert.match(lines[1], /^- \[Shop 1\]\(buzz:\/\/lead\/id-p1\)$/);

  const saved = stored(storageMap);
  assert.equal(saved.campaigns[0].status, "complete");
  assert.equal(saved.campaigns[0].count, 25);
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
          nextSkip: request.skip + 20,
        };
      }
      return {
        provider: "outscraper",
        places: [
          { ...place(2), name: "Wedding Guest House duplicate" },
          { ...place(3), name: "Bridal Suite Guest House" },
        ],
        estimatedCostUsd: 0.02,
        nextSkip: request.skip + 20,
      };
    },
  });

  setVerticalTags(verticalTags);
  try {
    await controller.start({
      ...INPUT,
      verticalId: "guesthouses-and-inns",
      verticalName: "Guesthouses and inns",
      target: 3,
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
  assert.deepEqual(saved.tagCursors, [20, 20]);
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
    "Google has no more restaurants for these tags in Johannesburg. Add another area or tag to find more.",
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

test("a provider that repeats its results without tags ends after one wasted page", async () => {
  const { controller, log } = harness({ pages: () => page(1, 20, 20) });
  await controller.start({
    ...INPUT,
    verticalName: "Restaurants",
    location: "Johannesburg",
    target: 100,
  });
  await controller.whenIdle();
  assertPagedByTwenty(log.searches);
  assert.equal(log.searches.length, 2);
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 20);
  assert.equal(
    done.endNote,
    "Google has no more restaurants in Johannesburg. Add another area or tag to find more.",
  );
});

test("a page that is only businesses already in Leads ends that query instead of paying for more", async () => {
  const { controller, log } = harness({
    existing: Array.from({ length: 40 }, (_, index) => `id-p${index + 1}`),
    pages: (request) => page(request.skip + 1, 20, request.skip + 20),
  });
  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();
  assert.equal(log.searches.length, 1);
  assert.equal(controller.getCurrent().count, 0);
  assert.equal(controller.getCurrent().status, "complete");
  assert.match(controller.getCurrent().endNote, /^Google has no more /);
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
    /^Google has no more restaurants in Johannesburg\./,
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
  };
  assert.equal(
    buildEndNote(base),
    "Google has no more restaurants for these tags in Johannesburg. Add another area or tag to find more.",
  );
  assert.equal(
    buildEndNote({ ...base, pickedTags: [] }),
    "Google has no more restaurants in Johannesburg. Add another area or tag to find more.",
  );
  assert.equal(buildEndNote({ ...base, count: 100 }), null);
  assert.equal(
    buildEndNote({ ...base, verticalName: "IT support" }),
    "Google has no more IT support for these tags in Johannesburg. Add another area or tag to find more.",
  );
  assert.equal(
    buildEndNote({ ...base, exhausted: false, pagesFetched: MAX_PAGES }),
    `The search stopped after ${MAX_PAGES} pages to protect your search budget. Start another search in a nearby area to find more.`,
  );
  for (const note of [
    buildEndNote(base),
    buildEndNote({ ...base, exhausted: false }),
  ]) {
    assert.ok(!note.includes("\u2014"), "no em dash");
  }
});

test("the end note is stored with the campaign and read back", async () => {
  const { controller, storageMap } = harness({ pages: () => page(1, 5, null) });
  await controller.start({ ...INPUT, target: 100 });
  await controller.whenIdle();
  const saved = stored(storageMap).campaigns[0];
  assert.match(saved.endNote, /^Google has no more /);
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
  // The two saves beside the failing one landed and are on the campaign.
  assert.equal(failed.count, 2);
  assert.deepEqual(log.sleeps, [...PUBLISH_BACKOFF_MS]);
  assert.equal(log.searches.length, 1);

  broken = false;
  await controller.retry();
  await controller.whenIdle();
  const done = controller.getCurrent();
  assert.equal(done.status, "complete");
  assert.equal(done.count, 20);
  // The page that was found is saved from where it is kept: no second search
  // is paid for, and the first two businesses were recognised as this
  // campaign's own, not saved again.
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

test("a run never goes past the page cap, and says so when it stops short", async () => {
  // Three tags never run out inside 25 pages (each query allows 20), and every
  // page adds 19 new places, so the target of 500 is not reached either.
  const offsets = { steak: 0, sushi: 100_000, pizza: 200_000 };
  const { controller, log } = harness({
    pages: (request) => {
      const tag = request.query.split(" ")[0];
      return page(offsets[tag] + request.skip, 19, request.skip + 20);
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
  assert.match(done.endNote, /^The search stopped after 25 pages /);
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
    pages: () => page(1, 4, 20),
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
  assert.equal(done.count, 6);
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
