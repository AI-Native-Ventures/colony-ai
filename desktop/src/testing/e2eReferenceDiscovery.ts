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

// Keep multi-city screenshots honest: each fixture city returns its own
// reference businesses, so the aggregate table proves it combines cities.
const REFERENCE_MULTI_CITY_PROSPECT_IDS: Readonly<
  Record<string, readonly string[]>
> = {
  "Johannesburg, Gauteng, South Africa": [
    REFERENCE_PROSPECT_IDS["the-olive-house"],
    REFERENCE_PROSPECT_IDS["sunday-edit"],
    REFERENCE_PROSPECT_IDS["common-ground"],
    REFERENCE_PROSPECT_IDS["little-kin"],
  ],
  "Cape Town, Western Cape, South Africa": [
    REFERENCE_PROSPECT_IDS["form-field"],
    REFERENCE_PROSPECT_IDS.stillroom,
    REFERENCE_PROSPECT_IDS["clay-collective"],
    REFERENCE_PROSPECT_IDS["studio-local"],
    REFERENCE_PROSPECT_IDS["cedar-co"],
  ],
  "Durban, KwaZulu-Natal, South Africa": [
    REFERENCE_PROSPECT_IDS["gather-house"],
    REFERENCE_PROSPECT_IDS["north-note"],
  ],
  "Pretoria, Gauteng, South Africa": [REFERENCE_PROSPECT_IDS["woven-living"]],
};

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

declare global {
  interface Window {
    /** Locations that should return the reference prospects in multi-city E2E. */
    __BUZZ_E2E_MULTI_CITY_RESULT_LOCATIONS__?: string[];
    /** Keeps multi-city screenshot state stable until a test chooses to advance it. */
    __BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__?: boolean;
    /** Starts timers for frozen reference campaigns after a screenshot. */
    __BUZZ_E2E_REFERENCE_DISCOVERY_RESUME__?: () => void;
    /** Completes one running fixture campaign so scheduler tests stay deterministic. */
    __BUZZ_E2E_REFERENCE_DISCOVERY_COMPLETE_ONE__?: () => void;
  }
}

function cloneCampaign(
  campaign: DiscoveryCampaign | null,
): DiscoveryCampaign | null {
  return campaign
    ? { ...campaign, prospectIds: [...campaign.prospectIds] }
    : null;
}

function referenceProspectIdsFor(
  location: string | undefined,
): readonly string[] {
  return location
    ? (REFERENCE_MULTI_CITY_PROSPECT_IDS[location] ??
        REFERENCE_HOME_FURNISHINGS_PROSPECT_IDS)
    : REFERENCE_HOME_FURNISHINGS_PROSPECT_IDS;
}

function createReferenceDiscoveryProvider(
  initialCampaign: DiscoveryCampaign,
): DiscoveryCampaignProvider {
  let current = cloneCampaign(initialCampaign);
  const campaigns = [cloneCampaign(initialCampaign) as DiscoveryCampaign];
  let sequence = 0;
  const progressTimers = new Map<string, number>();
  const listeners = new Set<(campaign: DiscoveryCampaign | null) => void>();

  function publish() {
    const snapshot = cloneCampaign(current);
    for (const listener of listeners) listener(snapshot);
  }

  function update(campaign: DiscoveryCampaign) {
    const index = campaigns.findIndex(({ id }) => id === campaign.id);
    if (index >= 0) campaigns[index] = campaign;
    else campaigns.unshift(campaign);
    if (current?.id === campaign.id) current = cloneCampaign(campaign);
    publish();
  }

  function campaignById(campaignId: string): DiscoveryCampaign | null {
    return campaigns.find((campaign) => campaign.id === campaignId) ?? null;
  }

  function stopProgress(campaignId: string): void {
    const timer = progressTimers.get(campaignId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      progressTimers.delete(campaignId);
    }
  }

  function advanceProgress(campaignId: string): void {
    if (window.__BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__) return;
    const timer = window.setTimeout(() => {
      progressTimers.delete(campaignId);
      const running = campaignById(campaignId);
      if (running?.status !== "running") return;
      if (window.__BUZZ_E2E_W10_FAIL_NEXT_RUN__) {
        window.__BUZZ_E2E_W10_FAIL_NEXT_RUN__ = false;
        update({ ...running, status: "failed" });
        return;
      }
      const count = Math.min(
        running.target,
        running.prospectIds.length,
        running.count + RESULTS_PER_UPDATE,
      );
      const completionTarget = Math.min(
        running.target,
        running.prospectIds.length,
      );
      const status = count >= completionTarget ? "complete" : "running";
      update({ ...running, count, status });
      if (status === "running") advanceProgress(campaignId);
    }, PROGRESS_INTERVAL_MS);
    progressTimers.set(campaignId, timer);
  }

  function begin(input: DiscoveryCampaignInput, campaignId: string) {
    const hasReferenceResults =
      input.audience === "businesses" &&
      input.verticalId === "home-furnishings-retailers" &&
      ((input.locationSelection?.kind === "country" &&
        input.locationSelection.countryCode?.toUpperCase() === "ZA") ||
        Boolean(
          window.__BUZZ_E2E_MULTI_CITY_RESULT_LOCATIONS__?.includes(
            input.locationSelection?.label ?? "",
          ),
        ));
    const prospectIds = hasReferenceResults
      ? [...referenceProspectIdsFor(input.locationSelection?.label)]
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
    current = cloneCampaign(campaign);
    update(campaign);
    if (campaign.status === "running") {
      advanceProgress(campaign.id);
    }
    return campaign;
  }

  window.__BUZZ_E2E_REFERENCE_DISCOVERY_RESUME__ = () => {
    if (window.__BUZZ_E2E_REFERENCE_DISCOVERY_FREEZE__) return;
    for (const campaign of campaigns) {
      if (campaign.status === "running" && !progressTimers.has(campaign.id)) {
        advanceProgress(campaign.id);
      }
    }
  };

  window.__BUZZ_E2E_REFERENCE_DISCOVERY_COMPLETE_ONE__ = () => {
    const campaign = campaigns.find(
      (candidate) => candidate.status === "running",
    );
    if (!campaign) return;
    stopProgress(campaign.id);
    update({
      ...campaign,
      count: Math.min(campaign.target, campaign.prospectIds.length),
      status: "complete",
    });
  };

  return {
    getCurrent: () => cloneCampaign(current),
    getCampaigns: () =>
      campaigns.map((campaign) => cloneCampaign(campaign) as DiscoveryCampaign),
    getContinuationFor(campaignId) {
      const campaign = campaignById(campaignId);
      if (
        campaign?.status !== "complete" ||
        campaign.count >= campaign.target
      ) {
        return null;
      }
      return {
        campaignId: campaign.id,
        state: "ready" as const,
        message: null,
        remainingTarget: campaign.target - campaign.count,
        pagesAtProviderCeiling: 1,
        spentUsd: campaign.spentUsd ?? 0,
        approvedBudgetUsd: campaign.budgetUsd,
        minimumAdditionalBudgetUsd: 0,
        recommendedAdditionalBudgetUsd: 0,
        estimatedPages: 1,
        estimatedCostUsd: 0,
      };
    },
    getContinuation() {
      return current ? this.getContinuationFor(current.id) : null;
    },
    async continueCampaignFor(campaignId) {
      const campaign = campaignById(campaignId);
      if (
        campaign?.status !== "complete" ||
        campaign.count >= campaign.target
      ) {
        return;
      }
      update({ ...campaign, status: "running" });
      advanceProgress(campaign.id);
    },
    async continueCampaign() {
      if (current) await this.continueCampaignFor(current.id);
    },
    async select(campaignId) {
      if (current?.id === campaignId) return;
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
      if (window.__BUZZ_E2E_W10_FAIL_NEXT_START__) {
        window.__BUZZ_E2E_W10_FAIL_NEXT_START__ = false;
        throw new Error("No matching businesses in this area.");
      }
      sequence += 1;
      return begin(input, `fixture-campaign-${sequence}`);
    },
    async pause() {
      if (current?.status !== "running") return;
      stopProgress(current.id);
      update({ ...current, status: "paused" });
    },
    async resume() {
      if (current?.status !== "paused") return;
      update({ ...current, status: "running" });
      advanceProgress(current.id);
    },
    async cancel() {
      if (!current || !["running", "paused"].includes(current.status)) return;
      stopProgress(current.id);
      update({ ...current, status: "cancelled" });
    },
    async retry() {
      if (current?.status !== "failed") return;
      update({ ...current, status: "running" });
      advanceProgress(current.id);
    },
    async resumeCampaign(campaignId) {
      const campaign = campaignById(campaignId);
      if (campaign?.status !== "paused") return;
      update({ ...campaign, status: "running" });
      advanceProgress(campaign.id);
    },
    async retryCampaign(campaignId) {
      const campaign = campaignById(campaignId);
      if (campaign?.status !== "failed") return;
      update({ ...campaign, status: "running" });
      advanceProgress(campaign.id);
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
