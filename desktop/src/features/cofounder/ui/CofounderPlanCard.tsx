import { useEffect, useRef, useState } from "react";

import type { CofounderPlan } from "../cofounderPhase2Model";
import "./cofounderPhase2.css";

const STEP_STATUS_LABELS: Record<
  CofounderPlan["steps"][number]["status"],
  string
> = {
  planned: "Planned",
  approved: "Approved",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  blocked: "Blocked",
  skipped: "Skipped",
  failed: "Failed",
};

type CardCallback = (planId: string) => void | Promise<void>;
type EditCallback = (
  planId: string,
  changes: { title: string },
) => void | Promise<void>;

export function CofounderPlanCard({
  plan,
  onApprove,
  onEdit,
  onReject,
}: {
  plan: CofounderPlan;
  onApprove: CardCallback;
  onEdit: EditCallback;
  onReject: CardCallback;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(plan.title);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const pending = plan.status === "proposed";
  const statusLabel =
    plan.status === "in_progress"
      ? "In progress"
      : plan.status.charAt(0).toUpperCase() + plan.status.slice(1);

  useEffect(() => {
    if (editing) titleInputRef.current?.focus();
  }, [editing]);

  async function runAction(name: string, action: () => void | Promise<void>) {
    setPendingAction(name);
    setActionError(null);
    try {
      await action();
      if (name === "edit") setEditing(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not update this plan.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  function saveEdit() {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    void runAction("edit", () => onEdit(plan.id, { title: nextTitle }));
  }

  return (
    <article
      aria-label={`Plan: ${plan.title}`}
      className="cf2-card cf2-plan-card"
      data-plan-id={plan.id}
      data-testid={`cofounder-plan-${plan.id}`}
    >
      <div className="cf2-card-head">
        <div className="cf2-chip-row">
          {pending ? (
            <span className="cf2-chip cf2-chip-warm">Needs you</span>
          ) : null}
          <span className="cf2-chip">Plan</span>
          <span className="cf2-muted">{plan.functionName}</span>
          {pending ? (
            plan.decideBy ? (
              <span className="cf2-muted">Decide by {plan.decideBy}</span>
            ) : null
          ) : (
            <span aria-live="polite" className="cf2-chip cf2-chip-status">
              {statusLabel}
            </span>
          )}
        </div>
        {editing ? (
          <label className="cf2-edit-field">
            Plan title
            <input
              ref={titleInputRef}
              data-testid={`cofounder-plan-title-${plan.id}`}
              onChange={(event) => setTitle(event.currentTarget.value)}
              value={title}
            />
          </label>
        ) : (
          <h2>{plan.title}</h2>
        )}
        {plan.summary ? (
          <p className="cf2-plan-summary">{plan.summary}</p>
        ) : null}
      </div>

      <div className="cf2-plan-table-wrap">
        <table className="cf2-plan-table">
          <thead>
            <tr>
              <th scope="col">Step and who</th>
              <th scope="col">Cost</th>
              <th scope="col">When</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {plan.steps.map((step, index) => (
              <tr key={step.id}>
                <th scope="row">
                  <span className="cf2-step-title">
                    <span aria-hidden="true" className="cf2-step-number">
                      {index + 1}
                    </span>
                    {step.title}
                  </span>
                  <span className="cf2-step-owner">{step.owner}</span>
                  <span className="cf2-step-mobile-meta">
                    {step.cost} · {step.timing} ·{" "}
                    {STEP_STATUS_LABELS[step.status]}
                  </span>
                </th>
                <td>{step.cost}</td>
                <td>{step.timing}</td>
                <td>
                  <span
                    className="cf2-step-status"
                    data-status={step.status}
                    data-testid={`cofounder-plan-step-${step.id}`}
                  >
                    {STEP_STATUS_LABELS[step.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cf2-plan-totals">
        <div>
          <span>Cost</span>
          <strong>{plan.costSummary}</strong>
        </div>
        <div>
          <span>Timing</span>
          <strong>{plan.timingSummary}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{plan.targetSummary}</strong>
        </div>
      </div>

      {pending ? (
        <div className="cf2-actions">
          {editing ? (
            <>
              <button
                className="cf2-button cf2-button-primary"
                disabled={pendingAction !== null}
                onClick={saveEdit}
                type="button"
              >
                Save changes
              </button>
              <button
                className="cf2-button"
                disabled={pendingAction !== null}
                onClick={() => {
                  setTitle(plan.title);
                  setEditing(false);
                }}
                type="button"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                aria-label={`Approve plan: ${plan.title}`}
                className="cf2-button cf2-button-primary"
                data-testid={`cofounder-plan-approve-${plan.id}`}
                disabled={pendingAction !== null}
                onClick={() =>
                  void runAction("approve", () => onApprove(plan.id))
                }
                type="button"
              >
                Approve
              </button>
              <button
                aria-label={`Edit plan: ${plan.title}`}
                className="cf2-button"
                data-testid={`cofounder-plan-edit-${plan.id}`}
                disabled={pendingAction !== null}
                onClick={() => {
                  setActionError(null);
                  setEditing(true);
                }}
                type="button"
              >
                Edit
              </button>
              <button
                aria-label={`Reject plan: ${plan.title}`}
                className="cf2-button cf2-button-danger"
                data-testid={`cofounder-plan-reject-${plan.id}`}
                disabled={pendingAction !== null}
                onClick={() =>
                  void runAction("reject", () => onReject(plan.id))
                }
                type="button"
              >
                Reject
              </button>
            </>
          )}
        </div>
      ) : null}
      {actionError ? (
        <p className="cf2-error-note" role="alert">
          {actionError}
        </p>
      ) : null}
    </article>
  );
}
