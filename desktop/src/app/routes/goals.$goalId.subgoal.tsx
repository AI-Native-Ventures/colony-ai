import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalFormScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalFormScreen");
  return { default: module.GoalFormScreen };
});

export const Route = createFileRoute("/goals/$goalId/subgoal")({
  component: GoalSubgoalCreateRouteComponent,
});

function GoalSubgoalCreateRouteComponent() {
  const { goalId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goal form
        </div>
      }
    >
      <GoalFormScreen mode="subgoal" parentGoalId={goalId} />
    </React.Suspense>
  );
}
