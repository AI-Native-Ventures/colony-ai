import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import type { CompanyWorkTrackingScreenKind } from "@/features/company-work/ui/CompanyWorkTrackingScreens";

const CompanyWorkTrackingScreens = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkTrackingScreens"
  );
  return { default: module.CompanyWorkTrackingScreens };
});

const screens = new Set<CompanyWorkTrackingScreenKind>([
  "suggestion",
  "timeline",
  "panel",
  "person",
  "watchdog",
  "watchdog-saved",
  "failed",
  "unavailable",
  "empty",
]);

export const Route = createFileRoute("/work/tracking/$screen/$resourceId")({
  beforeLoad: ({ params }) => {
    if (!screens.has(params.screen as CompanyWorkTrackingScreenKind)) {
      throw notFound();
    }
  },
  component: CompanyWorkTrackingRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.channel === "string" ? { channel: search.channel } : {}),
    ...(typeof search.threadRoot === "string"
      ? { threadRoot: search.threadRoot }
      : {}),
  }),
});

function CompanyWorkTrackingRouteComponent() {
  const { resourceId, screen } = Route.useParams();
  const { channel, threadRoot } = Route.useSearch();
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading work tracking
        </div>
      }
    >
      <CompanyWorkTrackingScreens
        channelId={channel}
        resourceId={resourceId}
        screen={screen as CompanyWorkTrackingScreenKind}
        threadRootId={threadRoot}
      />
    </React.Suspense>
  );
}
