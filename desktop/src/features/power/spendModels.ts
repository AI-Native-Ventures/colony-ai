import { verifyEvent } from "nostr-tools/pure";

import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_AI_SPEND_RECORD_HEAD,
  KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
} from "@/shared/constants/kinds";

export const COMPANY_SPEND_SCHEMA_VERSION = 1;
export const COMPANY_SPEND_HEAD_QUERY_LIMIT = 10_000;
const HEX_64 = /^[0-9a-f]{64}$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;
const MAX_MINOR_UNIT = 18_446_744_073_709_551_615n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AllowancePeriod = "day" | "week" | "month";
export type AllowanceValue = { amountCents: string; period: AllowancePeriod };
export type TemporaryAllowance = {
  allowance: AllowanceValue;
  expiresAt: string;
};
export type EmployeeAllowanceAction = {
  schemaVersion: number;
  employeePubkey: string;
  expectedHeadEventId?: string;
  allowance: AllowanceValue;
  temporaryAllowance?: TemporaryAllowance;
  fundingOrder: string[];
};
export type EmployeeAllowanceHead = {
  schemaVersion: number;
  employeePubkey: string;
  allowance: AllowanceValue;
  temporaryAllowance?: TemporaryAllowance;
  fundingOrder: string[];
  actorPubkey: string;
  updatedAt: string;
  sourceActionEventId: string;
};
export type EmployeeAllowanceHeadRecord = {
  dTag: string;
  event: RelayEvent;
  head: EmployeeAllowanceHead;
};

export type AgentTurnSpendRecord = {
  recordType: "agent_turn";
  employeePubkey: string;
  model?: string;
  sourceUsageEventId: string;
  estimatedAmountNanoUsd?: string;
  isEstimate: true;
  sourceOfFunds:
    | "colony_credits"
    | "provider_subscription"
    | "provider_api_key"
    | "unknown";
  reportedAt: string;
};
export type ExternalCostSpendRecord = {
  recordType: "external_cost";
  provider: string;
  description: string;
  costType: "subscription" | "credit_top_up";
  actualCashCostCents: string;
  recordedDate: string;
};
export type AiSpendRecord = AgentTurnSpendRecord | ExternalCostSpendRecord;
export type AiSpendRecordStatus = "active" | "removed";
export type AiSpendRecordAction = {
  schemaVersion: number;
  recordId: string;
  action: "record" | "remove";
  expectedHeadEventId?: string;
  record?: AiSpendRecord;
};
export type AiSpendRecordHead = {
  schemaVersion: number;
  recordId: string;
  record: AiSpendRecord;
  status: AiSpendRecordStatus;
  actorPubkey: string;
  updatedAt: string;
  sourceActionEventId: string;
};
export type AiSpendRecordHeadRecord = {
  dTag: string;
  event: RelayEvent;
  head: AiSpendRecordHead;
};

export function employeeAllowanceDTag(employeePubkey: string) {
  return `company:employee-allowance:${employeePubkey}`;
}

export function aiSpendRecordDTag(recordId: string) {
  return `company:ai-spend:${recordId}`;
}

export function allowanceActionTags(action: EmployeeAllowanceAction) {
  return [
    ["d", employeeAllowanceDTag(action.employeePubkey)],
    ["p", action.employeePubkey],
  ];
}

export function spendActionTags(action: AiSpendRecordAction) {
  const tags: string[][] = [["d", aiSpendRecordDTag(action.recordId)]];
  if (action.record?.recordType === "agent_turn") {
    tags.push(["p", action.record.employeePubkey]);
  }
  return tags;
}

export function parseEmployeeAllowanceHeadEvent(
  event: RelayEvent,
  relaySelf: string,
): EmployeeAllowanceHeadRecord | null {
  try {
    if (
      event.kind !== KIND_EMPLOYEE_AI_ALLOWANCE_HEAD ||
      event.pubkey.toLowerCase() !== relaySelf.toLowerCase() ||
      !verifyEvent(event)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  if (!isDTag(event, employeeAllowanceDTagFromContent(event.content))) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!isAllowanceHead(parsed)) return null;
  const dTag = employeeAllowanceDTag(parsed.employeePubkey);
  if (!isDTag(event, dTag)) return null;
  return { dTag, event, head: parsed };
}

export function parseAiSpendRecordHeadEvent(
  event: RelayEvent,
  relaySelf: string,
): AiSpendRecordHeadRecord | null {
  try {
    if (
      event.kind !== KIND_AI_SPEND_RECORD_HEAD ||
      event.pubkey.toLowerCase() !== relaySelf.toLowerCase() ||
      !verifyEvent(event)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (!isSpendHead(parsed)) return null;
  const dTag = aiSpendRecordDTag(parsed.recordId);
  if (!isDTag(event, dTag)) return null;
  return { dTag, event, head: parsed };
}

export function parseAgentTurnPayload(
  event: RelayEvent,
  ownerPubkey: string,
): {
  employeePubkey: string;
  model?: string;
  reportedAt: string;
  estimatedAmountNanoUsd?: string;
} | null {
  try {
    if (event.kind !== 44_200 || !HEX_64.test(event.id)) {
      return null;
    }
  } catch {
    return null;
  }
  const agentTags = event.tags.filter((tag) => tag[0] === "agent");
  const ownerTags = event.tags.filter((tag) => tag[0] === "p");
  if (agentTags.length !== 1 || !HEX_64.test(agentTags[0]?.[1] ?? "")) {
    return null;
  }
  if (
    ownerTags.length !== 1 ||
    ownerTags[0]?.[1]?.toLowerCase() !== ownerPubkey.toLowerCase()
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(event.content) as {
      timestamp?: unknown;
      turn?: { costUsd?: unknown } | null;
      model?: unknown;
      pricingIdentity?: { model?: unknown } | null;
    };
    if (
      typeof payload.timestamp !== "string" ||
      Number.isNaN(Date.parse(payload.timestamp))
    ) {
      return null;
    }
    const result: {
      employeePubkey: string;
      model?: string;
      reportedAt: string;
      estimatedAmountNanoUsd?: string;
    } = { employeePubkey: agentTags[0][1], reportedAt: payload.timestamp };
    if (event.pubkey.toLowerCase() !== result.employeePubkey.toLowerCase()) {
      return null;
    }
    const model =
      typeof payload.pricingIdentity?.model === "string"
        ? payload.pricingIdentity.model
        : typeof payload.model === "string"
          ? payload.model
          : undefined;
    if (model?.trim()) result.model = model.trim();
    if (typeof payload.turn?.costUsd === "number") {
      const nanoUsd = estimatedUsdToNanoUsd(payload.turn.costUsd);
      if (nanoUsd === null) return null;
      result.estimatedAmountNanoUsd = nanoUsd;
    }
    return result;
  } catch {
    return null;
  }
}

export function estimatedUsdToNanoUsd(amount: number): string | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const source = amount.toString().toLowerCase();
  const [coefficient, exponentText] = source.split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`;
  const decimalPlaces = fraction.length - exponent;
  const scaledPlaces = 9 - decimalPlaces;
  let value = BigInt(digits || "0");
  if (scaledPlaces >= 0) {
    value *= 10n ** BigInt(scaledPlaces);
  } else {
    const divisor = 10n ** BigInt(-scaledPlaces);
    value = (value + divisor / 2n) / divisor;
  }
  return value.toString();
}

export function allowancePeriodStart(period: AllowancePeriod, now: Date) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  if (period === "week") {
    const daysFromMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysFromMonday);
  } else if (period === "month") {
    start.setUTCDate(1);
  }
  return start;
}

export function effectiveAllowanceAt(head: EmployeeAllowanceHead, now: Date) {
  if (
    head.temporaryAllowance &&
    Date.parse(head.temporaryAllowance.expiresAt) > now.getTime()
  ) {
    return { allowance: head.temporaryAllowance.allowance, temporary: true };
  }
  return { allowance: head.allowance, temporary: false };
}

export function parseUsdCents(value: string): string | null {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = BigInt(match[1] ?? "0") * 100n + BigInt(fraction || "0");
  return cents <= MAX_MINOR_UNIT ? cents.toString() : null;
}

export function formatUsdCents(value: string | bigint): string {
  const cents = typeof value === "bigint" ? value : BigInt(value);
  const dollars = cents / 100n;
  const remainder = (cents % 100n).toString().padStart(2, "0");
  return `USD ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(dollars)}.${remainder}`;
}

function employeeAllowanceDTagFromContent(content: string) {
  try {
    const value = JSON.parse(content) as { employeePubkey?: unknown };
    return typeof value.employeePubkey === "string"
      ? employeeAllowanceDTag(value.employeePubkey)
      : "";
  } catch {
    return "";
  }
}

function isDTag(event: RelayEvent, expected: string) {
  return (
    expected.length > 0 &&
    event.tags.length === 1 &&
    event.tags[0]?.length === 2 &&
    event.tags[0]?.[0] === "d" &&
    event.tags[0]?.[1] === expected
  );
}

function isAllowance(value: unknown): value is AllowanceValue {
  if (!isObject(value) || !hasOnlyKeys(value, ["amountCents", "period"])) {
    return false;
  }
  return (
    typeof value.amountCents === "string" &&
    INTEGER.test(value.amountCents) &&
    value.amountCents.length <= 20 &&
    BigInt(value.amountCents) <= 18_446_744_073_709_551_615n &&
    ["day", "week", "month"].includes(String(value.period))
  );
}

function isAllowanceHead(value: unknown): value is EmployeeAllowanceHead {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "employeePubkey",
      "allowance",
      "temporaryAllowance",
      "fundingOrder",
      "actorPubkey",
      "updatedAt",
      "sourceActionEventId",
    ]) ||
    value.schemaVersion !== COMPANY_SPEND_SCHEMA_VERSION ||
    typeof value.employeePubkey !== "string" ||
    !HEX_64.test(value.employeePubkey) ||
    !isAllowance(value.allowance) ||
    !Array.isArray(value.fundingOrder) ||
    !value.fundingOrder.every((item) => typeof item === "string") ||
    typeof value.actorPubkey !== "string" ||
    !HEX_64.test(value.actorPubkey) ||
    typeof value.updatedAt !== "string" ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX_64.test(value.sourceActionEventId)
  ) {
    return false;
  }
  if (value.temporaryAllowance !== undefined) {
    const temporary = value.temporaryAllowance;
    if (
      !isObject(temporary) ||
      !hasOnlyKeys(temporary, ["allowance", "expiresAt"]) ||
      !isAllowance(temporary.allowance) ||
      temporary.allowance.period !== value.allowance.period ||
      BigInt(temporary.allowance.amountCents) <
        BigInt(value.allowance.amountCents) ||
      typeof temporary.expiresAt !== "string" ||
      Number.isNaN(Date.parse(temporary.expiresAt))
    ) {
      return false;
    }
  }
  return true;
}

function isSpendRecord(value: unknown): value is AiSpendRecord {
  if (!isObject(value) || typeof value.recordType !== "string") return false;
  if (value.recordType === "agent_turn") {
    return (
      hasOnlyKeys(value, [
        "recordType",
        "employeePubkey",
        "model",
        "sourceUsageEventId",
        "estimatedAmountNanoUsd",
        "isEstimate",
        "sourceOfFunds",
        "reportedAt",
      ]) &&
      typeof value.employeePubkey === "string" &&
      HEX_64.test(value.employeePubkey) &&
      (value.model === undefined ||
        (typeof value.model === "string" &&
          value.model.trim().length > 0 &&
          value.model.length <= 160)) &&
      typeof value.sourceUsageEventId === "string" &&
      HEX_64.test(value.sourceUsageEventId) &&
      (value.estimatedAmountNanoUsd === undefined ||
        (typeof value.estimatedAmountNanoUsd === "string" &&
          INTEGER.test(value.estimatedAmountNanoUsd))) &&
      value.isEstimate === true &&
      [
        "colony_credits",
        "provider_subscription",
        "provider_api_key",
        "unknown",
      ].includes(String(value.sourceOfFunds)) &&
      typeof value.reportedAt === "string" &&
      !Number.isNaN(Date.parse(value.reportedAt))
    );
  }
  return (
    value.recordType === "external_cost" &&
    hasOnlyKeys(value, [
      "recordType",
      "provider",
      "description",
      "costType",
      "actualCashCostCents",
      "recordedDate",
    ]) &&
    typeof value.provider === "string" &&
    value.provider.trim().length > 0 &&
    typeof value.description === "string" &&
    value.description.trim().length > 0 &&
    ["subscription", "credit_top_up"].includes(String(value.costType)) &&
    typeof value.actualCashCostCents === "string" &&
    INTEGER.test(value.actualCashCostCents) &&
    value.actualCashCostCents.length <= 20 &&
    BigInt(value.actualCashCostCents) <= 18_446_744_073_709_551_615n &&
    typeof value.recordedDate === "string" &&
    !Number.isNaN(Date.parse(`${value.recordedDate}T00:00:00Z`))
  );
}

function isSpendHead(value: unknown): value is AiSpendRecordHead {
  return (
    isObject(value) &&
    hasOnlyKeys(value, [
      "schemaVersion",
      "recordId",
      "record",
      "status",
      "actorPubkey",
      "updatedAt",
      "sourceActionEventId",
    ]) &&
    value.schemaVersion === COMPANY_SPEND_SCHEMA_VERSION &&
    typeof value.recordId === "string" &&
    ((isObject(value.record) &&
      value.record.recordType === "agent_turn" &&
      value.recordId === `usage:${value.record.sourceUsageEventId}`) ||
      (isObject(value.record) &&
        value.record.recordType === "external_cost" &&
        UUID.test(value.recordId.slice(5)) &&
        value.recordId === `cost:${value.recordId.slice(5)}`)) &&
    isSpendRecord(value.record) &&
    (value.status === "active" || value.status === "removed") &&
    typeof value.actorPubkey === "string" &&
    HEX_64.test(value.actorPubkey) &&
    typeof value.updatedAt === "string" &&
    typeof value.sourceActionEventId === "string" &&
    HEX_64.test(value.sourceActionEventId)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
