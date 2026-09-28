import { createFileRoute } from "@tanstack/react-router";
import {
  MoneySourceRouteScreen,
  type MoneySourceRouteState,
} from "@/features/money/MoneySourceScreen";

export const Route = createFileRoute("/money/costs/$state")({
  component: CostSourceRouteComponent,
});

function CostSourceRouteComponent() {
  const { state } = Route.useParams();
  return (
    <MoneySourceRouteScreen
      family="costs"
      state={state as MoneySourceRouteState}
    />
  );
}
