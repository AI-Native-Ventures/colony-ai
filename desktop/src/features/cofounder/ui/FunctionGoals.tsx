import { useMemo, useState, type FormEvent } from "react";

import type { FunctionId } from "../cofounderRecords";
import { numbersActions } from "../numbersActions";
import type { NumbersActionInput } from "../numbersActions";
import {
  METRIC_DETAILS,
  METRIC_IDS,
  formatMetricValue,
} from "../numbersRecords";
import type {
  GoalPeriod,
  GoalProgressView,
  GoalView,
  MetricId,
} from "../numbersRecords";
import type { useNumbersAction } from "../numbersHooks";

type ProfileLookup = Record<
  string,
  { displayName: string | null; avatarUrl?: string | null }
>;

type GoalDraft = {
  title: string;
  metric: MetricId;
  target: string;
  period: GoalPeriod;
  reason: string;
};

function initialDraft(functionId: FunctionId): GoalDraft {
  const metric = METRIC_IDS.find(
    (candidate) => METRIC_DETAILS[candidate].functionId === functionId,
  );
  if (!metric)
    throw new Error(`No goal metrics are configured for ${functionId}.`);
  return { title: "", metric, target: "1", period: "month", reason: "" };
}

function goalTargetInput(value: number, metric: MetricId): string {
  const unit = METRIC_DETAILS[metric].unit;
  return unit === "count" ? String(value) : (value / 100).toFixed(2);
}

function parseGoalTarget(value: string, metric: MetricId): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const target =
    METRIC_DETAILS[metric].unit === "count" ? parsed : Math.round(parsed * 100);
  return Number.isSafeInteger(target) && target > 0 ? target : null;
}

function actorName(
  pubkey: string | null,
  profiles: ProfileLookup,
  fallback: string,
): string {
  const displayName = pubkey
    ? profiles[pubkey.toLowerCase()]?.displayName?.trim()
    : null;
  return displayName && !/^(npub1|nprofile1|[0-9a-f]{64}$)/i.test(displayName)
    ? displayName
    : fallback;
}

function formatDate(epochSeconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(epochSeconds * 1_000));
}

function goalTarget(goal: GoalView, currency: string): string {
  const detail = METRIC_DETAILS[goal.metric];
  return `${formatMetricValue(goal.target, detail.unit, currency) ?? goal.target} ${detail.label.toLowerCase()} per ${goal.period}`;
}

function ApprovedGoal({
  currency,
  goal,
  goalOwnerName,
  progress,
  profiles,
}: {
  currency: string;
  goal: GoalView;
  goalOwnerName: string;
  progress: GoalProgressView | undefined;
  profiles: ProfileLookup;
}) {
  const detail = METRIC_DETAILS[goal.metric];
  const current = formatMetricValue(
    progress?.current ?? null,
    detail.unit,
    currency,
  );
  const target = formatMetricValue(goal.target, detail.unit, currency);
  const progressLabel =
    current === null ? "Progress not stated" : `${current} of ${target}`;
  const percent = progress?.percent;
  return (
    <li
      className="space-y-2"
      data-testid={`cofounder-approved-goal-${goal.goalId}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 text-sm font-bold">{goal.title}</span>
        <span className="text-sm font-extrabold">{progressLabel}</span>
      </div>
      {typeof percent === "number" && current !== null ? (
        <div
          aria-label={`${goal.title}: ${progressLabel}`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.max(0, Math.min(100, percent))}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Owned by {goalOwnerName} · approved by{" "}
        {actorName(goal.decidedByPubkey, profiles, "Company owner or admin")}
        {goal.decidedAt ? ` on ${formatDate(goal.decidedAt)}` : ""}
      </p>
    </li>
  );
}

function GoalForm({
  currency,
  draft,
  functionId,
  onCancel,
  onChange,
  onSubmit,
  submitLabel,
  title,
  pending,
}: {
  currency: string;
  draft: GoalDraft;
  functionId: FunctionId;
  onCancel: () => void;
  onChange: (draft: GoalDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  title: string;
  pending: boolean;
}) {
  const metricOptions = METRIC_IDS.filter(
    (metric) => METRIC_DETAILS[metric].functionId === functionId,
  );
  const targetUnit = METRIC_DETAILS[draft.metric].unit;
  const targetLabel =
    targetUnit === "count"
      ? "Target (whole number)"
      : `Target (${targetUnit === "usd_cents" ? "USD" : currency})`;
  const prefix = title.toLowerCase().replaceAll(" ", "-");
  return (
    <form
      aria-labelledby={`${prefix}-${functionId}`}
      className="space-y-3 rounded-xl border border-border p-4"
      onSubmit={onSubmit}
    >
      <h3 className="text-sm font-extrabold" id={`${prefix}-${functionId}`}>
        {title}
      </h3>
      <div className="space-y-1">
        <label
          className="text-sm font-semibold"
          htmlFor={`${prefix}-title-${functionId}`}
        >
          Goal title
        </label>
        <input
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          id={`${prefix}-title-${functionId}`}
          maxLength={120}
          onChange={(event) =>
            onChange({ ...draft, title: event.currentTarget.value })
          }
          required
          value={draft.title}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            className="text-sm font-semibold"
            htmlFor={`${prefix}-metric-${functionId}`}
          >
            Measure
          </label>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            id={`${prefix}-metric-${functionId}`}
            onChange={(event) => {
              const metric = event.currentTarget.value as MetricId;
              onChange({
                ...draft,
                metric,
                target: goalTargetInput(
                  parseGoalTarget(draft.target, draft.metric) ?? 1,
                  metric,
                ),
              });
            }}
            value={draft.metric}
          >
            {metricOptions.map((metric) => (
              <option key={metric} value={metric}>
                {METRIC_DETAILS[metric].label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label
            className="text-sm font-semibold"
            htmlFor={`${prefix}-target-${functionId}`}
          >
            {targetLabel}
          </label>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            id={`${prefix}-target-${functionId}`}
            min={targetUnit === "count" ? "1" : "0.01"}
            onChange={(event) =>
              onChange({ ...draft, target: event.currentTarget.value })
            }
            required
            step={targetUnit === "count" ? "1" : "0.01"}
            type="number"
            value={draft.target}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label
            className="text-sm font-semibold"
            htmlFor={`${prefix}-period-${functionId}`}
          >
            Period
          </label>
          <select
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            id={`${prefix}-period-${functionId}`}
            onChange={(event) =>
              onChange({
                ...draft,
                period: event.currentTarget.value as GoalPeriod,
              })
            }
            value={draft.period}
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </div>
        <div className="space-y-1">
          <label
            className="text-sm font-semibold"
            htmlFor={`${prefix}-reason-${functionId}`}
          >
            Reason (optional)
          </label>
          <input
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            id={`${prefix}-reason-${functionId}`}
            maxLength={300}
            onChange={(event) =>
              onChange({ ...draft, reason: event.currentTarget.value })
            }
            value={draft.reason}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {submitLabel}
        </button>
        <button
          className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function messageFor(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The goal could not be saved.";
}

export function FunctionGoals({
  canApprove,
  currency,
  functionId,
  goals,
  progress,
  goalOwnerName,
  profiles,
  numbersAction,
}: {
  canApprove: boolean;
  currency: string;
  functionId: FunctionId;
  goals: GoalView[];
  progress: GoalProgressView[];
  goalOwnerName: string;
  profiles: ProfileLookup;
  numbersAction: Pick<
    ReturnType<typeof useNumbersAction>,
    "isPending" | "mutateAsync"
  >;
}) {
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalGoalId, setProposalGoalId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GoalDraft>(() => initialDraft(functionId));
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const approved = useMemo(
    () => goals.filter((goal) => goal.status === "approved"),
    [goals],
  );
  const proposed = useMemo(
    () => goals.filter((goal) => goal.status === "proposed"),
    [goals],
  );

  function beginEdit(goal: GoalView) {
    setEditingGoalId(goal.goalId);
    setShowProposalForm(false);
    setDraft({
      title: goal.title,
      metric: goal.metric,
      target: goalTargetInput(goal.target, goal.metric),
      period: goal.period,
      reason: goal.reason ?? "",
    });
    setFeedback("");
    setErrorMessage("");
  }

  async function saveGoal(
    event: FormEvent<HTMLFormElement>,
    editingGoal: GoalView | undefined,
  ) {
    event.preventDefault();
    const title = draft.title.trim();
    const target = parseGoalTarget(draft.target, draft.metric);
    if (!title || !target) {
      setErrorMessage("Enter a goal title and a valid target.");
      return;
    }
    if (!canApprove || numbersAction.isPending) return;
    setErrorMessage("");
    setFeedback("");
    const input: NumbersActionInput = editingGoal
      ? numbersActions.editGoal(editingGoal, {
          title,
          metric: draft.metric,
          target,
          period: draft.period,
          ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        })
      : {
          op: "goal_propose",
          goalId: proposalGoalId ?? crypto.randomUUID(),
          function: functionId,
          title,
          metric: draft.metric,
          target,
          period: draft.period,
          ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        };
    try {
      await numbersAction.mutateAsync(input);
      setEditingGoalId(null);
      setShowProposalForm(false);
      setProposalGoalId(null);
      setDraft(initialDraft(functionId));
      setFeedback(editingGoal ? "Goal updated." : "Goal proposed.");
    } catch (error) {
      setErrorMessage(messageFor(error));
    }
  }

  async function decideGoal(goal: GoalView, op: "approve" | "reject") {
    if (!canApprove || numbersAction.isPending) return;
    setErrorMessage("");
    setFeedback("");
    try {
      await numbersAction.mutateAsync(
        op === "approve"
          ? numbersActions.approveGoal(goal)
          : numbersActions.rejectGoal(goal),
      );
      setFeedback(
        op === "approve" ? "Goal approved." : "Goal proposal rejected.",
      );
    } catch (error) {
      setErrorMessage(messageFor(error));
    }
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
        {canApprove ? (
          <button
            className="ml-auto rounded-xl bg-muted px-4 py-2 text-sm font-bold hover:bg-muted/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
            data-testid="cofounder-propose-goal"
            disabled={numbersAction.isPending}
            onClick={() => {
              setEditingGoalId(null);
              setProposalGoalId(crypto.randomUUID());
              setDraft(initialDraft(functionId));
              setShowProposalForm((open) => !open);
              setFeedback("");
              setErrorMessage("");
            }}
            type="button"
          >
            Propose a goal
          </button>
        ) : null}
      </div>

      {approved.length > 0 ? (
        <ul aria-label="Approved goals" className="space-y-4">
          {approved.map((goal) => (
            <ApprovedGoal
              currency={currency}
              goal={goal}
              goalOwnerName={goalOwnerName}
              key={goal.goalId}
              progress={progress.find((item) => item.goalId === goal.goalId)}
              profiles={profiles}
            />
          ))}
        </ul>
      ) : null}

      {proposed.length > 0 ? (
        <ul aria-label="Goal proposals" className="space-y-3">
          {proposed.map((goal) => (
            <li className="list-none" key={goal.goalId}>
              {editingGoalId === goal.goalId ? (
                <GoalForm
                  currency={currency}
                  draft={draft}
                  functionId={functionId}
                  onCancel={() => setEditingGoalId(null)}
                  onChange={setDraft}
                  onSubmit={(event) => void saveGoal(event, goal)}
                  pending={numbersAction.isPending}
                  submitLabel="Save changes"
                  title="Edit proposed goal"
                />
              ) : (
                <article
                  aria-labelledby={`goal-proposal-title-${goal.goalId}`}
                  className="rounded-xl border border-border bg-muted/40 p-4"
                  data-testid={`cofounder-goal-proposal-${goal.goalId}`}
                >
                  <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
                    Proposed by{" "}
                    {actorName(
                      goal.proposedByPubkey,
                      profiles,
                      "Company member",
                    )}
                  </p>
                  <h3
                    className="mt-2 text-sm font-extrabold"
                    id={`goal-proposal-title-${goal.goalId}`}
                  >
                    {goal.title}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Owned by {goalOwnerName} · target{" "}
                    {goalTarget(goal, currency)}
                    {goal.reason ? ` · ${goal.reason}` : ""}
                  </p>
                  {canApprove ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
                        disabled={numbersAction.isPending}
                        onClick={() => void decideGoal(goal, "approve")}
                        type="button"
                      >
                        Approve goal
                      </button>
                      <button
                        className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
                        disabled={numbersAction.isPending}
                        onClick={() => beginEdit(goal)}
                        type="button"
                      >
                        Edit goal
                      </button>
                      <button
                        className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-destructive hover:bg-destructive/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
                        disabled={numbersAction.isPending}
                        onClick={() => void decideGoal(goal, "reject")}
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
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {showProposalForm ? (
        <GoalForm
          currency={currency}
          draft={draft}
          functionId={functionId}
          onCancel={() => setShowProposalForm(false)}
          onChange={setDraft}
          onSubmit={(event) => void saveGoal(event, undefined)}
          pending={numbersAction.isPending}
          submitLabel="Create proposal"
          title="Propose a goal"
        />
      ) : null}

      {!goals.length ? (
        <p className="text-sm text-muted-foreground">No goals yet.</p>
      ) : null}

      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
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
