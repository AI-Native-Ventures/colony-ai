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
    location: "South Africa",
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
    createdAt: 1_000,
    skippedDuplicates: 0,
    skip: 20,
    pagesFetched: 1,
    exhausted: false,
    pendingPost: false,
    postState: "posted",
    stopNotePosted: false,
    topFits: [],
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
  assert.deepEqual(restored.campaigns[0], state.campaigns[0]);
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
  let state = emptyState("owner");
  for (let index = 0; index < MAX_STORED_CAMPAIGNS + 5; index += 1) {
    state = upsertCampaign(state, campaign(`c${index}`, { createdAt: index }));
  }
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

test("the public view hides run bookkeeping", () => {
  const view = toPublicCampaign(campaign("one", { skip: 40 }));
  assert.equal("skip" in view, false);
  assert.equal("topFits" in view, false);
  assert.equal(view.simulated, false);
  assert.equal(view.runBy.name, "Lerato");
  assert.deepEqual(view.prospectIds, ["a", "b", "c"]);
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
