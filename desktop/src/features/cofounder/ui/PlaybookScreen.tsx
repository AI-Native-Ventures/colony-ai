import { useState } from "react";

import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

import type {
  PlaybookChangeModel,
  PlaybookJobModel,
  PlaybookJobStepModel,
  PlaybookScreenModel,
  PlaybookStepModel,
  PlaybookVersionModel,
} from "../playbookModels";
import { TeamPage, TeamPageTitle } from "../../company-team/ui/TeamPage";
import "./playbook.css";

function StepDetails({
  hidden = false,
  id,
  step,
}: {
  hidden?: boolean;
  id?: string;
  step: PlaybookStepModel;
}) {
  return (
    <div className="cf3-step-details" hidden={hidden} id={id}>
      {step.detail ? <p>{step.detail}</p> : null}
      {step.inputs.length > 0 ? (
        <p>
          <strong>In:</strong> {step.inputs.join(", ")}
        </p>
      ) : null}
      {step.outputs.length > 0 ? (
        <p>
          <strong>Out:</strong> {step.outputs.join(", ")}
        </p>
      ) : null}
      {step.tools.length > 0 ? (
        <p>
          <strong>Tools:</strong> {step.tools.join(", ")}
        </p>
      ) : null}
      {step.approvalPrompt ? (
        <p className="cf3-approval-prompt">
          <strong>Your OK:</strong> {step.approvalPrompt}
        </p>
      ) : null}
    </div>
  );
}

function StepOwner({ step }: { step: PlaybookStepModel }) {
  const initials = step.owner.label
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  return (
    <span className="cf3-owner-label">
      <span
        aria-hidden="true"
        className={`cf3-owner-avatar is-${step.owner.kind}`}
      >
        {step.owner.kind === "agent" || step.owner.avatarName ? (
          <EmployeeAvatar
            className="size-full rounded-lg"
            name={step.owner.avatarName ?? step.owner.label}
          />
        ) : step.owner.kind === "worker" ? (
          <svg
            aria-hidden="true"
            fill="none"
            height="1rem"
            viewBox="0 0 24 24"
            width="1rem"
          >
            <path
              d="m8 8 4-3 4 3v8l-4 3-4-3V8Z"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
            <path
              d="m8 8 4 3 4-3M12 11v8"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        ) : step.owner.kind === "owner" ? (
          "BP"
        ) : (
          initials
        )}
      </span>
      {step.owner.label}
    </span>
  );
}

function FlowStep({ index, step }: { index: number; step: PlaybookStepModel }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = `playbook-step-detail-${step.id}`;
  const ownerPrompt =
    step.owner.kind === "owner" ? (step.approvalPrompt ?? step.detail) : null;
  return (
    <li className="cf3-flow-step" data-testid={`playbook-step-${step.id}`}>
      <span
        aria-hidden="true"
        className={`cf3-step-number${step.isApprovalPoint ? " is-approval" : ""}${step.owner.kind === "owner" ? " is-owner" : ""}`}
      >
        {index + 1}
      </span>
      <article className="cf3-step-card">
        <div className="cf3-step-heading">
          <button
            aria-controls={detailId}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${step.title}`}
            className="cf3-step-toggle"
            data-testid={`playbook-step-toggle-${step.id}`}
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {step.title}
          </button>
          <StepOwner step={step} />
        </div>
        <div className="cf3-step-summary">
          <span>
            {step.inputs.length > 0 ? `In: ${step.inputs.join(", ")}` : null}
            {step.outputs.length > 0
              ? `${step.inputs.length > 0 ? ". " : ""}Out: ${step.outputs.join(", ")}`
              : null}
            {step.inputs.length === 0 &&
            step.outputs.length === 0 &&
            !(step.owner.kind === "owner" && !step.isApprovalPoint)
              ? step.detail
              : null}
          </span>
          <span>
            Tools: {step.tools.length > 0 ? step.tools.join(", ") : "None"}
          </span>
        </div>
        {step.approvalPrompt || ownerPrompt ? (
          <p className="cf3-step-approval">
            <span>Your OK</span>
            {step.approvalPrompt ?? ownerPrompt}
          </p>
        ) : null}
        <StepDetails hidden={!expanded} id={detailId} step={step} />
      </article>
    </li>
  );
}

function jobCurrentStep(job: PlaybookJobModel): PlaybookJobStepModel | null {
  return job.steps.find((step) => step.id === job.currentStepId) ?? null;
}

function stepNeedsOwnerApproval(step: PlaybookJobStepModel): boolean {
  return (
    step.isApprovalPoint &&
    (step.status === "waiting_approval" ||
      (step.status === "pending" && step.owner.kind === "owner"))
  );
}

function JobDetailDialog({
  canApprove,
  job,
  onApproveStep,
  onClose,
  onStartStep,
  onMarkStepDone,
}: {
  canApprove: boolean;
  job: PlaybookJobModel | null;
  onApproveStep: (jobId: string, stepId: string) => Promise<void>;
  onClose: () => void;
  onStartStep: (jobId: string, stepId: string) => Promise<void>;
  onMarkStepDone: (jobId: string, stepId: string) => Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentStep = job ? jobCurrentStep(job) : null;

  async function runAction(
    action: "approve" | "start" | "complete",
    stepId: string,
  ) {
    if (!job || pendingAction) return;
    setPendingAction(action);
    setError(null);
    try {
      if (action === "approve") await onApproveStep(job.id, stepId);
      else if (action === "start") await onStartStep(job.id, stepId);
      else await onMarkStepDone(job.id, stepId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The job step could not be updated. Try again.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={Boolean(job)}
    >
      <DialogContent
        className="cf3-job-dialog"
        data-testid="playbook-job-detail"
        showCloseButton
      >
        {job ? (
          <>
            <div className="cf3-dialog-heading">
              <DialogTitle>{job.clientName}</DialogTitle>
              <DialogDescription>
                Copy of version {job.version} of the delivery playbook, started{" "}
                {job.startedAtLabel}.
              </DialogDescription>
              <p
                aria-live="polite"
                className="cf3-job-live-status"
                role="status"
              >
                {job.status === "running"
                  ? "Current step: "
                  : `Job ${job.status}. Current step: `}
                {currentStep?.title ?? "Complete"}
                {currentStep && stepNeedsOwnerApproval(currentStep)
                  ? ". Needs your approval."
                  : "."}
              </p>
            </div>
            <ol
              aria-label={`${job.clientName} job steps`}
              className="cf3-job-steps"
            >
              {job.steps.map((step, index) => {
                const isCurrent = step.id === job.currentStepId;
                return (
                  <li
                    className={`cf3-job-step${isCurrent ? " is-current" : ""}`}
                    data-status={step.status}
                    key={step.id}
                  >
                    <span aria-hidden="true" className="cf3-job-step-state">
                      {index + 1}
                    </span>
                    <div className="cf3-job-step-copy">
                      <div className="cf3-step-heading">
                        <strong>{step.title}</strong>
                        <span className="cf3-job-step-status">
                          {isCurrent
                            ? step.status === "waiting_approval"
                              ? "Needs you"
                              : stepNeedsOwnerApproval(step)
                                ? "Needs you"
                                : "Current step"
                            : step.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p>{step.owner.label}</p>
                      <StepDetails step={step} />
                      {isCurrent &&
                      stepNeedsOwnerApproval(step) &&
                      canApprove ? (
                        <button
                          aria-label={`Approve ${step.title} for ${job.clientName}`}
                          className="cf3-action-primary"
                          data-testid="playbook-job-approve-step"
                          disabled={pendingAction !== null}
                          onClick={() => void runAction("approve", step.id)}
                          type="button"
                        >
                          {pendingAction === "approve"
                            ? "Approving…"
                            : "Approve step"}
                        </button>
                      ) : null}
                      {isCurrent &&
                      (step.status === "approved" ||
                        step.status === "blocked") &&
                      canApprove ? (
                        <button
                          aria-label={`Start ${step.title} for ${job.clientName}`}
                          className="cf3-action-primary"
                          data-testid="playbook-job-start-step"
                          disabled={pendingAction !== null}
                          onClick={() => void runAction("start", step.id)}
                          type="button"
                        >
                          {pendingAction === "start"
                            ? "Starting…"
                            : "Start step"}
                        </button>
                      ) : null}
                      {isCurrent &&
                      (step.status === "in_progress" ||
                        (step.status === "pending" &&
                          step.owner.kind === "owner" &&
                          !step.isApprovalPoint)) &&
                      canApprove ? (
                        <button
                          aria-label={`Mark ${step.title} complete for ${job.clientName}`}
                          className="cf3-action-primary"
                          data-testid="playbook-job-complete-step"
                          disabled={pendingAction !== null}
                          onClick={() => void runAction("complete", step.id)}
                          type="button"
                        >
                          {pendingAction === "complete"
                            ? "Saving…"
                            : "Mark step complete"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            {error ? (
              <p className="cf3-error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function JobList({
  jobs,
  onOpen,
}: {
  jobs: readonly PlaybookJobModel[];
  onOpen: (jobId: string) => void;
}) {
  const runningJobs = jobs.filter((job) => job.status === "running");
  return (
    <section aria-labelledby="playbook-jobs-title" className="cf3-side-card">
      <div className="cf3-side-heading">
        <h2 id="playbook-jobs-title">Jobs on this playbook</h2>
        <p>One running copy per client</p>
      </div>
      {runningJobs.length > 0 ? (
        <ul className="cf3-job-list">
          {runningJobs.map((job) => {
            const currentStep = jobCurrentStep(job);
            const currentIndex = job.steps.findIndex(
              (step) => step.id === job.currentStepId,
            );
            const stepNumber = currentIndex < 0 ? 0 : currentIndex + 1;
            return (
              <li key={job.id}>
                <button
                  aria-label={`Open ${job.clientName}, step ${stepNumber} of ${job.steps.length}, ${currentStep?.title ?? "No current step"}`}
                  className="cf3-job-row"
                  data-testid={`playbook-job-${job.id}`}
                  onClick={() => onOpen(job.id)}
                  type="button"
                >
                  <span className="cf3-job-client">
                    <strong>{job.clientName}</strong>
                    <span>
                      {stepNumber} of {job.steps.length}
                    </span>
                  </span>
                  <span
                    aria-label={`${stepNumber} of ${job.steps.length} steps reached`}
                    className="cf3-job-progress"
                    role="img"
                  >
                    {job.steps.map((step, index) => (
                      <span
                        aria-hidden="true"
                        className={
                          index < currentIndex
                            ? "is-done"
                            : index === currentIndex
                              ? "is-current"
                              : ""
                        }
                        key={step.id}
                      />
                    ))}
                  </span>
                  <span className="cf3-job-current">
                    {currentStep?.title ?? "No current step"}
                    {currentStep && stepNeedsOwnerApproval(currentStep) ? (
                      <span className="cf3-need-pill">Needs you</span>
                    ) : null}
                    {job.roundLabel ? (
                      <span className="cf3-round-pill">{job.roundLabel}</span>
                    ) : null}
                  </span>
                  <span className="cf3-job-started">
                    Started {job.startedAtLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="cf3-side-empty">
          No client jobs are running this playbook yet.
        </p>
      )}
    </section>
  );
}

function PendingChangeCard({
  canApprove,
  change,
  onApprove,
  onDismiss,
}: {
  canApprove: boolean;
  change: PlaybookChangeModel | null;
  onApprove: (changeId: string) => Promise<void>;
  onDismiss: (changeId: string) => Promise<void>;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!change) return null;
  const changeId = change.id;

  async function runAction(action: "approve" | "dismiss") {
    if (pendingAction) return;
    setPendingAction(action);
    setError(null);
    try {
      if (action === "approve") await onApprove(changeId);
      else await onDismiss(changeId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The playbook change was not recorded. Try again.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section
      aria-labelledby="playbook-change-title"
      className="cf3-side-card cf3-change-card"
    >
      <h2 id="playbook-change-title">Proposed change</h2>
      <p>{change.summary}</p>
      {canApprove ? (
        <div className="cf3-change-actions">
          <button
            aria-label="Approve playbook change"
            className="cf3-action-primary"
            data-testid="playbook-approve-change"
            disabled={pendingAction !== null}
            onClick={() => void runAction("approve")}
            type="button"
          >
            {pendingAction === "approve" ? "Approving…" : "Approve change"}
          </button>
          <button
            aria-label="Not now for playbook change"
            className="cf3-action-secondary"
            data-testid="playbook-dismiss-change"
            disabled={pendingAction !== null}
            onClick={() => void runAction("dismiss")}
            type="button"
          >
            {pendingAction === "dismiss" ? "Saving…" : "Not now"}
          </button>
        </div>
      ) : (
        <p className="cf3-owner-only">
          Only an owner or admin can approve this change.
        </p>
      )}
      {error ? (
        <p className="cf3-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function VersionHistory({
  versions,
}: {
  versions: readonly PlaybookVersionModel[];
}) {
  return (
    <details
      className="cf3-side-card cf3-version-history"
      data-testid="playbook-version-history"
    >
      <summary>Version history</summary>
      <ol>
        {versions.map((version) => (
          <li key={version.version}>
            <strong>Version {version.version}</strong>
            <span>{version.summary}</span>
            <small>
              Approved by {version.approvedByLabel} on {version.approvedAtLabel}
            </small>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function PlaybookScreen({
  canApprove,
  canProposeChange,
  model,
  onApproveChange,
  onApproveJobStep,
  onDismissChange,
  onStartJobStep,
  onMarkJobStepDone,
  onProposeChange,
}: {
  canApprove: boolean;
  canProposeChange: boolean;
  model: PlaybookScreenModel;
  onApproveChange: (changeId: string) => Promise<void>;
  onApproveJobStep: (jobId: string, stepId: string) => Promise<void>;
  onDismissChange: (changeId: string) => Promise<void>;
  onStartJobStep: (jobId: string, stepId: string) => Promise<void>;
  onMarkJobStepDone: (jobId: string, stepId: string) => Promise<void>;
  onProposeChange: () => void;
}) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJob =
    model.jobs.find((job) => job.id === selectedJobId) ?? null;

  return (
    <TeamPage testId="cofounder-playbook-screen" title={model.title}>
      <div className="cf3-playbook-screen">
        <header className="cf3-playbook-header">
          <div>
            <TeamPageTitle>{model.title}</TeamPageTitle>
            <p className="cf3-playbook-summary">{model.summary}</p>
          </div>
          <button
            className="cf3-action-secondary cf3-propose-button"
            data-testid="playbook-propose-change"
            disabled={!canProposeChange}
            onClick={onProposeChange}
            type="button"
          >
            Propose a change
          </button>
          <div className="cf3-playbook-meta">
            <span>Version {model.version}</span>
            <span>
              {model.steps.filter((step) => step.isApprovalPoint).length}{" "}
              approval points
            </span>
            {model.version > 0 ? (
              <span>
                Last change approved by {model.lastApprovedByLabel} on{" "}
                {model.lastApprovedAtLabel}
              </span>
            ) : (
              <span>Awaiting first approval</span>
            )}
          </div>
        </header>

        <div className="cf3-playbook-layout">
          <ol aria-label="Delivery playbook steps" className="cf3-flow-list">
            {model.steps.map((step, index) => (
              <FlowStep index={index} key={step.id} step={step} />
            ))}
          </ol>
          <aside
            aria-label="Playbook jobs and approvals"
            className="cf3-playbook-aside"
          >
            <JobList
              jobs={model.jobs}
              onOpen={(jobId) => setSelectedJobId(jobId)}
            />
            <PendingChangeCard
              canApprove={canApprove}
              change={model.pendingChange}
              onApprove={onApproveChange}
              onDismiss={onDismissChange}
            />
            <VersionHistory versions={model.versions} />
          </aside>
        </div>
        <JobDetailDialog
          canApprove={canApprove}
          job={selectedJob}
          onApproveStep={onApproveJobStep}
          onClose={() => setSelectedJobId(null)}
          onStartStep={onStartJobStep}
          onMarkStepDone={onMarkJobStepDone}
        />
      </div>
    </TeamPage>
  );
}
