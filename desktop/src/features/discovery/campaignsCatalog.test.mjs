import assert from "node:assert/strict";
import test from "node:test";

import {
  campaignStatusFilter,
  createCampaignCatalog,
  queryCampaignCatalog,
} from "./campaignsCatalog.ts";

function campaign(index, overrides = {}) {
  return {
    id: `campaign-${index}`,
    name: `Campaign ${index}`,
    audience: "businesses",
    industryId: "home-living",
    industryName: "Home & Living",
    verticalId: "home-decor",
    verticalName: "Home Decor & Gift Shops",
    location: "Johannesburg",
    target: 50,
    count: index % 80,
    budgetUsd: 2.5,
    spentUsd: 1.25,
    criteria: "",
    status: "complete",
    prospectIds: [],
    created: true,
    createdAt: 1_700_000_000 + index,
    runBy: { name: "Aya", pubkey: null },
    ...overrides,
  };
}

test("campaign catalog searches every requested field and applies filters", () => {
  const catalog = createCampaignCatalog([
    campaign(1, {
      name: "Wedding studios",
      industryName: "Events",
      verticalName: "Wedding venues",
      location: "Cape Town",
      runBy: { name: "Mina", pubkey: null },
      status: "running",
    }),
    campaign(2, { status: "failed" }),
    campaign(3, { status: "cancelled" }),
  ]);

  assert.equal(queryCampaignCatalog(catalog, { q: "wedding" }).length, 1);
  assert.equal(queryCampaignCatalog(catalog, { q: "events" }).length, 1);
  assert.equal(queryCampaignCatalog(catalog, { q: "cape town" }).length, 1);
  assert.equal(queryCampaignCatalog(catalog, { runner: "Mina" }).length, 1);
  assert.equal(queryCampaignCatalog(catalog, { status: "failed" }).length, 1);
  assert.equal(queryCampaignCatalog(catalog, { status: "stopped" }).length, 1);
  assert.equal(campaignStatusFilter(campaign(4)), "ready");
});

test("five thousand campaigns filter within a generous budget", () => {
  const campaigns = Array.from({ length: 5_000 }, (_, index) =>
    campaign(index, {
      location: index === 4_321 ? "Needle City" : "Johannesburg",
      name: index === 4_321 ? "Needle campaign" : `Campaign ${index}`,
    }),
  );
  const catalog = createCampaignCatalog(campaigns);
  const started = performance.now();
  const result = queryCampaignCatalog(catalog, {
    q: "needle",
    sort: "newest",
  });
  const elapsed = performance.now() - started;

  assert.deepEqual(
    result.map((entry) => entry.campaign.id),
    ["campaign-4321"],
  );
  assert.ok(elapsed < 1_000, `filtering took ${elapsed.toFixed(1)}ms`);
});
