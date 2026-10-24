import { createFileRoute } from "@tanstack/react-router";
import { TodayScreen } from "@/features/home/ui/TodayScreen";

function NavigationHistoryScreen() {
  return <TodayScreen />;
}

export const Route = createFileRoute("/navigation/history")({
  component: NavigationHistoryScreen,
});
