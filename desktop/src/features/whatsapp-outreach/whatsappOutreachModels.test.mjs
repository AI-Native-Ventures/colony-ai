import assert from "node:assert/strict";
import test from "node:test";

import {
  contactWhatsAppStatus,
  getWhatsAppDailyCapProgress,
  isWhatsAppReplyWindowOpen,
  maskWhatsAppNumber,
  parseWhatsAppStatus,
  parseWhatsAppTemplate,
  renderWhatsAppTemplate,
  whatsappDeliveryLabel,
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
    whatsappDeliveryLabel("unconfirmed"),
    "Unconfirmed, check before retrying",
  );
});
