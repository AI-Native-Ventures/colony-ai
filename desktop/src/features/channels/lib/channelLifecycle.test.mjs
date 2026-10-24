import assert from "node:assert/strict";
import test from "node:test";

import { channelLifecycle, channelLifecycleLabel } from "./channelLifecycle.ts";

test("channelLifecycle maps ongoing and temporary streams", () => {
  assert.equal(channelLifecycle({ temporary: false }), "ongoing");
  assert.equal(channelLifecycle({ temporary: true }), "temporary");
});

test("channelLifecycleLabel names ongoing and temporary", () => {
  assert.equal(channelLifecycleLabel("ongoing", null), "Ongoing");
  assert.equal(
    channelLifecycleLabel("temporary", 7 * 24 * 60 * 60),
    "Temporary · 7d",
  );
});
