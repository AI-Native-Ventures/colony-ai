import { ArrowLeft } from "lucide-react";

import { isMacPlatform } from "@/shared/lib/platform";
import { useIsFullscreen } from "@/shared/lib/useIsFullscreen";
import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { OPEN_SIDEBAR_PROFILE_POPOVER_EVENT } from "@/features/sidebar/lib/profilePopoverOpenEvent";
import type { Channel, SearchHit } from "@/shared/api/types";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import { useSidebar } from "@/shared/ui/sidebar";
import {
  ActivityIcon,
  CollapseSidebarIcon,
  ExpandSidebarIcon,
  SavedIcon,
  TodayIcon,
} from "@/shared/ui/colonyIcons";
import colonyIcon from "../assets/colony-icon-v2.svg";

type SidebarSelectedView =
  | "today"
  | "home"
  | "channel"
  | "messages"
  | "agents"
  | "workflows"
  | "clients"
  | "work"
  | "pulse"
  | "projects"
  | "business"
  | "factory"
  | "team"
  | "goals"
  | "pins";

type AppSidebarPinnedHeaderProps = {
  activeCommunityName: string;
  factoryView?: boolean;
  channelLabels: Record<string, string>;
  currentChannelId?: string | null;
  currentPubkey?: string;
  onBrowseChannels?: () => void;
  onCreateAgent: () => void;
  onCreateChannel: () => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit, query: string) => void;
  onSelectChannel: (channelId: string) => void;
  onReturnToWorkspace?: () => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  showSidebarCollapseButton: boolean;
  scopeSearchFocusRequest: number;
  suggestionChannels: Channel[];
};

type AppSidebarPrimaryMenuProps = {
  homeBadgeCount: number;
  isSavedForLaterActive: boolean;
  onSelectSavedForLater: () => void;
  onSelectToday: () => void;
  onSelectHome: () => void;
  suppressTodaySelection?: boolean;
  selectedView: SidebarSelectedView;
};

export function AppSidebarPinnedHeader({
  activeCommunityName,
  factoryView = false,
  channelLabels,
  currentChannelId,
  currentPubkey,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  onOpenDm,
  onOpenSearchResult,
  onSelectChannel,
  onReturnToWorkspace,
  searchChannels,
  searchFocusRequest,
  showSidebarCollapseButton,
  scopeSearchFocusRequest,
  suggestionChannels,
}: AppSidebarPinnedHeaderProps) {
  const sidebar = useSidebar();
  const isFullscreen = useIsFullscreen();
  const communityInitial =
    activeCommunityName.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <div
      className="shrink-0"
      data-testid="sidebar-pinned-header"
      data-mac-chrome={isMacPlatform() && !isFullscreen ? "true" : undefined}
    >
      <div className="colony-sidebar-brand">
        {factoryView ? (
          <div
            className="flex min-w-0 flex-1 items-center gap-2 px-1.5"
            data-testid="factory-sidebar-brand"
          >
            <img
              alt=""
              aria-hidden="true"
              className="h-[26px] w-[26px] rounded-md"
              src={colonyIcon}
            />
            <span className="colony-sidebar-wordmark min-w-0 truncate">
              colony
            </span>
          </div>
        ) : (
          <button
            aria-label={`Open business switcher, current business ${activeCommunityName || "No community"}`}
            data-testid="sidebar-business-switcher"
            onClick={() =>
              window.dispatchEvent(
                new Event(OPEN_SIDEBAR_PROFILE_POPOVER_EVENT),
              )
            }
            type="button"
          >
            <span aria-hidden="true" className="colony-sidebar-brand-mark">
              {communityInitial}
              <span className="colony-sidebar-brand-dot" />
            </span>
            <span className="sidebar-company-name">
              <span>{activeCommunityName || "No community"}</span>
              <span className="sidebar-company-context">Company workspace</span>
            </span>
          </button>
        )}
        {showSidebarCollapseButton ? (
          <button
            aria-expanded={sidebar.open}
            aria-label="Toggle Sidebar"
            className="colony-sidebar-collapse"
            data-sidebar="trigger"
            onClick={sidebar.toggleSidebar}
            type="button"
          >
            {sidebar.open ? (
              <CollapseSidebarIcon size={18} />
            ) : (
              <ExpandSidebarIcon size={18} />
            )}
          </button>
        ) : null}
      </div>
      {factoryView ? (
        <button
          className="fx-sidebar-workspace-link"
          data-testid="factory-return-to-workspace"
          onClick={onReturnToWorkspace}
          type="button"
        >
          <ArrowLeft aria-hidden="true" />
          <span>
            <strong>{activeCommunityName}</strong>
            <small>Business workspace</small>
          </span>
        </button>
      ) : (
        <TopbarSearch
          channelLabels={channelLabels}
          channels={searchChannels}
          currentChannelId={currentChannelId}
          currentPubkey={currentPubkey}
          focusRequest={searchFocusRequest}
          onOpenChannel={onSelectChannel}
          onOpenResult={onOpenSearchResult}
          onOpenUser={(user) => onOpenDm({ pubkeys: [user.pubkey] })}
          onBrowseChannels={onBrowseChannels}
          onCreateAgent={onCreateAgent}
          onCreateChannel={onCreateChannel}
          scopeFocusRequest={scopeSearchFocusRequest}
          suggestionChannels={suggestionChannels}
        />
      )}
    </div>
  );
}

export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onSelectToday,
  onSelectHome,
  isSavedForLaterActive,
  onSelectSavedForLater,
  suppressTodaySelection = false,
  selectedView,
}: AppSidebarPrimaryMenuProps) {
  return (
    <SidebarHeader
      className="relative z-40 cursor-default select-none"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <SidebarMenu className="sidebar-primary-menu">
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={selectedView === "today" && !suppressTodaySelection}
            onClick={(event) => {
              const button = event.currentTarget;
              onSelectToday();
              window.requestAnimationFrame(() => {
                if (button.isConnected) button.focus({ preventScroll: true });
              });
            }}
            tooltip="Today"
            type="button"
          >
            <TodayIcon />
            <SidebarMenuLabel>Today</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem data-testid="sidebar-activity-item">
          <SidebarMenuButton
            data-testid="sidebar-activity-button"
            isActive={selectedView === "home"}
            onClick={() => {
              onSelectHome();
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLButtonElement>(
                      '[data-testid="sidebar-activity-button"]',
                    )
                    ?.focus({ preventScroll: true });
                });
              });
            }}
            tooltip="Activity"
            type="button"
          >
            <ActivityIcon />
            <SidebarMenuLabel>Activity</SidebarMenuLabel>
          </SidebarMenuButton>
          {homeBadgeCount > 0 ? (
            <SidebarMenuBadge data-testid="sidebar-home-count">
              {Math.min(homeBadgeCount, 99)}
            </SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="sidebar-saved-for-later"
            isActive={isSavedForLaterActive}
            onClick={onSelectSavedForLater}
            tooltip="Saved for later"
            type="button"
          >
            <SavedIcon />
            <SidebarMenuLabel>Saved for later</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}
