import assert from "node:assert/strict";
import test from "node:test";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { buildNeedsYou } from "./needsYou.ts";
import {
  buildNeedsYouSummary,
  hasNeedsYouSummaryError,
  holdSettledNeedsYouSummary,
} from "./needsYouSummary.ts";
import { parsePlanHead } from "./planRecords.ts";
import { AGENT, headContent, signHead, step } from "./planFixtures.mjs";

const NONE = { asks: [], plans: [], whatsappBatches: [], whatsappDrafts: [] };

function plan(overrides = {}) {
  const secret = generateSecretKey();
  const relay = getPublicKey(secret);
  const event = signHead(headContent(overrides), { secret });
  const parsed = parsePlanHead(event, relay);
  assert.ok(parsed, "test plan parses");
  return parsed;
}

function ask(overrides = {}) {
  const { ask: askOverrides, ...head } = overrides;
  return {
    channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
    event: {},
    head: {
      schemaVersion: 1,
      askId: "7245ba1a-e078-42ef-b896-00be34a94f11",
      status: "open",
      askerPubkey: AGENT,
      createdAt: "2026-10-30T08:00:00Z",
      ask: {
        schemaVersion: 1,
        askId: "7245ba1a-e078-42ef-b896-00be34a94f11",
        type: "approval",
        category: "general",
        title: "Approve the launch",
        threadRootEventId: "a".repeat(64),
        ...askOverrides,
      },
      resolution: null,
      cancellation: null,
      sourceActionEventId: "b".repeat(64),
      ...head,
    },
  };
}

function model(items = []) {
  return {
    approve: items.map((item, index) => ({
      ...item,
      source: item.source ?? {
        kind: "plan",
        planId: `summary-test-${index}`,
        stepId: null,
      },
      details: item.details ?? [],
    })),
    do: [],
    decide: [],
    total: items.length,
  };
}

function gap(gapId, state, category, text = "") {
  return {
    gapId,
    state,
    gap: {
      title: text || "Need access",
      need: text,
      options: [],
      chosen: 0,
      chosenReason: null,
      humanStep: "Connect it",
      pageUrl: null,
      accessId: "company-access",
      access: {
        name: "Capability",
        category,
        usedFor: text,
        agents: [],
        cost: "Covered by subscription",
      },
    },
    proposedByPubkey: "a".repeat(64),
    proposedAt: 100,
    approvedCostCents: null,
    eventId: `event-${gapId}`,
  };
}

function contact(waId, stage) {
  return { waId, stage };
}

test("reports every failed count source", () => {
  const complete = {
    hasNeedsYouError: false,
    hasWhatsAppError: false,
    hasCompanyAccessError: false,
    moneyRailsAvailability: "ready",
  };
  const cases = [
    ["complete sources", complete, false],
    ["core needs-you data", { ...complete, hasNeedsYouError: true }, true],
    ["WhatsApp data", { ...complete, hasWhatsAppError: true }, true],
    ["company access gaps", { ...complete, hasCompanyAccessError: true }, true],
    ["money rails", { ...complete, moneyRailsAvailability: "error" }, true],
  ];

  for (const [source, status, expected] of cases) {
    assert.equal(hasNeedsYouSummaryError(status), expected, source);
  }
});

test("counts all visible rows once, including money links, gaps and call requests", () => {
  const summary = buildNeedsYouSummary({
    model: model([
      { functionId: "sales", jobName: "Outreach" },
      { functionId: "sales", jobName: "Follow-ups" },
      { functionId: "operations", jobName: "Delivery" },
      { functionId: null, jobName: null },
    ]),
    paymentLinks: [{ state: "needs_you" }, { state: "sent" }],
    capabilityGaps: [
      gap("payment", "proposed", "payment_link"),
      gap("esign", "approved", "esign"),
      gap("company", "proposed", "other", "Company-wide setup"),
      gap("done", "completed", "whatsapp"),
      gap("declined", "declined", "payment_link"),
    ],
    whatsappContacts: [
      contact("lead-1", "wants_call"),
      contact("lead-1", "wants_call"),
      contact("lead-2", "replied"),
    ],
  });

  assert.equal(summary.total, 9);
  assert.deepEqual(summary.byPart, {
    sales: 3,
    operations: 2,
    customer_success: 0,
    finance: 2,
    brand: 0,
  });
  assert.deepEqual(summary.byJob, {
    "sales:Outreach": 1,
    "sales:Follow-ups": 1,
    "sales:Calls": 1,
    "operations:Delivery": 1,
    "finance:Deposits": 1,
  });
});

test("counts each reply draft as a row in the shared total and function badge", () => {
  const summary = buildNeedsYouSummary({
    model: {
      approve: [
        {
          functionId: "sales",
          jobName: "Follow-ups",
          source: { kind: "whatsapp_drafts", senderPubkey: AGENT },
          details: [
            { id: "draft-1", label: "A", text: "First reply" },
            { id: "draft-2", label: "B", text: "Second reply" },
            { id: "draft-3", label: "C", text: "Third reply" },
          ],
        },
      ],
      do: [],
      decide: [],
      total: 1,
    },
  });

  assert.equal(summary.total, 3);
  assert.equal(summary.byPart.sales, 3);
  assert.equal(summary.byJob["sales:Follow-ups"], 3);
});

test("capability gaps map only when their part is clear", () => {
  const summary = buildNeedsYouSummary({
    model: model(),
    capabilityGaps: [
      gap("calendar", "proposed", "calendar"),
      gap("renewal", "approved", "other", "Customer success renewal notes"),
      gap("ambiguous", "proposed", "other", "Shared company tool"),
    ],
  });

  assert.equal(summary.total, 3);
  assert.deepEqual(summary.byPart, {
    sales: 1,
    operations: 0,
    customer_success: 1,
    finance: 0,
    brand: 0,
  });
});

test("every needs-you source receives its part and any canonical job", () => {
  const salesPlan = plan({
    plan: { ...headContent().plan, title: "Sales plan", function: "sales" },
  });
  const operationsPlan = plan({
    status: "approved",
    plan: {
      ...headContent().plan,
      title: "Operations plan",
      function: "operations",
      steps: [
        step("go-live", {
          status: "waiting_approval",
          approvalPoint: { kind: "other", prompt: "Go live after approval" },
        }),
      ],
    },
  });
  const playbook = {
    playbookId: "delivery-playbook",
    status: "proposed",
    version: 0,
    title: "Delivery playbook",
    pending: {
      content: { title: "Delivery playbook", steps: [{}, {}] },
      changeSummary: null,
      proposedByPubkey: AGENT,
      proposedAt: 100,
    },
  };
  const playbookChange = {
    ...playbook,
    playbookId: "delivery-change",
    status: "active",
    version: 1,
    pending: { ...playbook.pending, changeSummary: "Add the launch checklist" },
  };
  const job = (jobId, jobStep) => ({
    jobId,
    playbookId: "delivery-playbook",
    playbookVersion: 1,
    playbookTitle: "Delivery playbook",
    title: "Customer website",
    status: "running",
    currentStepId: jobStep.stepId,
    steps: [jobStep],
    startedByPubkey: AGENT,
    startedAt: 100,
  });
  const jobStep = (stepId, approvalPoint, status, owner) => ({
    stepId,
    title: stepId,
    detail: null,
    owner,
    approvalPoint,
    status,
    statusAt: 110,
  });
  const goal = {
    goalId: "goal-sales",
    functionId: "sales",
    title: "5 new clients",
    metric: "won",
    target: 5,
    period: "month",
    status: "proposed",
    reason: null,
    proposedByPubkey: AGENT,
    proposedAt: 120,
  };
  const model = buildNeedsYou({
    ...NONE,
    canApprove: true,
    asks: [
      ask({
        ask: {
          askId: "11111111-1111-4111-8111-111111111111",
          type: "approval",
          category: "money",
          title: "Approve the deposit",
        },
      }),
      ask({
        ask: {
          askId: "22222222-2222-4222-8222-222222222222",
          type: "question",
          title: "Follow up with the lead",
        },
      }),
      ask({
        ask: {
          askId: "33333333-3333-4333-8333-333333333333",
          type: "approval",
          category: "general",
          title: "Should this stay company-wide?",
        },
      }),
      ask({
        ask: {
          askId: "44444444-4444-4444-8444-444444444444",
          type: "question",
          title: "Does the goal look right?",
          subject: { kind: "goal", id: "goal-sales" },
        },
      }),
      ask({
        ask: {
          askId: "55555555-5555-4555-8555-555555555555",
          type: "question",
          title: "Run the workflow?",
          subject: { kind: "workflowRun", id: "run-1" },
        },
      }),
    ],
    plans: [salesPlan, operationsPlan],
    playbooks: [playbook, playbookChange],
    playbookJobs: [
      job(
        "approval-job",
        jobStep(
          "go-live",
          { kind: "other", prompt: "Approve launch" },
          "waiting_approval",
          { kind: "agent", agentPubkey: AGENT },
        ),
      ),
      job("owner-job", jobStep("handover", null, "pending", { kind: "owner" })),
    ],
    goals: [goal],
    reviews: [
      {
        reviewDate: "2026-10-30",
        decisions: [
          {
            decisionId: "decision-brand",
            title: "Refresh the brand voice",
            detail: "",
            functionId: "brand",
            state: "open",
          },
          {
            decisionId: "decision-renewal",
            title: "Review the renewal plan",
            detail: "",
            functionId: null,
            state: "open",
          },
        ],
        annotatedByPubkey: AGENT,
        annotatedAt: 130,
        createdAt: 130,
      },
    ],
    whatsappBatches: [
      {
        batchId: "outreach",
        status: "pending",
        createdBy: AGENT,
        template: "Built a site for you",
        language: "en",
        rows: { total: 12, ready: 12, sent: 0, failed: 0, dropped: 0 },
        createdAt: "2026-10-30T08:00:00Z",
      },
      {
        batchId: "follow-up",
        status: "pending",
        createdBy: AGENT,
        template: "Follow-up",
        language: "en",
        rows: { total: 3, ready: 3, sent: 0, failed: 0, dropped: 0 },
        createdAt: "2026-10-30T08:00:00Z",
      },
    ],
    whatsappBatchDetails: [
      { batchId: "follow-up", note: "Follow up with the unread leads" },
    ],
    whatsappDrafts: [
      {
        id: "draft-1",
        state: "draft",
        senderPubkey: AGENT,
        createdAt: "2026-10-30T09:00:00Z",
        to: "Guesthouse",
        text: "Thanks for getting back to us",
      },
    ],
  });
  const byId = new Map(
    [...model.approve, ...model.do, ...model.decide].map((item) => [
      item.id,
      item,
    ]),
  );

  assert.deepEqual(
    [
      [
        byId.get("ask:11111111-1111-4111-8111-111111111111").functionId,
        byId.get("ask:11111111-1111-4111-8111-111111111111").jobName,
      ],
      [
        byId.get("ask:22222222-2222-4222-8222-222222222222").functionId,
        byId.get("ask:22222222-2222-4222-8222-222222222222").jobName,
      ],
      [
        byId.get("ask:33333333-3333-4333-8333-333333333333").functionId,
        byId.get("ask:33333333-3333-4333-8333-333333333333").jobName,
      ],
      [
        byId.get("ask:44444444-4444-4444-8444-444444444444").functionId,
        byId.get("ask:44444444-4444-4444-8444-444444444444").jobName,
      ],
      [
        byId.get("ask:55555555-5555-4555-8555-555555555555").functionId,
        byId.get("ask:55555555-5555-4555-8555-555555555555").jobName,
      ],
    ],
    [
      ["finance", "Deposits"],
      ["sales", "Follow-ups"],
      [null, null],
      ["sales", null],
      ["operations", null],
    ],
  );
  assert.equal(byId.get(`plan:${salesPlan.planId}`).functionId, "sales");
  assert.equal(
    byId.get(`plan-step:${operationsPlan.planId}:go-live`).functionId,
    "operations",
  );
  assert.equal(byId.get("playbook:delivery-playbook").jobName, "Delivery");
  assert.equal(byId.get("playbook:delivery-change").jobName, "Delivery");
  assert.equal(
    byId.get("playbook-step:approval-job:go-live").jobName,
    "Delivery",
  );
  assert.equal(
    byId.get("playbook-step:owner-job:handover").jobName,
    "Delivery",
  );
  assert.equal(byId.get("goal:goal-sales").functionId, "sales");
  assert.equal(
    byId.get("review-decision:2026-10-30:decision-brand").functionId,
    "brand",
  );
  assert.equal(
    byId.get("review-decision:2026-10-30:decision-renewal").functionId,
    "customer_success",
  );
  assert.equal(byId.get("wa-batch:outreach").jobName, "Outreach");
  assert.equal(byId.get("wa-batch:follow-up").jobName, "Follow-ups");
  assert.equal(byId.get(`wa-drafts:${AGENT}`).jobName, "Follow-ups");
});

test("the last settled count stays while a source loads again", () => {
  const counted = buildNeedsYouSummary({ model: buildNeedsYou(NONE) });
  const settled = { communityId: "one", data: counted, isError: true };
  const loadingAgain = { data: undefined, isPending: true, isError: false };

  assert.deepEqual(
    holdSettledNeedsYouSummary(loadingAgain, settled, "one"),
    { data: counted, isPending: false, isError: true },
    "a retry keeps the count and the failed-source note it settled with",
  );
  assert.equal(
    holdSettledNeedsYouSummary(loadingAgain, null, "one"),
    loadingAgain,
    "the first load has nothing to keep",
  );
  assert.equal(
    holdSettledNeedsYouSummary(loadingAgain, settled, "two"),
    loadingAgain,
    "a count from another workspace is never shown",
  );
});

test("a fresh count replaces the one that was kept", () => {
  const kept = buildNeedsYouSummary({ model: buildNeedsYou(NONE) });
  const fresh = buildNeedsYouSummary({
    model: buildNeedsYou(NONE),
    whatsappContacts: [contact("27820000001", "wants_call")],
  });
  const current = { data: fresh, isPending: false, isError: false };

  assert.equal(
    holdSettledNeedsYouSummary(
      current,
      { communityId: "one", data: kept, isError: true },
      "one",
    ),
    current,
  );
  assert.equal(fresh.total, 1);
});
