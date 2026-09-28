import { verifyEvent } from "nostr-tools/pure";

import type { DeliverablePointer } from "@/features/clients/lib/businessRecords";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_WORK_ITEM_ACTION,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";

export const COMPANY_WORK_SCHEMA_VERSION = 1;
export const COMPANY_WORK_HEAD_QUERY_LIMIT = 10_000;
export const COMPANY_WORK_HISTORY_QUERY_LIMIT = 1_000;

export type CompanyWorkStatus =
  | "active"
  | "paused"
  | "blocked"
  | "done_unverified"
  | "done_verified"
  | "archived";

export type CompanyWorkVerdict = "pass" | "revision_requested";

export type CompanyWorkVerification = {
  verdict: CompanyWorkVerdict;
  reason: string;
  evidence: string;
  reviewerPubkey: string;
  reviewedAt: string;
  sourceActionEventId: string;
};

export type CompanyWorkHead = {
  schemaVersion: number;
  workItemId: string;
  title: string;
  status: CompanyWorkStatus;
  assignedPubkeys: string[];
  approverPubkeys: string[];
  deliverables: DeliverablePointer[];
  requesterPubkey: string;
  doneCondition: string;
  goalId?: string;
  sourceEventId?: string;
  threadRootEventId?: string;
  evidence?: string;
  statusReason?: string;
  verification?: CompanyWorkVerification;
  sourceActionEventId: string;
};

export type CompanyWorkHeadRecord = {
  dTag: string;
  channelId: string;
  event: RelayEvent;
  head: CompanyWorkHead;
};

export type CompanyWorkInput = Omit<
  CompanyWorkHead,
  "statusReason" | "verification" | "sourceActionEventId"
>;

export type CompanyWorkActionKind =
  | "create"
  | "update"
  | "set_status"
  | "verify"
  | "archive"
  | "restore";

export type CompanyWorkAction = {
  schemaVersion: number;
  workItemId: string;
  action: CompanyWorkActionKind;
  expectedHeadEventId?: string;
  head?: CompanyWorkInput;
  status?: CompanyWorkStatus;
  reason?: string;
  verification?: {
    verdict: CompanyWorkVerdict;
    reason: string;
    evidence: string;
  };
};

export type CompanyWorkHistoryEntry = {
  event: RelayEvent;
  action: CompanyWorkAction;
  channelId: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const STATUSES = new Set<CompanyWorkStatus>([
  "active",
  "paused",
  "blocked",
  "done_unverified",
  "done_verified",
  "archived",
]);
const VERDICTS = new Set<CompanyWorkVerdict>(["pass", "revision_requested"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function companyWorkDTag(workItemId: string): string {
  if (!UUID_RE.test(workItemId)) {
    throw new Error("Company work coordinates require a work-item UUID.");
  }
  return `company:work:${workItemId.toLowerCase()}`;
}

function parseVerification(value: unknown): CompanyWorkVerification | null {
  if (!isObject(value)) return null;
  if (
    !hasOnlyKeys(value, [
      "verdict",
      "reason",
      "evidence",
      "reviewerPubkey",
      "reviewedAt",
      "sourceActionEventId",
    ]) ||
    typeof value.verdict !== "string" ||
    !VERDICTS.has(value.verdict as CompanyWorkVerdict) ||
    typeof value.reason !== "string" ||
    value.reason.trim().length === 0 ||
    typeof value.evidence !== "string" ||
    value.evidence.trim().length === 0 ||
    typeof value.reviewerPubkey !== "string" ||
    !HEX64_RE.test(value.reviewerPubkey) ||
    typeof value.reviewedAt !== "string" ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX64_RE.test(value.sourceActionEventId)
  ) {
    return null;
  }
  return {
    verdict: value.verdict as CompanyWorkVerdict,
    reason: value.reason,
    evidence: value.evidence,
    reviewerPubkey: value.reviewerPubkey.toLowerCase(),
    reviewedAt: value.reviewedAt,
    sourceActionEventId: value.sourceActionEventId.toLowerCase(),
  };
}

function parseHeadContent(content: string): CompanyWorkHead | null {
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
      "workItemId",
      "title",
      "status",
      "assignedPubkeys",
      "approverPubkeys",
      "deliverables",
      "requesterPubkey",
      "doneCondition",
      "goalId",
      "sourceEventId",
      "threadRootEventId",
      "evidence",
      "statusReason",
      "verification",
      "sourceActionEventId",
    ]) ||
    value.schemaVersion !== COMPANY_WORK_SCHEMA_VERSION ||
    typeof value.workItemId !== "string" ||
    !UUID_RE.test(value.workItemId) ||
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status as CompanyWorkStatus) ||
    !Array.isArray(value.assignedPubkeys) ||
    value.assignedPubkeys.length !== 1 ||
    !value.assignedPubkeys.every(
      (pubkey) => typeof pubkey === "string" && HEX64_RE.test(pubkey),
    ) ||
    !Array.isArray(value.approverPubkeys) ||
    !value.approverPubkeys.every(
      (pubkey) => typeof pubkey === "string" && HEX64_RE.test(pubkey),
    ) ||
    !Array.isArray(value.deliverables) ||
    typeof value.requesterPubkey !== "string" ||
    !HEX64_RE.test(value.requesterPubkey) ||
    typeof value.doneCondition !== "string" ||
    value.doneCondition.trim().length === 0 ||
    (value.goalId !== undefined &&
      (typeof value.goalId !== "string" || !UUID_RE.test(value.goalId))) ||
    (value.sourceEventId !== undefined &&
      (typeof value.sourceEventId !== "string" ||
        !HEX64_RE.test(value.sourceEventId))) ||
    (value.threadRootEventId !== undefined &&
      (typeof value.threadRootEventId !== "string" ||
        !HEX64_RE.test(value.threadRootEventId))) ||
    (value.sourceEventId !== undefined &&
      value.threadRootEventId === undefined) ||
    (value.evidence !== undefined && typeof value.evidence !== "string") ||
    (value.statusReason !== undefined &&
      typeof value.statusReason !== "string") ||
    (value.verification !== undefined &&
      !parseVerification(value.verification)) ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX64_RE.test(value.sourceActionEventId)
  ) {
    return null;
  }
  const verification =
    value.verification === undefined
      ? undefined
      : (parseVerification(value.verification) ?? undefined);
  if (value.status === "done_verified" && verification?.verdict !== "pass") {
    return null;
  }

  const deliverables = value.deliverables.map((entry) => {
    if (!isObject(entry)) return null;
    const fields = [
      "deliverableId",
      "versionEventId",
      "contentDigest",
      "mediaDigest",
      "versionDigest",
    ];
    if (
      !hasOnlyKeys(entry, fields) ||
      fields.some((field) => typeof entry[field] !== "string") ||
      !UUID_RE.test(entry.deliverableId as string) ||
      fields.slice(1).some((field) => !HEX64_RE.test(entry[field] as string))
    ) {
      return null;
    }
    return {
      deliverableId: (entry.deliverableId as string).toLowerCase(),
      versionEventId: (entry.versionEventId as string).toLowerCase(),
      contentDigest: (entry.contentDigest as string).toLowerCase(),
      mediaDigest: (entry.mediaDigest as string).toLowerCase(),
      versionDigest: (entry.versionDigest as string).toLowerCase(),
    } satisfies DeliverablePointer;
  });
  if (deliverables.some((entry) => entry === null)) return null;

  return {
    schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
    workItemId: value.workItemId.toLowerCase(),
    title: value.title,
    status: value.status as CompanyWorkStatus,
    assignedPubkeys: (value.assignedPubkeys as string[]).map((key) =>
      key.toLowerCase(),
    ),
    approverPubkeys: (value.approverPubkeys as string[]).map((key) =>
      key.toLowerCase(),
    ),
    deliverables: deliverables as DeliverablePointer[],
    requesterPubkey: value.requesterPubkey.toLowerCase(),
    doneCondition: value.doneCondition,
    ...(typeof value.goalId === "string"
      ? { goalId: value.goalId.toLowerCase() }
      : {}),
    ...(typeof value.sourceEventId === "string"
      ? { sourceEventId: value.sourceEventId.toLowerCase() }
      : {}),
    ...(typeof value.threadRootEventId === "string"
      ? { threadRootEventId: value.threadRootEventId.toLowerCase() }
      : {}),
    ...(typeof value.evidence === "string" ? { evidence: value.evidence } : {}),
    ...(typeof value.statusReason === "string"
      ? { statusReason: value.statusReason }
      : {}),
    ...(verification ? { verification } : {}),
    sourceActionEventId: value.sourceActionEventId.toLowerCase(),
  };
}

export function parseCompanyWorkHeadEvent(
  event: RelayEvent,
  relaySelf: string,
): CompanyWorkHeadRecord | null {
  try {
    if (
      event.kind !== KIND_WORK_ITEM_HEAD ||
      event.pubkey.toLowerCase() !== relaySelf.toLowerCase() ||
      !verifyEvent(event)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  if (
    event.tags.length !== 2 ||
    event.tags.some((tag) => tag.length !== 2 || !["h", "d"].includes(tag[0]))
  ) {
    return null;
  }
  const channelTags = event.tags.filter((tag) => tag[0] === "h");
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  if (channelTags.length !== 1 || dTags.length !== 1) return null;
  const channelId = channelTags[0]?.[1]?.toLowerCase();
  const dTag = dTags[0]?.[1];
  if (!channelId || !UUID_RE.test(channelId) || !dTag) return null;
  if (!dTag.startsWith("company:work:")) return null;
  const match = /^company:work:([0-9a-f-]{36})$/i.exec(dTag);
  if (!match || !UUID_RE.test(match[1])) return null;
  const head = parseHeadContent(event.content);
  if (!head || head.workItemId !== match[1].toLowerCase()) return null;
  return { dTag, channelId, event, head };
}

export function parseCompanyWorkActionEvent(
  event: RelayEvent,
  channelIds: readonly string[] | string,
  workItemId: string,
): CompanyWorkHistoryEntry | null {
  try {
    if (event.kind !== KIND_WORK_ITEM_ACTION || !verifyEvent(event))
      return null;
  } catch {
    return null;
  }
  const dTag = companyWorkDTag(workItemId);
  const allowedChannelIds =
    typeof channelIds === "string" ? [channelIds] : channelIds;
  const hTags = event.tags.filter((tag) => tag[0] === "h");
  const channelId = hTags[0]?.[1]?.toLowerCase();
  if (
    event.tags.length !== 2 ||
    hTags.length !== 1 ||
    !channelId ||
    !allowedChannelIds.some((allowed) => allowed.toLowerCase() === channelId) ||
    event.tags.filter((tag) => tag[0] === "d" && tag[1] === dTag).length !==
      1 ||
    event.tags.some((tag) => !["h", "d"].includes(tag[0]))
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
      "workItemId",
      "action",
      "expectedHeadEventId",
      "head",
      "status",
      "reason",
      "verification",
    ]) ||
    value.schemaVersion !== COMPANY_WORK_SCHEMA_VERSION ||
    value.workItemId !== workItemId ||
    typeof value.action !== "string" ||
    ![
      "create",
      "update",
      "set_status",
      "verify",
      "archive",
      "restore",
    ].includes(value.action)
  ) {
    return null;
  }
  const action = value as unknown as CompanyWorkAction;
  return { event, action, channelId };
}
