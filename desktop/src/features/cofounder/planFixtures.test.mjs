import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_PLAN_HEAD } from "@/shared/constants/kinds";
import { buildNeedsYou } from "./needsYou.ts";
import { parsePlanHead, planDTag, planTotals } from "./planRecords.ts";
import {
  esignSetupPlan,
  novemberPlan,
} from "../../testing/cofounderPlanFixtures.ts";

const SCOUT = "5".repeat(64);
const AYA = "6".repeat(64);
const OWNER = "7".repeat(64);

function asHead(mock) {
  // The same shape the mock bridge serves as a relay-signed head.
  const secret = generateSecretKey();
  const relay = getPublicKey(secret);
  const event = finalizeEvent(
    {
      kind: KIND_PLAN_HEAD,
      content: JSON.stringify({
        schemaVersion: 1,
        planId: mock.planId,
        status: mock.status,
        revision: mock.revision ?? 1,
        plan: {
          ...mock.plan,
          steps: mock.plan.steps.map((step) => ({
            ...step,
            status: step.status ?? "pending",
          })),
        },
        proposedByPubkey: mock.proposedByPubkey,
        proposedAt: mock.proposedAt ?? 1_793_000_000,
        updatedByPubkey: relay,
        updatedAt: mock.updatedAt ?? mock.proposedAt ?? 1_793_000_000,
        approvals: mock.approvals ?? [],
        sourceActionEventId: "a".repeat(64),
      }),
      tags: [["d", planDTag(mock.planId)]],
      created_at: 1_793_000_000,
    },
    secret,
  );
  return parsePlanHead(event, relay);
}

test("the November plan fixture parses and matches the CFPlanCard board", () => {
  const plan = asHead(novemberPlan({ scoutPubkey: SCOUT, ayaPubkey: AYA }));
  assert.ok(plan);
  assert.equal(plan.steps.length, 6);
  assert.equal(plan.targetLabel, "5 won");
  assert.equal(plan.timingLabel, "1 to 30 November");
  assert.equal(planTotals(plan).costCents, 3_720);
  assert.equal(plan.steps[2].approvalPoint.kind, "outreach");
  assert.equal(plan.steps[1].owner.kind, "worker");
});

test("the e-sign fixture gives Needs you one approve and one do", () => {
  const plan = asHead(
    esignSetupPlan({ scoutPubkey: SCOUT, ownerPubkey: OWNER }),
  );
  assert.ok(plan);
  const model = buildNeedsYou({
    canApprove: true,
    asks: [],
    plans: [plan, asHead(novemberPlan({ scoutPubkey: SCOUT, ayaPubkey: AYA }))],
    whatsappBatches: [],
    whatsappDrafts: [],
  });
  assert.deepEqual(model.approve.map((item) => item.category).sort(), [
    "plan",
    "taste",
  ]);
  assert.deepEqual(
    model.do.map((item) => item.title),
    ["Sign up for a free e-sign tool"],
  );
});
