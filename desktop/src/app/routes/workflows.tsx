import * as React from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";

import {
  parseWorkflowEditorPane,
  serializeWorkflowEditorPane,
} from "@/features/workflows/ui/workflowEditorPane";
import { usePreviewFeatureWarning } from "@/shared/features";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
import { LazyWorkflowsRouteScreen } from "./lazyWorkflowsRouteScreen";

function parseWorkflowStarting(
  value: unknown,
): "example" | "blank" | undefined {
  if (value === "example" || value === "blank") return value;
  return undefined;
}

export const Route = createFileRoute("/workflows")({
  component: WorkflowsRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    advanced: search.advanced === true ? true : undefined,
    channel: typeof search.channel === "string" ? search.channel : undefined,
    pane: serializeWorkflowEditorPane(parseWorkflowEditorPane(search.pane)),
    starting: parseWorkflowStarting(search.starting),
    view:
      search.view === "create" || search.view === "plain-new"
        ? search.view
        : undefined,
  }),
});

function WorkflowsRouteComponent() {
  usePreviewFeatureWarning("workflows");
  const navigate = Route.useNavigate();
  const location = useLocation();
  const { advanced, channel, pane, starting, view } = Route.useSearch();
  const hasOrigin =
    (location.state as { workflowEditorHasOrigin?: unknown } | undefined)
      ?.workflowEditorHasOrigin === true;

  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="workflows" />}>
      <LazyWorkflowsRouteScreen
        editor={
          view === "create" || view === "plain-new"
            ? {
                advanced: false,
                hasOrigin,
                initialChannelId: channel,
                mode: "create",
                pane: parseWorkflowEditorPane(pane),
                starting,
              }
            : null
        }
        onEditorPaneChange={(nextPane) => {
          void navigate({
            replace: true,
            resetScroll: false,
            search: {
              advanced,
              channel,
              pane: serializeWorkflowEditorPane(nextPane),
              starting,
              view,
            },
          });
        }}
      />
    </React.Suspense>
  );
}
