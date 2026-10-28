import * as React from "react";

import {
  hasSameMessageAuthor,
  isWithinGroupingWindow,
} from "@/features/messages/lib/messageGrouping";
import { THREAD_PANEL_MESSAGE_GUTTER_CLASS } from "@/features/messages/lib/messageThreadPanelLayout";
import { getThreadReplySpacingPx } from "@/features/messages/lib/messageGroupSpacing";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { cn } from "@/shared/lib/cn";
import { MessageThreadRow } from "./MessageThreadRow";

type MessageThreadTranscriptProps = {
  channelId: string;
  className?: string;
  currentPubkey?: string;
  messages: TimelineMessage[];
  onToggleReaction?: (
    message: TimelineMessage,
    emoji: string,
    remove: boolean,
  ) => Promise<void>;
  profiles?: UserProfileLookup;
  renderAfterMessage?: (message: TimelineMessage) => React.ReactNode;
  testId?: string;
};

function AfterMessage({ content }: { content: React.ReactNode }) {
  return content ? <div className="relative z-20">{content}</div> : null;
}

/**
 * Channel-thread message presentation without the panel header or composer.
 * Callers keep ownership of transport and compose semantics while sharing the
 * same row layout, grouping, gutters, and actions as `MessageThreadPanel`.
 */
export function MessageThreadTranscript({
  channelId,
  className,
  currentPubkey,
  messages,
  onToggleReaction,
  profiles,
  renderAfterMessage,
  testId = "message-thread-transcript",
}: MessageThreadTranscriptProps) {
  const renderItems = React.useMemo(() => {
    let previousMessage: TimelineMessage | null = null;
    return messages.map((message, index) => {
      const isContinuation =
        hasSameMessageAuthor(previousMessage, message) &&
        isWithinGroupingWindow(previousMessage?.createdAt, message.createdAt);
      previousMessage = message;
      return { index, isContinuation, message };
    });
  }, [messages]);

  return (
    <div
      className={cn(
        THREAD_PANEL_MESSAGE_GUTTER_CLASS,
        "flex flex-col pb-3 pt-0",
        className,
      )}
      data-testid={testId}
    >
      {renderItems.map(({ isContinuation, message }) => (
        <div
          className="flex flex-col gap-0"
          key={message.renderKey ?? message.id}
          style={{
            marginTop: getThreadReplySpacingPx(isContinuation),
          }}
        >
          <MessageThreadRow
            channelId={channelId}
            currentPubkey={currentPubkey}
            isContinuation={isContinuation}
            message={message}
            onToggleReaction={onToggleReaction}
            profiles={profiles}
            showDepthGuides={false}
          />
          {/* Above the row's hover padding, so controls under it stay clickable. */}
          <AfterMessage content={renderAfterMessage?.(message)} />
        </div>
      ))}
    </div>
  );
}
