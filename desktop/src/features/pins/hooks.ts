import * as React from "react";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { subscribeToBusinessRecords } from "@/features/clients/lib/businessRecordLive";
import { relayClient } from "@/shared/api/relayClient";
import { KIND_STREAM_MESSAGE_PINNED } from "@/shared/constants/kinds";

import type { ChannelPin, ChannelPinsResult, PinTarget } from "./pinModels";
import { fetchChannelPins, publishPin, removePins } from "./pinRelay";

export const channelPinsKey = (channelId: string) =>
  ["channel-pins", channelId.toLowerCase()] as const;

/**
 * The channel's pins, kept fresh: the query refetches on focus and reconnect and
 * a live subscription invalidates it when anyone pins or unpins. The query
 * cache is created per community, so nothing here outlives a community switch.
 */
export function useChannelPinsQuery(channelId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    enabled: enabled && channelId !== null,
    queryKey: channelPinsKey(channelId ?? "none"),
    queryFn: () => fetchChannelPins(channelId as string),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  React.useEffect(() => {
    if (!enabled || channelId === null) return;
    let disposed = false;
    let unsubscribeLive: (() => void) | null = null;
    const invalidate = () => {
      if (disposed) return;
      void queryClient.invalidateQueries({
        queryKey: channelPinsKey(channelId),
      });
    };
    const unsubscribeReconnect = relayClient.subscribeToReconnects(invalidate);
    void subscribeToBusinessRecords({
      relay: relayClient,
      channelIds: [channelId],
      kinds: [KIND_STREAM_MESSAGE_PINNED],
      isCurrentScope: () => !disposed,
      onEvent: invalidate,
    })
      .then((unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        unsubscribeLive = unsubscribe;
        // Close the gap between the first read and the subscription starting.
        invalidate();
      })
      .catch((error: unknown) => {
        // Pins still load on focus and reconnect; log the cause for support.
        console.warn(
          "[pins] live updates unavailable",
          error instanceof Error ? error.message : String(error),
        );
      });
    return () => {
      disposed = true;
      unsubscribeReconnect();
      unsubscribeLive?.();
    };
  }, [channelId, enabled, queryClient]);

  return query;
}

/** What a pin needs from a message to be shown before the relay confirms it. */
export type PinnableMessage = {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
};

function withOptimisticPin(
  current: ChannelPinsResult | undefined,
  message: PinnableMessage,
  pinnedBy: string,
): ChannelPinsResult {
  const now = Math.floor(Date.now() / 1000);
  const target: PinTarget = {
    state: "message",
    id: message.id.toLowerCase(),
    author: message.pubkey.toLowerCase(),
    content: message.content,
    createdAt: message.createdAt,
  };
  const pin: ChannelPin = {
    targetId: message.id.toLowerCase(),
    pins: [
      {
        pinEventId: `pending:${message.id.toLowerCase()}`,
        targetId: message.id.toLowerCase(),
        pinnedBy: pinnedBy.toLowerCase(),
        pinnedAt: now,
      },
    ],
    pinnedAt: now,
    pinnedBy: pinnedBy.toLowerCase(),
    target,
  };
  return {
    truncated: current?.truncated ?? false,
    pins: [
      pin,
      ...(current?.pins ?? []).filter(
        (existing) => existing.targetId !== pin.targetId,
      ),
    ],
  };
}

function snapshot(queryClient: QueryClient, channelId: string) {
  return queryClient.getQueryData<ChannelPinsResult>(channelPinsKey(channelId));
}

/**
 * Pin a message. Optimistic: the pin shows at once and is rolled back, with the
 * error surfaced to the caller, if the relay refuses it. Either way the cache is
 * refetched afterwards, so what stays on screen is what the relay holds.
 */
export function usePinMessageMutation(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      message,
    }: {
      message: PinnableMessage;
      pinnedBy: string;
    }) => publishPin(channelId, message.id),
    onMutate: async ({ message, pinnedBy }) => {
      await queryClient.cancelQueries({ queryKey: channelPinsKey(channelId) });
      const previous = snapshot(queryClient, channelId);
      queryClient.setQueryData<ChannelPinsResult>(
        channelPinsKey(channelId),
        withOptimisticPin(previous, message, pinnedBy),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(channelPinsKey(channelId), context?.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: channelPinsKey(channelId) }),
  });
}

/** Unpin by deleting the viewer's own pin events. Optimistic with rollback. */
export function useUnpinMessageMutation(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pinEventIds,
    }: {
      targetId: string;
      pinEventIds: string[];
    }) => removePins(channelId, pinEventIds),
    onMutate: async ({ targetId }) => {
      await queryClient.cancelQueries({ queryKey: channelPinsKey(channelId) });
      const previous = snapshot(queryClient, channelId);
      if (previous) {
        queryClient.setQueryData<ChannelPinsResult>(channelPinsKey(channelId), {
          ...previous,
          pins: previous.pins.filter((pin) => pin.targetId !== targetId),
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(channelPinsKey(channelId), context?.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: channelPinsKey(channelId) }),
  });
}
