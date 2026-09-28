import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import type { PendingWorkflowApproval } from "./needsMe";
import type { NeedsMeData } from "./needsMeHooks";

export type NeedsMeItem =
  | { kind: "ask"; record: AskHeadRecord; deadline: number | null }
  | {
      kind: "workflow_approval";
      record: PendingWorkflowApproval;
      deadline: number | null;
    };

function deadlineValue(deadline: number | null) {
  return deadline !== null && Number.isFinite(deadline)
    ? deadline
    : Number.POSITIVE_INFINITY;
}

function createdAtValue(item: NeedsMeItem) {
  const createdAt =
    item.kind === "ask"
      ? Date.parse(item.record.head.createdAt)
      : item.record.approval.createdAt * 1_000;
  return Number.isFinite(createdAt) ? createdAt : Number.POSITIVE_INFINITY;
}

function stableKey(item: NeedsMeItem) {
  return item.kind === "ask"
    ? `ask:${item.record.channelId}:${item.record.head.askId}`
    : `workflow:${item.record.workflow.id}:${item.record.run.id}:${item.record.approval.approvalRef}`;
}

export function buildNeedsMeItems(
  data: NeedsMeData | undefined,
): NeedsMeItem[] {
  if (!data) return [];
  const items: NeedsMeItem[] = [
    ...data.asks.map((record) => ({
      kind: "ask" as const,
      record,
      deadline: record.head.ask.decideBy
        ? Date.parse(record.head.ask.decideBy)
        : null,
    })),
    ...data.workflowApprovals.map((record) => ({
      kind: "workflow_approval" as const,
      record,
      deadline: Date.parse(record.approval.expiresAt),
    })),
  ];

  return items.sort((first, second) => {
    const firstDeadline = deadlineValue(first.deadline);
    const secondDeadline = deadlineValue(second.deadline);
    if (firstDeadline < secondDeadline) return -1;
    if (firstDeadline > secondDeadline) return 1;

    const firstCreatedAt = createdAtValue(first);
    const secondCreatedAt = createdAtValue(second);
    if (firstCreatedAt < secondCreatedAt) return -1;
    if (firstCreatedAt > secondCreatedAt) return 1;

    return stableKey(first).localeCompare(stableKey(second));
  });
}
