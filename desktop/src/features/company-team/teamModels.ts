import { verifyEvent } from "nostr-tools/pure";

import type {
  ManagedAgent,
  RelayAgent,
  RelayEvent,
  RelayMember,
} from "@/shared/api/types";
import {
  KIND_MEMBER_POSITION_ACTION,
  KIND_MEMBER_POSITION_HEAD,
} from "@/shared/constants/kinds";

export const MEMBER_POSITION_SCHEMA_VERSION = 1;
export const MEMBER_POSITION_HEAD_QUERY_LIMIT = 10_000;

export type TeamMemberKind = "human" | "employee";
export type TeamMemberStatus = "active" | "paused" | "terminated";
export type MemberPositionActionKind =
  | "set_title"
  | "set_manager"
  | "set_position"
  | "pause"
  | "terminate"
  | "rehire";

export type MemberPositionAction = {
  schemaVersion: number;
  pubkey: string;
  action: MemberPositionActionKind;
  expectedHeadEventId?: string;
  title?: string;
  managerPubkey?: string | null;
  reason?: string;
};

export type MemberPositionActionRecord = {
  event: RelayEvent;
  action: MemberPositionAction;
};

export type MemberPositionHead = {
  schemaVersion: number;
  pubkey: string;
  title: string;
  managerPubkey?: string;
  kind: TeamMemberKind;
  status: TeamMemberStatus;
  reason?: string;
  sourceActionEventId: string;
  updatedAt: string;
};

export type MemberPositionHeadRecord = {
  dTag: string;
  event: RelayEvent;
  head: MemberPositionHead;
};

export type TeamMember = {
  pubkey: string;
  kind: TeamMemberKind;
  createdAt: string;
  fallbackName: string | null;
  role: RelayMember["role"] | null;
  managedAgent: ManagedAgent | null;
  relayAgent: RelayAgent | null;
  position: MemberPositionHeadRecord | null;
};

const PUBKEY_RE = /^[0-9a-f]{64}$/;
const ACTIONS = new Set<MemberPositionActionKind>([
  "set_title",
  "set_manager",
  "set_position",
  "pause",
  "terminate",
  "rehire",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function normalizeTeamPubkey(pubkey: string): string {
  return pubkey.trim().toLowerCase();
}

export function memberPositionDTag(pubkey: string): string {
  const normalized = normalizeTeamPubkey(pubkey);
  if (!PUBKEY_RE.test(normalized)) {
    throw new Error(
      "Member pubkey must be 64 lowercase hexadecimal characters.",
    );
  }
  return `company:member:${normalized}`;
}

function parseHead(value: unknown): MemberPositionHead | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "pubkey",
      "title",
      "managerPubkey",
      "kind",
      "status",
      "reason",
      "sourceActionEventId",
      "updatedAt",
    ]) ||
    value.schemaVersion !== MEMBER_POSITION_SCHEMA_VERSION ||
    typeof value.pubkey !== "string" ||
    !PUBKEY_RE.test(value.pubkey) ||
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    value.title.length > 180 ||
    (value.managerPubkey !== undefined &&
      (typeof value.managerPubkey !== "string" ||
        !PUBKEY_RE.test(value.managerPubkey))) ||
    (value.kind !== "human" && value.kind !== "employee") ||
    (value.status !== "active" &&
      value.status !== "paused" &&
      value.status !== "terminated") ||
    (value.reason !== undefined &&
      (typeof value.reason !== "string" || value.reason.length > 1000)) ||
    typeof value.sourceActionEventId !== "string" ||
    !PUBKEY_RE.test(value.sourceActionEventId) ||
    typeof value.updatedAt !== "string" ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    return null;
  }
  if (value.managerPubkey === value.pubkey) return null;
  if (value.status === "active" && value.reason !== undefined) return null;
  if (
    value.status !== "active" &&
    (value.kind !== "employee" ||
      typeof value.reason !== "string" ||
      value.reason.trim().length === 0)
  ) {
    return null;
  }
  return {
    schemaVersion: MEMBER_POSITION_SCHEMA_VERSION,
    pubkey: value.pubkey,
    title: value.title,
    ...(typeof value.managerPubkey === "string"
      ? { managerPubkey: value.managerPubkey }
      : {}),
    kind: value.kind,
    status: value.status,
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    sourceActionEventId: value.sourceActionEventId,
    updatedAt: value.updatedAt,
  };
}

export function parseMemberPositionHeadEvent(
  event: RelayEvent,
  relaySelf: string,
): MemberPositionHeadRecord | null {
  if (
    event.kind !== KIND_MEMBER_POSITION_HEAD ||
    normalizeTeamPubkey(event.pubkey) !== normalizeTeamPubkey(relaySelf) ||
    !verifyEvent(event)
  ) {
    return null;
  }
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  if (event.tags.length !== 1 || dTags.length !== 1 || dTags[0]?.length !== 2) {
    return null;
  }
  let content: unknown;
  try {
    content = JSON.parse(event.content) as unknown;
  } catch {
    return null;
  }
  const head = parseHead(content);
  const dTag = dTags[0][1];
  if (!head || dTag !== memberPositionDTag(head.pubkey)) return null;
  return { dTag, event, head };
}

export function parseMemberPositionAction(
  value: unknown,
): MemberPositionAction | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "pubkey",
      "action",
      "expectedHeadEventId",
      "title",
      "managerPubkey",
      "reason",
    ]) ||
    value.schemaVersion !== MEMBER_POSITION_SCHEMA_VERSION ||
    typeof value.pubkey !== "string" ||
    !PUBKEY_RE.test(value.pubkey) ||
    typeof value.action !== "string" ||
    !ACTIONS.has(value.action as MemberPositionActionKind) ||
    (value.expectedHeadEventId !== undefined &&
      (typeof value.expectedHeadEventId !== "string" ||
        !PUBKEY_RE.test(value.expectedHeadEventId))) ||
    (value.title !== undefined &&
      (typeof value.title !== "string" ||
        value.title.trim().length === 0 ||
        value.title.length > 180)) ||
    (value.managerPubkey !== undefined &&
      value.managerPubkey !== null &&
      (typeof value.managerPubkey !== "string" ||
        !PUBKEY_RE.test(value.managerPubkey))) ||
    (value.reason !== undefined &&
      (typeof value.reason !== "string" ||
        value.reason.trim().length === 0 ||
        value.reason.length > 1000))
  ) {
    return null;
  }
  const action: MemberPositionAction = {
    schemaVersion: MEMBER_POSITION_SCHEMA_VERSION,
    pubkey: value.pubkey,
    action: value.action as MemberPositionActionKind,
    ...(typeof value.expectedHeadEventId === "string"
      ? { expectedHeadEventId: value.expectedHeadEventId }
      : {}),
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(value.managerPubkey === null || typeof value.managerPubkey === "string"
      ? { managerPubkey: value.managerPubkey }
      : {}),
    ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
  };
  const hasHead = action.expectedHeadEventId !== undefined;
  if (!hasHead && !["set_title", "set_position"].includes(action.action)) {
    return null;
  }
  if (
    !hasHead &&
    action.action === "set_position" &&
    action.title === undefined
  ) {
    return null;
  }
  switch (action.action) {
    case "set_title":
      return action.title &&
        action.managerPubkey === undefined &&
        !action.reason
        ? action
        : null;
    case "set_manager":
      return action.title === undefined &&
        action.managerPubkey !== undefined &&
        !action.reason
        ? action
        : null;
    case "set_position":
      return (action.title !== undefined ||
        action.managerPubkey !== undefined) &&
        !action.reason
        ? action
        : null;
    case "pause":
    case "terminate":
      return action.reason &&
        action.title === undefined &&
        action.managerPubkey === undefined
        ? action
        : null;
    case "rehire":
      return action.title === undefined &&
        action.managerPubkey === undefined &&
        action.reason === undefined
        ? action
        : null;
  }
}

export function parseMemberPositionActionEvent(
  event: RelayEvent,
  memberPubkey: string,
): MemberPositionActionRecord | null {
  const expectedPubkey = normalizeTeamPubkey(memberPubkey);
  if (event.kind !== KIND_MEMBER_POSITION_ACTION || !verifyEvent(event)) {
    return null;
  }
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  if (
    event.tags.length !== 1 ||
    dTags.length !== 1 ||
    dTags[0]?.length !== 2 ||
    dTags[0][1] !== memberPositionDTag(expectedPubkey)
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(event.content) as unknown;
  } catch {
    return null;
  }
  const action = parseMemberPositionAction(value);
  if (!action || normalizeTeamPubkey(action.pubkey) !== expectedPubkey) {
    return null;
  }
  return { event, action };
}

export function mergeTeamMembers(input: {
  relayMembers: RelayMember[];
  relayAgents: RelayAgent[];
  managedAgents: ManagedAgent[];
  positions: MemberPositionHeadRecord[];
  relayUrl: string;
}): TeamMember[] {
  const relayUrl = input.relayUrl.replace(/\/$/, "").toLowerCase();
  const positions = new Map(
    input.positions.map((record) => [
      normalizeTeamPubkey(record.head.pubkey),
      record,
    ]),
  );
  const workerPubkeys = new Set(
    input.relayAgents
      .filter((agent) => agent.agentType.toLowerCase() === "worker")
      .map((agent) => normalizeTeamPubkey(agent.pubkey)),
  );
  const managedAgents = new Map<string, ManagedAgent>();
  for (const agent of input.managedAgents) {
    if (agent.relayUrl.replace(/\/$/, "").toLowerCase() !== relayUrl) continue;
    const pubkey = normalizeTeamPubkey(agent.pubkey);
    if (workerPubkeys.has(pubkey)) continue;
    managedAgents.set(pubkey, agent);
  }
  const relayAgents = new Map<string, RelayAgent>();
  for (const agent of input.relayAgents) {
    if (
      agent.ownerPubkey === null ||
      workerPubkeys.has(normalizeTeamPubkey(agent.pubkey))
    ) {
      continue;
    }
    relayAgents.set(normalizeTeamPubkey(agent.pubkey), agent);
  }

  const members = new Map<string, TeamMember>();
  for (const member of input.relayMembers) {
    const pubkey = normalizeTeamPubkey(member.pubkey);
    if (workerPubkeys.has(pubkey)) continue;
    const managedAgent = managedAgents.get(pubkey) ?? null;
    const relayAgent = relayAgents.get(pubkey) ?? null;
    const position = positions.get(pubkey) ?? null;
    const directoryKind: TeamMemberKind =
      managedAgent || relayAgent ? "employee" : "human";
    if (
      position &&
      position.head.kind === "human" &&
      directoryKind === "employee"
    ) {
      throw new Error(
        "The relay returned a member position with the wrong member kind.",
      );
    }
    const kind = position?.head.kind ?? directoryKind;
    members.set(pubkey, {
      pubkey,
      kind,
      createdAt: member.createdAt,
      fallbackName: managedAgent?.name ?? relayAgent?.name ?? null,
      role: member.role,
      managedAgent,
      relayAgent,
      position,
    });
  }
  for (const [pubkey, agent] of managedAgents) {
    const position = positions.get(pubkey) ?? null;
    if (position && position.head.kind !== "employee") {
      throw new Error(
        "The relay returned a human position for a managed employee.",
      );
    }
    const existing = members.get(pubkey);
    members.set(pubkey, {
      pubkey,
      kind: position?.head.kind ?? "employee",
      createdAt: existing?.createdAt ?? agent.createdAt,
      fallbackName: agent.name,
      role: existing?.role ?? null,
      managedAgent: agent,
      relayAgent: relayAgents.get(pubkey) ?? existing?.relayAgent ?? null,
      position,
    });
  }
  for (const [pubkey, agent] of relayAgents) {
    const position = positions.get(pubkey) ?? null;
    if (position && position.head.kind !== "employee") {
      throw new Error("The relay returned a human position for an employee.");
    }
    const existing = members.get(pubkey);
    members.set(pubkey, {
      pubkey,
      kind: position?.head.kind ?? "employee",
      createdAt: existing?.createdAt ?? new Date(0).toISOString(),
      fallbackName: existing?.fallbackName ?? agent.name,
      role: existing?.role ?? null,
      managedAgent: existing?.managedAgent ?? null,
      relayAgent: agent,
      position,
    });
  }
  return [...members.values()];
}

export type TeamTreeRow = { member: TeamMember; depth: number };

export function buildTeamTreeRows(members: TeamMember[]): TeamTreeRow[] {
  const byPubkey = new Map(members.map((member) => [member.pubkey, member]));
  const children = new Map<string, TeamMember[]>();
  const roots: TeamMember[] = [];
  for (const member of members) {
    const managerPubkey = member.position?.head.managerPubkey;
    if (!managerPubkey || !byPubkey.has(managerPubkey)) {
      roots.push(member);
      continue;
    }
    const reports = children.get(managerPubkey) ?? [];
    reports.push(member);
    children.set(managerPubkey, reports);
  }
  const ordered = (items: TeamMember[]) =>
    [...items].sort((left, right) => {
      if (left.role === "owner" && right.role !== "owner") return -1;
      if (right.role === "owner" && left.role !== "owner") return 1;
      return (
        left.createdAt.localeCompare(right.createdAt) ||
        left.pubkey.localeCompare(right.pubkey)
      );
    });
  const rows: TeamTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (member: TeamMember, depth: number) => {
    if (visited.has(member.pubkey)) {
      throw new Error("The reporting tree contains a cycle.");
    }
    visited.add(member.pubkey);
    rows.push({ member, depth });
    for (const child of ordered(children.get(member.pubkey) ?? [])) {
      visit(child, depth + 1);
    }
  };
  for (const root of ordered(roots)) visit(root, 0);
  if (visited.size !== members.length) {
    throw new Error("The reporting tree contains a cycle.");
  }
  return rows;
}
