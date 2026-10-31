import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";

import { useCofounderSettingsQuery, useFunctionSlotsQuery } from "./hooks";

export function useCofounderMode() {
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  return {
    enabled: settings.data?.settings.enabled === true,
    settings,
  };
}

export function useCustomerRecordCapabilities() {
  const { activeCommunity } = useCommunities();
  const settings = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const enabled = settings.data?.settings.enabled === true;
  const membership = useMyRelayMembershipQuery();
  const identity = useIdentityQuery();
  const self = identity.data?.pubkey.toLowerCase() ?? null;
  const slots = useFunctionSlotsQuery(
    enabled ? (activeCommunity?.id ?? null) : null,
  );
  const agents = useManagedAgentsQuery({ enabled });
  const role = membership.data?.role;
  const ownerOrAdmin = role === "owner" || role === "admin";
  const isLead = (functionId: "sales" | "customer_success") =>
    Boolean(
      self &&
        slots.some(
          (slot) =>
            slot.functionId === functionId &&
            slot.leadPubkey?.toLowerCase() === self,
        ),
    );
  const isScout = Boolean(
    self &&
      agents.data?.some(
        (agent) =>
          agent.pubkey.toLowerCase() === self &&
          (agent.personaId === "builtin:fizz" ||
            agent.name.trim().toLocaleLowerCase() === "scout"),
      ),
  );
  const salesLead = isLead("sales");
  const customerSuccessLead = isLead("customer_success");

  return {
    enabled,
    settings,
    canWrite:
      ownerOrAdmin ||
      salesLead ||
      customerSuccessLead ||
      isScout ||
      self !== null,
    canConvert: ownerOrAdmin || salesLead,
  };
}
