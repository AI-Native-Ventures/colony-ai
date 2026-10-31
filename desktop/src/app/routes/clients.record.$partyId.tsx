import { createFileRoute } from "@tanstack/react-router";

import { CustomerRecordScreen } from "@/features/cofounder/ui/CustomerRecordScreen";

export const Route = createFileRoute("/clients/record/$partyId")({
  component: CustomerRecordRoute,
});

function CustomerRecordRoute() {
  const { partyId } = Route.useParams();
  return <CustomerRecordScreen partyId={partyId} />;
}
