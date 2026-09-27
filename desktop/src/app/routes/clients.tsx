import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ClientsScreen = React.lazy(async () => {
  const module = await import("@/features/clients/ui/ClientsScreen");
  return { default: module.ClientsScreen };
});

export const Route = createFileRoute("/clients")({
  component: ClientsRouteComponent,
});

function ClientsRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <ClientsScreen />
    </React.Suspense>
  );
}
