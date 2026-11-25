import * as React from "react";

import { useQueryClient } from "@tanstack/react-query";

import { relayClient } from "@/shared/api/relayClient";
import {
  isRelayConnectionDegraded,
  type ConnectionState,
} from "@/shared/api/relayClientShared";
import { isRelayDependentQuery } from "@/shared/api/relayQueryInvalidation";
import {
  isRelayHttpRateLimited,
  subscribeToRelayHttpRateLimitRecovery,
} from "@/shared/api/relayHttpRequestGate";
import {
  isRateLimited,
  subscribeToRateLimitRecovery,
} from "@/shared/api/relayRateLimitGate";

export const AUTO_HEAL_MIN_INTERVAL_MS = 15_000;

type RateLimitRecoveryQuery = {
  queryHash: string;
  queryKey: readonly unknown[];
  state: {
    status: string;
    fetchStatus: string;
  };
  isActive: () => boolean;
};

/**
 * Selects the small set of reads that a completed rate-limit window may retry.
 *
 * An automatic retry is consumed until the query succeeds or leaves the cache.
 * Without that latch a recovery retry that is immediately rate-limited would
 * re-arm the same window forever. The normal query retry, an explicit retry,
 * or a later connection recovery can still make progress; a success clears the
 * latch for the next independent failure.
 */
export class RelayRateLimitRecoveryScheduler {
  private retriedQueryHashes = new Set<string>();

  /** Returns eligible failed active relay queries, marking them as retried. */
  takeErroredActiveQueryHashes(
    queries: readonly RateLimitRecoveryQuery[],
  ): Set<string> {
    const selected = new Set<string>();
    for (const query of queries) {
      if (
        query.state.status !== "error" ||
        query.state.fetchStatus === "fetching" ||
        !query.isActive() ||
        !isRelayDependentQuery(query) ||
        this.retriedQueryHashes.has(query.queryHash)
      ) {
        continue;
      }
      this.retriedQueryHashes.add(query.queryHash);
      selected.add(query.queryHash);
    }
    return selected;
  }

  /** Clears a query's one-retry latch after it has recovered. */
  observeQuery(query: RateLimitRecoveryQuery): void {
    if (query.state.status === "success") {
      this.retriedQueryHashes.delete(query.queryHash);
    }
  }

  /** Clears state for a query that has left the cache. */
  forgetQuery(queryHash: string): void {
    this.retriedQueryHashes.delete(queryHash);
  }
}

/**
 * Tracks degraded→connected transitions and fires `onHeal` at most once per
 * `minIntervalMs`. When a transition is suppressed by the rate limiter, a
 * deferred heal is scheduled for the remaining window so the *last* recovery
 * always wins — stale query errors do not persist after reconnect.
 *
 * Injectable deps make this testable without React or DOM.
 */
export class RelayAutoHealScheduler {
  private lastHealAt = -Infinity;
  private deferredId: number | null = null;
  private readonly onHeal: () => void;
  private readonly minIntervalMs: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => number;
  private readonly clearTimeoutFn: (id: number) => void;
  private readonly nowFn: () => number;

  constructor(
    onHeal: () => void,
    minIntervalMs: number,
    setTimeoutFn: (fn: () => void, ms: number) => number,
    clearTimeoutFn: (id: number) => void,
    nowFn: () => number = () => Date.now(),
  ) {
    this.onHeal = onHeal;
    this.minIntervalMs = minIntervalMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.nowFn = nowFn;
  }

  /**
   * Call on every connection-state change. Fires `onHeal` (immediately or
   * deferred) when the transition is degraded→connected.
   */
  onTransition(prev: ConnectionState, next: ConnectionState): void {
    if (!(isRelayConnectionDegraded(prev) && next === "connected")) return;

    // A new recovery supersedes any pending deferred heal.
    if (this.deferredId !== null) {
      this.clearTimeoutFn(this.deferredId);
      this.deferredId = null;
    }

    const now = this.nowFn();
    const elapsed = now - this.lastHealAt;

    if (elapsed < this.minIntervalMs) {
      // Rate-limited — schedule for when the window expires.
      const remaining = this.minIntervalMs - elapsed;
      this.deferredId = this.setTimeoutFn(() => {
        this.deferredId = null;
        this.lastHealAt = this.nowFn();
        this.onHeal();
      }, remaining);
    } else {
      this.lastHealAt = now;
      this.onHeal();
    }
  }

  /** Cancel any pending deferred heal (call on unmount). */
  dispose(): void {
    if (this.deferredId !== null) {
      this.clearTimeoutFn(this.deferredId);
      this.deferredId = null;
    }
  }
}

/**
 * Auto-heal: when the connection recovers from a degraded state, invalidate
 * relay-dependent queries so errored queries (e.g. messages, which don't poll)
 * refetch automatically without requiring a manual reconnect action.
 *
 * Rate-limited to prevent a flappy connection (e.g. VPN toggling) from
 * firing a relay-wide invalidation across active queries with retry:1 every
 * time the relay briefly recovers.
 *
 * When a recovery is suppressed by the rate limiter (an earlier flap consumed
 * the budget), a deferred heal is scheduled for the remaining window so the
 * *last* recovery always wins and stale query errors do not persist.
 */
export function useRelayAutoHeal(): void {
  const queryClient = useQueryClient();
  const schedulerRef = React.useRef<RelayAutoHealScheduler | null>(null);
  const rateLimitRecoveryRef =
    React.useRef<RelayRateLimitRecoveryScheduler | null>(null);

  if (rateLimitRecoveryRef.current === null) {
    rateLimitRecoveryRef.current = new RelayRateLimitRecoveryScheduler();
  }

  if (schedulerRef.current === null) {
    schedulerRef.current = new RelayAutoHealScheduler(
      () => {
        if (isRateLimited() || isRelayHttpRateLimited()) {
          // The rate-limit recovery subscription below retries only failed
          // active queries after the shared window clears. A whole-cache
          // invalidate here would turn a healthy busy screen into another
          // burst and can immediately re-arm the same limit.
          return;
        }
        void queryClient.invalidateQueries({
          predicate: isRelayDependentQuery,
        });
      },
      AUTO_HEAL_MIN_INTERVAL_MS,
      window.setTimeout.bind(window),
      window.clearTimeout.bind(window),
    );
  }

  React.useEffect(() => {
    // Observe the RAW connection-state emitter, not the 2s-debounced
    // useRelayConnection() hook. A sub-2s flap never surfaces through the
    // debounced hook (its degraded report is cancelled by the recovery), yet
    // resetConnection() already rejected every in-flight query — the heal
    // must still fire or errored panes persist until a manual reconnect.
    let prev: ConnectionState | null = null;
    const unsubscribe = relayClient.subscribeToConnectionState((next) => {
      if (prev !== null) {
        schedulerRef.current?.onTransition(prev, next);
      }
      prev = next;
    });

    return () => {
      unsubscribe();
      schedulerRef.current?.dispose();
    };
  }, []);

  React.useEffect(() => {
    // A subscription-level CLOSED leaves the WebSocket connected, so it does
    // not produce the degraded-to-connected transition handled above. Only
    // retry active reads that failed, rather than starting every healthy query
    // on a busy screen at once when the shared back-pressure window ends.
    const recovery = rateLimitRecoveryRef.current;
    if (recovery === null) return;
    const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "removed") {
        recovery.forgetQuery(event.query.queryHash);
        return;
      }
      recovery.observeQuery(event.query);
    });
    const recoverRateLimitedQueries = () => {
      const queryHashes = recovery.takeErroredActiveQueryHashes(
        queryClient.getQueryCache().getAll(),
      );
      if (queryHashes.size === 0) return;
      void queryClient.invalidateQueries({
        predicate: (query) =>
          queryHashes.has(query.queryHash) &&
          query.state.status === "error" &&
          query.isActive(),
      });
    };
    const unsubscribeRecovery = subscribeToRateLimitRecovery(
      recoverRateLimitedQueries,
    );
    const unsubscribeHttpRecovery = subscribeToRelayHttpRateLimitRecovery(
      recoverRateLimitedQueries,
    );
    return () => {
      unsubscribeCache();
      unsubscribeRecovery();
      unsubscribeHttpRecovery();
    };
  }, [queryClient]);
}
