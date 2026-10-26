import { useQuery } from "@tanstack/react-query";

import {
  resolveTenantCommunityId,
  type TenantCommunityId,
} from "./tenantCommunity";

/**
 * The relay's tenant community id for a saved relay URL, asked of the relay
 * itself (see `tenantCommunity.ts`). `tenantId` stays null until the relay has
 * answered; `error` is set when it could not be confirmed, and nothing that
 * builds business record coordinates may run in that state.
 */
export function useTenantCommunityId(relayUrl: string | null): {
  tenantId: TenantCommunityId | null;
  pending: boolean;
  error: Error | null;
  retry: () => Promise<unknown>;
} {
  const query = useQuery({
    queryKey: ["tenant-community-id", relayUrl ?? "unavailable"],
    enabled: relayUrl !== null,
    // A host keeps its tenant id; a community change remounts and resets it.
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    queryFn: () => resolveTenantCommunityId(relayUrl ?? ""),
  });
  return {
    tenantId: query.data ?? null,
    pending: relayUrl !== null && query.isPending,
    error: query.error ?? null,
    retry: query.refetch,
  };
}
