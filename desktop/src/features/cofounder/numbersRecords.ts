import { KIND_NUMBERS_HEAD } from "@/shared/constants/kinds";
import type { RelayEvent } from "@/shared/api/types";

import {
  COMPANY_RECORD_SCHEMA_VERSION,
  PUBKEY_PATTERN,
  hasOnlyKeys,
  isObject,
  isValidRelayHead,
  oneTagValue,
  parseJson,
  pick,
} from "./cofounderRecords";
import type { FunctionId } from "./cofounderRecords";

export {
  KIND_NUMBERS_ACTION,
  KIND_NUMBERS_HEAD,
} from "@/shared/constants/kinds";

/**
 * Scorecard, goals and the Friday weekly review (kind 30678).
 *
 * Three relay-signed record families share the head kind and are told apart by
 * d-tag. Every figure is counted by the relay from the company's own records;
 * the desktop only reads and shows them.
 */
export const SCORECARD_D_TAG = "company:scorecard";
export const GOAL_D_TAG_PREFIX = "company:fngoal:";
export const REVIEW_D_TAG_PREFIX = "company:review:";
export const MAX_REVIEW_ITEMS = 5;

export type MetricId =
  | "leads_found"
  | "contacted"
  | "replied"
  | "quotes"
  | "won"
  | "workers_started"
  | "workers_done"
  | "workers_failed"
  | "plans_approved"
  | "active_clients"
  | "cash_in"
  | "invoiced"
  | "owed"
  | "worker_cost"
  | "cost_per_win";

/** Count is a whole number, money is minor units of the scorecard currency, usd_cents is US dollar cents. */
export type MetricUnit = "count" | "money" | "usd_cents";

export type MetricDetail = {
  label: string;
  functionId: FunctionId;
  unit: MetricUnit;
  /** How things stand now, with no history: it has no previous value. */
  pointInTime: boolean;
};

/** Mirrors `Metric` in buzz-core (`company_numbers.rs`), in display order. */
export const METRIC_DETAILS: Record<MetricId, MetricDetail> = {
  leads_found: {
    label: "Leads found",
    functionId: "sales",
    unit: "count",
    pointInTime: false,
  },
  contacted: {
    label: "Contacted",
    functionId: "sales",
    unit: "count",
    pointInTime: false,
  },
  replied: {
    label: "Replied",
    functionId: "sales",
    unit: "count",
    pointInTime: false,
  },
  quotes: {
    label: "Quotes",
    functionId: "sales",
    unit: "count",
    pointInTime: false,
  },
  won: { label: "Won", functionId: "sales", unit: "count", pointInTime: false },
  workers_started: {
    label: "Worker runs",
    functionId: "operations",
    unit: "count",
    pointInTime: false,
  },
  workers_done: {
    label: "Runs finished",
    functionId: "operations",
    unit: "count",
    pointInTime: false,
  },
  workers_failed: {
    label: "Runs failed",
    functionId: "operations",
    unit: "count",
    pointInTime: false,
  },
  plans_approved: {
    label: "Plans approved",
    functionId: "operations",
    unit: "count",
    pointInTime: false,
  },
  active_clients: {
    label: "Active clients",
    functionId: "customer_success",
    unit: "count",
    pointInTime: true,
  },
  cash_in: {
    label: "Cash in",
    functionId: "finance",
    unit: "money",
    pointInTime: false,
  },
  invoiced: {
    label: "Invoiced",
    functionId: "finance",
    unit: "money",
    pointInTime: false,
  },
  owed: {
    label: "Owed",
    functionId: "finance",
    unit: "money",
    pointInTime: true,
  },
  worker_cost: {
    label: "Worker cost",
    functionId: "finance",
    unit: "usd_cents",
    pointInTime: false,
  },
  cost_per_win: {
    label: "Cost per win",
    functionId: "brand",
    unit: "usd_cents",
    pointInTime: false,
  },
};

export const METRIC_IDS = Object.keys(METRIC_DETAILS) as MetricId[];

export type GoalPeriod = "week" | "month";
export type GoalStatus = "proposed" | "approved" | "rejected" | "retired";
export type DecisionState = "open" | "approved" | "declined" | "deferred";

export type MetricReadingView = {
  metric: MetricId;
  /** Over the latest seven days; null when it cannot be stated. */
  value: number | null;
  /** Over the seven days before; null for a number of how things stand now. */
  previous: number | null;
  /** `value - previous`, when both exist. */
  change: number | null;
};

export type FunctionScorecardView = {
  functionId: FunctionId;
  metrics: MetricReadingView[];
  /** Numbers the spec names that Colony does not record yet; show "not tracked yet", never zero. */
  notTracked: string[];
};

export type GoalProgressView = {
  goalId: string;
  functionId: FunctionId;
  title: string;
  metric: MetricId;
  target: number;
  period: GoalPeriod;
  current: number | null;
  /** Percent of the target, at most 1000. */
  percent: number | null;
};

export type ScorecardView = {
  /** End of the latest window, Unix seconds. */
  asOf: number;
  windowStart: number;
  previousStart: number;
  /** ISO 4217 code of every money number. */
  currency: string;
  otherCurrencyFacts: number;
  functions: FunctionScorecardView[];
  goals: GoalProgressView[];
  eventId: string;
};

export type GoalView = {
  goalId: string;
  functionId: FunctionId;
  title: string;
  metric: MetricId;
  target: number;
  period: GoalPeriod;
  status: GoalStatus;
  reason: string | null;
  proposedByPubkey: string;
  proposedAt: number;
  decidedByPubkey: string | null;
  decidedAt: number | null;
  note: string | null;
  /** Id of the head event: every write must name it as the expected head. */
  eventId: string;
};

export type ReviewDecisionView = {
  decisionId: string;
  title: string;
  detail: string;
  functionId: FunctionId | null;
  state: DecisionState;
  decidedByPubkey: string | null;
  decidedAt: number | null;
  note: string | null;
};

export type ReviewView = {
  /** The Friday that ends the week, `YYYY-MM-DD`. */
  reviewDate: string;
  asOf: number;
  windowStart: number;
  previousStart: number;
  currency: string;
  otherCurrencyFacts: number;
  functions: FunctionScorecardView[];
  wins: string[];
  misses: string[];
  decisions: ReviewDecisionView[];
  annotatedByPubkey: string | null;
  annotatedAt: number | null;
  createdAt: number;
  /** Id of the head event: every write must name it as the expected head. */
  eventId: string;
};

export type NumbersRecordView =
  | { kind: "scorecard"; scorecard: ScorecardView }
  | { kind: "goal"; goal: GoalView }
  | { kind: "review"; review: ReviewView };

const FUNCTION_IDS = new Set<string>([
  "sales",
  "operations",
  "customer_success",
  "finance",
  "brand",
]);
const GOAL_STATUSES = new Set<string>([
  "proposed",
  "approved",
  "rejected",
  "retired",
]);
const DECISION_STATES = new Set<string>([
  "open",
  "approved",
  "declined",
  "deferred",
]);
const GOAL_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const DECISION_ID_PATTERN = /^[a-z0-9_-]{1,32}$/;
const REVIEW_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function goalDTag(goalId: string): string {
  return `${GOAL_D_TAG_PREFIX}${goalId}`;
}

export function reviewDTag(reviewDate: string): string {
  return `${REVIEW_D_TAG_PREFIX}${reviewDate}`;
}

function text(value: unknown, max: number, allowEmpty = false): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  if (!allowEmpty && value.trim().length === 0) return null;
  return value;
}

/** A whole number that may be negative (a change), or null. `undefined` means the field is invalid. */
function signedOrNull(
  record: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const raw = pick(record, key);
  if (raw === null) return null;
  return typeof raw === "number" && Number.isSafeInteger(raw) ? raw : undefined;
}

function wholeNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const raw = pick(record, key);
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? raw
    : null;
}

function optionalText(
  record: Record<string, unknown>,
  key: string,
  max: number,
): string | null | undefined {
  const raw = pick(record, key);
  if (raw === undefined || raw === null) return null;
  const value = text(raw, max);
  return value === null ? undefined : value;
}

function optionalPubkey(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const raw = pick(record, key);
  if (raw === undefined || raw === null) return null;
  return typeof raw === "string" && PUBKEY_PATTERN.test(raw) ? raw : undefined;
}

function optionalTime(
  record: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const raw = pick(record, key);
  if (raw === undefined || raw === null) return null;
  return wholeNumber(record, key) ?? undefined;
}

function parseReading(value: unknown): MetricReadingView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["metric", "value", "previous", "change"])
  )
    return null;
  const metric = pick(value, "metric");
  const reading = signedOrNull(value, "value");
  const previous = signedOrNull(value, "previous");
  const change = signedOrNull(value, "change");
  if (
    typeof metric !== "string" ||
    !Object.hasOwn(METRIC_DETAILS, metric) ||
    reading === undefined ||
    previous === undefined ||
    change === undefined
  )
    return null;
  return { metric: metric as MetricId, value: reading, previous, change };
}

function parseFunctionCard(value: unknown): FunctionScorecardView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["function", "metrics", "notTracked"])
  )
    return null;
  const fn = pick(value, "function");
  const rawMetrics = pick(value, "metrics");
  const rawNotTracked = pick(value, "notTracked");
  if (
    typeof fn !== "string" ||
    !FUNCTION_IDS.has(fn) ||
    !Array.isArray(rawMetrics) ||
    !Array.isArray(rawNotTracked) ||
    !rawNotTracked.every((name) => typeof name === "string")
  )
    return null;
  const metrics: MetricReadingView[] = [];
  for (const raw of rawMetrics) {
    const reading = parseReading(raw);
    if (!reading) return null;
    metrics.push(reading);
  }
  return {
    functionId: fn as FunctionId,
    metrics,
    notTracked: rawNotTracked as string[],
  };
}

function parseFunctionCards(value: unknown): FunctionScorecardView[] | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const cards: FunctionScorecardView[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const card = parseFunctionCard(raw);
    if (!card || seen.has(card.functionId)) return null;
    seen.add(card.functionId);
    cards.push(card);
  }
  return cards;
}

function parseProgress(value: unknown): GoalProgressView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "goalId",
      "function",
      "title",
      "metric",
      "target",
      "period",
      "current",
      "percent",
    ])
  )
    return null;
  const goalId = pick(value, "goalId");
  const fn = pick(value, "function");
  const title = text(pick(value, "title"), 120);
  const metric = pick(value, "metric");
  const target = wholeNumber(value, "target");
  const period = pick(value, "period");
  const current = signedOrNull(value, "current");
  const percent = signedOrNull(value, "percent");
  if (
    typeof goalId !== "string" ||
    !GOAL_ID_PATTERN.test(goalId) ||
    typeof fn !== "string" ||
    !FUNCTION_IDS.has(fn) ||
    title === null ||
    typeof metric !== "string" ||
    !Object.hasOwn(METRIC_DETAILS, metric) ||
    target === null ||
    (period !== "week" && period !== "month") ||
    current === undefined ||
    percent === undefined
  )
    return null;
  return {
    goalId,
    functionId: fn as FunctionId,
    title,
    metric: metric as MetricId,
    target,
    period,
    current,
    percent,
  };
}

export function parseScorecardHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): ScorecardView | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_NUMBERS_HEAD)) return null;
  if (oneTagValue(event, "d") !== SCORECARD_D_TAG || event.tags.length !== 1)
    return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "asOf",
      "windowStart",
      "previousStart",
      "currency",
      "otherCurrencyFacts",
      "functions",
      "goals",
    ])
  )
    return null;
  const asOf = wholeNumber(content, "asOf");
  const windowStart = wholeNumber(content, "windowStart");
  const previousStart = wholeNumber(content, "previousStart");
  const currency = pick(content, "currency");
  const otherCurrencyFacts = wholeNumber(content, "otherCurrencyFacts");
  const functions = parseFunctionCards(pick(content, "functions"));
  const rawGoals = pick(content, "goals");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    asOf === null ||
    windowStart === null ||
    previousStart === null ||
    typeof currency !== "string" ||
    !CURRENCY_PATTERN.test(currency) ||
    otherCurrencyFacts === null ||
    functions === null ||
    !Array.isArray(rawGoals)
  )
    return null;
  const goals: GoalProgressView[] = [];
  for (const raw of rawGoals) {
    const goal = parseProgress(raw);
    if (!goal) return null;
    goals.push(goal);
  }
  return {
    asOf,
    windowStart,
    previousStart,
    currency,
    otherCurrencyFacts,
    functions,
    goals,
    eventId: event.id,
  };
}

export function parseGoalHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): GoalView | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_NUMBERS_HEAD)) return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(GOAL_D_TAG_PREFIX) || event.tags.length !== 1)
    return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "goalId",
      "function",
      "title",
      "metric",
      "target",
      "period",
      "status",
      "reason",
      "proposedByPubkey",
      "proposedAt",
      "decidedByPubkey",
      "decidedAt",
      "note",
      "sourceActionEventId",
    ])
  )
    return null;
  const goalId = pick(content, "goalId");
  const fn = pick(content, "function");
  const title = text(pick(content, "title"), 120);
  const metric = pick(content, "metric");
  const target = wholeNumber(content, "target");
  const period = pick(content, "period");
  const status = pick(content, "status");
  const reason = optionalText(content, "reason", 300);
  const proposedBy = pick(content, "proposedByPubkey");
  const proposedAt = wholeNumber(content, "proposedAt");
  const decidedBy = optionalPubkey(content, "decidedByPubkey");
  const decidedAt = optionalTime(content, "decidedAt");
  const note = optionalText(content, "note", 300);
  const source = pick(content, "sourceActionEventId");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    typeof goalId !== "string" ||
    !GOAL_ID_PATTERN.test(goalId) ||
    dTag !== goalDTag(goalId) ||
    typeof fn !== "string" ||
    !FUNCTION_IDS.has(fn) ||
    title === null ||
    typeof metric !== "string" ||
    !Object.hasOwn(METRIC_DETAILS, metric) ||
    METRIC_DETAILS[metric as MetricId].functionId !== fn ||
    target === null ||
    target < 1 ||
    (period !== "week" && period !== "month") ||
    typeof status !== "string" ||
    !GOAL_STATUSES.has(status) ||
    reason === undefined ||
    typeof proposedBy !== "string" ||
    !PUBKEY_PATTERN.test(proposedBy) ||
    proposedAt === null ||
    decidedBy === undefined ||
    decidedAt === undefined ||
    note === undefined ||
    typeof source !== "string" ||
    !PUBKEY_PATTERN.test(source)
  )
    return null;
  return {
    goalId,
    functionId: fn as FunctionId,
    title,
    metric: metric as MetricId,
    target,
    period,
    status: status as GoalStatus,
    reason,
    proposedByPubkey: proposedBy,
    proposedAt,
    decidedByPubkey: decidedBy,
    decidedAt,
    note,
    eventId: event.id,
  };
}

function parseDecision(value: unknown): ReviewDecisionView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "decisionId",
      "title",
      "detail",
      "function",
      "state",
      "decidedByPubkey",
      "decidedAt",
      "note",
    ])
  )
    return null;
  const decisionId = pick(value, "decisionId");
  const title = text(pick(value, "title"), 120);
  const detail = text(pick(value, "detail") ?? "", 300, true);
  const fn = pick(value, "function");
  const state = pick(value, "state");
  const decidedBy = optionalPubkey(value, "decidedByPubkey");
  const decidedAt = optionalTime(value, "decidedAt");
  const note = optionalText(value, "note", 300);
  if (
    typeof decisionId !== "string" ||
    !DECISION_ID_PATTERN.test(decisionId) ||
    title === null ||
    detail === null ||
    (fn !== undefined &&
      fn !== null &&
      (typeof fn !== "string" || !FUNCTION_IDS.has(fn))) ||
    typeof state !== "string" ||
    !DECISION_STATES.has(state) ||
    decidedBy === undefined ||
    decidedAt === undefined ||
    note === undefined
  )
    return null;
  return {
    decisionId,
    title,
    detail,
    functionId: (fn as FunctionId | undefined | null) ?? null,
    state: state as DecisionState,
    decidedByPubkey: decidedBy,
    decidedAt,
    note,
  };
}

function parseLines(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_REVIEW_ITEMS) return null;
  return value.every((line) => text(line, 200) !== null)
    ? (value as string[])
    : null;
}

export function parseReviewHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): ReviewView | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_NUMBERS_HEAD)) return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(REVIEW_D_TAG_PREFIX) || event.tags.length !== 1)
    return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, [
      "schemaVersion",
      "reviewDate",
      "asOf",
      "windowStart",
      "previousStart",
      "currency",
      "otherCurrencyFacts",
      "functions",
      "wins",
      "misses",
      "decisions",
      "annotatedByPubkey",
      "annotatedAt",
      "createdAt",
      "sourceActionEventId",
    ])
  )
    return null;
  const reviewDate = pick(content, "reviewDate");
  const asOf = wholeNumber(content, "asOf");
  const windowStart = wholeNumber(content, "windowStart");
  const previousStart = wholeNumber(content, "previousStart");
  const currency = pick(content, "currency");
  const otherCurrencyFacts = wholeNumber(content, "otherCurrencyFacts");
  const functions = parseFunctionCards(pick(content, "functions"));
  const wins = parseLines(pick(content, "wins"));
  const misses = parseLines(pick(content, "misses"));
  const rawDecisions = pick(content, "decisions");
  const annotatedBy = optionalPubkey(content, "annotatedByPubkey");
  const annotatedAt = optionalTime(content, "annotatedAt");
  const createdAt = wholeNumber(content, "createdAt");
  const source = pick(content, "sourceActionEventId");
  if (
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION ||
    typeof reviewDate !== "string" ||
    !REVIEW_DATE_PATTERN.test(reviewDate) ||
    dTag !== reviewDTag(reviewDate) ||
    asOf === null ||
    windowStart === null ||
    previousStart === null ||
    typeof currency !== "string" ||
    !CURRENCY_PATTERN.test(currency) ||
    otherCurrencyFacts === null ||
    functions === null ||
    wins === null ||
    misses === null ||
    (rawDecisions !== undefined &&
      (!Array.isArray(rawDecisions) ||
        rawDecisions.length > MAX_REVIEW_ITEMS)) ||
    annotatedBy === undefined ||
    annotatedAt === undefined ||
    createdAt === null ||
    (source !== undefined &&
      (typeof source !== "string" || !PUBKEY_PATTERN.test(source)))
  )
    return null;
  const decisions: ReviewDecisionView[] = [];
  const seen = new Set<string>();
  for (const raw of (rawDecisions as unknown[] | undefined) ?? []) {
    const decision = parseDecision(raw);
    if (!decision || seen.has(decision.decisionId)) return null;
    seen.add(decision.decisionId);
    decisions.push(decision);
  }
  return {
    reviewDate,
    asOf,
    windowStart,
    previousStart,
    currency,
    otherCurrencyFacts,
    functions,
    wins,
    misses,
    decisions,
    annotatedByPubkey: annotatedBy,
    annotatedAt,
    createdAt,
    eventId: event.id,
  };
}

/** Reads one numbers head of any family; null when it is not a valid relay head. */
export function parseNumbersHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): NumbersRecordView | null {
  const dTag = oneTagValue(event, "d");
  if (dTag === SCORECARD_D_TAG) {
    const scorecard = parseScorecardHead(event, relaySelfPubkey);
    return scorecard ? { kind: "scorecard", scorecard } : null;
  }
  if (dTag?.startsWith(GOAL_D_TAG_PREFIX)) {
    const goal = parseGoalHead(event, relaySelfPubkey);
    return goal ? { kind: "goal", goal } : null;
  }
  if (dTag?.startsWith(REVIEW_D_TAG_PREFIX)) {
    const review = parseReviewHead(event, relaySelfPubkey);
    return review ? { kind: "review", review } : null;
  }
  return null;
}

export type NumbersModel = {
  scorecard: ScorecardView | null;
  goals: GoalView[];
  /** Newest Friday first. */
  reviews: ReviewView[];
};

type Dated<T> = { value: T; createdAt: number; eventId: string };

function newest<T>(
  entries: ReadonlyArray<Dated<T>>,
  key: (value: T) => string,
): T[] {
  const latest = new Map<string, Dated<T>>();
  for (const entry of entries) {
    const id = key(entry.value);
    const current = latest.get(id);
    if (
      !current ||
      entry.createdAt > current.createdAt ||
      (entry.createdAt === current.createdAt &&
        entry.eventId.localeCompare(current.eventId) < 0)
    ) {
      latest.set(id, entry);
    }
  }
  return [...latest.values()].map((entry) => entry.value);
}

/** The newest head per record wins. */
export function buildNumbersModel(
  parsed: ReadonlyArray<{ record: NumbersRecordView; createdAt: number }>,
): NumbersModel {
  const scorecards: Array<Dated<ScorecardView>> = [];
  const goals: Array<Dated<GoalView>> = [];
  const reviews: Array<Dated<ReviewView>> = [];
  for (const { record, createdAt } of parsed) {
    if (record.kind === "scorecard") {
      scorecards.push({
        value: record.scorecard,
        createdAt,
        eventId: record.scorecard.eventId,
      });
    } else if (record.kind === "goal") {
      goals.push({
        value: record.goal,
        createdAt,
        eventId: record.goal.eventId,
      });
    } else {
      reviews.push({
        value: record.review,
        createdAt,
        eventId: record.review.eventId,
      });
    }
  }
  return {
    scorecard: newest(scorecards, () => SCORECARD_D_TAG)[0] ?? null,
    goals: newest(goals, (goal) => goal.goalId).sort(
      (first, second) =>
        second.proposedAt - first.proposedAt ||
        first.goalId.localeCompare(second.goalId),
    ),
    reviews: newest(reviews, (review) => review.reviewDate).sort(
      (first, second) => second.reviewDate.localeCompare(first.reviewDate),
    ),
  };
}

/** The scorecard of one function, or null when the relay has not written one yet. */
export function functionScorecard(
  source:
    | Pick<ScorecardView, "functions">
    | Pick<ReviewView, "functions">
    | null,
  functionId: FunctionId,
): FunctionScorecardView | null {
  return (
    source?.functions.find((card) => card.functionId === functionId) ?? null
  );
}

/** Goals the owner has not decided yet. */
export function proposedGoals(goals: readonly GoalView[]): GoalView[] {
  return goals.filter((goal) => goal.status === "proposed");
}

/** Goals being tracked, optionally for one function. */
export function approvedGoals(
  goals: readonly GoalView[],
  functionId?: FunctionId,
): GoalView[] {
  return goals.filter(
    (goal) =>
      goal.status === "approved" &&
      (functionId === undefined || goal.functionId === functionId),
  );
}

/** Decisions of a review that wait for the owner. */
export function openDecisions(review: ReviewView): ReviewDecisionView[] {
  return review.decisions.filter((decision) => decision.state === "open");
}

export type ChangeDirection = "up" | "down" | "flat";

/** Which way a number moved; null when there is nothing to compare. */
export function changeDirection(
  reading: MetricReadingView,
): ChangeDirection | null {
  if (reading.change === null) return null;
  if (reading.change > 0) return "up";
  return reading.change < 0 ? "down" : "flat";
}

/**
 * Whether a move is good news. A cost, a failure and what is owed are better
 * when they fall; every other number is better when it rises.
 */
const LOWER_IS_BETTER = new Set<MetricId>([
  "workers_failed",
  "owed",
  "worker_cost",
  "cost_per_win",
]);

export function isImprovement(reading: MetricReadingView): boolean | null {
  const direction = changeDirection(reading);
  if (direction === null || direction === "flat") return null;
  return LOWER_IS_BETTER.has(reading.metric)
    ? direction === "down"
    : direction === "up";
}

/**
 * A number as people read it. Money is shown in the scorecard currency, a
 * dollar cost in US dollars. Returns null when the value cannot be stated, so
 * the screen decides what to show (never a zero).
 */
export function formatMetricValue(
  value: number | null,
  unit: MetricUnit,
  currency: string,
): string | null {
  if (value === null) return null;
  if (unit === "count") return new Intl.NumberFormat("en-ZA").format(value);
  const code = unit === "usd_cents" ? "USD" : currency;
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: code,
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
}

/** Percent of a goal reached, clamped to what a progress bar can draw. */
export function goalBarPercent(
  progress: Pick<GoalProgressView, "percent">,
): number {
  return Math.max(0, Math.min(100, progress.percent ?? 0));
}
