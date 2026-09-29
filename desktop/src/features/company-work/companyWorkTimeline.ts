import type { CompanyWorkHistoryEntry } from "./companyWorkModels";

export type CompanyWorkTimelineEntry = {
  eventId: string;
  createdAt: number;
  actorPubkey: string;
  channelId: string;
  label: string;
  reason?: string;
  evidence?: string;
};

export function projectCompanyWorkTimeline(
  history: readonly CompanyWorkHistoryEntry[],
): CompanyWorkTimelineEntry[] {
  let previousThreadRoot: string | undefined;
  let previousDueAt: string | undefined;
  const chronological = [...history].sort(
    (left, right) =>
      left.event.created_at - right.event.created_at ||
      left.event.id.localeCompare(right.event.id),
  );
  const entries = chronological.map((entry) => {
    const action = entry.action;
    let label: string;
    switch (action.action) {
      case "create":
        label = "created this commitment.";
        previousThreadRoot = action.head?.threadRootEventId;
        previousDueAt = action.head?.dueAt;
        break;
      case "update": {
        const nextThreadRoot = action.head?.threadRootEventId;
        label =
          nextThreadRoot !== previousThreadRoot
            ? "moved this work item to a new thread."
            : "updated this work item.";
        previousThreadRoot = nextThreadRoot;
        break;
      }
      case "set_status":
        label = `changed the status to ${(action.status ?? "active").replaceAll("_", " ")}.`;
        break;
      case "verify":
        label =
          action.verification?.verdict === "pass"
            ? "verified the done condition."
            : "requested revisions.";
        break;
      case "archive":
        label = "archived this work item.";
        break;
      case "restore":
        label = "restored this work item.";
        break;
      case "set_due_date":
        label = previousDueAt ? "changed the due date." : "set a due date.";
        previousDueAt = action.dueAt;
        break;
      case "clear_due_date":
        label = "cleared the due date.";
        previousDueAt = undefined;
        break;
    }
    return {
      eventId: entry.event.id,
      createdAt: entry.event.created_at,
      actorPubkey: entry.event.pubkey,
      channelId: entry.channelId,
      label,
      ...(action.reason ? { reason: action.reason } : {}),
      ...(action.verification?.reason
        ? { reason: action.verification.reason }
        : {}),
      ...(action.verification?.evidence
        ? { evidence: action.verification.evidence }
        : {}),
    };
  });
  return entries.reverse();
}
