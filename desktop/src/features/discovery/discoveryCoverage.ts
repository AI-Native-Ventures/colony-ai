import type { StoredCampaign } from "./discoveryCampaignStore";
import type {
  DiscoveryCoverage,
  DiscoveryQueryEndReason,
} from "./discoveryProvider";
import { QUERY_PLACE_CEILING } from "./discoverySearch";

/**
 * Page boundaries this device has durably saved for each exact provider query
 * (business type, tag and area), so a later search does not buy the same pages
 * again.
 */
function coverageCursor(
  coverage: readonly DiscoveryCoverage[],
  queryKey: string,
): number {
  return coverage.find((entry) => entry.queryKey === queryKey)?.nextSkip ?? 0;
}

function coverageTerminalReason(
  coverage: readonly DiscoveryCoverage[],
  queryKey: string,
): DiscoveryQueryEndReason | null {
  return (
    coverage.find((entry) => entry.queryKey === queryKey)?.terminalReason ??
    null
  );
}

/** The coverage list with one query moved forward to `nextSkip`. */
export function advanceCoverage(
  coverage: readonly DiscoveryCoverage[],
  queryKey: string,
  nextSkip: number,
  terminalReason: DiscoveryQueryEndReason | null,
): DiscoveryCoverage[] {
  const next = coverage.map((entry) =>
    entry.queryKey === queryKey
      ? {
          ...entry,
          nextSkip: Math.max(entry.nextSkip, nextSkip),
          terminalReason: terminalReason ?? entry.terminalReason,
        }
      : { ...entry },
  );
  if (!next.some((entry) => entry.queryKey === queryKey)) {
    next.push({ queryKey, nextSkip, terminalReason });
  }
  return next;
}

/**
 * How far a query was covered by any campaign whose coverage can be trusted,
 * and why it ended if it did.
 */
export function coveredQueryIn(
  campaigns: readonly Pick<StoredCampaign, "trustedCoverage" | "coverage">[],
  queryKey: string,
): DiscoveryCoverage {
  const coverage = campaigns
    .filter((campaign) => campaign.trustedCoverage)
    .map((campaign) => campaign.coverage)
    .reduce<DiscoveryCoverage>(
      (current, entries) => {
        const nextSkip = Math.max(
          current.nextSkip,
          coverageCursor(entries, queryKey),
        );
        return {
          queryKey,
          nextSkip,
          terminalReason:
            current.terminalReason ?? coverageTerminalReason(entries, queryKey),
        };
      },
      { queryKey, nextSkip: 0, terminalReason: null },
    );
  return {
    ...coverage,
    nextSkip: Math.min(QUERY_PLACE_CEILING, coverage.nextSkip),
  };
}
