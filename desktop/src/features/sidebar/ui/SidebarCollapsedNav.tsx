import type * as React from "react";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { SidebarDmParticipant } from "@/features/sidebar/ui/SidebarSection";
import type { Channel } from "@/shared/api/types";
import {
  ActivityIcon,
  BusinessIcon,
  CompanyIcon,
  FactoryIcon,
  HashIcon,
  LibraryIcon,
  SavedIcon,
  TodayIcon,
} from "@/shared/ui/colonyIcons";

type CollapsedDirectMessage = {
  channel: Channel;
  isActive: boolean;
  label: string;
  participants?: SidebarDmParticipant[];
  unreadCount: number;
};

type SidebarCollapsedNavProps = {
  directMessages: CollapsedDirectMessage[];
  homeBadgeCount: number;
  isActivityActive: boolean;
  isBusinessActive: boolean;
  isCompanyActive: boolean;
  isFactoryActive: boolean;
  isSavedForLaterActive: boolean;
  isTodayActive: boolean;
  hasUnreadChannels: boolean;
  onExpand: () => void;
  onSelectBusiness: () => void;
  onSelectChannel: (channelId: string) => void;
  onSelectCompany: () => void;
  onSelectFactory: () => void;
  onSelectHome: () => void;
  onSelectLibrary?: () => void;
  onSelectSavedForLater: () => void;
  onSelectToday: () => void;
};

function CollapsedItem({
  active = false,
  ariaLabel,
  children,
  onClick,
  testId,
}: {
  active?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={ariaLabel}
      className="colony-collapsed-item"
      data-active={active || undefined}
      data-testid={testId}
      onClick={onClick}
      title={ariaLabel}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * The collapsed sidebar: one icon per destination, a single Channels icon
 * that carries the unread dot, and the direct messages as small avatars. It
 * replaces the expanded lists while the sidebar is collapsed to its icon rail.
 */
export function SidebarCollapsedNav({
  directMessages,
  homeBadgeCount,
  isActivityActive,
  isBusinessActive,
  isCompanyActive,
  isFactoryActive,
  isSavedForLaterActive,
  isTodayActive,
  hasUnreadChannels,
  onExpand,
  onSelectBusiness,
  onSelectChannel,
  onSelectCompany,
  onSelectFactory,
  onSelectHome,
  onSelectLibrary,
  onSelectSavedForLater,
  onSelectToday,
}: SidebarCollapsedNavProps) {
  return (
    <div className="colony-collapsed-nav" data-testid="sidebar-collapsed-nav">
      <CollapsedItem
        active={isTodayActive}
        ariaLabel="Today"
        onClick={onSelectToday}
        testId="sidebar-collapsed-today"
      >
        <TodayIcon size={20} />
      </CollapsedItem>
      <CollapsedItem
        active={isActivityActive}
        ariaLabel={
          homeBadgeCount > 0 ? `Activity, ${homeBadgeCount} new` : "Activity"
        }
        onClick={onSelectHome}
        testId="sidebar-collapsed-activity"
      >
        <ActivityIcon size={20} />
        {homeBadgeCount > 0 ? (
          <span className="colony-collapsed-badge">
            {Math.min(homeBadgeCount, 99)}
          </span>
        ) : null}
      </CollapsedItem>
      <CollapsedItem
        active={isSavedForLaterActive}
        ariaLabel="Saved for later"
        onClick={onSelectSavedForLater}
        testId="sidebar-collapsed-saved"
      >
        <SavedIcon size={20} />
      </CollapsedItem>
      <span aria-hidden="true" className="colony-collapsed-divider" />
      <CollapsedItem
        active={isCompanyActive}
        ariaLabel="Company"
        onClick={onSelectCompany}
        testId="sidebar-collapsed-company"
      >
        <CompanyIcon size={20} />
      </CollapsedItem>
      <CollapsedItem
        active={isBusinessActive}
        ariaLabel="Business"
        onClick={onSelectBusiness}
        testId="sidebar-collapsed-business"
      >
        <BusinessIcon size={20} />
      </CollapsedItem>
      <CollapsedItem
        active={isFactoryActive}
        ariaLabel="Software Factory"
        onClick={onSelectFactory}
        testId="sidebar-collapsed-factory"
      >
        <FactoryIcon size={20} />
      </CollapsedItem>
      {onSelectLibrary ? (
        <CollapsedItem
          ariaLabel="Library"
          onClick={onSelectLibrary}
          testId="sidebar-collapsed-library"
        >
          <LibraryIcon size={20} />
        </CollapsedItem>
      ) : null}
      <span aria-hidden="true" className="colony-collapsed-divider" />
      <CollapsedItem
        ariaLabel={hasUnreadChannels ? "Channels, unread messages" : "Channels"}
        onClick={onExpand}
        testId="sidebar-collapsed-channels"
      >
        <HashIcon size={20} />
        {hasUnreadChannels ? <span className="colony-collapsed-dot" /> : null}
      </CollapsedItem>
      {directMessages.map(
        ({ channel, isActive, label, participants, unreadCount }) => {
          const primary = participants?.[0];
          return (
            <CollapsedItem
              active={isActive}
              ariaLabel={
                unreadCount > 0 ? `${label}, ${unreadCount} unread` : label
              }
              key={channel.id}
              onClick={() => onSelectChannel(channel.id)}
              testId={`sidebar-collapsed-dm-${channel.name}`}
            >
              <ProfileAvatar
                avatarUrl={primary?.avatarUrl ?? null}
                className="colony-collapsed-avatar"
                label={label}
                shape={primary?.isAgent ? "squircle" : "circle"}
              />
              {unreadCount > 0 ? (
                <span className="colony-collapsed-badge colony-collapsed-badge-avatar">
                  {Math.min(unreadCount, 99)}
                </span>
              ) : null}
            </CollapsedItem>
          );
        },
      )}
    </div>
  );
}
