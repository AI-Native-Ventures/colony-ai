import { useMemo } from "react";

import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useNeedsMeQuery } from "@/features/home/needsMeHooks";
import {
  useWhatsAppBatchesQuery,
  useWhatsAppDraftsQuery,
  useWhatsAppStatusQuery,
} from "@/features/whatsapp-outreach/whatsappOutreachQueries";
import { useCommunities } from "@/features/communities/useCommunities";

import { useCofounderSettingsQuery } from "./hooks";
import { buildNeedsYou } from "./needsYou";
import { usePlansQuery } from "./planHooks";

/**
 * The Needs you list for Today. Asks and the WhatsApp outreach queue show as
 * they always did; plans show only while co-founder mode is on, because the
 * relay refuses to approve a proposal while it is off.
 */
export function useNeedsYouQuery() {
  const { activeCommunity } = useCommunities();
  const needsMe = useNeedsMeQuery();
  const membership = useMyRelayMembershipQuery();
  const role = membership.data?.role;
  const canApprove = role === "owner" || role === "admin";
  const cofounder = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const cofounderOn = cofounder.data?.settings.enabled === true;
  const plans = usePlansQuery(cofounder.data?.exists === true);
  const whatsappStatus = useWhatsAppStatusQuery(canApprove);
  const outreachConnected = whatsappStatus.data?.connected === true;
  const batches = useWhatsAppBatchesQuery(
    "pending",
    canApprove && outreachConnected,
  );
  const drafts = useWhatsAppDraftsQuery(canApprove && outreachConnected);

  const model = useMemo(
    () =>
      buildNeedsYou({
        canApprove,
        asks: needsMe.data.asks,
        plans: (plans.data ?? []).filter(
          (plan) => cofounderOn || plan.status !== "proposed",
        ),
        whatsappBatches: batches.data ?? [],
        whatsappDrafts: drafts.data ?? [],
      }),
    [
      canApprove,
      cofounderOn,
      needsMe.data.asks,
      plans.data,
      batches.data,
      drafts.data,
    ],
  );

  return {
    model,
    isPending: needsMe.isPending || plans.isPending,
    error: needsMe.asksError ?? plans.error ?? null,
  };
}
