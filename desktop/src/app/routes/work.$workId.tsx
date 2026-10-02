import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { WorkDetailScreen } from "@/features/clients/ui/WorkDetailScreen";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const CompanyWorkFormScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkFormScreen"
  );
  return { default: module.CompanyWorkFormScreen };
});

export const Route = createFileRoute("/work/$workId")({
  component: WorkDetailRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.client === "string" ? { client: search.client } : {}),
    ...(typeof search.channel === "string" ? { channel: search.channel } : {}),
    ...(typeof search.goal === "string" ? { goal: search.goal } : {}),
  }),
});

function WorkDetailRouteComponent() {
  const { workId } = Route.useParams();
  const { channel, client, goal } = Route.useSearch();
  if (workId === "new") {
    return (
      <React.Suspense
        fallback={
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            Loading work form
          </div>
        }
      >
        <CompanyWorkFormScreen
          initialChannelId={channel}
          initialGoalId={goal}
        />
      </React.Suspense>
    );
  }
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <WorkDetailScreen clientId={client} workItemId={workId} />
    </React.Suspense>
  );
}
