import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_PLAN_HEAD } from "@/shared/constants/kinds";
import { planDTag } from "./planRecords.ts";

export const PLAN_ID = "7f0c3c1e-5b1e-4d52-9a55-3d1f2b6a8c10";
export const RELAY_SECRET = generateSecretKey();
export const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
export const AGENT = "a".repeat(64);
export const OWNER = "b".repeat(64);

export function step(id, overrides = {}) {
  return {
    stepId: id,
    title: `Step ${id}`,
    owner: { kind: "function", function: "sales" },
    costLabel: "Free",
    costEstimateCents: 0,
    whenLabel: "This week",
    status: "pending",
    ...overrides,
  };
}

export function headContent(overrides = {}) {
  return {
    schemaVersion: 1,
    planId: PLAN_ID,
    status: "proposed",
    revision: 1,
    plan: {
      title: "Get 5 clients in November",
      summary: "Goal for Sales.",
      function: "sales",
      currency: "ZAR",
      budgetCents: 0,
      targetLabel: "5 won",
      timingLabel: "1 to 30 November",
      steps: [
        step("find", { costEstimateCents: 0 }),
        step("send", { costEstimateCents: 3700, costLabel: "About R37" }),
      ],
    },
    proposedByPubkey: AGENT,
    proposedAt: 1_793_000_000,
    updatedByPubkey: AGENT,
    updatedAt: 1_793_000_000,
    approvals: [],
    sourceActionEventId: "c".repeat(64),
    ...overrides,
  };
}

export function signHead(content = headContent(), overrides = {}) {
  return finalizeEvent(
    {
      kind: KIND_PLAN_HEAD,
      content: JSON.stringify(content),
      tags: [["d", planDTag(content.planId ?? PLAN_ID)]],
      created_at: 1_793_000_000,
      ...overrides,
    },
    overrides.secret ?? RELAY_SECRET,
  );
}
