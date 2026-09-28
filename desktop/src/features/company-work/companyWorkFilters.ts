import type { GoalHeadRecord } from "@/features/goals/goalModels";
import type {
  CompanyWorkHeadRecord,
  CompanyWorkStatus,
} from "./companyWorkModels";

export type CompanyWorkStatusFilter = "all" | CompanyWorkStatus;

export type CompanyWorkFilters = {
  status: CompanyWorkStatusFilter;
  ownerPubkey: string | null;
  goalId: string | null;
};

export const emptyCompanyWorkFilters: CompanyWorkFilters = {
  status: "all",
  ownerPubkey: null,
  goalId: null,
};

export function goalFilterScope(
  selectedGoalId: string | null,
  goals: readonly GoalHeadRecord[],
): Set<string> | null {
  if (!selectedGoalId) return null;

  const scope = new Set([selectedGoalId.toLowerCase()]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of goals) {
      const goal = record.head.goal;
      if (
        goal?.parentGoalId &&
        scope.has(goal.parentGoalId.toLowerCase()) &&
        !scope.has(goal.goalId.toLowerCase())
      ) {
        scope.add(goal.goalId.toLowerCase());
        changed = true;
      }
    }
  }
  return scope;
}

export function filterCompanyWorkRecords(
  records: readonly CompanyWorkHeadRecord[],
  filters: CompanyWorkFilters,
  goals: readonly GoalHeadRecord[],
): CompanyWorkHeadRecord[] {
  const goalScope = goalFilterScope(filters.goalId, goals);
  const ownerPubkey = filters.ownerPubkey?.toLowerCase() ?? null;
  return records.filter((record) => {
    if (filters.status !== "all" && record.head.status !== filters.status) {
      return false;
    }
    if (
      ownerPubkey &&
      !record.head.assignedPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === ownerPubkey,
      )
    ) {
      return false;
    }
    if (
      goalScope &&
      (!record.head.goalId || !goalScope.has(record.head.goalId.toLowerCase()))
    ) {
      return false;
    }
    return true;
  });
}

export function clearCompanyWorkFilter(
  filters: CompanyWorkFilters,
  field: keyof CompanyWorkFilters,
): CompanyWorkFilters {
  switch (field) {
    case "status":
      return { ...filters, status: "all" };
    case "ownerPubkey":
      return { ...filters, ownerPubkey: null };
    case "goalId":
      return { ...filters, goalId: null };
  }
}
