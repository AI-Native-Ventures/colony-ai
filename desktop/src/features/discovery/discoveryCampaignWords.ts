import { inSearchArea } from "./discoveryCampaignAreas";
import type { StoredCampaign } from "./discoveryCampaignStore";
import type { DiscoveryCoverage } from "./discoveryProvider";
import {
  buildSearchWords,
  cursorHasPages,
  discoveryCoverageKeys,
  normalizePickedTags,
  normalizeSearchWords,
  searchWordAt,
} from "./discoverySearch";
import { findVertical } from "./taxonomy";

/**
 * The plain words a campaign searches Maps with.
 *
 * Until 14 Nov 2026 a campaign sent Maps the catalogue's formal label
 * ("Furniture & Upholstery Repair Businesses") pinned to one small window
 * around the centre of the chosen place. Maps found 8 places for a whole
 * province and the run said the province had no more. Measured the same day:
 * the label as written finds 2 places province-wide, "upholsterers" finds a
 * full page at offset 100.
 *
 * A campaign now carries a short list of search words: the label in plain
 * words, then the catalogue's everyday names for the type. It searches the
 * whole named area with the first word and, when that word runs out before
 * the target, goes on with the next word in the same area. That is not
 * widening: it is the same business type in the same place. Nearby areas are
 * still only searched after the owner's yes, once every word has run out.
 */
export function searchWordsForType(
  verticalId: string,
  verticalName: string,
): string[] {
  return buildSearchWords(
    verticalName,
    findVertical(verticalId)?.aliases ?? [],
  );
}

type WordCampaign = Pick<StoredCampaign, "pickedTags"> &
  Partial<Pick<StoredCampaign, "searchWords" | "wordIndex">>;

function wordIndexOf(campaign: WordCampaign): number {
  const index = Math.floor(campaign.wordIndex ?? 0);
  if (!Number.isFinite(index) || index < 0) return 0;
  const words = normalizeSearchWords(campaign.searchWords);
  return Math.min(index, Math.max(0, words.length - 1));
}

/** The word an untagged campaign is searching with now; null for an older one. */
export function currentSearchWord(campaign: WordCampaign): string | null {
  return searchWordAt(campaign.searchWords, wordIndexOf(campaign));
}

/** The word a page of this campaign was asked with, for its page log. */
export function pageSearchWord(
  campaign: WordCampaign,
  tagIndex: number | null,
): string | null {
  return tagIndex === null
    ? currentSearchWord(campaign)
    : searchWordAt(campaign.searchWords, 0);
}

/** How many search words an untagged campaign has not started yet. */
export function searchWordsLeft(campaign: WordCampaign): number {
  if (normalizePickedTags(campaign.pickedTags).length > 0) return 0;
  const words = normalizeSearchWords(campaign.searchWords);
  return Math.max(0, words.length - 1 - wordIndexOf(campaign));
}

const WORD_END_REASONS: ReadonlySet<string> = new Set([
  "provider_end",
  "provider_ceiling",
  "provider_repeat",
]);

/**
 * Whether a running campaign goes on with its next search word now: the word
 * it was searching ran out in this area before the target and another word
 * is left. A tagged campaign has one search per tag and no word turns.
 */
export function movesToNextWord(campaign: StoredCampaign): boolean {
  return (
    !campaign.pendingPage &&
    campaign.exhausted &&
    campaign.count < campaign.target &&
    campaign.endReason !== null &&
    WORD_END_REASONS.has(campaign.endReason) &&
    searchWordsLeft(campaign) > 0
  );
}

/**
 * The campaign as it starts its next search word in the area it is in: a
 * fresh cursor for that word, taken from what earlier campaigns on this
 * device already covered. A word that was covered to its end is entered and
 * left at once, so the run goes on to the one after it.
 */
export function enterNextWord(
  campaign: StoredCampaign,
  covered: (queryKey: string) => DiscoveryCoverage,
): StoredCampaign {
  if (searchWordsLeft(campaign) <= 0) return campaign;
  const wordIndex = wordIndexOf(campaign) + 1;
  const area = inSearchArea(campaign);
  const queryKey = discoveryCoverageKeys({
    verticalId: campaign.verticalId,
    pickedTags: [],
    searchWords: campaign.searchWords,
    wordIndex,
    location: area.location,
    locationSelection: area.locationSelection,
  })[0];
  const stream = queryKey ? covered(queryKey) : null;
  const skip = stream?.nextSkip ?? 0;
  const hasPage =
    (stream?.terminalReason ?? null) === null && cursorHasPages(skip);
  return {
    ...campaign,
    wordIndex,
    skip,
    pendingTagCursors: null,
    exhausted: !hasPage,
    endReason: hasPage ? null : "provider_end",
  };
}

/** The page log field naming the word a page was asked with, when it has one. */
export function pageWordField(
  campaign: WordCampaign,
  tagIndex: number | null,
): { word?: string } {
  const word = pageSearchWord(campaign, tagIndex);
  return word ? { word } : {};
}

/**
 * What a page of nothing but businesses this campaign already found means.
 *
 * For the first word, a tag, or a campaign without words it is the paging
 * fault `provider_repeat` stands for. A later word mostly finds businesses an
 * earlier word already found: its first page is often the same top
 * businesses with new ones behind them, so one such page ends nothing (null)
 * and two in a row are the end of that word.
 */
export function repeatPageReason(
  campaign: StoredCampaign,
  tagIndex: number | null,
): "provider_repeat" | "provider_end" | null {
  const laterWord =
    tagIndex === null &&
    normalizeSearchWords(campaign.searchWords).length > 0 &&
    wordIndexOf(campaign) > 0;
  if (!laterWord) return "provider_repeat";
  const before = campaign.pageLog.at(-1);
  const repeatedTwice =
    before !== undefined &&
    before.word === pageSearchWord(campaign, tagIndex) &&
    before.area === inSearchArea(campaign).location &&
    before.placesReturned > 0 &&
    before.repeatedInCampaign >= before.placesReturned;
  return repeatedTwice ? "provider_end" : null;
}
