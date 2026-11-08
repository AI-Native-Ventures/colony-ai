import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyState,
  MAX_STORED_CAMPAIGNS,
  parseStoredState,
  readState,
  serializeState,
  setCurrent,
  storageKey,
  toPublicCampaign,
  upsertCampaign,
  withTopFit,
  writeState,
} from "./discoveryCampaignStore.ts";

function campaign(id, overrides = {}) {
  return {
    id,
    name: `Campaign ${id}`,
    audience: "businesses",
    industryId: "home-living",
    industryName: "Home & Living",
    verticalId: "home-decor",
    verticalName: "Home Decor & Gift Shops",
    pickedTags: [],
    location: "South Africa",
    locationSelection: null,
    target: 50,
    count: 3,
    budgetUsd: 2.5,
    criteria: "",
    status: "complete",
    prospectIds: ["a", "b", "c"],
    created: true,
    simulated: false,
    runBy: { name: "Lerato", pubkey: "f".repeat(64) },
    failureReason: null,
    postedInSales: true,
    endNote: null,
    createdAt: 1_000,
    skippedDuplicates: 0,
    seenProviderPlaceIds: [],
    spentUsd: 0,
    endReason: null,
    pageLog: [],
    coverage: [],
    skip: 20,
    tagCursors: [],
    pendingTagCursors: null,
    pagesFetched: 1,
    exhausted: false,
    pendingPost: false,
    postState: "posted",
    stopNotePosted: false,
    topFits: [],
    pendingPage: null,
    ...overrides,
  };
}

function withCampaigns(...campaigns) {
  return campaigns.reduce(
    (state, entry) => upsertCampaign(state, entry),
    emptyState("owner"),
  );
}

test("the key is per community", () => {
  assert.notEqual(storageKey("a"), storageKey("b"));
});

test("a saved list round-trips", () => {
  const state = setCurrent(withCampaigns(campaign("one")), "one");
  const restored = parseStoredState(serializeState(state));
  assert.equal(restored.currentId, "one");
  assert.equal(restored.ownerPubkey, "owner");
  assert.deepEqual(restored.campaigns[0], {
    ...state.campaigns[0],
    qualification: {
      enabled: false,
      selectedSignals: [],
      runId: null,
      phase: "idle",
      failureReason: null,
    },
  });
});

test("campaign qualification starts fully off and preserves an explicit selection", () => {
  const state = withCampaigns(
    campaign("qualified", {
      qualification: {
        enabled: true,
        selectedSignals: ["NO_WEBSITE", "NO_WHATSAPP_LINK"],
        runId: "d39cf188-319a-4efc-92cc-8c55c5f2d6d2",
        phase: "paused",
        failureReason: "relay publish failed",
      },
    }),
  );
  const restored = parseStoredState(serializeState(state));
  assert.deepEqual(restored.campaigns[0].qualification, {
    enabled: true,
    selectedSignals: ["NO_WEBSITE", "NO_WHATSAPP_LINK"],
    runId: "d39cf188-319a-4efc-92cc-8c55c5f2d6d2",
    phase: "paused",
    failureReason: "relay publish failed",
  });
  assert.deepEqual(
    parseStoredState(serializeState(withCampaigns(campaign("off"))))
      .campaigns[0].qualification,
    {
      enabled: false,
      selectedSignals: [],
      runId: null,
      phase: "idle",
      failureReason: null,
    },
  );
});

test("legacy storage receives safe continuation defaults", () => {
  const {
    locationSelection,
    seenProviderPlaceIds,
    spentUsd,
    endReason,
    pageLog,
    coverage,
    ...legacyCampaign
  } = campaign("legacy");
  const restored = parseStoredState(
    JSON.stringify({
      version: 1,
      ownerPubkey: "owner",
      currentId: "legacy",
      campaigns: [legacyCampaign],
    }),
  ).campaigns[0];

  assert.equal(restored.locationSelection, null);
  assert.deepEqual(restored.seenProviderPlaceIds, []);
  assert.equal(restored.spentUsd, 0);
  assert.equal(restored.endReason, null);
  assert.deepEqual(restored.pageLog, []);
  assert.deepEqual(restored.coverage, []);
});

test("a version-two provider-repeat campaign keeps its resumable cursor", () => {
  const stuck = campaign("real-estate-stuck", {
    name: "Real Estate Agents and Brokers prospects",
    location: "Johannesburg",
    target: 100,
    count: 11,
    budgetUsd: 0.3,
    spentUsd: 0.12,
    prospectIds: Array.from({ length: 11 }, (_, index) => `id-p${index + 10}`),
    seenProviderPlaceIds: Array.from(
      { length: 40 },
      (_, index) => `p${index + 1}`,
    ),
    endReason: "provider_repeat",
    exhausted: true,
    skip: 40,
    pagesFetched: 2,
    coverage: [
      {
        queryKey: "home-decor::tag:::legacy:johannesburg",
        nextSkip: 40,
        terminalReason: "provider_repeat",
      },
    ],
  });
  delete stuck.pageLog;
  const restored = parseStoredState(
    JSON.stringify({
      version: 2,
      ownerPubkey: "owner",
      currentId: stuck.id,
      campaigns: [stuck],
    }),
  );

  assert.equal(restored.currentId, "real-estate-stuck");
  assert.equal(restored.campaigns[0].pagesFetched, 2);
  assert.equal(restored.campaigns[0].skip, 40);
  assert.equal(restored.campaigns[0].endReason, "provider_repeat");
  assert.equal(restored.campaigns[0].coverage[0].nextSkip, 40);
  assert.equal(
    restored.campaigns[0].coverage[0].terminalReason,
    "provider_repeat",
  );
  assert.deepEqual(restored.campaigns[0].pageLog, []);
});

test("the end note survives a restart", () => {
  const note =
    "The provider did not offer another page for restaurants in Johannesburg, so this query stopped.";
  const state = withCampaigns(campaign("one", { endNote: note }));
  const restored = parseStoredState(serializeState(state));
  assert.equal(restored.campaigns[0].endNote, note);
});

test("picked tags and their independent cursors survive a restart", () => {
  const state = withCampaigns(
    campaign("tagged", {
      pickedTags: ["wedding guest", "bridal suite"],
      tagCursors: [10, null],
      pendingTagCursors: [20, null],
    }),
  );
  const restored = parseStoredState(serializeState(state)).campaigns[0];
  assert.deepEqual(restored.pickedTags, ["wedding guest", "bridal suite"]);
  assert.deepEqual(restored.tagCursors, [10, null]);
  assert.deepEqual(restored.pendingTagCursors, [20, null]);
});

test("a saved vertical id is read under today's catalogue; its name and an unknown id stay as saved", () => {
  const old = campaign("old", {
    verticalId: "pest-control-services",
    verticalName: "Pest Control Services",
  });
  const restored = parseStoredState(serializeState(withCampaigns(old)));
  assert.equal(restored.campaigns[0].verticalId, "pest-control-companies");
  assert.equal(restored.campaigns[0].verticalName, "Pest Control Services");
  const unmapped = parseStoredState(
    serializeState(withCampaigns(campaign("two"))),
  );
  assert.equal(unmapped.campaigns[0].verticalId, "home-decor");
});

test("on restart a running campaign is paused so Resume continues from its cursor", () => {
  const state = withCampaigns(campaign("one", { status: "running", skip: 40 }));
  const restored = parseStoredState(serializeState(state));
  assert.equal(restored.campaigns[0].status, "paused");
  assert.equal(restored.campaigns[0].skip, 40);
});

test("a post caught mid-send is never repeated after a restart", () => {
  const state = withCampaigns(
    campaign("one", {
      postedInSales: false,
      postState: "sending",
      pendingPost: true,
    }),
  );
  const restored = parseStoredState(serializeState(state)).campaigns[0];
  assert.equal(restored.postState, "posted");
  assert.equal(restored.pendingPost, false);
});

test("unreadable storage gives an empty list instead of throwing", () => {
  for (const raw of [
    null,
    "",
    "not json",
    "[]",
    '{"version":2,"campaigns":[]}',
    '{"version":1}',
  ]) {
    assert.deepEqual(parseStoredState(raw), emptyState());
  }
});

test("unusable campaigns are dropped, usable ones kept", () => {
  const raw = JSON.stringify({
    version: 1,
    ownerPubkey: null,
    currentId: "gone",
    campaigns: [
      campaign("good"),
      { id: "bad", name: "x" },
      { ...campaign("worse"), status: "exploded" },
      null,
    ],
  });
  const state = parseStoredState(raw);
  assert.deepEqual(
    state.campaigns.map((entry) => entry.id),
    ["good"],
  );
  assert.equal(state.currentId, null);
});

test("the list is newest first and capped", () => {
  const state = parseStoredState(
    JSON.stringify({
      version: 2,
      ownerPubkey: "owner",
      currentId: "c0",
      campaigns: Array.from({ length: MAX_STORED_CAMPAIGNS + 5 }, (_, index) =>
        campaign(`c${index}`, { createdAt: index }),
      ),
    }),
  );
  assert.equal(state.campaigns.length, MAX_STORED_CAMPAIGNS);
  assert.equal(state.campaigns[0].id, `c${MAX_STORED_CAMPAIGNS + 4}`);
  assert.equal(state.campaigns.at(-1).id, "c5");
});

test("upsert replaces in place and keeps the current campaign", () => {
  let state = setCurrent(
    withCampaigns(campaign("one"), campaign("two", { createdAt: 2_000 })),
    "one",
  );
  state = upsertCampaign(state, campaign("one", { count: 9 }));
  assert.equal(state.currentId, "one");
  assert.equal(state.campaigns.find((entry) => entry.id === "one").count, 9);
  assert.equal(state.campaigns.length, 2);
});

test("only the best five fits are kept, best first", () => {
  let fits = [];
  for (const [id, fit] of [
    ["a", 65],
    ["b", 100],
    ["c", 80],
    ["d", 95],
    ["e", 30],
    ["f", 85],
    ["g", 100],
  ]) {
    fits = withTopFit(fits, { id, name: id.toUpperCase(), fit });
  }
  assert.deepEqual(
    fits.map((fit) => fit.id),
    ["b", "g", "d", "f", "c"],
  );
});

test("the public view exposes page evidence but hides private run bookkeeping", () => {
  const pageLog = [
    {
      page: 1,
      skip: 0,
      placesReturned: 20,
      newProspectsSaved: 3,
      alreadyInLeads: 17,
      repeatedInCampaign: 0,
      costUsd: 0.06,
      stopReason: "provider_end",
    },
  ];
  const view = toPublicCampaign(campaign("one", { pageLog, skip: 40 }));
  assert.equal("skip" in view, false);
  assert.equal("topFits" in view, false);
  assert.equal(view.simulated, false);
  assert.equal(view.runBy.name, "Lerato");
  assert.deepEqual(view.prospectIds, ["a", "b", "c"]);
  assert.deepEqual(view.runLog, pageLog);
  assert.equal(view.pagesFetched, 1);
});

test("storage that throws never breaks reading or writing", () => {
  const broken = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("full");
    },
  };
  assert.deepEqual(readState(broken, "k"), emptyState());
  assert.equal(writeState(broken, "k", emptyState()), false);
  assert.deepEqual(readState(null, "k"), emptyState());
  assert.equal(writeState(null, "k", emptyState()), false);
});

const PENDING_PAGE = {
  provider: "outscraper",
  places: [
    {
      placeId: "p1",
      name: "Olive Branch Studio",
      category: "Home goods store",
      subtypes: null,
      address: "1 Main Road",
      city: "Johannesburg",
      state: "Gauteng",
      country: "South Africa",
      phone: "+27 11 555 0100",
      website: "https://olive-branch.example",
      email: null,
      rating: 4.5,
      reviews: 20,
      latitude: null,
      longitude: null,
      mapsUrl: null,
      description: null,
      businessStatus: null,
    },
  ],
  estimatedCostUsd: 0.012,
  nextSkip: 20,
};

test("a page that was paid for but not saved survives a restart", () => {
  const state = withCampaigns(
    campaign("one", { status: "failed", pendingPage: PENDING_PAGE }),
  );
  const restored = parseStoredState(serializeState(state));
  assert.deepEqual(restored.campaigns[0].pendingPage, PENDING_PAGE);
});

test("an unreadable pending page is dropped without losing the campaign", () => {
  for (const junk of [
    "text",
    42,
    { places: "none" },
    { places: [] },
    { places: [null, 3] },
  ]) {
    const state = withCampaigns(campaign("one"));
    const raw = JSON.parse(serializeState(state));
    raw.campaigns[0].pendingPage = junk;
    const restored = parseStoredState(JSON.stringify(raw));
    assert.equal(restored.campaigns.length, 1);
    assert.equal(restored.campaigns[0].pendingPage, null);
  }
});

test("a stored pending page is capped at one server page of places", () => {
  const places = Array.from({ length: 80 }, (_, index) => ({
    ...PENDING_PAGE.places[0],
    placeId: `p${index}`,
  }));
  const state = withCampaigns(
    campaign("one", { pendingPage: { ...PENDING_PAGE, places } }),
  );
  const restored = parseStoredState(serializeState(state));
  assert.equal(restored.campaigns[0].pendingPage.places.length, 50);
});
