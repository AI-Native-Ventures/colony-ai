import * as React from "react";
import { useCompanyAgentPubkeys } from "@/features/agents/useCompanyManagedAgents";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { useManagedAgentActions } from "./useManagedAgentActions";

/**
 * The management hook knows every managed agent, because presence and deletion
 * checks need that. Screens that list agents use this wrapper instead: it
 * shows only the current business's agents, so legacy starters stay hidden
 * without being deleted.
 */
export function useCompanyScopedAgentActions() {
  const allAgents = useManagedAgentActions();
  const companyAgentPubkeys = useCompanyAgentPubkeys(
    allAgents.managedAgents,
    allAgents.relayAgentsQuery.data,
  );
  const managedAgents = React.useMemo(
    () =>
      allAgents.managedAgents.filter((agent) =>
        companyAgentPubkeys.has(normalizePubkey(agent.pubkey)),
      ),
    [allAgents.managedAgents, companyAgentPubkeys],
  );
  return { ...allAgents, managedAgents };
}
