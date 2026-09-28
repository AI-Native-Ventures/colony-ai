import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const AskCreateScreen = React.lazy(async () => {
  const module = await import("@/features/company-asks/ui/AskCreateScreen");
  return { default: module.AskCreateScreen };
});

export const Route = createFileRoute("/asks/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    channelId: typeof search.channelId === "string" ? search.channelId : null,
    threadRootEventId:
      typeof search.threadRootEventId === "string"
        ? search.threadRootEventId
        : null,
  }),
  component: AskCreateRouteComponent,
});

function AskCreateRouteComponent() {
  const { channelId, threadRootEventId } = Route.useSearch();
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading ask form
        </div>
      }
    >
      <AskCreateScreen
        channelId={channelId}
        threadRootEventId={threadRootEventId}
      />
    </React.Suspense>
  );
}
