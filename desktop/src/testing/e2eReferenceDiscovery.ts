import type {
  DiscoveryCampaign,
  DiscoveryCampaignInput,
  DiscoveryCampaignProvider,
} from "@/features/discovery/discoveryProvider";
import { REFERENCE_PROSPECT_IDS } from "./e2eReferenceWorkspace";

const REFERENCE_CAMPAIGN: DiscoveryCampaign = {
  id: "agency-prospects",
  name: "Independent brands needing social support",
  audience: "businesses",
  industryId: "home-living",
  industryName: "Home & Living",
  verticalId: "home-decor-gift-shops",
  verticalName: "Home Decor & Gift Shops",
  location: "South Africa",
  target: 50,
  count: 12,
  budgetUsd: 2.5,
  criteria: "",
  status: "complete",
  prospectIds: Object.values(REFERENCE_PROSPECT_IDS),
  created: false,
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

function createReferenceDiscoveryProvider(): DiscoveryCampaignProvider {
  let current = cloneCampaign(REFERENCE_CAMPAIGN);
  const campaigns = [cloneCampaign(REFERENCE_CAMPAIGN) as DiscoveryCampaign];
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
      input.verticalId === "home-decor-gift-shops" &&
      input.location.toLocaleLowerCase().includes("south africa");
    const prospectIds = hasReferenceResults
      ? Object.values(REFERENCE_PROSPECT_IDS)
      : [];
    const campaign: DiscoveryCampaign = {
      ...input,
      id: campaignId,
      count: 0,
      budgetUsd: Math.round(input.target * 5) / 100,
      status: prospectIds.length ? "running" : "complete",
      prospectIds,
      created: true,
    };
    update(campaign);
    if (campaign.status === "running") advanceProgress();
    return campaign;
  }

  return {
    getCurrent: () => cloneCampaign(current),
    getCampaigns: () =>
      campaigns.map((campaign) => cloneCampaign(campaign) as DiscoveryCampaign),
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

export function installReferenceDiscoveryProvider(): void {
  window.__BUZZ_E2E_W10_DISCOVERY_PROVIDER__ =
    createReferenceDiscoveryProvider();
}
