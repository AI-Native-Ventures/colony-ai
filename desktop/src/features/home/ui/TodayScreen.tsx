import {
  ArrowRight,
  Bot,
  Bell,
  CircleAlert,
  House,
  Search,
} from "lucide-react";
import * as React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useHomeFeedQuery } from "@/features/home/hooks";
import { useNeedsMeQuery } from "@/features/home/needsMeHooks";
import { useApprovalMutation } from "@/features/workflows/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getThreadReference } from "@/features/messages/lib/threading";
import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import type { PendingWorkflowApproval } from "@/features/home/needsMe";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import type { TeamMember } from "@/features/company-team/teamModels";
import { useEmployeeRuntime } from "@/features/company-team/useEmployeeRuntime";
import type { FeedItem } from "@/shared/api/types";
import { ColonyAntAvatar } from "@/shared/ui/ColonyAntAvatar";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { Button } from "@/shared/ui/button";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import {
  buildNeedsMeItems,
  groupNeedsMeItems,
  isNeedsMeItemOverdue,
  needsMeItemKey,
  type NeedsMeGrouping,
  type NeedsMeItem,
} from "@/features/home/needsMeOrdering";
import { needsMeAskLabel } from "@/features/company-asks/askCardMapping";
import { normalizePubkey } from "@/shared/lib/pubkey";

function formatActivityTime(createdAt: number) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt * 1_000));
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

function deadlineLabel(deadline: string | null | undefined) {
  if (!deadline) return "No deadline";
  const timestamp = Date.parse(deadline);
  if (!Number.isFinite(timestamp)) return "Deadline unavailable";
  const date = new Date(timestamp);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (first: Date, second: Date) =>
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate();
  const day = sameDay(date, today)
    ? "Today"
    : sameDay(date, tomorrow)
      ? "Tomorrow"
      : new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day}, ${time}`;
}

function needsMeDateLabel(deadline: string | null | undefined) {
  if (!deadline) return "No deadline";
  const timestamp = Date.parse(deadline);
  if (!Number.isFinite(timestamp)) return "Deadline unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function AskNeedsMeRow({
  record,
  currentPubkey,
  profiles,
  teamMembers,
  channelName,
  onOpen,
}: {
  record: AskHeadRecord;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  teamMembers: TeamMember[];
  channelName: string;
  onOpen: (record: AskHeadRecord) => void;
}) {
  const ask = record.head.ask;
  const askerProfile = profiles?.[normalizePubkey(record.head.askerPubkey)];
  const employee = teamMembers.find(
    (member) =>
      member.kind === "employee" &&
      normalizePubkey(member.pubkey) ===
        normalizePubkey(record.head.askerPubkey),
  );
  const asker = resolveUserLabel({
    pubkey: record.head.askerPubkey,
    currentPubkey,
    profiles,
  });
  const actorName = employee?.fallbackName?.trim() || asker;
  const askerIsAgent = employee !== undefined || askerProfile?.isAgent === true;
  const preview = ask.body?.trim() || ask.toolConsent?.actionPreview?.trim();
  const receivedAt = Date.parse(record.head.createdAt);
  const receivedTime = Number.isFinite(receivedAt)
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(receivedAt))
    : null;
  const overdue =
    ask.decideBy !== undefined &&
    ask.decideBy !== null &&
    Date.parse(ask.decideBy) < Date.now();
  return (
    <button
      aria-label={`Open ${ask.title}`}
      className="colony-needs-me-row"
      data-ask-id={ask.askId}
      data-testid={`today-ask-${ask.askId}`}
      onClick={() => onOpen(record)}
      type="button"
    >
      <span className="colony-canary-ask-topline">
        <span>✓ Waiting for you</span>
        {receivedTime ? (
          <time dateTime={record.head.createdAt}>{receivedTime}</time>
        ) : null}
      </span>
      <span className="colony-canary-ask-kind">{needsMeAskLabel(ask)}</span>
      <strong className="colony-canary-ask-title">{ask.title}</strong>
      {preview ? (
        <span className="colony-canary-ask-preview">{preview}</span>
      ) : null}
      <span className="colony-canary-ask-source">
        {askerIsAgent ? (
          <ColonyAntAvatar className="size-8" decorative name={actorName} />
        ) : askerProfile ? (
          <span aria-hidden="true">
            <UserAvatar
              avatarUrl={askerProfile.avatarUrl ?? null}
              displayName={asker}
              size="sm"
            />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="colony-canary-ask-avatar-pending"
          />
        )}
        <span className="colony-canary-ask-author">{actorName}</span>
        <span className="colony-canary-ask-channel">
          {channelName === "conversation"
            ? "In conversation"
            : `In #${channelName}`}
        </span>
      </span>
      {overdue ? (
        <span className="colony-needs-me-overdue">Overdue</span>
      ) : null}
      {ask.decideBy ? (
        <span className="colony-canary-ask-deadline">
          Decide by {needsMeDateLabel(ask.decideBy)}
        </span>
      ) : null}
      <span className="colony-canary-ask-open" aria-hidden="true">
        Open <ArrowRight size={14} />
      </span>
    </button>
  );
}

function WorkflowApprovalRow({
  record,
  channelName,
  onChanged,
}: {
  record: PendingWorkflowApproval;
  channelName: string;
  onChanged: () => void;
}) {
  const approvalMutation = useApprovalMutation();
  const [error, setError] = React.useState<string | null>(null);
  const runAction = async (action: "grant" | "deny") => {
    setError(null);
    try {
      await approvalMutation.mutateAsync({
        token: record.approval.approvalRef,
        action,
      });
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The workflow approval was not recorded.",
      );
    }
  };
  return (
    <article
      className="colony-needs-me-row colony-needs-me-workflow-row"
      data-testid={`today-workflow-approval-${record.approval.approvalRef}`}
    >
      <span className="colony-needs-me-copy">
        <strong>{record.workflow.name}</strong>
        <small>
          {record.approval.stepId} · #{channelName} · Expires{" "}
          {deadlineLabel(record.approval.expiresAt)}
        </small>
        {error ? (
          <small className="colony-needs-me-error" role="alert">
            {error}
          </small>
        ) : null}
      </span>
      <span className="colony-needs-me-type">approval</span>
      <span className="colony-needs-me-workflow-actions">
        <Button
          disabled={approvalMutation.isPending}
          onClick={() => void runAction("grant")}
          size="sm"
          type="button"
        >
          Approve
        </Button>
        <Button
          disabled={approvalMutation.isPending}
          onClick={() => void runAction("deny")}
          size="sm"
          type="button"
          variant="outline"
        >
          Deny
        </Button>
      </span>
    </article>
  );
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

function TodayEmployeeLine({
  member,
  name,
  onOpen,
}: {
  member: TeamMember;
  name: string;
  onOpen: () => void;
}) {
  const runtime = useEmployeeRuntime(member);
  return (
    <button className="colony-canary-team-line" onClick={onOpen} type="button">
      <ColonyAntAvatar className="size-10" decorative name={name} />
      <span>
        <strong>{name}</strong>
        <small>{member.position?.head.title || "Employee"}</small>
      </span>
      <span className="colony-canary-team-status">{runtime.label}</span>
    </button>
  );
}

export function TodayScreen({
  showUpdatesAction = false,
}: {
  showUpdatesAction?: boolean;
}) {
  const feedQuery = useHomeFeedQuery();
  const needsMe = useNeedsMeQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const teamQuery = useCompanyTeamQuery();
  const location = useLocation();
  const navigate = useNavigate();
  const needsYouView =
    (location.search as { view?: unknown }).view === "needs-you";
  const [needsMeGrouping, setNeedsMeGrouping] =
    React.useState<NeedsMeGrouping>("deadline");
  const [showOverdueOnly, setShowOverdueOnly] = React.useState(false);
  const [visibleLimit, setVisibleLimit] = React.useState(6);
  const needsMeProfilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...(needsMe.data?.asks ?? []).map((record) => record.head.askerPubkey),
        ...(feedQuery.data?.feed.agentActivity ?? []).map(
          (item) => item.pubkey,
        ),
        ...(teamQuery.data?.members ?? []).map((member) => member.pubkey),
        ...(identityQuery.data?.pubkey ? [identityQuery.data.pubkey] : []),
      ]),
    ],
    [
      identityQuery.data?.pubkey,
      needsMe.data?.asks,
      feedQuery.data?.feed.agentActivity,
      teamQuery.data?.members,
    ],
  );
  const needsMeProfilesQuery = useUsersBatchQuery(needsMeProfilePubkeys, {
    enabled: needsMeProfilePubkeys.length > 0,
  });
  const needsMeProfiles = needsMeProfilesQuery.data?.profiles;
  const { goAskDetail, goChannel, goHome, goPulse, goTeam, goTeamMember } =
    useAppNavigation();
  const needsMeErrors = [
    ...new Set(
      [
        needsMe.asksError?.message,
        needsMe.workflowApprovalsError?.message,
      ].filter((message): message is string => Boolean(message)),
    ),
  ];
  const needItems = React.useMemo(
    () => buildNeedsMeItems(needsMe.data),
    [needsMe.data],
  );
  const forwardItems = React.useMemo(
    () => movingForwardItems(feedQuery.data?.feed),
    [feedQuery.data],
  );
  const scoutBrief = React.useMemo(
    () =>
      (feedQuery.data?.feed.agentActivity ?? []).find((item) => {
        const profile = needsMeProfiles?.[normalizePubkey(item.pubkey)];
        const author = profile?.displayName || profile?.name || "";
        return (
          author.trim().toLowerCase() === "scout" &&
          /\bbrief\b/i.test(item.content)
        );
      }) ?? null,
    [feedQuery.data?.feed.agentActivity, needsMeProfiles],
  );
  const employeeMembers = (teamQuery.data?.members ?? []).filter(
    (member) =>
      member.kind === "employee" &&
      member.position?.head.status !== "terminated",
  );
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  const dayPart =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";
  const firstName =
    identityQuery.data?.displayName?.trim().split(/\s+/)[0] ?? "";
  const greeting =
    firstName &&
    firstName.length < 30 &&
    !firstName.toLowerCase().startsWith("npub")
      ? `${dayPart}, ${firstName}.`
      : `${dayPart}.`;

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
  const groupingNow = Date.now();
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

  const renderNeedsMeItem = (item: NeedsMeItem) => {
    if (item.kind === "ask") {
      return (
        <AskNeedsMeRow
          channelName={channelName(item.record.channelId)}
          currentPubkey={identityQuery.data?.pubkey}
          profiles={needsMeProfiles}
          teamMembers={teamQuery.data?.members ?? []}
          key={needsMeItemKey(item)}
          onOpen={openAsk}
          record={item.record}
        />
      );
    }
    return (
      <WorkflowApprovalRow
        channelName={channelName(item.record.channelId)}
        key={needsMeItemKey(item)}
        onChanged={refreshNeedsMe}
        record={item.record}
      />
    );
  };

  const retryNeedsMe = React.useCallback(() => {
    void needsMe.refetch();
  }, [needsMe.refetch]);

  const refreshNeedsMe = React.useCallback(() => {
    void needsMe.refetch();
  }, [needsMe.refetch]);

  return (
    <div
      className="colony-today-screen colony-canary-today"
      data-testid="colony-canary-today"
    >
      <TodayTopBar onOpenInbox={() => void goHome()} />
      <div className="colony-today-scroll">
        <div className="colony-today-heading">
          {needsYouView ? (
            <>
              <button
                className="colony-canary-back"
                onClick={() => void navigate({ to: "/today", search: {} })}
                type="button"
              >
                Today
              </button>
              <h1>Needs you.</h1>
            </>
          ) : (
            <div>
              <span className="colony-canary-date">{dateLabel}</span>
              <h1>{greeting}</h1>
            </div>
          )}
          {showUpdatesAction ? (
            <Button
              className="colony-secondary-button"
              onClick={() => void goPulse()}
              size="sm"
              type="button"
              variant="outline"
            >
              Team updates
            </Button>
          ) : null}
        </div>

        {!needsYouView ? (
          <section
            aria-label="Scout's latest brief"
            className="colony-canary-scout-brief"
          >
            <ColonyAntAvatar className="size-14" decorative name="Scout" />
            <div>
              <div className="colony-canary-brief-meta">
                <strong>
                  Scout · {scoutBrief ? "Latest brief" : "Morning brief"}
                </strong>
                {scoutBrief ? (
                  <span>{formatActivityTime(scoutBrief.createdAt)}</span>
                ) : null}
              </div>
              <p>
                {scoutBrief
                  ? scoutBrief.content
                  : "Scout's brief will appear here when it arrives."}
              </p>
              {scoutBrief ? (
                <button onClick={() => openItem(scoutBrief)} type="button">
                  Open brief <ArrowRight aria-hidden="true" size={14} />
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section aria-label="Needs you" className="colony-today-needs-me">
          <div className="colony-today-needs-me-heading">
            <div className="colony-today-needs-me-summary">
              <h2>Needs you</h2>
              {needsMeErrors.length === 0 && needItems.length > 0 ? (
                <span className="colony-canary-soft-count">
                  {needItems.length}
                </span>
              ) : null}
              {!needsYouView ? (
                <button
                  className="colony-canary-see-all"
                  onClick={() =>
                    void navigate({
                      to: "/today",
                      search: { view: "needs-you" },
                    })
                  }
                  type="button"
                >
                  See all <ArrowRight aria-hidden="true" size={14} />
                </button>
              ) : null}
              {needsYouView &&
              needItems.length > 0 &&
              overdueItems.length > 0 ? (
                <button
                  aria-label={
                    showingOverdueOnly
                      ? "Show all decisions"
                      : "Show overdue decisions"
                  }
                  aria-pressed={showingOverdueOnly}
                  className="colony-needs-me-overdue-toggle"
                  data-testid="needs-me-overdue-toggle"
                  onClick={() => setShowOverdueOnly((current) => !current)}
                  type="button"
                >
                  {overdueItems.length} overdue
                </button>
              ) : null}
            </div>
            {needsYouView && needItems.length > 0 ? (
              <fieldset className="colony-needs-me-group-controls">
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
          {needsYouView && overdueItems.length > 0 ? (
            <div className="colony-needs-me-overdue-note" role="status">
              <strong>{overdueItems.length} asks are overdue</strong>
              <p>They stay open until answered, withdrawn or expired.</p>
            </div>
          ) : null}
          {needItems.length > 0 ? (
            <div
              className={
                needsYouView
                  ? "colony-today-needs-me-list"
                  : "colony-canary-decision-grid"
              }
            >
              {!needsYouView
                ? needItems.slice(0, 2).map(renderNeedsMeItem)
                : null}
              {needsYouView && groupedItems.overdue.length > 0 ? (
                <section aria-label="Overdue" className="colony-needs-me-group">
                  <h3>Overdue</h3>
                  {groupedItems.overdue.map(renderNeedsMeItem)}
                </section>
              ) : null}
              {needsYouView &&
              (!showingOverdueOnly || needsMeGrouping !== "deadline")
                ? groupedItems.groups.map((group) => (
                    <section
                      aria-label={group.label}
                      className="colony-needs-me-group"
                      key={group.key}
                    >
                      <h3>{group.label}</h3>
                      {group.items.map(renderNeedsMeItem)}
                    </section>
                  ))
                : null}
              {needsYouView && visibleSource.length > visibleItems.length ? (
                <div className="colony-needs-me-show-more">
                  <Button
                    data-testid="needs-me-show-more"
                    onClick={() => setVisibleLimit((current) => current + 12)}
                    type="button"
                    variant="outline"
                  >
                    Show{" "}
                    {Math.min(12, visibleSource.length - visibleItems.length)}{" "}
                    more
                  </Button>
                </div>
              ) : null}
            </div>
          ) : needsMe.isPending ? (
            <p className="colony-today-needs-me-loading" role="status">
              Loading open decisions…
            </p>
          ) : needsMeErrors.length === 0 ? (
            <div className="colony-today-needs-me-empty" role="status">
              <h3>Nothing needs you right now.</h3>
              <p>Your next decision will appear here.</p>
            </div>
          ) : null}
          {needsMeErrors.length > 0 ? (
            <div className="colony-today-query-error" role="alert">
              <p>
                {needItems.length > 0
                  ? "Some decisions may be unavailable or out of date."
                  : "Needs you could not be loaded."}
              </p>
              <ul>
                {needsMeErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              <Button
                onClick={retryNeedsMe}
                size="sm"
                type="button"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          ) : null}
        </section>

        {!needsYouView && (forwardItems.length > 0 || feedQuery.error) ? (
          <section
            aria-label="Moving forward"
            className="colony-today-moving-forward"
          >
            <h2>Moving forward</h2>
            {feedQuery.error ? (
              <p className="colony-today-query-error" role="alert">
                {feedQuery.error instanceof Error
                  ? feedQuery.error.message
                  : "Recent activity could not be loaded."}
              </p>
            ) : null}
            {forwardItems.map((item) => (
              <AttentionRow item={item} key={item.id} onOpen={openItem} />
            ))}
          </section>
        ) : null}

        {!needsYouView ? (
          <section aria-label="Your team" className="colony-canary-today-team">
            <div className="colony-canary-section-heading">
              <h2>Your team</h2>
              <button onClick={() => void goTeam()} type="button">
                See the team <ArrowRight aria-hidden="true" size={14} />
              </button>
            </div>
            {teamQuery.isLoading ? (
              <p role="status">Loading your team…</p>
            ) : null}
            {teamQuery.isError ? (
              <div role="alert">
                <p>Team information could not load.</p>
                <button onClick={() => void teamQuery.refetch()} type="button">
                  Try again
                </button>
              </div>
            ) : null}
            {!teamQuery.isLoading &&
            !teamQuery.isError &&
            employeeMembers.length === 0 ? (
              <p>No employees yet.</p>
            ) : null}
            {employeeMembers.length > 0 ? (
              <div className="colony-canary-team-grid">
                {employeeMembers.slice(0, 6).map((member) => {
                  const profile =
                    needsMeProfiles?.[normalizePubkey(member.pubkey)];
                  const name =
                    profile?.displayName?.trim() ||
                    member.fallbackName?.trim() ||
                    "Employee";
                  return (
                    <TodayEmployeeLine
                      key={member.pubkey}
                      member={member}
                      name={name}
                      onOpen={() => void goTeamMember(member.pubkey)}
                    />
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export { TodayTopBar };
