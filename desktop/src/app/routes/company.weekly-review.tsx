import { createFileRoute } from "@tanstack/react-router";

import { WeeklyReviewScreen } from "@/features/cofounder/ui/WeeklyReviewScreen";

export const Route = createFileRoute("/company/weekly-review")({
  component: WeeklyReviewScreen,
});
