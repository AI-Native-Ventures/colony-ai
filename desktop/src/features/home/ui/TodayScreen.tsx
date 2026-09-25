import { Bot, Bell, CircleAlert, Folder, House, Search } from "lucide-react";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useHomeFeedQuery } from "@/features/home/hooks";
import { getThreadReference } from "@/features/messages/lib/threading";
import type { FeedItem } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";

function formatTodayDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatActivityTime(createdAt: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt * 1_000));
}

function attentionItems(
  feed:
    | NonNullable<ReturnType<typeof useHomeFeedQuery>["data"]>["feed"]
    | undefined,
) {
  if (!feed) return [];
  const items = [...feed.needsAction, ...feed.mentions, ...feed.agentActivity];
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((first, second) => second.createdAt - first.createdAt);
}

function AttentionRow({
  item,
  onOpen,
}: {
  item: FeedItem;
  onOpen: (item: FeedItem) => void;
}) {
  const Icon =
    item.category === "agent_activity"
      ? Bot
      : item.category === "mention"
        ? Bell
        : CircleAlert;
  const secondary = [
    item.channelName ? `#${item.channelName}` : null,
    formatActivityTime(item.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
  const content = item.content.trim();

  return item.channelId ? (
    <button
      aria-label={`Open ${item.channelName || "channel"}: ${content}`}
      className="colony-today-attention-row"
      data-testid={`today-attention-${item.id}`}
      onClick={() => onOpen(item)}
      type="button"
    >
      <span aria-hidden="true" className="colony-today-attention-icon">
        <Icon />
      </span>
      <span className="colony-today-attention-copy">
        {secondary ? <small>{secondary}</small> : null}
        <strong>{content}</strong>
      </span>
      <span aria-hidden="true" className="colony-today-chevron">
        ›
      </span>
    </button>
  ) : (
    <article className="colony-today-attention-row">
      <span aria-hidden="true" className="colony-today-attention-icon">
        <Icon />
      </span>
      <span className="colony-today-attention-copy">
        {secondary ? <small>{secondary}</small> : null}
        <strong>{content}</strong>
      </span>
    </article>
  );
}

function TodayTopBar({ onOpenInbox }: { onOpenInbox: () => void }) {
  const openSearch = React.useCallback(() => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  }, []);

  return (
    <WorkspaceTopBar
      actions={
        <>
          <button
            aria-label="Search workspace"
            onClick={openSearch}
            type="button"
          >
            <Search aria-hidden="true" />
          </button>
          <button aria-label="Open Inbox" onClick={onOpenInbox} type="button">
            <Bell aria-hidden="true" />
          </button>
        </>
      }
    >
      <House aria-hidden="true" />
      <span>Today</span>
    </WorkspaceTopBar>
  );
}

export function TodayScreen() {
  const feedQuery = useHomeFeedQuery();
  const { goChannel, goHome, goPulse } = useAppNavigation();
  const items = React.useMemo(
    () => attentionItems(feedQuery.data?.feed),
    [feedQuery.data],
  );

  const openItem = React.useCallback(
    (item: FeedItem) => {
      if (!item.channelId) return;
      const threadRootId = getThreadReference(item.tags).rootId;
      void goChannel(item.channelId, {
        messageId: item.id,
        threadRootId,
        thread: threadRootId ?? undefined,
      });
    },
    [goChannel],
  );

  return (
    <div className="colony-today-screen">
      <TodayTopBar onOpenInbox={() => void goHome()} />
      <div className="colony-today-scroll">
        <div className="colony-today-heading">
          <div>
            <h1>Today</h1>
            <p>{formatTodayDate(new Date())}</p>
          </div>
          <Button
            className="colony-secondary-button"
            onClick={() => void goPulse()}
            size="sm"
            type="button"
            variant="outline"
          >
            Team updates
          </Button>
        </div>

        <div className="colony-today-grid">
          <section
            aria-label="Needs your attention"
            className="colony-today-primary"
          >
            {feedQuery.error ? (
              <p className="colony-today-query-error" role="alert">
                {feedQuery.error instanceof Error
                  ? feedQuery.error.message
                  : "Today activity could not be loaded."}
              </p>
            ) : null}
            {items.length > 0 ? (
              items.map((item) => (
                <AttentionRow item={item} key={item.id} onOpen={openItem} />
              ))
            ) : (
              <div className="colony-today-empty" role="status">
                <Folder aria-hidden="true" />
                <h3>You’re up to date</h3>
                <p>New reviews and blockers appear as the team works.</p>
              </div>
            )}
            <div className="colony-today-business-reviews">
              <div className="colony-today-section-heading">
                <h2>Business reviews</h2>
                <span>0</span>
              </div>
            </div>
          </section>

          <aside
            aria-label="Agency activity"
            className="colony-today-secondary"
          >
            <section className="colony-today-card">
              <div className="colony-today-card-heading">
                <h2>With your clients</h2>
                <span>All approvals</span>
              </div>
              <p>No client reviews outstanding.</p>
            </section>
            <section className="colony-today-card">
              <div className="colony-today-card-heading">
                <h2>Next delivery</h2>
                <span>Queue</span>
              </div>
              <p>No scheduled content.</p>
            </section>
            <section className="colony-today-card">
              <h2>Money to follow up</h2>
              <p>No overdue invoices.</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

export { TodayTopBar };
