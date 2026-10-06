import assert from "node:assert/strict";
import test from "node:test";

import {
  isRelayMembershipDeniedError,
  relayMembershipDenialDetail,
} from "./relayMembershipDenied.ts";

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
