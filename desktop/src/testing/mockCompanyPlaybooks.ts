/**
 * Mock bridge model of co-founder playbooks and their running copies (kind
 * 30677 heads, kind 47067 actions). It applies the same authority and
 * approval-point rules as the relay (`buzz_core::company_playbooks`), enough
 * for UI specs: an agent never approves, a step with an approval point cannot
 * start until the owner approved it, steps run in order, a change waits until
 * the owner approves it. No signature work.
 *
 * This file imports nothing from the bridge, so the bridge can import it.
 */

export type MockPlaybookOwner = {
  kind: "function" | "lead_agent" | "worker" | "owner";
  function?: string;
  agentPubkey?: string;
  workerType?: string;
};

export type MockPlaybookStep = {
  stepId: string;
  title: string;
  detail?: string;
  owner: MockPlaybookOwner;
  inputs?: string[];
  outputs?: string[];
  tools?: string[];
  approvalPoint?: {
    kind: "outreach" | "spend" | "taste" | "hire" | "other";
    prompt: string;
  };
};

export type MockPlaybookContent = {
  title: string;
  summary?: string;
  function?: string;
  steps: MockPlaybookStep[];
};

export type MockPlaybookRecord = {
  decision:
    | "approved"
    | "rejected"
    | "edited"
    | "published"
    | "withdrawn"
    | "archived";
  version: number;
  revision?: number;
  actorPubkey: string;
  at: number;
  note?: string;
  changeSummary?: string;
  proposedByPubkey?: string;
  actionEventId?: string;
};

/** One playbook seed. Keys follow the relay-signed playbook head. */
export type MockPlaybook = {
  playbookId: string;
  /** Defaults to `active` when there is an approved version, otherwise `proposed`. */
  status?: "proposed" | "active" | "archived" | "rejected";
  /** Latest approved version; 0 or omitted while only a proposal exists. */
  version?: number;
  current?: MockPlaybookContent;
  pending?: {
    content: MockPlaybookContent;
    changeSummary?: string;
    proposedByPubkey: string;
    proposedAt?: number;
    revision?: number;
  };
  records?: MockPlaybookRecord[];
  createdByPubkey: string;
  createdAt?: number;
  updatedAt?: number;
};

export type MockJobStepStatus =
  | "pending"
  | "waiting_approval"
  | "approved"
  | "in_progress"
  | "done"
  | "blocked"
  | "skipped";

export type MockJobStep = MockPlaybookStep & {
  status?: MockJobStepStatus;
  note?: string;
  progressLabel?: string;
  statusAt?: number;
};

/** One running copy seed. Keys follow the relay-signed running-copy head. */
export type MockPlaybookJob = {
  jobId: string;
  playbookId: string;
  playbookVersion?: number;
  playbookTitle: string;
  title: string;
  status?: "running" | "completed" | "cancelled";
  steps: MockJobStep[];
  approvals?: Array<{
    stepId: string;
    decision: "approved" | "rejected";
    actorPubkey: string;
    at: number;
    note?: string;
    actionEventId?: string;
  }>;
  handoffs?: Array<{
    stepId: string;
    from: MockPlaybookOwner;
    to: MockPlaybookOwner;
    byPubkey: string;
    at: number;
    note?: string;
    actionEventId?: string;
  }>;
  startedByPubkey: string;
  startedAt?: number;
  endedAt?: number;
  updatedAt?: number;
};

export type MockPlaybookState = {
  companyPlaybooks?: MockPlaybook[];
  companyPlaybookJobs?: MockPlaybookJob[];
};

export type MockPlaybookContext = {
  /** The signed-in person is the owner or an admin. */
  isAdmin: boolean;
  cofounderEnabled: boolean;
  /** Unix seconds. */
  now: number;
  actorPubkey: string;
  eventId: string;
};

const DEFAULT_TIME = 1_793_000_000;
const ENDED = new Set<MockJobStepStatus>(["done", "skipped"]);

function stepStatus(step: MockJobStep): MockJobStepStatus {
  return step.status ?? "pending";
}

function firstOpenStep(job: MockPlaybookJob): MockJobStep | undefined {
  return job.steps.find((step) => !ENDED.has(stepStatus(step)));
}

function contentBody(content: MockPlaybookContent): Record<string, unknown> {
  return {
    title: content.title,
    summary: content.summary ?? "",
    ...(content.function ? { function: content.function } : {}),
    steps: content.steps.map(stepBody),
  };
}

function stepBody(step: MockPlaybookStep): Record<string, unknown> {
  return {
    stepId: step.stepId,
    title: step.title,
    ...(step.detail ? { detail: step.detail } : {}),
    owner: step.owner,
    ...(step.inputs?.length ? { inputs: step.inputs } : {}),
    ...(step.outputs?.length ? { outputs: step.outputs } : {}),
    ...(step.tools?.length ? { tools: step.tools } : {}),
    ...(step.approvalPoint ? { approvalPoint: step.approvalPoint } : {}),
  };
}

/** The playbook head content the relay would sign. */
export function mockPlaybookHeadContent(
  playbook: MockPlaybook,
): Record<string, unknown> {
  const version = playbook.version ?? (playbook.current ? 1 : 0);
  const createdAt = playbook.createdAt ?? DEFAULT_TIME;
  return {
    schemaVersion: 1,
    playbookId: playbook.playbookId,
    status: playbook.status ?? (version > 0 ? "active" : "proposed"),
    version,
    ...(playbook.current ? { current: contentBody(playbook.current) } : {}),
    ...(playbook.pending
      ? {
          pending: {
            content: contentBody(playbook.pending.content),
            ...(playbook.pending.changeSummary
              ? { changeSummary: playbook.pending.changeSummary }
              : {}),
            proposedByPubkey: playbook.pending.proposedByPubkey,
            proposedAt: playbook.pending.proposedAt ?? createdAt,
            revision: playbook.pending.revision ?? 1,
          },
        }
      : {}),
    records: (playbook.records ?? []).map((record) => ({
      ...record,
      actionEventId: record.actionEventId ?? "a".repeat(64),
    })),
    createdByPubkey: playbook.createdByPubkey,
    createdAt,
    updatedByPubkey: playbook.createdByPubkey,
    updatedAt: playbook.updatedAt ?? createdAt,
    sourceActionEventId: "a".repeat(64),
  };
}

/** The running-copy head content the relay would sign. */
export function mockPlaybookJobHeadContent(
  job: MockPlaybookJob,
): Record<string, unknown> {
  const startedAt = job.startedAt ?? DEFAULT_TIME;
  const status = job.status ?? "running";
  const current = status === "running" ? firstOpenStep(job) : undefined;
  return {
    schemaVersion: 1,
    jobId: job.jobId,
    playbookId: job.playbookId,
    playbookVersion: job.playbookVersion ?? 1,
    playbookTitle: job.playbookTitle,
    title: job.title,
    status,
    ...(current ? { currentStepId: current.stepId } : {}),
    steps: job.steps.map((step) => ({
      ...stepBody(step),
      status: stepStatus(step),
      ...(step.note ? { note: step.note } : {}),
      ...(step.progressLabel ? { progressLabel: step.progressLabel } : {}),
      statusAt: step.statusAt ?? startedAt,
    })),
    approvals: (job.approvals ?? []).map((record) => ({
      ...record,
      actionEventId: record.actionEventId ?? "a".repeat(64),
    })),
    handoffs: (job.handoffs ?? []).map((record) => ({
      ...record,
      actionEventId: record.actionEventId ?? "a".repeat(64),
    })),
    startedByPubkey: job.startedByPubkey,
    startedAt,
    ...(job.endedAt ? { endedAt: job.endedAt } : {}),
    updatedByPubkey: job.startedByPubkey,
    updatedAt: job.updatedAt ?? startedAt,
    sourceActionEventId: "a".repeat(64),
  };
}

type PlaybookActionBody = {
  schemaVersion?: number;
  playbookId?: string;
  kind?: string;
  content?: MockPlaybookContent;
  changeSummary?: string;
  revision?: number;
  note?: string;
};

type JobActionBody = {
  schemaVersion?: number;
  jobId?: string;
  kind?: string;
  playbookId?: string;
  playbookVersion?: number;
  title?: string;
  stepId?: string;
  stepStatus?: MockJobStepStatus;
  progressLabel?: string;
  handOffTo?: MockPlaybookOwner;
  note?: string;
};

function hasWorkerOutwardGate(
  owner: MockPlaybookOwner,
  point: MockPlaybookStep["approvalPoint"],
): boolean {
  return (
    owner.kind === "worker" &&
    (point?.kind === "outreach" || point?.kind === "spend")
  );
}

/**
 * Apply one playbook action (kind 47067 under a `company:playbook:` d tag).
 * Returns the relay's refusal message, or null when it applied.
 */
export function applyMockPlaybookAction(
  state: MockPlaybookState,
  action: PlaybookActionBody,
  context: MockPlaybookContext,
): string | null {
  if (action.schemaVersion !== 1 || !action.playbookId || !action.kind)
    return "invalid: playbook action has an unsupported shape.";
  const playbooks = state.companyPlaybooks ?? [];
  state.companyPlaybooks = playbooks;
  const existing = playbooks.find(
    (candidate) => candidate.playbookId === action.playbookId,
  );
  const need = (what: string): string | null =>
    context.isAdmin
      ? null
      : `restricted: only the owner or an admin can ${what}`;
  const needMode = (what: string): string | null =>
    context.cofounderEnabled
      ? null
      : `restricted: co-founder mode is off for this company, so ${what}`;
  const record = (
    playbook: MockPlaybook,
    decision: MockPlaybookRecord["decision"],
    extra: Partial<MockPlaybookRecord> = {},
  ) => {
    playbook.records = [
      ...(playbook.records ?? []),
      {
        decision,
        version: playbook.version ?? 0,
        actorPubkey: context.actorPubkey,
        at: context.now,
        ...(action.note ? { note: action.note } : {}),
        actionEventId: context.eventId,
        ...extra,
      },
    ];
  };

  if (action.kind === "propose") {
    const refusal = needMode("playbooks cannot be proposed");
    if (refusal) return refusal;
    if (existing) return "conflict: a playbook with this id already exists";
    if (!action.content) return "invalid: propose needs a playbook";
    playbooks.push({
      playbookId: action.playbookId,
      status: "proposed",
      version: 0,
      pending: {
        content: action.content,
        changeSummary: action.changeSummary,
        proposedByPubkey: context.actorPubkey,
        proposedAt: context.now,
        revision: 1,
      },
      records: [],
      createdByPubkey: context.actorPubkey,
      createdAt: context.now,
      updatedAt: context.now,
    });
    return null;
  }
  if (!existing) return "conflict: this playbook does not exist";
  const playbook = existing;
  const status = playbook.status ?? (playbook.version ? "active" : "proposed");
  if (status !== "proposed" && status !== "active")
    return "conflict: this playbook has already ended";
  const decided = playbook.pending;
  switch (action.kind) {
    case "propose_change": {
      const refusal = needMode("playbook changes cannot be proposed");
      if (refusal) return refusal;
      if (status !== "active")
        return "conflict: only an approved playbook takes a proposed change; revise the first proposal instead";
      if (playbook.pending)
        return "conflict: a change is already waiting for the owner; revise or withdraw it first";
      if (!action.content || !action.changeSummary)
        return "invalid: propose_change carries a playbook and a change summary";
      playbook.pending = {
        content: action.content,
        changeSummary: action.changeSummary,
        proposedByPubkey: context.actorPubkey,
        proposedAt: context.now,
        revision: 1,
      };
      break;
    }
    case "revise": {
      const refusal = needMode("playbook proposals cannot be revised");
      if (refusal) return refusal;
      if (!playbook.pending)
        return "conflict: no change is waiting to be revised";
      if (!action.content) return "invalid: revise needs a playbook";
      playbook.pending = {
        ...playbook.pending,
        content: action.content,
        changeSummary: action.changeSummary ?? playbook.pending.changeSummary,
        revision: (playbook.pending.revision ?? 1) + 1,
      };
      if (
        context.isAdmin &&
        playbook.pending.proposedByPubkey !== context.actorPubkey
      ) {
        record(playbook, "edited", { revision: playbook.pending.revision });
      }
      break;
    }
    case "approve":
    case "reject": {
      const refusal = need(`${action.kind} a playbook or a change to one`);
      if (refusal) return refusal;
      if (action.kind === "approve") {
        const modeRefusal = needMode(
          "new playbook versions cannot be approved",
        );
        if (modeRefusal) return modeRefusal;
      }
      if (!decided) return "conflict: no change is waiting for a decision";
      if (action.revision !== (decided.revision ?? 1))
        return `conflict: the proposal changed since you looked: it is now revision ${decided.revision ?? 1}`;
      playbook.pending = undefined;
      if (action.kind === "approve") {
        playbook.version = (playbook.version ?? 0) + 1;
        playbook.current = decided.content;
        playbook.status = "active";
      } else if (!playbook.version) {
        playbook.status = "rejected";
      }
      record(playbook, action.kind === "approve" ? "approved" : "rejected", {
        revision: decided.revision ?? 1,
        ...(decided.changeSummary
          ? { changeSummary: decided.changeSummary }
          : {}),
        proposedByPubkey: decided.proposedByPubkey,
      });
      break;
    }
    case "withdraw": {
      if (!decided) return "conflict: no change is waiting to be withdrawn";
      if (!context.isAdmin && decided.proposedByPubkey !== context.actorPubkey)
        return "restricted: only the proposer, the owner or an admin can withdraw a proposal";
      playbook.pending = undefined;
      if (!playbook.version) playbook.status = "rejected";
      record(playbook, "withdrawn", {
        revision: decided.revision ?? 1,
        proposedByPubkey: decided.proposedByPubkey,
      });
      break;
    }
    case "edit": {
      const refusal = need("write a playbook version directly");
      if (refusal) return refusal;
      if (!action.content) return "invalid: edit needs a playbook";
      playbook.pending = undefined;
      playbook.version = (playbook.version ?? 0) + 1;
      playbook.current = action.content;
      playbook.status = "active";
      record(playbook, "published", {
        ...(action.changeSummary
          ? { changeSummary: action.changeSummary }
          : {}),
      });
      break;
    }
    case "archive": {
      const refusal = need("archive a playbook");
      if (refusal) return refusal;
      playbook.pending = undefined;
      playbook.status = "archived";
      record(playbook, "archived");
      break;
    }
    default:
      return "invalid: unknown playbook action kind";
  }
  playbook.updatedAt = context.now;
  return null;
}

function canRunStep(
  step: MockJobStep,
  job: MockPlaybookJob,
  context: MockPlaybookContext,
): boolean {
  if (context.isAdmin) return true;
  if (step.owner.kind === "owner") return false;
  return job.startedByPubkey === context.actorPubkey;
}

/**
 * Apply one running-copy action (kind 47067 under a `company:playbook-job:` d
 * tag). Returns the relay's refusal message, or null when it applied.
 */
export function applyMockPlaybookJobAction(
  state: MockPlaybookState,
  action: JobActionBody,
  context: MockPlaybookContext,
): string | null {
  if (action.schemaVersion !== 1 || !action.jobId || !action.kind)
    return "invalid: playbook job action has an unsupported shape.";
  const jobs = state.companyPlaybookJobs ?? [];
  state.companyPlaybookJobs = jobs;
  const existing = jobs.find((candidate) => candidate.jobId === action.jobId);

  if (action.kind === "start") {
    if (!context.cofounderEnabled)
      return "restricted: co-founder mode is off for this company, so jobs cannot be started";
    if (existing) return "conflict: a job with this id already exists";
    const playbook = (state.companyPlaybooks ?? []).find(
      (candidate) => candidate.playbookId === action.playbookId,
    );
    if (!playbook) return "conflict: that playbook does not exist";
    if (playbook.status === "archived")
      return "conflict: that playbook is archived; jobs can no longer start from it";
    if (!playbook.current || !playbook.version)
      return "conflict: that playbook has no approved version yet; the owner has to approve it first";
    if (
      action.playbookVersion !== undefined &&
      action.playbookVersion !== playbook.version
    )
      return `conflict: the playbook moved on: it is now version ${playbook.version}`;
    if (!action.title) return "invalid: start needs a title";
    jobs.push({
      jobId: action.jobId,
      playbookId: playbook.playbookId,
      playbookVersion: playbook.version,
      playbookTitle: playbook.current.title,
      title: action.title,
      status: "running",
      steps: playbook.current.steps.map((step) => ({
        ...step,
        status: "pending" as const,
        statusAt: context.now,
      })),
      approvals: [],
      handoffs: [],
      startedByPubkey: context.actorPubkey,
      startedAt: context.now,
      updatedAt: context.now,
    });
    return null;
  }
  if (!existing) return "conflict: this job does not exist";
  const job = existing;
  if ((job.status ?? "running") !== "running")
    return "conflict: this job has already ended";

  if (action.kind === "cancel") {
    if (!context.isAdmin && job.startedByPubkey !== context.actorPubkey)
      return "restricted: only whoever started the job, the owner or an admin can cancel it";
    job.status = "cancelled";
    job.endedAt = context.now;
    job.updatedAt = context.now;
    return null;
  }

  const step = job.steps.find(
    (candidate) => candidate.stepId === action.stepId,
  );
  if (!step) return `invalid: the job has no step ${action.stepId ?? ""}`;
  const current = stepStatus(step);

  if (action.kind === "hand_off") {
    if (ENDED.has(current))
      return "conflict: a step that ended cannot be handed on";
    if (!canRunStep(step, job, context))
      return "restricted: you are not the doer of this step";
    if (!action.handOffTo) return "invalid: hand_off needs handOffTo";
    if (JSON.stringify(step.owner) === JSON.stringify(action.handOffTo))
      return "conflict: the step already has that owner";
    if (hasWorkerOutwardGate(action.handOffTo, step.approvalPoint))
      return "invalid: a worker step cannot send or spend: workers never take outward actions";
    job.handoffs = [
      ...(job.handoffs ?? []),
      {
        stepId: step.stepId,
        from: step.owner,
        to: action.handOffTo,
        byPubkey: context.actorPubkey,
        at: context.now,
        ...(action.note ? { note: action.note } : {}),
        actionEventId: context.eventId,
      },
    ];
    step.owner = action.handOffTo;
    job.updatedAt = context.now;
    return null;
  }

  const open = firstOpenStep(job);
  if (open?.stepId !== step.stepId)
    return `conflict: step ${step.stepId} is not the current step; the job is at step ${open?.stepId ?? "none"}`;
  const gated = Boolean(step.approvalPoint);
  const decide = (approving: boolean): string | null => {
    if (!context.isAdmin)
      return `restricted: only the owner or an admin can ${approving ? "approve" : "reject"} a step`;
    if (!gated) return "conflict: this step has no approval point";
    if (current !== "pending" && current !== "waiting_approval")
      return "conflict: only a step that has not started can be approved or rejected";
    step.status = approving ? "approved" : "skipped";
    step.statusAt = context.now;
    if (action.note) step.note = action.note;
    job.approvals = [
      ...(job.approvals ?? []),
      {
        stepId: step.stepId,
        decision: approving ? "approved" : "rejected",
        actorPubkey: context.actorPubkey,
        at: context.now,
        ...(action.note ? { note: action.note } : {}),
        actionEventId: context.eventId,
      },
    ];
    return null;
  };

  switch (action.kind) {
    case "request_step_approval": {
      if (!canRunStep(step, job, context))
        return "restricted: you are not the doer of this step";
      if (!gated) return "conflict: this step has no approval point";
      if (current !== "pending")
        return "conflict: only a pending step can ask for approval";
      step.status = "waiting_approval";
      step.statusAt = context.now;
      if (action.note) step.note = action.note;
      break;
    }
    case "approve_step":
    case "reject_step": {
      const refusal = decide(action.kind === "approve_step");
      if (refusal) return refusal;
      break;
    }
    case "update_step": {
      if (!canRunStep(step, job, context))
        return "restricted: you are not the doer of this step";
      const to = action.stepStatus;
      if (!to || !["in_progress", "done", "blocked", "skipped"].includes(to))
        return "invalid: update_step moves a step to in_progress, done, blocked or skipped";
      if (to === "blocked" && !action.note)
        return "invalid: a blocked step needs a note that says why";
      const allowed =
        (to === "in_progress" &&
          (current === "approved" ||
            current === "blocked" ||
            (current === "pending" && !gated))) ||
        (to === "done" &&
          (current === "in_progress" ||
            current === "approved" ||
            (current === "pending" &&
              !gated &&
              step.owner.kind === "owner"))) ||
        (to === "blocked" &&
          (current === "approved" ||
            current === "in_progress" ||
            (current === "pending" && !gated))) ||
        (to === "skipped" && current !== "done" && current !== "skipped");
      if (!allowed)
        return current === "waiting_approval" ||
          (current === "pending" && gated)
          ? "conflict: this step waits for the owner's approval before it can run"
          : "conflict: that step cannot move to that state from where it is";
      step.status = to;
      step.statusAt = context.now;
      if (action.note) step.note = action.note;
      if (action.progressLabel) step.progressLabel = action.progressLabel;
      break;
    }
    default:
      return "invalid: unknown playbook job action kind";
  }
  if (job.steps.every((candidate) => ENDED.has(stepStatus(candidate)))) {
    job.status = "completed";
    job.endedAt = context.now;
  }
  job.updatedAt = context.now;
  return null;
}
