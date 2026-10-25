import * as React from "react";
import { mergeMessages } from "@/features/messages/hooks";
import {
  channelWindowThreadSummaries,
  type ChannelWindowStore,
} from "@/features/messages/lib/channelWindowStore";
import type { Channel, RelayEvent } from "@/shared/api/types";

type ChannelResolvedMessagesOptions = {
  activeChannel: Channel | null;
  messages: RelayEvent[];
  targetMessageEvents: RelayEvent[];
  windowStore?: ChannelWindowStore;
};

/**
 * Channel history with any route-target events spliced in, plus the thread
 * summaries of the loaded window.
 */
export function useChannelResolvedMessages({
  activeChannel,
  messages,
  targetMessageEvents,
  windowStore,
}: ChannelResolvedMessagesOptions) {
  const resolvedMessages = React.useMemo(() => {
    if (!activeChannel || targetMessageEvents.length === 0) return messages;
    return targetMessageEvents.reduce(mergeMessages, messages);
  }, [activeChannel, messages, targetMessageEvents]);

  const threadSummaries = React.useMemo(
    () => (windowStore ? channelWindowThreadSummaries(windowStore) : new Map()),
    [windowStore],
  );

  return { resolvedMessages, threadSummaries };
}
