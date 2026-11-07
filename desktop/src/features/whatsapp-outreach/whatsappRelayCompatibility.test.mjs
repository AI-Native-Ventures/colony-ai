import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWhatsAppContact,
  parseWhatsAppStatus,
} from "./whatsappOutreachModels.ts";

// Schema fixture extracted from tag desktop-v3.0.37's strict contact parser on 2026-11-05. It
// intentionally has no `queued` stage. Keep this fixture strict: the relay's Rust projection
// test supplies the matching production seam that must create this wire shape when no capability
// is sent.
const V3037_STAGES = new Set([
  "none",
  "contacted",
  "replied",
  "wants_call",
  "call_booked",
  "quote_sent",
  "client",
  "no_thanks",
  "stopped",
  "not_on_whatsapp",
]);

// Schema fixture extracted from tag desktop-v3.0.38's contact/status parser on 2026-11-05. This
// release added `queued`, `outreachStatus`, and Slice 1's optional accountRetryCount, but not
// Slice 2's health objects. It must still ignore the additive fields below.
const V3038_STAGES = new Set([...V3037_STAGES, "queued"]);
const V3038_OUTREACH_STATUSES = new Set([
  "none",
  "waiting_for_approval",
  "queued",
  "sent",
  "replied",
  "opted_out",
]);

function v3037Record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The relay returned an unreadable WhatsApp ${label}.`);
  }
  return value;
}

function v3037String(value, label) {
  if (typeof value !== "string") {
    throw new Error(`The relay returned an invalid WhatsApp ${label}.`);
  }
  return value;
}

function v3037NullableString(value, label) {
  return value === undefined || value === null
    ? null
    : v3037String(value, label);
}

function v3037Boolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`The relay returned an invalid WhatsApp ${label}.`);
  }
  return value;
}

function parseV3037Contact(value) {
  const contact = v3037Record(value, "contact");
  const stage = contact.stage ?? "none";
  if (typeof stage !== "string" || !V3037_STAGES.has(stage)) {
    throw new Error("The relay returned an invalid WhatsApp contact stage.");
  }
  const stageSetBy = contact.stageSetBy;
  if (
    stageSetBy !== null &&
    stageSetBy !== undefined &&
    stageSetBy !== "auto" &&
    (typeof stageSetBy !== "string" || !/^[0-9a-f]{64}$/iu.test(stageSetBy))
  ) {
    throw new Error("The relay returned an invalid WhatsApp stage author.");
  }
  const outbound = contact.lastOutboundState;
  if (
    outbound !== null &&
    outbound !== undefined &&
    !["sent", "delivered", "read", "failed"].includes(outbound)
  ) {
    throw new Error("The relay returned an invalid WhatsApp outbound state.");
  }
  return {
    waId: v3037String(contact.waId, "WhatsApp id"),
    e164: v3037String(contact.e164, "contact phone number"),
    displayName: v3037NullableString(contact.displayName, "contact name"),
    profileName: v3037NullableString(
      contact.profileName,
      "WhatsApp profile name",
    ),
    businessName: v3037NullableString(contact.businessName, "business name"),
    website: v3037NullableString(contact.website, "business website"),
    label: v3037NullableString(contact.label, "contact label"),
    leadId: v3037NullableString(contact.leadId, "lead id"),
    ownerPubkey: v3037NullableString(contact.ownerPubkey, "owner pubkey"),
    threadRootEventId: v3037NullableString(
      contact.threadRootEventId,
      "thread root id",
    ),
    lastInboundAt: v3037NullableString(
      contact.lastInboundAt,
      "last inbound time",
    ),
    lastContactedAt: v3037NullableString(
      contact.lastContactedAt,
      "last contacted time",
    ),
    lastReplyAt: v3037NullableString(contact.lastReplyAt, "last reply time"),
    stage,
    stageSetBy: stageSetBy ?? null,
    stageChangedAt: v3037NullableString(
      contact.stageChangedAt,
      "stage changed time",
    ),
    lastOutboundState: outbound ?? null,
    windowOpen: v3037Boolean(contact.windowOpen, "reply-window flag"),
    windowClosesAt: v3037NullableString(
      contact.windowClosesAt,
      "reply-window close time",
    ),
    optedOut: v3037Boolean(contact.optedOut, "opt-out flag"),
    paused: v3037Boolean(contact.paused, "contact-paused flag"),
    pauseReason: v3037NullableString(
      contact.pauseReason,
      "contact pause reason",
    ),
    unanswered: v3037Boolean(contact.unanswered, "unanswered flag"),
    awaitingApproval: contact.awaitingApproval === true,
  };
}

function parseV3037Status(value) {
  const status = v3037Record(value, "status");
  const quality = status.quality;
  if (
    quality !== null &&
    !["GREEN", "YELLOW", "RED", "green", "yellow", "red"].includes(quality)
  ) {
    throw new Error("The relay returned an invalid WhatsApp quality rating.");
  }
  return {
    connected: v3037Boolean(status.connected, "connected flag"),
    connectionId: v3037NullableString(status.connectionId, "connection id"),
    dailyNewChatCap: status.dailyNewChatCap,
    newChatsSentToday: status.newChatsSentToday,
    sendingPaused: v3037Boolean(status.sendingPaused, "sending-paused flag"),
    pauseReason: v3037NullableString(status.pauseReason, "pause reason"),
    templates: Array.isArray(status.templates) ? status.templates : [],
  };
}

function parseV3038Status(value) {
  const status = v3037Record(value, "status");
  const legacy = parseV3037Status(status);
  const retryCount = status.accountRetryCount;
  if (
    retryCount !== undefined &&
    (typeof retryCount !== "number" ||
      !Number.isFinite(retryCount) ||
      !Number.isInteger(retryCount))
  ) {
    throw new Error("The relay returned an invalid account retry count.");
  }
  return {
    ...legacy,
    accountRetryCount: retryCount === undefined ? 0 : Math.max(0, retryCount),
  };
}

function parseV3038Contact(value) {
  const contact = v3037Record(value, "contact");
  const rawStage = typeof contact.stage === "string" ? contact.stage : "none";
  const outreachStatus =
    typeof contact.outreachStatus === "string" &&
    V3038_OUTREACH_STATUSES.has(contact.outreachStatus)
      ? contact.outreachStatus
      : null;
  const stage = V3038_STAGES.has(rawStage)
    ? rawStage
    : outreachStatus === "queued"
      ? "queued"
      : "none";
  const legacyShape = parseV3037Contact({ ...contact, stage: "none" });
  return {
    ...legacyShape,
    stage: stage === "none" && outreachStatus === "queued" ? "queued" : stage,
    outreachStatus,
  };
}

const relayOutput = {
  status: {
    connected: true,
    connectionId: "connection-id",
    displayPhoneNumber: "+27 61 534 0627",
    verifiedName: "Horizon Labs",
    quality: "GREEN",
    phoneStatus: "CONNECTED",
    dailyNewChatCap: 30,
    newChatsSentToday: 12,
    accountRetryCount: 63,
    sendingPaused: true,
    pauseReason: "owner paused",
    // Additive fields must not make strict older desktop parsers reject this response.
    ownerPaused: true,
    ownerPausedBy: "a".repeat(64),
    ownerPausedAt: "2026-11-07T10:42:00Z",
    issues: [],
    outreachChannelId: "outreach-channel-id",
    templatesSyncedAt: "2026-11-05T08:00:00Z",
    templates: [],
    webhookUrl: "https://relay.test/hooks/whatsapp/id",
    // New Slice 2 fields must be safely ignored by installed desktops.
    sendHealth: {
      code: "131042",
      message:
        "Meta blocked this send: payment problem on your WhatsApp account. Fix it in Meta Business Suite, WhatsApp Manager, Payment settings, then send again.",
      banner:
        "WhatsApp stopped sending. Meta says there is a payment problem on your WhatsApp Business account. Nothing was lost: 63 messages are waiting. Fix it in Meta, then press Resume and retry.",
      fixSteps: ["Open Meta Business Suite."],
      fixUrl:
        "https://business.facebook.com/latest/whatsapp_manager/payment_settings",
      at: "2026-11-05T08:14:00Z",
      paused: true,
      resumeRequestedAt: null,
      waitingCount: 63,
    },
    healthSummary: { notDeliveredByMeta: 12 },
  },
  // This is the output from a request without the queued-stage capability. `outreachStatus`
  // remains an old, permissive string while strict `stage` stays inside the v3.0.37 enum.
  contact: {
    waId: "27726480186",
    e164: "+27 72 648 0186",
    displayName: "Lethabong Boutique Guest House",
    profileName: "Lethabong Boutique Guest House",
    businessName: "Lethabong Boutique Guest House",
    website: null,
    label: null,
    leadId: null,
    ownerPubkey: null,
    threadRootEventId: null,
    lastInboundAt: null,
    lastContactedAt: "2026-11-05T08:14:00Z",
    lastReplyAt: null,
    lastOutboundState: "failed",
    stage: "none",
    stageSetBy: "auto",
    stageChangedAt: "2026-11-05T08:14:00Z",
    outreachStatus: "queued",
    queuedFrom: null,
    lastFailureSummary:
      "Meta did not deliver this one. Meta limits marketing messages to people who have not been engaging with businesses. You were not charged. Try again in a few days or reach them another way.",
    deliveryFailure: {
      code: "131049",
      summary:
        "Meta did not deliver this one. Meta limits marketing messages to people who have not been engaging with businesses. You were not charged. Try again in a few days or reach them another way.",
      retryAfter: null,
      canRetryLater: true,
    },
    windowOpen: false,
    windowClosesAt: null,
    optedOut: false,
    paused: true,
    pauseReason: "Meta error 131049",
    unanswered: false,
    awaitingApproval: false,
  },
};

test("Slice 2 relay output parses on desktop-v3.0.37 and desktop-v3.0.38", () => {
  assert.equal(V3037_STAGES.has("queued"), false);
  assert.doesNotThrow(() => parseV3037Status(relayOutput.status));
  assert.doesNotThrow(() => parseV3037Contact(relayOutput.contact));
  assert.doesNotThrow(() => parseV3038Status(relayOutput.status));
  assert.doesNotThrow(() => parseV3038Contact(relayOutput.contact));
  assert.doesNotThrow(() => parseWhatsAppStatus(relayOutput.status));
  assert.doesNotThrow(() => parseWhatsAppContact(relayOutput.contact));
  assert.equal(parseV3038Contact(relayOutput.contact).stage, "queued");
  assert.equal(
    parseWhatsAppStatus(relayOutput.status).sendHealth?.code,
    "131042",
  );
  assert.equal(parseWhatsAppStatus(relayOutput.status).ownerPaused, true);
  assert.equal(
    parseWhatsAppStatus(relayOutput.status).ownerPausedBy,
    "a".repeat(64),
  );
  assert.equal(
    parseWhatsAppContact(relayOutput.contact).deliveryFailure?.code,
    "131049",
  );
  // If a relay leaks this v3.0.38 enum value to v3.0.37, the old parser rejects the response.
  assert.throws(
    () => parseV3037Contact({ ...relayOutput.contact, stage: "queued" }),
    /invalid WhatsApp contact stage/u,
  );
});
