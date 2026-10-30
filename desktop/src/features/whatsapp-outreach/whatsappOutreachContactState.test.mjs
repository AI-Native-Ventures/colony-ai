import assert from "node:assert/strict";
import test from "node:test";

import { sendNowBatchIdForQueuedMessage } from "./whatsappOutreachContactState.ts";

const contact = {
  waId: "27821234410",
  e164: "+27 82 123 4410",
};

function batch(overrides = {}) {
  return {
    batchId: "approved-test-batch",
    status: "approved",
    rows: [
      {
        to: "+27 82 123 4410",
        preview: "A test message",
        state: "ready",
      },
    ],
    ...overrides,
  };
}

test("matches a queued message to its unique small approved ready batch row", () => {
  assert.equal(
    sendNowBatchIdForQueuedMessage(contact, "A test message", [batch()]),
    "approved-test-batch",
  );
});

test("does not match pending, oversized, non-ready, or different messages", () => {
  assert.equal(
    sendNowBatchIdForQueuedMessage(contact, "A test message", [
      batch({ status: "pending" }),
    ]),
    null,
  );
  assert.equal(
    sendNowBatchIdForQueuedMessage(contact, "A test message", [
      batch({ rows: [...batch().rows, ...batch().rows, ...batch().rows] }),
    ]),
    null,
  );
  assert.equal(
    sendNowBatchIdForQueuedMessage(contact, "A test message", [
      batch({ rows: [{ ...batch().rows[0], state: "sending" }] }),
    ]),
    null,
  );
  assert.equal(
    sendNowBatchIdForQueuedMessage(contact, "Different message", [batch()]),
    null,
  );
});

test("does not choose between ambiguous matching approved batches", () => {
  assert.equal(
    sendNowBatchIdForQueuedMessage(contact, "A test message", [
      batch(),
      batch({ batchId: "another-approved-test-batch" }),
    ]),
    null,
  );
});

test("uses the schedule field to distinguish queued messages for the same contact", () => {
  const scheduledBatch = batch({
    rows: [{ ...batch().rows[0], sendsAt: "2026-10-30T08:00:00.000Z" }],
  });
  assert.equal(
    sendNowBatchIdForQueuedMessage(
      contact,
      "A test message",
      [scheduledBatch],
      "2026-10-30T10:00:00+02:00",
    ),
    "approved-test-batch",
  );
  assert.equal(
    sendNowBatchIdForQueuedMessage(
      contact,
      "A test message",
      [scheduledBatch],
      "2026-10-30T11:00:00+02:00",
    ),
    null,
  );
});
