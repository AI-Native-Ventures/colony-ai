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
import { useNumbersQuery } from "./numbersHooks";
import { usePlansQuery } from "./planHooks";
import { usePlaybooksQuery } from "./playbookHooks";

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
  const playbooks = usePlaybooksQuery(cofounder.data?.exists === true);
  const numbers = useNumbersQuery(cofounderOn && canApprove);
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
        // A proposal waits only while the mode is on; steps of running copies show either way.
        playbooks: (playbooks.data?.playbooks ?? []).filter(
          (playbook) => cofounderOn || playbook.pending === null,
        ),
        playbookJobs: playbooks.data?.jobs ?? [],
        whatsappBatches: batches.data ?? [],
        whatsappDrafts: drafts.data ?? [],
        goals: cofounderOn ? (numbers.data?.goals ?? []) : [],
        reviews: cofounderOn ? (numbers.data?.reviews ?? []) : [],
      }),
    [
      canApprove,
      cofounderOn,
      needsMe.data.asks,
      plans.data,
      playbooks.data,
      batches.data,
      drafts.data,
      numbers.data,
    ],
  );

  const whatsappError = canApprove
    ? (whatsappStatus.error ??
      (outreachConnected ? (batches.error ?? drafts.error) : null))
    : null;

  return {
    model,
    isPending: needsMe.isPending || plans.isPending || playbooks.isPending,
    error: needsMe.asksError ?? plans.error ?? playbooks.error ?? null,
    whatsappError,
    refetch: () =>
      Promise.all([needsMe.refetch(), plans.refetch(), playbooks.refetch()]),
  };
}
