import * as React from "react";
import { X } from "lucide-react";

import type { Project } from "@/features/projects/hooks";
import type { FactoryRun } from "@/shared/api/factoryRuntime";
import type { ManagedAgent } from "@/shared/api/types";
import type { DeskTab, FactoryPlan } from "./factoryTypes";

export function SessionActionsDialog({
  title,
  projectName,
  status,
  canStop,
  onStop,
  onClose,
}: {
  title: string;
  projectName: string;
  status: React.ReactNode;
  canStop: boolean;
  onStop: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="fx-menu-summary">
        <span className="fx-project-chip">{projectName}</span>
        {status}
      </div>
      {canStop ? (
        <div className="fx-menu-actions">
          <button
            className="fx-button fx-button-small fx-danger"
            onClick={onStop}
            type="button"
          >
            Stop session
          </button>
        </div>
      ) : null}
      <p className="fx-field-note">
        Stopping interrupts its work and retains its history.
      </p>
    </Modal>
  );
}

export function NameDialog({
  title,
  label,
  action,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  action: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = React.useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value);
        }}
      >
        <label>
          {label}
          <input
            onChange={(event) => setValue(event.currentTarget.value)}
            value={value}
          />
        </label>
        <div className="fx-modal-actions">
          <button className="fx-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="fx-button fx-button-primary"
            disabled={!value.trim()}
            type="submit"
          >
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function StartRunDialog({
  projects,
  localRepositories,
  agents,
  runs,
  tabs,
  activeTabId,
  busy,
  error,
  onClose,
  onStart,
}: {
  projects: Project[];
  localRepositories: Array<{ name: string; path: string }>;
  agents: ManagedAgent[];
  runs: FactoryRun[];
  tabs: DeskTab[];
  activeTabId: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onStart: (input: {
    projectId: string;
    repositoryId: string;
    checkoutPath: string;
    agentId: string;
    parentRunId: string;
    prompt: string;
    tabId: string;
  }) => void;
}) {
  const [projectId, setProjectId] = React.useState("");
  const [agentId, setAgentId] = React.useState("");
  const [parentRunId, setParentRunId] = React.useState("");
  const [task, setTask] = React.useState("");
  const [direction, setDirection] = React.useState("");
  const [tabId, setTabId] = React.useState(activeTabId);
  const project = projects.find(
    (item) => item.projectAddress === projectId || item.id === projectId,
  );
  const selectedRepository =
    project?.repositories.find(
      (repo) => repo.repoAddress === project.primaryRepositoryAddress,
    ) ??
    (project?.repositories.length === 1 ? project.repositories[0] : undefined);
  const matchingCheckouts = selectedRepository
    ? localRepositories.filter(
        (item) =>
          item.name.toLowerCase() === selectedRepository.name.toLowerCase(),
      )
    : [];
  const checkoutPath =
    matchingCheckouts.length === 1 ? matchingCheckouts[0].path : "";
  const selectedAgent = agents.find((agent) => agent.pubkey === agentId);
  const canStart = Boolean(
    project &&
      selectedRepository &&
      checkoutPath &&
      agentId &&
      direction.trim() &&
      !busy,
  );
  return (
    <Modal title="Start a session" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canStart || !project || !selectedRepository) return;
          onStart({
            projectId: project.projectAddress,
            repositoryId: selectedRepository.repoAddress,
            checkoutPath,
            agentId,
            parentRunId,
            prompt: task.trim()
              ? `Task: ${task.trim()}\n\nStarting direction:\n${direction.trim()}`
              : direction.trim(),
            tabId,
          });
        }}
      >
        <label>
          Task
          <input
            onChange={(event) => setTask(event.currentTarget.value)}
            value={task}
          />
        </label>
        <div className="fx-form-row">
          <label>
            Project
            <select
              onChange={(event) => setProjectId(event.currentTarget.value)}
              value={projectId}
            >
              <option value="">Select a project</option>
              {projects.map((item) => (
                <option key={item.id} value={item.projectAddress}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Open in tab
            <select
              onChange={(event) => setTabId(event.currentTarget.value)}
              value={tabId}
            >
              {tabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Harness
          <select
            disabled={!agents.length}
            onChange={(event) => setAgentId(event.currentTarget.value)}
            value={agentId}
          >
            <option value="">Select a local agent</option>
            {agents.map((agent) => (
              <option key={agent.pubkey} value={agent.pubkey}>
                {agent.name} · {agent.runtime ?? "Default harness"}
              </option>
            ))}
          </select>
        </label>
        <div className="fx-form-row">
          <label>
            Provider
            <input
              readOnly
              value={selectedAgent?.provider ?? "Not configured"}
            />
          </label>
          <label>
            Model
            <input readOnly value={selectedAgent?.model ?? "Not configured"} />
          </label>
        </div>
        <label>
          Parent session
          <select
            onChange={(event) => setParentRunId(event.currentTarget.value)}
            value={parentRunId}
          >
            <option value="">No parent session</option>
            {runs
              .filter(
                (run) => run.status === "running" || run.status === "waiting",
              )
              .map((run) => (
                <option key={run.id} value={run.id}>
                  {agents.find((agent) => agent.pubkey === run.agentId)?.name ??
                    run.harnessId}
                </option>
              ))}
          </select>
        </label>
        <label>
          Starting direction
          <textarea
            onChange={(event) => setDirection(event.currentTarget.value)}
            value={direction}
          />
        </label>
        {error ? (
          <p className="fx-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="fx-modal-actions">
          <button className="fx-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="fx-button fx-button-primary"
            disabled={!canStart}
            type="submit"
          >
            {busy ? "Starting..." : "Start session"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PlanDialog({
  projects,
  plan,
  initialProjectId,
  title,
  action,
  onClose,
  onSubmit,
}: {
  projects: Project[];
  plan?: FactoryPlan;
  initialProjectId?: string;
  title: string;
  action: string;
  onClose: () => void;
  onSubmit: (input: {
    projectId: string;
    title: string;
    outcome: string;
    criteria: string[];
  }) => void;
}) {
  const [projectId, setProjectId] = React.useState(
    plan?.projectId ?? initialProjectId ?? projects[0]?.projectAddress ?? "",
  );
  const [planTitle, setPlanTitle] = React.useState(plan?.title ?? "");
  const [outcome, setOutcome] = React.useState(plan?.outcome ?? "");
  const [criteria, setCriteria] = React.useState(
    plan?.acceptanceCriteria.join("\n") ?? "",
  );
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!projectId || !planTitle.trim() || !outcome.trim()) return;
          onSubmit({
            projectId,
            title: planTitle.trim(),
            outcome: outcome.trim(),
            criteria: criteria
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          });
        }}
      >
        <label>
          Project
          <select
            onChange={(event) => setProjectId(event.currentTarget.value)}
            value={projectId}
          >
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.projectAddress}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Plan name
          <input
            onChange={(event) => setPlanTitle(event.currentTarget.value)}
            value={planTitle}
          />
        </label>
        <label>
          Outcome
          <textarea
            onChange={(event) => setOutcome(event.currentTarget.value)}
            value={outcome}
          />
        </label>
        <label>
          Acceptance criteria · one per line
          <textarea
            onChange={(event) => setCriteria(event.currentTarget.value)}
            value={criteria}
          />
        </label>
        <div className="fx-modal-actions">
          <button className="fx-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="fx-button fx-button-primary"
            disabled={!projectId || !planTitle.trim() || !outcome.trim()}
            type="submit"
          >
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function TaskDialog({
  plan,
  onClose,
  onSubmit,
}: {
  plan: FactoryPlan;
  onClose: () => void;
  onSubmit: (title: string, dependencies: string[]) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [dependency, setDependency] = React.useState("");
  return (
    <Modal title="Add a task" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim())
            onSubmit(title.trim(), dependency ? [dependency] : []);
        }}
      >
        <label>
          Task outcome
          <input
            onChange={(event) => setTitle(event.currentTarget.value)}
            value={title}
          />
        </label>
        <label>
          Starts after
          <select
            onChange={(event) => setDependency(event.currentTarget.value)}
            value={dependency}
          >
            <option value="">No dependency</option>
            {plan.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
        <div className="fx-modal-actions">
          <button className="fx-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="fx-button fx-button-primary"
            disabled={!title.trim()}
            type="submit"
          >
            Add task
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className="fx-modal-scrim">
      <section
        aria-labelledby="factory-modal-title"
        aria-modal="true"
        className="fx-modal"
        role="dialog"
      >
        <header>
          <h2 id="factory-modal-title">{title}</h2>
          <button
            aria-label="Close"
            className="fx-icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
