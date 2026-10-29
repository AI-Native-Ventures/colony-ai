import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import {
  getAgentSubscriptionUsage,
  onAgentMetricsChanged,
} from "@/shared/api/tauriArchive";
import { useIdentityQuery } from "@/shared/api/hooks";

const agentSubscriptionUsageKey = (
  agentPubkey: string,
  communityId: string,
  relayUrl: string,
  identityPubkey: string,
) =>
  [
    "agent-subscription-usage",
    agentPubkey,
    communityId,
    relayUrl,
    identityPubkey,
  ] as const;

export function useAgentSubscriptionUsage(
  agentPubkey: string,
  enabled: boolean,
) {
  const { activeCommunity } = useCommunities();
  const queryClient = useQueryClient();
  const identity = useIdentityQuery();

  useEffect(() => {
    if (!agentPubkey) return;
    return onAgentMetricsChanged(() => {
      void queryClient.invalidateQueries({
        queryKey: ["agent-subscription-usage", agentPubkey],
      });
    });
  }, [agentPubkey, queryClient]);

  return useQuery({
    queryKey: agentSubscriptionUsageKey(
      agentPubkey,
      activeCommunity?.id ?? "none",
      activeCommunity?.relayUrl ?? "none",
      identity.data?.pubkey ?? "none",
    ),
    queryFn: () => getAgentSubscriptionUsage(agentPubkey),
    enabled:
      enabled &&
      agentPubkey.length > 0 &&
      activeCommunity !== null &&
      identity.data?.pubkey !== undefined,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
