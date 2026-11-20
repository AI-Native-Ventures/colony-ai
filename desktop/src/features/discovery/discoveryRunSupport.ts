import type { StoredCampaign } from "./discoveryCampaignStore";
import { pageSearchWord } from "./discoveryCampaignWords";
import type {
  DiscoveryRequestBudget,
  DiscoveryRequestKind,
} from "./discoveryRequestBudget";
import {
  buildDiscoverySearchPlan,
  discoveryCoverageKey,
  isTransientSearchError,
  RATE_LIMIT_EXHAUSTED_MESSAGE,
  rateLimitRetrySeconds,
  type DiscoverySearchRequest,
  type DiscoverySearchResponse,
} from "./discoverySearch";
import type { CampaignSearchSpec } from "./discoverySearchPage";

const GENERIC_STOP_REASON =
  "The search stopped. Retry when the connection is available.";

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function plainDiscoveryReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return GENERIC_STOP_REASON;
}

export function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

function escapeLinkText(text: string): string {
  return text
    .replace(/[\\[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The Sales message for a finished run, or a short note for a stopped one. */
export function buildResultsMessage(
  campaign: Pick<
    StoredCampaign,
    "name" | "verticalName" | "location" | "count" | "topFits"
  > &
    Partial<Pick<StoredCampaign, "endNote">>,
  kind: "final" | "stopped",
  leadLink: (prospectId: string) => string,
): string {
  const label = campaign.name.replace(/"/g, "'");
  const noun = campaign.count === 1 ? "prospect" : "prospects";
  const headline =
    kind === "final"
      ? `Found ${campaign.count} ${noun} for "${label}" (${campaign.verticalName} · ${campaign.location}).`
      : `The search "${label}" stopped after finding ${campaign.count} ${noun}.`;
  const note = kind === "final" ? campaign.endNote?.trim() : null;
  const head = note ? `${headline} ${note}` : headline;
  if (campaign.topFits.length === 0) return head;
  const lines = campaign.topFits.map(
    (fit) => `- [${escapeLinkText(fit.name)}](${leadLink(fit.id)})`,
  );
  const lead = kind === "final" ? "Best fits:" : "Best fits so far:";
  return [`${head} ${lead}`, ...lines].join("\n");
}

export function requestedCoverageKey(
  campaign: Pick<
    StoredCampaign,
    "verticalId" | "location" | "locationSelection" | "pickedTags"
  > &
    Partial<Pick<StoredCampaign, "searchWords" | "wordIndex">>,
  tagIndex: number | null,
): string {
  return discoveryCoverageKey({
    verticalId: campaign.verticalId,
    tag: tagIndex === null ? null : (campaign.pickedTags?.[tagIndex] ?? null),
    word: pageSearchWord(campaign, tagIndex),
    location: campaign.location,
    locationSelection: campaign.locationSelection,
  });
}

/** Finds the tag that owns the page being saved from durable cursor state. */
export function requestedTagIndex(campaign: CampaignSearchSpec): number | null {
  const plan = buildDiscoverySearchPlan({
    verticalName: campaign.verticalName,
    location: campaign.location,
    locationSelection: campaign.locationSelection,
    skip: campaign.skip,
    pickedTags: campaign.pickedTags,
    tagCursors: campaign.tagCursors,
    turn: campaign.pagesFetched ?? 0,
    searchWords: campaign.searchWords,
    wordIndex: campaign.wordIndex,
  });
  return plan.requests[0]?.tagIndex ?? null;
}

/** Shares only overlapping asynchronous loads, then refreshes on the next call. */
export function createSharedAsyncLoader<T>(
  load: () => Promise<T>,
): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const loading = load();
    inFlight = loading;
    void loading.then(
      () => {
        if (inFlight === loading) inFlight = null;
      },
      () => {
        if (inFlight === loading) inFlight = null;
      },
    );
    return loading;
  };
}

type SearchPageRunnerDeps = {
  budget: Pick<DiscoveryRequestBudget, "acquire">;
  maxRateLimitWaitMs: number;
  maxRateLimitWaits: number;
  search: (
    request: DiscoverySearchRequest,
    signal: AbortSignal,
  ) => Promise<DiscoverySearchResponse>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  transientBackoffMs: readonly number[];
};

/** Retries only bounded passing errors while charging every actual request. */
export function createSearchPageRunner({
  budget,
  maxRateLimitWaitMs,
  maxRateLimitWaits,
  search,
  sleep,
  transientBackoffMs,
}: SearchPageRunnerDeps) {
  return async function searchPage(
    campaignId: string,
    request: DiscoverySearchRequest,
    requestSignal: AbortSignal,
    waitSignal: AbortSignal,
    kind: DiscoveryRequestKind,
  ): Promise<DiscoverySearchResponse> {
    let transientAttempt = 0;
    let rateLimitWaits = 0;
    for (;;) {
      try {
        await budget.acquire({ campaignId, kind, signal: waitSignal });
        if (requestSignal.aborted || waitSignal.aborted) {
          throw new DOMException("The search was stopped.", "AbortError");
        }
        return await search(request, requestSignal);
      } catch (error) {
        if (
          requestSignal.aborted ||
          waitSignal.aborted ||
          isAbortError(error)
        ) {
          throw error;
        }
        const retryAfterSeconds = rateLimitRetrySeconds(error);
        if (retryAfterSeconds !== null) {
          if (rateLimitWaits >= maxRateLimitWaits) {
            throw new Error(RATE_LIMIT_EXHAUSTED_MESSAGE);
          }
          rateLimitWaits += 1;
          await sleep(
            Math.min(maxRateLimitWaitMs, retryAfterSeconds * 1_000),
            waitSignal,
          );
          continue;
        }
        if (!isTransientSearchError(error)) throw error;
        const delay = transientBackoffMs[transientAttempt];
        transientAttempt += 1;
        if (delay === undefined) throw error;
        await sleep(delay, waitSignal);
      }
    }
  };
}
