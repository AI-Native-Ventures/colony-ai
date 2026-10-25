import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NO_AGENT_SCOPES,
  TURN_ERROR_VISIBLE_MS,
  formatWorkingIndicatorLabel,
  latestPostedAt,
  recordAgentScopes,
  selectChannelWorkingIndicator,
  selectThreadWorkingIndicator,
  workingIndicatorAnchor,
} from "./agentWorkingIndicator.ts";

const SCOUT = "aa".repeat(32);
const NOVA = "bb".repeat(32);
const RIO = "cc".repeat(32);
const NAMES = { [SCOUT]: "Scout", [NOVA]: "Nova", [RIO]: "Rio" };
const nameOf = (pubkey) => NAMES[pubkey.toLowerCase()] ?? "Agent";
const NOW = 1_000_000;
const THREAD = "thread-head-1";

function input(overrides = {}) {
  return {
    botTyping: [],
    errors: [],
    lastScopes: NO_AGENT_SCOPES,
    nameOf,
    now: NOW,
    working: [],
    ...overrides,
  };
}

const scoutWorking = {
  pubkey: SCOUT,
  anchorAt: NOW - 12_000,
  source: "observer",
};

describe("selectChannelWorkingIndicator", () => {
  it("is hidden when nothing is working", () => {
    assert.deepEqual(selectChannelWorkingIndicator(input()), {
      kind: "hidden",
    });
  });

  it("shows a working agent with its own anchor", () => {
    const state = selectChannelWorkingIndicator(
      input({ working: [scoutWorking] }),
    );
    assert.equal(state.kind, "working");
    assert.deepEqual(state.agents, [
      { pubkey: SCOUT, name: "Scout", anchorAt: NOW - 12_000 },
    ]);
  });

  it("leaves an agent that is replying inside a thread to the thread panel", () => {
    const state = selectChannelWorkingIndicator(
      input({
        working: [scoutWorking],
        botTyping: [{ pubkey: SCOUT, threadHeadId: THREAD }],
      }),
    );
    assert.equal(state.kind, "hidden");
  });

  it("keeps an agent that also types at channel level", () => {
    const state = selectChannelWorkingIndicator(
      input({
        working: [scoutWorking],
        botTyping: [
          { pubkey: SCOUT, threadHeadId: THREAD },
          { pubkey: SCOUT, threadHeadId: null },
        ],
      }),
    );
    assert.equal(state.kind, "working");
  });

  it("shows a fresh error once the turn stopped", () => {
    const state = selectChannelWorkingIndicator(
      input({ errors: [{ pubkey: SCOUT, at: NOW - 1_000 }] }),
    );
    assert.equal(state.kind, "error");
    assert.equal(
      formatWorkingIndicatorLabel(state),
      "Scout hit a problem and stopped.",
    );
  });

  it("hides an error after it has been visible long enough", () => {
    const state = selectChannelWorkingIndicator(
      input({
        errors: [{ pubkey: SCOUT, at: NOW - TURN_ERROR_VISIBLE_MS }],
      }),
    );
    assert.equal(state.kind, "hidden");
  });

  it("does not show a lingering working turn for an agent that errored", () => {
    const state = selectChannelWorkingIndicator(
      input({
        working: [scoutWorking],
        errors: [{ pubkey: SCOUT, at: NOW - 500 }],
      }),
    );
    assert.equal(state.kind, "error");
  });

  it("keeps working agents ahead of another agent's error", () => {
    const state = selectChannelWorkingIndicator(
      input({
        working: [scoutWorking],
        errors: [{ pubkey: NOVA, at: NOW - 500 }],
      }),
    );
    assert.equal(state.kind, "working");
    assert.deepEqual(
      state.agents.map((agent) => agent.name),
      ["Scout"],
    );
  });

  it("leaves a thread error to the thread panel", () => {
    const state = selectChannelWorkingIndicator(
      input({
        errors: [{ pubkey: SCOUT, at: NOW - 500 }],
        lastScopes: new Map([[SCOUT, THREAD]]),
      }),
    );
    assert.equal(state.kind, "hidden");
  });
});

describe("a reply that has posted", () => {
  const seconds = (ms) => Math.floor(ms / 1000);

  it("ends the channel notice for that agent", () => {
    const state = selectChannelWorkingIndicator(
      input({
        working: [scoutWorking],
        posted: new Map([[SCOUT, seconds(NOW - 2_000)]]),
      }),
    );
    assert.equal(state.kind, "hidden");
  });

  it("keeps the notice when the agent's last message is from before the turn", () => {
    const state = selectChannelWorkingIndicator(
      input({
        working: [scoutWorking],
        posted: new Map([[SCOUT, seconds(NOW - 60_000)]]),
      }),
    );
    assert.equal(state.kind, "working");
  });

  it("only ends the notice for the agent that replied", () => {
    const state = selectChannelWorkingIndicator(
      input({
        working: [
          scoutWorking,
          { pubkey: NOVA, anchorAt: NOW - 12_000, source: "observer" },
        ],
        posted: new Map([[SCOUT, seconds(NOW - 2_000)]]),
      }),
    );
    assert.deepEqual(
      state.agents.map((agent) => agent.name),
      ["Nova"],
    );
  });

  it("counts a reply posted in the same second the turn began", () => {
    const anchorAt = 1_700_000_000_400;
    const state = selectChannelWorkingIndicator(
      input({
        working: [{ pubkey: SCOUT, anchorAt, source: "observer" }],
        posted: new Map([[SCOUT, 1_700_000_000]]),
      }),
    );
    assert.equal(state.kind, "hidden");
  });

  it("ends the thread notice", () => {
    const state = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        botTyping: [
          { pubkey: SCOUT, threadHeadId: THREAD, firstSeenAt: NOW - 5_000 },
        ],
        posted: new Map([[SCOUT, seconds(NOW - 1_000)]]),
      }),
    );
    assert.equal(state.kind, "hidden");
  });

  it("finds the latest message per watched agent only", () => {
    const posted = latestPostedAt(
      [
        { pubkey: SCOUT.toUpperCase(), createdAt: 10 },
        { pubkey: SCOUT, createdAt: 30 },
        { pubkey: SCOUT, createdAt: 20 },
        { pubkey: NOVA, createdAt: 99 },
        { createdAt: 5 },
      ],
      new Set([SCOUT]),
    );
    assert.deepEqual([...posted], [[SCOUT, 30]]);
  });
});

describe("selectThreadWorkingIndicator", () => {
  it("is hidden without an open thread", () => {
    const state = selectThreadWorkingIndicator(
      input({
        threadHeadId: null,
        botTyping: [{ pubkey: SCOUT, threadHeadId: THREAD }],
      }),
    );
    assert.equal(state.kind, "hidden");
  });

  it("shows only agents typing in the open thread", () => {
    const state = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        botTyping: [
          { pubkey: SCOUT, threadHeadId: THREAD },
          { pubkey: NOVA, threadHeadId: "other-thread" },
          { pubkey: RIO, threadHeadId: null },
        ],
      }),
    );
    assert.equal(state.kind, "working");
    assert.deepEqual(
      state.agents.map((agent) => agent.name),
      ["Scout"],
    );
  });

  it("prefers the turn start over the first typing time for the anchor", () => {
    const state = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        working: [scoutWorking],
        botTyping: [
          { pubkey: SCOUT, threadHeadId: THREAD, firstSeenAt: NOW - 2_000 },
        ],
      }),
    );
    assert.equal(state.agents[0].anchorAt, NOW - 12_000);
  });

  it("falls back to first typing, then to now", () => {
    const typed = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        botTyping: [
          { pubkey: SCOUT, threadHeadId: THREAD, firstSeenAt: NOW - 2_000 },
        ],
      }),
    );
    assert.equal(typed.agents[0].anchorAt, NOW - 2_000);
    const bare = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        botTyping: [{ pubkey: SCOUT, threadHeadId: THREAD }],
      }),
    );
    assert.equal(bare.agents[0].anchorAt, NOW);
  });

  it("shows an error for an agent last seen in this thread, even after typing lapsed", () => {
    const state = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        errors: [{ pubkey: SCOUT, at: NOW - 3_000 }],
        lastScopes: new Map([[SCOUT, THREAD]]),
      }),
    );
    assert.equal(state.kind, "error");
  });

  it("drops the stale typing entry once the turn errored", () => {
    const state = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        botTyping: [{ pubkey: SCOUT, threadHeadId: THREAD }],
        errors: [{ pubkey: SCOUT, at: NOW - 500 }],
        lastScopes: new Map([[SCOUT, THREAD]]),
      }),
    );
    assert.equal(state.kind, "error");
  });

  it("ignores an error from another scope", () => {
    const state = selectThreadWorkingIndicator(
      input({
        threadHeadId: THREAD,
        errors: [{ pubkey: SCOUT, at: NOW - 500 }],
        lastScopes: new Map([[SCOUT, null]]),
      }),
    );
    assert.equal(state.kind, "hidden");
  });
});

describe("recordAgentScopes", () => {
  it("returns the same map when nothing changed", () => {
    const first = recordAgentScopes(NO_AGENT_SCOPES, [
      { pubkey: SCOUT.toUpperCase(), threadHeadId: THREAD },
    ]);
    assert.equal(first.get(SCOUT), THREAD);
    const again = recordAgentScopes(first, [
      { pubkey: SCOUT, threadHeadId: THREAD },
    ]);
    assert.equal(again, first);
  });

  it("lets channel typing outrank thread typing for one agent", () => {
    const scopes = recordAgentScopes(NO_AGENT_SCOPES, [
      { pubkey: SCOUT, threadHeadId: THREAD },
      { pubkey: SCOUT, threadHeadId: null },
    ]);
    assert.equal(scopes.get(SCOUT), null);
  });
});

describe("labels and timer anchor", () => {
  const agent = (pubkey, anchorAt = NOW) => ({
    pubkey,
    name: nameOf(pubkey),
    anchorAt,
  });

  it("words one, two and many agents plainly", () => {
    assert.equal(
      formatWorkingIndicatorLabel({ kind: "working", agents: [agent(SCOUT)] }),
      "Scout is working…",
    );
    assert.equal(
      formatWorkingIndicatorLabel({
        kind: "working",
        agents: [agent(SCOUT), agent(NOVA)],
      }),
      "Scout and Nova are working…",
    );
    assert.equal(
      formatWorkingIndicatorLabel({
        kind: "working",
        agents: [agent(SCOUT), agent(NOVA), agent(RIO)],
      }),
      "Scout, Nova and 1 more are working…",
    );
    assert.equal(formatWorkingIndicatorLabel({ kind: "hidden" }), "");
  });

  it("never uses an em dash", () => {
    const text = formatWorkingIndicatorLabel({
      kind: "error",
      agents: [agent(SCOUT), agent(NOVA)],
    });
    assert.ok(!text.includes(String.fromCharCode(0x2014)));
  });

  it("anchors the timer to the earliest start", () => {
    assert.equal(
      workingIndicatorAnchor({
        kind: "working",
        agents: [agent(SCOUT, 50), agent(NOVA, 20)],
      }),
      20,
    );
    assert.equal(workingIndicatorAnchor({ kind: "hidden" }), null);
    assert.equal(
      workingIndicatorAnchor({ kind: "error", agents: [agent(SCOUT)] }),
      null,
    );
  });
});
