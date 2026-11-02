import type * as React from "react";

import { agentPresenceStartBlockReason } from "@/features/agents/lib/useAgentAvailability";
import {
  Ban,
  CircleSlash,
  Clock,
  Pencil,
  Play,
  RotateCcw,
  Shield,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";

import {
  getManagedAgentPrimaryActionLabel,
  isManagedAgentActive,
} from "@/features/agents/lib/managedAgentControlActions";
import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { PresenceDot } from "@/features/presence/ui/PresenceBadge";
import {
  agentCommunityAvailability,
  MANAGED_AGENT_PAIR_ACTION_LABELS,
  type ManagedAgentPairAction,
} from "@/features/agents/managedAgentRuntimeStatus";
import type {
  ChannelMember,
  ManagedAgent,
  ManagedAgentRuntimeStatus,
  PresenceStatus,
} from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { MoreHorizontalGlyph } from "./dialogIcons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

type MembersSidebarMemberCardProps = {
  canChangeRole: boolean;
  canModerate: boolean;
  canRemoveMember: boolean;
  isActionPending: boolean;
  isArchived: boolean;
  managedAgent?: ManagedAgent;
  managedAgentRuntime?: ManagedAgentRuntimeStatus;
  /** When set, the lifecycle menu item controls this agent+community pair
   * (local agents in a community context) instead of the whole agent. */
  pairAction?: ManagedAgentPairAction;
  member: ChannelMember;
  memberAvatarLabel: string;
  memberIsBot: boolean;
  memberLabel: string;
  moderationState?: MemberModerationState;
  onBan: (member: ChannelMember) => void;
  onChangeRole: (member: ChannelMember, role: string) => void;
  onEditRespondTo?: (agent: ManagedAgent) => void;
  onManagedAgentAction: (agent: ManagedAgent) => void;
  onOpenProfile?: (pubkey: string) => void;
  onRemoveMember: (member: ChannelMember) => void;
  onTimeout: (member: ChannelMember, expiresAtSecs: number) => void;
  onUnban: (member: ChannelMember) => void;
  onUntimeout: (member: ChannelMember) => void;
  presenceStatus?: PresenceStatus | null;
  profileAvatarUrl?: string | null;
  profileOwnerPubkey?: string | null;
};

/** Whether a member is currently banned / timed out (from the restriction read). */
export type MemberModerationState = {
  banned: boolean;
  timedOut: boolean;
};

/** Timeout durations offered in the member menu, in seconds. */
const TIMEOUT_PRESETS: { label: string; seconds: number }[] = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
];

function formatRoleLabel(member: ChannelMember, memberIsBot: boolean) {
  if (memberIsBot) {
    return "agent";
  }

  return member.role;
}

type StatusTone = "good" | "live" | "need" | "quiet";

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  good: "bg-colony-success-bg text-colony-success",
  live: "bg-colony-accent-soft text-colony-accent-ink",
  need: "bg-colony-need-bg text-colony-need",
  quiet: "bg-colony-idle text-colony-fg-secondary",
};

/** The 24px pill under an agent's name: availability, then who it answers. */
function StatusChip({
  children,
  testId,
  tone,
}: {
  children: React.ReactNode;
  testId?: string;
  tone: StatusTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[calc(12.5*var(--colony-px))] font-extrabold",
        STATUS_TONE_CLASS[tone],
      )}
      data-testid={testId}
    >
      {tone === "live" ? (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full bg-colony-accent"
        />
      ) : null}
      {children}
    </span>
  );
}

function availabilityTone(label: string): StatusTone {
  if (label === "Here" || label === "Running") return "good";
  if (label === "Waking") return "live";
  if (label === "Needs setup on this device") return "need";
  return "quiet";
}

function formatRespondToLabel(agent: ManagedAgent) {
  switch (agent.respondTo) {
    case "anyone":
      return "Anyone";
    case "allowlist":
      return `Selected people (${agent.respondToAllowlist.length})`;
    default:
      return "Only me";
  }
}

export function MembersSidebarMemberCard({
  canChangeRole,
  canModerate,
  canRemoveMember,
  isActionPending,
  isArchived,
  managedAgent,
  managedAgentRuntime,
  pairAction,
  member,
  memberAvatarLabel,
  memberIsBot,
  memberLabel,
  moderationState,
  onBan,
  onChangeRole,
  onEditRespondTo,
  onManagedAgentAction,
  onOpenProfile,
  onRemoveMember,
  onTimeout,
  onUnban,
  onUntimeout,
  presenceStatus,
  profileAvatarUrl,
  profileOwnerPubkey,
}: MembersSidebarMemberCardProps) {
  const roleLabel = formatRoleLabel(member, memberIsBot);
  const disabled = isActionPending || isArchived;
  // Community ban/timeout applies to people, never bots, and never the community
  // owner (whom no moderator can restrict).
  const canModerateMember =
    canModerate && !memberIsBot && member.role !== "owner";
  const hasActions = memberIsBot
    ? Boolean(managedAgent) || canRemoveMember
    : canRemoveMember || canChangeRole || canModerateMember;

  const availabilityLabel = managedAgentRuntime
    ? agentCommunityAvailability(managedAgentRuntime)
    : managedAgent
      ? isManagedAgentActive(managedAgent)
        ? "Running"
        : "Stopped"
      : null;

  const memberIdentity = (
    <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-3">
      <div className="relative shrink-0">
        <ProfileAvatar
          avatarUrl={profileAvatarUrl ?? null}
          pubkey={member.pubkey}
          className={cn(
            "text-xs shadow-none",
            memberIsBot ? "size-10" : "size-[2.375rem]",
          )}
          iconClassName="h-4 w-4"
          label={memberAvatarLabel}
          shape={memberIsBot ? "squircle" : "circle"}
        />
        {presenceStatus ? (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-colony-pop"
            data-testid={`sidebar-member-presence-${member.pubkey}`}
          >
            <PresenceDot className="h-2 w-2" status={presenceStatus} />
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {memberIsBot ? (
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-extrabold">
            <span className="truncate">{memberLabel}</span>
            <span className="shrink-0 text-xs font-semibold text-colony-muted">
              {roleLabel}
            </span>
            <AgentManagementMarker
              pubkey={member.pubkey}
              ownerPubkey={profileOwnerPubkey}
              testId={`sidebar-member-agent-provenance-${member.pubkey}`}
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-extrabold">
              {memberLabel}
            </span>
            {roleLabel ? (
              <span className="text-xs font-semibold text-colony-muted">
                {roleLabel}
              </span>
            ) : null}
          </div>
        )}
        {availabilityLabel || managedAgent ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {availabilityLabel ? (
              <StatusChip
                testId={`sidebar-managed-agent-status-${member.pubkey}`}
                tone={availabilityTone(availabilityLabel)}
              >
                {availabilityLabel}
              </StatusChip>
            ) : null}
            {managedAgent ? (
              <StatusChip
                testId={`sidebar-managed-agent-respond-to-${member.pubkey}`}
                tone="quiet"
              >
                {formatRespondToLabel(managedAgent)}
              </StatusChip>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "group/member relative isolate flex items-center gap-3 border-b border-colony-border py-2 text-left",
        memberIsBot ? "min-h-16" : "min-h-[3.75rem]",
      )}
      data-testid={`sidebar-member-${member.pubkey}`}
    >
      {onOpenProfile ? (
        <button
          aria-label={`Open profile for ${memberLabel}`}
          className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          data-testid={`sidebar-member-open-profile-${member.pubkey}`}
          onClick={() => onOpenProfile(member.pubkey)}
          type="button"
        />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 z-0" />
      )}
      {memberIdentity}
      {hasActions ? (
        <MemberActionsMenu
          canChangeRole={canChangeRole}
          canModerateMember={canModerateMember}
          canRemoveMember={canRemoveMember}
          disabled={disabled}
          managedAgent={managedAgent}
          member={member}
          memberIsBot={memberIsBot}
          memberLabel={memberLabel}
          moderationState={moderationState}
          onBan={onBan}
          onChangeRole={onChangeRole}
          onEditRespondTo={onEditRespondTo}
          onManagedAgentAction={onManagedAgentAction}
          onRemoveMember={onRemoveMember}
          onTimeout={onTimeout}
          onUnban={onUnban}
          onUntimeout={onUntimeout}
          pairAction={pairAction}
          availability={presenceStatus ?? undefined}
        />
      ) : null}
    </div>
  );
}

const PEOPLE_ROLES = ["admin", "member", "guest"] as const;

function MemberActionsMenu({
  availability,
  canChangeRole,
  canModerateMember,
  canRemoveMember,
  disabled,
  managedAgent,
  member,
  memberIsBot,
  memberLabel,
  moderationState,
  onBan,
  onChangeRole,
  onEditRespondTo,
  onManagedAgentAction,
  onRemoveMember,
  onTimeout,
  onUnban,
  onUntimeout,
  pairAction,
}: {
  canChangeRole: boolean;
  availability: PresenceStatus | undefined;
  canModerateMember: boolean;
  canRemoveMember: boolean;
  disabled: boolean;
  managedAgent?: ManagedAgent;
  member: ChannelMember;
  memberIsBot: boolean;
  memberLabel: string;
  moderationState?: MemberModerationState;
  onBan: (member: ChannelMember) => void;
  onChangeRole: (member: ChannelMember, role: string) => void;
  onEditRespondTo?: (agent: ManagedAgent) => void;
  onManagedAgentAction: (agent: ManagedAgent) => void;
  onRemoveMember: (member: ChannelMember) => void;
  onTimeout: (member: ChannelMember, expiresAtSecs: number) => void;
  onUnban: (member: ChannelMember) => void;
  onUntimeout: (member: ChannelMember) => void;
  pairAction?: ManagedAgentPairAction;
}) {
  const showChangeRole =
    canChangeRole && !memberIsBot && member.role !== "owner";
  const isBanned = moderationState?.banned ?? false;
  const isTimedOut = moderationState?.timedOut ?? false;

  const startBlockReason = managedAgent
    ? agentPresenceStartBlockReason(
        pairAction ? pairAction === "stop" : isManagedAgentActive(managedAgent),
        availability,
      )
    : undefined;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Actions for ${memberLabel}`}
          className="relative z-20 flex size-9 shrink-0 items-center justify-center rounded-[0.625rem] text-colony-fg-secondary hover:bg-colony-track hover:text-colony-fg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40 data-[state=open]:bg-colony-track"
          data-testid={`sidebar-member-menu-${member.pubkey}`}
          type="button"
        >
          <MoreHorizontalGlyph size={17} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {memberIsBot && managedAgent ? (
          <>
            <DropdownMenuItem
              data-testid={`sidebar-agent-action-${member.pubkey}`}
              disabled={disabled || Boolean(startBlockReason)}
              title={startBlockReason}
              onClick={() => {
                if (!startBlockReason) onManagedAgentAction(managedAgent);
              }}
            >
              {pairAction
                ? getPairActionIcon(pairAction)
                : getManagedAgentActionIcon(managedAgent)}
              {pairAction
                ? MANAGED_AGENT_PAIR_ACTION_LABELS[pairAction]
                : getManagedAgentPrimaryActionLabel(managedAgent)}
            </DropdownMenuItem>
            {onEditRespondTo ? (
              <DropdownMenuItem
                data-testid={`sidebar-edit-respond-to-${member.pubkey}`}
                disabled={disabled}
                onClick={() => onEditRespondTo(managedAgent)}
              >
                <Pencil className="h-4 w-4" />
                Manage agent access...
              </DropdownMenuItem>
            ) : null}
            {canRemoveMember || showChangeRole ? (
              <DropdownMenuSeparator />
            ) : null}
          </>
        ) : null}
        {showChangeRole ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              data-testid={`sidebar-change-role-${member.pubkey}`}
              disabled={disabled}
            >
              <Shield className="h-4 w-4" />
              Change role
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {PEOPLE_ROLES.map((role) => (
                <DropdownMenuItem
                  data-testid={`sidebar-role-${role}-${member.pubkey}`}
                  disabled={disabled || member.role === role}
                  key={role}
                  onClick={() => onChangeRole(member, role)}
                >
                  {role[0]?.toUpperCase()}
                  {role.slice(1)}
                  {member.role === role ? " (current)" : ""}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {canRemoveMember ? (
          <>
            {showChangeRole ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              data-testid={`sidebar-remove-member-${member.pubkey}`}
              disabled={disabled}
              onClick={() => onRemoveMember(member)}
            >
              <Trash2 className="h-4 w-4" />
              Remove from channel
            </DropdownMenuItem>
          </>
        ) : null}
        {canModerateMember ? (
          <>
            {canRemoveMember || showChangeRole ? (
              <DropdownMenuSeparator />
            ) : null}
            {isTimedOut ? (
              <DropdownMenuItem
                data-testid={`sidebar-untimeout-${member.pubkey}`}
                disabled={disabled}
                onClick={() => onUntimeout(member)}
              >
                <ShieldCheck className="h-4 w-4" />
                Lift timeout
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  data-testid={`sidebar-timeout-${member.pubkey}`}
                  disabled={disabled}
                >
                  <Clock className="h-4 w-4" />
                  Time out
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {TIMEOUT_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      data-testid={`sidebar-timeout-${preset.seconds}-${member.pubkey}`}
                      disabled={disabled}
                      key={preset.seconds}
                      onClick={() =>
                        onTimeout(
                          member,
                          Math.floor(Date.now() / 1000) + preset.seconds,
                        )
                      }
                    >
                      {preset.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {isBanned ? (
              <DropdownMenuItem
                data-testid={`sidebar-unban-${member.pubkey}`}
                disabled={disabled}
                onClick={() => onUnban(member)}
              >
                <CircleSlash className="h-4 w-4" />
                Lift ban
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                data-testid={`sidebar-ban-${member.pubkey}`}
                disabled={disabled}
                onClick={() => onBan(member)}
              >
                <Ban className="h-4 w-4" />
                Ban from community
              </DropdownMenuItem>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getPairActionIcon(action: ManagedAgentPairAction) {
  if (action === "stop") return <Square className="h-4 w-4" />;
  if (action === "restart") return <RotateCcw className="h-4 w-4" />;
  return <Play className="h-4 w-4" />;
}

function getManagedAgentActionIcon(agent: ManagedAgent) {
  if (isManagedAgentActive(agent)) {
    return <Square className="h-4 w-4" />;
  }

  if (agent.backend.type === "local" && agent.status === "stopped") {
    return <RotateCcw className="h-4 w-4" />;
  }

  return <Play className="h-4 w-4" />;
}
