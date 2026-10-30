import { KIND_PLAYBOOK_HEAD } from "@/shared/constants/kinds";
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
import {
  APPROVAL_KINDS,
  FUNCTION_IDS,
  PUBKEY_PATTERN,
  STEP_ID_PATTERN,
  optionalText,
  parseOwner,
  text,
} from "./planRecords";
import type { PlanApprovalKind, PlanStepOwnerView } from "./planRecords";

export {
  KIND_PLAYBOOK_ACTION,
  KIND_PLAYBOOK_HEAD,
} from "@/shared/constants/kinds";

/**
 * Playbooks and their running copies share one head kind (30677). The d tag
 * tells them apart: `company:playbook:<uuid>` is a playbook,
 * `company:playbook-job:<uuid>` is a running copy for one client job.
 */
export const PLAYBOOK_D_TAG_PREFIX = "company:playbook:";
export const PLAYBOOK_JOB_D_TAG_PREFIX = "company:playbook-job:";
export const MAX_PLAYBOOK_STEPS = 24;
export const MAX_PLAYBOOK_RECORDS = 200;
export const MAX_JOB_APPROVALS = 200;
export const MAX_JOB_HANDOFFS = 100;

export type PlaybookStatus = "proposed" | "active" | "archived" | "rejected";

export type PlaybookDecision =
  | "approved"
  | "rejected"
  | "edited"
  | "published"
  | "withdrawn"
  | "archived";

export type JobStatus = "running" | "completed" | "cancelled";

export type JobStepStatus =
  | "pending"
  | "waiting_approval"
  | "approved"
  | "in_progress"
  | "done"
  | "blocked"
  | "skipped";

export type JobDecision = "approved" | "rejected";

export type PlaybookApprovalPoint = { kind: PlanApprovalKind; prompt: string };

/** One step of a playbook: what happens, who does it and what it needs. */
export type PlaybookStepView = {
  stepId: string;
  title: string;
  detail: string | null;
  owner: PlanStepOwnerView;
  inputs: string[];
  outputs: string[];
  tools: string[];
  approvalPoint: PlaybookApprovalPoint | null;
};

export type PlaybookContentView = {
  title: string;
  summary: string;
  functionId: FunctionId | null;
  steps: PlaybookStepView[];
};

/** A proposal waiting for the owner: a new playbook or a change to the current version. */
export type PlaybookChangeView = {
  content: PlaybookContentView;
  /** One short line the owner reads, for example "Add a logins checklist to step 2". */
  changeSummary: string | null;
  proposedByPubkey: string;
  proposedAt: number;
  /** Approve and reject name this revision. */
  revision: number;
};

export type PlaybookDecisionRecordView = {
  decision: PlaybookDecision;
  /** The version in effect after the decision. */
  version: number;
  revision: number | null;
  actorPubkey: string;
  at: number;
  note: string | null;
  changeSummary: string | null;
  proposedByPubkey: string | null;
  actionEventId: string;
};

export type PlaybookView = {
  playbookId: string;
  status: PlaybookStatus;
  /** Latest approved version; 0 until the first approval. */
  version: number;
  /** The playbook's title: the approved one, or the waiting proposal's. */
  title: string;
  current: PlaybookContentView | null;
  pending: PlaybookChangeView | null;
  records: PlaybookDecisionRecordView[];
  createdByPubkey: string;
  createdAt: number;
  updatedByPubkey: string;
  updatedAt: number;
  /** Id of the head event: every write must name it as the expected head. */
  eventId: string;
};

export type JobStepView = {
  stepId: string;
  title: string;
  detail: string | null;
  owner: PlanStepOwnerView;
  inputs: string[];
  outputs: string[];
  tools: string[];
  approvalPoint: PlaybookApprovalPoint | null;
  status: JobStepStatus;
  note: string | null;
  /** Short progress line such as "Round 1 of 2". */
  progressLabel: string | null;
  /** When `status` last changed, Unix seconds. */
  statusAt: number;
};

export type JobApprovalRecordView = {
  stepId: string;
  decision: JobDecision;
  actorPubkey: string;
  at: number;
  note: string | null;
  actionEventId: string;
};

export type JobHandoffRecordView = {
  stepId: string;
  from: PlanStepOwnerView;
  to: PlanStepOwnerView;
  byPubkey: string;
  at: number;
  note: string | null;
  actionEventId: string;
};

/** A running copy of a playbook for one client job. */
export type JobView = {
  jobId: string;
  playbookId: string;
  /** The version the steps were copied from. */
  playbookVersion: number;
  playbookTitle: string;
  /** The job, for example the client's name. */
  title: string;
  status: JobStatus;
  /** The first step that has not ended; null once the job ended. */
  currentStepId: string | null;
  steps: JobStepView[];
  approvals: JobApprovalRecordView[];
  handoffs: JobHandoffRecordView[];
  startedByPubkey: string;
  startedAt: number;
  endedAt: number | null;
  updatedByPubkey: string;
  updatedAt: number;
  /** Id of the head event: every write must name it as the expected head. */
  eventId: string;
};

const PLAYBOOK_STATUSES = new Set<PlaybookStatus>([
  "proposed",
  "active",
  "archived",
  "rejected",
]);
const PLAYBOOK_DECISIONS = new Set<PlaybookDecision>([
  "approved",
  "rejected",
  "edited",
  "published",
  "withdrawn",
  "archived",
]);
const JOB_STATUSES = new Set<JobStatus>(["running", "completed", "cancelled"]);
const JOB_STEP_STATUSES = new Set<JobStepStatus>([
  "pending",
  "waiting_approval",
  "approved",
  "in_progress",
  "done",
  "blocked",
  "skipped",
]);
const JOB_DECISIONS = new Set<JobDecision>(["approved", "rejected"]);
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function playbookDTag(playbookId: string): string {
  return `${PLAYBOOK_D_TAG_PREFIX}${playbookId}`;
}

export function playbookJobDTag(jobId: string): string {
  return `${PLAYBOOK_JOB_D_TAG_PREFIX}${jobId}`;
}

/** Which family a head's d tag names. */
export function playbookRecordKind(dTag: string): "playbook" | "job" | null {
  if (dTag.startsWith(PLAYBOOK_D_TAG_PREFIX)) return "playbook";
  if (dTag.startsWith(PLAYBOOK_JOB_D_TAG_PREFIX)) return "job";
  return null;
}

function parseList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) return null;
  return value.every((item) => text(item, 120) !== null)
    ? (value as string[])
    : null;
}

function parseApprovalPoint(
  value: unknown,
): PlaybookApprovalPoint | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isObject(value) || !hasOnlyKeys(value, ["kind", "prompt"]))
    return undefined;
  const kind = pick(value, "kind");
  const prompt = text(pick(value, "prompt"), 80);
  if (
    typeof kind !== "string" ||
    !APPROVAL_KINDS.has(kind as PlanApprovalKind) ||
    prompt === null
  )
    return undefined;
  return { kind: kind as PlanApprovalKind, prompt };
}

type StepCommon = {
  stepId: string;
  title: string;
  detail: string | null;
  owner: PlanStepOwnerView;
  inputs: string[];
  outputs: string[];
  tools: string[];
  approvalPoint: PlaybookApprovalPoint | null;
};

const STEP_COMMON_KEYS = [
  "stepId",
  "title",
  "detail",
  "owner",
  "inputs",
  "outputs",
  "tools",
  "approvalPoint",
] as const;

function parseStepCommon(value: Record<string, unknown>): StepCommon | null {
  const stepId = pick(value, "stepId");
  const title = text(pick(value, "title"), 160);
  const detail = optionalText(value, "detail", 600);
  const owner = parseOwner(pick(value, "owner"));
  const inputs = parseList(pick(value, "inputs"));
  const outputs = parseList(pick(value, "outputs"));
  const tools = parseList(pick(value, "tools"));
  const approvalPoint = parseApprovalPoint(pick(value, "approvalPoint"));
  if (
    typeof stepId !== "string" ||
    !STEP_ID_PATTERN.test(stepId) ||
    title === null ||
    detail === undefined ||
    owner === null ||
    inputs === null ||
    outputs === null ||
    tools === null ||
    approvalPoint === undefined
  )
    return null;
  // Hard rule 4: a worker step never sends or spends.
  if (
    owner.kind === "worker" &&
    approvalPoint &&
    (approvalPoint.kind === "outreach" || approvalPoint.kind === "spend")
  )
    return null;
  return {
    stepId,
    title,
    detail,
    owner,
    inputs,
    outputs,
    tools,
    approvalPoint,
  };
}

function parsePlaybookStep(value: unknown): PlaybookStepView | null {
  if (!isObject(value) || !hasOnlyKeys(value, STEP_COMMON_KEYS)) return null;
  return parseStepCommon(value);
}

function parseContent(value: unknown): PlaybookContentView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, ["title", "summary", "function", "steps"])
  )
    return null;
  const title = text(pick(value, "title"), 120);
  const summary = text(pick(value, "summary") ?? "", 600, true);
  const fn = pick(value, "function");
  const rawSteps = pick(value, "steps");
  if (
    title === null ||
    summary === null ||
    (fn !== undefined && (typeof fn !== "string" || !FUNCTION_IDS.has(fn))) ||
    !Array.isArray(rawSteps) ||
    rawSteps.length < 1 ||
    rawSteps.length > MAX_PLAYBOOK_STEPS
  )
    return null;
  const steps: PlaybookStepView[] = [];
  const seen = new Set<string>();
  for (const raw of rawSteps) {
    const step = parsePlaybookStep(raw);
    if (!step || seen.has(step.stepId)) return null;
    seen.add(step.stepId);
    steps.push(step);
  }
  return {
    title,
    summary,
    functionId: (fn as FunctionId | undefined) ?? null,
    steps,
  };
}

function parseChange(value: unknown): PlaybookChangeView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "content",
      "changeSummary",
      "proposedByPubkey",
      "proposedAt",
      "revision",
    ])
  )
    return null;
  const content = parseContent(pick(value, "content"));
  const changeSummary = optionalText(value, "changeSummary", 500);
  const proposedBy = pick(value, "proposedByPubkey");
  const proposedAt = readNumber(value, "proposedAt");
  const revision = readNumber(value, "revision");
  if (
    content === null ||
    changeSummary === undefined ||
    typeof proposedBy !== "string" ||
    !PUBKEY_PATTERN.test(proposedBy) ||
    proposedAt === null ||
    revision === null ||
    revision < 1
  )
    return null;
  return {
    content,
    changeSummary,
    proposedByPubkey: proposedBy,
    proposedAt,
    revision,
  };
}

function parseDecisionRecord(
  value: unknown,
): PlaybookDecisionRecordView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "decision",
      "version",
      "revision",
      "actorPubkey",
      "at",
      "note",
      "changeSummary",
      "proposedByPubkey",
      "actionEventId",
    ])
  )
    return null;
  const decision = pick(value, "decision");
  const version = readNumber(value, "version");
  const rawRevision = pick(value, "revision");
  const revision =
    rawRevision === undefined ? null : readNumber(value, "revision");
  const actor = pick(value, "actorPubkey");
  const at = readNumber(value, "at");
  const note = optionalText(value, "note", 500);
  const changeSummary = optionalText(value, "changeSummary", 500);
  const proposedBy = pick(value, "proposedByPubkey");
  const actionEventId = pick(value, "actionEventId");
  if (
    typeof decision !== "string" ||
    !PLAYBOOK_DECISIONS.has(decision as PlaybookDecision) ||
    version === null ||
    (rawRevision !== undefined && (revision === null || revision < 1)) ||
    typeof actor !== "string" ||
    !PUBKEY_PATTERN.test(actor) ||
    at === null ||
    note === undefined ||
    changeSummary === undefined ||
    (proposedBy !== undefined &&
      (typeof proposedBy !== "string" || !PUBKEY_PATTERN.test(proposedBy))) ||
    typeof actionEventId !== "string" ||
    !PUBKEY_PATTERN.test(actionEventId)
  )
    return null;
  return {
    decision: decision as PlaybookDecision,
    version,
    revision,
    actorPubkey: actor,
    at,
    note,
    changeSummary,
    proposedByPubkey: (proposedBy as string | undefined) ?? null,
    actionEventId,
  };
}

function relayHeadContent(
  event: RelayEvent,
  relaySelfPubkey: string,
  prefix: string,
  allowedKeys: readonly string[],
): { dTag: string; content: Record<string, unknown> } | null {
  if (!isValidRelayHead(event, relaySelfPubkey, KIND_PLAYBOOK_HEAD))
    return null;
  const dTag = oneTagValue(event, "d");
  if (!dTag?.startsWith(prefix) || event.tags.length !== 1) return null;
  const content = parseJson(event.content);
  if (
    !isObject(content) ||
    !hasOnlyKeys(content, allowedKeys) ||
    pick(content, "schemaVersion") !== COMPANY_RECORD_SCHEMA_VERSION
  )
    return null;
  return { dTag, content };
}

export function parsePlaybookHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): PlaybookView | null {
  const parsed = relayHeadContent(
    event,
    relaySelfPubkey,
    PLAYBOOK_D_TAG_PREFIX,
    [
      "schemaVersion",
      "playbookId",
      "status",
      "version",
      "current",
      "pending",
      "records",
      "createdByPubkey",
      "createdAt",
      "updatedByPubkey",
      "updatedAt",
      "sourceActionEventId",
    ],
  );
  if (!parsed) return null;
  const { dTag, content } = parsed;
  const playbookId = pick(content, "playbookId");
  const status = pick(content, "status");
  const version = readNumber(content, "version");
  const createdAt = readNumber(content, "createdAt");
  const updatedAt = readNumber(content, "updatedAt");
  const createdBy = pick(content, "createdByPubkey");
  const updatedBy = pick(content, "updatedByPubkey");
  const source = pick(content, "sourceActionEventId");
  const rawCurrent = pick(content, "current");
  const rawPending = pick(content, "pending");
  const rawRecords = pick(content, "records");
  if (
    typeof playbookId !== "string" ||
    !UUID_PATTERN.test(playbookId) ||
    dTag !== playbookDTag(playbookId) ||
    typeof status !== "string" ||
    !PLAYBOOK_STATUSES.has(status as PlaybookStatus) ||
    version === null ||
    createdAt === null ||
    updatedAt === null ||
    typeof createdBy !== "string" ||
    !PUBKEY_PATTERN.test(createdBy) ||
    typeof updatedBy !== "string" ||
    !PUBKEY_PATTERN.test(updatedBy) ||
    typeof source !== "string" ||
    !PUBKEY_PATTERN.test(source)
  )
    return null;
  if (
    rawRecords !== undefined &&
    (!Array.isArray(rawRecords) || rawRecords.length > MAX_PLAYBOOK_RECORDS)
  )
    return null;
  const current =
    rawCurrent === undefined || rawCurrent === null
      ? null
      : parseContent(rawCurrent);
  if (rawCurrent !== undefined && rawCurrent !== null && current === null)
    return null;
  const pending =
    rawPending === undefined || rawPending === null
      ? null
      : parseChange(rawPending);
  if (rawPending !== undefined && rawPending !== null && pending === null)
    return null;
  // A version exists exactly when there is approved content (an archived
  // playbook that was never approved has neither).
  if ((version === 0) !== (current === null) && status !== "archived")
    return null;
  const records: PlaybookDecisionRecordView[] = [];
  for (const raw of (rawRecords as unknown[] | undefined) ?? []) {
    const record = parseDecisionRecord(raw);
    if (!record) return null;
    records.push(record);
  }
  const title = current?.title ?? pending?.content.title;
  if (!title) return null;
  return {
    playbookId,
    status: status as PlaybookStatus,
    version,
    title,
    current,
    pending,
    records,
    createdByPubkey: createdBy,
    createdAt,
    updatedByPubkey: updatedBy,
    updatedAt,
    eventId: event.id,
  };
}

function parseJobStep(value: unknown): JobStepView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      ...STEP_COMMON_KEYS,
      "status",
      "note",
      "progressLabel",
      "statusAt",
    ])
  )
    return null;
  const common = parseStepCommon(value);
  const status = pick(value, "status");
  const note = optionalText(value, "note", 500);
  const progressLabel = optionalText(value, "progressLabel", 120);
  const statusAt = readNumber(value, "statusAt");
  if (
    common === null ||
    typeof status !== "string" ||
    !JOB_STEP_STATUSES.has(status as JobStepStatus) ||
    note === undefined ||
    progressLabel === undefined ||
    statusAt === null
  )
    return null;
  return {
    ...common,
    status: status as JobStepStatus,
    note,
    progressLabel,
    statusAt,
  };
}

function parseJobApproval(value: unknown): JobApprovalRecordView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "stepId",
      "decision",
      "actorPubkey",
      "at",
      "note",
      "actionEventId",
    ])
  )
    return null;
  const stepId = pick(value, "stepId");
  const decision = pick(value, "decision");
  const actor = pick(value, "actorPubkey");
  const at = readNumber(value, "at");
  const note = optionalText(value, "note", 500);
  const actionEventId = pick(value, "actionEventId");
  if (
    typeof stepId !== "string" ||
    !STEP_ID_PATTERN.test(stepId) ||
    typeof decision !== "string" ||
    !JOB_DECISIONS.has(decision as JobDecision) ||
    typeof actor !== "string" ||
    !PUBKEY_PATTERN.test(actor) ||
    at === null ||
    note === undefined ||
    typeof actionEventId !== "string" ||
    !PUBKEY_PATTERN.test(actionEventId)
  )
    return null;
  return {
    stepId,
    decision: decision as JobDecision,
    actorPubkey: actor,
    at,
    note,
    actionEventId,
  };
}

function parseJobHandoff(value: unknown): JobHandoffRecordView | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "stepId",
      "from",
      "to",
      "byPubkey",
      "at",
      "note",
      "actionEventId",
    ])
  )
    return null;
  const stepId = pick(value, "stepId");
  const from = parseOwner(pick(value, "from"));
  const to = parseOwner(pick(value, "to"));
  const by = pick(value, "byPubkey");
  const at = readNumber(value, "at");
  const note = optionalText(value, "note", 500);
  const actionEventId = pick(value, "actionEventId");
  if (
    typeof stepId !== "string" ||
    !STEP_ID_PATTERN.test(stepId) ||
    from === null ||
    to === null ||
    typeof by !== "string" ||
    !PUBKEY_PATTERN.test(by) ||
    at === null ||
    note === undefined ||
    typeof actionEventId !== "string" ||
    !PUBKEY_PATTERN.test(actionEventId)
  )
    return null;
  return { stepId, from, to, byPubkey: by, at, note, actionEventId };
}

function parseAll<T>(
  raw: unknown,
  max: number,
  parse: (value: unknown) => T | null,
): T[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > max) return null;
  const out: T[] = [];
  for (const item of raw) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/** The first step that has not ended, while the job runs. */
function firstOpenStepId(steps: readonly JobStepView[]): string | null {
  return (
    steps.find((step) => step.status !== "done" && step.status !== "skipped")
      ?.stepId ?? null
  );
}

export function parsePlaybookJobHead(
  event: RelayEvent,
  relaySelfPubkey: string,
): JobView | null {
  const parsed = relayHeadContent(
    event,
    relaySelfPubkey,
    PLAYBOOK_JOB_D_TAG_PREFIX,
    [
      "schemaVersion",
      "jobId",
      "playbookId",
      "playbookVersion",
      "playbookTitle",
      "title",
      "status",
      "currentStepId",
      "steps",
      "approvals",
      "handoffs",
      "startedByPubkey",
      "startedAt",
      "endedAt",
      "updatedByPubkey",
      "updatedAt",
      "sourceActionEventId",
    ],
  );
  if (!parsed) return null;
  const { dTag, content } = parsed;
  const jobId = pick(content, "jobId");
  const playbookId = pick(content, "playbookId");
  const playbookVersion = readNumber(content, "playbookVersion");
  const playbookTitle = text(pick(content, "playbookTitle"), 120);
  const title = text(pick(content, "title"), 120);
  const status = pick(content, "status");
  const currentStepId = pick(content, "currentStepId");
  const startedAt = readNumber(content, "startedAt");
  const rawEndedAt = pick(content, "endedAt");
  const endedAt =
    rawEndedAt === undefined ? null : readNumber(content, "endedAt");
  const updatedAt = readNumber(content, "updatedAt");
  const startedBy = pick(content, "startedByPubkey");
  const updatedBy = pick(content, "updatedByPubkey");
  const source = pick(content, "sourceActionEventId");
  const rawSteps = pick(content, "steps");
  if (
    typeof jobId !== "string" ||
    !UUID_PATTERN.test(jobId) ||
    dTag !== playbookJobDTag(jobId) ||
    typeof playbookId !== "string" ||
    !UUID_PATTERN.test(playbookId) ||
    playbookVersion === null ||
    playbookVersion < 1 ||
    playbookTitle === null ||
    title === null ||
    typeof status !== "string" ||
    !JOB_STATUSES.has(status as JobStatus) ||
    (currentStepId !== undefined && typeof currentStepId !== "string") ||
    startedAt === null ||
    (rawEndedAt !== undefined && endedAt === null) ||
    updatedAt === null ||
    typeof startedBy !== "string" ||
    !PUBKEY_PATTERN.test(startedBy) ||
    typeof updatedBy !== "string" ||
    !PUBKEY_PATTERN.test(updatedBy) ||
    typeof source !== "string" ||
    !PUBKEY_PATTERN.test(source) ||
    !Array.isArray(rawSteps) ||
    rawSteps.length < 1 ||
    rawSteps.length > MAX_PLAYBOOK_STEPS
  )
    return null;
  const steps: JobStepView[] = [];
  const seen = new Set<string>();
  for (const raw of rawSteps) {
    const step = parseJobStep(raw);
    if (!step || seen.has(step.stepId)) return null;
    seen.add(step.stepId);
    steps.push(step);
  }
  const approvals = parseAll(
    pick(content, "approvals"),
    MAX_JOB_APPROVALS,
    parseJobApproval,
  );
  const handoffs = parseAll(
    pick(content, "handoffs"),
    MAX_JOB_HANDOFFS,
    parseJobHandoff,
  );
  if (approvals === null || handoffs === null) return null;
  // The head names the current step; a head that disagrees with its own steps is refused.
  const expectedCurrent = status === "running" ? firstOpenStepId(steps) : null;
  if ((currentStepId ?? null) !== expectedCurrent) return null;
  return {
    jobId,
    playbookId,
    playbookVersion,
    playbookTitle,
    title,
    status: status as JobStatus,
    currentStepId: expectedCurrent,
    steps,
    approvals,
    handoffs,
    startedByPubkey: startedBy,
    startedAt,
    endedAt,
    updatedByPubkey: updatedBy,
    updatedAt,
    eventId: event.id,
  };
}

/** How many steps of the playbook's approved version ask for the owner. */
export function playbookApprovalPointCount(
  content: PlaybookContentView | null,
): number {
  return content?.steps.filter((step) => step.approvalPoint).length ?? 0;
}

/** The newest approval or direct edit: "Last change approved by you on 2 Nov". */
export function lastApprovedChange(
  playbook: Pick<PlaybookView, "records">,
): PlaybookDecisionRecordView | null {
  for (let index = playbook.records.length - 1; index >= 0; index -= 1) {
    const record = playbook.records[index];
    if (record.decision === "approved" || record.decision === "published")
      return record;
  }
  return null;
}

/** "3 of 7" and the step the job is at, for the jobs list beside a playbook. */
export function jobProgress(job: JobView): {
  done: number;
  total: number;
  currentStep: JobStepView | null;
} {
  const done = job.steps.filter(
    (step) => step.status === "done" || step.status === "skipped",
  ).length;
  const currentStep =
    job.steps.find((step) => step.stepId === job.currentStepId) ?? null;
  return { done, total: job.steps.length, currentStep };
}

/**
 * The job's current step when it stopped at its approval point, for the owner.
 * A step for the founder with an approval point is at that point as soon as it
 * is current: the owner approves it from Needs you without anyone asking first.
 */
export function jobStepsWaitingForApproval(job: JobView): JobStepView[] {
  return job.status === "running"
    ? job.steps.filter(
        (step) =>
          step.stepId === job.currentStepId &&
          step.approvalPoint !== null &&
          (step.status === "waiting_approval" ||
            (step.status === "pending" && step.owner.kind === "owner")),
      )
    : [];
}

/** The job's current step when only a person can do it and may start now ("Do" in Needs you). */
export function jobOpenHumanSteps(job: JobView): JobStepView[] {
  return job.status === "running"
    ? job.steps.filter(
        (step) =>
          step.stepId === job.currentStepId &&
          step.owner.kind === "owner" &&
          (step.status === "approved" ||
            step.status === "in_progress" ||
            (step.status === "pending" && step.approvalPoint === null)),
      )
    : [];
}

/** Jobs of one playbook, running ones first, newest change first. */
export function jobsOfPlaybook(
  jobs: readonly JobView[],
  playbookId: string,
): JobView[] {
  return jobs
    .filter((job) => job.playbookId === playbookId)
    .sort(
      (first, second) =>
        Number(second.status === "running") -
          Number(first.status === "running") ||
        second.updatedAt - first.updatedAt ||
        first.jobId.localeCompare(second.jobId),
    );
}

function newestWins<T extends { eventId: string }>(
  parsed: ReadonlyArray<{ record: T; createdAt: number; key: string }>,
): T[] {
  const latest = new Map<string, { record: T; createdAt: number }>();
  for (const entry of parsed) {
    const current = latest.get(entry.key);
    if (
      !current ||
      entry.createdAt > current.createdAt ||
      (entry.createdAt === current.createdAt &&
        entry.record.eventId.localeCompare(current.record.eventId) < 0)
    ) {
      latest.set(entry.key, {
        record: entry.record,
        createdAt: entry.createdAt,
      });
    }
  }
  return [...latest.values()].map(({ record }) => record);
}

/** The newest head per playbook wins; newest change first. */
export function latestPlaybooks(
  parsed: ReadonlyArray<{ playbook: PlaybookView; createdAt: number }>,
): PlaybookView[] {
  return newestWins(
    parsed.map(({ playbook, createdAt }) => ({
      record: playbook,
      createdAt,
      key: playbook.playbookId,
    })),
  ).sort(
    (first, second) =>
      second.updatedAt - first.updatedAt ||
      first.playbookId.localeCompare(second.playbookId),
  );
}

/** The newest head per job wins; newest change first. */
export function latestJobs(
  parsed: ReadonlyArray<{ job: JobView; createdAt: number }>,
): JobView[] {
  return newestWins(
    parsed.map(({ job, createdAt }) => ({
      record: job,
      createdAt,
      key: job.jobId,
    })),
  ).sort(
    (first, second) =>
      second.updatedAt - first.updatedAt ||
      first.jobId.localeCompare(second.jobId),
  );
}
