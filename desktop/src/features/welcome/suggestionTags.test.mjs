import assert from "node:assert/strict";
import test from "node:test";

import { MAX_SUGGESTIONS, suggestionsFromTags } from "./suggestionTags.ts";

test("suggestions are read from suggest tags, trimmed and in order", () => {
  assert.deepEqual(
    suggestionsFromTags([
      ["h", "channel"],
      ["suggest", " Find more customers "],
      ["suggest", "Plan my first week"],
      ["p", "pubkey"],
    ]),
    ["Find more customers", "Plan my first week"],
  );
});

test("empty, repeated and over-long suggestions are dropped", () => {
  assert.deepEqual(
    suggestionsFromTags([
      ["suggest", ""],
      ["suggest", "Yes"],
      ["suggest", "Yes"],
      ["suggest", "x".repeat(61)],
      ["suggest"],
    ]),
    ["Yes"],
  );
});

test("a message shows at most four suggestions", () => {
  const tags = Array.from({ length: 9 }, (_, index) => [
    "suggest",
    `Option ${index}`,
  ]);
  assert.equal(suggestionsFromTags(tags).length, MAX_SUGGESTIONS);
});

test("no tags means no suggestions", () => {
  assert.deepEqual(suggestionsFromTags(undefined), []);
  assert.deepEqual(suggestionsFromTags([]), []);
});
