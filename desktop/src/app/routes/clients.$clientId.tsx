import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ClientDetailScreen } from "@/features/clients/ui/ClientDetailScreen";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

export const Route = createFileRoute("/clients/$clientId")({
  component: ClientDetailRouteComponent,
});

function ClientDetailRouteComponent() {
  const { clientId } = Route.useParams();
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
      <ClientDetailScreen clientId={clientId} />
    </React.Suspense>
  );
}
