import * as React from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { ChevronRight, GitBranch, LayoutGrid, Lock, Plus } from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import {
  useProjectsQuery,
  useProjectLocalRepositoriesQuery,
} from "@/features/projects/hooks";
import { ProjectCreationDialog } from "@/features/projects/ui/ProjectCreationDialog";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  createFactoryRun,
  type FactoryRun,
  type FactoryRunStatus,
  type FactoryScope,
} from "@/shared/api/factoryRuntime";
import { useFactoryRuns } from "@/features/factory/useFactoryRuns";
import {
  assignRunToFactoryTab,
  loadFactoryDesk,
  saveFactoryDesk,
} from "@/features/factory/lib/factoryDeskStore.ts";
import { factoryStatusPresentation } from "@/features/factory/lib/factoryPresentation.ts";
import {
  loadFactoryPlans,
  saveFactoryPlan,
} from "@/features/factory/plans/factoryPlanStore.ts";
import { subscribeFactorySessionStart } from "@/features/factory/lib/factorySessionRequest";
import "./factory.css";
import {
  FactoryEmptyDetail,
  FactoryError,
  FactoryPage,
  FactoryStateGroups,
  PlanDetail,
  PlansList,
  ProjectDetail,
  repositoryLabel,
  RunReview,
  SessionList,
} from "./FactoryPages";
import {
  NameDialog,
  PlanDialog,
  StartRunDialog,
  TaskDialog,
} from "./FactoryDialogs";
import { FactoryDeskLayout, runTitle } from "./FactoryWorkbench";
import type {
  FactoryDesk,
  FactoryPageRoute,
  FactoryPlan,
} from "./factoryTypes";

const FACTORY_ROUTES = [
  ["workbench", "Workbench", "/factory"],
  ["projects", "Projects", "/factory/projects"],
  ["plans", "Plans & tasks", "/factory/plans"],
  ["sessions", "Sessions", "/factory/sessions"],
] as const;

const FACTORY_STATUSES: FactoryRunStatus[] = [
  "queued",
  "running",
  "waiting",
  "blocked",
  "error",
  "done",
  "cancelled",
];

function parseFactoryRoute(pathname: string): FactoryPageRoute {
  const parts = pathname.split("/").filter(Boolean);
  const routeId = (index: number) => {
    try {
      return decodeURIComponent(parts[index] ?? "");
    } catch {
      return parts[index] ?? "";
    }
  };
  if (parts[1] === "projects") return { kind: "projects" };
  if (parts[1] === "project") return { kind: "project", projectId: routeId(2) };
  if (parts[1] === "plans") return { kind: "plans" };
  if (parts[1] === "plan") return { kind: "plan", planId: routeId(2) };
  if (parts[1] === "review") return { kind: "review", runId: routeId(2) };
  if (parts[1] === "sessions") return { kind: "sessions" };
  if (parts[1] === "states") return { kind: "states" };
  return { kind: "workbench" };
}

function scopeFrom(
  relayUrl: string,
  identityPubkey: string,
  community: ReturnType<typeof useCommunities>["activeCommunity"],
): FactoryScope {
  return {
    relayUrl,
    identityPubkey,
    businessCommunityId:
      community?.businessCommunityId ?? community?.id ?? "unavailable",
    clientChannelId: community?.clientChannelId ?? null,
  };
}

export function FactoryWorkspace() {
  const location = useLocation();
  const communities = useCommunities();
  const identity = useIdentityQuery();
  const community = communities.activeCommunity;
  const scope = React.useMemo(
    () =>
      scopeFrom(
        community?.relayUrl ?? "unavailable",
        identity.data?.pubkey ?? "unavailable",
        community,
      ),
    [community, identity.data?.pubkey],
  );
  const scopeKey = [
    scope.relayUrl,
    scope.identityPubkey,
    scope.businessCommunityId,
    scope.clientChannelId ?? "",
  ].join("\u0000");

  if (!community || !identity.data?.pubkey) {
    return null;
  }

  return (
    <FactoryConnected
      key={scopeKey}
      community={community}
      scope={scope}
      route={parseFactoryRoute(location.pathname)}
    />
  );
}

function FactoryConnected({
  community,
  scope,
  route,
}: {
  community: NonNullable<ReturnType<typeof useCommunities>["activeCommunity"]>;
  scope: FactoryScope;
  route: FactoryPageRoute;
}) {
  const navigate = useNavigate();
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const localRepositoriesQuery = useProjectLocalRepositoriesQuery(
    community.reposDir,
  );
  const localRepositories = localRepositoriesQuery.data ?? [];
  const managedAgentsQuery = useManagedAgentsQuery();
  const localAgents = (managedAgentsQuery.data ?? []).filter(
    (agent) =>
      agent.backend.type === "local" && agent.relayUrl === scope.relayUrl,
  );
  const runsState = useFactoryRuns(scope);
  const [plans, setPlans] = React.useState<FactoryPlan[]>(() => {
    try {
      return loadFactoryPlans(window.localStorage, scope) as FactoryPlan[];
    } catch {
      return [];
    }
  });
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const [desk, setDesk] = React.useState<FactoryDesk>(() => {
    try {
      return loadFactoryDesk(window.localStorage, scope) as FactoryDesk;
    } catch {
      return loadFactoryDesk({ getItem: () => null }, scope) as FactoryDesk;
    }
  });
  const [tabDialogOpen, setTabDialogOpen] = React.useState(false);
  const [startDialogOpen, setStartDialogOpen] = React.useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = React.useState(false);
  const [planDialogOpen, setPlanDialogOpen] = React.useState(false);
  const [planTaskDialogOpen, setPlanTaskDialogOpen] = React.useState(false);
  const [newPlanProjectId, setNewPlanProjectId] = React.useState("");
  const [editingPlanId, setEditingPlanId] = React.useState<string | null>(null);
  const [planError, setPlanError] = React.useState<string | null>(null);
  const [activePlanId, setActivePlanId] = React.useState<string | null>(null);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = React.useState<
    FactoryRunStatus | "all"
  >("all");
  const [isCreatingRun, setIsCreatingRun] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      setPlans(loadFactoryPlans(window.localStorage, scope) as FactoryPlan[]);
      setStorageError(null);
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Plans could not be loaded.",
      );
    }
  }, [scope]);

  React.useEffect(
    () => subscribeFactorySessionStart(scope, () => setStartDialogOpen(true)),
    [scope],
  );

  React.useEffect(() => {
    try {
      saveFactoryDesk(window.localStorage, scope, desk);
      setStorageError(null);
    } catch (error) {
      setStorageError(
        error instanceof Error
          ? error.message
          : "Desk tabs could not be saved.",
      );
    }
  }, [desk, scope]);

  const selectedTab =
    desk.tabs.find((tab) => tab.id === desk.activeTabId) ?? desk.tabs[0];
  const selectedTabId = selectedTab?.id ?? "build-desk";
  const selectedRoute = route.kind;
  const selectedProject =
    projects.find(
      (project) =>
        project.id === (route.kind === "project" ? route.projectId : ""),
    ) ??
    projects.find(
      (project) =>
        project.projectAddress ===
        (route.kind === "project" ? route.projectId : ""),
    ) ??
    projects.find(
      (project) =>
        project.dtag === (route.kind === "project" ? route.projectId : ""),
    ) ??
    null;
  const selectedPlan =
    plans.find(
      (plan) =>
        plan.id ===
        (route.kind === "plan" ? route.planId : (activePlanId ?? "")),
    ) ?? null;
  const selectedRunId =
    route.kind === "review" ? route.runId : (activeRunId ?? "");
  const selectedRun =
    runsState.runs.find((run) => run.id === selectedRunId) ?? null;
  const projectForRun = (run: FactoryRun) =>
    projects.find(
      (project) =>
        project.projectAddress === run.projectId ||
        project.id === run.projectId,
    ) ?? null;
  const runProjectName = (run: FactoryRun) => projectForRun(run)?.name ?? "";

  const go = (path: string) => void navigate({ to: path as never });

  function storePlan(plan: FactoryPlan) {
    try {
      const next = saveFactoryPlan(
        window.localStorage,
        scope,
        plan,
      ) as FactoryPlan[];
      setPlans(next);
      setPlanError(null);
      setPlanDialogOpen(false);
      setActivePlanId(plan.id);
      go(`/factory/plan/${encodeURIComponent(plan.id)}`);
    } catch (error) {
      setPlanError(
        error instanceof Error ? error.message : "Plan could not be saved.",
      );
    }
  }

  async function startRun(input: {
    projectId: string;
    repositoryId: string;
    checkoutPath: string;
    agentId: string;
    parentRunId: string;
    prompt: string;
    tabId: string;
  }) {
    setCreateError(null);
    setIsCreatingRun(true);
    try {
      const run = await createFactoryRun({
        operationKey: crypto.randomUUID(),
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        checkoutPath: input.checkoutPath,
        agentId: input.agentId,
        parentRunId: input.parentRunId || null,
        prompt: input.prompt,
      });
      const nextDesk = assignRunToFactoryTab(
        desk,
        run.id,
        input.tabId,
      ) as FactoryDesk;
      setDesk(nextDesk);
      setStartDialogOpen(false);
      await runsState.refresh();
      setActiveRunId(run.id);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "The session could not be started.",
      );
    } finally {
      setIsCreatingRun(false);
    }
  }

  function createDeskTab(name: string) {
    const tab = { id: crypto.randomUUID(), name: name.trim() };
    setDesk((current) => ({
      ...current,
      tabs: [...current.tabs, tab],
      activeTabId: tab.id,
    }));
    setTabDialogOpen(false);
  }

  function addPlan(input: {
    projectId: string;
    title: string;
    outcome: string;
    criteria: string[];
  }) {
    const now = new Date().toISOString();
    storePlan({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      title: input.title,
      outcome: input.outcome,
      acceptanceCriteria: input.criteria,
      tasks: [],
      revisions: [{ version: 1, updatedAt: now, title: input.title }],
      status: "draft",
      updatedAt: now,
    });
  }

  function updatePlan(input: {
    projectId: string;
    title: string;
    outcome: string;
    criteria: string[];
  }) {
    if (!selectedPlan) return;
    const now = new Date().toISOString();
    storePlan({
      ...selectedPlan,
      projectId: input.projectId,
      title: input.title,
      outcome: input.outcome,
      acceptanceCriteria: input.criteria,
      revisions: [
        ...selectedPlan.revisions,
        {
          version: selectedPlan.revisions.length + 1,
          updatedAt: now,
          title: input.title,
        },
      ],
      status: "review",
      updatedAt: now,
    });
    setEditingPlanId(null);
  }

  function updatePlanStatus(plan: FactoryPlan, status: FactoryPlan["status"]) {
    storePlan({ ...plan, status, updatedAt: new Date().toISOString() });
  }

  function addPlanTask(title: string, dependencies: string[]) {
    if (!selectedPlan) return;
    const next = {
      ...selectedPlan,
      tasks: [
        ...selectedPlan.tasks,
        {
          id: crypto.randomUUID(),
          title,
          dependencies,
          status: dependencies.length
            ? ("blocked" as const)
            : ("ready" as const),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    storePlan(next);
    setPlanTaskDialogOpen(false);
  }

  const sessionsForTab = runsState.runs.filter(
    (run) => (desk.runToTab[run.id] ?? desk.tabs[0]?.id) === selectedTab?.id,
  );

  return (
    <main className="fx-workspace" data-testid="factory-workspace">
      <header className="fx-heading">
        <div className="fx-title">
          <LayoutGrid aria-hidden="true" />
          <h1>Software Factory</h1>
        </div>
        <nav aria-label="Factory views" className="fx-nav">
          {FACTORY_ROUTES.map(([id, label, href]) => (
            <button
              aria-current={selectedRoute === id ? "page" : undefined}
              className="fx-nav-link"
              key={id}
              onClick={() => go(href)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          className="fx-button fx-button-primary"
          onClick={() => setStartDialogOpen(true)}
          type="button"
        >
          <Plus aria-hidden="true" /> Start session
        </button>
      </header>

      {route.kind === "workbench" ? (
        <>
          <div className="fx-tabbar">
            <div
              aria-label="Factory desk tabs"
              className="fx-tabs"
              role="tablist"
            >
              {desk.tabs.map((tab) => (
                <button
                  aria-selected={tab.id === selectedTab?.id}
                  key={tab.id}
                  onClick={() =>
                    setDesk((current) => ({ ...current, activeTabId: tab.id }))
                  }
                  role="tab"
                  type="button"
                >
                  {tab.name}
                  {(() => {
                    const attentionCount = runsState.runs.filter(
                      (run) =>
                        (desk.runToTab[run.id] ?? desk.tabs[0]?.id) ===
                          tab.id &&
                        ["waiting", "blocked", "error"].includes(run.status),
                    ).length;
                    return attentionCount ? (
                      <span className="fx-tab-attention">{attentionCount}</span>
                    ) : null;
                  })()}
                </button>
              ))}
            </div>
            <button
              aria-label="New workspace tab"
              className="fx-icon-button"
              onClick={() => setTabDialogOpen(true)}
              type="button"
            >
              <Plus aria-hidden="true" />
            </button>
            <span className="fx-local-label">Local</span>
          </div>
          <div className="fx-desk-meta">
            <span>
              <LayoutGrid aria-hidden="true" />
              {selectedTab?.name ?? "Build desk"}
              <b>·</b>
              {sessionsForTab.length} sessions across{" "}
              {
                new Set(
                  sessionsForTab.map((run) => run.projectId).filter(Boolean),
                ).size
              }{" "}
              projects
            </span>
          </div>
          {runsState.error ? (
            <FactoryError
              message={runsState.error.message}
              onRetry={() => void runsState.refresh()}
            />
          ) : null}
          {storageError ? <FactoryError message={storageError} /> : null}
          <FactoryDeskLayout
            activeTabId={selectedTabId}
            agents={localAgents}
            allRuns={runsState.runs}
            onOpenPlan={(planId) =>
              go(`/factory/plan/${encodeURIComponent(planId)}`)
            }
            onOpenRun={(runId) =>
              go(`/factory/review/${encodeURIComponent(runId)}`)
            }
            plans={plans}
            projects={projects}
            reconnecting={runsState.reattachErrors}
            runs={sessionsForTab}
            snapshots={runsState.snapshots}
          />
          <footer className="fx-workspace-footer">
            <span>
              <Lock aria-hidden="true" /> Sessions keep their own working copies
            </span>
            <button
              className="fx-text-button"
              onClick={() => go("/factory/states")}
              type="button"
            >
              Preview states
            </button>
          </footer>
        </>
      ) : null}

      {route.kind === "projects" ? (
        <FactoryPage
          title="Projects"
          actions={
            <button
              className="fx-button fx-button-primary"
              onClick={() => setProjectDialogOpen(true)}
              type="button"
            >
              <Plus aria-hidden="true" /> Add project
            </button>
          }
        >
          {projectsQuery.error ? (
            <FactoryError message={projectsQuery.error.message} />
          ) : null}
          <div className="fx-project-grid">
            {projects.map((project) => {
              const sessionCount = runsState.runs.filter(
                (run) =>
                  run.projectId === project.projectAddress ||
                  run.projectId === project.id,
              ).length;
              return (
                <button
                  className="fx-project-card"
                  key={project.id}
                  onClick={() =>
                    go(`/factory/project/${encodeURIComponent(project.id)}`)
                  }
                  type="button"
                >
                  <div className="fx-project-card-top">
                    <span className="fx-project-chip">{project.name}</span>
                    <ChevronRight aria-hidden="true" />
                  </div>
                  <h3>{project.name}</h3>
                  <p>{project.description}</p>
                  <footer>
                    <GitBranch aria-hidden="true" />
                    {project.repositories.map(repositoryLabel).join(", ")}
                    <span>{sessionCount} sessions</span>
                  </footer>
                </button>
              );
            })}
          </div>
        </FactoryPage>
      ) : null}

      {route.kind === "project" ? (
        <FactoryPage title={selectedProject?.name ?? ""}>
          {selectedProject ? (
            <ProjectDetail
              project={selectedProject}
              runs={runsState.runs.filter(
                (run) =>
                  run.projectId === selectedProject.projectAddress ||
                  run.projectId === selectedProject.id,
              )}
              agents={localAgents}
              snapshots={runsState.snapshots}
              localRepositories={localRepositories}
              onStartSession={() => setStartDialogOpen(true)}
              onCancelRun={(runId) => void runsState.cancelRun(runId)}
              onOpenRun={(runId) =>
                go(`/factory/review/${encodeURIComponent(runId)}`)
              }
              onOpenPlan={(planId) => {
                if (planId === "new") {
                  setNewPlanProjectId(selectedProject.projectAddress);
                  setPlanDialogOpen(true);
                } else {
                  go(`/factory/plan/${encodeURIComponent(planId)}`);
                }
              }}
              onOpenRepository={(repositoryId, tab) =>
                void navigate({
                  to: "/projects/$projectId" as never,
                  params: { projectId: selectedProject.id },
                  search: { repositoryId, tab } as never,
                } as never)
              }
              plans={plans.filter(
                (plan) =>
                  plan.projectId === selectedProject.projectAddress ||
                  plan.projectId === selectedProject.id,
              )}
            />
          ) : (
            <FactoryEmptyDetail
              loading={projectsQuery.isPending}
              label="Project"
            />
          )}
        </FactoryPage>
      ) : null}

      {route.kind === "plans" || route.kind === "plan" ? (
        <FactoryPage
          title={
            route.kind === "plans"
              ? "Plans that keep moving"
              : (selectedPlan?.title ?? "")
          }
          actions={
            route.kind === "plans" ? (
              <button
                className="fx-button fx-button-primary"
                onClick={() => setPlanDialogOpen(true)}
                type="button"
              >
                <Plus aria-hidden="true" /> New plan
              </button>
            ) : (
              <button
                className="fx-button"
                onClick={() => go("/factory/plans")}
                type="button"
              >
                All plans
              </button>
            )
          }
        >
          {planError ? <FactoryError message={planError} /> : null}
          {route.kind === "plans" ? (
            <PlansList
              plans={plans}
              projects={projects}
              onOpen={(plan) => {
                setActivePlanId(plan.id);
                go(`/factory/plan/${encodeURIComponent(plan.id)}`);
              }}
            />
          ) : selectedPlan ? (
            <PlanDetail
              plan={selectedPlan}
              projects={projects}
              onOpenProject={(id) =>
                go(`/factory/project/${encodeURIComponent(id)}`)
              }
              onAddTask={() => setPlanTaskDialogOpen(true)}
              onRequestRevision={() => updatePlanStatus(selectedPlan, "review")}
              onEdit={() => {
                setActivePlanId(selectedPlan.id);
                setEditingPlanId(selectedPlan.id);
                setPlanDialogOpen(true);
              }}
            />
          ) : (
            <FactoryEmptyDetail loading={false} label="Plan" />
          )}
        </FactoryPage>
      ) : null}

      {route.kind === "sessions" ? (
        <FactoryPage title="Every session, wherever you left it">
          <label className="fx-filter">
            Filter sessions
            <select
              aria-label="Filter sessions"
              onChange={(event) =>
                setSessionFilter(
                  event.currentTarget.value as FactoryRunStatus | "all",
                )
              }
              value={sessionFilter}
            >
              <option value="all">All sessions</option>
              {FACTORY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {factoryStatusPresentation(status).label}
                </option>
              ))}
            </select>
            <span>
              {runsState.runs.length} sessions across {projects.length} projects
            </span>
          </label>
          {runsState.error ? (
            <FactoryError
              message={runsState.error.message}
              onRetry={() => void runsState.refresh()}
            />
          ) : null}
          <SessionList
            runs={runsState.runs.filter(
              (run) => sessionFilter === "all" || run.status === sessionFilter,
            )}
            projects={projects}
            agents={localAgents}
            snapshots={runsState.snapshots}
            onOpen={(run) =>
              go(`/factory/review/${encodeURIComponent(run.id)}`)
            }
            onCancel={(run) => void runsState.cancelRun(run.id)}
          />
        </FactoryPage>
      ) : null}

      {route.kind === "review" ? (
        <FactoryPage
          title={
            selectedRun
              ? runTitle(
                  selectedRun,
                  runsState.snapshots.get(selectedRun.id),
                  localAgents.find(
                    (agent) => agent.pubkey === selectedRun.agentId,
                  )?.name,
                )
              : ""
          }
        >
          {selectedRun ? (
            <RunReview
              run={selectedRun}
              projectName={runProjectName(selectedRun)}
              agent={localAgents.find(
                (agent) => agent.pubkey === selectedRun.agentId,
              )}
              snapshot={runsState.snapshots.get(selectedRun.id)}
              reconnecting={runsState.reattachErrors.has(selectedRun.id)}
            />
          ) : null}
        </FactoryPage>
      ) : null}

      {route.kind === "states" ? (
        <FactoryPage
          title="Review the workbench states"
          actions={
            <button
              className="fx-button"
              onClick={() => go("/factory")}
              type="button"
            >
              Back to workbench
            </button>
          }
        >
          <FactoryStateGroups
            runs={runsState.runs}
            snapshots={runsState.snapshots}
            reconnecting={runsState.reattachErrors}
            projects={projects}
            agents={localAgents}
            onOpen={(run) =>
              go(`/factory/review/${encodeURIComponent(run.id)}`)
            }
          />
          {runsState.error ? (
            <FactoryError
              message={runsState.error.message}
              onRetry={() => void runsState.refresh()}
            />
          ) : null}
        </FactoryPage>
      ) : null}

      {tabDialogOpen ? (
        <NameDialog
          title="New workspace tab"
          label="Tab name"
          action="Create tab"
          onClose={() => setTabDialogOpen(false)}
          onSubmit={createDeskTab}
        />
      ) : null}
      {startDialogOpen ? (
        <StartRunDialog
          projects={projects}
          localRepositories={localRepositories}
          agents={localAgents}
          runs={runsState.runs}
          tabs={desk.tabs}
          activeTabId={selectedTabId}
          busy={isCreatingRun}
          error={createError}
          onClose={() => {
            setStartDialogOpen(false);
            setCreateError(null);
          }}
          onStart={(input) => void startRun(input)}
        />
      ) : null}
      <ProjectCreationDialog
        onCreated={(project) => {
          setProjectDialogOpen(false);
          go(`/factory/project/${encodeURIComponent(project.id)}`);
        }}
        onOpenChange={setProjectDialogOpen}
        open={projectDialogOpen}
      />
      {planDialogOpen ? (
        <PlanDialog
          key={editingPlanId ?? "new-plan"}
          projects={projects}
          initialProjectId={newPlanProjectId}
          plan={plans.find((plan) => plan.id === editingPlanId)}
          title={editingPlanId ? "Edit plan" : "Create a plan"}
          action={editingPlanId ? "Save changes" : "Create plan"}
          onClose={() => {
            setPlanDialogOpen(false);
            setEditingPlanId(null);
            setNewPlanProjectId("");
          }}
          onSubmit={editingPlanId ? updatePlan : addPlan}
        />
      ) : null}
      {planTaskDialogOpen && selectedPlan ? (
        <TaskDialog
          plan={selectedPlan}
          onClose={() => setPlanTaskDialogOpen(false)}
          onSubmit={addPlanTask}
        />
      ) : null}
    </main>
  );
}
