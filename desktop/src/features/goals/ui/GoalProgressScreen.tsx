import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { canEditGoal, type GoalStatus } from "../goalModels";
import { useGoalActionMutation, useGoalHeadQuery } from "../goalRelay";
import { GoalRouteBackLink, GoalRouteHeader } from "./GoalRouteHeader";

type EditableGoalStatus = "active" | "off_pace" | "achieved";

function isEditableStatus(status: GoalStatus): status is EditableGoalStatus {
  return status === "active" || status === "off_pace" || status === "achieved";
}

export function GoalProgressScreen({ goalId }: { goalId: string }) {
  const goalQuery = useGoalHeadQuery(goalId);
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const mutation = useGoalActionMutation();
  const { goGoal, goGoals } = useAppNavigation();
  const record = goalQuery.data;
  const head = record?.head;
  const goal = head?.goal;
  const currentPubkey = identityQuery.data?.pubkey ?? "";
  const role = membershipQuery.data?.role;
  const canSave = Boolean(head && canEditGoal(role, currentPubkey, head));
  const [current, setCurrent] = React.useState("");
  const [status, setStatus] = React.useState<EditableGoalStatus>("active");
  const [evidence, setEvidence] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isDirty, setIsDirty] = React.useState(false);
  const initializedEventRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!record || isDirty || initializedEventRef.current === record.event.id) {
      return;
    }
    initializedEventRef.current = record.event.id;
    setCurrent(record.head.progress?.current ?? "");
    setStatus(
      isEditableStatus(record.head.status) ? record.head.status : "active",
    );
  }, [isDirty, record]);

  const updateField = (update: () => void) => {
    setIsDirty(true);
    setFormError(null);
    mutation.reset();
    update();
  };

  const onCancel = () => {
    if (goalId) void goGoal(goalId);
    else void goGoals();
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!record || !goal || !canSave || mutation.isPending) return;
    if (!evidence.trim()) {
      setFormError("Add evidence for this progress update.");
      return;
    }
    if (goal.target && !current.trim()) {
      setFormError("Add the current value for this goal.");
      return;
    }

    setFormError(null);
    try {
      await mutation.mutateAsync({
        action: {
          schemaVersion: 1,
          goalId,
          action: "progress",
          expectedHeadEventId: record.event.id,
          progress: {
            ...(goal.target ? { current: current.trim() } : {}),
            evidence: evidence.trim(),
            evidenceRefs: [],
          },
          status,
        },
      });
      await goGoal(goalId);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Progress could not be saved.",
      );
    }
  };

  if (
    goalQuery.isPending ||
    identityQuery.isPending ||
    membershipQuery.isPending
  ) {
    return (
      <>
        <GoalRouteHeader title="Update progress" />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading progress form
        </div>
      </>
    );
  }

  if (goalQuery.isError || identityQuery.isError || membershipQuery.isError) {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal unavailable
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            Goal details, identity or permissions could not be loaded.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {goalQuery.isError ? (
              <Button
                onClick={() => void goalQuery.refetch()}
                variant="outline"
              >
                Try loading goal again
              </Button>
            ) : null}
            {identityQuery.isError ? (
              <Button
                onClick={() => void identityQuery.refetch()}
                variant="outline"
              >
                Try loading identity again
              </Button>
            ) : null}
            {membershipQuery.isError ? (
              <Button
                onClick={() => void membershipQuery.refetch()}
                variant="outline"
              >
                Try loading permissions again
              </Button>
            ) : null}
            <Button onClick={onCancel} variant="ghost">
              Back to goal
            </Button>
          </div>
        </section>
      </>
    );
  }

  if (!record || !goal || head?.status === "deleted") {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal unavailable
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            This goal is unavailable.
          </p>
          <Button className="mt-5" onClick={onCancel}>
            Back to goal
          </Button>
        </section>
      </>
    );
  }

  if (head.status === "archived") {
    return (
      <>
        <GoalRouteHeader title="Goal permissions" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal permissions
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            This goal is archived. Restore it before recording progress.
          </p>
          <Button className="mt-5" onClick={onCancel}>
            Back to goal
          </Button>
        </section>
      </>
    );
  }

  if (!canSave) {
    return (
      <>
        <GoalRouteHeader title="Goal permissions" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal permissions
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            Only the goal owner, the community owner, or an admin can record
            progress.
          </p>
          <Button className="mt-5" onClick={onCancel}>
            Back to goal
          </Button>
        </section>
      </>
    );
  }

  return (
    <>
      <GoalRouteHeader title="Update progress" />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="goal-progress-screen"
      >
        <GoalRouteBackLink onClick={onCancel} />
        <h1 className="text-2xl font-bold tracking-tight">Update progress</h1>
        <form
          className="mt-6 max-w-[740px]"
          onSubmit={(event) => void onSubmit(event)}
        >
          <h2 className="mb-5 text-base font-semibold">{head.title}</h2>
          {goal.target ? (
            <label
              className="mb-5 flex flex-col gap-2 text-xs font-semibold"
              htmlFor="goal-progress-current"
            >
              Current value
              <Input
                autoFocus
                className="rounded-md text-sm"
                id="goal-progress-current"
                inputMode="decimal"
                min="0"
                onChange={(event) =>
                  updateField(() => setCurrent(event.currentTarget.value))
                }
                required
                step="any"
                type="number"
                value={current}
              />
            </label>
          ) : null}
          <label
            className="mb-5 flex flex-col gap-2 text-xs font-semibold"
            htmlFor="goal-progress-status"
          >
            Status
            <select
              className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              id="goal-progress-status"
              onChange={(event) =>
                updateField(() =>
                  setStatus(event.currentTarget.value as EditableGoalStatus),
                )
              }
              value={status}
            >
              <option value="active">active</option>
              <option value="off_pace">off pace</option>
              <option value="achieved">achieved</option>
            </select>
          </label>
          <label
            className="mb-5 flex flex-col gap-2 text-xs font-semibold"
            htmlFor="goal-progress-evidence"
          >
            Evidence or update
            <textarea
              className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal leading-6"
              id="goal-progress-evidence"
              maxLength={2000}
              onChange={(event) =>
                updateField(() => setEvidence(event.currentTarget.value))
              }
              placeholder="Explain progress. To mark achieved, describe how the done condition was met."
              required
              value={evidence}
            />
          </label>
          <div className="border-l-2 border-border bg-muted/50 p-4">
            <strong className="text-sm">Done condition</strong>
            <p className="mt-1 text-sm leading-6">{goal.doneCondition}</p>
          </div>
          {formError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          {mutation.isError && !formError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
            <Button
              className="bg-[#637fb1] text-white hover:bg-[#536d9c] dark:bg-[#8aa6d8] dark:text-[#282532] dark:hover:bg-[#7795c9]"
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? "Recording update" : "Record update"}
            </Button>
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </main>
    </>
  );
}
