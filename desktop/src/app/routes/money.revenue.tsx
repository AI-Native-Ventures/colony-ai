import { createFileRoute } from "@tanstack/react-router";
import { MoneyRouteScreen } from "@/features/money/MoneyScreens";

export const Route = createFileRoute("/money/revenue")({
  component: () => <MoneyRouteScreen section="revenue" />,
});
