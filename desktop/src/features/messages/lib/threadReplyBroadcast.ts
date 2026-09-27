import type { MessageComposerProps } from "@/features/messages/ui/MessageComposer.types";
import { addBroadcastReplyTag } from "./threading.ts";

/** Bind a thread reply sender to the selected channel broadcast state. */
export function createThreadReplySender(
  send: MessageComposerProps["onSend"],
  alsoSendToChannel: boolean,
): MessageComposerProps["onSend"] {
  if (!alsoSendToChannel) return send;

  return (
    content,
    mentionPubkeys,
    mediaTags,
    channelId,
    threadContext,
    forceRest,
  ) =>
    send(
      content,
      mentionPubkeys,
      addBroadcastReplyTag(mediaTags),
      channelId,
      threadContext,
      forceRest,
    );
}
