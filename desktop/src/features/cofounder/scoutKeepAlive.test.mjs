import assert from "node:assert/strict";
import test from "node:test";

import {
  afterScoutStartFailure,
  cofounderScoutCardModel,
  COFOUNDER_WAKE_TAG,
  findCofounderScout,
  findPendingCofounderWake,
  getScoutStartState,
  IDLE_SCOUT_START_STATE,
  noteScoutStartFailed,
  planScoutStart,
  requestScoutRestart,
  resetScoutStartState,
  SCOUT_START_BACKOFF_MS,
  SCOUT_START_MAX_FAILURES,
  SCOUT_STALL_AFTER_MS,
} from "./scoutKeepAlive.ts";

const SCOUT = "a".repeat(64);
const OTHER = "b".repeat(64);
const RELAY = "c".repeat(64);
const OWNER = "d".repeat(64);
const RELAY_URL = "wss://horizon.example";
const NOW = 1_800_000_000_000;

function agent(overrides = {}) {
  return {
    pubkey: SCOUT,
    name: "Scout",
    personaId: "builtin:fizz",
    relayUrl: RELAY_URL,
    status: "stopped",
    startOnAppLaunch: false,
    backend: { type: "local" },
    ...overrides,
  };
}

function plan(overrides = {}) {
  return planScoutStart({
    enabled: true,
    onboardingKnown: true,
    onboardingStarted: false,
    scout: agent(),
    wakeWaiting: false,
    state: IDLE_SCOUT_START_STATE,
    now: NOW,
    ...overrides,
  });
}

test("2 Nov: a stopped Scout is started by itself when onboarding has not begun", () => {
  // The owner's machine: Scout made by the Welcome flow with "start with the
  // app" off, stopped by the 3.0.30 update, no onboarding record.
  const result = plan();
  assert.equal(result.start, true);
  assert.equal(result.reason, "onboarding-not-started");
  assert.equal(
    result.markAutoStart,
    true,
    "start with the app is turned on so the next launch restores Scout",
  );
});

test("nothing starts while co-founder mode is off", () => {
  const result = plan({ enabled: false });
  assert.equal(result.start, false);
  assert.equal(result.markAutoStart, false);
});

test("an onboarding record that has not been read is not 'not started'", () => {
  assert.equal(plan({ onboardingKnown: false }).start, false);
});

test("a running Scout is left alone", () => {
  assert.equal(plan({ scout: agent({ status: "running" }) }).start, false);
  assert.equal(plan({ scout: agent({ status: "deployed" }) }).start, false);
});

test("a remote or missing Scout is never started on this computer", () => {
  assert.equal(plan({ scout: null }).start, false);
  assert.equal(
    plan({ scout: agent({ backend: { type: "provider", id: "x" } }) }).start,
    false,
  );
});

test("a Scout stopped on purpose is left alone once onboarding has begun", () => {
  const result = plan({ onboardingStarted: true, wakeWaiting: false });
  assert.equal(result.start, false);
});

test("a relay wake waiting for a stopped Scout starts it, even mid-onboarding", () => {
  const result = plan({ onboardingStarted: true, wakeWaiting: true });
  assert.equal(result.start, true);
  assert.equal(result.reason, "wake-waiting");
});

test("a failed start is retried on a capped back-off, then left failed", () => {
  let state = IDLE_SCOUT_START_STATE;
  const delays = [];
  for (let attempt = 1; attempt < SCOUT_START_MAX_FAILURES; attempt += 1) {
    assert.equal(plan({ state, now: NOW + 10 * 60_000 * attempt }).start, true);
    state = afterScoutStartFailure(state, SCOUT, "no tool", NOW);
    assert.equal(state.phase, "failed");
    assert.equal(state.failures, attempt);
    delays.push(state.nextAttemptAt - NOW);
    // Inside the wait: no start, and the plan says when to look again.
    const waiting = plan({ state, now: NOW + 1 });
    assert.equal(waiting.start, false);
    assert.equal(waiting.retryAt, state.nextAttemptAt);
  }
  assert.deepEqual(delays, [
    SCOUT_START_BACKOFF_MS[1],
    SCOUT_START_BACKOFF_MS[2],
    SCOUT_START_BACKOFF_MS[3],
  ]);
  // The last allowed attempt fails too: now only Try again continues.
  state = afterScoutStartFailure(state, SCOUT, "no tool", NOW);
  const gaveUp = plan({ state, now: NOW + 60 * 60_000 });
  assert.equal(gaveUp.start, false);
  assert.equal(gaveUp.gaveUp, true);
  assert.equal(gaveUp.retryAt, null);
});

test("failures of another agent do not hold Scout back", () => {
  const state = afterScoutStartFailure(
    IDLE_SCOUT_START_STATE,
    OTHER,
    "broken",
    NOW,
  );
  assert.equal(plan({ state, now: NOW + 1 }).start, true);
});

test("Try again forgets earlier failures and starts Scout at once", () => {
  resetScoutStartState();
  for (let i = 0; i < SCOUT_START_MAX_FAILURES; i += 1) {
    noteScoutStartFailed(SCOUT, "no tool", NOW);
  }
  const before = getScoutStartState();
  assert.equal(plan({ state: before, now: NOW + 1 }).gaveUp, true);
  requestScoutRestart(SCOUT);
  const after = getScoutStartState();
  assert.equal(after.failures, 0);
  assert.equal(after.requests, before.requests + 1);
  assert.equal(plan({ state: after, now: NOW + 1 }).start, true);
  resetScoutStartState();
});

test("start with the app is only turned on, never off, and only for a local Scout", () => {
  assert.equal(
    plan({ scout: agent({ startOnAppLaunch: true }) }).markAutoStart,
    false,
  );
  assert.equal(
    plan({ scout: agent({ status: "running" }) }).markAutoStart,
    true,
    "also when Scout happens to be running now",
  );
});

test("findCofounderScout picks the lead, else the one Scout on this community", () => {
  const lead = agent({ pubkey: OTHER, name: "Maya", personaId: null });
  const scout = agent();
  assert.equal(
    findCofounderScout([scout, lead], {
      leadPubkey: OTHER,
      relayUrl: RELAY_URL,
    }),
    lead,
  );
  assert.equal(
    findCofounderScout([scout, lead], { relayUrl: RELAY_URL }),
    scout,
  );
});

test("findCofounderScout refuses two Scouts and ignores another community's", () => {
  const first = agent();
  const second = agent({ pubkey: OTHER });
  assert.equal(
    findCofounderScout([first, second], { relayUrl: RELAY_URL }),
    null,
  );
  const elsewhere = agent({ relayUrl: "wss://other.example" });
  assert.equal(findCofounderScout([elsewhere], { relayUrl: RELAY_URL }), null);
  const remote = agent({ backend: { type: "provider", id: "x" } });
  assert.equal(findCofounderScout([remote], { relayUrl: RELAY_URL }), null);
});

// ── relay wakes ────────────────────────────────────────────────────────────

function wakeEvent(overrides = {}) {
  return {
    id: "1".repeat(64),
    pubkey: RELAY,
    kind: 9,
    created_at: 1_000,
    content: "Wake from the relay (co-founder mode):",
    sig: "",
    tags: [
      ["h", "dm-channel"],
      ["p", SCOUT],
      [COFOUNDER_WAKE_TAG, "mode_on"],
    ],
    ...overrides,
  };
}

function relay({ wakes, scoutEvents }) {
  const asked = [];
  return {
    asked,
    fetchEvents: async (filter) => {
      asked.push(filter);
      return filter.authors?.[0] === SCOUT ? scoutEvents : wakes;
    },
  };
}

test("a relay wake Scout never reacted to is found in the history after a launch", async () => {
  const { fetchEvents, asked } = relay({
    wakes: [wakeEvent()],
    scoutEvents: [],
  });
  const wake = await findPendingCofounderWake({
    scoutPubkey: SCOUT,
    relaySelf: RELAY,
    nowSeconds: 2_000,
    fetchEvents,
  });
  assert.deepEqual(wake, {
    id: "1".repeat(64),
    createdAt: 1_000,
    channelId: "dm-channel",
  });
  // The relay refuses a read that names no kinds (the p-gate): both name them.
  assert.ok(asked.every((filter) => Array.isArray(filter.kinds)));
});

test("a wake Scout reacted to or answered is no longer waiting", async () => {
  const reaction = {
    id: "2".repeat(64),
    pubkey: SCOUT,
    kind: 7,
    created_at: 1_001,
    content: "👀",
    sig: "",
    tags: [["e", "1".repeat(64)]],
  };
  const { fetchEvents } = relay({
    wakes: [wakeEvent()],
    scoutEvents: [reaction],
  });
  assert.equal(
    await findPendingCofounderWake({
      scoutPubkey: SCOUT,
      relaySelf: RELAY,
      nowSeconds: 2_000,
      fetchEvents,
    }),
    null,
  );
});

test("only a message the relay itself signed counts as a wake", async () => {
  // A member who copies the tag cannot make Scout start (or hide anything).
  const forged = wakeEvent({ pubkey: OWNER });
  const noTag = wakeEvent({ tags: [["p", SCOUT]] });
  const { fetchEvents } = relay({ wakes: [forged, noTag], scoutEvents: [] });
  assert.equal(
    await findPendingCofounderWake({
      scoutPubkey: SCOUT,
      relaySelf: RELAY,
      nowSeconds: 2_000,
      fetchEvents,
    }),
    null,
  );
});

test("a relay that cannot be read is an error, never 'nothing is waiting'", async () => {
  await assert.rejects(
    findPendingCofounderWake({
      scoutPubkey: SCOUT,
      relaySelf: RELAY,
      nowSeconds: 2_000,
      fetchEvents: async () => {
        throw new Error("offline");
      },
    }),
    /offline/,
  );
});

// ── the card ───────────────────────────────────────────────────────────────

function card(overrides = {}) {
  return cofounderScoutCardModel({
    enabled: true,
    recordsKnown: true,
    onboardingStatus: null,
    briefExists: false,
    waitingSince: NOW / 1000,
    unreachable: false,
    unreachableDetail: null,
    scoutStart: IDLE_SCOUT_START_STATE,
    companyName: "Horizon Labs",
    nowMs: NOW,
    ...overrides,
  });
}

test("the card shows progress from the moment the mode is on, before any onboarding record", () => {
  const result = card();
  assert.equal(result?.kind, "progress");
  assert.equal(result?.title, "Scout is getting to know Horizon Labs");
  assert.equal(result?.retry, false);
});

test("after a few minutes without an onboarding record the card says so, with Try again", () => {
  const result = card({ nowMs: NOW + SCOUT_STALL_AFTER_MS });
  assert.equal(result?.kind, "stalled");
  assert.equal(result?.title, "Scout has not started yet");
  assert.equal(result?.retry, true);
  assert.match(result?.body ?? "", /Try again/);
});

test("a start that failed on this computer is shown at once, with the reason and one button", () => {
  const failed = afterScoutStartFailure(
    IDLE_SCOUT_START_STATE,
    SCOUT,
    "Claude Code is not installed.",
    NOW,
  );
  const result = card({ scoutStart: failed });
  assert.equal(result?.kind, "failed");
  assert.equal(result?.title, "Scout could not start");
  assert.match(result?.body ?? "", /Claude Code is not installed\./);
  assert.equal(result?.retry, true);
});

test("the relay's 'could not be reached' still shows, and a failed start wins over it", () => {
  const unreachable = card({
    unreachable: true,
    unreachableDetail: "The relay found more than one Scout.",
  });
  assert.equal(unreachable?.kind, "unreachable");
  assert.match(unreachable?.body ?? "", /more than one Scout/);
  const failed = afterScoutStartFailure(
    IDLE_SCOUT_START_STATE,
    SCOUT,
    "x",
    NOW,
  );
  assert.equal(card({ unreachable: true, scoutStart: failed })?.kind, "failed");
});

test("the card is gone when the mode is off, onboarding is done or a brief exists", () => {
  assert.equal(card({ enabled: false }), null);
  assert.equal(card({ onboardingStatus: "complete" }), null);
  assert.equal(card({ briefExists: true }), null);
  assert.equal(card({ recordsKnown: false }), null);
});

test("an onboarding in progress stalls on the same clock as one that never started", () => {
  const started = card({
    onboardingStatus: "in_progress",
    nowMs: NOW + SCOUT_STALL_AFTER_MS,
  });
  assert.equal(started?.kind, "stalled");
});
