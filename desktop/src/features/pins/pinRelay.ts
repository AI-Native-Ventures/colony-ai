import { relayClient } from "@/shared/api/relayClient";
import { deleteMessage, signRelayEvent } from "@/shared/api/tauri";
import { KIND_STREAM_MESSAGE_PINNED } from "@/shared/constants/kinds";

import {
  buildChannelPins,
  type ChannelPinsResult,
  MAX_PIN_EVENTS,
  PINNABLE_MESSAGE_KINDS,
} from "./pinModels";

/** Targets are looked up this many at a time. */
const TARGET_CHUNK = 50;

/**
 * Read a channel's pins: its live pin events, then the messages they point at.
 * A failed read throws (rule 1: a failure is never an empty list). Targets are
 * fetched by id with explicit kinds and judged by `buildChannelPins`, which
 * drops any that are not stream messages of this channel.
 */
export async function fetchChannelPins(
  channelId: string,
): Promise<ChannelPinsResult> {
  const fetched = await relayClient.fetchEvents({
    kinds: [KIND_STREAM_MESSAGE_PINNED],
    "#h": [channelId],
    limit: MAX_PIN_EVENTS + 1,
  });
  // Newest first, then bounded: a channel with more pin events than the cap
  // shows the most recent ones and says so.
  const pinEvents = [...fetched]
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_PIN_EVENTS);

  const targetIds = [
    ...new Set(
      pinEvents.flatMap((event) =>
        event.tags
          .filter((tag) => tag[0] === "e" && typeof tag[1] === "string")
          .map((tag) => tag[1].toLowerCase()),
      ),
    ),
  ];
  const targetEvents = [];
  for (let index = 0; index < targetIds.length; index += TARGET_CHUNK) {
    const ids = targetIds.slice(index, index + TARGET_CHUNK);
    // Scoped to this channel like every other by-id read: a pin that points
    // into another channel finds nothing here and shows as unavailable.
    const found = await relayClient.fetchEvents({
      ids,
      kinds: [...PINNABLE_MESSAGE_KINDS],
      "#h": [channelId],
      limit: ids.length,
    });
    targetEvents.push(...found);
  }

  const { result, rejected } = buildChannelPins(
    channelId,
    pinEvents,
    targetEvents,
  );
  if (rejected > 0) {
    console.warn(
      `[pins] ignored ${rejected} pin(s) that do not point at a message of this channel`,
    );
  }
  return {
    ...result,
    truncated: result.truncated || fetched.length > MAX_PIN_EVENTS,
  };
}

/** One signed pin event is the whole user action (rule 5). Returns its id. */
export async function publishPin(
  channelId: string,
  messageId: string,
): Promise<string> {
  const event = await signRelayEvent({
    kind: KIND_STREAM_MESSAGE_PINNED,
    content: "",
    tags: [
      ["h", channelId],
      ["e", messageId],
    ],
  });
  await relayClient.publishEvent(
    event,
    "Timed out pinning the message.",
    "Failed to pin the message.",
  );
  return event.id;
}

/**
 * Unpin by deleting the viewer's own pin events for the message (NIP-09, through
 * the same command that deletes a message). Usually one event; if a race made
 * two, all go, one after the other, and the first failure stops the run so the
 * caller can show what is still pinned.
 */
export async function removePins(
  channelId: string,
  pinEventIds: readonly string[],
): Promise<void> {
  for (const pinEventId of pinEventIds) {
    await deleteMessage(channelId, pinEventId);
  }
}
