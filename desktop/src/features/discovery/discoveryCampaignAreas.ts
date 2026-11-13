import type { StoredCampaign } from "./discoveryCampaignStore";
import { distanceKm, type DiscoveryLocation } from "./discoveryLocation";
import type { DiscoveryCoverage } from "./discoveryProvider";
import { cursorHasPages, discoveryCoverageKeys } from "./discoverySearch";

/**
 * The areas one campaign can search: the place the owner chose, then the
 * nearby areas offered with it.
 *
 * A campaign only ever enters a nearby area after the owner said yes. The run
 * never widens the area by itself: when the chosen place runs out it stops and
 * asks.
 */
type AreaCampaign = Pick<StoredCampaign, "location" | "locationSelection"> &
  Partial<Pick<StoredCampaign, "areaIndex">>;

function withoutNearby(place: DiscoveryLocation): DiscoveryLocation {
  const { nearby: _nearby, ...rest } = place;
  return rest;
}

/** Nearby areas of the chosen place, nearest first. */
export function nearbyAreas(campaign: AreaCampaign): DiscoveryLocation[] {
  const chosen = campaign.locationSelection;
  if (!chosen?.nearby?.length) return [];
  return chosen.nearby
    .map((place, order) => ({
      place: withoutNearby(place),
      order,
      distance: distanceKm(chosen, place),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance || left.order - right.order,
    )
    .map((entry) => entry.place);
}

function areaIndexOf(campaign: AreaCampaign): number {
  const index = Math.floor(campaign.areaIndex ?? 0);
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, nearbyAreas(campaign).length);
}

/**
 * A copy of the campaign whose location is the area it is searching now, for
 * building search requests and coverage keys. The campaign itself keeps the
 * chosen place, which is what the screens name.
 */
export function inSearchArea<T extends AreaCampaign>(campaign: T): T {
  const index = areaIndexOf(campaign);
  if (index === 0) return campaign;
  const area = nearbyAreas(campaign)[index - 1];
  if (!area) return campaign;
  return { ...campaign, location: area.label, locationSelection: area };
}

/** The nearby area the campaign would search next, or null when none is left. */
export function nextNearbyArea(
  campaign: AreaCampaign,
): DiscoveryLocation | null {
  return nearbyAreas(campaign)[areaIndexOf(campaign)] ?? null;
}

/** Labels of the nearby areas not searched yet, nearest first. */
export function nearbyAreasLeft(campaign: AreaCampaign): string[] {
  return nearbyAreas(campaign)
    .slice(areaIndexOf(campaign))
    .map((place) => place.label);
}

/**
 * Labels of every area this campaign fetched a page from, in the order it
 * reached them. An area it was moved to but has not searched yet is not
 * listed, and neither is one an earlier search had already finished.
 */
export function areasSearched(
  campaign: Pick<StoredCampaign, "location" | "pageLog">,
): string[] {
  const areas = campaign.pageLog.map(
    (entry) => entry.area ?? campaign.location,
  );
  return areas.length ? [...new Set(areas)] : [campaign.location];
}

/** "Durban, KwaZulu-Natal, South Africa" reads as "Durban" in one short line. */
export function shortAreaName(label: string): string {
  return label.split(",")[0]?.trim() || label.trim();
}

const AREA_END_REASONS: ReadonlySet<string> = new Set([
  "provider_end",
  "provider_ceiling",
  "provider_repeat",
]);

/** Whether the area being searched ran out before the target was reached. */
export function areaRanOut(
  campaign: Pick<
    StoredCampaign,
    "exhausted" | "count" | "target" | "endReason"
  >,
): boolean {
  return (
    campaign.exhausted &&
    campaign.count < campaign.target &&
    campaign.endReason !== null &&
    AREA_END_REASONS.has(campaign.endReason)
  );
}

/**
 * Whether a running campaign moves on to its next nearby area now. True only
 * after the owner said yes to nearby areas: without that answer a campaign
 * whose area ran out finishes and asks.
 */
export function movesToNextArea(campaign: StoredCampaign): boolean {
  return (
    campaign.nearbyApproved &&
    !campaign.pendingPage &&
    areaRanOut(campaign) &&
    nextNearbyArea(campaign) !== null
  );
}

/**
 * The campaign as it starts its next nearby area: fresh cursors for that
 * area's searches, taken from what earlier campaigns on this device already
 * covered there. An area that was covered to its end is entered and left at
 * once, so the run goes on to the one after it.
 */
export function enterNextArea(
  campaign: StoredCampaign,
  covered: (queryKey: string) => DiscoveryCoverage,
): StoredCampaign {
  const area = nextNearbyArea(campaign);
  if (!area) return campaign;
  const pickedTags = campaign.pickedTags ?? [];
  const coverage = discoveryCoverageKeys({
    verticalId: campaign.verticalId,
    pickedTags,
    location: area.label,
    locationSelection: area,
  }).map(covered);
  const skip = coverage[0]?.nextSkip ?? 0;
  const tagCursors = pickedTags.map((_, index) => {
    const stream = coverage[index];
    return stream &&
      stream.terminalReason === null &&
      cursorHasPages(stream.nextSkip)
      ? stream.nextSkip
      : null;
  });
  const hasPage = pickedTags.length
    ? tagCursors.some(cursorHasPages)
    : coverage[0]?.terminalReason === null && cursorHasPages(skip);
  return {
    ...campaign,
    areaIndex: areaIndexOf(campaign) + 1,
    skip,
    tagCursors,
    pendingTagCursors: null,
    exhausted: !hasPage,
    endReason: hasPage ? null : "provider_end",
  };
}
