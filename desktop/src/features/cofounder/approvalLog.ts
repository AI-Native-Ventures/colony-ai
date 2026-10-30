import type { AskHeadRecord } from "@/features/company-asks/askRecords";

import type { PlanDecision, PlanView } from "./planRecords";
import type {
  JobView,
  PlaybookDecision,
  PlaybookView,
} from "./playbookRecords";

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
    | { kind: "playbook"; playbookId: string; version: number }
    | { kind: "playbook_job"; jobId: string; stepId: string }
    | { kind: "ask"; askId: string; channelId: string };
  note: string | null;
};

function seconds(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/** A playbook the owner wrote directly counts as approved; a withdrawal or an archive as stopped. */
function playbookDecision(decision: PlaybookDecision): PlanDecision {
  switch (decision) {
    case "approved":
    case "published":
      return "approved";
    case "rejected":
      return "rejected";
    case "edited":
      return "edited";
    default:
      return "cancelled";
  }
}

export function buildApprovalLog(sources: {
  plans: readonly PlanView[];
  asks: readonly AskHeadRecord[];
  playbooks?: readonly PlaybookView[];
  playbookJobs?: readonly JobView[];
}): ApprovalLogEntry[] {
  const entries: ApprovalLogEntry[] = [];
  for (const playbook of sources.playbooks ?? []) {
    for (const [index, record] of playbook.records.entries()) {
      entries.push({
        id: `playbook:${playbook.playbookId}:${index}`,
        at: record.at,
        actorPubkey: record.actorPubkey,
        decision: playbookDecision(record.decision),
        subject: record.changeSummary
          ? `${playbook.title}: ${record.changeSummary}`
          : playbook.title,
        source: {
          kind: "playbook",
          playbookId: playbook.playbookId,
          version: record.version,
        },
        note: record.note,
      });
    }
  }
  for (const job of sources.playbookJobs ?? []) {
    for (const [index, record] of job.approvals.entries()) {
      const step = job.steps.find(
        (candidate) => candidate.stepId === record.stepId,
      );
      entries.push({
        id: `playbook-job:${job.jobId}:${index}`,
        at: record.at,
        actorPubkey: record.actorPubkey,
        decision: record.decision,
        subject: `${step?.title ?? record.stepId} (${job.title})`,
        source: {
          kind: "playbook_job",
          jobId: job.jobId,
          stepId: record.stepId,
        },
        note: record.note,
      });
    }
  }
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
