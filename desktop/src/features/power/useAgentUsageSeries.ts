import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getAgentUsageSeries,
  onAgentMetricsChanged,
  type AgentUsageSeries,
} from "@/shared/api/tauriArchive";
import { usageBucketBoundaries, type UsagePeriodDays } from "./usageBoundaries";

export const agentUsageSeriesQueryKey = (periodDays: UsagePeriodDays) =>
  ["agent-usage-series", periodDays] as const;

export function useAgentUsageSeries(periodDays: UsagePeriodDays) {
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(
    () => agentUsageSeriesQueryKey(periodDays),
    [periodDays],
  );

  React.useEffect(
    () =>
      onAgentMetricsChanged(() => {
        void queryClient.invalidateQueries({ queryKey });
      }),
    [queryClient, queryKey],
  );

  return useQuery<AgentUsageSeries>({
    queryKey,
    queryFn: () =>
      getAgentUsageSeries({
        bucketBoundaries: usageBucketBoundaries(new Date(), periodDays),
      }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
