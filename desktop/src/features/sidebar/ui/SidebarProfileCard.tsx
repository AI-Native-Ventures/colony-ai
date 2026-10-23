import * as React from "react";

import { getPresenceLabel } from "@/features/presence/lib/presence";
import { PresenceDot } from "@/features/presence/ui/PresenceBadge";
import { useSelfProfileCache } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { ProfilePopover } from "@/features/profile/ui/ProfilePopover";
import { StatusEmoji } from "@/features/user-status/ui/StatusEmoji";
import type { UserStatusInput } from "@/features/user-status/types";
import type { LeaveCommunityResult } from "@/features/communities/leaveCommunity";
import type { Community } from "@/features/communities/types";
import { CommunitySwitcher } from "@/features/communities/ui/CommunitySwitcher";
import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import type { SettingsSection } from "@/features/settings/ui/SettingsPanels";
import type { PresenceStatus, Profile, UserStatus } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  getThemePair,
  type SyntaxThemeName,
} from "@/shared/theme/theme-loader";
import { OPEN_SIDEBAR_PROFILE_POPOVER_EVENT } from "@/features/sidebar/lib/profilePopoverOpenEvent";

type SidebarProfileCardProps = {
  activeCommunity: Community | null;
  isPresencePending?: boolean;
  onOpenAddCommunity: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onRemoveCommunity: (id: string) => Promise<LeaveCommunityResult | undefined>;
  onSendFeedback?: () => void;
  onSetPresenceStatus?: (status: PresenceStatus) => void;
  onSetUserStatus: (status: UserStatusInput) => void;
  onClearUserStatus: () => void;
  onSwitchCommunity: (id: string) => void;
  onUpdateCommunity: (
    id: string,
    updates: Partial<Pick<Community, "name" | "relayUrl" | "token">>,
  ) => void;
  profile?: Profile;
  resolvedDisplayName: string;
  selfPresenceStatus: PresenceStatus;
  selfUserStatus?: UserStatus;
  communities: Community[];
};

export function SidebarProfileCard({
  activeCommunity,
  isPresencePending,
  onOpenAddCommunity,
  onOpenSettings,
  onSendFeedback,
  onRemoveCommunity,
  onSetPresenceStatus,
  onSetUserStatus,
  onClearUserStatus,
  onSwitchCommunity,
  onUpdateCommunity,
  profile,
  resolvedDisplayName,
  selfPresenceStatus,
  selfUserStatus,
  communities,
}: SidebarProfileCardProps) {
  const selfProfileCache = useSelfProfileCache();
  const {
    accentColor,
    applyAppearance,
    fieldColors,
    isDark,
    selectedThemeName,
  } = useTheme();
  const myMembershipQuery = useMyRelayMembershipLookupQuery();
  const activeRole = myMembershipQuery.data?.membership?.role;
  const canInvite = activeRole === "owner" || activeRole === "admin";
  const [profilePopoverOpen, setProfilePopoverOpen] = React.useState(false);
  const profileCardRef = React.useRef<HTMLDivElement | null>(null);
  const toggleProfilePopover = React.useCallback(
    () => setProfilePopoverOpen((prev) => !prev),
    [],
  );
  const handleCardClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !profileCardRef.current?.contains(target)
      ) {
        return;
      }
      toggleProfilePopover();
    },
    [toggleProfilePopover],
  );
  const hasStatus = Boolean(selfUserStatus?.text || selfUserStatus?.emoji);

  React.useEffect(() => {
    const openProfilePopover = () => setProfilePopoverOpen(true);
    window.addEventListener(
      OPEN_SIDEBAR_PROFILE_POPOVER_EVENT,
      openProfilePopover,
    );
    return () =>
      window.removeEventListener(
        OPEN_SIDEBAR_PROFILE_POPOVER_EVENT,
        openProfilePopover,
      );
  }, []);

  const toggleTheme = React.useCallback(() => {
    const pairedTheme = getThemePair(selectedThemeName as SyntaxThemeName);
    applyAppearance({
      accent: accentColor,
      field: fieldColors,
      followSystem: false,
      theme: pairedTheme ?? (isDark ? "buzz" : "buzz-dark"),
    });
  }, [accentColor, applyAppearance, fieldColors, isDark, selectedThemeName]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: child buttons provide keyboard access; wrapper fills pointer gaps between them.
    <div
      className="group/profile-card cursor-pointer rounded-xl px-2 py-2 transition-colors hover:bg-sidebar-border/35"
      data-testid="sidebar-profile-card"
      onClick={handleCardClick}
      ref={profileCardRef}
    >
      <div className="colony-sidebar-profile-row flex min-w-0 items-center gap-2">
        <button
          aria-label={`Open profile menu for ${resolvedDisplayName}`}
          className="relative shrink-0 rounded-xl outline-hidden focus:outline-none focus-visible:outline-none"
          data-testid="sidebar-profile-avatar-button"
          onClick={(event) => {
            event.stopPropagation();
            toggleProfilePopover();
          }}
          type="button"
        >
          <span className="colony-sidebar-profile-avatar">
            <ProfileAvatar
              avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
              avatarUrl={profile?.avatarUrl ?? null}
              className="size-full text-sm"
              iconClassName="h-4 w-4"
              label={resolvedDisplayName}
              testId="sidebar-profile-avatar"
            />
            <span
              aria-label={getPresenceLabel(selfPresenceStatus)}
              className="colony-sidebar-profile-presence"
              data-testid="self-presence-badge"
              role="img"
            >
              <PresenceDot className="size-full" status={selfPresenceStatus} />
            </span>
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <ProfilePopover
            open={profilePopoverOpen}
            onOpenChange={setProfilePopoverOpen}
            avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
            avatarUrl={profile?.avatarUrl ?? null}
            currentStatus={selfPresenceStatus}
            displayName={resolvedDisplayName}
            isStatusPending={isPresencePending}
            onClearUserStatus={onClearUserStatus}
            onOpenSettings={onOpenSettings}
            onSendFeedback={onSendFeedback}
            onSetStatus={onSetPresenceStatus ?? (() => {})}
            onSetUserStatus={onSetUserStatus}
            isDark={isDark}
            onToggleTheme={toggleTheme}
            triggerContainerRef={profileCardRef}
            userStatusEmoji={selfUserStatus?.emoji}
            userStatusExpiresAt={selfUserStatus?.expiresAt}
            userStatusText={selfUserStatus?.text}
            userStatusUpdatedAt={selfUserStatus?.updatedAt}
            communitySwitcherSlot={
              <CommunitySwitcher
                activeCommunity={activeCommunity}
                canInvite={canInvite}
                onAddCommunity={() => {
                  setProfilePopoverOpen(false);
                  onOpenAddCommunity();
                }}
                onInvite={() => {
                  setProfilePopoverOpen(false);
                  onOpenSettings("community-members");
                }}
                onRemoveCommunity={onRemoveCommunity}
                onSwitchCommunity={onSwitchCommunity}
                onUpdateCommunity={onUpdateCommunity}
                variant="profile-menu"
                communities={communities}
              />
            }
          >
            <button
              onClick={(event) => {
                event.stopPropagation();
                toggleProfilePopover();
              }}
              className="block w-full min-w-0 rounded-sm text-left text-sidebar-foreground outline-hidden focus:outline-none focus-visible:outline-none"
              data-testid="open-settings"
              type="button"
            >
              <p
                className="truncate text-sm font-semibold leading-tight text-current"
                data-testid="sidebar-profile-name"
              >
                {resolvedDisplayName}
              </p>
            </button>
          </ProfilePopover>

          <button
            aria-label={
              hasStatus
                ? `Open profile menu for ${resolvedDisplayName}`
                : "Set a status"
            }
            className={cn(
              "mt-0.5 flex w-full min-w-0 items-center truncate rounded-sm text-left text-2xs leading-snug text-sidebar-foreground/70 outline-hidden focus-visible:ring-1 focus-visible:ring-sidebar-ring",
              profilePopoverOpen && "opacity-100",
            )}
            data-buzz-sidebar-secondary
            data-testid="sidebar-profile-user-status"
            onClick={(event) => {
              event.stopPropagation();
              toggleProfilePopover();
            }}
            type="button"
          >
            {hasStatus && selfUserStatus?.emoji ? (
              <StatusEmoji
                className="mr-1 w-4 shrink-0 text-xs"
                value={selfUserStatus.emoji}
              />
            ) : null}
            <span className="truncate">
              {hasStatus ? selfUserStatus?.text : "Set a status"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
