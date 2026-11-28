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
  parseWhatsAppMedia,
  parseWhatsAppMessage,
  parseWhatsAppContact,
  parseWhatsAppStageCounts,
  parseWhatsAppStatus,
  parseWhatsAppThread,
  parseWhatsAppTemplate,
  resetWhatsAppUnknownMessageStateWarning,
  renderWhatsAppTemplate,
  whatsappDeliveryLabel,
  whatsappQueuedScheduleLabel,
  whatsappLeadStatusLabel,
  whatsappMessagePreview,
  whatsappMessageText,
  whatsappQualityLabel,
  whatsappTemplateDisplayTitle,
  whatsappTemplateMetaName,
} from "./whatsappOutreachModels.ts";
import { parseWhatsAppSafetyLedger } from "./whatsappOutreachSafety.ts";

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
    hasSentOutbound: true,
    businessOutreachStopped: true,
    businessStopReason: "Lindiwe opted out.",
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
  assert.equal(contact.lastFailureSummary, null);
  assert.equal(contact.hasSentOutbound, true);
  assert.equal(contact.businessOutreachStopped, true);
  assert.equal(contact.businessStopReason, "Lindiwe opted out.");

  const legacyContact = parseWhatsAppContact({
    ...payload,
    stageSetBy: "auto",
    lastOutboundState: undefined,
    hasSentOutbound: undefined,
    businessOutreachStopped: undefined,
    businessStopReason: undefined,
  });
  assert.equal(legacyContact.lastOutboundState, null);
  assert.equal(legacyContact.hasSentOutbound, false);
  assert.equal(legacyContact.businessOutreachStopped, false);
  assert.equal(legacyContact.businessStopReason, null);
  assert.throws(
    () => parseWhatsAppContact({ ...payload, stageSetBy: "not-a-pubkey" }),
    /invalid WhatsApp stage author/u,
  );
  assert.throws(
    () => parseWhatsAppContact({ ...payload, lastOutboundState: "queued" }),
    /invalid WhatsApp outbound state/u,
  );

  const queuedContact = parseWhatsAppContact({
    ...payload,
    stage: "queued",
    stageSetBy: "auto",
    lastContactedAt: null,
    queuedFrom: "Batch: Melville guesthouses",
    outreachStatus: "queued",
  });
  assert.equal(queuedContact.stage, "queued");
  assert.equal(queuedContact.queuedFrom, "Batch: Melville guesthouses");
  assert.equal(queuedContact.outreachStatus, "queued");

  // An older relay has no `stage: queued`, but it already exposes the queue status.
  const oldRelayQueuedContact = parseWhatsAppContact({
    ...payload,
    stage: "none",
    stageSetBy: "auto",
    lastContactedAt: null,
    queuedFrom: undefined,
    outreachStatus: "queued",
  });
  assert.equal(oldRelayQueuedContact.stage, "queued");
  assert.equal(oldRelayQueuedContact.queuedFrom, null);

  // A newer relay stage must not make an older desktop hide the contact or crash.
  const futureStageContact = parseWhatsAppContact({
    ...payload,
    stage: "future_stage",
    stageSetBy: "auto",
  });
  assert.equal(futureStageContact.stage, "none");
});

test("safety ledger parser keeps the relay's durable opt-out and business-stop evidence", () => {
  const ledger = parseWhatsAppSafetyLedger({
    suppressions: [
      {
        id: "suppression-id",
        identityKind: "phone",
        identityValue: "27821237135",
        scope: "opt_out",
        reason: "stop",
        matchedRule: "stop",
        source: "inbound",
        createdAt: "2026-11-08T08:00:00Z",
        undoneAt: null,
      },
    ],
    businessStops: [
      {
        businessId: "lead-id",
        sourceWaId: "27821237135",
        reason: "stop",
        matchedRule: "stop",
        createdAt: "2026-11-08T08:00:00Z",
      },
    ],
  });
  assert.equal(ledger.suppressions[0].scope, "opt_out");
  assert.equal(ledger.suppressions[0].reason, "stop");
  assert.equal(ledger.businessStops[0].businessId, "lead-id");
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

// The relay stores `other` for a location, a contact card and any type WhatsApp does not
// describe (crates/buzz-relay/src/whatsapp/inbound.rs `parse_message`; the database CHECK on
// `whatsapp_messages.kind` allows exactly these five). One such message used to make the
// whole chat fail with "The relay returned an invalid WhatsApp message kind."
const relayMessage = (overrides) => ({
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
  createdAt: "2026-11-17T17:27:00+02:00",
  ...overrides,
});

const sampleContact = {
  waId: "27821237135",
  e164: "+27821237135",
  displayName: "Plane Tree Guesthouse",
  profileName: "Thandeka",
  businessName: "Plane Tree Guesthouse",
  website: null,
  label: "Plane Tree",
  leadId: "lead-id",
  ownerPubkey: null,
  threadRootEventId: null,
  lastInboundAt: "2026-11-17T17:27:00+02:00",
  lastContactedAt: "2026-11-15T13:32:00+02:00",
  lastReplyAt: "2026-11-17T17:27:00+02:00",
  stage: "replied",
  stageSetBy: null,
  stageChangedAt: "2026-11-17T17:27:00+02:00",
  lastOutboundState: "read",
  windowOpen: false,
  windowClosesAt: null,
  optedOut: false,
  paused: false,
  pauseReason: null,
  unanswered: true,
  hasSentOutbound: true,
  businessOutreachStopped: false,
  businessStopReason: null,
};

test("every message kind the relay stores is accepted", () => {
  for (const kind of ["text", "template", "media", "button", "other"]) {
    assert.equal(parseWhatsAppMessage(relayMessage({ kind })).kind, kind);
  }
});

test("a chat that holds a location, a contact card or an undescribed message still opens", () => {
  const thread = parseWhatsAppThread({
    contact: sampleContact,
    messages: [
      relayMessage({ id: "m1" }),
      relayMessage({
        id: "m2",
        kind: "other",
        text: "[location] Kensington Guest House",
      }),
      relayMessage({ id: "m3", kind: "other", text: "[contact card] Sipho" }),
      relayMessage({ id: "m4", kind: "other", text: "[unsupported message]" }),
    ],
  });
  assert.deepEqual(
    thread.messages.map((message) => message.kind),
    ["text", "other", "other", "other"],
  );
  assert.equal(thread.messages[1].text, "[location] Kensington Guest House");
});

test("a kind this build does not know yet is shown as its text, never a failed chat", () => {
  const message = parseWhatsAppMessage(
    relayMessage({ kind: "poll", text: "Which day suits you?" }),
  );
  assert.equal(message.kind, "other");
  assert.equal(message.text, "Which day suits you?");
  assert.equal(whatsappMessageText(message), "Which day suits you?");
});

test("the relay's stand-in for an undescribed message reads as a plain sentence", () => {
  const undescribed = parseWhatsAppMessage(
    relayMessage({ kind: "other", text: "[unsupported message]" }),
  );
  const sentence = "Sent a message type that cannot be shown here";
  assert.equal(whatsappMessageText(undescribed), sentence);
  assert.equal(whatsappMessagePreview(undescribed), sentence);
  // Only the stand-in is reworded: a person who types the same words keeps them.
  const typed = parseWhatsAppMessage(
    relayMessage({ kind: "text", text: "[unsupported message]" }),
  );
  assert.equal(whatsappMessageText(typed), "[unsupported message]");
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
  assert.equal(status.accountRetryCount, 0);
  assert.equal(status.ownerPaused, false);
  assert.equal(status.ownerPausedBy, null);
  assert.equal(status.ownerPausedAt, null);
  assert.equal(
    parseWhatsAppStatus(baseStatus({ accountRetryCount: 63 }))
      .accountRetryCount,
    63,
  );
  assert.equal(whatsappQualityLabel(status.quality), "Green");
});

test("status parser preserves an additive owner pause identity and time", () => {
  const status = parseWhatsAppStatus(
    baseStatus({
      sendingPaused: true,
      pauseReason: "owner paused",
      ownerPaused: true,
      ownerPausedBy: "a".repeat(64),
      ownerPausedAt: "2026-11-07T10:42:00Z",
    }),
  );
  assert.equal(status.ownerPaused, true);
  assert.equal(status.ownerPausedBy, "a".repeat(64));
  assert.equal(status.ownerPausedAt, "2026-11-07T10:42:00Z");
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

const inboundMessage = {
  id: "m1",
  waId: "27821234567",
  direction: "in",
  kind: "media",
  text: "[sticker]",
  templateName: null,
  state: "read",
  errorCode: null,
  errorText: null,
  eventId: null,
  senderPubkey: null,
  createdAt: "2026-11-02T07:41:10Z",
};

test("a sticker message keeps its stored media so the app can show it", () => {
  const message = parseWhatsAppMessage({
    ...inboundMessage,
    media: {
      type: "sticker",
      state: "stored",
      url: "https://acme.example/media/abc.webp",
      mime: "image/webp",
      size: 900,
      opaque: false,
      animated: true,
      canRetry: false,
      description: "Customer sent a sticker",
    },
  });
  assert.equal(message.media?.type, "sticker");
  assert.equal(message.media?.url, "https://acme.example/media/abc.webp");
  assert.equal(message.media?.animated, true);
  assert.equal(whatsappMessagePreview(message), "Sent a sticker");
});

test("a message from an older relay has no media and keeps its text", () => {
  const message = parseWhatsAppMessage({ ...inboundMessage, text: "Hello" });
  assert.equal("media" in message, false);
  assert.equal(whatsappMessagePreview(message), "Hello");
});

test("payment failures carry a safe account recovery scope while older relays fail closed", () => {
  const paymentFailure = parseWhatsAppMessage({
    ...inboundMessage,
    direction: "out",
    kind: "template",
    state: "failed",
    errorCode: "131042",
    errorText: "Business eligibility payment issue",
    failureSummary:
      "Meta blocked this send: payment problem on your WhatsApp account.",
    retryScope: "account",
    canRetry: true,
  });
  assert.equal(paymentFailure.retryScope, "account");
  assert.equal(paymentFailure.canRetry, true);
  assert.match(paymentFailure.failureSummary, /payment problem/u);
  const unknownScope = parseWhatsAppMessage({
    ...paymentFailure,
    retryScope: "future-retry-scope",
    canRetry: true,
  });
  assert.equal(unknownScope.retryScope, null);
  assert.equal(unknownScope.canRetry, false);
});

test("a media record the app cannot read never hides the conversation", () => {
  assert.equal(parseWhatsAppMedia(null), null);
  assert.equal(parseWhatsAppMedia("sticker"), null);
  assert.equal(parseWhatsAppMedia({ type: "hologram" }), null);
  const message = parseWhatsAppMessage({
    ...inboundMessage,
    media: { type: "hologram" },
  });
  assert.equal(message.media, null);
  assert.equal(whatsappMessagePreview(message), "[sticker]");
  // A state the app does not know reads as a failed download, which offers the honest note.
  assert.equal(
    parseWhatsAppMedia({ type: "image", state: "weird" })?.state,
    "failed",
  );
});

test("previews say what was sent and keep the caption", () => {
  const preview = (media) =>
    whatsappMessagePreview(
      parseWhatsAppMessage({ ...inboundMessage, text: "x", media }),
    );
  assert.equal(preview({ type: "image", state: "pending" }), "Sent a photo");
  assert.equal(
    preview({ type: "image", state: "stored", caption: "our garden" }),
    "Sent a photo: our garden",
  );
  assert.equal(
    preview({ type: "voice", state: "stored" }),
    "Sent a voice note",
  );
  assert.equal(
    preview({ type: "document", state: "stored", filename: "quote.pdf" }),
    "Sent quote.pdf",
  );
  assert.equal(
    preview({ type: "location", state: "none", name: "Guest House" }),
    "Shared a location: Guest House",
  );
  assert.equal(
    preview({ type: "contacts", state: "none", contacts: [] }),
    "Shared a contact card",
  );
});

test("contact cards keep names and numbers and drop malformed entries", () => {
  const media = parseWhatsAppMedia({
    type: "contacts",
    state: "none",
    contacts: [
      { name: "Sipho", phones: ["+27 82 111 2222", 5, null] },
      "nope",
      { phones: "bad" },
    ],
  });
  assert.deepEqual(
    media?.contacts.map((card) => [card.name, card.phones]),
    [
      ["Sipho", ["+27 82 111 2222"]],
      [null, []],
    ],
  );
});

const goodCounts = {
  contacts: [],
  nextCursor: null,
  stageCounts: { contacted: 174, replied: 12, mystery_future_stage: 9 },
  failedNotContacted: 3,
  totalContacts: 450,
  countsTruncated: false,
};

test("a lead that is ready to call keeps its stage and its call brief", () => {
  const base = {
    waId: "27821237135",
    e164: "+27821237135",
    displayName: "Plane Tree Guesthouse",
    leadId: null,
    ownerPubkey: null,
    threadRootEventId: null,
    lastInboundAt: null,
    windowOpen: false,
    windowClosesAt: null,
    optedOut: false,
    paused: false,
    pauseReason: null,
    unanswered: false,
  };
  const ready = parseWhatsAppContact({
    ...base,
    stage: "ready_to_call",
    callBrief: {
      link: "https://preview.example/plane-tree",
      note: "Wants the booking page first.",
      assigneePubkey: "ab".repeat(32),
      updatedBy: "cd".repeat(32),
      updatedAt: "2026-11-28T10:00:00+00:00",
    },
  });
  assert.equal(ready.stage, "ready_to_call");
  assert.deepEqual(ready.callBrief, {
    link: "https://preview.example/plane-tree",
    note: "Wants the booking page first.",
    assigneePubkey: "ab".repeat(32),
    updatedBy: "cd".repeat(32),
    updatedAt: "2026-11-28T10:00:00+00:00",
  });
  // An older relay sends no brief, and a broken one never fails the contact.
  assert.equal(parseWhatsAppContact(base).callBrief, null);
  assert.equal(
    parseWhatsAppContact({ ...base, callBrief: "not a brief" }).callBrief,
    null,
  );
  // A stage this build does not know yet still reads as "none", not as an error.
  assert.equal(
    parseWhatsAppContact({ ...base, stage: "a_future_stage" }).stage,
    "none",
  );
  // The relay counts the new stage like any other.
  assert.equal(
    parseWhatsAppStageCounts({
      stageCounts: { ready_to_call: 4 },
      failedNotContacted: 0,
      totalContacts: 4,
      countsTruncated: false,
    }).stageCounts.ready_to_call,
    4,
  );
});

test("stage counts parse, ignore unknown stages and read a missing stage as absent", () => {
  const counts = parseWhatsAppStageCounts(goodCounts);
  assert.deepEqual(counts, {
    stageCounts: { contacted: 174, replied: 12 },
    failedNotContacted: 3,
    totalContacts: 450,
    countsTruncated: false,
  });
  assert.equal(counts.stageCounts.client, undefined);
});

test("an answer without stageCounts is an older relay and reads as null", () => {
  assert.equal(parseWhatsAppStageCounts({ contacts: [] }), null);
});

test("stage counts with wrong types are refused", () => {
  const bad = [
    { ...goodCounts, stageCounts: [] },
    { ...goodCounts, stageCounts: null },
    { ...goodCounts, stageCounts: { contacted: "174" } },
    { ...goodCounts, stageCounts: { contacted: -1 } },
    { ...goodCounts, stageCounts: { contacted: 1.5 } },
    { ...goodCounts, failedNotContacted: undefined },
    { ...goodCounts, failedNotContacted: -2 },
    { ...goodCounts, totalContacts: "450" },
    { ...goodCounts, countsTruncated: "no" },
    "not an object",
  ];
  for (const value of bad) {
    assert.throws(() => parseWhatsAppStageCounts(value), /WhatsApp|relay/u);
  }
});
