import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_PINNED,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";

/**
 * Channel pins: the read model.
 *
 * Contract (kind 40004, reserved in the kind registry and unused until now): a
 * pin is one event signed by the pinner with exactly one `["h", channelId]` and
 * exactly one bare `["e", messageId]`. The `e` tag carries no marker on purpose:
 * the relay reads only `root` and `reply` markers as thread replies, so a pin
 * never changes a message's reply count. Unpinning is a NIP-09 deletion of the
 * pin event by the pinner, so a pin that exists is a pin that is still pinned.
 *
 * The reader trusts nothing it was not told: a pin whose tags do not match this
 * contract is ignored, and a pin whose target is not a stream message of this
 * same channel is dropped, never shown. A target that cannot be read (deleted,
 * or not visible to this person) is shown honestly as unavailable.
 */

export const MAX_PIN_EVENTS = 500;
export const MAX_CHANNEL_PINS = 200;
/** Message kinds a pin may point at. */
export const PINNABLE_MESSAGE_KINDS: readonly number[] = [
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
];

const HEX64_RE = /^[0-9a-f]{64}$/i;

export type PinRecord = {
  pinEventId: string;
  targetId: string;
  pinnedBy: string;
  /** Unix seconds. */
  pinnedAt: number;
};

export type PinTarget =
  | {
      state: "message";
      id: string;
      author: string;
      content: string;
      /** Unix seconds. */
      createdAt: number;
    }
  | { state: "unavailable" };

export type ChannelPin = {
  targetId: string;
  /** Every live pin event for this message, newest first. */
  pins: PinRecord[];
  /** When it was most recently pinned, unix seconds. */
  pinnedAt: number;
  /** Who pinned it first. */
  pinnedBy: string;
  target: PinTarget;
};

export type ChannelPinsResult = {
  pins: ChannelPin[];
  /** More pin events or pins existed than are shown. */
  truncated: boolean;
};

function channelTagValues(tags: string[][]): string[] {
  return tags.filter((tag) => tag[0] === "h").map((tag) => tag[1] ?? "");
}

/** Strict parse of one pin event for `channelId`; `null` when it breaks the contract. */
export function parsePinEvent(
  event: RelayEvent,
  channelId: string,
): PinRecord | null {
  if (event.kind !== KIND_STREAM_MESSAGE_PINNED) return null;
  if (!HEX64_RE.test(event.id) || !HEX64_RE.test(event.pubkey)) return null;
  const channels = channelTagValues(event.tags);
  if (channels.length !== 1) return null;
  if (channels[0].toLowerCase() !== channelId.toLowerCase()) return null;
  const targets = event.tags.filter((tag) => tag[0] === "e");
  if (targets.length !== 1) return null;
  const [target] = targets;
  if (target.length !== 2 || !HEX64_RE.test(target[1])) return null;
  return {
    pinEventId: event.id.toLowerCase(),
    targetId: target[1].toLowerCase(),
    pinnedBy: event.pubkey.toLowerCase(),
    pinnedAt: event.created_at,
  };
}

/** Group live pin records by message, newest pin first within each. */
export function groupPins(
  records: readonly PinRecord[],
): Array<Omit<ChannelPin, "target">> {
  const byTarget = new Map<string, PinRecord[]>();
  for (const record of records) {
    const list = byTarget.get(record.targetId) ?? [];
    list.push(record);
    byTarget.set(record.targetId, list);
  }
  const newestFirst = (left: PinRecord, right: PinRecord) =>
    right.pinnedAt - left.pinnedAt ||
    left.pinEventId.localeCompare(right.pinEventId);
  return [...byTarget.entries()]
    .map(([targetId, pins]) => {
      const sorted = [...pins].sort(newestFirst);
      const first = sorted[sorted.length - 1];
      return {
        targetId,
        pins: sorted,
        pinnedAt: sorted[0].pinnedAt,
        pinnedBy: first.pinnedBy,
      };
    })
    .sort(
      (left, right) =>
        right.pinnedAt - left.pinnedAt ||
        left.targetId.localeCompare(right.targetId),
    );
}

/**
 * Judge a fetched target against the pin. `"rejected"` means the event exists
 * but is not a stream message of this channel: the pin is dropped.
 */
export function resolvePinTarget(
  targetId: string,
  channelId: string,
  events: readonly RelayEvent[],
): PinTarget | "rejected" {
  const event = events.find(
    (candidate) => candidate.id.toLowerCase() === targetId.toLowerCase(),
  );
  if (!event) return { state: "unavailable" };
  const channels = channelTagValues(event.tags);
  if (
    !PINNABLE_MESSAGE_KINDS.includes(event.kind) ||
    channels.length !== 1 ||
    channels[0].toLowerCase() !== channelId.toLowerCase()
  ) {
    return "rejected";
  }
  return {
    state: "message",
    id: event.id.toLowerCase(),
    author: event.pubkey.toLowerCase(),
    content: event.content,
    createdAt: event.created_at,
  };
}

/** Everything the screens show, from raw pin events and the targets fetched for them. */
export function buildChannelPins(
  channelId: string,
  pinEvents: readonly RelayEvent[],
  targetEvents: readonly RelayEvent[],
): { result: ChannelPinsResult; rejected: number } {
  const records = pinEvents
    .map((event) => parsePinEvent(event, channelId))
    .filter((record): record is PinRecord => record !== null);
  const grouped = groupPins(records);
  const pins: ChannelPin[] = [];
  let rejected = 0;
  for (const group of grouped) {
    const target = resolvePinTarget(group.targetId, channelId, targetEvents);
    if (target === "rejected") {
      rejected += 1;
      continue;
    }
    pins.push({ ...group, target });
  }
  return {
    result: {
      pins: pins.slice(0, MAX_CHANNEL_PINS),
      truncated:
        pins.length > MAX_CHANNEL_PINS || pinEvents.length > MAX_PIN_EVENTS,
    },
    rejected,
  };
}

/** The pin events `pubkey` made for `targetId`: what an unpin has to delete. */
export function pinEventsBy(
  pin: Pick<ChannelPin, "pins"> | undefined,
  pubkey: string | undefined,
): PinRecord[] {
  if (!pin || !pubkey) return [];
  return pin.pins.filter((record) => record.pinnedBy === pubkey.toLowerCase());
}

/** First non-empty lines of a message, bounded, for a list row. */
export function pinPreview(content: string, max = 220): string {
  const text = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
