import { verifyEvent } from "nostr-tools/pure";

import { parseMemberPositionAction } from "@/features/company-team/teamModels";
import { KIND_ASK_HEAD } from "@/shared/constants/kinds";
import { MAX_EXPLICIT_CHANNEL_VALUES } from "@/shared/api/relayClientShared";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";

export type AskType =
  | "approval"
  | "question"
  | "choice"
  | "checklist"
  | "verdict";
export type AskCategory = "general" | "money" | "hire" | "tool" | "secret";
export type AskStatus = "open" | "resolved" | "cancelled";
export type AskOutcome =
  | "approved"
  | "rejected"
  | "revision_requested"
  | "answered"
  | "chosen"
  | "confirmed"
  | "pass"
  | "fail";

export type AskOption = { id: string; label: string };

export type AskRecord = {
  schemaVersion: number;
  askId: string;
  type: AskType;
  category: AskCategory;
  title: string;
  body?: string;
  threadRootEventId: string;
  addresseePubkey?: string | null;
  decideBy?: string | null;
  options?: AskOption[] | null;
  items?: AskOption[] | null;
  subject?: {
    kind: "goal" | "workflowRun" | "workItem" | "companyMember";
    id: string;
  } | null;
  memberProposal?:
    | import("@/features/company-team/teamModels").MemberPositionAction
    | null;
};

export type AskHead = {
  schemaVersion: number;
  askId: string;
  status: AskStatus;
  askerPubkey: string;
  createdAt: string;
  ask: AskRecord;
  resolution?: {
    outcome: AskOutcome;
    reason?: string;
    answer?: string;
    optionId?: string;
    checkedItemIds?: string[];
    resolvedByPubkey: string;
    resolvedAt: string;
    responseEventId: string;
  } | null;
  cancellation?: {
    cancelledByPubkey: string;
    cancelledAt: string;
    reason: string;
  } | null;
  sourceActionEventId: string;
};

export type AskHeadRecord = {
  channelId: string;
  event: RelayEvent;
  head: AskHead;
};

export const askHeadQueryKey = (
  channelId: string,
  askId: string,
  relaySelfPubkey: string | null,
) => ["company-ask-head", channelId, askId, relaySelfPubkey] as const;

export const askHeadsQueryKey = (
  channelIds: readonly string[],
  relaySelfPubkey: string | null,
) =>
  [
    "company-ask-heads",
    [...channelIds].sort().join(","),
    relaySelfPubkey,
  ] as const;

const ASK_PAGE_SIZE = 500;
const ASK_MAX_PAGES = 20;
const ASK_HEAD_STATUSES = new Set<AskStatus>(["open", "resolved", "cancelled"]);
const ASK_TYPES = new Set<AskType>([
  "approval",
  "question",
  "choice",
  "checklist",
  "verdict",
]);
const ASK_CATEGORIES = new Set<AskCategory>([
  "general",
  "money",
  "hire",
  "tool",
  "secret",
]);

function oneTagValue(event: RelayEvent, name: string): string | null {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 && typeof tags[0][1] === "string"
    ? tags[0][1]
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAskHead(content: string): AskHead {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("The relay returned an invalid ask head.");
  }
  if (!isRecord(value) || !isRecord(value.ask)) {
    throw new Error("The relay returned an incomplete ask head.");
  }
  const head = value as unknown as AskHead;
  const ask = value.ask;
  const rawSubject = ask.subject;
  const subject =
    rawSubject === undefined || rawSubject === null
      ? null
      : isRecord(rawSubject) &&
          typeof rawSubject.kind === "string" &&
          typeof rawSubject.id === "string"
        ? { kind: rawSubject.kind, id: rawSubject.id }
        : undefined;
  const memberProposal =
    ask.memberProposal === undefined || ask.memberProposal === null
      ? null
      : parseMemberPositionAction(ask.memberProposal);
  if (
    head.schemaVersion !== 1 ||
    typeof head.askId !== "string" ||
    !ASK_HEAD_STATUSES.has(head.status) ||
    typeof head.askerPubkey !== "string" ||
    typeof head.createdAt !== "string" ||
    !Number.isFinite(Date.parse(head.createdAt)) ||
    typeof head.sourceActionEventId !== "string" ||
    ask.schemaVersion !== 1 ||
    ask.askId !== head.askId ||
    typeof ask.type !== "string" ||
    !ASK_TYPES.has(ask.type as AskType) ||
    typeof ask.category !== "string" ||
    !ASK_CATEGORIES.has(ask.category as AskCategory) ||
    typeof ask.title !== "string" ||
    typeof ask.threadRootEventId !== "string"
  ) {
    throw new Error(
      "The relay returned an ask head with an unsupported shape.",
    );
  }
  if (
    (rawSubject !== undefined &&
      rawSubject !== null &&
      subject === undefined) ||
    (ask.memberProposal !== undefined &&
      ask.memberProposal !== null &&
      !memberProposal) ||
    (memberProposal !== null &&
      (ask.type !== "approval" ||
        subject?.kind !== "companyMember" ||
        subject.id !== memberProposal.pubkey ||
        (memberProposal.action === "terminate" ||
        memberProposal.action === "rehire"
          ? ask.category !== "hire"
          : ask.category !== "general"))) ||
    (subject?.kind === "companyMember" && memberProposal === null)
  ) {
    throw new Error(
      "The relay returned a malformed member-position proposal ask.",
    );
  }
  return head;
}

/**
 * Accept an ask head only when its signature, relay signer, and channel
 * coordinates match the active relay and requested channel.
 */
export function decodeRelayAskHead(
  event: RelayEvent,
  relaySelfPubkey: string,
  expectedChannelId?: string,
): AskHeadRecord | null {
  if (event.kind !== KIND_ASK_HEAD) return null;
  const channelId = oneTagValue(event, "h");
  const dTag = oneTagValue(event, "d");
  if (
    !channelId ||
    !dTag ||
    (expectedChannelId && channelId !== expectedChannelId)
  ) {
    return null;
  }
  if (event.pubkey.toLowerCase() !== relaySelfPubkey.toLowerCase()) return null;
  try {
    if (!verifyEvent(event)) return null;
  } catch {
    return null;
  }

  const head = parseAskHead(event.content);
  if (dTag !== `channel:${channelId}:ask:${head.askId}`) return null;
  return { channelId, event, head };
}

export function askIdFromAction(content: string): string | null {
  try {
    const action: unknown = JSON.parse(content);
    if (
      isRecord(action) &&
      action.action === "create" &&
      typeof action.askId === "string" &&
      action.askId.length > 0
    ) {
      return action.askId;
    }
  } catch {
    return null;
  }
  return null;
}

function compareNewest(first: RelayEvent, second: RelayEvent) {
  return (
    second.created_at - first.created_at || first.id.localeCompare(second.id)
  );
}

export async function fetchAskHead(
  channelId: string,
  askId: string,
  relaySelfPubkey: string,
): Promise<AskHeadRecord | null> {
  const dTag = `channel:${channelId}:ask:${askId}`;
  const events = await relayClient.fetchEvents({
    kinds: [KIND_ASK_HEAD],
    "#h": [channelId],
    "#d": [dTag],
    limit: 50,
  });
  return (
    events
      .map((event) => decodeRelayAskHead(event, relaySelfPubkey, channelId))
      .filter((record): record is AskHeadRecord => record !== null)
      .filter((record) => record.head.askId === askId)
      .sort((first, second) => compareNewest(first.event, second.event))[0] ??
    null
  );
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<U>,
): Promise<U[]> {
  const result = new Array<U>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        result[index] = await task(values[index]);
      }
    }),
  );
  return result;
}

function splitIntoChunks<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function nextPageCursor(events: readonly RelayEvent[]) {
  let oldest: RelayEvent | undefined;
  for (const event of events) {
    if (
      !oldest ||
      event.created_at < oldest.created_at ||
      (event.created_at === oldest.created_at &&
        event.id.localeCompare(oldest.id) > 0)
    ) {
      oldest = event;
    }
  }
  return oldest;
}

async function fetchAskHeadPages(
  channelIds: readonly string[],
  relaySelfPubkey: string,
): Promise<AskHeadRecord[]> {
  const seen = new Map<string, AskHeadRecord>();
  let until: number | undefined;
  let beforeId: string | undefined;

  for (let pageNumber = 0; pageNumber < ASK_MAX_PAGES; pageNumber += 1) {
    const events = await relayClient.fetchEvents({
      kinds: [KIND_ASK_HEAD],
      "#h": [...channelIds],
      limit: ASK_PAGE_SIZE,
      ...(until === undefined ? {} : { until, before_id: beforeId }),
    });
    for (const event of events) {
      const record = decodeRelayAskHead(event, relaySelfPubkey);
      if (
        record &&
        channelIds.includes(record.channelId) &&
        !seen.has(record.event.id)
      ) {
        seen.set(record.event.id, record);
      }
    }
    if (events.length < ASK_PAGE_SIZE) return [...seen.values()];

    const oldest = nextPageCursor(events);
    if (!oldest || (until === oldest.created_at && beforeId === oldest.id)) {
      throw new Error(
        "The ask list could not advance its relay history cursor.",
      );
    }
    until = oldest.created_at;
    beforeId = oldest.id;
  }

  throw new Error("The ask list is larger than the supported inbox history.");
}

export async function fetchAskHeads(
  channelIds: readonly string[],
  relaySelfPubkey: string,
): Promise<AskHeadRecord[]> {
  const uniqueChannelIds = [...new Set(channelIds)].sort();
  if (uniqueChannelIds.length === 0) return [];
  const channelChunks = splitIntoChunks(
    uniqueChannelIds,
    MAX_EXPLICIT_CHANNEL_VALUES,
  );
  const pages = await mapWithConcurrency(channelChunks, 3, (chunk) =>
    fetchAskHeadPages(chunk, relaySelfPubkey),
  );
  const byCoordinate = new Map<string, AskHeadRecord>();
  for (const record of pages.flat()) {
    const key = `${record.channelId}:${record.head.askId}`;
    const current = byCoordinate.get(key);
    if (!current || compareNewest(current.event, record.event) > 0) {
      byCoordinate.set(key, record);
    }
  }
  return [...byCoordinate.values()];
}

export function splitChannelIds(channelIds: readonly string[]) {
  return splitIntoChunks(
    [...new Set(channelIds)].sort(),
    MAX_EXPLICIT_CHANNEL_VALUES,
  );
}
