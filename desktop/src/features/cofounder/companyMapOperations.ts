import {
  jobOpenHumanSteps,
  jobStepsWaitingForApproval,
  jobsOfPlaybook,
} from "./playbookRecords";
import type {
  JobView,
  PlaybookContentView,
  PlaybookStepView,
  PlaybookView,
} from "./playbookRecords";

/** The nearest existing surface a data-backed Operations step can open. */
export type CompanyMapOperationsStepTarget =
  | "client-conversation"
  | "needs-you"
  | "operations"
  | "work";

/** One ordered step as it appears on the Operations second ring. */
export type CompanyMapOperationsStep = {
  owner: PlaybookStepView["owner"];
  stepId: string;
  target: CompanyMapOperationsStepTarget;
  title: string;
  waitingForOwner: boolean;
};

/** One real Operations playbook and its running-copy summary for the map. */
export type CompanyMapOperationsWorkflow = {
  isNew: boolean;
  playbookId: string;
  runningJobCount: number;
  steps: CompanyMapOperationsStep[];
  title: string;
  updatedAt: number;
};

function contentForPlaybook(
  playbook: PlaybookView,
): PlaybookContentView | null {
  return playbook.current ?? playbook.pending?.content ?? null;
}

function isOperationsPlaybook(playbook: PlaybookView): boolean {
  if (playbook.status !== "active" && playbook.status !== "proposed") {
    return false;
  }
  return contentForPlaybook(playbook)?.functionId === "operations";
}

function waitingStepIds(jobs: readonly JobView[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const job of jobs) {
    for (const step of jobStepsWaitingForApproval(job)) ids.add(step.stepId);
    for (const step of jobOpenHumanSteps(job)) ids.add(step.stepId);
  }
  return ids;
}

function hasWhatsApp(step: PlaybookStepView): boolean {
  return step.tools.some(
    (tool) => tool.trim().toLocaleLowerCase() === "whatsapp",
  );
}

function targetForStep(
  step: PlaybookStepView,
  waitingForOwner: boolean,
): CompanyMapOperationsStepTarget {
  if (waitingForOwner || step.approvalPoint !== null) return "needs-you";
  if (step.owner.kind === "worker") return "work";
  if (
    step.owner.kind === "function" &&
    step.owner.functionId === "customer_success" &&
    hasWhatsApp(step)
  ) {
    return "client-conversation";
  }
  return "operations";
}

/**
 * Selects only active or proposed Operations playbooks for the map. It keeps
 * their ordered source steps, exposes real running-copy counts, and never
 * invents a client channel or work-item link that the records do not carry.
 */
export function operationsMapWorkflows({
  jobs,
  playbooks,
}: {
  jobs: readonly JobView[];
  playbooks: readonly PlaybookView[];
}): CompanyMapOperationsWorkflow[] {
  return playbooks
    .filter(isOperationsPlaybook)
    .sort(
      (first, second) =>
        Number(second.status === "active") -
          Number(first.status === "active") ||
        second.updatedAt - first.updatedAt ||
        first.playbookId.localeCompare(second.playbookId),
    )
    .flatMap((playbook) => {
      const content = contentForPlaybook(playbook);
      if (!content) return [];
      const playbookJobs = jobsOfPlaybook(jobs, playbook.playbookId);
      const waiting = waitingStepIds(playbookJobs);
      return [
        {
          isNew: playbook.status === "proposed",
          playbookId: playbook.playbookId,
          runningJobCount: playbookJobs.filter(
            (job) => job.status === "running",
          ).length,
          steps: content.steps.map((step) => {
            const waitingForOwner = waiting.has(step.stepId);
            return {
              owner: step.owner,
              stepId: step.stepId,
              target: targetForStep(step, waitingForOwner),
              title: step.title,
              waitingForOwner,
            };
          }),
          title: content.title,
          updatedAt: playbook.updatedAt,
        },
      ];
    });
}
