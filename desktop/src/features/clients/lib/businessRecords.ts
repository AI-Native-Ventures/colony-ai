import { utf8ToBytes } from "@noble/hashes/utils.js";

import {
  KIND_CLIENT_ACTION,
  KIND_CLIENT_HEAD,
  KIND_DELIVERABLE_APPROVAL,
  KIND_DELIVERABLE_VERSION,
  KIND_WORK_ITEM_ACTION,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import { MAX_EXPLICIT_CHANNEL_VALUES } from "@/shared/api/relayClientShared";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayClient } from "@/shared/api/relayClientSession";
import {
  BusinessRecordLimitError,
  BusinessRecordParseError,
} from "./businessRecordErrors";
import {
  clientDTag,
  deliverableApprovalDTag,
  deliverableVersionDTag,
  workItemDTag,
} from "./businessRecordCoordinates";
import {
  computeDeliverableContentDigest,
  computeDeliverableDigests,
} from "./businessRecordDigests";
export {
  buildWorkItemReferenceMessageTemplate,
  buildWorkItemReferenceTag,
  clientDTag,
  deliverableApprovalDTag,
  deliverableVersionDTag,
  parseWorkItemReferenceCoordinate,
  workItemDTag,
} from "./businessRecordCoordinates";
export {
  canonicalJson,
  computeDeliverableDigests,
  MAX_DELIVERABLE_BODY_BYTES,
} from "./businessRecordDigests";

export const BUSINESS_RECORD_SCHEMA_VERSION = 1;
export const MAX_CLIENT_CHANNELS_TO_SCAN = 4096;
export const MAX_WORK_CLIENT_CHANNELS = 128;
export const MAX_CURRENT_WORK_ITEMS = 500;
export const MAX_DELIVERABLE_EVENTS = 1000;
export const MAX_BUSINESS_EVENT_BYTES = 1_000_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32_RE = /^[0-9a-f]{64}$/;
const MUTATION_KINDS = new Set([
  KIND_CLIENT_ACTION,
  KIND_WORK_ITEM_ACTION,
  KIND_DELIVERABLE_VERSION,
  KIND_DELIVERABLE_APPROVAL,
]);

export type RecordAction = "create" | "update" | "archive" | "restore";
export type ApprovalDecision = "approved" | "changes_requested" | "rejected";

export type ClientHead = {
  schemaVersion: number;
  clientId: string;
  partyId: string;
  displayName: string;
  approverPubkeys: string[];
  status: string;
  sourceActionEventId: string;
};

export type DeliverablePointer = {
  deliverableId: string;
  versionEventId: string;
  contentDigest: string;
  mediaDigest: string;
  versionDigest: string;
};

export type WorkItemHead = {
  schemaVersion: number;
  clientId: string;
  workItemId: string;
  title: string;
  status: string;
  assignedPubkeys: string[];
  approverPubkeys: string[];
  deliverables: DeliverablePointer[];
  sourceEventId: string;
};

export type DeliverableVersion = {
  schemaVersion: number;
  clientId: string;
  workItemId: string;
  deliverableId: string;
  version: number;
  previousVersionEventId: string | null;
  contentDigest: string;
  mediaDigests: string[];
  body: unknown;
};

export type DeliverableApproval = {
  schemaVersion: number;
  clientId: string;
  workItemId: string;
  deliverableId: string;
  versionEventId: string;
  contentDigest: string;
  mediaDigest: string;
  decision: ApprovalDecision;
  note: string | null;
};

export type ClientActionInput = {
  schemaVersion: number;
  clientId: string;
  action: RecordAction;
  expectedHeadEventId: string | null;
  head: Omit<ClientHead, "sourceActionEventId">;
};

export type WorkItemActionInput = {
  schemaVersion: number;
  clientId: string;
  workItemId: string;
  action: RecordAction;
  expectedHeadEventId: string | null;
  head: Omit<WorkItemHead, "sourceEventId">;
};

export type BusinessEventTemplate = {
  kind: number;
  content: string;
  tags: string[][];
};

export type BusinessRecordRelay = Pick<
  RelayClient,
  "fetchEvents" | "publishEvent" | "subscribeLive"
>;

export type BusinessRecordSigner = typeof signRelayEvent;

export type EventRecord<T> = {
  event: RelayEvent;
  value: T;
};

export {
  BusinessRecordLimitError,
  BusinessRecordParseError,
} from "./businessRecordErrors";

export function isBusinessRecordCommandRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /^(conflict|forbidden|invalid|restricted):/i.test(
    error.message.trim(),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new BusinessRecordParseError(`${label}.${key} must be a string`);
  }
  return value;
}

function readUuid(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);
  if (!UUID_RE.test(value)) {
    throw new BusinessRecordParseError(`${label}.${key} must be a UUID`);
  }
  return value.toLowerCase();
}

function readPubkeys(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && HEX_32_RE.test(item))
  ) {
    throw new BusinessRecordParseError(
      `${label}.${key} must be pubkey hex values`,
    );
  }
  return value.map((item) => (item as string).toLowerCase());
}

function readDigest(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);
  if (!HEX_32_RE.test(value)) {
    throw new BusinessRecordParseError(
      `${label}.${key} must be a SHA-256 digest`,
    );
  }
  return value;
}

function readOptionalEventId(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || !HEX_32_RE.test(value)) {
    throw new BusinessRecordParseError(
      `${label}.${key} must be an event id or null`,
    );
  }
  return value;
}

function readEventId(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = readString(record, key, label);
  if (!HEX_32_RE.test(value)) {
    throw new BusinessRecordParseError(`${label}.${key} must be an event id`);
  }
  return value;
}

function parseContent(event: RelayEvent): Record<string, unknown> {
  if (utf8ToBytes(event.content).byteLength > MAX_BUSINESS_EVENT_BYTES) {
    throw new BusinessRecordLimitError(
      "business record event exceeds the content limit",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(event.content) as unknown;
  } catch {
    throw new BusinessRecordParseError("business record content is not JSON");
  }
  if (!isRecord(value)) {
    throw new BusinessRecordParseError(
      "business record content must be an object",
    );
  }
  if (value.schemaVersion !== BUSINESS_RECORD_SCHEMA_VERSION) {
    throw new BusinessRecordParseError(
      "unsupported business record schema version",
    );
  }
  return value;
}

function readUniqueTag(event: RelayEvent, name: string): string {
  const values = event.tags.filter((tag) => tag[0] === name);
  if (values.length !== 1 || typeof values[0]?.[1] !== "string") {
    throw new BusinessRecordParseError(
      `business record requires exactly one ${name} tag`,
    );
  }
  return values[0][1];
}

function validateChannelAndDTag(
  event: RelayEvent,
  expectedClientId: string,
  expectedDTag: string,
): void {
  const channelId = readUniqueTag(event, "h").toLowerCase();
  const dTag = readUniqueTag(event, "d");
  if (channelId !== expectedClientId.toLowerCase()) {
    throw new BusinessRecordParseError(
      "business record is outside its client channel",
    );
  }
  if (dTag !== expectedDTag) {
    throw new BusinessRecordParseError(
      "business record d tag does not match its coordinate",
    );
  }
}

function parseDeliverablePointer(value: unknown): DeliverablePointer {
  if (!isRecord(value)) {
    throw new BusinessRecordParseError(
      "work item deliverable pointer must be an object",
    );
  }
  return {
    deliverableId: readUuid(value, "deliverableId", "deliverable pointer"),
    versionEventId: readEventId(value, "versionEventId", "deliverable pointer"),
    contentDigest: readDigest(value, "contentDigest", "deliverable pointer"),
    mediaDigest: readDigest(value, "mediaDigest", "deliverable pointer"),
    versionDigest: readDigest(value, "versionDigest", "deliverable pointer"),
  };
}

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} must be a UUID`);
}

function assertHex32(value: string, label: string): void {
  if (!HEX_32_RE.test(value)) {
    throw new Error(`${label} must be 32-byte lowercase hex`);
  }
}

export function parseClientHead(event: RelayEvent): EventRecord<ClientHead> {
  if (event.kind !== KIND_CLIENT_HEAD) {
    throw new BusinessRecordParseError("event is not a client head");
  }
  const channelId = readUniqueTag(event, "h").toLowerCase();
  assertUuid(channelId, "client channel id");
  validateChannelAndDTag(event, channelId, clientDTag(channelId));
  const record = parseContent(event);
  const clientId = readUuid(record, "clientId", "client head");
  if (clientId !== channelId) {
    throw new BusinessRecordParseError(
      "client head id does not match its channel",
    );
  }
  const displayName = readString(record, "displayName", "client head").trim();
  const status = readString(record, "status", "client head").trim();
  if (!displayName || !status) {
    throw new BusinessRecordParseError(
      "client head name and status are required",
    );
  }
  return {
    event,
    value: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId,
      partyId: readUuid(record, "partyId", "client head"),
      displayName,
      approverPubkeys: readPubkeys(record, "approverPubkeys", "client head"),
      status,
      sourceActionEventId: readEventId(
        record,
        "sourceActionEventId",
        "client head",
      ),
    },
  };
}

export function parseWorkItemHead(
  event: RelayEvent,
): EventRecord<WorkItemHead> {
  if (event.kind !== KIND_WORK_ITEM_HEAD) {
    throw new BusinessRecordParseError("event is not a work item head");
  }
  const channelId = readUniqueTag(event, "h").toLowerCase();
  assertUuid(channelId, "client channel id");
  const record = parseContent(event);
  const clientId = readUuid(record, "clientId", "work item head");
  const workItemId = readUuid(record, "workItemId", "work item head");
  validateChannelAndDTag(event, clientId, workItemDTag(clientId, workItemId));
  if (clientId !== channelId) {
    throw new BusinessRecordParseError(
      "work item id does not match its client channel",
    );
  }
  const title = readString(record, "title", "work item head").trim();
  const status = readString(record, "status", "work item head").trim();
  if (!title || !status) {
    throw new BusinessRecordParseError(
      "work item title and status are required",
    );
  }
  const rawDeliverables = record.deliverables;
  if (!Array.isArray(rawDeliverables)) {
    throw new BusinessRecordParseError(
      "work item deliverables must be an array",
    );
  }
  return {
    event,
    value: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId,
      workItemId,
      title,
      status,
      assignedPubkeys: readPubkeys(record, "assignedPubkeys", "work item head"),
      approverPubkeys: readPubkeys(record, "approverPubkeys", "work item head"),
      deliverables: rawDeliverables.map(parseDeliverablePointer),
      sourceEventId: readEventId(record, "sourceEventId", "work item head"),
    },
  };
}

export function parseDeliverableVersion(
  event: RelayEvent,
): EventRecord<DeliverableVersion> {
  if (event.kind !== KIND_DELIVERABLE_VERSION) {
    throw new BusinessRecordParseError("event is not a deliverable version");
  }
  const channelId = readUniqueTag(event, "h").toLowerCase();
  assertUuid(channelId, "client channel id");
  const record = parseContent(event);
  const clientId = readUuid(record, "clientId", "deliverable version");
  const workItemId = readUuid(record, "workItemId", "deliverable version");
  const deliverableId = readUuid(
    record,
    "deliverableId",
    "deliverable version",
  );
  const version = record.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new BusinessRecordParseError(
      "deliverable version must be a positive integer",
    );
  }
  validateChannelAndDTag(
    event,
    clientId,
    deliverableVersionDTag(clientId, deliverableId, version as number),
  );
  if (clientId !== channelId) {
    throw new BusinessRecordParseError(
      "deliverable version is outside its client channel",
    );
  }
  const mediaDigests = record.mediaDigests;
  if (
    !Array.isArray(mediaDigests) ||
    !mediaDigests.every(
      (item) => typeof item === "string" && HEX_32_RE.test(item),
    )
  ) {
    throw new BusinessRecordParseError("deliverable media digests are invalid");
  }
  const normalizedMedia = mediaDigests.map((item) =>
    (item as string).toLowerCase(),
  );
  if (
    normalizedMedia.some(
      (digest, index) =>
        index > 0 && (normalizedMedia[index - 1] ?? "") >= digest,
    )
  ) {
    throw new BusinessRecordParseError(
      "deliverable media digests are not sorted and unique",
    );
  }
  const bodyDigest = computeDeliverableContentDigest(record.body);
  const contentDigest = readDigest(
    record,
    "contentDigest",
    "deliverable version",
  );
  if (bodyDigest !== contentDigest) {
    throw new BusinessRecordParseError(
      "deliverable content digest does not match its body",
    );
  }
  return {
    event,
    value: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId,
      workItemId,
      deliverableId,
      version: version as number,
      previousVersionEventId: readOptionalEventId(
        record,
        "previousVersionEventId",
        "deliverable version",
      ),
      contentDigest,
      mediaDigests: normalizedMedia,
      body: record.body,
    },
  };
}

export function parseDeliverableApproval(
  event: RelayEvent,
): EventRecord<DeliverableApproval> {
  if (event.kind !== KIND_DELIVERABLE_APPROVAL) {
    throw new BusinessRecordParseError("event is not a deliverable approval");
  }
  const channelId = readUniqueTag(event, "h").toLowerCase();
  assertUuid(channelId, "client channel id");
  const record = parseContent(event);
  const clientId = readUuid(record, "clientId", "deliverable approval");
  const versionEventId = readEventId(
    record,
    "versionEventId",
    "deliverable approval",
  );
  validateChannelAndDTag(
    event,
    clientId,
    deliverableApprovalDTag(clientId, versionEventId),
  );
  if (clientId !== channelId) {
    throw new BusinessRecordParseError(
      "deliverable approval is outside its client channel",
    );
  }
  const decision = readString(record, "decision", "deliverable approval");
  if (
    decision !== "approved" &&
    decision !== "changes_requested" &&
    decision !== "rejected"
  ) {
    throw new BusinessRecordParseError(
      "deliverable approval decision is invalid",
    );
  }
  const note = record.note;
  if (note !== null && typeof note !== "string") {
    throw new BusinessRecordParseError(
      "deliverable approval note must be a string or null",
    );
  }
  return {
    event,
    value: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId,
      workItemId: readUuid(record, "workItemId", "deliverable approval"),
      deliverableId: readUuid(record, "deliverableId", "deliverable approval"),
      versionEventId,
      contentDigest: readDigest(
        record,
        "contentDigest",
        "deliverable approval",
      ),
      mediaDigest: readDigest(record, "mediaDigest", "deliverable approval"),
      decision,
      note,
    },
  };
}

function validateExpectedHead(
  action: RecordAction,
  expectedHeadEventId: string | null,
  label: string,
): void {
  if (action === "create" && expectedHeadEventId !== null) {
    throw new Error(`${label} create must not have an expected head id`);
  }
  if (action !== "create" && expectedHeadEventId === null) {
    throw new Error(`${label} mutation requires an expected head id`);
  }
  if (expectedHeadEventId !== null) {
    assertHex32(expectedHeadEventId, `expected ${label} head event id`);
  }
}

export function buildClientActionTemplate(
  input: ClientActionInput,
): BusinessEventTemplate {
  assertUuid(input.clientId, "client id");
  if (input.head.clientId.toLowerCase() !== input.clientId.toLowerCase()) {
    throw new Error("client action head must match the client channel");
  }
  if (input.head.schemaVersion !== BUSINESS_RECORD_SCHEMA_VERSION) {
    throw new Error("unsupported client head schema version");
  }
  if (input.schemaVersion !== BUSINESS_RECORD_SCHEMA_VERSION) {
    throw new Error("unsupported client action schema version");
  }
  validateExpectedHead(input.action, input.expectedHeadEventId, "client");
  assertUuid(input.head.partyId, "party id");
  if (!input.head.displayName.trim() || !input.head.status.trim()) {
    throw new Error("client name and status are required");
  }
  for (const pubkey of input.head.approverPubkeys) {
    assertHex32(pubkey, "approver pubkey");
  }
  return {
    kind: KIND_CLIENT_ACTION,
    content: JSON.stringify(input),
    tags: [
      ["h", input.clientId.toLowerCase()],
      ["d", clientDTag(input.clientId)],
    ],
  };
}

export function buildWorkItemActionTemplate(
  input: WorkItemActionInput,
): BusinessEventTemplate {
  assertUuid(input.clientId, "client id");
  assertUuid(input.workItemId, "work item id");
  if (
    input.head.clientId.toLowerCase() !== input.clientId.toLowerCase() ||
    input.head.workItemId.toLowerCase() !== input.workItemId.toLowerCase()
  ) {
    throw new Error("work item action head must match its client and work ids");
  }
  if (input.head.schemaVersion !== BUSINESS_RECORD_SCHEMA_VERSION) {
    throw new Error("unsupported work item head schema version");
  }
  if (input.schemaVersion !== BUSINESS_RECORD_SCHEMA_VERSION) {
    throw new Error("unsupported work item action schema version");
  }
  validateExpectedHead(input.action, input.expectedHeadEventId, "work item");
  if (!input.head.title.trim() || !input.head.status.trim()) {
    throw new Error("work item title and status are required");
  }
  for (const pubkey of [
    ...input.head.assignedPubkeys,
    ...input.head.approverPubkeys,
  ]) {
    assertHex32(pubkey, "work item pubkey");
  }
  if (input.action === "create" && input.head.deliverables.length !== 0) {
    throw new Error("work item creation cannot supply deliverable pointers");
  }
  return {
    kind: KIND_WORK_ITEM_ACTION,
    content: JSON.stringify(input),
    tags: [
      ["h", input.clientId.toLowerCase()],
      ["d", workItemDTag(input.clientId, input.workItemId)],
    ],
  };
}

export function buildDeliverableVersionTemplate(
  version: Omit<DeliverableVersion, "schemaVersion" | "contentDigest">,
): BusinessEventTemplate {
  assertUuid(version.clientId, "client id");
  assertUuid(version.workItemId, "work item id");
  assertUuid(version.deliverableId, "deliverable id");
  if (!Number.isInteger(version.version) || version.version < 1) {
    throw new Error("deliverable version must be a positive integer");
  }
  if (
    version.previousVersionEventId !== null &&
    !HEX_32_RE.test(version.previousVersionEventId)
  ) {
    throw new Error("previous deliverable version event id is invalid");
  }
  const digests = computeDeliverableDigests(version.body, version.mediaDigests);
  const content: DeliverableVersion = {
    ...version,
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    mediaDigests: digests.sortedMediaDigests,
    contentDigest: digests.contentDigest,
  };
  return {
    kind: KIND_DELIVERABLE_VERSION,
    content: JSON.stringify(content),
    tags: [
      ["h", content.clientId.toLowerCase()],
      [
        "d",
        deliverableVersionDTag(
          content.clientId,
          content.deliverableId,
          content.version,
        ),
      ],
    ],
  };
}

export function buildDeliverableApprovalTemplate(
  approval: DeliverableApproval,
): BusinessEventTemplate {
  assertUuid(approval.clientId, "client id");
  assertUuid(approval.workItemId, "work item id");
  assertUuid(approval.deliverableId, "deliverable id");
  assertHex32(approval.versionEventId, "version event id");
  assertHex32(approval.contentDigest, "content digest");
  assertHex32(approval.mediaDigest, "media digest");
  if (
    approval.decision !== "approved" &&
    approval.decision !== "changes_requested" &&
    approval.decision !== "rejected"
  ) {
    throw new Error("deliverable approval decision is invalid");
  }
  return {
    kind: KIND_DELIVERABLE_APPROVAL,
    content: JSON.stringify({
      ...approval,
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    }),
    tags: [
      ["h", approval.clientId.toLowerCase()],
      [
        "d",
        deliverableApprovalDTag(approval.clientId, approval.versionEventId),
      ],
    ],
  };
}

function clientScopeFromTemplate(
  template: BusinessEventTemplate,
  checkKind: boolean,
): string {
  if (checkKind && !MUTATION_KINDS.has(template.kind)) {
    throw new Error("event kind is not a supported business command");
  }
  const hTags = template.tags.filter((tag) => tag[0] === "h");
  const dTags = template.tags.filter((tag) => tag[0] === "d");
  if (
    hTags.length !== 1 ||
    dTags.length !== 1 ||
    !hTags[0]?.[1] ||
    !dTags[0]?.[1]
  ) {
    throw new Error("business commands require one h tag and one d tag");
  }
  const clientId = hTags[0][1].toLowerCase();
  assertUuid(clientId, "client channel id");
  if (utf8ToBytes(template.content).byteLength > MAX_BUSINESS_EVENT_BYTES) {
    throw new BusinessRecordLimitError(
      "business record command exceeds the content limit",
    );
  }
  let record: unknown;
  try {
    record = JSON.parse(template.content) as unknown;
  } catch {
    throw new Error("business record command content is not JSON");
  }
  if (!isRecord(record)) {
    throw new Error("business record command content must be an object");
  }
  if (record.schemaVersion !== BUSINESS_RECORD_SCHEMA_VERSION) {
    throw new Error("unsupported business record command schema version");
  }
  let expectedDTag: string;
  switch (template.kind) {
    case KIND_CLIENT_ACTION: {
      const commandClientId = readUuid(record, "clientId", "client action");
      const head = record.head;
      if (
        !isRecord(head) ||
        readUuid(head, "clientId", "client action head") !== commandClientId
      ) {
        throw new Error("client action head must match the client channel");
      }
      expectedDTag = clientDTag(commandClientId);
      break;
    }
    case KIND_WORK_ITEM_ACTION: {
      const commandClientId = readUuid(record, "clientId", "work item action");
      const workItemId = readUuid(record, "workItemId", "work item action");
      const head = record.head;
      if (
        !isRecord(head) ||
        readUuid(head, "clientId", "work item action head") !==
          commandClientId ||
        readUuid(head, "workItemId", "work item action head") !== workItemId
      ) {
        throw new Error("work item action head must match its coordinates");
      }
      expectedDTag = workItemDTag(commandClientId, workItemId);
      break;
    }
    case KIND_DELIVERABLE_VERSION: {
      const commandClientId = readUuid(
        record,
        "clientId",
        "deliverable version",
      );
      const deliverableId = readUuid(
        record,
        "deliverableId",
        "deliverable version",
      );
      if (!Number.isInteger(record.version) || (record.version as number) < 1) {
        throw new Error("deliverable version must be a positive integer");
      }
      expectedDTag = deliverableVersionDTag(
        commandClientId,
        deliverableId,
        record.version as number,
      );
      break;
    }
    case KIND_DELIVERABLE_APPROVAL: {
      const commandClientId = readUuid(
        record,
        "clientId",
        "deliverable approval",
      );
      const versionEventId = readEventId(
        record,
        "versionEventId",
        "deliverable approval",
      );
      expectedDTag = deliverableApprovalDTag(commandClientId, versionEventId);
      break;
    }
    default:
      throw new Error("event kind is not a supported business command");
  }
  if (clientId !== readUuid(record, "clientId", "business command")) {
    throw new Error("business command is outside its client channel");
  }
  if (dTags[0][1] !== expectedDTag) {
    throw new Error("business command d tag does not match its coordinates");
  }
  return clientId;
}

export function createBusinessRecordService(
  relay: BusinessRecordRelay = relayClient,
  signer: BusinessRecordSigner = signRelayEvent,
) {
  async function fetchManyChannels(
    channelIds: readonly string[],
    kinds: number[],
  ): Promise<RelayEvent[]> {
    if (channelIds.length > MAX_CLIENT_CHANNELS_TO_SCAN) {
      throw new BusinessRecordLimitError(
        "Too many client channels to load in one request",
      );
    }
    const normalized = [
      ...new Set(
        channelIds.map((id) => {
          assertUuid(id, "client channel id");
          return id.toLowerCase();
        }),
      ),
    ];
    const events: RelayEvent[] = [];
    for (
      let index = 0;
      index < normalized.length;
      index += MAX_EXPLICIT_CHANNEL_VALUES
    ) {
      const batch = normalized.slice(
        index,
        index + MAX_EXPLICIT_CHANNEL_VALUES,
      );
      const response = await relay.fetchEvents({
        kinds,
        "#h": batch,
        limit: batch.length,
      });
      events.push(...response);
    }
    return events;
  }

  async function sign(template: BusinessEventTemplate): Promise<RelayEvent> {
    clientScopeFromTemplate(template, true);
    return signer({
      kind: template.kind,
      content: template.content,
      tags: template.tags,
    });
  }

  async function publish(event: RelayEvent): Promise<RelayEvent> {
    const clientId = clientScopeFromTemplate(
      { kind: event.kind, content: event.content, tags: event.tags },
      true,
    );
    try {
      await relay.publishEvent(
        event,
        "Timed out publishing the business record",
        "Failed to publish the business record",
      );
      return event;
    } catch (publishError) {
      try {
        const observed = await relay.fetchEvents({
          ids: [event.id],
          kinds: [event.kind],
          "#h": [clientId],
          limit: 1,
        });
        if (
          observed.some(
            (candidate) =>
              candidate.id === event.id &&
              candidate.kind === event.kind &&
              candidate.tags.some(
                (tag) => tag[0] === "h" && tag[1] === clientId,
              ),
          )
        ) {
          return event;
        }
      } catch (readError) {
        throw new AggregateError(
          [publishError, readError],
          "Could not confirm whether the business record was saved",
        );
      }
      throw publishError;
    }
  }

  return {
    async listClientHeads(channelIds: readonly string[]) {
      if (channelIds.length === 0) return [];
      const events = await fetchManyChannels(channelIds, [KIND_CLIENT_HEAD]);
      const records = events.map(parseClientHead);
      const allowed = new Set(
        channelIds.map((id) => {
          assertUuid(id, "client channel id");
          return id.toLowerCase();
        }),
      );
      if (records.some((record) => !allowed.has(record.value.clientId))) {
        throw new BusinessRecordParseError(
          "client head query returned another client channel",
        );
      }
      return records;
    },

    async getClientHead(clientId: string) {
      assertUuid(clientId, "client id");
      const events = await relay.fetchEvents({
        kinds: [KIND_CLIENT_HEAD],
        "#h": [clientId.toLowerCase()],
        "#d": [clientDTag(clientId)],
        limit: 2,
      });
      if (events.length > 1) {
        throw new BusinessRecordParseError(
          "client head coordinate is not unique",
        );
      }
      return events[0] ? parseClientHead(events[0]) : null;
    },

    async listWorkItemHeads(clientId: string) {
      assertUuid(clientId, "client id");
      const events = await relay.fetchEvents({
        kinds: [KIND_WORK_ITEM_HEAD],
        "#h": [clientId.toLowerCase()],
        limit: MAX_CURRENT_WORK_ITEMS + 1,
      });
      if (events.length > MAX_CURRENT_WORK_ITEMS) {
        throw new BusinessRecordLimitError(
          "The client has too many work items to load in one request",
        );
      }
      const records = events.map(parseWorkItemHead);
      if (
        records.some(
          (record) => record.value.clientId !== clientId.toLowerCase(),
        )
      ) {
        throw new BusinessRecordParseError(
          "work item query returned another client",
        );
      }
      return records;
    },

    async listWorkItemHeadsForChannels(channelIds: readonly string[]) {
      if (channelIds.length > MAX_WORK_CLIENT_CHANNELS) {
        throw new BusinessRecordLimitError(
          "Too many client channels to load the shared work list",
        );
      }
      const normalized = [
        ...new Set(
          channelIds.map((id) => {
            assertUuid(id, "client channel id");
            return id.toLowerCase();
          }),
        ),
      ];
      const records: EventRecord<WorkItemHead>[] = [];
      for (
        let index = 0;
        index < normalized.length;
        index += MAX_EXPLICIT_CHANNEL_VALUES
      ) {
        const batch = normalized.slice(
          index,
          index + MAX_EXPLICIT_CHANNEL_VALUES,
        );
        const events = await relay.fetchEvents({
          kinds: [KIND_WORK_ITEM_HEAD],
          "#h": batch,
          limit: MAX_CURRENT_WORK_ITEMS + 1,
        });
        records.push(...events.map(parseWorkItemHead));
        if (records.length > MAX_CURRENT_WORK_ITEMS) {
          throw new BusinessRecordLimitError(
            "The shared work list exceeds the current record limit",
          );
        }
        if (records.some((record) => !batch.includes(record.value.clientId))) {
          throw new BusinessRecordParseError(
            "work item query returned another client channel",
          );
        }
      }
      return records;
    },

    async getWorkItemHead(clientId: string, workItemId: string) {
      assertUuid(clientId, "client id");
      assertUuid(workItemId, "work item id");
      const events = await relay.fetchEvents({
        kinds: [KIND_WORK_ITEM_HEAD],
        "#h": [clientId.toLowerCase()],
        "#d": [workItemDTag(clientId, workItemId)],
        limit: 2,
      });
      if (events.length > 1) {
        throw new BusinessRecordParseError(
          "work item coordinate is not unique",
        );
      }
      if (!events[0]) return null;
      const record = parseWorkItemHead(events[0]);
      if (
        record.value.clientId !== clientId.toLowerCase() ||
        record.value.workItemId !== workItemId.toLowerCase()
      ) {
        throw new BusinessRecordParseError(
          "work item query returned another record",
        );
      }
      return record;
    },

    async listDeliverableEvents(clientId: string, workItemId?: string) {
      assertUuid(clientId, "client id");
      if (workItemId !== undefined) assertUuid(workItemId, "work item id");
      const events = await relay.fetchEvents({
        kinds: [KIND_DELIVERABLE_VERSION, KIND_DELIVERABLE_APPROVAL],
        "#h": [clientId.toLowerCase()],
        limit: MAX_DELIVERABLE_EVENTS,
      });
      if (events.length >= MAX_DELIVERABLE_EVENTS) {
        throw new BusinessRecordLimitError(
          "The client has too much deliverable history to load in one request",
        );
      }
      const parsed = events.map((event) =>
        event.kind === KIND_DELIVERABLE_VERSION
          ? parseDeliverableVersion(event)
          : parseDeliverableApproval(event),
      );
      if (
        parsed.some(
          (record) => record.value.clientId !== clientId.toLowerCase(),
        )
      ) {
        throw new BusinessRecordParseError(
          "deliverable query returned another client",
        );
      }
      return workItemId
        ? parsed.filter(
            (record) => record.value.workItemId === workItemId.toLowerCase(),
          )
        : parsed;
    },

    sign,
    publish,

    async submit(template: BusinessEventTemplate) {
      const event = await sign(template);
      return { event, accepted: await publish(event) };
    },

    async subscribeToClient(
      clientId: string,
      onEvent: (event: RelayEvent) => void,
    ) {
      assertUuid(clientId, "client id");
      return relay.subscribeLive(
        {
          kinds: [
            KIND_CLIENT_HEAD,
            KIND_WORK_ITEM_HEAD,
            KIND_DELIVERABLE_VERSION,
            KIND_DELIVERABLE_APPROVAL,
          ],
          "#h": [clientId.toLowerCase()],
          limit: 1000,
          since: Math.floor(Date.now() / 1000),
        },
        onEvent,
      );
    },
  };
}

export const businessRecordService = createBusinessRecordService();
