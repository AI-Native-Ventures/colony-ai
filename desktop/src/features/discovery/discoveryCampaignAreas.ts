import type { StoredCampaign } from "./discoveryCampaignStore";
import { suburbsOf } from "./discoveryCityAreas";
import { distanceKm, type DiscoveryLocation } from "./discoveryLocation";
import type { DiscoveryCoverage } from "./discoveryProvider";
import {
  cursorHasPages,
  discoveryCoverageKeys,
  normalizePickedTags,
  normalizeSearchWords,
} from "./discoverySearch";

/**
 * The areas one campaign can search: the place the owner chose, its suburbs
 * when it is a big city (see `discoveryCityAreas.ts`), then the nearby areas
 * offered with it.
 *
 * Suburbs are part of the chosen city, so the run searches them by itself
 * once the whole-city search runs out. A campaign only ever enters a nearby
 * area after the owner said yes. The run never widens the area by itself:
 * when the chosen place and its suburbs run out it stops and asks.
 */
type AreaCampaign = Pick<StoredCampaign, "location" | "locationSelection"> &
  Partial<Pick<StoredCampaign, "areaIndex" | "suburbIndex">>;

function withoutNearby(place: DiscoveryLocation): DiscoveryLocation {
  const { nearby: _nearby, ...rest } = place;
  return rest;
}

/** The chosen city's suburbs, in search order; empty for any other place. */
export function suburbAreas(campaign: AreaCampaign): DiscoveryLocation[] {
  return suburbsOf(campaign.locationSelection);
}

function areaName(label: string): string {
  return shortAreaName(label).toLocaleLowerCase();
}

/**
 * Nearby areas of the chosen place, nearest first. A nearby area that is one
 * of the city's own suburbs is left out: the suburb search already covers it.
 */
export function nearbyAreas(campaign: AreaCampaign): DiscoveryLocation[] {
  const chosen = campaign.locationSelection;
  if (!chosen?.nearby?.length) return [];
  const suburbs = new Set(
    suburbAreas(campaign).map((place) => areaName(place.label)),
  );
  return chosen.nearby
    .filter((place) => !suburbs.has(areaName(place.label)))
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
  if (index === 0) {
    const suburb = suburbAreas(campaign)[suburbIndexOf(campaign) - 1];
    if (!suburb) return campaign;
    return { ...campaign, location: suburb.label, locationSelection: suburb };
  }
  const area = nearbyAreas(campaign)[index - 1];
  if (!area) return campaign;
  return { ...campaign, location: area.label, locationSelection: area };
}

/** 0 while the whole city is searched, k for its k-th suburb. */
function suburbIndexOf(campaign: AreaCampaign): number {
  const index = Math.floor(campaign.suburbIndex ?? 0);
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, suburbAreas(campaign).length);
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

type SuburbCampaign = AreaCampaign &
  Pick<StoredCampaign, "pickedTags"> &
  Partial<Pick<StoredCampaign, "searchWords" | "wordIndex">>;

/** How many searches one suburb has: one per word, or one for a tagged run. */
function wordTurns(campaign: SuburbCampaign): number {
  if (normalizePickedTags(campaign.pickedTags).length > 0) return 1;
  return Math.max(1, normalizeSearchWords(campaign.searchWords).length);
}

function wordTurnOf(campaign: SuburbCampaign): number {
  const index = Math.floor(campaign.wordIndex ?? 0);
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(index, wordTurns(campaign) - 1);
}

/**
 * Where the suburb search goes after the search it is on runs out, or null
 * when nothing is left in the chosen city.
 *
 * The whole city is searched first, with every word (see
 * `discoveryCampaignWords.ts`). Then each word goes through every suburb
 * before the next word starts: a suburb's first word finds mostly businesses
 * not seen yet, while a later word in the same suburb mostly repeats them.
 */
export function nextSuburbStep(
  campaign: SuburbCampaign,
): { suburbIndex: number; wordIndex: number } | null {
  if (areaIndexOf(campaign) > 0) return null;
  const count = suburbAreas(campaign).length;
  if (count === 0) return null;
  const suburb = suburbIndexOf(campaign);
  const word = wordTurnOf(campaign);
  if (suburb === 0) return { suburbIndex: 1, wordIndex: 0 };
  if (suburb < count) return { suburbIndex: suburb + 1, wordIndex: word };
  if (word + 1 < wordTurns(campaign)) {
    return { suburbIndex: 1, wordIndex: word + 1 };
  }
  return null;
}

/**
 * Labels of the city's suburbs the campaign has not searched yet, in search
 * order. Empty when the campaign has nothing left to search in the city.
 */
export function suburbsLeft(
  campaign: SuburbCampaign & Pick<StoredCampaign, "pageLog">,
): string[] {
  if (nextSuburbStep(campaign) === null) return [];
  const searched = new Set(
    campaign.pageLog.map((entry) => entry.area ?? campaign.location),
  );
  const labels = suburbAreas(campaign).map((place) => place.label);
  const unsearched = labels.filter((label) => !searched.has(label));
  return unsearched.length ? unsearched : labels;
}

/** How many of the city's suburbs this campaign fetched a page from. */
export function suburbsSearched(
  campaign: AreaCampaign & Pick<StoredCampaign, "pageLog">,
): number {
  const suburbs = new Set(suburbAreas(campaign).map((place) => place.label));
  return new Set(
    campaign.pageLog
      .map((entry) => entry.area)
      .filter(
        (area): area is string => area !== undefined && suburbs.has(area),
      ),
  ).size;
}

/**
 * Whether a running campaign goes on to its next suburb search now: the
 * search it was on ran out before the target, every word for the whole city
 * is used, and the city has a suburb search left. No yes is needed: the
 * suburbs are inside the place the owner chose.
 */
export function movesToNextSuburb(campaign: StoredCampaign): boolean {
  if (
    campaign.pendingPage ||
    !areaRanOut(campaign) ||
    campaign.endReason === "provider_repeat" ||
    nextSuburbStep(campaign) === null
  ) {
    return false;
  }
  // The whole city goes through its own words first.
  return (
    suburbIndexOf(campaign) > 0 ||
    wordTurnOf(campaign) + 1 >= wordTurns(campaign)
  );
}

/** A fresh cursor for each search of a place, after what was covered before. */
function freshCursors(
  campaign: StoredCampaign,
  place: DiscoveryLocation,
  wordIndex: number,
  covered: (queryKey: string) => DiscoveryCoverage,
): {
  skip: number;
  tagCursors: Array<number | null>;
  hasPage: boolean;
} {
  const pickedTags = campaign.pickedTags ?? [];
  const coverage = discoveryCoverageKeys({
    verticalId: campaign.verticalId,
    pickedTags,
    searchWords: campaign.searchWords,
    wordIndex,
    location: place.label,
    locationSelection: place,
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
  return { skip, tagCursors, hasPage };
}

/**
 * The campaign as it starts its next suburb search. A search an earlier
 * campaign on this device already covered to its end is entered and left at
 * once, so the run goes on to the one after it.
 */
export function enterNextSuburb(
  campaign: StoredCampaign,
  covered: (queryKey: string) => DiscoveryCoverage,
): StoredCampaign {
  const step = nextSuburbStep(campaign);
  if (!step) return campaign;
  const suburb = suburbAreas(campaign)[step.suburbIndex - 1];
  if (!suburb) return campaign;
  const { skip, tagCursors, hasPage } = freshCursors(
    campaign,
    suburb,
    step.wordIndex,
    covered,
  );
  // Only the page a search really ends on says so in Run details.
  const pageLog = campaign.pageLog.map((entry, index, all) =>
    index === all.length - 1 && entry.stopReason !== null
      ? { ...entry, stopReason: null }
      : entry,
  );
  return {
    ...campaign,
    suburbIndex: step.suburbIndex,
    wordIndex: step.wordIndex,
    skip,
    tagCursors,
    pageLog,
    pendingTagCursors: null,
    exhausted: !hasPage,
    endReason: hasPage ? null : "provider_end",
  };
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
  // A nearby area starts again with the campaign's first search word.
  const { skip, tagCursors, hasPage } = freshCursors(
    campaign,
    area,
    0,
    covered,
  );
  return {
    ...campaign,
    areaIndex: areaIndexOf(campaign) + 1,
    wordIndex: 0,
    skip,
    tagCursors,
    pendingTagCursors: null,
    exhausted: !hasPage,
    endReason: hasPage ? null : "provider_end",
  };
}
