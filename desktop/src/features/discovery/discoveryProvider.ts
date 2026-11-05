import * as React from "react";

import type { DiscoveryLocation } from "./discoveryLocation";
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

/** Why a completed run cannot keep asking this query for another page. */
export type DiscoveryEndReason =
  | "target_reached"
  | "provider_end"
  | "provider_ceiling"
  | "approved_budget"
  | "provider_repeat";

/** Reasons a particular provider query stream cannot usefully continue. */
export type DiscoveryQueryEndReason = Extract<
  DiscoveryEndReason,
  "provider_end" | "provider_ceiling" | "provider_repeat"
>;

/**
 * A saved page boundary for a business type, its chosen tags and one exact
 * place. New campaigns use it to avoid paying for the same provider pages.
 */
export type DiscoveryCoverage = {
  queryKey: string;
  /** The first page offset that has not already been paid for and saved. */
  nextSkip: number;
  /** A terminal result on this device prevents another local campaign rebuying it. */
  terminalReason: DiscoveryQueryEndReason | null;
};

export type DiscoveryCampaign = {
  id: string;
  name: string;
  audience: DiscoveryAudience;
  industryId: string;
  industryName: string;
  verticalId: string;
  verticalName: string;
  /** Search refinements chosen from this type's generated tag layer. */
  pickedTags?: string[];
  location: string;
  /** A selected geocoder result. Legacy campaigns can omit it and still read. */
  locationSelection?: DiscoveryLocation | null;
  target: number;
  count: number;
  budgetUsd: number;
  /** Actual provider estimate accumulated from pages that were fully saved. */
  spentUsd?: number;
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
  /**
   * Plain-words reason a finished run is below its target; null when the target
   * was reached. It states only the observed stopping evidence.
   */
  endNote?: string | null;
  /** Machine-readable companion to `endNote`, used by Find more. */
  endReason?: DiscoveryEndReason | null;
  /** Device-local page boundaries, one for each provider query stream. */
  coverage?: DiscoveryCoverage[];
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
