import type { CompanyWorkHistoryEntry } from "./companyWorkModels";
import type { CompanyWorkSuggestionAcceptanceEntry } from "./companyWorkTrackingModels";

export type CompanyWorkTimelineEntry = {
  eventId: string;
  createdAt: number;
  actorPubkey: string;
  channelId: string;
  label: string;
  reason?: string;
  evidence?: string;
  dueAt?: string;
};

export function projectCompanyWorkTimeline(
  history: readonly (
    | CompanyWorkHistoryEntry
    | CompanyWorkSuggestionAcceptanceEntry
  )[],
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
    let dueAt: string | undefined;
    if ("acceptedWorkItemId" in action) {
      label = "accepted a commitment suggestion.";
    } else {
      switch (action.action) {
        case "create":
          label = "created this commitment.";
          previousThreadRoot = action.head?.threadRootEventId;
          previousDueAt = action.head?.dueAt;
          dueAt = previousDueAt;
          break;
        case "update": {
          const nextThreadRoot = action.head?.threadRootEventId;
          label =
            nextThreadRoot !== previousThreadRoot
              ? "moved this work item to a new thread."
              : "updated this work item.";
          previousThreadRoot = nextThreadRoot;
          if (action.head?.dueAt !== previousDueAt) {
            previousDueAt = action.head?.dueAt;
            dueAt = previousDueAt;
          }
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
          dueAt = action.dueAt;
          break;
        case "clear_due_date":
          label = "cleared the due date.";
          dueAt = previousDueAt;
          previousDueAt = undefined;
          break;
      }
    }
    const workAction = "acceptedWorkItemId" in action ? null : action;
    return {
      eventId: entry.event.id,
      createdAt: entry.event.created_at,
      actorPubkey: entry.event.pubkey,
      channelId: entry.channelId,
      label,
      ...(dueAt ? { dueAt } : {}),
      ...(workAction?.reason ? { reason: workAction.reason } : {}),
      ...(workAction?.verification?.reason
        ? { reason: workAction.verification.reason }
        : {}),
      ...(workAction?.verification?.evidence
        ? { evidence: workAction.verification.evidence }
        : {}),
    };
  });
  return entries.reverse();
}
