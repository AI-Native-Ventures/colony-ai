import { createFileRoute } from "@tanstack/react-router";

import { AskDetailScreen } from "@/features/company-asks/ui/AskDetailScreen";

export const Route = createFileRoute("/asks/$channelId/$askId")({
  component: AskDetailRouteComponent,
});

function AskDetailRouteComponent() {
  const { askId, channelId } = Route.useParams();
  return <AskDetailScreen askId={askId} channelId={channelId} />;
}
