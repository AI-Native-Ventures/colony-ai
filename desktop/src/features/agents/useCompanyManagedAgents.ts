import { useMemo } from "react";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { mergeTeamMembers } from "@/features/company-team/teamModels";
import { useCommunities } from "@/features/communities/useCommunities";
import { useManagedAgentsQuery, useRelayAgentsQuery } from "./hooks";
import type { ManagedAgent, RelayAgent } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

/** Recompute Team membership from live directories so a newly created Scout is never hidden by an older Team snapshot. */
export function useCompanyAgentPubkeys(
  managedAgents: readonly ManagedAgent[] | undefined,
  relayAgents: readonly RelayAgent[] | undefined,
) {
  const team = useCompanyTeamQuery();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMemo(() => {
    if (!relayUrl) return new Set<string>();
    return new Set(
      mergeTeamMembers({
        managedAgents: [...(managedAgents ?? [])],
        relayAgents: [...(relayAgents ?? [])],
        relayMembers: team.data?.relayMembers ?? [],
        positions:
          team.data?.members.flatMap((member) =>
            member.position ? [member.position] : [],
          ) ?? [],
        relayUrl,
      }).map((member) => normalizePubkey(member.pubkey)),
    );
  }, [relayUrl, managedAgents, relayAgents, team.data]);
}

/** Display only the current business's agents; complete records remain available to runtime and sign-out. */
export function useCompanyManagedAgentsQuery(options?: { enabled?: boolean }) {
  const query = useManagedAgentsQuery(options);
  const relay = useRelayAgentsQuery(options);
  const pubkeys = useCompanyAgentPubkeys(query.data, relay.data);
  const data = useMemo(
    () =>
      query.data?.filter((agent) => pubkeys.has(normalizePubkey(agent.pubkey))),
    [query.data, pubkeys],
  );
  return { ...query, data };
}
