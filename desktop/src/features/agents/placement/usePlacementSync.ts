import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { runAgentLifecycle } from "@/features/agents/agentLifecycle";
import {
  managedAgentsQueryKey,
  useManagedAgentsQuery,
  useStartManagedAgentMutation,
} from "@/features/agents/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { listManagedAgents } from "@/shared/api/tauri";
import { stopManagedAgent } from "@/shared/api/tauriManagedAgents";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { planPlacementActions } from "./placementEnforcement";
import { usePlacements } from "./placementQueries";
import { getPlacement, subscribePlacements } from "./placementStore";
import type { PlacementChange } from "./placementStore";

/**
 * Keeps this Mac in step with the relay's placement heads (spec 5.2):
 * reads and watches the heads of this Mac's agents, stops the local harness of
 * an agent that moves to the cloud, and starts it again when it moves back.
 * Mounted once in the app shell.
 */
export function usePlacementSync(): void {
  const queryClient = useQueryClient();
  const managedAgents = useManagedAgentsQuery();
  const startAgent = useStartManagedAgentMutation().mutateAsync;
  const { activeCommunity } = useCommunities();
  const identityQuery = useIdentityQuery();
  const relayUrl = activeCommunity?.relayUrl?.trim()
    ? activeCommunity.relayUrl
    : undefined;
  const signer = normalizePubkey(identityQuery.data?.pubkey ?? "") || undefined;

  const pubkeys = React.useMemo(
    () => (managedAgents.data ?? []).map((agent) => agent.pubkey),
    [managedAgents.data],
  );
  usePlacements(pubkeys);

  const scopeRef = React.useRef<{ relayUrl: string; signer: string } | null>(
    null,
  );
  scopeRef.current = relayUrl && signer ? { relayUrl, signer } : null;
  const startRef = React.useRef(startAgent);
  startRef.current = startAgent;

  React.useEffect(() => {
    const handle = async (changes: PlacementChange[]) => {
      let agents: Awaited<ReturnType<typeof listManagedAgents>>;
      try {
        agents = await queryClient.fetchQuery({
          queryKey: managedAgentsQueryKey,
          queryFn: listManagedAgents,
          staleTime: 0,
        });
      } catch (error) {
        console.warn(
          "[placement] could not list agents to apply a flip",
          error,
        );
        return;
      }
      for (const { pubkey, action } of planPlacementActions(changes, agents)) {
        try {
          await runAgentLifecycle(pubkey, `placement ${action}`, async () => {
            // The head may have moved again while this waited for the lock.
            const home = getPlacement(pubkey).home;
            if (action === "stop" && home !== "cloud") return;
            if (action === "start" && home !== "mac") return;
            if (action === "stop") {
              await stopManagedAgent(
                pubkey,
                "the agent was moved to the cloud",
              );
              return;
            }
            const scope = scopeRef.current;
            if (!scope) return;
            await startRef.current({
              pubkey,
              expectedRelayUrl: scope.relayUrl,
              expectedSignerPubkey: scope.signer,
              replayFloorUnix: Math.floor(Date.now() / 1000) - 60,
            });
          });
        } catch (error) {
          console.warn(`[placement] could not ${action} ${pubkey}`, error);
        } finally {
          void queryClient.invalidateQueries({
            queryKey: managedAgentsQueryKey,
          });
        }
      }
    };
    return subscribePlacements((changes) => {
      void handle(changes);
    });
  }, [queryClient]);
}
