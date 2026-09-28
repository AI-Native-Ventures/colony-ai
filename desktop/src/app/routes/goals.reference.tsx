import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalReferencePickerScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalReferencePickerScreen");
  return { default: module.GoalReferencePickerScreen };
});

export const Route = createFileRoute("/goals/reference")({
  component: GoalReferenceRouteComponent,
});

function GoalReferenceRouteComponent() {
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goals
        </div>
      }
    >
      <GoalReferencePickerScreen />
    </React.Suspense>
  );
}
