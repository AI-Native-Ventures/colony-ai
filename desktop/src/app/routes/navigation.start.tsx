import { createFileRoute } from "@tanstack/react-router";
import { TodayScreen } from "@/features/home/ui/TodayScreen";

function NavigationStartScreen() {
  return <TodayScreen showUpdatesAction={false} />;
}

export const Route = createFileRoute("/navigation/start")({
  component: NavigationStartScreen,
});
