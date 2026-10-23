import * as React from "react";

import { getRealDiscoveryProvider } from "./discoveryRuntime";

export type DiscoveryAudience = "businesses" | "people";
export type DiscoveryRunStatus =
  | "running"
  | "paused"
  | "cancelled"
  | "failed"
  | "complete";

export type DiscoveryRunner = {
  name: string;
  pubkey: string | null;
};

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
  /** Who started the run; the screens say "Run by <name>". */
  runBy?: DiscoveryRunner | null;
  /**
   * True only for the test-build stand-in runner. The screens then keep the
   * design's "Example" wording; a real run never claims to be simulated.
   */
  simulated?: boolean;
  /** Plain-words reason shown when `status` is "failed". */
  failureReason?: string | null;
  /** Whether the results were posted in the Sales channel. */
  postedInSales?: boolean;
  /** Unix seconds the campaign was approved. */
  createdAt?: number;
  /** Places the search found that were already in Leads, so not added again. */
  skippedDuplicates?: number;
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

/**
 * The runner behind Find prospects. A test build may install a stand-in on
 * `window`; it always wins. Otherwise the real runner for the active community
 * (search through the relay, results saved as prospect records).
 */
export function getDiscoveryCampaignProvider(): DiscoveryCampaignProvider | null {
  if (typeof window === "undefined") return null;
  return (
    window.__BUZZ_E2E_W10_DISCOVERY_PROVIDER__ ?? getRealDiscoveryProvider()
  );
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
