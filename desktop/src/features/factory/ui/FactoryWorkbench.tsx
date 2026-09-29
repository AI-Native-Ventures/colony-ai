import * as React from "react";
import {
  Bot,
  Check,
  CircleAlert,
  Clock3,
  FolderGit2,
  GitBranch,
  RefreshCw,
} from "lucide-react";

import type { Project } from "@/features/projects/hooks";
import { factoryStatusPresentation } from "@/features/factory/lib/factoryPresentation";
import {
  getFactoryRunDraft,
  setFactoryRunDraft,
  type FactoryRun,
  type FactoryRunSnapshot,
  type FactoryRunStatus,
} from "@/shared/api/factoryRuntime";
import type { ManagedAgent } from "@/shared/api/types";
import type {
  FactoryDeskView,
  FactoryPanePosition,
  FactoryPlan,
} from "./factoryTypes";
import { FactoryRunToolPane, type FactoryRunTool } from "./FactoryRunTools";
import { useFactoryRunRecordQuery } from "../lib/factoryRunRecords";

export function FactoryDeskLayout({
  activeTabId,
  agents,
  allRuns,
  onOpenPlan,
  onOpenRun,
  plans,
  projects,
  reconnecting,
  runs,
  snapshots,
}: {
  activeTabId: string;
  agents: ManagedAgent[];
  allRuns: FactoryRun[];
  onOpenPlan: (planId: string) => void;
  onOpenRun: (runId: string) => void;
  plans: FactoryPlan[];
  projects: Project[];
  reconnecting: ReadonlySet<string>;
  runs: FactoryRun[];
  snapshots: ReadonlyMap<string, FactoryRunSnapshot>;
}) {
  const [activeViews, setActiveViews] = React.useState<Record<string, string>>(
    {},
  );
  React.useEffect(() => {
    if (activeTabId) setActiveViews({});
  }, [activeTabId]);

  const runsById = new Map(allRuns.map((run) => [run.id, run]));
  const includedRunIds = new Set(runs.map((run) => run.id));
  for (const run of runs) {
    let parentId = run.parentRunId;
    let depth = 0;
    while (parentId && depth++ < 32) {
      const parent = runsById.get(parentId);
      if (!parent || includedRunIds.has(parent.id)) break;
      includedRunIds.add(parent.id);
      parentId = parent.parentRunId;
    }
  }
  const visibleRuns = allRuns.filter((run) => includedRunIds.has(run.id));
  const visibleRunIds = new Set(visibleRuns.map((run) => run.id));
  const roots = visibleRuns.filter(
    (run) => !run.parentRunId || !visibleRunIds.has(run.parentRunId),
  );
  const lead = roots[0];
  const belongsToLead = (run: FactoryRun) => {
    let parentId = run.parentRunId;
    let depth = 0;
    while (parentId && depth++ < 32) {
      if (parentId === lead?.id) return true;
      parentId = runsById.get(parentId)?.parentRunId ?? null;
    }
    return false;
  };
  const leadChildren = lead
    ? visibleRuns.filter((run) => run.id !== lead.id && belongsToLead(run))
    : [];
  const otherRuns = visibleRuns.filter(
    (run) => run.id !== lead?.id && !belongsToLead(run),
  );
  const leftViews: FactoryDeskView[] = lead
    ? [
        { kind: "run", id: lead.id, run: lead },
        ...plans
          .filter((plan) => plan.projectId === lead.projectId)
          .map((plan) => ({
            kind: "plan" as const,
            id: `plan:${plan.id}`,
            plan,
          })),
      ]
    : [];
  const topViews: FactoryDeskView[] = (
    leadChildren.length ? leadChildren.slice(0, 2) : otherRuns.slice(0, 2)
  ).map((run) => ({ kind: "run", id: run.id, run }));
  const bottomSource = leadChildren.length ? otherRuns : otherRuns.slice(2);
  const bottomViews = bottomSource.map((run) => ({
    kind: "run" as const,
    id: run.id,
    run,
  }));

  const chooseView = (position: FactoryPanePosition, viewId: string) =>
    setActiveViews((current) => ({ ...current, [position]: viewId }));

  return (
    <section
      aria-label="Factory workbench"
      className="fx-desk-layout"
      data-testid="factory-desk-layout"
    >
      {(
        [
          ["lead", "lead pane", leftViews],
          ["delegates", "delegated sessions pane", topViews],
          ["sessions", "sessions pane", bottomViews],
        ] as const
      ).map(([position, label, views]) => {
        const activeView =
          views.find((view) => view.id === activeViews[position]) ?? views[0];
        const delegates =
          position === "lead" && activeView?.kind === "run"
            ? visibleRuns.filter((run) => run.parentRunId === activeView.run.id)
            : [];
        return (
          <FactoryDeskPaneGroup
            activeViewId={activeViews[position]}
            agents={agents}
            delegates={delegates}
            key={position}
            label={label}
            onOpenPlan={onOpenPlan}
            onOpenRun={onOpenRun}
            onSelectView={(id) => chooseView(position, id)}
            position={position}
            projects={projects}
            reconnecting={reconnecting}
            snapshots={snapshots}
            views={views}
          />
        );
      })}
    </section>
  );
}

function FactoryDeskPaneGroup({
  activeViewId,
  agents,
  delegates,
  label,
  onOpenPlan,
  onOpenRun,
  onSelectView,
  position,
  projects,
  reconnecting,
  snapshots,
  views,
}: {
  activeViewId?: string;
  agents: ManagedAgent[];
  delegates: FactoryRun[];
  label: string;
  onOpenPlan: (planId: string) => void;
  onOpenRun: (runId: string) => void;
  onSelectView: (id: string) => void;
  position: FactoryPanePosition;
  projects: Project[];
  reconnecting: ReadonlySet<string>;
  snapshots: ReadonlyMap<string, FactoryRunSnapshot>;
  views: FactoryDeskView[];
}) {
  const activeView = views.find((view) => view.id === activeViewId) ?? views[0];
  return (
    <section
      aria-label={`Pane group: ${label}`}
      className={`fx-pane-group fx-pane-${position}`}
      data-pane-position={position}
      data-testid="factory-pane-group"
    >
      <header className="fx-pane-group-header">
        <div
          aria-label="Sessions in pane"
          className="fx-pane-tabs"
          role="tablist"
        >
          {views.map((view) => {
            const title =
              view.kind === "run"
                ? runTitle(
                    view.run,
                    snapshots.get(view.run.id),
                    agents.find((agent) => agent.pubkey === view.run.agentId)
                      ?.name,
                  )
                : `Plan · v${view.plan.revisions.length}`;
            const status =
              view.kind === "run"
                ? factoryStatusPresentation(view.run.status).label
                : undefined;
            return (
              <button
                aria-label={status ? `${title}, ${status}` : title}
                aria-selected={view.id === activeView?.id}
                className="fx-pane-tab"
                key={view.id}
                onClick={() => onSelectView(view.id)}
                role="tab"
                type="button"
              >
                {view.kind === "run" ? (
                  <Bot aria-hidden="true" />
                ) : (
                  <FolderGit2 aria-hidden="true" />
                )}
                <span>{title}</span>
                {view.kind === "run" ? (
                  <i
                    aria-hidden="true"
                    className={`fx-pane-tab-dot fx-${factoryStatusPresentation(view.run.status).tone}`}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </header>
      <div className="fx-pane-group-body" role="tabpanel">
        {activeView?.kind === "run" ? (
          <FactoryAgentPane
            agent={agents.find(
              (agent) => agent.pubkey === activeView.run.agentId,
            )}
            agents={agents}
            delegates={delegates}
            onOpenRun={onOpenRun}
            runSnapshots={snapshots}
            project={projects.find(
              (project) =>
                project.projectAddress === activeView.run.projectId ||
                project.id === activeView.run.projectId,
            )}
            reconnecting={reconnecting.has(activeView.run.id)}
            run={activeView.run}
            snapshot={snapshots.get(activeView.run.id)}
          />
        ) : activeView?.kind === "plan" ? (
          <FactoryPlanPane
            onOpen={() => onOpenPlan(activeView.plan.id)}
            plan={activeView.plan}
            project={projects.find(
              (project) =>
                project.projectAddress === activeView.plan.projectId ||
                project.id === activeView.plan.projectId,
            )}
          />
        ) : (
          <div aria-hidden="true" className="fx-pane-empty" />
        )}
      </div>
    </section>
  );
}

function FactoryAgentPane({
  agent,
  agents,
  delegates,
  onOpenRun,
  project,
  reconnecting,
  run,
  runSnapshots,
  snapshot,
}: {
  agent?: ManagedAgent;
  agents: ManagedAgent[];
  delegates: FactoryRun[];
  onOpenRun: (runId: string) => void;
  project?: Project;
  reconnecting: boolean;
  run: FactoryRun;
  runSnapshots: ReadonlyMap<string, FactoryRunSnapshot>;
  snapshot?: FactoryRunSnapshot;
}) {
  const [draft, setDraft] = React.useState("");
  const [draftLoading, setDraftLoading] = React.useState(true);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [activeTool, setActiveTool] = React.useState<FactoryRunTool>("agent");
  const activeToolRunId = React.useRef(run.id);
  const runRecordQuery = useFactoryRunRecordQuery(run.id);
  const draftGeneration = React.useRef(0);
  const draftWrites = React.useRef<Promise<void>>(Promise.resolve());
  const title = runTitle(run, snapshot, agent?.name);

  React.useEffect(() => {
    if (activeToolRunId.current !== run.id) {
      activeToolRunId.current = run.id;
      setActiveTool("agent");
    }
  }, [run.id]);

  const previewState = runRecordQuery.data?.head.preview.state;
  const previewDesignMissing = ["starting", "running", "stopped"].includes(
    previewState ?? "",
  );
  const reviewDesignMissing = Boolean(runRecordQuery.data?.head.pullRequest);
  React.useEffect(() => {
    if (
      (activeTool === "preview" && previewDesignMissing) ||
      (activeTool === "review" && reviewDesignMissing)
    ) {
      setActiveTool("agent");
    }
  }, [activeTool, previewDesignMissing, reviewDesignMissing]);

  React.useEffect(() => {
    const generation = ++draftGeneration.current;
    setDraft("");
    setDraftError(null);
    setDraftLoading(true);
    void getFactoryRunDraft(run.id).then(
      (record) => {
        if (draftGeneration.current !== generation) return;
        setDraft(record?.draft ?? "");
        setDraftLoading(false);
      },
      (error: unknown) => {
        if (draftGeneration.current !== generation) return;
        setDraftError(
          error instanceof Error ? error.message : "Draft could not be loaded.",
        );
        setDraftLoading(false);
      },
    );
    return () => {
      draftGeneration.current += 1;
    };
  }, [run.id]);

  const saveDraft = (value: string) => {
    setDraft(value);
    setDraftError(null);
    const generation = draftGeneration.current;
    draftWrites.current = draftWrites.current
      .catch(() => undefined)
      .then(async () => {
        await setFactoryRunDraft(run.id, value);
        if (draftGeneration.current === generation) setDraftError(null);
      })
      .catch((error: unknown) => {
        if (draftGeneration.current !== generation) return;
        setDraftError(
          error instanceof Error ? error.message : "Draft could not be saved.",
        );
      });
  };

  const events = (snapshot?.events ?? []).filter((event) =>
    eventText(event.payload).trim(),
  );
  return (
    <article className="fx-agent-pane" data-status={run.status}>
      <div className="fx-agent-context">
        {project ? (
          <span className="fx-project-chip">{project.name}</span>
        ) : null}
        <span className="fx-agent-checkout" title={run.checkoutPath}>
          <GitBranch aria-hidden="true" />
          {run.checkoutPath}
        </span>
        <StatusLabel status={run.status} />
        <nav aria-label={`${title} tools`} className="fx-agent-tool-tabs">
          {(["agent", "preview", "review"] as const)
            .filter(
              (tool) =>
                !(tool === "preview" && previewDesignMissing) &&
                !(tool === "review" && reviewDesignMissing),
            )
            .map((tool) => (
              <button
                aria-pressed={activeTool === tool}
                className="fx-agent-tool-tab"
                data-testid={`factory-run-tool-${tool}`}
                key={tool}
                onClick={() => setActiveTool(tool)}
                type="button"
              >
                {tool === "agent"
                  ? "Agent"
                  : tool === "preview"
                    ? "Preview"
                    : "Review"}
              </button>
            ))}
        </nav>
      </div>
      {activeTool === "agent" ? (
        <>
          {reconnecting ? (
            <div
              className="fx-run-message"
              data-state="reconnecting"
              role="status"
            >
              <RefreshCw aria-hidden="true" /> Reconnecting to this session
            </div>
          ) : null}
          {run.error ? (
            <div className="fx-run-message fx-failed" role="status">
              <CircleAlert aria-hidden="true" />
              <span>{run.error}</span>
            </div>
          ) : null}
          <div
            aria-label={`${title} transcript`}
            className="fx-agent-transcript"
            role="log"
          >
            {events.map((event) => (
              <div
                className={
                  event.kind === "user_prompt"
                    ? "fx-agent-message fx-from-you"
                    : "fx-agent-message"
                }
                key={`${event.sequence}:${event.kind}`}
              >
                <strong>
                  {event.kind === "user_prompt"
                    ? "You"
                    : (agent?.name ?? agent?.runtime ?? run.harnessId)}
                </strong>
                <p>{eventText(event.payload)}</p>
              </div>
            ))}
          </div>
          {delegates.length ? (
            <section aria-label="Delegated work" className="fx-agent-delegates">
              <div>
                <span>
                  <GitBranch aria-hidden="true" /> Delegated work
                </span>
              </div>
              {delegates.map((delegate) => {
                const delegateTitle = runTitle(
                  delegate,
                  runSnapshots.get(delegate.id),
                  agents.find((item) => item.pubkey === delegate.agentId)?.name,
                );
                return (
                  <button
                    aria-label={`${delegateTitle}, ${factoryStatusPresentation(delegate.status).label}`}
                    className="fx-delegate"
                    key={delegate.id}
                    onClick={() => onOpenRun(delegate.id)}
                    type="button"
                  >
                    <span>{delegateTitle}</span>
                    <StatusLabel status={delegate.status} />
                  </button>
                );
              })}
            </section>
          ) : null}
          <label className="fx-agent-composer">
            <textarea
              aria-label={`Draft for ${title}`}
              disabled={draftLoading}
              onChange={(event) => saveDraft(event.currentTarget.value)}
              placeholder="Steer this task..."
              value={draft}
            />
            {draftError ? (
              <span className="fx-draft-error" role="status">
                {draftError}
              </span>
            ) : null}
          </label>
          <footer className="fx-agent-footer">
            <span>
              <Bot aria-hidden="true" /> {agent?.runtime ?? run.harnessId}
            </span>
            <span>Local</span>
          </footer>
        </>
      ) : (
        <FactoryRunToolPane
          onOpenAgent={() => setActiveTool("agent")}
          run={run}
          tool={activeTool}
        />
      )}
    </article>
  );
}

function FactoryPlanPane({
  onOpen,
  plan,
  project,
}: {
  onOpen: () => void;
  plan: FactoryPlan;
  project?: Project;
}) {
  return (
    <article className="fx-plan-pane">
      <div>
        {project ? (
          <span className="fx-project-chip">{project.name}</span>
        ) : null}
        <span className={`fx-plan-status fx-plan-${plan.status}`}>
          {plan.status === "approved"
            ? "Approved"
            : plan.status === "review"
              ? "In review"
              : "Draft"}
        </span>
      </div>
      <button className="fx-plan-pane-title" onClick={onOpen} type="button">
        {plan.title}
      </button>
      <p>{plan.outcome}</p>
      <h3>What done looks like</h3>
      <ul>
        {plan.acceptanceCriteria.map((criterion) => (
          <li key={criterion}>{criterion}</li>
        ))}
      </ul>
      <h3>Work & dependencies</h3>
      {plan.tasks.map((task) => (
        <div className="fx-plan-pane-task" key={task.id}>
          <strong>{task.title}</strong>
          <p>
            {task.dependencies.length
              ? `After ${task.dependencies
                  .map(
                    (dependency) =>
                      plan.tasks.find(
                        (candidate) => candidate.id === dependency,
                      )?.title,
                  )
                  .filter(Boolean)
                  .join(", ")}`
              : "Can run independently"}
          </p>
        </div>
      ))}
    </article>
  );
}

export function StatusLabel({ status }: { status: FactoryRunStatus }) {
  const presentation = factoryStatusPresentation(status);
  const Icon =
    status === "done"
      ? Check
      : status === "waiting" || status === "queued"
        ? Clock3
        : status === "error" || status === "blocked"
          ? CircleAlert
          : null;
  return (
    <span className={`fx-status fx-${presentation.tone}`}>
      <i />
      {Icon ? <Icon aria-hidden="true" /> : null}
      {presentation.label}
    </span>
  );
}

export function eventText(payload: unknown) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (typeof value.message === "string") return value.message;
  }
  return "";
}

export function runTitle(
  run: FactoryRun,
  snapshot: { events: Array<{ kind: string; payload: unknown }> } | undefined,
  fallback?: string,
) {
  const initialPrompt = snapshot?.events.find(
    (event) => event.kind === "user_prompt",
  );
  const promptText = initialPrompt ? eventText(initialPrompt.payload) : "";
  const firstLine = promptText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^Task:\s*/iu, "");
  return firstLine || fallback || run.harnessId;
}
