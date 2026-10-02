import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalConfirmationScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalConfirmationScreen");
  return { default: module.GoalConfirmationScreen };
});

export const Route = createFileRoute("/goals/$goalId/delete")({
  component: GoalDeleteRouteComponent,
});

function GoalDeleteRouteComponent() {
  const { goalId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goal
        </div>
      }
    >
      <GoalConfirmationScreen action="delete" goalId={goalId} />
    </React.Suspense>
  );
}
