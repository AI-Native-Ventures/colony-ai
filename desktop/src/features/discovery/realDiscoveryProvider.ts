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
import { fitScore, leadNameKey, mapPlaceToProspect } from "./discoveryMapping";
import type {
  DiscoveryCampaign,
  DiscoveryCampaignInput,
  DiscoveryCampaignProvider,
} from "./discoveryProvider";
import {
  buildSearchRequest,
  isTransientSearchError,
  type DiscoveryPlace,
  type DiscoverySearchRequest,
  type DiscoverySearchResponse,
} from "./discoverySearch";

/** Hard ceiling on search pages per campaign (25 x 20 = 500 places). */
export const MAX_PAGES = 25;
export const MAX_TARGET = 500;
export const PUBLISH_CONCURRENCY = 3;
export const PUBLISH_BACKOFF_MS = [400, 800, 1600] as const;
export const SEARCH_BACKOFF_MS = [1_000, 3_000] as const;
/** Display-only budget per requested prospect, as in the design's example. */
export const BUDGET_USD_PER_PROSPECT = 0.05;

export type DiscoveryContext = {
  /** The private Sales channel that holds business records. */
  channelId: string;
  communityId: string;
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

export const FIRST_START_ERROR =
  "Add a location and choose 1 to 500 prospects.";
export const NO_SALES_CHANNEL_ERROR =
  "Finding prospects saves its results in the private Sales channel, which is not set up here yet.";
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
  >,
  kind: "final" | "stopped",
  leadLink: (prospectId: string) => string,
): string {
  const label = campaign.name.replace(/"/g, "'");
  const noun = campaign.count === 1 ? "prospect" : "prospects";
  const headline =
    kind === "final"
      ? `Found ${campaign.count} ${noun} for "${label}" (${campaign.verticalName} · ${campaign.location}).`
      : `The search "${label}" stopped after finding ${campaign.count} ${noun}.`;
  if (campaign.topFits.length === 0) return headline;
  const lines = campaign.topFits.map(
    (fit) => `- [${escapeLinkText(fit.name)}](${leadLink(fit.id)})`,
  );
  const lead = kind === "final" ? "Best fits:" : "Best fits so far:";
  return [`${headline} ${lead}`, ...lines].join("\n");
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

  type PageOutcome = { ok: true } | { ok: false; error: unknown };

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
    if (!campaign) return { ok: true };
    const nowSeconds = deps.nowSeconds();
    const own = new Set(campaign.prospectIds);
    const seen = new Set<string>();
    const fresh: Array<{ id: string; place: DiscoveryPlace }> = [];
    let duplicates = 0;
    for (const place of response.places) {
      const id = await deps.prospectId(place);
      if (own.has(id) || seen.has(id)) continue;
      seen.add(id);
      if (
        context.existingProspectIds.has(id) ||
        context.existingNames.has(leadNameKey(place.name))
      ) {
        duplicates += 1;
        continue;
      }
      fresh.push({ id, place });
    }
    const room = Math.max(0, campaign.target - campaign.count);
    const queue = fresh.slice(0, room);

    let failure: unknown = null;
    for (
      let index = 0;
      index < queue.length && failure === null && !run.abort.signal.aborted;
      index += PUBLISH_CONCURRENCY
    ) {
      const chunk = queue.slice(index, index + PUBLISH_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map(async ({ id, place }) => {
          const changes = mapPlaceToProspect(
            place,
            {
              campaignId: campaign.id,
              industry: campaign.industryName,
              vertical: campaign.verticalName,
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
          } else {
            context.existingProspectIds.add(id);
            duplicates += 1;
          }
        }
      }
    }
    if (duplicates > 0) {
      patch(run.campaignId, (existing) => ({
        ...existing,
        skippedDuplicates: existing.skippedDuplicates + duplicates,
      }));
    }
    if (failure !== null && !isAbortError(failure)) {
      return { ok: false, error: failure };
    }
    return { ok: true };
  }

  // ---- the run loop --------------------------------------------------------

  function isLive(run: ActiveRun): boolean {
    return !disposed && run.generation === generation;
  }

  async function runLoop(
    run: ActiveRun,
    context: DiscoveryContext,
    first: DiscoverySearchResponse | null,
  ): Promise<void> {
    let pending = first;
    try {
      while (isLive(run)) {
        const campaign = findCampaign(state, run.campaignId);
        if (!campaign) return;
        if (
          campaign.count >= campaign.target ||
          campaign.exhausted ||
          campaign.pagesFetched >= MAX_PAGES
        ) {
          await finish(run, context);
          return;
        }
        const response =
          pending ??
          (await searchPage(
            run,
            buildSearchRequest({
              query: campaign.verticalName,
              location: campaign.location,
              skip: campaign.skip,
            }),
          ));
        pending = null;
        if (!isLive(run)) return;
        const outcome = await savePage(run, context, response);
        if (!isLive(run)) return;
        if (!outcome.ok) {
          await fail(run, context, outcome.error);
          return;
        }
        // Only a fully saved page moves the cursor, so a retry never skips
        // places that were found but not saved.
        patch(run.campaignId, (existing) => ({
          ...existing,
          skip: response.nextSkip ?? existing.skip + response.places.length,
          exhausted: response.nextSkip === null,
          pagesFetched: existing.pagesFetched + 1,
        }));
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
    first: DiscoverySearchResponse | null,
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
    beginRun(fresh.id, context, null);
    void flushPendingPosts();
  }

  const controller: DiscoveryController = {
    getCurrent: current,
    getCampaigns: () => state.campaigns.map(toPublicCampaign),

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
      if (
        !location ||
        !Number.isFinite(target) ||
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
      const request = buildSearchRequest({
        query: input.verticalName,
        location,
        skip: 0,
      });
      const first = await deps.search(request, probe.signal);
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
        location,
        target,
        count: 0,
        budgetUsd: Math.round(target * BUDGET_USD_PER_PROSPECT * 100) / 100,
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
        skip: 0,
        pagesFetched: 0,
        exhausted: false,
        pendingPost: false,
        postState: "none",
        stopNotePosted: false,
        topFits: [],
      };
      commit(setCurrent(upsertCampaign(state, campaign), campaign.id));
      beginRun(campaign.id, context, first);
      const created = findCampaign(state, campaign.id);
      return toPublicCampaign(created ?? campaign);
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
