import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { KIND_ASK_HEAD } from "@/shared/constants/kinds";
import { relayClient } from "@/shared/api/relayClient";
import { useRelaySelfQuery } from "@/features/moderation/hooks";
import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";
import {
  askHeadQueryKey,
  askHeadsQueryKey,
  decodeRelayAskHead,
  fetchCompanyToolConsentAskHead,
  fetchAskHead,
  fetchAskHeads,
  fetchCompanyToolConsentAskHeads,
  splitChannelIds,
} from "./askRecords";

export const ASK_HEAD_REFETCH_INTERVAL_MS = 30_000;

export function useAskHeadQuery(
  channelId: string | null,
  askId: string | null,
  enabled = true,
  companyToolConsentInbox = false,
) {
  const relaySelfQuery = useRelaySelfQuery(
    enabled && channelId !== null && askId !== null,
  );
  const relaySelfPubkey = relaySelfQuery.data ?? null;
  const queryClient = useQueryClient();
  const queryKey = React.useMemo(
    () =>
      askHeadQueryKey(
        channelId ?? "",
        askId ?? "",
        relaySelfPubkey,
        companyToolConsentInbox,
      ),
    [askId, channelId, companyToolConsentInbox, relaySelfPubkey],
  );
  const refetchInterval = useFocusedRefetchInterval(
    ASK_HEAD_REFETCH_INTERVAL_MS,
  );
  const query = useQuery({
    queryKey,
    queryFn: () => {
      if (!channelId || !askId || !relaySelfPubkey) {
        throw new Error("The ask coordinates are unavailable.");
      }
      return companyToolConsentInbox
        ? fetchCompanyToolConsentAskHead(channelId, askId, relaySelfPubkey)
        : fetchAskHead(channelId, askId, relaySelfPubkey);
    },
    enabled:
      enabled &&
      channelId !== null &&
      askId !== null &&
      relaySelfPubkey !== null,
    refetchInterval,
  });
  const [liveState, setLiveState] = React.useState<
    "connecting" | "live" | "unavailable"
  >("connecting");

  React.useEffect(() => {
    if (
      !enabled ||
      !channelId ||
      !askId ||
      !relaySelfPubkey ||
      companyToolConsentInbox
    ) {
      setLiveState("unavailable");
      return;
    }
    let active = true;
    let dispose: (() => Promise<void>) | null = null;
    setLiveState("connecting");
    void relayClient
      .subscribeLive(
        {
          kinds: [KIND_ASK_HEAD],
          "#h": [channelId],
          "#d": [`channel:${channelId}:ask:${askId}`],
          limit: 10,
        },
        (event) => {
          const record = decodeRelayAskHead(event, relaySelfPubkey, channelId);
          if (!record || record.head.askId !== askId) return;
          void queryClient.invalidateQueries({ queryKey });
        },
        (readiness) => {
          if (active)
            setLiveState(readiness === "eose" ? "live" : "unavailable");
        },
        5_000,
        () => {
          if (active) setLiveState("unavailable");
        },
      )
      .then((unsubscribe) => {
        if (active) dispose = unsubscribe;
        else void unsubscribe();
      })
      .catch(() => {
        if (active) setLiveState("unavailable");
      });
    return () => {
      active = false;
      if (dispose) void dispose();
    };
  }, [
    askId,
    channelId,
    companyToolConsentInbox,
    enabled,
    queryClient,
    queryKey,
    relaySelfPubkey,
  ]);

  return { query, relaySelfQuery, liveState };
}

export type AskHeadQueryState = ReturnType<typeof useAskHeadQuery>;

export function useAskHeadsQuery(
  channelIds: readonly string[],
  includeCompanyToolConsent = false,
) {
  const relaySelfQuery = useRelaySelfQuery(
    channelIds.length > 0 || includeCompanyToolConsent,
  );
  const relaySelfPubkey = relaySelfQuery.data ?? null;
  const queryClient = useQueryClient();
  const channelIdsKey = [...new Set(channelIds)].sort().join(",");
  const normalizedChannelIds = React.useMemo(
    () => (channelIdsKey ? channelIdsKey.split(",") : []),
    [channelIdsKey],
  );
  const queryKey = React.useMemo(
    () =>
      askHeadsQueryKey(
        normalizedChannelIds,
        relaySelfPubkey,
        includeCompanyToolConsent,
      ),
    [includeCompanyToolConsent, normalizedChannelIds, relaySelfPubkey],
  );
  const refetchInterval = useFocusedRefetchInterval(
    ASK_HEAD_REFETCH_INTERVAL_MS,
  );
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (normalizedChannelIds.length === 0 && !includeCompanyToolConsent) {
        return [];
      }
      if (!relaySelfPubkey) {
        throw new Error("The relay identity is unavailable.");
      }
      const [channelRecords, companyToolConsentRecords] = await Promise.all([
        fetchAskHeads(normalizedChannelIds, relaySelfPubkey),
        includeCompanyToolConsent
          ? fetchCompanyToolConsentAskHeads(relaySelfPubkey)
          : Promise.resolve([]),
      ]);
      const byCoordinate = new Map<string, (typeof channelRecords)[number]>();
      for (const record of [...channelRecords, ...companyToolConsentRecords]) {
        const key = `${record.channelId}:${record.head.askId}`;
        const current = byCoordinate.get(key);
        if (
          !current ||
          current.event.created_at < record.event.created_at ||
          (current.event.created_at === record.event.created_at &&
            current.event.id.localeCompare(record.event.id) > 0)
        ) {
          byCoordinate.set(key, record);
        }
      }
      return [...byCoordinate.values()];
    },
    enabled:
      normalizedChannelIds.length === 0 && !includeCompanyToolConsent
        ? true
        : relaySelfPubkey !== null,
    initialData:
      normalizedChannelIds.length === 0 && !includeCompanyToolConsent
        ? []
        : undefined,
    refetchInterval,
  });

  React.useEffect(() => {
    if (normalizedChannelIds.length === 0 || !relaySelfPubkey) return;
    let active = true;
    const disposers = new Set<() => Promise<void>>();
    let nextChunk = 0;
    const chunks = splitChannelIds(normalizedChannelIds);
    const subscribeNext = async () => {
      while (active && nextChunk < chunks.length) {
        const chunk = chunks[nextChunk++];
        try {
          const unsubscribe = await relayClient.subscribeLive(
            { kinds: [KIND_ASK_HEAD], "#h": chunk, limit: 500 },
            (event) => {
              if (!decodeRelayAskHead(event, relaySelfPubkey)) return;
              void queryClient.invalidateQueries({ queryKey });
            },
            undefined,
            5_000,
          );
          if (active) disposers.add(unsubscribe);
          else void unsubscribe();
        } catch {
          // The query still refetches on the foreground cadence. A failed live
          // subscription must not turn a verified history result into empty data.
        }
      }
    };
    const workers = Array.from({ length: Math.min(4, chunks.length) }, () =>
      subscribeNext(),
    );
    void Promise.all(workers);
    return () => {
      active = false;
      for (const unsubscribe of disposers) void unsubscribe();
      disposers.clear();
    };
  }, [normalizedChannelIds, queryClient, queryKey, relaySelfPubkey]);

  return { query, relaySelfQuery };
}
