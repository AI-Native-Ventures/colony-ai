import { createFileRoute } from "@tanstack/react-router";
import {
  MoneyTaxRouteScreen,
  type MoneyTaxRouteState,
} from "@/features/money/MoneyTaxScreen";

export const Route = createFileRoute("/money/tax/$state")({
  validateSearch: (search: Record<string, unknown>) => ({
    invoiceId:
      typeof search.invoiceId === "string" ? search.invoiceId : undefined,
  }),
  component: TaxRouteComponent,
});

function TaxRouteComponent() {
  const { state } = Route.useParams();
  const { invoiceId } = Route.useSearch();
  return (
    <MoneyTaxRouteScreen
      invoiceId={invoiceId}
      state={state as MoneyTaxRouteState}
    />
  );
}
