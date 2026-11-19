/** The controller keeps six searches of headroom below the relay's 60/minute limit. */
export const MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE = 54;
/** Pages asked before their turn use at most this many shared request slots. */
export const MAX_DISCOVERY_AHEAD_REQUESTS_PER_MINUTE = 30;

export type DiscoveryRequestKind = "in_turn" | "ahead";

export type DiscoveryRequestBudgetSnapshot = {
  ahead: number;
  queued: number;
  requests: number;
};

export type DiscoveryRequestBudget = {
  registerCampaign: (campaignId: string) => void;
  unregisterCampaign: (campaignId: string) => void;
  acquire: (input: {
    campaignId: string;
    kind: DiscoveryRequestKind;
    signal: AbortSignal;
  }) => Promise<void>;
  dispose: () => void;
  snapshot: () => DiscoveryRequestBudgetSnapshot;
};

type StartedRequest = {
  campaignId: string;
  kind: DiscoveryRequestKind;
  startedAt: number;
};

type PendingRequest = {
  campaignId: string;
  kind: DiscoveryRequestKind;
  onAbort: () => void;
  reject: (reason: unknown) => void;
  resolve: () => void;
  signal: AbortSignal;
};

type RequestBudgetDeps = {
  nowSeconds: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
};

function abortError(): DOMException {
  return new DOMException("The search was stopped.", "AbortError");
}

/**
 * A single controller owns this rolling-window budget. Calls wait instead of
 * being dropped, and an aborted run removes only its own queued request.
 */
export function createDiscoveryRequestBudget(
  deps: RequestBudgetDeps,
): DiscoveryRequestBudget {
  const activeCampaigns = new Set<string>();
  const pending: PendingRequest[] = [];
  const started: StartedRequest[] = [];
  let disposed = false;
  let wake: AbortController | null = null;

  function now(): number {
    const value = deps.nowSeconds();
    return Number.isFinite(value) ? value : 0;
  }

  function prune(): void {
    const cutoff = now() - 60;
    while ((started[0]?.startedAt ?? Infinity) <= cutoff) started.shift();
  }

  function aheadCount(campaignId?: string): number {
    return started.filter(
      (request) =>
        request.kind === "ahead" &&
        (campaignId === undefined || request.campaignId === campaignId),
    ).length;
  }

  function remove(entry: PendingRequest): boolean {
    const index = pending.indexOf(entry);
    if (index < 0) return false;
    pending.splice(index, 1);
    entry.signal.removeEventListener("abort", entry.onAbort);
    return true;
  }

  function rejectAll(error: unknown): void {
    const entries = pending.splice(0, pending.length);
    for (const entry of entries) {
      entry.signal.removeEventListener("abort", entry.onAbort);
      entry.reject(error);
    }
  }

  function clearWake(): void {
    wake?.abort();
    wake = null;
  }

  function hasWaitingAheadCompetitor(entry: PendingRequest): boolean {
    return pending.some(
      (candidate) =>
        candidate !== entry &&
        candidate.kind === "ahead" &&
        candidate.campaignId !== entry.campaignId &&
        activeCampaigns.has(candidate.campaignId) &&
        !candidate.signal.aborted,
    );
  }

  function canStart(entry: PendingRequest): boolean {
    if (entry.signal.aborted) return false;
    if (started.length >= MAX_DISCOVERY_SEARCH_REQUESTS_PER_MINUTE) {
      return false;
    }
    if (entry.kind !== "ahead") return true;
    if (aheadCount() >= MAX_DISCOVERY_AHEAD_REQUESTS_PER_MINUTE) return false;
    const fairShare = Math.ceil(
      MAX_DISCOVERY_AHEAD_REQUESTS_PER_MINUTE /
        Math.max(1, activeCampaigns.size),
    );
    if (aheadCount(entry.campaignId) >= fairShare) return false;
    if (!hasWaitingAheadCompetitor(entry)) return true;

    const ownAhead = aheadCount(entry.campaignId);
    const lowestWaitingAhead = Math.min(
      ...pending
        .filter(
          (candidate) =>
            candidate.kind === "ahead" &&
            candidate.campaignId !== entry.campaignId &&
            activeCampaigns.has(candidate.campaignId) &&
            !candidate.signal.aborted,
        )
        .map((candidate) => aheadCount(candidate.campaignId)),
    );
    return ownAhead <= lowestWaitingAhead;
  }

  function nextStartableIndex(): number {
    const ordered = [
      ...pending
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.kind === "in_turn"),
      ...pending
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.kind === "ahead"),
    ];
    return ordered.find(({ entry }) => canStart(entry))?.index ?? -1;
  }

  function scheduleWake(): void {
    if (disposed || pending.length === 0) return;
    clearWake();
    const oldest = started[0];
    if (!oldest) {
      rejectAll(new Error("Discovery request scheduling stalled."));
      return;
    }
    const waitMs = Math.max(1, Math.ceil((oldest.startedAt + 60 - now()) * 1_000));
    const controller = new AbortController();
    wake = controller;
    void deps.sleep(waitMs, controller.signal).then(
      () => {
        if (wake !== controller) return;
        wake = null;
        pump();
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (wake === controller) wake = null;
        rejectAll(error);
      },
    );
  }

  function pump(): void {
    if (disposed) return;
    prune();
    clearWake();
    for (;;) {
      const index = nextStartableIndex();
      if (index < 0) break;
      const entry = pending[index];
      if (!entry) break;
      pending.splice(index, 1);
      entry.signal.removeEventListener("abort", entry.onAbort);
      started.push({
        campaignId: entry.campaignId,
        kind: entry.kind,
        startedAt: now(),
      });
      entry.resolve();
    }
    if (pending.length > 0) scheduleWake();
  }

  return {
    registerCampaign(campaignId) {
      activeCampaigns.add(campaignId);
    },

    unregisterCampaign(campaignId) {
      activeCampaigns.delete(campaignId);
      pump();
    },

    acquire({ campaignId, kind, signal }) {
      if (disposed || signal.aborted) return Promise.reject(abortError());
      return new Promise<void>((resolve, reject) => {
        let entry: PendingRequest;
        const onAbort = () => {
          if (!remove(entry)) return;
          reject(abortError());
          pump();
        };
        entry = { campaignId, kind, onAbort, reject, resolve, signal };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.push(entry);
        pump();
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearWake();
      activeCampaigns.clear();
      rejectAll(abortError());
    },

    snapshot() {
      prune();
      return {
        ahead: aheadCount(),
        queued: pending.length,
        requests: started.length,
      };
    },
  };
}
