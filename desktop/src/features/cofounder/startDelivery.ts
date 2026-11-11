import type { JobView, PlaybookView } from "./playbookRecords";

/** Active playbooks with an approved current version, preferring Operations. */
export function eligibleStartDeliveryPlaybooks(
  playbooks: readonly PlaybookView[],
): PlaybookView[] {
  const eligible = playbooks.filter(
    (playbook) =>
      playbook.status === "active" &&
      playbook.version > 0 &&
      playbook.current !== null,
  );
  const operations = eligible.filter(
    (playbook) => playbook.current?.functionId === "operations",
  );
  return operations.length > 0 ? operations : eligible;
}

/** One-based steps that the owner performs or must approve. */
export function startDeliveryOwnerStepNumbers(
  playbook: Pick<PlaybookView, "current">,
): number[] {
  return (
    playbook.current?.steps.flatMap((step, index) =>
      step.owner.kind === "owner" || step.approvalPoint !== null
        ? [index + 1]
        : [],
    ) ?? []
  );
}

function normalizedClientName(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

/** Match running jobs the same way the relay links them to customer records. */
export function hasRunningJobForClient(
  jobs: readonly JobView[],
  clientName: string,
): boolean {
  const normalizedName = normalizedClientName(clientName);
  if (!normalizedName) return false;
  return jobs.some(
    (job) =>
      job.status === "running" &&
      normalizedClientName(job.title) === normalizedName,
  );
}
