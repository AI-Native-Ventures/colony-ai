import { Bot, BriefcaseBusiness, Folders, House, Inbox } from "lucide-react";

import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { OPEN_SIDEBAR_PROFILE_POPOVER_EVENT } from "@/features/sidebar/lib/profilePopoverOpenEvent";
import { SidebarProjectsSection } from "@/features/sidebar/ui/SidebarProjectsSection";
import { FeatureGate } from "@/shared/features";
import type { Channel, SearchHit } from "@/shared/api/types";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import { ProtectedBestieSidebarEntry } from "@protected-feature-components";
import { Button } from "@/shared/ui/button";
import { DrawerPanelIcon } from "@/shared/ui/DrawerPanelIcon";
import { useSidebar } from "@/shared/ui/sidebar";

type SidebarSelectedView =
  | "today"
  | "home"
  | "channel"
  | "messages"
  | "agents"
  | "workflows"
  | "pulse"
  | "projects";

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
  onSelectAgents: () => void;
  onSelectHome: () => void;
  onSelectProjects: () => void;
  onSelectWorkflows: () => void;
  projectsOverviewActive: boolean;
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
  const communityInitial =
    activeCommunityName.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <div
      className="mx-[3px] shrink-0 px-2 pb-2 pt-2"
      data-testid="sidebar-pinned-header"
    >
      <div className="colony-sidebar-brand mb-2 flex h-10 items-center gap-2">
        <button
          aria-label={`Open business switcher, current business ${activeCommunityName || "No community"}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
          data-testid="sidebar-business-switcher"
          onClick={() =>
            window.dispatchEvent(new Event(OPEN_SIDEBAR_PROFILE_POPOVER_EVENT))
          }
          type="button"
        >
          <span aria-hidden="true" className="colony-sidebar-brand-mark">
            {communityInitial}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold text-sidebar-foreground">
            {activeCommunityName || "No community"}
          </span>
        </button>
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
            <DrawerPanelIcon side={sidebar.open ? "left" : "right"} />
          </Button>
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
  onSelectAgents,
  onSelectHome,
  onSelectProjects,
  onSelectWorkflows,
  projectsOverviewActive,
  selectedView,
}: AppSidebarPrimaryMenuProps) {
  return (
    <>
      <SidebarHeader
        className="relative z-40 cursor-default select-none px-2 pb-0 pt-0"
        data-tauri-drag-region
        data-testid="sidebar-primary-menu"
      >
        <SidebarMenu className="sidebar-primary-menu pb-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[active=true]:font-normal"
              isActive={selectedView === "today"}
              onClick={onSelectToday}
              tooltip="Today"
              type="button"
            >
              <House className="h-4 w-4" />
              <SidebarMenuLabel>Today</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[active=true]:font-normal"
              isActive={selectedView === "home"}
              onClick={onSelectHome}
              tooltip="Inbox"
              type="button"
            >
              <Inbox className="h-4 w-4" />
              <SidebarMenuLabel>Inbox</SidebarMenuLabel>
            </SidebarMenuButton>
            {homeBadgeCount > 0 ? (
              <SidebarMenuBadge
                className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
                data-testid="sidebar-home-count"
              >
                {Math.min(homeBadgeCount, 99)}
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>
          <FeatureGate feature="workflows">
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="open-workflows-view"
                isActive={selectedView === "workflows"}
                onClick={onSelectWorkflows}
                tooltip="Work"
                type="button"
              >
                <BriefcaseBusiness className="h-4 w-4" />
                <SidebarMenuLabel>Work</SidebarMenuLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </FeatureGate>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[active=true]:font-normal"
              data-testid="open-agents-view"
              isActive={selectedView === "agents"}
              onClick={onSelectAgents}
              tooltip="Agent work"
              type="button"
            >
              <Bot className="h-4 w-4" />
              <SidebarMenuLabel>Agent work</SidebarMenuLabel>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <FeatureGate feature="projects">
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="open-projects-view"
                isActive={selectedView === "projects" && projectsOverviewActive}
                onClick={onSelectProjects}
                tooltip="Projects"
                type="button"
              >
                <Folders className="h-4 w-4" />
                <SidebarMenuLabel>Software Factory</SidebarMenuLabel>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </FeatureGate>
          <ProtectedBestieSidebarEntry />
        </SidebarMenu>
      </SidebarHeader>
      <SidebarProjectsSection />
    </>
  );
}
