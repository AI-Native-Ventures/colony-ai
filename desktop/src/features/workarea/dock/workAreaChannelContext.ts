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
