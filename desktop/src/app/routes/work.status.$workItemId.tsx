import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const CompanyWorkStatusScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkActionScreens"
  );
  return { default: module.CompanyWorkStatusScreen };
});

export const Route = createFileRoute("/work/status/$workItemId")({
  component: CompanyWorkStatusRouteComponent,
});

function CompanyWorkStatusRouteComponent() {
  const { workItemId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading work item
        </div>
      }
    >
      <CompanyWorkStatusScreen workItemId={workItemId} />
    </React.Suspense>
  );
}
