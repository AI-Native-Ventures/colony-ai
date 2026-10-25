import assert from "node:assert/strict";
import test from "node:test";

import {
  getThreadReplyAvatarCenterRem,
  getThreadReplyAvatarCenterYRem,
  getThreadReplyConnectorLayout,
  getThreadReplyDescendantRailStartYRem,
  getThreadReplyIndentRem,
  threadReplyLength,
} from "./threadTreeLayout.ts";

test("getThreadReplyIndentRem uses the design's 52px nesting step", () => {
  assert.equal(getThreadReplyIndentRem(0), 0);
  assert.equal(getThreadReplyIndentRem(1), 0);
  assert.equal(getThreadReplyIndentRem(2), 3.25);
  assert.equal(getThreadReplyIndentRem(3), 6.5);
});

test("avatar center helpers expose the rail anchor points", () => {
  assert.equal(getThreadReplyAvatarCenterRem(0), 1.25);
  assert.equal(getThreadReplyAvatarCenterRem(1), 1.25);
  assert.equal(getThreadReplyAvatarCenterRem(2), 4.5);
  assert.equal(getThreadReplyAvatarCenterYRem(), 1.25);
  assert.equal(getThreadReplyDescendantRailStartYRem(), 2.875);
});

test("getThreadReplyConnectorLayout stops before the child avatar edge", () => {
  assert.equal(getThreadReplyConnectorLayout(0), null);
  assert.equal(getThreadReplyConnectorLayout(1), null);
  assert.deepEqual(getThreadReplyConnectorLayout(2), {
    childOffsetRem: 4.5,
    heightRem: 1.25,
    parentOffsetRem: 1.25,
    widthRem: 1.625,
  });
  assert.deepEqual(getThreadReplyConnectorLayout(3), {
    childOffsetRem: 7.75,
    heightRem: 1.25,
    parentOffsetRem: 4.5,
    widthRem: 1.625,
  });
});

test("getThreadReplyConnectorLayout clamps very deep replies to the visible rail", () => {
  assert.deepEqual(getThreadReplyConnectorLayout(99), {
    childOffsetRem: 20.75,
    heightRem: 1.25,
    parentOffsetRem: 17.5,
    widthRem: 1.625,
  });
});

test("threadReplyLength formats rem values for inline styles", () => {
  assert.equal(threadReplyLength(0), "0");
  assert.equal(threadReplyLength(1.75), "1.75rem");
  assert.equal(threadReplyLength(-0.125), "-0.125rem");
});
