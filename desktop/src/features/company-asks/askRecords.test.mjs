import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_ASK_HEAD } from "@/shared/constants/kinds";
import { askIdFromAction, decodeRelayAskHead } from "./askRecords.ts";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const ASK_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const THREAD_ROOT = "a".repeat(64);
const RELAY_SECRET = generateSecretKey();
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const OTHER_SECRET = generateSecretKey();

function headContent(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    askId: ASK_ID,
    status: "open",
    askerPubkey: "d".repeat(64),
    createdAt: "2026-09-27T08:00:00Z",
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "approval",
      category: "general",
      title: "Approve the launch plan",
      threadRootEventId: THREAD_ROOT,
      addresseePubkey: "e".repeat(64),
      decideBy: "2026-09-28T08:00:00Z",
    },
    resolution: null,
    cancellation: null,
    sourceActionEventId: "b".repeat(64),
    ...overrides,
  });
}

function signHead({
  secret = RELAY_SECRET,
  content = headContent(),
  tags = [
    ["h", CHANNEL_ID],
    ["d", `channel:${CHANNEL_ID}:ask:${ASK_ID}`],
    ["e", THREAD_ROOT],
  ],
} = {}) {
  return finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: 1_790_467_200,
      content,
      tags,
    },
    secret,
  );
}

test("decodeRelayAskHead accepts a verified relay head at its channel coordinate", () => {
  const event = signHead();
  const decoded = decodeRelayAskHead(event, RELAY_PUBKEY, CHANNEL_ID);

  assert.equal(decoded?.channelId, CHANNEL_ID);
  assert.equal(decoded?.head.askId, ASK_ID);
  assert.equal(decoded?.head.ask.type, "approval");
  assert.equal(decoded?.event.id, event.id);
});

test("decodeRelayAskHead rejects user signatures, duplicate coordinates, and wrong channels", () => {
  const validTags = [
    ["h", CHANNEL_ID],
    ["d", `channel:${CHANNEL_ID}:ask:${ASK_ID}`],
  ];
  assert.equal(
    decodeRelayAskHead(signHead({ secret: OTHER_SECRET }), RELAY_PUBKEY),
    null,
  );
  assert.equal(
    decodeRelayAskHead(
      signHead({ tags: [...validTags, ["h", CHANNEL_ID]] }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    decodeRelayAskHead(
      signHead(),
      RELAY_PUBKEY,
      "9dae0116-799b-5071-a0a8-fdd30a91a35d",
    ),
    null,
  );
  assert.equal(
    decodeRelayAskHead(
      signHead({
        tags: [validTags[0], ["d", `channel:${CHANNEL_ID}:ask:other`]],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("decodeRelayAskHead rejects a tampered signature and reports malformed signed content", () => {
  const event = signHead();
  const tamperedEvent = JSON.parse(JSON.stringify(event));
  tamperedEvent.content = `${tamperedEvent.content} `;
  assert.equal(decodeRelayAskHead(tamperedEvent, RELAY_PUBKEY), null);
  assert.throws(
    () => decodeRelayAskHead(signHead({ content: "{" }), RELAY_PUBKEY),
    /invalid ask head/i,
  );
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: headContent({ status: "new" }) }),
        RELAY_PUBKEY,
      ),
    /unsupported shape/i,
  );
});

test("decodeRelayAskHead accepts and validates member-position proposal asks", () => {
  const memberPubkey = "f".repeat(64);
  const content = headContent({
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "approval",
      category: "general",
      title: "Change reporting line",
      threadRootEventId: THREAD_ROOT,
      addresseePubkey: "e".repeat(64),
      subject: { kind: "companyMember", id: memberPubkey },
      memberProposal: {
        schemaVersion: 1,
        pubkey: memberPubkey,
        action: "set_title",
        expectedHeadEventId: "a".repeat(64),
        title: "Operations lead",
      },
    },
  });
  const decoded = decodeRelayAskHead(signHead({ content }), RELAY_PUBKEY);
  assert.equal(decoded?.head.ask.memberProposal?.pubkey, memberPubkey);

  const invalid = headContent({
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "question",
      category: "general",
      title: "Change reporting line",
      threadRootEventId: THREAD_ROOT,
      addresseePubkey: "e".repeat(64),
      subject: { kind: "companyMember", id: memberPubkey },
      memberProposal: {
        schemaVersion: 1,
        pubkey: memberPubkey,
        action: "set_title",
        expectedHeadEventId: "a".repeat(64),
        title: "Operations lead",
      },
    },
  });
  assert.throws(
    () => decodeRelayAskHead(signHead({ content: invalid }), RELAY_PUBKEY),
    /malformed member-position proposal/i,
  );
});

test("decodeRelayAskHead accepts typed allowance proposals and rejects malformed values", () => {
  const employeePubkey = "f".repeat(64);
  const proposal = {
    schemaVersion: 1,
    employeePubkey,
    expectedHeadEventId: "c".repeat(64),
    allowance: { amountCents: "10000", period: "week" },
    temporaryAllowance: {
      allowance: { amountCents: "12550", period: "week" },
      expiresAt: "2026-10-05T23:59:59.999Z",
    },
    fundingOrder: ["Configured source"],
  };
  const makeContent = (spendAllowanceProposal) =>
    headContent({
      ask: {
        schemaVersion: 1,
        askId: ASK_ID,
        type: "approval",
        category: "money",
        title: "Allowance change request",
        body: "The approved project needs a short term increase.",
        threadRootEventId: THREAD_ROOT,
        addresseePubkey: "e".repeat(64),
        subject: { kind: "companyMember", id: employeePubkey },
        spendAllowanceProposal,
      },
    });

  const decoded = decodeRelayAskHead(
    signHead({ content: makeContent(proposal) }),
    RELAY_PUBKEY,
  );
  assert.deepEqual(
    decoded?.head.ask.spendAllowanceProposal?.temporaryAllowance,
    proposal.temporaryAllowance,
  );

  const malformed = structuredClone(proposal);
  malformed.temporaryAllowance.allowance.amountCents = "9999";
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: makeContent(malformed) }),
        RELAY_PUBKEY,
      ),
    /unsupported shape/i,
  );
});

test("decodeRelayAskHead accepts a tool consent ask with an exact preview", () => {
  const value = JSON.parse(headContent());
  value.ask.type = "tool_consent";
  value.ask.category = "tool";
  value.ask.toolConsent = {
    action: "message_outsider",
    actionPreview:
      "Send this email to client@example.com: The report is ready.",
  };
  const decoded = decodeRelayAskHead(
    signHead({ content: JSON.stringify(value) }),
    RELAY_PUBKEY,
  );
  assert.equal(decoded?.head.ask.type, "tool_consent");
  assert.equal(
    decoded?.head.ask.toolConsent?.actionPreview,
    "Send this email to client@example.com: The report is ready.",
  );
});

test("decodeRelayAskHead rejects tool consent records without bounded previews", () => {
  const missingPreview = JSON.parse(headContent());
  missingPreview.ask.type = "tool_consent";
  missingPreview.ask.category = "tool";
  missingPreview.ask.toolConsent = { action: "delete_data" };
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: JSON.stringify(missingPreview) }),
        RELAY_PUBKEY,
      ),
    /unsupported shape/i,
  );

  const wrongCategory = JSON.parse(headContent());
  wrongCategory.ask.type = "tool_consent";
  wrongCategory.ask.category = "general";
  wrongCategory.ask.toolConsent = {
    action: "publish_publicly",
    actionPreview: "Publish a post.",
  };
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: JSON.stringify(wrongCategory) }),
        RELAY_PUBKEY,
      ),
    /unsupported shape/i,
  );
});

test("decodeRelayAskHead validates a hire ask manager pubkey", () => {
  const proposal = {
    hireId: ASK_ID,
    rolePack: {
      personaId: "catalog:persona",
      title: "Researcher",
      job: "Prepare research summaries",
      skills: ["Research"],
      tools: [{ name: "read_reports", risk: "low" }],
      workerMenu: ["runtime-discovered"],
    },
    displayName: "Imani",
    title: "Researcher",
    managerPubkey: "f".repeat(64),
    introductionChannelId: CHANNEL_ID,
    runtimeId: "runtime-discovered",
    providerId: "provider-current",
  };
  const makeHireContent = () =>
    headContent({
      ask: {
        schemaVersion: 1,
        askId: ASK_ID,
        type: "approval",
        category: "hire",
        title: "Hire Imani as a researcher",
        threadRootEventId: THREAD_ROOT,
        subject: { kind: "hire", id: proposal.hireId },
        hireProposal: proposal,
      },
    });

  const decoded = decodeRelayAskHead(
    signHead({ content: makeHireContent() }),
    RELAY_PUBKEY,
  );
  assert.equal(decoded?.head.ask.hireProposal?.managerPubkey, "f".repeat(64));

  delete proposal.providerId;
  const providerless = decodeRelayAskHead(
    signHead({ content: makeHireContent() }),
    RELAY_PUBKEY,
  );
  assert.equal(providerless?.head.ask.hireProposal?.providerId, undefined);

  proposal.managerPubkey = "not-a-pubkey";
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: makeHireContent() }),
        RELAY_PUBKEY,
      ),
    /malformed hire proposal/i,
  );
});

test("decodeRelayAskHead validates duty proposals against ask identity and channel", () => {
  const proposal = {
    schemaVersion: 1,
    dutyId: ASK_ID,
    employeePubkey: "f".repeat(64),
    title: "Review saved hospitality research",
    scheduleText: "Every Monday at 09:00",
    scheduleCron: "0 9 * * 1",
    timeZone: "Etc/UTC",
    channelId: CHANNEL_ID,
    instructions: "Review the saved list and report changes.",
  };
  const makeDutyContent = (dutyProposal = proposal, subjectId = ASK_ID) =>
    headContent({
      ask: {
        schemaVersion: 1,
        askId: ASK_ID,
        type: "approval",
        category: "duty",
        title: "Give Aya a weekly research duty",
        body: "Every Monday, review the saved hospitality list and report changes.",
        threadRootEventId: THREAD_ROOT,
        subject: { kind: "duty", id: subjectId },
        dutyProposal,
      },
    });

  const decoded = decodeRelayAskHead(
    signHead({ content: makeDutyContent() }),
    RELAY_PUBKEY,
    CHANNEL_ID,
  );
  assert.equal(decoded?.head.ask.category, "duty");
  assert.equal(decoded?.head.ask.dutyProposal?.dutyId, ASK_ID);

  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({
          content: makeDutyContent(
            proposal,
            "7916ba1a-e078-42ef-b896-00be34a94f12",
          ),
        }),
        RELAY_PUBKEY,
        CHANNEL_ID,
      ),
    /malformed duty proposal ask/i,
  );

  const crossChannelProposal = {
    ...proposal,
    channelId: "9dae0116-799b-5071-a0a8-fdd30a91a35d",
  };
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: makeDutyContent(crossChannelProposal) }),
        RELAY_PUBKEY,
        CHANNEL_ID,
      ),
    /malformed duty proposal ask/i,
  );

  const mismatchedSchedule = { ...proposal, scheduleCron: "1 9 * * 1" };
  assert.throws(
    () =>
      decodeRelayAskHead(
        signHead({ content: makeDutyContent(mismatchedSchedule) }),
        RELAY_PUBKEY,
        CHANNEL_ID,
      ),
    /malformed duty proposal ask/i,
  );
});

test("askIdFromAction reads create commands only", () => {
  assert.equal(
    askIdFromAction(JSON.stringify({ action: "create", askId: ASK_ID })),
    ASK_ID,
  );
  assert.equal(
    askIdFromAction(JSON.stringify({ action: "respond", askId: ASK_ID })),
    null,
  );
  assert.equal(askIdFromAction("not json"), null);
});
