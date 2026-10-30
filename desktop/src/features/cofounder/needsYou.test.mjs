import assert from "node:assert/strict";
import test from "node:test";

import { buildApprovalLog } from "./approvalLog.ts";
import { buildNeedsYou } from "./needsYou.ts";
import { parsePlanHead } from "./planRecords.ts";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { AGENT, OWNER, headContent, signHead, step } from "./planFixtures.mjs";

function plan(overrides) {
  // Heads in these tests are signed by a throwaway relay key.
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

const NONE = { asks: [], plans: [], whatsappBatches: [], whatsappDrafts: [] };

test("a proposed plan is an approve item for an owner and absent for anyone else", () => {
  const proposed = plan();
  const owner = buildNeedsYou({ ...NONE, canApprove: true, plans: [proposed] });
  assert.equal(owner.total, 1);
  assert.equal(owner.approve[0].id, `plan:${proposed.planId}`);
  assert.equal(owner.approve[0].category, "plan");
  assert.equal(owner.approve[0].fromPubkey, AGENT);
  assert.deepEqual(
    owner.approve[0].actions.map((a) => a.id),
    ["approve", "edit", "reject"],
  );
  assert.match(owner.approve[0].subtitle, /Sales/);
  const member = buildNeedsYou({
    ...NONE,
    canApprove: false,
    plans: [proposed],
  });
  assert.equal(member.total, 0);
});

test("a step at an approval point is approve, a human-only step is do", () => {
  const running = plan({
    status: "approved",
    plan: {
      ...headContent().plan,
      steps: [
        step("batch", {
          status: "waiting_approval",
          approvalPoint: { kind: "outreach", prompt: "You approve each batch" },
        }),
        step("signup", {
          owner: { kind: "owner" },
          title: "Sign up for a free e-sign tool",
          detail: "Free plan, 3 documents a month.",
        }),
        step("later"),
      ],
    },
  });
  const model = buildNeedsYou({ ...NONE, canApprove: true, plans: [running] });
  assert.deepEqual(
    model.approve.map((i) => [i.category, i.approvalKind, i.source.stepId]),
    [["outreach", "outreach", "batch"]],
  );
  assert.deepEqual(
    model.do.map((i) => [i.title, i.actions[0].id]),
    [["Sign up for a free e-sign tool", "done"]],
  );
  assert.equal(model.total, 2);
});

test("asks sort into approve, do and decide by their type", () => {
  const model = buildNeedsYou({
    ...NONE,
    canApprove: true,
    asks: [
      ask({
        ask: {
          askId: "11111111-1111-4111-8111-111111111111",
          type: "approval",
          category: "money",
          title: "Spend R500",
        },
      }),
      ask({
        ask: {
          askId: "22222222-2222-4222-8222-222222222222",
          type: "checklist",
          title: "Check the logins",
        },
      }),
      ask({
        ask: {
          askId: "33333333-3333-4333-8333-333333333333",
          type: "question",
          title: "Which name?",
        },
      }),
      ask({
        status: "resolved",
        ask: {
          askId: "44444444-4444-4444-8444-444444444444",
          title: "Already done",
        },
      }),
    ],
  });
  assert.deepEqual(
    model.approve.map((i) => [i.title, i.category]),
    [["Spend R500", "spend"]],
  );
  assert.deepEqual(
    model.do.map((i) => i.title),
    ["Check the logins"],
  );
  assert.deepEqual(
    model.decide.map((i) => [i.title, i.category]),
    [["Which name?", "question"]],
  );
});

test("pending WhatsApp batches and agent drafts are approve items for owners only", () => {
  const batch = {
    batchId: "b1",
    status: "pending",
    createdBy: AGENT,
    template: "Built a site for you",
    language: "en",
    rows: { total: 18, ready: 0, sent: 0, failed: 0, dropped: 0 },
    createdAt: "2026-10-30T08:00:00Z",
  };
  const draft = (id, to) => ({
    id,
    waId: to,
    direction: "out",
    kind: "text",
    text: `Hi ${to}`,
    templateName: null,
    state: "draft",
    errorCode: null,
    errorText: null,
    eventId: null,
    senderPubkey: AGENT,
    createdAt: "2026-10-30T09:00:00Z",
    to,
    params: [],
  });
  const sources = {
    ...NONE,
    whatsappBatches: [batch, { ...batch, batchId: "b2", status: "approved" }],
    whatsappDrafts: [draft("d1", "Plane Tree"), draft("d2", "Corner Cottage")],
  };
  const owner = buildNeedsYou({ ...sources, canApprove: true });
  assert.deepEqual(owner.approve.map((i) => i.id).sort(), [
    "wa-batch:b1",
    `wa-drafts:${AGENT}`,
  ]);
  const drafts = owner.approve.find((i) => i.id.startsWith("wa-drafts"));
  assert.equal(drafts.count, 2);
  assert.deepEqual(
    drafts.details.map((d) => d.label),
    ["Plane Tree", "Corner Cottage"],
  );
  assert.equal(owner.approve.find((i) => i.id === "wa-batch:b1").count, 18);
  assert.equal(buildNeedsYou({ ...sources, canApprove: false }).total, 0);
});

test("the soonest decide-by comes first, then newest", () => {
  const soon = plan({ plan: { ...headContent().plan, title: "Soon" } });
  const model = buildNeedsYou({
    ...NONE,
    canApprove: true,
    plans: [soon],
    asks: [
      ask({
        ask: {
          askId: "55555555-5555-4555-8555-555555555555",
          title: "Later",
          decideBy: "2030-01-01T00:00:00Z",
        },
      }),
      ask({
        ask: {
          askId: "66666666-6666-4666-8666-666666666666",
          title: "Sooner",
          decideBy: "2026-11-02T00:00:00Z",
        },
      }),
    ],
  });
  assert.deepEqual(
    model.approve.slice(0, 2).map((i) => i.title),
    ["Sooner", "Later"],
  );
});

test("the approval log lists plan decisions and resolved asks, newest first", () => {
  const approved = plan({
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
        decision: "rejected",
        actorPubkey: OWNER,
        at: 1_793_000_300,
        revision: 1,
        note: "Wrong template",
        actionEventId: "e".repeat(64),
      },
    ],
  });
  const resolved = ask({
    status: "resolved",
    resolution: {
      outcome: "approved",
      resolvedByPubkey: OWNER,
      resolvedAt: "2026-10-30T12:00:00Z",
      responseEventId: "f".repeat(64),
    },
  });
  const log = buildApprovalLog({ plans: [approved], asks: [resolved, ask()] });
  assert.equal(log.length, 3);
  assert.equal(log[0].source.kind, "ask");
  assert.equal(log[0].decision, "approved");
  assert.equal(log[1].decision, "rejected");
  assert.equal(log[1].subject, "Step send");
  assert.equal(log[1].note, "Wrong template");
  assert.equal(log[2].subject, "Get 5 clients in November");
  assert.ok(log.every((entry) => entry.actorPubkey === OWNER));
});
