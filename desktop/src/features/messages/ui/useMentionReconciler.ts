import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import {
  managedAgentsQueryKey,
  useStartManagedAgentMutation,
} from "@/features/agents/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { listManagedAgents } from "@/shared/api/tauri";
import {
  releaseWakeEvents,
  stopManagedAgent,
} from "@/shared/api/tauriManagedAgents";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { runAgentLifecycle } from "@/features/agents/agentLifecycle";
import {
  failAgentStartWatches,
  registerAgentStartWatch,
  resolveAgentStartWatches,
  stallAgentStartWatches,
} from "@/features/agents/agentStartWatch";
import { createMentionCatchUpStore } from "@/features/agents/mentionCatchUpStorage";
import {
  createMentionReconciler,
  type MentionReconciler,
  type TenantScope,
} from "@/features/agents/mentionReconciler";
import { setMentionReconciler } from "@/features/agents/mentionReconcilerHandle";
import { setStartFloorLookup } from "@/features/agents/startFloorLookup";
import { findUnansweredMentions } from "@/features/agents/unansweredMentions";
import { isDetachedStartInFlight } from "./useDetachedAgentStart";

/**
 * Mounts the mention reconciler for the community on screen (see
 * `mentionReconciler`): it reads the relay after every send that mentions
 * someone and once when the community opens, so a mention to a local agent is
 * never left unanswered because the send path did not wake the agent.
 */
export function useMentionReconciler(): void {
  const queryClient = useQueryClient();
  const startAgent = useStartManagedAgentMutation().mutateAsync;
  const { activeCommunity } = useCommunities();
  const identityQuery = useIdentityQuery();
  const relayUrl = activeCommunity?.relayUrl?.trim()
    ? activeCommunity.relayUrl
    : undefined;
  const signer = normalizePubkey(identityQuery.data?.pubkey ?? "") || undefined;

  // Read through refs so the reconciler is built once per mount and always
  // sees the scope of the latest render.
  const scopeRef = React.useRef<TenantScope | null>(null);
  scopeRef.current =
    relayUrl && signer
      ? { expectedRelayUrl: relayUrl, expectedSignerPubkey: signer }
      : null;
  const startRef = React.useRef(startAgent);
  startRef.current = startAgent;

  const reconcilerRef = React.useRef<MentionReconciler | null>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const reconciler = createMentionReconciler({
      loadAgents: () =>
        queryClient.fetchQuery({
          queryKey: managedAgentsQueryKey,
          queryFn: listManagedAgents,
          staleTime: 0,
        }),
      findUnanswered: (agentPubkey, lookbackSeconds) => {
        const sender = scopeRef.current?.expectedSignerPubkey;
        if (!sender) {
          return Promise.reject(
            new Error("the signed-in identity is not known yet"),
          );
        }
        return findUnansweredMentions({
          agentPubkey,
          senderPubkey: sender,
          nowSeconds: Math.floor(Date.now() / 1000),
          lookbackSeconds,
          fetchEvents: (filter) => relayClient.fetchEvents(filter),
        });
      },
      getScope: () => scopeRef.current,
      stopAgent: (pubkey, reason) => stopManagedAgent(pubkey, reason),
      handBack: (pubkey, eventIds) => releaseWakeEvents(pubkey, eventIds),
      exclusive: runAgentLifecycle,
      startAgent: (agent, attempt, scope) =>
        startRef.current({
          pubkey: agent.pubkey,
          expectedRelayUrl: scope.expectedRelayUrl,
          expectedSignerPubkey: scope.expectedSignerPubkey,
          replayFloorUnix: attempt.floorUnix,
          forceRestart: attempt.force,
        }),
      isStartInFlight: isDetachedStartInFlight,
      watch: (input) => {
        registerAgentStartWatch(input);
      },
      resolve: (pubkey, registeredBefore) =>
        resolveAgentStartWatches(pubkey, { registeredBefore }),
      now: () => Date.now(),
      fail: failAgentStartWatches,
      stall: stallAgentStartWatches,
      caughtUp: createMentionCatchUpStore(),
      report: (message) => {
        toast.error(message);
      },
      warn: (message, error) => {
        console.warn(message, error);
      },
      schedule: (run, delayMs) => {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      },
    });
    reconcilerRef.current = reconciler;
    setMentionReconciler(reconciler);
    // Every start of an agent reaches back to the oldest mention the relay
    // shows it never answered, and hands back the ones its last harness
    // queued and lost.
    setStartFloorLookup((agentPubkey) => reconciler.prepareStart(agentPubkey));
    setReady(true);
    return () => {
      setReady(false);
      reconcilerRef.current = null;
      setStartFloorLookup(null);
      setMentionReconciler(null);
      reconciler.dispose();
    };
  }, [queryClient]);

  // Once the community is open and its identity known: what was sent while the
  // app was closed or the agent was down.
  const launched = React.useRef(false);
  React.useEffect(() => {
    if (!ready || !signer || !relayUrl || launched.current) return;
    launched.current = true;
    reconcilerRef.current?.catchUpOnLaunch();
  }, [ready, relayUrl, signer]);
}
