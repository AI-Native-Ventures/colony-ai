import assert from "node:assert/strict";
import test from "node:test";

import {
  canSendNowWhatsAppBatch,
  canUseWhatsAppSendNow,
} from "./whatsappSendNowEligibility.ts";

const OWNER = "ab".repeat(32);

function access(overrides = {}) {
  return {
    role: "owner",
    pubkey: OWNER,
    isAgent: false,
    ownerPubkey: null,
    knownAgentPubkeys: new Set(),
    ...overrides,
  };
}

test("send now is limited to owner and admin human identities", () => {
  for (const role of ["owner", "admin"]) {
    assert.equal(canUseWhatsAppSendNow(access({ role })), true, role);
  }
  for (const role of ["member", null, undefined]) {
    assert.equal(canUseWhatsAppSendNow(access({ role })), false, String(role));
  }
});

test("send now excludes agent identities and identities owned by the user", () => {
  assert.equal(canUseWhatsAppSendNow(access({ isAgent: true })), false);
  assert.equal(canUseWhatsAppSendNow(access({ ownerPubkey: OWNER })), false);
  assert.equal(
    canUseWhatsAppSendNow(
      access({
        pubkey: OWNER.toUpperCase(),
        knownAgentPubkeys: new Set([OWNER]),
      }),
    ),
    false,
  );
  assert.equal(canUseWhatsAppSendNow(access({ pubkey: undefined })), false);
});

test("send now batch must be approved, small, and still ready", () => {
  const ready = { state: "ready" };
  assert.equal(
    canSendNowWhatsAppBatch({ status: "approved", rows: [ready] }, true),
    true,
  );
  assert.equal(
    canSendNowWhatsAppBatch({ status: "pending", rows: [ready] }, true),
    false,
  );
  assert.equal(
    canSendNowWhatsAppBatch(
      { status: "approved", rows: [ready, ready, ready, ready] },
      true,
    ),
    false,
  );
  assert.equal(
    canSendNowWhatsAppBatch(
      { status: "approved", rows: [{ state: "sent" }] },
      true,
    ),
    false,
  );
  assert.equal(
    canSendNowWhatsAppBatch({ status: "approved", rows: [ready] }, false),
    false,
  );
});
