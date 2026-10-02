import type { RelayEvent } from "@/shared/api/types";
import { MAX_EXPLICIT_CHANNEL_VALUES } from "@/shared/api/relayClientShared";
import type { RelayClient } from "@/shared/api/relayClientSession";

const CLIENT_CHANNEL_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SUBSCRIBED_CLIENT_CHANNELS = 4096;

type BusinessRecordLiveRelay = Pick<RelayClient, "subscribeLive">;

export type BusinessRecordLiveSubscriptionInput = {
  relay: BusinessRecordLiveRelay;
  channelIds: readonly string[];
  kinds: readonly number[];
  isCurrentScope: () => boolean;
  onEvent: (event: RelayEvent) => void;
};

export async function subscribeToBusinessRecords({
  relay,
  channelIds,
  kinds,
  isCurrentScope,
  onEvent,
}: BusinessRecordLiveSubscriptionInput): Promise<() => void> {
  if (channelIds.length > MAX_SUBSCRIBED_CLIENT_CHANNELS) {
    throw new Error(
      "Too many client channels for a live business subscription",
    );
  }
  if (kinds.length === 0 || kinds.some((kind) => !Number.isInteger(kind))) {
    throw new Error(
      "A live business subscription requires explicit event kinds",
    );
  }
  const normalizedIds = [
    ...new Set(
      channelIds.map((channelId) => {
        if (!CLIENT_CHANNEL_ID_RE.test(channelId)) {
          throw new Error("Client channel id must be a UUID");
        }
        return channelId.toLowerCase();
      }),
    ),
  ];
  const uniqueKinds = [...new Set(kinds)];
  const batches: string[][] = [];
  for (
    let index = 0;
    index < normalizedIds.length;
    index += MAX_EXPLICIT_CHANNEL_VALUES
  ) {
    batches.push(
      normalizedIds.slice(index, index + MAX_EXPLICIT_CHANNEL_VALUES),
    );
  }

  let active = true;
  const unsubscribers = new Set<() => void | Promise<void>>();
  const dispose = () => {
    if (!active) return;
    active = false;
    for (const unsubscribe of unsubscribers) {
      const result = unsubscribe();
      if (result instanceof Promise) {
        void result.catch((error: unknown) => {
          console.error(
            "Failed to close a business record subscription",
            error,
          );
        });
      }
    }
    unsubscribers.clear();
  };

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const unsubscribe = await relay.subscribeLive(
        {
          kinds: uniqueKinds,
          "#h": batch,
          limit: 0,
        },
        (event) => {
          if (!active || !isCurrentScope()) return;
          if (!uniqueKinds.includes(event.kind)) return;
          const channelTags = event.tags.filter((tag) => tag[0] === "h");
          if (
            channelTags.length !== 1 ||
            !batch.includes(channelTags[0]?.[1]?.toLowerCase() ?? "")
          ) {
            return;
          }
          onEvent(event);
        },
      );
      if (active) {
        unsubscribers.add(unsubscribe);
      } else {
        const result = unsubscribe();
        if (result instanceof Promise) {
          void result.catch((error: unknown) => {
            console.error(
              "Failed to close a stale business subscription",
              error,
            );
          });
        }
      }
    }),
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) {
    dispose();
    throw failed.reason;
  }
  return dispose;
}
