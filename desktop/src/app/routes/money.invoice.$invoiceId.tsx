import { createFileRoute } from "@tanstack/react-router";
import { MoneyRouteScreen } from "@/features/money/MoneyScreens";

export const Route = createFileRoute("/money/invoice/$invoiceId")({
  component: InvoiceRouteComponent,
});

function InvoiceRouteComponent() {
  const { invoiceId } = Route.useParams();
  return <MoneyRouteScreen invoiceId={invoiceId} section="invoice" />;
}
