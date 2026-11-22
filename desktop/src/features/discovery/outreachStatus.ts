import type {
  OutreachStatus,
  OutreachStatusRecord,
} from "./businessRecordContract";

export type OutreachStatusFilter = "all" | OutreachStatus;

export type OutreachStatusProgress = Readonly<{
  messaged: number;
  resolved: number;
  total: number;
}>;

export const OUTREACH_STATUS_OPTIONS = [
  {
    value: "not_started",
    label: "Not started",
    description: "Nobody has messaged this list yet.",
  },
  {
    value: "in_progress",
    label: "In progress",
    description: "Outreach is running on this list.",
  },
  {
    value: "done",
    label: "Done",
    description: "Everyone on the list has been contacted.",
  },
] as const satisfies ReadonlyArray<{
  value: OutreachStatus;
  label: string;
  description: string;
}>;

export function outreachStatusFor(
  outreach: OutreachStatusRecord | null | undefined,
  progress?: OutreachStatusProgress | null,
): OutreachStatus {
  if (outreach) return outreach.status;
  if (!progress) return "not_started";
  if (progress.total > 0 && progress.resolved >= progress.total) {
    return "done";
  }
  return progress.messaged > 0 ? "in_progress" : "not_started";
}

function resolvedOutreachStatus(
  value: OutreachStatus | OutreachStatusRecord | null | undefined,
): OutreachStatus {
  return typeof value === "string" ? value : outreachStatusFor(value);
}

export function outreachStatusOption(status: OutreachStatus) {
  const option = OUTREACH_STATUS_OPTIONS.find(
    (candidate) => candidate.value === status,
  );
  if (!option) throw new Error("Unknown outreach status.");
  return option;
}

export function countOutreachStatusFilters<T>(
  records: readonly T[],
  outreachForRecord: (
    record: T,
  ) => OutreachStatus | OutreachStatusRecord | null | undefined,
): Record<OutreachStatusFilter, number> {
  const counts: Record<OutreachStatusFilter, number> = {
    all: records.length,
    not_started: 0,
    in_progress: 0,
    done: 0,
  };
  for (const record of records) {
    counts[resolvedOutreachStatus(outreachForRecord(record))] += 1;
  }
  return counts;
}

export function filterByOutreachStatus<T>(
  records: readonly T[],
  filter: OutreachStatusFilter,
  outreachForRecord: (
    record: T,
  ) => OutreachStatus | OutreachStatusRecord | null | undefined,
): T[] {
  if (filter === "all") return [...records];
  return records.filter(
    (record) => resolvedOutreachStatus(outreachForRecord(record)) === filter,
  );
}

/** A created batch only starts untouched outreach. It never overwrites a later decision. */
export function shouldAutoMarkOutreachInProgress(
  outreach: OutreachStatusRecord | null | undefined,
): boolean {
  const status = outreachStatusFor(outreach);
  return status === "not_started";
}

function calendarDay(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Africa/Johannesburg",
    year: "numeric",
  }).format(value);
}

export function formatOutreachStatusSetAt(
  unixSeconds: number,
  now = new Date(),
): string {
  const setAt = new Date(unixSeconds * 1000);
  if (calendarDay(setAt) === calendarDay(now)) {
    const time = new Intl.DateTimeFormat("en-ZA", {
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      timeZone: "Africa/Johannesburg",
    }).format(setAt);
    return `today ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (calendarDay(setAt) === calendarDay(yesterday)) return "yesterday";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Johannesburg",
  }).format(setAt);
}

export function outreachStatusFootnote(
  outreach: OutreachStatusRecord,
  setByName: string,
): string {
  const when = formatOutreachStatusSetAt(outreach.setAt).replace(
    /^today /u,
    "today at ",
  );
  return `Set to ${outreachStatusOption(outreach.status).label} by ${setByName} ${when}.`;
}
