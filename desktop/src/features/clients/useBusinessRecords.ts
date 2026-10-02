import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useChannelsQuery } from "@/features/channels/hooks";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  KIND_CLIENT_HEAD,
  KIND_DELIVERABLE_APPROVAL,
  KIND_DELIVERABLE_VERSION,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";
import {
  moneyRecordService,
  MONEY_RECORD_KINDS,
  type MoneyWorkspaceRecords,
} from "@/features/money/lib/moneyRecords";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import type { Channel, RelayEvent } from "@/shared/api/types";

import {
  BusinessRecordParseError,
  businessRecordService,
  type BusinessEventTemplate,
  type EventRecord,
  type WorkItemHead,
} from "./lib/businessRecords";
import { subscribeToBusinessRecords } from "./lib/businessRecordLive";

const BUSINESS_RECORD_QUERY_FAMILY = "business-records";

function businessRecordScope(relayUrl: string | null, pubkey: string | null) {
  return [
    BUSINESS_RECORD_QUERY_FAMILY,
    relayUrl ?? "no-relay",
    pubkey ?? "no-identity",
  ] as const;
}

function channelListKey(channelIds: readonly string[]) {
  return [...new Set(channelIds.map((id) => id.toLowerCase()))]
    .sort()
    .join(",");
}

export function isClientRecordChannel(channel: Channel): boolean {
  return (
    channel.channelType === "stream" &&
    channel.visibility === "private" &&
    channel.isMember
  );
}

function useBusinessRecordLiveScope(
  channelIds: readonly string[],
  kinds: readonly number[],
  scopeEnabled: boolean,
  relayUrl: string | null,
  pubkey: string | null,
) {
  const queryClient = useQueryClient();
  const channelKey = channelListKey(channelIds);
  const kindsKey = [...new Set(kinds)]
    .sort((left, right) => left - right)
    .join(",");
  const scopeToken = [
    relayUrl ?? "no-relay",
    pubkey ?? "no-identity",
    channelKey,
    kindsKey,
  ].join("|");
  const currentScopeRef = React.useRef(scopeToken);
  currentScopeRef.current = scopeToken;
  const [liveState, setLiveState] = React.useState<{
    error: unknown;
    ready: boolean;
    scopeToken: string;
  }>({ error: null, ready: false, scopeToken: "" });

  React.useEffect(() => {
    let disposed = false;
    let unsubscribeLive: (() => void) | null = null;
    const channelIdsForEffect = channelKey ? channelKey.split(",") : [];
    const kindsForEffect = kindsKey
      ? kindsKey.split(",").map((kind) => Number(kind))
      : [];
    if (!scopeEnabled || !relayUrl || !pubkey) {
      setLiveState({ error: null, ready: false, scopeToken });
      return;
    }

    setLiveState({ error: null, ready: false, scopeToken });
    const family = businessRecordScope(relayUrl, pubkey);
    const invalidate = () => {
      if (disposed || currentScopeRef.current !== scopeToken) return;
      void queryClient.invalidateQueries({ queryKey: family });
    };
    const unsubscribeReconnect = relayClient.subscribeToReconnects(invalidate);

    void subscribeToBusinessRecords({
      relay: relayClient,
      channelIds: channelIdsForEffect,
      kinds: kindsForEffect,
      isCurrentScope: () => !disposed && currentScopeRef.current === scopeToken,
      onEvent: invalidate,
    })
      .then((unsubscribe) => {
        if (disposed || currentScopeRef.current !== scopeToken) {
          unsubscribe();
          return;
        }
        unsubscribeLive = unsubscribe;
        setLiveState({ error: null, ready: true, scopeToken });
      })
      .catch((error: unknown) => {
        if (!disposed && currentScopeRef.current === scopeToken) {
          setLiveState({ error, ready: false, scopeToken });
        }
      });

    return () => {
      disposed = true;
      unsubscribeReconnect();
      unsubscribeLive?.();
    };
  }, [
    channelKey,
    kindsKey,
    pubkey,
    queryClient,
    relayUrl,
    scopeEnabled,
    scopeToken,
  ]);

  return {
    error: liveState.scopeToken === scopeToken ? liveState.error : null,
    ready: liveState.scopeToken === scopeToken && liveState.ready,
  };
}

function useRecordContext() {
  const { activeCommunity } = useCommunities();
  const identityQuery = useIdentityQuery();
  const channelsQuery = useChannelsQuery();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const pubkey = identityQuery.data?.pubkey.toLowerCase() ?? null;
  const clientChannels = React.useMemo(
    () => (channelsQuery.data ?? []).filter(isClientRecordChannel),
    [channelsQuery.data],
  );
  return {
    channelsQuery,
    clientChannels,
    identityQuery,
    pubkey,
    relayUrl,
    scopeEnabled:
      channelsQuery.isSuccess &&
      identityQuery.isSuccess &&
      Boolean(relayUrl && pubkey),
  };
}

export function clientDirectoryQueryKey(
  relayUrl: string | null,
  pubkey: string | null,
  channelIds: readonly string[],
) {
  return [
    ...businessRecordScope(relayUrl, pubkey),
    "client-directory",
    channelListKey(channelIds),
  ] as const;
}

export function useClientDirectoryQuery() {
  const { channelsQuery, clientChannels, pubkey, relayUrl, scopeEnabled } =
    useRecordContext();
  const channelIds = React.useMemo(
    () => clientChannels.map((channel) => channel.id.toLowerCase()).sort(),
    [clientChannels],
  );
  const live = useBusinessRecordLiveScope(
    channelIds,
    [KIND_CLIENT_HEAD],
    scopeEnabled,
    relayUrl,
    pubkey,
  );
  const query = useQuery({
    queryKey: clientDirectoryQueryKey(relayUrl, pubkey, channelIds),
    enabled: scopeEnabled && live.ready,
    queryFn: () => businessRecordService.listClientHeads(channelIds),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  return {
    ...query,
    channelsQuery,
    clientChannels,
    liveError: live.error,
  };
}

export function moneyRecordsQueryKey(
  relayUrl: string | null,
  pubkey: string | null,
  channelIds: readonly string[],
) {
  return [
    ...businessRecordScope(relayUrl, pubkey),
    "money-records",
    channelListKey(channelIds),
  ] as const;
}

export function useMoneyRecordsQuery(enabled = true) {
  const directoryQuery = useClientDirectoryQuery();
  const { pubkey, relayUrl } = useRecordContext();
  const channelIds = React.useMemo(
    () =>
      (directoryQuery.data ?? []).map((record) => record.value.clientId).sort(),
    [directoryQuery.data],
  );
  const scopeEnabled =
    enabled && directoryQuery.isSuccess && Boolean(pubkey && relayUrl);
  const live = useBusinessRecordLiveScope(
    channelIds,
    MONEY_RECORD_KINDS,
    scopeEnabled,
    relayUrl,
    pubkey,
  );
  const query = useQuery<MoneyWorkspaceRecords>({
    queryKey: moneyRecordsQueryKey(relayUrl, pubkey, channelIds),
    enabled: scopeEnabled && live.ready,
    queryFn: () => moneyRecordService.list(channelIds),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return {
    ...query,
    directoryQuery,
    liveError: live.error,
    liveReady: live.ready,
  };
}

export function clientRecordQueryKey(
  relayUrl: string | null,
  pubkey: string | null,
  clientId: string | null,
  family: "client" | "work-items" | "deliverables" | "members",
) {
  return [
    ...businessRecordScope(relayUrl, pubkey),
    family,
    clientId?.toLowerCase() ?? "no-client",
  ] as const;
}

export function useClientRecordsQuery(clientId: string | null, enabled = true) {
  const { channelsQuery, clientChannels, pubkey, relayUrl, scopeEnabled } =
    useRecordContext();
  const normalizedClientId = clientId?.toLowerCase() ?? null;
  const channel = React.useMemo(
    () =>
      normalizedClientId
        ? (clientChannels.find(
            (candidate) => candidate.id.toLowerCase() === normalizedClientId,
          ) ?? null)
        : null,
    [clientChannels, normalizedClientId],
  );
  const validChannel = Boolean(
    channel && channel.id.toLowerCase() === normalizedClientId,
  );
  const channelIds = React.useMemo(
    () => (validChannel && normalizedClientId ? [normalizedClientId] : []),
    [normalizedClientId, validChannel],
  );
  const live = useBusinessRecordLiveScope(
    channelIds,
    [
      KIND_CLIENT_HEAD,
      KIND_WORK_ITEM_HEAD,
      KIND_DELIVERABLE_VERSION,
      KIND_DELIVERABLE_APPROVAL,
    ],
    scopeEnabled && validChannel && enabled,
    relayUrl,
    pubkey,
  );
  const clientQuery = useQuery({
    queryKey: clientRecordQueryKey(
      relayUrl,
      pubkey,
      normalizedClientId,
      "client",
    ),
    enabled: scopeEnabled && validChannel && enabled && live.ready,
    queryFn: async () => {
      if (!normalizedClientId)
        throw new Error("No client channel was selected");
      const record =
        await businessRecordService.getClientHead(normalizedClientId);
      if (record && record.value.clientId !== normalizedClientId) {
        throw new BusinessRecordParseError(
          "Client query returned another client",
        );
      }
      return record;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const workItemsQuery = useQuery({
    queryKey: clientRecordQueryKey(
      relayUrl,
      pubkey,
      normalizedClientId,
      "work-items",
    ),
    enabled:
      scopeEnabled &&
      validChannel &&
      enabled &&
      live.ready &&
      clientQuery.isSuccess &&
      Boolean(clientQuery.data),
    queryFn: () => {
      if (!normalizedClientId)
        throw new Error("No client channel was selected");
      return businessRecordService.listWorkItemHeads(normalizedClientId);
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const membersQuery = useChannelMembersQuery(
    validChannel ? (channel?.id ?? null) : null,
    scopeEnabled &&
      enabled &&
      validChannel &&
      clientQuery.isSuccess &&
      Boolean(clientQuery.data),
  );

  return {
    channel,
    channelsQuery,
    clientQuery,
    liveError: live.error,
    liveReady: live.ready,
    membersQuery,
    workItemsQuery,
  };
}

export function useClientDeliverableEventsQuery(
  clientId: string | null,
  workItemId: string | null,
  enabled = true,
) {
  const { clientChannels, pubkey, relayUrl, scopeEnabled } = useRecordContext();
  const normalizedClientId = clientId?.toLowerCase() ?? null;
  const normalizedWorkItemId = workItemId?.toLowerCase() ?? null;
  const hasClientChannel = clientChannels.some(
    (channel) => channel.id.toLowerCase() === normalizedClientId,
  );
  return useQuery({
    queryKey: [
      ...businessRecordScope(relayUrl, pubkey),
      "deliverables",
      normalizedClientId ?? "no-client",
      normalizedWorkItemId ?? "no-work-item",
    ] as const,
    enabled:
      scopeEnabled &&
      enabled &&
      hasClientChannel &&
      Boolean(normalizedClientId && normalizedWorkItemId),
    queryFn: () => {
      if (!normalizedClientId || !normalizedWorkItemId) {
        throw new Error("Client and work record coordinates are required");
      }
      return businessRecordService.listDeliverableEvents(
        normalizedClientId,
        normalizedWorkItemId,
      );
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useAllWorkItemHeadsQuery(enabled = true) {
  const directoryQuery = useClientDirectoryQuery();
  const { pubkey, relayUrl } = useRecordContext();
  const channelIds = React.useMemo(
    () =>
      (directoryQuery.data ?? []).map((record) => record.value.clientId).sort(),
    [directoryQuery.data],
  );
  const live = useBusinessRecordLiveScope(
    channelIds,
    [KIND_WORK_ITEM_HEAD],
    enabled && directoryQuery.isSuccess && Boolean(pubkey && relayUrl),
    relayUrl,
    pubkey,
  );
  const query = useQuery({
    queryKey: [
      ...businessRecordScope(relayUrl, pubkey),
      "shared-work-list",
      channelListKey(channelIds),
    ] as const,
    enabled: enabled && directoryQuery.isSuccess && live.ready,
    queryFn: () =>
      businessRecordService.listWorkItemHeadsForChannels(channelIds),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return { ...query, directoryQuery, liveError: live.error };
}

export function useSubmitBusinessRecordMutation() {
  const queryClient = useQueryClient();
  const { pubkey, relayUrl } = useRecordContext();
  const pendingEventRef = React.useRef<{
    fingerprint: string;
    event: RelayEvent;
  } | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: BusinessEventTemplate | RelayEvent) => {
      if ("id" in input) {
        return {
          event: input,
          accepted: await businessRecordService.publish(input),
        };
      }
      const fingerprint = JSON.stringify([
        input.kind,
        input.tags,
        input.content,
      ]);
      if (
        pendingEventRef.current &&
        pendingEventRef.current.fingerprint !== fingerprint
      ) {
        throw new Error(
          "A previous business update is awaiting confirmation. Retry that update before changing it.",
        );
      }
      const event =
        pendingEventRef.current?.event ??
        (await businessRecordService.sign(input));
      pendingEventRef.current = { fingerprint, event };
      const accepted = await businessRecordService.publish(event);
      return { event, accepted };
    },
    onSuccess: ({ event }, input) => {
      if ("id" in input && pendingEventRef.current?.event.id === event.id) {
        pendingEventRef.current = null;
      } else if (
        !("id" in input) &&
        pendingEventRef.current?.event.id === event.id
      ) {
        pendingEventRef.current = null;
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: businessRecordScope(relayUrl, pubkey),
      });
    },
  });
  const discardPending = React.useCallback(() => {
    pendingEventRef.current = null;
    mutation.reset();
  }, [mutation.reset]);
  return { ...mutation, discardPending };
}

export function findUniqueWorkItem(
  records: readonly EventRecord<WorkItemHead>[],
  workItemId: string,
  expectedClientId: string | null,
): EventRecord<WorkItemHead> | null {
  const normalizedId = workItemId.toLowerCase();
  const matching = records.filter(
    (record) =>
      record.value.workItemId === normalizedId &&
      (!expectedClientId ||
        record.value.clientId === expectedClientId.toLowerCase()),
  );
  if (matching.length > 1) {
    throw new BusinessRecordParseError(
      "Work item id resolves to more than one client record",
    );
  }
  return matching[0] ?? null;
}
