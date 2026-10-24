import type * as React from "react";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { GatedDestination } from "@/features/sidebar/ui/SidebarDestinationList";
import {
  SIDEBAR_DESTINATIONS,
  type SidebarDestinationContext,
} from "@/features/sidebar/ui/sidebarDestinations";
import type { SidebarDmParticipant } from "@/features/sidebar/ui/SidebarSection";
import type { Channel } from "@/shared/api/types";
import {
  ActivityIcon,
  HashIcon,
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
  /** The same context the expanded destination list draws from. */
  destinationContext: SidebarDestinationContext;
  directMessages: CollapsedDirectMessage[];
  homeBadgeCount: number;
  isActivityActive: boolean;
  isSavedForLaterActive: boolean;
  isTodayActive: boolean;
  hasUnreadChannels: boolean;
  onExpand: () => void;
  onSelectChannel: (channelId: string) => void;
  onSelectHome: () => void;
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
 * The destination icons come from `SIDEBAR_DESTINATIONS`.
 */
export function SidebarCollapsedNav({
  destinationContext,
  directMessages,
  homeBadgeCount,
  isActivityActive,
  isSavedForLaterActive,
  isTodayActive,
  hasUnreadChannels,
  onExpand,
  onSelectChannel,
  onSelectHome,
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
      {SIDEBAR_DESTINATIONS.map((entry) => {
        const rail = entry.rail;
        if (!rail) return null;
        const Icon = rail.Icon;
        return (
          <GatedDestination feature={entry.feature} key={entry.id}>
            <CollapsedItem
              active={rail.isActive(destinationContext)}
              ariaLabel={rail.label}
              onClick={() => rail.onSelect(destinationContext)}
              testId={rail.testId}
            >
              <Icon size={20} />
            </CollapsedItem>
          </GatedDestination>
        );
      })}
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
