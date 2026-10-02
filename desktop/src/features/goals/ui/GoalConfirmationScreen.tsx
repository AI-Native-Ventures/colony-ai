import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import {
  canEditGoal,
  canRestoreOrDeleteGoal,
  type GoalActionKind,
} from "../goalModels";
import {
  useGoalActionMutation,
  useGoalHeadQuery,
  useGoalHeadsQuery,
} from "../goalRelay";
import { GoalRouteBackLink, GoalRouteHeader } from "./GoalRouteHeader";

type GoalConfirmationAction = "archive" | "delete";

export function GoalConfirmationScreen({
  action,
  goalId,
}: {
  action: GoalConfirmationAction;
  goalId: string;
}) {
  const goalQuery = useGoalHeadQuery(goalId);
  const goalsQuery = useGoalHeadsQuery();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const mutation = useGoalActionMutation();
  const { goEditGoal, goGoal, goGoals } = useAppNavigation();
  const record = goalQuery.data;
  const head = record?.head;
  const currentPubkey = identityQuery.data?.pubkey ?? "";
  const role = membershipQuery.data?.role;
  const dependents = (goalsQuery.data ?? []).filter(
    (candidate) =>
      candidate.head.status !== "deleted" &&
      candidate.head.goal?.parentGoalId === goalId,
  );
  const isBlocked = action === "delete" && dependents.length > 0;
  const canConfirm =
    action === "archive"
      ? Boolean(
          head &&
            head.status !== "archived" &&
            canEditGoal(role, currentPubkey, head),
        )
      : canRestoreOrDeleteGoal(role);
  const heading = action === "delete" ? "Delete goal?" : "Archive goal?";

  const onCancel = () => void goGoal(goalId);

  const onConfirm = async () => {
    if (!record || !head || !canConfirm || isBlocked || mutation.isPending) {
      return;
    }
    const mutationAction: GoalActionKind = action;
    try {
      await mutation.mutateAsync({
        action: {
          schemaVersion: 1,
          goalId,
          action: mutationAction,
          expectedHeadEventId: record.event.id,
        },
      });
      if (action === "archive") await goGoal(goalId);
      else await goGoals();
    } catch {
      // React Query keeps the failure visible while the confirmation remains open.
    }
  };

  if (
    goalQuery.isPending ||
    goalsQuery.isPending ||
    identityQuery.isPending ||
    membershipQuery.isPending
  ) {
    return (
      <>
        <GoalRouteHeader title={heading} />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goal
        </div>
      </>
    );
  }

  if (
    goalQuery.isError ||
    goalsQuery.isError ||
    identityQuery.isError ||
    membershipQuery.isError
  ) {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-semibold tracking-tight">
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
            {goalsQuery.isError ? (
              <Button
                onClick={() => void goalsQuery.refetch()}
                variant="outline"
              >
                Try loading sub-goals again
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

  if (!record || !head?.goal || head.status === "deleted") {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-semibold tracking-tight">
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

  if (!canConfirm) {
    return (
      <>
        <GoalRouteHeader title="Goal permissions" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-semibold tracking-tight">
            Goal permissions
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            {action === "archive"
              ? "Only the goal owner, the community owner, or an admin can archive this goal."
              : "Only the community owner or an admin can delete this goal."}
          </p>
          <Button className="mt-5" onClick={onCancel}>
            Back to goal
          </Button>
        </section>
      </>
    );
  }

  const description =
    action === "delete"
      ? "The goal record will be removed from this review. Conversation references will show a deleted-goal marker."
      : "This goal leaves the active list. Its conversations, history and links stay available.";

  return (
    <>
      <GoalRouteHeader title={heading} />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid={`goal-${action}-screen`}
      >
        <GoalRouteBackLink onClick={onCancel} />
        <h1 className="text-2xl font-bold tracking-tight">{heading}</h1>
        <div className="mt-6 max-w-[650px] rounded-lg border border-border p-6">
          <h2 className="text-base font-bold">{head.title}</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            {dependents.length} sub-goals
          </p>
          {action === "delete" && isBlocked ? (
            <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
              <strong className="text-sm">Resolve these links first.</strong>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Move sub-goals to another parent before deleting this goal.
                Archive is available without removing those relationships.
              </p>
              <ul className="mt-3 divide-y divide-border">
                {dependents.map((dependent) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    key={dependent.head.goalId}
                  >
                    <span className="text-sm font-medium">
                      {dependent.head.title}
                    </span>
                    <Button
                      onClick={() => void goEditGoal(dependent.head.goalId)}
                      type="button"
                      variant="outline"
                    >
                      Edit sub-goal
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {action === "archive" && dependents.length > 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Sub-goals stay active; archiving a parent does not complete or
              archive them.
            </p>
          ) : null}
          {mutation.isError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {mutation.error.message}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            {!isBlocked ? (
              <Button
                className={
                  action === "archive"
                    ? "bg-[#637fb1] text-white hover:bg-[#536d9c] dark:bg-[#8aa6d8] dark:text-[#282532] dark:hover:bg-[#7795c9]"
                    : undefined
                }
                disabled={mutation.isPending}
                onClick={() => void onConfirm()}
                variant={action === "delete" ? "destructive" : "default"}
              >
                {mutation.isPending
                  ? action === "delete"
                    ? "Deleting goal"
                    : "Archiving goal"
                  : action === "delete"
                    ? "Delete goal"
                    : "Archive goal"}
              </Button>
            ) : null}
            {action === "delete" && isBlocked ? (
              <Button
                onClick={() =>
                  void goEditGoal(dependents[0]?.head.goalId ?? goalId)
                }
                type="button"
                variant="outline"
              >
                Edit relationships
              </Button>
            ) : null}
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      </main>
    </>
  );
}
