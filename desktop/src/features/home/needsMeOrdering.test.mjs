import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNeedsMeItems,
  groupNeedsMeItems,
  needsMeItemKey,
} from "./needsMeOrdering.ts";

function ask(
  channelId,
  askId,
  decideBy,
  createdAt,
  type = "approval",
  category = "general",
) {
  return {
    channelId,
    head: {
      askId,
      createdAt,
      ask: { category, decideBy, type },
    },
  };
}

function approval(approvalRef, expiresAt, createdAt, id = approvalRef) {
  return {
    approval: { approvalRef, expiresAt, createdAt },
    workflow: { id: `workflow-${id}` },
    run: { id: `run-${id}` },
  };
}

test("Needs me sorts by deadline, then creation time and stable record id", () => {
  const items = buildNeedsMeItems({
    asks: [
      ask(
        "channel-b",
        "ask-b",
        "2026-09-27T14:00:00+02:00",
        "2026-09-27T10:00:00Z",
      ),
      ask(
        "channel-a",
        "ask-z",
        "2026-09-27T14:00:00+02:00",
        "2026-09-27T09:00:00Z",
      ),
      ask(
        "channel-a",
        "ask-a",
        "2026-09-27T14:00:00+02:00",
        "2026-09-27T09:00:00Z",
      ),
      ask(
        "channel-a",
        "ask-earliest",
        "2026-09-27T13:00:00+02:00",
        "2026-09-27T11:00:00Z",
      ),
    ],
    workflowApprovals: [
      approval("approval-late", "2026-09-27T15:00:00+02:00", 1_790_500_000),
    ],
  });

  assert.deepEqual(
    items.map((item) =>
      item.kind === "ask"
        ? item.record.head.askId
        : item.record.approval.approvalRef,
    ),
    ["ask-earliest", "ask-a", "ask-z", "ask-b", "approval-late"],
  );
});

test("Needs me places missing and invalid deadlines after dated records", () => {
  const items = buildNeedsMeItems({
    asks: [
      ask("channel", "no-deadline", null, "2026-09-27T09:00:00Z"),
      ask("channel", "invalid-deadline", "not-a-date", "2026-09-27T08:00:00Z"),
      ask(
        "channel",
        "dated",
        "2026-09-27T14:00:00+02:00",
        "2026-09-27T10:00:00Z",
      ),
    ],
    workflowApprovals: [],
  });

  assert.deepEqual(
    items.map((item) => item.kind === "ask" && item.record.head.askId),
    ["dated", "invalid-deadline", "no-deadline"],
  );
});

test("Needs me grouping keeps overdue records and groups in deadline order", () => {
  const now = Date.parse("2026-09-28T10:00:00.000Z");
  const items = buildNeedsMeItems({
    asks: [
      ask(
        "channel-a",
        "overdue",
        "2026-09-28T08:00:00.000Z",
        "2026-09-27T10:00:00.000Z",
      ),
      ask(
        "channel-a",
        "funding",
        "2026-09-28T11:00:00.000Z",
        "2026-09-27T11:00:00.000Z",
        "approval",
        "money",
      ),
      ask(
        "channel-b",
        "choice",
        "2026-09-29T11:00:00.000Z",
        "2026-09-27T12:00:00.000Z",
        "choice",
      ),
      ask(
        "channel-a",
        "tool",
        "2026-09-30T11:00:00.000Z",
        "2026-09-27T13:00:00.000Z",
        "approval",
        "tool",
      ),
      ask("channel-c", "unassigned", null, "2026-09-27T14:00:00.000Z"),
    ],
    workflowApprovals: [],
  });

  const byType = groupNeedsMeItems(items, "type", { now });
  assert.deepEqual(byType.overdue, []);
  assert.deepEqual(
    byType.groups.map((group) => group.label),
    ["Approvals & consent", "Funding", "Questions & checks"],
  );
  assert.deepEqual(
    byType.groups.map((group) => group.items.map(needsMeItemKey)),
    [
      [
        "ask:channel-a:overdue",
        "ask:channel-a:tool",
        "ask:channel-c:unassigned",
      ],
      ["ask:channel-a:funding"],
      ["ask:channel-b:choice"],
    ],
  );

  const byDeadline = groupNeedsMeItems(items, "deadline", { now });
  assert.deepEqual(
    byDeadline.groups.slice(0, 2).map((group) => group.label),
    ["Today", "Tomorrow"],
  );
  assert.match(byDeadline.groups[2].label, /30/);
  assert.equal(byDeadline.groups[3].label, "No deadline");
  assert.deepEqual(
    [
      ...byDeadline.overdue,
      ...byDeadline.groups.flatMap((group) => group.items),
    ].map(needsMeItemKey),
    items.map(needsMeItemKey),
  );

  const byChannel = groupNeedsMeItems(items, "channel", {
    now,
    channelLabel: (channelId) => `#${channelId}`,
  });
  assert.deepEqual(
    byChannel.groups.map((group) => group.label),
    ["#channel-a", "#channel-b", "#channel-c"],
  );
  assert.deepEqual(
    byChannel.groups.map((group) => group.items.map(needsMeItemKey)),
    [
      ["ask:channel-a:overdue", "ask:channel-a:funding", "ask:channel-a:tool"],
      ["ask:channel-b:choice"],
      ["ask:channel-c:unassigned"],
    ],
  );
});
