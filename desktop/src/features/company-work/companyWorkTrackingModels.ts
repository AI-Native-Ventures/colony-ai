import { verifyEvent } from "nostr-tools/pure";

import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_COMPANY_WORK_TRACKING_ACTION,
  KIND_COMPANY_WORK_TRACKING_HEAD,
} from "@/shared/constants/kinds";
import type { CompanyWorkInput } from "./companyWorkModels";

export const COMPANY_WORK_TRACKING_SCHEMA_VERSION = 1;
export const COMPANY_WORK_TRACKING_HEAD_QUERY_LIMIT = 10_000;
export const COMPANY_WORK_TRACKING_ACTION_QUERY_LIMIT = 5_000;

export type CompanyWorkCheckWhen =
  | "no_update"
  | "due_date_passes"
  | "worker_reports_failure";

export type CompanyWorkWatchdogConfig = {
  checkWhen: CompanyWorkCheckWhen;
  checkIntervalSeconds: number;
  askFirstPubkey?: string;
  escalateToPubkey?: string;
  escalationIntervalSeconds?: number;
};

export type CompanyWorkSuggestionHead = {
  recordType: "commitment_suggestion";
  schemaVersion: number;
  suggestionId: string;
  sourceEventId: string;
  sourceChannelId: string;
  proposedByPubkey: string;
  expiresAt?: string;
  workItem: CompanyWorkInput;
  status: "pending" | "accepted" | "dismissed" | "expired";
  acceptedWorkItemId?: string;
  sourceActionEventId: string;
};

export type CompanyWorkWatchdogHead = {
  recordType: "watchdog_configuration";
  schemaVersion: number;
  workItemId: string;
  enabled: boolean;
  config?: CompanyWorkWatchdogConfig;
  sourceActionEventId: string;
};

export type CompanyWorkTrackingHead =
  | CompanyWorkSuggestionHead
  | CompanyWorkWatchdogHead;

export type CompanyWorkTrackingHeadRecord = {
  dTag: string;
  channelId: string;
  event: RelayEvent;
  head: CompanyWorkTrackingHead;
};

export type CompanyWorkTrackingAction = {
  schemaVersion: number;
  action: "accept" | "dismiss" | "expire" | "configure" | "disable";
  recordId: string;
  expectedHeadEventId?: string;
  acceptedWorkItemId?: string;
  config?: CompanyWorkWatchdogConfig;
};

export type CompanyWorkSuggestionAcceptanceEntry = {
  event: RelayEvent;
  channelId: string;
  action: {
    action: "accept";
    recordId: string;
    acceptedWorkItemId: string;
  };
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/i;
const UTC_RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const CHECK_WHEN = new Set<CompanyWorkCheckWhen>([
  "no_update",
  "due_date_passes",
  "worker_reports_failure",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isUtcRfc3339(value: unknown): value is string {
  return (
    typeof value === "string" &&
    UTC_RFC3339_RE.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function companyWorkSuggestionDTag(suggestionId: string) {
  if (!UUID_RE.test(suggestionId)) {
    throw new Error("Commitment suggestion coordinates require a UUID.");
  }
  return `company:work-suggestion:${suggestionId.toLowerCase()}`;
}

export function companyWorkWatchdogDTag(workItemId: string) {
  if (!UUID_RE.test(workItemId)) {
    throw new Error("Watchdog coordinates require a work-item UUID.");
  }
  return `company:work-watchdog:${workItemId.toLowerCase()}`;
}

function parseWorkInput(value: unknown): CompanyWorkInput | null {
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
      "dueAt",
    ]) ||
    value.schemaVersion !== COMPANY_WORK_TRACKING_SCHEMA_VERSION ||
    typeof value.workItemId !== "string" ||
    !UUID_RE.test(value.workItemId) ||
    typeof value.title !== "string" ||
    value.title.trim().length === 0 ||
    value.status !== "active" ||
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
    !value.deliverables.every((entry) => {
      if (
        !isObject(entry) ||
        !hasOnlyKeys(entry, [
          "deliverableId",
          "versionEventId",
          "contentDigest",
          "mediaDigest",
          "versionDigest",
        ])
      ) {
        return false;
      }
      return (
        typeof entry.deliverableId === "string" &&
        UUID_RE.test(entry.deliverableId) &&
        [
          "versionEventId",
          "contentDigest",
          "mediaDigest",
          "versionDigest",
        ].every(
          (field) =>
            typeof entry[field] === "string" &&
            HEX64_RE.test(entry[field] as string),
        )
      );
    }) ||
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
    (value.dueAt !== undefined && !isUtcRfc3339(value.dueAt))
  ) {
    return null;
  }
  return value as unknown as CompanyWorkInput;
}

function parseWatchdogConfig(value: unknown): CompanyWorkWatchdogConfig | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "checkWhen",
      "checkIntervalSeconds",
      "askFirstPubkey",
      "escalateToPubkey",
      "escalationIntervalSeconds",
    ]) ||
    typeof value.checkWhen !== "string" ||
    !CHECK_WHEN.has(value.checkWhen as CompanyWorkCheckWhen) ||
    !Number.isInteger(value.checkIntervalSeconds) ||
    (value.checkIntervalSeconds as number) <= 0 ||
    (value.askFirstPubkey !== undefined &&
      (typeof value.askFirstPubkey !== "string" ||
        !HEX64_RE.test(value.askFirstPubkey))) ||
    (value.escalateToPubkey !== undefined &&
      (typeof value.escalateToPubkey !== "string" ||
        !HEX64_RE.test(value.escalateToPubkey))) ||
    (value.escalationIntervalSeconds !== undefined &&
      (!Number.isInteger(value.escalationIntervalSeconds) ||
        (value.escalationIntervalSeconds as number) <= 0))
  ) {
    return null;
  }
  return value as unknown as CompanyWorkWatchdogConfig;
}

function parseHeadContent(content: string): CompanyWorkTrackingHead | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isObject(value) || value.schemaVersion !== 1) return null;
  if (value.recordType === "commitment_suggestion") {
    if (
      !hasOnlyKeys(value, [
        "recordType",
        "schemaVersion",
        "suggestionId",
        "sourceEventId",
        "sourceChannelId",
        "proposedByPubkey",
        "expiresAt",
        "workItem",
        "status",
        "acceptedWorkItemId",
        "sourceActionEventId",
      ]) ||
      typeof value.suggestionId !== "string" ||
      !UUID_RE.test(value.suggestionId) ||
      typeof value.sourceEventId !== "string" ||
      !HEX64_RE.test(value.sourceEventId) ||
      typeof value.sourceChannelId !== "string" ||
      !UUID_RE.test(value.sourceChannelId) ||
      typeof value.proposedByPubkey !== "string" ||
      !HEX64_RE.test(value.proposedByPubkey) ||
      (value.expiresAt !== undefined && !isUtcRfc3339(value.expiresAt)) ||
      !["pending", "accepted", "dismissed", "expired"].includes(
        value.status as string,
      ) ||
      (value.acceptedWorkItemId !== undefined &&
        (typeof value.acceptedWorkItemId !== "string" ||
          !UUID_RE.test(value.acceptedWorkItemId))) ||
      typeof value.sourceActionEventId !== "string" ||
      !HEX64_RE.test(value.sourceActionEventId)
    ) {
      return null;
    }
    const workItem = parseWorkInput(value.workItem);
    if (!workItem) return null;
    if (
      (value.status === "accepted") !==
      (value.acceptedWorkItemId !== undefined)
    ) {
      return null;
    }
    return {
      recordType: "commitment_suggestion",
      schemaVersion: 1,
      suggestionId: value.suggestionId.toLowerCase(),
      sourceEventId: value.sourceEventId.toLowerCase(),
      sourceChannelId: value.sourceChannelId.toLowerCase(),
      proposedByPubkey: value.proposedByPubkey.toLowerCase(),
      ...(typeof value.expiresAt === "string"
        ? { expiresAt: value.expiresAt }
        : {}),
      workItem,
      status: value.status as CompanyWorkSuggestionHead["status"],
      ...(typeof value.acceptedWorkItemId === "string"
        ? { acceptedWorkItemId: value.acceptedWorkItemId.toLowerCase() }
        : {}),
      sourceActionEventId: value.sourceActionEventId.toLowerCase(),
    };
  }
  if (value.recordType !== "watchdog_configuration") return null;
  const config =
    value.config === undefined ? undefined : parseWatchdogConfig(value.config);
  if (
    !hasOnlyKeys(value, [
      "recordType",
      "schemaVersion",
      "workItemId",
      "enabled",
      "config",
      "sourceActionEventId",
    ]) ||
    typeof value.workItemId !== "string" ||
    !UUID_RE.test(value.workItemId) ||
    typeof value.enabled !== "boolean" ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX64_RE.test(value.sourceActionEventId) ||
    (value.config !== undefined && !config) ||
    (value.enabled && !config)
  ) {
    return null;
  }
  return {
    recordType: "watchdog_configuration",
    schemaVersion: 1,
    workItemId: value.workItemId.toLowerCase(),
    enabled: value.enabled,
    ...(config ? { config } : {}),
    sourceActionEventId: value.sourceActionEventId.toLowerCase(),
  };
}

export function parseCompanyWorkTrackingHeadEvent(
  event: RelayEvent,
  relaySelf: string,
): CompanyWorkTrackingHeadRecord | null {
  try {
    if (
      event.kind !== KIND_COMPANY_WORK_TRACKING_HEAD ||
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
  const channelId = event.tags
    .find((tag) => tag[0] === "h")?.[1]
    ?.toLowerCase();
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (!channelId || !UUID_RE.test(channelId) || !dTag) return null;
  const head = parseHeadContent(event.content);
  if (!head) return null;
  if (head.recordType === "commitment_suggestion") {
    const expectedDTag = `company:work-suggestion:${head.suggestionId}`;
    if (
      dTag !== expectedDTag ||
      head.sourceChannelId !== channelId ||
      head.workItem.sourceEventId !== head.sourceEventId
    ) {
      return null;
    }
  }
  if (
    head.recordType === "watchdog_configuration" &&
    dTag !== `company:work-watchdog:${head.workItemId}`
  ) {
    return null;
  }
  return { dTag, channelId, event, head };
}

export function parseCompanyWorkSuggestionAcceptanceEvent(
  event: RelayEvent,
  channelId: string,
  workItemId: string,
): CompanyWorkSuggestionAcceptanceEntry | null {
  try {
    if (
      event.kind !== KIND_COMPANY_WORK_TRACKING_ACTION ||
      !verifyEvent(event)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const hTags = event.tags.filter((tag) => tag[0] === "h");
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  const eventChannelId = hTags[0]?.[1]?.toLowerCase();
  if (
    event.tags.length !== 2 ||
    hTags.length !== 1 ||
    dTags.length !== 1 ||
    eventChannelId !== channelId.toLowerCase() ||
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
      "action",
      "recordId",
      "expectedHeadEventId",
      "acceptedWorkItemId",
    ]) ||
    value.schemaVersion !== 1 ||
    value.action !== "accept" ||
    typeof value.recordId !== "string" ||
    !UUID_RE.test(value.recordId) ||
    dTags[0]?.[1] !== companyWorkSuggestionDTag(value.recordId) ||
    typeof value.expectedHeadEventId !== "string" ||
    !HEX64_RE.test(value.expectedHeadEventId) ||
    typeof value.acceptedWorkItemId !== "string" ||
    !UUID_RE.test(value.acceptedWorkItemId) ||
    value.acceptedWorkItemId.toLowerCase() !== workItemId.toLowerCase()
  ) {
    return null;
  }
  return {
    event,
    channelId: eventChannelId,
    action: {
      action: "accept",
      recordId: value.recordId.toLowerCase(),
      acceptedWorkItemId: value.acceptedWorkItemId.toLowerCase(),
    },
  };
}
