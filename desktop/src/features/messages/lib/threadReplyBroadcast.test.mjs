import assert from "node:assert/strict";
import { test } from "node:test";

import { createThreadReplySender } from "./threadReplyBroadcast.ts";

test("thread reply sender forwards broadcast state as a channel tag", async () => {
  const calls = [];
  const send = async (...args) => calls.push(args);
  const sender = createThreadReplySender(send, true);
  const mediaTags = [["e", "thread-root", "", "root"]];
  const threadContext = {
    parentEventId: "thread-parent",
    threadHeadId: "thread-root",
  };

  await sender(
    "Reply",
    ["mention-key"],
    mediaTags,
    "channel-id",
    threadContext,
    true,
  );

  assert.deepEqual(calls, [
    [
      "Reply",
      ["mention-key"],
      [
        ["e", "thread-root", "", "root"],
        ["broadcast", "1"],
      ],
      "channel-id",
      threadContext,
      true,
    ],
  ]);
  assert.deepEqual(mediaTags, [["e", "thread-root", "", "root"]]);
});

test("thread reply sender leaves the normal send path untouched when disabled", async () => {
  const send = async () => {};
  assert.equal(createThreadReplySender(send, false), send);
});
