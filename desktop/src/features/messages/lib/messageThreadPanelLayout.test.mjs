import assert from "node:assert/strict";
import { it } from "node:test";

import {
  getThreadReplySpacingPx,
  MESSAGE_GROUP_SPACING_PX,
} from "./messageGroupSpacing.ts";

it("uses the channel gap for each separate reply and keeps continuations grouped", () => {
  assert.equal(getThreadReplySpacingPx(false), MESSAGE_GROUP_SPACING_PX);
  assert.equal(getThreadReplySpacingPx(true), 0);
});
