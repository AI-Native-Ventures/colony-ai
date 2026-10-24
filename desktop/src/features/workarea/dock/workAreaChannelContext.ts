import * as React from "react";

/** The channel facts dock tabs need but cannot derive from a channel id. */
export type WorkAreaChannel = {
  channelId: string;
  channelType: string;
  isArchived: boolean;
  currentPubkey?: string;
  /** Canonical active thread root for per-task browser approvals. */
  threadRootId?: string | null;
};

export const WorkAreaChannelContext =
  React.createContext<WorkAreaChannel | null>(null);

export function useWorkAreaChannel(): WorkAreaChannel | null {
  return React.useContext(WorkAreaChannelContext);
}

/**
 * The channel whose conversation is on screen beside the dock. Provided by the
 * layout around the conversation, so a message's file card can tell whether its
 * file is the one open in that channel's dock.
 */
export const WorkAreaConversationContext = React.createContext<string | null>(
  null,
);

export function useWorkAreaConversationChannelId(): string | null {
  return React.useContext(WorkAreaConversationContext);
}
