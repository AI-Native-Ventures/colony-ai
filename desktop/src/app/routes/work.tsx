import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { WorkScreen } from "@/features/clients/ui/WorkScreen";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

export const Route = createFileRoute("/work")({
  component: WorkRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search.client === "string" ? search.client : undefined,
  }),
});

function WorkRouteComponent() {
  const { client } = Route.useSearch();
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <WorkScreen initialClientId={client} />
    </React.Suspense>
  );
}
