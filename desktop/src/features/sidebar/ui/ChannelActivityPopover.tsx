import * as React from "react";
import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import type { ActiveChannelTurnSummary } from "@/features/agents/activeAgentTurnsStore";
import { formatElapsedClock } from "@/features/agents/ui/agentSessionUtils";
import { buildInboxItems, type InboxItem } from "@/features/home/lib/inbox";
import { getGroupedInboxItemIds } from "@/features/home/useHomeInboxReadState";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel, FeedItem, HomeFeedResponse } from "@/shared/api/types";
import { normalizePubkey, truncateNpub } from "@/shared/lib/pubkey";
import { useNow } from "@/shared/lib/useNow";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import {
  DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui/popover";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { ChannelGlyph } from "@/features/channels/ui/ChannelGlyph";

const HOVER_CLOSE_DELAY_MS = 180;
const ACTIVITY_POPOVER_MOTION_STYLE = {
  "--tw-enter-scale": "1",
  "--tw-exit-scale": "1",
} as React.CSSProperties;

function buildChannelActivityFeed(items: FeedItem[]): HomeFeedResponse {
  return {
    feed: {
      mentions: items.filter((item) => item.category === "mention"),
      needsAction: items.filter((item) => item.category === "needs_action"),
      activity: items.filter(
        (item) =>
          item.category !== "mention" &&
          item.category !== "needs_action" &&
          item.category !== "agent_activity",
      ),
      agentActivity: items.filter((item) => item.category === "agent_activity"),
    },
    meta: {
      since: 0,
      total: items.length,
      generatedAt: 0,
    },
  };
}

const EYEBROW_CLASS =
  "text-2xs font-extrabold uppercase tracking-[0.09em] text-colony-muted";

function ThreadPreviewRow({
  isAgent,
  item,
  onMarkRead,
  onOpen,
}: {
  isAgent: boolean;
  item: InboxItem;
  onMarkRead: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      className="group/activity-row relative flex flex-col gap-2 rounded-colony-chip p-3 shadow-[inset_0_0_0_1px_hsl(var(--colony-border))] transition-colors hover:bg-colony-wash focus-within:bg-colony-wash"
      data-testid={`channel-activity-item-${item.conversationId}`}
    >
      <button
        aria-label={`Open thread from ${item.senderLabel}`}
        className="absolute inset-0 z-0 w-full rounded-colony-chip text-left"
        onClick={onOpen}
        type="button"
      />
      <div className="pointer-events-none relative z-10 flex items-center gap-2.5">
        <UserAvatar
          avatarUrl={item.avatarUrl}
          className="size-7 shrink-0"
          displayName={item.senderLabel}
          shape={isAgent ? "squircle" : "circle"}
          size="md"
        />
        <span className="min-w-0 flex-1 truncate text-menu font-extrabold">
          {item.senderLabel}
        </span>
        <span className="shrink-0 text-xs font-medium text-colony-muted">
          {item.timestampLabel}
        </span>
      </div>
      <span className="pointer-events-none relative z-10 text-xs font-extrabold text-colony-accent-ink">
        Thread
        {item.unreadCount > 1 ? ` · ${item.unreadCount} unread` : ""}
      </span>
      <Markdown
        className="inbox-preview-markdown pointer-events-none relative z-10 line-clamp-2 text-menu font-medium leading-[1.45] text-colony-fg-secondary"
        content={item.preview}
        interactive={false}
        mentionNames={item.mentionNames}
      />
      <div className="relative z-10 flex gap-2">
        <Button
          onClick={(event) => {
            event.stopPropagation();
            onMarkRead();
          }}
          size="xs"
          type="button"
          variant="ghost"
          className="h-8.5 bg-colony-track px-3 text-xs font-bold text-colony-fg hover:bg-colony-border"
        >
          Mark as read
        </Button>
      </div>
    </div>
  );
}

function WorkingAgentRow({
  avatarUrl,
  elapsed,
  initialsLabel,
  name,
  onOpen,
  pubkey,
}: {
  avatarUrl: string | null;
  elapsed: string;
  /** Unprefixed key (or authored name) the avatar derives initials from. */
  initialsLabel: string;
  name: string;
  onOpen: () => void;
  pubkey: string;
}) {
  return (
    <button
      className="flex w-full min-w-0 items-center gap-3 rounded-colony-chip px-2.5 py-2 text-left transition-colors hover:bg-colony-wash focus-visible:bg-colony-wash focus-visible:outline-hidden"
      data-testid={`channel-activity-agent-${pubkey}`}
      onClick={onOpen}
      type="button"
    >
      <UserAvatar
        avatarUrl={avatarUrl}
        className="size-8.5 shrink-0"
        displayName={name}
        initialsLabel={initialsLabel}
        shape="squircle"
        size="md"
      />
      <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
        <span className="truncate text-control font-extrabold">{name}</span>
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-colony-accent-ink">
          <span className="size-[7px] rounded-full bg-colony-accent motion-safe:animate-pulse" />
          Working · {elapsed}
        </span>
      </span>
      <span className="text-xs font-extrabold text-colony-accent-ink underline">
        View activity
      </span>
    </button>
  );
}

/**
 * Working-agent rows for the channel activity popover. Exported for consumer
 * tests: it owns the generated `Agent npub1…` fallback label that flows into
 * `UserAvatar` initials.
 */
export function WorkingAgentRows({
  activeWorking,
  channelId,
  onOpen,
  profiles,
}: {
  activeWorking: ActiveChannelTurnSummary;
  channelId: string;
  onOpen: (pubkey: string, channelId: string) => void;
  profiles?: UserProfileLookup;
}) {
  const now = useNow(1000);
  const alignedAgentNames =
    activeWorking.agentNames?.length === activeWorking.agentPubkeys.length
      ? activeWorking.agentNames
      : null;

  return activeWorking.agentPubkeys.map((pubkey, index) => {
    const profile = profiles?.[normalizePubkey(pubkey)];
    const authoredName =
      profile?.displayName?.trim() || alignedAgentNames?.[index];
    const keyLabel = truncateNpub(pubkey);
    const name = authoredName || `Agent ${keyLabel}`;
    // Each agent counts from its own start; the channel anchor is the fallback.
    const agentAnchor =
      activeWorking.agentAnchors?.[normalizePubkey(pubkey)] ??
      activeWorking.anchorAt;
    return (
      <WorkingAgentRow
        avatarUrl={profile?.avatarUrl ?? null}
        elapsed={formatElapsedClock(now - agentAnchor)}
        initialsLabel={authoredName || keyLabel}
        key={pubkey}
        name={name}
        onOpen={() => onOpen(pubkey, channelId)}
        pubkey={pubkey}
      />
    );
  });
}

export function ChannelActivityPopover({
  activeWorking,
  channel,
  children,
}: {
  activeWorking?: ActiveChannelTurnSummary;
  channel: Channel;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const {
    clearChannelUnreadSource,
    getChannelActivityItemReadAt,
    locallyUnreadFeedItems,
    markMessageRead,
    markThreadRead,
    unreadThreadFeedItems,
    feedItemState,
  } = useAppShell();
  const { undoUnread } = feedItemState;
  const identityQuery = useIdentityQuery();
  const { goChannel } = useAppNavigation();

  const unreadChannelFeedItems = React.useMemo(() => {
    return unreadThreadFeedItems.filter(
      (item) => item.channelId === channel.id,
    );
  }, [channel.id, unreadThreadFeedItems]);
  const profilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...unreadChannelFeedItems.map((item) => item.pubkey),
        ...(activeWorking?.agentPubkeys ?? []),
      ]),
    ],
    [activeWorking?.agentPubkeys, unreadChannelFeedItems],
  );
  const profilesQuery = useUsersBatchQuery(open ? profilePubkeys : [], {
    enabled: open,
  });
  const profiles = profilesQuery.data?.profiles;
  const activityReadAtByMessageId = React.useMemo(
    () =>
      new Map(
        unreadChannelFeedItems.map((item) => [
          item.id,
          getChannelActivityItemReadAt(item),
        ]),
      ),
    [getChannelActivityItemReadAt, unreadChannelFeedItems],
  );
  const activityItems = React.useMemo(() => {
    if (!open) return [];
    return buildInboxItems({
      channels: [channel],
      currentPubkey: identityQuery.data?.pubkey,
      feed: buildChannelActivityFeed(unreadChannelFeedItems),
      getMessageReadAt: (messageId) =>
        activityReadAtByMessageId.get(messageId) ?? null,
      profiles,
    });
  }, [
    channel,
    activityReadAtByMessageId,
    identityQuery.data?.pubkey,
    open,
    profiles,
    unreadChannelFeedItems,
  ]);
  const hasContent =
    unreadChannelFeedItems.length > 0 ||
    (activeWorking?.agentPubkeys.length ?? 0) > 0;

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);
  const openWithDelay = React.useCallback(() => {
    if (!hasContent) return;
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS);
  }, [clearHoverTimer, hasContent]);
  const openImmediately = React.useCallback(() => {
    if (!hasContent) return;
    clearHoverTimer();
    setOpen(true);
  }, [clearHoverTimer, hasContent]);
  const closeWithDelay = React.useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [clearHoverTimer]);
  const keepOpen = React.useCallback(() => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  React.useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);
  React.useEffect(() => {
    if (!hasContent) {
      setOpen(false);
    }
  }, [hasContent]);

  const clearUnreadOverride = React.useCallback(
    (item: InboxItem) => {
      const clearedItemIds = new Set(getGroupedInboxItemIds(item));
      for (const itemId of clearedItemIds) {
        undoUnread(itemId);
      }
      const channelId = item.item.channelId ?? null;
      const hasAnotherChannelOverride = locallyUnreadFeedItems.some(
        (feedItem) =>
          feedItem.channelId === channelId && !clearedItemIds.has(feedItem.id),
      );
      if (channelId && !hasAnotherChannelOverride) {
        clearChannelUnreadSource(channelId, "inbox");
      }
    },
    [clearChannelUnreadSource, locallyUnreadFeedItems, undoUnread],
  );

  const handleMarkRead = React.useCallback(
    (item: InboxItem) => {
      clearUnreadOverride(item);
      for (const reply of item.groupItems) {
        markMessageRead(reply.id, reply.createdAt);
      }
      markThreadRead(item.conversationId, item.latestActivityAt);
    },
    [clearUnreadOverride, markMessageRead, markThreadRead],
  );

  if (!hasContent) {
    return children;
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover/focus events bubble from the nested channel button while the wrapper keeps the preview interactive. */}
      <div
        className="w-full min-w-0"
        onBlur={closeWithDelay}
        onContextMenu={() => setOpen(false)}
        onFocus={openImmediately}
        onMouseEnter={openWithDelay}
        onMouseLeave={closeWithDelay}
      >
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      </div>
      <PopoverContent
        align="start"
        className="flex w-96 flex-col gap-3.5 rounded-colony-popover bg-colony-pop p-4"
        data-testid={`channel-activity-popover-${channel.name}`}
        onFocusCapture={keepOpen}
        onMouseEnter={keepOpen}
        onMouseLeave={closeWithDelay}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="right"
        sideOffset={8}
        style={ACTIVITY_POPOVER_MOTION_STYLE}
      >
        <section
          aria-label="Channel activity"
          className="flex max-h-[28rem] min-h-0 flex-col gap-3.5 overflow-hidden"
        >
          <h3
            className="m-0 flex items-center gap-2.5"
            data-testid="channel-activity-header"
          >
            <ChannelGlyph channel={channel} className="size-4.5" />
            <span className="flex-1 truncate text-base font-extrabold">
              {channel.name}
            </span>
            <span className={EYEBROW_CLASS}>Channel activity</span>
          </h3>
          <div
            className="buzz-channel-activity-scrollbar flex min-h-0 flex-col gap-3.5 overflow-y-auto overscroll-contain"
            data-testid="channel-activity-scroll"
          >
            {activeWorking?.agentPubkeys.length ? (
              <div className="flex flex-col gap-1">
                <span className={`${EYEBROW_CLASS} pb-1`}>Agents working</span>
                <WorkingAgentRows
                  activeWorking={activeWorking}
                  channelId={channel.id}
                  onOpen={(_pubkey, channelId) => {
                    setOpen(false);
                    void goChannel(channelId);
                  }}
                  profiles={profiles}
                />
              </div>
            ) : null}
            {activityItems.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className={`${EYEBROW_CLASS} pb-0.5`}>
                  Unread threads
                </span>
                {activityItems.map((item) => (
                  <ThreadPreviewRow
                    isAgent={
                      profiles?.[normalizePubkey(item.item.pubkey)]?.isAgent ===
                      true
                    }
                    item={item}
                    key={item.conversationId}
                    onMarkRead={() => handleMarkRead(item)}
                    onOpen={() => {
                      clearUnreadOverride(item);
                      setOpen(false);
                      void goChannel(channel.id, {
                        messageId: item.id,
                        threadRootId: item.conversationId,
                      });
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
