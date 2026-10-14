import * as React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Home,
  Menu,
  MessageCircle,
  Plus,
  Settings,
  Users,
} from "lucide-react";

import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { useNeedsMeQuery } from "@/features/home/needsMeHooks";
import { buildNeedsMeItems } from "@/features/home/needsMeOrdering";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import { CreateChannelDialog } from "@/features/sidebar/ui/CreateChannelDialog";
import { SidebarRelayConnectionCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import { SidebarRelayErrorNotice } from "@/features/sidebar/ui/SidebarRelayErrorNotice";
import { Sidebar, useSidebar } from "@/shared/ui/sidebar";

function AntMark() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 466 309">
      <g stroke="currentColor" strokeLinecap="round" strokeWidth="14">
        <path d="M198 201Q176 230 163 265 M229 211Q226 243 232 274 M259 190Q281 221 296 252 M327 114Q340 82 371 74 M343 126Q367 106 395 105" />
      </g>
      <g fill="currentColor">
        <circle cx="104" cy="172" r="80" />
        <circle cx="226" cy="164" r="52" />
        <circle cx="313" cy="148" r="46" />
      </g>
    </svg>
  );
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** The approved Colony navigation, bound to the real app's channels and routes. */
export function ColonyCanarySidebar({
  activeCommunity,
  channels,
  communities,
  currentPubkey,
  errorMessage,
  fallbackDisplayName,
  isCreateChannelOpen,
  isCreatingChannel,
  isLoading,
  onCreateChannel,
  onCreateChannelOpenChange,
  onOpenSearchResult,
  onSelectChannel,
  onSelectSettings,
  onSelectTeam,
  onSelectToday,
  onSwitchCommunity,
  profile,
  relayConnectionCard,
  searchChannels,
  searchFocusRequests,
  selectedChannelId,
  selectedView,
  unreadChannelIds,
}: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const needsMe = useNeedsMeQuery();
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const [localCreateOpen, setLocalCreateOpen] = React.useState(false);
  const [companyMenuOpen, setCompanyMenuOpen] = React.useState(false);
  const conversationChannels = React.useMemo(
    () =>
      channels
        .filter(
          (channel) => channel.channelType === "stream" && !channel.archivedAt,
        )
        .sort((a, b) => {
          const aTime = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
          const bTime = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
          return bTime - aTime || a.name.localeCompare(b.name);
        }),
    [channels],
  );
  const searchConversationChannels = React.useMemo(
    () =>
      searchChannels.filter(
        (channel) => channel.channelType === "stream" && !channel.archivedAt,
      ),
    [searchChannels],
  );
  const settingsActive = location.pathname === "/settings";
  const needsYouActive =
    location.pathname === "/today" &&
    (location.search as { view?: unknown }).view === "needs-you";
  const needsYouCount =
    needsMe.asksError || needsMe.workflowApprovalsError || needsMe.isPending
      ? null
      : buildNeedsMeItems(needsMe.data).length;
  const showRelayRecovery =
    relayConnectionCard.showSidebarRelayConnectionCard ||
    Boolean(errorMessage && !relayConnectionCard.hasRelayUnreachableError);
  const todayActive =
    !settingsActive && !needsYouActive && selectedView === "today";
  const conversationsActive = !settingsActive && selectedView === "channel";
  const teamActive = !settingsActive && selectedView === "team";
  const displayName =
    profile?.displayName?.trim() ||
    fallbackDisplayName?.trim() ||
    "Your account";
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const goNeedsYou = () => {
    void navigate({ to: "/today", search: { view: "needs-you" } });
    closeMobile();
  };
  const createOpen = Boolean(isCreateChannelOpen || localCreateOpen);
  const changeCreateOpen = (open: boolean) => {
    setLocalCreateOpen(open);
    onCreateChannelOpenChange?.(open);
  };

  return (
    <>
      <button
        aria-label="Open navigation"
        className="colony-canary-mobile-trigger"
        onClick={toggleSidebar}
        type="button"
      >
        <Menu aria-hidden="true" size={19} />
      </button>
      <Sidebar
        className="colony-canary-sidebar"
        data-colony-canary-ui
        data-testid="app-sidebar"
      >
        <div className="colony-canary-sidebar-inner">
          <button
            aria-label="Colony, Today"
            className="colony-canary-brand"
            onClick={() => {
              onSelectToday();
              closeMobile();
            }}
            type="button"
          >
            <AntMark />
            <strong>Colony</strong>
          </button>
          <div className="colony-canary-company">
            <button
              aria-expanded={companyMenuOpen}
              aria-label={`Company: ${activeCommunity?.name || "Colony"}`}
              onClick={() => {
                if (communities.length > 1) setCompanyMenuOpen((open) => !open);
                else onSelectSettings("business-profile");
              }}
              type="button"
            >
              <span>{activeCommunity?.name || "Colony"}</span>
              {communities.length > 1 ? (
                <ChevronDown aria-hidden="true" size={14} />
              ) : null}
            </button>
            {companyMenuOpen && communities.length > 1 ? (
              <div className="colony-canary-company-menu" role="menu">
                {communities.map((community) => (
                  <button
                    aria-current={
                      community.id === activeCommunity?.id ? "true" : undefined
                    }
                    key={community.id}
                    onClick={() => {
                      onSwitchCommunity(community.id);
                      setCompanyMenuOpen(false);
                      closeMobile();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {community.name}
                    {community.id === activeCommunity?.id ? (
                      <Check aria-hidden="true" size={14} />
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <nav aria-label="Main navigation" className="colony-canary-nav">
            <button
              aria-current={todayActive ? "page" : undefined}
              className={todayActive ? "active" : ""}
              onClick={() => {
                onSelectToday();
                closeMobile();
              }}
              type="button"
            >
              <Home aria-hidden="true" size={18} />
              <span>Today</span>
            </button>
            <button
              aria-current={conversationsActive ? "page" : undefined}
              className={conversationsActive ? "active" : ""}
              onClick={() => {
                const target =
                  conversationChannels.find(
                    (channel) => channel.id === selectedChannelId,
                  ) ?? conversationChannels[0];
                if (target) onSelectChannel(target.id);
                else changeCreateOpen(true);
                closeMobile();
              }}
              type="button"
            >
              <MessageCircle aria-hidden="true" size={18} />
              <span>Conversations</span>
            </button>
            <button
              aria-current={teamActive ? "page" : undefined}
              className={teamActive ? "active" : ""}
              onClick={() => {
                onSelectTeam();
                closeMobile();
              }}
              type="button"
            >
              <Users aria-hidden="true" size={18} />
              <span>Team</span>
            </button>
            <button
              aria-current={settingsActive ? "page" : undefined}
              className={settingsActive ? "active" : ""}
              onClick={() => {
                onSelectSettings();
                closeMobile();
              }}
              type="button"
            >
              <Settings aria-hidden="true" size={18} />
              <span>Settings</span>
            </button>
            <button
              aria-current={needsYouActive ? "page" : undefined}
              className={`colony-canary-needs${needsYouActive ? " active" : ""}`}
              onClick={goNeedsYou}
              type="button"
            >
              <span className="colony-canary-needs-icon" aria-hidden="true">
                <Check size={13} />
              </span>
              <span>Needs you</span>
              {needsYouCount !== null && needsYouCount > 0 ? (
                <span className="colony-canary-needs-count">
                  {needsYouCount}
                </span>
              ) : null}
            </button>
          </nav>
          {conversationsActive ? (
            <div className="colony-canary-conversation-list">
              {isLoading ? (
                <span role="status">Loading conversations…</span>
              ) : null}
              {!isLoading && conversationChannels.length === 0 ? (
                <span>No conversations yet</span>
              ) : null}
              {conversationChannels.map((channel) => (
                <button
                  aria-current={
                    selectedChannelId === channel.id ? "page" : undefined
                  }
                  className={selectedChannelId === channel.id ? "selected" : ""}
                  key={channel.id}
                  onClick={() => {
                    onSelectChannel(channel.id);
                    closeMobile();
                  }}
                  type="button"
                >
                  <span className="colony-canary-conversation-name">
                    {channel.name}
                  </span>
                  {unreadChannelIds.has(channel.id) ? (
                    <span className="colony-canary-unread">
                      <span className="sr-only">Unread</span>
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="colony-canary-tools">
            <button onClick={() => changeCreateOpen(true)} type="button">
              <Plus aria-hidden="true" size={17} />
              New conversation
            </button>
            <TopbarSearch
              channels={searchConversationChannels}
              currentChannelId={selectedChannelId}
              currentPubkey={currentPubkey}
              focusRequest={searchFocusRequests[0]}
              onOpenChannel={(channelId) => {
                onSelectChannel(channelId);
                closeMobile();
              }}
              onOpenResult={onOpenSearchResult}
              scopeFocusRequest={searchFocusRequests[1]}
              suggestionChannels={conversationChannels}
              triggerLabel="Search"
            />
          </div>
          <div className="colony-canary-bottom">
            {relayConnectionCard.showSidebarRelayConnectionCard ? (
              <div className="colony-canary-relay-recovery">
                <SidebarRelayConnectionCard
                  isConnected={relayConnectionCard.isRelayConnectionSuccess}
                  isReconnectPending={
                    relayConnectionCard.isRelayReconnectPending
                  }
                  isWaitingOnReconnectHook={
                    relayConnectionCard.isWaitingOnReconnectHook
                  }
                  onDismiss={relayConnectionCard.onDismissRelayConnectionCard}
                  onReconnect={relayConnectionCard.onReconnectRelay}
                />
              </div>
            ) : errorMessage &&
              !relayConnectionCard.hasRelayUnreachableError ? (
              <div className="colony-canary-relay-recovery">
                <SidebarRelayErrorNotice message={errorMessage} />
              </div>
            ) : null}
            {!showRelayRecovery ? (
              <button
                className="colony-canary-team-link"
                onClick={() => {
                  onSelectTeam();
                  closeMobile();
                }}
                type="button"
              >
                <span aria-hidden="true" className="colony-canary-orbit" />
                <span>
                  <strong>Team</strong>
                  <small>View your team</small>
                </span>
                <ArrowUpRight aria-hidden="true" size={14} />
              </button>
            ) : null}
            <button
              className="colony-canary-account"
              onClick={() => {
                onSelectSettings("profile");
                closeMobile();
              }}
              type="button"
            >
              <span aria-hidden="true" className="colony-canary-initials">
                {initials(displayName)}
              </span>
              <span>
                <strong>{displayName}</strong>
                <small>Account</small>
              </span>
              <ChevronDown aria-hidden="true" size={14} />
            </button>
          </div>
        </div>
      </Sidebar>
      <CreateChannelDialog
        channelKind={createOpen ? "stream" : null}
        description="Start a conversation with your team."
        isCreating={isCreatingChannel}
        onCreate={onCreateChannel}
        onOpenChange={changeCreateOpen}
        title="New conversation"
      />
    </>
  );
}
