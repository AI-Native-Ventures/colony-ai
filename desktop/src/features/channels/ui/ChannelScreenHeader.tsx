import { LogIn, SquareTerminal } from "lucide-react";
import type * as React from "react";

import { ChatHeader } from "@/features/chat/ui/ChatHeader";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import type { ActiveDmHeaderParticipant } from "@/features/channels/useActiveChannelHeader";
import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import { getDmParticipantPreview } from "@/features/channels/lib/dmParticipantDisplay";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import { ChannelMembersBar } from "@/features/channels/ui/ChannelMembersBar";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { UserNameIndicators } from "@/features/user-status/ui/UserNameIndicators";
import { Button } from "@/shared/ui/button";
import type { Channel, PresenceStatus } from "@/shared/api/types";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { ColonyAntAvatar } from "@/shared/ui/ColonyAntAvatar";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  toggleTerminalPanel,
  useTerminalPanel,
} from "@/features/terminal/terminalPanelStore";

const DM_HEADER_AVATAR_SIZE = 32;
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
  agentPubkeys?: ReadonlySet<string>;
  agentPubkeysPending?: boolean;
  headerEndActions?: React.ReactNode;
  isAddBotOpen?: boolean;
  isJoining?: boolean;
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
  actionsVariant = "inline",
  activeDmAvatarUrl,
  activeDmHeaderParticipants,
  activeDmPresenceStatus,
  chromeWrapperRef,
  currentPubkey,
  agentPubkeys,
  agentPubkeysPending = false,
  headerEndActions,
  isAddBotOpen,
  isJoining = false,
  onAddBotOpenChange,
  showHeaderContent = true,
  transparentChrome = false,
  onJoinChannel,
  onManageChannel,
  onToggleMembers,
}: ChannelScreenHeaderProps) {
  const isGroupDm =
    activeChannel?.channelType === "dm" &&
    activeDmHeaderParticipants.length > 1;
  const activeDmParticipant = activeDmHeaderParticipants[0] ?? null;
  const activeDmIsAgent = Boolean(
    activeDmParticipant &&
      (activeDmParticipant.isAgent ||
        agentPubkeys?.has(normalizePubkey(activeDmParticipant.pubkey))),
  );
  const showJoinButton =
    activeChannel !== null &&
    !activeChannel.isMember &&
    activeChannel.visibility === "open" &&
    !activeChannel.archivedAt &&
    onJoinChannel;

  const terminalPanel = useTerminalPanel();
  const terminalButton =
    activeChannel &&
    !referenceThreadPresentation &&
    actionsVariant !== "reference" ? (
      <Button
        aria-label={
          terminalPanel.mode === "closed"
            ? "Open Colony Term"
            : "Hide Colony Term"
        }
        onClick={toggleTerminalPanel}
        size="icon"
        title="Colony Term (⌘J)"
        type="button"
        variant={terminalPanel.mode === "closed" ? "outline" : "secondary"}
      >
        <SquareTerminal />
      </Button>
    ) : null;
  const channelActions = activeChannel ? (
    showJoinButton ? (
      <div className="flex items-center gap-1">
        <Button
          disabled={isJoining}
          onClick={() => void onJoinChannel()}
          size="sm"
          variant="default"
        >
          <LogIn className="mr-1.5 h-4 w-4" />
          {isJoining ? "Joining…" : "Join"}
        </Button>
        {headerEndActions}
      </div>
    ) : (
      <ChannelMembersBar
        channel={activeChannel}
        currentPubkey={currentPubkey}
        endActions={headerEndActions}
        isAddBotOpen={isAddBotOpen}
        onAddBotOpenChange={onAddBotOpenChange}
        onManageChannel={onManageChannel}
        onToggleMembers={onToggleMembers}
        variant={actionsVariant}
      />
    )
  ) : (
    headerEndActions
  );
  const actions =
    terminalButton || channelActions ? (
      <div className="flex items-center gap-1">
        {terminalButton}
        {channelActions}
      </div>
    ) : null;

  if (!showHeaderContent) {
    return null;
  }

  const header = (
    <ChatHeader
      belowSystemChrome={
        !referenceThreadPresentation && actionsVariant !== "reference"
      }
      chromeWrapperRef={chromeWrapperRef}
      actions={actions}
      channelType={activeChannel?.channelType}
      description={getChannelDescription(activeChannel)}
      leadingContent={
        activeChannel?.channelType === "dm" ? (
          isGroupDm ? (
            <DmHeaderParticipantStack
              agentPubkeys={agentPubkeys}
              agentPubkeysPending={agentPubkeysPending}
              participants={activeDmHeaderParticipants}
            />
          ) : activeDmParticipant ? (
            agentPubkeysPending && !activeDmIsAgent ? (
              <span
                aria-label="Loading participant portrait"
                className="colony-canary-dm-avatar-pending"
                data-testid="chat-header-dm-avatar"
                role="img"
              />
            ) : (
              <UserProfilePopover
                pubkey={activeDmParticipant.pubkey}
                role={activeDmIsAgent ? "bot" : undefined}
                triggerAriaLabel={`Open profile for ${activeChannelTitle}`}
                triggerElement="span"
              >
                {activeDmIsAgent ? (
                  <span className="colony-canary-dm-ant-wrap">
                    <ColonyAntAvatar
                      name={activeChannelTitle}
                      className="size-8"
                      decorative
                      testId="chat-header-dm-avatar"
                    />
                    <span
                      aria-label={`Status: ${activeDmPresenceStatus ?? "offline"}`}
                      className="colony-canary-dm-presence"
                      data-presence={activeDmPresenceStatus ?? "offline"}
                      data-testid="chat-presence-badge"
                      role="img"
                    />
                  </span>
                ) : (
                  <ProfileAvatarWithStatus
                    avatarClassName="text-xs"
                    avatarUrl={activeDmAvatarUrl}
                    className="mr-1.5 h-8 w-8"
                    geometry={DM_HEADER_AVATAR_STATUS_GEOMETRY}
                    iconClassName="h-4 w-4"
                    label={activeChannelTitle}
                    shape="circle"
                    size={DM_HEADER_AVATAR_SIZE}
                    status={activeDmPresenceStatus ?? "offline"}
                    statusTestId="chat-presence-badge"
                    testId="chat-header-dm-avatar"
                  />
                )}
              </UserProfilePopover>
            )
          ) : (
            <ProfileAvatarWithStatus
              avatarClassName="text-xs"
              avatarUrl={activeDmAvatarUrl}
              className="mr-1.5 h-8 w-8"
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
          <ChannelGlyph
            channel={activeChannel}
            className="h-4 w-4 translate-y-px text-muted-foreground"
          />
        ) : undefined
      }
      statusBadge={
        <>
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
      showDescription={
        actionsVariant === "reference" && !referenceThreadPresentation
      }
      title={activeChannelTitle}
      titleClassName={
        referenceThreadPresentation ? "text-channel-title" : undefined
      }
      titleAdornment={
        activeChannel?.channelType === "dm" && !isGroupDm ? (
          <UserNameIndicators
            className="ml-1"
            pubkey={activeDmParticipant?.pubkey}
            size="dm"
          />
        ) : null
      }
      transparentChrome={transparentChrome}
      visibility={activeChannel?.visibility}
    />
  );

  return referenceThreadPresentation ? (
    <div className="relative z-40">{header}</div>
  ) : (
    header
  );
}

function DmHeaderParticipantStack({
  agentPubkeys,
  agentPubkeysPending,
  participants,
}: {
  agentPubkeys?: ReadonlySet<string>;
  agentPubkeysPending: boolean;
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
      {visibleParticipants.map((participant, index) =>
        agentPubkeysPending &&
        !participant.isAgent &&
        !agentPubkeys?.has(normalizePubkey(participant.pubkey)) ? (
          <span
            aria-label="Loading participant portrait"
            className={`${index > 0 ? "-ml-2" : ""} colony-canary-dm-avatar-pending`}
            data-testid="chat-header-dm-avatar-stack-participant"
            key={participant.pubkey}
            role="img"
            style={{ zIndex: index + 1 }}
          />
        ) : (
          <UserProfilePopover
            key={participant.pubkey}
            pubkey={participant.pubkey}
            triggerAriaLabel={`Open profile for ${participant.displayName}`}
            triggerElement="span"
            role={
              participant.isAgent ||
              agentPubkeys?.has(normalizePubkey(participant.pubkey))
                ? "bot"
                : undefined
            }
          >
            <span
              className={index > 0 ? "-ml-2" : ""}
              data-testid="chat-header-dm-avatar-stack-participant"
              style={{ zIndex: index + 1 }}
            >
              {participant.isAgent ||
              agentPubkeys?.has(normalizePubkey(participant.pubkey)) ? (
                <ColonyAntAvatar
                  name={participant.displayName}
                  className="size-8 ring-2 ring-background"
                  decorative
                />
              ) : (
                <UserAvatar
                  accent={false}
                  avatarUrl={participant.avatarUrl}
                  className={
                    index < stackItemCount - 1
                      ? "h-8 w-8 text-xs ring-2 ring-background"
                      : "h-8 w-8 text-xs"
                  }
                  displayName={participant.displayName}
                  shape="circle"
                  size="sm"
                />
              )}
            </span>
          </UserProfilePopover>
        ),
      )}
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
