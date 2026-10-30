import { KIND_CUSTOMER_HEAD } from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";

import {
  COMPANY_RECORD_SCHEMA_VERSION,
  PUBKEY_PATTERN,
  hasOnlyKeys,
  isObject,
  isValidRelayHead,
  oneTagValue,
  parseJson,
  pick,
} from "./cofounderRecords";

export {
  KIND_CUSTOMER_ACTION,
  KIND_CUSTOMER_HEAD,
} from "@/shared/constants/kinds";

/**
 * The customer record (kind 30679): one record per business across its life,
 * from the lead found in Discovery to the client, the project and the money.
 *
 * It is a relay-signed head, community-wide, keyed by the party id the
 * prospect, proposals and client share (d-tag `customer:<partyId>`). The relay
 * builds every figure and timeline line from the company's own records; the
 * desktop only reads and shows them. Mirrors `CustomerRecordHead` in
 * `crates/buzz-core/src/company_customers.rs`.
 */
export const CUSTOMER_D_TAG_PREFIX = "customer:";
export const MAX_CUSTOMER_MILESTONES = 200;
export const MAX_CUSTOMER_ATTACHMENTS = 200;
export const MAX_CUSTOMER_TIMELINE_ENTRIES = 1_000;
/** A record younger than this is not recomputed by `refresh`. */
export const CUSTOMER_REFRESH_FRESH_SECS = 60;

export type CustomerStage = "lead" | "client";
export type MilestoneKind = "call_booked" | "agreement_signed" | "other";
export type AttachmentKind = "email" | "file";
export type ConversionSource = "client_record" | "owner_action";
export type JobStatus = "running" | "completed" | "cancelled";

export type TimelineKind =
  | "found"
  | "opener_approved"
  | "opener_sent"
  | "replied"
  | "call_booked"
  | "quote_drafted"
  | "quote_accepted"
  | "agreement_signed"
  | "milestone"
  | "email"
  | "file"
  | "converted"
  | "invoice_issued"
  | "payment_received"
  | "project_started"
  | "project_completed";

export type TimelineEntryView = {
  /** `<source kind>:<source id>:<entry kind>`. */
  entryId: string;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  /** Unix seconds the thing happened. */
  at: number;
  /** Who did it; null for the customer or a provider. */
  actorPubkey: string | null;
  source: { kind: string; id: string };
};

export type FoundView = {
  at: number;
  byPubkey: string | null;
  /** The search it came from, in words. */
  search: string | null;
};

export type ConversionView = {
  at: number;
  source: ConversionSource;
  byPubkey: string | null;
  actionEventId: string | null;
};

/** Every amount is minor units of `currency`; null means the records do not say, never zero. */
export type MoneyView = {
  currency: string | null;
  quoteTotalMinor: number | null;
  /** Everything paid so far; the first payment is the deposit. */
  depositPaidMinor: number | null;
  depositPaidAt: number | null;
  balanceDueMinor: number | null;
  otherCurrencyFacts: number;
};

export type QuoteView = {
  proposalId: string;
  revision: number;
  totalMinor: number | null;
  currency: string;
  draftedAt: number;
  acceptedAt: number | null;
};

export type WhatsappView = {
  waId: string;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  lastMessageAt: number | null;
  optedOut: boolean;
};

export type ChatsView = {
  whatsapp: WhatsappView | null;
  emailCount: number;
};

export type ProjectView = {
  jobId: string;
  title: string;
  playbookTitle: string;
  status: JobStatus;
  currentStepId: string | null;
  currentStepTitle: string | null;
  /** 1-based position of the current step ("step 3 of 7"). */
  stepNumber: number | null;
  stepCount: number;
  startedAt: number;
  endedAt: number | null;
};

export type MilestoneView = {
  /** The id of the action that recorded it. */
  milestoneId: string;
  kind: MilestoneKind;
  title: string | null;
  at: number;
  note: string | null;
  fileRef: string | null;
  byPubkey: string;
  recordedAt: number;
};

export type EmailView = {
  from: string;
  subject: string;
  date: number;
  summary: string;
};

export type AttachmentView = {
  /** The id of the action that added it. */
  attachmentId: string;
  kind: AttachmentKind;
  label: string;
  fileRefs: string[];
  email: EmailView | null;
  addedByPubkey: string;
  addedAt: number;
};

export type CustomerRecordView = {
  partyId: string;
  displayName: string;
  stage: CustomerStage;
  leadId: string | null;
  clientId: string | null;
  clientStatus: string | null;
  found: FoundView | null;
  conversion: ConversionView | null;
  money: MoneyView;
  /** Proposals, oldest first. */
  quotes: QuoteView[];
  chats: ChatsView;
  project: ProjectView | null;
  /** Oldest first. */
  milestones: MilestoneView[];
  /** Oldest first. */
  attachments: AttachmentView[];
  /** The customer's life, oldest first. */
  timeline: TimelineEntryView[];
  computedAt: number;
  updatedByPubkey: string;
  updatedAt: number;
  sourceActionEventId: string | null;
  /** Id of the head event: every write must name it as the expected head. */
  eventId: string;
  /** Time of the head event, Unix seconds. */
  createdAt: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX_ID_PATTERN = /^[0-9a-f]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_TEXT = 300;
const MAX_FILE_REF = 500;
const MAX_EMAIL_SUMMARY_BYTES = 4_096;

const STAGES = new Set<string>(["lead", "client"]);
const MILESTONE_KINDS = new Set<string>([
  "call_booked",
  "agreement_signed",
  "other",
]);
const ATTACHMENT_KINDS = new Set<string>(["email", "file"]);
const CONVERSION_SOURCES = new Set<string>(["client_record", "owner_action"]);
const JOB_STATUSES = new Set<string>(["running", "completed", "cancelled"]);
/** In the order the relay breaks ties between entries of one second. */
export const TIMELINE_KINDS: readonly TimelineKind[] = [
  "found",
  "opener_approved",
  "opener_sent",
  "replied",
  "call_booked",
  "quote_drafted",
  "quote_accepted",
  "agreement_signed",
  "milestone",
  "email",
  "file",
  "converted",
  "invoice_issued",
  "payment_received",
  "project_started",
  "project_completed",
];
const TIMELINE_KIND_SET = new Set<string>(TIMELINE_KINDS);

export function customerDTag(partyId: string): string {
  return `${CUSTOMER_D_TAG_PREFIX}${partyId}`;
}

/** The party id a customer d-tag names, or null. */
export function parseCustomerDTag(dTag: string | null): string | null {
  if (!dTag?.startsWith(CUSTOMER_D_TAG_PREFIX)) return null;
  const id = dTag.slice(CUSTOMER_D_TAG_PREFIX.length);
  return UUID_PATTERN.test(id) ? id : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  return value.trim().length === 0 ? null : value;
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** `undefined` when the field is present but invalid, `null` when absent or null. */
function optional<T>(
  record: Record<string, unknown>,
  key: string,
  read: (value: unknown) => T | null,
): T | null | undefined {
  const raw = pick(record, key);
  if (raw === undefined || raw === null) return null;
  const value = read(raw);
  return value === null ? undefined : value;
}

function pubkey(value: unknown): string | null {
  return typeof value === "string" && PUBKEY_PATTERN.test(value) ? value : null;
}

function hexId(value: unknown): string | null {
  return typeof value === "string" && HEX_ID_PATTERN.test(value) ? value : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function parseSource(value: unknown): { kind: string; id: string } | null {
  if (!isObject(value) || !hasOnlyKeys(value, ["kind", "id"])) return null;
  const kind = text(pick(value, "kind"), 64);
  const id = text(pick(value, "id"), 128);
  return kind && id ? { kind, id } : null;
}

function parseEntry(value: unknown): TimelineEntryView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "entryId",
      "kind",
      "title",
      "detail",
      "at",
      "actorPubkey",
      "source",
    ])
  )
    return null;
  const entryId = text(pick(value, "entryId"), 256);
  const kind = pick(value, "kind");
  const title = text(pick(value, "title"), 400);
  const detail = optional(value, "detail", (raw) => text(raw, 600));
  const at = whole(pick(value, "at"));
  const actorPubkey = optional(value, "actorPubkey", pubkey);
  const source = parseSource(pick(value, "source"));
  if (
    !entryId ||
    typeof kind !== "string" ||
    !TIMELINE_KIND_SET.has(kind) ||
    !title ||
    detail === undefined ||
    at === null ||
    actorPubkey === undefined ||
    !source
  )
    return null;
  return {
    entryId,
    kind: kind as TimelineKind,
    title,
    detail,
    at,
    actorPubkey,
    source,
  };
}

function parseFound(value: unknown): FoundView | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isObject(value) || !hasOnlyKeys(value, ["at", "byPubkey", "search"]))
    return undefined;
  const at = whole(pick(value, "at"));
  const byPubkey = optional(value, "byPubkey", pubkey);
  const search = optional(value, "search", (raw) => text(raw, MAX_TEXT));
  if (at === null || byPubkey === undefined || search === undefined)
    return undefined;
  return { at, byPubkey, search };
}

function parseConversion(value: unknown): ConversionView | null | undefined {
  if (value === undefined || value === null) return null;
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["at", "source", "byPubkey", "actionEventId"])
  )
    return undefined;
  const at = whole(pick(value, "at"));
  const source = pick(value, "source");
  const byPubkey = optional(value, "byPubkey", pubkey);
  const actionEventId = optional(value, "actionEventId", hexId);
  if (
    at === null ||
    typeof source !== "string" ||
    !CONVERSION_SOURCES.has(source) ||
    byPubkey === undefined ||
    actionEventId === undefined
  )
    return undefined;
  return { at, source: source as ConversionSource, byPubkey, actionEventId };
}

function parseMoney(value: unknown): MoneyView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "currency",
      "quoteTotalMinor",
      "depositPaidMinor",
      "depositPaidAt",
      "balanceDueMinor",
      "otherCurrencyFacts",
    ])
  )
    return null;
  const currency = optional(value, "currency", (raw) =>
    typeof raw === "string" && CURRENCY_PATTERN.test(raw) ? raw : null,
  );
  const quoteTotalMinor = optional(value, "quoteTotalMinor", whole);
  const depositPaidMinor = optional(value, "depositPaidMinor", whole);
  const depositPaidAt = optional(value, "depositPaidAt", whole);
  const balanceDueMinor = optional(value, "balanceDueMinor", whole);
  const otherCurrencyFacts = whole(pick(value, "otherCurrencyFacts"));
  if (
    currency === undefined ||
    quoteTotalMinor === undefined ||
    depositPaidMinor === undefined ||
    depositPaidAt === undefined ||
    balanceDueMinor === undefined ||
    otherCurrencyFacts === null
  )
    return null;
  // No money record means no figure at all.
  if (
    currency === null &&
    (quoteTotalMinor !== null ||
      depositPaidMinor !== null ||
      balanceDueMinor !== null)
  )
    return null;
  return {
    currency,
    quoteTotalMinor,
    depositPaidMinor,
    depositPaidAt,
    balanceDueMinor,
    otherCurrencyFacts,
  };
}

function parseQuote(value: unknown): QuoteView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "proposalId",
      "revision",
      "totalMinor",
      "currency",
      "draftedAt",
      "acceptedAt",
    ])
  )
    return null;
  const proposalId = uuid(pick(value, "proposalId"));
  const revision = whole(pick(value, "revision"));
  const totalMinor = optional(value, "totalMinor", whole);
  const currency = pick(value, "currency");
  const draftedAt = whole(pick(value, "draftedAt"));
  const acceptedAt = optional(value, "acceptedAt", whole);
  if (
    !proposalId ||
    revision === null ||
    revision < 1 ||
    totalMinor === undefined ||
    typeof currency !== "string" ||
    !CURRENCY_PATTERN.test(currency) ||
    draftedAt === null ||
    acceptedAt === undefined
  )
    return null;
  return { proposalId, revision, totalMinor, currency, draftedAt, acceptedAt };
}

function parseChats(value: unknown): ChatsView | null {
  if (!isObject(value) || !hasOnlyKeys(value, ["whatsapp", "emailCount"]))
    return null;
  const emailCount = whole(pick(value, "emailCount"));
  if (emailCount === null) return null;
  const raw = pick(value, "whatsapp");
  if (raw === undefined || raw === null) return { whatsapp: null, emailCount };
  if (
    !isObject(raw) ||
    !hasOnlyKeys(raw, [
      "waId",
      "messageCount",
      "inboundCount",
      "outboundCount",
      "lastMessageAt",
      "optedOut",
    ])
  )
    return null;
  const waId = pick(raw, "waId");
  const messageCount = whole(pick(raw, "messageCount"));
  const inboundCount = whole(pick(raw, "inboundCount"));
  const outboundCount = whole(pick(raw, "outboundCount"));
  const lastMessageAt = optional(raw, "lastMessageAt", whole);
  const optedOut = pick(raw, "optedOut");
  if (
    typeof waId !== "string" ||
    !/^[0-9]{5,20}$/.test(waId) ||
    messageCount === null ||
    inboundCount === null ||
    outboundCount === null ||
    inboundCount + outboundCount !== messageCount ||
    lastMessageAt === undefined ||
    typeof optedOut !== "boolean"
  )
    return null;
  return {
    whatsapp: {
      waId,
      messageCount,
      inboundCount,
      outboundCount,
      lastMessageAt,
      optedOut,
    },
    emailCount,
  };
}

function parseProject(value: unknown): ProjectView | null | undefined {
  if (value === undefined || value === null) return null;
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "jobId",
      "title",
      "playbookTitle",
      "status",
      "currentStepId",
      "currentStepTitle",
      "stepNumber",
      "stepCount",
      "startedAt",
      "endedAt",
    ])
  )
    return undefined;
  const jobId = text(pick(value, "jobId"), 64);
  const title = text(pick(value, "title"), 400);
  const playbookTitle = text(pick(value, "playbookTitle"), 400);
  const status = pick(value, "status");
  const currentStepId = optional(value, "currentStepId", (raw) =>
    text(raw, 64),
  );
  const currentStepTitle = optional(value, "currentStepTitle", (raw) =>
    text(raw, 400),
  );
  const stepNumber = optional(value, "stepNumber", whole);
  const stepCount = whole(pick(value, "stepCount"));
  const startedAt = whole(pick(value, "startedAt"));
  const endedAt = optional(value, "endedAt", whole);
  if (
    !jobId ||
    !title ||
    !playbookTitle ||
    typeof status !== "string" ||
    !JOB_STATUSES.has(status) ||
    currentStepId === undefined ||
    currentStepTitle === undefined ||
    stepNumber === undefined ||
    stepCount === null ||
    startedAt === null ||
    endedAt === undefined ||
    (stepNumber !== null && (stepNumber < 1 || stepNumber > stepCount))
  )
    return undefined;
  return {
    jobId,
    title,
    playbookTitle,
    status: status as JobStatus,
    currentStepId,
    currentStepTitle,
    stepNumber,
    stepCount,
    startedAt,
    endedAt,
  };
}

function parseMilestone(value: unknown): MilestoneView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "milestoneId",
      "kind",
      "title",
      "at",
      "note",
      "fileRef",
      "byPubkey",
      "recordedAt",
    ])
  )
    return null;
  const milestoneId = hexId(pick(value, "milestoneId"));
  const kind = pick(value, "kind");
  const title = optional(value, "title", (raw) => text(raw, MAX_TEXT));
  const at = whole(pick(value, "at"));
  const note = optional(value, "note", (raw) => text(raw, MAX_TEXT));
  const fileRef = optional(value, "fileRef", (raw) => text(raw, MAX_FILE_REF));
  const byPubkey = pubkey(pick(value, "byPubkey"));
  const recordedAt = whole(pick(value, "recordedAt"));
  if (
    !milestoneId ||
    typeof kind !== "string" ||
    !MILESTONE_KINDS.has(kind) ||
    title === undefined ||
    at === null ||
    note === undefined ||
    fileRef === undefined ||
    !byPubkey ||
    recordedAt === null ||
    (kind === "other") !== (title !== null)
  )
    return null;
  return {
    milestoneId,
    kind: kind as MilestoneKind,
    title,
    at,
    note,
    fileRef,
    byPubkey,
    recordedAt,
  };
}

function parseEmail(value: unknown): EmailView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["from", "subject", "date", "summary"])
  )
    return null;
  const from = text(pick(value, "from"), MAX_TEXT);
  const subject = text(pick(value, "subject"), MAX_TEXT);
  const date = whole(pick(value, "date"));
  const summary = pick(value, "summary");
  if (
    !from ||
    !subject ||
    date === null ||
    typeof summary !== "string" ||
    summary.trim().length === 0 ||
    new TextEncoder().encode(summary).length > MAX_EMAIL_SUMMARY_BYTES
  )
    return null;
  return { from, subject, date, summary };
}

function parseAttachment(value: unknown): AttachmentView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "attachmentId",
      "kind",
      "label",
      "fileRefs",
      "email",
      "addedByPubkey",
      "addedAt",
    ])
  )
    return null;
  const attachmentId = hexId(pick(value, "attachmentId"));
  const kind = pick(value, "kind");
  const label = text(pick(value, "label"), MAX_TEXT);
  const rawRefs = pick(value, "fileRefs");
  const email = optional(value, "email", parseEmail);
  const addedByPubkey = pubkey(pick(value, "addedByPubkey"));
  const addedAt = whole(pick(value, "addedAt"));
  if (
    !attachmentId ||
    typeof kind !== "string" ||
    !ATTACHMENT_KINDS.has(kind) ||
    !label ||
    !Array.isArray(rawRefs) ||
    rawRefs.length > 5 ||
    !rawRefs.every(
      (ref) => typeof ref === "string" && text(ref, MAX_FILE_REF) !== null,
    ) ||
    email === undefined ||
    (kind === "email") !== (email !== null) ||
    !addedByPubkey ||
    addedAt === null
  )
    return null;
  return {
    attachmentId,
    kind: kind as AttachmentKind,
    label,
    fileRefs: rawRefs as string[],
    email,
    addedByPubkey,
    addedAt,
  };
}

function parseList<T>(
  value: unknown,
  max: number,
  read: (item: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items: T[] = [];
  for (const raw of value) {
    const item = read(raw);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

/**
 * Read one customer record head. Returns null for anything the relay would not
 * write: a wrong signer, a d-tag that does not name the party, an unknown key
 * anywhere, a money figure without a currency.
 */
export function parseCustomerHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): CustomerRecordView | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_CUSTOMER_HEAD))
    return null;
  const dTagParty = parseCustomerDTag(oneTagValue(event, "d"));
  if (!dTagParty || event.tags.length !== 1) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "partyId",
      "displayName",
      "stage",
      "leadId",
      "clientId",
      "clientStatus",
      "found",
      "conversion",
      "money",
      "quotes",
      "chats",
      "project",
      "milestones",
      "attachments",
      "timeline",
      "computedAt",
      "updatedByPubkey",
      "updatedAt",
      "sourceActionEventId",
    ]) ||
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION
  )
    return null;
  const partyId = uuid(pick(content, "partyId"));
  const displayName = pick(content, "displayName");
  const stage = pick(content, "stage");
  const leadId = optional(content, "leadId", uuid);
  const clientId = optional(content, "clientId", uuid);
  const clientStatus = optional(content, "clientStatus", (raw) =>
    text(raw, 64),
  );
  const found = parseFound(pick(content, "found"));
  const conversion = parseConversion(pick(content, "conversion"));
  const money = parseMoney(pick(content, "money"));
  const quotes = parseList(pick(content, "quotes"), 1_000, parseQuote);
  const chats = parseChats(pick(content, "chats"));
  const project = parseProject(pick(content, "project"));
  const milestones = parseList(
    pick(content, "milestones"),
    MAX_CUSTOMER_MILESTONES,
    parseMilestone,
  );
  const attachments = parseList(
    pick(content, "attachments"),
    MAX_CUSTOMER_ATTACHMENTS,
    parseAttachment,
  );
  const timeline = parseList(
    pick(content, "timeline"),
    MAX_CUSTOMER_TIMELINE_ENTRIES,
    parseEntry,
  );
  const computedAt = whole(pick(content, "computedAt"));
  const updatedByPubkey = pubkey(pick(content, "updatedByPubkey"));
  const updatedAt = whole(pick(content, "updatedAt"));
  const sourceActionEventId = optional(content, "sourceActionEventId", hexId);
  if (
    !partyId ||
    partyId !== dTagParty ||
    typeof displayName !== "string" ||
    displayName.length > MAX_TEXT ||
    typeof stage !== "string" ||
    !STAGES.has(stage) ||
    leadId === undefined ||
    clientId === undefined ||
    clientStatus === undefined ||
    found === undefined ||
    conversion === undefined ||
    !money ||
    !quotes ||
    !chats ||
    project === undefined ||
    !milestones ||
    !attachments ||
    !timeline ||
    computedAt === null ||
    !updatedByPubkey ||
    updatedAt === null ||
    sourceActionEventId === undefined
  )
    return null;
  // A client has a conversion and a lead does not.
  if ((stage === "client") !== (conversion !== null)) return null;
  const ids = new Set<string>();
  for (const entry of timeline) {
    if (ids.has(entry.entryId)) return null;
    ids.add(entry.entryId);
  }
  return {
    partyId,
    displayName,
    stage: stage as CustomerStage,
    leadId,
    clientId,
    clientStatus,
    found,
    conversion,
    money,
    quotes,
    chats,
    project,
    milestones,
    attachments,
    timeline,
    computedAt,
    updatedByPubkey,
    updatedAt,
    sourceActionEventId,
    eventId: event.id,
    createdAt: event.created_at,
  };
}

/** The newest head per business wins; businesses are listed by name. */
export function buildCustomerRecords(
  parsed: ReadonlyArray<CustomerRecordView>,
): CustomerRecordView[] {
  const latest = new Map<string, CustomerRecordView>();
  for (const record of parsed) {
    const current = latest.get(record.partyId);
    if (
      !current ||
      record.createdAt > current.createdAt ||
      (record.createdAt === current.createdAt &&
        record.eventId.localeCompare(current.eventId) < 0)
    ) {
      latest.set(record.partyId, record);
    }
  }
  return [...latest.values()].sort(
    (first, second) =>
      first.displayName.localeCompare(second.displayName) ||
      first.partyId.localeCompare(second.partyId),
  );
}

/** "step 3 of 7", or null when the project has no current step. */
export function projectStepLabel(project: ProjectView | null): string | null {
  if (!project || project.stepNumber === null) return null;
  return `step ${project.stepNumber} of ${project.stepCount}`;
}

/** True while a refresh would be a no-op: the relay recounts at most once a minute. */
export function customerRefreshIsFresh(
  record: CustomerRecordView,
  nowSeconds: number,
): boolean {
  return nowSeconds - record.computedAt < CUSTOMER_REFRESH_FRESH_SECS;
}

/** The latest recorded milestone of a kind, or null. */
export function latestMilestone(
  record: CustomerRecordView,
  kind: MilestoneKind,
): MilestoneView | null {
  const matching = record.milestones.filter(
    (milestone) => milestone.kind === kind,
  );
  return matching.length === 0 ? null : matching[matching.length - 1];
}
