import { createFileRoute } from "@tanstack/react-router";
import { MoneyRouteScreen } from "@/features/money/MoneyScreens";

export const Route = createFileRoute("/money/revenue/$invoiceId")({
  component: RevenueInvoiceRouteComponent,
});

function RevenueInvoiceRouteComponent() {
  const { invoiceId } = Route.useParams();
  return <MoneyRouteScreen invoiceId={invoiceId} section="revenue-invoice" />;
}
