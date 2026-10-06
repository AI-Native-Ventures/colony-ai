import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  currentMembershipDenialGeneration,
  getMembershipDenial,
  reportMembershipDenial,
  resetMembershipDenialGate,
  subscribeMembershipDenial,
} from "./membershipDenialGate.ts";

const DENIED = new Error(
  "relay returned 403 Forbidden: You must be a relay member to access this relay",
);

afterEach(() => resetMembershipDenialGate());

test("a membership refusal is recorded for its community", () => {
  const generation = currentMembershipDenialGeneration();
  assert.equal(reportMembershipDenial(generation, "a", DENIED), true);
  assert.deepEqual(getMembershipDenial(), {
    communityId: "a",
    detail: "You must be a relay member to access this relay",
  });
});

test("other errors never raise the gate", () => {
  const generation = currentMembershipDenialGeneration();
  assert.equal(
    reportMembershipDenial(generation, "a", new Error("boom")),
    false,
  );
  assert.equal(getMembershipDenial(), null);
});

test("many failures in one generation notify once", () => {
  let notified = 0;
  const unsubscribe = subscribeMembershipDenial(() => {
    notified += 1;
  });
  const generation = currentMembershipDenialGeneration();
  assert.equal(reportMembershipDenial(generation, "a", DENIED), true);
  assert.equal(reportMembershipDenial(generation, "a", DENIED), false);
  assert.equal(reportMembershipDenial(generation, "a", DENIED), false);
  unsubscribe();
  assert.equal(notified, 1);
});

test("a stale denial from a previous community is not applied after a switch", () => {
  const staleGeneration = currentMembershipDenialGeneration();
  // The person switches communities: the community reset starts a new generation.
  resetMembershipDenialGate();
  assert.equal(reportMembershipDenial(staleGeneration, "a", DENIED), false);
  assert.equal(getMembershipDenial(), null);
  // The new community can still raise its own denial.
  assert.equal(
    reportMembershipDenial(currentMembershipDenialGeneration(), "b", DENIED),
    true,
  );
  assert.equal(getMembershipDenial()?.communityId, "b");
});

test("reset clears an existing denial and tells subscribers", () => {
  let notified = 0;
  const unsubscribe = subscribeMembershipDenial(() => {
    notified += 1;
  });
  reportMembershipDenial(currentMembershipDenialGeneration(), "a", DENIED);
  resetMembershipDenialGate();
  unsubscribe();
  assert.equal(getMembershipDenial(), null);
  assert.equal(notified, 2);
});
