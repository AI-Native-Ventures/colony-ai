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
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

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
  icon,
  isUnread = false,
  label,
  onClick,
  testId,
  unread,
}: {
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
  const { dmChannelLabels, dmParticipantsByChannelId } = useDmSidebarMetadata({
    currentPubkey,
    directMessages,
    fallbackDisplayName,
    profileDisplayName: profile?.displayName,
  });
  const { starredChannelIds } = useChannelStars(
    currentPubkey,
    activeCommunity?.relayUrl,
  );
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
  const roomGroups = React.useMemo(() => {
    const seen = new Set<string>();
    const bySection = sections.map((section) => {
      const items = sortChannelsForSidebar(
        rooms.filter(
          (channel) =>
            assignments[channel.id] === section.id &&
            !starredChannelIds.has(channel.id) &&
            !seen.has(channel.id),
        ),
        sortModeFor(sectionSortGroupKey(section.id)),
      );
      for (const item of items) seen.add(item.id);
      return { id: section.id, items, label: section.name };
    });
    const starred = sortChannelsForSidebar(
      rooms.filter(
        (channel) => starredChannelIds.has(channel.id) && !seen.has(channel.id),
      ),
      sortModeFor("starred"),
    );
    for (const item of starred) seen.add(item.id);
    const unassigned = sortChannelsForSidebar(
      rooms.filter((channel) => !seen.has(channel.id)),
      sortModeFor("channels"),
    );
    return [
      ...(starred.length > 0
        ? [{ id: "starred", items: starred, label: "Starred" }]
        : []),
      ...bySection.filter((group) => group.items.length > 0),
      ...(unassigned.length > 0
        ? [{ id: "rooms", items: unassigned, label: "" }]
        : []),
    ];
  }, [assignments, rooms, sections, sortModeFor, starredChannelIds]);

  return (
    <div className="map-shell-chats-list">
      <section aria-labelledby="map-shell-customers-heading">
        <GroupHeading>
          <span id="map-shell-customers-heading">Customers</span>
        </GroupHeading>
        {contacts.map((contact) => (
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
          const unreadCount = unreadChannelIds.has(channel.id)
            ? Math.max(unreadChannelCounts.get(channel.id) ?? 0, 1)
            : (unreadChannelCounts.get(channel.id) ?? 0);
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
        {roomGroups
          .flatMap((group) => group.items)
          .map((channel) => {
            const unreadCount = unreadChannelIds.has(channel.id)
              ? Math.max(unreadChannelCounts.get(channel.id) ?? 0, 1)
              : (unreadChannelCounts.get(channel.id) ?? 0);
            const roomLabel = channel.name.toLocaleLowerCase().endsWith("room")
              ? channel.name
              : `${channel.name} room`;
            return (
              <ChatRow
                icon={<RoomIcon channel={channel} />}
                isUnread={unreadCount > 0}
                key={channel.id}
                label={roomLabel}
                onClick={() => onOpenChannel(channel.id)}
                testId={`map-shell-room-${channel.id}`}
                unread={unreadCount}
              />
            );
          })}
      </section>
    </div>
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
  const hasUnread = unreadChannelIds.size > 0;
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
