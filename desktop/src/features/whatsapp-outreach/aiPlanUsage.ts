import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getAiPlanReserve,
  overrideAiPlanReserveOnce,
  updateAiPlanReserve,
  type AiPlanReserveState,
} from "@/shared/api/aiPlanUsage";

const ROOT_QUERY_KEY = ["ai-plan-reserve"] as const;

/** Shared query keys for the desktop-local AI plan reserve. */
export const aiPlanReserveQueryKeys = {
  all: ROOT_QUERY_KEY,
  current: [...ROOT_QUERY_KEY, "current"] as const,
};

/** Read the desktop-local plan reserve once for all Outreach surfaces. */
export function useAiPlanReserveQuery() {
  return useQuery({
    queryKey: aiPlanReserveQueryKeys.current,
    queryFn: getAiPlanReserve,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

function useAiPlanReserveCommit<Args extends readonly unknown[]>(
  commit: (...args: Args) => Promise<AiPlanReserveState>,
) {
  const queryClient = useQueryClient();
  const generation = React.useRef(0);
  return React.useCallback(
    async (...args: Args) => {
      const requestGeneration = ++generation.current;
      const state = await commit(...args);
      if (requestGeneration === generation.current) {
        await queryClient.cancelQueries({
          queryKey: aiPlanReserveQueryKeys.all,
        });
        queryClient.setQueryData(aiPlanReserveQueryKeys.current, state);
      }
      return state;
    },
    [commit, queryClient],
  );
}

/** Persist a reserve setting while fencing stale async completions by generation. */
export function useAiPlanReserveUpdate() {
  return useAiPlanReserveCommit(updateAiPlanReserve);
}

/** Consume the one available override only after the user explicitly asks for it. */
export function useAiPlanReserveOverride() {
  return useAiPlanReserveCommit(overrideAiPlanReserveOnce);
}

/** Make an honest compact label for the Outreach chip. */
export function aiPlanReserveChipLabel(
  state: AiPlanReserveState | undefined,
): string {
  if (!state) return "Checking usage";
  const reported = state.usage.filter(
    (usage) =>
      usage.availability === "available" &&
      usage.freshness === "fresh" &&
      usage.usedPercent !== null,
  );
  if (reported.length === 0) return "usage not available for your AI";
  const mostUsed = reported.reduce((highest, usage) =>
    (usage.usedPercent ?? 0) > (highest.usedPercent ?? 0) ? usage : highest,
  );
  const used = new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
  }).format(mostUsed.usedPercent ?? 0);
  return state.preference.enabled
    ? `${used}% used, ${state.preference.reservedPercent}% kept for you`
    : `${used}% used, reserve is off`;
}
