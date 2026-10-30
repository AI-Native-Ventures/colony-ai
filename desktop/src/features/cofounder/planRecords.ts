import { KIND_PLAN_HEAD } from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";

import {
  COMPANY_RECORD_SCHEMA_VERSION,
  hasOnlyKeys,
  isObject,
  isValidRelayHead,
  oneTagValue,
  parseJson,
  pick,
  readNumber,
} from "./cofounderRecords";
import type { FunctionId } from "./cofounderRecords";

export { KIND_PLAN_ACTION, KIND_PLAN_HEAD } from "@/shared/constants/kinds";

export const PLAN_D_TAG_PREFIX = "company:plan:";
export const MAX_PLAN_STEPS = 24;
export const MAX_PLAN_APPROVALS = 200;

export type PlanStatus =
  | "proposed"
  | "approved"
  | "completed"
  | "rejected"
  | "cancelled";

export type PlanStepStatus =
  | "pending"
  | "waiting_approval"
  | "approved"
  | "in_progress"
  | "done"
  | "skipped"
  | "failed";

export type PlanApprovalKind =
  | "outreach"
  | "spend"
  | "taste"
  | "hire"
  | "other";

export type PlanOwnerKind = "function" | "lead_agent" | "worker" | "owner";

export type PlanDecision = "approved" | "rejected" | "edited" | "cancelled";

export type PlanStepOwnerView = {
  kind: PlanOwnerKind;
  functionId: FunctionId | null;
  agentPubkey: string | null;
  workerType: string | null;
};

export type PlanStepView = {
  stepId: string;
  title: string;
  detail: string | null;
  owner: PlanStepOwnerView;
  tools: string[];
  costLabel: string;
  costEstimateCents: number;
  whenLabel: string;
  approvalPoint: { kind: PlanApprovalKind; prompt: string } | null;
  status: PlanStepStatus;
  note: string | null;
};

export type PlanApprovalRecordView = {
  scope: "plan" | "step";
  stepId: string | null;
  decision: PlanDecision;
  actorPubkey: string;
  at: number;
  revision: number;
  note: string | null;
  actionEventId: string;
};

export type PlanView = {
  planId: string;
  status: PlanStatus;
  revision: number;
  title: string;
  summary: string;
  functionId: FunctionId | null;
  currency: string;
  budgetCents: number;
  decideBy: number | null;
  targetLabel: string | null;
  timingLabel: string | null;
  steps: PlanStepView[];
  proposedByPubkey: string;
  proposedAt: number;
  updatedByPubkey: string;
  updatedAt: number;
  approvals: PlanApprovalRecordView[];
  /** Id of the head event: every write must name it as the expected head. */
  eventId: string;
};

const PLAN_STATUSES = new Set<PlanStatus>([
  "proposed",
  "approved",
  "completed",
  "rejected",
  "cancelled",
]);
const STEP_STATUSES = new Set<PlanStepStatus>([
  "pending",
  "waiting_approval",
  "approved",
  "in_progress",
  "done",
  "skipped",
  "failed",
]);
export const APPROVAL_KINDS = new Set<PlanApprovalKind>([
  "outreach",
  "spend",
  "taste",
  "hire",
  "other",
]);
const OWNER_KINDS = new Set<PlanOwnerKind>([
  "function",
  "lead_agent",
  "worker",
  "owner",
]);
const DECISIONS = new Set<PlanDecision>([
  "approved",
  "rejected",
  "edited",
  "cancelled",
]);
export const FUNCTION_IDS = new Set<string>([
  "sales",
  "operations",
  "customer_success",
  "finance",
  "brand",
]);
export const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
const PLAN_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const STEP_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function planDTag(planId: string): string {
  return `${PLAN_D_TAG_PREFIX}${planId}`;
}

export function text(
  value: unknown,
  max: number,
  allowEmpty = false,
): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  if (!allowEmpty && value.trim().length === 0) return null;
  return value;
}

export function optionalText(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string | null | undefined {
  const raw = pick(record, key);
  if (raw === undefined || raw === null) return null;
  const value = text(raw, max);
  return value === null ? undefined : value;
}

function parseStep(value: unknown): PlanStepView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "stepId",
      "title",
      "detail",
      "owner",
      "tools",
      "costLabel",
      "costEstimateCents",
      "whenLabel",
      "approvalPoint",
      "status",
      "note",
    ])
  )
    return null;
  const stepId = pick(value, "stepId");
  const title = text(pick(value, "title"), 160);
  const detail = optionalText(value, "detail", 600);
  const costLabel = text(pick(value, "costLabel"), 80);
  const whenLabel = text(pick(value, "whenLabel"), 80);
  const note = optionalText(value, "note", 500);
  const status = pick(value, "status");
  const rawCost = pick(value, "costEstimateCents");
  const costEstimateCents =
    rawCost === undefined ? 0 : readNumber(value, "costEstimateCents");
  const rawTools = pick(value, "tools");
  const tools = rawTools === undefined ? [] : rawTools;
  const owner = parseOwner(pick(value, "owner"));
  const rawPoint = pick(value, "approvalPoint");
  let approvalPoint: PlanStepView["approvalPoint"] = null;
  if (rawPoint !== undefined && rawPoint !== null) {
    if (
      !isObject(rawPoint) ||
      !hasOnlyKeys(rawPoint, ["kind", "prompt"]) ||
      !APPROVAL_KINDS.has(pick(rawPoint, "kind") as PlanApprovalKind)
    )
      return null;
    const prompt = text(pick(rawPoint, "prompt"), 80);
    if (prompt === null) return null;
    approvalPoint = {
      kind: pick(rawPoint, "kind") as PlanApprovalKind,
      prompt,
    };
  }
  if (
    typeof stepId !== "string" ||
    !STEP_ID_PATTERN.test(stepId) ||
    title === null ||
    detail === undefined ||
    costLabel === null ||
    whenLabel === null ||
    note === undefined ||
    costEstimateCents === null ||
    !Array.isArray(tools) ||
    tools.length > 6 ||
    !tools.every((tool) => text(tool, 80) !== null) ||
    owner === null ||
    typeof status !== "string" ||
    !STEP_STATUSES.has(status as PlanStepStatus)
  )
    return null;
  return {
    stepId,
    title,
    detail,
    owner,
    tools: tools as string[],
    costLabel,
    costEstimateCents,
    whenLabel,
    approvalPoint,
    status: status as PlanStepStatus,
    note,
  };
}

export function parseOwner(value: unknown): PlanStepOwnerView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["kind", "function", "agentPubkey", "workerType"])
  )
    return null;
  const kind = pick(value, "kind");
  const fn = pick(value, "function");
  const agent = pick(value, "agentPubkey");
  const workerType = pick(value, "workerType");
  if (
    typeof kind !== "string" ||
    !OWNER_KINDS.has(kind as PlanOwnerKind) ||
    (fn !== undefined && (typeof fn !== "string" || !FUNCTION_IDS.has(fn))) ||
    (agent !== undefined &&
      (typeof agent !== "string" || !PUBKEY_PATTERN.test(agent))) ||
    (workerType !== undefined && text(workerType, 80) === null)
  )
    return null;
  return {
    kind: kind as PlanOwnerKind,
    functionId: (fn as FunctionId | undefined) ?? null,
    agentPubkey: (agent as string | undefined) ?? null,
    workerType: (workerType as string | undefined) ?? null,
  };
}

function parseApproval(value: unknown): PlanApprovalRecordView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "scope",
      "stepId",
      "decision",
      "actorPubkey",
      "at",
      "revision",
      "note",
      "actionEventId",
    ])
  )
    return null;
  const scope = pick(value, "scope");
  const stepId = pick(value, "stepId");
  const decision = pick(value, "decision");
  const actorPubkey = pick(value, "actorPubkey");
  const actionEventId = pick(value, "actionEventId");
  const at = readNumber(value, "at");
  const revision = readNumber(value, "revision");
  const note = optionalText(value, "note", 500);
  if (
    (scope !== "plan" && scope !== "step") ||
    (scope === "plan"
      ? stepId !== undefined
      : typeof stepId !== "string" || !STEP_ID_PATTERN.test(stepId)) ||
    typeof decision !== "string" ||
    !DECISIONS.has(decision as PlanDecision) ||
    typeof actorPubkey !== "string" ||
    !PUBKEY_PATTERN.test(actorPubkey) ||
    typeof actionEventId !== "string" ||
    !PUBKEY_PATTERN.test(actionEventId) ||
    at === null ||
    revision === null ||
    note === undefined
  )
    return null;
  return {
    scope,
    stepId: (stepId as string | undefined) ?? null,
    decision: decision as PlanDecision,
    actorPubkey,
    at,
    revision,
    note,
    actionEventId,
  };
}

export function parsePlanHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): PlanView | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_PLAN_HEAD)) return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(PLAN_D_TAG_PREFIX) || event.tags.length !== 1)
    return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "planId",
      "status",
      "revision",
      "plan",
      "proposedByPubkey",
      "proposedAt",
      "updatedByPubkey",
      "updatedAt",
      "approvals",
      "sourceActionEventId",
    ])
  )
    return null;
  const planId = pick(content, "planId");
  const status = pick(content, "status");
  const revision = readNumber(content, "revision");
  const proposedAt = readNumber(content, "proposedAt");
  const updatedAt = readNumber(content, "updatedAt");
  const proposedBy = pick(content, "proposedByPubkey");
  const updatedBy = pick(content, "updatedByPubkey");
  const source = pick(content, "sourceActionEventId");
  const rawApprovals = pick(content, "approvals");
  const plan = pick(content, "plan");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    typeof planId !== "string" ||
    !PLAN_ID_PATTERN.test(planId) ||
    dTag !== planDTag(planId) ||
    typeof status !== "string" ||
    !PLAN_STATUSES.has(status as PlanStatus) ||
    revision === null ||
    revision < 1 ||
    proposedAt === null ||
    updatedAt === null ||
    typeof proposedBy !== "string" ||
    !PUBKEY_PATTERN.test(proposedBy) ||
    typeof updatedBy !== "string" ||
    !PUBKEY_PATTERN.test(updatedBy) ||
    typeof source !== "string" ||
    !PUBKEY_PATTERN.test(source) ||
    !isObject(plan) ||
    !hasOnlyKeys(plan, [
      "title",
      "summary",
      "function",
      "currency",
      "budgetCents",
      "decideBy",
      "targetLabel",
      "timingLabel",
      "steps",
    ])
  )
    return null;
  if (
    rawApprovals !== undefined &&
    (!Array.isArray(rawApprovals) || rawApprovals.length > MAX_PLAN_APPROVALS)
  )
    return null;
  const approvals: PlanApprovalRecordView[] = [];
  for (const raw of (rawApprovals as unknown[] | undefined) ?? []) {
    const record = parseApproval(raw);
    if (!record) return null;
    approvals.push(record);
  }
  const title = text(pick(plan, "title"), 120);
  const summary = text(pick(plan, "summary") ?? "", 600, true);
  const fn = pick(plan, "function");
  const currency = pick(plan, "currency");
  const budgetCents =
    pick(plan, "budgetCents") === undefined
      ? 0
      : readNumber(plan, "budgetCents");
  const rawDecideBy = pick(plan, "decideBy");
  const decideBy =
    rawDecideBy === undefined ? null : readNumber(plan, "decideBy");
  const targetLabel = optionalText(plan, "targetLabel", 80);
  const timingLabel = optionalText(plan, "timingLabel", 80);
  const rawSteps = pick(plan, "steps");
  if (
    title === null ||
    summary === null ||
    (fn !== undefined && (typeof fn !== "string" || !FUNCTION_IDS.has(fn))) ||
    typeof currency !== "string" ||
    !CURRENCY_PATTERN.test(currency) ||
    budgetCents === null ||
    (rawDecideBy !== undefined && decideBy === null) ||
    targetLabel === undefined ||
    timingLabel === undefined ||
    !Array.isArray(rawSteps) ||
    rawSteps.length < 1 ||
    rawSteps.length > MAX_PLAN_STEPS
  )
    return null;
  const steps: PlanStepView[] = [];
  const seen = new Set<string>();
  for (const raw of rawSteps) {
    const step = parseStep(raw);
    if (!step || seen.has(step.stepId)) return null;
    seen.add(step.stepId);
    steps.push(step);
  }
  return {
    planId,
    status: status as PlanStatus,
    revision,
    title,
    summary,
    functionId: (fn as FunctionId | undefined) ?? null,
    currency,
    budgetCents,
    decideBy,
    targetLabel,
    timingLabel,
    steps,
    proposedByPubkey: proposedBy,
    proposedAt,
    updatedByPubkey: updatedBy,
    updatedAt,
    approvals,
    eventId: event.id,
  };
}

/** Totals the plan card shows under the step table. */
export function planTotals(
  plan: Pick<PlanView, "steps" | "currency" | "targetLabel" | "timingLabel">,
): {
  costCents: number;
  currency: string;
  targetLabel: string | null;
  timingLabel: string | null;
} {
  return {
    costCents: plan.steps.reduce(
      (sum, step) => sum + step.costEstimateCents,
      0,
    ),
    currency: plan.currency,
    targetLabel: plan.targetLabel,
    timingLabel: plan.timingLabel,
  };
}

/** Steps stopped at their approval point, waiting for an owner or admin. */
export function stepsWaitingForApproval(plan: PlanView): PlanStepView[] {
  return plan.status === "approved"
    ? plan.steps.filter((step) => step.status === "waiting_approval")
    : [];
}

/** Steps only a person can do ("Do" in Needs you) that are still open. */
export function openHumanSteps(plan: PlanView): PlanStepView[] {
  return plan.status === "approved"
    ? plan.steps.filter(
        (step) =>
          step.owner.kind === "owner" &&
          (step.status === "pending" ||
            step.status === "approved" ||
            step.status === "in_progress"),
      )
    : [];
}

/** The newest head per plan wins. */
export function latestPlans(
  parsed: ReadonlyArray<{ plan: PlanView; createdAt: number }>,
): PlanView[] {
  const latest = new Map<string, { plan: PlanView; createdAt: number }>();
  for (const entry of parsed) {
    const current = latest.get(entry.plan.planId);
    if (
      !current ||
      entry.createdAt > current.createdAt ||
      (entry.createdAt === current.createdAt &&
        entry.plan.eventId.localeCompare(current.plan.eventId) < 0)
    ) {
      latest.set(entry.plan.planId, entry);
    }
  }
  return [...latest.values()]
    .map(({ plan }) => plan)
    .sort(
      (first, second) =>
        second.updatedAt - first.updatedAt ||
        first.planId.localeCompare(second.planId),
    );
}
