import { FUNCTION_DETAILS } from "../functions";
import { planActions } from "../planActions";
import type { PlanProposalInput } from "../planActions";
import { usePlanAction } from "../planHooks";
import { planTotals } from "../planRecords";
import type { PlanStepView, PlanView } from "../planRecords";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { CofounderPlan } from "../cofounderPhase2Model";
import { CofounderPlanCard } from "./CofounderPlanCard";

function ownerLabel(
  step: PlanStepView,
  profiles: Record<string, { displayName: string | null }> | undefined,
): string {
  const agentName = step.owner.agentPubkey
    ? profiles?.[step.owner.agentPubkey.toLowerCase()]?.displayName?.trim()
    : null;
  switch (step.owner.kind) {
    case "function":
      return step.owner.functionId
        ? FUNCTION_DETAILS[step.owner.functionId].name
        : "Company team";
    case "lead_agent":
      return `${agentName || "Lead agent"}${
        step.tools.length > 0 ? ` with ${step.tools.join(", ")}` : ""
      }`;
    case "worker":
      return agentName
        ? `Workers under ${agentName}`
        : step.owner.workerType
          ? `${step.owner.workerType.replaceAll("_", " ")} worker`
          : "Worker";
    case "owner":
      return "You";
  }
}

function statusLabel(status: PlanView["status"]): CofounderPlan["status"] {
  switch (status) {
    case "proposed":
    case "approved":
    case "rejected":
      return status;
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
  }
}

function stepStatusLabel(
  status: PlanStepView["status"],
): CofounderPlan["steps"][number]["status"] {
  switch (status) {
    case "pending":
      return "planned";
    case "waiting_approval":
      return "waiting";
    case "approved":
    case "in_progress":
    case "done":
    case "skipped":
    case "failed":
      return status;
  }
}

function formatCost(plan: PlanView): string {
  const { costCents, currency } = planTotals(plan);
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(costCents / 100);
  } catch {
    return `${currency} ${(costCents / 100).toFixed(0)}`;
  }
}

function decideByLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  const date = new Date(seconds * 1_000);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function toCofounderPlan(
  plan: PlanView,
  profiles?: Record<string, { displayName: string | null }>,
): CofounderPlan {
  const totals = planTotals(plan);
  return {
    id: plan.planId,
    title: plan.title,
    summary: plan.summary,
    functionName: plan.functionId
      ? FUNCTION_DETAILS[plan.functionId].name
      : "Company plan",
    decideBy: decideByLabel(plan.decideBy),
    steps: plan.steps.map((step) => ({
      id: step.stepId,
      title: step.title,
      owner: ownerLabel(step, profiles),
      cost: step.costLabel,
      timing: step.whenLabel,
      status: stepStatusLabel(step.status),
    })),
    costSummary: `About ${formatCost(plan)}`,
    timingSummary: totals.timingLabel ?? "Timing not set",
    targetSummary: totals.targetLabel ?? "Target not set",
    status: statusLabel(plan.status),
  };
}

function toPlanProposal(plan: PlanView, title: string): PlanProposalInput {
  return {
    title,
    summary: plan.summary,
    ...(plan.functionId ? { function: plan.functionId } : {}),
    currency: plan.currency,
    budgetCents: plan.budgetCents,
    ...(plan.decideBy !== null ? { decideBy: plan.decideBy } : {}),
    ...(plan.targetLabel ? { targetLabel: plan.targetLabel } : {}),
    ...(plan.timingLabel ? { timingLabel: plan.timingLabel } : {}),
    steps: plan.steps.map((step) => ({
      stepId: step.stepId,
      title: step.title,
      ...(step.detail ? { detail: step.detail } : {}),
      owner: {
        kind: step.owner.kind,
        ...(step.owner.functionId ? { function: step.owner.functionId } : {}),
        ...(step.owner.agentPubkey
          ? { agentPubkey: step.owner.agentPubkey }
          : {}),
        ...(step.owner.workerType ? { workerType: step.owner.workerType } : {}),
      },
      ...(step.tools.length > 0 ? { tools: step.tools } : {}),
      costLabel: step.costLabel,
      costEstimateCents: step.costEstimateCents,
      whenLabel: step.whenLabel,
      ...(step.approvalPoint ? { approvalPoint: step.approvalPoint } : {}),
      ...(step.note ? { note: step.note } : {}),
    })),
  };
}

export function CofounderRelayPlanCard({ plan }: { plan: PlanView }) {
  const action = usePlanAction();
  const pubkeys = plan.steps.flatMap((step) =>
    step.owner.agentPubkey ? [step.owner.agentPubkey] : [],
  );
  const profiles = useUsersBatchQuery(pubkeys, { enabled: pubkeys.length > 0 });
  const view = toCofounderPlan(plan, profiles.data?.profiles);
  return (
    <CofounderPlanCard
      onApprove={async (planId) => {
        if (planId !== plan.planId) return;
        await action.mutateAsync(planActions.approve(plan));
      }}
      onEdit={async (planId, changes) => {
        if (planId !== plan.planId) return;
        await action.mutateAsync(
          planActions.edit(plan, toPlanProposal(plan, changes.title)),
        );
      }}
      onReject={async (planId) => {
        if (planId !== plan.planId) return;
        await action.mutateAsync(planActions.reject(plan));
      }}
      plan={view}
    />
  );
}
