import type {
  DiscoveryCampaign,
  DiscoveryCampaignInput,
  DiscoveryCampaignProvider,
} from "@/features/discovery/discoveryProvider";
import { BUDGET_USD_PER_PROSPECT } from "@/features/discovery/discoveryCampaignContinuation";
import {
  REFERENCE_DISCOVERY_CAMPAIGN_IDS,
  REFERENCE_AGENTS,
  REFERENCE_PROSPECT_IDS,
  referenceRestaurantProspectId,
} from "./e2eReferenceWorkspace";

const REFERENCE_RUNNER = {
  name: REFERENCE_AGENTS.aya.name,
  pubkey: REFERENCE_AGENTS.aya.pubkey,
};

function providerBudgetForTarget(target: number): number {
  return Math.round(target * BUDGET_USD_PER_PROSPECT * 10_000) / 10_000;
}

// The reference workspace also seeds guesthouse leads for outreach scenarios.
// Keep this simulated home-furnishings campaign restricted to its twelve
// matching fixture records.
const REFERENCE_HOME_FURNISHINGS_PROSPECT_IDS = [
  REFERENCE_PROSPECT_IDS["the-olive-house"],
  REFERENCE_PROSPECT_IDS["form-field"],
  REFERENCE_PROSPECT_IDS["sunday-edit"],
  REFERENCE_PROSPECT_IDS.stillroom,
  REFERENCE_PROSPECT_IDS["gather-house"],
  REFERENCE_PROSPECT_IDS["common-ground"],
  REFERENCE_PROSPECT_IDS["clay-collective"],
  REFERENCE_PROSPECT_IDS["woven-living"],
  REFERENCE_PROSPECT_IDS["little-kin"],
  REFERENCE_PROSPECT_IDS["north-note"],
  REFERENCE_PROSPECT_IDS["studio-local"],
  REFERENCE_PROSPECT_IDS["cedar-co"],
] as const;

const REFERENCE_CAMPAIGN: DiscoveryCampaign = {
  id: REFERENCE_DISCOVERY_CAMPAIGN_IDS.independentBrands,
  name: "Independent brands needing social support",
  audience: "businesses",
  industryId: "home-living",
  industryName: "Home & Living",
  verticalId: "home-furnishings-retailers",
  verticalName: "Home furnishings retailers",
  location: "South Africa",
  target: 50,
  count: 12,
  budgetUsd: providerBudgetForTarget(50),
  criteria: "",
  status: "complete",
  prospectIds: [...REFERENCE_HOME_FURNISHINGS_PROSPECT_IDS],
  created: false,
  runBy: REFERENCE_RUNNER,
  simulated: true,
  postedInSales: true,
};

const REFERENCE_GUESTHOUSE_CAMPAIGN: DiscoveryCampaign = {
  ...REFERENCE_CAMPAIGN,
  id: REFERENCE_DISCOVERY_CAMPAIGN_IDS.guesthouses,
  name: "Guesthouses, Johannesburg",
  industryId: "hospitality",
  industryName: "Hospitality",
  verticalId: "guesthouses",
  verticalName: "Guesthouses",
  location: "Johannesburg",
  target: 12,
  count: 12,
  budgetUsd: providerBudgetForTarget(12),
  prospectIds: [
    REFERENCE_PROSPECT_IDS.stillroom,
    REFERENCE_PROSPECT_IDS["north-note"],
    REFERENCE_PROSPECT_IDS["studio-local"],
    REFERENCE_PROSPECT_IDS["woven-living"],
    REFERENCE_PROSPECT_IDS["little-kin"],
    REFERENCE_PROSPECT_IDS["the-olive-house"],
    REFERENCE_PROSPECT_IDS["quiet-owl-bb"],
    REFERENCE_PROSPECT_IDS["marigold-house"],
    REFERENCE_PROSPECT_IDS["melville-hill-cottages"],
    REFERENCE_PROSPECT_IDS["sunday-edit"],
    REFERENCE_PROSPECT_IDS["gather-house"],
    REFERENCE_PROSPECT_IDS["common-ground"],
  ],
};

const REFERENCE_RESTAURANT_CAMPAIGN: DiscoveryCampaign = {
  ...REFERENCE_CAMPAIGN,
  id: REFERENCE_DISCOVERY_CAMPAIGN_IDS.restaurants,
  name: "Restaurants prospects",
  industryId: "restaurants",
  industryName: "Restaurants",
  verticalId: "restaurants",
  verticalName: "Restaurants",
  location: "Johannesburg",
  target: 41,
  count: 41,
  budgetUsd: providerBudgetForTarget(41),
  prospectIds: Array.from({ length: 41 }, (_, index) =>
    referenceRestaurantProspectId(index),
  ),
};

const PROGRESS_INTERVAL_MS = 800;
const RESULTS_PER_UPDATE = 3;

function cloneCampaign(
  campaign: DiscoveryCampaign | null,
): DiscoveryCampaign | null {
  return campaign
    ? { ...campaign, prospectIds: [...campaign.prospectIds] }
    : null;
}

function createReferenceDiscoveryProvider(
  initialCampaign: DiscoveryCampaign,
): DiscoveryCampaignProvider {
  let current = cloneCampaign(initialCampaign);
  const campaigns = [cloneCampaign(initialCampaign) as DiscoveryCampaign];
  let sequence = 0;
  let progressTimer: number | null = null;
  const listeners = new Set<(campaign: DiscoveryCampaign | null) => void>();

  function publish() {
    const snapshot = cloneCampaign(current);
    for (const listener of listeners) listener(snapshot);
  }

  function update(campaign: DiscoveryCampaign) {
    current = campaign;
    const index = campaigns.findIndex(({ id }) => id === campaign.id);
    if (index >= 0) campaigns[index] = campaign;
    else campaigns.unshift(campaign);
    publish();
  }

  function stopProgress() {
    if (progressTimer !== null) {
      window.clearTimeout(progressTimer);
      progressTimer = null;
    }
  }

  function advanceProgress() {
    progressTimer = window.setTimeout(() => {
      progressTimer = null;
      if (current?.status !== "running") return;
      if (window.__BUZZ_E2E_W10_FAIL_NEXT_RUN__) {
        window.__BUZZ_E2E_W10_FAIL_NEXT_RUN__ = false;
        update({ ...current, status: "failed" });
        return;
      }
      const count = Math.min(
        current.target,
        current.prospectIds.length,
        current.count + RESULTS_PER_UPDATE,
      );
      const completionTarget = Math.min(
        current.target,
        current.prospectIds.length,
      );
      const status = count >= completionTarget ? "complete" : "running";
      update({ ...current, count, status });
      if (status === "running") advanceProgress();
    }, PROGRESS_INTERVAL_MS);
  }

  function begin(input: DiscoveryCampaignInput, campaignId: string) {
    stopProgress();
    const hasReferenceResults =
      input.audience === "businesses" &&
      input.verticalId === "home-furnishings-retailers" &&
      input.locationSelection?.kind === "country" &&
      input.locationSelection.countryCode?.toUpperCase() === "ZA";
    const prospectIds = hasReferenceResults
      ? [...REFERENCE_HOME_FURNISHINGS_PROSPECT_IDS]
      : [];
    const campaign: DiscoveryCampaign = {
      ...input,
      id: campaignId,
      count: 0,
      budgetUsd: providerBudgetForTarget(input.target),
      status: prospectIds.length ? "running" : "complete",
      prospectIds,
      created: true,
      runBy: REFERENCE_RUNNER,
      simulated: true,
      postedInSales: true,
    };
    update(campaign);
    if (campaign.status === "running") advanceProgress();
    return campaign;
  }

  return {
    getCurrent: () => cloneCampaign(current),
    getCampaigns: () =>
      campaigns.map((campaign) => cloneCampaign(campaign) as DiscoveryCampaign),
    getContinuation() {
      if (current?.status !== "complete" || current.count >= current.target) {
        return null;
      }
      return {
        campaignId: current.id,
        state: "ready" as const,
        message: null,
        remainingTarget: current.target - current.count,
        pagesAtProviderCeiling: 1,
        spentUsd: current.spentUsd ?? 0,
        approvedBudgetUsd: current.budgetUsd,
        minimumAdditionalBudgetUsd: 0,
        recommendedAdditionalBudgetUsd: 0,
        estimatedPages: 1,
        estimatedCostUsd: 0,
      };
    },
    async continueCampaign() {
      if (current?.status !== "complete" || current.count >= current.target) {
        return;
      }
      update({ ...current, status: "running" });
      advanceProgress();
    },
    async select(campaignId) {
      if (current?.id === campaignId) return;
      if (current?.status === "running") {
        stopProgress();
        update({ ...current, status: "paused" });
      }
      const selected = campaigns.find((campaign) => campaign.id === campaignId);
      if (!selected) return;
      current = cloneCampaign(selected);
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start(input) {
      if (current?.status === "running") {
        stopProgress();
        update({ ...current, status: "paused" });
      }
      sequence += 1;
      return begin(input, `fixture-campaign-${sequence}`);
    },
    async pause() {
      if (current?.status !== "running") return;
      stopProgress();
      update({ ...current, status: "paused" });
    },
    async resume() {
      if (current?.status !== "paused") return;
      update({ ...current, status: "running" });
      advanceProgress();
    },
    async cancel() {
      if (!current || !["running", "paused"].includes(current.status)) return;
      stopProgress();
      update({ ...current, status: "cancelled" });
    },
    async retry() {
      if (current?.status !== "failed") return;
      update({ ...current, status: "running" });
      advanceProgress();
    },
  };
}

export function installReferenceDiscoveryProvider(
  whatsappGuesthouses = false,
  restaurantsBoard = false,
): void {
  window.__BUZZ_E2E_W10_DISCOVERY_PROVIDER__ = createReferenceDiscoveryProvider(
    restaurantsBoard
      ? REFERENCE_RESTAURANT_CAMPAIGN
      : whatsappGuesthouses
        ? REFERENCE_GUESTHOUSE_CAMPAIGN
        : REFERENCE_CAMPAIGN,
  );
}
