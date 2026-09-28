import { invokeTauri } from "@/shared/api/tauri";
import type {
  ApprovalActionResponse,
  TriggerWorkflowResponse,
  Workflow,
  WorkflowApproval,
  WorkflowDraft,
  WorkflowPreview,
  WorkflowRun,
  WorkflowSaveResult,
  TraceEntry,
} from "@/shared/api/types";

// ── Raw types (snake_case from backend) ───────────────────────────────────

type RawWorkflow = {
  id: string;
  revision: string;
  name: string;
  owner_pubkey: string;
  channel_id: string | null;
  definition: Record<string, unknown>;
  status: Workflow["status"];
  created_at: number;
  updated_at: number;
};

type RawWorkflowSaveResponse = RawWorkflow & {
  webhook_secret?: string | null;
};

type RawWorkflowDraft = {
  id: string;
  revision: string;
  name: string;
  owner_pubkey: string;
  channel_id: string;
  definition: Record<string, unknown>;
  updated_at: number;
};

type RawWorkflowPreviewStep = {
  step_id: string;
  outcome: string;
  action: string;
  definition: Record<string, unknown> | null;
  paths: string[];
  note: string | null;
};

type RawWorkflowPreview = {
  preview: boolean;
  side_effects: boolean;
  steps: RawWorkflowPreviewStep[];
};

type RawTraceEntry = {
  step_id: string;
  status: string;
  output?: Record<string, unknown>;
  started_at?: number | null;
  completed_at?: number | null;
  error?: string | null;
};

type RawWorkflowRun = {
  id: string;
  workflow_id: string;
  status: WorkflowRun["status"];
  current_step: number | null;
  execution_trace: RawTraceEntry[];
  started_at: number | null;
  completed_at: number | null;
  error_code?: string | null;
  error_message: string | null;
  created_at: number;
};

type RawWorkflowRunCursor = {
  before: string;
  before_id: string;
};

type RawWorkflowRunsResponse = {
  runs: RawWorkflowRun[];
  next: RawWorkflowRunCursor | null;
};

type RawWorkflowApproval = {
  approval_ref: string;
  workflow_id: string;
  run_id: string;
  step_id: string;
  step_index: number;
  approver_spec: string;
  status: WorkflowApproval["status"];
  approver_pubkey: string | null;
  note: string | null;
  expires_at: string;
  created_at: number;
};

type RawWorkflowApprovalsResponse = {
  approvals: RawWorkflowApproval[];
};

type RawTriggerWorkflowResponse = {
  run_id: string;
  workflow_id: string;
  status: string;
};

type RawApprovalActionResponse = {
  token: string;
  status: string;
  run_id: string;
  workflow_id: string;
};

// ── Conversion functions ──────────────────────────────────────────────────

function fromRawWorkflow(raw: RawWorkflow): Workflow {
  return {
    id: raw.id,
    revision: raw.revision,
    name: raw.name,
    ownerPubkey: raw.owner_pubkey,
    channelId: raw.channel_id,
    definition: raw.definition,
    status: raw.status,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function fromRawWorkflowSave(raw: RawWorkflowSaveResponse): WorkflowSaveResult {
  return {
    workflow: fromRawWorkflow(raw),
    webhookSecret: raw.webhook_secret ?? null,
  };
}

function fromRawWorkflowDraft(raw: RawWorkflowDraft): WorkflowDraft {
  return {
    id: raw.id,
    revision: raw.revision,
    name: raw.name,
    ownerPubkey: raw.owner_pubkey,
    channelId: raw.channel_id,
    definition: raw.definition,
    updatedAt: raw.updated_at,
  };
}

function fromRawWorkflowPreview(raw: RawWorkflowPreview): WorkflowPreview {
  return {
    preview: raw.preview,
    sideEffects: raw.side_effects,
    steps: raw.steps.map((step) => ({
      stepId: step.step_id,
      outcome: step.outcome,
      action: step.action,
      definition: step.definition,
      paths: step.paths,
      note: step.note,
    })),
  };
}

function fromRawTraceEntry(raw: RawTraceEntry): TraceEntry {
  return {
    stepId: raw.step_id,
    status: raw.status,
    output: raw.output ?? {},
    startedAt: raw.started_at ?? null,
    completedAt: raw.completed_at ?? null,
    error: raw.error ?? null,
  };
}

function fromRawWorkflowRun(raw: RawWorkflowRun): WorkflowRun {
  return {
    id: raw.id,
    workflowId: raw.workflow_id,
    status: raw.status,
    currentStep: raw.current_step,
    executionTrace: raw.execution_trace.map(fromRawTraceEntry),
    startedAt: raw.started_at,
    completedAt: raw.completed_at,
    errorCode: raw.error_code ?? null,
    errorMessage: raw.error_message,
    createdAt: raw.created_at,
  };
}

export function fromRawApproval(raw: RawWorkflowApproval): WorkflowApproval {
  return {
    approvalRef: raw.approval_ref,
    workflowId: raw.workflow_id,
    runId: raw.run_id,
    stepId: raw.step_id,
    stepIndex: raw.step_index,
    approverSpec: raw.approver_spec,
    status: raw.status,
    approverPubkey: raw.approver_pubkey,
    note: raw.note,
    expiresAt: raw.expires_at,
    createdAt: raw.created_at,
  };
}

function fromRawTriggerResponse(
  raw: RawTriggerWorkflowResponse,
): TriggerWorkflowResponse {
  return {
    runId: raw.run_id,
    workflowId: raw.workflow_id,
    status: raw.status,
  };
}

function fromRawApprovalResponse(
  raw: RawApprovalActionResponse,
): ApprovalActionResponse {
  return {
    token: raw.token,
    status: raw.status,
    runId: raw.run_id,
    workflowId: raw.workflow_id,
  };
}

// ── Tauri invoke wrappers ─────────────────────────────────────────────────

export async function getChannelWorkflows(
  channelId: string,
): Promise<Workflow[]> {
  const raw = await invokeTauri<RawWorkflow[]>("get_channel_workflows", {
    channelId,
  });
  return raw.map(fromRawWorkflow);
}

/**
 * Fetch workflows across many channels in a single relay round-trip.
 *
 * Replaces the per-channel `Promise.all(getChannelWorkflows)` fanout on the
 * Workflows overview: the backend `#h` filter matches any listed channel, and
 * each returned workflow carries its own `channelId` so callers can group.
 */
export async function getChannelsWorkflows(
  channelIds: string[],
): Promise<Workflow[]> {
  const raw = await invokeTauri<RawWorkflow[]>("get_channels_workflows", {
    channelIds,
  });
  return raw.map(fromRawWorkflow);
}

export async function getWorkflow(workflowId: string): Promise<Workflow> {
  const raw = await invokeTauri<RawWorkflow>("get_workflow", { workflowId });
  return fromRawWorkflow(raw);
}

export async function getWorkflowDraft(
  workflowId: string,
): Promise<WorkflowDraft | null> {
  const raw = await invokeTauri<RawWorkflowDraft | null>("get_workflow_draft", {
    workflowId,
  });
  return raw ? fromRawWorkflowDraft(raw) : null;
}

export async function saveWorkflowDraft(
  workflowId: string,
  channelId: string,
  yamlDefinition: string,
  expectedRevision?: string,
): Promise<WorkflowDraft> {
  const raw = await invokeTauri<RawWorkflowDraft>("save_workflow_draft", {
    workflowId,
    channelId,
    yamlDefinition,
    expectedRevision: expectedRevision ?? null,
  });
  return fromRawWorkflowDraft(raw);
}

export async function publishWorkflowDraft(
  workflowId: string,
  draftRevision: string,
  expectedActiveRevision?: string,
): Promise<WorkflowSaveResult> {
  const raw = await invokeTauri<RawWorkflowSaveResponse>(
    "publish_workflow_draft",
    {
      workflowId,
      draftRevision,
      expectedActiveRevision: expectedActiveRevision ?? null,
    },
  );
  return fromRawWorkflowSave(raw);
}

export async function setWorkflowStatus(
  workflowId: string,
  status: "active" | "paused",
): Promise<string> {
  return invokeTauri<string>("set_workflow_status", { workflowId, status });
}

export async function previewWorkflow(
  yamlDefinition: string,
): Promise<WorkflowPreview> {
  const raw = await invokeTauri<RawWorkflowPreview>("preview_workflow", {
    yamlDefinition,
  });
  return fromRawWorkflowPreview(raw);
}

export async function createWorkflow(
  channelId: string,
  yamlDefinition: string,
): Promise<WorkflowSaveResult> {
  const raw = await invokeTauri<RawWorkflowSaveResponse>("create_workflow", {
    channelId,
    yamlDefinition,
  });
  return fromRawWorkflowSave(raw);
}

export async function updateWorkflow(
  workflowId: string,
  yamlDefinition: string,
  expectedRevision: string,
): Promise<WorkflowSaveResult> {
  const raw = await invokeTauri<RawWorkflowSaveResponse>("update_workflow", {
    workflowId,
    yamlDefinition,
    expectedRevision,
  });
  return fromRawWorkflowSave(raw);
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  await invokeTauri("delete_workflow", { workflowId });
}

export async function getWorkflowRuns(
  workflowId: string,
  limit?: number,
): Promise<WorkflowRun[]> {
  const raw = await invokeTauri<RawWorkflowRunsResponse>("get_workflow_runs", {
    workflowId,
    limit: limit ?? null,
  });
  return raw.runs.map(fromRawWorkflowRun);
}

export async function getRunApprovals(
  workflowId: string,
  runId: string,
): Promise<WorkflowApproval[]> {
  const raw = await invokeTauri<RawWorkflowApprovalsResponse>(
    "get_run_approvals",
    {
      workflowId,
      runId,
    },
  );
  return raw.approvals.map(fromRawApproval);
}

export async function triggerWorkflow(
  workflowId: string,
): Promise<TriggerWorkflowResponse> {
  const raw = await invokeTauri<RawTriggerWorkflowResponse>(
    "trigger_workflow",
    { workflowId },
  );
  return fromRawTriggerResponse(raw);
}

export async function grantApproval(
  token: string,
  note?: string,
): Promise<ApprovalActionResponse> {
  const raw = await invokeTauri<RawApprovalActionResponse>("grant_approval", {
    token,
    note: note ?? null,
  });
  return fromRawApprovalResponse(raw);
}

export async function denyApproval(
  token: string,
  note?: string,
): Promise<ApprovalActionResponse> {
  const raw = await invokeTauri<RawApprovalActionResponse>("deny_approval", {
    token,
    note: note ?? null,
  });
  return fromRawApprovalResponse(raw);
}
