import { createFileRoute } from "@tanstack/react-router";

import { WhatsAppBatchScreen } from "@/features/whatsapp-outreach/WhatsAppBatchScreen";

export const Route = createFileRoute("/whatsapp/batches/$batchId")({
  component: WhatsAppBatchRoute,
});

function WhatsAppBatchRoute() {
  const { batchId } = Route.useParams();
  return <WhatsAppBatchScreen batchId={batchId} redirectToChat />;
}
