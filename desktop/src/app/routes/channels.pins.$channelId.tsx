import { createFileRoute } from "@tanstack/react-router";

import { ChannelPinsScreen } from "@/features/channels/ui/ChannelPinsScreen";

export const Route = createFileRoute("/channels/pins/$channelId")({
  component: ChannelPinsRoute,
});

function ChannelPinsRoute() {
  const { channelId } = Route.useParams();
  return <ChannelPinsScreen channelId={channelId} />;
}
