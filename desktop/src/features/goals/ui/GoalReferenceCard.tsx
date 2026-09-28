import type * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useGoalHeadsQuery } from "../goalRelay";

function shortGoalId(goalId: string): string {
  return goalId.slice(0, 8).toUpperCase();
}

function GoalReferenceCardFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 flex w-full max-w-[740px] items-center gap-3 rounded-lg border border-border bg-[#f8f7f8] p-5 text-left dark:bg-[#302b38]">
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
  const { goGoal } = useAppNavigation();
  const record = goalsQuery.data?.find(
    (candidate) => candidate.head.goalId === goalId,
  );
  const goal = record?.head.goal;

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

  const label = `${goal.parentGoalId ? "Sub-goal" : "Company goal"} · ${shortGoalId(goal.goalId)}`;

  const contents = (
    <>
      <span aria-hidden="true" className="text-xl text-primary">
        ◎
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-6">
          {record.head.title}
        </span>
        <span className="mt-1 block text-2xs text-muted-foreground">
          {label}
        </span>
      </span>
    </>
  );

  if (!interactive) {
    return <GoalReferenceCardFrame>{contents}</GoalReferenceCardFrame>;
  }

  return (
    <button
      aria-label={`Open goal: ${record.head.title}`}
      className="my-3 flex w-full max-w-[740px] items-center gap-3 rounded-lg border border-border bg-[#f8f7f8] p-5 text-left transition-colors hover:bg-[#f4f0f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#302b38] dark:hover:bg-[#39313f]"
      data-testid={`goal-reference-card-${goal.goalId}`}
      onClick={() => void goGoal(goal.goalId)}
      type="button"
    >
      {contents}
    </button>
  );
}
