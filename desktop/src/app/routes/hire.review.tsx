import { createFileRoute } from "@tanstack/react-router";

import { HireReviewScreen } from "@/features/company-hiring/ui/HireReviewScreen";

export const Route = createFileRoute("/hire/review")({
  component: HireReviewRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    hireId: typeof search.hireId === "string" ? search.hireId : undefined,
    channelId:
      typeof search.channelId === "string" ? search.channelId : undefined,
    askId: typeof search.askId === "string" ? search.askId : undefined,
  }),
});

function HireReviewRoute() {
  const { askId, channelId, hireId } = Route.useSearch();
  if (!hireId) return null;
  return (
    <HireReviewScreen
      hireId={hireId}
      source={askId ? { askId, channelId } : undefined}
    />
  );
}
