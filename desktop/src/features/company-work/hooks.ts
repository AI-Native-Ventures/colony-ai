import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { subscribeToBusinessRecords } from "@/features/clients/lib/businessRecordLive";
import { signRelayEvent } from "@/shared/api/tauri";
import { relayClient } from "@/shared/api/relayClient";
import {
  KIND_WORK_ITEM_ACTION,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";

import {
  COMPANY_WORK_HEAD_QUERY_LIMIT,
  COMPANY_WORK_HISTORY_QUERY_LIMIT,
  companyWorkDTag,
  parseCompanyWorkActionEvent,
  parseCompanyWorkHeadEvent,
  type CompanyWorkAction,
  type CompanyWorkHeadRecord,
  type CompanyWorkHistoryEntry,
} from "./companyWorkModels";

const companyWorkHeadsKey = (relayUrl: string | null, channelIdsKey: string) =>
  ["company-work-heads", relayUrl, channelIdsKey] as const;
const companyWorkMoveReferencesKey = (
  relayUrl: string | null,
  channelIdsKey: string,
) => ["company-work-move-references", relayUrl, channelIdsKey] as const;

export type CompanyWorkMoveReference = {
  workItemId: string;
  fromRootId: string | null;
  toRootId: string | null;
  eventId: string;
  actorPubkey: string;
};

export const companyWorkHistoryKey = (
  relayUrl: string | null,
  channelIdsKey: string,
  workItemId: string,
) => ["company-work-history", relayUrl, channelIdsKey, workItemId] as const;

function channelListKey(channelIds: readonly string[]) {
  return [...new Set(channelIds.map((id) => id.toLowerCase()))]
    .sort()
    .join(",");
}

async function fetchCompanyWorkHeads(
  channelIds: readonly string[],
): Promise<CompanyWorkHeadRecord[]> {
  if (channelIds.length === 0) return [];
  if (channelIds.length > 4096) {
    throw new Error("Too many conversation channels to load company work.");
  }
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_WORK_ITEM_HEAD],
    authors: [relaySelf],
    "#h": [...channelIds],
    limit: COMPANY_WORK_HEAD_QUERY_LIMIT + 1,
  });
  if (events.length > COMPANY_WORK_HEAD_QUERY_LIMIT) {
    throw new Error("The company work list exceeds the supported read limit.");
  }
  const records: CompanyWorkHeadRecord[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    if (!dTag.startsWith("company:work:")) continue;
    const record = parseCompanyWorkHeadEvent(event, relaySelf);
    if (!record) {
      throw new Error(
        "The relay returned an invalid signed company work item.",
      );
    }
    if (!channelIds.includes(record.channelId)) {
      throw new Error(
        "The relay returned company work outside its channel scope.",
      );
    }
    if (seen.has(record.head.workItemId)) {
      throw new Error("The relay returned duplicate company work item heads.");
    }
    seen.add(record.head.workItemId);
    records.push(record);
  }
  return records;
}

async function fetchCompanyWorkHistory(
  channelIds: readonly string[],
  workItemId: string,
): Promise<CompanyWorkHistoryEntry[]> {
  if (channelIds.length === 0) return [];
  if (channelIds.length > 4096) {
    throw new Error("Too many conversation channels to load work history.");
  }
  const dTag = companyWorkDTag(workItemId);
  const events = await relayClient.fetchEvents({
    kinds: [KIND_WORK_ITEM_ACTION],
    "#h": [...channelIds],
    "#d": [dTag],
    limit: COMPANY_WORK_HISTORY_QUERY_LIMIT + 1,
  });
  if (events.length > COMPANY_WORK_HISTORY_QUERY_LIMIT) {
    throw new Error(
      "The company work history exceeds the supported read limit.",
    );
  }
  const history = events.map((event) => {
    const entry = parseCompanyWorkActionEvent(event, channelIds, workItemId);
    if (!entry) {
      throw new Error("The relay returned an invalid company work action.");
    }
    return entry;
  });
  return history.sort(
    (left, right) => right.event.created_at - left.event.created_at,
  );
}

async function fetchCompanyWorkMoveReferences(
  channelIds: readonly string[],
): Promise<CompanyWorkMoveReference[]> {
  if (channelIds.length === 0) return [];
  if (channelIds.length > 4096) {
    throw new Error("Too many conversation channels to load work history.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_WORK_ITEM_ACTION],
    "#h": [...channelIds],
    limit: COMPANY_WORK_HISTORY_QUERY_LIMIT * 10 + 1,
  });
  if (events.length > COMPANY_WORK_HISTORY_QUERY_LIMIT * 10) {
    throw new Error(
      "Company work history exceeds the supported move-reference limit.",
    );
  }

  const histories = new Map<string, CompanyWorkHistoryEntry[]>();
  for (const event of events) {
    const dTag = event.tags.find((tag) => tag[0] === "d")?.[1] ?? "";
    const match = /^company:work:([0-9a-f-]{36})$/i.exec(dTag);
    if (!match) continue;
    const workItemId = match[1].toLowerCase();
    const entry = parseCompanyWorkActionEvent(event, channelIds, workItemId);
    if (!entry) {
      throw new Error("The relay returned an invalid company work action.");
    }
    const history = histories.get(workItemId) ?? [];
    history.push(entry);
    histories.set(workItemId, history);
  }

  const references: CompanyWorkMoveReference[] = [];
  for (const [workItemId, history] of histories) {
    history.sort(
      (left, right) =>
        left.event.created_at - right.event.created_at ||
        left.event.id.localeCompare(right.event.id),
    );
    let previousRootId: string | null = null;
    for (const entry of history) {
      if (entry.action.action === "create") {
        previousRootId =
          entry.action.head?.threadRootEventId?.toLowerCase() ?? null;
      } else if (entry.action.action === "update") {
        const nextRootId =
          entry.action.head?.threadRootEventId?.toLowerCase() ?? null;
        if (previousRootId !== nextRootId) {
          references.push({
            workItemId,
            fromRootId: previousRootId,
            toRootId: nextRootId,
            eventId: entry.event.id,
            actorPubkey: entry.event.pubkey,
          });
        }
        previousRootId = nextRootId;
      }
    }
  }
  return references;
}

export function useCompanyWorkHeadsQuery(enabled = true) {
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
  const headsQuery = useQuery({
    enabled: enabled && relayUrl !== null && channelsQuery.isSuccess,
    queryKey: companyWorkHeadsKey(relayUrl, channelIdsKey),
    queryFn: () => fetchCompanyWorkHeads(channelIds),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const scopeToken = `${relayUrl ?? "no-relay"}|${channelIdsKey}`;
  const currentScopeRef = React.useRef(scopeToken);
  currentScopeRef.current = scopeToken;
  const [liveState, setLiveState] = React.useState<{
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
      setLiveState({ error: null, scopeToken });
      return;
    }
    setLiveState({ error: null, scopeToken });
    const key = companyWorkHeadsKey(relayUrl, channelIdsKey);
    const unsubscribeReconnect = relayClient.subscribeToReconnects(() => {
      if (disposed || currentScopeRef.current !== scopeToken) return;
      void queryClient.invalidateQueries({ queryKey: key });
    });
    void subscribeToBusinessRecords({
      relay: relayClient,
      channelIds,
      kinds: [KIND_WORK_ITEM_HEAD],
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
        setLiveState({ error: null, scopeToken });
        void queryClient.invalidateQueries({ queryKey: key });
      })
      .catch((error: unknown) => {
        if (!disposed && currentScopeRef.current === scopeToken) {
          setLiveState({ error, scopeToken });
        }
      });

    return () => {
      disposed = true;
      unsubscribeReconnect();
      unsubscribeLive?.();
    };
  }, [
    channelIds,
    channelIdsKey,
    channelsQuery.isSuccess,
    enabled,
    queryClient,
    relayUrl,
    scopeToken,
  ]);

  return {
    ...headsQuery,
    channelsQuery,
    liveError: liveState.scopeToken === scopeToken ? liveState.error : null,
  };
}

export function useCompanyWorkHistoryQuery(
  channelId: string | null,
  workItemId: string | null,
  enabled = true,
) {
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
  return useQuery({
    enabled:
      enabled &&
      relayUrl !== null &&
      channelsQuery.isSuccess &&
      channelId !== null &&
      channelIds.includes(channelId.toLowerCase()) &&
      workItemId !== null,
    queryKey: companyWorkHistoryKey(relayUrl, channelIdsKey, workItemId ?? ""),
    queryFn: () => fetchCompanyWorkHistory(channelIds, workItemId as string),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useCompanyWorkMoveReferencesQuery(enabled = true) {
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
  return useQuery({
    enabled:
      enabled &&
      relayUrl !== null &&
      channelsQuery.isSuccess &&
      channelIds.length > 0,
    queryKey: companyWorkMoveReferencesKey(relayUrl, channelIdsKey),
    queryFn: () => fetchCompanyWorkMoveReferences(channelIds),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useCompanyWorkActionMutation() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const channelsQuery = useChannelsQuery();
  const channelIdsKey = channelListKey(
    (channelsQuery.data ?? [])
      .filter(
        (channel) =>
          channel.channelType === "stream" &&
          channel.isMember &&
          channel.archivedAt === null,
      )
      .map((channel) => channel.id),
  );

  return useMutation({
    mutationFn: async ({
      channelId,
      action,
    }: {
      channelId: string;
      action: CompanyWorkAction;
    }) => {
      const event = await signRelayEvent({
        kind: KIND_WORK_ITEM_ACTION,
        content: JSON.stringify(action),
        tags: [
          ["h", channelId],
          ["d", companyWorkDTag(action.workItemId)],
        ],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the company work item.",
        "Failed to save the company work item.",
      );
      return event;
    },
    onSettled: async (_data, _error, _variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: companyWorkHeadsKey(relayUrl, channelIdsKey),
        }),
        queryClient.invalidateQueries({
          queryKey: ["company-work-history", relayUrl],
        }),
        queryClient.invalidateQueries({
          queryKey: companyWorkMoveReferencesKey(relayUrl, channelIdsKey),
        }),
        queryClient.invalidateQueries({
          queryKey: ["company-goals", relayUrl],
        }),
      ]);
    },
  });
}
