import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findUnansweredMentions, threadHeadOf } from "./unansweredMentions.ts";

const SCOUT =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
const ME = "1111111111111111111111111111111111111111111111111111111111111111";
const OTHER =
  "2222222222222222222222222222222222222222222222222222222222222222";
const WELCOME = "channel-welcome";
// 26 Oct 2026, the GATE-303 timeline.
const NOW = 1_792_997_700;
const FIRST = 1_792_997_470; // 06:51:10Z "are you there?"
const SECOND = 1_792_997_600; // 06:53:20Z the owner's second mention

const mention = (id, createdAt, extra = {}) => ({
  id,
  pubkey: extra.pubkey ?? ME,
  created_at: createdAt,
  kind: 9,
  content: "@Scout hi",
  sig: "s",
  tags: [["h", WELCOME], ["p", extra.p ?? SCOUT], ...(extra.tags ?? [])],
});
const answer = (kind, forId, extra = {}) => ({
  id: `answer-${forId}-${kind}`,
  pubkey: extra.pubkey ?? SCOUT,
  created_at: extra.createdAt ?? FIRST + 5,
  kind,
  content: kind === 7 ? "👀" : "hello",
  sig: "s",
  tags: [
    ["h", WELCOME],
    ["e", forId],
    ["p", ME],
  ],
});

/** A relay holding `events`: answers the two reads the finder makes. */
function relay(events, calls = []) {
  return async (filter) => {
    calls.push(filter);
    return events.filter((event) => {
      if (!filter.kinds.includes(event.kind)) return false;
      if (filter.authors && !filter.authors.includes(event.pubkey))
        return false;
      if (
        filter["#p"] &&
        !event.tags.some((t) => t[0] === "p" && filter["#p"].includes(t[1]))
      )
        return false;
      if (
        filter["#e"] &&
        !event.tags.some((t) => t[0] === "e" && filter["#e"].includes(t[1]))
      )
        return false;
      return event.created_at >= (filter.since ?? 0);
    });
  };
}

const find = (events, overrides = {}) =>
  findUnansweredMentions({
    agentPubkey: SCOUT,
    senderPubkey: ME,
    nowSeconds: NOW,
    fetchEvents: relay(events),
    ...overrides,
  });

describe("findUnansweredMentions", () => {
  it("finds the older mention the agent never touched, behind a newer one it answered", async () => {
    // GATE-303: a27e49a5 got nothing, da14c9ca was answered.
    const events = [
      mention("a27e49a5", FIRST),
      mention("da14c9ca", SECOND),
      answer(7, "da14c9ca", { createdAt: SECOND + 1 }),
      answer(9, "da14c9ca", { createdAt: SECOND + 20 }),
    ];
    const found = await find(events);
    assert.deepEqual(found, [
      {
        id: "a27e49a5",
        createdAt: FIRST,
        channelId: WELCOME,
        threadHeadId: null,
        progress: "none",
      },
    ]);
  });

  it("does not take the seen reaction for an answer: the harness queued it, nothing more", async () => {
    // GATE-304: the first harness reacted 👀 as soon as it queued the mention
    // and was stopped before it answered. The reaction is progress, never
    // proof the person was answered.
    const events = [mention("m1", FIRST), answer(7, "m1")];
    const found = await find(events);
    assert.deepEqual(
      found.map((m) => [m.id, m.progress]),
      [["m1", "seen"]],
    );
  });

  it("tells a turn that began (💬) from one that only queued the mention (👀)", async () => {
    const events = [
      mention("queued", FIRST),
      answer(7, "queued"),
      mention("begun", FIRST + 10),
      { ...answer(7, "begun"), content: "💬", created_at: FIRST + 12 },
      { ...answer(7, "begun"), id: "seen-begun", created_at: FIRST + 11 },
    ];
    const found = await find(events);
    assert.deepEqual(
      found.map((m) => [m.id, m.progress]),
      [
        ["queued", "seen"],
        ["begun", "working"],
      ],
    );
  });

  it("an answer wins over any reaction left behind", async () => {
    const events = [
      mention("m1", FIRST),
      answer(7, "m1"),
      answer(9, "m1", { createdAt: FIRST + 20 }),
    ];
    assert.deepEqual(await find(events), []);
  });

  it("counts a reply as touched", async () => {
    const events = [mention("m1", FIRST), answer(9, "m1")];
    assert.deepEqual(await find(events), []);
  });

  it("counts an agent reply in the same thread, after the mention, as touched", async () => {
    // The mention was sent inside a thread and the agent replied to the thread
    // (its root), not to the mention's own id.
    const events = [
      mention("in-thread", FIRST, { tags: [["e", "root-1", "", "root"]] }),
      {
        ...answer(9, "root-1", { createdAt: FIRST + 8 }),
        tags: [
          ["h", WELCOME],
          ["e", "root-1", "", "root"],
          ["p", ME],
        ],
      },
    ];
    assert.deepEqual(await find(events), []);
  });

  it("does not count a reply in the thread that came before the mention", async () => {
    const events = [
      mention("in-thread", FIRST, { tags: [["e", "root-1", "", "root"]] }),
      {
        ...answer(9, "root-1", { createdAt: FIRST - 30 }),
        tags: [
          ["h", WELCOME],
          ["e", "root-1", "", "root"],
          ["p", ME],
        ],
      },
    ];
    // The relay read starts at the mention, so an earlier reply is not even
    // returned; the fake relay mirrors that through `since`.
    assert.equal((await find(events)).length, 1);
  });

  it("is oldest first", async () => {
    const events = [mention("late", SECOND), mention("early", FIRST)];
    assert.deepEqual(
      (await find(events)).map((m) => m.id),
      ["early", "late"],
    );
  });

  it("ignores answers from anyone but the agent", async () => {
    const events = [mention("m1", FIRST), answer(9, "m1", { pubkey: OTHER })];
    assert.equal((await find(events)).length, 1);
  });

  it("ignores mentions of other agents and mentions sent by other people", async () => {
    const events = [
      mention("for-nova", FIRST, { p: "3".repeat(64) }),
      mention("by-other", FIRST, { pubkey: OTHER }),
    ];
    assert.deepEqual(await find(events), []);
  });

  it("reports the thread a mention was sent in", async () => {
    const events = [
      mention("reply", FIRST, { tags: [["e", "root-1", "", "root"]] }),
    ];
    assert.equal((await find(events))[0].threadHeadId, "root-1");
  });

  it("looks no further back than asked", async () => {
    const events = [mention("old", NOW - 10_000)];
    assert.deepEqual(await find(events, { lookbackSeconds: 900 }), []);
    assert.equal((await find(events, { lookbackSeconds: 20_000 })).length, 1);
  });

  it("asks the relay for the agent's answers only when a mention exists", async () => {
    const calls = [];
    await find([], { fetchEvents: relay([], calls) });
    assert.equal(calls.length, 1);
  });

  it("rejects when the relay cannot be read: never an empty answer", async () => {
    await assert.rejects(
      find([], {
        fetchEvents: async () => {
          throw new Error("relay down");
        },
      }),
      /relay down/,
    );
  });

  it("rejects when the relay does not answer in time", async () => {
    await assert.rejects(
      find([], { fetchEvents: () => new Promise(() => {}), readTimeoutMs: 20 }),
      /timed out/,
    );
  });

  it("rejects when only the answers read fails", async () => {
    let call = 0;
    await assert.rejects(
      find([], {
        fetchEvents: async () => {
          call += 1;
          if (call === 1) return [mention("m1", FIRST)];
          throw new Error("answers unreadable");
        },
      }),
      /answers unreadable/,
    );
  });
});

describe("threadHeadOf", () => {
  it("prefers the root marker, then the reply marker, then any e tag", () => {
    const base = { tags: [] };
    assert.equal(threadHeadOf(base), null);
    assert.equal(
      threadHeadOf({
        tags: [
          ["e", "p1", "", "reply"],
          ["e", "r1", "", "root"],
        ],
      }),
      "r1",
    );
    assert.equal(threadHeadOf({ tags: [["e", "p1", "", "reply"]] }), "p1");
    assert.equal(threadHeadOf({ tags: [["e", "x"]] }), "x");
  });
});
