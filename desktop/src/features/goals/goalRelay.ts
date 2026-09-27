import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useCommunities } from "@/features/communities/useCommunities";
import { signRelayEvent } from "@/shared/api/tauri";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_GOAL_ACTION, KIND_GOAL_HEAD } from "@/shared/constants/kinds";

import {
  GOAL_HEAD_QUERY_LIMIT,
  goalDTag,
  parseGoalActionEvent,
  parseGoalHeadEvent,
  type GoalAction,
  type GoalHeadRecord,
} from "./goalModels";

const GOAL_HISTORY_QUERY_LIMIT = 2_000;

export const goalHeadsQueryKey = (relayUrl: string | null) =>
  ["company-goals", relayUrl] as const;

export const goalHistoryQueryKey = (relayUrl: string | null, dTag: string) =>
  ["company-goal-history", relayUrl, dTag] as const;

async function fetchGoalHeads(): Promise<GoalHeadRecord[]> {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_GOAL_HEAD],
    authors: [relaySelf],
    limit: GOAL_HEAD_QUERY_LIMIT,
  });
  if (events.length >= GOAL_HEAD_QUERY_LIMIT) {
    throw new Error("The company goal list exceeds the supported read limit.");
  }
  return events.map((event) => {
    const parsed = parseGoalHeadEvent(event, relaySelf);
    if (!parsed) {
      throw new Error("The relay returned an invalid signed company goal.");
    }
    return parsed;
  });
}

async function fetchGoalHistory(dTag: string): Promise<RelayEvent[]> {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_GOAL_ACTION],
    "#d": [dTag],
    limit: GOAL_HISTORY_QUERY_LIMIT,
  });
  if (events.length >= GOAL_HISTORY_QUERY_LIMIT) {
    throw new Error(
      "The company goal history exceeds the supported read limit.",
    );
  }
  const history = events.map((event) => {
    if (!parseGoalActionEvent(event, dTag)) {
      throw new Error("The relay returned an invalid company goal action.");
    }
    return event;
  });
  return history.sort((left, right) => right.created_at - left.created_at);
}

export function useGoalHeadsQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && relayUrl !== null,
    queryKey: goalHeadsQueryKey(relayUrl),
    queryFn: fetchGoalHeads,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useGoalHeadQuery(goalId: string, enabled = true) {
  const headsQuery = useGoalHeadsQuery(enabled);
  return {
    ...headsQuery,
    data: headsQuery.data?.find((record) => record.head.goalId === goalId),
  };
}

export function useGoalHistoryQuery(dTag: string | null, enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && relayUrl !== null && dTag !== null,
    queryKey: goalHistoryQueryKey(relayUrl, dTag ?? ""),
    queryFn: () => fetchGoalHistory(dTag as string),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useGoalActionMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;

  return useMutation({
    mutationFn: async ({ action }: { action: GoalAction }) => {
      const event = await signRelayEvent({
        kind: KIND_GOAL_ACTION,
        content: JSON.stringify(action),
        tags: [["d", goalDTag(action.goalId)]],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the company goal.",
        "Failed to save the company goal.",
      );
      return event;
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: goalHeadsQueryKey(relayUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: goalHistoryQueryKey(
            relayUrl,
            goalDTag(variables.action.goalId),
          ),
        }),
      ]);
    },
  });
}
