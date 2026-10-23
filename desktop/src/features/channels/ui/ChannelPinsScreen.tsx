import { Bell, ChevronLeft, Folder, House, Search } from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { PinnedMessagesList } from "@/features/pins/ui/PinnedMessagesList";
import { ChevronLeftIcon, ChevronRightIcon } from "@/shared/ui/colonyIcons";

function openSearch() {
  document
    .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
    ?.click();
}

export function ChannelPinsScreen({ channelId }: { channelId: string }) {
  const channelsQuery = useChannelsQuery();
  const channel = channelsQuery.data?.find((item) => item.id === channelId);
  const channelName = channel?.name ?? channelId;
  const { navigationHistory, openBrowseChannels } = useAppShell();
  const { goChannel, goHome } = useAppNavigation();

  return (
    <div
      className="colony-channel-pins-screen"
      data-testid="channel-pins-screen"
    >
      <header className="colony-topbar c3pin-topbar">
        <button
          aria-label="Go back"
          className="colony-topbar-button"
          data-testid="global-back"
          disabled={!navigationHistory.canGoBack}
          onClick={navigationHistory.goBack}
          title="Back"
          type="button"
        >
          <ChevronLeftIcon size={17} />
        </button>
        <button
          aria-label="Go forward"
          className="colony-topbar-button"
          data-testid="global-forward"
          disabled={!navigationHistory.canGoForward}
          onClick={navigationHistory.goForward}
          title="Forward"
          type="button"
        >
          <ChevronRightIcon size={17} />
        </button>
        <nav aria-label="Breadcrumb" className="colony-breadcrumb">
          <House aria-hidden="true" className="size-4" />
          <span>Channels</span>
          <span aria-hidden="true">/</span>
          <button
            className="c3pin-crumb"
            onClick={() => void goChannel(channelId)}
            type="button"
          >
            {channelName}
          </button>
          <span aria-hidden="true">/</span>
          <span aria-current="page" data-current="true">
            Pinned
          </span>
        </nav>
        <span className="flex-1" />
        <button
          aria-label="Search workspace"
          className="c3pin-action"
          onClick={openSearch}
          type="button"
        >
          <Search aria-hidden="true" className="size-[1.1875rem]" />
        </button>
        <button
          aria-label="Open Inbox"
          className="c3pin-action"
          onClick={() => void goHome()}
          type="button"
        >
          <Bell aria-hidden="true" className="size-[1.1875rem]" />
        </button>
      </header>
      <main className="colony-channel-pins-content c3pin-content">
        <div className="c3pin-inner">
          <header className="c3pin-heading">
            <div className="c3pin-heading-copy">
              <h1>Pinned in {channelName}</h1>
              <span>Messages the team wanted to keep within reach</span>
            </div>
            <div className="c3pin-heading-actions">
              <button
                className="c3pin-button"
                onClick={() => void goChannel(channelId)}
                type="button"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
                Back to channel
              </button>
              <button
                className="c3pin-button"
                onClick={openBrowseChannels}
                type="button"
              >
                Browse channels
              </button>
            </div>
          </header>
          <PinnedMessagesList
            channelId={channelId}
            empty={
              <div className="colony-channel-pins-empty" role="status">
                <Folder aria-hidden="true" />
                <h2>No pinned messages</h2>
                <p>Pin a message from its menu so the team can find it.</p>
              </div>
            }
            variant="page"
          />
        </div>
      </main>
    </div>
  );
}
