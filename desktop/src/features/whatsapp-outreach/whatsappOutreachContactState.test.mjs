import assert from "node:assert/strict";
import test from "node:test";

import {
  contactWithThreadDetails,
  contactStatus,
  isWhatsAppAwaitingReply,
  sendNowBatchIdForQueuedMessage,
} from "./whatsappOutreachContactState.ts";

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

test("a failed latest outbound message is never called sent", () => {
  assert.equal(
    contactStatus({
      optedOut: false,
      awaitingApproval: false,
      unanswered: false,
      lastInboundAt: null,
      lastOutboundState: "failed",
    }),
    "Send failed",
  );
});

test("awaiting reply is conservative for old relays and excludes durable holds", () => {
  const sent = {
    optedOut: false,
    businessOutreachStopped: false,
    unanswered: false,
    awaitingApproval: false,
    stage: "contacted",
    hasSentOutbound: true,
    lastOutboundState: "sent",
    lastContactedAt: "2026-11-08T09:00:00Z",
    lastInboundAt: null,
  };
  assert.equal(isWhatsAppAwaitingReply(sent), true);
  assert.equal(
    isWhatsAppAwaitingReply({
      ...sent,
      lastInboundAt: "2026-11-08T10:00:00Z",
    }),
    false,
  );
  assert.equal(
    isWhatsAppAwaitingReply({ ...sent, businessOutreachStopped: true }),
    false,
  );
  assert.equal(
    isWhatsAppAwaitingReply({
      ...sent,
      hasSentOutbound: false,
      lastOutboundState: null,
      lastContactedAt: null,
    }),
    false,
  );
});

test("thread details preserve safety holds when only the additive thread view has them", () => {
  const listContact = {
    waId: "27821234410",
    displayName: null,
    profileName: null,
    businessName: null,
    website: null,
    label: null,
    stage: "contacted",
    stageSetBy: null,
    stageChangedAt: null,
    queuedFrom: null,
    outreachStatus: null,
    lastContactedAt: null,
    lastOutboundState: null,
    lastFailureSummary: null,
    deliveryFailure: null,
    lastReplyAt: null,
    hasSentOutbound: false,
    businessOutreachStopped: false,
    businessStopReason: null,
    leadId: null,
  };
  const threadContact = {
    ...listContact,
    displayName: "Corner Cottage",
    hasSentOutbound: true,
    businessOutreachStopped: true,
    businessStopReason: "Lindiwe replied stop.",
    leadId: "business-id",
  };
  const resolved = contactWithThreadDetails(
    listContact,
    threadContact,
    "batch-lead-id",
  );

  assert.equal(resolved?.displayName, "Corner Cottage");
  assert.equal(resolved?.hasSentOutbound, true);
  assert.equal(resolved?.businessOutreachStopped, true);
  assert.equal(resolved?.businessStopReason, "Lindiwe replied stop.");
  assert.equal(resolved?.leadId, "business-id");
});
