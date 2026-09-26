import * as React from "react";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  FolderGit2,
  GitBranch,
  MoreHorizontal,
  Plus,
} from "lucide-react";

import type { Project } from "@/features/projects/hooks";
import { factoryStatusPresentation } from "@/features/factory/lib/factoryPresentation";
import type { FactoryRun, FactoryRunStatus } from "@/shared/api/factoryRuntime";
import type { ManagedAgent } from "@/shared/api/types";
import { SessionActionsDialog } from "./FactoryDialogs";
import { eventText, runTitle, StatusLabel } from "./FactoryWorkbench";
import type { FactoryPlan, FactoryRepository } from "./factoryTypes";

export function repositoryLabel(repository: FactoryRepository) {
  const cloneUrl = repository.cloneUrls[0];
  if (cloneUrl) {
    try {
      const segments = new URL(cloneUrl).pathname.split("/").filter(Boolean);
      const name = segments.at(-1)?.replace(/\.git$/iu, "");
      const owner = segments.at(-2);
      if (owner && name && !/^[0-9a-f]{64}$/iu.test(owner)) {
        return `${owner}/${name}`;
      }
    } catch {
      // A non-URL clone target falls back to the repository event fields.
    }
  }
  return `${repository.owner}/${repository.name}`;
}

export function FactoryPage({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="fx-page">
      <header>
        {title ? <h2>{title}</h2> : <span />}
        <div>{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function FactoryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="fx-error" role="status">
      <CircleAlert aria-hidden="true" />
      <span>{message}</span>
      {onRetry ? (
        <button className="fx-text-button" onClick={onRetry} type="button">
          Reconnect
        </button>
      ) : null}
    </div>
  );
}

export function FactoryEmptyDetail({
  loading,
  label,
}: {
  loading: boolean;
  label: string;
}) {
  void loading;
  void label;
  return null;
}

export function ProjectDetail({
  project,
  runs,
  agents,
  snapshots,
  localRepositories,
  onAddAgent,
  onCancelRun,
  onOpenRun,
  onOpenPlan,
  onOpenRepository,
  plans,
}: {
  project: Project;
  runs: FactoryRun[];
  agents: ManagedAgent[];
  snapshots: ReadonlyMap<
    string,
    { events: Array<{ sequence: number; kind: string; payload: unknown }> }
  >;
  localRepositories: Array<{ name: string; path: string }>;
  onAddAgent: () => void;
  onCancelRun: (runId: string) => void;
  onOpenRun: (runId: string) => void;
  onOpenPlan: (planId: string) => void;
  onOpenRepository: (
    repositoryId: string,
    tab: "files" | "issues" | "prs",
  ) => void;
  plans: FactoryPlan[];
}) {
  const primaryRepository =
    project.repositories.find(
      (repository) =>
        repository.repoAddress === project.primaryRepositoryAddress,
    ) ?? project.repositories[0];
  const localCheckout = primaryRepository
    ? localRepositories.find(
        (repository) =>
          repository.name.toLowerCase() ===
          primaryRepository.name.toLowerCase(),
      )
    : undefined;
  return (
    <>
      <div className="fx-project-actions">
        {primaryRepository ? (
          <>
            <button
              className="fx-button"
              onClick={() =>
                onOpenRepository(primaryRepository.repoAddress, "files")
              }
              type="button"
            >
              Browse repository
            </button>
            <button
              className="fx-button"
              onClick={() =>
                onOpenRepository(primaryRepository.repoAddress, "issues")
              }
              type="button"
            >
              Issues
            </button>
            <button
              className="fx-button"
              onClick={() =>
                onOpenRepository(primaryRepository.repoAddress, "prs")
              }
              type="button"
            >
              Change reviews
            </button>
          </>
        ) : null}
      </div>
      <div className="fx-project-summary">
        <span className="fx-project-chip">{project.name}</span>
        <p>{project.description}</p>
        <dl>
          <dt>Repository</dt>
          <dd>{project.repositories.map(repositoryLabel).join(", ")}</dd>
          <dt>Local folder</dt>
          <dd>{localCheckout?.path}</dd>
          <dt>Default branch</dt>
          <dd>{primaryRepository?.defaultBranch}</dd>
          <dt>Execution boundary</dt>
          <dd>Each implementation session gets its own working copy.</dd>
        </dl>
      </div>
      <div className="fx-section-label">
        <h3>Plans & tasks</h3>
        <button
          className="fx-text-button"
          onClick={() => onOpenPlan("new")}
          type="button"
        >
          New plan <Plus aria-hidden="true" />
        </button>
      </div>
      {plans.length ? (
        <PlansList
          plans={plans}
          projects={[project]}
          onOpen={(plan) => onOpenPlan(plan.id)}
        />
      ) : null}
      <div className="fx-section-label">
        <h3>Agent sessions</h3>
        <button className="fx-text-button" onClick={onAddAgent} type="button">
          Add agent <Plus aria-hidden="true" />
        </button>
      </div>
      <SessionList
        runs={runs}
        projects={[project]}
        agents={agents}
        onOpen={(run) => onOpenRun(run.id)}
        onCancel={(run) => onCancelRun(run.id)}
        snapshots={snapshots}
      />
    </>
  );
}

export function PlansList({
  plans,
  projects,
  onOpen,
}: {
  plans: FactoryPlan[];
  projects: Project[];
  onOpen: (plan: FactoryPlan) => void;
}) {
  if (!plans.length) return null;
  return (
    <div className="fx-plan-list">
      {plans.map((plan) => (
        <button
          className="fx-plan-row"
          key={plan.id}
          onClick={() => onOpen(plan)}
          type="button"
        >
          <span className="fx-plan-icon">
            <FolderGit2 aria-hidden="true" />
          </span>
          <div>
            <strong>{plan.title}</strong>
            <p>
              {
                projects.find(
                  (project) =>
                    project.projectAddress === plan.projectId ||
                    project.id === plan.projectId,
                )?.name
              }{" "}
              · Version {plan.revisions.length} · {plan.tasks.length} tasks
            </p>
          </div>
          <span className="fx-pill">
            {plan.status === "approved"
              ? "Approved"
              : plan.status === "review"
                ? "Changes requested"
                : "Plan review"}
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export function PlanDetail({
  plan,
  projects,
  onOpenProject,
  onAddTask,
  onRequestRevision,
  onEdit,
}: {
  plan: FactoryPlan;
  projects: Project[];
  onOpenProject: (id: string) => void;
  onAddTask: () => void;
  onRequestRevision: () => void;
  onEdit: () => void;
}) {
  const project = projects.find(
    (item) =>
      item.projectAddress === plan.projectId || item.id === plan.projectId,
  );
  return (
    <>
      <div className="fx-plan-heading">
        {project ? (
          <button
            className="fx-project-chip fx-chip-button"
            onClick={() => onOpenProject(project.id)}
            type="button"
          >
            {project.name}
          </button>
        ) : null}
        <span>
          Version {plan.revisions.length}{" "}
          {plan.status === "approved" ? "approved" : ""}
        </span>
      </div>
      <div className="fx-plan-layout">
        <section>
          <h3>Outcome</h3>
          <p>{plan.outcome}</p>
          <h3>Acceptance criteria</h3>
          <ul>
            {plan.acceptanceCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <div className="fx-section-label">
            <h3>Tasks & dependencies</h3>
            <button className="fx-button" onClick={onAddTask} type="button">
              <Plus aria-hidden="true" /> Add task
            </button>
          </div>
          {plan.tasks.map((task) => (
            <div className="fx-task-row" key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <p>
                  {task.dependencies.length
                    ? `After ${task.dependencies
                        .map(
                          (id) =>
                            plan.tasks.find((other) => other.id === id)
                              ?.title ?? "",
                        )
                        .filter(Boolean)
                        .join(", ")}`
                    : "Can run independently"}
                </p>
              </div>
              <span className="fx-pill">
                {task.status === "blocked"
                  ? "Blocked"
                  : task.status === "done"
                    ? "Done"
                    : "Ready"}
              </span>
            </div>
          ))}
        </section>
        <aside>
          <h3>Plan decisions</h3>
          {plan.revisions.map((revision) => (
            <p className="fx-plan-note" key={revision.version}>
              Version {revision.version} ·{" "}
              {new Date(revision.updatedAt).toLocaleDateString()}
            </p>
          ))}
          <button
            className="fx-button fx-plan-action"
            onClick={onRequestRevision}
            type="button"
          >
            Request a revision
          </button>
          <button
            className="fx-button fx-plan-action"
            onClick={onEdit}
            type="button"
          >
            Edit plan
          </button>
        </aside>
      </div>
    </>
  );
}

export function SessionList({
  runs,
  projects,
  agents,
  onOpen,
  onCancel,
  snapshots = new Map(),
}: {
  runs: FactoryRun[];
  projects: Project[];
  agents: ManagedAgent[];
  onOpen: (run: FactoryRun) => void;
  onCancel: (run: FactoryRun) => void;
  snapshots?: ReadonlyMap<
    string,
    { events: Array<{ sequence: number; kind: string; payload: unknown }> }
  >;
}) {
  const [managedRun, setManagedRun] = React.useState<FactoryRun | null>(null);
  if (!runs.length) return null;
  const sorted = [...runs].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return (
    <div className="fx-session-table">
      {sorted.map((run) => {
        const snapshot = snapshots.get(run.id);
        const title = runTitle(
          run,
          snapshot,
          agents.find((agent) => agent.pubkey === run.agentId)?.name,
        );
        const projectName = projects.find(
          (project) =>
            project.projectAddress === run.projectId ||
            project.id === run.projectId,
        )?.name;
        return (
          <div className="fx-session-row" key={run.id}>
            <span className="fx-agent-mark">
              <Bot aria-hidden="true" />
            </span>
            <div>
              <button
                className="fx-run-title"
                onClick={() => onOpen(run)}
                type="button"
              >
                {title}
              </button>
              <p>
                {projectName} · {run.harnessId} · {run.checkoutPath}
              </p>
            </div>
            <StatusLabel status={run.status} />
            <button
              className="fx-button fx-button-small"
              onClick={() => onOpen(run)}
              type="button"
            >
              Open
            </button>
            <button
              aria-label={`Manage ${title}`}
              className="fx-icon-button"
              onClick={() => setManagedRun(run)}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
            {managedRun?.id === run.id ? (
              <SessionActionsDialog
                canStop={["queued", "running", "waiting", "blocked"].includes(
                  run.status,
                )}
                onClose={() => setManagedRun(null)}
                onStop={() => {
                  onCancel(run);
                  setManagedRun(null);
                }}
                projectName={projectName ?? ""}
                status={<StatusLabel status={run.status} />}
                title={title}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function RunReview({
  run,
  projectName,
  agent,
  snapshot,
  reconnecting,
}: {
  run: FactoryRun;
  projectName: string;
  agent?: ManagedAgent;
  snapshot?: {
    events: Array<{
      sequence: number;
      createdAt: string;
      kind: string;
      payload: unknown;
    }>;
  };
  reconnecting: boolean;
}) {
  return (
    <>
      <div className="fx-review-meta">
        <span className="fx-project-chip">{projectName}</span>
        <StatusLabel status={run.status} />
        <span>
          <GitBranch aria-hidden="true" /> {run.repositoryId}
        </span>
        {agent ? (
          <span>
            {agent.name} · {agent.runtime ?? run.harnessId}
          </span>
        ) : (
          <span>{run.harnessId}</span>
        )}
      </div>
      {reconnecting ? (
        <FactoryError message="Reconnecting to this session" />
      ) : null}
      {run.error ? (
        <div className="fx-run-note">
          <strong>{factoryStatusPresentation(run.status).label}</strong>
          <p>{run.error}</p>
        </div>
      ) : null}
      <div className="fx-review-layout">
        <section className="fx-output-panel">
          {snapshot?.events.map((event) => (
            <article className="fx-output-event" key={event.sequence}>
              <small>
                {event.kind} · {new Date(event.createdAt).toLocaleTimeString()}
              </small>
              <p>{eventText(event.payload)}</p>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}

export function FactoryStateGroups({
  runs,
  snapshots,
  reconnecting,
  projects,
  agents,
  onOpen,
}: {
  runs: FactoryRun[];
  snapshots: ReadonlyMap<
    string,
    { events: Array<{ sequence: number; kind: string; payload: unknown }> }
  >;
  reconnecting: ReadonlySet<string>;
  projects: Project[];
  agents: ManagedAgent[];
  onOpen: (run: FactoryRun) => void;
}) {
  const groups: Array<
    [FactoryRunStatus | "reconnecting", string, FactoryRun[]]
  > = [
    ["waiting", "Waiting", runs.filter((run) => run.status === "waiting")],
    ["blocked", "Blocked", runs.filter((run) => run.status === "blocked")],
    [
      "error",
      "Interrupted session",
      runs.filter((run) => run.status === "error"),
    ],
    [
      "reconnecting",
      "Reconnecting",
      runs.filter((run) => reconnecting.has(run.id)),
    ],
  ];
  return (
    <div className="fx-state-grid">
      {groups
        .filter(([, , items]) => items.length)
        .map(([id, title, items]) => (
          <section key={id}>
            <h3>{title}</h3>
            {items.map((run) => {
              const snapshot = snapshots.get(run.id);
              const projectName =
                projects.find(
                  (project) =>
                    project.projectAddress === run.projectId ||
                    project.id === run.projectId,
                )?.name ??
                run.projectId ??
                "";
              const agentName = agents.find(
                (agent) => agent.pubkey === run.agentId,
              )?.name;
              const stateDetail = reconnecting.has(run.id)
                ? "Reconnecting to this session"
                : run.error || eventText(snapshot?.events.at(-1)?.payload);
              return (
                <button
                  className="fx-state-run"
                  key={run.id}
                  onClick={() => onOpen(run)}
                  type="button"
                >
                  <span className="fx-state-run-copy">
                    <strong>{runTitle(run, snapshot, agentName)}</strong>
                    <small>{projectName}</small>
                    {stateDetail ? <small>{stateDetail}</small> : null}
                  </span>
                  <StatusLabel status={run.status} />
                  <ChevronRight aria-hidden="true" />
                </button>
              );
            })}
          </section>
        ))}
    </div>
  );
}
