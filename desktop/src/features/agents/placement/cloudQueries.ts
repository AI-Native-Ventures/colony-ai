import { useQuery } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";

import { getCloudCapabilities, NO_CLOUD_CAPABILITIES } from "./cloudApi";
import type { CloudCapabilities } from "./cloudApi";

export const cloudCapabilitiesQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["cloud-capabilities", communityId, relayUrl] as const;

/**
 * What this account may do with cloud agents on the active relay. A relay that
 * does not know cloud agents, or a read that fails, reads as "not available":
 * the switch stays hidden rather than offering something that cannot work.
 */
export function useCloudCapabilities(options?: { enabled?: boolean }) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const query = useQuery({
    enabled: (options?.enabled ?? true) && Boolean(communityId && relayUrl),
    queryKey: cloudCapabilitiesQueryKey(communityId, relayUrl),
    queryFn: getCloudCapabilities,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const capabilities: CloudCapabilities = query.data ?? NO_CLOUD_CAPABILITIES;
  return {
    capabilities,
    /** The switch is offered: the relay has cloud agents on for this account. */
    available: capabilities.enabled && capabilities.allowed,
    isLoading: query.isLoading,
  };
}
