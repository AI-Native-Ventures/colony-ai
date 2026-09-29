import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  companyWorkDTag,
  parseCompanyWorkActionEvent,
  parseCompanyWorkHeadEvent,
} from "./companyWorkModels.ts";
import {
  clearCompanyWorkFilter,
  emptyCompanyWorkFilters,
  filterCompanyWorkRecords,
  goalFilterScope,
} from "./companyWorkFilters.ts";
import {
  hasSameCompanyWorkAudience,
  parseCompanyWorkThreadRoots,
} from "./companyWorkMove.ts";
import { projectCompanyWorkTimeline } from "./companyWorkTimeline.ts";

const RELAY_SECRET = new Uint8Array(32).fill(4);
const OTHER_SECRET = new Uint8Array(32).fill(5);
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const CHANNEL_ID = "123e4567-e89b-12d3-a456-426614174010";
const WORK_ID = "123e4567-e89b-12d3-a456-426614174011";

function signedHead({
  workItemId = WORK_ID,
  status = "active",
  assignedPubkeys = ["a".repeat(64)],
  goalId,
  acceptedAt,
  dueAt,
  tags = [
    ["h", CHANNEL_ID],
    ["d", companyWorkDTag(workItemId)],
  ],
  content,
  secret = RELAY_SECRET,
} = {}) {
  const head = {
    schemaVersion: 1,
    workItemId,
    title: "Prepare the launch checklist",
    status,
    assignedPubkeys,
    approverPubkeys: [],
    deliverables: [],
    requesterPubkey: "b".repeat(64),
    doneCondition: "Every launch task has an owner",
    ...(goalId ? { goalId } : {}),
    ...(acceptedAt ? { acceptedAt } : {}),
    ...(dueAt ? { dueAt } : {}),
    sourceActionEventId: "c".repeat(64),
  };
  return finalizeEvent(
    {
      kind: 30634,
      created_at: 1_790_000_000,
      content: content ?? JSON.stringify(head),
      tags,
    },
    secret,
  );
}

function workRecord({ workItemId, status, ownerPubkey, goalId }) {
  const event = signedHead({
    workItemId,
    status,
    assignedPubkeys: [ownerPubkey],
    goalId,
  });
  return parseCompanyWorkHeadEvent(event, RELAY_PUBKEY);
}

test("company work coordinates contain the item UUID and no community id", () => {
  assert.equal(companyWorkDTag(WORK_ID), `company:work:${WORK_ID}`);
  assert.throws(() => companyWorkDTag("not-a-uuid"));
});

test("company work head parsing verifies shared kind, relay author, h and d", () => {
  const event = signedHead();
  const parsed = parseCompanyWorkHeadEvent(event, RELAY_PUBKEY);
  assert.equal(parsed?.channelId, CHANNEL_ID);
  assert.equal(parsed?.head.workItemId, WORK_ID);

  assert.equal(
    parseCompanyWorkHeadEvent(event, getPublicKey(OTHER_SECRET)),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({ secret: OTHER_SECRET }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(signedHead({ tags: [] }), RELAY_PUBKEY),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({
        tags: [
          ["h", CHANNEL_ID],
          ["d", `client:${WORK_ID}`],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({ content: "tampered after signing" }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("company work head parsing accepts a moved standalone item", () => {
  const head = {
    schemaVersion: 1,
    workItemId: WORK_ID,
    title: "Prepare the launch checklist",
    status: "active",
    assignedPubkeys: ["a".repeat(64)],
    approverPubkeys: [],
    deliverables: [],
    requesterPubkey: "b".repeat(64),
    doneCondition: "Every launch task has an owner",
    threadRootEventId: "d".repeat(64),
    sourceActionEventId: "c".repeat(64),
  };
  const event = signedHead({ content: JSON.stringify(head) });
  assert.equal(
    parseCompanyWorkHeadEvent(event, RELAY_PUBKEY)?.head.threadRootEventId,
    "d".repeat(64),
  );
});

test("company work due dates require UTC RFC 3339 and follow acceptance", () => {
  const parsed = parseCompanyWorkHeadEvent(
    signedHead({
      acceptedAt: "2026-10-01T09:00:00Z",
      dueAt: "2026-10-08T09:00:00Z",
    }),
    RELAY_PUBKEY,
  );
  assert.equal(parsed?.head.dueAt, "2026-10-08T09:00:00Z");
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({
        acceptedAt: "2026-10-01T09:00:00Z",
        dueAt: "2026-10-08T09:00:00+00:00",
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({
        acceptedAt: "2026-10-01T09:00:00Z",
        dueAt: "2026-10-01T09:00:00Z",
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("company work due-date action parsing rejects invalid timestamps", () => {
  const actionEvent = (dueAt) =>
    finalizeEvent(
      {
        kind: 47006,
        created_at: 1_790_000_000,
        tags: [
          ["h", CHANNEL_ID],
          ["d", companyWorkDTag(WORK_ID)],
        ],
        content: JSON.stringify({
          schemaVersion: 1,
          workItemId: WORK_ID,
          action: "set_due_date",
          expectedHeadEventId: "d".repeat(64),
          dueAt,
        }),
      },
      OTHER_SECRET,
    );
  assert.equal(
    parseCompanyWorkActionEvent(
      actionEvent("2026-10-08T09:00:00Z"),
      CHANNEL_ID,
      WORK_ID,
    )?.action.dueAt,
    "2026-10-08T09:00:00Z",
  );
  assert.equal(
    parseCompanyWorkActionEvent(
      actionEvent("2026-10-08T09:00:00+00:00"),
      CHANNEL_ID,
      WORK_ID,
    ),
    null,
  );
});

test("company work head parsing requires a pass record for done verified", () => {
  const event = signedHead({
    status: "done_verified",
    content: JSON.stringify({
      schemaVersion: 1,
      workItemId: WORK_ID,
      title: "Prepare the launch checklist",
      status: "done_verified",
      assignedPubkeys: ["a".repeat(64)],
      approverPubkeys: [],
      deliverables: [],
      requesterPubkey: "b".repeat(64),
      doneCondition: "Every launch task has an owner",
      sourceActionEventId: "c".repeat(64),
    }),
  });
  assert.equal(parseCompanyWorkHeadEvent(event, RELAY_PUBKEY), null);
});

test("company work filters intersect owner, status, and goal descendants", () => {
  const parentGoalId = "123e4567-e89b-12d3-a456-426614174020";
  const childGoalId = "123e4567-e89b-12d3-a456-426614174021";
  const unrelatedGoalId = "123e4567-e89b-12d3-a456-426614174022";
  const parent = { head: { goal: { goalId: parentGoalId } } };
  const child = {
    head: { goal: { goalId: childGoalId, parentGoalId } },
  };
  const unrelated = {
    head: { goal: { goalId: unrelatedGoalId } },
  };
  const goals = [parent, child, unrelated];
  const records = [
    workRecord({
      workItemId: "123e4567-e89b-12d3-a456-426614174030",
      status: "active",
      ownerPubkey: "a".repeat(64),
      goalId: parentGoalId,
    }),
    workRecord({
      workItemId: "123e4567-e89b-12d3-a456-426614174031",
      status: "active",
      ownerPubkey: "a".repeat(64),
      goalId: childGoalId,
    }),
    workRecord({
      workItemId: "123e4567-e89b-12d3-a456-426614174032",
      status: "blocked",
      ownerPubkey: "a".repeat(64),
      goalId: childGoalId,
    }),
    workRecord({
      workItemId: "123e4567-e89b-12d3-a456-426614174033",
      status: "active",
      ownerPubkey: "b".repeat(64),
      goalId: unrelatedGoalId,
    }),
  ];

  const result = filterCompanyWorkRecords(
    records,
    {
      status: "active",
      ownerPubkey: "A".repeat(64),
      goalId: parentGoalId,
    },
    goals,
  );
  assert.deepEqual(
    result.map((record) => record.head.workItemId),
    [records[0].head.workItemId, records[1].head.workItemId],
  );
  assert.deepEqual(
    [...goalFilterScope(parentGoalId, goals)].sort(),
    [parentGoalId, childGoalId].sort(),
  );
  assert.deepEqual(
    filterCompanyWorkRecords(records, emptyCompanyWorkFilters, goals),
    records,
  );
});

test("company work filter chips clear independently and clear all", () => {
  const filters = {
    status: "blocked",
    ownerPubkey: "a".repeat(64),
    goalId: "123e4567-e89b-12d3-a456-426614174020",
  };
  assert.deepEqual(clearCompanyWorkFilter(filters, "ownerPubkey"), {
    ...filters,
    ownerPubkey: null,
  });
  assert.deepEqual(clearCompanyWorkFilter(filters, "goalId"), {
    ...filters,
    goalId: null,
  });
  assert.deepEqual(clearCompanyWorkFilter(filters, "status"), {
    ...filters,
    status: "all",
  });
  assert.deepEqual(
    clearCompanyWorkFilter(
      clearCompanyWorkFilter(
        clearCompanyWorkFilter(filters, "ownerPubkey"),
        "goalId",
      ),
      "status",
    ),
    emptyCompanyWorkFilters,
  );
  assert.deepEqual(
    filterCompanyWorkRecords([], emptyCompanyWorkFilters, []),
    [],
    "an empty real record set stays empty",
  );
});

test("move destinations include only real top-level messages in accessible streams", () => {
  const destinationChannelId = "123e4567-e89b-12d3-a456-426614174012";
  const channel = {
    id: CHANNEL_ID,
    channelType: "stream",
    isMember: true,
    archivedAt: null,
  };
  const event = {
    id: "d".repeat(64),
    kind: 9,
    created_at: 10,
    tags: [["h", CHANNEL_ID]],
    content: "A launch discussion",
  };
  const reply = {
    ...event,
    id: "e".repeat(64),
    tags: [
      ["h", CHANNEL_ID],
      ["e", "f".repeat(64), "", "reply"],
    ],
  };
  const outsideChannel = {
    ...event,
    id: "1".repeat(64),
    tags: [["h", destinationChannelId]],
  };
  const roots = parseCompanyWorkThreadRoots(
    [event, reply, outsideChannel],
    [channel],
  );
  assert.equal(roots.length, 1);
  assert.equal(roots[0].event.id, event.id);
  assert.equal(roots[0].preview, "A launch discussion");
});

test("move eligibility requires identical visibility, members, and roles", () => {
  const source = {
    id: CHANNEL_ID,
    visibility: "private",
  };
  const destination = {
    id: "123e4567-e89b-12d3-a456-426614174012",
    visibility: "private",
  };
  const members = [
    { pubkey: "a".repeat(64), role: "owner" },
    { pubkey: "b".repeat(64), role: "member" },
  ];
  assert.equal(
    hasSameCompanyWorkAudience(
      source,
      destination,
      members,
      [...members].reverse(),
    ),
    true,
  );
  assert.equal(
    hasSameCompanyWorkAudience(source, destination, members, [
      members[0],
      { ...members[1], role: "admin" },
    ]),
    false,
  );
  assert.equal(
    hasSameCompanyWorkAudience(
      source,
      { ...destination, visibility: "open" },
      members,
      members,
    ),
    false,
  );
});

test("work activity comes from signed actions and labels thread moves", () => {
  const actionEvent = (id, created_at, channelId, action) => ({
    event: {
      id,
      created_at,
      pubkey: "a".repeat(64),
    },
    channelId,
    action,
  });
  const history = [
    actionEvent("f", 6, CHANNEL_ID, { action: "restore" }),
    actionEvent("e", 5, CHANNEL_ID, { action: "archive" }),
    actionEvent("d", 4, CHANNEL_ID, {
      action: "verify",
      verification: {
        verdict: "revision_requested",
        reason: "Add the missing source.",
        evidence: "The source link is not attached.",
      },
    }),
    actionEvent("c", 3, CHANNEL_ID, {
      action: "set_status",
      status: "done_unverified",
      reason: "The owner submitted the work.",
    }),
    actionEvent("b", 2, CHANNEL_ID, {
      action: "update",
      head: { threadRootEventId: "b".repeat(64) },
    }),
    actionEvent("a", 1, CHANNEL_ID, {
      action: "create",
      head: { threadRootEventId: "a".repeat(64) },
    }),
  ];
  const timeline = projectCompanyWorkTimeline(history);
  assert.deepEqual(
    timeline.map((entry) => entry.label),
    [
      "restored this work item.",
      "archived this work item.",
      "requested revisions.",
      "changed the status to done unverified.",
      "moved this work item to a new thread.",
      "created this commitment.",
    ],
  );
  assert.equal(timeline[2].reason, "Add the missing source.");
  assert.equal(timeline[2].evidence, "The source link is not attached.");
  assert.deepEqual(projectCompanyWorkTimeline([]), []);
});

test("work due date history distinguishes set, change, and clear", () => {
  const history = [
    {
      event: { id: "d", created_at: 4, pubkey: "a".repeat(64) },
      channelId: CHANNEL_ID,
      action: { action: "clear_due_date" },
    },
    {
      event: { id: "c", created_at: 3, pubkey: "a".repeat(64) },
      channelId: CHANNEL_ID,
      action: { action: "set_due_date", dueAt: "2026-10-10T12:00:00Z" },
    },
    {
      event: { id: "b", created_at: 2, pubkey: "a".repeat(64) },
      channelId: CHANNEL_ID,
      action: { action: "set_due_date", dueAt: "2026-10-09T12:00:00Z" },
    },
    {
      event: { id: "a", created_at: 1, pubkey: "a".repeat(64) },
      channelId: CHANNEL_ID,
      action: { action: "create", head: {} },
    },
  ];
  assert.deepEqual(
    projectCompanyWorkTimeline(history).map((entry) => entry.label),
    [
      "cleared the due date.",
      "changed the due date.",
      "set a due date.",
      "created this commitment.",
    ],
  );
});
