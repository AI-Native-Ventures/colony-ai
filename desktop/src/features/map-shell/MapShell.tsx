import * as React from "react";
import { useLocation } from "@tanstack/react-router";
import { ChevronDown, LogOut, Menu, Power, Search } from "lucide-react";
import { toast } from "sonner";

import { mapShellTrailForPath } from "@/app/topBarBreadcrumbs";
import { useNeedsYouSummary } from "@/features/cofounder/needsYouSummary";
import { WorkspaceMark } from "@/features/communities/ui/WorkspaceMark";
import { WorkspaceSwitcherMenu } from "@/features/communities/ui/WorkspaceSwitcherMenu";
import type { Community } from "@/features/communities/types";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { ProfilePopover } from "@/features/profile/ui/ProfilePopover";
import { useSelfProfileCache } from "@/features/profile/hooks";
import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  getThemePair,
  type SyntaxThemeName,
} from "@/shared/theme/theme-loader";
import { signOutKeepData } from "@/shared/api/tauriIdentity";
import type {
  Channel,
  PresenceStatus,
  Profile,
  SearchHit,
  UserSearchResult,
  UserStatus,
} from "@/shared/api/types";
import type { UserStatusInput } from "@/features/user-status/types";
import type { SettingsSection } from "@/features/settings/ui/SettingsPanels";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import { ChatsMenu, ChatsMenuContent } from "./ChatsMenu";
import "./MapShell.css";

type MapShellProps = {
  activeWorkspace: Community | null;
  channels: Channel[];
  currentChannelId: string | null;
  currentPubkey?: string;
  fallbackDisplayName?: string;
  homeBadgeCount: number;
  onActivity: () => void;
  onBrowseChannels: () => void;
  onClients: () => void;
  onCopyWorkspaceLink: () => void;
  onCreateAgent: () => void;
  onCreateChannel: () => void;
  onCreateWorkspace: () => void;
  onGoHome: () => void;
  onInvitePeople: () => void;
  onJoinWorkspace: () => void;
  onOpenChannel: (channelId: string) => void;
  onOpenResult: (hit: SearchHit, query: string) => void;
  onOpenSearch: () => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onOpenUser?: (user: UserSearchResult) => void | Promise<void>;
  onOpenWhatsAppContact: (channelId: string, waId: string) => void;
  onOpenWorkspaceSettings: () => void;
  onPower: () => void;
  onSendFeedback?: () => void;
  onSetPresenceStatus: (status: PresenceStatus) => void;
  onSetUserStatus: (status: UserStatusInput) => void;
  onClearUserStatus: () => void;
  onSwitchWorkspace: (id: string) => void;
  onTeam: () => void;
  onNeedsYou: () => void;
  presenceStatus: PresenceStatus;
  isPresencePending: boolean;
  profile?: Profile;
  searchFocusRequest: number;
  selfUserStatus?: UserStatus;
  unreadChannelIds: ReadonlySet<string>;
  unreadChannelCounts: ReadonlyMap<string, number>;
  workspaces: Community[];
};

function MapMark({ activePart }: { activePart?: string }) {
  const partFill = (part: string, inactiveToken: string) =>
    activePart === part
      ? "hsl(var(--colony-accent))"
      : `hsl(var(${inactiveToken}))`;

  return (
    <svg aria-hidden="true" className="map-shell-map-mark" viewBox="0 0 28 28">
      <circle cx="14" cy="14" r="4.5" fill="hsl(var(--colony-fg-secondary))" />
      <circle
        cx="24"
        cy="7"
        r="3"
        data-active={activePart === "Sales" ? "true" : undefined}
        data-part="Sales"
        fill={partFill("Sales", "--colony-fg")}
      />
      <circle
        cx="24"
        cy="21"
        r="3"
        data-active={activePart === "Finance" ? "true" : undefined}
        data-part="Finance"
        fill={partFill("Finance", "--colony-border-strong")}
      />
      <circle
        cx="4"
        cy="5"
        r="3"
        data-active={activePart === "Operations" ? "true" : undefined}
        data-part="Operations"
        fill={partFill("Operations", "--colony-fg")}
      />
      <circle
        cx="3"
        cy="14"
        r="3"
        data-active={activePart === "Customer Success" ? "true" : undefined}
        data-part="Customer Success"
        fill={partFill("Customer Success", "--colony-border-strong")}
      />
      <circle
        cx="4"
        cy="23"
        r="3"
        data-active={activePart === "Brand" ? "true" : undefined}
        data-part="Brand"
        fill={partFill("Brand", "--colony-border-strong")}
      />
    </svg>
  );
}

function ActivityBellIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.1"
      viewBox="0 0 24 24"
    >
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

function NeedYouButton({
  count,
  onClick,
}: {
  count: number | undefined;
  onClick: () => void;
}) {
  const label =
    count === undefined
      ? "Needs you"
      : count > 0
        ? `${count} need you`
        : "Nothing needs you";

  return (
    <button
      aria-label={label}
      className="map-shell-needs-button"
      data-testid="map-shell-needs-you"
      data-empty={count === 0 ? "true" : undefined}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function AccountMenu({
  currentPubkey,
  fallbackDisplayName,
  onOpenSettings,
  onPower,
  onSendFeedback,
  onSetPresenceStatus,
  onSetUserStatus,
  onClearUserStatus,
  presenceStatus,
  isPresencePending,
  profile,
  selfUserStatus,
}: Pick<
  MapShellProps,
  | "currentPubkey"
  | "fallbackDisplayName"
  | "onOpenSettings"
  | "onPower"
  | "onSendFeedback"
  | "onSetPresenceStatus"
  | "onSetUserStatus"
  | "onClearUserStatus"
  | "presenceStatus"
  | "isPresencePending"
  | "profile"
  | "selfUserStatus"
>) {
  const selfProfileCache = useSelfProfileCache();
  const isMobile = useIsMobile();
  const {
    accentColor,
    applyAppearance,
    fieldColors,
    isDark,
    selectedThemeName,
  } = useTheme();
  const [open, setOpen] = React.useState(false);
  const displayName =
    profile?.displayName?.trim() ||
    fallbackDisplayName?.trim() ||
    "Your profile";
  const toggleTheme = React.useCallback(() => {
    const paired = getThemePair(selectedThemeName as SyntaxThemeName);
    applyAppearance({
      accent: accentColor,
      field: fieldColors,
      followSystem: false,
      theme: paired ?? (isDark ? "buzz" : "buzz-dark"),
    });
  }, [accentColor, applyAppearance, fieldColors, isDark, selectedThemeName]);
  const handleSignOut = React.useCallback(async () => {
    try {
      await signOutKeepData();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Sign out could not be completed.",
      );
    }
  }, []);
  const extraMenuItems = (
    <>
      <button
        className="pm-row"
        data-testid="map-shell-power"
        onClick={() => {
          setOpen(false);
          window.requestAnimationFrame(onPower);
        }}
        role="menuitem"
        type="button"
      >
        <Power className="size-[1.125rem]" />
        <span className="pm-row-label">Power</span>
      </button>
      <button
        className="pm-row"
        data-testid="map-shell-signout"
        onClick={() => {
          setOpen(false);
          void handleSignOut();
        }}
        role="menuitem"
        type="button"
      >
        <LogOut className="size-[1.125rem]" />
        <span className="pm-row-label">Sign out</span>
      </button>
    </>
  );

  return (
    <ProfilePopover
      additionalMenuItems={extraMenuItems}
      align="end"
      avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
      avatarUrl={profile?.avatarUrl ?? null}
      currentStatus={presenceStatus}
      displayName={displayName}
      isDark={isDark}
      isStatusPending={isPresencePending}
      jobTitle={profile?.jobTitle ?? null}
      largeTouchTargets={isMobile}
      onClearUserStatus={onClearUserStatus}
      onOpenChange={setOpen}
      onOpenSettings={onOpenSettings}
      onSendFeedback={onSendFeedback}
      onSetStatus={onSetPresenceStatus}
      onSetUserStatus={onSetUserStatus}
      onToggleTheme={toggleTheme}
      open={open}
      placement={isMobile ? "top" : "bottom"}
      pubkey={profile?.pubkey ?? currentPubkey}
      userStatusEmoji={selfUserStatus?.emoji}
      userStatusExpiresAt={selfUserStatus?.expiresAt}
      userStatusText={selfUserStatus?.text}
      userStatusUpdatedAt={selfUserStatus?.updatedAt}
    >
      <button
        aria-label={`Open profile menu for ${displayName}`}
        className="map-shell-avatar-trigger"
        data-testid="map-shell-avatar"
        type="button"
      >
        <ProfileAvatar
          avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
          avatarUrl={profile?.avatarUrl ?? null}
          className="map-shell-avatar-image"
          label={displayName}
          pubkey={profile?.pubkey ?? currentPubkey}
          testId="map-shell-avatar-image"
        />
      </button>
    </ProfilePopover>
  );
}

export function MapShell({
  activeWorkspace,
  channels,
  currentChannelId,
  currentPubkey,
  fallbackDisplayName,
  homeBadgeCount,
  onActivity,
  onBrowseChannels,
  onClients,
  onCopyWorkspaceLink,
  onCreateAgent,
  onCreateChannel,
  onCreateWorkspace,
  onGoHome,
  onInvitePeople,
  onJoinWorkspace,
  onOpenChannel,
  onOpenResult,
  onOpenSearch,
  onOpenSettings,
  onOpenUser,
  onOpenWhatsAppContact,
  onOpenWorkspaceSettings,
  onPower,
  onSendFeedback,
  onSetPresenceStatus,
  onSetUserStatus,
  onClearUserStatus,
  onSwitchWorkspace,
  onTeam,
  onNeedsYou,
  presenceStatus,
  isPresencePending,
  profile,
  searchFocusRequest,
  selfUserStatus,
  unreadChannelIds,
  unreadChannelCounts,
  workspaces,
}: MapShellProps) {
  const location = useLocation();
  const { data: needsYouSummary } = useNeedsYouSummary();
  const needsYouTotal = needsYouSummary?.total;
  const isHome =
    location.pathname === "/" || location.pathname === "/company/map";
  const activeChannel = channels.find(
    (channel) => channel.id === currentChannelId,
  );
  const trail = mapShellTrailForPath(location.pathname, {
    channelName: activeChannel?.name,
  });
  const activePart = trail && "part" in trail ? trail.part : undefined;
  const workspaceName = activeWorkspace?.name ?? "No workspace";
  const workspaceInitial =
    workspaceName.trim().slice(0, 1).toUpperCase() || "C";
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const profileMenu = (
    <AccountMenu
      currentPubkey={currentPubkey}
      fallbackDisplayName={fallbackDisplayName}
      isPresencePending={isPresencePending}
      onClearUserStatus={onClearUserStatus}
      onOpenSettings={onOpenSettings}
      onPower={onPower}
      onSendFeedback={onSendFeedback}
      onSetPresenceStatus={onSetPresenceStatus}
      onSetUserStatus={onSetUserStatus}
      presenceStatus={presenceStatus}
      profile={profile}
      selfUserStatus={selfUserStatus}
    />
  );
  const chatProps = {
    channels,
    currentPubkey,
    fallbackDisplayName,
    profile,
    unreadChannelIds,
    unreadChannelCounts,
    onOpenChannel,
    onOpenWhatsAppContact,
  };

  return (
    <header
      className="map-shell-bar"
      data-home={isHome ? "true" : undefined}
      data-testid="map-shell-bar"
    >
      <div className="map-shell-left">
        {isHome ? (
          <WorkspaceSwitcherMenu
            activeWorkspace={activeWorkspace}
            onCopyWorkspaceLink={onCopyWorkspaceLink}
            onCreateWorkspace={onCreateWorkspace}
            onInvitePeople={onInvitePeople}
            onJoinWorkspace={onJoinWorkspace}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            onSwitchWorkspace={onSwitchWorkspace}
            renderTrigger={({ open }) => (
              <button
                aria-expanded={open}
                aria-haspopup="dialog"
                aria-label={`Switch workspace, current workspace ${workspaceName}`}
                className="map-shell-company-trigger"
                data-testid="map-shell-company"
                type="button"
              >
                <WorkspaceMark
                  className="map-shell-company-mark"
                  communityIconFit="contain"
                  communityId={activeWorkspace?.id}
                  dataTestId="map-shell-company-mark"
                  fallbackContent={<span>{workspaceInitial}</span>}
                  imageFit="contain"
                  name={workspaceName}
                  relayUrl={activeWorkspace?.relayUrl}
                />
                <span className="map-shell-company-name">{workspaceName}</span>
              </button>
            )}
            renderWorkspaceMark={(workspace) => (
              <WorkspaceMark
                className="map-shell-workspace-choice-mark"
                communityIconFit="contain"
                communityId={workspace.id}
                fallbackContent={
                  <span>
                    {workspace.name.trim().slice(0, 1).toUpperCase() || "C"}
                  </span>
                }
                imageFit="contain"
                name={workspace.name}
                relayUrl={workspace.relayUrl}
              />
            )}
            workspaces={workspaces}
          />
        ) : (
          <>
            <button
              aria-label="Company map"
              className="map-shell-map-button"
              data-testid="map-shell-map-button"
              onClick={onGoHome}
              type="button"
            >
              <MapMark activePart={activePart} />
              <span>Map</span>
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
            {trail ? (
              <nav
                aria-label="Breadcrumb"
                className="map-shell-trail"
                data-testid="map-shell-trail"
              >
                {"part" in trail ? (
                  <>
                    <span className="map-shell-trail-part">{trail.part}</span>
                    <span
                      aria-hidden="true"
                      className="map-shell-trail-separator"
                    >
                      /
                    </span>
                    <span className="map-shell-trail-job">{trail.job}</span>
                  </>
                ) : (
                  <span className="map-shell-trail-screen">{trail.screen}</span>
                )}
              </nav>
            ) : null}
          </>
        )}
      </div>
      <div className="map-shell-spacer" />
      <div className="map-shell-desktop-actions">
        <ChatsMenu {...chatProps} />
        <nav aria-label="Company" className="map-shell-company-nav">
          <button
            className="map-shell-nav-button"
            data-testid="map-shell-customers"
            onClick={onClients}
            type="button"
          >
            Customers
          </button>
          <button
            className="map-shell-nav-button"
            data-testid="map-shell-team"
            onClick={onTeam}
            type="button"
          >
            Team
          </button>
        </nav>
        <div className="map-shell-search">
          <TopbarSearch
            channels={channels}
            currentChannelId={currentChannelId}
            currentPubkey={currentPubkey}
            focusRequest={searchFocusRequest}
            onBrowseChannels={onBrowseChannels}
            onCreateAgent={onCreateAgent}
            onCreateChannel={onCreateChannel}
            onOpenChannel={onOpenChannel}
            onOpenResult={onOpenResult}
            onOpenUser={onOpenUser}
            variant="icon"
          />
        </div>
        <button
          aria-label="Activity"
          className="map-shell-icon-button"
          data-testid="map-shell-activity"
          onClick={onActivity}
          type="button"
        >
          <ActivityBellIcon />
          {homeBadgeCount > 0 ? (
            <span aria-hidden="true" className="map-shell-bell-dot" />
          ) : null}
        </button>
        <NeedYouButton count={needsYouTotal} onClick={onNeedsYou} />
        {profileMenu}
      </div>
      <div className="map-shell-mobile-actions">
        <NeedYouButton count={needsYouTotal} onClick={onNeedsYou} />
        <button
          aria-expanded={mobileMenuOpen}
          aria-haspopup="dialog"
          aria-label="Open menu"
          className="map-shell-icon-button"
          data-testid="map-shell-mobile-menu-button"
          onClick={() => setMobileMenuOpen(true)}
          type="button"
        >
          <Menu aria-hidden="true" />
        </button>
        <Sheet onOpenChange={setMobileMenuOpen} open={mobileMenuOpen}>
          <SheetContent
            aria-describedby={undefined}
            className="map-shell-mobile-sheet"
            data-testid="map-shell-mobile-sheet"
            side="bottom"
          >
            <div aria-hidden="true" className="map-shell-sheet-handle" />
            <SheetHeader className="map-shell-sheet-header">
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav aria-label="Company" className="map-shell-mobile-nav">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onClients();
                }}
                type="button"
              >
                Customers
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onTeam();
                }}
                type="button"
              >
                Team
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onActivity();
                }}
                type="button"
              >
                Activity
              </button>
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenSearch();
                }}
                type="button"
              >
                <Search
                  aria-hidden="true"
                  className="map-shell-mobile-search-icon"
                />
                Search
              </button>
            </nav>
            <h2 className="map-shell-group-heading">Chats</h2>
            <div className="map-shell-mobile-chats">
              <ChatsMenuContent
                {...chatProps}
                onOpenChannel={(channelId) => {
                  setMobileMenuOpen(false);
                  onOpenChannel(channelId);
                }}
                onOpenWhatsAppContact={(channelId, waId) => {
                  setMobileMenuOpen(false);
                  onOpenWhatsAppContact(channelId, waId);
                }}
              />
            </div>
            <div className="map-shell-mobile-account">{profileMenu}</div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
