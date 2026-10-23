import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const WorkScreen = React.lazy(async () => {
  const module = await import("@/features/clients/ui/WorkScreen");
  return { default: module.WorkScreen };
});

export const Route = createFileRoute("/$workSurface")({
  beforeLoad: ({ params }) => {
    if (params.workSurface !== "work") {
      throw notFound();
    }
  },
  component: WorkRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.client === "string" ? { client: search.client } : {}),
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
