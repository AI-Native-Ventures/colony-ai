import { Bell, Globe, Hash, PanelLeft, Search, Users } from "lucide-react";
import { ChannelMemberAvatarStack } from "@/features/channels/ui/ChannelMemberAvatarStack";
import { WORK_AREA_PANEL_ID } from "@/features/workarea/dock/WorkAreaPanel";
import { toggleWorkAreaFrom } from "@/features/workarea/dock/workAreaActions";
import { useWorkAreaDock } from "@/features/workarea/dock/useWorkAreaDock";
import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";
import { isBrowserHostAvailable } from "@/shared/api/browserHost";
import type { ChannelMember } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";

/** Reference workspace chrome for the active channel and optional thread. */
export function ChannelWorkspaceTopBar({
  channelId,
  channelTitle,
  isThreadOpen,
  currentPubkey,
  members,
  onToggleMembers,
  onOpenInbox,
}: {
  channelId: string;
  channelTitle: string;
  isThreadOpen: boolean;
  currentPubkey?: string;
  members: ChannelMember[];
  onToggleMembers: () => void;
  onOpenInbox: () => void;
}) {
  const workArea = useWorkAreaDock(channelId);
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
            aria-controls={workArea.open ? WORK_AREA_PANEL_ID : undefined}
            aria-expanded={workArea.open}
            className="colony-work-area-button"
            data-testid="channel-work-area-trigger"
            onClick={(event) =>
              toggleWorkAreaFrom(channelId, event.currentTarget)
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <PanelLeft aria-hidden="true" />
            Work area
          </Button>
          {isBrowserHostAvailable() ? (
            // As in the reference, the globe on the conversation toolbar opens
            // the browser beside the conversation.
            <button
              aria-label="Open browser"
              className="colony-channel-topbar-action"
              data-testid="channel-open-browser"
              onClick={() => requestWorkAreaTab("browser")}
              type="button"
            >
              <Globe aria-hidden="true" />
            </button>
          ) : (
            <Globe
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground"
            />
          )}
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
