import { createFileRoute } from "@tanstack/react-router";

import {
  HomeFeedRouteContent,
  validateHomeSearch,
} from "@/features/map-shell/HomeFeedRouteContent";

export const Route = createFileRoute("/activity")({
  validateSearch: validateHomeSearch,
  component: ActivityRouteComponent,
});

function ActivityRouteComponent() {
  const { filter } = Route.useSearch();
  return <HomeFeedRouteContent filter={filter} />;
}
