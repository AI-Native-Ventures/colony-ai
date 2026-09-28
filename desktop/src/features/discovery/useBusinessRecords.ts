import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useChannelsQuery } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import { BUSINESS_RECORD_QUERY_KINDS } from "./businessRecordContract";
import {
  loadBusinessRecords,
  resolveBusinessChannel,
  type BusinessRecords,
} from "./businessRecordRelay";

const BUSINESS_CHANNEL_STALE_MS = 30_000;

export function useBusinessRecords() {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const activeCommunityId = activeCommunity?.id ?? null;
  const activeCommunityRelayUrl = activeCommunity?.relayUrl ?? null;
  const identity = useIdentityQuery();
  const channels = useChannelsQuery({ enabled: Boolean(activeCommunity) });
  const channelQuery = useQuery({
    queryKey: [
      "w10-business-channel",
      activeCommunityRelayUrl ?? "unavailable",
      activeCommunityId ?? "unavailable",
    ],
    enabled: channels.isSuccess && Boolean(activeCommunity),
    staleTime: BUSINESS_CHANNEL_STALE_MS,
    queryFn: () => resolveBusinessChannel(channels.data ?? []),
  });
  const channelId = channelQuery.data ?? null;
  const pubkey = identity.data?.pubkey ?? null;
  const recordsKey = React.useMemo(
    () => [
      "w10-business-records",
      activeCommunityRelayUrl ?? "unavailable",
      activeCommunityId ?? "unavailable",
      pubkey ?? "unavailable",
      channelId ?? "unavailable",
    ],
    [activeCommunityId, activeCommunityRelayUrl, channelId, pubkey],
  );
  const recordsQuery = useQuery<BusinessRecords>({
    queryKey: recordsKey,
    enabled: Boolean(channelId && pubkey),
    staleTime: BUSINESS_CHANNEL_STALE_MS,
    queryFn: () => {
      if (!channelId || !pubkey) {
        throw new Error("Business records are not available yet.");
      }
      return loadBusinessRecords(channelId, pubkey);
    },
  });
  React.useEffect(() => {
    if (!channelId || !activeCommunityId) return;
    let disposed = false;
    let dispose: (() => Promise<void>) | null = null;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: recordsKey });
    };
    void relayClient
      .subscribeLive(
        {
          kinds: [...BUSINESS_RECORD_QUERY_KINDS],
          limit: 0,
          "#h": [channelId],
        },
        invalidate,
        (readiness) => {
          if (readiness === "eose") invalidate();
        },
      )
      .then((unsubscribe) => {
        if (disposed) {
          void unsubscribe();
        } else {
          dispose = unsubscribe;
        }
      })
      .catch((error: unknown) => {
        console.error("Could not subscribe to W10 business records", error);
      });
    const stopReconnects = relayClient.subscribeToReconnects(invalidate);
    return () => {
      disposed = true;
      stopReconnects();
      if (dispose) void dispose();
    };
  }, [activeCommunityId, channelId, queryClient, recordsKey]);

  const refresh = React.useCallback(async () => {
    if (!channelId) {
      await channelQuery.refetch();
      return;
    }
    await queryClient.invalidateQueries({ queryKey: recordsKey });
    await recordsQuery.refetch();
  }, [channelId, channelQuery, queryClient, recordsKey, recordsQuery]);

  return {
    communityId: activeCommunityId,
    channelId,
    channelLoading:
      Boolean(activeCommunity) &&
      (channels.isPending ||
        (channels.isSuccess && channelQuery.isPending) ||
        identity.isPending),
    needsBusinessChannel: channelQuery.isSuccess && channelId === null,
    channelError: channelQuery.error ?? channels.error ?? identity.error,
    records: recordsQuery.data ?? null,
    recordsLoading: recordsQuery.isPending,
    recordsError: recordsQuery.error,
    role: recordsQuery.data?.role ?? null,
    pubkey,
    refresh,
  };
}
