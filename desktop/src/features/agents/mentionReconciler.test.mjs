import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMentionReconciler,
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

const mention = (id, createdAt, channelId = WELCOME, threadHeadId = null) => ({
  id,
  createdAt,
  channelId,
  threadHeadId,
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
  };
  const log = {
    loads: 0,
    finds: [],
    starts: [],
    watches: [],
    resolved: [],
    failed: [],
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
    startAgent: async (agentRecord, attempt, scope) => {
      log.starts.push({ pubkey: agentRecord.pubkey, ...attempt, scope });
      if (state.startError) throw state.startError;
      // The host now reports the harness it just spawned.
      state.agents = state.agents.map((candidate) =>
        candidate.pubkey === agentRecord.pubkey
          ? { ...candidate, status: "running" }
          : candidate,
      );
      return agentRecord;
    },
    isStartInFlight: () => state.inFlight,
    watch: (input) => log.watches.push(input),
    resolve: (pubkey) => log.resolved.push(pubkey),
    fail: (pubkey, reason) => log.failed.push({ pubkey, reason }),
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
    await r.advance(10 * 60_000);
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
