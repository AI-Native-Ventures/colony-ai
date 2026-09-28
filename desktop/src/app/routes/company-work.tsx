import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const CompanyWorkScreen = React.lazy(async () => {
  const module = await import("@/features/company-work/ui/CompanyWorkScreen");
  return { default: module.CompanyWorkScreen };
});

export const Route = createFileRoute("/company-work")({
  component: CompanyWorkRouteComponent,
});

function CompanyWorkRouteComponent() {
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
