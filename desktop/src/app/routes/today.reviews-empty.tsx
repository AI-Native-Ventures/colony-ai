import { createFileRoute } from "@tanstack/react-router";
import { TodayScreen } from "@/features/home/ui/TodayScreen";

export const Route = createFileRoute("/today/reviews-empty")({
  component: TodayScreen,
});
