import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  companyWorkDTag,
  parseCompanyWorkHeadEvent,
} from "./companyWorkModels.ts";

const RELAY_SECRET = new Uint8Array(32).fill(4);
const OTHER_SECRET = new Uint8Array(32).fill(5);
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const CHANNEL_ID = "123e4567-e89b-12d3-a456-426614174010";
const WORK_ID = "123e4567-e89b-12d3-a456-426614174011";

function signedHead({
  workItemId = WORK_ID,
  status = "active",
  tags = [
    ["h", CHANNEL_ID],
    ["d", companyWorkDTag(WORK_ID)],
  ],
  content,
  secret = RELAY_SECRET,
} = {}) {
  const head = {
    schemaVersion: 1,
    workItemId,
    title: "Prepare the launch checklist",
    status,
    assignedPubkeys: ["a".repeat(64)],
    approverPubkeys: [],
    deliverables: [],
    requesterPubkey: "b".repeat(64),
    doneCondition: "Every launch task has an owner",
    sourceActionEventId: "c".repeat(64),
  };
  return finalizeEvent(
    {
      kind: 30634,
      created_at: 1_790_000_000,
      content: content ?? JSON.stringify(head),
      tags,
    },
    secret,
  );
}

test("company work coordinates contain the item UUID and no community id", () => {
  assert.equal(companyWorkDTag(WORK_ID), `company:work:${WORK_ID}`);
  assert.throws(() => companyWorkDTag("not-a-uuid"));
});

test("company work head parsing verifies shared kind, relay author, h and d", () => {
  const event = signedHead();
  const parsed = parseCompanyWorkHeadEvent(event, RELAY_PUBKEY);
  assert.equal(parsed?.channelId, CHANNEL_ID);
  assert.equal(parsed?.head.workItemId, WORK_ID);

  assert.equal(
    parseCompanyWorkHeadEvent(event, getPublicKey(OTHER_SECRET)),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({ secret: OTHER_SECRET }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(signedHead({ tags: [] }), RELAY_PUBKEY),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({
        tags: [
          ["h", CHANNEL_ID],
          ["d", `client:${WORK_ID}`],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyWorkHeadEvent(
      signedHead({ content: "tampered after signing" }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("company work head parsing requires a pass record for done verified", () => {
  const event = signedHead({
    status: "done_verified",
    content: JSON.stringify({
      schemaVersion: 1,
      workItemId: WORK_ID,
      title: "Prepare the launch checklist",
      status: "done_verified",
      assignedPubkeys: ["a".repeat(64)],
      approverPubkeys: [],
      deliverables: [],
      requesterPubkey: "b".repeat(64),
      doneCondition: "Every launch task has an owner",
      sourceActionEventId: "c".repeat(64),
    }),
  });
  assert.equal(parseCompanyWorkHeadEvent(event, RELAY_PUBKEY), null);
});
