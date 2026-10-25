import type { TimelineMessage } from "@/features/messages/types";
import type { TypingIndicatorEntry } from "@/features/messages/useChannelTyping";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";

export function shouldUseFocusIdleDrawer({
  channelManagementOpen,
  hasIdleAuxiliaryPanel,
  hasIdlePanelCloseHandler,
  hasProfilePanel,
  hasThreadSurface,
  overrideThread = false,
  useSplitAuxiliaryPane,
}: {
  channelManagementOpen: boolean;
  hasIdleAuxiliaryPanel: boolean;
  hasIdlePanelCloseHandler: boolean;
  hasProfilePanel: boolean;
  hasThreadSurface: boolean;
  overrideThread?: boolean;
  useSplitAuxiliaryPane: boolean;
}): boolean {
  return (
    (useSplitAuxiliaryPane || overrideThread) &&
    !channelManagementOpen &&
    !hasProfilePanel &&
    (!hasThreadSurface || overrideThread) &&
    hasIdleAuxiliaryPanel &&
    hasIdlePanelCloseHandler
  );
}

/** Whether a caller-owned auxiliary sheet should render ahead of a thread. */
export function shouldPrioritizeIdleAuxiliary(
  overrideThread: boolean,
  hasIdleAuxiliary: boolean,
) {
  return overrideThread && hasIdleAuxiliary;
}

/**
 * The message whose thread is open in the side panel, so its row in the
 * timeline can carry a soft wash of the person's accent. Null whenever some
 * other surface owns the panel (channel details, a caller-owned sheet over the
 * thread) or no thread is open.
 */
export function selectActiveThreadRootId({
  channelManagementOpen,
  hasThreadSurface,
  idleAuxiliaryCoversThread,
  openThreadHeadId,
  threadHeadId,
}: {
  channelManagementOpen: boolean;
  hasThreadSurface: boolean;
  idleAuxiliaryCoversThread: boolean;
  openThreadHeadId: string | null | undefined;
  threadHeadId: string | null | undefined;
}): string | null {
  if (!hasThreadSurface || channelManagementOpen || idleAuxiliaryCoversThread) {
    return null;
  }
  return threadHeadId ?? openThreadHeadId ?? null;
}

export function isWelcomeSetupSystemMessage(message: TimelineMessage) {
  if (message.kind !== KIND_SYSTEM_MESSAGE) {
    return false;
  }

  try {
    const payload = JSON.parse(message.body) as { type?: string };
    return (
      payload.type === "channel_created" || payload.type === "member_joined"
    );
  } catch {
    return false;
  }
}

export function mentionsKnownAgent(
  mentionPubkeys: string[],
  knownAgentPubkeys: ReadonlySet<string>,
) {
  return mentionPubkeys.some((pubkey) =>
    knownAgentPubkeys.has(pubkey.toLowerCase()),
  );
}

export function selectThreadComposerBotTypingPubkeys(
  entries: TypingIndicatorEntry[],
  threadHeadId: string | null,
) {
  if (!threadHeadId) return [];
  return entries
    .filter((entry) => entry.threadHeadId === threadHeadId)
    .map((entry) => entry.pubkey)
    .filter(
      (pubkey, index, all) =>
        all.findIndex(
          (candidate) => candidate.toLowerCase() === pubkey.toLowerCase(),
        ) === index,
    );
}
