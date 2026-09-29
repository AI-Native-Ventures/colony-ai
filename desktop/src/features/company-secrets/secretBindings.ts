import { verifyEvent } from "nostr-tools/pure";

import {
  decodeRelayAskHead,
  type AskHeadRecord,
} from "@/features/company-asks/askRecords";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_ASK_HEAD,
  KIND_SECRET_BINDING_ACTION,
  KIND_SECRET_BINDING_HEAD,
} from "@/shared/constants/kinds";

export type SecretStorage = "device" | "server";
export type SecretBindingStatus = "pending" | "active" | "revoked";

export type SecretAskCoordinate = {
  channelId: string;
  askId: string;
};

export type SecretBindingSpec = {
  schemaVersion: 1;
  bindingId: string;
  name: string;
  employeePubkey: string;
  toolName: string;
  allowedUse: string;
  storage: SecretStorage;
  sourceAsk?: SecretAskCoordinate;
};

export type SecretBindingHead = {
  schemaVersion: 1;
  binding: SecretBindingSpec;
  status: SecretBindingStatus;
  sourceActionEventId: string;
};

export type SecretBindingRecord = {
  event: RelayEvent;
  head: SecretBindingHead;
};

type SecretBindingAction = {
  schemaVersion: 1;
  bindingId: string;
  action: "create" | "activate" | "revoke";
  expectedHeadEventId?: string;
  binding?: SecretBindingSpec;
};

const SECRET_BINDING_STATUSES = new Set<SecretBindingStatus>([
  "pending",
  "active",
  "revoked",
]);
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeHead(event: RelayEvent, relaySelfPubkey: string) {
  if (
    event.kind !== KIND_SECRET_BINDING_HEAD ||
    event.pubkey.toLowerCase() !== relaySelfPubkey.toLowerCase()
  ) {
    return null;
  }
  try {
    if (!verifyEvent(event)) return null;
    const value: unknown = JSON.parse(event.content);
    if (!isRecord(value) || !isRecord(value.binding)) return null;
    const head = value as unknown as SecretBindingHead;
    const binding = value.binding;
    const allowedBindingFields = new Set([
      "schemaVersion",
      "bindingId",
      "name",
      "employeePubkey",
      "toolName",
      "allowedUse",
      "storage",
      "sourceAsk",
    ]);
    if (
      Object.keys(binding).some((key) => !allowedBindingFields.has(key)) ||
      head.schemaVersion !== 1 ||
      !SECRET_BINDING_STATUSES.has(head.status) ||
      binding.schemaVersion !== 1 ||
      typeof binding.bindingId !== "string" ||
      !UUID_PATTERN.test(binding.bindingId) ||
      typeof binding.name !== "string" ||
      typeof binding.employeePubkey !== "string" ||
      !PUBKEY_PATTERN.test(binding.employeePubkey) ||
      typeof binding.toolName !== "string" ||
      typeof binding.allowedUse !== "string" ||
      (binding.storage !== "device" && binding.storage !== "server") ||
      (binding.sourceAsk !== undefined &&
        (!isRecord(binding.sourceAsk) ||
          typeof binding.sourceAsk.channelId !== "string" ||
          typeof binding.sourceAsk.askId !== "string")) ||
      typeof head.sourceActionEventId !== "string"
    ) {
      return null;
    }
    const dTags = event.tags.filter((tag) => tag[0] === "d");
    if (
      dTags.length !== 1 ||
      event.tags.some((tag) => tag[0] !== "d") ||
      dTags[0]?.[1] !== `company:secret:${binding.bindingId}`
    ) {
      return null;
    }
    return { event, head } satisfies SecretBindingRecord;
  } catch {
    return null;
  }
}

export async function fetchSecretBindings(
  relaySelfPubkey: string,
): Promise<SecretBindingRecord[]> {
  const events = await relayClient.fetchEvents({
    kinds: [KIND_SECRET_BINDING_HEAD],
    authors: [relaySelfPubkey],
    limit: 1000,
  });
  const records: SecretBindingRecord[] = [];
  for (const event of events) {
    const record = decodeHead(event, relaySelfPubkey);
    if (record) records.push(record);
  }
  return records.sort((first, second) =>
    first.head.binding.name.localeCompare(second.head.binding.name),
  );
}

export async function fetchSecretAsk(
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
  const records: AskHeadRecord[] = [];
  for (const event of events) {
    const record = decodeRelayAskHead(event, relaySelfPubkey, channelId);
    if (record?.head.askId === askId) records.push(record);
  }
  return (
    records.sort(
      (first, second) => second.event.created_at - first.event.created_at,
    )[0] ?? null
  );
}

async function submitAction(action: SecretBindingAction): Promise<void> {
  const signed = await signRelayEvent({
    kind: KIND_SECRET_BINDING_ACTION,
    content: JSON.stringify(action),
    tags: [["d", `company:secret:${action.bindingId}`]],
  });
  await relayClient.publishEvent(
    signed,
    "The secret binding change timed out before the relay confirmed it.",
    "The secret binding could not be changed.",
  );
}

export async function createSecretBinding(binding: SecretBindingSpec) {
  await submitAction({
    schemaVersion: 1,
    bindingId: binding.bindingId,
    action: "create",
    binding,
  });
}

export async function activateSecretBinding(
  bindingId: string,
  expectedHeadEventId: string,
) {
  await submitAction({
    schemaVersion: 1,
    bindingId,
    action: "activate",
    expectedHeadEventId,
  });
}

export async function revokeSecretBinding(
  bindingId: string,
  expectedHeadEventId: string,
) {
  await submitAction({
    schemaVersion: 1,
    bindingId,
    action: "revoke",
    expectedHeadEventId,
  });
}
