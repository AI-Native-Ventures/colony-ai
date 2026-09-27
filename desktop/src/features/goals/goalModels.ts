import { verifyEvent } from "nostr-tools/pure";

import type { RelayEvent } from "@/shared/api/types";
import { KIND_GOAL_ACTION, KIND_GOAL_HEAD } from "@/shared/constants/kinds";

export const GOAL_RECORD_SCHEMA_VERSION = 1;
export const GOAL_HEAD_QUERY_LIMIT = 10_000;

export type GoalStatus =
  | "active"
  | "off_pace"
  | "achieved"
  | "archived"
  | "deleted";

export type GoalTarget = {
  value: string;
  unit: string;
};

export type GoalRecord = {
  schemaVersion: number;
  goalId: string;
  parentGoalId?: string;
  title: string;
  ownerPubkey: string;
  dueDate?: string;
  doneCondition: string;
  target?: GoalTarget;
  linkedChannelIds: string[];
};

export type GoalProgress = {
  current?: string;
  evidence: string;
  evidenceRefs: string[];
};

export type RecordedGoalProgress = GoalProgress & {
  recordedByPubkey: string;
  recordedAt: string;
};

export type GoalHead = {
  schemaVersion: number;
  goalId: string;
  status: GoalStatus;
  title: string;
  goal?: GoalRecord;
  progress?: RecordedGoalProgress;
  sourceActionEventId: string;
};

export type GoalHeadRecord = {
  communityId: string;
  dTag: string;
  event: RelayEvent;
  head: GoalHead;
};

export type GoalActionKind =
  | "create"
  | "update"
  | "progress"
  | "set_status"
  | "archive"
  | "restore"
  | "delete";

export type GoalAction = {
  schemaVersion: number;
  goalId: string;
  action: GoalActionKind;
  expectedHeadEventId?: string;
  goal?: GoalRecord;
  progress?: GoalProgress;
  status?: Exclude<GoalStatus, "archived" | "deleted">;
  reason?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const GOAL_STATUSES = new Set<GoalStatus>([
  "active",
  "off_pace",
  "achieved",
  "archived",
  "deleted",
]);
const GOAL_ACTION_KINDS = new Set<GoalActionKind>([
  "create",
  "update",
  "progress",
  "set_status",
  "archive",
  "restore",
  "delete",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parseGoalRecord(value: unknown, goalId: string): GoalRecord | null {
  if (!isObject(value)) return null;
  if (
    !hasOnlyKeys(value, [
      "schemaVersion",
      "goalId",
      "parentGoalId",
      "title",
      "ownerPubkey",
      "dueDate",
      "doneCondition",
      "target",
      "linkedChannelIds",
    ]) ||
    value.schemaVersion !== GOAL_RECORD_SCHEMA_VERSION ||
    value.goalId !== goalId ||
    !isOptionalString(value.parentGoalId) ||
    !isOptionalString(value.dueDate) ||
    typeof value.title !== "string" ||
    typeof value.ownerPubkey !== "string" ||
    !HEX64_RE.test(value.ownerPubkey) ||
    typeof value.doneCondition !== "string" ||
    !Array.isArray(value.linkedChannelIds) ||
    !value.linkedChannelIds.every(
      (channelId) => typeof channelId === "string" && UUID_RE.test(channelId),
    )
  ) {
    return null;
  }
  let target: GoalTarget | undefined;
  if (value.target !== undefined) {
    if (
      !isObject(value.target) ||
      !hasOnlyKeys(value.target, ["value", "unit"]) ||
      typeof value.target.value !== "string" ||
      typeof value.target.unit !== "string"
    ) {
      return null;
    }
    target = { value: value.target.value, unit: value.target.unit };
  }
  return {
    schemaVersion: GOAL_RECORD_SCHEMA_VERSION,
    goalId,
    ...(typeof value.parentGoalId === "string"
      ? { parentGoalId: value.parentGoalId.toLowerCase() }
      : {}),
    title: value.title,
    ownerPubkey: value.ownerPubkey.toLowerCase(),
    ...(typeof value.dueDate === "string" ? { dueDate: value.dueDate } : {}),
    doneCondition: value.doneCondition,
    ...(target ? { target } : {}),
    linkedChannelIds: value.linkedChannelIds.map((id) =>
      (id as string).toLowerCase(),
    ),
  };
}

function parseRecordedProgress(value: unknown): RecordedGoalProgress | null {
  if (!isObject(value)) return null;
  if (
    !hasOnlyKeys(value, [
      "current",
      "evidence",
      "evidenceRefs",
      "recordedByPubkey",
      "recordedAt",
    ]) ||
    !isOptionalString(value.current) ||
    typeof value.evidence !== "string" ||
    !Array.isArray(value.evidenceRefs) ||
    !value.evidenceRefs.every((reference) => typeof reference === "string") ||
    typeof value.recordedByPubkey !== "string" ||
    !HEX64_RE.test(value.recordedByPubkey) ||
    typeof value.recordedAt !== "string"
  ) {
    return null;
  }
  return {
    ...(typeof value.current === "string" ? { current: value.current } : {}),
    evidence: value.evidence,
    evidenceRefs: value.evidenceRefs as string[],
    recordedByPubkey: value.recordedByPubkey.toLowerCase(),
    recordedAt: value.recordedAt,
  };
}

export function goalDTag(communityId: string, goalId: string): string {
  if (!UUID_RE.test(communityId) || !UUID_RE.test(goalId)) {
    throw new Error("Goal coordinates require UUID values.");
  }
  return `company:${communityId.toLowerCase()}:goal:${goalId.toLowerCase()}`;
}

export function parseGoalDTag(
  value: string,
): { communityId: string; goalId: string } | null {
  const match = /^company:([0-9a-f-]{36}):goal:([0-9a-f-]{36})$/i.exec(value);
  if (!match || !UUID_RE.test(match[1]) || !UUID_RE.test(match[2])) return null;
  return {
    communityId: match[1].toLowerCase(),
    goalId: match[2].toLowerCase(),
  };
}

function parseGoalHeadContent(content: string): GoalHead | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "goalId",
      "status",
      "title",
      "goal",
      "progress",
      "sourceActionEventId",
    ]) ||
    value.schemaVersion !== GOAL_RECORD_SCHEMA_VERSION ||
    typeof value.goalId !== "string" ||
    !UUID_RE.test(value.goalId) ||
    typeof value.status !== "string" ||
    !GOAL_STATUSES.has(value.status as GoalStatus) ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX64_RE.test(value.sourceActionEventId)
  ) {
    return null;
  }
  const goalId = value.goalId.toLowerCase();
  const goal =
    value.goal === undefined ? undefined : parseGoalRecord(value.goal, goalId);
  const progress =
    value.progress === undefined
      ? undefined
      : parseRecordedProgress(value.progress);
  if (
    (value.goal !== undefined && !goal) ||
    (value.progress !== undefined && !progress) ||
    (value.status === "deleted" && (goal || progress)) ||
    (value.status !== "deleted" && !goal)
  ) {
    return null;
  }
  return {
    schemaVersion: GOAL_RECORD_SCHEMA_VERSION,
    goalId,
    status: value.status as GoalStatus,
    title: value.title,
    ...(goal ? { goal } : {}),
    ...(progress ? { progress } : {}),
    sourceActionEventId: value.sourceActionEventId.toLowerCase(),
  };
}

export function parseGoalHeadEvent(
  event: RelayEvent,
  relaySelf: string,
): GoalHeadRecord | null {
  try {
    if (
      event.kind !== KIND_GOAL_HEAD ||
      event.pubkey.toLowerCase() !== relaySelf.toLowerCase() ||
      !verifyEvent(event)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  if (
    event.tags.length !== 1 ||
    event.tags[0]?.length !== 2 ||
    event.tags[0]?.[0] !== "d"
  ) {
    return null;
  }
  const dTag = event.tags[0][1];
  const coordinate = parseGoalDTag(dTag);
  const head = parseGoalHeadContent(event.content);
  if (!coordinate || !head || coordinate.goalId !== head.goalId) return null;
  return {
    communityId: coordinate.communityId,
    dTag,
    event,
    head,
  };
}

export function parseGoalActionEvent(
  event: RelayEvent,
  dTag: string,
): { action: GoalAction; event: RelayEvent } | null {
  try {
    if (event.kind !== KIND_GOAL_ACTION || !verifyEvent(event)) return null;
  } catch {
    return null;
  }
  if (
    event.tags.length !== 1 ||
    event.tags[0]?.length !== 2 ||
    event.tags[0]?.[0] !== "d" ||
    event.tags[0]?.[1] !== dTag
  ) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "goalId",
      "action",
      "expectedHeadEventId",
      "goal",
      "progress",
      "status",
      "reason",
    ]) ||
    value.schemaVersion !== GOAL_RECORD_SCHEMA_VERSION ||
    typeof value.goalId !== "string" ||
    !UUID_RE.test(value.goalId) ||
    typeof value.action !== "string" ||
    !GOAL_ACTION_KINDS.has(value.action as GoalActionKind) ||
    !isOptionalString(value.expectedHeadEventId) ||
    !isOptionalString(value.reason)
  ) {
    return null;
  }
  const coordinate = parseGoalDTag(dTag);
  if (!coordinate || coordinate.goalId !== value.goalId.toLowerCase())
    return null;
  return {
    action: value as unknown as GoalAction,
    event,
  };
}

export function canManageCompanyGoals(
  role: string | null | undefined,
): boolean {
  return role === "owner" || role === "admin";
}

export function canEditGoal(
  role: string | null | undefined,
  actorPubkey: string | null | undefined,
  head: GoalHead,
): boolean {
  return (
    canManageCompanyGoals(role) ||
    Boolean(
      actorPubkey &&
        head.goal?.ownerPubkey.toLowerCase() === actorPubkey.toLowerCase(),
    )
  );
}

export function canCreateSubgoal(
  role: string | null | undefined,
  actorPubkey: string | null | undefined,
  parent: GoalHead,
): boolean {
  return (
    canManageCompanyGoals(role) ||
    Boolean(
      actorPubkey &&
        parent.goal?.ownerPubkey.toLowerCase() === actorPubkey.toLowerCase(),
    )
  );
}

export function canRestoreOrDeleteGoal(
  role: string | null | undefined,
): boolean {
  return canManageCompanyGoals(role);
}
