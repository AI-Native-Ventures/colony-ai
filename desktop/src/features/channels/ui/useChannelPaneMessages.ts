import * as React from "react";
import { isWelcomeSetupSystemMessage } from "@/features/channels/ui/ChannelPane.helpers";
import type { ChannelPaneProps } from "@/features/channels/ui/ChannelPane.types";
import { buildMainTimelineEntries } from "@/features/messages/lib/threadPanel";
import { getRecentMentionPubkeys } from "@/features/messages/lib/recentMentionPubkeys";
import { isWelcomeExperienceChannel } from "@/features/onboarding/welcome";

type ChannelPaneMessagesOptions = Pick<
  ChannelPaneProps,
  "activeChannel" | "messages" | "profiles" | "threadSummaries"
>;

export function useChannelPaneMessages({
  activeChannel,
  messages,
  profiles,
  threadSummaries,
}: ChannelPaneMessagesOptions) {
  const visibleMessages = React.useMemo(
    () =>
      isWelcomeExperienceChannel(activeChannel)
        ? messages.filter((message) => !isWelcomeSetupSystemMessage(message))
        : messages,
    [activeChannel, messages],
  );

  const mainTimelineEntries = React.useMemo(
    () =>
      buildMainTimelineEntries(
        visibleMessages,
        new Set(),
        threadSummaries,
        profiles,
      ),
    [profiles, threadSummaries, visibleMessages],
  );

  const recentMentionPubkeys = React.useMemo(
    () => getRecentMentionPubkeys(messages, activeChannel?.channelType),
    [activeChannel?.channelType, messages],
  );

  return {
    mainTimelineEntries,
    recentMentions: recentMentionPubkeys,
    visibleMessages,
  };
}
