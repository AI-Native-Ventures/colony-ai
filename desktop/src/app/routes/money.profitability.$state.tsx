import { createFileRoute } from "@tanstack/react-router";
import {
  MoneySourceRouteScreen,
  type MoneySourceRouteState,
} from "@/features/money/MoneySourceScreen";

export const Route = createFileRoute("/money/profitability/$state")({
  component: ProfitabilityRouteComponent,
});

function ProfitabilityRouteComponent() {
  const { state } = Route.useParams();
  return (
    <MoneySourceRouteScreen
      family="profitability"
      state={state as MoneySourceRouteState}
    />
  );
}
