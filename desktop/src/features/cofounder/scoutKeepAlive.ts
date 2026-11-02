import type { ManagedAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

/**
 * Keeps the owner's Scout running while co-founder mode is on.
 *
 * 2 Nov 2026, owner on 3.0.30: co-founder mode was on, the relay left its
 * start-up wake in the Scout direct message, and nothing happened for hours
 * because Scout was not running. Scout is made by the Welcome flow with
 * "start with the app" off, so neither the launch restore nor the community
 * fan-out in the desktop host ever starts it, and the only things that start it
 * are a mention the owner sends. A wake is sent by the relay, not by the owner,
 * so no part of the app reacted to it. The owner had to message Scout to begin
 * onboarding.
 *
 * The rule here is the owner's: co-founder onboarding starts by itself, and the
 * owner never has to message Scout, open a chat or click anything. The wake is
 * hidden from every surface (#688), so the app does not look for it: it keeps
 * Scout up, and a Scout that is up reads the wake live, or replays it from its
 * wake ledger when it starts (up to 7 days back, handled once, and only marked
 * handled when its turn ended with an answer). This module holds the decisions
 * as pure functions, so they are tested without React:
 *
 * - [`planScoutStart`]: start Scout when co-founder mode is on and Scout is a
 *   stopped local agent. A failed start is retried with a capped back-off and
 *   then left in a visible `failed` state with one recovery action (Try again).
 * - [`cofounderScoutCardModel`]: what the "Scout is getting to know" card says.
 */

/** Wait before the next start attempt, by how many attempts already failed:
 * the first attempt is at once, then 5 s, 30 s and 2 min. After that Scout is
 * `failed` until the owner presses Try again. */
export const SCOUT_START_BACKOFF_MS = [0, 5_000, 30_000, 120_000] as const;
/** Failed attempts after which the keep-alive stops and says so. */
export const SCOUT_START_MAX_FAILURES = SCOUT_START_BACKOFF_MS.length;
/** Time after which a Scout that has not begun onboarding is called stalled. */
export const SCOUT_STALL_AFTER_MS = 3 * 60 * 1000;

type ScoutAgent = Pick<
  ManagedAgent,
  "pubkey" | "name" | "status" | "backend" | "startOnAppLaunch"
>;

/** The built-in Welcome persona Scout is made from. */
const SCOUT_PERSONA_ID = "builtin:fizz";

function sameRelay(a: string | null | undefined, b: string | null | undefined) {
  const clean = (value: string | null | undefined) =>
    value?.trim().replace(/\/+$/, "") ?? "";
  return clean(a) === clean(b);
}

/** Whether the agent has a live harness now. */
export function isScoutUp(agent: Pick<ManagedAgent, "status">): boolean {
  return agent.status === "running" || agent.status === "deployed";
}

/**
 * The local agent that is the owner's Scout on this community: the lead the
 * onboarding record names, else the one local agent made from the Scout persona
 * or named Scout. An agent pinned to another community is not this community's
 * Scout. Two candidates are an unclear choice, so none is picked (the relay
 * refuses to wake either).
 */
export function findCofounderScout<
  T extends ScoutAgent & Partial<Pick<ManagedAgent, "personaId" | "relayUrl">>,
>(
  agents: readonly T[],
  options: { leadPubkey?: string | null; relayUrl?: string | null } = {},
): T | null {
  const local = agents.filter(
    (agent) =>
      agent.backend.type === "local" &&
      (!agent.relayUrl?.trim() ||
        !options.relayUrl?.trim() ||
        sameRelay(agent.relayUrl, options.relayUrl)),
  );
  if (options.leadPubkey) {
    const lead = normalizePubkey(options.leadPubkey);
    const named = local.find((agent) => normalizePubkey(agent.pubkey) === lead);
    if (named) return named;
  }
  const scouts = local.filter(
    (agent) =>
      agent.personaId === SCOUT_PERSONA_ID ||
      agent.name.trim().toLowerCase() === "scout",
  );
  return scouts.length === 1 ? (scouts[0] as T) : null;
}

export type ScoutStartPhase = "idle" | "starting" | "failed";

export type ScoutStartState = {
  /** Normalized pubkey the state belongs to. */
  pubkey: string | null;
  phase: ScoutStartPhase;
  /** Failed attempts since Scout was last seen running or the owner retried. */
  failures: number;
  /** Plain-words reason of the latest failure. */
  reason: string | null;
  /** Desktop clock ms before which no attempt is made. */
  nextAttemptAt: number;
  /** Times the owner pressed Try again: makes the keep-alive look again. */
  requests: number;
};

export const IDLE_SCOUT_START_STATE: ScoutStartState = {
  pubkey: null,
  phase: "idle",
  failures: 0,
  reason: null,
  nextAttemptAt: 0,
  requests: 0,
};

export type ScoutStartPlan = {
  /** Start Scout now. */
  start: boolean;
  /** Why Scout is started: onboarding has not begun, or just keeping it up. */
  reason: "onboarding-not-started" | "keep-running" | null;
  /** Turn "start with the app" on for Scout so the next launch starts it. */
  markAutoStart: boolean;
  /** Desktop clock ms to look again, when waiting out a back-off. */
  retryAt: number | null;
  /** The keep-alive gave up: only the owner's Try again continues. */
  gaveUp: boolean;
};

const NO_PLAN: ScoutStartPlan = {
  start: false,
  reason: null,
  markAutoStart: false,
  retryAt: null,
  gaveUp: false,
};

/**
 * Whether Scout is to be started now.
 *
 * Nothing happens while co-founder mode is off, or for a Scout that is missing,
 * remote or running. A stopped local Scout is started while the mode is on. To
 * stop Scout for good, switch co-founder mode off.
 */
export function planScoutStart(input: {
  enabled: boolean;
  /** The onboarding record was read without error. */
  onboardingKnown: boolean;
  /** The onboarding record exists, so Scout has begun. */
  onboardingStarted: boolean;
  scout: ScoutAgent | null;
  state: ScoutStartState;
  now: number;
}): ScoutStartPlan {
  const { scout, state } = input;
  if (!input.enabled || !scout || scout.backend.type !== "local") {
    return NO_PLAN;
  }
  // A Scout whose "start with the app" is off is not restored at launch: turn
  // it on while co-founder mode is on, whatever else is going on.
  const markAutoStart = !scout.startOnAppLaunch;
  if (isScoutUp(scout)) return { ...NO_PLAN, markAutoStart };
  const reason =
    input.onboardingKnown && !input.onboardingStarted
      ? "onboarding-not-started"
      : "keep-running";

  const sameScout =
    state.pubkey !== null && state.pubkey === normalizePubkey(scout.pubkey);
  const failures = sameScout ? state.failures : 0;
  if (failures >= SCOUT_START_MAX_FAILURES) {
    return { ...NO_PLAN, markAutoStart, gaveUp: true };
  }
  const nextAttemptAt = sameScout ? state.nextAttemptAt : 0;
  if (input.now < nextAttemptAt) {
    return { ...NO_PLAN, markAutoStart, retryAt: nextAttemptAt };
  }
  return { start: true, reason, markAutoStart, retryAt: null, gaveUp: false };
}

/** State after a failed start: counts it and sets the next attempt time. */
export function afterScoutStartFailure(
  state: ScoutStartState,
  pubkey: string,
  reason: string,
  now: number,
): ScoutStartState {
  const key = normalizePubkey(pubkey);
  const failures = (state.pubkey === key ? state.failures : 0) + 1;
  return {
    ...state,
    pubkey: key,
    phase: "failed",
    failures,
    reason,
    nextAttemptAt:
      now +
      (SCOUT_START_BACKOFF_MS[
        Math.min(failures, SCOUT_START_MAX_FAILURES - 1)
      ] ?? 0),
  };
}

// ── Owner-visible state ────────────────────────────────────────────────────

let current: ScoutStartState = IDLE_SCOUT_START_STATE;
const listeners = new Set<() => void>();

function publish(next: ScoutStartState) {
  current = next;
  for (const listener of [...listeners]) listener();
}

export function getScoutStartState(): ScoutStartState {
  return current;
}

export function subscribeScoutStartState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setScoutStartState(next: ScoutStartState) {
  publish(next);
}

/** Scout is starting: the card says so. */
export function noteScoutStarting(pubkey: string) {
  const key = normalizePubkey(pubkey);
  publish({
    ...(current.pubkey === key
      ? current
      : { ...IDLE_SCOUT_START_STATE, requests: current.requests }),
    pubkey: key,
    phase: "starting",
    reason: null,
  });
}

/** Scout was seen running: nothing is outstanding. */
export function noteScoutUp(pubkey: string) {
  const key = normalizePubkey(pubkey);
  if (
    current.pubkey === key &&
    current.phase === "idle" &&
    current.failures === 0
  ) {
    return;
  }
  publish({
    ...IDLE_SCOUT_START_STATE,
    pubkey: key,
    requests: current.requests,
  });
}

/** The start failed: count it, set the back-off, keep the reason. */
export function noteScoutStartFailed(
  pubkey: string,
  reason: string,
  now: number,
) {
  publish(afterScoutStartFailure(current, pubkey, reason, now));
}

/** The owner pressed Try again: forget earlier failures so the next look starts
 * Scout at once. `pubkey` is `null` while Scout is not known yet. */
export function requestScoutRestart(pubkey: string | null) {
  publish({
    ...IDLE_SCOUT_START_STATE,
    pubkey: pubkey === null ? null : normalizePubkey(pubkey),
    phase: "starting",
    requests: current.requests + 1,
  });
}

/** Community-switch reset (see resetCommunityState in useCommunityInit). */
export function resetScoutStartState() {
  publish({ ...IDLE_SCOUT_START_STATE, requests: current.requests });
}

// ── The card ───────────────────────────────────────────────────────────────

export type CofounderScoutCardKind =
  | "progress"
  | "stalled"
  | "failed"
  | "unreachable";

export type CofounderScoutCard = {
  kind: CofounderScoutCardKind;
  title: string;
  body: string;
  /** The button says "Try again" (and wakes Scout) rather than "Open Scout". */
  retry: boolean;
};

/**
 * What the Scout card says, or `null` when it is not shown.
 *
 * It is shown from the moment co-founder mode is on until onboarding is done
 * and a brief exists. Before 2 Nov it was shown only once an onboarding record
 * existed, which is exactly the state Scout is in when it never started: the
 * owner saw nothing at all.
 */
export function cofounderScoutCardModel(input: {
  enabled: boolean;
  /** Both records were read without error. */
  recordsKnown: boolean;
  /** Onboarding record status, or `null` when Scout has not begun. */
  onboardingStatus: "in_progress" | "complete" | null;
  /** A brief is waiting for the owner or was confirmed. */
  briefExists: boolean;
  /** Unix seconds the owner switched on (or resumed) onboarding, if known. */
  waitingSince: number | null;
  /** The relay marked Scout unreachable, with its plain reason. */
  unreachableDetail: string | null;
  unreachable: boolean;
  scoutStart: ScoutStartState;
  companyName: string;
  nowMs: number;
}): CofounderScoutCard | null {
  if (
    !input.enabled ||
    !input.recordsKnown ||
    input.briefExists ||
    input.onboardingStatus === "complete"
  ) {
    return null;
  }
  const retryHint = "Try again to wake Scout and continue setup.";
  if (input.scoutStart.phase === "failed") {
    return {
      kind: "failed",
      title: "Scout could not start",
      body: `${input.scoutStart.reason ?? "Scout did not start on this computer."} ${retryHint}`,
      retry: true,
    };
  }
  if (input.unreachable) {
    return {
      kind: "unreachable",
      title: "Scout could not be reached",
      body: input.unreachableDetail
        ? `${input.unreachableDetail} ${retryHint}`
        : `Scout could not be reached. ${retryHint}`,
      retry: true,
    };
  }
  const stalled =
    input.waitingSince !== null &&
    input.nowMs - input.waitingSince * 1_000 >= SCOUT_STALL_AFTER_MS;
  if (stalled) {
    return {
      kind: "stalled",
      title: "Scout has not started yet",
      body: `It has been a few minutes since ${input.companyName} was switched on. ${retryHint}`,
      retry: true,
    };
  }
  return {
    kind: "progress",
    title: `Scout is getting to know ${input.companyName}`,
    body: "Reading your website, leads, chats and connected tools. Scout will message you a short brief to check.",
    retry: false,
  };
}
