import assert from "node:assert/strict";
import { test } from "node:test";

import { addBroadcastReplyTag } from "./threading.ts";

test("addBroadcastReplyTag appends one tag without mutating input", () => {
  const tags = [["e", "thread-root", "", "root"]];

  const result = addBroadcastReplyTag(tags);

  assert.deepEqual(result, [
    ["e", "thread-root", "", "root"],
    ["broadcast", "1"],
  ]);
  assert.deepEqual(tags, [["e", "thread-root", "", "root"]]);
});

test("addBroadcastReplyTag does not duplicate an existing tag", () => {
  const tags = [["broadcast", "1"]];

  assert.equal(addBroadcastReplyTag(tags), tags);
});
