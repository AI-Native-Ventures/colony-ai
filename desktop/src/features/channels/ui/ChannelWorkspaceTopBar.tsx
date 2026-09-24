import { Bell, Hash, Search } from "lucide-react";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";

/** Reference workspace chrome for the active channel and optional thread. */
export function ChannelWorkspaceTopBar({
  channelTitle,
  isThreadOpen,
  onOpenInbox,
}: {
  channelTitle: string;
  isThreadOpen: boolean;
  onOpenInbox: () => void;
}) {
  const openSearch = () => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  };

  return (
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
          <button aria-label="Open Inbox" onClick={onOpenInbox} type="button">
            <Bell aria-hidden="true" />
          </button>
        </>
      }
      className="colony-channel-topbar"
    >
      <Hash aria-hidden="true" />
      <strong>{channelTitle}</strong>
      {isThreadOpen ? (
        <>
          <span
            aria-hidden="true"
            className="colony-workspace-breadcrumb-separator text-xs"
          >
            /
          </span>
          <span className="colony-workspace-breadcrumb-label text-xs">
            Thread
          </span>
        </>
      ) : null}
    </WorkspaceTopBar>
  );
}
