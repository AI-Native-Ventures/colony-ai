import type * as React from "react";

import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import { getChannelDetail } from "@/features/channels/lib/channelDescription";
import { getDmParticipantPreview } from "@/features/channels/lib/dmParticipantDisplay";
import { ChannelAddAgentHost } from "@/features/channels/ui/ChannelAddAgentHost";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import { ChannelMemberAvatarStack } from "@/features/channels/ui/ChannelMemberAvatarStack";
import { ChannelWorkspaceTabs } from "@/features/channels/ui/ChannelWorkspaceTabs";
import { ConversationHeader } from "@/features/channels/ui/ConversationHeader";
import { DmAgentSubtitle } from "@/features/channels/ui/DmAgentSubtitle";
import type { ActiveDmHeaderParticipant } from "@/features/channels/useActiveChannelHeader";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { UserNameIndicators } from "@/features/user-status/ui/UserNameIndicators";
import { WORK_AREA_PANEL_ID } from "@/features/workarea/dock/WorkAreaPanel";
import { toggleWorkAreaFrom } from "@/features/workarea/dock/workAreaActions";
import { useWorkAreaDock } from "@/features/workarea/dock/useWorkAreaDock";
import { requestChannelSearch } from "@/shared/lib/channelSearchRequest";
import type {
  Channel,
  ChannelMember,
  PresenceStatus,
} from "@/shared/api/types";
import {
  JoinGlyph,
  KebabIcon,
  SearchGlyph,
  WorkAreaToggleIcon,
} from "@/shared/ui/conversationIcons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { UserAvatar } from "@/shared/ui/UserAvatar";

/** A header control with its name in a tooltip. */
function HeaderTip({
  children,
  label,
}: {
  children: React.ReactElement;
  label: string;
}) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const DM_HEADER_AVATAR_SIZE = 40;
const DM_HEADER_AVATAR_STATUS_GEOMETRY = scaleProfileAvatarStatusGeometry(
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  DM_HEADER_AVATAR_SIZE,
);

type ChannelScreenHeaderProps = {
  activeChannel: Channel | null;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  activeChannelTitle: string;
  referenceThreadPresentation?: boolean;
  actionsVariant?: "inline" | "compact" | "reference";
  activeDmAvatarUrl: string | null;
  activeDmHeaderParticipants: ActiveDmHeaderParticipant[];
  activeDmPresenceStatus: PresenceStatus | null;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  currentPubkey?: string;
  headerEndActions?: React.ReactNode;
  isAddBotOpen?: boolean;
  isJoining?: boolean;
  members?: ChannelMember[];
  showHeaderContent?: boolean;
  transparentChrome?: boolean;
  onAddBotOpenChange?: (open: boolean) => void;
  onJoinChannel?: () => Promise<void>;
  onManageChannel: () => void;
  onToggleMembers: () => void;
};

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  activeChannelTitle,
  referenceThreadPresentation = false,
  activeDmAvatarUrl,
  activeDmHeaderParticipants,
  activeDmPresenceStatus,
  chromeWrapperRef,
  currentPubkey,
  headerEndActions,
  isAddBotOpen,
  isJoining = false,
  members = [],
  onAddBotOpenChange,
  showHeaderContent = true,
  onJoinChannel,
  onManageChannel,
  onToggleMembers,
}: ChannelScreenHeaderProps) {
  const isDm = activeChannel?.channelType === "dm";
  const isGroupDm = isDm && activeDmHeaderParticipants.length > 1;
  const activeDmParticipant = activeDmHeaderParticipants[0] ?? null;
  const showJoinButton =
    activeChannel !== null &&
    !activeChannel.isMember &&
    activeChannel.visibility === "open" &&
    !activeChannel.archivedAt &&
    onJoinChannel;
  const workArea = useWorkAreaDock(activeChannel?.id ?? null);
  const memberCount = members.length || (activeChannel?.memberCount ?? 0);

  if (!showHeaderContent) {
    return null;
  }

  const actions = activeChannel ? (
    <>
      {showJoinButton ? (
        <button
          className="c3c-button mr-1 inline-flex h-10 items-center gap-2 rounded-xl bg-colony-accent px-4 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          data-testid="channel-header-join"
          disabled={isJoining}
          onClick={() => void onJoinChannel()}
          type="button"
        >
          <JoinGlyph size={17} />
          {isJoining ? "Joining…" : "Join"}
        </button>
      ) : !isDm ? (
        <HeaderTip label="Channel members">
          <button
            aria-label={`View channel members (${memberCount})`}
            className="flex h-10 items-center gap-2 rounded-xl pl-1.5 pr-2.5 text-colony-fg transition-colors hover:bg-colony-accent-soft"
            data-testid="channel-members-trigger"
            onClick={onToggleMembers}
            type="button"
          >
            <ChannelMemberAvatarStack
              currentPubkey={currentPubkey}
              members={members}
              size="header"
              testIdPrefix="channel-topbar-member"
            />
            <span className="c3c-button font-bold tabular-nums">
              {memberCount}
            </span>
          </button>
        </HeaderTip>
      ) : null}
      {showJoinButton || !workArea ? null : (
        <HeaderTip label="Work area">
          <button
            aria-controls={workArea.open ? WORK_AREA_PANEL_ID : undefined}
            aria-expanded={workArea.open}
            aria-label="Open work area"
            className="c3c-icon-button"
            data-active={workArea.open ? "true" : undefined}
            data-testid="channel-work-area-trigger"
            onClick={(event) =>
              toggleWorkAreaFrom(activeChannel.id, event.currentTarget)
            }
            type="button"
          >
            <WorkAreaToggleIcon />
          </button>
        </HeaderTip>
      )}
      <HeaderTip
        label={isDm ? "Search this conversation" : "Search this channel"}
      >
        <button
          aria-label={isDm ? "Search this conversation" : "Search this channel"}
          className="c3c-icon-button"
          data-testid="channel-search-trigger"
          onClick={requestChannelSearch}
          type="button"
        >
          <SearchGlyph />
        </button>
      </HeaderTip>
      <HeaderTip label="Channel settings">
        <button
          aria-label="Manage channel"
          className="c3c-icon-button"
          data-testid="channel-management-trigger"
          onClick={onManageChannel}
          type="button"
        >
          <KebabIcon />
        </button>
      </HeaderTip>
      {headerEndActions}
      <ChannelAddAgentHost
        channel={activeChannel}
        onOpenChange={onAddBotOpenChange}
        open={isAddBotOpen}
      />
    </>
  ) : (
    headerEndActions
  );

  const leading = isDm ? (
    isGroupDm ? (
      <DmHeaderParticipantStack participants={activeDmHeaderParticipants} />
    ) : activeDmParticipant ? (
      <UserProfilePopover
        pubkey={activeDmParticipant.pubkey}
        role={activeDmParticipant.isAgent ? "bot" : undefined}
        triggerAriaLabel={`Open profile for ${activeChannelTitle}`}
        triggerElement="span"
      >
        <ProfileAvatarWithStatus
          avatarClassName="text-sm"
          avatarUrl={activeDmAvatarUrl}
          className="h-10 w-10"
          geometry={DM_HEADER_AVATAR_STATUS_GEOMETRY}
          iconClassName="h-4 w-4"
          label={activeChannelTitle}
          shape={activeDmParticipant.isAgent ? "squircle" : "circle"}
          size={DM_HEADER_AVATAR_SIZE}
          status={activeDmPresenceStatus ?? "offline"}
          statusTestId="chat-presence-badge"
          testId="chat-header-dm-avatar"
        />
      </UserProfilePopover>
    ) : (
      <ProfileAvatarWithStatus
        avatarClassName="text-sm"
        avatarUrl={activeDmAvatarUrl}
        className="h-10 w-10"
        geometry={DM_HEADER_AVATAR_STATUS_GEOMETRY}
        iconClassName="h-4 w-4"
        label={activeChannelTitle}
        shape="circle"
        size={DM_HEADER_AVATAR_SIZE}
        status={activeDmPresenceStatus ?? "offline"}
        statusTestId="chat-presence-badge"
        testId="chat-header-dm-avatar"
      />
    )
  ) : activeChannel ? (
    <ChannelGlyph channel={activeChannel} className="!size-5 text-colony-fg" />
  ) : undefined;

  const header = (
    <ConversationHeader
      actions={actions}
      chromeWrapperRef={chromeWrapperRef}
      description={
        isDm
          ? undefined
          : showJoinButton
            ? "Read-only until you join this open channel."
            : activeChannel
              ? (getChannelDetail(activeChannel) ?? undefined)
              : undefined
      }
      descriptionBelow={Boolean(showJoinButton)}
      leading={leading}
      statusBadge={
        <>
          {activeChannel?.archivedAt ? (
            <span
              className="c3c-archived-badge"
              data-testid="chat-archived-badge"
            >
              Archived
            </span>
          ) : null}
          <ChannelHeaderStatusBadge
            ephemeralDisplay={activeChannelEphemeralDisplay}
          />
          {!isGroupDm && activeDmParticipant ? (
            <AgentManagementMarker
              pubkey={activeDmParticipant.pubkey}
              testId="chat-header-agent-provenance"
            />
          ) : null}
        </>
      }
      subtitle={
        isDm && !isGroupDm && activeDmParticipant?.isAgent ? (
          <DmAgentSubtitle pubkey={activeDmParticipant.pubkey} />
        ) : undefined
      }
      tabs={
        activeChannel?.channelType === "stream" &&
        !referenceThreadPresentation ? (
          <ChannelWorkspaceTabs />
        ) : undefined
      }
      title={activeChannelTitle}
      titleAdornment={
        isDm && !isGroupDm ? (
          <UserNameIndicators
            className="ml-1"
            pubkey={activeDmParticipant?.pubkey}
            size="dm"
          />
        ) : null
      }
    />
  );

  return referenceThreadPresentation ? (
    <div className="relative z-40">{header}</div>
  ) : (
    header
  );
}

function DmHeaderParticipantStack({
  participants,
}: {
  participants: ActiveDmHeaderParticipant[];
}) {
  const { hiddenCount, visibleParticipants } =
    getDmParticipantPreview(participants);
  const stackItemCount = visibleParticipants.length + (hiddenCount > 0 ? 1 : 0);

  return (
    <div
      className="mr-1.5 flex shrink-0 items-center"
      data-testid="chat-header-dm-avatar-stack"
    >
      {visibleParticipants.map((participant, index) => (
        <UserProfilePopover
          key={participant.pubkey}
          pubkey={participant.pubkey}
          triggerAriaLabel={`Open profile for ${participant.displayName}`}
          triggerElement="span"
          role={participant.isAgent ? "bot" : undefined}
        >
          <span
            className={index > 0 ? "-ml-2" : ""}
            data-testid="chat-header-dm-avatar-stack-participant"
            style={{ zIndex: index + 1 }}
          >
            <UserAvatar
              accent={participant.isAgent === true}
              avatarUrl={participant.avatarUrl}
              className={
                index < stackItemCount - 1
                  ? "h-8 w-8 text-xs ring-2 ring-background"
                  : "h-8 w-8 text-xs"
              }
              displayName={participant.displayName}
              shape={participant.isAgent ? "squircle" : "circle"}
              size="sm"
            />
          </span>
        </UserProfilePopover>
      ))}
      {hiddenCount > 0 ? (
        <div
          className={visibleParticipants.length > 0 ? "-ml-2" : ""}
          data-testid="chat-header-dm-avatar-stack-more"
          style={{ zIndex: stackItemCount }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground shadow-xs">
            <span className="text-2xs leading-none">+{hiddenCount}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
