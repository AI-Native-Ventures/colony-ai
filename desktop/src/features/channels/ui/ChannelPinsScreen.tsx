import { Bell, Folder, House, Search } from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { Button } from "@/shared/ui/button";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";

function openSearch() {
  document
    .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
    ?.click();
}

export function ChannelPinsScreen({ channelId }: { channelId: string }) {
  const channelsQuery = useChannelsQuery();
  const channel = channelsQuery.data?.find((item) => item.id === channelId);
  const { openBrowseChannels } = useAppShell();
  const { goHome } = useAppNavigation();

  return (
    <div
      className="colony-channel-pins-screen"
      data-testid="channel-pins-screen"
    >
      <WorkspaceTopBar
        actions={
          <>
            <button
              aria-label="Search workspace"
              onClick={openSearch}
              type="button"
            >
              <Search aria-hidden="true" />
            </button>
            <button
              aria-label="Open Inbox"
              onClick={() => void goHome()}
              type="button"
            >
              <Bell aria-hidden="true" />
            </button>
          </>
        }
      >
        <House aria-hidden="true" />
        <span>Channels</span>
      </WorkspaceTopBar>
      <main className="colony-channel-pins-content">
        <header className="colony-channel-pins-heading">
          <h1 className="text-studio-title">
            Pinned in {channel?.name ?? channelId}
          </h1>
          <Button
            className="h-7 rounded-md px-2.5 text-2xs font-semibold"
            onClick={openBrowseChannels}
            size="sm"
            type="button"
            variant="outline"
          >
            Browse channels
          </Button>
        </header>
        <div className="colony-channel-pins-empty" role="status">
          <Folder aria-hidden="true" />
          <h2>No pinned messages</h2>
          <p>Pin a message from its menu so the team can find it.</p>
        </div>
      </main>
    </div>
  );
}
