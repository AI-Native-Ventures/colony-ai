import * as React from "react";

import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";

import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useUserProfileQuery,
  useUsersBatchQuery,
} from "@/features/profile/hooks";
import {
  useRelayAgentsQuery,
  useManagedAgentsQuery,
} from "@/features/agents/hooks";
import { useIsManagedAgent } from "@/features/agents/useIsManagedAgent";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import {
  formatOwnerLabel,
  ownsAuthorAgent,
} from "@/features/profile/lib/identity";
import { formatElapsedClock } from "@/features/agents/ui/agentSessionUtils";
import { useAgentAvailability } from "@/features/agents/lib/useAgentAvailability";
import {
  useUserStatusQuery,
  visibleUserStatus,
} from "@/features/user-status/hooks";
import { StatusEmoji } from "@/features/user-status/ui/StatusEmoji";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey, truncateNpub } from "@/shared/lib/pubkey";
import { useProfileInteractionActions } from "@/features/profile/ui/useProfileInteractionActions";

import {
  DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui/popover";
import { useNow } from "@/shared/lib/useNow";
import { Spinner } from "@/shared/ui/spinner";
import "@/features/profile/ui/ProfilePanel.css";
import { resolveModelLabel } from "@/features/agents/lib/formatAgentModelLabel";

type UserProfilePopoverProps = {
  children: React.ReactNode;
  pubkey: string;
  triggerElement?: "div" | "span";
  /**
   * Extra classes for the focusable trigger wrapper, which defaults to
   * inline-flex. Use `min-w-0 max-w-full` when truncating flex content must
   * shrink, or `inline` when prose content must fragment across lines.
   */
  triggerClassName?: string;
  /** Test id applied to the focusable profile trigger shell. */
  triggerTestId?: string;
  /** Accessible name for interactive trigger content that is visually hidden. */
  triggerAriaLabel?: string;
  /** Set false when the trigger is inside another interactive control. */
  enableProfilePanel?: boolean;
  /** Set false when a smaller, context-specific hover treatment is provided. */
  enableHoverPopover?: boolean;
  /** When set to "bot", the profile is treated as an agent ("Agent" chip). */
  role?: string;
  /** Accepted for existing callers; the hover card no longer draws a glyph. */
  botIdenticonValue?: string;
};

const HOVER_CLOSE_DELAY_MS = 200;

const RUNTIME_LABELS: Record<string, string> = {
  goose: "Goose",
  "claude-code": "Claude Code",
  "codex-acp": "Codex",
  aider: "Aider",
};

function runtimeLabel(command: string): string {
  return RUNTIME_LABELS[command] ?? command;
}

export function UserProfilePopover({
  children,
  pubkey,
  triggerElement = "div",
  triggerAriaLabel,
  triggerClassName,
  triggerTestId,
  enableProfilePanel = true,
  enableHoverPopover = true,
  role,
}: UserProfilePopoverProps) {
  const [open, setOpen] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { openProfilePanel } = useProfilePanel();
  const canOpenProfilePanel = enableProfilePanel && Boolean(openProfilePanel);

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleTriggerMouseEnter = React.useCallback(() => {
    if (!enableHoverPopover) {
      return;
    }
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer, enableHoverPopover]);

  const handleMouseLeave = React.useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimer]);

  const handleContentMouseEnter = React.useCallback(() => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  const handleTriggerClick = React.useCallback(
    (event: React.MouseEvent) => {
      clearHoverTimer();
      if (canOpenProfilePanel && openProfilePanel) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        openProfilePanel(pubkey);
      }
    },
    [canOpenProfilePanel, clearHoverTimer, openProfilePanel, pubkey],
  );

  React.useEffect(() => {
    return clearHoverTimer;
  }, [clearHoverTimer]);

  const TriggerElement = triggerElement;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverAnchor asChild>
        <TriggerElement
          aria-label={triggerAriaLabel}
          data-testid={triggerTestId}
          role={canOpenProfilePanel ? "button" : undefined}
          tabIndex={canOpenProfilePanel ? 0 : undefined}
          onClick={handleTriggerClick}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              canOpenProfilePanel &&
              openProfilePanel
            ) {
              e.preventDefault();
              e.stopPropagation();
              clearHoverTimer();
              setOpen(false);
              openProfilePanel(pubkey);
            }
          }}
          onMouseEnter={handleTriggerMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={cn(
            "inline-flex",
            triggerClassName,
            canOpenProfilePanel && "cursor-pointer [&_*]:cursor-pointer",
          )}
        >
          {children}
        </TriggerElement>
      </PopoverAnchor>
      {open ? (
        <UserProfilePopoverBody
          canOpenProfilePanel={canOpenProfilePanel}
          onBeforeAction={clearHoverTimer}
          onContentMouseEnter={handleContentMouseEnter}
          onMouseLeave={handleMouseLeave}
          onTriggerClick={handleTriggerClick}
          pubkey={pubkey}
          role={role}
          setOpen={setOpen}
        />
      ) : null}
    </Popover>
  );
}

/**
 * Everything behind the popover surface: seven query subscriptions, agent
 * classification, and the interaction actions. Mounted only while the
 * popover is open — the trigger shell above stays cheap enough for grids
 * that render hundreds of instances (~40ms per card when this was eager).
 */
function UserProfilePopoverBody({
  canOpenProfilePanel,
  onBeforeAction,
  onContentMouseEnter,
  onMouseLeave,
  onTriggerClick,
  pubkey,
  role,
  setOpen,
}: {
  canOpenProfilePanel: boolean;
  onBeforeAction: () => void;
  onContentMouseEnter: () => void;
  onMouseLeave: () => void;
  onTriggerClick: (event: React.MouseEvent) => void;
  pubkey: string;
  role?: string;
  setOpen: (open: boolean) => void;
}) {
  const profileQuery = useUserProfileQuery(pubkey);
  const usersBatchQuery = useUsersBatchQuery([pubkey]);
  const relayAgentsQuery = useRelayAgentsQuery();
  const managedAgentsQuery = useManagedAgentsQuery();
  const { status: presenceStatus } = useAgentAvailability(pubkey);
  const userStatusQuery = useUserStatusQuery([pubkey]);

  const relayAgent = relayAgentsQuery.data?.find((a) => a.pubkey === pubkey);
  const managedAgent = managedAgentsQuery.data?.find(
    (a) => a.pubkey === pubkey,
  );
  const profile = profileQuery.data;
  const ownerPubkey = profile?.ownerPubkey ?? null;
  const ownerProfileQuery = useUsersBatchQuery(
    ownerPubkey ? [ownerPubkey] : [],
    { enabled: Boolean(ownerPubkey) },
  );
  const normalizedPubkey = normalizePubkey(pubkey);
  const isAgentByOaOwner = Boolean(
    usersBatchQuery.data?.profiles[normalizedPubkey]?.isAgent,
  );
  const isAgentByProfileOwner = profile?.ownerPubkey != null;
  const isBotProfile =
    role === "bot" ||
    Boolean(relayAgent || managedAgent) ||
    isAgentByProfileOwner ||
    isAgentByOaOwner;
  const isAgentClassificationPending =
    role !== "bot" &&
    (profileQuery.isPending ||
      relayAgentsQuery.isPending ||
      managedAgentsQuery.isPending ||
      usersBatchQuery.isPending);
  const displayName = profile?.displayName ?? truncateNpub(pubkey);
  // Owner signal mirrors UserProfilePanel: a declared NIP-OA owner whose agent
  // runs elsewhere holds no local seckey, so key custody (`isOwner`) alone
  // wrongly hides the affordance from them — and gating on bot-ness alone shows
  // it to every viewer. Combine declared ownership with local management, same
  // shape as the pane/sidebar/memory fixes. Every real boundary is server-side;
  // this only decides whether the Message action is painted for an agent.
  const isOwner = useIsManagedAgent(isBotProfile ? pubkey : null);
  const identityQuery = useIdentityQuery();
  const currentPubkey = identityQuery.data?.pubkey;
  const ownerLabel = isBotProfile
    ? formatOwnerLabel(
        ownerPubkey,
        currentPubkey,
        ownerProfileQuery.data?.profiles,
      )
    : null;
  const isSelf =
    currentPubkey !== undefined &&
    currentPubkey.toLowerCase() === pubkey.toLowerCase();
  const showProfileActions = currentPubkey !== undefined && !isSelf;
  const showHumanProfileActions =
    showProfileActions && !isBotProfile && !isAgentClassificationPending;
  const isCurrentUserOwner = ownsAuthorAgent(profile, currentPubkey);
  const viewerIsOwner = isCurrentUserOwner || isOwner === true;
  const showMessageAction =
    showProfileActions &&
    !isAgentClassificationPending &&
    (!isBotProfile || viewerIsOwner);
  const showAnyProfileActions = showHumanProfileActions || showMessageAction;
  const userStatus = visibleUserStatus(
    userStatusQuery.data?.[pubkey.toLowerCase()],
  );
  const userStatusText = userStatus?.text.trim() ?? "";
  const hasUserStatus = Boolean(userStatusText || userStatus?.emoji);
  const profileDescription = profile?.about?.trim() ?? "";
  const profileSubheader = profileDescription || profile?.nip05Handle?.trim();
  const jobTitle =
    (profile as { jobTitle?: string | null } | undefined)?.jobTitle?.trim() ||
    null;
  const activeTurns = useAgentWorking(isBotProfile ? pubkey : null).channels;
  const channelsQuery = useChannelsQuery();
  const channelIdToName = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const channel of channelsQuery.data ?? []) {
      map[channel.id] = channel.name;
    }
    return map;
  }, [channelsQuery.data]);

  const closeProfileActions = React.useCallback(
    () => setOpen(false),
    [setOpen],
  );
  const { handleMessage, handleWave, isOpeningDm, pendingAction } =
    useProfileInteractionActions({
      availability: {
        message: showMessageAction,
        wave: showHumanProfileActions,
      },
      effectivePubkey: pubkey,
      enabled: true,
      isBot: isBotProfile,
      isSelf,
      onBeforeAction: onBeforeAction,
      onClose: closeProfileActions,
      viewerIsOwner,
    });

  const profileHeaderContent = (
    <>
      <ProfileAvatarWithStatus
        avatarClassName="text-base"
        avatarUrl={profile?.avatarUrl ?? null}
        pubkey={pubkey}
        className="h-12.5 w-12.5"
        geometry={scaleProfileAvatarStatusGeometry(
          DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
          50,
        )}
        iconClassName="h-6 w-6"
        label={displayName}
        shape={isBotProfile ? "squircle" : "circle"}
        size={50}
        status={presenceStatus}
        statusTestId="user-profile-popover-presence-badge"
        testId="user-profile-popover-avatar"
      />

      <div className="min-w-0 flex-1">
        <div className="ph-name-row">
          <span className="ph-name">{displayName}</span>
          {isBotProfile ? <span className="ph-agent-chip">Agent</span> : null}
          <AgentManagementMarker
            pubkey={pubkey}
            ownerPubkey={ownerPubkey}
            testId="user-profile-popover-agent-provenance"
          />
        </div>
        {isBotProfile && ownerLabel ? (
          <p
            className="ph-owner"
            data-testid={`user-profile-popover-owner-${pubkey}`}
          >
            managed by {ownerLabel}
          </p>
        ) : null}
      </div>
    </>
  );

  // Runtime and model chips come from the agent's own record; the connection
  // chip reads the managed agent's process state.
  const agentChips: string[] = [];
  if (isBotProfile) {
    const runtime = managedAgent?.agentCommand ?? relayAgent?.agentType;
    if (runtime) agentChips.push(runtimeLabel(runtime));
    if (managedAgent?.model) {
      agentChips.push(
        resolveModelLabel(managedAgent.model, null, managedAgent.provider),
      );
    }
    if (managedAgent) {
      agentChips.push(
        managedAgent.status === "running" || managedAgent.status === "deployed"
          ? "ACP: connected"
          : "ACP: stopped",
      );
    }
  }

  return (
    <PopoverContent
      align="start"
      className="ph-card"
      data-testid="user-profile-popover"
      onMouseEnter={onContentMouseEnter}
      onMouseLeave={onMouseLeave}
      // This is a hover card: moving focus into its first button on open
      // makes the profile header look keyboard-selected before the user has
      // interacted with it. Keep focus on the trigger; Tab still enters the
      // card and shows its normal focus treatment when needed.
      onOpenAutoFocus={(event) => event.preventDefault()}
      side="top"
      sideOffset={8}
    >
      <div className="ph-stack">
        {canOpenProfilePanel ? (
          <button
            className="ph-head ph-head-button"
            onClick={onTriggerClick}
            type="button"
          >
            {profileHeaderContent}
          </button>
        ) : (
          <div className="ph-head">{profileHeaderContent}</div>
        )}

        {jobTitle || profileSubheader ? (
          <p className="ph-about" data-testid="user-profile-description">
            {[jobTitle, profileSubheader].filter(Boolean).join(". ")}
          </p>
        ) : null}

        {agentChips.length > 0 ? (
          <div className="ph-chips">
            {agentChips.map((chip) => (
              <span className="ph-chip" key={chip}>
                {chip}
              </span>
            ))}
          </div>
        ) : null}

        {activeTurns.map(({ channelId, anchorAt }) => (
          <PopoverWorkingBadge
            anchorAt={anchorAt}
            key={channelId}
            name={channelIdToName[channelId] ?? channelId}
          />
        ))}

        {hasUserStatus ? (
          <div className="ph-status" data-testid="user-profile-status">
            {userStatus?.emoji ? (
              <StatusEmoji
                className="h-3.5 w-3.5 shrink-0"
                value={userStatus.emoji}
              />
            ) : null}
            {userStatusText ? (
              <span className="truncate">{userStatusText}</span>
            ) : null}
          </div>
        ) : null}

        {showAnyProfileActions ? (
          <div className="ph-actions">
            {showMessageAction ? (
              <button
                className="ph-message"
                data-testid={`user-profile-popover-message-${pubkey}`}
                disabled={pendingAction !== null || isOpeningDm}
                onClick={() => {
                  void handleMessage();
                }}
                type="button"
              >
                {pendingAction === "message" ? (
                  <Spinner
                    aria-hidden="true"
                    className="h-3.5 w-3.5 border-2"
                  />
                ) : null}
                Message
              </button>
            ) : null}
            {showHumanProfileActions ? (
              <button
                aria-label="Wave"
                className="ph-wave buzz-wave-hover-trigger"
                data-testid={`user-profile-popover-wave-${pubkey}`}
                disabled={pendingAction !== null || isOpeningDm}
                onClick={() => {
                  void handleWave();
                }}
                type="button"
              >
                {pendingAction === "wave" ? (
                  <Spinner
                    aria-hidden="true"
                    className="h-3.5 w-3.5 border-2"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="buzz-wave-hand text-sm leading-none"
                  >
                    👋
                  </span>
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </PopoverContent>
  );
}

function PopoverWorkingBadge({
  name,
  anchorAt,
}: {
  name: string;
  anchorAt: number;
}) {
  const now = useNow(1000);

  return (
    <span className="ph-working">
      <i aria-hidden="true" />
      Working in #{name} · {formatElapsedClock(now - anchorAt)}
    </span>
  );
}
