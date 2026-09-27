import * as React from "react";
import {
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  House,
} from "lucide-react";

import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { OPEN_SIDEBAR_PROFILE_POPOVER_EVENT } from "@/features/sidebar/lib/profilePopoverOpenEvent";
import type { Channel, SearchHit } from "@/shared/api/types";
import {
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import { Button } from "@/shared/ui/button";
import { useSidebar } from "@/shared/ui/sidebar";
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
  const communityInitial =
    activeCommunityName.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <div
      className="mx-[3px] shrink-0 px-2 pb-2 pt-2"
      data-testid="sidebar-pinned-header"
    >
      <div className="colony-sidebar-brand mb-2 flex h-10 items-center gap-2">
        {factoryView ? (
          <div
            className="flex min-w-0 flex-1 items-center gap-2 px-1"
            data-testid="factory-sidebar-brand"
          >
            <img
              alt=""
              aria-hidden="true"
              className="h-[26px] w-[26px] rounded-md"
              src={colonyIcon}
            />
            <span className="min-w-0 truncate text-xl font-bold tracking-[-0.055em] text-sidebar-foreground">
              colony
            </span>
          </div>
        ) : (
          <button
            aria-label={`Open business switcher, current business ${activeCommunityName || "No community"}`}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
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
              <span className="colony-sidebar-brand-mark-dot">·</span>
            </span>
            <span className="sidebar-company-name min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
              <span className="block truncate">
                {activeCommunityName || "No community"}
              </span>
              <span className="sidebar-company-context block truncate">
                Company workspace
              </span>
            </span>
          </button>
        )}
        {showSidebarCollapseButton ? (
          <Button
            aria-label="Toggle Sidebar"
            className="colony-sidebar-collapse h-7 w-7 shrink-0 text-sidebar-foreground/70"
            data-sidebar="trigger"
            onClick={sidebar.toggleSidebar}
            size="icon"
            type="button"
            variant="ghost"
          >
            {sidebar.open ? (
              <ChevronLeft aria-hidden="true" className="size-3" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3" />
            )}
          </Button>
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
  const [activityExpanded, setActivityExpanded] = React.useState(
    isSavedForLaterActive,
  );

  React.useEffect(() => {
    if (isSavedForLaterActive) setActivityExpanded(true);
  }, [isSavedForLaterActive]);

  return (
    <SidebarHeader
      className="relative z-40 cursor-default select-none px-2 pb-0 pt-0"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <SidebarMenu className="sidebar-primary-menu pb-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            className="text-xs data-[active=true]:font-normal"
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
            <House className="h-4 w-4" />
            <SidebarMenuLabel>Today</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem data-testid="sidebar-activity-item">
          <SidebarMenuButton
            className="text-xs data-[active=true]:font-normal"
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
            <ClipboardCheck className="h-4 w-4" />
            <SidebarMenuLabel>Activity</SidebarMenuLabel>
          </SidebarMenuButton>
          <SidebarMenuAction
            aria-controls="sidebar-activity-children"
            aria-expanded={activityExpanded}
            aria-label={
              activityExpanded ? "Collapse Activity" : "Expand Activity"
            }
            data-testid="sidebar-activity-toggle"
            onClick={() => setActivityExpanded((value) => !value)}
            showOnHover
            type="button"
          >
            <ChevronDown
              aria-hidden="true"
              className={activityExpanded ? "rotate-0" : "-rotate-90"}
            />
          </SidebarMenuAction>
          {homeBadgeCount > 0 ? (
            <SidebarMenuBadge
              className="right-7 h-auto min-w-0 rounded-none bg-transparent px-0 py-0 text-2xs font-normal text-sidebar-foreground"
              data-testid="sidebar-home-count"
            >
              {Math.min(homeBadgeCount, 99)}
            </SidebarMenuBadge>
          ) : null}
          {activityExpanded ? (
            <SidebarMenu
              className="sidebar-activity-children"
              data-testid="sidebar-activity-children"
              id="sidebar-activity-children"
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="sidebar-navigation-child pl-7"
                  data-testid="sidebar-saved-for-later"
                  isActive={isSavedForLaterActive}
                  onClick={onSelectSavedForLater}
                  tooltip="Saved for later"
                  type="button"
                >
                  <Bookmark className="h-4 w-4" />
                  <SidebarMenuLabel>Saved for later</SidebarMenuLabel>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          ) : null}
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}
