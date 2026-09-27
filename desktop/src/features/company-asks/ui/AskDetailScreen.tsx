import type * as React from "react";
import { Bell, Building2, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useAskHeadQuery } from "@/features/company-asks/hooks";
import { AskCard } from "@/features/company-asks/ui/AskCard";
import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { getThreadReference } from "@/features/messages/lib/threading";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import type { Channel, RelayEvent } from "@/shared/api/types";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";
import { Markdown } from "@/shared/ui/markdown";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { WorkspaceTopBar } from "@/shared/ui/workspace-topbar";
import { Button } from "@/shared/ui/button";

function isChannelRootMessage(
  event: RelayEvent,
  channelId: string,
  rootId: string,
) {
  return (
    event.id === rootId &&
    (event.kind === KIND_STREAM_MESSAGE ||
      event.kind === KIND_STREAM_MESSAGE_V2) &&
    event.tags.filter((tag) => tag[0] === "h").length === 1 &&
    event.tags.some((tag) => tag[0] === "h" && tag[1] === channelId) &&
    getThreadReference(event.tags).parentId === null
  );
}

function rootThreadTitle(body: string) {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const workspaceTitle = lines[0]?.match(/^#{1,3}\s+(.+)$/)?.[1];
  return workspaceTitle ?? lines[0] ?? "Discussion";
}

function rootThreadDisplayBody(body: string) {
  const lines = body.split(/\r?\n/);
  const titleLine = lines.findIndex((line) => line.trim().length > 0);
  if (titleLine < 0 || !/^#{1,3}\s+/.test(lines[titleLine].trim())) {
    return body;
  }
  return lines
    .slice(titleLine + 1)
    .join("\n")
    .trim();
}

function AskDetailState({
  message,
  testId,
  onRetry,
}: {
  message: string;
  testId: string;
  onRetry?: () => void;
}) {
  return (
    <section className="colony-ask-route-state" data-testid={testId}>
      <p role={onRetry ? "alert" : "status"}>{message}</p>
      {onRetry ? (
        <Button onClick={onRetry} type="button" variant="outline">
          Try again
        </Button>
      ) : null}
    </section>
  );
}

function AskDetailMemberScreen({
  askId,
  channel,
  channelId,
  currentPubkey,
}: {
  askId: string;
  channel: Channel;
  channelId: string;
  currentPubkey: string;
}) {
  const { goHome } = useAppNavigation();
  const askState = useAskHeadQuery(channelId, askId);
  const record = askState.query.data;
  const rootId = record?.head.ask.threadRootEventId ?? null;
  const rootQuery = useQuery({
    enabled: rootId !== null,
    queryKey: ["company-ask-thread-root", channelId, askId, rootId],
    queryFn: async () => {
      if (!rootId) throw new Error("The discussion message id is missing.");
      const events = await relayClient.fetchEvents({
        ids: [rootId],
        kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2],
        "#h": [channelId],
        limit: 1,
      });
      return (
        events.find((event) =>
          isChannelRootMessage(event, channelId, rootId),
        ) ?? null
      );
    },
  });
  const profilePubkeys = [
    rootQuery.data?.pubkey,
    record?.head.askerPubkey,
    record?.head.ask.addresseePubkey,
    record?.head.resolution?.resolvedByPubkey,
    record?.head.cancellation?.cancelledByPubkey,
  ].filter((pubkey): pubkey is string => Boolean(pubkey));
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: profilePubkeys.length > 0,
  });
  const formattedRoot = rootQuery.data
    ? formatTimelineMessages(
        [rootQuery.data],
        channel,
        currentPubkey,
        null,
        profilesQuery.data?.profiles,
        undefined,
        undefined,
        undefined,
        askState.relaySelfQuery.data,
      )[0]
    : undefined;
  const threadTitle = formattedRoot
    ? rootThreadTitle(formattedRoot.body)
    : "Decision";
  const rootDisplayBody = formattedRoot
    ? rootThreadDisplayBody(formattedRoot.body)
    : "";

  let detailState: React.ReactNode = null;
  if (askState.relaySelfQuery.isPending) {
    detailState = (
      <AskDetailState
        message="Checking the relay identity…"
        testId="ask-detail-loading"
      />
    );
  } else if (
    askState.relaySelfQuery.isError ||
    (askState.relaySelfQuery.isSuccess && !askState.relaySelfQuery.data)
  ) {
    detailState = (
      <AskDetailState
        message="The relay identity is unavailable, so this ask cannot be verified."
        onRetry={() => void askState.relaySelfQuery.refetch()}
        testId="ask-detail-unavailable"
      />
    );
  } else if (askState.query.isPending) {
    detailState = (
      <AskDetailState
        message="Loading the latest ask…"
        testId="ask-detail-loading"
      />
    );
  } else if (askState.query.isError) {
    detailState = (
      <AskDetailState
        message={
          askState.query.error instanceof Error
            ? askState.query.error.message
            : "The ask could not be loaded."
        }
        onRetry={() => void askState.query.refetch()}
        testId="ask-detail-error"
      />
    );
  } else if (!record) {
    detailState = (
      <AskDetailState
        message="This ask could not be found in this conversation."
        testId="ask-detail-not-found"
      />
    );
  } else if (rootQuery.isPending) {
    detailState = (
      <AskDetailState
        message="Loading the discussion message…"
        testId="ask-root-loading"
      />
    );
  } else if (rootQuery.isError) {
    detailState = (
      <AskDetailState
        message="The discussion message could not be loaded."
        onRetry={() => void rootQuery.refetch()}
        testId="ask-root-error"
      />
    );
  } else if (!rootQuery.data) {
    detailState = (
      <AskDetailState
        message="The discussion message for this ask was not found."
        onRetry={() => void rootQuery.refetch()}
        testId="ask-root-not-found"
      />
    );
  }

  const searchWorkspace = () => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  };

  return (
    <div className="colony-ask-detail-screen" data-testid="ask-detail-screen">
      <WorkspaceTopBar
        actions={
          <>
            <button
              aria-label="Search workspace"
              onClick={searchWorkspace}
              type="button"
            >
              <Search aria-hidden="true" />
            </button>
            <button
              aria-label="Open Inbox"
              onClick={() => void goHome()}
              type="button"
            >
              <Bell aria-hidden="true" />
            </button>
          </>
        }
      >
        <Building2 aria-hidden="true" />
        <span>Company</span>
        <span
          aria-hidden="true"
          className="colony-workspace-breadcrumb-separator"
        >
          /
        </span>
        <span
          className="colony-ask-detail-breadcrumb-label"
          data-testid="ask-detail-breadcrumb"
        >
          Decision in {threadTitle}
        </span>
      </WorkspaceTopBar>
      <main className="colony-ask-detail-scroll">
        <div className="colony-ask-detail-content">
          <Link className="colony-ask-detail-back" to="/today">
            ‹ Back
          </Link>
          {formattedRoot ? (
            <>
              <h1 data-testid="ask-thread-title">Decision in {threadTitle}</h1>
              <article
                aria-label="Message anchoring this ask"
                className="colony-ask-thread-root"
                data-testid="ask-thread-root"
              >
                <UserAvatar
                  avatarUrl={formattedRoot.avatarUrl ?? null}
                  displayName={formattedRoot.author}
                  size="md"
                />
                <div className="colony-ask-thread-root-content">
                  <header>
                    <strong>{formattedRoot.author}</strong>
                    <time
                      dateTime={new Date(
                        formattedRoot.createdAt * 1_000,
                      ).toISOString()}
                    >
                      {formattedRoot.time}
                    </time>
                  </header>
                  <Markdown
                    className="colony-ask-thread-root-body"
                    content={rootDisplayBody}
                    interactive={false}
                    messageId={formattedRoot.id}
                  />
                </div>
              </article>
            </>
          ) : null}
          {detailState}
          {record ? (
            <AskCard
              askId={askId}
              channelId={channelId}
              currentPubkey={currentPubkey}
              profiles={profilesQuery.data?.profiles}
              queryState={askState}
              showDetailLink={false}
            />
          ) : null}
          <nav
            aria-label="Ask navigation"
            className="colony-ask-detail-actions"
          >
            <Link
              params={{ channelId }}
              search={{
                messageId: rootId ?? undefined,
                threadRootId: rootId ?? undefined,
                thread: rootId ?? undefined,
              }}
              to="/channels/$channelId"
            >
              Back to discussion
            </Link>
            <Link to="/today">Needs me</Link>
          </nav>
        </div>
      </main>
    </div>
  );
}

export function AskDetailScreen({
  askId,
  channelId,
}: {
  askId: string;
  channelId: string;
}) {
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const { goHome } = useAppNavigation();
  const channel = channelsQuery.data?.find((item) => item.id === channelId);
  const currentPubkey = identityQuery.data?.pubkey;
  const searchWorkspace = () => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  };

  let accessState: React.ReactNode = null;
  if (channelsQuery.isPending || identityQuery.isPending) {
    accessState = (
      <AskDetailState
        message="Checking conversation access…"
        testId="ask-detail-access-loading"
      />
    );
  } else if (channelsQuery.isError || identityQuery.isError) {
    accessState = (
      <AskDetailState
        message="Conversation access could not be checked."
        onRetry={() => {
          void channelsQuery.refetch();
          void identityQuery.refetch();
        }}
        testId="ask-detail-access-error"
      />
    );
  } else if (!currentPubkey) {
    accessState = (
      <AskDetailState
        message="Sign in to a member account to view this ask."
        testId="ask-detail-no-access"
      />
    );
  } else if (!channel?.isMember) {
    accessState = (
      <AskDetailState
        message="You are not a member of this conversation."
        testId="ask-detail-no-access"
      />
    );
  }

  if (!accessState && channel?.isMember && currentPubkey) {
    return (
      <AskDetailMemberScreen
        askId={askId}
        channel={channel}
        channelId={channelId}
        currentPubkey={currentPubkey}
      />
    );
  }

  return (
    <div className="colony-ask-detail-screen" data-testid="ask-detail-screen">
      <WorkspaceTopBar
        actions={
          <>
            <button
              aria-label="Search workspace"
              onClick={searchWorkspace}
              type="button"
            >
              <Search aria-hidden="true" />
            </button>
            <button
              aria-label="Open Inbox"
              onClick={() => void goHome()}
              type="button"
            >
              <Bell aria-hidden="true" />
            </button>
          </>
        }
      >
        <Building2 aria-hidden="true" />
        <span>Company</span>
        <span
          aria-hidden="true"
          className="colony-workspace-breadcrumb-separator"
        >
          /
        </span>
        <span className="colony-ask-detail-breadcrumb-label">Decision</span>
      </WorkspaceTopBar>
      <main className="colony-ask-detail-scroll">
        <div className="colony-ask-detail-content">
          <Link className="colony-ask-detail-back" to="/today">
            ‹ Back
          </Link>
          {accessState}
          <nav
            aria-label="Ask navigation"
            className="colony-ask-detail-actions"
          >
            <Link to="/today">Needs me</Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
