import * as React from "react";

export type DiscoveryAudience = "businesses" | "people";
export type DiscoveryRunStatus =
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "complete";

export type DiscoveryCampaign = {
  id: string;
  name: string;
  audience: DiscoveryAudience;
  industryId: string;
  industryName: string;
  verticalId: string;
  verticalName: string;
  location: string;
  target: number;
  count: number;
  budgetUsd: number;
  criteria: string;
  status: DiscoveryRunStatus;
  prospectIds: string[];
  created: boolean;
};

export type DiscoveryCampaignInput = Omit<
  DiscoveryCampaign,
  "id" | "count" | "budgetUsd" | "status" | "prospectIds" | "created"
>;

export type DiscoveryCampaignProvider = {
  getCurrent: () => DiscoveryCampaign | null;
  getCampaigns: () => DiscoveryCampaign[];
  select: (campaignId: string) => Promise<void>;
  subscribe: (
    listener: (campaign: DiscoveryCampaign | null) => void,
  ) => () => void;
  start: (input: DiscoveryCampaignInput) => Promise<DiscoveryCampaign>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
};

declare global {
  interface Window {
    __BUZZ_E2E_W10_DISCOVERY_PROVIDER__?: DiscoveryCampaignProvider;
    __BUZZ_E2E_W10_FAIL_NEXT_RUN__?: boolean;
  }
}

export function getDiscoveryCampaignProvider(): DiscoveryCampaignProvider | null {
  if (typeof window === "undefined") return null;
  return window.__BUZZ_E2E_W10_DISCOVERY_PROVIDER__ ?? null;
}

export function useDiscoveryCampaign() {
  const provider = getDiscoveryCampaignProvider();
  const [campaign, setCampaign] = React.useState<DiscoveryCampaign | null>(
    () => provider?.getCurrent() ?? null,
  );

  React.useEffect(() => {
    if (!provider) {
      setCampaign(null);
      return;
    }
    const unsubscribe = provider.subscribe(setCampaign);
    setCampaign(provider.getCurrent());
    return unsubscribe;
  }, [provider]);

  return { campaign, provider };
}
