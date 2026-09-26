import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Bot, ChevronRight } from "lucide-react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useProjectsQuery, type Project } from "@/features/projects/hooks";
import {
  getFactoryRunSnapshot,
  listFactoryRuns,
  type FactoryRun,
  type FactoryRunSnapshot,
  type FactoryScope,
} from "@/shared/api/factoryRuntime";
import { factoryStatusPresentation } from "@/features/factory/lib/factoryPresentation";
import { requestFactorySessionStart } from "@/features/factory/lib/factorySessionRequest";
import type { ManagedAgent } from "@/shared/api/types";

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
  const runsQuery = useQuery({
    queryKey,
    queryFn: listFactoryRuns,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const projectsQuery = useProjectsQuery();
  const agentsQuery = useManagedAgentsQuery();
  const runs = runsQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const visibleRuns = [...runs].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const titleQueries = useQueries({
    queries: visibleRuns.slice(0, 12).map((run) => ({
      queryKey: ["factory-run-title", queryKey, run.id],
      queryFn: () => getFactoryRunSnapshot(run.id),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const snapshots = new Map<string, FactoryRunSnapshot>();
  for (const [index, run] of visibleRuns.slice(0, 12).entries()) {
    const snapshot = titleQueries[index]?.data;
    if (snapshot) snapshots.set(run.id, snapshot);
  }

  const bringInAgent = () => requestFactorySessionStart(scope);
  const openAllSessions = () =>
    void navigate({ to: "/factory/sessions" as never });

  return (
    <section aria-label="Factory navigator" className="fx-sidebar-navigator">
      <div className="fx-sidebar-runs">
        {runsQuery.error ? (
          <div className="fx-sidebar-error" role="status">
            {runsQuery.error instanceof Error ? runsQuery.error.message : ""}
          </div>
        ) : null}
        {visibleRuns.map((run) => (
          <FactoryNavigatorRun
            agents={agents}
            key={run.id}
            onOpen={() =>
              void navigate({
                to: "/factory/review/$runId" as never,
                params: { runId: run.id },
              } as never)
            }
            projects={projects}
            run={run}
            snapshot={snapshots.get(run.id)}
          />
        ))}
      </div>
      <footer className="fx-sidebar-footer">
        <button
          className="fx-sidebar-action"
          onClick={bringInAgent}
          type="button"
        >
          <Bot aria-hidden="true" />
          Bring in an agent
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

function FactoryNavigatorRun({
  agents,
  onOpen,
  projects,
  run,
  snapshot,
}: {
  agents: ManagedAgent[];
  onOpen: () => void;
  projects: Project[];
  run: FactoryRun;
  snapshot?: FactoryRunSnapshot;
}) {
  const project = projects.find(
    (item) => item.projectAddress === run.projectId || item.id === run.projectId,
  );
  const agent = agents.find((item) => item.pubkey === run.agentId);
  const prompt = snapshot?.events.find((event) => event.kind === "user_prompt");
  const promptText =
    prompt?.payload && typeof prompt.payload === "object"
      ? (prompt.payload as Record<string, unknown>).text
      : undefined;
  const title =
    typeof promptText === "string"
      ? promptText
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .find(Boolean)
          ?.replace(/^Task:\s*/iu, "")
      : undefined;
  const status = factoryStatusPresentation(run.status);

  return (
    <button className="fx-sidebar-run" onClick={onOpen} type="button">
      <span className={`fx-sidebar-run-dot fx-${status.tone}`} />
      <span className="fx-sidebar-run-copy">
        <span className="fx-sidebar-run-title">
          {title || agent?.name || run.harnessId}
        </span>
        <span className="fx-sidebar-run-project">
          {project?.name} · {status.label}
        </span>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}
