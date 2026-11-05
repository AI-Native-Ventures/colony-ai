import assert from "node:assert/strict";
import test from "node:test";

const {
  buildDiscoveryCampaignCreateAction,
  buildOutreachListCreateAction,
  buildOutreachListMutation,
  outreachListDTag,
  parseOutreachListHead,
} = await import("./outreachRecords.ts");

const COMMUNITY = "e2e-tenant";
const CHANNEL = "e2e-sales-channel";
const LIST_ID = "9bb3be2c-4faa-4114-9b2d-d2ad6bd09b88";

function event(content, { kind = 30684, tags } = {}) {
  return {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    kind,
    content: JSON.stringify(content),
    created_at: 1,
    tags: tags ?? [
      ["h", CHANNEL],
      ["d", outreachListDTag(COMMUNITY, LIST_ID)],
    ],
    sig: "c".repeat(128),
  };
}

test("outreach list parser accepts a relay head scoped to the Sales channel", () => {
  const head = {
    schemaVersion: 1,
    listId: LIST_ID,
    name: "Melville guesthouses, Nov",
    note: null,
    status: "active",
    source: { kind: "manual", campaignId: null },
    defaultTemplate: null,
    members: [
      {
        leadId: "0d13a579-215f-4c87-9f4d-646bdded3397",
        addedBy: "d".repeat(64),
        addedByAgent: false,
        addedAt: 1_762_000_000,
      },
    ],
    createdBy: "d".repeat(64),
    createdByAgent: false,
    createdAt: 1_762_000_000,
    updatedBy: "d".repeat(64),
    updatedAt: 1_762_000_000,
    sourceActionEventId: "e".repeat(64),
  };

  assert.deepEqual(parseOutreachListHead(event(head), COMMUNITY, CHANNEL), {
    eventId: "a".repeat(64),
    dTag: outreachListDTag(COMMUNITY, LIST_ID),
    record: head,
  });
});

test("outreach list parser rejects a head from another channel or d-tag", () => {
  const head = {
    schemaVersion: 1,
    listId: LIST_ID,
    name: "A list",
    note: null,
    status: "active",
    source: { kind: "manual", campaignId: null },
    defaultTemplate: null,
    members: [],
    createdBy: "d".repeat(64),
    createdByAgent: false,
    createdAt: 1,
    updatedBy: "d".repeat(64),
    updatedAt: 1,
    sourceActionEventId: "e".repeat(64),
  };

  assert.equal(
    parseOutreachListHead(
      event(head, {
        tags: [
          ["h", "other-channel"],
          ["d", outreachListDTag(COMMUNITY, LIST_ID)],
        ],
      }),
      COMMUNITY,
      CHANNEL,
    ),
    null,
  );
  assert.equal(
    parseOutreachListHead(
      event(head, {
        tags: [
          ["h", CHANNEL],
          ["d", outreachListDTag(COMMUNITY, "other-id")],
        ],
      }),
      COMMUNITY,
      CHANNEL,
    ),
    null,
  );
});

test("list create action trims names, deduplicates lead ids, and omits the head fence", () => {
  const leadA = "0d13a579-215f-4c87-9f4d-646bdded3397";
  const leadB = "e2d2b4a7-fb2c-413e-a99b-4bd5bf247a86";
  assert.deepEqual(
    buildOutreachListCreateAction({
      listId: LIST_ID,
      name: "  Melville guesthouses, Nov  ",
      source: {
        kind: "campaign",
        campaignId: "18e47754-1cb4-4d04-a0b2-fd5ac6a90c48",
      },
      leadIds: [leadA, leadB, leadA],
    }),
    {
      schemaVersion: 1,
      listId: LIST_ID,
      op: "create",
      name: "Melville guesthouses, Nov",
      source: {
        kind: "campaign",
        campaignId: "18e47754-1cb4-4d04-a0b2-fd5ac6a90c48",
      },
      leadIds: [leadA, leadB],
    },
  );
});

test("list create action enforces the contract name and membership limits", () => {
  const base = {
    listId: LIST_ID,
    name: "Valid name",
    source: { kind: "manual" },
    leadIds: [],
  };
  assert.throws(() => buildOutreachListCreateAction({ ...base, name: "  " }));
  assert.throws(() =>
    buildOutreachListCreateAction({
      ...base,
      leadIds: Array.from(
        { length: 501 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    }),
  );
});

test("list mutations carry one operation and an optional exact head fence", () => {
  const action = buildOutreachListMutation({
    listId: LIST_ID,
    expectedHeadEventId: "f".repeat(64),
    op: "add_members",
    leadIds: ["0d13a579-215f-4c87-9f4d-646bdded3397"],
  });
  assert.deepEqual(action, {
    schemaVersion: 1,
    listId: LIST_ID,
    op: "add_members",
    expectedHeadEventId: "f".repeat(64),
    leadIds: ["0d13a579-215f-4c87-9f4d-646bdded3397"],
  });
  assert.deepEqual(
    buildOutreachListMutation({
      listId: LIST_ID,
      op: "set_default_template",
    }),
    {
      schemaVersion: 1,
      listId: LIST_ID,
      op: "set_default_template",
    },
  );
  assert.throws(() =>
    buildOutreachListMutation({ listId: LIST_ID, op: "rename" }),
  );
});

test("campaign backfill create keeps the campaign id and maps final progress", () => {
  assert.deepEqual(
    buildDiscoveryCampaignCreateAction({
      campaignId: "18e47754-1cb4-4d04-a0b2-fd5ac6a90c48",
      name: "Restaurants prospects, Johannesburg",
      audience: "businesses",
      industryName: "Food and drink",
      verticalId: "restaurants",
      verticalName: "Restaurants",
      pickedTags: ["fine dining", "fine dining"],
      area: "Johannesburg, South Africa",
      target: 50,
      found: 12,
      skippedDuplicates: 3,
      status: "complete",
      endNote: "Search finished",
      runBy: { kind: "person", pubkey: "d".repeat(64) },
    }),
    {
      schemaVersion: 1,
      campaignId: "18e47754-1cb4-4d04-a0b2-fd5ac6a90c48",
      op: "create",
      name: "Restaurants prospects, Johannesburg",
      audience: "businesses",
      industryName: "Food and drink",
      verticalId: "restaurants",
      verticalName: "Restaurants",
      pickedTags: ["fine dining"],
      area: "Johannesburg, South Africa",
      target: 50,
      found: 12,
      skippedDuplicates: 3,
      status: "complete",
      endNote: "Search finished",
      runBy: { kind: "person", pubkey: "d".repeat(64) },
    },
  );
});
