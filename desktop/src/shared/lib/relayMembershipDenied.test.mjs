import assert from "node:assert/strict";
import test from "node:test";

import {
  isRelayMembershipDeniedError,
  relayMembershipDenialDetail,
  stripRelayWrappers,
} from "./relayMembershipDenied.ts";

// The exact text the packaged app showed after Retry: the owned-agent query
// wraps the native layer's "relay returned {status}: {message}".
const NESTED_DENIAL =
  "relay owned-agent query failed: relay returned 403 Forbidden: You must be a relay member to access this relay";

const SHAPES = [
  "You must be a relay member to access this relay",
  "relay_membership_required",
  "restricted: not a relay member",
  "invalid: you are not a relay member",
];

test("every known membership refusal shape is recognised", () => {
  for (const shape of SHAPES) {
    assert.equal(isRelayMembershipDeniedError(new Error(shape)), true, shape);
    assert.equal(isRelayMembershipDeniedError(shape), true, shape);
  }
});

test("the native transport prefix does not hide a refusal", () => {
  assert.equal(
    isRelayMembershipDeniedError(
      new Error(
        "relay returned 403 Forbidden: You must be a relay member to access this relay",
      ),
    ),
    true,
  );
});

test("other failures are not membership refusals", () => {
  for (const other of [
    "relay returned 403 Forbidden: rate limited",
    "relay returned 500 Internal Server Error: boom",
    "relay unreachable: connection refused",
    "temporary channel read failure",
    "",
  ]) {
    assert.equal(isRelayMembershipDeniedError(new Error(other)), false, other);
  }
  assert.equal(isRelayMembershipDeniedError(null), false);
  assert.equal(isRelayMembershipDeniedError(undefined), false);
  assert.equal(isRelayMembershipDeniedError({ message: SHAPES[0] }), false);
});

test("the details line drops the transport prefix and keeps the reason", () => {
  assert.equal(
    relayMembershipDenialDetail(
      new Error(
        "relay returned 403 Forbidden: You must be a relay member to access this relay",
      ),
    ),
    "You must be a relay member to access this relay",
  );
  assert.equal(
    relayMembershipDenialDetail("restricted: not a relay member"),
    "restricted: not a relay member",
  );
  assert.doesNotMatch(
    relayMembershipDenialDetail("relay returned 403 Forbidden: nope"),
    /relay returned/,
  );
});

test("the nested wrapper from the Retry path is stripped down to the reason", () => {
  assert.equal(isRelayMembershipDeniedError(NESTED_DENIAL), true);
  assert.equal(
    relayMembershipDenialDetail(NESTED_DENIAL),
    "You must be a relay member to access this relay",
  );
  assert.equal(
    relayMembershipDenialDetail(new Error(NESTED_DENIAL)),
    "You must be a relay member to access this relay",
  );
});

test("every wrapper the native layer adds is stripped, however deep", () => {
  for (const wrapped of [
    "relay agent channel-membership query failed: relay returned 403 Forbidden: nope",
    "relay owned-agent query failed: relay agent channel-membership query failed: relay returned 403: nope",
    "relay returned 403 Forbidden: nope",
  ]) {
    assert.equal(stripRelayWrappers(wrapped), "nope", wrapped);
    assert.doesNotMatch(
      relayMembershipDenialDetail(wrapped),
      /relay returned|query failed/,
      wrapped,
    );
  }
  // Already plain text passes through untouched, so stripping twice is safe.
  assert.equal(stripRelayWrappers("not a relay member"), "not a relay member");
  assert.equal(
    relayMembershipDenialDetail(relayMembershipDenialDetail(NESTED_DENIAL)),
    "You must be a relay member to access this relay",
  );
});

test("the stable membership code reads as the plain sentence in details", () => {
  assert.equal(
    relayMembershipDenialDetail("relay_membership_required"),
    "You must be a relay member to access this relay",
  );
  assert.equal(
    relayMembershipDenialDetail(
      "relay returned 403 Forbidden: relay_membership_required",
    ),
    "You must be a relay member to access this relay",
  );
});
