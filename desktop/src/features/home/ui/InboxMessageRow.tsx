import * as React from "react";

import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import type { InboxContextMessage } from "@/features/home/lib/inbox";
import { toTimelineMessage } from "@/features/home/lib/inboxViewHelpers";
import { formatTimeWithoutDayPeriod } from "@/features/messages/lib/dateFormatters";
import { formatItemTimestamp } from "@/shared/lib/datetime";
import { WorkAreaFileCard } from "@/features/home/ui/WorkAreaFileCard";
import type { TimelineMessage } from "@/features/messages/types";
import { getConfigNudgeAuthorPubkey } from "@/features/messages/ui/configNudgeAuthPubkey";
import { MessageActionBar } from "@/features/messages/ui/MessageActionBar";
import { MessageAgentOwner } from "@/features/messages/ui/MessageAgentOwner";
import { MessageReactions } from "@/features/messages/ui/MessageReactions";
import { useReactionHandler } from "@/features/messages/ui/useReactionHandler";
import { useMessageEmoji } from "@/features/messages/lib/useMessageEmoji";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { VideoReviewContext } from "@/shared/ui/VideoPlayer";
import { VideoReviewCommentMarkdown } from "@/shared/ui/VideoReviewCommentMarkdown";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";
import "./ActivityScreen.css";

export type InboxDisplayMessage = InboxContextMessage & {
  depth: number;
};

const CLOCK_24H = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "09:12" today; "Yesterday at 09:12", "Monday at 09:12" or a date before. */
function formatMessageStamp(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1_000);
  const now = new Date();
  const clock = CLOCK_24H.format(date);
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? clock : `${formatItemTimestamp(unixSeconds)} at ${clock}`;
}

type InboxMessageRowProps = {
  agentPubkeys?: ReadonlySet<string>;
  canReply: boolean;
  /** Channel UUID for "Copy link" — passed straight through to MessageActionBar. */
  channelId?: string | null;
  isContinuation?: boolean;
  isFirst?: boolean;
  isFocusHighlightVisible: boolean;
  /** The author's job title from the Team records, shown beside their name. */
  jobTitle?: string | null;
  message: InboxDisplayMessage;
  onDelete?: (message: InboxDisplayMessage) => void;
  onEdit?: (message: InboxDisplayMessage) => void;
  onSelectReplyTarget: (message: InboxDisplayMessage) => void;
  onToggleReaction?: (
    message: TimelineMessage,
    emoji: string,
    remove: boolean,
  ) => Promise<void>;
  /** Resolves the mention identities carried by "Copy message". */
  profiles?: UserProfileLookup;
  showUnreadBoundary?: boolean;
  videoReviewCommentRootId?: string;
  videoReviewContext?: VideoReviewContext;
};

export function InboxMessageRow({
  agentPubkeys,
  canReply,
  channelId = null,
  isContinuation = false,
  isFirst = false,
  isFocusHighlightVisible,
  jobTitle = null,
  message,
  onDelete,
  onEdit,
  onSelectReplyTarget,
  onToggleReaction,
  profiles,
  showUnreadBoundary = false,
  videoReviewCommentRootId,
  videoReviewContext,
}: InboxMessageRowProps) {
  const timelineMessage = React.useMemo(
    () => toTimelineMessage(message),
    [message],
  );
  const imetaByUrl = React.useMemo(
    () => (message.tags ? parseImetaTags(message.tags) : undefined),
    [message.tags],
  );
  const { customEmoji, emojiOnly } = useMessageEmoji(
    message.content,
    message.tags,
  );
  const [badgeBurstEmoji, setBadgeBurstEmoji] = React.useState<string | null>(
    null,
  );
  const {
    reactions,
    canToggle: canToggleReactions,
    pending: reactionPending,
    errorMessage: reactionErrorMessage,
    select: handleReactionSelect,
  } = useReactionHandler(timelineMessage, onToggleReaction);
  // "Is this pubkey an agent" = the community-scoped baseline every surface
  // shares plus this surface's extras passed via `agentPubkeys` (HomeView
  // folds feed-profile `isAgent` flags in). Mirrors MessageRow's predicate.
  const knownAgentPubkeys = useKnownAgentPubkeys();
  const isKnownAgentPubkey = React.useCallback(
    (pubkey: string) => {
      const normalized = normalizePubkey(pubkey);
      return (
        knownAgentPubkeys.has(normalized) ||
        agentPubkeys?.has(normalized) === true
      );
    },
    [agentPubkeys, knownAgentPubkeys],
  );
  const isAuthorAgent = isKnownAgentPubkey(message.authorPubkey);
  const profileRole = isAuthorAgent ? "bot" : undefined;
  const hoverTimestampLabel = formatTimeWithoutDayPeriod(
    message.timeLabel ?? message.fullTimestampLabel,
  );
  // Derived here rather than plumbed in with the message: the thread pane has no
  // day divider to supply the date, and deriving on render means a row does not
  // keep saying "Today" after midnight. `fullTimestampLabel` stays the absolute
  // value behind the hover title.
  const timestampLabel = formatMessageStamp(message.createdAt);
  const timestampNode = (
    <p
      className="ca-msg-time"
      data-testid="inbox-message-timestamp"
      title={message.fullTimestampLabel}
    >
      {timestampLabel}
    </p>
  );

  return (
    <div className="ca-msg-wrap">
      {showUnreadBoundary ? (
        <section
          aria-label="New messages"
          className="ca-new-divider"
          data-testid="message-unread-divider"
        >
          <span aria-hidden="true" />
          <strong>New</strong>
        </section>
      ) : null}
      {message.isSelected ? (
        <div
          aria-hidden="true"
          className="ca-msg-focus"
          data-visible={isFocusHighlightVisible ? "true" : undefined}
        />
      ) : null}
      <article
        className="ca-msg group/message"
        data-continuation={isContinuation ? "true" : undefined}
        data-message-id={message.id}
        data-testid={
          message.isSelected
            ? "home-inbox-selected-message"
            : "home-inbox-context-message"
        }
      >
        {canReply || canToggleReactions || onDelete || onEdit ? (
          <div
            className="ca-msg-actions"
            data-first={isFirst ? "true" : undefined}
          >
            <MessageActionBar
              channelId={channelId}
              message={timelineMessage}
              onDelete={onDelete ? () => onDelete(message) : undefined}
              onEdit={onEdit ? () => onEdit(message) : undefined}
              onReactionSelect={
                canToggleReactions ? handleReactionSelect : undefined
              }
              onReactionBadgeBurstRequest={
                reactionPending ? undefined : setBadgeBurstEmoji
              }
              onReply={
                canReply ? () => onSelectReplyTarget(message) : undefined
              }
              profiles={profiles}
              reactionErrorMessage={reactionErrorMessage}
              reactions={reactions}
            />
          </div>
        ) : null}

        {isContinuation ? (
          <div
            aria-hidden="true"
            className="ca-msg-gutter"
            title={message.fullTimestampLabel}
          >
            <p>{hoverTimestampLabel}</p>
          </div>
        ) : (
          <div className="ca-msg-lead">
            <UserProfilePopover
              botIdenticonValue={message.authorLabel}
              pubkey={message.authorPubkey}
              role={profileRole}
              triggerClassName={cn(
                "shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                isAuthorAgent ? "rounded-[30%]" : "rounded-full",
              )}
              triggerElement="span"
            >
              <span className="inline-flex shrink-0">
                <ProfileAvatar
                  avatarUrl={message.avatarUrl}
                  className="ca-msg-avatar"
                  label={message.authorLabel}
                  pubkey={message.authorPubkey}
                  shape={isAuthorAgent ? "squircle" : "circle"}
                />
              </span>
            </UserProfilePopover>
          </div>
        )}

        <div className="ca-msg-main">
          {isContinuation ? null : (
            <div className="ca-msg-head" data-testid="message-header">
              <UserProfilePopover
                botIdenticonValue={message.authorLabel}
                pubkey={message.authorPubkey}
                role={profileRole}
                triggerElement="span"
              >
                <span className="ca-msg-name" data-testid="message-author">
                  {message.authorLabel}
                </span>
              </UserProfilePopover>
              {jobTitle || message.isAgent ? (
                <span className="ca-msg-sub">
                  {jobTitle}
                  {jobTitle && message.isAgent ? " · " : null}
                  {message.isAgent ? (
                    <MessageAgentOwner
                      ownerLabel={message.ownerLabel}
                      ownerPubkey={message.ownerPubkey}
                    />
                  ) : null}
                </span>
              ) : null}
              {timestampNode}
            </div>
          )}

          <div className="ca-msg-body" data-testid="message-body">
            <VideoReviewCommentMarkdown
              className={cn(
                "max-w-full text-left text-message text-foreground",
                emojiOnly &&
                  "text-4xl leading-tight [&_p]:leading-tight [&_img[data-custom-emoji]]:h-[1.45em] [&_img[data-custom-emoji]]:align-middle [&_button:has(img[data-custom-emoji])]:align-middle",
              )}
              // Only pass the author pubkey for agent-authored messages so
              // config-nudge cards can authenticate the sender. Uses the
              // raw event signer (signerPubkey), not a relay-delegated display
              // author, because the agent itself must have signed the card.
              configNudgeAuthorPubkey={getConfigNudgeAuthorPubkey(
                timelineMessage,
                isKnownAgentPubkey,
              )}
              content={message.content}
              messageId={message.id}
              linkPreviewsSuppressed={hasLinkPreviewSuppression(
                timelineMessage.tags,
              )}
              customEmoji={customEmoji}
              imetaByUrl={imetaByUrl}
              mentionNames={message.mentionNames}
              mentionPubkeysByName={message.mentionPubkeysByName}
              videoReviewCommentRootId={videoReviewCommentRootId}
              videoReviewContext={videoReviewContext}
            />
            <MessageReactions
              canToggle={canToggleReactions}
              messageId={message.id}
              onSelect={(emoji) => {
                void handleReactionSelect(emoji);
              }}
              burstEmojiOnRender={badgeBurstEmoji}
              onBurstEmojiRendered={(emoji) => {
                setBadgeBurstEmoji((current) =>
                  current === emoji ? null : current,
                );
              }}
              pending={reactionPending}
              reactions={reactions}
            />
            {reactionErrorMessage ? (
              <p className="mt-1.5 text-xs text-destructive">
                {reactionErrorMessage}
              </p>
            ) : null}
            {isAuthorAgent && !isContinuation ? (
              <WorkAreaFileCard
                authorPubkey={message.signerPubkey ?? message.authorPubkey}
                content={message.content}
                isKnownAgentPubkey={isKnownAgentPubkey}
              />
            ) : null}
          </div>
        </div>
      </article>
    </div>
  );
}
