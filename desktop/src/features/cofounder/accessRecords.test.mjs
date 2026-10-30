import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { applyMockAccessAction } from "../../testing/mockCompanyAccess.ts";
import {
  KIND_COMPANY_ACCESS_HEAD,
  accessDTag,
  buildAccessActionEvent,
  buildAccessRows,
  buildGapNeedsYouItems,
  capabilityGapDTag,
  parseAccessHead,
  parseCapabilityGapHead,
  parseSlotHireHead,
  slotHireDTag,
} from "./accessRecords.ts";
import { buildFunctionSlotViews } from "./functions.ts";

const RELAY_SECRET = generateSecretKey();
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const OWNER = "a".repeat(64);
const AGENT = "b".repeat(64);
const GAP_ID = "22222222-2222-4222-8222-222222222222";
const HIRE_ID = "33333333-3333-4333-8333-333333333333";

const entry = {
  name: "E-sign, free plan",
  category: "esign",
  usedFor: "Agreements to sign",
  cost: "Free, 3 a month",
};

function gap(overrides = {}) {
  return {
    title: "Sign up for a free e-sign tool",
    need: "So clients can sign agreements in Colony.",
    options: [
      {
        name: "Free sign",
        costText: "Free",
        costCents: 0,
        recurring: false,
        works: true,
      },
    ],
    chosen: 0,
    humanStep: "Choose a password, then tell me.",
    pageUrl: "https://example.com/signup",
    accessId: "esign",
    access: entry,
    ...overrides,
  };
}

function sign(content, dTag, { secret = RELAY_SECRET } = {}) {
  return finalizeEvent(
    {
      kind: KIND_COMPANY_ACCESS_HEAD,
      content: JSON.stringify(content),
      tags: [["d", dTag]],
      created_at: 1_700_000_000,
    },
    secret,
  );
}

function accessContent(overrides = {}) {
  return {
    schemaVersion: 1,
    accessId: "esign",
    entry,
    state: "active",
    grantedByPubkey: OWNER,
    grantedAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function gapContent(overrides = {}) {
  return {
    schemaVersion: 1,
    gapId: GAP_ID,
    gap: gap(),
    state: "proposed",
    proposedByPubkey: AGENT,
    proposedAt: 5,
    updatedAt: 5,
    ...overrides,
  };
}

test("an access head parses only when relay signed and exactly shaped", () => {
  const head = parseAccessHead(
    sign(accessContent(), accessDTag("esign")),
    RELAY_PUBKEY,
  );
  assert.equal(head?.accessId, "esign");
  assert.equal(head?.state, "active");
  assert.deepEqual(head?.entry.agents, []);

  const stranger = sign(accessContent(), accessDTag("esign"), {
    secret: generateSecretKey(),
  });
  assert.equal(parseAccessHead(stranger, RELAY_PUBKEY), null);
  assert.equal(
    parseAccessHead(
      sign(accessContent({ surprise: 1 }), accessDTag("esign")),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseAccessHead(
      sign(accessContent(), accessDTag("someone-else")),
      RELAY_PUBKEY,
    ),
    null,
  );
  // A revoked head must name who revoked it.
  assert.equal(
    parseAccessHead(
      sign(accessContent({ state: "revoked" }), accessDTag("esign")),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("a gap head and a slot hire head parse from the same kind", () => {
  const parsedGap = parseCapabilityGapHead(
    sign(gapContent(), capabilityGapDTag(GAP_ID)),
    RELAY_PUBKEY,
  );
  assert.equal(parsedGap?.gapId, GAP_ID);
  assert.equal(parsedGap?.gap.pageUrl, "https://example.com/signup");
  // An access parser refuses a gap and the other way round.
  assert.equal(
    parseAccessHead(
      sign(gapContent(), capabilityGapDTag(GAP_ID)),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCapabilityGapHead(
      sign(accessContent(), accessDTag("esign")),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCapabilityGapHead(
      sign(
        gapContent({ gap: gap({ pageUrl: "http://example.com" }) }),
        capabilityGapDTag(GAP_ID),
      ),
      RELAY_PUBKEY,
    ),
    null,
    "only https pages open in the browser",
  );
  const slot = parseSlotHireHead(
    sign(
      {
        schemaVersion: 1,
        hireId: HIRE_ID,
        function: "finance",
        setByPubkey: AGENT,
        updatedAt: 1,
      },
      slotHireDTag(HIRE_ID),
    ),
    RELAY_PUBKEY,
  );
  assert.deepEqual(
    { hireId: slot?.hireId, functionId: slot?.functionId },
    { hireId: HIRE_ID, functionId: "finance" },
  );
});

test("the access list always shows the Colony-run tools and honours a revoke", () => {
  assert.deepEqual(
    buildAccessRows([]).map((row) => [row.accessId, row.state, row.builtin]),
    [
      ["whatsapp", "active", true],
      ["discovery", "active", true],
      ["credits", "active", true],
    ],
  );
  const revokedDiscovery = parseAccessHead(
    sign(
      accessContent({
        accessId: "discovery",
        entry: { ...entry, category: "discovery", name: "Discovery" },
        state: "revoked",
        revokedByPubkey: OWNER,
        revokedAt: 2,
      }),
      accessDTag("discovery"),
    ),
    RELAY_PUBKEY,
  );
  const esign = parseAccessHead(
    sign(accessContent(), accessDTag("esign")),
    RELAY_PUBKEY,
  );
  const rows = buildAccessRows([esign, revokedDiscovery]);
  assert.deepEqual(
    rows.map((row) => [row.accessId, row.state]),
    [
      ["whatsapp", "active"],
      ["discovery", "revoked"],
      ["credits", "active"],
      ["esign", "active"],
    ],
  );
});

test("a proposed gap needs approval, an approved gap is a do item, the rest are hidden", () => {
  const head = (state, id, proposedAt) =>
    parseCapabilityGapHead(
      sign(
        gapContent({
          gapId: id,
          state,
          proposedAt,
          ...(state === "approved"
            ? {
                approvedByPubkey: OWNER,
                approvedAt: 6,
                approvedCostCents: 0,
              }
            : {}),
        }),
        capabilityGapDTag(id),
      ),
      RELAY_PUBKEY,
    );
  const ids = [
    "44444444-4444-4444-8444-444444444441",
    "44444444-4444-4444-8444-444444444442",
    "44444444-4444-4444-8444-444444444443",
  ];
  const items = buildGapNeedsYouItems([
    head("proposed", ids[0], 1),
    head("approved", ids[1], 2),
    head("declined", ids[2], 3),
  ]);
  assert.deepEqual(
    items.map((item) => [item.gapId, item.group, item.free]),
    [
      [ids[1], "do", true],
      [ids[0], "approve", true],
    ],
  );
  assert.equal(items[0].pageUrl, "https://example.com/signup");
});

test("action events tag the record they change", () => {
  const revoke = buildAccessActionEvent({
    op: "revoke",
    accessId: "whatsapp",
    reason: "paused",
    expectedHeadEventId: null,
  });
  assert.deepEqual(revoke.tags, [["d", "company:access:whatsapp"]]);
  assert.deepEqual(JSON.parse(revoke.content), {
    schemaVersion: 1,
    op: "revoke",
    accessId: "whatsapp",
    reason: "paused",
  });
  const approve = buildAccessActionEvent({
    op: "gap_approve",
    gapId: GAP_ID,
    expectedHeadEventId: "c".repeat(64),
  });
  assert.deepEqual(approve.tags, [["d", `company:capgap:${GAP_ID}`]]);
  assert.equal(JSON.parse(approve.content).expectedHeadEventId, "c".repeat(64));
  const slot = buildAccessActionEvent({
    op: "slot_hire_set",
    hireId: HIRE_ID,
    functionId: "finance",
    expectedHeadEventId: null,
  });
  assert.deepEqual(slot.tags, [["d", `company:slot-hire:${HIRE_ID}`]]);
  assert.equal(JSON.parse(slot.content).function, "finance");
});

test("the mock relay revokes a built-in tool and refuses a member", () => {
  const records = [];
  const revoke = JSON.stringify({
    schemaVersion: 1,
    op: "revoke",
    accessId: "whatsapp",
  });
  assert.match(
    applyMockAccessAction(records, revoke, AGENT, "member", 10),
    /only the owner or an admin/,
  );
  assert.equal(records.length, 0);
  assert.equal(
    applyMockAccessAction(records, revoke, OWNER, "owner", 10),
    null,
  );
  assert.equal(records[0].dTag, "company:access:whatsapp");
  assert.equal(records[0].content.state, "revoked");
  assert.match(
    applyMockAccessAction(records, revoke, OWNER, "owner", 11),
    /already revoked/,
  );
});

test("the mock gap flow needs approval and the human step before it creates access", () => {
  const records = [];
  const act = (op, actor, role, extra = {}) =>
    applyMockAccessAction(
      records,
      JSON.stringify({ schemaVersion: 1, op, gapId: GAP_ID, ...extra }),
      actor,
      role,
      20,
    );
  assert.equal(act("gap_propose", AGENT, "member", { gap: gap() }), null);
  // The agent cannot skip the owner.
  assert.match(
    act("gap_approve", AGENT, "member"),
    /only the owner or an admin/,
  );
  assert.match(
    act("gap_complete", AGENT, "member"),
    /approval and the human step/,
  );
  assert.equal(act("gap_approve", OWNER, "owner"), null);
  assert.match(
    act("gap_complete", AGENT, "member"),
    /approval and the human step/,
  );
  assert.equal(act("gap_done", OWNER, "owner"), null);
  assert.equal(act("gap_complete", AGENT, "member"), null);
  const access = records.find(
    (record) => record.dTag === "company:access:esign",
  );
  assert.equal(access?.content.state, "active");
  assert.equal(access?.content.viaGapId, GAP_ID);
});

test("a paused, terminated or departed lead leaves the slot empty", () => {
  const head = {
    functionId: "sales",
    state: "filled",
    leadPubkey: AGENT,
    eventId: "d".repeat(64),
  };
  const member = (status) => ({
    pubkey: AGENT,
    position: { head: { status } },
  });
  const slot = (members) => buildFunctionSlotViews([head], members)[0];
  assert.equal(slot([member("active")]).state, "filled");
  assert.equal(slot([member("paused")]).state, "empty");
  assert.equal(slot([member("terminated")]).state, "empty");
  assert.equal(slot([]).state, "empty");
});
