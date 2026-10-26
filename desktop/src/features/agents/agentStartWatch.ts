import * as React from "react";

import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  getAgentWorkingState,
  subscribeAgentWorkingSignal,
} from "./agentWorkingSignal";

/**
 * Mentions to an agent that had to be started for them, until the agent picks
 * them up.
 *
 * A publish-first mention send publishes the message and wakes the agent in the
 * background. If that harness dies or stalls before it reads the message, the
 * person used to see nothing at all, and the next mention spawned a harness
 * whose replay floor was the NEW message, so the first one was skipped for
 * good (GATE-302, 26 Oct). This store is the renderer's memory of those wakes:
 *
 * 1. It hands back the replay floor of the OLDEST mention nobody picked up, so
 *    any harness started for the agent reaches back to it.
 * 2. It restarts the agent once on its own when nothing picked the mention up,
 *    then calls the start stalled after a bounded time, so the conversation can
 *    say so with a way to try again instead of staying silent.
 * 3. It forgets an agent as soon as the agent is seen working anywhere.
 */

/** Silence after which the agent is started again, once, on its own. */
export const AGENT_START_RETRY_AFTER_MS = 20_000;
/** Silence after which the person is told the agent did not start. */
export const AGENT_START_STALLED_AFTER_MS = 60_000;
/** How long an unanswered mention keeps pulling the replay floor back. The
 * harness never replays further than this either (`REPLAY_FLOOR_MAX_AGE_SECS`
 * in `buzz-acp`). */
export const AGENT_START_WATCH_TTL_MS = 15 * 60 * 1000;

export type AgentStartPhase = "starting" | "stalled";

export type AgentStartWatch = {
  /** Normalized agent pubkey. */
  pubkey: string;
  channelId: string | null;
  /** The thread the mention was sent in, or `null` for the main conversation. */
  threadHeadId: string | null;
  /** Desktop-clock ms when the person waited from. */
  since: number;
  /** Unix seconds: the oldest unanswered mention for this agent. */
  floorUnix: number;
  phase: AgentStartPhase;
  /** Why the start failed, when it failed outright. */
  reason: string | null;
};

/** Starts the agent again. `force` replaces a harness that is still running. */
export type AgentStartRunner = (attempt: {
  force: boolean;
  floorUnix: number;
}) => Promise<unknown>;

type Entry = {
  watch: AgentStartWatch;
  start: AgentStartRunner;
  /** The automatic restart already ran (or is not wanted any more). */
  retried: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  stallTimer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<string, Entry>();
/** The latest start attempt per agent. A failure that arrives after a newer
 * attempt began belongs to the past and must not mark the newer one stalled. */
const attempts = new Map<string, number>();
const listeners = new Set<() => void>();
const channelCache = new Map<string, AgentStartWatch[]>();
const EMPTY_WATCHES: AgentStartWatch[] = [];
let unsubscribeWorking: (() => void) | null = null;

function entryKey(
  pubkey: string,
  channelId: string | null,
  threadHeadId: string | null,
) {
  return `${pubkey}|${channelId ?? ""}|${threadHeadId ?? ""}`;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Could not start the agent.";
}

function schedule(
  run: () => void,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(run, Math.max(0, delayMs));
  // Node (the unit tests) would otherwise wait on a timer nobody cleared.
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

function clearTimers(entry: Entry) {
  if (entry.retryTimer !== null) clearTimeout(entry.retryTimer);
  if (entry.stallTimer !== null) clearTimeout(entry.stallTimer);
  entry.retryTimer = null;
  entry.stallTimer = null;
}

function notify() {
  channelCache.clear();
  for (const listener of listeners) {
    listener();
  }
}

function entriesFor(pubkey: string): Entry[] {
  return [...entries.values()].filter((entry) => entry.watch.pubkey === pubkey);
}

function oldestFloorFor(pubkey: string): number | undefined {
  let oldest: number | undefined;
  for (const entry of entriesFor(pubkey)) {
    oldest =
      oldest === undefined
        ? entry.watch.floorUnix
        : Math.min(oldest, entry.watch.floorUnix);
  }
  return oldest;
}

function dropEntry(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  clearTimers(entry);
  entries.delete(key);
}

function pruneExpired(now: number) {
  for (const [key, entry] of entries) {
    if (entry.watch.floorUnix * 1000 < now - AGENT_START_WATCH_TTL_MS) {
      dropEntry(key);
    }
  }
}

/** Follow the working signal only while somebody is waiting on an agent. */
function syncWorkingSubscription() {
  if (entries.size > 0 && unsubscribeWorking === null) {
    unsubscribeWorking = subscribeAgentWorkingSignal(onWorkingSignal);
  } else if (entries.size === 0 && unsubscribeWorking !== null) {
    unsubscribeWorking();
    unsubscribeWorking = null;
  }
}

function onWorkingSignal() {
  const waitingOn = new Set([...entries.values()].map((e) => e.watch.pubkey));
  for (const pubkey of waitingOn) {
    if (getAgentWorkingState(pubkey).working) {
      resolveAgentStartWatches(pubkey);
    }
  }
}

function runStart(
  entry: Entry,
  attempt: { force: boolean; floorUnix: number },
) {
  const attemptId = beginAgentStartAttempt(entry.watch.pubkey);
  let result: Promise<unknown>;
  try {
    result = entry.start(attempt);
  } catch (error) {
    result = Promise.reject(error);
  }
  result.catch((error: unknown) => {
    failAgentStartWatches(entry.watch.pubkey, messageOf(error), attemptId);
  });
}

function startTimers(key: string, entry: Entry) {
  clearTimers(entry);
  const elapsed = Date.now() - entry.watch.since;
  if (!entry.retried) {
    entry.retryTimer = schedule(
      () => autoRestart(key),
      AGENT_START_RETRY_AFTER_MS - elapsed,
    );
  }
  entry.stallTimer = schedule(
    () => stall(key),
    AGENT_START_STALLED_AFTER_MS - elapsed,
  );
}

function autoRestart(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  entry.retryTimer = null;
  if (entry.retried || entry.watch.phase !== "starting") return;
  // One restart per agent, however many conversations are waiting on it.
  for (const sibling of entriesFor(entry.watch.pubkey)) {
    sibling.retried = true;
  }
  runStart(entry, {
    force: false,
    floorUnix: oldestFloorFor(entry.watch.pubkey) ?? entry.watch.floorUnix,
  });
}

function stall(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  entry.stallTimer = null;
  if (entry.watch.phase === "stalled") return;
  entry.watch = { ...entry.watch, phase: "stalled" };
  notify();
}

/**
 * Record that `pubkey` was woken for a mention and has not answered yet.
 * Returns the replay floor the start must use: the OLDEST unanswered mention
 * for the agent, so a harness started now still replays an earlier one.
 */
export function registerAgentStartWatch(input: {
  pubkey: string;
  channelId: string | null;
  threadHeadId: string | null;
  /** Unix seconds captured when the mention was queued. */
  floorUnix: number;
  start: AgentStartRunner;
}): { floorUnix: number } {
  const now = Date.now();
  pruneExpired(now);
  const pubkey = normalizePubkey(input.pubkey);
  const oldest = oldestFloorFor(pubkey);
  const floorUnix =
    oldest === undefined ? input.floorUnix : Math.min(oldest, input.floorUnix);
  const key = entryKey(pubkey, input.channelId, input.threadHeadId);
  const existing = entries.get(key);
  if (existing && existing.watch.phase === "starting") {
    existing.start = input.start;
    existing.watch = { ...existing.watch, floorUnix };
  } else {
    const entry: Entry = {
      watch: {
        pubkey,
        channelId: input.channelId,
        threadHeadId: input.threadHeadId,
        since: now,
        floorUnix,
        phase: "starting",
        reason: null,
      },
      start: input.start,
      retried: false,
      retryTimer: null,
      stallTimer: null,
    };
    if (existing) clearTimers(existing);
    entries.set(key, entry);
    startTimers(key, entry);
  }
  syncWorkingSubscription();
  notify();
  return { floorUnix };
}

/** The agent picked the mention up (or answered): stop waiting on it. */
export function resolveAgentStartWatches(pubkey: string) {
  const key = normalizePubkey(pubkey);
  let changed = false;
  for (const [entryId, entry] of entries) {
    if (entry.watch.pubkey === key) {
      dropEntry(entryId);
      changed = true;
    }
  }
  syncWorkingSubscription();
  if (changed) notify();
}

/**
 * Note that a start for `pubkey` is about to run and return its number. Pass
 * it to [`failAgentStartWatches`] so a failure from an older attempt, arriving
 * after a newer one began, is ignored instead of stalling the newer one.
 */
export function beginAgentStartAttempt(pubkey: string): number {
  const key = normalizePubkey(pubkey);
  const next = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, next);
  return next;
}

/**
 * The start failed outright: say so now instead of waiting for the clock.
 * With `attempt`, only the latest attempt's failure counts.
 */
export function failAgentStartWatches(
  pubkey: string,
  reason: string,
  attempt?: number,
) {
  const key = normalizePubkey(pubkey);
  if (attempt !== undefined && attempts.get(key) !== attempt) return;
  let changed = false;
  for (const entry of entries.values()) {
    if (entry.watch.pubkey !== key) continue;
    clearTimers(entry);
    entry.retried = true;
    entry.watch = { ...entry.watch, phase: "stalled", reason };
    changed = true;
  }
  if (changed) notify();
}

/** The person asked to try again: replace the harness and replay from the
 * oldest unanswered mention, with a fresh countdown. */
export function retryAgentStart(pubkey: string) {
  const key = normalizePubkey(pubkey);
  const mine = [...entries.entries()].filter(
    ([, entry]) => entry.watch.pubkey === key,
  );
  const first = mine[0]?.[1];
  if (!first) return;
  const now = Date.now();
  const floorUnix = oldestFloorFor(key) ?? first.watch.floorUnix;
  for (const [entryId, entry] of mine) {
    entry.retried = true;
    entry.watch = {
      ...entry.watch,
      phase: "starting",
      since: now,
      reason: null,
    };
    startTimers(entryId, entry);
  }
  notify();
  runStart(first, { force: true, floorUnix });
}

export function getAgentStartWatches(
  channelId: string | null,
): AgentStartWatch[] {
  const cacheKey = channelId ?? "";
  const cached = channelCache.get(cacheKey);
  if (cached) return cached;
  const matching = [...entries.values()]
    .map((entry) => entry.watch)
    .filter((watch) => (watch.channelId ?? "") === cacheKey)
    .sort((a, b) => a.since - b.since || a.pubkey.localeCompare(b.pubkey));
  const result = matching.length === 0 ? EMPTY_WATCHES : matching;
  channelCache.set(cacheKey, result);
  return result;
}

export function subscribeAgentStartWatches(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Agents the person is waiting on to start, in one conversation. */
export function useChannelAgentStartWatches(
  channelId: string | null | undefined,
): AgentStartWatch[] {
  return React.useSyncExternalStore(subscribeAgentStartWatches, () =>
    getAgentStartWatches(channelId ?? null),
  );
}

/** Community-switch reset (see resetCommunityState in useCommunityInit). */
export function resetAgentStartWatches() {
  for (const entry of entries.values()) {
    clearTimers(entry);
  }
  entries.clear();
  attempts.clear();
  syncWorkingSubscription();
  notify();
}
