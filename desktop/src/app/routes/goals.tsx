import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const GoalsScreen = React.lazy(async () => {
  const module = await import("@/features/goals/ui/GoalsScreen");
  return { default: module.GoalsScreen };
});

export const Route = createFileRoute("/goals")({
  component: GoalsRouteComponent,
});

function GoalsRouteComponent() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading goals
        </div>
      }
    >
      <GoalsScreen />
    </React.Suspense>
  );
}
