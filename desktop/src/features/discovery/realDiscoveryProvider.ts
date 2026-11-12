/**
 * The production discovery runner. One controller per community runs a
 * campaign page by page: search through the relay, map each place to a
 * prospect record, publish it, and post the results in the Sales channel.
 *
 * Everything outside the state machine (search, publishing, posting, storage,
 * clock, timers) is injected through `DiscoveryDeps`, so the machine is tested
 * without a network. See AGENTS.md "Review-Proven Rules": a failure either
 * reaches the screen as a plain reason or leaves a durable retry record;
 * async results are fenced by generation; every loop is bounded.
 */

import type { ProspectChanges } from "./businessRecordMutations";
import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import {
  findCampaign,
  readState,
  setCurrent,
  toPublicCampaign,
  upsertCampaign,
  withTopFit,
  writeState,
  emptyState,
  type StorageLike,
  type StoredCampaign,
  type StoredState,
} from "./discoveryCampaignStore";
import {
  BUDGET_EPSILON_USD,
  BUDGET_USD_PER_PROSPECT,
  buildEndNote,
  continuationCursors,
  continuationFor,
  MAX_PAGES,
  PAGE_BUDGET_USD,
  roundUsd,
} from "./discoveryCampaignContinuation";
import { fitScore, leadNameKey, mapPlaceToProspect } from "./discoveryMapping";
import {
  fetchCampaignPage,
  responseCursor,
  type CampaignSearchSpec,
  type PreparedSearchPage,
} from "./discoverySearchPage";
import { matchDiscoveryTags } from "./discoveryTags";
import {
  cloneCampaignQualificationSettings,
  parseCampaignQualificationSettings,
  type CampaignQualificationSettings,
} from "./qualificationCampaign";
import type {
  DiscoveryCampaign,
  DiscoveryCampaignInput,
  DiscoveryCampaignProvider,
  DiscoveryCoverage,
  DiscoveryEndReason,
  DiscoveryPageLog,
  DiscoveryQueryEndReason,
} from "./discoveryProvider";
import {
  SEARCH_PAGE_SIZE,
  buildDiscoverySearchPlan,
  cursorHasPages,
  discoveryCoverageKey,
  discoveryCoverageKeys,
  isTransientSearchError,
  normalizePickedTags,
  QUERY_PLACE_CEILING,
  type DiscoveryPlace,
  type DiscoverySearchRequest,
  type DiscoverySearchResponse,
} from "./discoverySearch";

/** The owner-facing campaign form permits targets from 100 through 500. */
export const MIN_TARGET = 100;
export const MAX_TARGET = 500;
export const PUBLISH_CONCURRENCY = 3;
export const PUBLISH_BACKOFF_MS = [400, 800, 1600] as const;
export const SEARCH_BACKOFF_MS = [1_000, 3_000] as const;
export { BUDGET_USD_PER_PROSPECT, buildEndNote, MAX_PAGES };

export type DiscoveryContext = {
  /** The private Sales channel that holds business records. */
  channelId: string;
  /** The relay's tenant community id; never the local community id. */
  communityId: TenantCommunityId;
  pubkey: string;
  displayName: string;
  /** Record ids already in Leads. The controller adds what it saves. */
  existingProspectIds: Set<string>;
  /**
   * Names (see `leadNameKey`) of the leads that existed before this run. Leads
   * are one per business name, so a place with one of these names is skipped.
   */
  existingNames: ReadonlySet<string>;
};

export type DiscoveryDeps = {
  storage: StorageLike | null;
  storageKey: string;
  nowSeconds: () => number;
  newId: () => string;
  /** Resolves after `ms`, or rejects with an AbortError when `signal` fires. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  getOwnerPubkey: () => Promise<string>;
  /** Looks up the Sales channel, the signed-in person and existing leads. */
  resolveContext: () => Promise<DiscoveryContext>;
  search: (
    request: DiscoverySearchRequest,
    signal: AbortSignal,
  ) => Promise<DiscoverySearchResponse>;
  prospectId: (place: DiscoveryPlace) => Promise<string>;
  publishProspect: (input: {
    context: DiscoveryContext;
    changes: ProspectChanges;
  }) => Promise<void>;
  postToSales: (input: {
    context: DiscoveryContext;
    content: string;
  }) => Promise<void>;
  leadLink: (prospectId: string) => string;
};

export type DiscoveryController = DiscoveryCampaignProvider & {
  /** Stops any run and drops listeners. The next community builds a new one. */
  dispose: () => void;
  /** Resolves when no run is in flight (tests). */
  whenIdle: () => Promise<void>;
};

type ActiveRun = {
  campaignId: string;
  generation: number;
  abort: AbortController;
  done: Promise<void>;
};

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

function advanceCoverage(
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

function requestedCoverageKey(
  campaign: Pick<
    StoredCampaign,
    "verticalId" | "location" | "locationSelection" | "pickedTags"
  >,
  tagIndex: number | null,
): string {
  return discoveryCoverageKey({
    verticalId: campaign.verticalId,
    tag: tagIndex === null ? null : (campaign.pickedTags?.[tagIndex] ?? null),
    location: campaign.location,
    locationSelection: campaign.locationSelection,
  });
}

/**
 * The tag whose turn it is for the next page, from saved state alone. The cursor
 * and page count only move once a page is fully saved, so this names the tag
 * that the page being saved (even after a restart) was asked for.
 */
function requestedTagIndex(campaign: CampaignSearchSpec): number | null {
  const plan = buildDiscoverySearchPlan({
    verticalName: campaign.verticalName,
    location: campaign.location,
    locationSelection: campaign.locationSelection,
    skip: campaign.skip,
    pickedTags: campaign.pickedTags,
    tagCursors: campaign.tagCursors,
    turn: campaign.pagesFetched ?? 0,
  });
  return plan.requests[0]?.tagIndex ?? null;
}

export const FIRST_START_ERROR =
  "Pick a location from the list and choose 100 to 500 prospects.";
export const STOPPED_ERROR = "The search was stopped before it began.";
const GENERIC_STOP_REASON =
  "The search stopped. Retry when the connection is available.";

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function plainReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return GENERIC_STOP_REASON;
}

function alreadyExists(error: unknown): boolean {
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

export function createDiscoveryController(
  deps: DiscoveryDeps,
): DiscoveryController {
  let state: StoredState = readState(deps.storage, deps.storageKey);
  let generation = 0;
  let active: ActiveRun | null = null;
  let disposed = false;
  let flushing = false;
  const inflight = new Set<Promise<void>>();
  const flushAttempted = new Set<string>();
  const listeners = new Set<(campaign: DiscoveryCampaign | null) => void>();

  // ---- state ---------------------------------------------------------------

  function current(): DiscoveryCampaign | null {
    const campaign = findCampaign(state, state.currentId);
    return campaign ? toPublicCampaign(campaign) : null;
  }

  /** One snapshot write and one notification per change. */
  function commit(next: StoredState): void {
    state = next;
    writeState(deps.storage, deps.storageKey, state);
    const snapshot = current();
    for (const listener of [...listeners]) listener(snapshot);
  }

  function patch(
    id: string,
    change: (campaign: StoredCampaign) => StoredCampaign,
  ): StoredCampaign | null {
    const campaign = findCampaign(state, id);
    if (!campaign) return null;
    const next = change(campaign);
    commit(upsertCampaign(state, next));
    return next;
  }

  /** A different signed-in identity starts with an empty list. */
  function ensureOwner(pubkey: string): void {
    if (state.ownerPubkey === pubkey) return;
    if (state.ownerPubkey === null) {
      commit({ ...state, ownerPubkey: pubkey });
      return;
    }
    stopActive("paused");
    commit(emptyState(pubkey));
  }

  function stopActive(status: "paused" | "cancelled"): StoredCampaign | null {
    const run = active;
    if (!run) return null;
    generation += 1;
    run.abort.abort();
    active = null;
    return patch(run.campaignId, (campaign) => ({ ...campaign, status }));
  }

  // ---- search and save -----------------------------------------------------

  async function searchPage(
    run: ActiveRun,
    request: DiscoverySearchRequest,
  ): Promise<DiscoverySearchResponse> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await deps.search(request, run.abort.signal);
      } catch (error) {
        if (run.abort.signal.aborted || !isTransientSearchError(error)) {
          throw error;
        }
        const delay = SEARCH_BACKOFF_MS[attempt];
        if (delay === undefined) throw error;
        await deps.sleep(delay, run.abort.signal);
      }
    }
  }

  type PublishOutcome = "created" | "duplicate";

  async function publishWithRetry(
    run: ActiveRun,
    context: DiscoveryContext,
    changes: ProspectChanges,
  ): Promise<PublishOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await deps.publishProspect({ context, changes });
        return "created";
      } catch (error) {
        // The relay refuses a second create for the same record. On the first
        // try that means someone else saved it first; after a retry it means
        // our earlier try did land and only its acknowledgement was lost.
        if (alreadyExists(error))
          return attempt === 0 ? "duplicate" : "created";
        const delay = PUBLISH_BACKOFF_MS[attempt];
        if (delay === undefined || run.abort.signal.aborted) throw error;
        await deps.sleep(delay, run.abort.signal);
      }
    }
  }

  function recordSaved(
    run: ActiveRun,
    context: DiscoveryContext,
    id: string,
    name: string,
    fit: number,
  ): void {
    context.existingProspectIds.add(id);
    patch(run.campaignId, (campaign) =>
      campaign.prospectIds.includes(id)
        ? campaign
        : {
            ...campaign,
            count: campaign.count + 1,
            prospectIds: [...campaign.prospectIds, id],
            topFits: withTopFit(campaign.topFits, { id, name, fit }),
          },
    );
  }

  /** Each outcome records what this paid page actually added or skipped. */
  type PageOutcome =
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

  /**
   * Saves one page of places. Results that reach the relay are recorded on the
   * campaign even if the run was stopped meanwhile (they exist and belong to
   * the campaign); stopping only prevents starting further saves.
   */
  async function savePage(
    run: ActiveRun,
    context: DiscoveryContext,
    response: DiscoverySearchResponse,
  ): Promise<PageOutcome> {
    const campaign = findCampaign(state, run.campaignId);
    if (!campaign) {
      return {
        ok: true,
        newProspectsSaved: 0,
        alreadyInLeads: 0,
        providerPlaceIds: [],
        repeatedInCampaign: 0,
        providerLooped: false,
      };
    }
    const nowSeconds = deps.nowSeconds();
    const own = new Set(campaign.prospectIds);
    const seen = new Set<string>();
    const previousProviderIds = new Set(campaign.seenProviderPlaceIds);
    const providerPlaceIds = [
      ...new Set(
        response.places.flatMap((place) =>
          place.placeId?.trim() ? [place.placeId.trim()] : [],
        ),
      ),
    ];
    // Google Maps pages can overlap when its ordering shifts. A partial overlap
    // is normal and is only deduplicated. It is a loop only when every provider
    // id on the page was already returned to this campaign.
    const repeatedInCampaign = providerPlaceIds.filter((id) =>
      previousProviderIds.has(id),
    ).length;
    const providerLooped =
      providerPlaceIds.length > 0 &&
      repeatedInCampaign === providerPlaceIds.length;
    const fresh: Array<{ id: string; place: DiscoveryPlace }> = [];
    let alreadyInLeads = 0;
    for (const place of response.places) {
      const id = await deps.prospectId(place);
      if (own.has(id) || seen.has(id)) continue;
      seen.add(id);
      if (
        context.existingProspectIds.has(id) ||
        context.existingNames.has(leadNameKey(place.name))
      ) {
        alreadyInLeads += 1;
        continue;
      }
      fresh.push({ id, place });
    }
    const room = Math.max(0, campaign.target - campaign.count);
    const queue = fresh.slice(0, room);

    let failure: unknown = null;
    let newProspectsSaved = 0;
    for (
      let index = 0;
      index < queue.length && failure === null && !run.abort.signal.aborted;
      index += PUBLISH_CONCURRENCY
    ) {
      const chunk = queue.slice(index, index + PUBLISH_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async ({ id, place }) => {
          const discoveryTags = matchDiscoveryTags(
            campaign.verticalId,
            campaign.pickedTags ?? [],
            place,
          );
          const changes = mapPlaceToProspect(
            place,
            {
              campaignId: campaign.id,
              industry: campaign.industryName,
              vertical: campaign.verticalName,
              discoveryTags,
              nowSeconds,
            },
            id,
          );
          if (!changes) return null;
          const outcome = await publishWithRetry(run, context, changes);
          return { id, name: changes.displayName, outcome, place };
        }),
      );
      for (const result of settled) {
        if (result.status === "rejected") {
          failure ??= result.reason;
        } else if (result.value) {
          const { id, name, outcome, place } = result.value;
          if (outcome === "created") {
            recordSaved(run, context, id, name, fitScore(place));
            newProspectsSaved += 1;
          } else {
            context.existingProspectIds.add(id);
            alreadyInLeads += 1;
          }
        }
      }
    }
    if (alreadyInLeads > 0) {
      patch(run.campaignId, (existing) => ({
        ...existing,
        skippedDuplicates: existing.skippedDuplicates + alreadyInLeads,
      }));
    }
    if (failure !== null && !isAbortError(failure)) {
      return { ok: false, error: failure };
    }
    return {
      ok: true,
      newProspectsSaved,
      alreadyInLeads,
      providerPlaceIds,
      repeatedInCampaign,
      providerLooped,
    };
  }

  // ---- the run loop --------------------------------------------------------

  function isLive(run: ActiveRun): boolean {
    return !disposed && run.generation === generation;
  }

  /**
   * A page that arrives after a pause or stop was still paid for. Nothing on
   * it is saved (the run is over), but it is kept so Resume saves it instead
   * of searching again.
   */
  function keepLatePage(run: ActiveRun, page: PreparedSearchPage) {
    if (disposed) return;
    patch(run.campaignId, (existing) => ({
      ...existing,
      pendingPage: existing.pendingPage ?? page.response,
      pendingTagCursors: existing.pendingTagCursors ?? page.tagCursors,
    }));
  }

  function markLastPageStop(
    pageLog: DiscoveryPageLog[],
    stopReason: DiscoveryEndReason,
  ): DiscoveryPageLog[] {
    const last = pageLog.at(-1);
    if (!last) return pageLog;
    return [...pageLog.slice(0, -1), { ...last, stopReason }];
  }

  async function runLoop(
    run: ActiveRun,
    context: DiscoveryContext,
    first: PreparedSearchPage | null,
  ): Promise<void> {
    let pending = first;
    try {
      while (isLive(run)) {
        const campaign = findCampaign(state, run.campaignId);
        if (!campaign) return;
        if (campaign.count >= campaign.target || campaign.exhausted) {
          if (campaign.count >= campaign.target && !campaign.endReason) {
            patch(run.campaignId, (existing) => ({
              ...existing,
              endReason: "target_reached",
              pageLog: markLastPageStop(existing.pageLog, "target_reached"),
            }));
          }
          await finish(run, context);
          return;
        }
        // The owner approved the maximum up front. Do not ask for another
        // full page if its expected US$0.06 would exceed it. `MAX_PAGES` is
        // the matching hard ceiling for a 500-prospect approved budget.
        if (
          !campaign.pendingPage &&
          (campaign.pagesFetched >= MAX_PAGES ||
            campaign.spentUsd + PAGE_BUDGET_USD > campaign.budgetUsd + 0.0001)
        ) {
          patch(run.campaignId, (existing) => ({
            ...existing,
            exhausted: true,
            endReason: "approved_budget",
            pageLog: markLastPageStop(existing.pageLog, "approved_budget"),
          }));
          await finish(run, context);
          return;
        }
        const page =
          pending ??
          (await fetchCampaignPage(campaign, run.abort.signal, (request) =>
            searchPage(run, request),
          ));
        pending = null;
        if (!isLive(run)) {
          keepLatePage(run, page);
          return;
        }
        const response = page.response;
        // The page was paid for: keep it on the campaign until every place on
        // it is saved, so a failed save is retried from here, not re-searched.
        if (campaign.pendingPage !== response) {
          patch(run.campaignId, (existing) => ({
            ...existing,
            pendingPage: response,
            pendingTagCursors: page.tagCursors,
          }));
        }
        const outcome = await savePage(run, context, response);
        if (!isLive(run)) return;
        if (!outcome.ok) {
          await fail(run, context, outcome.error);
          return;
        }
        // Only a fully saved page moves the cursor, so a retry never skips
        // places that were found but not saved. Existing Leads do not end a
        // query: their next page can still hold new prospects. A page is a
        // loop only when every provider id on it was previously returned to
        // this campaign, so a normal partial overlap continues to its cursor.
        const next = responseCursor(response);
        patch(run.campaignId, (existing) => {
          const moved = existing.pendingTagCursors ?? page.tagCursors;
          const asked = requestedTagIndex(existing);
          const requestedSkip =
            asked === null
              ? existing.skip
              : (existing.tagCursors[asked] ?? existing.skip);
          // Tagged searches have their own cursor. The merged response's
          // `nextSkip` is only a display cursor and can reach 400 while a
          // different tag still has pages, so use the saved cursor for the
          // exact provider query that was asked.
          const providerEnded =
            asked === null ? next === null : moved[asked] === null;
          const pageReason = outcome.providerLooped
            ? "provider_repeat"
            : providerEnded
              ? response.places.length >= SEARCH_PAGE_SIZE &&
                requestedSkip + SEARCH_PAGE_SIZE >= QUERY_PLACE_CEILING
                ? "provider_ceiling"
                : "provider_end"
              : null;
          const tagCursors = moved.map((cursor, index) =>
            pageReason !== null && index === asked ? null : cursor,
          );
          const tagged = (existing.pickedTags ?? []).length > 0;
          const exhausted = tagged
            ? !tagCursors.some(cursorHasPages)
            : pageReason !== null;
          const reachedTarget = existing.count >= existing.target;
          const coverageNext = requestedSkip + SEARCH_PAGE_SIZE;
          const coverageTerminalReason =
            pageReason === "provider_end" ||
            pageReason === "provider_ceiling" ||
            pageReason === "provider_repeat"
              ? pageReason
              : null;
          const coverage = advanceCoverage(
            existing.coverage,
            requestedCoverageKey(existing, asked),
            coverageNext,
            coverageTerminalReason,
          );
          const seenProviderPlaceIds = [
            ...new Set([
              ...existing.seenProviderPlaceIds,
              ...outcome.providerPlaceIds,
            ]),
          ].slice(-QUERY_PLACE_CEILING);
          const stopReason = reachedTarget ? "target_reached" : pageReason;
          const pageLog: DiscoveryPageLog = {
            page: existing.pagesFetched + 1,
            skip: requestedSkip,
            placesReturned: response.places.length,
            newProspectsSaved: outcome.newProspectsSaved,
            alreadyInLeads: outcome.alreadyInLeads,
            repeatedInCampaign: outcome.repeatedInCampaign,
            costUsd: response.estimatedCostUsd,
            stopReason,
          };
          return {
            ...existing,
            skip: next ?? existing.skip + SEARCH_PAGE_SIZE,
            exhausted,
            pagesFetched: existing.pagesFetched + 1,
            spentUsd:
              Math.round(
                (existing.spentUsd + response.estimatedCostUsd) * 10_000,
              ) / 10_000,
            endReason: reachedTarget
              ? "target_reached"
              : exhausted
                ? pageReason
                : null,
            coverage,
            seenProviderPlaceIds,
            pageLog: [...existing.pageLog, pageLog].slice(-MAX_PAGES),
            pendingPage: null,
            tagCursors,
            pendingTagCursors: null,
          };
        });
      }
    } catch (error) {
      if (!isLive(run) || isAbortError(error)) return;
      await fail(run, context, error);
    }
  }

  async function finish(run: ActiveRun, context: DiscoveryContext) {
    if (active === run) active = null;
    patch(run.campaignId, (campaign) => ({
      ...campaign,
      status: "complete",
      failureReason: null,
      endNote: buildEndNote(campaign),
      pendingPost:
        campaign.count > 0 && campaign.postState !== "posted"
          ? true
          : campaign.pendingPost,
    }));
    await postResults(run.campaignId, context, "final");
  }

  async function fail(
    run: ActiveRun,
    context: DiscoveryContext,
    error: unknown,
  ) {
    if (active === run) active = null;
    const reason = plainReason(error);
    patch(run.campaignId, (campaign) => ({
      ...campaign,
      status: "failed",
      failureReason: reason,
    }));
    await postResults(run.campaignId, context, "stopped");
  }

  // ---- posting in Sales ----------------------------------------------------

  async function postResults(
    id: string,
    context: DiscoveryContext,
    kind: "final" | "stopped",
  ): Promise<void> {
    const campaign = findCampaign(state, id);
    if (!campaign || campaign.count === 0) {
      if (campaign?.pendingPost) {
        patch(id, (existing) => ({ ...existing, pendingPost: false }));
      }
      return;
    }
    if (kind === "final") {
      if (campaign.postedInSales || campaign.postState !== "none") return;
    } else if (campaign.stopNotePosted || campaign.postedInSales) {
      return;
    }
    const content = buildResultsMessage(campaign, kind, deps.leadLink);
    // The marker is written before the send. A crash in between can then skip
    // a post, but it can never post twice.
    patch(id, (existing) =>
      kind === "final"
        ? { ...existing, postState: "sending" }
        : { ...existing, stopNotePosted: true },
    );
    try {
      await deps.postToSales({ context, content });
    } catch (error) {
      console.warn("Could not post discovery results in Sales", error);
      if (kind === "final") {
        // Durable retry record: tried again on the next open or resume.
        patch(id, (existing) => ({
          ...existing,
          postState: "none",
          pendingPost: true,
        }));
      }
      return;
    }
    if (kind === "final") {
      patch(id, (existing) => ({
        ...existing,
        postState: "posted",
        postedInSales: true,
        pendingPost: false,
      }));
    }
  }

  /** Retries each unposted result message once per session. */
  async function flushPendingPosts(): Promise<void> {
    if (flushing || disposed) return;
    const due = state.campaigns.filter(
      (campaign) =>
        campaign.pendingPost &&
        campaign.postState === "none" &&
        campaign.status === "complete" &&
        !flushAttempted.has(campaign.id),
    );
    if (due.length === 0) return;
    flushing = true;
    try {
      const context = await deps.resolveContext();
      ensureOwner(context.pubkey);
      for (const campaign of due) {
        flushAttempted.add(campaign.id);
        await postResults(campaign.id, context, "final");
      }
    } catch (error) {
      // Nothing is lost: pendingPost stays set and the next open tries again.
      console.warn("Could not retry posting discovery results", error);
    } finally {
      flushing = false;
    }
  }

  // ---- starting and resuming -----------------------------------------------

  function beginRun(
    campaignId: string,
    context: DiscoveryContext,
    first: PreparedSearchPage | null,
  ): ActiveRun {
    generation += 1;
    const run: ActiveRun = {
      campaignId,
      generation,
      abort: new AbortController(),
      done: Promise.resolve(),
    };
    active = run;
    run.done = runLoop(run, context, first);
    const tracked = run.done;
    inflight.add(tracked);
    const forget = () => {
      inflight.delete(tracked);
    };
    tracked.then(forget, forget);
    return run;
  }

  async function continueCurrent(additionalBudgetUsd?: number): Promise<void> {
    const target = findCampaign(state, state.currentId);
    const continuation = target ? continuationFor(target) : null;
    if (!target || !continuation) return;
    if (continuation.state === "unavailable") {
      throw new Error(continuation.message ?? GENERIC_STOP_REASON);
    }
    const requestedAdditional =
      additionalBudgetUsd === undefined ? 0 : additionalBudgetUsd;
    if (
      !Number.isFinite(requestedAdditional) ||
      requestedAdditional < 0 ||
      (continuation.state === "approval_required" &&
        requestedAdditional + BUDGET_EPSILON_USD <
          continuation.minimumAdditionalBudgetUsd)
    ) {
      throw new Error(
        `Approve at least ${continuation.minimumAdditionalBudgetUsd.toFixed(2)} more to cover the next provider page.`,
      );
    }
    const context = await deps.resolveContext();
    if (disposed) return;
    ensureOwner(context.pubkey);
    const fresh = findCampaign(state, target.id);
    const freshContinuation = fresh ? continuationFor(fresh) : null;
    if (
      !fresh ||
      !freshContinuation ||
      freshContinuation.state === "unavailable"
    ) {
      return;
    }
    if (active && active.campaignId !== fresh.id) stopActive("paused");
    const cursorState =
      fresh.endReason === "provider_repeat"
        ? continuationCursors(fresh)
        : {
            skip: fresh.skip,
            tagCursors: [...fresh.tagCursors],
            coverage: fresh.coverage.map((entry) => ({ ...entry })),
          };
    patch(fresh.id, (campaign) => ({
      ...campaign,
      budgetUsd: roundUsd(campaign.budgetUsd + requestedAdditional),
      status: "running",
      failureReason: null,
      exhausted: false,
      endReason: null,
      endNote: null,
      skip: cursorState.skip,
      tagCursors: cursorState.tagCursors,
      coverage: cursorState.coverage,
    }));
    const resumed = findCampaign(state, fresh.id);
    if (!resumed) return;
    beginRun(
      resumed.id,
      context,
      resumed.pendingPage
        ? {
            response: resumed.pendingPage,
            tagCursors: resumed.pendingTagCursors ?? resumed.tagCursors,
          }
        : null,
    );
    void flushPendingPosts();
  }

  async function resumeCurrent(from: "paused" | "failed"): Promise<void> {
    const target = findCampaign(state, state.currentId);
    if (!target || target.status !== from) return;
    const context = await deps.resolveContext();
    if (disposed) return;
    ensureOwner(context.pubkey);
    const fresh = findCampaign(state, target.id);
    if (!fresh || fresh.status !== from) return;
    if (active && active.campaignId !== fresh.id) stopActive("paused");
    patch(fresh.id, (campaign) => ({
      ...campaign,
      status: "running",
      failureReason: null,
    }));
    // A page that was found but not fully saved is saved first; only then does
    // the run search for the next one.
    beginRun(
      fresh.id,
      context,
      fresh.pendingPage
        ? {
            response: fresh.pendingPage,
            tagCursors: fresh.pendingTagCursors ?? fresh.tagCursors,
          }
        : null,
    );
    void flushPendingPosts();
  }

  /**
   * A fresh campaign for an identical structured provider query starts after
   * every page this device durably saved. Each tag has its own cursor. Only
   * campaigns with trusted coverage count: older ones recorded pages the
   * provider never served, and following them made a new search for the same
   * type and place finish at once with nothing found.
   */
  function coveredQuery(queryKey: string): DiscoveryCoverage {
    const coverage = state.campaigns
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
              current.terminalReason ??
              coverageTerminalReason(entries, queryKey),
          };
        },
        { queryKey, nextSkip: 0, terminalReason: null },
      );
    return {
      ...coverage,
      nextSkip: Math.min(QUERY_PLACE_CEILING, coverage.nextSkip),
    };
  }

  const controller: DiscoveryController = {
    getCurrent: current,
    getCampaigns: () => state.campaigns.map(toPublicCampaign),
    getContinuation: () => {
      const campaign = findCampaign(state, state.currentId);
      return campaign ? continuationFor(campaign) : null;
    },
    continueCampaign: (additionalBudgetUsd) =>
      continueCurrent(additionalBudgetUsd),

    async select(campaignId) {
      if (state.currentId === campaignId) return;
      if (!findCampaign(state, campaignId)) return;
      if (active && active.campaignId !== campaignId) stopActive("paused");
      commit(setCurrent(state, campaignId));
      void flushPendingPosts();
    },

    subscribe(listener) {
      listeners.add(listener);
      void flushPendingPosts();
      return () => {
        listeners.delete(listener);
      };
    },

    async start(input: DiscoveryCampaignInput) {
      const location = input.location.trim();
      const target = Math.floor(input.target);
      const locationSelection = input.locationSelection ?? null;
      if (
        !location ||
        !locationSelection ||
        location !== locationSelection.label.trim() ||
        !Number.isFinite(target) ||
        // Older persisted campaigns and the focused state-machine tests can
        // have a smaller target. The only owner-facing entrypoint is the form,
        // which enforces MIN_TARGET before an approved run reaches here.
        target < 1 ||
        target > MAX_TARGET
      ) {
        throw new Error(FIRST_START_ERROR);
      }
      const context = await deps.resolveContext();
      if (disposed) throw new Error(STOPPED_ERROR);
      ensureOwner(context.pubkey);

      // The first page runs before anything is created, so a server that
      // cannot search (not set up, no credits) fails here with its plain
      // words and leaves no campaign behind.
      const probe = new AbortController();
      const pickedTags = normalizePickedTags(input.pickedTags);
      const coverageKeys = discoveryCoverageKeys({
        verticalId: input.verticalId,
        pickedTags,
        location,
        locationSelection,
      });
      const initialCoverage = coverageKeys.map(coveredQuery);
      const initialSkip = initialCoverage[0]?.nextSkip ?? 0;
      const initialTagCursors = pickedTags.map((_, index) => {
        const coverage = initialCoverage[index];
        return coverage &&
          coverage.terminalReason === null &&
          cursorHasPages(coverage.nextSkip)
          ? coverage.nextSkip
          : null;
      });
      const hasProviderPage = pickedTags.length
        ? initialTagCursors.some(cursorHasPages)
        : initialCoverage[0]?.terminalReason === null &&
          cursorHasPages(initialSkip);
      const first = hasProviderPage
        ? await fetchCampaignPage(
            {
              verticalId: input.verticalId,
              verticalName: input.verticalName,
              location,
              locationSelection,
              skip: initialSkip,
              pickedTags,
              tagCursors: initialTagCursors,
            },
            probe.signal,
            deps.search,
          )
        : null;
      if (disposed) throw new Error(STOPPED_ERROR);

      if (active) stopActive("paused");
      const campaign: StoredCampaign = {
        id: deps.newId(),
        name: input.name.trim() || `${input.verticalName} prospects`,
        audience: input.audience,
        industryId: input.industryId,
        industryName: input.industryName,
        verticalId: input.verticalId,
        verticalName: input.verticalName,
        pickedTags,
        location,
        locationSelection,
        target,
        count: 0,
        budgetUsd:
          Math.round(target * BUDGET_USD_PER_PROSPECT * 10_000) / 10_000,
        criteria: input.criteria,
        status: "running",
        prospectIds: [],
        created: true,
        simulated: false,
        runBy: { name: context.displayName, pubkey: context.pubkey },
        failureReason: null,
        postedInSales: false,
        createdAt: deps.nowSeconds(),
        skippedDuplicates: 0,
        seenProviderPlaceIds: [],
        spentUsd: 0,
        endReason: hasProviderPage
          ? null
          : (initialCoverage.find((cursor) => cursor.terminalReason)
              ?.terminalReason ?? "provider_ceiling"),
        pageLog: [],
        coverage: initialCoverage,
        trustedCoverage: true,
        skip: initialSkip,
        tagCursors: initialTagCursors,
        pendingTagCursors: first?.tagCursors ?? null,
        pagesFetched: 0,
        exhausted: !hasProviderPage,
        endNote: null,
        pendingPost: false,
        postState: "none",
        stopNotePosted: false,
        topFits: [],
        pendingPage: first?.response ?? null,
        qualification: parseCampaignQualificationSettings(input.qualification),
      };
      commit(setCurrent(upsertCampaign(state, campaign), campaign.id));
      beginRun(campaign.id, context, first);
      const created = findCampaign(state, campaign.id);
      return toPublicCampaign(created ?? campaign);
    },

    async updateQualification(
      campaignId: string,
      settings: CampaignQualificationSettings,
    ) {
      const updated = patch(campaignId, (campaign) => ({
        ...campaign,
        qualification: cloneCampaignQualificationSettings(settings),
      }));
      if (!updated) throw new Error("This discovery campaign is unavailable.");
      return toPublicCampaign(updated);
    },

    async pause() {
      const target = findCampaign(state, state.currentId);
      if (target?.status !== "running") return;
      if (active?.campaignId === target.id) stopActive("paused");
      else patch(target.id, (campaign) => ({ ...campaign, status: "paused" }));
    },

    resume: () => resumeCurrent("paused"),
    retry: () => resumeCurrent("failed"),

    async cancel() {
      const target = findCampaign(state, state.currentId);
      if (
        !target ||
        (target.status !== "running" && target.status !== "paused")
      ) {
        return;
      }
      if (active?.campaignId === target.id) stopActive("cancelled");
      else
        patch(target.id, (campaign) => ({ ...campaign, status: "cancelled" }));
    },

    dispose() {
      disposed = true;
      generation += 1;
      active?.abort.abort();
      active = null;
      listeners.clear();
    },

    whenIdle: async () => {
      // A run may hand off to a fresh run (retry), so wait until none is left.
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
  };

  // The saved list belongs to one identity; check it as soon as it is known.
  void deps
    .getOwnerPubkey()
    .then((pubkey) => {
      if (!disposed) ensureOwner(pubkey);
    })
    .catch((error: unknown) => {
      // Not fatal: the next start or resume resolves the identity again.
      console.warn(
        "Could not read the identity for discovery campaigns",
        error,
      );
    });

  return controller;
}
