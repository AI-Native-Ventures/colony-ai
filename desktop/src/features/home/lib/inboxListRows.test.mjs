import assert from "node:assert/strict";
import test from "node:test";

import { buildInboxListRows } from "./inboxListRows.ts";

function inboxItem(
  id,
  latestActivityAt,
  conversationId = `conversation:${id}`,
) {
  return {
    conversationId,
    groupItems: [],
    id,
    item: { id },
    latestActivityAt,
  };
}

test("Inbox All lists rows in latest-first order", () => {
  const rows = buildInboxListRows({
    items: [
      inboxItem("older", 1_753_099_100),
      inboxItem("newer", 1_753_099_300),
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.item.id),
    ["newer", "older"],
  );
});

test("Inbox conversation keys stay stable when the representative changes", () => {
  const first = buildInboxListRows({
    items: [inboxItem("reply-1", 1, "thread-root")],
  });
  const second = buildInboxListRows({
    items: [inboxItem("reply-2", 2, "thread-root")],
  });

  assert.equal(first[0].key, "inbox:thread-root");
  assert.equal(second[0].key, first[0].key);
});
