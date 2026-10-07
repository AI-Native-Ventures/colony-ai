import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentsInChannel,
  memoryTitle,
  resolveKnowledgeView,
  sortDocuments,
  toKnowledgeDocument,
} from "./workAreaKnowledgeModel.ts";

const CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);
const OUTSIDER = "c".repeat(64);

const ok = (data) => ({ status: "success", error: null, data });
const pending = { status: "pending", error: null, data: undefined };
const failed = (error = new Error("x")) => ({
  status: "error",
  error,
  data: undefined,
});
const channel = (overrides = {}) => ({
  id: CHANNEL,
  channelType: "stream",
  isMember: true,
  archivedAt: null,
  ...overrides,
});
const entry = (slug, body = "Body", createdAt = 100) => ({
  slug,
  body,
  eventId: `e-${slug}`,
  createdAt,
  outgoingRefs: [],
});
const listing = (core, memories = [], truncated = false) => ({
  core,
  memories,
  truncated,
});

const managed = [
  { pubkey: BOB, name: "Bob" },
  { pubkey: ALICE, name: "Alice" },
  { pubkey: OUTSIDER, name: "Not here" },
];

const base = (overrides = {}) => ({
  channelId: CHANNEL,
  channels: ok([channel()]),
  members: ok([{ pubkey: ALICE }, { pubkey: BOB.toUpperCase() }]),
  managedAgents: ok(managed),
  memory: [
    ok(listing(null, [entry("mem/a")])),
    ok(listing(null, [entry("mem/b")])),
  ],
  ...overrides,
});

test("every state of the Knowledge tab is decided by one table", () => {
  const cases = [
    ["channels loading", base({ channels: pending }), "loading"],
    ["channels failed", base({ channels: failed() }), "failed"],
    [
      "not a member",
      base({ channels: ok([channel({ isMember: false })]) }),
      "denied",
    ],
    ["members loading", base({ members: pending }), "loading"],
    ["members failed", base({ members: failed() }), "failed"],
    ["managed agents loading", base({ managedAgents: pending }), "loading"],
    ["managed agents failed", base({ managedAgents: failed() }), "failed"],
    [
      "none of my agents are here",
      base({
        members: ok([{ pubkey: OUTSIDER.replace("c", "d") }]),
        memory: [],
      }),
      "no-agents",
    ],
    [
      "memory still loading",
      base({ memory: [pending, ok(listing(null, [entry("mem/b")]))] }),
      "loading",
    ],
    [
      "every memory read failed",
      base({ memory: [failed(), failed()] }),
      "failed",
    ],
    [
      "agents here, nothing written down",
      base({ memory: [ok(listing(null)), ok(listing(null))] }),
      "empty",
    ],
    ["memory to show", base(), "ready"],
    [
      "one read failed, one worked",
      base({ memory: [failed(), ok(listing(null, [entry("mem/b")]))] }),
      "ready",
    ],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(resolveKnowledgeView(input).state, expected, name);
  }
});

test("channel membership outranks every data failure", () => {
  const view = resolveKnowledgeView(
    base({
      channels: ok([channel({ isMember: false })]),
      members: failed(),
      managedAgents: failed(),
    }),
  );
  assert.equal(view.state, "denied");
});

test("only managed agents that are members are listed, by name", () => {
  const agents = agentsInChannel(managed, [
    { pubkey: ALICE },
    { pubkey: BOB.toUpperCase() },
  ]);
  assert.deepEqual(
    agents.map((agent) => agent.name),
    ["Alice", "Bob"],
  );
});

test("memory is attributed to the agent it came from, in agent order", () => {
  const view = resolveKnowledgeView(
    base({
      memory: [
        ok(listing(null, [entry("mem/alices-note")])),
        ok(listing(null, [entry("mem/bobs-note")])),
      ],
    }),
  );
  assert.equal(view.state, "ready");
  assert.deepEqual(
    view.groups.map((group) => [group.agent.name, group.documents[0].slug]),
    [
      ["Alice", "mem/alices-note"],
      ["Bob", "mem/bobs-note"],
    ],
  );
});

test("a memory list that does not line up with the agents is never shown", () => {
  const view = resolveKnowledgeView(
    base({ memory: [ok(listing(null, [entry("mem/a")]))] }),
  );
  assert.equal(view.state, "loading");
});

test("a failed read is reported per agent without hiding the others", () => {
  const view = resolveKnowledgeView(
    base({ memory: [failed(), ok(listing(null, [entry("mem/b")]))] }),
  );
  assert.equal(view.state, "ready");
  assert.deepEqual(
    view.unavailable.map((agent) => agent.name),
    ["Alice"],
  );
  assert.deepEqual(
    view.groups.map((group) => group.agent.name),
    ["Bob"],
  );
});

test("the relay's truncation flag is carried so the tab can say so", () => {
  const view = resolveKnowledgeView(
    base({
      memory: [
        ok(listing(null, [entry("mem/a")], true)),
        ok(listing(null, [entry("mem/b")], false)),
      ],
    }),
  );
  assert.deepEqual(
    view.groups.map((group) => group.truncated),
    [true, false],
  );
});

test("the core profile comes first, then newest, then by slug", () => {
  const documents = ["mem/old", "core", "mem/new", "mem/also-new"].map((slug) =>
    toKnowledgeDocument(ALICE, {
      ...entry(slug),
      createdAt: slug === "mem/old" ? 10 : slug === "core" ? 5 : 50,
    }),
  );
  assert.deepEqual(
    sortDocuments(documents).map((doc) => doc.slug),
    ["core", "mem/also-new", "mem/new", "mem/old"],
  );
});

test("titles and previews read like words, not slugs", () => {
  assert.equal(memoryTitle("core"), "Core profile");
  assert.equal(memoryTitle("mem/preferences/ui-density"), "Ui density");
  assert.equal(memoryTitle("mem/people/alice_smith"), "Alice smith");
  const doc = toKnowledgeDocument(
    ALICE,
    entry("mem/x", `\n\n  First real line  \nSecond line`),
  );
  assert.equal(doc.preview, "First real line");
  assert.equal(doc.key, `${ALICE}:mem/x`);
  const long = toKnowledgeDocument(ALICE, entry("mem/y", "w".repeat(500)));
  assert.equal(long.preview.length, 140);
  assert.ok(long.preview.endsWith("…"));
});
