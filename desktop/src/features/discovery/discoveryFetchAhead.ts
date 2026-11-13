/**
 * Asks for the next provider pages of a campaign while earlier pages are
 * being saved, so a run does not wait for one page before asking for the
 * next. Pages are still saved strictly in order by the run loop.
 *
 * Nothing extra is bought: only pages the approved budget already covers are
 * requested, and they would be asked for anyway, one after the other.
 */

import {
  BUDGET_EPSILON_USD,
  MAX_PAGES,
  PAGE_BUDGET_USD,
} from "./discoveryCampaignContinuation";
import type { StoredCampaign } from "./discoveryCampaignStore";
import {
  SEARCH_PAGE_SIZE,
  cursorHasPages,
  type DiscoverySearchRequest,
  type DiscoverySearchResponse,
} from "./discoverySearch";
import {
  fetchCampaignPage,
  type PreparedSearchPage,
} from "./discoverySearchPage";

/** Provider pages asked for ahead of the one a run is saving. */
export const PREFETCH_PAGES = 5;
/**
 * Pages asked ahead per minute. The relay allows a member 20 searches a
 * minute; the rest is left for pages asked for in turn and for retries.
 */
export const PREFETCH_REQUESTS_PER_MINUTE = 10;

export type FetchAhead = {
  /** Starts the requests this campaign is allowed to make ahead. */
  start: (campaign: StoredCampaign, pageInHand: boolean) => void;
  /** The page at the campaign's cursor: the one asked ahead, else `inTurn()`. */
  pageAt: (
    campaign: StoredCampaign,
    stopped: AbortSignal,
    inTurn: () => Promise<PreparedSearchPage>,
  ) => Promise<PreparedSearchPage>;
  /** Forgets a campaign's pages ahead; only offsets below `belowSkip` when given. */
  drop: (campaignId: string, belowSkip?: number) => void;
  /** Stops and forgets what one campaign (or every campaign) asked ahead. */
  stop: (campaignId?: string) => void;
};

/**
 * True once a campaign has seen the provider page forward: its latest saved
 * page is a second or later page and less than half of it repeated earlier
 * pages. Until 12 Nov 2026 a relay fault made every page a copy of the first;
 * asking ahead then would have bought the same page five times.
 */
export function providerPagesForward(
  campaign: Pick<StoredCampaign, "pageLog">,
): boolean {
  const last = campaign.pageLog.at(-1);
  return (
    last !== undefined &&
    last.page >= 2 &&
    last.placesReturned > 0 &&
    last.repeatedInCampaign * 2 < last.placesReturned
  );
}

export function createFetchAhead(deps: {
  nowSeconds: () => number;
  search: (
    request: DiscoverySearchRequest,
    signal: AbortSignal,
  ) => Promise<DiscoverySearchResponse>;
}): FetchAhead {
  /** Pages asked ahead, by campaign and offset, until a run saves them. */
  const pages = new Map<string, Promise<PreparedSearchPage>>();
  /** One stop switch per campaign. A pause does not use it: see `start`. */
  const aborts = new Map<string, AbortController>();
  /** Unix seconds of the requests made ahead in the last minute. */
  const starts: number[] = [];

  const keyOf = (campaignId: string, skip: number) => `${campaignId}:${skip}`;

  function requestsLeft(): number {
    const now = deps.nowSeconds();
    while (starts.length > 0 && now - (starts[0] ?? now) >= 60) starts.shift();
    return PREFETCH_REQUESTS_PER_MINUTE - starts.length;
  }

  function drop(campaignId: string, belowSkip?: number): void {
    const prefix = `${campaignId}:`;
    for (const key of [...pages.keys()]) {
      if (!key.startsWith(prefix)) continue;
      if (
        belowSkip === undefined ||
        Number(key.slice(prefix.length)) < belowSkip
      ) {
        pages.delete(key);
      }
    }
  }

  function stop(campaignId?: string): void {
    for (const [id, abort] of [...aborts]) {
      if (campaignId !== undefined && id !== campaignId) continue;
      abort.abort();
      aborts.delete(id);
      drop(id);
    }
  }

  /**
   * Bounds: the approved budget, the page cap, the provider ceiling,
   * `PREFETCH_PAGES` and the per-minute limit. Nothing is asked ahead before
   * the provider has shown that it pages forward. Tagged campaigns ask one
   * tag per turn and are left as they are.
   *
   * A request ahead is not retried here: a failure is forgotten and the page
   * is asked for again, with the usual backoff, when its turn comes. A pause
   * does not stop a request ahead, because the relay finishes and charges it
   * either way; the page stays in memory so Resume and Retry in the same
   * session do not buy it again. A page past the end of the provider's
   * results comes back empty and costs nothing.
   */
  function start(campaign: StoredCampaign, pageInHand: boolean): void {
    if ((campaign.pickedTags ?? []).length > 0) return;
    if (!providerPagesForward(campaign)) return;
    const affordable = Math.floor(
      (campaign.budgetUsd - campaign.spentUsd + BUDGET_EPSILON_USD) /
        PAGE_BUDGET_USD,
    );
    const count = Math.min(
      PREFETCH_PAGES,
      affordable,
      MAX_PAGES - campaign.pagesFetched,
    );
    for (let index = pageInHand ? 1 : 0; index < count; index += 1) {
      const skip = campaign.skip + index * SEARCH_PAGE_SIZE;
      if (!cursorHasPages(skip)) return;
      const key = keyOf(campaign.id, skip);
      if (pages.has(key)) continue;
      if (requestsLeft() <= 0) return;
      starts.push(deps.nowSeconds());
      let abort = aborts.get(campaign.id);
      if (!abort) {
        abort = new AbortController();
        aborts.set(campaign.id, abort);
      }
      const signal = abort.signal;
      const request = fetchCampaignPage({ ...campaign, skip }, signal, (ask) =>
        deps.search(ask, signal),
      );
      pages.set(key, request);
      request.catch(() => {
        if (pages.get(key) === request) pages.delete(key);
      });
    }
  }

  async function pageAt(
    campaign: StoredCampaign,
    stopped: AbortSignal,
    inTurn: () => Promise<PreparedSearchPage>,
  ): Promise<PreparedSearchPage> {
    const key = keyOf(campaign.id, campaign.skip);
    const ahead = pages.get(key);
    if (ahead) {
      try {
        const page = await ahead;
        pages.delete(key);
        return page;
      } catch {
        // The request ahead failed. Ask again in turn, with the usual retry.
        if (pages.get(key) === ahead) pages.delete(key);
        if (stopped.aborted) {
          throw new DOMException("The search was stopped.", "AbortError");
        }
      }
    }
    return inTurn();
  }

  return { start, pageAt, drop, stop };
}
