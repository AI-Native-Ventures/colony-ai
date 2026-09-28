import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const CompanyWorkFormScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkFormScreen"
  );
  return { default: module.CompanyWorkFormScreen };
});

export const Route = createFileRoute("/work/edit/$workItemId")({
  component: CompanyWorkEditRouteComponent,
});

function CompanyWorkEditRouteComponent() {
  const { workItemId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading work item
        </div>
      }
    >
      <CompanyWorkFormScreen workItemId={workItemId} />
    </React.Suspense>
  );
}
