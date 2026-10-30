import { COMPANY_RECORD_SCHEMA_VERSION } from "./cofounderRecords";
import { planDTag } from "./planRecords";
import type { PlanStepStatus, PlanView } from "./planRecords";

/** What a proposal says; steps start pending. Mirrors `PlanProposal` in buzz-core. */
export type PlanProposalInput = {
  title: string;
  summary?: string;
  function?: string;
  currency: string;
  budgetCents?: number;
  decideBy?: number;
  targetLabel?: string;
  timingLabel?: string;
  steps: Array<Record<string, unknown>>;
};

export type PlanActionInput =
  | { kind: "propose"; planId: string; plan: PlanProposalInput }
  | {
      kind: "revise";
      planId: string;
      plan: PlanProposalInput;
      expectedHeadEventId: string;
    }
  | {
      kind: "approve" | "reject";
      planId: string;
      revision: number;
      note?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "cancel";
      planId: string;
      note?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "request_step_approval" | "approve_step" | "reject_step";
      planId: string;
      stepId: string;
      note?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "update_step";
      planId: string;
      stepId: string;
      stepStatus: Exclude<
        PlanStepStatus,
        "pending" | "waiting_approval" | "approved"
      >;
      note?: string;
      expectedHeadEventId: string;
    };

/** The signed event content and tags of one plan action (kind 47063). */
export function buildPlanActionEvent(input: PlanActionInput): {
  content: string;
  tags: string[][];
} {
  const body: Record<string, unknown> = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    planId: input.planId,
    kind: input.kind,
  };
  if ("plan" in input) body.plan = input.plan;
  if ("revision" in input) body.revision = input.revision;
  if ("stepId" in input) body.stepId = input.stepId;
  if ("stepStatus" in input) body.stepStatus = input.stepStatus;
  if ("note" in input && input.note) body.note = input.note;
  if ("expectedHeadEventId" in input) {
    body.expectedHeadEventId = input.expectedHeadEventId;
  }
  return {
    content: JSON.stringify(body),
    tags: [["d", planDTag(input.planId)]],
  };
}

/** One-tap helpers for the plan card and Needs you. Each names the exact head and revision seen. */
export const planActions = {
  approve: (plan: PlanView, note?: string): PlanActionInput => ({
    kind: "approve",
    planId: plan.planId,
    revision: plan.revision,
    note,
    expectedHeadEventId: plan.eventId,
  }),
  reject: (plan: PlanView, note?: string): PlanActionInput => ({
    kind: "reject",
    planId: plan.planId,
    revision: plan.revision,
    note,
    expectedHeadEventId: plan.eventId,
  }),
  edit: (plan: PlanView, proposal: PlanProposalInput): PlanActionInput => ({
    kind: "revise",
    planId: plan.planId,
    plan: proposal,
    expectedHeadEventId: plan.eventId,
  }),
  cancel: (plan: PlanView, note?: string): PlanActionInput => ({
    kind: "cancel",
    planId: plan.planId,
    note,
    expectedHeadEventId: plan.eventId,
  }),
  approveStep: (
    plan: PlanView,
    stepId: string,
    note?: string,
  ): PlanActionInput => ({
    kind: "approve_step",
    planId: plan.planId,
    stepId,
    note,
    expectedHeadEventId: plan.eventId,
  }),
  rejectStep: (
    plan: PlanView,
    stepId: string,
    note?: string,
  ): PlanActionInput => ({
    kind: "reject_step",
    planId: plan.planId,
    stepId,
    note,
    expectedHeadEventId: plan.eventId,
  }),
  markDone: (
    plan: PlanView,
    stepId: string,
    note?: string,
  ): PlanActionInput => ({
    kind: "update_step",
    planId: plan.planId,
    stepId,
    stepStatus: "done",
    note,
    expectedHeadEventId: plan.eventId,
  }),
};
