import assert from "node:assert/strict";
import test from "node:test";

import { isRelayMembershipDeniedError } from "../../../shared/lib/relayMembershipDenied.ts";
import { describeCommunityApplyError } from "./communityApplyError.ts";

const MEMBERSHIP_ERROR =
  "current identity is not a member of the business community";

test("known membership error becomes plain copy and keeps the raw text", () => {
  const copy = describeCommunityApplyError({
    communityName: "Colony",
    error: MEMBERSHIP_ERROR,
    hasOtherCommunities: true,
  });
  assert.equal(
    copy.message,
    "This sign-in is not a member of Colony. Switch to another community or remove this one.",
  );
  assert.equal(copy.detail, MEMBERSHIP_ERROR);
  assert.equal(copy.isMembershipError, true);
  assert.doesNotMatch(copy.message, /buzz/i);
});

test("membership copy does not point at other communities when there are none", () => {
  const copy = describeCommunityApplyError({
    communityName: "Colony",
    error: MEMBERSHIP_ERROR,
    hasOtherCommunities: false,
  });
  assert.equal(
    copy.message,
    "This sign-in is not a member of Colony. Remove it from this device, or ask for an invitation.",
  );
});

test("membership copy falls back to a neutral name", () => {
  const copy = describeCommunityApplyError({
    communityName: null,
    error: "restricted: not a relay member",
    hasOtherCommunities: true,
  });
  assert.match(copy.message, /not a member of this community\./);
  assert.equal(copy.isMembershipError, true);
});

test("other errors keep their original text and show no details line", () => {
  const copy = describeCommunityApplyError({
    communityName: "Colony",
    error: "Temporary community connection failure.",
    hasOtherCommunities: true,
  });
  assert.equal(copy.message, "Temporary community connection failure.");
  assert.equal(copy.detail, null);
  assert.equal(copy.isMembershipError, false);
});

test("every refusal the workspace detects gets the plain membership copy", () => {
  for (const shape of [
    "You must be a relay member to access this relay",
    "relay_membership_required",
    "restricted: not a relay member",
    "invalid: you are not a relay member",
  ]) {
    assert.equal(isRelayMembershipDeniedError(shape), true, shape);
    const copy = describeCommunityApplyError({
      communityName: "Colony",
      error: shape,
      hasOtherCommunities: false,
    });
    assert.equal(copy.isMembershipError, true, shape);
    assert.match(copy.message, /^This sign-in is not a member of Colony\./);
  }
});
