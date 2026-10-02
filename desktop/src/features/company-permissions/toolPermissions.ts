import { verifyEvent } from "nostr-tools/pure";

import { KIND_TOOL_PERMISSION_HEAD } from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";

export type ToolPermissionScopeKind = "thread" | "channel" | "customer";
export type ToolPermissionScope = {
  kind: ToolPermissionScopeKind;
  id: string;
};

export type ToolPermissionRecord = {
  schemaVersion: 1;
  permissionId: string;
  agentPubkey: string;
  action: string;
  scope: ToolPermissionScope;
  expiresAt: string;
};

export type ToolPermissionHead = {
  schemaVersion: 1;
  permissionId: string;
  status: "active" | "revoked";
  permission: ToolPermissionRecord;
  grantedByPubkey: string;
  changedByPubkey: string;
  updatedAt: string;
  sourceActionEventId: string;
};

export type ToolPermissionHeadRecord = {
  event: RelayEvent;
  head: ToolPermissionHead;
};

export type ToolPermissionAction = {
  schemaVersion: 1;
  permissionId: string;
  action: "grant" | "update" | "revoke";
  expectedHeadEventId?: string;
  permission?: ToolPermissionRecord;
  reason?: string;
};

export const TOOL_PERMISSION_HEAD_QUERY_LIMIT = 10_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const PUBKEY_RE = /^[0-9a-f]{64}$/i;
const SCOPE_KINDS = new Set<ToolPermissionScopeKind>([
  "thread",
  "channel",
  "customer",
]);
const TOOL_PERMISSION_ACTIONS = {
  spend_money: "Spend money",
  message_outsider: "Message outsiders",
  delete_data: "Delete data",
  publish_publicly: "Publish publicly",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneTagValue(event: RelayEvent, name: string): string | null {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 && typeof tags[0][1] === "string"
    ? tags[0][1]
    : null;
}

function parseHead(content: string): ToolPermissionHead | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.permission)) return null;
  const head = value;
  const permission = value.permission;
  const scope = permission.scope;
  if (!isRecord(scope)) return null;
  if (
    head.schemaVersion !== 1 ||
    typeof head.permissionId !== "string" ||
    !UUID_RE.test(head.permissionId) ||
    (head.status !== "active" && head.status !== "revoked") ||
    permission.schemaVersion !== 1 ||
    permission.permissionId !== head.permissionId ||
    typeof permission.agentPubkey !== "string" ||
    !PUBKEY_RE.test(permission.agentPubkey) ||
    typeof permission.action !== "string" ||
    permission.action.trim().length === 0 ||
    permission.action.length > 180 ||
    typeof scope.kind !== "string" ||
    !SCOPE_KINDS.has(scope.kind as ToolPermissionScopeKind) ||
    typeof scope.id !== "string" ||
    (scope.kind === "thread" && !HEX64_RE.test(scope.id)) ||
    ((scope.kind === "channel" || scope.kind === "customer") &&
      !UUID_RE.test(scope.id)) ||
    typeof permission.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(permission.expiresAt)) ||
    typeof head.grantedByPubkey !== "string" ||
    !PUBKEY_RE.test(head.grantedByPubkey) ||
    typeof head.changedByPubkey !== "string" ||
    !PUBKEY_RE.test(head.changedByPubkey) ||
    typeof head.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(head.updatedAt)) ||
    typeof head.sourceActionEventId !== "string" ||
    !HEX64_RE.test(head.sourceActionEventId)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    permissionId: head.permissionId.toLowerCase(),
    status: head.status,
    permission: {
      schemaVersion: 1,
      permissionId: permission.permissionId.toLowerCase(),
      agentPubkey: permission.agentPubkey.toLowerCase(),
      action: permission.action,
      scope: {
        kind: scope.kind as ToolPermissionScopeKind,
        id: scope.id.toLowerCase(),
      },
      expiresAt: permission.expiresAt,
    },
    grantedByPubkey: head.grantedByPubkey.toLowerCase(),
    changedByPubkey: head.changedByPubkey.toLowerCase(),
    updatedAt: head.updatedAt,
    sourceActionEventId: head.sourceActionEventId.toLowerCase(),
  };
}

export function toolPermissionDTag(permissionId: string): string {
  if (!UUID_RE.test(permissionId)) {
    throw new Error("Permission coordinates require a permission UUID.");
  }
  return `company:permission:${permissionId.toLowerCase()}`;
}

export function decodeRelayToolPermissionHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): ToolPermissionHeadRecord | null {
  if (
    event.kind !== KIND_TOOL_PERMISSION_HEAD ||
    event.pubkey.toLowerCase() !== relaySelfPubkey.toLowerCase()
  ) {
    return null;
  }
  const dTag = oneTagValue(event, "d");
  const agentPubkey = oneTagValue(event, "p");
  if (!dTag || !agentPubkey || event.tags.length !== 2) return null;
  try {
    if (!verifyEvent(event)) return null;
  } catch {
    return null;
  }
  const head = parseHead(event.content);
  if (
    !head ||
    dTag !== toolPermissionDTag(head.permissionId) ||
    agentPubkey.toLowerCase() !== head.permission.agentPubkey
  ) {
    return null;
  }
  return { event, head };
}

export function toolPermissionState(
  record: ToolPermissionHeadRecord,
  now = Date.now(),
): "Active" | "Expired" | "Revoked" {
  if (record.head.status === "revoked") return "Revoked";
  return Date.parse(record.head.permission.expiresAt) <= now
    ? "Expired"
    : "Active";
}

export function toolPermissionActionLabel(action: string): string {
  return (
    TOOL_PERMISSION_ACTIONS[action as keyof typeof TOOL_PERMISSION_ACTIONS] ??
    action
  );
}

export function resolveToolPermissionAction(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  const match = Object.entries(TOOL_PERMISSION_ACTIONS).find(
    ([key, label]) => key === normalized || label.toLowerCase() === normalized,
  );
  return match?.[0] ?? null;
}

export function resolveToolPermissionScope(
  input: string,
  resources: {
    channels: readonly { id: string; name: string }[];
    customers: readonly { clientId: string; displayName: string }[];
  },
): ToolPermissionScope | null {
  const value = input.trim();
  const explicit = /^(thread|channel|customer):(.+)$/i.exec(value);
  if (explicit) {
    const kind = explicit[1].toLowerCase() as ToolPermissionScopeKind;
    const id = explicit[2].trim().toLowerCase();
    if (
      (kind === "thread" && HEX64_RE.test(id)) ||
      ((kind === "channel" || kind === "customer") && UUID_RE.test(id))
    ) {
      return { kind, id };
    }
    return null;
  }
  if (HEX64_RE.test(value)) {
    return { kind: "thread", id: value.toLowerCase() };
  }
  const channelName = value.startsWith("#") ? value.slice(1).trim() : value;
  const channels = resources.channels.filter(
    (channel) => channel.name.toLowerCase() === channelName.toLowerCase(),
  );
  const customers = resources.customers.filter(
    (customer) => customer.displayName.toLowerCase() === value.toLowerCase(),
  );
  if (channels.length === 1 && customers.length === 0) {
    return { kind: "channel", id: channels[0].id.toLowerCase() };
  }
  if (customers.length === 1 && channels.length === 0) {
    return { kind: "customer", id: customers[0].clientId.toLowerCase() };
  }
  return null;
}

export function toolPermissionScopeLabel(
  scope: ToolPermissionScope,
  resources: {
    channels: readonly { id: string; name: string }[];
    customers: readonly { clientId: string; displayName: string }[];
  },
): string {
  if (scope.kind === "channel") {
    const channel = resources.channels.find(
      (item) => item.id.toLowerCase() === scope.id,
    );
    return channel ? `#${channel.name}` : `Channel ${scope.id}`;
  }
  if (scope.kind === "customer") {
    const customer = resources.customers.find(
      (item) => item.clientId.toLowerCase() === scope.id,
    );
    return customer?.displayName ?? `Customer ${scope.id}`;
  }
  return `Thread ${scope.id.slice(0, 8)}`;
}
