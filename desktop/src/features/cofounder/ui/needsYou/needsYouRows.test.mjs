import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNeedsYouRows,
  describeNeedsYouAction,
  groupNeedsYouRows,
  needsYouRowCopy,
} from "./needsYouRows.ts";

function item(overrides = {}) {
  return {
    id: "item-1",
    section: "approve",
    category: "other",
    title: "Prepared work",
    subtitle: "Scout prepared the next step.",
    fromPubkey: "a".repeat(64),
    createdAt: 1,
    decideBy: null,
    functionId: "operations",
    jobName: null,
    approvalKind: null,
    count: null,
    details: [],
    source: { kind: "plan", planId: "plan-1", stepId: "approve" },
    actions: [
      { id: "approve", label: "Approve", tone: "primary" },
      { id: "reject", label: "Reject", tone: "danger" },
    ],
    ...overrides,
  };
}

test("page rows expand each reply draft and deduplicate call requests", () => {
  const draftItem = item({
    id: "wa-drafts:sender",
    source: { kind: "whatsapp_drafts", senderPubkey: "a".repeat(64) },
    functionId: "sales",
    jobName: "Follow-ups",
    count: 2,
    details: [
      { id: "draft-1", label: "+27 82 123 4567", text: "Reply one." },
      { id: "draft-2", label: "+27 82 765 4321", text: "Reply two." },
    ],
  });
  const contact = {
    waId: "wa-1",
    e164: "+27821234567",
    displayName: "Thandeka",
    profileName: null,
    businessName: "Plane Tree Guesthouse",
    ownerPubkey: "a".repeat(64),
    stage: "wants_call",
  };
  const rows = buildNeedsYouRows({
    model: {
      approve: [draftItem],
      do: [],
      decide: [],
      total: 1,
    },
    paymentLinks: [],
    capabilityGaps: [],
    capabilityGapHeads: [],
    whatsappContacts: [contact, contact],
    whatsappDrafts: [
      {
        id: "draft-1",
        waId: "wa-1",
        to: contact.e164,
        text: "Reply one.",
        senderPubkey: "a".repeat(64),
      },
      {
        id: "draft-2",
        waId: "wa-2",
        to: "+27827654321",
        text: "Reply two.",
        senderPubkey: "a".repeat(64),
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.kind),
    ["draft", "draft", "call_request"],
  );
  assert.equal(
    needsYouRowCopy(rows[0]).title,
    "Reply to Thandeka at Plane Tree Guesthouse",
  );
  assert.equal(needsYouRowCopy(rows[0]).yesLabel, "Send");
  assert.equal(needsYouRowCopy(rows[0]).noLabel, "No");
  assert.equal(needsYouRowCopy(rows[2]).yesLabel, "Pick a time");
  assert.equal(needsYouRowCopy(rows[2]).noLabel, null);
});

test("copy names each board action and preserves plain source details", () => {
  const rows = [
    {
      kind: "item",
      id: "batch-outreach",
      item: item({
        source: { kind: "whatsapp_batch", batchId: "batch-1" },
        title: "WhatsApp batch of 12 messages",
        subtitle: "Template: first_touch",
        functionId: "sales",
        jobName: "Outreach",
        count: 12,
      }),
    },
    {
      kind: "item",
      id: "batch-followup",
      item: item({
        source: { kind: "whatsapp_batch", batchId: "batch-2" },
        functionId: "sales",
        jobName: "Follow-ups",
        count: 3,
      }),
    },
    {
      kind: "item",
      id: "new-playbook",
      item: item({
        title: "New playbook: Lead follow-up",
        source: { kind: "playbook", playbookId: "playbook-1" },
        functionId: "operations",
      }),
    },
    {
      kind: "item",
      id: "change-playbook",
      item: item({
        title: "Change to Delivery",
        source: { kind: "playbook", playbookId: "playbook-2" },
        functionId: "operations",
      }),
    },
    {
      kind: "item",
      id: "go-live",
      item: item({
        title: "Launch Northline Interiors",
        source: { kind: "playbook_job", jobId: "job-1", stepId: "launch" },
      }),
    },
    {
      kind: "item",
      id: "question",
      item: item({
        title: "Which date should I use?",
        category: "question",
        source: { kind: "ask", askId: "ask-1", channelId: "channel-1" },
        actions: [{ id: "answer", label: "Answer", tone: "primary" }],
      }),
    },
    {
      kind: "item",
      id: "money-ask",
      item: item({
        title: "Approve R3,000 for delivery tools?",
        category: "spend",
        source: { kind: "ask", askId: "ask-money", channelId: "channel-1" },
      }),
    },
    {
      kind: "item",
      id: "start-delivery",
      item: item({
        title: "Start delivery at Plane Tree Guesthouse",
        source: { kind: "playbook_job", jobId: "job-1", stepId: "start" },
      }),
    },
  ];

  assert.deepEqual(
    rows.map((row) => {
      const copy = needsYouRowCopy(row);
      return [copy.title, copy.subtitle, copy.yesLabel, copy.noLabel];
    }),
    [
      [
        "Message 12 contacts",
        "WhatsApp. First message to each.",
        "Send 12",
        "No",
      ],
      [
        "Follow up with 3 contacts",
        "WhatsApp. They read it and did not reply.",
        "Send 3",
        "No",
      ],
      [
        "New workflow: Lead follow-up",
        "Scout prepared the next step.",
        "Add it",
        "No",
      ],
      [
        "Change to Delivery",
        "Scout prepared the next step.",
        "Change it",
        "No",
      ],
      [
        "Launch Northline Interiors",
        "Scout prepared the next step.",
        "Go live",
        "No",
      ],
      [
        "Which date should I use?",
        "Scout prepared the next step.",
        "Answer",
        null,
      ],
      [
        "Approve R3,000 for delivery tools?",
        "Scout prepared the next step.",
        "Approve",
        "No",
      ],
      [
        "Start delivery at Plane Tree Guesthouse",
        "Scout prepared the next step.",
        "Start",
        "No",
      ],
    ],
  );
});

test("copy uses the owner verb for hires, decisions, deposits, and gaps", () => {
  const rows = [
    {
      kind: "item",
      id: "hire-review",
      item: item({
        category: "hire",
        title: "Hire a Customer Success lead?",
        subtitle: "Two sites go live next week.",
        source: {
          kind: "review_decision",
          reviewDate: "2026-10-30",
          decisionId: "hire-cs",
        },
      }),
    },
    {
      kind: "item",
      id: "money-review",
      item: item({
        category: "review_decision",
        title: "Approve R3,000 for delivery tools?",
        subtitle: "The next client needs a signed PDF.",
        source: {
          kind: "review_decision",
          reviewDate: "2026-10-30",
          decisionId: "budget-tools",
        },
      }),
    },
    {
      kind: "payment_link",
      id: "deposit",
      card: {
        id: "link-1",
        amountMinor: 375_000,
        currency: "ZAR",
        purpose: "Half of the signed R7,500 quote",
        invoiceLabel: "R7,500 quote",
        recipient: { name: "Thandeka" },
        customerName: "Plane Tree Guesthouse",
      },
    },
    {
      kind: "capability_gap",
      id: "invoice-gap",
      item: {
        group: "approve",
        title: "Connect invoicing",
        detail: "Let Scout prepare invoices.",
        costText: null,
      },
      functionId: "finance",
    },
  ];

  assert.deepEqual(
    rows.map((row) => {
      const copy = needsYouRowCopy(row);
      return [copy.title, copy.subtitle, copy.yesLabel, copy.noLabel];
    }),
    [
      [
        "Hire a Customer Success lead?",
        "Two sites go live next week.",
        "Hire",
        "No",
      ],
      [
        "Approve R3,000 for delivery tools?",
        "The next client needs a signed PDF.",
        "Approve",
        "No",
      ],
      [
        "Send a deposit link to Thandeka, Plane Tree Guesthouse",
        "R3,750. Half of the signed R7,500 quote",
        "Send link",
        "No",
      ],
      ["Connect invoicing", "Let Scout prepare invoices.", "Approve", "No"],
    ],
  );
});

test("groups rows in the company order and keeps unassigned work in Company", () => {
  const rows = [
    { kind: "item", id: "company", item: item({ functionId: null }) },
    {
      kind: "item",
      id: "brand",
      item: item({ functionId: "brand" }),
    },
    {
      kind: "item",
      id: "customer-success",
      item: item({ functionId: "customer_success" }),
    },
    { kind: "item", id: "finance", item: item({ functionId: "finance" }) },
    { kind: "item", id: "sales", item: item({ functionId: "sales" }) },
    {
      kind: "item",
      id: "operations",
      item: item({ functionId: "operations" }),
    },
  ];

  assert.deepEqual(
    groupNeedsYouRows(rows).map((group) => group.label),
    ["Sales", "Operations", "Finance", "Customer Success", "Brand", "Company"],
  );
});

test("yes and no buttons map each source to its existing action path", () => {
  const paymentCard = {
    id: "payment-1",
    headEventId: "head-1",
    state: "needs_you",
  };
  const gapItem = {
    gapId: "gap-1",
    group: "approve",
    pageUrl: null,
    headEventId: "gap-head-1",
  };
  const makeItemRow = (overrides) => ({
    kind: "item",
    id: "source-row",
    item: item(overrides),
  });
  const planProposal = makeItemRow({
    source: { kind: "plan", planId: "plan-1", stepId: null },
  });
  const planStep = makeItemRow({
    source: { kind: "plan", planId: "plan-1", stepId: "step-1" },
  });
  const playbook = makeItemRow({
    source: { kind: "playbook", playbookId: "playbook-1" },
  });
  const playbookJob = makeItemRow({
    source: { kind: "playbook_job", jobId: "job-1", stepId: "step-1" },
  });
  const playbookJobDo = makeItemRow({
    section: "do",
    source: { kind: "playbook_job", jobId: "job-1", stepId: "step-1" },
  });
  const goal = makeItemRow({
    source: { kind: "goal", goalId: "goal-1" },
  });
  const review = makeItemRow({
    source: {
      kind: "review_decision",
      reviewDate: "2026-11-10",
      decisionId: "decision-1",
    },
  });
  const batch = makeItemRow({
    source: { kind: "whatsapp_batch", batchId: "batch-1" },
  });
  const draft = {
    kind: "draft",
    id: "draft:draft-1",
    item: item({
      source: { kind: "whatsapp_drafts", senderPubkey: null },
    }),
    detail: { id: "draft-1", label: "Contact", text: "Hello" },
    draft: null,
    contact: null,
  };
  const ask = makeItemRow({
    source: { kind: "ask", askId: "ask-1", channelId: "channel-1" },
    actions: [{ id: "answer", label: "Answer", tone: "primary" }],
  });
  const call = {
    kind: "call_request",
    id: "call:wa-1",
    contact: { waId: "wa-1" },
  };
  const payment = {
    kind: "payment_link",
    id: "payment-link:payment-1",
    card: paymentCard,
  };
  const gap = {
    kind: "capability_gap",
    id: "capability-gap:gap-1",
    item: gapItem,
    functionId: "finance",
  };
  const gapPage = {
    ...gap,
    item: { ...gapItem, group: "do", pageUrl: "https://example.test" },
  };
  const gapDone = {
    ...gap,
    item: { ...gapItem, group: "do", pageUrl: null },
  };

  assert.deepEqual(describeNeedsYouAction(payment, "yes"), {
    kind: "payment_link",
    card: paymentCard,
    decision: "approve",
  });
  assert.equal(describeNeedsYouAction(payment, "no").decision, "reject");
  assert.equal(describeNeedsYouAction(gap, "yes").operation, "gap_approve");
  assert.equal(describeNeedsYouAction(gap, "no").operation, "gap_decline");
  assert.equal(describeNeedsYouAction(gapPage, "yes").operation, "gap_done");
  assert.equal(describeNeedsYouAction(gapPage, "no"), null);
  assert.equal(describeNeedsYouAction(gapDone, "yes").operation, "gap_done");
  assert.equal(describeNeedsYouAction(call, "yes").kind, "open");
  assert.equal(describeNeedsYouAction(call, "no"), null);
  assert.equal(describeNeedsYouAction(draft, "yes").decision, "approve");
  assert.equal(describeNeedsYouAction(draft, "no").decision, "reject");
  assert.equal(
    describeNeedsYouAction(planProposal, "yes").operation,
    "approve",
  );
  assert.equal(describeNeedsYouAction(planProposal, "no").operation, "reject");
  assert.equal(describeNeedsYouAction(planStep, "yes").operation, "approve");
  assert.equal(describeNeedsYouAction(planStep, "no").operation, "reject");
  assert.equal(describeNeedsYouAction(playbook, "yes").decision, "approve");
  assert.equal(describeNeedsYouAction(playbook, "no").decision, "reject");
  assert.equal(describeNeedsYouAction(playbookJob, "yes").operation, "approve");
  assert.equal(describeNeedsYouAction(playbookJob, "no").operation, "reject");
  assert.equal(describeNeedsYouAction(playbookJobDo, "yes").operation, "done");
  assert.equal(describeNeedsYouAction(goal, "yes").decision, "approve");
  assert.equal(describeNeedsYouAction(goal, "no").decision, "reject");
  assert.equal(describeNeedsYouAction(review, "yes").decision, "approved");
  assert.equal(describeNeedsYouAction(review, "no").decision, "declined");
  assert.equal(describeNeedsYouAction(batch, "yes").decision, "approve");
  assert.equal(describeNeedsYouAction(batch, "no").decision, "reject");
  assert.equal(describeNeedsYouAction(ask, "yes").kind, "open");
  assert.equal(describeNeedsYouAction(ask, "no"), null);
});
