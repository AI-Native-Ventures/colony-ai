import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { subscribeToBusinessRecords } from "@/features/clients/lib/businessRecordLive";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import {
  KIND_COMPANY_WORK_TRACKING_ACTION,
  KIND_COMPANY_WORK_TRACKING_HEAD,
} from "@/shared/constants/kinds";

import {
  COMPANY_WORK_TRACKING_ACTION_QUERY_LIMIT,
  COMPANY_WORK_TRACKING_HEAD_QUERY_LIMIT,
  parseCompanyWorkSuggestionAcceptanceEvent,
  parseCompanyWorkTrackingHeadEvent,
  type CompanyWorkSuggestionAcceptanceEntry,
  type CompanyWorkTrackingAction,
  type CompanyWorkTrackingHeadRecord,
} from "./companyWorkTrackingModels";

const MAX_TRACKING_CHANNELS = 4096;

function channelListKey(channelIds: readonly string[]) {
  return [...new Set(channelIds.map((id) => id.toLowerCase()))]
    .sort()
    .join(",");
}

const trackingHeadsKey = (relayUrl: string | null, channelIdsKey: string) =>
  ["company-work-tracking-heads", relayUrl, channelIdsKey] as const;

async function fetchCompanyWorkTrackingHeads(
  channelIds: readonly string[],
): Promise<CompanyWorkTrackingHeadRecord[]> {
  if (channelIds.length === 0) return [];
  if (channelIds.length > MAX_TRACKING_CHANNELS) {
    throw new Error("Too many conversation channels to load work tracking.");
  }
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COMPANY_WORK_TRACKING_HEAD],
    authors: [relaySelf],
    "#h": [...channelIds],
    limit: COMPANY_WORK_TRACKING_HEAD_QUERY_LIMIT + 1,
  });
  if (events.length > COMPANY_WORK_TRACKING_HEAD_QUERY_LIMIT) {
    throw new Error("Work tracking exceeds the supported read limit.");
  }
  const records: CompanyWorkTrackingHeadRecord[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    if (
      !dTag.startsWith("company:work-suggestion:") &&
      !dTag.startsWith("company:work-watchdog:")
    ) {
      continue;
    }
    const record = parseCompanyWorkTrackingHeadEvent(event, relaySelf);
    if (
      !record ||
      !channelIds.some((id) => id.toLowerCase() === record.channelId)
    ) {
      throw new Error(
        "The relay returned an invalid company work tracking head.",
      );
    }
    if (seen.has(record.dTag)) {
      throw new Error("The relay returned duplicate work tracking heads.");
    }
    seen.add(record.dTag);
    records.push(record);
  }
  return records;
}

export function useCompanyWorkTrackingHeadsQuery(enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const channelsQuery = useChannelsQuery({ enabled });
  const channelIds = React.useMemo(
    () =>
      (channelsQuery.data ?? [])
        .filter(
          (channel) =>
            channel.channelType === "stream" &&
            channel.isMember &&
            channel.archivedAt === null,
        )
        .map((channel) => channel.id.toLowerCase())
        .sort(),
    [channelsQuery.data],
  );
  const channelIdsKey = channelListKey(channelIds);
  const queryClient = useQueryClient();
  const key = React.useMemo(
    () => trackingHeadsKey(relayUrl, channelIdsKey),
    [channelIdsKey, relayUrl],
  );
  const query = useQuery({
    enabled: enabled && relayUrl !== null && channelsQuery.isSuccess,
    queryKey: key,
    queryFn: () => fetchCompanyWorkTrackingHeads(channelIds),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const scopeToken = `${relayUrl ?? "no-relay"}|${channelIdsKey}`;
  const currentScopeRef = React.useRef(scopeToken);
  currentScopeRef.current = scopeToken;
  const [liveError, setLiveError] = React.useState<{
    error: unknown;
    scopeToken: string;
  }>({ error: null, scopeToken: "" });

  React.useEffect(() => {
    let disposed = false;
    let unsubscribeLive: (() => void) | null = null;
    if (
      !enabled ||
      !relayUrl ||
      !channelsQuery.isSuccess ||
      channelIds.length === 0
    ) {
      setLiveError({ error: null, scopeToken });
      return;
    }
    setLiveError({ error: null, scopeToken });
    const unsubscribeReconnect = relayClient.subscribeToReconnects(() => {
      if (disposed || currentScopeRef.current !== scopeToken) return;
      void queryClient.invalidateQueries({ queryKey: key });
    });
    void subscribeToBusinessRecords({
      relay: relayClient,
      channelIds,
      kinds: [KIND_COMPANY_WORK_TRACKING_HEAD],
      isCurrentScope: () => !disposed && currentScopeRef.current === scopeToken,
      onEvent: () => {
        if (disposed || currentScopeRef.current !== scopeToken) return;
        void queryClient.invalidateQueries({ queryKey: key });
      },
    })
      .then((unsubscribe) => {
        if (disposed || currentScopeRef.current !== scopeToken) {
          unsubscribe();
          return;
        }
        unsubscribeLive = unsubscribe;
        void queryClient.invalidateQueries({ queryKey: key });
      })
      .catch((error: unknown) => {
        if (!disposed && currentScopeRef.current === scopeToken) {
          setLiveError({ error, scopeToken });
        }
      });
    return () => {
      disposed = true;
      unsubscribeReconnect();
      unsubscribeLive?.();
    };
  }, [
    channelIds,
    channelsQuery.isSuccess,
    enabled,
    key,
    queryClient,
    relayUrl,
    scopeToken,
  ]);

  return {
    ...query,
    channelsQuery,
    liveError: liveError.scopeToken === scopeToken ? liveError.error : null,
  };
}

async function fetchSuggestionAcceptances(
  channelId: string,
  workItemId: string,
): Promise<CompanyWorkSuggestionAcceptanceEntry[]> {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_COMPANY_WORK_TRACKING_ACTION],
    "#h": [channelId],
    limit: COMPANY_WORK_TRACKING_ACTION_QUERY_LIMIT + 1,
  });
  if (events.length > COMPANY_WORK_TRACKING_ACTION_QUERY_LIMIT) {
    throw new Error("Work tracking history exceeds the supported read limit.");
  }
  const acceptances: CompanyWorkSuggestionAcceptanceEntry[] = [];
  for (const event of events) {
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    if (!dTag.startsWith("company:work-suggestion:")) continue;
    let action: unknown;
    try {
      action = (JSON.parse(event.content) as { action?: unknown }).action;
    } catch {
      throw new Error("The relay returned an invalid work tracking action.");
    }
    if (action !== "accept") continue;
    const entry = parseCompanyWorkSuggestionAcceptanceEvent(
      event,
      channelId,
      workItemId,
    );
    if (!entry) {
      const content = JSON.parse(event.content) as {
        acceptedWorkItemId?: unknown;
      };
      if (
        typeof content.acceptedWorkItemId === "string" &&
        content.acceptedWorkItemId.toLowerCase() === workItemId.toLowerCase()
      ) {
        throw new Error("The relay returned an invalid suggestion acceptance.");
      }
      continue;
    }
    acceptances.push(entry);
  }
  return acceptances.sort(
    (left, right) =>
      right.event.created_at - left.event.created_at ||
      right.event.id.localeCompare(left.event.id),
  );
}

export function useCompanyWorkSuggestionAcceptancesQuery(
  channelId: string | null,
  workItemId: string | null,
  enabled = true,
) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled:
      enabled && relayUrl !== null && channelId !== null && workItemId !== null,
    queryKey: [
      "company-work-suggestion-acceptances",
      relayUrl,
      channelId?.toLowerCase() ?? "",
      workItemId?.toLowerCase() ?? "",
    ],
    queryFn: () =>
      fetchSuggestionAcceptances(channelId as string, workItemId as string),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useCompanyWorkTrackingActionMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async ({
      channelId,
      dTag,
      action,
    }: {
      channelId: string;
      dTag: string;
      action: CompanyWorkTrackingAction;
    }) => {
      const event = await signRelayEvent({
        kind: KIND_COMPANY_WORK_TRACKING_ACTION,
        content: JSON.stringify(action),
        tags: [
          ["h", channelId],
          ["d", dTag],
        ],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the work tracking change.",
        "Failed to save the work tracking change.",
      );
      return event;
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["company-work-tracking-heads", relayUrl],
        }),
        queryClient.invalidateQueries({
          queryKey: ["company-work-heads", relayUrl],
        }),
        queryClient.invalidateQueries({
          queryKey: ["company-work-history", relayUrl],
        }),
        queryClient.invalidateQueries({
          queryKey: ["company-work-suggestion-acceptances", relayUrl],
        }),
        queryClient.invalidateQueries({
          queryKey: ["company-work-move-references", relayUrl],
        }),
      ]);
    },
  });
}
