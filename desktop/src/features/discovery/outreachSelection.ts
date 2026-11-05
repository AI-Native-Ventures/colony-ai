export type OutreachWhatsAppStatus =
  | "not-contacted"
  | "in-batch"
  | "sent"
  | "replied"
  | "opted-out"
  | "no-number";

export type OutreachRow = {
  id: string;
  searchableText: string;
  hasPhone: boolean;
  whatsappStatus: OutreachWhatsAppStatus;
  stage: string;
};

export type OutreachFilters = {
  hasPhone: boolean | null;
  whatsappStatuses: ReadonlySet<OutreachWhatsAppStatus>;
  stages: ReadonlySet<string>;
};

export const EMPTY_OUTREACH_FILTERS: OutreachFilters = {
  hasPhone: null,
  whatsappStatuses: new Set(),
  stages: new Set(),
};

export function filterOutreachRows<T extends OutreachRow>(
  rows: readonly T[],
  filters: OutreachFilters,
  query = "",
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (filters.hasPhone !== null && row.hasPhone !== filters.hasPhone) {
      return false;
    }
    if (
      filters.whatsappStatuses.size > 0 &&
      !filters.whatsappStatuses.has(row.whatsappStatus)
    ) {
      return false;
    }
    if (filters.stages.size > 0 && !filters.stages.has(row.stage)) return false;
    return !needle || row.searchableText.toLocaleLowerCase().includes(needle);
  });
}

/** Counts each option independently while keeping the current search query. */
export function outreachFilterCounts(
  rows: readonly OutreachRow[],
  _filters: OutreachFilters,
  query = "",
): {
  hasPhone: number;
  whatsapp: Record<OutreachWhatsAppStatus, number>;
  stages: Record<string, number>;
} {
  const baseRows = filterOutreachRows(rows, EMPTY_OUTREACH_FILTERS, query);
  const statuses: OutreachWhatsAppStatus[] = [
    "not-contacted",
    "in-batch",
    "sent",
    "replied",
    "opted-out",
    "no-number",
  ];
  return {
    hasPhone: baseRows.filter((row) => row.hasPhone).length,
    whatsapp: Object.fromEntries(
      statuses.map((status) => [
        status,
        baseRows.filter((row) => row.whatsappStatus === status).length,
      ]),
    ) as Record<OutreachWhatsAppStatus, number>,
    stages: Object.fromEntries(
      [...new Set(rows.map((row) => row.stage))].map((stage) => [
        stage,
        baseRows.filter((row) => row.stage === stage).length,
      ]),
    ),
  };
}

/** Pointer and keyboard checkbox changes share the same shift-range behavior. */
export function toggleOutreachSelection(input: {
  selected: ReadonlySet<string>;
  visibleIds: readonly string[];
  id: string;
  checked: boolean;
  shiftKey: boolean;
  anchorId: string | null;
}): { selected: Set<string>; anchorId: string } {
  const selected = new Set(input.selected);
  const anchorIndex = input.anchorId
    ? input.visibleIds.indexOf(input.anchorId)
    : -1;
  const targetIndex = input.visibleIds.indexOf(input.id);
  const canRangeSelect = input.shiftKey && anchorIndex >= 0 && targetIndex >= 0;
  const ids = canRangeSelect
    ? input.visibleIds.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1,
      )
    : [input.id];
  for (const id of ids) {
    if (input.checked) selected.add(id);
    else selected.delete(id);
  }
  return {
    selected,
    anchorId: canRangeSelect ? (input.anchorId ?? input.id) : input.id,
  };
}

export function selectAllMatching(
  selected: ReadonlySet<string>,
  matchingIds: readonly string[],
): Set<string> {
  return new Set([...selected, ...matchingIds]);
}
