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
  | "verdict"
  | "tool_consent";
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
  | "fail"
  | "secret_bound";

export type SecretAskRequest = {
  toolName: string;
  clientName?: string;
  allowedUse: string;
};

export type HireToolRisk = "low" | "medium" | "high";

export type HireProposal = {
  hireId: string;
  rolePack: {
    personaId: string;
    title: string;
    job: string;
    skills: string[];
    tools: { name: string; risk: HireToolRisk }[];
    workerMenu: string[];
    defaultAllowance?: string;
  };
  displayName: string;
  title: string;
  managerPubkey?: string;
  introductionChannelId: string;
  runtimeId: string;
  providerId?: string;
  modelId?: string;
  weeklyAllowance?: string;
};

export type AskOption = { id: string; label: string };

export type ToolConsentPreview = {
  action:
    | "spend_money"
    | "message_outsider"
    | "delete_data"
    | "publish_publicly";
  actionPreview: string;
};

export type AskRecord = {
  schemaVersion: number;
  askId: string;
  type: AskType;
  category: AskCategory;
  title: string;
  body?: string;
  threadRootEventId: string;
  threadStart?: { title: string; openingContext?: string } | null;
  addresseePubkey?: string | null;
  decideBy?: string | null;
  options?: AskOption[] | null;
  items?: AskOption[] | null;
  subject?: {
    kind: "goal" | "workflowRun" | "workItem" | "companyMember" | "hire";
    id: string;
  } | null;
  memberProposal?:
    | import("@/features/company-team/teamModels").MemberPositionAction
    | null;
  hireProposal?: HireProposal | null;
  toolConsent?: ToolConsentPreview | null;
  secretRequest?: SecretAskRequest | null;
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
    secretBindingId?: string;
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
  companyToolConsentInbox = false,
) =>
  [
    "company-ask-head",
    channelId,
    askId,
    relaySelfPubkey,
    companyToolConsentInbox,
  ] as const;

export const askHeadsQueryKey = (
  channelIds: readonly string[],
  relaySelfPubkey: string | null,
  includeCompanyToolConsent = false,
) =>
  [
    "company-ask-heads",
    [...channelIds].sort().join(","),
    relaySelfPubkey,
    includeCompanyToolConsent,
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
  "tool_consent",
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

function parseHireProposal(value: unknown): HireProposal | null {
  if (!isRecord(value)) return null;
  const rolePack = value.rolePack;
  if (!isRecord(rolePack)) return null;
  const tools = rolePack.tools;
  const validTools =
    Array.isArray(tools) &&
    tools.every(
      (tool) =>
        isRecord(tool) &&
        typeof tool.name === "string" &&
        tool.name.trim().length > 0 &&
        ["low", "medium", "high"].includes(String(tool.risk)),
    );
  const validStringArray = (
    candidate: unknown,
    max: number,
  ): candidate is string[] =>
    Array.isArray(candidate) &&
    candidate.length <= max &&
    candidate.every(
      (item) => typeof item === "string" && item.trim().length > 0,
    );
  const proposal = value as unknown as HireProposal;
  const knownKeys = new Set([
    "hireId",
    "rolePack",
    "displayName",
    "title",
    "managerPubkey",
    "introductionChannelId",
    "runtimeId",
    "providerId",
    "modelId",
    "weeklyAllowance",
  ]);
  const knownRoleKeys = new Set([
    "personaId",
    "title",
    "job",
    "skills",
    "tools",
    "workerMenu",
    "defaultAllowance",
  ]);
  const allowanceValid = (allowance: unknown) =>
    allowance === undefined ||
    (typeof allowance === "string" &&
      allowance.length <= 30 &&
      /^\d+(\.\d+)?$/.test(allowance));
  const validManagerPubkey =
    proposal.managerPubkey === undefined ||
    (typeof proposal.managerPubkey === "string" &&
      /^[0-9a-f]{64}$/.test(proposal.managerPubkey));
  const uniqueWorkerMenu =
    Array.isArray(rolePack.workerMenu) &&
    new Set(rolePack.workerMenu).size === rolePack.workerMenu.length;
  if (
    Object.keys(value).some((key) => !knownKeys.has(key)) ||
    Object.keys(rolePack).some((key) => !knownRoleKeys.has(key)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      proposal.hireId,
    ) ||
    typeof rolePack.personaId !== "string" ||
    !rolePack.personaId.trim() ||
    typeof rolePack.title !== "string" ||
    !rolePack.title.trim() ||
    typeof rolePack.job !== "string" ||
    !rolePack.job.trim() ||
    !validStringArray(rolePack.skills, 32) ||
    !validTools ||
    !validStringArray(rolePack.workerMenu, 32) ||
    rolePack.workerMenu.length === 0 ||
    !uniqueWorkerMenu ||
    typeof proposal.displayName !== "string" ||
    !proposal.displayName.trim() ||
    typeof proposal.title !== "string" ||
    !proposal.title.trim() ||
    !validManagerPubkey ||
    typeof proposal.introductionChannelId !== "string" ||
    typeof proposal.runtimeId !== "string" ||
    !rolePack.workerMenu.includes(proposal.runtimeId) ||
    (proposal.providerId !== undefined &&
      (typeof proposal.providerId !== "string" ||
        !proposal.providerId.trim())) ||
    (proposal.modelId !== undefined && typeof proposal.modelId !== "string") ||
    !allowanceValid(rolePack.defaultAllowance) ||
    !allowanceValid(proposal.weeklyAllowance)
  ) {
    return null;
  }
  return proposal;
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
  const threadStart = ask.threadStart;
  const validThreadStart =
    threadStart === undefined ||
    threadStart === null ||
    (isRecord(threadStart) &&
      Object.keys(threadStart).every(
        (key) => key === "title" || key === "openingContext",
      ) &&
      typeof threadStart.title === "string" &&
      threadStart.title.trim().length > 0 &&
      Array.from(threadStart.title).length <= 180 &&
      (threadStart.openingContext === undefined ||
        (typeof threadStart.openingContext === "string" &&
          Array.from(threadStart.openingContext).length <= 4000)));
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
  const hireProposal =
    ask.hireProposal === undefined || ask.hireProposal === null
      ? null
      : parseHireProposal(ask.hireProposal);
  const secretRequest = ask.secretRequest;
  const invalidSecretRequest =
    ask.category === "secret"
      ? ask.type !== "question" ||
        !isRecord(secretRequest) ||
        Object.keys(secretRequest).some(
          (key) =>
            key !== "toolName" && key !== "clientName" && key !== "allowedUse",
        ) ||
        typeof secretRequest.toolName !== "string" ||
        (secretRequest.clientName !== undefined &&
          (typeof secretRequest.clientName !== "string" ||
            !secretRequest.clientName.trim() ||
            Array.from(secretRequest.clientName).length > 120)) ||
        typeof secretRequest.allowedUse !== "string"
      : secretRequest !== undefined && secretRequest !== null;
  const toolConsent = ask.toolConsent;
  const validToolConsent =
    toolConsent === undefined ||
    toolConsent === null ||
    (isRecord(toolConsent) &&
      [
        "spend_money",
        "message_outsider",
        "delete_data",
        "publish_publicly",
      ].includes(String(toolConsent.action)) &&
      typeof toolConsent.actionPreview === "string" &&
      toolConsent.actionPreview.length > 0 &&
      toolConsent.actionPreview.length <= 4000);
  const invalidMemberProposal =
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
    (subject?.kind === "companyMember" && memberProposal === null);
  const invalidHireProposal =
    (ask.hireProposal !== undefined &&
      ask.hireProposal !== null &&
      !hireProposal) ||
    (hireProposal !== null &&
      (ask.type !== "approval" ||
        ask.category !== "hire" ||
        subject?.kind !== "hire" ||
        subject.id !== hireProposal.hireId ||
        memberProposal !== null)) ||
    (subject?.kind === "hire" && hireProposal === null);
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
    typeof ask.threadRootEventId !== "string" ||
    !validThreadStart ||
    invalidSecretRequest ||
    !validToolConsent ||
    (ask.type === "tool_consent" &&
      (ask.category !== "tool" || !isRecord(toolConsent))) ||
    (ask.type !== "tool_consent" && toolConsent != null)
  ) {
    throw new Error(
      "The relay returned an ask head with an unsupported shape.",
    );
  }
  if (
    rawSubject !== undefined &&
    rawSubject !== null &&
    subject === undefined
  ) {
    throw new Error("The relay returned a malformed company proposal ask.");
  }
  if (invalidMemberProposal) {
    throw new Error("The relay returned a malformed member-position proposal.");
  }
  if (invalidHireProposal) {
    throw new Error("The relay returned a malformed hire proposal ask.");
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

/** Reads a valid new-thread opening from a signed ask create event. */
export function askThreadStartFromAction(
  content: string,
): { title: string; openingContext?: string } | null {
  try {
    const action: unknown = JSON.parse(content);
    if (
      !isRecord(action) ||
      action.action !== "create" ||
      !isRecord(action.ask)
    ) {
      return null;
    }
    const threadStart = action.ask.threadStart;
    if (
      !isRecord(threadStart) ||
      typeof threadStart.title !== "string" ||
      threadStart.title.trim().length === 0 ||
      Array.from(threadStart.title).length > 180 ||
      (threadStart.openingContext !== undefined &&
        (typeof threadStart.openingContext !== "string" ||
          Array.from(threadStart.openingContext).length > 4000))
    ) {
      return null;
    }
    return {
      title: threadStart.title,
      ...(typeof threadStart.openingContext === "string"
        ? { openingContext: threadStart.openingContext }
        : {}),
    };
  } catch {
    return null;
  }
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

export async function fetchCompanyToolConsentAskHead(
  channelId: string,
  askId: string,
  relaySelfPubkey: string,
): Promise<AskHeadRecord | null> {
  const dTag = `channel:${channelId}:ask:${askId}`;
  const events = await relayClient.fetchEvents({
    kinds: [KIND_ASK_HEAD],
    authors: [relaySelfPubkey],
    "#d": [dTag],
    "#t": ["tool_consent"],
    limit: 10,
  });
  return (
    events
      .filter((event) => oneTagValue(event, "t") === "tool_consent")
      .map((event) => decodeRelayAskHead(event, relaySelfPubkey, channelId))
      .filter((record): record is AskHeadRecord => record !== null)
      .filter(
        (record) =>
          record.head.askId === askId &&
          record.head.ask.type === "tool_consent" &&
          record.head.ask.category === "tool",
      )
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

/**
 * Fetch tool-consent asks across community channels. The relay permits this
 * global filter only for community owners and admins, then limits results to
 * relay-signed tool-consent heads.
 */
export async function fetchCompanyToolConsentAskHeads(
  relaySelfPubkey: string,
): Promise<AskHeadRecord[]> {
  const seen = new Map<string, AskHeadRecord>();
  let until: number | undefined;
  let beforeId: string | undefined;

  for (let pageNumber = 0; pageNumber < ASK_MAX_PAGES; pageNumber += 1) {
    const events = await relayClient.fetchEvents({
      kinds: [KIND_ASK_HEAD],
      authors: [relaySelfPubkey],
      "#t": ["tool_consent"],
      limit: ASK_PAGE_SIZE,
      ...(until === undefined ? {} : { until, before_id: beforeId }),
    });
    for (const event of events) {
      if (oneTagValue(event, "t") !== "tool_consent") continue;
      const record = decodeRelayAskHead(event, relaySelfPubkey);
      if (
        record?.head.ask.type === "tool_consent" &&
        record.head.ask.category === "tool"
      ) {
        const key = `${record.channelId}:${record.head.askId}`;
        const current = seen.get(key);
        if (!current || compareNewest(current.event, record.event) > 0) {
          seen.set(key, record);
        }
      }
    }
    if (events.length < ASK_PAGE_SIZE) return [...seen.values()];

    const oldest = nextPageCursor(events);
    if (!oldest || (until === oldest.created_at && beforeId === oldest.id)) {
      throw new Error(
        "The tool-consent inbox could not advance its relay history cursor.",
      );
    }
    until = oldest.created_at;
    beforeId = oldest.id;
  }

  throw new Error("The tool-consent inbox exceeds supported history.");
}

export function splitChannelIds(channelIds: readonly string[]) {
  return splitIntoChunks(
    [...new Set(channelIds)].sort(),
    MAX_EXPLICIT_CHANNEL_VALUES,
  );
}
