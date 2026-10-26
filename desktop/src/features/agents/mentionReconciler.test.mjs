import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  getAgentStartWatches,
  registerAgentStartWatch,
  resetAgentStartWatches,
  resolveAgentStartWatches,
} from "./agentStartWatch.ts";
import {
  createMentionReconciler,
  MAX_AUTOMATIC_RESTARTS,
  RETRY_DELAYS_MS,
  SENT_CHECK_DELAYS_MS,
} from "./mentionReconciler.ts";

const SCOUT =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
const NOVA = "dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321";
const WELCOME = "channel-welcome";
const SCOPE = {
  expectedRelayUrl: "wss://relay.example",
  expectedSignerPubkey: "1".repeat(64),
};
// 26 Oct 2026, the GATE-303 timeline.
const FIRST = 1_792_997_470;
const SECOND = 1_792_997_600;

const mention = (
  id,
  createdAt,
  channelId = WELCOME,
  threadHeadId = null,
  progress = "none",
) => ({
  id,
  createdAt,
  channelId,
  threadHeadId,
  progress,
});
const agent = (pubkey, status = "stopped", backend = "local") => ({
  pubkey,
  name: pubkey === SCOUT ? "Scout" : "Nova",
  status,
  backend: { type: backend },
});

/** Everything the reconciler touches, with a virtual clock for its timers. */
function rig(overrides = {}) {
  const state = {
    agents: [agent(SCOUT, "stopped")],
    unanswered: new Map([[SCOUT, [mention("a27e49a5", FIRST)]]]),
    scope: SCOPE,
    inFlight: false,
    loadError: null,
    findError: null,
    startError: null,
    handBackError: null,
    /** The harness the start spawns is gone again at once. */
    diesAfterStart: false,
  };
  const log = {
    loads: 0,
    finds: [],
    /** Every stop, hand-back and start, in the order they happened. */
    steps: [],
    stops: [],
    handBacks: [],
    exclusive: [],
    starts: [],
    watches: [],
    resolved: [],
    resolvedBefore: [],
    failed: [],
    stalled: [],
    reports: [],
    warns: [],
    caught: new Set(),
  };
  const timers = [];
  let now = 0;
  const deps = {
    loadAgents: async () => {
      log.loads += 1;
      if (state.loadError) throw state.loadError;
      return state.agents;
    },
    findUnanswered: async (pubkey, lookbackSeconds) => {
      log.finds.push({ pubkey, lookbackSeconds });
      if (state.findError) throw state.findError;
      return state.unanswered.get(pubkey) ?? [];
    },
    getScope: () => state.scope,
    stopAgent: async (pubkey, reason) => {
      log.steps.push("stop");
      log.stops.push({ pubkey, reason });
      state.agents = state.agents.map((candidate) =>
        candidate.pubkey === pubkey
          ? { ...candidate, status: "stopped" }
          : candidate,
      );
    },
    handBack: async (pubkey, eventIds) => {
      log.steps.push("handBack");
      log.handBacks.push({ pubkey, eventIds });
      if (state.handBackError) throw state.handBackError;
      return eventIds.length;
    },
    exclusive: async (pubkey, label, work) => {
      log.exclusive.push({ pubkey, label });
      return work();
    },
    startAgent: async (agentRecord, attempt, scope) => {
      log.steps.push("start");
      log.starts.push({ pubkey: agentRecord.pubkey, ...attempt, scope });
      if (state.startError) throw state.startError;
      // The host now reports the harness it just spawned.
      state.agents = state.agents.map((candidate) =>
        candidate.pubkey === agentRecord.pubkey
          ? {
              ...candidate,
              status: state.diesAfterStart ? "stopped" : "running",
            }
          : candidate,
      );
      return agentRecord;
    },
    isStartInFlight: () => state.inFlight,
    watch: (input) => log.watches.push(input),
    resolve: (pubkey, before) => {
      log.resolved.push(pubkey);
      log.resolvedBefore.push(before);
    },
    now: () => now,
    fail: (pubkey, reason) => log.failed.push({ pubkey, reason }),
    stall: (pubkey, note) => log.stalled.push({ pubkey, note }),
    caughtUp: {
      has: (id) => log.caught.has(id),
      add: (id) => log.caught.add(id),
    },
    report: (message) => log.reports.push(message),
    warn: (message) => log.warns.push(message),
    schedule: (run, delayMs) => {
      const timer = { at: now + delayMs, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    ...overrides,
  };
  const reconciler = createMentionReconciler(deps);
  /** Run every timer due within `ms`, letting async work settle between. */
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      await settle();
      const due = timers
        .filter((timer) => timer.live && timer.at <= until)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      now = due.at;
      due.run();
    }
    now = until;
    await settle();
  }
  return {
    reconciler,
    state,
    log,
    advance,
    pending: () => timers.filter((t) => t.live).length,
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe("after a send", () => {
  it("starts a stopped local agent that never touched the mention (GATE-303)", async () => {
    const r = rig();
    r.reconciler.noteMentionSent([SCOUT]);
    // Nothing happens before the first look: the send path had its chance.
    await r.advance(SENT_CHECK_DELAYS_MS[0] - 1);
    assert.equal(r.log.starts.length, 0);
    await r.advance(1);
    assert.equal(r.log.starts.length, 1);
    assert.equal(r.log.starts[0].pubkey, SCOUT);
    assert.equal(r.log.starts[0].floorUnix, FIRST);
    assert.equal(r.log.starts[0].force, false);
    assert.deepEqual(r.log.starts[0].scope, SCOPE);
    // The conversation is told: a loud watch, with the mention's own scope.
    assert.equal(r.log.watches.length, 1);
    assert.equal(r.log.watches[0].quiet, false);
    assert.equal(r.log.watches[0].channelId, WELCOME);
    assert.equal(r.log.watches[0].floorUnix, FIRST);
  });

  it("reaches back to the oldest unanswered mention, not the newest", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [
      mention("a27e49a5", FIRST),
      mention("da14c9ca", SECOND),
    ]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts[0].floorUnix, FIRST);
  });

  it("does nothing for a mention the agent already answered, and clears the wait", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, []);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 0);
    assert.deepEqual(r.log.resolved, [SCOUT]);
    assert.equal(r.pending(), 0);
  });

  it("starts from the host's word, not a cached running status", async () => {
    // The cache said running; the host, which looks at the process, says
    // stopped. The reconciler only ever reads the host.
    const r = rig();
    r.state.agents = [agent(SCOUT, "stopped")];
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 1);
  });

  it("leaves a running agent alone, waits quietly, and looks a bounded number of times", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(20 * 60_000);
    assert.equal(r.log.starts.length, 0);
    assert.ok(r.log.watches.length >= 1);
    assert.ok(r.log.watches.every((watch) => watch.quiet === true));
    // First look plus one per configured delay, then it stops looking.
    assert.equal(r.log.finds.length, 1 + SENT_CHECK_DELAYS_MS.length);
    assert.equal(r.pending(), 0);
  });

  it("stops waiting as soon as a later look finds the mention answered", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    r.state.unanswered.set(SCOUT, []);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.deepEqual(r.log.resolved, [SCOUT]);
    assert.equal(r.pending(), 0);
  });

  it("ignores a mention of someone who is not a local agent", async () => {
    const r = rig();
    r.reconciler.noteMentionSent([NOVA]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.finds.length, 0);
    assert.equal(r.log.starts.length, 0);
  });

  it("ignores a provider-backed agent: it runs elsewhere", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "deployed", "provider")];
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.finds.length, 0);
    assert.equal(r.log.starts.length, 0);
  });

  it("does not start a second harness while the send flow's wake is in flight", async () => {
    const r = rig();
    r.state.inFlight = true;
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 0);
    assert.equal(r.log.watches.length, 1);
  });

  it("waits for a scope it does not have yet, then starts under it", async () => {
    const r = rig();
    r.state.scope = null;
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 0);
    r.state.scope = SCOPE;
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 1);
    assert.deepEqual(r.log.starts[0].scope, SCOPE);
  });

  it("says so at once when the start fails, and does not loop", async () => {
    const r = rig();
    r.state.startError = new Error("spawn failed");
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(10 * 60_000);
    assert.equal(r.log.starts.length, 1);
    assert.deepEqual(r.log.failed, [{ pubkey: SCOUT, reason: "spawn failed" }]);
    assert.equal(r.pending(), 0);
  });
});

describe("when a read fails", () => {
  it("retries the relay read with a back-off and never starts on a failed read", async () => {
    const r = rig();
    r.state.findError = new Error("relay down");
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 0);
    r.state.findError = null;
    await r.advance(RETRY_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 1);
    assert.equal(r.log.reports.length, 0);
  });

  it("reports once when the relay stays unreadable through every retry", async () => {
    const r = rig();
    r.state.findError = new Error("relay down");
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(10 * 60_000);
    assert.equal(r.log.starts.length, 0);
    assert.equal(r.log.reports.length, 1);
    assert.equal(r.log.finds.length, 1 + RETRY_DELAYS_MS.length);
    assert.equal(r.pending(), 0);
  });

  it("retries a host list that is not ready, then reports", async () => {
    const r = rig();
    r.state.loadError = new Error("host not ready");
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(10 * 60_000);
    assert.equal(r.log.starts.length, 0);
    assert.equal(r.log.reports.length, 1);
    assert.equal(r.log.loads, 1 + RETRY_DELAYS_MS.length);
  });

  it("starts once the host list comes back", async () => {
    const r = rig();
    r.state.loadError = new Error("host not ready");
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    r.state.loadError = null;
    await r.advance(RETRY_DELAYS_MS[0] + SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 1);
  });
});

describe("when the community opens", () => {
  it("starts a stopped local agent for a mention sent while nothing was running", async () => {
    const r = rig();
    r.reconciler.catchUpOnLaunch();
    await r.advance(0);
    assert.equal(r.log.starts.length, 1);
    assert.equal(r.log.starts[0].floorUnix, FIRST);
    assert.equal(r.log.finds[0].lookbackSeconds, 24 * 60 * 60);
  });

  it("starts for a given mention once, not on every launch", async () => {
    const r = rig();
    r.reconciler.catchUpOnLaunch();
    await r.advance(0);
    assert.equal(r.log.starts.length, 1);
    // The next launch: same relay state, same device.
    const next = rig();
    next.log.caught = r.log.caught;
    next.reconciler.catchUpOnLaunch();
    await next.advance(10 * 60_000);
    assert.equal(next.log.starts.length, 0);
  });

  it("starts nothing for an agent that answered everything", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, []);
    r.reconciler.catchUpOnLaunch();
    await r.advance(0);
    assert.equal(r.log.starts.length, 0);
  });

  it("skips provider-backed agents", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "deployed", "provider")];
    r.reconciler.catchUpOnLaunch();
    await r.advance(0);
    assert.equal(r.log.finds.length, 0);
  });

  it("reports a host that never lists the agents", async () => {
    const r = rig();
    r.state.loadError = new Error("host not ready");
    r.reconciler.catchUpOnLaunch();
    await r.advance(10 * 60_000);
    assert.equal(r.log.reports.length, 1);
    assert.equal(r.log.starts.length, 0);
  });
});

describe("a harness that queued the mention and was stopped before it answered (GATE-304)", () => {
  const T = 1_793_016_887; // 12:14:47Z, 6bf4fee6
  const queued = () => mention("6bf4fee6", T, WELCOME, null, "seen");

  it("hands the mention back to the harness, then starts the agent from it", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [queued()]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.deepEqual(r.log.handBacks, [
      { pubkey: SCOUT, eventIds: ["6bf4fee6"] },
    ]);
    assert.deepEqual(r.log.steps, ["handBack", "start"]);
    assert.equal(r.log.starts[0].floorUnix, T);
    assert.deepEqual(
      r.log.exclusive.map((entry) => entry.label),
      ["mention reconcile"],
    );
  });

  it("finds it when the harness is stopped some seconds after a clean start", async () => {
    // The wake started Scout; it queued the mention (👀) and was stopped.
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.state.unanswered.set(SCOUT, [queued()]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 0, "a running harness is left alone");
    // The harness goes away; the next look sees it.
    r.state.agents = [agent(SCOUT, "stopped")];
    await r.advance(SENT_CHECK_DELAYS_MS[1]);
    assert.deepEqual(r.log.steps, ["handBack", "start"]);
    assert.equal(r.log.starts[0].floorUnix, T);
  });

  it("hands back only what the harness queued, never a mention nobody saw", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [
      queued(),
      mention("fresh", T + 30, WELCOME, null, "none"),
    ]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.deepEqual(r.log.handBacks[0].eventIds, ["6bf4fee6"]);
    assert.equal(r.log.starts[0].floorUnix, T);
  });

  it("starts without a hand-back when nothing was queued", async () => {
    const r = rig();
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.handBacks.length, 0);
    assert.equal(r.log.starts.length, 1);
  });

  it("still starts the agent when the ledger cannot be edited", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [queued()]);
    r.state.handBackError = new Error("ledger unreadable");
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 1);
    assert.ok(r.log.warns.length >= 1);
  });

  it("does not run a turn that began again on its own: says so and lets the person decide", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [
      mention("begun", T, WELCOME, null, "working"),
    ]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.equal(r.log.starts.length, 0);
    assert.equal(r.log.handBacks.length, 0);
    assert.equal(r.log.failed.length, 0, "the start did not fail");
    assert.deepEqual(r.log.stalled, [
      { pubkey: SCOUT, note: "Scout stopped while working on this." },
    ]);
    assert.equal(r.pending(), 0);
  });

  it("starts the agent for the mentions it can answer when others had begun", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [
      mention("begun", T - 100, WELCOME, null, "working"),
      queued(),
    ]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.deepEqual(r.log.handBacks[0].eventIds, ["6bf4fee6"]);
    assert.equal(r.log.starts.length, 1);
    assert.equal(r.log.starts[0].floorUnix, T);
  });

  it("stops starting a harness that keeps going away and says so", async () => {
    const r = rig();
    r.state.diesAfterStart = true;
    r.state.unanswered.set(SCOUT, [queued()]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(30 * 60_000);
    assert.equal(r.log.starts.length, MAX_AUTOMATIC_RESTARTS);
    assert.deepEqual(r.log.stalled, [
      { pubkey: SCOUT, note: "Scout keeps stopping before it answers." },
    ]);
    assert.equal(r.pending(), 0);
  });

  it("keeps looking for a quarter of an hour: a harness that dies late is found", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.state.unanswered.set(SCOUT, [queued()]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(10 * 60_000);
    assert.equal(r.log.starts.length, 0);
    r.state.agents = [agent(SCOUT, "stopped")];
    await r.advance(3 * 60_000);
    assert.equal(r.log.starts.length, 1);
  });

  it("starts for a queued mention at launch, once", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [queued()]);
    r.reconciler.catchUpOnLaunch();
    await r.advance(0);
    assert.deepEqual(r.log.steps, ["handBack", "start"]);
    const next = rig();
    next.state.unanswered.set(SCOUT, [queued()]);
    next.log.caught = r.log.caught;
    next.reconciler.catchUpOnLaunch();
    await next.advance(10 * 60_000);
    assert.equal(next.log.starts.length, 0);
  });
});

describe("before a harness is spawned for the agent", () => {
  it("hands back the mentions its last harness queued and returns how far back to replay", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [
      mention("old-queued", FIRST, WELCOME, null, "seen"),
      mention("untouched", SECOND, WELCOME, null, "none"),
    ]);
    assert.equal(await r.reconciler.prepareStart(SCOUT), FIRST);
    assert.deepEqual(r.log.handBacks, [
      { pubkey: SCOUT, eventIds: ["old-queued"] },
    ]);
  });

  it("returns nothing to reach back to when the agent owes no answer", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, []);
    assert.equal(await r.reconciler.prepareStart(SCOUT), undefined);
    assert.equal(r.log.handBacks.length, 0);
  });

  it("rejects when the relay cannot be read: the caller decides", async () => {
    const r = rig();
    r.state.findError = new Error("relay down");
    await assert.rejects(r.reconciler.prepareStart(SCOUT), /relay down/);
  });
});

describe("when the person asks to try again", () => {
  const T = 1_793_016_887;

  it("replaces a running harness, hands back everything unanswered and starts from the oldest", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.state.unanswered.set(SCOUT, [
      mention("begun", T - 50, WELCOME, null, "working"),
      mention("queued", T, WELCOME, null, "seen"),
      mention("untouched", T + 5, WELCOME, null, "none"),
    ]);
    await r.reconciler.retryAgent(SCOUT, T + 5);
    assert.deepEqual(r.log.steps, ["stop", "handBack", "start"]);
    assert.equal(r.log.stops[0].reason, "the person asked to try again");
    assert.deepEqual(r.log.handBacks[0].eventIds, ["begun", "queued"]);
    assert.equal(r.log.starts[0].floorUnix, T - 50);
    assert.equal(r.log.starts[0].force, false);
    assert.deepEqual(
      r.log.exclusive.map((entry) => entry.label),
      ["try again"],
    );
  });

  it("does not stop an agent that is already stopped", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, [
      mention("queued", T, WELCOME, null, "seen"),
    ]);
    await r.reconciler.retryAgent(SCOUT, T);
    assert.deepEqual(r.log.steps, ["handBack", "start"]);
  });

  it("still restarts when the relay cannot be read", async () => {
    const r = rig();
    r.state.findError = new Error("relay down");
    r.state.agents = [agent(SCOUT, "running")];
    await r.reconciler.retryAgent(SCOUT, T);
    assert.deepEqual(r.log.steps, ["stop", "start"]);
    assert.equal(r.log.starts[0].floorUnix, T);
  });

  it("is what the watch's Try again runs", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.state.unanswered.set(SCOUT, [
      mention("queued", T, WELCOME, null, "seen"),
    ]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    const watch = r.log.watches[0];
    await watch.start({ force: true, floorUnix: T });
    assert.deepEqual(r.log.steps, ["stop", "handBack", "start"]);
  });

  it("is refused while Colony has no scope", async () => {
    const r = rig();
    r.state.scope = null;
    await assert.rejects(r.reconciler.retryAgent(SCOUT, T), /still connecting/);
    assert.equal(r.log.starts.length, 0);
  });
});

describe("the watch's own restart", () => {
  const T = 1_793_016_887;

  it("replaces a harness that is gone, handing back what it queued", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.state.unanswered.set(SCOUT, [
      mention("queued", T, WELCOME, null, "seen"),
    ]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    r.state.agents = [agent(SCOUT, "stopped")];
    await r.log.watches[0].start({ force: false, floorUnix: T });
    assert.deepEqual(r.log.steps, ["handBack", "start"]);
  });

  it("leaves a harness that is running alone", async () => {
    const r = rig();
    r.state.agents = [agent(SCOUT, "running")];
    r.state.unanswered.set(SCOUT, [
      mention("queued", T, WELCOME, null, "seen"),
    ]);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    await r.log.watches[0].start({ force: false, floorUnix: T });
    assert.equal(r.log.starts.length, 0);
    assert.equal(r.log.stops.length, 0);
  });
});

describe("a look at the relay that began before the person's mention was sent (GATE-304)", () => {
  it("only ends the waits registered before it began", async () => {
    const r = rig();
    r.state.unanswered.set(SCOUT, []);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    assert.deepEqual(r.log.resolved, [SCOUT]);
    assert.equal(r.log.resolvedBefore[0], SENT_CHECK_DELAYS_MS[0]);
  });

  describe("against the real store of waits", () => {
    const T0_MS = 1_793_016_880_000;
    beforeEach(() => {
      mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0_MS });
      resetAgentStartWatches();
    });
    afterEach(() => {
      resetAgentStartWatches();
      mock.timers.reset();
    });

    it("keeps the wait for a mention sent while the look was still reading", async () => {
      // The launch look asked the relay before the person typed; the relay
      // answered "nothing unanswered" after the mention had registered its
      // wait. The wait must survive: the look never saw that mention.
      let answer;
      const reading = new Promise((resolve) => {
        answer = resolve;
      });
      const timers = [];
      const reconciler = createMentionReconciler({
        loadAgents: async () => [agent(SCOUT, "running")],
        findUnanswered: async () => {
          await reading;
          return [];
        },
        getScope: () => SCOPE,
        stopAgent: async () => {},
        handBack: async () => 0,
        exclusive: async (_pubkey, _label, work) => work(),
        startAgent: async () => {},
        isStartInFlight: () => false,
        watch: registerAgentStartWatch,
        resolve: (pubkey, registeredBefore) =>
          resolveAgentStartWatches(pubkey, { registeredBefore }),
        now: () => Date.now(),
        fail: () => {},
        stall: () => {},
        caughtUp: { has: () => false, add: () => {} },
        report: () => {},
        warn: () => {},
        schedule: (run, delayMs) => {
          const timer = setTimeout(run, delayMs);
          timers.push(timer);
          return () => clearTimeout(timer);
        },
      });
      // An earlier mention's wait, registered before the look began.
      registerAgentStartWatch({
        pubkey: SCOUT,
        channelId: WELCOME,
        threadHeadId: null,
        floorUnix: 1_793_016_000,
        start: async () => {},
      });
      reconciler.catchUpOnLaunch();
      mock.timers.tick(10);
      await settle();
      // The look is reading. The person sends a mention; its wait registers.
      mock.timers.tick(5_000);
      registerAgentStartWatch({
        pubkey: SCOUT,
        channelId: WELCOME,
        threadHeadId: "thread-1",
        floorUnix: 1_793_016_886,
        start: async () => {},
      });
      answer();
      await settle();
      const left = [...getAgentStartWatches(WELCOME)].map(
        (watch) => watch.threadHeadId,
      );
      assert.deepEqual(left, ["thread-1"], "only the older wait ended");
      reconciler.dispose();
    });
  });
});

describe("dispose", () => {
  it("cancels what is pending and starts nothing afterwards", async () => {
    const r = rig();
    r.reconciler.noteMentionSent([SCOUT]);
    r.reconciler.dispose();
    await r.advance(10 * 60_000);
    assert.equal(r.log.starts.length, 0);
    assert.equal(r.pending(), 0);
    r.reconciler.noteMentionSent([SCOUT]);
    await r.advance(10 * 60_000);
    assert.equal(r.log.starts.length, 0);
  });

  it("drops a look that was already in flight", async () => {
    const r = rig({
      findUnanswered: async () => {
        await settle();
        return [mention("a27e49a5", FIRST)];
      },
    });
    r.reconciler.noteMentionSent([SCOUT]);
    // Run the first look's timer, then dispose while its read is pending.
    await r.advance(SENT_CHECK_DELAYS_MS[0]);
    r.reconciler.dispose();
    await settle();
    assert.ok(r.log.starts.length <= 1);
  });
});
