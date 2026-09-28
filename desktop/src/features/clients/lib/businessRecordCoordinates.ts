import {
  KIND_STREAM_MESSAGE,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";
import { BusinessRecordParseError } from "./businessRecordErrors";
import type {
  BusinessEventTemplate,
  EventRecord,
  WorkItemHead,
} from "./businessRecords";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_32_RE = /^[0-9a-f]{64}$/;

function assertUuid(value: string, label: string): void {
  if (!UUID_RE.test(value)) throw new Error(`${label} must be a UUID`);
}

function assertHex32(value: string, label: string): void {
  if (!HEX_32_RE.test(value)) {
    throw new Error(`${label} must be 32-byte lowercase hex`);
  }
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

export function clientDTag(clientId: string): string {
  assertUuid(clientId, "client id");
  const normalized = clientId.toLowerCase();
  return `client:${normalized}:client:${normalized}`;
}

export function workItemDTag(clientId: string, workItemId: string): string {
  assertUuid(clientId, "client id");
  assertUuid(workItemId, "work item id");
  return `client:${clientId.toLowerCase()}:work:${workItemId.toLowerCase()}`;
}

export function buildWorkItemReferenceTag(
  record: EventRecord<WorkItemHead>,
): string[] {
  const { clientId, workItemId } = record.value;
  const dTag = workItemDTag(clientId, workItemId);
  assertHex32(record.event.pubkey, "work item head author");
  if (
    record.event.kind !== KIND_WORK_ITEM_HEAD ||
    readUniqueTag(record.event, "h").toLowerCase() !== clientId.toLowerCase() ||
    readUniqueTag(record.event, "d") !== dTag
  ) {
    throw new BusinessRecordParseError(
      "work item reference must match its exact client head",
    );
  }
  return [
    "a",
    `${KIND_WORK_ITEM_HEAD}:${record.event.pubkey.toLowerCase()}:${dTag}`,
  ];
}

export function parseWorkItemReferenceCoordinate(
  coordinate: string,
  clientId: string,
): { authorPubkey: string; dTag: string; workItemId: string } | null {
  try {
    assertUuid(clientId, "client channel id");
  } catch {
    return null;
  }
  const firstSeparator = coordinate.indexOf(":");
  const secondSeparator = coordinate.indexOf(":", firstSeparator + 1);
  if (firstSeparator < 1 || secondSeparator < 0) return null;
  const kind = Number(coordinate.slice(0, firstSeparator));
  const authorPubkey = coordinate.slice(firstSeparator + 1, secondSeparator);
  const dTag = coordinate.slice(secondSeparator + 1);
  if (kind !== KIND_WORK_ITEM_HEAD || !HEX_32_RE.test(authorPubkey))
    return null;
  const prefix = `client:${clientId.toLowerCase()}:work:`;
  if (!dTag.startsWith(prefix)) return null;
  const workItemId = dTag.slice(prefix.length);
  try {
    assertUuid(workItemId, "work item id");
    if (workItemDTag(clientId, workItemId) !== dTag) return null;
  } catch {
    return null;
  }
  return { authorPubkey, dTag, workItemId: workItemId.toLowerCase() };
}

export function buildWorkItemReferenceMessageTemplate(
  record: EventRecord<WorkItemHead>,
  senderPubkey: string,
): BusinessEventTemplate {
  assertHex32(senderPubkey, "message author");
  return {
    kind: KIND_STREAM_MESSAGE,
    content: "",
    tags: [
      ["h", record.value.clientId.toLowerCase()],
      ["p", senderPubkey.toLowerCase()],
      buildWorkItemReferenceTag(record),
    ],
  };
}

export function deliverableVersionDTag(
  clientId: string,
  deliverableId: string,
  version: number,
): string {
  assertUuid(clientId, "client id");
  assertUuid(deliverableId, "deliverable id");
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("deliverable version must be a positive integer");
  }
  return (
    "client:" +
    clientId.toLowerCase() +
    ":deliverable:" +
    deliverableId.toLowerCase() +
    ":version:" +
    version
  );
}

export function deliverableApprovalDTag(
  clientId: string,
  versionEventId: string,
): string {
  assertUuid(clientId, "client id");
  assertHex32(versionEventId, "version event id");
  return (
    "client:" +
    clientId.toLowerCase() +
    ":deliverable-approval:" +
    versionEventId
  );
}
