import {
  enterNextArea,
  enterNextSuburb,
  movesToNextArea,
  movesToNextSuburb,
} from "./discoveryCampaignAreas";
import type { StoredCampaign } from "./discoveryCampaignStore";
import { enterNextWord, movesToNextWord } from "./discoveryCampaignWords";
import type { DiscoveryCoverage } from "./discoveryProvider";

/**
 * The next search of a running campaign whose search ran out before its
 * target, or null when the run stops here.
 *
 * In order: the next plain word for the same area; the next suburb search of
 * the chosen city (inside the place the owner chose, so no yes is needed);
 * the next nearby area, only after the owner's yes.
 */
export function nextSearchFor(
  campaign: StoredCampaign,
  covered: (queryKey: string) => DiscoveryCoverage,
): StoredCampaign | null {
  if (movesToNextWord(campaign)) return enterNextWord(campaign, covered);
  if (movesToNextSuburb(campaign)) return enterNextSuburb(campaign, covered);
  if (movesToNextArea(campaign)) return enterNextArea(campaign, covered);
  return null;
}
