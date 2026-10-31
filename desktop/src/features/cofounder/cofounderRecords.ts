import { verifyEvent } from "nostr-tools/pure";

import {
  KIND_COFOUNDER_HEAD,
  KIND_COMPANY_FUNCTION_ACTION,
  KIND_COMPANY_FUNCTION_HEAD,
  KIND_WORKER_RUN_HEAD,
} from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";

export {
  KIND_COFOUNDER_ACTION,
  KIND_COFOUNDER_HEAD,
  KIND_COMPANY_FUNCTION_HEAD,
  KIND_PLAN_ACTION,
  KIND_PLAN_HEAD,
  KIND_WORKER_RUN_HEAD,
} from "@/shared/constants/kinds";

export const COFOUNDER_D_TAG = "company:cofounder";
export const COMPANY_FUNCTION_D_TAG_PREFIX = "company:function:";
export const WORKER_RUN_D_TAG_PREFIX = "company:worker:";
export const COMPANY_RECORD_SCHEMA_VERSION = 1;
export const MAX_WORKER_OUTPUT_BYTES = 16_384;

export type MoneyPreference = "cheapest_first" | "best_option";

export type ApprovalSwitches = {
  approveEveryHire: boolean;
  approvePlaybookChanges: boolean;
  approveEveryDiscoveryCampaign: boolean;
};

export type CofounderSettings = {
  enabled: boolean;
  moneyPreference: MoneyPreference;
  approvalSwitches: ApprovalSwitches;
};

export type CofounderSettingsHead = {
  settings: CofounderSettings;
  eventId: string;
};

export type CofounderSettingsView = {
  exists: boolean;
  eventId: string | null;
  settings: CofounderSettings;
};

export type FunctionId =
  | "sales"
  | "operations"
  | "customer_success"
  | "finance"
  | "brand";

export type SlotState = "empty" | "covered_by_scout" | "filled";

export type CompanyFunctionHead = {
  functionId: FunctionId;
  state: SlotState;
  leadPubkey: string | null;
  eventId: string;
};

export type CompanyFunctionActionInput = {
  functionId: FunctionId;
  kind: "assign_lead" | "cover_by_scout" | "clear";
  leadPubkey?: string;
  expectedHeadEventId: string | null;
};

export type FunctionSlotView = {
  functionId: FunctionId;
  state: SlotState;
  leadPubkey: string | null;
};

export type WorkerStatus = "running" | "done" | "failed" | "cancelled";

export type WorkerRun = {
  workerId: string;
  parentPubkey: string;
  label: string;
  model: string;
  status: WorkerStatus;
  startedAt: number;
  deadlineAt: number;
  finishedAt: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  outputText: string | null;
  failureReason: string | null;
  eventId: string;
};

export const DEFAULT_COFOUNDER_SETTINGS: CofounderSettings = {
  enabled: false,
  moneyPreference: "cheapest_first",
  approvalSwitches: {
    approveEveryHire: false,
    approvePlaybookChanges: false,
    approveEveryDiscoveryCampaign: false,
  },
};

const FUNCTION_IDS = new Set<FunctionId>([
  "sales",
  "operations",
  "customer_success",
  "finance",
  "brand",
]);
export const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;
const WORKER_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pick(
  value: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(value, key)) return value[key];
  }
  return undefined;
}

export function oneTagValue(event: RelayEvent, name: string): string | null {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 && tags[0]?.length === 2
    ? (tags[0][1] ?? null)
    : null;
}

export function isValidRelayHead(
  event: RelayEvent,
  relaySelfPubkey: string,
  expectedKind: number,
): boolean {
  if (
    event.kind !== expectedKind ||
    event.pubkey.toLowerCase() !== relaySelfPubkey.toLowerCase()
  ) {
    return false;
  }
  try {
    return verifyEvent(event);
  } catch {
    return false;
  }
}

function parseSettings(value: unknown): CofounderSettings | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["enabled", "moneyPreference", "approvalSwitches"])
  )
    return null;
  const enabled = pick(value, "enabled");
  const moneyPreference = pick(value, "moneyPreference");
  const rawSwitches = pick(value, "approvalSwitches");
  if (
    !isObject(rawSwitches) ||
    !hasOnlyKeys(rawSwitches, [
      "approveEveryHire",
      "approvePlaybookChanges",
      "approveEveryDiscoveryCampaign",
    ])
  )
    return null;
  const approveEveryHire = pick(rawSwitches, "approveEveryHire");
  const approvePlaybookChanges = pick(rawSwitches, "approvePlaybookChanges");
  const approveEveryDiscoveryCampaign = pick(
    rawSwitches,
    "approveEveryDiscoveryCampaign",
  );
  if (
    typeof enabled !== "boolean" ||
    (moneyPreference !== "cheapest_first" &&
      moneyPreference !== "best_option") ||
    typeof approveEveryHire !== "boolean" ||
    typeof approvePlaybookChanges !== "boolean" ||
    typeof approveEveryDiscoveryCampaign !== "boolean"
  ) {
    return null;
  }
  return {
    enabled,
    moneyPreference,
    approvalSwitches: {
      approveEveryHire,
      approvePlaybookChanges,
      approveEveryDiscoveryCampaign,
    },
  };
}

export function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

export function parseCofounderSettingsHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): CofounderSettingsHead | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_COFOUNDER_HEAD))
    return null;
  if (oneTagValue(event, "d") !== COFOUNDER_D_TAG) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "settings",
      "updatedByPubkey",
      "updatedAt",
    ])
  )
    return null;
  const schemaVersion = pick(content, "schemaVersion");
  const settings = parseSettings(pick(content, "settings"));
  const updatedByPubkey = pick(content, "updatedByPubkey");
  return schemaVersion === COMPANY_RECORD_SCHEMA_VERSION &&
    settings &&
    typeof updatedByPubkey === "string" &&
    PUBKEY_PATTERN.test(updatedByPubkey) &&
    readNumber(content, "updatedAt") !== null
    ? { settings, eventId: event.id }
    : null;
}

export function companyFunctionDTag(functionId: FunctionId): string {
  return `${COMPANY_FUNCTION_D_TAG_PREFIX}${functionId}`;
}

/** Build the member-signed function slot action (kind 47061). */
export function buildCompanyFunctionActionEvent(
  input: CompanyFunctionActionInput,
): { content: string; tags: string[][] } {
  const content: Record<string, unknown> = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    function: input.functionId,
    kind: input.kind,
    ...(input.leadPubkey ? { leadPubkey: input.leadPubkey } : {}),
    ...(input.expectedHeadEventId
      ? { expectedHeadEventId: input.expectedHeadEventId }
      : {}),
  };
  return {
    content: JSON.stringify(content),
    tags: [["d", companyFunctionDTag(input.functionId)]],
  };
}

export { KIND_COMPANY_FUNCTION_ACTION };

export function parseCompanyFunctionHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): CompanyFunctionHead | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_COMPANY_FUNCTION_HEAD)) {
    return null;
  }
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(COMPANY_FUNCTION_D_TAG_PREFIX)) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "function",
      "state",
      "leadPubkey",
      "updatedByPubkey",
      "updatedAt",
    ])
  )
    return null;
  const schemaVersion = pick(content, "schemaVersion");
  const functionId = pick(content, "function");
  const state = pick(content, "state");
  const rawLeadPubkey = pick(content, "leadPubkey");
  const leadPubkey =
    typeof rawLeadPubkey === "string" ? rawLeadPubkey.toLowerCase() : null;
  const updatedByPubkey = pick(content, "updatedByPubkey");
  if (
    schemaVersion !== COMPANY_RECORD_SCHEMA_VERSION ||
    typeof functionId !== "string" ||
    !FUNCTION_IDS.has(functionId as FunctionId) ||
    dTag !== companyFunctionDTag(functionId as FunctionId) ||
    (state !== "empty" && state !== "covered_by_scout" && state !== "filled") ||
    (state === "filled" && (!leadPubkey || !PUBKEY_PATTERN.test(leadPubkey))) ||
    (state !== "filled" && rawLeadPubkey != null) ||
    typeof updatedByPubkey !== "string" ||
    !PUBKEY_PATTERN.test(updatedByPubkey) ||
    readNumber(content, "updatedAt") === null
  ) {
    return null;
  }
  return {
    functionId: functionId as FunctionId,
    state,
    leadPubkey: state === "filled" ? leadPubkey : null,
    eventId: event.id,
  };
}

export function readNumber(
  value: Record<string, unknown>,
  key: string,
): number | null {
  const raw = pick(value, key);
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0)
    return raw;
  return null;
}

export function workerRunDTag(workerId: string): string {
  return `${WORKER_RUN_D_TAG_PREFIX}${workerId}`;
}

export function parseWorkerRunHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): WorkerRun | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_WORKER_RUN_HEAD))
    return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(WORKER_RUN_D_TAG_PREFIX)) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "run",
      "updatedByPubkey",
      "updatedAt",
      "sourceActionEventId",
    ])
  )
    return null;
  const run = pick(content, "run");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    !isObject(run) ||
    !hasOnlyKeys(run, [
      "workerId",
      "parentPubkey",
      "label",
      "model",
      "status",
      "startedAt",
      "deadlineAt",
      "finishedAt",
      "inputTokens",
      "outputTokens",
      "costUsd",
      "outputText",
      "failureReason",
    ]) ||
    typeof pick(content, "updatedByPubkey") !== "string" ||
    !PUBKEY_PATTERN.test(pick(content, "updatedByPubkey") as string) ||
    readNumber(content, "updatedAt") === null ||
    typeof pick(content, "sourceActionEventId") !== "string" ||
    !/^[0-9a-f]{64}$/i.test(pick(content, "sourceActionEventId") as string)
  ) {
    return null;
  }

  const workerId = pick(run, "workerId");
  const parentPubkey = pick(run, "parentPubkey");
  const label = pick(run, "label");
  const model = pick(run, "model");
  const status = pick(run, "status");
  const startedAt = readNumber(run, "startedAt");
  const deadlineAt = readNumber(run, "deadlineAt");
  const finishedAtValue = pick(run, "finishedAt");
  const finishedAt =
    finishedAtValue == null ? null : readNumber(run, "finishedAt");
  const inputTokens = readNumber(run, "inputTokens");
  const outputTokens = readNumber(run, "outputTokens");
  const rawCost = pick(run, "costUsd");
  const costUsd =
    rawCost == null
      ? null
      : typeof rawCost === "number" && Number.isFinite(rawCost) && rawCost >= 0
        ? rawCost
        : Number.NaN;
  const rawOutput = pick(run, "outputText");
  const outputText = typeof rawOutput === "string" ? rawOutput : null;
  const rawFailureReason = pick(run, "failureReason");
  const failureReason =
    typeof rawFailureReason === "string" ? rawFailureReason : null;
  const parentTag = oneTagValue(event, "p");
  if (
    typeof workerId !== "string" ||
    !WORKER_ID_PATTERN.test(workerId) ||
    dTag !== workerRunDTag(workerId) ||
    typeof parentPubkey !== "string" ||
    !PUBKEY_PATTERN.test(parentPubkey) ||
    parentTag?.toLowerCase() !== parentPubkey.toLowerCase() ||
    event.tags.some((tag) => tag[0] === "h") ||
    typeof label !== "string" ||
    label.trim().length === 0 ||
    typeof model !== "string" ||
    model.trim().length === 0 ||
    (status !== "running" &&
      status !== "done" &&
      status !== "failed" &&
      status !== "cancelled") ||
    startedAt === null ||
    deadlineAt === null ||
    (finishedAtValue != null && finishedAt === null) ||
    inputTokens === null ||
    outputTokens === null ||
    (costUsd !== null && !Number.isFinite(costUsd)) ||
    (rawOutput != null && typeof rawOutput !== "string") ||
    (rawFailureReason != null && typeof rawFailureReason !== "string") ||
    (outputText !== null &&
      new TextEncoder().encode(outputText).byteLength > MAX_WORKER_OUTPUT_BYTES)
  ) {
    return null;
  }
  return {
    workerId,
    parentPubkey: parentPubkey.toLowerCase(),
    label,
    model,
    status,
    startedAt,
    deadlineAt,
    finishedAt,
    inputTokens,
    outputTokens,
    costUsd,
    outputText,
    failureReason,
    eventId: event.id,
  };
}

export function workerEffectiveStatus(
  run: WorkerRun,
  nowSeconds = Math.floor(Date.now() / 1000),
): WorkerStatus {
  return run.status === "running" && run.deadlineAt < nowSeconds
    ? "failed"
    : run.status;
}

export function workerEffectiveFailureReason(
  run: WorkerRun,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  if (run.status === "running" && run.deadlineAt < nowSeconds) {
    return "The worker ran past its deadline without reporting an end.";
  }
  return run.failureReason;
}
