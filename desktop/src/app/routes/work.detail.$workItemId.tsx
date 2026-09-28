import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const CompanyWorkDetailScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkDetailScreen"
  );
  return { default: module.CompanyWorkDetailScreen };
});

export const Route = createFileRoute("/work/detail/$workItemId")({
  component: CompanyWorkDetailRouteComponent,
});

function CompanyWorkDetailRouteComponent() {
  const { workItemId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading work item
        </div>
      }
    >
      <CompanyWorkDetailScreen workItemId={workItemId} />
    </React.Suspense>
  );
}
