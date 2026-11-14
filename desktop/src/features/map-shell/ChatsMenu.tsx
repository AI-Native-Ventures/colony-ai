import * as React from "react";
import { LockKeyhole } from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { sortDmChannelsForSidebar } from "@/features/sidebar/lib/dmSidebarSort";
import {
  sectionSortGroupKey,
  sortChannelsForSidebar,
} from "@/features/sidebar/lib/channelSortPreference";
import { useChannelSortPreference } from "@/features/sidebar/lib/useChannelSortPreference";
import { useChannelSections } from "@/features/sidebar/lib/useChannelSections";
import { useChannelStars } from "@/features/sidebar/lib/useChannelStars";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { useWhatsAppContactsQuery } from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import type { WhatsAppContact } from "@/features/whatsapp-outreach/whatsappOutreachModels";
import type { Channel, Profile } from "@/shared/api/types";
import {
  DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui/popover";

const CUSTOMER_CHAT_LIMIT = 8;
const HOVER_CLOSE_DELAY_MS = 180;

export type ChatsMenuProps = {
  channels: Channel[];
  currentPubkey?: string;
  fallbackDisplayName?: string;
  profile?: Profile;
  unreadChannelIds: ReadonlySet<string>;
  unreadChannelCounts: ReadonlyMap<string, number>;
  onOpenChannel: (channelId: string) => void;
  onOpenWhatsAppContact: (channelId: string, waId: string) => void;
};

function ChatBubbleIcon() {
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
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

function RoomIconGlyph() {
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
      <circle cx="9" cy="9" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M16 14.6a4.5 4.5 0 0 1 4.5 4.4" />
    </svg>
  );
}

function displayCustomerName(contact: WhatsAppContact): string {
  const name =
    contact.displayName?.trim() || contact.profileName?.trim() || contact.e164;
  const businessName = contact.businessName?.trim();
  return businessName ? `${name}, ${businessName}` : name;
}

function ChatRow({
  channelRow = false,
  icon,
  isUnread = false,
  label,
  onClick,
  testId,
  unread,
}: {
  channelRow?: boolean;
  icon: React.ReactNode;
  isUnread?: boolean;
  label: string;
  onClick: () => void;
  testId?: string;
  unread?: number;
}) {
  return (
    <button
      aria-label={unread ? `${label}, ${unread} unread` : label}
      className="map-shell-chat-row"
      data-map-shell-channel-row={channelRow ? "true" : undefined}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span className={`map-shell-row-label${isUnread ? " is-unread" : ""}`}>
        {label}
      </span>
      {typeof unread === "number" && unread > 0 ? (
        <span aria-hidden="true" className="map-shell-count">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="map-shell-group-heading">{children}</h2>;
}

function DirectMessageIcon({
  channel,
  currentPubkey,
  profile,
  participants,
}: {
  channel: Channel;
  currentPubkey?: string;
  profile?: Profile;
  participants:
    | Array<{
        avatarUrl: string | null;
        isAgent?: boolean;
        label: string;
        pubkey: string;
      }>
    | undefined;
}) {
  const participant = participants?.[0];
  if (!participant) {
    return (
      <span aria-hidden="true" className="map-shell-icon-tile">
        <ChatBubbleIcon />
      </span>
    );
  }

  if (participant.isAgent) {
    return (
      <EmployeeAvatar
        className="map-shell-person-avatar"
        name={participant.label}
        profile={participant.avatarUrl}
        pubkey={participant.pubkey}
        testId={`map-shell-dm-avatar-${channel.id}`}
      />
    );
  }

  return (
    <ProfileAvatar
      avatarUrl={participant.avatarUrl}
      className="map-shell-person-avatar"
      label={participant.label}
      pubkey={participant.pubkey || currentPubkey || profile?.pubkey}
      testId={`map-shell-dm-avatar-${channel.id}`}
    />
  );
}

function RoomIcon({ channel }: { channel: Channel }) {
  return (
    <span
      aria-hidden="true"
      className="map-shell-icon-tile"
      data-private={channel.visibility === "private" ? "true" : undefined}
    >
      {channel.visibility === "private" ? <LockKeyhole /> : <RoomIconGlyph />}
    </span>
  );
}

function unreadCountFor(
  channel: Channel,
  unreadChannelIds: ReadonlySet<string>,
  unreadChannelCounts: ReadonlyMap<string, number>,
) {
  const count = unreadChannelCounts.get(channel.id) ?? 0;
  return unreadChannelIds.has(channel.id) ? Math.max(count, 1) : count;
}

type ChannelMenuGroup = {
  id: string;
  items: Channel[];
  label: string;
};

function useChannelMenuGroups(
  channels: Channel[],
  currentPubkey?: string,
): ChannelMenuGroup[] {
  const { activeCommunity } = useCommunities();
  const rooms = React.useMemo(
    () => channels.filter((channel) => channel.channelType !== "dm"),
    [channels],
  );
  const { sections, assignments } = useChannelSections(
    currentPubkey,
    activeCommunity?.relayUrl,
  );
  const sectionIds = React.useMemo(
    () => sections.map((section) => section.id),
    [sections],
  );
  const { sortModeFor } = useChannelSortPreference(
    currentPubkey,
    activeCommunity?.relayUrl,
    sectionIds,
  );
  const { starredChannelIds } = useChannelStars(
    currentPubkey,
    activeCommunity?.relayUrl,
  );

  return React.useMemo(() => {
    const sectionIdSet = new Set(sections.map((section) => section.id));
    const starred = sortChannelsForSidebar(
      rooms.filter((channel) => starredChannelIds.has(channel.id)),
      sortModeFor("starred"),
    );
    const bySection = sections
      .map((section) => ({
        id: section.id,
        items: sortChannelsForSidebar(
          rooms.filter(
            (channel) =>
              !starredChannelIds.has(channel.id) &&
              assignments[channel.id] === section.id,
          ),
          sortModeFor(sectionSortGroupKey(section.id)),
        ),
        label: section.name,
      }))
      .filter((group) => group.items.length > 0);
    const unassigned = sortChannelsForSidebar(
      rooms.filter((channel) => {
        if (starredChannelIds.has(channel.id)) return false;
        const sectionId = assignments[channel.id];
        return !sectionId || !sectionIdSet.has(sectionId);
      }),
      sortModeFor("channels"),
    );

    return [
      ...(starred.length > 0
        ? [{ id: "starred", items: starred, label: "Starred" }]
        : []),
      ...bySection,
      ...(unassigned.length > 0
        ? [{ id: "channels", items: unassigned, label: "Channels" }]
        : []),
    ];
  }, [assignments, rooms, sections, sortModeFor, starredChannelIds]);
}

export function ChatsMenuContent({
  channels,
  currentPubkey,
  fallbackDisplayName,
  profile,
  unreadChannelIds,
  unreadChannelCounts,
  onOpenChannel,
  onOpenWhatsAppContact,
}: ChatsMenuProps) {
  const { activeCommunity } = useCommunities();
  const directMessages = React.useMemo(
    () => channels.filter((channel) => channel.channelType === "dm"),
    [channels],
  );
  const rooms = React.useMemo(
    () => channels.filter((channel) => channel.channelType !== "dm"),
    [channels],
  );
  const { sections } = useChannelSections(
    currentPubkey,
    activeCommunity?.relayUrl,
  );
  const sectionIds = React.useMemo(
    () => sections.map((section) => section.id),
    [sections],
  );
  const { sortModeFor } = useChannelSortPreference(
    currentPubkey,
    activeCommunity?.relayUrl,
    sectionIds,
  );
  const { dmChannelLabels, dmParticipantsByChannelId } = useDmSidebarMetadata({
    currentPubkey,
    directMessages,
    fallbackDisplayName,
    profileDisplayName: profile?.displayName,
  });
  const sortedDms = React.useMemo(
    () =>
      sortDmChannelsForSidebar(
        directMessages,
        dmChannelLabels,
        sortModeFor("dms"),
      ),
    [directMessages, dmChannelLabels, sortModeFor],
  );
  const customerChatChannel = rooms.find(
    (channel) => channel.name.trim().toLocaleLowerCase() === "outreach",
  );
  const contactsQuery = useWhatsAppContactsQuery(Boolean(customerChatChannel));
  const contacts = React.useMemo(
    () =>
      [...(customerChatChannel ? (contactsQuery.data ?? []) : [])].sort(
        (left, right) => {
          if (left.unanswered !== right.unanswered) {
            return left.unanswered ? -1 : 1;
          }
          return displayCustomerName(left).localeCompare(
            displayCustomerName(right),
          );
        },
      ),
    [contactsQuery.data, customerChatChannel],
  );

  return (
    <div className="map-shell-chats-list">
      <section aria-labelledby="map-shell-customers-heading">
        <GroupHeading>
          <span id="map-shell-customers-heading">Customers</span>
        </GroupHeading>
        {contacts.slice(0, CUSTOMER_CHAT_LIMIT).map((contact) => (
          <ChatRow
            icon={
              <span aria-hidden="true" className="map-shell-icon-tile">
                <ChatBubbleIcon />
              </span>
            }
            isUnread={contact.unanswered}
            key={contact.waId}
            label={displayCustomerName(contact)}
            onClick={() => {
              if (customerChatChannel) {
                onOpenWhatsAppContact(customerChatChannel.id, contact.waId);
              }
            }}
            testId={`map-shell-wa-${contact.waId}`}
            unread={contact.unanswered ? 1 : undefined}
          />
        ))}
        {customerChatChannel ? (
          <ChatRow
            icon={
              <span aria-hidden="true" className="map-shell-icon-tile">
                <ChatBubbleIcon />
              </span>
            }
            label="All customer chats"
            onClick={() => onOpenWhatsAppContact(customerChatChannel.id, "")}
            testId="map-shell-all-customer-chats"
          />
        ) : null}
        {!customerChatChannel && contacts.length === 0 ? (
          <p className="map-shell-empty">Customer chats are not connected.</p>
        ) : null}
      </section>
      <section aria-labelledby="map-shell-team-heading">
        <GroupHeading>
          <span id="map-shell-team-heading">Your team</span>
        </GroupHeading>
        {sortedDms.map((channel) => {
          const label = dmChannelLabels[channel.id] ?? channel.name;
          const unreadCount = unreadCountFor(
            channel,
            unreadChannelIds,
            unreadChannelCounts,
          );
          return (
            <ChatRow
              icon={
                <DirectMessageIcon
                  channel={channel}
                  currentPubkey={currentPubkey}
                  participants={dmParticipantsByChannelId[channel.id]}
                  profile={profile}
                />
              }
              isUnread={unreadCount > 0}
              key={channel.id}
              label={label}
              onClick={() => onOpenChannel(channel.id)}
              testId={`map-shell-dm-${channel.id}`}
              unread={unreadCount}
            />
          );
        })}
      </section>
    </div>
  );
}

export function ChannelsMenuContent({
  channels,
  currentPubkey,
  hideDefaultGroupHeading = false,
  unreadChannelIds,
  unreadChannelCounts,
  onOpenChannel,
}: Pick<
  ChatsMenuProps,
  | "channels"
  | "currentPubkey"
  | "unreadChannelIds"
  | "unreadChannelCounts"
  | "onOpenChannel"
> & {
  hideDefaultGroupHeading?: boolean;
}) {
  const channelGroups = useChannelMenuGroups(channels, currentPubkey);

  return (
    <div className="map-shell-channels-list">
      {channelGroups.length === 0 ? (
        <p className="map-shell-empty">No channels yet.</p>
      ) : (
        channelGroups.map((group) => (
          <section key={group.id}>
            {hideDefaultGroupHeading && group.id === "channels" ? null : (
              <GroupHeading>{group.label}</GroupHeading>
            )}
            {group.items.map((channel) => {
              const unreadCount = unreadCountFor(
                channel,
                unreadChannelIds,
                unreadChannelCounts,
              );
              return (
                <ChatRow
                  channelRow
                  icon={<RoomIcon channel={channel} />}
                  isUnread={unreadCount > 0}
                  key={channel.id}
                  label={channel.name}
                  onClick={() => onOpenChannel(channel.id)}
                  testId={`map-shell-channel-${channel.id}`}
                  unread={unreadCount}
                />
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

export function ChannelsMenu({
  channels,
  currentPubkey,
  unreadChannelIds,
  unreadChannelCounts,
  onOpenChannel,
}: ChatsMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [pendingFocus, setPendingFocus] = React.useState<
    "first" | "last" | null
  >(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const hoverOpenTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hoverCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const openedByHoverRef = React.useRef(false);
  const hasUnread = channels.some(
    (channel) =>
      channel.channelType !== "dm" && unreadChannelIds.has(channel.id),
  );

  const clearHoverOpenTimer = React.useCallback(() => {
    if (hoverOpenTimerRef.current !== null) {
      clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
  }, []);
  const clearHoverCloseTimer = React.useCallback(() => {
    if (hoverCloseTimerRef.current !== null) {
      clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);
  const clearHoverTimers = React.useCallback(() => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
  }, [clearHoverCloseTimer, clearHoverOpenTimer]);
  const openImmediately = React.useCallback(
    (focusTarget: "first" | "last" | null = null) => {
      clearHoverTimers();
      openedByHoverRef.current = false;
      setPendingFocus(focusTarget);
      setOpen(true);
    },
    [clearHoverTimers],
  );
  const openWithDelay = React.useCallback(() => {
    clearHoverCloseTimer();
    if (open) return;
    clearHoverOpenTimer();
    hoverOpenTimerRef.current = setTimeout(() => {
      openedByHoverRef.current = true;
      setOpen(true);
    }, DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverCloseTimer, clearHoverOpenTimer, open]);
  const closeWithDelay = React.useCallback(() => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    if (!open) return;
    hoverCloseTimerRef.current = setTimeout(() => {
      openedByHoverRef.current = false;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverCloseTimer, clearHoverOpenTimer, open]);
  const closeAndReturnFocus = React.useCallback(() => {
    clearHoverTimers();
    openedByHoverRef.current = false;
    setPendingFocus(null);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [clearHoverTimers]);
  const getChannelRows = React.useCallback(
    () =>
      Array.from(
        contentRef.current?.querySelectorAll<HTMLButtonElement>(
          '[data-map-shell-channel-row="true"]',
        ) ?? [],
      ),
    [],
  );
  const moveFocus = React.useCallback(
    (direction: 1 | -1) => {
      const rows = getChannelRows();
      if (rows.length === 0) return;
      const activeElement = document.activeElement;
      const activeIndex =
        activeElement instanceof HTMLButtonElement
          ? rows.indexOf(activeElement)
          : -1;
      const nextIndex =
        activeIndex === -1
          ? direction === 1
            ? 0
            : rows.length - 1
          : (activeIndex + direction + rows.length) % rows.length;
      rows[nextIndex]?.focus();
    },
    [getChannelRows],
  );

  React.useEffect(() => () => clearHoverTimers(), [clearHoverTimers]);
  React.useEffect(() => {
    if (!open || pendingFocus === null) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const rows = getChannelRows();
      const row = pendingFocus === "first" ? rows[0] : rows[rows.length - 1];
      row?.focus();
      setPendingFocus(null);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [getChannelRows, open, pendingFocus]);

  const handleTriggerClick = React.useCallback(() => {
    clearHoverTimers();
    if (open && openedByHoverRef.current) {
      openedByHoverRef.current = false;
      return;
    }
    openedByHoverRef.current = false;
    setOpen((current) => !current);
  }, [clearHoverTimers, open]);
  const handleTriggerKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "Spacebar"
      ) {
        event.preventDefault();
        openImmediately("first");
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        openImmediately("first");
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        openImmediately("last");
      }
    },
    [openImmediately],
  );
  const handleContentKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndReturnFocus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        moveFocus(1);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        moveFocus(-1);
      }
    },
    [closeAndReturnFocus, moveFocus],
  );

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        clearHoverTimers();
        if (!nextOpen) {
          openedByHoverRef.current = false;
          setPendingFocus(null);
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      <PopoverAnchor asChild>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={hasUnread ? "Channels, unread messages" : "Channels"}
          className="map-shell-nav-button map-shell-channels-trigger"
          data-testid="map-shell-channels-button"
          onBlur={closeWithDelay}
          onClick={handleTriggerClick}
          onKeyDown={handleTriggerKeyDown}
          onMouseEnter={openWithDelay}
          onMouseLeave={closeWithDelay}
          ref={triggerRef}
          type="button"
        >
          <RoomIconGlyph />
          <span>Channels</span>
          {hasUnread ? (
            <span aria-hidden="true" className="map-shell-channel-dot" />
          ) : null}
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        aria-label="Channels"
        className="map-shell-channels-popover"
        data-testid="map-shell-channels-popover"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          closeAndReturnFocus();
        }}
        onFocusCapture={clearHoverCloseTimer}
        onKeyDown={handleContentKeyDown}
        onMouseEnter={clearHoverCloseTimer}
        onMouseLeave={closeWithDelay}
        onOpenAutoFocus={(event) => event.preventDefault()}
        ref={contentRef}
        side="bottom"
        sideOffset={6}
      >
        <ChannelsMenuContent
          channels={channels}
          currentPubkey={currentPubkey}
          onOpenChannel={(channelId) => {
            clearHoverTimers();
            openedByHoverRef.current = false;
            setOpen(false);
            onOpenChannel(channelId);
          }}
          unreadChannelCounts={unreadChannelCounts}
          unreadChannelIds={unreadChannelIds}
        />
      </PopoverContent>
    </Popover>
  );
}

export function ChatsMenu({
  channels,
  currentPubkey,
  fallbackDisplayName,
  profile,
  unreadChannelIds,
  unreadChannelCounts,
  onOpenChannel,
  onOpenWhatsAppContact,
}: ChatsMenuProps) {
  const [open, setOpen] = React.useState(false);
  const hasUnread = channels.some(
    (channel) =>
      unreadChannelIds.has(channel.id) &&
      (channel.channelType === "dm" ||
        channel.name.trim().toLocaleLowerCase() === "outreach"),
  );
  const contentProps = {
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
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={hasUnread ? "Chats, unread messages" : "Chats"}
          className="map-shell-nav-button map-shell-chats-trigger"
          data-testid="map-shell-chats-button"
          type="button"
        >
          <ChatBubbleIcon />
          <span>Chats</span>
          {hasUnread ? (
            <span aria-hidden="true" className="map-shell-chat-dot" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Chats"
        className="map-shell-chats-popover"
        data-testid="map-shell-chats-popover"
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="bottom"
        sideOffset={6}
      >
        <ChatsMenuContent
          {...contentProps}
          onOpenChannel={(channelId) => {
            setOpen(false);
            onOpenChannel(channelId);
          }}
          onOpenWhatsAppContact={(channelId, waId) => {
            setOpen(false);
            onOpenWhatsAppContact(channelId, waId);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
