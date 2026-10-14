import { createFileRoute } from "@tanstack/react-router";

import { TodayScreen } from "@/features/home/ui/TodayScreen";

export const Route = createFileRoute("/today")({
  component: TodayScreen,
  validateSearch: (search: Record<string, unknown>): { view?: "needs-you" } =>
    search.view === "needs-you" ? { view: "needs-you" } : {},
});
