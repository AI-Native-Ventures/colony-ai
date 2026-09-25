import { createFileRoute } from "@tanstack/react-router";
import { TodayScreen } from "@/features/home/ui/TodayScreen";

export const Route = createFileRoute("/navigation/start")({
  component: TodayScreen,
});
