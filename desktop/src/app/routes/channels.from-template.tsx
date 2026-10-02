import { createFileRoute } from "@tanstack/react-router";

import { ChannelTemplatePickerScreen } from "@/features/channel-templates/ui/ChannelTemplatePickerScreen";

export const Route = createFileRoute("/channels/from-template")({
  component: ChannelTemplatePickerScreen,
});
