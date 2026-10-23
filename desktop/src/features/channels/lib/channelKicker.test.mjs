import assert from "node:assert/strict";
import test from "node:test";

import { getChannelKicker } from "./channelKicker.ts";

test("getChannelKicker names every channel type and visibility", () => {
  for (const [channelType, visibility, expected] of [
    ["stream", "open", "Channel"],
    ["stream", "private", "Private channel"],
    ["forum", "open", "Forum"],
    ["forum", "private", "Private forum"],
    ["dm", "open", "Direct message"],
    ["dm", "private", "Direct message"],
  ]) {
    assert.equal(getChannelKicker({ channelType, visibility }), expected);
  }
});

test("getChannelKicker is empty without a channel", () => {
  assert.equal(getChannelKicker(null), undefined);
});
