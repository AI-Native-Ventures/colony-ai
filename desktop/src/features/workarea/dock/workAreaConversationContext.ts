import * as React from "react";

import type { TimelineMessage } from "@/features/messages/types";

/** The channel's current message window, shared with its dock without another fetch. */
export type WorkAreaConversation = {
  messages: readonly TimelineMessage[];
  loading: boolean;
  failed: boolean;
  hasOlderMessages: boolean;
  onRetry: () => void;
  onDiscuss: (rootId: string) => void;
};

export const WorkAreaConversationContext =
  React.createContext<WorkAreaConversation | null>(null);

export function useWorkAreaConversation(): WorkAreaConversation | null {
  return React.useContext(WorkAreaConversationContext);
}
