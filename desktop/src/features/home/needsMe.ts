import {
  getRunApprovals,
  getChannelsWorkflows,
  getWorkflowRunsPage,
} from "@/shared/api/tauriWorkflows";
import type {
  Workflow,
  WorkflowApproval,
  WorkflowRun,
} from "@/shared/api/types";
import { MAX_EXPLICIT_CHANNEL_VALUES } from "@/shared/api/relayClientShared";
import { normalizePubkey } from "@/shared/lib/pubkey";

export type PendingWorkflowApproval = {
  approval: WorkflowApproval;
  channelId: string;
  run: WorkflowRun;
  workflow: Workflow;
};

const MAX_RUN_PAGES_PER_WORKFLOW = 10;

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<U>,
): Promise<U[]> {
  const result = new Array<U>(values.length);
  let nextIndex = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (!failed && nextIndex < values.length) {
        const index = nextIndex++;
        try {
          result[index] = await task(values[index]);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  return result;
}

function chunks(values: readonly string[], size: number) {
  const result: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchWorkflows(channelIds: readonly string[]) {
  const channelChunks = chunks(
    [...new Set(channelIds)].sort(),
    MAX_EXPLICIT_CHANNEL_VALUES,
  );
  const groups = await mapWithConcurrency(channelChunks, 3, (ids) =>
    getChannelsWorkflows(ids),
  );
  const byId = new Map<string, Workflow>();
  for (const workflow of groups.flat()) byId.set(workflow.id, workflow);
  return [...byId.values()].filter(
    (workflow) => workflow.status === "active" && workflow.channelId !== null,
  );
}

async function fetchAllRuns(workflowId: string) {
  const runs: WorkflowRun[] = [];
  let cursor: Awaited<ReturnType<typeof getWorkflowRunsPage>>["next"] = null;
  for (let page = 0; page < MAX_RUN_PAGES_PER_WORKFLOW; page += 1) {
    const result = await getWorkflowRunsPage(workflowId, 100, cursor);
    runs.push(...result.runs);
    if (!result.next) return runs;
    cursor = result.next;
  }
  throw new Error(
    "Workflow approval history is larger than the supported limit.",
  );
}

function approvalIsAddressedTo(approval: WorkflowApproval, pubkey: string) {
  const target = normalizePubkey(pubkey);
  const approverSpec = normalizePubkey(approval.approverSpec.trim());
  return (
    approverSpec === "" ||
    approverSpec === "any" ||
    approverSpec === target ||
    (approval.approverPubkey !== null &&
      normalizePubkey(approval.approverPubkey) === target)
  );
}

export async function fetchPendingWorkflowApprovals(
  channelIds: readonly string[],
  currentPubkey: string,
): Promise<PendingWorkflowApproval[]> {
  if (channelIds.length === 0) return [];
  const allowedChannels = new Set(channelIds);
  const workflows = (await fetchWorkflows(channelIds)).filter(
    (workflow) => workflow.channelId && allowedChannels.has(workflow.channelId),
  );
  const workflowRuns = await mapWithConcurrency(
    workflows,
    4,
    async (workflow) =>
      (await fetchAllRuns(workflow.id))
        .filter((run) => run.status === "waiting_approval")
        .map((run) => ({ workflow, run })),
  );
  const waitingRuns = workflowRuns.flat();
  const runApprovals = await mapWithConcurrency(
    waitingRuns,
    4,
    async ({ workflow, run }) => ({
      workflow,
      run,
      approvals: await getRunApprovals(workflow.id, run.id),
    }),
  );
  const now = Date.now();
  return runApprovals.flatMap(({ workflow, run, approvals }) => {
    const channelId = workflow.channelId;
    if (!channelId) return [];
    return approvals
      .filter((approval) => {
        const expiry = Date.parse(approval.expiresAt);
        return (
          approval.status === "pending" &&
          Number.isFinite(expiry) &&
          expiry > now &&
          approvalIsAddressedTo(approval, currentPubkey)
        );
      })
      .map((approval) => ({
        approval,
        channelId,
        run,
        workflow,
      }));
  });
}
