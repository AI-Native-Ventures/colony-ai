import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const CompanyWorkVerifyScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkActionScreens"
  );
  return { default: module.CompanyWorkVerifyScreen };
});

export const Route = createFileRoute("/work/verify/$workItemId")({
  component: CompanyWorkVerifyRouteComponent,
});

function CompanyWorkVerifyRouteComponent() {
  const { workItemId } = Route.useParams();
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading work item
        </div>
      }
    >
      <CompanyWorkVerifyScreen workItemId={workItemId} />
    </React.Suspense>
  );
}
