import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const WorkScreen = React.lazy(async () => {
  const module = await import("@/features/clients/ui/WorkScreen");
  return { default: module.WorkScreen };
});

const CompanyWorkScreen = React.lazy(async () => {
  const module = await import("@/features/company-work/ui/CompanyWorkScreen");
  return { default: module.CompanyWorkScreen };
});

export const Route = createFileRoute("/$workSurface")({
  beforeLoad: ({ params }) => {
    if (
      params.workSurface !== "work" &&
      params.workSurface !== "company-work"
    ) {
      throw notFound();
    }
  },
  component: WorkRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.client === "string" ? { client: search.client } : {}),
  }),
});

function WorkRouteComponent() {
  const { workSurface } = Route.useParams();
  const { client } = Route.useSearch();

  if (workSurface === "company-work") {
    return (
      <React.Suspense
        fallback={
          <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
            Loading work
          </div>
        }
      >
        <CompanyWorkScreen />
      </React.Suspense>
    );
  }

  if (workSurface !== "work") {
    throw notFound();
  }

  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <WorkScreen initialClientId={client} />
    </React.Suspense>
  );
}
