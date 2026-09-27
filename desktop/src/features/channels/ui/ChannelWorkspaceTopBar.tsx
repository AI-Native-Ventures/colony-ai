import { Bell, Hash, PanelLeft, Search, Users } from "lucide-react";
import { ChannelMemberAvatarStack } from "@/features/channels/ui/ChannelMemberAvatarStack";
import { toggleTerminalPanel } from "@/features/terminal/terminalPanelStore";
import type { ChannelMember } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";

/** Reference workspace chrome for the active channel and optional thread. */
export function ChannelWorkspaceTopBar({
  channelTitle,
  isThreadOpen,
  currentPubkey,
  members,
  onToggleMembers,
  onOpenInbox,
}: {
  channelTitle: string;
  isThreadOpen: boolean;
  currentPubkey?: string;
  members: ChannelMember[];
  onToggleMembers: () => void;
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
          <Button
            className="colony-work-area-button"
            data-testid="channel-work-area-trigger"
            onClick={toggleTerminalPanel}
            size="sm"
            type="button"
            variant="outline"
          >
            <PanelLeft aria-hidden="true" />
            Work area
          </Button>
          <ChannelMemberAvatarStack
            currentPubkey={currentPubkey}
            members={members}
            size="compact"
            testIdPrefix="channel-topbar-member"
          />
          <button
            aria-label="View members"
            className="colony-channel-topbar-action"
            data-testid="channel-topbar-members-trigger"
            onClick={onToggleMembers}
            type="button"
          >
            <Users aria-hidden="true" />
          </button>
          <button
            aria-label="Search workspace"
            className="colony-channel-topbar-action"
            onClick={openSearch}
            type="button"
          >
            <Search aria-hidden="true" />
          </button>
          <button
            aria-label="Open Inbox"
            className="colony-channel-topbar-action"
            onClick={onOpenInbox}
            type="button"
          >
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
