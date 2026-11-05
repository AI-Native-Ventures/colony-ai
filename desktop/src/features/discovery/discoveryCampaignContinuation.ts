import type { StoredCampaign } from "./discoveryCampaignStore";
import type {
  DiscoveryContinuation,
  DiscoveryCoverage,
} from "./discoveryProvider";
import {
  SEARCH_PAGE_SIZE,
  cursorHasPages,
  discoveryCoverageKeys,
  QUERY_PLACE_CEILING,
} from "./discoverySearch";

/** Hard ceiling on search pages per campaign (25 x 20 = 500 places). */
export const MAX_PAGES = 25;
/** A 20-place provider page is approximately US$0.06. */
export const BUDGET_USD_PER_PROSPECT = 0.003;
export const PAGE_BUDGET_USD = SEARCH_PAGE_SIZE * BUDGET_USD_PER_PROSPECT;
export const BUDGET_EPSILON_USD = 0.0001;

export function roundUsd(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** The vertical as it reads inside a sentence ("Restaurants" to "restaurants"). */
function inSentence(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length > 1 && trimmed[1] === trimmed[1]?.toLocaleUpperCase()) {
    return trimmed;
  }
  return `${trimmed.charAt(0).toLocaleLowerCase()}${trimmed.slice(1)}`;
}

/**
 * Why a finished run is below its target, in plain words; null when the target
 * was reached. Shown on the campaign card and in the Sales message.
 */
export function buildEndNote(
  campaign: Pick<
    StoredCampaign,
    | "count"
    | "target"
    | "exhausted"
    | "pagesFetched"
    | "verticalName"
    | "location"
    | "pickedTags"
    | "endReason"
  >,
): string | null {
  if (campaign.count >= campaign.target) return null;
  const what = inSentence(campaign.verticalName) || "results";
  switch (campaign.endReason) {
    case "provider_repeat":
      return `The provider returned only places already seen in this campaign on page ${campaign.pagesFetched}. The search stopped before another paid request. Find more retries this campaign from its next saved page, or search a nearby area.`;
    case "provider_ceiling":
      return `The relay offered no next page after ${campaign.pagesFetched} pages because this query reached the provider's 400-place ceiling in ${campaign.location}. Search a nearby area or use another tag.`;
    case "provider_end": {
      const tagged = (campaign.pickedTags ?? []).length > 0;
      return tagged
        ? `The relay returned nextSkip null after ${campaign.pagesFetched} pages for ${what} with these tags in ${campaign.location}. The provider did not offer another page. Search a nearby area or use another tag.`
        : `The relay returned nextSkip null after ${campaign.pagesFetched} pages for ${what} in ${campaign.location}. The provider did not offer another page. Search a nearby area or use another tag.`;
    }
    case "approved_budget":
      return `The approved search budget was used after ${campaign.pagesFetched} pages. Find more asks you to approve more before this campaign continues from its next saved page.`;
    case "target_reached":
      return null;
    default:
      return campaign.exhausted
        ? `This saved campaign stopped before reaching its target, but it has no provider end reason. Find more to continue from its cursor or search a nearby area.`
        : `The approved search budget was used after ${campaign.pagesFetched} pages. Find more asks you to approve more before this campaign continues from its next saved page.`;
  }
}

function cappedCursor(cursor: number): number {
  return Math.min(QUERY_PLACE_CEILING, Math.max(0, cursor));
}

type ContinuationCursors = {
  skip: number;
  tagCursors: Array<number | null>;
  coverage: DiscoveryCoverage[];
};

/** Restores a false provider-repeat stop from its durable page boundaries. */
export function continuationCursors(
  campaign: StoredCampaign,
): ContinuationCursors {
  const keys = discoveryCoverageKeys({
    verticalId: campaign.verticalId,
    pickedTags: campaign.pickedTags,
    location: campaign.location,
    locationSelection: campaign.locationSelection,
  });
  const priorCoverage = new Map(
    campaign.coverage.map((entry) => [entry.queryKey, entry]),
  );
  const wasProviderRepeat = new Set(
    campaign.coverage
      .filter((entry) => entry.terminalReason === "provider_repeat")
      .map((entry) => entry.queryKey),
  );
  const coverage = campaign.coverage.map((entry) =>
    entry.terminalReason === "provider_repeat"
      ? { ...entry, terminalReason: null }
      : { ...entry },
  );
  const tagged = (campaign.pickedTags ?? []).length > 0;
  if (!tagged) {
    const skip = cappedCursor(campaign.pagesFetched * SEARCH_PAGE_SIZE);
    const queryKey = keys[0];
    const index = coverage.findIndex((entry) => entry.queryKey === queryKey);
    const resumed = { queryKey, nextSkip: skip, terminalReason: null };
    if (index >= 0) coverage[index] = resumed;
    else coverage.push(resumed);
    return { skip, tagCursors: [], coverage };
  }

  const tagCursors = (campaign.pickedTags ?? []).map((_, index) => {
    const queryKey = keys[index];
    const coverageEntry = queryKey ? priorCoverage.get(queryKey) : null;
    if (queryKey && wasProviderRepeat.has(queryKey)) {
      return cappedCursor(coverageEntry?.nextSkip ?? 0);
    }
    return campaign.tagCursors[index] ?? null;
  });
  // Very old records did not retain coverage. Recover the tag that was most
  // recently asked from its saved turn count rather than discarding the run.
  if (!tagCursors.some(cursorHasPages)) {
    const index = Math.max(0, campaign.pagesFetched - 1) % tagCursors.length;
    const queryKey = keys[index];
    const cursor = cappedCursor(campaign.pagesFetched * SEARCH_PAGE_SIZE);
    tagCursors[index] = cursor;
    if (queryKey) {
      const coverageIndex = coverage.findIndex(
        (entry) => entry.queryKey === queryKey,
      );
      const resumed = { queryKey, nextSkip: cursor, terminalReason: null };
      if (coverageIndex >= 0) coverage[coverageIndex] = resumed;
      else coverage.push(resumed);
    }
  }
  return {
    skip: campaign.skip,
    tagCursors,
    coverage,
  };
}

function pagesAvailableForContinuation(
  campaign: StoredCampaign,
  tagCursors: Array<number | null>,
  skip: number,
): number {
  const tagged = (campaign.pickedTags ?? []).length > 0;
  const cursorPages: number = tagged
    ? tagCursors.reduce<number>(
        (total, cursor) =>
          total +
          (cursorHasPages(cursor)
            ? Math.ceil(
                (QUERY_PLACE_CEILING - (cursor ?? 0)) / SEARCH_PAGE_SIZE,
              )
            : 0),
        0,
      )
    : cursorHasPages(skip)
      ? Math.ceil((QUERY_PLACE_CEILING - skip) / SEARCH_PAGE_SIZE)
      : 0;
  return Math.max(0, Math.min(MAX_PAGES - campaign.pagesFetched, cursorPages));
}

/** Computes an in-place continuation without creating a second campaign. */
export function continuationFor(
  campaign: StoredCampaign,
): DiscoveryContinuation | null {
  if (campaign.count >= campaign.target || campaign.status !== "complete") {
    return null;
  }
  const remainingTarget = Math.max(0, campaign.target - campaign.count);
  const isFalseRepeat = campaign.endReason === "provider_repeat";
  const cursors = isFalseRepeat
    ? continuationCursors(campaign)
    : {
        skip: campaign.skip,
        tagCursors: [...campaign.tagCursors],
        coverage: campaign.coverage,
      };
  const pagesAtProviderCeiling = pagesAvailableForContinuation(
    campaign,
    cursors.tagCursors,
    cursors.skip,
  );
  const estimatedPages = Math.min(
    pagesAtProviderCeiling,
    Math.max(1, Math.ceil(remainingTarget / SEARCH_PAGE_SIZE)),
  );
  const estimatedCostUsd = roundUsd(estimatedPages * PAGE_BUDGET_USD);
  const approvedRemainingUsd = Math.max(
    0,
    roundUsd(campaign.budgetUsd - campaign.spentUsd),
  );
  const minimumAdditionalBudgetUsd = roundUsd(
    Math.max(0, PAGE_BUDGET_USD - approvedRemainingUsd),
  );
  const recommendedAdditionalBudgetUsd = roundUsd(
    Math.max(
      minimumAdditionalBudgetUsd,
      estimatedCostUsd - approvedRemainingUsd,
    ),
  );
  const base = {
    campaignId: campaign.id,
    remainingTarget,
    pagesAtProviderCeiling,
    spentUsd: campaign.spentUsd,
    approvedBudgetUsd: campaign.budgetUsd,
    minimumAdditionalBudgetUsd,
    recommendedAdditionalBudgetUsd,
    estimatedPages,
    estimatedCostUsd,
  };
  if (campaign.endReason === "provider_end") {
    return {
      ...base,
      state: "unavailable",
      message: `The relay returned nextSkip null after ${campaign.pagesFetched} pages, so this provider query has no next page. Search a nearby area starts a new campaign.`,
    };
  }
  if (
    campaign.endReason === "provider_ceiling" ||
    pagesAtProviderCeiling === 0
  ) {
    return {
      ...base,
      state: "unavailable",
      message:
        "This query has reached the relay's 400-place provider ceiling. Search a nearby area starts a new campaign.",
    };
  }
  if (
    campaign.endReason !== "provider_repeat" &&
    campaign.endReason !== "approved_budget"
  ) {
    return null;
  }
  return {
    ...base,
    state:
      minimumAdditionalBudgetUsd > BUDGET_EPSILON_USD
        ? "approval_required"
        : "ready",
    message: null,
  };
}
