import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

import { KIND_PLAN_ACTION, KIND_PLAN_HEAD } from "@/shared/constants/kinds";
import { buildPlanActionEvent, planActions } from "./planActions.ts";
import {
  latestPlans,
  openHumanSteps,
  parsePlanHead,
  planDTag,
  planTotals,
  stepsWaitingForApproval,
} from "./planRecords.ts";

import {
  OWNER,
  PLAN_ID,
  RELAY_PUBKEY,
  RELAY_SECRET,
  headContent,
  signHead,
  step,
} from "./planFixtures.mjs";
test("parsePlanHead reads a relay signed plan with live step state", () => {
  const plan = parsePlanHead(signHead(), RELAY_PUBKEY);
  assert.ok(plan);
  assert.equal(plan.planId, PLAN_ID);
  assert.equal(plan.status, "proposed");
  assert.equal(plan.functionId, "sales");
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0].owner.functionId, "sales");
  assert.equal(plan.steps[1].costEstimateCents, 3700);
  assert.deepEqual(planTotals(plan), {
    costCents: 3700,
    currency: "ZAR",
    targetLabel: "5 won",
    timingLabel: "1 to 30 November",
  });
});

test("parsePlanHead refuses a head from anyone but the relay", () => {
  const stranger = generateSecretKey();
  const event = finalizeEvent(
    {
      kind: KIND_PLAN_HEAD,
      content: JSON.stringify(headContent()),
      tags: [["d", planDTag(PLAN_ID)]],
      created_at: 1_793_000_000,
    },
    stranger,
  );
  assert.equal(parsePlanHead(event, RELAY_PUBKEY), null);
});

test("parsePlanHead refuses unknown keys, a wrong d tag and duplicate step ids", () => {
  assert.equal(
    parsePlanHead(signHead({ ...headContent(), surprise: true }), RELAY_PUBKEY),
    null,
  );
  const wrongTag = finalizeEvent(
    {
      kind: KIND_PLAN_HEAD,
      content: JSON.stringify(headContent()),
      tags: [["d", "company:plan:00000000-0000-4000-8000-000000000000"]],
      created_at: 1_793_000_000,
    },
    RELAY_SECRET,
  );
  assert.equal(parsePlanHead(wrongTag, RELAY_PUBKEY), null);
  const duplicate = headContent();
  duplicate.plan.steps = [step("a"), step("a")];
  assert.equal(parsePlanHead(signHead(duplicate), RELAY_PUBKEY), null);
  const noSteps = headContent();
  noSteps.plan.steps = [];
  assert.equal(parsePlanHead(signHead(noSteps), RELAY_PUBKEY), null);
});

test("parsePlanHead keeps the approval record: who, what, when", () => {
  const plan = parsePlanHead(
    signHead(
      headContent({
        status: "approved",
        approvals: [
          {
            scope: "plan",
            decision: "approved",
            actorPubkey: OWNER,
            at: 1_793_000_100,
            revision: 1,
            actionEventId: "d".repeat(64),
          },
          {
            scope: "step",
            stepId: "send",
            decision: "approved",
            actorPubkey: OWNER,
            at: 1_793_000_200,
            revision: 1,
            note: "Template looks right",
            actionEventId: "e".repeat(64),
          },
        ],
      }),
    ),
    RELAY_PUBKEY,
  );
  assert.ok(plan);
  assert.equal(plan.approvals.length, 2);
  assert.equal(plan.approvals[1].stepId, "send");
  assert.equal(plan.approvals[1].note, "Template looks right");
  // A plan scope record must not name a step.
  const bad = headContent({
    approvals: [
      {
        scope: "plan",
        stepId: "send",
        decision: "approved",
        actorPubkey: OWNER,
        at: 1,
        revision: 1,
        actionEventId: "d".repeat(64),
      },
    ],
  });
  assert.equal(parsePlanHead(signHead(bad), RELAY_PUBKEY), null);
});

test("steps waiting at an approval point and open human steps come only from approved plans", () => {
  const content = headContent({ status: "approved" });
  content.plan.steps = [
    step("gate", {
      status: "waiting_approval",
      approvalPoint: { kind: "outreach", prompt: "You approve each batch" },
    }),
    step("signup", { owner: { kind: "owner" }, status: "pending" }),
    step("done", { owner: { kind: "owner" }, status: "done" }),
  ];
  const approved = parsePlanHead(signHead(content), RELAY_PUBKEY);
  assert.deepEqual(
    stepsWaitingForApproval(approved).map((s) => s.stepId),
    ["gate"],
  );
  assert.deepEqual(
    openHumanSteps(approved).map((s) => s.stepId),
    ["signup"],
  );
  const proposed = parsePlanHead(
    signHead({ ...content, status: "proposed" }),
    RELAY_PUBKEY,
  );
  assert.deepEqual(stepsWaitingForApproval(proposed), []);
  assert.deepEqual(openHumanSteps(proposed), []);
});

test("latestPlans keeps the newest head per plan", () => {
  const older = parsePlanHead(signHead(), RELAY_PUBKEY);
  const newer = parsePlanHead(
    signHead(headContent({ status: "approved", updatedAt: 1_793_000_500 })),
    RELAY_PUBKEY,
  );
  const result = latestPlans([
    { plan: older, createdAt: 10 },
    { plan: newer, createdAt: 20 },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "approved");
});

test("plan actions name the exact head and revision the person saw", () => {
  const plan = parsePlanHead(signHead(), RELAY_PUBKEY);
  const approve = buildPlanActionEvent(planActions.approve(plan));
  const body = JSON.parse(approve.content);
  assert.equal(body.kind, "approve");
  assert.equal(body.revision, 1);
  assert.equal(body.expectedHeadEventId, plan.eventId);
  assert.deepEqual(approve.tags, [["d", planDTag(PLAN_ID)]]);
  const done = JSON.parse(
    buildPlanActionEvent(planActions.markDone(plan, "send", "Signed up"))
      .content,
  );
  assert.equal(done.kind, "update_step");
  assert.equal(done.stepId, "send");
  assert.equal(done.stepStatus, "done");
  assert.equal(done.note, "Signed up");
  assert.equal(KIND_PLAN_ACTION, 47063);
});
