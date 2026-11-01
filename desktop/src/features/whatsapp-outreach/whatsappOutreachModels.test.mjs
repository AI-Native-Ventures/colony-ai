import assert from "node:assert/strict";
import test from "node:test";

import {
  contactWhatsAppStatus,
  formatWhatsAppPhoneNumber,
  getWhatsAppDailyCapProgress,
  isWhatsAppPhoneLikeName,
  formatWhatsAppNumber,
  isWhatsAppReplyWindowOpen,
  maskWhatsAppNumber,
  parseWhatsAppBatchDetail,
  parseWhatsAppMessage,
  parseWhatsAppContact,
  parseWhatsAppStatus,
  parseWhatsAppTemplate,
  resetWhatsAppUnknownMessageStateWarning,
  renderWhatsAppTemplate,
  whatsappDeliveryLabel,
  whatsappQueuedScheduleLabel,
  whatsappLeadStatusLabel,
  whatsappQualityLabel,
  whatsappTemplateDisplayTitle,
  whatsappTemplateMetaName,
} from "./whatsappOutreachModels.ts";

const approvedTemplate = {
  title: "Built a site for you",
  name: "hl_vb",
  proposedTitle: null,
  titleCustom: false,
  language: "en",
  category: "MARKETING",
  status: "APPROVED",
  body: "Hey {{1}}, see your {{2}} preview.",
  slots: 2,
  buttons: [{ type: "QUICK_REPLY", text: "Yes, I'm interested" }],
};

test("contact parser accepts the additive stage and identity view fields", () => {
  const payload = {
    waId: "27821237135",
    e164: "+27821237135",
    displayName: "Plane Tree Guesthouse",
    profileName: "Thandeka",
    businessName: "Plane Tree Guesthouse",
    website: "https://form-field.example",
    label: "Plane Tree",
    leadId: "lead-id",
    ownerPubkey: null,
    threadRootEventId: null,
    lastInboundAt: "2026-10-29T09:14:00+02:00",
    lastContactedAt: "2026-10-28T09:40:00+02:00",
    lastReplyAt: "2026-10-29T09:14:00+02:00",
    stage: "wants_call",
    stageSetBy: "deadbeef".repeat(8),
    stageChangedAt: "2026-10-29T09:14:00+02:00",
    lastOutboundState: "read",
    windowOpen: true,
    windowClosesAt: "2026-10-30T09:14:00+02:00",
    optedOut: false,
    paused: false,
    pauseReason: null,
    unanswered: true,
  };
  const contact = parseWhatsAppContact(payload);
  assert.equal(contact.stage, "wants_call");
  assert.equal(contact.profileName, "Thandeka");
  assert.equal(contact.businessName, "Plane Tree Guesthouse");
  assert.equal(contact.website, "https://form-field.example");
  assert.equal(contact.label, "Plane Tree");
  assert.equal(contact.stageSetBy, "deadbeef".repeat(8));
  assert.equal(contact.lastContactedAt, "2026-10-28T09:40:00+02:00");
  assert.equal(contact.lastReplyAt, "2026-10-29T09:14:00+02:00");
  assert.equal(contact.lastOutboundState, "read");

  const legacyContact = parseWhatsAppContact({
    ...payload,
    stageSetBy: "auto",
    lastOutboundState: undefined,
  });
  assert.equal(legacyContact.lastOutboundState, null);
  assert.throws(
    () => parseWhatsAppContact({ ...payload, stageSetBy: "not-a-pubkey" }),
    /invalid WhatsApp stage author/u,
  );
  assert.throws(
    () => parseWhatsAppContact({ ...payload, lastOutboundState: "queued" }),
    /invalid WhatsApp outbound state/u,
  );
});

function baseStatus(overrides = {}) {
  return {
    connected: true,
    connectionId: "connection-id",
    displayPhoneNumber: "+27 61 534 0627",
    verifiedName: "Horizon Labs",
    quality: "GREEN",
    phoneStatus: "CONNECTED",
    dailyNewChatCap: 30,
    newChatsSentToday: 12,
    sendingPaused: false,
    pauseReason: null,
    issues: [],
    outreachChannelId: "outreach-channel-id",
    templatesSyncedAt: "2026-10-29T08:00:00Z",
    templates: [approvedTemplate],
    webhookUrl: "https://relay.test/hooks/whatsapp/id",
    ...overrides,
  };
}

test("reply window is open before, but not at, the 24 hour boundary", () => {
  const inboundAt = Date.parse("2026-10-29T08:00:00Z");
  assert.equal(isWhatsAppReplyWindowOpen(null, inboundAt), false);
  assert.equal(isWhatsAppReplyWindowOpen("invalid", inboundAt), false);
  assert.equal(isWhatsAppReplyWindowOpen(inboundAt, inboundAt), true);
  assert.equal(
    isWhatsAppReplyWindowOpen(inboundAt, inboundAt + 23 * 60 * 60 * 1000),
    true,
  );
  assert.equal(
    isWhatsAppReplyWindowOpen(inboundAt, inboundAt + 24 * 60 * 60 * 1000),
    false,
  );
  assert.equal(isWhatsAppReplyWindowOpen(inboundAt, inboundAt - 1), false);
});

test("unnamed South African contacts use one readable phone display", () => {
  assert.equal(formatWhatsAppPhoneNumber("+27683735905"), "+27 68 373 5905");
  assert.equal(formatWhatsAppPhoneNumber("27 68 373 5905"), "+27 68 373 5905");
  assert.equal(formatWhatsAppPhoneNumber("+1 202 555 0100"), "+1 202 555 0100");
  assert.equal(isWhatsAppPhoneLikeName("+27683735905"), true);
  assert.equal(isWhatsAppPhoneLikeName("+27 68 373 5905"), true);
  assert.equal(isWhatsAppPhoneLikeName("Corner Cottage"), false);
});

test("inbound received state maps to read and unknown states are omitted", () => {
  const message = {
    id: "message-id",
    waId: "27821237135",
    direction: "in",
    kind: "text",
    text: "Message text.",
    templateName: null,
    state: "received",
    errorCode: null,
    errorText: null,
    eventId: null,
    senderPubkey: null,
    createdAt: "2026-10-31T09:00:00+02:00",
  };
  assert.equal(parseWhatsAppMessage(message).state, "read");

  const warnings = [];
  const originalWarn = console.warn;
  resetWhatsAppUnknownMessageStateWarning();
  console.warn = (...args) => warnings.push(args);
  try {
    const unknown = {
      ...message,
      direction: "out",
      state: "received_by_carrier",
    };
    assert.equal(parseWhatsAppMessage(unknown).state, null);
    assert.equal(parseWhatsAppMessage(unknown).state, null);
  } finally {
    console.warn = originalWarn;
    resetWhatsAppUnknownMessageStateWarning();
  }
  assert.equal(warnings.length, 1);
});

test("daily cap progress handles zero, the cap, and over-cap counts", () => {
  assert.deepEqual(getWhatsAppDailyCapProgress(12, 30), {
    sent: 12,
    cap: 30,
    remaining: 18,
    percentage: 40,
  });
  assert.deepEqual(getWhatsAppDailyCapProgress(30, 30), {
    sent: 30,
    cap: 30,
    remaining: 0,
    percentage: 100,
  });
  assert.deepEqual(getWhatsAppDailyCapProgress(35, 30), {
    sent: 35,
    cap: 30,
    remaining: 0,
    percentage: 100,
  });
  assert.deepEqual(getWhatsAppDailyCapProgress(4, 0), {
    sent: 4,
    cap: 0,
    remaining: 0,
    percentage: 0,
  });
  assert.deepEqual(getWhatsAppDailyCapProgress(-1, 2000), {
    sent: 0,
    cap: 1000,
    remaining: 1000,
    percentage: 0,
  });
});

test("template previews use ordered params and keep the display title primary", () => {
  const template = parseWhatsAppTemplate(approvedTemplate);
  assert.equal(whatsappTemplateDisplayTitle(template), "Built a site for you");
  assert.equal(whatsappTemplateMetaName(template, false), null);
  assert.equal(whatsappTemplateMetaName(template, true), "hl_vb");
  assert.equal(
    renderWhatsAppTemplate(template.body, ["Pam", "guesthouse"]),
    "Hey Pam, see your guesthouse preview.",
  );
  assert.equal(
    renderWhatsAppTemplate("{{1}} and {{2}}", ["only one"]),
    "only one and {{2}}",
  );
});

test("status parser strips unknown secret fields and clamps invalid cap ranges", () => {
  const status = parseWhatsAppStatus(
    baseStatus({
      accessToken: "fake-secret-that-must-not-escape",
      dailyNewChatCap: -3,
    }),
  );
  assert.equal(status.dailyNewChatCap, 0);
  assert.equal("accessToken" in status, false);
  assert.equal(status.templates[0].name, "hl_vb");
  assert.equal(status.quality, "green");
  assert.equal(whatsappQualityLabel(status.quality), "Green");
});

test("status precedence keeps an opted-out contact locked", () => {
  assert.equal(
    contactWhatsAppStatus({
      optedOut: true,
      replied: true,
      sent: true,
      inBatch: true,
    }),
    "opted-out",
  );
  assert.equal(
    contactWhatsAppStatus({
      optedOut: false,
      replied: false,
      sent: false,
      inBatch: true,
    }),
    "in-batch",
  );
  assert.equal(
    contactWhatsAppStatus({
      optedOut: false,
      replied: false,
      sent: true,
      inBatch: true,
    }),
    "in-batch",
  );
  assert.equal(whatsappLeadStatusLabel("opted-out"), "Opted out");
  assert.equal(whatsappLeadStatusLabel("in-batch"), "In batch");
});

test("South African phone masking preserves only the prefix and final four", () => {
  assert.equal(maskWhatsAppNumber("+27615340627"), "+27 61 *** 0627");
  assert.equal(formatWhatsAppNumber("27821237135"), "+27 82 123 7135");
});

test("delivery states have visible text equivalents, including failures", () => {
  assert.equal(whatsappDeliveryLabel("read"), "Read");
  assert.equal(whatsappDeliveryLabel("delivered"), "Delivered");
  assert.equal(
    whatsappDeliveryLabel("failed", "Number is not on WhatsApp"),
    "Failed: Number is not on WhatsApp",
  );
  assert.equal(whatsappDeliveryLabel("draft"), "Draft, needs approval");
  assert.equal(
    whatsappDeliveryLabel(
      "queued",
      null,
      "2026-10-30T08:15:00+02:00",
      Date.parse("2026-10-30T08:00:00+02:00"),
    ),
    "Sends today at 08:15",
  );
  assert.equal(whatsappDeliveryLabel("queued"), "Queued to send");
  assert.equal(
    whatsappDeliveryLabel("unconfirmed"),
    "Unconfirmed, check before retrying",
  );
});

test("queued send labels use the South African send date and time", () => {
  const now = Date.parse("2026-10-30T08:00:00+02:00");
  assert.equal(
    whatsappQueuedScheduleLabel("2026-10-30T08:15:00+02:00", now),
    "Sends today at 08:15",
  );
  assert.equal(
    whatsappQueuedScheduleLabel("2026-10-31T08:00:00+02:00", now),
    "Sends tomorrow at 08:00",
  );
  assert.equal(whatsappQueuedScheduleLabel(null, now), "Queued to send");
  assert.equal(
    whatsappQueuedScheduleLabel("2026-10-29T08:00:00+02:00", now),
    "Queued to send",
  );
});

test("pending batch details preserve the held row preview and linked lead", () => {
  const batch = parseWhatsAppBatchDetail({
    batchId: "batch-id",
    status: "pending",
    createdBy: "owner-pubkey",
    template: "hl_vb",
    language: "en",
    note: null,
    materialLinks: [],
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-10-30T08:00:00Z",
    rows: [
      {
        idx: 0,
        to: "+27821234410",
        leadId: "jacaranda-lead-id",
        params: ["guesthouses"],
        preview: "Hey Pam, here is your guesthouse preview.",
        state: "held",
        skipReason: null,
        sendsAt: "2026-10-30T08:15:00+02:00",
      },
    ],
    counts: { total: 1, ready: 1, sent: 0, failed: 0, dropped: 0 },
  });

  assert.equal(batch.status, "pending");
  assert.equal(batch.rows[0].state, "held");
  assert.equal(batch.rows[0].leadId, "jacaranda-lead-id");
  assert.equal(batch.rows[0].sendsAt, "2026-10-30T08:15:00+02:00");
  assert.equal(
    batch.rows[0].preview,
    "Hey Pam, here is your guesthouse preview.",
  );
});
