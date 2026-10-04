import { useCompanyManagedAgentsQuery } from "@/features/agents/useCompanyManagedAgents";
import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronRight,
  FileText,
  GitBranch,
  Globe,
  Network,
  Plus,
  Search,
  Terminal,
  Folder,
} from "lucide-react";

import { useProjectsQuery } from "@/features/projects/hooks";
import {
  FACTORY_PLAN_CHANGE_EVENT,
  factoryPlanStorageKey,
  loadFactoryPlans,
  type FactoryPlanRecord,
} from "@/features/factory/plans/factoryPlanStore";
import { factoryStatusPresentation } from "@/features/factory/lib/factoryPresentation";
import { requestFactorySessionStart } from "@/features/factory/lib/factorySessionRequest";
import {
  getFactoryRunSnapshot,
  listFactoryRuns,
  type FactoryRun,
  type FactoryRunSnapshot,
  type FactoryScope,
} from "@/shared/api/factoryRuntime";

type FactoryNavigatorProps = {
  scope: FactoryScope;
};

export function FactoryNavigator({ scope }: FactoryNavigatorProps) {
  const navigate = useNavigate();
  const queryKey = React.useMemo(
    () => [
      "factory-runs",
      scope.relayUrl,
      scope.identityPubkey,
      scope.businessCommunityId,
      scope.clientChannelId ?? "",
    ],
    [
      scope.relayUrl,
      scope.identityPubkey,
      scope.businessCommunityId,
      scope.clientChannelId,
    ],
  );
  const planStorageKey = factoryPlanStorageKey(scope);
  const runsQuery = useQuery({
    queryKey,
    queryFn: listFactoryRuns,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const projectsQuery = useProjectsQuery();
  const agentsQuery = useCompanyManagedAgentsQuery();
  const runs = runsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const visibleRuns = [...runs].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const titleQueries = useQueries({
    queries: visibleRuns.slice(0, 30).map((run) => ({
      queryKey: ["factory-run-title", queryKey, run.id],
      queryFn: () => getFactoryRunSnapshot(run.id),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const snapshots = new Map<string, FactoryRunSnapshot>();
  for (const [index, run] of visibleRuns.slice(0, 30).entries()) {
    const snapshot = titleQueries[index]?.data;
    if (snapshot) snapshots.set(run.id, snapshot);
  }
  const [sessionFilter, setSessionFilter] = React.useState("");
  const [plans, setPlans] = React.useState<FactoryPlanRecord[]>([]);
  const [planLoadError, setPlanLoadError] = React.useState<string | null>(null);

  const reloadPlans = React.useCallback(() => {
    try {
      setPlans(loadFactoryPlans(window.localStorage, scope));
      setPlanLoadError(null);
    } catch (error) {
      setPlanLoadError(
        error instanceof Error ? error.message : "Plans could not be loaded.",
      );
    }
  }, [scope]);

  React.useEffect(() => {
    reloadPlans();
    const refreshChangedPlans = (event: Event) => {
      const changedKey = (event as CustomEvent<string>).detail;
      if (changedKey === planStorageKey) reloadPlans();
    };
    window.addEventListener(FACTORY_PLAN_CHANGE_EVENT, refreshChangedPlans);
    return () =>
      window.removeEventListener(
        FACTORY_PLAN_CHANGE_EVENT,
        refreshChangedPlans,
      );
  }, [planStorageKey, reloadPlans]);

  const projectById = new Map(
    projects.flatMap((project) => [
      [project.id, project] as const,
      [project.projectAddress, project] as const,
    ]),
  );
  const runTitles = new Map(
    visibleRuns.map((run) => [
      run.id,
      runTitle(
        run,
        snapshots.get(run.id),
        agents.find((agent) => agent.pubkey === run.agentId)?.name,
      ),
    ]),
  );
  const normalizedFilter = sessionFilter.trim().toLocaleLowerCase();
  const matchingRunIds = new Set<string>();
  if (!normalizedFilter) {
    for (const run of visibleRuns) matchingRunIds.add(run.id);
  } else {
    for (const run of visibleRuns) {
      const projectName = projectById.get(run.projectId ?? "")?.name ?? "";
      const searchable = [
        runTitles.get(run.id),
        projectName,
        run.harnessId,
        agents.find((agent) => agent.pubkey === run.agentId)?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      if (!searchable.includes(normalizedFilter)) continue;
      let current: FactoryRun | undefined = run;
      while (current && !matchingRunIds.has(current.id)) {
        matchingRunIds.add(current.id);
        current = current.parentRunId
          ? visibleRuns.find(
              (candidate) => candidate.id === current?.parentRunId,
            )
          : undefined;
      }
    }
  }

  const runsByParent = new Map<string | null, FactoryRun[]>();
  for (const run of visibleRuns) {
    if (!matchingRunIds.has(run.id)) continue;
    const parentId =
      run.parentRunId && matchingRunIds.has(run.parentRunId)
        ? run.parentRunId
        : null;
    const children = runsByParent.get(parentId) ?? [];
    children.push(run);
    runsByParent.set(parentId, children);
  }
  const runsWithPlans = new Set(
    visibleRuns.map((run) => run.projectId).filter(Boolean),
  );
  const visiblePlans = plans.filter((plan) =>
    runsWithPlans.has(plan.projectId),
  );

  const bringInAgent = () => requestFactorySessionStart(scope);
  const openAllSessions = () =>
    void navigate({ to: "/factory/sessions" as never });
  const openRun = (run: FactoryRun) =>
    void navigate({
      to: "/factory/review/$runId" as never,
      params: { runId: run.id },
    } as never);
  const openPlan = (planId: string) =>
    void navigate({
      to: "/factory/plan/$planId" as never,
      params: { planId },
    } as never);

  const renderRun = (
    run: FactoryRun,
    depth: number,
    ancestors: ReadonlySet<string>,
  ): React.ReactNode => {
    if (ancestors.has(run.id)) return null;
    const nextAncestors = new Set(ancestors).add(run.id);
    const children = runsByParent.get(run.id) ?? [];
    const status = factoryStatusPresentation(run.status);
    const projectName = projectById.get(run.projectId ?? "")?.name;
    return (
      <React.Fragment key={run.id}>
        <li className="fx-sidebar-tree-row" data-depth={depth}>
          <button
            aria-label={`${runTitles.get(run.id) ?? run.harnessId}, ${status.label}`}
            className="fx-sidebar-run"
            data-testid="factory-session-tree-item"
            onClick={() => openRun(run)}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            type="button"
          >
            {depth > 0 ? (
              <span aria-hidden="true" className="fx-sidebar-tree-branch" />
            ) : null}
            <span className={`fx-sidebar-run-dot fx-${status.tone}`} />
            <span className="fx-sidebar-run-copy">
              <span className="fx-sidebar-run-title">
                {runTitles.get(run.id) ?? run.harnessId}
              </span>
              <span className="fx-sidebar-run-project">
                {projectName ? `${projectName} · ` : ""}
                {status.label}
              </span>
            </span>
            <ChevronRight aria-hidden="true" />
          </button>
        </li>
        {children.map((child) => renderRun(child, depth + 1, nextAncestors))}
      </React.Fragment>
    );
  };

  return (
    <section aria-label="Factory navigator" className="fx-sidebar-navigator">
      <div aria-hidden="true" className="fx-sidebar-rail">
        <span data-active="true">
          <Network />
        </span>
        <span>
          <GitBranch />
        </span>
        <span>
          <Folder />
        </span>
        <span>
          <Terminal />
        </span>
        <span>
          <Globe />
        </span>
      </div>
      <div className="fx-sidebar-tree-head">
        <span>
          Sessions <b>{matchingRunIds.size}</b>
        </span>
        <button
          aria-label="New session"
          className="fx-sidebar-icon-button"
          onClick={bringInAgent}
          type="button"
        >
          <Plus aria-hidden="true" />
        </button>
      </div>
      <label className="fx-sidebar-search">
        <Search aria-hidden="true" />
        <input
          aria-label="Search Factory sessions"
          onChange={(event) => setSessionFilter(event.currentTarget.value)}
          placeholder="Find a session..."
          value={sessionFilter}
        />
      </label>
      {runsQuery.error ? (
        <div className="fx-sidebar-error" role="status">
          {runsQuery.error instanceof Error ? runsQuery.error.message : ""}
        </div>
      ) : null}
      <ul aria-label="Factory sessions" className="fx-sidebar-runs">
        {(runsByParent.get(null) ?? []).map((run) =>
          renderRun(run, 0, new Set()),
        )}
      </ul>
      <div className="fx-sidebar-artifacts">
        <div className="fx-sidebar-tree-head">
          <span>Plans & artifacts</span>
          <button
            aria-label="All plans"
            className="fx-sidebar-icon-button"
            onClick={() => void navigate({ to: "/factory/plans" as never })}
            type="button"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        {planLoadError ? (
          <div className="fx-sidebar-error" role="status">
            {planLoadError}
          </div>
        ) : null}
        {visiblePlans.map((plan) => (
          <button
            aria-label={`${plan.title}, ${plan.status === "approved" ? "Approved" : "In review"}`}
            className="fx-sidebar-artifact"
            key={plan.id}
            onClick={() => openPlan(plan.id)}
            title={plan.title}
            type="button"
          >
            <FileText aria-hidden="true" />
            <span>{plan.title}</span>
            <i aria-hidden="true">{plan.status === "approved" ? "✓" : "○"}</i>
          </button>
        ))}
      </div>
      <footer className="fx-sidebar-footer">
        <button
          className="fx-sidebar-action"
          onClick={bringInAgent}
          type="button"
        >
          <Bot aria-hidden="true" />
          Start session
        </button>
        <button
          className="fx-sidebar-action fx-sidebar-all-sessions"
          onClick={openAllSessions}
          type="button"
        >
          <span>All sessions</span>
          <span>{runs.length}</span>
        </button>
      </footer>
    </section>
  );
}

function runTitle(
  run: FactoryRun,
  snapshot: FactoryRunSnapshot | undefined,
  fallback?: string,
) {
  const prompt = snapshot?.events.find((event) => event.kind === "user_prompt");
  const payload = prompt?.payload;
  const promptText =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).text
      : undefined;
  return (
    (typeof promptText === "string"
      ? promptText
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find(Boolean)
          ?.replace(/^Task:\s*/iu, "")
      : undefined) ||
    fallback ||
    run.harnessId
  );
}
