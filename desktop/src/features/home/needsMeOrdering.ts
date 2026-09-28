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

export type NeedsMeGrouping = "deadline" | "type" | "channel";

export type NeedsMeGroup = {
  key: string;
  label: string;
  items: NeedsMeItem[];
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

function itemChannelId(item: NeedsMeItem) {
  return item.record.channelId;
}

function itemTypeGroup(item: NeedsMeItem) {
  if (item.kind === "workflow_approval") {
    return { key: "approvals", label: "Approvals & consent" };
  }
  if (item.record.head.ask.category === "money") {
    return { key: "funding", label: "Funding" };
  }
  if (item.record.head.ask.type === "approval") {
    return { key: "approvals", label: "Approvals & consent" };
  }
  return { key: "questions-checks", label: "Questions & checks" };
}

function deadlineGroupLabel(deadline: number | null, now: number) {
  if (deadline === null || !Number.isFinite(deadline)) return "No deadline";
  const date = new Date(deadline);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (first: Date, second: Date) =>
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function isNeedsMeItemOverdue(item: NeedsMeItem, now = Date.now()) {
  return (
    item.deadline !== null &&
    Number.isFinite(item.deadline) &&
    item.deadline < now
  );
}

/** Groups the already deadline-sorted queue without dropping or reordering records within groups. */
export function groupNeedsMeItems(
  items: readonly NeedsMeItem[],
  grouping: NeedsMeGrouping,
  options: {
    now?: number;
    channelLabel?: (channelId: string) => string;
  } = {},
): { overdue: NeedsMeItem[]; groups: NeedsMeGroup[] } {
  const now = options.now ?? Date.now();
  const overdue: NeedsMeItem[] = [];
  const groups = new Map<string, NeedsMeGroup>();

  for (const item of items) {
    if (isNeedsMeItemOverdue(item, now)) {
      overdue.push(item);
      continue;
    }

    let group: { key: string; label: string };
    if (grouping === "deadline") {
      group = {
        key: `deadline:${deadlineGroupLabel(item.deadline, now)}`,
        label: deadlineGroupLabel(item.deadline, now),
      };
    } else if (grouping === "type") {
      group = itemTypeGroup(item);
    } else {
      const channelId = itemChannelId(item);
      group = {
        key: `channel:${channelId}`,
        label: options.channelLabel?.(channelId) ?? channelId,
      };
    }

    const existing = groups.get(group.key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(group.key, { ...group, items: [item] });
    }
  }

  return { overdue, groups: [...groups.values()] };
}

export function needsMeItemKey(item: NeedsMeItem) {
  return stableKey(item);
}
