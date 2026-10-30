import { COMPANY_RECORD_SCHEMA_VERSION } from "./cofounderRecords";
import { playbookDTag, playbookJobDTag } from "./playbookRecords";
import type { JobStepStatus, JobView, PlaybookView } from "./playbookRecords";

/** What a playbook says; mirrors `PlaybookContent` in buzz-core. */
export type PlaybookContentInput = {
  title: string;
  summary?: string;
  function?: string;
  steps: Array<Record<string, unknown>>;
};

/** A step owner as the relay reads it (`PlanStepOwner`). */
export type PlaybookOwnerInput = {
  kind: "function" | "lead_agent" | "worker" | "owner";
  function?: string;
  agentPubkey?: string;
  workerType?: string;
};

export type PlaybookActionInput =
  | {
      kind: "propose";
      playbookId: string;
      content: PlaybookContentInput;
      changeSummary?: string;
    }
  | {
      kind: "propose_change";
      playbookId: string;
      content: PlaybookContentInput;
      changeSummary: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "revise" | "edit";
      playbookId: string;
      content: PlaybookContentInput;
      changeSummary?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "approve" | "reject";
      playbookId: string;
      revision: number;
      note?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "withdraw" | "archive";
      playbookId: string;
      note?: string;
      expectedHeadEventId: string;
    };

export type PlaybookJobActionInput =
  | {
      kind: "start";
      jobId: string;
      playbookId: string;
      title: string;
      playbookVersion?: number;
    }
  | {
      kind: "update_step";
      jobId: string;
      stepId: string;
      stepStatus: Extract<
        JobStepStatus,
        "in_progress" | "done" | "blocked" | "skipped"
      >;
      note?: string;
      progressLabel?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "request_step_approval" | "approve_step" | "reject_step";
      jobId: string;
      stepId: string;
      note?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "hand_off";
      jobId: string;
      stepId: string;
      handOffTo: PlaybookOwnerInput;
      note?: string;
      expectedHeadEventId: string;
    }
  | {
      kind: "cancel";
      jobId: string;
      note?: string;
      expectedHeadEventId: string;
    };

type SignedContent = { content: string; tags: string[][] };

/** The signed event content and tags of one playbook action (kind 47067). */
export function buildPlaybookActionEvent(
  input: PlaybookActionInput,
): SignedContent {
  const body: Record<string, unknown> = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    playbookId: input.playbookId,
    kind: input.kind,
  };
  if ("content" in input) body.content = input.content;
  if ("changeSummary" in input && input.changeSummary) {
    body.changeSummary = input.changeSummary;
  }
  if ("revision" in input) body.revision = input.revision;
  if ("note" in input && input.note) body.note = input.note;
  if ("expectedHeadEventId" in input) {
    body.expectedHeadEventId = input.expectedHeadEventId;
  }
  return {
    content: JSON.stringify(body),
    tags: [["d", playbookDTag(input.playbookId)]],
  };
}

/** The signed event content and tags of one running-copy action (kind 47067). */
export function buildPlaybookJobActionEvent(
  input: PlaybookJobActionInput,
): SignedContent {
  const body: Record<string, unknown> = {
    schemaVersion: COMPANY_RECORD_SCHEMA_VERSION,
    jobId: input.jobId,
    kind: input.kind,
  };
  if ("playbookId" in input) body.playbookId = input.playbookId;
  if ("playbookVersion" in input && input.playbookVersion !== undefined) {
    body.playbookVersion = input.playbookVersion;
  }
  if ("title" in input) body.title = input.title;
  if ("stepId" in input) body.stepId = input.stepId;
  if ("stepStatus" in input) body.stepStatus = input.stepStatus;
  if ("progressLabel" in input && input.progressLabel) {
    body.progressLabel = input.progressLabel;
  }
  if ("handOffTo" in input) body.handOffTo = input.handOffTo;
  if ("note" in input && input.note) body.note = input.note;
  if ("expectedHeadEventId" in input) {
    body.expectedHeadEventId = input.expectedHeadEventId;
  }
  return {
    content: JSON.stringify(body),
    tags: [["d", playbookJobDTag(input.jobId)]],
  };
}

function waitingRevision(playbook: PlaybookView): number {
  if (!playbook.pending) {
    throw new Error("No change is waiting for a decision on this playbook.");
  }
  return playbook.pending.revision;
}

/** One-tap helpers for the playbook page and Needs you. Each names the exact head and revision seen. */
export const playbookActions = {
  approve: (playbook: PlaybookView, note?: string): PlaybookActionInput => ({
    kind: "approve",
    playbookId: playbook.playbookId,
    revision: waitingRevision(playbook),
    note,
    expectedHeadEventId: playbook.eventId,
  }),
  reject: (playbook: PlaybookView, note?: string): PlaybookActionInput => ({
    kind: "reject",
    playbookId: playbook.playbookId,
    revision: waitingRevision(playbook),
    note,
    expectedHeadEventId: playbook.eventId,
  }),
  /** The owner edits the waiting proposal before approving it. */
  edit: (
    playbook: PlaybookView,
    content: PlaybookContentInput,
    changeSummary?: string,
  ): PlaybookActionInput => ({
    kind: "revise",
    playbookId: playbook.playbookId,
    content,
    changeSummary,
    expectedHeadEventId: playbook.eventId,
  }),
  /** The owner writes the next version directly. */
  publish: (
    playbook: PlaybookView,
    content: PlaybookContentInput,
    changeSummary?: string,
  ): PlaybookActionInput => ({
    kind: "edit",
    playbookId: playbook.playbookId,
    content,
    changeSummary,
    expectedHeadEventId: playbook.eventId,
  }),
  /** "Propose a change" on the playbook page. */
  proposeChange: (
    playbook: PlaybookView,
    content: PlaybookContentInput,
    changeSummary: string,
  ): PlaybookActionInput => ({
    kind: "propose_change",
    playbookId: playbook.playbookId,
    content,
    changeSummary,
    expectedHeadEventId: playbook.eventId,
  }),
  withdraw: (playbook: PlaybookView, note?: string): PlaybookActionInput => ({
    kind: "withdraw",
    playbookId: playbook.playbookId,
    note,
    expectedHeadEventId: playbook.eventId,
  }),
  archive: (playbook: PlaybookView, note?: string): PlaybookActionInput => ({
    kind: "archive",
    playbookId: playbook.playbookId,
    note,
    expectedHeadEventId: playbook.eventId,
  }),
};

/** One-tap helpers for a running copy. Each names the exact head seen. */
export const playbookJobActions = {
  start: (
    playbook: Pick<PlaybookView, "playbookId" | "version">,
    jobId: string,
    title: string,
  ): PlaybookJobActionInput => ({
    kind: "start",
    jobId,
    playbookId: playbook.playbookId,
    title,
    playbookVersion: playbook.version,
  }),
  approveStep: (
    job: JobView,
    stepId: string,
    note?: string,
  ): PlaybookJobActionInput => ({
    kind: "approve_step",
    jobId: job.jobId,
    stepId,
    note,
    expectedHeadEventId: job.eventId,
  }),
  rejectStep: (
    job: JobView,
    stepId: string,
    note?: string,
  ): PlaybookJobActionInput => ({
    kind: "reject_step",
    jobId: job.jobId,
    stepId,
    note,
    expectedHeadEventId: job.eventId,
  }),
  requestApproval: (
    job: JobView,
    stepId: string,
    note?: string,
  ): PlaybookJobActionInput => ({
    kind: "request_step_approval",
    jobId: job.jobId,
    stepId,
    note,
    expectedHeadEventId: job.eventId,
  }),
  markDone: (
    job: JobView,
    stepId: string,
    note?: string,
  ): PlaybookJobActionInput => ({
    kind: "update_step",
    jobId: job.jobId,
    stepId,
    stepStatus: "done",
    note,
    expectedHeadEventId: job.eventId,
  }),
  handOff: (
    job: JobView,
    stepId: string,
    handOffTo: PlaybookOwnerInput,
    note?: string,
  ): PlaybookJobActionInput => ({
    kind: "hand_off",
    jobId: job.jobId,
    stepId,
    handOffTo,
    note,
    expectedHeadEventId: job.eventId,
  }),
  cancel: (job: JobView, note?: string): PlaybookJobActionInput => ({
    kind: "cancel",
    jobId: job.jobId,
    note,
    expectedHeadEventId: job.eventId,
  }),
};
