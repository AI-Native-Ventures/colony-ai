import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalProgressScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalProgressScreen");
  return { default: module.GoalProgressScreen };
});

export const Route = createFileRoute("/goals/$goalId/progress")({
  component: GoalProgressRouteComponent,
});

function GoalProgressRouteComponent() {
  const { goalId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading progress form
        </div>
      }
    >
      <GoalProgressScreen goalId={goalId} />
    </React.Suspense>
  );
}
