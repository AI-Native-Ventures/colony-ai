import * as React from "react";
import { Link } from "@tanstack/react-router";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { needsMeAskLabel } from "@/features/company-asks/askCardMapping";
import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import { useCofounderSettingsQuery } from "@/features/cofounder/hooks";
import { useHomeFeedQuery } from "@/features/home/hooks";
import { useNeedsMeQuery } from "@/features/home/needsMeHooks";
import {
  buildNeedsMeItems,
  groupNeedsMeItems,
  isNeedsMeItemOverdue,
  needsMeItemKey,
  type NeedsMeGrouping,
  type NeedsMeItem,
} from "@/features/home/needsMeOrdering";
import { getThreadReference } from "@/features/messages/lib/threading";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { FeedItem } from "@/shared/api/types";
import { NeedsYouPlaybookList } from "@/features/cofounder/ui/NeedsYouPlaybookList";
import {
  ChevronRightIcon,
  SearchIcon,
  TodayIcon,
} from "@/shared/ui/colonyIcons";
import { AlertCircleIcon, BellIcon, WarningIcon } from "./homeIcons";
import "./TodayScreen.css";

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatActivityTime(createdAt: number) {
  return formatClock(new Date(createdAt * 1_000));
}

/** "Friday, 23 October". */
function todayLabel(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")}`;
}

function capitalise(label: string) {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sameDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

/** "22 Oct, 17:00", "Today, 14:00" or "Sat 24 Oct, 12:00". */
function deadlineText(deadline: string | null | undefined, now: Date) {
  if (!deadline) return null;
  const timestamp = Date.parse(deadline);
  if (!Number.isFinite(timestamp)) return "Deadline unavailable";
  const date = new Date(timestamp);
  const time = formatClock(date);
  if (sameDay(date, now)) return `Today, ${time}`;
  if (date.getTime() < now.getTime()) {
    const day = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
    }).format(date);
    return `${day}, ${time}`;
  }
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(",", "");
  return `${day}, ${time}`;
}

function movingForwardItems(
  feed:
    | NonNullable<ReturnType<typeof useHomeFeedQuery>["data"]>["feed"]
    | undefined,
) {
  if (!feed) return [];
  const items = [...feed.activity, ...feed.agentActivity];
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((first, second) => second.createdAt - first.createdAt);
}

type ProfileLookup = Record<
  string,
  { avatarUrl: string | null; displayName: string | null; isAgent?: boolean }
>;

function PersonAvatar({
  className,
  fallbackLabel,
  profiles,
  pubkey,
}: {
  className?: string;
  fallbackLabel: string;
  profiles?: ProfileLookup;
  pubkey?: string;
}) {
  const profile = pubkey ? profiles?.[pubkey.toLowerCase()] : undefined;
  return (
    <ProfileAvatar
      avatarUrl={profile?.avatarUrl ?? null}
      className={className}
      label={profile?.displayName ?? fallbackLabel}
      pubkey={pubkey}
      shape={profile?.isAgent === true ? "squircle" : "circle"}
    />
  );
}

function AskNeedsMeRow({
  record,
  currentPubkey,
  profiles,
  channelName,
  now,
  onOpen,
}: {
  record: AskHeadRecord;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  channelName: string;
  now: Date;
  onOpen: (record: AskHeadRecord) => void;
}) {
  const ask = record.head.ask;
  const asker = resolveUserLabel({
    pubkey: record.head.askerPubkey,
    currentPubkey,
    profiles,
  });
  const overdue =
    ask.decideBy !== undefined &&
    ask.decideBy !== null &&
    Date.parse(ask.decideBy) < now.getTime();
  const when = deadlineText(ask.decideBy, now);
  return (
    <button
      aria-label={`Open ${ask.title}`}
      className="ct-row"
      data-ask-id={ask.askId}
      data-testid={`today-ask-${ask.askId}`}
      onClick={() => onOpen(record)}
      type="button"
    >
      <PersonAvatar
        className="ct-row-avatar"
        fallbackLabel={asker}
        profiles={profiles as ProfileLookup | undefined}
        pubkey={record.head.askerPubkey}
      />
      <span className="ct-row-copy">
        <strong>{ask.title}</strong>
        <small>
          {asker} · #{channelName}
          {when ? ` · ${when}` : ""}
        </small>
      </span>
      <span className="ct-chips">
        <span className="ct-chip">{capitalise(needsMeAskLabel(ask))}</span>
        {overdue ? (
          <span className="ct-chip" data-tone="need">
            Overdue
          </span>
        ) : null}
      </span>
      <ChevronRightIcon className="ct-chevron" size={18} strokeWidth={2.4} />
    </button>
  );
}

function MovingForwardRow({
  item,
  profiles,
  onOpen,
}: {
  item: FeedItem;
  profiles?: ProfileLookup;
  onOpen: (item: FeedItem) => void;
}) {
  const content = item.content.trim();
  const secondary = [
    item.channelName ? `#${item.channelName}` : null,
    formatActivityTime(item.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");
  const knownAuthor = Boolean(profiles?.[item.pubkey.toLowerCase()]);
  const lead = knownAuthor ? (
    <PersonAvatar
      className="ct-forward-avatar"
      fallbackLabel="Agent"
      profiles={profiles}
      pubkey={item.pubkey}
    />
  ) : (
    <span
      aria-hidden="true"
      className="ct-forward-tile"
      data-tone={item.category === "agent_activity" ? undefined : "bad"}
    >
      {item.category === "agent_activity" ? (
        <BellIcon size={17} />
      ) : (
        <WarningIcon size={17} strokeWidth={2.4} />
      )}
    </span>
  );
  const copy = (
    <span className="ct-forward-copy">
      <strong>{content}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </span>
  );

  return item.channelId ? (
    <button
      aria-label={`Open ${item.channelName || "channel"}: ${content}`}
      className="ct-forward-row"
      data-testid={`today-attention-${item.id}`}
      onClick={() => onOpen(item)}
      type="button"
    >
      {lead}
      {copy}
    </button>
  ) : (
    <article
      className="ct-forward-row"
      data-testid={`today-attention-${item.id}`}
    >
      {lead}
      {copy}
    </article>
  );
}

/** The top bar's title and actions, in the shell bar's content slot. */
function TodayTopBar({ onOpenInbox }: { onOpenInbox: () => void }) {
  const openSearch = React.useCallback(() => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  }, []);

  return (
    <AppTopChromePortal>
      <span className="ct-topbar-title">
        <TodayIcon size={17} />
        Today
      </span>
      <span className="flex-1" />
      <button
        aria-label="Search workspace"
        className="ct-topbar-action"
        onClick={openSearch}
        type="button"
      >
        <SearchIcon size={19} strokeWidth={2.2} />
      </button>
      <button
        aria-label="Open Activity"
        className="ct-topbar-action"
        onClick={onOpenInbox}
        type="button"
      >
        <BellIcon size={19} />
      </button>
    </AppTopChromePortal>
  );
}

/** `showUpdatesAction` is accepted for old routes; Team updates are not in this build. */
export function TodayScreen(_props: { showUpdatesAction?: boolean } = {}) {
  const feedQuery = useHomeFeedQuery();
  const needsMe = useNeedsMeQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const { activeCommunity } = useCommunities();
  const cofounderSettings = useCofounderSettingsQuery(
    activeCommunity?.id ?? null,
  );
  const [needsMeGrouping, setNeedsMeGrouping] =
    React.useState<NeedsMeGrouping>("deadline");
  const [showOverdueOnly, setShowOverdueOnly] = React.useState(false);
  const [visibleLimit, setVisibleLimit] = React.useState(6);
  const needItems = React.useMemo(
    () => buildNeedsMeItems(needsMe.data).filter((item) => item.kind === "ask"),
    [needsMe.data],
  );
  const forwardItems = React.useMemo(
    () => movingForwardItems(feedQuery.data?.feed),
    [feedQuery.data],
  );
  const profilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...needItems.flatMap((item) =>
          item.kind === "ask" ? [item.record.head.askerPubkey] : [],
        ),
        ...forwardItems.map((item) => item.pubkey),
        ...(identityQuery.data?.pubkey ? [identityQuery.data.pubkey] : []),
      ]),
    ],
    [forwardItems, identityQuery.data?.pubkey, needItems],
  );
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: profilePubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles;
  const { goAskDetail, goChannel, goHome } = useAppNavigation();
  const needsMeErrors = [
    ...new Set(
      [needsMe.asksError?.message].filter((message): message is string =>
        Boolean(message),
      ),
    ),
  ];

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

  const openAsk = React.useCallback(
    (record: AskHeadRecord) => {
      void goAskDetail(
        record.channelId,
        record.head.askId,
        record.head.ask.type === "tool_consent",
      );
    },
    [goAskDetail],
  );

  const channelName = React.useCallback(
    (channelId: string) =>
      channelsQuery.data?.find((channel) => channel.id === channelId)?.name ??
      "conversation",
    [channelsQuery.data],
  );
  const now = new Date();
  const groupingNow = now.getTime();
  const overdueItems = needItems.filter((item) =>
    isNeedsMeItemOverdue(item, groupingNow),
  );
  const showingOverdueOnly = showOverdueOnly && overdueItems.length > 0;
  const visibleSource = showingOverdueOnly ? overdueItems : needItems;
  const visibleItems = visibleSource.slice(0, visibleLimit);
  const groupedItems = groupNeedsMeItems(visibleItems, needsMeGrouping, {
    now: groupingNow,
    channelLabel: (channelId) => `#${channelName(channelId)}`,
  });

  const renderNeedsMeItem = (item: NeedsMeItem) =>
    item.kind === "ask" ? (
      <AskNeedsMeRow
        channelName={channelName(item.record.channelId)}
        currentPubkey={identityQuery.data?.pubkey}
        key={needsMeItemKey(item)}
        now={now}
        onOpen={openAsk}
        profiles={profiles}
        record={item.record}
      />
    ) : null;

  const retryNeedsMe = React.useCallback(() => {
    void needsMe.refetch();
  }, [needsMe.refetch]);

  return (
    <div className="ct-screen" data-testid="today-screen">
      <TodayTopBar onOpenInbox={() => void goHome()} />
      <div className="ct-scroll">
        <div className="ct-page">
          <div className="ct-heading">
            <h1>Today</h1>
            <div className="ct-heading-meta">
              <span>{todayLabel(now)}</span>
              {cofounderSettings.data?.settings.enabled ? (
                <Link
                  className="ct-needs-you-link"
                  data-testid="today-needs-you-link"
                  to="/today/needs-you"
                >
                  Needs you
                </Link>
              ) : null}
            </div>
          </div>

          <div className="ct-columns">
            <section aria-label="Needs me" className="ct-needs">
              <div className="ct-needs-head">
                <h2>Needs me</h2>
                <span className="ct-needs-count">
                  {needsMeErrors.length > 0
                    ? "Open asks unavailable"
                    : `${needItems.length} open ${needItems.length === 1 ? "decision" : "decisions"}`}
                </span>
                {needItems.length > 0 && overdueItems.length > 0 ? (
                  <button
                    aria-label={
                      showingOverdueOnly
                        ? "Show all decisions"
                        : "Show overdue decisions"
                    }
                    aria-pressed={showingOverdueOnly}
                    className="ct-overdue-pill"
                    data-testid="needs-me-overdue-toggle"
                    onClick={() => setShowOverdueOnly((current) => !current)}
                    type="button"
                  >
                    <AlertCircleIcon size={14} strokeWidth={2.6} />
                    {overdueItems.length} overdue
                  </button>
                ) : null}
                {needItems.length > 0 ? (
                  <fieldset className="ct-group-by">
                    <legend className="sr-only">Group decisions</legend>
                    {(
                      [
                        ["deadline", "By deadline"],
                        ["type", "By type"],
                        ["channel", "By channel"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        aria-pressed={needsMeGrouping === value}
                        data-testid={`needs-me-group-${value}`}
                        key={value}
                        onClick={() => setNeedsMeGrouping(value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </fieldset>
                ) : null}
              </div>

              {overdueItems.length > 0 ? (
                <div className="ct-overdue-note" role="status">
                  <AlertCircleIcon size={18} strokeWidth={2.4} />
                  <span>
                    <strong>
                      {overdueItems.length === 1
                        ? "1 ask is overdue."
                        : `${overdueItems.length} asks are overdue.`}
                    </strong>{" "}
                    It stays open until it’s answered, withdrawn or expires.
                  </span>
                </div>
              ) : null}

              {needItems.length > 0 ? (
                <>
                  {groupedItems.overdue.length > 0 ? (
                    <section aria-label="Overdue" className="ct-group">
                      <h3>Overdue</h3>
                      {groupedItems.overdue.map(renderNeedsMeItem)}
                    </section>
                  ) : null}
                  {!showingOverdueOnly || needsMeGrouping !== "deadline"
                    ? groupedItems.groups.map((group) => (
                        <section
                          aria-label={group.label}
                          className="ct-group"
                          key={group.key}
                        >
                          <h3>{group.label}</h3>
                          {group.items.map(renderNeedsMeItem)}
                        </section>
                      ))
                    : null}
                  {visibleSource.length > visibleItems.length ? (
                    <button
                      className="ct-more"
                      data-testid="needs-me-show-more"
                      onClick={() => setVisibleLimit((current) => current + 12)}
                      type="button"
                    >
                      Show{" "}
                      {Math.min(12, visibleSource.length - visibleItems.length)}{" "}
                      more
                    </button>
                  ) : null}
                </>
              ) : needsMe.isPending ? (
                <p className="ct-state" role="status">
                  Loading open decisions…
                </p>
              ) : needsMeErrors.length === 0 ? (
                <div className="ct-empty" role="status">
                  <h3>You’re up to date.</h3>
                  <p>No open asks are addressed to you.</p>
                </div>
              ) : null}
              {needsMeErrors.length > 0 ? (
                <div className="ct-error" role="alert">
                  <p>
                    {needItems.length > 0
                      ? "Some decisions may be unavailable or out of date."
                      : "Needs me could not be loaded."}
                  </p>
                  <ul>
                    {needsMeErrors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                  <button
                    className="ct-button"
                    onClick={retryNeedsMe}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : null}
              <NeedsYouPlaybookList />
            </section>

            {forwardItems.length > 0 || feedQuery.error ? (
              <section aria-label="Moving forward" className="ct-forward">
                <h2>Moving forward</h2>
                {feedQuery.error ? (
                  <p className="ct-error" role="alert">
                    {feedQuery.error instanceof Error
                      ? feedQuery.error.message
                      : "Recent activity could not be loaded."}
                  </p>
                ) : null}
                <div className="ct-forward-list">
                  {forwardItems.map((item) => (
                    <MovingForwardRow
                      item={item}
                      key={item.id}
                      onOpen={openItem}
                      profiles={profiles as ProfileLookup | undefined}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export { TodayTopBar };
