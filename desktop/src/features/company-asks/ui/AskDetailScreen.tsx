import * as React from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { mapSpecializedAskCard } from "@/features/company-asks/askCardMapping";
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
import { Button } from "@/shared/ui/button";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from "@/shared/ui/colonyIcons";
import { BellGlyph, DecisionAvatar, SearchGlyph } from "./AskDecisionParts";
import { formatClockTime } from "./askCardFormatting";
import "./askDecisions.css";

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
    <section className="colony-decision-state" data-testid={testId}>
      <p role={onRetry ? "alert" : "status"}>{message}</p>
      {onRetry ? (
        <Button onClick={onRetry} type="button" variant="outline">
          Try again
        </Button>
      ) : null}
    </section>
  );
}

const TOP_CHROME_CONTENT_ID = "app-top-chrome-content";

/**
 * The page's top bar: the history buttons and the breadcrumb, with Search and
 * the Inbox bell at the end (`AskDetail.dc.html`). When the shell already draws
 * its own top bar, the breadcrumb and the two buttons move into it instead.
 */
function AskDetailTopBar({
  pageTitle,
  onSearch,
  onInbox,
}: {
  pageTitle: string;
  onSearch: () => void;
  onInbox: () => void;
}) {
  const { navigationHistory } = useAppShell();
  const [slot, setSlot] = React.useState<HTMLElement | null>(() =>
    document.getElementById(TOP_CHROME_CONTENT_ID),
  );
  React.useLayoutEffect(() => {
    setSlot(document.getElementById(TOP_CHROME_CONTENT_ID));
  }, []);
  const trail = (
    <>
      <nav aria-label="Breadcrumb" className="colony-decision-breadcrumb">
        <span>Company</span>
        <span aria-hidden="true">/</span>
        <span
          data-current="true"
          data-testid="ask-detail-breadcrumb"
          title={pageTitle}
        >
          {pageTitle}
        </span>
      </nav>
      <span className="colony-decision-topbar-spacer" />
      <button
        aria-label="Search workspace"
        className="colony-decision-topbar-action"
        onClick={onSearch}
        type="button"
      >
        <SearchGlyph />
      </button>
      <button
        aria-label="Open Inbox"
        className="colony-decision-topbar-action"
        onClick={onInbox}
        type="button"
      >
        <BellGlyph />
      </button>
    </>
  );
  if (slot) return createPortal(trail, slot);
  return (
    <header className="colony-topbar" data-testid="ask-detail-topbar">
      <button
        aria-label="Go back"
        className="colony-topbar-button"
        data-testid="global-back"
        disabled={!navigationHistory.canGoBack}
        onClick={navigationHistory.goBack}
        type="button"
      >
        <ChevronLeftIcon size={17} />
      </button>
      <button
        aria-label="Go forward"
        className="colony-topbar-button"
        data-testid="global-forward"
        disabled={!navigationHistory.canGoForward}
        onClick={navigationHistory.goForward}
        type="button"
      >
        <ChevronRightIcon size={17} />
      </button>
      {trail}
    </header>
  );
}

function BackLink() {
  return (
    <Link className="colony-decision-back" to="/today">
      <ChevronLeftIcon size={15} strokeWidth={2.6} />
      Back
    </Link>
  );
}

function AskDetailMemberScreen({
  askId,
  channel,
  channelId,
  currentPubkey,
  companyToolConsentInbox,
}: {
  askId: string;
  channel: Channel | null;
  channelId: string;
  currentPubkey: string;
  companyToolConsentInbox: boolean;
}) {
  const { goHome } = useAppNavigation();
  const askState = useAskHeadQuery(
    channelId,
    askId,
    true,
    companyToolConsentInbox,
  );
  const record = askState.query.data;
  const rootId = record?.head.ask.threadRootEventId ?? null;
  const rootQuery = useQuery({
    enabled: rootId !== null && channel?.isMember === true,
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
    record?.head.ask.spendAllowanceProposal?.employeePubkey,
  ].filter((pubkey): pubkey is string => Boolean(pubkey));
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: profilePubkeys.length > 0,
  });
  const formattedRoot =
    rootQuery.data && channel
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
  const specializedAskTitle =
    record && mapSpecializedAskCard(record.head.ask)
      ? record.head.ask.title
      : null;
  const pageTitle = formattedRoot
    ? `Decision in ${threadTitle}`
    : (specializedAskTitle ?? "Decision");
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
  } else if (channel?.isMember && rootQuery.isPending) {
    detailState = (
      <AskDetailState
        message="Loading the discussion message…"
        testId="ask-root-loading"
      />
    );
  } else if (channel?.isMember && rootQuery.isError) {
    detailState = (
      <AskDetailState
        message="The discussion message could not be loaded."
        onRetry={() => void rootQuery.refetch()}
        testId="ask-root-error"
      />
    );
  } else if (channel?.isMember && !rootQuery.data) {
    detailState = (
      <AskDetailState
        message="The discussion message for this ask was not found."
        onRetry={() => void rootQuery.refetch()}
        testId="ask-root-not-found"
      />
    );
  }
  if (specializedAskTitle) detailState = null;

  const searchWorkspace = () => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  };

  const rootAnchor =
    !specializedAskTitle && formattedRoot ? (
      <article
        aria-label="Message anchoring this ask"
        className="colony-decision-root"
        data-testid="ask-thread-root"
      >
        <DecisionAvatar
          isAgent={formattedRoot.isAgent}
          name={formattedRoot.author}
          profiles={profilesQuery.data?.profiles}
          pubkey={formattedRoot.pubkey}
          size={42}
        />
        <div className="colony-decision-message-body">
          <div className="colony-decision-message-head">
            <strong>{formattedRoot.author}</strong>
            <time
              dateTime={new Date(formattedRoot.createdAt * 1_000).toISOString()}
            >
              {formattedRoot.isAgent ? "AI employee" : "Person"} · #
              {channel?.name ?? "conversation"} ·{" "}
              {formatClockTime(
                new Date(formattedRoot.createdAt * 1_000).toISOString(),
              ) ?? formattedRoot.time}
            </time>
          </div>
          <Markdown
            className="colony-decision-message-text"
            content={rootDisplayBody}
            interactive={false}
            messageId={formattedRoot.id}
          />
        </div>
      </article>
    ) : null;

  return (
    <div className="colony-decision-screen" data-testid="ask-detail-screen">
      <AskDetailTopBar
        onInbox={() => void goHome()}
        onSearch={searchWorkspace}
        pageTitle={pageTitle}
      />
      <main className="colony-decision-scroll">
        <div
          className="colony-decision-content"
          data-funding={specializedAskTitle ? "true" : undefined}
        >
          <BackLink />
          {specializedAskTitle ? (
            <div className="colony-decision-title-row">
              <h1 data-testid="ask-thread-title">{specializedAskTitle}</h1>
              <Link
                className="colony-decision-raise"
                search={{
                  channelId,
                  threadRootEventId: record?.head.ask.threadRootEventId ?? null,
                }}
                to="/asks/new"
              >
                <PlusIcon size={16} />
                Raise an ask
              </Link>
            </div>
          ) : null}
          {!specializedAskTitle && formattedRoot ? (
            <h1
              className="colony-decision-title"
              data-testid="ask-thread-title"
            >
              Decision in {threadTitle}
            </h1>
          ) : null}
          {detailState}
          {record ? (
            <AskCard
              askId={askId}
              channelId={channelId}
              currentPubkey={currentPubkey}
              leading={rootAnchor}
              profiles={profilesQuery.data?.profiles}
              queryState={askState}
              showDetailLink={false}
              showDiscussionLink={channel?.isMember === true}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}

export function AskDetailScreen({
  askId,
  channelId,
  companyToolConsentInbox = false,
}: {
  askId: string;
  channelId: string;
  companyToolConsentInbox?: boolean;
}) {
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const { goHome } = useAppNavigation();
  const channel = channelsQuery.data?.find((item) => item.id === channelId);
  const currentPubkey = identityQuery.data?.pubkey;
  const canResolveCompanyAsk =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  const canOpenCompanyToolConsent =
    companyToolConsentInbox && canResolveCompanyAsk;
  const searchWorkspace = () => {
    document
      .querySelector<HTMLButtonElement>('[data-testid="open-search"]')
      ?.click();
  };

  let accessState: React.ReactNode = null;
  if (
    channelsQuery.isPending ||
    identityQuery.isPending ||
    (companyToolConsentInbox && membershipQuery.isPending)
  ) {
    accessState = (
      <AskDetailState
        message="Checking conversation access…"
        testId="ask-detail-access-loading"
      />
    );
  } else if (
    channelsQuery.isError ||
    identityQuery.isError ||
    (companyToolConsentInbox && membershipQuery.isError)
  ) {
    accessState = (
      <AskDetailState
        message="Conversation access could not be checked."
        onRetry={() => {
          void channelsQuery.refetch();
          void identityQuery.refetch();
          if (companyToolConsentInbox) void membershipQuery.refetch();
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
  } else if (!channel?.isMember && !canOpenCompanyToolConsent) {
    accessState = (
      <AskDetailState
        message="You are not a member of this conversation."
        testId="ask-detail-no-access"
      />
    );
  }

  if (
    !accessState &&
    (channel?.isMember || canOpenCompanyToolConsent) &&
    currentPubkey
  ) {
    return (
      <AskDetailMemberScreen
        askId={askId}
        channel={channel ?? null}
        channelId={channelId}
        currentPubkey={currentPubkey}
        companyToolConsentInbox={
          canOpenCompanyToolConsent && !channel?.isMember
        }
      />
    );
  }

  return (
    <div className="colony-decision-screen" data-testid="ask-detail-screen">
      <AskDetailTopBar
        onInbox={() => void goHome()}
        onSearch={searchWorkspace}
        pageTitle="Decision"
      />
      <main className="colony-decision-scroll">
        <div className="colony-decision-content">
          <BackLink />
          {accessState}
          <nav
            aria-label="Ask navigation"
            className="colony-decision-actions"
            data-passive="true"
          >
            <Link className="colony-decision-link" to="/today">
              Needs me
            </Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
