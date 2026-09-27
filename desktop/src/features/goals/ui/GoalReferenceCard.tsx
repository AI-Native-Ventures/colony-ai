import type * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useGoalHeadsQuery } from "../goalRelay";

function shortGoalId(goalId: string): string {
  return goalId.slice(0, 8).toUpperCase();
}

function GoalReferenceCardFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 flex w-full max-w-[650px] items-center gap-3 rounded-lg border border-border bg-muted/30 p-4 text-left">
      {children}
    </div>
  );
}

export function GoalReferenceCard({
  goalId,
  interactive = true,
}: {
  goalId: string;
  interactive?: boolean;
}) {
  const goalsQuery = useGoalHeadsQuery();
  const identityQuery = useIdentityQuery();
  const { goGoal } = useAppNavigation();
  const record = goalsQuery.data?.find(
    (candidate) => candidate.head.goalId === goalId,
  );
  const goal = record?.head.goal;
  const ownerPubkey = goal?.ownerPubkey;
  const profilesQuery = useUsersBatchQuery(ownerPubkey ? [ownerPubkey] : [], {
    enabled: Boolean(ownerPubkey),
  });

  if (goalsQuery.isPending) {
    return (
      <GoalReferenceCardFrame>
        <span aria-hidden="true" className="text-lg text-primary">
          ◎
        </span>
        <span className="text-sm text-muted-foreground" role="status">
          Loading goal
        </span>
      </GoalReferenceCardFrame>
    );
  }

  if (goalsQuery.isError || !record) {
    return (
      <GoalReferenceCardFrame>
        <span className="text-sm text-muted-foreground">
          Goal unavailable · {shortGoalId(goalId)}
        </span>
      </GoalReferenceCardFrame>
    );
  }

  if (record.head.status === "deleted" || !goal) {
    return (
      <GoalReferenceCardFrame>
        <span className="text-sm text-muted-foreground">
          Deleted goal · {shortGoalId(goalId)}
        </span>
      </GoalReferenceCardFrame>
    );
  }

  const parent = goal.parentGoalId
    ? goalsQuery.data?.find(
        (candidate) => candidate.head.goalId === goal.parentGoalId,
      )
    : undefined;
  const ownerLabel = resolveUserLabel({
    currentPubkey: identityQuery.data?.pubkey,
    profiles: profilesQuery.data?.profiles,
    pubkey: goal.ownerPubkey,
  });
  const summary = [
    ownerLabel,
    record.head.status.replaceAll("_", " "),
    parent ? `Part of ${parent.head.title}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = `${goal.parentGoalId ? "SUB-GOAL" : "GOAL"} · ${shortGoalId(goal.goalId)}`;

  const contents = (
    <>
      <span aria-hidden="true" className="text-xl text-primary">
        ◎
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xs text-muted-foreground">{label}</span>
        <span className="my-1 block text-sm font-semibold leading-6">
          {record.head.title}
        </span>
        <span className="block text-2xs text-muted-foreground">{summary}</span>
      </span>
      <span aria-hidden="true" className="text-base text-muted-foreground">
        ↗
      </span>
    </>
  );

  if (!interactive) {
    return <GoalReferenceCardFrame>{contents}</GoalReferenceCardFrame>;
  }

  return (
    <button
      aria-label={`Open goal: ${record.head.title}`}
      className="my-3 flex w-full max-w-[650px] items-center gap-3 rounded-lg border border-border bg-muted/30 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`goal-reference-card-${goal.goalId}`}
      onClick={() => void goGoal(goal.goalId)}
      type="button"
    >
      {contents}
    </button>
  );
}
