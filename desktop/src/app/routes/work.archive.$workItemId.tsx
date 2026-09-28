import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const CompanyWorkArchiveScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkActionScreens"
  );
  return { default: module.CompanyWorkArchiveScreen };
});

export const Route = createFileRoute("/work/archive/$workItemId")({
  component: CompanyWorkArchiveRouteComponent,
});

function CompanyWorkArchiveRouteComponent() {
  const { workItemId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading work item
        </div>
      }
    >
      <CompanyWorkArchiveScreen workItemId={workItemId} />
    </React.Suspense>
  );
}
