import * as React from "react";

import {
  useChannelTurnErrors,
  useChannelWorkingAgents,
} from "@/features/agents/agentWorkingSignal";
import {
  type AgentScopes,
  type AgentWorkingIndicatorState,
  type IndicatorTypingEntry,
  NO_AGENT_SCOPES,
  latestPostedAt,
  TURN_ERROR_VISIBLE_MS,
  recordAgentScopes,
  selectChannelWorkingIndicator,
  selectThreadWorkingIndicator,
} from "@/features/channels/lib/agentWorkingIndicator";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";

type PostedMessage = { createdAt: number; pubkey?: string };

type ScopeRecord = { channelId: string | null; scopes: AgentScopes };

/**
 * What the conversation says about agents at work, for the main column and
 * the open thread: "Scout is working…" while a turn runs, a short plain note
 * if it stopped with an error. Built on the unified working signal (the same
 * data as the sidebar timer) plus the bot typing entries, which know the
 * thread an agent is replying in.
 */
export function useAgentWorkingIndicators({
  agentNames,
  botTypingEntries,
  channelId,
  channelMessages,
  currentPubkey,
  openThreadHeadId,
  profiles,
  threadMessages,
}: {
  agentNames: ReadonlyMap<string, string>;
  botTypingEntries: readonly IndicatorTypingEntry[];
  channelId: string | null;
  /** Everything loaded in the channel; a reply from the agent ends its notice. */
  channelMessages: readonly PostedMessage[];
  currentPubkey?: string;
  openThreadHeadId: string | null;
  profiles?: UserProfileLookup;
  /** The open thread's messages. */
  threadMessages: readonly PostedMessage[];
}): {
  channel: AgentWorkingIndicatorState;
  thread: AgentWorkingIndicatorState;
} {
  const working = useChannelWorkingAgents(channelId);
  const errors = useChannelTurnErrors(channelId);

  const [record, setRecord] = React.useState<ScopeRecord>({
    channelId: null,
    scopes: NO_AGENT_SCOPES,
  });
  React.useEffect(() => {
    setRecord((current) => {
      const base =
        current.channelId === channelId ? current.scopes : NO_AGENT_SCOPES;
      const scopes = recordAgentScopes(base, botTypingEntries);
      return scopes === current.scopes && current.channelId === channelId
        ? current
        : { channelId, scopes };
    });
  }, [botTypingEntries, channelId]);
  const lastScopes =
    record.channelId === channelId ? record.scopes : NO_AGENT_SCOPES;

  // An error notice has a lifetime: re-evaluate when each one ends.
  const [expiryTick, bumpExpiry] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const now = Date.now();
    const timers = errors
      .map((error) => error.at + TURN_ERROR_VISIBLE_MS - now)
      .filter((ms) => ms > 0)
      .map((ms) => window.setTimeout(bumpExpiry, ms + 20));
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [errors]);

  const nameOf = React.useCallback(
    (pubkey: string) =>
      resolveUserLabel({
        pubkey,
        currentPubkey,
        fallbackName: agentNames.get(pubkey.toLowerCase()) ?? "An agent",
        profiles,
        preferResolvedSelfLabel: true,
      }),
    [agentNames, currentPubkey, profiles],
  );

  // Who could be mid-reply: agents working in the channel or typing in it.
  const watched = React.useMemo(
    () =>
      new Set([
        ...working.map((agent) => agent.pubkey.toLowerCase()),
        ...botTypingEntries.map((entry) => entry.pubkey.toLowerCase()),
      ]),
    [botTypingEntries, working],
  );
  const channelPosted = React.useMemo(
    () => latestPostedAt(channelMessages, watched),
    [channelMessages, watched],
  );
  const threadPosted = React.useMemo(
    () => latestPostedAt(threadMessages, watched),
    [threadMessages, watched],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: expiryTick re-runs the clock-dependent selection
  return React.useMemo(() => {
    const input = {
      botTyping: botTypingEntries,
      errors,
      lastScopes,
      nameOf,
      now: Date.now(),
      working,
    };
    return {
      channel: selectChannelWorkingIndicator({
        ...input,
        posted: channelPosted,
      }),
      thread: selectThreadWorkingIndicator({
        ...input,
        posted: threadPosted,
        threadHeadId: openThreadHeadId,
      }),
    };
  }, [
    channelPosted,
    threadPosted,
    botTypingEntries,
    errors,
    expiryTick,
    lastScopes,
    nameOf,
    openThreadHeadId,
    working,
  ]);
}
