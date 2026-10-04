import { useManagedAgentRuntimesQuery } from "@/features/agents/managedAgentRuntimeHooks";
import { findManagedAgentRuntime } from "@/features/agents/managedAgentRuntimeStatus";
import { useActiveAgentTurns } from "@/features/agents/activeAgentTurnsStore";
import { useCommunities } from "@/features/communities/useCommunities";
import type { TeamMember } from "./teamModels";
import { employeeRuntimeStatus } from "./employeePresentation";

/** Observe the current community's pair, never another community's readiness. */
export function useEmployeeRuntime(member: TeamMember) {
  const { activeCommunity } = useCommunities();
  const query = useManagedAgentRuntimesQuery({
    enabled: member.kind === "employee",
  });
  const turns = useActiveAgentTurns(
    member.kind === "employee" ? member.pubkey : null,
  );
  const relay = activeCommunity?.relayUrl;
  const runtime = relay
    ? findManagedAgentRuntime(query.data ?? [], member.pubkey, relay)
    : undefined;
  return {
    label:
      member.kind === "employee" && query.isLoading
        ? "Loading"
        : employeeRuntimeStatus(
            member,
            runtime,
            turns.length > 0,
            query.isError,
          ),
    runtime,
  };
}
