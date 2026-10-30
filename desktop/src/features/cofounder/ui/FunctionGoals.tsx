import { useState, type FormEvent } from "react";

import type {
  ApprovedFunctionGoal,
  FunctionGoalsFixture,
  ProposedFunctionGoal,
} from "../cofounderNumbers";
import type { FunctionId } from "../cofounderRecords";

function progressPercent(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, (current / target) * 100));
}

function ApprovedGoal({ goal }: { goal: ApprovedFunctionGoal }) {
  const progressLabel = `${goal.current} of ${goal.target}`;
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-sm font-bold">{goal.title}</span>
        <span className="text-sm font-extrabold">{progressLabel}</span>
      </div>
      <div
        aria-label={`${goal.title}: ${progressLabel}`}
        aria-valuemax={goal.target}
        aria-valuemin={0}
        aria-valuenow={goal.current}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${progressPercent(goal.current, goal.target)}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Owned by {goal.owner} · approved by {goal.approvedBy} on{" "}
        {goal.approvedOn}
      </p>
    </li>
  );
}

function ProposedGoal({
  canApprove,
  goal,
  onApprove,
  onEdit,
  onReject,
}: {
  canApprove: boolean;
  goal: ProposedFunctionGoal;
  onApprove: (goal: ProposedFunctionGoal) => void;
  onEdit: (goal: ProposedFunctionGoal) => void;
  onReject: (goal: ProposedFunctionGoal) => void;
}) {
  return (
    <article
      aria-labelledby={`goal-proposal-title-${goal.id}`}
      className="rounded-xl border border-border bg-muted/40 p-4"
      data-testid={`cofounder-goal-proposal-${goal.id}`}
    >
      <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        Scout proposed
      </p>
      <h3
        className="mt-2 text-sm font-extrabold"
        id={`goal-proposal-title-${goal.id}`}
      >
        {goal.title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Owned by {goal.owner} · target {goal.target}
      </p>
      {canApprove ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => onApprove(goal)}
            type="button"
          >
            Approve goal
          </button>
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => onEdit(goal)}
            type="button"
          >
            Edit goal
          </button>
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-destructive hover:bg-destructive/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => onReject(goal)}
            type="button"
          >
            Reject goal
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Waiting for the owner to review this goal.
        </p>
      )}
    </article>
  );
}

export function FunctionGoals({
  canApprove,
  fixtureAvailable,
  functionId,
  goals,
}: {
  canApprove: boolean;
  fixtureAvailable: boolean;
  functionId: FunctionId;
  goals: FunctionGoalsFixture | undefined;
}) {
  const [approved, setApproved] = useState(goals?.approved ?? []);
  const [proposed, setProposed] = useState(goals?.proposed ?? []);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTarget, setDraftTarget] = useState("1");
  const [feedback, setFeedback] = useState("");

  function requestGoalProposal() {
    const suggestion = goals?.suggested;
    if (!fixtureAvailable || !canApprove || !suggestion) return;
    setProposed((current) =>
      current.some((goal) => goal.id === suggestion.id)
        ? current
        : [...current, suggestion],
    );
    setFeedback("");
  }

  function beginEdit(goal: ProposedFunctionGoal) {
    setEditingGoalId(goal.id);
    setDraftTitle(goal.title);
    setDraftTarget(String(goal.target));
    setFeedback("");
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draftTitle.trim();
    const target = Number(draftTarget);
    if (!editingGoalId || !title || !Number.isFinite(target) || target < 1) {
      setFeedback("Enter a goal and a target greater than zero.");
      return;
    }
    setProposed((current) =>
      current.map((goal) =>
        goal.id === editingGoalId ? { ...goal, title, target } : goal,
      ),
    );
    setEditingGoalId(null);
    setFeedback("Goal proposal updated.");
  }

  function approveGoal(goal: ProposedFunctionGoal) {
    if (!canApprove) return;
    setProposed((current) => current.filter((item) => item.id !== goal.id));
    setApproved((current) => [
      {
        ...goal,
        approvedBy: "you",
        approvedOn: "30 Oct",
      },
      ...current,
    ]);
    setFeedback("Goal approved.");
  }

  function rejectGoal(goal: ProposedFunctionGoal) {
    if (!canApprove) return;
    setProposed((current) => current.filter((item) => item.id !== goal.id));
    setFeedback("Goal proposal rejected.");
  }

  return (
    <section
      aria-labelledby={`function-goals-title-${functionId}`}
      className="team-card space-y-4 p-5 sm:p-6"
      data-testid="cofounder-goals"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2
          className="text-base font-extrabold"
          id={`function-goals-title-${functionId}`}
        >
          Goals
        </h2>
        <button
          className="ml-auto rounded-xl bg-muted px-4 py-2 text-sm font-bold hover:bg-muted/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          data-testid="cofounder-propose-goal"
          disabled={
            !fixtureAvailable ||
            !canApprove ||
            !goals?.suggested ||
            proposed.some((goal) => goal.id === goals?.suggested?.id)
          }
          onClick={requestGoalProposal}
          type="button"
        >
          Propose a goal
        </button>
      </div>

      {approved.length > 0 ? (
        <ul aria-label="Approved goals" className="space-y-4">
          {approved.map((goal) => (
            <ApprovedGoal goal={goal} key={goal.id} />
          ))}
        </ul>
      ) : null}

      {proposed.length > 0 ? (
        <ul aria-label="Goal proposals" className="space-y-3">
          {proposed.map((goal) => (
            <li className="list-none" key={goal.id}>
              {editingGoalId === goal.id ? (
                <form
                  aria-labelledby={`goal-edit-title-${goal.id}`}
                  className="space-y-3 rounded-xl border border-border p-4"
                  onSubmit={saveEdit}
                >
                  <h3
                    className="text-sm font-extrabold"
                    id={`goal-edit-title-${goal.id}`}
                  >
                    Edit proposed goal
                  </h3>
                  <div className="space-y-1">
                    <label
                      className="text-sm font-semibold"
                      htmlFor={`goal-title-${functionId}`}
                    >
                      Goal
                    </label>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      id={`goal-title-${functionId}`}
                      onChange={(event) =>
                        setDraftTitle(event.currentTarget.value)
                      }
                      value={draftTitle}
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      className="text-sm font-semibold"
                      htmlFor={`goal-target-${functionId}`}
                    >
                      Target
                    </label>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      id={`goal-target-${functionId}`}
                      min={1}
                      onChange={(event) =>
                        setDraftTarget(event.currentTarget.value)
                      }
                      type="number"
                      value={draftTarget}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      type="submit"
                    >
                      Save changes
                    </button>
                    <button
                      className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={() => setEditingGoalId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <ProposedGoal
                  canApprove={canApprove}
                  goal={goal}
                  onApprove={approveGoal}
                  onEdit={beginEdit}
                  onReject={rejectGoal}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {!fixtureAvailable ? (
        <p className="text-sm text-muted-foreground">
          Goal records will appear when scorecard tracking is connected.
        </p>
      ) : approved.length === 0 && proposed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No goals yet.</p>
      ) : null}

      {feedback ? (
        <p
          aria-live="polite"
          className="text-sm text-muted-foreground"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
