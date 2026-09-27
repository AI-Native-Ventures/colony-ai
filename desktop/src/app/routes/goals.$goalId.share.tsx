import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalShareScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalShareScreen");
  return { default: module.GoalShareScreen };
});

export const Route = createFileRoute("/goals/$goalId/share")({
  component: GoalShareRouteComponent,
});

function GoalShareRouteComponent() {
  const { goalId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading goal reference
        </div>
      }
    >
      <GoalShareScreen goalId={goalId} />
    </React.Suspense>
  );
}
