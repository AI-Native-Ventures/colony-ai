import { createFileRoute } from "@tanstack/react-router";
import { MoneyRouteScreen } from "@/features/money/MoneyScreens";

export const Route = createFileRoute("/money/invoices")({
  component: () => <MoneyRouteScreen section="invoices" />,
});
