import { Bot, Bell, CircleAlert, House, Search } from "lucide-react";
import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useHomeFeedQuery } from "@/features/home/hooks";
import { useNeedsMeQuery } from "@/features/home/needsMeHooks";
import { useApprovalMutation } from "@/features/workflows/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getThreadReference } from "@/features/messages/lib/threading";
import type { AskHeadRecord } from "@/features/company-asks/askRecords";
import type { PendingWorkflowApproval } from "@/features/home/needsMe";
import { useChannelsQuery } from "@/features/channels/hooks";
import type { FeedItem } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { buildNeedsMeItems } from "@/features/home/needsMeOrdering";

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

function AskNeedsMeRow({
  record,
  currentPubkey,
  profiles,
  channelName,
  onOpen,
}: {
  record: AskHeadRecord;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  channelName: string;
  onOpen: (record: AskHeadRecord) => void;
}) {
  const ask = record.head.ask;
  const asker = resolveUserLabel({
    pubkey: record.head.askerPubkey,
    currentPubkey,
    profiles,
  });
  const recipient = currentPubkey
    ? resolveUserLabel({
        pubkey: currentPubkey,
        currentPubkey,
        profiles,
        preferResolvedSelfLabel: Boolean(
          profiles?.[normalizePubkey(currentPubkey)],
        ),
      })
    : "You";
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
      <span className="colony-needs-me-copy">
        <strong>{ask.title}</strong>
        <small>
          {asker} → {recipient} · #{channelName} · {deadlineLabel(ask.decideBy)}
        </small>
      </span>
      <span className="colony-needs-me-type">{ask.type}</span>
      {overdue ? (
        <span className="colony-needs-me-overdue">Overdue</span>
      ) : null}
      <span aria-hidden="true" className="colony-needs-me-chevron">
        ›
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

export function TodayScreen({
  showUpdatesAction = false,
}: {
  showUpdatesAction?: boolean;
}) {
  const feedQuery = useHomeFeedQuery();
  const needsMe = useNeedsMeQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const needsMeProfilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...(needsMe.data?.asks ?? []).map((record) => record.head.askerPubkey),
        ...(identityQuery.data?.pubkey ? [identityQuery.data.pubkey] : []),
      ]),
    ],
    [identityQuery.data?.pubkey, needsMe.data?.asks],
  );
  const needsMeProfilesQuery = useUsersBatchQuery(needsMeProfilePubkeys, {
    enabled: needsMeProfilePubkeys.length > 0,
  });
  const needsMeProfiles = needsMeProfilesQuery.data?.profiles;
  const { goAskDetail, goChannel, goHome, goPulse } = useAppNavigation();
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
      void goAskDetail(record.channelId, record.head.askId);
    },
    [goAskDetail],
  );

  const channelName = React.useCallback(
    (channelId: string) =>
      channelsQuery.data?.find((channel) => channel.id === channelId)?.name ??
      "conversation",
    [channelsQuery.data],
  );

  const retryNeedsMe = React.useCallback(() => {
    void needsMe.refetch();
  }, [needsMe.refetch]);

  const refreshNeedsMe = React.useCallback(() => {
    void needsMe.refetch();
  }, [needsMe.refetch]);

  return (
    <div className="colony-today-screen">
      <TodayTopBar onOpenInbox={() => void goHome()} />
      <div className="colony-today-scroll">
        <div className="colony-today-heading">
          <h1>Today</h1>
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

        <section aria-label="Needs me" className="colony-today-needs-me">
          <div className="colony-today-needs-me-heading">
            <p>
              Needs me ·{" "}
              {needsMeErrors.length > 0
                ? "Unavailable"
                : `${needItems.length} open decisions`}
            </p>
          </div>
          {needItems.length > 0 ? (
            <div className="colony-today-needs-me-list">
              {needItems.map((item) =>
                item.kind === "ask" ? (
                  <AskNeedsMeRow
                    channelName={channelName(item.record.channelId)}
                    currentPubkey={identityQuery.data?.pubkey}
                    profiles={needsMeProfiles}
                    key={`ask-${item.record.channelId}-${item.record.head.askId}`}
                    onOpen={openAsk}
                    record={item.record}
                  />
                ) : (
                  <WorkflowApprovalRow
                    channelName={channelName(item.record.channelId)}
                    key={`approval-${item.record.approval.approvalRef}`}
                    onChanged={refreshNeedsMe}
                    record={item.record}
                  />
                ),
              )}
            </div>
          ) : needsMe.isPending ? (
            <p className="colony-today-needs-me-loading" role="status">
              Loading open decisions…
            </p>
          ) : needsMeErrors.length === 0 ? (
            <div className="colony-today-needs-me-empty" role="status">
              <h3>You’re clear for now.</h3>
              <p>No open decisions need your attention.</p>
            </div>
          ) : null}
          {needsMeErrors.length > 0 ? (
            <div className="colony-today-query-error" role="alert">
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

        {forwardItems.length > 0 || feedQuery.error ? (
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
      </div>
    </div>
  );
}

export { TodayTopBar };
