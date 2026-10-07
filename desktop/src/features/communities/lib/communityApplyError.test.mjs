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

// Exactly what the packaged app showed in Details after Retry.
const GATE_STRING =
  "relay owned-agent query failed: relay returned 403 Forbidden: You must be a relay member to access this relay";
const RAW_RELAY_TEXT = /relay returned \d{3}|query failed|relay unreachable/i;

test("Retry while still refused: Details is the plain reason, never the wrapper text", () => {
  for (const hasOtherCommunities of [true, false]) {
    const copy = describeCommunityApplyError({
      communityName: "Colony",
      error: GATE_STRING,
      hasOtherCommunities,
    });
    assert.equal(copy.isMembershipError, true);
    assert.equal(
      copy.detail,
      "You must be a relay member to access this relay",
    );
    assert.doesNotMatch(copy.detail, RAW_RELAY_TEXT);
    assert.doesNotMatch(copy.message, RAW_RELAY_TEXT);
  }
});

test("first view and Retry show the same Details text for the same refusal", () => {
  const firstView = describeCommunityApplyError({
    communityName: "Colony",
    // The gate hands the screen its already-normalised detail.
    error: "You must be a relay member to access this relay",
    hasOtherCommunities: true,
  });
  for (const retryError of [
    GATE_STRING,
    "relay returned 403 Forbidden: You must be a relay member to access this relay",
    "relay_membership_required",
  ]) {
    const afterRetry = describeCommunityApplyError({
      communityName: "Colony",
      error: retryError,
      hasOtherCommunities: true,
    });
    assert.equal(afterRetry.detail, firstView.detail, retryError);
    assert.equal(afterRetry.message, firstView.message, retryError);
  }
});

test("Retry with other relay errors shows one plain sentence and no raw text", () => {
  for (const [raw, plain] of [
    [
      "relay owned-agent query failed: relay returned 500 Internal Server Error: upstream exploded",
      "Colony could not reach this community. Try again.",
    ],
    [
      "relay returned 502 Bad Gateway: nope",
      "Colony could not reach this community. Try again.",
    ],
    ["relay unreachable: request timed out", "Can't reach the relay."],
    [
      "relay owned-agent query failed: relay unreachable: could not connect to relay",
      "Can't reach the relay.",
    ],
  ]) {
    const copy = describeCommunityApplyError({
      communityName: "Colony",
      error: raw,
      hasOtherCommunities: true,
    });
    assert.equal(copy.message, plain, raw);
    assert.equal(copy.detail, null, raw);
    assert.equal(copy.isMembershipError, false, raw);
    assert.doesNotMatch(copy.message, RAW_RELAY_TEXT, raw);
  }
});
