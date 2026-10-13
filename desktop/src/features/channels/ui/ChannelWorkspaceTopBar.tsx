import {
  Bell,
  Ellipsis,
  FolderOpen,
  Globe,
  Hash,
  PanelLeft,
  Search,
  Settings2,
  Users,
} from "lucide-react";
import { ChannelMemberAvatarStack } from "@/features/channels/ui/ChannelMemberAvatarStack";
import { WORK_AREA_PANEL_ID } from "@/features/workarea/dock/WorkAreaPanel";
import {
  closeWorkAreaRestoringFocus,
  openWorkAreaFrom,
  toggleWorkAreaFrom,
} from "@/features/workarea/dock/workAreaActions";
import { useWorkAreaDock } from "@/features/workarea/dock/useWorkAreaDock";
import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";
import { isBrowserHostAvailable } from "@/shared/api/browserHost";
import type { ChannelMember } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { ColonyAntAvatar } from "@/shared/ui/ColonyAntAvatar";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  NavigationHistoryControls,
  WorkspaceTopBar,
} from "@/shared/ui/workspace-topbar";

/** Reference workspace chrome for the active channel and optional thread. */
export function ChannelWorkspaceTopBar({
  channelId,
  channelTitle,
  description,
  isCanaryConversation = false,
  isThreadOpen,
  currentPubkey,
  agentPubkeys,
  agentIdentityUnresolved = false,
  members,
  onToggleMembers,
  onManageChannel,
  onOpenInbox,
}: {
  channelId: string;
  channelTitle: string;
  description?: string | null;
  isCanaryConversation?: boolean;
  isThreadOpen: boolean;
  currentPubkey?: string;
  agentPubkeys?: ReadonlySet<string>;
  agentIdentityUnresolved?: boolean;
  members: ChannelMember[];
  onToggleMembers: () => void;
  onManageChannel?: () => void;
  onOpenInbox: () => void;
}) {
  const workArea = useWorkAreaDock(channelId);
  const openSearch = () => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  };

  if (isCanaryConversation) {
    return (
      <header
        className="colony-canary-conversation-header"
        data-testid="colony-conversation-header"
      >
        <div className="colony-canary-conversation-title-row">
          <div className="colony-canary-conversation-title">
            <NavigationHistoryControls />
            <h1
              className="colony-canary-conversation-heading"
              data-testid="chat-title"
            >
              {channelTitle}
            </h1>
            {isThreadOpen ? (
              <span className="colony-canary-thread-breadcrumb">/ Thread</span>
            ) : null}
          </div>
          <div className="colony-canary-conversation-actions">
            <Button
              aria-controls={workArea.open ? WORK_AREA_PANEL_ID : undefined}
              aria-expanded={workArea.open}
              data-testid="channel-work-area-trigger"
              onClick={(event) => {
                if (workArea.open && workArea.activeTabId === "shared") {
                  closeWorkAreaRestoringFocus(channelId);
                } else {
                  openWorkAreaFrom(channelId, "shared", event.currentTarget);
                }
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <FolderOpen aria-hidden="true" />
              Workspace
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Conversation actions"
                  data-testid="colony-conversation-actions"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Ellipsis aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onToggleMembers}>
                  <Users aria-hidden="true" /> Members
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openSearch}>
                  <Search aria-hidden="true" /> Search
                </DropdownMenuItem>
                {onManageChannel ? (
                  <DropdownMenuItem onSelect={onManageChannel}>
                    <Settings2 aria-hidden="true" /> Conversation settings
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {members.length > 0 ? (
          <button
            className="colony-canary-conversation-participants"
            onClick={onToggleMembers}
            type="button"
            aria-label="View conversation members"
          >
            {members.slice(0, 5).map((member) => {
              const isAgent =
                member.isAgent ||
                agentPubkeys?.has(normalizePubkey(member.pubkey));
              return (
                <span
                  className="colony-canary-conversation-participant"
                  key={member.pubkey}
                >
                  {isAgent ? (
                    <ColonyAntAvatar
                      name={member.displayName ?? "Agent"}
                      className="size-7"
                      decorative
                    />
                  ) : agentIdentityUnresolved ? (
                    <span
                      aria-label={`Loading portrait for ${member.displayName ?? "participant"}`}
                      className="colony-canary-conversation-participant-pending"
                      role="img"
                    />
                  ) : (
                    <UserAvatar
                      avatarUrl={null}
                      displayName={member.displayName ?? "Member"}
                      className="!h-7 !w-7 text-2xs"
                      fallbackDelayMs={0}
                    />
                  )}
                  <span>
                    {member.displayName ?? (isAgent ? "Agent" : "Member")}
                  </span>
                </span>
              );
            })}
            {members.length > 5 ? (
              <span className="colony-canary-participant-overflow">
                +{members.length - 5}
              </span>
            ) : null}
          </button>
        ) : null}
        {description ? (
          <p className="colony-canary-conversation-description">
            {description}
          </p>
        ) : null}
      </header>
    );
  }

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
