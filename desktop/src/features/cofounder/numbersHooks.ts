import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCommunities } from "@/features/communities/useCommunities";
import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";

import { buildNumbersActionEvent } from "./numbersActions";
import type { NumbersActionInput } from "./numbersActions";
import {
  KIND_NUMBERS_ACTION,
  KIND_NUMBERS_HEAD,
  buildNumbersModel,
  parseNumbersHead,
} from "./numbersRecords";
import type {
  FunctionScorecardView,
  GoalView,
  NumbersModel,
  ReviewView,
} from "./numbersRecords";
import type { FunctionId } from "./cofounderRecords";

export const numbersQueryKey = (
  communityId: string | null,
  relayUrl: string | null,
) => ["company-numbers", communityId, relayUrl] as const;

async function fetchNumbers(): Promise<NumbersModel> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_NUMBERS_HEAD],
    authors: [relaySelf],
    limit: 1_000,
  });
  const parsed = [];
  for (const event of events) {
    const record = parseNumbersHead(event, relaySelf);
    if (record) parsed.push({ record, createdAt: event.created_at });
  }
  return buildNumbersModel(parsed);
}

/** The scorecard, every goal and every weekly review of the company. */
export function useNumbersQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && Boolean(communityId && relayUrl),
    queryKey: numbersQueryKey(communityId, relayUrl),
    queryFn: fetchNumbers,
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** The scorecard of one function, with its approved goals. */
export function useFunctionNumbers(functionId: FunctionId, enabled = true) {
  const numbers = useNumbersQuery(enabled);
  const card = useMemo<FunctionScorecardView | null>(
    () =>
      numbers.data?.scorecard?.functions.find(
        (candidate) => candidate.functionId === functionId,
      ) ?? null,
    [numbers.data, functionId],
  );
  const goals = useMemo<GoalView[]>(
    () =>
      (numbers.data?.goals ?? []).filter(
        (goal) => goal.functionId === functionId,
      ),
    [numbers.data, functionId],
  );
  return {
    ...numbers,
    scorecard: numbers.data?.scorecard ?? null,
    card,
    goals,
  };
}

export function useReviewQuery(reviewDate: string | null) {
  const numbers = useNumbersQuery(reviewDate !== null);
  const review = useMemo<ReviewView | null>(
    () =>
      numbers.data?.reviews.find(
        (candidate) => candidate.reviewDate === reviewDate,
      ) ?? null,
    [numbers.data, reviewDate],
  );
  return { ...numbers, review };
}

/** One mutation for every numbers write: sign, publish, refresh the list. */
export function useNumbersAction() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async (input: NumbersActionInput) => {
      if (!communityId || !relayUrl)
        throw new Error("No active company is selected.");
      const { content, tags } = buildNumbersActionEvent(input);
      const event = await signRelayEvent({
        kind: KIND_NUMBERS_ACTION,
        content,
        tags,
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the numbers.",
        "Failed to save the numbers.",
      );
      return event;
    },
    onSettled: async () => {
      if (!communityId || !relayUrl) return;
      await queryClient.invalidateQueries({
        queryKey: numbersQueryKey(communityId, relayUrl),
      });
    },
  });
}
