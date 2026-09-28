import assert from "node:assert/strict";
import test from "node:test";

import { buildNeedsMeItems } from "./needsMeOrdering.ts";

function ask(channelId, askId, decideBy, createdAt) {
  return {
    channelId,
    head: {
      askId,
      createdAt,
      ask: { decideBy },
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
