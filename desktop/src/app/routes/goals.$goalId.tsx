import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalDetailScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalDetailScreen");
  return { default: module.GoalDetailScreen };
});

const GoalFormScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalFormScreen");
  return { default: module.GoalFormScreen };
});

export const Route = createFileRoute("/goals/$goalId")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.parent === "string" ? { parent: search.parent } : {}),
  }),
  component: GoalDetailRouteComponent,
});

function GoalDetailRouteComponent() {
  const { goalId } = Route.useParams();
  const { parent } = Route.useSearch();
  if (goalId === "new") {
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
        <GoalFormScreen
          mode={parent ? "subgoal" : "create"}
          parentGoalId={parent}
        />
      </React.Suspense>
    );
  }

  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading goal
        </div>
      }
    >
      <GoalDetailScreen goalId={goalId} />
    </React.Suspense>
  );
}
