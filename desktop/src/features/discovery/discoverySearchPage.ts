import type { StoredCampaign } from "./discoveryCampaignStore";
import {
  SEARCH_PAGE_SIZE,
  buildDiscoverySearchPlan,
  cursorHasPages,
  mergeDiscoverySearchResponses,
  type DiscoverySearchRequest,
  type DiscoverySearchResponse,
} from "./discoverySearch";

export type PreparedSearchPage = {
  response: DiscoverySearchResponse;
  tagCursors: Array<number | null>;
};

export type CampaignSearchSpec = Pick<
  StoredCampaign,
  | "verticalId"
  | "verticalName"
  | "location"
  | "locationSelection"
  | "skip"
  | "pickedTags"
  | "tagCursors"
> &
  Partial<Pick<StoredCampaign, "pagesFetched">>;

type SearchPage = (
  request: DiscoverySearchRequest,
  signal: AbortSignal,
) => Promise<DiscoverySearchResponse>;

export async function fetchCampaignPage(
  campaign: CampaignSearchSpec,
  signal: AbortSignal,
  search: SearchPage,
): Promise<PreparedSearchPage> {
  const plan = buildDiscoverySearchPlan({
    verticalName: campaign.verticalName,
    location: campaign.location,
    locationSelection: campaign.locationSelection,
    skip: campaign.skip,
    pickedTags: campaign.pickedTags,
    tagCursors: campaign.tagCursors,
    turn: campaign.pagesFetched ?? 0,
  });
  // One full page per turn: with tags they take turns, never share a page.
  const responses = await Promise.all(
    plan.requests.map(({ request }) => search(request, signal)),
  );
  if (!plan.pickedTags.length) {
    const response = responses[0];
    if (response) return { response, tagCursors: [] };
    return {
      response: mergeDiscoverySearchResponses([], null),
      tagCursors: [],
    };
  }

  const tagCursors = [...campaign.tagCursors];
  for (const [index, planned] of plan.requests.entries()) {
    const response = responses[index];
    if (planned.tagIndex !== null && response) {
      tagCursors[planned.tagIndex] = responseCursor(response);
    }
  }
  const nextSkip = tagCursors.some(cursorHasPages)
    ? campaign.skip + SEARCH_PAGE_SIZE
    : null;
  return {
    response: mergeDiscoverySearchResponses(responses, nextSkip),
    tagCursors,
  };
}

/** A next offset the provider can still serve; the 400 place ceiling ends it. */
function usableCursor(nextSkip: number | null): number | null {
  return cursorHasPages(nextSkip) ? nextSkip : null;
}

/**
 * The relay derives this cursor from the provider's raw page before it drops
 * malformed rows. A short normalized list can still come from a full paid
 * provider page, so only the cursor can honestly say whether to continue.
 */
export function responseCursor(
  response: DiscoverySearchResponse,
): number | null {
  return usableCursor(response.nextSkip);
}
