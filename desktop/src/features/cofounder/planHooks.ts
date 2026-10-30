import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";

import { buildPlanActionEvent } from "./planActions";
import type { PlanActionInput } from "./planActions";
import {
  KIND_PLAN_ACTION,
  KIND_PLAN_HEAD,
  latestPlans,
  parsePlanHead,
} from "./planRecords";
import type { PlanView } from "./planRecords";

export const plansQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-plans", communityId, relayUrl] as const;

async function fetchPlans(): Promise<PlanView[]> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_PLAN_HEAD],
    authors: [relaySelf],
    limit: 500,
  });
  const parsed = [];
  for (const event of events) {
    const plan = parsePlanHead(event, relaySelf);
    if (plan) parsed.push({ plan, createdAt: event.created_at });
  }
  return latestPlans(parsed);
}

/** Every plan of the company, newest change first. */
export function usePlansQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && Boolean(communityId && relayUrl),
    queryKey: plansQueryKey(communityId, relayUrl),
    queryFn: fetchPlans,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function usePlanQuery(planId: string | null) {
  const plans = usePlansQuery(planId !== null);
  const plan = useMemo(
    () => plans.data?.find((candidate) => candidate.planId === planId) ?? null,
    [plans.data, planId],
  );
  return { ...plans, plan };
}

/** One mutation for every plan write: sign, publish, refresh the list. */
export function usePlanAction() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (input: PlanActionInput) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const { content, tags } = buildPlanActionEvent(input);
      const event = await signRelayEvent({
        kind: KIND_PLAN_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the plan.",
        "Failed to save the plan.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: plansQueryKey(communityId, relayUrl),
      });
    },
  });
}
