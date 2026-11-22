import assert from "node:assert/strict";
import test from "node:test";

const { calculateOutreachListProgress, hasAttemptedWhatsAppFirstMessage } =
  await import("./outreachListProgress.ts");

function contact(overrides = {}) {
  return {
    waId: "27825550000",
    e164: "+27825550000",
    displayName: "Example business",
    profileName: null,
    businessName: "Example business",
    website: null,
    label: null,
    leadId: "lead-1",
    ownerPubkey: null,
    threadRootEventId: null,
    lastInboundAt: null,
    lastContactedAt: null,
    lastOutboundState: null,
    lastFailureSummary: null,
    deliveryFailure: null,
    lastReplyAt: null,
    stage: "none",
    stageSetBy: "auto",
    stageChangedAt: null,
    queuedFrom: null,
    outreachStatus: null,
    hasSentOutbound: false,
    windowOpen: false,
    windowClosesAt: null,
    optedOut: false,
    paused: false,
    pauseReason: null,
    unanswered: false,
    awaitingApproval: false,
    businessOutreachStopped: false,
    businessStopReason: null,
    ...overrides,
  };
}

test("first-message predicate follows the lead-status seam and excludes queue-only contacts", () => {
  const cases = [
    { name: "no contact", value: null, inBatch: false, expected: false },
    {
      name: "queued only",
      value: contact({ stage: "queued", queuedFrom: "Batch: autumn" }),
      inBatch: true,
      expected: false,
    },
    {
      name: "sent",
      value: contact({
        lastContactedAt: "2026-11-20T09:00:00Z",
        stage: "contacted",
      }),
      inBatch: false,
      expected: true,
    },
    {
      name: "delivered",
      value: contact({ lastOutboundState: "delivered", stage: "contacted" }),
      inBatch: false,
      expected: true,
    },
    {
      name: "read",
      value: contact({ lastOutboundState: "read", stage: "contacted" }),
      inBatch: false,
      expected: true,
    },
    {
      name: "replied",
      value: contact({
        lastInboundAt: "2026-11-20T09:10:00Z",
        stage: "replied",
      }),
      inBatch: false,
      expected: true,
    },
    {
      name: "opted out before an attempt",
      value: contact({ optedOut: true, stage: "stopped" }),
      inBatch: false,
      expected: false,
    },
    {
      name: "failed not on WhatsApp",
      value: contact({ stage: "not_on_whatsapp", lastOutboundState: "failed" }),
      inBatch: false,
      expected: true,
    },
  ];

  for (const scenario of cases) {
    assert.equal(
      hasAttemptedWhatsAppFirstMessage(scenario.value, scenario.inBatch),
      scenario.expected,
      scenario.name,
    );
  }
});

test("list progress keeps no-phone and stopped leads complete without inflating messages", () => {
  const result = calculateOutreachListProgress({
    contacts: [
      contact({
        leadId: "sent",
        lastContactedAt: "2026-11-20T09:00:00Z",
        stage: "contacted",
      }),
      contact({
        leadId: "stopped",
        businessOutreachStopped: true,
        businessStopReason: "A linked contact opted out.",
      }),
    ],
    inBatchLeadIds: new Set(["queued"]),
    members: [
      {
        active: true,
        leadId: "sent",
        phone: "+27 82 555 0001",
        whatsappPhone: null,
      },
      {
        active: true,
        leadId: "no-phone",
        phone: null,
        whatsappPhone: null,
      },
      {
        active: true,
        leadId: "stopped",
        phone: "+27 82 555 0003",
        whatsappPhone: null,
      },
      {
        active: true,
        leadId: "queued",
        phone: "+27 82 555 0004",
        whatsappPhone: null,
      },
    ],
  });

  assert.deepEqual(result, {
    impossible: 2,
    messaged: 1,
    resolved: 3,
    total: 4,
  });
});
