import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  KIND_BRIEF_HEAD,
  KIND_ONBOARDING_HEAD,
} from "@/shared/constants/kinds";
import {
  buildBriefActionEvent,
  buildOnboardingActionEvent,
  parseBriefHead,
  parseOnboardingHead,
} from "./initiativeRecords.ts";

const relaySecret = generateSecretKey();
const relayPubkey = getPublicKey(relaySecret);
const ownerPubkey = getPublicKey(generateSecretKey());
const eventId = "a".repeat(64);

function sign(kind, content, dTag) {
  return finalizeEvent(
    {
      kind,
      content: JSON.stringify(content),
      tags: [["d", dTag]],
      created_at: 1_793_000_000,
    },
    relaySecret,
  );
}

function briefContent() {
  return {
    whatYouSell: "Websites for guesthouses",
    whoBuys: "Independent guesthouses",
    howYouTalk: "Friendly and direct",
    sources: ["Your website", "38 leads"],
  };
}

function onboardingHead(overrides = {}) {
  return {
    schemaVersion: 1,
    revision: 2,
    status: "in_progress",
    leadPubkey: ownerPubkey,
    steps: [
      { step: "brief", state: "done" },
      { step: "money", state: "done" },
      { step: "approvals", state: "done" },
      { step: "accounts", state: "asked" },
      { step: "map", state: "todo" },
    ],
    question: {
      step: "accounts",
      text: "Please sign in to Pinterest.",
      account: {
        id: "pinterest",
        label: "Pinterest",
        url: "https://www.pinterest.com/login/",
      },
    },
    accounts: [
      {
        id: "pinterest",
        label: "Pinterest",
        url: "https://www.pinterest.com/login/",
        state: "asked",
      },
    ],
    startedAt: 1_793_000_000,
    resumeCount: 0,
    updatedByPubkey: ownerPubkey,
    updatedAt: 1_793_000_100,
    ...overrides,
  };
}

test("parseBriefHead reads the exact relay-signed brief record", () => {
  const event = sign(
    KIND_BRIEF_HEAD,
    {
      schemaVersion: 1,
      revision: 3,
      pending: briefContent(),
      updatedByPubkey: ownerPubkey,
      updatedAt: 1_793_000_100,
    },
    "company:brief",
  );
  const head = parseBriefHead(event, relayPubkey);
  assert.ok(head);
  assert.equal(head.pending?.whoBuys, "Independent guesthouses");
  assert.equal(head.confirmed, null);
  assert.equal(head.eventId, event.id);
});

test("parseBriefHead rejects unknown record keys and coordinates", () => {
  assert.equal(
    parseBriefHead(
      sign(
        KIND_BRIEF_HEAD,
        {
          schemaVersion: 1,
          revision: 1,
          pending: briefContent(),
          updatedByPubkey: ownerPubkey,
          updatedAt: 1_793_000_100,
          futureField: true,
        },
        "company:brief",
      ),
      relayPubkey,
    ),
    null,
  );
  assert.equal(
    parseBriefHead(
      sign(
        KIND_BRIEF_HEAD,
        {
          schemaVersion: 1,
          revision: 1,
          pending: briefContent(),
          updatedByPubkey: ownerPubkey,
          updatedAt: 1_793_000_100,
        },
        "company:brief:wrong",
      ),
      relayPubkey,
    ),
    null,
  );
});

test("parseOnboardingHead reads account prompts and the proposed company map", () => {
  const entries = [
    { function: "sales", placement: "existing_agent", leadPubkey: ownerPubkey },
    { function: "operations", placement: "scout" },
    { function: "customer_success", placement: "empty" },
    { function: "finance", placement: "empty" },
    { function: "brand", placement: "empty" },
  ];
  const content = onboardingHead({
    map: { entries, firstFunction: "sales", approved: false },
  });
  const event = sign(KIND_ONBOARDING_HEAD, content, "company:onboarding");
  const head = parseOnboardingHead(event, relayPubkey);
  assert.ok(head);
  assert.equal(head.question?.account?.label, "Pinterest");
  assert.equal(head.map?.entries[0]?.leadPubkey, ownerPubkey);
  assert.equal(head.map?.firstFunction, "sales");
  assert.equal(head.eventId, event.id);
});

test("parseOnboardingHead rejects unknown fields and out-of-order steps", () => {
  const unknown = onboardingHead({ futureField: true });
  assert.equal(
    parseOnboardingHead(
      sign(KIND_ONBOARDING_HEAD, unknown, "company:onboarding"),
      relayPubkey,
    ),
    null,
  );
  const reversed = onboardingHead();
  reversed.steps.reverse();
  assert.equal(
    parseOnboardingHead(
      sign(KIND_ONBOARDING_HEAD, reversed, "company:onboarding"),
      relayPubkey,
    ),
    null,
  );
});

test("action builders bind writes to the observed head and exact record d tag", () => {
  assert.deepEqual(
    buildBriefActionEvent({
      kind: "confirm",
      expectedHeadEventId: eventId,
    }),
    {
      content: JSON.stringify({
        schemaVersion: 1,
        kind: "confirm",
        expectedHeadEventId: eventId,
      }),
      tags: [["d", "company:brief"]],
    },
  );
  assert.deepEqual(
    buildOnboardingActionEvent({
      kind: "answer",
      step: "money",
      moneyPreference: "best_option",
      expectedHeadEventId: eventId,
    }),
    {
      content: JSON.stringify({
        schemaVersion: 1,
        kind: "answer",
        step: "money",
        moneyPreference: "best_option",
        expectedHeadEventId: eventId,
      }),
      tags: [["d", "company:onboarding"]],
    },
  );
});
