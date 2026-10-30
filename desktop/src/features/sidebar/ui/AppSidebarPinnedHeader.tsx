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
  TodayIcon,
} from "@/shared/ui/colonyIcons";

type SidebarSelectedView =
  | "today"
  | "home"
  | "channel"
  | "messages"
  | "agents"
  | "clients"
  | "work"
  | "business"
  | "team"
  | "pins";

type AppSidebarPinnedHeaderProps = {
  activeCommunityName: string;
  channelLabels: Record<string, string>;
  currentChannelId?: string | null;
  currentPubkey?: string;
  onBrowseChannels?: () => void;
  onCreateAgent: () => void;
  onCreateChannel: () => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit, query: string) => void;
  onSelectChannel: (channelId: string) => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  showSidebarCollapseButton: boolean;
  scopeSearchFocusRequest: number;
  suggestionChannels: Channel[];
};

type AppSidebarPrimaryMenuProps = {
  homeBadgeCount: number;
  onSelectToday: () => void;
  onSelectHome: () => void;
  suppressActivitySelection?: boolean;
  suppressTodaySelection?: boolean;
  selectedView: SidebarSelectedView;
};

export function AppSidebarPinnedHeader({
  activeCommunityName,
  channelLabels,
  currentChannelId,
  currentPubkey,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  onOpenDm,
  onOpenSearchResult,
  onSelectChannel,
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
        <button
          aria-label={`Open business switcher, current business ${activeCommunityName || "No community"}`}
          data-testid="sidebar-business-switcher"
          onClick={() =>
            window.dispatchEvent(new Event(OPEN_SIDEBAR_PROFILE_POPOVER_EVENT))
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
    </div>
  );
}

export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onSelectToday,
  onSelectHome,
  suppressActivitySelection = false,
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
            isActive={selectedView === "home" && !suppressActivitySelection}
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
      </SidebarMenu>
    </SidebarHeader>
  );
}
