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
  MAX_SEEN_PROVIDER_PLACE_IDS,
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
import {
  enterNextArea,
  enterNextSuburb,
  inSearchArea,
} from "./discoveryCampaignAreas";
import { nextSearchFor } from "./discoveryCampaignSteps";
import {
  pageWordField,
  repeatPageReason,
  searchWordsForType,
} from "./discoveryCampaignWords";
import { advanceCoverage, coveredQueryIn } from "./discoveryCoverage";
import { createFetchAhead } from "./discoveryFetchAhead";
import { fitScore, leadNameKey, mapPlaceToProspect } from "./discoveryMapping";
import { createDiscoveryRequestBudget } from "./discoveryRequestBudget";
import {
  DiscoveryRunRegistry,
  type ActiveDiscoveryRun,
} from "./discoveryRunRegistry";
import {
  fetchCampaignPage,
  responseCursor,
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
} from "./discoveryProvider";
import {
  SEARCH_PAGE_SIZE,
  cursorHasPages,
  discoveryCoverageKeys,
  normalizePickedTags,
  QUERY_PLACE_CEILING,
  type DiscoveryPlace,
  type DiscoverySearchRequest,
  type DiscoverySearchResponse,
} from "./discoverySearch";
import {
  buildResultsMessage,
  createSearchPageRunner,
  createSharedAsyncLoader,
  isAbortError,
  isAlreadyExistsError,
  plainDiscoveryReason,
  requestedCoverageKey,
  requestedTagIndex,
} from "./discoveryRunSupport";

/** The owner-facing campaign form permits targets from 100 through 500. */
export const MIN_TARGET = 100;
export const MAX_TARGET = 500;
export const PUBLISH_CONCURRENCY = 6;
export const PUBLISH_BACKOFF_MS = [400, 800, 1600] as const;
export const SEARCH_BACKOFF_MS = [1_000, 3_000] as const;
export const MAX_RATE_LIMIT_WAITS = 6;
export const MAX_RATE_LIMIT_WAIT_MS = 65_000;
export { BUDGET_USD_PER_PROSPECT, buildEndNote, MAX_PAGES };
export { buildResultsMessage, isAbortError };

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

export const FIRST_START_ERROR =
  "Pick a location from the list and choose 100 to 500 prospects.";
export const STOPPED_ERROR = "The search was stopped before it began.";
export function createDiscoveryController(
  deps: DiscoveryDeps,
): DiscoveryController {
  let state: StoredState = readState(deps.storage, deps.storageKey);
  let disposed = false;
  let flushing = false;
  let probeSequence = 0;
  const startProbes = new Set<AbortController>();
  const runs = new DiscoveryRunRegistry();
  const requestBudget = createDiscoveryRequestBudget({
    nowSeconds: deps.nowSeconds,
    sleep: deps.sleep,
  });
  const resolveStartContext = createSharedAsyncLoader(deps.resolveContext);
  const searchPage = createSearchPageRunner({
    budget: requestBudget,
    maxRateLimitWaitMs: MAX_RATE_LIMIT_WAIT_MS,
    maxRateLimitWaits: MAX_RATE_LIMIT_WAITS,
    search: deps.search,
    sleep: deps.sleep,
    transientBackoffMs: SEARCH_BACKOFF_MS,
  });
  // Later approved pages are asked for while earlier ones are being saved.
  const ahead = createFetchAhead();
  const flushAttempted = new Set<string>();
  /** Cross-run reservations close the gap between duplicate check and publish. */
  const pendingProspectIds = new Set<string>();
  const pendingLeadNames = new Set<string>();
  const savedProspectIds = new Set<string>();
  const savedLeadNames = new Set<string>();
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
    stopAllRuns("paused");
    ahead.stop();
    pendingProspectIds.clear();
    pendingLeadNames.clear();
    savedProspectIds.clear();
    savedLeadNames.clear();
    commit(emptyState(pubkey));
  }

  function stopRun(
    campaignId: string,
    status: "paused" | "cancelled",
  ): StoredCampaign | null {
    const run = runs.stop(campaignId);
    requestBudget.unregisterCampaign(campaignId);
    if (!run) return null;
    return patch(run.campaignId, (campaign) => ({ ...campaign, status }));
  }

  function stopAllRuns(status: "paused" | "cancelled"): void {
    for (const run of runs.stopAll()) {
      requestBudget.unregisterCampaign(run.campaignId);
      patch(run.campaignId, (campaign) => ({ ...campaign, status }));
    }
  }

  type PublishOutcome = "created" | "duplicate";

  async function publishWithRetry(
    run: ActiveDiscoveryRun,
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
        if (isAlreadyExistsError(error))
          return attempt === 0 ? "duplicate" : "created";
        const delay = PUBLISH_BACKOFF_MS[attempt];
        if (delay === undefined || run.abort.signal.aborted) throw error;
        await deps.sleep(delay, run.abort.signal);
      }
    }
  }

  function recordSaved(
    run: ActiveDiscoveryRun,
    context: DiscoveryContext,
    id: string,
    name: string,
    fit: number,
  ): void {
    context.existingProspectIds.add(id);
    savedProspectIds.add(id);
    savedLeadNames.add(leadNameKey(name));
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
    run: ActiveDiscoveryRun,
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
    const fresh: Array<{
      id: string;
      place: DiscoveryPlace;
      reservationName: string;
    }> = [];
    const reservedIds = new Set<string>();
    const reservedNames = new Set<string>();
    let alreadyInLeads = 0;
    for (const place of response.places) {
      const id = await deps.prospectId(place);
      if (own.has(id) || seen.has(id)) continue;
      seen.add(id);
      const name = leadNameKey(place.name);
      if (
        context.existingProspectIds.has(id) ||
        context.existingNames.has(name) ||
        savedProspectIds.has(id) ||
        savedLeadNames.has(name) ||
        pendingProspectIds.has(id) ||
        pendingLeadNames.has(name)
      ) {
        alreadyInLeads += 1;
        continue;
      }
      pendingProspectIds.add(id);
      pendingLeadNames.add(name);
      reservedIds.add(id);
      reservedNames.add(name);
      fresh.push({ id, place, reservationName: name });
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
        chunk.map(async ({ id, place, reservationName }) => {
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
          return {
            id,
            name: changes.displayName,
            reservationName,
            nameKey: leadNameKey(changes.displayName),
            outcome,
            place,
          };
        }),
      );
      for (const result of settled) {
        if (result.status === "rejected") {
          failure ??= result.reason;
        } else if (result.value) {
          const { id, name, nameKey, outcome, place, reservationName } =
            result.value;
          pendingProspectIds.delete(id);
          pendingLeadNames.delete(reservationName);
          reservedIds.delete(id);
          reservedNames.delete(reservationName);
          if (outcome === "created") {
            recordSaved(run, context, id, name, fitScore(place));
            newProspectsSaved += 1;
          } else {
            context.existingProspectIds.add(id);
            savedProspectIds.add(id);
            savedLeadNames.add(nameKey);
            alreadyInLeads += 1;
          }
        }
      }
    }
    // A failed or stopped chunk keeps the durable page for retry. Its local
    // reservation must be released first, otherwise that retry would skip its
    // own unsaved business forever.
    for (const id of reservedIds) pendingProspectIds.delete(id);
    for (const name of reservedNames) pendingLeadNames.delete(name);
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

  function isLive(run: ActiveDiscoveryRun): boolean {
    return !disposed && runs.isLive(run);
  }

  /**
   * A page that arrives after a pause or stop was still paid for. Nothing on
   * it is saved (the run is over), but it is kept so Resume saves it instead
   * of searching again.
   */
  function keepLatePage(run: ActiveDiscoveryRun, page: PreparedSearchPage) {
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
    run: ActiveDiscoveryRun,
    context: DiscoveryContext,
    first: PreparedSearchPage | null,
  ): Promise<void> {
    let pending = first;
    try {
      while (isLive(run)) {
        const campaign = findCampaign(state, run.campaignId);
        if (!campaign) return;
        // The search ran out before the target: the next word, the next
        // suburb of the chosen city, or (after a yes) the next nearby area.
        if (nextSearchFor(campaign, coveredQuery)) {
          ahead.stop(campaign.id);
          patch(run.campaignId, (it) => nextSearchFor(it, coveredQuery) ?? it);
          continue;
        }
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
        // a hard ceiling on searches, short suburb pages included.
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
        const searching = inSearchArea(campaign);
        ahead.drop(campaign.id, campaign.skip);
        ahead.start(searching, pending !== null, (request, aheadSignal) =>
          searchPage(
            run.campaignId,
            request,
            aheadSignal,
            run.abort.signal,
            "ahead",
          ),
        );
        const page =
          pending ??
          (await ahead.pageAt(searching, run.abort.signal, () =>
            fetchCampaignPage(searching, run.abort.signal, (request) =>
              searchPage(
                run.campaignId,
                request,
                run.abort.signal,
                run.abort.signal,
                "in_turn",
              ),
            ),
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
          const repeatReason = outcome.providerLooped
            ? repeatPageReason(existing, asked)
            : null;
          const pageReason = repeatReason
            ? repeatReason
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
            requestedCoverageKey(inSearchArea(existing), asked),
            coverageNext,
            coverageTerminalReason,
          );
          const seenProviderPlaceIds = [
            ...new Set([
              ...existing.seenProviderPlaceIds,
              ...outcome.providerPlaceIds,
            ]),
          ].slice(-MAX_SEEN_PROVIDER_PLACE_IDS);
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
            area: inSearchArea(existing).location,
            ...pageWordField(existing, asked),
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

  async function finish(run: ActiveDiscoveryRun, context: DiscoveryContext) {
    if (!runs.retire(run)) return;
    requestBudget.unregisterCampaign(run.campaignId);
    ahead.stop(run.campaignId);
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
    run: ActiveDiscoveryRun,
    context: DiscoveryContext,
    error: unknown,
  ) {
    if (!runs.retire(run)) return;
    requestBudget.unregisterCampaign(run.campaignId);
    const reason = plainDiscoveryReason(error);
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
  ): ActiveDiscoveryRun {
    const run = runs.begin(campaignId);
    requestBudget.registerCampaign(campaignId);
    run.done = runLoop(run, context, first);
    runs.track(run, run.done);
    return run;
  }

  async function continueCampaign(
    campaignId: string,
    additionalBudgetUsd?: number,
  ): Promise<void> {
    const target = findCampaign(state, campaignId);
    const continuation = target ? continuationFor(target) : null;
    if (!target || !continuation) return;
    if (continuation.state === "unavailable") {
      throw new Error(continuation.message ?? GENERIC_STOP_REASON);
    }
    // Without an amount the page allowance grows by what the remaining target
    // needs. It is provider cost the owner is not charged for.
    const requestedAdditional =
      additionalBudgetUsd === undefined
        ? continuation.recommendedAdditionalBudgetUsd
        : additionalBudgetUsd;
    if (
      !Number.isFinite(requestedAdditional) ||
      requestedAdditional + BUDGET_EPSILON_USD <
        continuation.minimumAdditionalBudgetUsd
    ) {
      throw new Error(
        "This campaign cannot continue with less than one more provider page.",
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
    const cursorState =
      fresh.endReason === "provider_repeat"
        ? continuationCursors(fresh)
        : {
            skip: fresh.skip,
            tagCursors: [...fresh.tagCursors],
            coverage: fresh.coverage.map((entry) => ({ ...entry })),
          };
    // Continuing a campaign whose area ran out is the owner's yes to nearby;
    // an older campaign that ran out on the whole city goes on to its suburbs.
    const suburbs = (freshContinuation.suburbs?.length ?? 0) > 0;
    const nearby = (freshContinuation.nearbyAreas?.length ?? 0) > 0;
    if (nearby || suburbs) ahead.stop(fresh.id);
    patch(fresh.id, (campaign) => {
      const resumed: StoredCampaign = {
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
      };
      if (suburbs) return enterNextSuburb(resumed, coveredQuery);
      return nearby
        ? enterNextArea({ ...resumed, nearbyApproved: true }, coveredQuery)
        : resumed;
    });
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

  async function resumeCampaign(
    campaignId: string,
    from: "paused" | "failed",
  ): Promise<void> {
    const target = findCampaign(state, campaignId);
    if (!target || target.status !== from) return;
    const context = await deps.resolveContext();
    if (disposed) return;
    ensureOwner(context.pubkey);
    const fresh = findCampaign(state, target.id);
    if (!fresh || fresh.status !== from) return;
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
    return coveredQueryIn(state.campaigns, queryKey);
  }

  const controller: DiscoveryController = {
    getCurrent: current,
    getCampaigns: () => state.campaigns.map(toPublicCampaign),
    getContinuation: () => {
      const campaign = findCampaign(state, state.currentId);
      return campaign ? continuationFor(campaign) : null;
    },
    getContinuationFor: (campaignId) => {
      const campaign = findCampaign(state, campaignId);
      return campaign ? continuationFor(campaign) : null;
    },
    continueCampaign: (additionalBudgetUsd) => {
      const campaignId = state.currentId;
      return campaignId
        ? continueCampaign(campaignId, additionalBudgetUsd)
        : Promise.resolve();
    },
    continueCampaignFor: (campaignId, additionalBudgetUsd) =>
      continueCampaign(campaignId, additionalBudgetUsd),

    async select(campaignId) {
      if (state.currentId === campaignId) return;
      if (!findCampaign(state, campaignId)) return;
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
      const context = await resolveStartContext();
      if (disposed) throw new Error(STOPPED_ERROR);
      ensureOwner(context.pubkey);

      // The first page runs before anything is created, so a server that
      // cannot search (not set up, no credits) fails here with its plain
      // words and leaves no campaign behind.
      const probe = new AbortController();
      const probeId = `probe-${++probeSequence}`;
      startProbes.add(probe);
      requestBudget.registerCampaign(probeId);
      const pickedTags = normalizePickedTags(input.pickedTags);
      // Plain words Maps understands, and the whole named area. See
      // `discoveryCampaignWords.ts` for what the old request found.
      const searchWords = searchWordsForType(
        input.verticalId,
        input.verticalName,
      );
      const coverageKeys = discoveryCoverageKeys({
        verticalId: input.verticalId,
        pickedTags,
        searchWords,
        wordIndex: 0,
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
      let first: PreparedSearchPage | null = null;
      try {
        first = hasProviderPage
          ? await fetchCampaignPage(
              {
                verticalId: input.verticalId,
                verticalName: input.verticalName,
                location,
                locationSelection,
                skip: initialSkip,
                pickedTags,
                tagCursors: initialTagCursors,
                searchWords,
                wordIndex: 0,
              },
              probe.signal,
              (request) =>
                searchPage(
                  probeId,
                  request,
                  probe.signal,
                  probe.signal,
                  "in_turn",
                ),
            )
          : null;
      } finally {
        startProbes.delete(probe);
        requestBudget.unregisterCampaign(probeId);
      }
      if (disposed) throw new Error(STOPPED_ERROR);

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
        areaIndex: 0,
        suburbIndex: 0,
        nearbyApproved: false,
        searchWords,
        wordIndex: 0,
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
      if (runs.isLiveFor(target.id)) stopRun(target.id, "paused");
      else patch(target.id, (campaign) => ({ ...campaign, status: "paused" }));
    },

    resume: () => {
      const campaignId = state.currentId;
      return campaignId ? resumeCampaign(campaignId, "paused") : Promise.resolve();
    },
    retry: () => {
      const campaignId = state.currentId;
      return campaignId ? resumeCampaign(campaignId, "failed") : Promise.resolve();
    },
    resumeCampaign: (campaignId) => resumeCampaign(campaignId, "paused"),
    retryCampaign: (campaignId) => resumeCampaign(campaignId, "failed"),

    async cancel() {
      const target = findCampaign(state, state.currentId);
      if (
        !target ||
        (target.status !== "running" && target.status !== "paused")
      ) {
        return;
      }
      if (runs.isLiveFor(target.id)) stopRun(target.id, "cancelled");
      else
        patch(target.id, (campaign) => ({ ...campaign, status: "cancelled" }));
      ahead.stop(target.id); // A cancelled campaign is never resumed.
    },

    dispose() {
      disposed = true;
      for (const probe of startProbes) probe.abort();
      startProbes.clear();
      runs.stopAll();
      requestBudget.dispose();
      pendingProspectIds.clear();
      pendingLeadNames.clear();
      savedProspectIds.clear();
      savedLeadNames.clear();
      listeners.clear();
      ahead.stop();
    },

    whenIdle: () => runs.whenIdle(),
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
