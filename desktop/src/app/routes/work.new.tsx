import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const CompanyWorkFormScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkFormScreen"
  );
  return { default: module.CompanyWorkFormScreen };
});

export const Route = createFileRoute("/work/new")({
  component: NewCompanyWorkRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    channel: typeof search.channel === "string" ? search.channel : undefined,
    goal: typeof search.goal === "string" ? search.goal : undefined,
  }),
});

function NewCompanyWorkRouteComponent() {
  const { channel, goal } = Route.useSearch();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading work form
        </div>
      }
    >
      <CompanyWorkFormScreen initialChannelId={channel} initialGoalId={goal} />
    </React.Suspense>
  );
}
