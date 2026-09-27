import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalFormScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalFormScreen");
  return { default: module.GoalFormScreen };
});

export const Route = createFileRoute("/goals/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    parent: typeof search.parent === "string" ? search.parent : undefined,
  }),
  component: GoalCreateRouteComponent,
});

function GoalCreateRouteComponent() {
  const { parent } = Route.useSearch();
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
