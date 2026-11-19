import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import type { CompanyHireHeadRecord } from "@/features/company-hiring/companyHireModels";

import type { PrebuiltAgent } from "../prebuiltAgents";
import type { PrebuiltHireChoice } from "../prebuiltHireStorage";

export type ModelChoice = {
  runtimeId: string;
  providerId: string;
  modelId: string;
  label: string;
};

export type ChoiceDraft = {
  runtimeId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
};

export type HireRecoveryState = "idle" | "checking" | "ready" | "failed";

export const EMPTY_CHOICE: ChoiceDraft = {
  runtimeId: "",
  providerId: "",
  modelId: "",
  effortLevel: "",
};

export function choiceKey(runtimeId: string, providerId: string) {
  return JSON.stringify([runtimeId, providerId]);
}

export function providerForRuntime(
  runtime: AcpRuntimeCatalogEntry,
  inheritedProvider: string,
) {
  return runtime.providerEnvVar ? inheritedProvider : "";
}

export function storedChoice(draft: ChoiceDraft): PrebuiltHireChoice {
  return {
    runtimeId: draft.runtimeId,
    providerId: draft.providerId,
    modelId: draft.modelId,
    ...(draft.effortLevel ? { effortLevel: draft.effortLevel } : {}),
  };
}

export function prebuiltChoiceFieldClassName({
  required,
  value,
}: {
  required: boolean;
  value: string;
}) {
  const needsChoice = required && !value;
  return [
    "h-[2.875rem] min-w-0 max-w-full rounded-xl border-2 px-3 text-sm font-medium",
    needsChoice
      ? "border-primary focus-visible:ring-primary/35"
      : "border-input",
  ].join(" ");
}

export function sameProposal(
  record: CompanyHireHeadRecord | null,
  hireId: string,
  agent: PrebuiltAgent,
) {
  return (
    record?.head.proposal.hireId === hireId &&
    record.head.proposal.displayName === agent.name &&
    record.head.proposal.title === (agent.job ?? agent.name)
  );
}

export function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The hire paused before it finished. Retry to continue from the saved step.";
}
