import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useChannelAgentStartWatches } from "@/features/agents/agentStartWatch";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { findUnansweredMentions } from "@/features/agents/unansweredMentions";
import { usePresenceQuery } from "@/features/presence/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import {
  AgentHomeCard,
  TopUpDialog,
  homeNoticeContent,
  useTopUpDialog,
} from "./AgentHomeNotices";
import { homeNoticeKind } from "./homeNoticeModel";
import { useAgentHome } from "./useAgentHome";

/** How far back a message to an agent can be and still be "waiting". */
const LOOKBACK_SECONDS = 15 * 60;

/**
 * The cloud agent card for a direct message with an agent: Mac off, out of AI
 * credit, or could not start (plan Task 18). Mounted above the composer.
 */
export function ChannelAgentHomeNotices({
  channel,
  currentPubkey,
}: {
  channel: Channel | null;
  currentPubkey: string | undefined;
}) {
  const knownAgents = useKnownAgentPubkeys();
  const agentPubkey = React.useMemo(() => {
    if (channel?.channelType !== "dm") return null;
    const me = currentPubkey ? normalizePubkey(currentPubkey) : null;
    const others = channel.participantPubkeys
      .map(normalizePubkey)
      .filter((pubkey) => pubkey !== me);
    if (others.length !== 1) return null;
    return knownAgents.has(others[0]) ? others[0] : null;
  }, [channel, currentPubkey, knownAgents]);
  if (!agentPubkey || !channel) return null;
  return (
    <HomeNoticeForAgent
      agentPubkey={agentPubkey}
      channelId={channel.id}
      currentPubkey={currentPubkey}
    />
  );
}

function HomeNoticeForAgent({
  agentPubkey,
  channelId,
  currentPubkey,
}: {
  agentPubkey: string;
  channelId: string;
  currentPubkey: string | undefined;
}) {
  const model = useAgentHome(agentPubkey);
  const identity = useIdentityQuery().data?.pubkey ?? currentPubkey;
  const topUp = useTopUpDialog();
  const watches = useChannelAgentStartWatches(channelId);
  const presence = usePresenceQuery([agentPubkey], { enabled: model.owned });
  const online = (presence.data?.[agentPubkey] ?? "offline") !== "offline";

  // Only a Mac placed agent can be "Mac off": look for a message it never
  // answered, and only while nothing shows it online.
  const watchUnanswered =
    model.owned &&
    model.cloudAvailable &&
    model.placement.home === "mac" &&
    !online &&
    Boolean(identity);
  const unanswered = useQuery({
    enabled: watchUnanswered,
    queryKey: ["agent-home-unanswered", agentPubkey, identity],
    queryFn: async () => {
      const found = await findUnansweredMentions({
        agentPubkey,
        senderPubkey: identity as string,
        nowSeconds: Math.floor(Date.now() / 1000),
        lookbackSeconds: LOOKBACK_SECONDS,
        fetchEvents: (filter) => relayClient.fetchEvents(filter),
      });
      return found[0]?.createdAt ?? null;
    },
    refetchInterval: 15_000,
    retry: false,
  });

  const [now, setNow] = React.useState(() => Math.floor(Date.now() / 1000));
  React.useEffect(() => {
    if (!watchUnanswered) return;
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      5_000,
    );
    return () => window.clearInterval(timer);
  }, [watchUnanswered]);

  const kind = homeNoticeKind({
    placement: model.placement,
    cloudAvailable: model.cloudAvailable,
    owned: model.owned,
    online,
    hasLocalRecord: model.hasLocalRecord,
    localStartFailed: watches.some(
      (watch) =>
        normalizePubkey(watch.pubkey) === agentPubkey &&
        watch.phase === "stalled",
    ),
    oldestUnansweredAt: watchUnanswered ? (unanswered.data ?? null) : null,
    nowSeconds: now,
  });
  if (!kind) return null;
  const { message, actions } = homeNoticeContent(kind, model.name, {
    moveToCloud: () => void model.choose("cloud"),
    moveToMac: () => void model.choose("mac"),
    retry: () => void model.retryWake(),
    topUp: () => topUp.setOpen(true),
  });
  return (
    <>
      <AgentHomeCard
        actions={actions}
        busy={model.pending}
        kind={kind}
        message={model.message ?? message}
      />
      <TopUpDialog onOpenChange={topUp.setOpen} open={topUp.open} />
    </>
  );
}
