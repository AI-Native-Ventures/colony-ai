import * as React from "react";

import { OtherSetupAgentMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import { useIsOtherSetupAgent } from "@/features/agents/useKnownAgentPubkeys";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import { agentPresenceStartBlockReason } from "@/features/agents/lib/useAgentAvailability";
import {
  getManagedAgentPrimaryActionLabel,
  isManagedAgentActive,
} from "@/features/agents/lib/managedAgentControlActions";
import { RestartDiffBadge } from "@/features/agents/ui/RestartDiffBadge";
import type { IdentityArchiveActions } from "@/features/identity-archive/hooks";
import { getPresenceLabel } from "@/features/presence/lib/presence";
import type { useUserProfileQuery } from "@/features/profile/hooks";
import type { ProfileField } from "@/features/profile/ui/UserProfilePanelFields";
import {
  ArchiveStatusTooltip,
  ProfileInfoTabContent,
  ProfileTabBar,
} from "@/features/profile/ui/UserProfilePanelTabs";
import { ProfileTabContentTransition } from "@/features/profile/ui/ProfileTabContentTransition";
import { ChannelsFocusedView } from "@/features/profile/ui/UserProfilePanelFocusedViews";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import {
  ProfilePersonaPrimaryActions,
  ProfilePrimaryActions,
} from "@/features/profile/ui/UserProfilePrimaryActions";
import { PencilIcon } from "@/features/profile/ui/profileIcons";
import { StatusEmoji } from "@/features/user-status/ui/StatusEmoji";
import type { ManagedAgent, RelayAgent } from "@/shared/api/types";
import type {
  ProfileChannelLink,
  ProfilePanelTab,
} from "@/features/profile/ui/UserProfilePanelUtils";
import { cn } from "@/shared/lib/cn";
import { useNow } from "@/shared/lib/useNow";
import "@/features/profile/ui/ProfilePanel.css";

export { AgentInstructionsFocusedView } from "@/features/profile/ui/UserProfilePanelAgentDetails";

// ── Summary view ─────────────────────────────────────────────────────────────

export type ProfileSummaryViewProps = {
  canAddToChannel: boolean;
  canDeleteAgent: boolean;
  canEditAgent: boolean;
  channelCount: number;
  channelIdToName: Record<string, string>;
  channels: ProfileChannelLink[];
  channelsLoading: boolean;
  /** Name of the community the agent is visible in, for the Visibility row. */
  communityName?: string;
  displayName: string;
  canInstantiateAgent: boolean;
  agentInstruction: string | null;
  handleAgentPrimaryAction: () => void;
  handleAgentRestart: () => void;
  handleEditAgent: () => void;
  handleToggleAgentAutoStart: () => void;
  handleEditPersona?: () => void;
  handleInstantiateAgent: () => void;
  handleMessage?: () => void;
  handleWave?: () => void;
  isArchived: boolean;
  isMessagePending: boolean;
  isWavePending: boolean;
  isBot: boolean;
  isAgentActionPending: boolean;
  isOwner: boolean | undefined;
  isSelf: boolean;
  managedAgent: ManagedAgent | undefined;
  agentInfoFields: ProfileField[];
  archiveActions: IdentityArchiveActions;
  agentSettingsFields: ProfileField[];
  diagnosticsFields: ProfileField[];
  onAddToChannel: () => void;
  /** Mint an agent trading card. Present only for owner-managed personas. */
  onCreateCard?: () => void;
  onDeleteAgent: () => void;
  onDuplicateAgent?: () => void;
  onExportAgent?: () => void;
  onOpenChannel: (channelId: string) => void;
  onTabChange: (tab: ProfilePanelTab, options?: { replace?: boolean }) => void;
  presenceStatus: "online" | "away" | "offline" | undefined;
  profile: ReturnType<typeof useUserProfileQuery>["data"];
  pubkey: string | null;
  relayAgent: RelayAgent | undefined;
  tab: ProfilePanelTab;
  userStatus: { text: string; emoji: string } | null | undefined;
};

/**
 * The facts list, in the order the board shows it. Labels outside this list
 * (ACP and MCP commands, backend, status, "Managed by") stay out of the
 * summary; the owner reaches them through the agent's edit dialog.
 */
const FACT_ORDER = [
  "Public key",
  "NIP-05",
  "Agent type",
  "Capabilities",
  "Runtime",
  "Agent profile",
  "Who can instruct",
  "Start on launch",
  "Last error",
  "Visibility",
] as const;

/** The optional job title of a profile, when the relay carries one. */
function profileJobTitle(
  profile: ProfileSummaryViewProps["profile"],
): string | null {
  const title = (profile as { jobTitle?: string | null } | undefined)?.jobTitle;
  return title?.trim() || null;
}

function managerName(fields: ProfileField[]): string | null {
  const value = fields.find(
    (field) => field.label === "Managed by",
  )?.displayValue;
  return value ? value.replace(/ \(you\)$/u, "") : null;
}

export function ProfileSummaryView({
  canAddToChannel,
  canDeleteAgent,
  canEditAgent,
  channelCount,
  channelIdToName,
  channels,
  channelsLoading,
  communityName,
  displayName,
  canInstantiateAgent,
  agentInstruction,
  handleAgentPrimaryAction,
  handleAgentRestart,
  handleEditAgent,
  handleToggleAgentAutoStart,
  handleEditPersona,
  handleInstantiateAgent,
  handleMessage,
  handleWave,
  isArchived,
  isMessagePending,
  isWavePending,
  isBot,
  isAgentActionPending,
  isOwner,
  isSelf,
  managedAgent,
  agentInfoFields,
  archiveActions,
  agentSettingsFields,
  diagnosticsFields,
  onAddToChannel,
  onCreateCard,
  onDeleteAgent,
  onDuplicateAgent,
  onExportAgent,
  onOpenChannel,
  onTabChange,
  presenceStatus,
  profile,
  pubkey,
  relayAgent,
  tab,
  userStatus,
}: ProfileSummaryViewProps) {
  const notManagedOnDevice = useIsOtherSetupAgent(pubkey, profile?.ownerPubkey);
  const activeTurns = useAgentWorking(isBot ? pubkey : null).channels;

  const showInstructionBlock =
    isOwner === true &&
    (agentInstruction !== null || handleEditPersona !== undefined);
  const showChannelsTab =
    channelsLoading || channelCount > 0 || isBot || relayAgent !== undefined;

  const facts = React.useMemo(() => {
    const byLabel = new Map<string, ProfileField>();
    for (const field of [
      ...agentInfoFields,
      ...agentSettingsFields,
      ...diagnosticsFields,
    ]) {
      if ((FACT_ORDER as readonly string[]).includes(field.label)) {
        byLabel.set(field.label, field);
      }
    }
    if (managedAgent && !byLabel.has("Last error")) {
      byLabel.set("Last error", {
        displayValue: "None",
        label: "Last error",
        testId: "user-profile-last-error",
      });
    }
    if (isArchived) {
      byLabel.set("Visibility", {
        displayValue: "Archived",
        label: "Visibility",
        testId: "user-profile-archived-flair",
        trailingNode: <ArchiveStatusTooltip />,
      });
    } else if (isBot) {
      byLabel.set("Visibility", {
        displayValue: `Everyone in ${communityName ?? "this community"}`,
        label: "Visibility",
        testId: "user-profile-visibility",
      });
    }
    return FACT_ORDER.flatMap((label) => {
      const field = byLabel.get(label);
      return field ? [field] : [];
    });
  }, [
    agentInfoFields,
    agentSettingsFields,
    communityName,
    diagnosticsFields,
    isArchived,
    isBot,
    managedAgent,
  ]);

  const tabs = React.useMemo(() => {
    const items: Array<{ id: ProfilePanelTab; label: string }> = [
      { id: "info", label: "Info" },
    ];
    if (showChannelsTab) {
      items.push({ id: "channels", label: "Channels" });
    }
    return items;
  }, [showChannelsTab]);

  const showTabBar = tabs.length > 1;
  const activeTab = tabs.some((item) => item.id === tab)
    ? tab
    : (tabs[0]?.id ?? "info");
  const tabIds = React.useMemo(() => tabs.map((item) => item.id), [tabs]);

  const ownerName = managerName(agentInfoFields);
  const subtitle = [
    profileJobTitle(profile),
    presenceStatus ? getPresenceLabel(presenceStatus) : null,
    isBot && ownerName ? `managed by ${ownerName}` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div
      className="pp-summary"
      data-testid="user-profile-summary-scroll-layout"
    >
      <ProfileHero
        activeTurns={isBot ? activeTurns : []}
        channelIdToName={channelIdToName}
        displayName={displayName}
        isBot={isBot}
        notManagedOnDevice={notManagedOnDevice}
        onEditAgent={canEditAgent ? handleEditAgent : undefined}
        presenceStatus={presenceStatus}
        profile={profile}
        subtitle={subtitle}
        userStatus={userStatus}
      />

      {canInstantiateAgent ? (
        <ProfilePersonaPrimaryActions
          disabled={isAgentActionPending}
          onStartAgent={handleInstantiateAgent}
        />
      ) : !isSelf && pubkey ? (
        <ProfilePrimaryActions
          agentActionDisabled={isAgentActionPending}
          agentStartBlockReason={
            managedAgent
              ? agentPresenceStartBlockReason(
                  isManagedAgentActive(managedAgent),
                  presenceStatus,
                )
              : undefined
          }
          agentActionLabel={
            isOwner === true && managedAgent
              ? getManagedAgentPrimaryActionLabel(managedAgent)
              : undefined
          }
          messagePending={isMessagePending}
          onAgentPrimaryAction={
            isOwner === true && managedAgent
              ? handleAgentPrimaryAction
              : undefined
          }
          onAgentRestart={
            isOwner === true &&
            managedAgent?.backend.type === "local" &&
            (managedAgent.status === "running" ||
              managedAgent.status === "deployed")
              ? handleAgentRestart
              : undefined
          }
          onMessage={handleMessage}
          onWave={handleWave}
          wavePending={isWavePending}
        />
      ) : null}

      {/* Tab-independent restart badge: visible on every tab so a plain
          Info-tab open shows it. */}
      {managedAgent?.needsRestart ? (
        <RestartDiffBadge
          autoRestartEnabled={managedAgent.autoRestartOnConfigChange}
          className="self-start"
          restartDiff={managedAgent.restartDiff}
        />
      ) : null}

      {tabs.length > 0 ? (
        <section className="pp-tabs-section">
          {showTabBar ? (
            <ProfileTabBar
              activeTab={activeTab}
              onTabChange={onTabChange}
              tabs={tabs}
            />
          ) : null}
          <ProfileTabContentTransition activeTab={activeTab} tabs={tabIds}>
            {activeTab === "info" ? (
              <ProfileInfoTabContent
                archiveActions={archiveActions}
                canArchiveAgent={isBot && archiveActions.canArchive}
                canDeleteAgent={canDeleteAgent}
                facts={facts}
                isDeleteAgentPending={isAgentActionPending}
                managedAgent={managedAgent}
                onCreateCard={onCreateCard}
                onDeleteAgent={onDeleteAgent}
                onDuplicateAgent={onDuplicateAgent}
                onEditAgent={handleEditAgent}
                onExportAgent={onExportAgent}
                onToggleStartOnLaunch={
                  managedAgent?.backend.type === "local"
                    ? handleToggleAgentAutoStart
                    : undefined
                }
                showInstructionBlock={showInstructionBlock}
                startOnLaunchEnabled={managedAgent?.startOnAppLaunch}
                startOnLaunchPending={isAgentActionPending}
              />
            ) : null}
            {activeTab === "channels" ? (
              <ChannelsFocusedView
                canAddToChannel={canAddToChannel}
                channels={channels}
                isActionPending={isAgentActionPending}
                isLoading={channelsLoading}
                onAddToChannel={onAddToChannel}
                onOpenChannel={onOpenChannel}
                variant="embedded"
              />
            ) : null}
          </ProfileTabContentTransition>
        </section>
      ) : null}
    </div>
  );
}

// ── Hero & metadata ──────────────────────────────────────────────────────────

/** "4m", or seconds while the first minute runs. */
function formatWorkingFor(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function ProfileHero({
  activeTurns,
  channelIdToName,
  displayName,
  isBot,
  notManagedOnDevice,
  onEditAgent,
  presenceStatus,
  profile,
  subtitle,
  userStatus,
}: {
  activeTurns: Array<{ channelId: string; anchorAt: number }>;
  channelIdToName: Record<string, string>;
  displayName: string;
  isBot: boolean;
  notManagedOnDevice?: boolean;
  onEditAgent?: () => void;
  presenceStatus: "online" | "away" | "offline" | undefined;
  profile: ProfileSummaryViewProps["profile"];
  subtitle: string[];
  userStatus: ProfileSummaryViewProps["userStatus"];
}) {
  const now = useNow(15_000);
  const working = activeTurns[0];
  const workingChannel = working
    ? (channelIdToName[working.channelId] ?? null)
    : null;

  return (
    <div className="pp-hero">
      <span
        className="pp-avatar"
        data-shape={isBot ? "squircle" : "circle"}
        data-testid="user-profile-avatar-frame"
      >
        <ProfileAvatar
          avatarUrl={profile?.avatarUrl ?? null}
          className="pp-avatar-image"
          iconClassName="h-8 w-8"
          label={displayName}
          shape={isBot ? "squircle" : "circle"}
          testId="user-profile-avatar"
        />
        {presenceStatus ? (
          <span
            aria-label={getPresenceLabel(presenceStatus)}
            className="pp-presence"
            data-status={presenceStatus}
            data-testid="user-profile-presence-badge"
            role="img"
          />
        ) : null}
      </span>

      <h3 className="pp-name-row" data-testid="user-profile-name-row">
        <span className="pp-name">{displayName}</span>
        {notManagedOnDevice ? <OtherSetupAgentMarker /> : null}
        {onEditAgent ? (
          <button
            aria-label={`Edit ${displayName}`}
            className="pp-edit"
            data-testid="user-profile-edit-agent"
            onClick={onEditAgent}
            type="button"
          >
            <span
              aria-hidden="true"
              className="pp-edit-icon"
              data-testid="user-profile-edit-agent-icon"
            >
              <PencilIcon size={15} strokeWidth={2.2} />
            </span>
          </button>
        ) : null}
      </h3>

      {subtitle.length > 0 ? (
        <span className="pp-subtitle" data-testid="user-profile-subtitle">
          {subtitle.join(" · ")}
        </span>
      ) : null}

      {profile?.about?.trim() ? (
        <ProfileHeroDescription
          about={profile.about.trim()}
          key={profile.about.trim()}
        />
      ) : null}

      {profile?.nip05Handle ? (
        <p className="pp-handle">{profile.nip05Handle}</p>
      ) : null}

      {userStatus && (userStatus.text || userStatus.emoji) ? (
        <p className="pp-status">
          {userStatus.emoji ? (
            <StatusEmoji
              className="mr-1 inline h-3.5 w-3.5"
              value={userStatus.emoji}
            />
          ) : null}
          {userStatus.text}
        </p>
      ) : null}

      {working ? (
        <span className="pp-working" data-testid="user-profile-working-chip">
          <i aria-hidden="true" />
          Working
          {workingChannel ? ` in #${workingChannel}` : ""} ·{" "}
          {formatWorkingFor(now - working.anchorAt)}
        </span>
      ) : null}
    </div>
  );
}

function ProfileHeroDescription({ about }: { about: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const [isTruncated, setIsTruncated] = React.useState(false);
  const textRef = React.useRef<HTMLParagraphElement>(null);

  const measureTruncation = React.useCallback(() => {
    const element = textRef.current;
    if (!element || expanded) {
      return;
    }
    setIsTruncated(element.scrollHeight > element.clientHeight + 1);
  }, [expanded]);

  React.useLayoutEffect(() => {
    measureTruncation();
  }, [measureTruncation]);

  React.useEffect(() => {
    const element = textRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureTruncation();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureTruncation]);

  return (
    <div className="pp-about-block">
      <p
        className={cn("pp-about", !expanded && "pp-about-clamped")}
        data-testid="user-profile-description"
        ref={textRef}
      >
        {about}
      </p>
      {!expanded && isTruncated ? (
        <button
          className="pp-more"
          data-testid="user-profile-description-toggle"
          onClick={() => setExpanded(true)}
          type="button"
        >
          more
        </button>
      ) : null}
      {expanded ? (
        <button
          className="pp-more"
          data-testid="user-profile-description-toggle"
          onClick={() => setExpanded(false)}
          type="button"
        >
          less
        </button>
      ) : null}
    </div>
  );
}
