import type { DiscoveryEndReason, DiscoveryPageLog } from "./discoveryProvider";

/** The persisted outcome of saving one provider page. */
export type PageOutcome =
  | {
      ok: true;
      /** Prospects actually persisted from this provider page. */
      newProspectsSaved: number;
      /** Results that were already in Leads when this page was processed. */
      alreadyInLeads: number;
      /** Ids that identify overlap with an earlier campaign page. */
      providerPlaceIds: string[];
      repeatedInCampaign: number;
      /** Only a page made entirely of prior campaign ids is a provider loop. */
      providerLooped: boolean;
    }
  | { ok: false; error: unknown };

/** Replaces the last page result when an otherwise saved run stops. */
export function markLastPageStop(
  pageLog: DiscoveryPageLog[],
  stopReason: DiscoveryEndReason,
): DiscoveryPageLog[] {
  const last = pageLog.at(-1);
  if (!last) return pageLog;
  return [...pageLog.slice(0, -1), { ...last, stopReason }];
}
