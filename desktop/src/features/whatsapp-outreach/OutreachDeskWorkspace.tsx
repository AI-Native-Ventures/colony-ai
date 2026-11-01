import * as React from "react";

import type { OutreachDeskTab } from "@/features/channels/ui/ChannelWorkspaceTabs";
import { WhatsAppOutreachScreen } from "./WhatsAppOutreachScreen";
import { OutreachDeskNeedsYou } from "./OutreachDeskNeedsYou";
import { OutreachPipeline } from "./OutreachPipeline";

export function OutreachDeskWorkspace({
  activeTab,
  channelId,
  channelIsMember,
  initialContactWaId,
  onTabChange,
}: {
  activeTab: Extract<OutreachDeskTab, "needs-you" | "pipeline" | "chats">;
  channelId: string;
  channelIsMember: boolean;
  initialContactWaId: string | null;
  onTabChange: (tab: OutreachDeskTab) => void;
}) {
  const [selectedWaId, setSelectedWaId] = React.useState(initialContactWaId);
  React.useEffect(() => {
    if (initialContactWaId) setSelectedWaId(initialContactWaId);
  }, [initialContactWaId]);

  const openChat = React.useCallback(
    (waId: string) => {
      setSelectedWaId(waId);
      onTabChange("chats");
    },
    [onTabChange],
  );

  if (activeTab === "chats") {
    return (
      <WhatsAppOutreachScreen
        channelId={channelId}
        channelIsMember={channelIsMember}
        initialContactWaId={selectedWaId}
        initialThreadRootId={null}
        mode="desk"
      />
    );
  }
  if (activeTab === "pipeline") {
    return (
      <OutreachPipeline
        channelIsMember={channelIsMember}
        onOpenChat={openChat}
      />
    );
  }
  return (
    <OutreachDeskNeedsYou
      channelIsMember={channelIsMember}
      onOpenChat={openChat}
    />
  );
}
