import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  getAgentWorkingState,
  getTurnErrorsForChannel,
  getWorkingAgentPubkeysForChannel,
  getWorkingAgentsForChannel,
  getWorkingChannels,
  reportChannelBotTyping,
  resetAgentWorkingSignal,
  subscribeAgentWorkingSignal,
} from "./agentWorkingSignal.ts";
import {
  resetActiveAgentTurnsStore,
  syncAgentTurnsFromEvents,
} from "./activeAgentTurnsStore.ts";

const AGENT =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
const AGENT_2 =
  "dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321";

function makeEvent(overrides) {
  return {
    seq: 1,
    timestamp: new Date().toISOString(),
    kind: "turn_started",
    agentIndex: 0,
    channelId: "chan-1",
    sessionId: "sess-1",
    turnId: "turn-1",
    payload: null,
    ...overrides,
  };
}

function startTurn(agent, channelId, turnId = `turn-${channelId}`) {
  syncAgentTurnsFromEvents(agent, [
    makeEvent({ channelId, turnId, seq: Math.floor(Math.random() * 1e9) }),
  ]);
}

beforeEach(() => {
  resetActiveAgentTurnsStore();
  resetAgentWorkingSignal();
});

describe("getAgentWorkingState", () => {
  it("is idle with no signals", () => {
    const state = getAgentWorkingState(AGENT);
    assert.equal(state.working, false);
    assert.equal(state.source, "none");
    assert.deepEqual(state.channels, []);
  });

  it("reports observer-backed work, unscoped (all-channels rule)", () => {
    startTurn(AGENT, "chan-1");
    const state = getAgentWorkingState(AGENT);
    assert.equal(state.working, true);
    assert.equal(state.source, "observer");
    assert.deepEqual(
      state.channels.map((c) => [c.channelId, c.source]),
      [["chan-1", "observer"]],
    );
  });

  it("scopes working to the requested channel", () => {
    startTurn(AGENT, "chan-1");
    const inChannel = getAgentWorkingState(AGENT, "chan-1");
    assert.equal(inChannel.working, true);
    assert.equal(inChannel.source, "observer");

    const elsewhere = getAgentWorkingState(AGENT, "chan-2");
    assert.equal(elsewhere.working, false);
    assert.equal(elsewhere.source, "none");
    // The unscoped channel list is still exposed for badges.
    assert.equal(elsewhere.channels.length, 1);
  });

  it("falls back to typing when no observer turns exist", () => {
    reportChannelBotTyping("chan-1", [AGENT]);
    const state = getAgentWorkingState(AGENT, "chan-1");
    assert.equal(state.working, true);
    assert.equal(state.source, "typing");
    assert.equal(state.channels[0].source, "typing");
    assert.ok(state.channels[0].anchorAt <= Date.now());
  });

  it("prefers observer over typing for the same channel (no duplicate)", () => {
    startTurn(AGENT, "chan-1");
    reportChannelBotTyping("chan-1", [AGENT]);
    const state = getAgentWorkingState(AGENT, "chan-1");
    assert.equal(state.source, "observer");
    assert.equal(state.channels.length, 1);
    assert.equal(state.channels[0].source, "observer");
  });

  it("typing in one channel does not mark work in another", () => {
    reportChannelBotTyping("chan-1", [AGENT]);
    const state = getAgentWorkingState(AGENT, "chan-2");
    assert.equal(state.working, false);
  });

  it("typing clears when re-reported empty", () => {
    reportChannelBotTyping("chan-1", [AGENT]);
    reportChannelBotTyping("chan-1", []);
    assert.equal(getAgentWorkingState(AGENT, "chan-1").working, false);
  });

  it("preserves first-seen anchor across typing re-reports", async () => {
    reportChannelBotTyping("chan-1", [AGENT]);
    const first = getAgentWorkingState(AGENT).channels[0].anchorAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    reportChannelBotTyping("chan-1", [AGENT, AGENT_2]);
    const again = getAgentWorkingState(AGENT).channels[0].anchorAt;
    assert.equal(again, first);
  });
});

describe("getWorkingChannels", () => {
  it("merges typing-only agents into an observer channel summary", () => {
    startTurn(AGENT, "chan-1");
    reportChannelBotTyping("chan-1", [AGENT_2]);
    const channels = getWorkingChannels();
    assert.equal(channels.length, 1);
    assert.equal(channels[0].source, "observer");
    assert.equal(channels[0].agentCount, 2);
    assert.deepEqual(
      new Set(channels[0].agentPubkeys),
      new Set([AGENT, AGENT_2]),
    );
  });

  it("adds typing-only channels with a typing source", () => {
    startTurn(AGENT, "chan-1");
    reportChannelBotTyping("chan-2", [AGENT_2]);
    const channels = getWorkingChannels();
    assert.deepEqual(
      channels.map((c) => [c.channelId, c.source]),
      [
        ["chan-1", "observer"],
        ["chan-2", "typing"],
      ],
    );
  });
});

describe("getWorkingAgentPubkeysForChannel", () => {
  it("unions observer and typing agents for the channel", () => {
    startTurn(AGENT, "chan-1");
    reportChannelBotTyping("chan-1", [AGENT_2]);
    assert.deepEqual(
      new Set(getWorkingAgentPubkeysForChannel("chan-1")),
      new Set([AGENT, AGENT_2]),
    );
    assert.deepEqual(getWorkingAgentPubkeysForChannel("chan-2"), []);
    assert.deepEqual(getWorkingAgentPubkeysForChannel(null), []);
  });
});

describe("subscription and caching", () => {
  it("returns reference-stable snapshots before React subscribes", () => {
    startTurn(AGENT, "chan-1");
    assert.equal(
      getAgentWorkingState(AGENT, "chan-1"),
      getAgentWorkingState(AGENT, "chan-1"),
    );
    assert.equal(getWorkingChannels(), getWorkingChannels());
    assert.equal(
      getWorkingAgentPubkeysForChannel("chan-1"),
      getWorkingAgentPubkeysForChannel("chan-1"),
    );
  });

  it("returns reference-stable snapshots while subscribed", () => {
    startTurn(AGENT, "chan-1");
    const unsubscribe = subscribeAgentWorkingSignal(() => {});
    try {
      assert.equal(
        getAgentWorkingState(AGENT, "chan-1"),
        getAgentWorkingState(AGENT, "chan-1"),
      );
      assert.equal(getWorkingChannels(), getWorkingChannels());
      assert.equal(
        getWorkingAgentPubkeysForChannel("chan-1"),
        getWorkingAgentPubkeysForChannel("chan-1"),
      );
    } finally {
      unsubscribe();
    }
  });

  it("notifies on typing changes but not on identical re-reports", () => {
    let notified = 0;
    const unsubscribe = subscribeAgentWorkingSignal(() => {
      notified += 1;
    });
    try {
      reportChannelBotTyping("chan-1", [AGENT]);
      assert.equal(notified, 1);
      reportChannelBotTyping("chan-1", [AGENT]);
      assert.equal(notified, 1);
      reportChannelBotTyping("chan-1", []);
      assert.equal(notified, 2);
    } finally {
      unsubscribe();
    }
  });

  it("invalidates snapshots when the turns store changes", () => {
    const unsubscribe = subscribeAgentWorkingSignal(() => {});
    try {
      const before = getAgentWorkingState(AGENT, "chan-1");
      assert.equal(before.working, false);
      startTurn(AGENT, "chan-1");
      const after = getAgentWorkingState(AGENT, "chan-1");
      assert.equal(after.working, true);
      assert.equal(after.source, "observer");
    } finally {
      unsubscribe();
    }
  });

  it("resetAgentWorkingSignal clears typing state", () => {
    reportChannelBotTyping("chan-1", [AGENT]);
    resetAgentWorkingSignal();
    assert.equal(getAgentWorkingState(AGENT, "chan-1").working, false);
  });
});

function errorEvent(overrides) {
  return makeEvent({
    kind: "turn_error",
    seq: 2_000_000_000,
    timestamp: new Date(Date.now() + 1).toISOString(),
    ...overrides,
  });
}

describe("getWorkingAgentsForChannel", () => {
  it("is empty without a channel or work", () => {
    assert.deepEqual(getWorkingAgentsForChannel(null), []);
    assert.deepEqual(getWorkingAgentsForChannel("chan-1"), []);
  });

  it("lists each working agent once, oldest anchor first", () => {
    startTurn(AGENT_2, "chan-1");
    startTurn(AGENT, "chan-1");
    startTurn(AGENT, "chan-2");
    const agents = getWorkingAgentsForChannel("chan-1");
    assert.deepEqual(
      new Set(agents.map((agent) => agent.pubkey)),
      new Set([AGENT, AGENT_2]),
    );
    assert.ok(agents.every((agent) => agent.source === "observer"));
    assert.ok(agents[0].anchorAt <= agents[1].anchorAt);
  });

  it("falls back to channel typing and prefers the observer anchor", () => {
    reportChannelBotTyping("chan-1", [AGENT, AGENT_2]);
    startTurn(AGENT, "chan-1");
    const byAgent = new Map(
      getWorkingAgentsForChannel("chan-1").map((a) => [a.pubkey, a]),
    );
    assert.equal(byAgent.get(AGENT)?.source, "observer");
    assert.equal(byAgent.get(AGENT_2)?.source, "typing");
  });

  it("is reference-stable until the signal changes", () => {
    const unsubscribe = subscribeAgentWorkingSignal(() => {});
    try {
      startTurn(AGENT, "chan-1");
      const first = getWorkingAgentsForChannel("chan-1");
      assert.equal(getWorkingAgentsForChannel("chan-1"), first);
      startTurn(AGENT_2, "chan-1");
      assert.notEqual(getWorkingAgentsForChannel("chan-1"), first);
    } finally {
      unsubscribe();
    }
  });
});

describe("getTurnErrorsForChannel", () => {
  it("reports a fresh turn error in its own channel only", () => {
    startTurn(AGENT, "chan-1", "t1");
    syncAgentTurnsFromEvents(AGENT, [
      errorEvent({ channelId: "chan-1", turnId: "t1" }),
    ]);
    assert.equal(getWorkingAgentsForChannel("chan-1").length, 0);
    const errors = getTurnErrorsForChannel("chan-1");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].pubkey, AGENT);
    assert.deepEqual(getTurnErrorsForChannel("chan-2"), []);
  });

  it("does not report a clean completion", () => {
    startTurn(AGENT, "chan-1", "t1");
    syncAgentTurnsFromEvents(AGENT, [
      errorEvent({ kind: "turn_completed", channelId: "chan-1", turnId: "t1" }),
    ]);
    assert.equal(getWorkingAgentsForChannel("chan-1").length, 0);
    assert.deepEqual(getTurnErrorsForChannel("chan-1"), []);
  });

  it("ignores an old error replayed from history", () => {
    syncAgentTurnsFromEvents(AGENT, [
      errorEvent({
        channelId: "chan-1",
        turnId: "t1",
        timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
      }),
    ]);
    assert.deepEqual(getTurnErrorsForChannel("chan-1"), []);
  });

  it("clears the error when the agent starts a new turn there", () => {
    const unsubscribe = subscribeAgentWorkingSignal(() => {});
    try {
      syncAgentTurnsFromEvents(AGENT, [
        errorEvent({ channelId: "chan-1", turnId: "t1", seq: 1 }),
      ]);
      assert.equal(getTurnErrorsForChannel("chan-1").length, 1);
      syncAgentTurnsFromEvents(AGENT, [
        makeEvent({
          channelId: "chan-1",
          turnId: "t2",
          seq: 3_000_000_000,
          timestamp: new Date(Date.now() + 2).toISOString(),
        }),
      ]);
      assert.deepEqual(getTurnErrorsForChannel("chan-1"), []);
      assert.equal(getWorkingAgentsForChannel("chan-1").length, 1);
    } finally {
      unsubscribe();
    }
  });

  it("maps a channel-less panic onto the channels the agent was working in", () => {
    startTurn(AGENT, "chan-1", "t1");
    startTurn(AGENT, "chan-2", "t2");
    syncAgentTurnsFromEvents(AGENT, [
      errorEvent({ kind: "agent_panic", channelId: null, turnId: null }),
    ]);
    assert.equal(getTurnErrorsForChannel("chan-1").length, 1);
    assert.equal(getTurnErrorsForChannel("chan-2").length, 1);
  });

  it("notifies subscribers when an error lands", () => {
    let notified = 0;
    const unsubscribe = subscribeAgentWorkingSignal(() => {
      notified += 1;
    });
    try {
      syncAgentTurnsFromEvents(AGENT, [
        errorEvent({ channelId: "chan-1", turnId: "t1" }),
      ]);
      assert.ok(notified >= 1);
      assert.equal(getTurnErrorsForChannel("chan-1").length, 1);
    } finally {
      unsubscribe();
    }
  });

  it("is cleared by the turns store reset", () => {
    syncAgentTurnsFromEvents(AGENT, [
      errorEvent({ channelId: "chan-1", turnId: "t1" }),
    ]);
    resetActiveAgentTurnsStore();
    resetAgentWorkingSignal();
    assert.deepEqual(getTurnErrorsForChannel("chan-1"), []);
  });
});
