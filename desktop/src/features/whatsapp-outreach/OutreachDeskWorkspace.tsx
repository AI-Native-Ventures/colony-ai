import * as React from "react";

import { useWorkAreaDock } from "@/features/workarea/dock/useWorkAreaDock";
import { openWorkArea } from "@/features/workarea/dock/workAreaStore";
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
  const dock = useWorkAreaDock(channelId);
  const activeWhatsAppTab = dock.tabs.find(
    (tab) => tab.id === dock.activeTabId && tab.kind === "whatsapp",
  );
  const activeWhatsAppTabId = activeWhatsAppTab?.id ?? null;
  const activeWhatsAppContactWaId = activeWhatsAppTab?.contactWaId ?? null;
  const dockWhatsAppOpen = dock.open && activeWhatsAppTab !== undefined;

  React.useEffect(() => {
    if (!initialContactWaId) return;
    setSelectedWaId(initialContactWaId);
    if (dockWhatsAppOpen && activeWhatsAppTabId) {
      openWorkArea(channelId, "whatsapp", activeWhatsAppTabId, {
        contactWaId: initialContactWaId,
      });
    }
  }, [activeWhatsAppTabId, channelId, dockWhatsAppOpen, initialContactWaId]);

  React.useEffect(() => {
    if (!dockWhatsAppOpen || !activeWhatsAppTabId) return;
    if (
      activeWhatsAppContactWaId &&
      activeWhatsAppContactWaId !== selectedWaId
    ) {
      setSelectedWaId(activeWhatsAppContactWaId);
      return;
    }
    if (!activeWhatsAppContactWaId && selectedWaId) {
      openWorkArea(channelId, "whatsapp", activeWhatsAppTabId, {
        contactWaId: selectedWaId,
      });
    }
  }, [
    activeWhatsAppContactWaId,
    activeWhatsAppTabId,
    channelId,
    dockWhatsAppOpen,
    selectedWaId,
  ]);

  const selectDeskContact = React.useCallback(
    (waId: string) => {
      setSelectedWaId(waId);
      if (dockWhatsAppOpen && activeWhatsAppTabId) {
        openWorkArea(channelId, "whatsapp", activeWhatsAppTabId, {
          contactWaId: waId,
        });
      }
    },
    [activeWhatsAppTabId, channelId, dockWhatsAppOpen],
  );

  const openChat = React.useCallback(
    (waId: string) => {
      selectDeskContact(waId);
      onTabChange("chats");
    },
    [onTabChange, selectDeskContact],
  );

  if (activeTab === "chats") {
    return (
      <div className="c3wa-desk-container">
        <WhatsAppOutreachScreen
          channelId={channelId}
          channelIsMember={channelIsMember}
          hideSelectedConversation={dockWhatsAppOpen}
          initialContactWaId={selectedWaId}
          initialThreadRootId={null}
          mode="desk"
          onContactSelected={selectDeskContact}
        />
      </div>
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
