import assert from "node:assert/strict";
import test from "node:test";

import {
  claimPrebuiltHireRun,
  ownsPrebuiltHireRun,
  releasePrebuiltHireRun,
  resetPrebuiltHireRunFence,
} from "./prebuiltHireRunFence.ts";

test("the production hire-run fence allows one continuation and invalidates it on reset", () => {
  const first = claimPrebuiltHireRun("community-a", "hire-a");
  assert.ok(first);
  assert.equal(ownsPrebuiltHireRun(first), true);
  assert.equal(claimPrebuiltHireRun("community-a", "hire-a"), null);
  assert.ok(
    claimPrebuiltHireRun("community-a", "hire-b"),
    "a different hire stays independent",
  );

  resetPrebuiltHireRunFence();
  assert.equal(ownsPrebuiltHireRun(first), false);
  assert.ok(
    claimPrebuiltHireRun("community-a", "hire-a"),
    "the next community generation may continue the same coordinate",
  );
  releasePrebuiltHireRun(first);
  resetPrebuiltHireRunFence();
});
