import * as React from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FolderGit2,
  GitBranch,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import {
  useProjectsQuery,
  useProjectLocalRepositoriesQuery,
  type Project,
} from "@/features/projects/hooks";
import { ProjectCreationDialog } from "@/features/projects/ui/ProjectCreationDialog";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  createFactoryRun,
  type FactoryRun,
  type FactoryRunStatus,
  type FactoryScope,
} from "@/shared/api/factoryRuntime";
import type { ManagedAgent } from "@/shared/api/types";
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
import "./factory.css";

type FactoryPlanTask = {
  id: string;
  title: string;
  dependencies: string[];
  status: "ready" | "blocked" | "done";
};

type FactoryPlan = {
  id: string;
  projectId: string;
  title: string;
  outcome: string;
  acceptanceCriteria: string[];
  tasks: FactoryPlanTask[];
  revisions: Array<{ version: number; updatedAt: string; title: string }>;
  status: "draft" | "review" | "approved";
  updatedAt: string;
};

type DeskTab = { id: string; name: string };
type FactoryDesk = {
  tabs: DeskTab[];
  activeTabId: string;
  runToTab: Record<string, string>;
};

type FactoryPageRoute =
  | { kind: "workbench" }
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "plans" }
  | { kind: "plan"; planId: string }
  | { kind: "review"; runId: string }
  | { kind: "sessions" }
  | { kind: "states" };

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
  if (parts[1] === "projects") return { kind: "projects" };
  if (parts[1] === "project") return { kind: "project", projectId: parts[2] ?? "" };
  if (parts[1] === "plans") return { kind: "plans" };
  if (parts[1] === "plan") return { kind: "plan", planId: parts[2] ?? "" };
  if (parts[1] === "review") return { kind: "review", runId: parts[2] ?? "" };
  if (parts[1] === "sessions") return { kind: "sessions" };
  if (parts[1] === "states") return { kind: "states" };
  return { kind: "workbench" };
}

function scopeFrom(relayUrl: string, identityPubkey: string, community: ReturnType<typeof useCommunities>["activeCommunity"]): FactoryScope {
  return {
    relayUrl,
    identityPubkey,
    businessCommunityId: community?.businessCommunityId ?? community?.id ?? "unavailable",
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
  const localRepositoriesQuery = useProjectLocalRepositoriesQuery(community.reposDir);
  const localRepositories = localRepositoriesQuery.data ?? [];
  const managedAgentsQuery = useManagedAgentsQuery();
  const localAgents = (managedAgentsQuery.data ?? []).filter(
    (agent) => agent.backend.type === "local" && agent.relayUrl === scope.relayUrl,
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
  const [editingPlanId, setEditingPlanId] = React.useState<string | null>(null);
  const [planError, setPlanError] = React.useState<string | null>(null);
  const [activePlanId, setActivePlanId] = React.useState<string | null>(null);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = React.useState<FactoryRunStatus | "all">("all");
  const [isCreatingRun, setIsCreatingRun] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      setPlans(loadFactoryPlans(window.localStorage, scope) as FactoryPlan[]);
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Plans could not be loaded.");
    }
  }, [scope]);

  React.useEffect(() => {
    try {
      saveFactoryDesk(window.localStorage, scope, desk);
      setStorageError(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Desk tabs could not be saved.");
    }
  }, [desk, scope]);

  const selectedTab = desk.tabs.find((tab) => tab.id === desk.activeTabId) ?? desk.tabs[0];
  const selectedTabId = selectedTab?.id ?? "build-desk";
  const selectedRoute = route.kind;
  const latestReviewRun = runsState.runs
    .filter((run) => run.status === "done")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const selectedProject =
    projects.find((project) => project.id === (route.kind === "project" ? route.projectId : "")) ??
    projects.find((project) => project.projectAddress === (route.kind === "project" ? route.projectId : "")) ??
    null;
  const selectedPlan =
    plans.find((plan) => plan.id === (route.kind === "plan" ? route.planId : activePlanId ?? "")) ?? null;
  const selectedRunId = route.kind === "review" ? route.runId : activeRunId ?? "";
  const selectedRun = runsState.runs.find((run) => run.id === selectedRunId) ?? null;
  const runProjectName = (run: FactoryRun) =>
    projects.find((project) => project.projectAddress === run.projectId || project.id === run.projectId)?.name ?? "Project unavailable";

  const go = (path: string) => void navigate({ to: path as never });

  function storePlan(plan: FactoryPlan) {
    try {
      const next = saveFactoryPlan(window.localStorage, scope, plan) as FactoryPlan[];
      setPlans(next);
      setPlanError(null);
      setPlanDialogOpen(false);
      setActivePlanId(plan.id);
      go(`/factory/plan/${encodeURIComponent(plan.id)}`);
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Plan could not be saved.");
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
      const nextDesk = assignRunToFactoryTab(desk, run.id, input.tabId) as FactoryDesk;
      setDesk(nextDesk);
      setStartDialogOpen(false);
      await runsState.refresh();
      setActiveRunId(run.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "The session could not be started.");
    } finally {
      setIsCreatingRun(false);
    }
  }

  function createDeskTab(name: string) {
    const tab = { id: crypto.randomUUID(), name: name.trim() };
    setDesk((current) => ({ ...current, tabs: [...current.tabs, tab], activeTabId: tab.id }));
    setTabDialogOpen(false);
  }

  function addPlan(input: { projectId: string; title: string; outcome: string; criteria: string[] }) {
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

  function updatePlan(input: { projectId: string; title: string; outcome: string; criteria: string[] }) {
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
        { version: selectedPlan.revisions.length + 1, updatedAt: now, title: input.title },
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
      tasks: [...selectedPlan.tasks, { id: crypto.randomUUID(), title, dependencies, status: dependencies.length ? "blocked" as const : "ready" as const }],
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
          <Boxes aria-hidden="true" />
          <h1>Software Factory</h1>
        </div>
        <nav aria-label="Software Factory" className="fx-nav">
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
          <button
            aria-current={route.kind === "review" ? "page" : undefined}
            className="fx-nav-link"
            disabled={!latestReviewRun}
            onClick={() => latestReviewRun && go(`/factory/review/${encodeURIComponent(latestReviewRun.id)}`)}
            type="button"
          >
            Reviews{latestReviewRun ? <span>{runsState.runs.filter((run) => run.status === "done").length}</span> : null}
          </button>
        </nav>
        {route.kind === "workbench" ? (
          <button className="fx-button fx-button-primary" onClick={() => setStartDialogOpen(true)} type="button">
            <Plus aria-hidden="true" /> Add agent
          </button>
        ) : null}
      </header>

      {route.kind === "workbench" ? (
        <>
          <div className="fx-tabbar">
            <div aria-label="Factory desk tabs" className="fx-tabs" role="tablist">
              {desk.tabs.map((tab) => (
                <button
                  aria-selected={tab.id === selectedTab?.id}
                  key={tab.id}
                  onClick={() => setDesk((current) => ({ ...current, activeTabId: tab.id }))}
                  role="tab"
                  type="button"
                >
                  {tab.name}
                  <span className="fx-tab-count">{runsState.runs.filter((run) => (desk.runToTab[run.id] ?? desk.tabs[0]?.id) === tab.id).length}</span>
                </button>
              ))}
            </div>
            <button aria-label="New workspace tab" className="fx-icon-button" onClick={() => setTabDialogOpen(true)} type="button"><Plus aria-hidden="true" /></button>
            <span className="fx-session-count"><Bot aria-hidden="true" />{runsState.runs.length} sessions</span>
          </div>
          <div className="fx-desk-toolbar">
            <span>{selectedTab?.name ?? "Build desk"}</span>
            <div><button className="fx-text-button" onClick={() => go("/factory/sessions")} type="button">All sessions</button><b>·</b><button className="fx-text-button" onClick={() => setStartDialogOpen(true)} type="button">Add agent</button></div>
          </div>
          {runsState.error ? <FactoryError message={runsState.error.message} onRetry={() => void runsState.refresh()} /> : null}
          {storageError ? <FactoryError message={storageError} /> : null}
          <div className="fx-workbench-content">
            {runsState.loading ? <p className="fx-muted">Loading sessions…</p> : null}
            {!runsState.loading && sessionsForTab.length === 0 ? (
              <div className="fx-empty-state">
                <Bot aria-hidden="true" />
                <h2>No sessions here</h2>
                <p>Start an agent from a project or a task.</p>
                <button className="fx-button fx-button-primary" onClick={() => setStartDialogOpen(true)} type="button"><Plus aria-hidden="true" /> Add agent</button>
              </div>
            ) : null}
            <div className="fx-run-grid">
              {sessionsForTab.map((run) => (
                <FactoryRunCard
                  key={run.id}
                  run={run}
                  agent={localAgents.find((agent) => agent.pubkey === run.agentId)}
                  projectName={runProjectName(run)}
                  snapshot={runsState.snapshots.get(run.id)}
                  reconnecting={runsState.reattachErrors.has(run.id)}
                  onCancel={() => void runsState.cancelRun(run.id)}
                  onOpen={() => {
                    setActiveRunId(run.id);
                    go(`/factory/review/${encodeURIComponent(run.id)}`);
                  }}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}

      {route.kind === "projects" ? (
        <FactoryPage title="Projects" actions={<button className="fx-button fx-button-primary" onClick={() => setProjectDialogOpen(true)} type="button"><Plus aria-hidden="true" /> Add project</button>}>
          {projectsQuery.error ? <FactoryError message={projectsQuery.error.message} /> : null}
          <div className="fx-project-grid">
            {projects.map((project) => {
              const sessionCount = runsState.runs.filter((run) => run.projectId === project.projectAddress || run.projectId === project.id).length;
              return <button className="fx-project-card" key={project.id} onClick={() => go(`/factory/project/${encodeURIComponent(project.id)}`)} type="button">
                <div className="fx-project-card-top"><span className="fx-project-chip">{project.repositories.length} repositories</span><ChevronRight aria-hidden="true" /></div>
                <h3>{project.name}</h3><p>{project.description || ""}</p>
                <footer><GitBranch aria-hidden="true" />{project.repositories.map((repo) => repo.name).join(", ") || "No repository linked"}<span>{sessionCount} sessions</span></footer>
              </button>;
            })}
          </div>
          {!projectsQuery.isPending && projects.length === 0 ? <div className="fx-empty-state"><FolderGit2 aria-hidden="true" /><h2>No projects yet</h2><p>Projects from this workspace appear here.</p><button className="fx-button fx-button-primary" onClick={() => setProjectDialogOpen(true)} type="button"><Plus aria-hidden="true" /> Add project</button></div> : null}
        </FactoryPage>
      ) : null}

      {route.kind === "project" ? (
        <FactoryPage title={selectedProject?.name ?? "Project"} actions={<button className="fx-button fx-button-primary" onClick={() => setStartDialogOpen(true)} type="button"><Plus aria-hidden="true" /> Add agent</button>}>
          {selectedProject ? <ProjectDetail
            project={selectedProject}
            runs={runsState.runs.filter((run) => run.projectId === selectedProject.projectAddress || run.projectId === selectedProject.id)}
            agents={localAgents}
            snapshots={runsState.snapshots}
            onAddAgent={() => setStartDialogOpen(true)}
            onCancelRun={(runId) => void runsState.cancelRun(runId)}
            onOpenRun={(runId) => go(`/factory/review/${encodeURIComponent(runId)}`)}
            onOpenPlan={(planId) => planId === "new" ? setPlanDialogOpen(true) : go(`/factory/plan/${encodeURIComponent(planId)}`)}
            plans={plans.filter((plan) => plan.projectId === selectedProject.projectAddress || plan.projectId === selectedProject.id)}
          /> : <FactoryEmptyDetail loading={projectsQuery.isPending} label="Project" />}
        </FactoryPage>
      ) : null}

      {route.kind === "plans" || route.kind === "plan" ? (
        <FactoryPage title={route.kind === "plans" ? "Plans that keep moving" : selectedPlan?.title ?? "Plan"} actions={route.kind === "plans" ? <button className="fx-button fx-button-primary" onClick={() => setPlanDialogOpen(true)} type="button"><Plus aria-hidden="true" /> New plan</button> : <button className="fx-button" onClick={() => setPlanTaskDialogOpen(true)} type="button"><Plus aria-hidden="true" /> Add task</button>}>
          {planError ? <FactoryError message={planError} /> : null}
          {route.kind === "plans" ? <PlansList plans={plans} projects={projects} onOpen={(plan) => { setActivePlanId(plan.id); go(`/factory/plan/${encodeURIComponent(plan.id)}`); }} /> : selectedPlan ? <PlanDetail plan={selectedPlan} projects={projects} onOpenProject={(id) => go(`/factory/project/${encodeURIComponent(id)}`)} onApprove={() => updatePlanStatus(selectedPlan, "approved")} onRequestRevision={() => updatePlanStatus(selectedPlan, "review")} onEdit={() => { setActivePlanId(selectedPlan.id); setEditingPlanId(selectedPlan.id); setPlanDialogOpen(true); }} /> : <FactoryEmptyDetail loading={false} label="Plan" />}
        </FactoryPage>
      ) : null}

      {route.kind === "sessions" ? (
        <FactoryPage title="Every session, wherever you left it">
          <label className="fx-filter">Filter sessions<select aria-label="Filter sessions" onChange={(event) => setSessionFilter(event.currentTarget.value as FactoryRunStatus | "all")} value={sessionFilter}><option value="all">All sessions</option>{FACTORY_STATUSES.map((status) => <option key={status} value={status}>{factoryStatusPresentation(status).label}</option>)}</select><span>{runsState.runs.length} sessions across {projects.length} projects</span></label>
          {runsState.error ? <FactoryError message={runsState.error.message} onRetry={() => void runsState.refresh()} /> : null}
          <SessionList runs={runsState.runs.filter((run) => sessionFilter === "all" || run.status === sessionFilter)} projects={projects} agents={localAgents} reconnecting={runsState.reattachErrors} onOpen={(run) => go(`/factory/review/${encodeURIComponent(run.id)}`)} onCancel={(run) => void runsState.cancelRun(run.id)} />
        </FactoryPage>
      ) : null}

      {route.kind === "review" ? (
        <FactoryPage title={selectedRun ? (selectedRun.projectId ? runProjectName(selectedRun) : "Session review") : "Changes to review"} actions={<button className="fx-button" onClick={() => go("/factory/sessions")} type="button">All sessions</button>}>
          {selectedRun ? <RunReview run={selectedRun} projectName={runProjectName(selectedRun)} agent={localAgents.find((agent) => agent.pubkey === selectedRun.agentId)} snapshot={runsState.snapshots.get(selectedRun.id)} reconnecting={runsState.reattachErrors.has(selectedRun.id)} /> : <SessionList runs={runsState.runs.filter((run) => run.status === "done" || run.status === "error")} projects={projects} agents={localAgents} reconnecting={runsState.reattachErrors} onOpen={(run) => { setActiveRunId(run.id); go(`/factory/review/${encodeURIComponent(run.id)}`); }} onCancel={(run) => void runsState.cancelRun(run.id)} />}
        </FactoryPage>
      ) : null}

      {route.kind === "states" ? (
        <FactoryPage title="Review the workbench states">
          <FactoryStateGroups runs={runsState.runs} snapshots={runsState.snapshots} reconnecting={runsState.reattachErrors} projects={projects} onOpen={(run) => go(`/factory/review/${encodeURIComponent(run.id)}`)} />
          {runsState.error ? <FactoryError message={runsState.error.message} onRetry={() => void runsState.refresh()} /> : null}
        </FactoryPage>
      ) : null}

      {tabDialogOpen ? <NameDialog title="New workspace tab" label="Tab name" action="Create tab" onClose={() => setTabDialogOpen(false)} onSubmit={createDeskTab} /> : null}
      {startDialogOpen ? <StartRunDialog projects={projects} localRepositories={localRepositories} agents={localAgents} runs={runsState.runs} tabs={desk.tabs} activeTabId={selectedTabId} busy={isCreatingRun} error={createError} onClose={() => { setStartDialogOpen(false); setCreateError(null); }} onStart={(input) => void startRun(input)} /> : null}
      <ProjectCreationDialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen} />
      {planDialogOpen ? <PlanDialog key={editingPlanId ?? "new-plan"} projects={projects} plan={plans.find((plan) => plan.id === editingPlanId)} title={editingPlanId ? "Edit plan" : "Create a plan"} action={editingPlanId ? "Save changes" : "Create plan"} onClose={() => { setPlanDialogOpen(false); setEditingPlanId(null); }} onSubmit={editingPlanId ? updatePlan : addPlan} /> : null}
      {planTaskDialogOpen && selectedPlan ? <TaskDialog plan={selectedPlan} onClose={() => setPlanTaskDialogOpen(false)} onSubmit={addPlanTask} /> : null}
    </main>
  );
}

function FactoryPage({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return <section className="fx-page"><header><h2>{title}</h2><div>{actions}</div></header>{children}</section>;
}

function FactoryError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="fx-error" role="status"><CircleAlert aria-hidden="true" /><span>{message}</span>{onRetry ? <button className="fx-text-button" onClick={onRetry} type="button">Reconnect</button> : null}</div>;
}

function FactoryEmptyDetail({ loading, label }: { loading: boolean; label: string }) {
  return <div className="fx-empty-state"><FolderGit2 aria-hidden="true" /><h2>{loading ? "Loading" : `${label} unavailable`}</h2><p>{loading ? "Loading workspace records." : "This record is not available in the current workspace."}</p></div>;
}

function FactoryRunCard({ run, agent, projectName, snapshot, reconnecting, onCancel, onOpen }: { run: FactoryRun; agent?: ManagedAgent; projectName: string; snapshot?: { events: Array<{ sequence: number; kind: string; payload: unknown }> }; reconnecting: boolean; onCancel: () => void; onOpen: () => void }) {
  const presentation = factoryStatusPresentation(run.status);
  const lastEvent = snapshot?.events.at(-1);
  const canCancel = ["queued", "running", "waiting", "blocked"].includes(run.status);
  return <article className="fx-run-card" data-status={run.status}>
    <div className="fx-run-head"><span className="fx-agent-mark"><Bot aria-hidden="true" /></span><div><button className="fx-run-title" onClick={onOpen} type="button">{agent?.name ?? "Agent session"}</button><span>{agent?.runtime ?? run.harnessId}</span></div><StatusLabel status={run.status} /></div>
    <div className="fx-pane-context"><span className="fx-project-chip">{projectName}</span><span><GitBranch aria-hidden="true" />{run.repositoryId ?? "Repository unavailable"}</span></div>
    {reconnecting ? <div className="fx-run-message" data-state="reconnecting"><RefreshCw aria-hidden="true" /> Reconnecting to this session</div> : null}
    {run.status === "blocked" || run.status === "waiting" || run.status === "error" ? <div className={`fx-run-message fx-${presentation.tone}`}><CircleAlert aria-hidden="true" /><span>{run.error || presentation.label}</span></div> : null}
    {lastEvent ? <p className="fx-run-output">{eventText(lastEvent.payload)}</p> : <p className="fx-run-output fx-muted">Session history will appear here.</p>}
    <footer><button className="fx-text-button" onClick={onOpen} type="button">Open session <ArrowUpRight aria-hidden="true" /></button>{canCancel ? <button className="fx-text-button fx-danger" onClick={onCancel} type="button">Cancel</button> : null}</footer>
  </article>;
}

function StatusLabel({ status }: { status: FactoryRunStatus }) {
  const presentation = factoryStatusPresentation(status);
  const Icon = status === "done" ? Check : status === "waiting" || status === "queued" ? Clock3 : status === "error" || status === "blocked" ? CircleAlert : null;
  return <span className={`fx-status fx-${presentation.tone}`}><i />{Icon ? <Icon aria-hidden="true" /> : null}{presentation.label}</span>;
}

function eventText(payload: unknown) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.message === "string") return value.message;
  }
  return "Output recorded.";
}

function ProjectDetail({ project, runs, agents, snapshots, onAddAgent, onCancelRun, onOpenRun, onOpenPlan, plans }: { project: Project; runs: FactoryRun[]; agents: ManagedAgent[]; snapshots: ReadonlyMap<string, { events: Array<{ sequence: number; kind: string; payload: unknown }> }>; onAddAgent: () => void; onCancelRun: (runId: string) => void; onOpenRun: (runId: string) => void; onOpenPlan: (planId: string) => void; plans: FactoryPlan[] }) {
  return <>
    <div className="fx-project-summary"><span className="fx-project-chip">{project.repositories.length} repositories</span><p>{project.description || ""}</p><dl><dt>Repository</dt><dd>{project.repositories.map((repo) => repo.name).join(", ") || "No repository linked"}</dd><dt>Local folder</dt><dd>Available checkouts are selected when starting a session.</dd><dt>Default branch</dt><dd>{project.repositories.map((repo) => repo.defaultBranch).filter(Boolean).join(", ") || "Not set"}</dd><dt>Execution boundary</dt><dd>Sessions run in a selected local working copy.</dd></dl></div>
    <div className="fx-section-label"><h3>Plans & tasks</h3><button className="fx-text-button" onClick={() => onOpenPlan("")} type="button">New plan <Plus aria-hidden="true" /></button></div>
    {plans.length ? <PlansList plans={plans} projects={[project]} onOpen={(plan) => onOpenPlan(plan.id)} /> : <p className="fx-muted">No plans here</p>}
    <div className="fx-section-label"><h3>Agent sessions</h3><button className="fx-text-button" onClick={onAddAgent} type="button">Add agent <Plus aria-hidden="true" /></button></div>
    <SessionList runs={runs} projects={[project]} agents={agents} reconnecting={new Set()} onOpen={(run) => onOpenRun(run.id)} onCancel={(run) => onCancelRun(run.id)} snapshots={snapshots} />
  </>;
}

function PlansList({ plans, projects, onOpen }: { plans: FactoryPlan[]; projects: Project[]; onOpen: (plan: FactoryPlan) => void }) {
  if (!plans.length) return <div className="fx-empty-state fx-empty-compact"><ListTodoIcon /><h2>No plans yet</h2><p>Create a plan to capture the outcome and acceptance criteria.</p></div>;
  return <div className="fx-plan-list">{plans.map((plan) => <button className="fx-plan-row" key={plan.id} onClick={() => onOpen(plan)} type="button"><span className="fx-plan-icon"><Check aria-hidden="true" /></span><div><strong>{plan.title}</strong><p>{projects.find((project) => project.projectAddress === plan.projectId || project.id === plan.projectId)?.name ?? "Project unavailable"} · Version {plan.revisions.length} · {plan.tasks.length} tasks</p></div><span className="fx-pill">{plan.status === "approved" ? "Approved" : plan.status === "review" ? "Changes requested" : "Plan review"}</span><ChevronRight aria-hidden="true" /></button>)}</div>;
}

function ListTodoIcon() { return <FolderGit2 aria-hidden="true" />; }

function PlanDetail({ plan, projects, onOpenProject, onApprove, onRequestRevision, onEdit }: { plan: FactoryPlan; projects: Project[]; onOpenProject: (id: string) => void; onApprove: () => void; onRequestRevision: () => void; onEdit: () => void }) {
  const project = projects.find((item) => item.projectAddress === plan.projectId || item.id === plan.projectId);
  return <>
    <div className="fx-plan-heading"><button className="fx-project-chip fx-chip-button" onClick={() => project && onOpenProject(project.id)} type="button">{project?.name ?? "Project unavailable"}</button><span>Version {plan.revisions.length}</span><span className="fx-pill">{plan.status === "approved" ? "Approved" : plan.status === "review" ? "Changes requested" : "Plan review"}</span></div>
    <div className="fx-plan-layout"><section><h3>Outcome</h3><p>{plan.outcome}</p><h3>Acceptance criteria</h3><ul>{plan.acceptanceCriteria.map((criterion, index) => <li key={`${index}-${criterion}`}>{criterion}</li>)}</ul><div className="fx-section-label"><h3>Tasks & dependencies</h3><span>{plan.tasks.length} tasks</span></div>{plan.tasks.length ? plan.tasks.map((task) => <div className="fx-task-row" key={task.id}><div><strong>{task.title}</strong><p>{task.dependencies.length ? `After ${task.dependencies.map((id) => plan.tasks.find((other) => other.id === id)?.title ?? "task").join(", ")}` : "Can run independently"}</p></div><span className="fx-pill">{task.status === "blocked" ? "Blocked" : task.status === "done" ? "Done" : "Ready"}</span></div>) : <p className="fx-muted">No tasks yet</p>}</section><aside><h3>Plan decisions</h3>{plan.revisions.map((revision) => <p className="fx-plan-note" key={revision.version}>Version {revision.version} · {new Date(revision.updatedAt).toLocaleDateString()}</p>)}{plan.status !== "approved" ? <button className="fx-button fx-button-primary fx-plan-action" onClick={onApprove} type="button">Approve this version</button> : null}<button className="fx-button fx-plan-action" onClick={onRequestRevision} type="button">Request a revision</button><button className="fx-button fx-plan-action" onClick={onEdit} type="button">Edit plan</button><p className="fx-muted">Approval records the scope. Start each agent when its task is ready.</p></aside></div>
  </>;
}

function SessionList({ runs, projects, agents, reconnecting, onOpen, onCancel, snapshots = new Map() }: { runs: FactoryRun[]; projects: Project[]; agents: ManagedAgent[]; reconnecting: ReadonlySet<string>; onOpen: (run: FactoryRun) => void; onCancel: (run: FactoryRun) => void; snapshots?: ReadonlyMap<string, { events: Array<{ sequence: number; kind: string; payload: unknown }> }> }) {
  if (!runs.length) return <div className="fx-empty-state fx-empty-compact"><Bot aria-hidden="true" /><h2>No sessions here</h2><p>Start an agent from a project or a task.</p></div>;
  const sorted = [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return <div className="fx-session-table">{sorted.map((run) => <div className="fx-session-row" key={run.id}><span className="fx-agent-mark"><Bot aria-hidden="true" /></span><div><button className="fx-run-title" onClick={() => onOpen(run)} type="button">{agents.find((agent) => agent.pubkey === run.agentId)?.name ?? "Agent session"}</button><p>{projects.find((project) => project.projectAddress === run.projectId || project.id === run.projectId)?.name ?? "Project unavailable"} · {run.harnessId} · {run.checkoutPath}</p>{snapshots.get(run.id)?.events.at(-1) ? <p className="fx-session-output">{eventText(snapshots.get(run.id)?.events.at(-1)?.payload)}</p> : null}{reconnecting.has(run.id) ? <p className="fx-reconnect-label">Reconnecting to this session</p> : null}</div><StatusLabel status={run.status} /><button className="fx-button fx-button-small" onClick={() => onOpen(run)} type="button">Open</button>{["queued", "running", "waiting", "blocked"].includes(run.status) ? <button aria-label="Cancel session" className="fx-text-button fx-danger" onClick={() => onCancel(run)} type="button">Cancel</button> : null}</div>)}</div>;
}

function RunReview({ run, projectName, agent, snapshot, reconnecting }: { run: FactoryRun; projectName: string; agent?: ManagedAgent; snapshot?: { events: Array<{ sequence: number; createdAt: string; kind: string; payload: unknown }> }; reconnecting: boolean }) {
  return <>
    <div className="fx-review-meta"><span className="fx-project-chip">{projectName}</span><StatusLabel status={run.status} /><span><GitBranch aria-hidden="true" /> {run.repositoryId ?? "Repository unavailable"}</span>{agent ? <span>{agent.name} · {agent.runtime ?? run.harnessId}</span> : <span>{run.harnessId}</span>}</div>
    {reconnecting ? <FactoryError message="Reconnecting to this session" /> : null}
    {(run.status === "error" || run.status === "blocked" || run.status === "waiting") ? <div className="fx-run-note"><strong>{factoryStatusPresentation(run.status).label}</strong><p>{run.error || "The run is retained with its saved history and working copy."}</p></div> : null}
    <div className="fx-review-layout"><section className="fx-output-panel"><h3>Session output</h3>{snapshot?.events.length ? snapshot.events.map((event) => <article className="fx-output-event" key={event.sequence}><small>{event.kind} · {new Date(event.createdAt).toLocaleTimeString()}</small><p>{eventText(event.payload)}</p></article>) : <p className="fx-muted">No output has been recorded for this session.</p>}</section><aside><h3>Review this iteration</h3><div className="fx-checklist"><p><Clock3 aria-hidden="true" /> Repository diff is not available for this run.</p><p><Clock3 aria-hidden="true" /> Checks are not recorded.</p><p><Clock3 aria-hidden="true" /> Review decision is not recorded.</p></div><p className="fx-muted">This runtime stores session output. Review actions need a repository diff and check result for this checkout.</p></aside></div>
  </>;
}

function FactoryStateGroups({ runs, snapshots, reconnecting, projects, onOpen }: { runs: FactoryRun[]; snapshots: ReadonlyMap<string, { events: Array<{ sequence: number; kind: string; payload: unknown }> }>; reconnecting: ReadonlySet<string>; projects: Project[]; onOpen: (run: FactoryRun) => void }) {
  const groups: Array<[FactoryRunStatus | "reconnecting", string, FactoryRun[]]> = [
    ["waiting", "Waiting", runs.filter((run) => run.status === "waiting")],
    ["blocked", "Blocked", runs.filter((run) => run.status === "blocked")],
    ["error", "Interrupted session", runs.filter((run) => run.status === "error")],
    ["reconnecting", "Reconnecting", runs.filter((run) => reconnecting.has(run.id))],
  ];
  return <div className="fx-state-grid">{groups.map(([id, title, items]) => <section key={id}><h3>{title}</h3><p>{id === "reconnecting" ? "The host attachment is being restored." : `Sessions currently in the ${title.toLowerCase()} state.`}</p>{items.length ? items.map((run) => <button className="fx-state-run" key={run.id} onClick={() => onOpen(run)} type="button"><span>{projects.find((project) => project.projectAddress === run.projectId || project.id === run.projectId)?.name ?? "Project unavailable"}</span><StatusLabel status={run.status} /><small>{snapshots.get(run.id)?.events.length ?? 0} output events</small><ChevronRight aria-hidden="true" /></button>) : <span className="fx-muted">No sessions</span>}</section>)}</div>;
}

function NameDialog({ title, label, action, onClose, onSubmit }: { title: string; label: string; action: string; onClose: () => void; onSubmit: (value: string) => void }) {
  const [value, setValue] = React.useState("");
  return <Modal title={title} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value); }}><label>{label}<input autoFocus onChange={(event) => setValue(event.currentTarget.value)} value={value} /></label><div className="fx-modal-actions"><button className="fx-button" onClick={onClose} type="button">Cancel</button><button className="fx-button fx-button-primary" disabled={!value.trim()} type="submit">{action}</button></div></form></Modal>;
}

function StartRunDialog({ projects, localRepositories, agents, runs, tabs, activeTabId, busy, error, onClose, onStart }: { projects: Project[]; localRepositories: Array<{ name: string; path: string }>; agents: ManagedAgent[]; runs: FactoryRun[]; tabs: DeskTab[]; activeTabId: string; busy: boolean; error: string | null; onClose: () => void; onStart: (input: { projectId: string; repositoryId: string; checkoutPath: string; agentId: string; parentRunId: string; prompt: string; tabId: string }) => void }) {
  const [projectId, setProjectId] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  const [parentRunId, setParentRunId] = React.useState("");
  const [task, setTask] = React.useState("");
  const [direction, setDirection] = React.useState("");
  const [tabId, setTabId] = React.useState(activeTabId);
  const project = projects.find((item) => item.projectAddress === projectId || item.id === projectId);
  const selectedRepository = project?.repositories.find((repo) => repo.repoAddress === project.primaryRepositoryAddress) ?? (project?.repositories.length === 1 ? project.repositories[0] : undefined);
  const matchingCheckouts = selectedRepository ? localRepositories.filter((item) => item.name.toLowerCase() === selectedRepository.name.toLowerCase()) : [];
  const checkoutPath = matchingCheckouts.length === 1 ? matchingCheckouts[0].path : "";
  const selectedAgent = agents.find((agent) => agent.pubkey === agentId);
  const canStart = Boolean(project && selectedRepository && checkoutPath && agentId && direction.trim() && !busy);
  return <Modal title="Add an agent session" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (!canStart || !project || !selectedRepository) return; onStart({ projectId: project.projectAddress, repositoryId: selectedRepository.repoAddress, checkoutPath, agentId, parentRunId, prompt: task.trim() ? `Task: ${task.trim()}\n\nStarting direction:\n${direction.trim()}` : direction.trim(), tabId }); }}>
    <label>Task<input autoFocus onChange={(event) => setTask(event.currentTarget.value)} value={task} /></label>
    <div className="fx-form-row"><label>Project<select onChange={(event) => setProjectId(event.currentTarget.value)} value={projectId}><option value="">Select a project</option>{projects.map((item) => <option key={item.id} value={item.projectAddress}>{item.name}</option>)}</select></label><label>Open in tab<select onChange={(event) => setTabId(event.currentTarget.value)} value={tabId}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.name}</option>)}</select></label></div>
    <label>Harness<select disabled={!agents.length} onChange={(event) => setAgentId(event.currentTarget.value)} value={agentId}><option value="">Select a local agent</option>{agents.map((agent) => <option key={agent.pubkey} value={agent.pubkey}>{agent.name} · {agent.runtime ?? "Default harness"}</option>)}</select></label>
    <div className="fx-form-row"><label>Provider<input readOnly value={selectedAgent?.provider ?? "Not configured"} /></label><label>Model<input readOnly value={selectedAgent?.model ?? "Not configured"} /></label></div>
    <label>Parent agent<select onChange={(event) => setParentRunId(event.currentTarget.value)} value={parentRunId}><option value="">No parent agent</option>{runs.filter((run) => run.status === "running" || run.status === "waiting").map((run) => <option key={run.id} value={run.id}>{agents.find((agent) => agent.pubkey === run.agentId)?.name ?? run.harnessId}</option>)}</select></label>
    <label>Starting direction<textarea onChange={(event) => setDirection(event.currentTarget.value)} value={direction} /></label>
    {error ? <p className="fx-form-error" role="alert">{error}</p> : null}
    <div className="fx-modal-actions"><button className="fx-button" onClick={onClose} type="button">Cancel</button><button className="fx-button fx-button-primary" disabled={!canStart} type="submit">{busy ? "Starting..." : "Start session"}</button></div>
  </form></Modal>;
}

function PlanDialog({ projects, plan, title, action, onClose, onSubmit }: { projects: Project[]; plan?: FactoryPlan; title: string; action: string; onClose: () => void; onSubmit: (input: { projectId: string; title: string; outcome: string; criteria: string[] }) => void }) {
  const [projectId, setProjectId] = React.useState(plan?.projectId ?? "");
  const [planTitle, setPlanTitle] = React.useState(plan?.title ?? "");
  const [outcome, setOutcome] = React.useState(plan?.outcome ?? "");
  const [criteria, setCriteria] = React.useState(plan?.acceptanceCriteria.join("\n") ?? "");
  return <Modal title={title} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (!projectId || !planTitle.trim() || !outcome.trim()) return; onSubmit({ projectId, title: planTitle.trim(), outcome: outcome.trim(), criteria: criteria.split("\n").map((item) => item.trim()).filter(Boolean) }); }}><label>Project<select onChange={(event) => setProjectId(event.currentTarget.value)} value={projectId}><option value="">Select a project</option>{projects.map((project) => <option key={project.id} value={project.projectAddress}>{project.name}</option>)}</select></label><label>Plan name<input onChange={(event) => setPlanTitle(event.currentTarget.value)} value={planTitle} /></label><label>Outcome<textarea onChange={(event) => setOutcome(event.currentTarget.value)} value={outcome} /></label><label>Acceptance criteria · one per line<textarea onChange={(event) => setCriteria(event.currentTarget.value)} value={criteria} /></label><p className="fx-form-help">Plans are saved on this device for this workspace.</p><div className="fx-modal-actions"><button className="fx-button" onClick={onClose} type="button">Cancel</button><button className="fx-button fx-button-primary" disabled={!projectId || !planTitle.trim() || !outcome.trim()} type="submit">{action}</button></div></form></Modal>;
}

function TaskDialog({ plan, onClose, onSubmit }: { plan: FactoryPlan; onClose: () => void; onSubmit: (title: string, dependencies: string[]) => void }) {
  const [title, setTitle] = React.useState("");
  const [dependency, setDependency] = React.useState("");
  return <Modal title="Add task" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); if (title.trim()) onSubmit(title.trim(), dependency ? [dependency] : []); }}><label>Task<input autoFocus onChange={(event) => setTitle(event.currentTarget.value)} value={title} /></label><label>Depends on<select onChange={(event) => setDependency(event.currentTarget.value)} value={dependency}><option value="">Can run independently</option>{plan.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><div className="fx-modal-actions"><button className="fx-button" onClick={onClose} type="button">Cancel</button><button className="fx-button fx-button-primary" disabled={!title.trim()} type="submit">Add task</button></div></form></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="fx-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-labelledby="factory-modal-title" aria-modal="true" className="fx-modal" role="dialog"><header><h2 id="factory-modal-title">{title}</h2><button aria-label="Close" className="fx-icon-button" onClick={onClose} type="button"><X aria-hidden="true" /></button></header>{children}</section></div>;
}
