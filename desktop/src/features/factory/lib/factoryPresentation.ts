import type { FactoryRun, FactoryRunStatus } from "@/shared/api/factoryRuntime";

export const FACTORY_STATUS_PRESENTATION: Record<
  FactoryRunStatus,
  { label: string; tone: string }
> = {
  queued: { label: "Queued", tone: "queued" },
  running: { label: "Working", tone: "working" },
  waiting: { label: "Waiting", tone: "waiting" },
  blocked: { label: "Blocked", tone: "blocked" },
  error: { label: "Failed", tone: "failed" },
  done: { label: "Done", tone: "done" },
  cancelled: { label: "Cancelled", tone: "cancelled" },
};

export function factoryStatusPresentation(status: FactoryRunStatus) {
  return FACTORY_STATUS_PRESENTATION[status];
}

export function latestRunForProject(
  runs: FactoryRun[],
  projectId: string,
): FactoryRun | null {
  const matchingRuns = runs
    .filter((run) => run.projectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return matchingRuns[0] ?? null;
}
