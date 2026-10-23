import {
  AlertCircle,
  Ellipsis,
  ExternalLink,
  LoaderCircle,
  MailOpen,
} from "lucide-react";
import * as React from "react";

import {
  getInboxTypeLabel,
  type InboxFilter,
  type InboxItem,
  type InboxTypeLabel,
} from "@/features/home/lib/inbox";
import { hasRenderedVideoAttachment } from "@/features/messages/lib/videoReviewContext";
import { getThreadReference } from "@/features/messages/lib/threading";
import {
  InboxFilterChips,
  InboxFilterMenu,
} from "@/features/home/ui/InboxFilterMenu";
import {
  DraftsPanel,
  type DraftViewItem,
} from "@/features/messages/ui/DraftsPanel";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Separator } from "@/shared/ui/separator";
import { Switch } from "@/shared/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { VirtualizedList } from "@/shared/ui/VirtualizedList";
import "./ActivityScreen.css";

const INBOX_EMPTY_STATE_TITLES: Record<InboxFilter, string> = {
  all: "No activity yet",
  project: "No project work found",
  mention: "No mentions found",
  thread: "No threads found",
  needs_action: "Nothing needs action",
  agent_activity: "No agent updates found",
  reminders: "No reminders",
  drafts: "No drafts",
};

const INBOX_UNREAD_EMPTY_STATE_TITLES: Record<InboxFilter, string> = {
  all: "No unread activity",
  project: "No unread project work",
  mention: "No unread mentions",
  thread: "No unread threads",
  needs_action: "No unread items needing action",
  agent_activity: "No unread agent updates",
  reminders: "No unread reminders",
  drafts: "No unread drafts",
};

/** "Needs action in #Sales": what the item is and where it happened. */
function InboxKindLine({
  isDone,
  isActionRequired,
  label,
}: {
  isDone: boolean;
  isActionRequired: boolean;
  label: InboxTypeLabel;
}) {
  const text = label.channelLabel
    ? label.separator
      ? `${label.text} ${label.separator} #${label.channelLabel}`
      : `${label.text} #${label.channelLabel}`
    : label.text;
  return (
    <div
      className="ca-row-kind"
      data-done={isDone ? "true" : undefined}
      data-inbox-type-label=""
      data-tone={isActionRequired && !isDone ? "need" : undefined}
    >
      {text}
    </div>
  );
}

function getInboxVideoReviewCommentRootId(item: InboxItem) {
  const feedItems = [item.item, ...item.groupItems];
  const feedItemById = new Map(
    feedItems.map((feedItem) => [feedItem.id, feedItem]),
  );
  const videoMessageIds = new Set(
    feedItems
      .filter((feedItem) =>
        hasRenderedVideoAttachment({
          body: feedItem.content,
          tags: feedItem.tags,
        }),
      )
      .map((feedItem) => feedItem.id),
  );
  const visited = new Set<string>();
  let ancestorId = getThreadReference(item.item.tags).parentId;

  while (ancestorId && !visited.has(ancestorId)) {
    if (videoMessageIds.has(ancestorId)) return ancestorId;
    visited.add(ancestorId);
    const ancestor = feedItemById.get(ancestorId);
    ancestorId = ancestor ? getThreadReference(ancestor.tags).parentId : null;
  }

  return undefined;
}

type InboxListPaneProps = {
  agentPubkeys?: ReadonlySet<string>;
  activeDraftCount: number;
  draftItems: DraftViewItem[];
  doneSet: ReadonlySet<string>;
  filter: InboxFilter;
  items: InboxItem[];
  onFilterChange: (filter: InboxFilter) => void;
  onDeleteDraft: (draftKey: string) => void;
  onMarkRead: (itemId: string) => void;
  onMarkUnread: (itemId: string) => void;
  onOpenDirect: (item: InboxItem) => void;
  isReopenPending?: (channelId: string | null | undefined) => boolean;
  isReopenErrored?: (channelId: string | null | undefined) => boolean;
  onSelect: (itemId: string) => void;
  onSelectDraft: (draftKey: string) => void;
  onUnreadOnlyChange: (checked: boolean) => void;
  selectedConversationId: string | null;
  selectedDraftKey: string | null;
  showRightDivider?: boolean;
  unreadOnly: boolean;
};

export function InboxListPane({
  agentPubkeys,
  activeDraftCount,
  draftItems,
  doneSet,
  filter,
  items,
  onFilterChange,
  onDeleteDraft,
  onMarkRead,
  onMarkUnread,
  onOpenDirect,
  isReopenPending,
  isReopenErrored,
  onSelect,
  onSelectDraft,
  onUnreadOnlyChange,
  selectedConversationId,
  selectedDraftKey,
  showRightDivider = false,
  unreadOnly,
}: InboxListPaneProps) {
  const isDrafts = filter === "drafts";
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const unreadVisibleItemCount = React.useMemo(
    () =>
      items.reduce((count, item) => count + (doneSet.has(item.id) ? 0 : 1), 0),
    [doneSet, items],
  );
  const handleMarkAllRead = React.useCallback(() => {
    for (const item of items) {
      if (!doneSet.has(item.id)) {
        onMarkRead(item.id);
      }
    }
  }, [doneSet, items, onMarkRead]);

  const renderItem = (item: InboxItem) => {
    const isSelected = item.conversationId === selectedConversationId;
    const isDone = doneSet.has(item.id);
    const hasChannelTarget = Boolean(item.item.channelId);
    const isReopening = isReopenPending?.(item.item.channelId) ?? false;
    const hasReopenError = isReopenErrored?.(item.item.channelId) ?? false;
    const canOpen = hasChannelTarget && !isReopening;
    const openLabel = !hasChannelTarget
      ? "No channel link"
      : isReopening
        ? "Reopening…"
        : "Open in channel";
    const typeLabel = getInboxTypeLabel(item);
    const videoReviewCommentRootId = getInboxVideoReviewCommentRootId(item);
    const isSenderAgent =
      agentPubkeys?.has(normalizePubkey(item.item.pubkey)) === true;
    const profileRole = isSenderAgent ? "bot" : undefined;
    const handleRowContentClick = (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-inbox-profile-trigger]")
      ) {
        return;
      }
      onSelect(item.id);
    };
    const markAction = isDone ? (
      <button
        aria-label="Mark unread"
        className="ca-row-action"
        onClick={(event) => {
          event.stopPropagation();
          onMarkUnread(item.id);
        }}
        type="button"
      >
        Mark unread
      </button>
    ) : (
      <button
        aria-label="Mark as read"
        className="ca-row-action"
        onClick={(event) => {
          event.stopPropagation();
          onMarkRead(item.id);
        }}
        type="button"
      >
        Mark as read
      </button>
    );
    const row = (
      <div
        aria-current={isSelected ? "true" : undefined}
        className="ca-row group/inbox-item"
        data-selected={isSelected ? "true" : undefined}
        data-testid={`home-inbox-item-${item.id}`}
      >
        <button
          aria-label={`Open inbox item from ${item.senderLabel}`}
          className="ca-row-hit"
          onClick={() => onSelect(item.id)}
          type="button"
        />

        {/* biome-ignore lint/a11y: The sibling full-row button provides keyboard/screen-reader row activation; this wrapper delegates pointer selection while allowing nested profile triggers. */}
        <div className="ca-row-inner" onClick={handleRowContentClick}>
          <div className="ca-row-lead" data-inbox-profile-trigger="true">
            <UserProfilePopover
              botIdenticonValue={item.senderLabel}
              pubkey={item.item.pubkey}
              role={profileRole}
              triggerClassName={cn(
                "shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                isSenderAgent ? "rounded-[30%]" : "rounded-full",
              )}
              triggerElement="span"
              triggerTestId={`home-inbox-avatar-${item.id}`}
            >
              <span className="inline-flex shrink-0">
                <ProfileAvatar
                  avatarUrl={item.avatarUrl}
                  className="ca-row-avatar"
                  label={item.senderLabel}
                  shape={isSenderAgent ? "squircle" : "circle"}
                />
              </span>
            </UserProfilePopover>
          </div>

          <div className="ca-row-body">
            <div className="ca-row-top">
              <span className="ca-row-name" data-inbox-profile-trigger="true">
                <UserProfilePopover
                  botIdenticonValue={item.senderLabel}
                  pubkey={item.item.pubkey}
                  role={profileRole}
                  triggerElement="span"
                >
                  <span className="ca-row-name-text">{item.senderLabel}</span>
                </UserProfilePopover>
              </span>
              <span className="ca-row-meta">
                {!isDone && item.unreadCount <= 1 ? (
                  <span aria-hidden="true" className="ca-row-dot" />
                ) : null}
                {item.unreadCount > 1 ? (
                  <span
                    className="ca-row-unread"
                    data-testid="home-inbox-unread-count"
                  >
                    {item.unreadCount} unread
                  </span>
                ) : null}
                <span className="ca-row-time">{item.timestampLabel}</span>
              </span>
            </div>
            <InboxKindLine
              isActionRequired={item.isActionRequired}
              isDone={isDone}
              label={typeLabel}
            />

            {isReopening || hasReopenError ? (
              <div
                aria-live="polite"
                className="ca-row-status"
                data-tone={hasReopenError ? "bad" : undefined}
                data-testid={`home-inbox-reopen-status-${item.id}`}
                role="status"
              >
                {isReopening ? (
                  <>
                    <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
                    Reopening…
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    Couldn’t reopen
                    {canOpen ? (
                      <button
                        className="ml-0.5 rounded font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid={`home-inbox-reopen-retry-${item.id}`}
                        onClick={(event) => {
                          // The row wrapper selects on click; stop it so
                          // Retry only re-issues the reopen for this row.
                          event.stopPropagation();
                          onOpenDirect(item);
                        }}
                        type="button"
                      >
                        Retry
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            <div
              className="ca-row-preview"
              data-done={isDone ? "true" : undefined}
            >
              <VideoReviewCommentMarkdown
                className="inbox-preview-markdown text-inherit"
                content={item.preview}
                interactive={false}
                mentionNames={item.mentionNames}
                videoReviewCommentRootId={videoReviewCommentRootId}
              />
            </div>

            {isSelected ? (
              <div className="ca-row-actions">
                {markAction}
                <button
                  aria-label={openLabel}
                  className="ca-row-action"
                  disabled={!canOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (canOpen) onOpenDirect(item);
                  }}
                  type="button"
                >
                  {openLabel}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {isSelected ? null : (
          <div className="ca-row-hover-actions">
            {isDone ? (
              <InboxRowActionButton
                label="Mark unread"
                onClick={() => onMarkUnread(item.id)}
              >
                <MailOpen className="!h-4 !w-4" />
              </InboxRowActionButton>
            ) : (
              <InboxRowActionButton
                label="Mark as read"
                onClick={() => onMarkRead(item.id)}
              >
                <MailOpen className="!h-4 !w-4" />
              </InboxRowActionButton>
            )}
            <InboxRowActionButton
              disabled={!canOpen}
              label={openLabel}
              onClick={() => onOpenDirect(item)}
            >
              <ExternalLink className="!h-4 !w-4" />
            </InboxRowActionButton>
          </div>
        )}
      </div>
    );

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          {isDone ? (
            <ContextMenuItem onClick={() => onMarkUnread(item.id)}>
              <MailOpen className="h-4 w-4" />
              Mark unread
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => onMarkRead(item.id)}>
              <MailOpen className="h-4 w-4" />
              Mark as read
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!canOpen}
            onClick={() => {
              if (canOpen) {
                onOpenDirect(item);
              }
            }}
          >
            <ExternalLink className="h-4 w-4" />
            {openLabel}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <section
      className="ca-list"
      data-divider={showRightDivider ? "true" : undefined}
      data-testid="home-inbox-list-pane"
    >
      <header className="ca-list-head" data-tauri-drag-region>
        <div className="ca-title-row">
          <h1>Activity</h1>
          <InboxFilterMenu
            activeDraftCount={activeDraftCount}
            filter={filter}
            onFilterChange={onFilterChange}
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label="Inbox options"
                className="ca-options-button"
                data-testid="inbox-options-trigger"
                type="button"
              >
                <Ellipsis aria-hidden="true" size={18} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-2">
              <div
                className={cn(
                  "flex min-h-9 items-center justify-between gap-3 rounded-lg px-2 py-1.5",
                  isDrafts && "opacity-50",
                )}
              >
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="inbox-unread-only-switch"
                >
                  Show unread only
                </label>
                <Switch
                  checked={unreadOnly}
                  data-testid="inbox-unread-only-toggle"
                  disabled={isDrafts}
                  id="inbox-unread-only-switch"
                  onCheckedChange={onUnreadOnlyChange}
                />
              </div>
              <Separator className="my-1 bg-muted" />
              <button
                className="flex min-h-9 w-full items-center rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50"
                disabled={unreadVisibleItemCount === 0}
                onClick={handleMarkAllRead}
                type="button"
              >
                <span>Mark all as read</span>
                {unreadVisibleItemCount > 0 ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {unreadVisibleItemCount}
                  </span>
                ) : null}
              </button>
            </PopoverContent>
          </Popover>
        </div>
        <InboxFilterChips
          activeDraftCount={activeDraftCount}
          filter={filter}
          onFilterChange={onFilterChange}
        />
      </header>

      {isDrafts ? (
        <div className="ca-list-drafts" data-testid="home-inbox-drafts">
          <DraftsPanel
            items={draftItems}
            onDeleteDraft={onDeleteDraft}
            onSelectDraft={onSelectDraft}
            selectedDraftKey={selectedDraftKey}
          />
        </div>
      ) : (
        <div
          className="ca-list-body"
          data-testid="home-inbox-list"
          ref={scrollRef}
        >
          {items.length > 0 ? (
            <VirtualizedList
              estimateSize={112}
              getItemKey={(item) => `inbox:${item.conversationId}`}
              items={items}
              renderItem={(item) => renderItem(item)}
              scrollRef={scrollRef}
            />
          ) : (
            <div className="ca-list-empty">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {unreadOnly
                    ? INBOX_UNREAD_EMPTY_STATE_TITLES[filter]
                    : INBOX_EMPTY_STATE_TITLES[filter]}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {unreadOnly
                    ? "Turn off Show unread only to see read activity."
                    : filter === "all"
                      ? "New activity will appear here."
                      : "Switch back to All to see other activity."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function InboxRowActionButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
            active && "bg-blue-500/10 text-blue-500 hover:text-blue-500",
          )}
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (disabled) {
              return;
            }
            onClick();
          }}
          type="button"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
