import { createFileRoute } from "@tanstack/react-router";
import { TodayScreen } from "@/features/home/ui/TodayScreen";

function NavigationHistoryScreen() {
  return <TodayScreen showUpdatesAction={false} />;
}

export const Route = createFileRoute("/navigation/history")({
  component: NavigationHistoryScreen,
});
