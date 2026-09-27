import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { WorkDetailScreen } from "@/features/clients/ui/WorkDetailScreen";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

export const Route = createFileRoute("/work/$workId")({
  component: WorkDetailRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search.client === "string" ? search.client : undefined,
  }),
});

function WorkDetailRouteComponent() {
  const { workId } = Route.useParams();
  const { client } = Route.useSearch();
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <WorkDetailScreen clientId={client} workItemId={workId} />
    </React.Suspense>
  );
}
