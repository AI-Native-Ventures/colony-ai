import type { AskHeadRecord } from "@/features/company-asks/askRecords";

import type { PlanDecision, PlanView } from "./planRecords";

/**
 * The durable answer to "who approved what, and when".
 *
 * Plan decisions come from the approval record inside each plan head. Ask
 * decisions come from the resolved ask heads. Each entry names the person who
 * decided; an agent never appears as the decider.
 */
export type ApprovalLogDecision = PlanDecision | "answered";

export type ApprovalLogEntry = {
  id: string;
  /** Unix seconds. */
  at: number;
  actorPubkey: string;
  decision: ApprovalLogDecision;
  /** What was decided: the plan or step title, or the ask title. */
  subject: string;
  source:
    | { kind: "plan"; planId: string; stepId: string | null; revision: number }
    | { kind: "ask"; askId: string; channelId: string };
  note: string | null;
};

function seconds(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export function buildApprovalLog(sources: {
  plans: readonly PlanView[];
  asks: readonly AskHeadRecord[];
}): ApprovalLogEntry[] {
  const entries: ApprovalLogEntry[] = [];
  for (const plan of sources.plans) {
    for (const [index, record] of plan.approvals.entries()) {
      const step = record.stepId
        ? plan.steps.find((candidate) => candidate.stepId === record.stepId)
        : null;
      entries.push({
        id: `plan:${plan.planId}:${index}`,
        at: record.at,
        actorPubkey: record.actorPubkey,
        decision: record.decision,
        subject: step ? step.title : plan.title,
        source: {
          kind: "plan",
          planId: plan.planId,
          stepId: record.stepId,
          revision: record.revision,
        },
        note: record.note,
      });
    }
  }
  for (const record of sources.asks) {
    const { head } = record;
    if (head.status !== "resolved" || !head.resolution) continue;
    const { outcome, resolvedByPubkey, resolvedAt, reason } = head.resolution;
    entries.push({
      id: `ask:${head.askId}`,
      at: seconds(resolvedAt),
      actorPubkey: resolvedByPubkey,
      decision:
        outcome === "approved" || outcome === "confirmed" || outcome === "pass"
          ? "approved"
          : outcome === "rejected" || outcome === "fail"
            ? "rejected"
            : "answered",
      subject: head.ask.title,
      source: { kind: "ask", askId: head.askId, channelId: record.channelId },
      note: reason ?? null,
    });
  }
  return entries.sort(
    (first, second) =>
      second.at - first.at || first.id.localeCompare(second.id),
  );
}
