import assert from "node:assert/strict";
import { it } from "node:test";

import { getThreadReplySpacingClass } from "./messageThreadPanelLayout.ts";

it("matches ThreadFocus reply spacing and main timeline grouping", () => {
  const cases = [
    [{ depth: 1, index: 0, isContinuation: false }, ""],
    [{ depth: 1, index: 1, isContinuation: false }, "mt-1.5"],
    [{ depth: 2, index: 2, isContinuation: false }, "mt-4"],
    [{ depth: 3, index: 3, isContinuation: false }, "mt-3.5"],
    [{ depth: 4, index: 4, isContinuation: false }, "mt-6"],
    [{ depth: 8, index: 5, isContinuation: false }, "mt-6"],
    [{ depth: 1, index: 1, isContinuation: true }, ""],
    [{ depth: 2, index: 2, isContinuation: true }, ""],
    [{ depth: 4, index: 4, isContinuation: true }, ""],
  ];

  for (const [input, expected] of cases) {
    assert.equal(getThreadReplySpacingClass(input), expected);
  }
});
