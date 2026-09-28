import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalDetailScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalDetailScreen");
  return { default: module.GoalDetailScreen };
});

export const Route = createFileRoute("/goals/$goalId")({
  component: GoalDetailRouteComponent,
});

function GoalDetailRouteComponent() {
  const { goalId } = Route.useParams();
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
