import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

import {
  applyPlacements,
  getPlacement,
  getPlacementsVersion,
  subscribePlacementsVersion,
} from "./placementStore";
import {
  KIND_AGENT_PLACEMENT_HEAD,
  parsePlacementHead,
  pickNewestPlacements,
} from "./placementTypes";
import type { AgentPlacement } from "./placementTypes";

/** Heads per relay read: a filter with a very long `#d` list is refused. */
const READ_CHUNK = 100;

export const placementsQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
  agentsKey: string,
) => ["agent-placements", communityId, relayUrl, agentsKey] as const;

/** Lowercased, deduplicated and sorted: one query per set of agents. */
export function normalizeAgentSet(agentPubkeys: readonly string[]): string[] {
  return [...new Set(agentPubkeys.map(normalizePubkey).filter(Boolean))].sort();
}

/**
 * Reads the relay-signed placement heads of `agentPubkeys` and records them in
 * the placement store. A relay that does not advertise a signing key, or a
 * read that fails, rejects: "no head" would read as "on the Mac" and start a
 * second copy of a cloud agent.
 */
export async function fetchPlacements(
  agentPubkeys: readonly string[],
): Promise<void> {
  const agents = normalizeAgentSet(agentPubkeys);
  if (agents.length === 0) return;
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events: RelayEvent[] = [];
  for (let index = 0; index < agents.length; index += READ_CHUNK) {
    const chunk = agents.slice(index, index + READ_CHUNK);
    events.push(
      ...(await relayClient.fetchEvents({
        kinds: [KIND_AGENT_PLACEMENT_HEAD],
        authors: [relaySelf],
        "#d": chunk,
        limit: chunk.length * 4,
      })),
    );
  }
  applyPlacements(pickNewestPlacements(events, relaySelf));
}

/**
 * Keeps the placement store current for `agentPubkeys`: a read when the set
 * changes or the relay reconnects, a live subscription for flips, and a slow
 * poll as a safety net. Returns the placement of each agent, `mac` at
 * generation 0 where the relay has no head.
 */
export function usePlacements(
  agentPubkeys: readonly string[],
  options?: { enabled?: boolean },
): Map<string, AgentPlacement> {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const agents = React.useMemo(
    () => normalizeAgentSet(agentPubkeys),
    [agentPubkeys],
  );
  const agentsKey = agents.join(",");
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(communityId && relayUrl) &&
    agents.length > 0;
  const queryKey = React.useMemo(
    () => placementsQueryKey(communityId, relayUrl, agentsKey),
    [communityId, relayUrl, agentsKey],
  );

  useQuery({
    enabled,
    queryKey,
    queryFn: async () => {
      await fetchPlacements(agents);
      return agents.length;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  React.useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const refresh = () => {
      if (!disposed) void queryClient.invalidateQueries({ queryKey });
    };
    const unsubscribeReconnect = relayClient.subscribeToReconnects(refresh);
    void getRelaySelf()
      .then((relaySelf) => {
        if (disposed || !relaySelf) return null;
        return relayClient.subscribeLive(
          {
            kinds: [KIND_AGENT_PLACEMENT_HEAD],
            authors: [relaySelf],
            "#d": agents,
            since: Math.floor(Date.now() / 1000) - 5,
            limit: agents.length * 4,
          },
          (event) => {
            const parsed = parsePlacementHead(event, relaySelf);
            if (parsed) {
              applyPlacements(new Map([[parsed.agent, parsed.placement]]));
            }
          },
        );
      })
      .then((stop) => {
        if (!stop) return;
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch((error: unknown) => {
        // The poll above still brings flips in, just slower.
        console.warn(
          "[placement] could not subscribe to placement heads",
          error,
        );
      });
    return () => {
      disposed = true;
      unsubscribeReconnect();
      unsubscribe?.();
    };
  }, [agents, enabled, queryClient, queryKey]);

  const version = React.useSyncExternalStore(
    subscribePlacementsVersion,
    getPlacementsVersion,
  );
  return React.useMemo(() => {
    void version;
    return new Map(agents.map((pubkey) => [pubkey, getPlacement(pubkey)]));
  }, [agents, version]);
}

/** The placement of one agent from the store, with no relay traffic of its
 * own (`usePlacements` in the app shell keeps the store current). */
export function usePlacement(agentPubkey: string | null | undefined) {
  const version = React.useSyncExternalStore(
    subscribePlacementsVersion,
    getPlacementsVersion,
  );
  return React.useMemo(() => {
    void version;
    return getPlacement(agentPubkey ?? "");
  }, [agentPubkey, version]);
}
