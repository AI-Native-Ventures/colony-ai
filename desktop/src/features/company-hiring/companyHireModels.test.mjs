import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { KIND_HIRE_HEAD } from "@/shared/constants/kinds";
import {
  companyHireDTag,
  parseCompanyHireAction,
  parseCompanyHireHeadEvent,
} from "./companyHireModels.ts";

const RELAY_SECRET = new Uint8Array(32).fill(8);
const OTHER_SECRET = new Uint8Array(32).fill(9);
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const HIRE_ID = "123e4567-e89b-12d3-a456-426614174010";
const CHANNEL_ID = "123e4567-e89b-12d3-a456-426614174011";

function proposal(overrides = {}) {
  return {
    hireId: HIRE_ID,
    rolePack: {
      personaId: "researcher",
      title: "Researcher",
      job: "Prepare customer research summaries.",
      skills: ["Research"],
      tools: [{ name: "read_reports", risk: "low" }],
      workerMenu: ["codex"],
    },
    displayName: "Imani",
    title: "Researcher",
    introductionChannelId: CHANNEL_ID,
    runtimeId: "codex",
    weeklyAllowance: "8.00",
    ...overrides,
  };
}

function headContent(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    proposal: proposal(),
    status: "proposed",
    proposedByPubkey: "a".repeat(64),
    sourceActionEventId: "b".repeat(64),
    ...overrides,
  });
}

function signedHead({ tags, content, secret = RELAY_SECRET } = {}) {
  return finalizeEvent(
    {
      kind: KIND_HIRE_HEAD,
      created_at: 1_790_000_000,
      content: content ?? headContent(),
      tags: tags ?? [["d", companyHireDTag(HIRE_ID)]],
    },
    secret,
  );
}

test("hire coordinate is company-wide and requires a UUID", () => {
  assert.equal(companyHireDTag(HIRE_ID), `company:hire:${HIRE_ID}`);
  assert.throws(() => companyHireDTag("not-a-uuid"));
});

test("hire head parsing verifies relay signer, signature, kind and d-tag", () => {
  const event = signedHead();
  const record = parseCompanyHireHeadEvent(event, RELAY_PUBKEY, HIRE_ID);
  assert.equal(record?.head.proposal.displayName, "Imani");
  assert.equal(record?.head.status, "proposed");

  assert.equal(
    parseCompanyHireHeadEvent(event, getPublicKey(OTHER_SECRET)),
    null,
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({ secret: OTHER_SECRET }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({ tags: [["h", CHANNEL_ID]] }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({
        tags: [
          ["d", `company:hire:${HIRE_ID}`],
          ["h", CHANNEL_ID],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({
        tags: [
          ["d", `company:hire:${HIRE_ID}`],
          ["d", `company:hire:${HIRE_ID}`],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyHireHeadEvent(signedHead({ content: "{" }), RELAY_PUBKEY),
    null,
  );
});

test("hired status requires the founder, employee and introduction coordinates", () => {
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({
        content: headContent({
          status: "hired",
          founderPubkey: "c".repeat(64),
          employeePubkey: "d".repeat(64),
          introductionEventId: "e".repeat(64),
        }),
      }),
      RELAY_PUBKEY,
    )?.head.status,
    "hired",
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({ content: headContent({ status: "hired" }) }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({
        content: headContent({
          status: "approved",
          founderPubkey: "not-a-key",
        }),
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({
        content: headContent({
          status: "approved",
          founderPubkey: "c".repeat(64),
          founderApprovalReason: "The referral meets the approved scope.",
        }),
      }),
      RELAY_PUBKEY,
    )?.head.founderApprovalReason,
    "The referral meets the approved scope.",
  );
  assert.equal(
    parseCompanyHireHeadEvent(
      signedHead({
        content: headContent({ founderApprovalReason: 7 }),
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
});

test("hire action parser binds each action to its required coordinates", () => {
  const create = {
    schemaVersion: 1,
    hireId: HIRE_ID,
    action: "create",
    proposal: proposal(),
  };
  assert.equal(parseCompanyHireAction(create)?.action, "create");
  assert.equal(
    parseCompanyHireAction({ ...create, expectedHeadEventId: "f".repeat(64) }),
    null,
  );
  assert.equal(
    parseCompanyHireAction({
      ...create,
      action: "update",
      expectedHeadEventId: "f".repeat(64),
    })?.action,
    "update",
  );
  assert.equal(
    parseCompanyHireAction({
      ...create,
      action: "update",
    }),
    null,
  );
  assert.equal(
    parseCompanyHireAction({
      schemaVersion: 1,
      hireId: HIRE_ID,
      action: "attach_employee",
      expectedHeadEventId: "f".repeat(64),
      employeePubkey: "7".repeat(64),
    })?.action,
    "attach_employee",
  );
  assert.equal(
    parseCompanyHireAction({
      schemaVersion: 1,
      hireId: HIRE_ID,
      action: "complete",
      expectedHeadEventId: "f".repeat(64),
      employeePubkey: "7".repeat(64),
      introductionEventId: "8".repeat(64),
    })?.action,
    "complete",
  );
  assert.equal(
    parseCompanyHireAction({
      schemaVersion: 1,
      hireId: HIRE_ID,
      action: "complete",
      expectedHeadEventId: "f".repeat(64),
      employeePubkey: "7".repeat(64),
    }),
    null,
  );
  const founderApproval = {
    schemaVersion: 1,
    hireId: HIRE_ID,
    action: "approve",
    expectedHeadEventId: "f".repeat(64),
    reason: "The founder reviewed the referred scope.",
  };
  assert.equal(parseCompanyHireAction(founderApproval)?.action, "approve");
  assert.equal(
    parseCompanyHireAction({ ...founderApproval, reason: "   " }),
    null,
  );
  assert.equal(
    parseCompanyHireAction({ ...founderApproval, reason: "x".repeat(1001) }),
    null,
  );
});
