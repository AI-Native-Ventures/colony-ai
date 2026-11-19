import type { HireProposal } from "@/features/company-asks/askRecords";
import {
  COMPANY_HIRE_SCHEMA_VERSION,
  type CompanyHireAction,
} from "@/features/company-hiring/companyHireModels";

import type { AccessActionInput } from "./accessRecords";
import type { FunctionId } from "./cofounderRecords";
import type { CompanyJobActionInput } from "./jobAssignments";
import { FUNCTION_DETAILS } from "./functions";
import { prebuiltBuiltInRole } from "./prebuiltAgents";
import type { PrebuiltAgent } from "./prebuiltAgents";
import type { PrebuiltHireChoice } from "./prebuiltHireStorage";

export function buildPrebuiltHireProposal({
  agent,
  choice,
  hireId,
  introductionChannelId,
  managerPubkey,
  personaId,
}: {
  agent: PrebuiltAgent;
  choice: PrebuiltHireChoice;
  hireId: string;
  introductionChannelId: string;
  managerPubkey?: string | null;
  personaId: string;
}): HireProposal {
  const role = prebuiltBuiltInRole(agent, choice.runtimeId).companyRole;
  return {
    hireId,
    rolePack: {
      personaId,
      title: agent.name,
      job: role.job,
      skills: [...role.skills],
      tools: role.tools.map((tool) => ({ ...tool })),
      workerMenu: [...role.workerMenu],
    },
    displayName: agent.name,
    // Team rows name the job, while the persona and hire dialog keep the
    // approved specialist name. For heads these are intentionally identical.
    title: role.job,
    ...(managerPubkey ? { managerPubkey } : {}),
    introductionChannelId,
    runtimeId: choice.runtimeId,
    ...(choice.providerId ? { providerId: choice.providerId } : {}),
    modelId: choice.modelId,
  };
}

/** Builds the create command that the relay accepts for a pre-built hire. */
export function buildPrebuiltHireCreateAction(
  proposal: HireProposal,
): CompanyHireAction {
  return {
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId: proposal.hireId,
    action: "create",
    proposal,
  };
}

/** Builds the slot-intent command before a pre-built hire is approved. */
export function buildPrebuiltSlotHireSetAction({
  functionId,
  hireId,
}: {
  functionId: FunctionId;
  hireId: string;
}): Extract<AccessActionInput, { op: "slot_hire_set" }> {
  return {
    op: "slot_hire_set",
    functionId,
    hireId,
    expectedHeadEventId: null,
  };
}

/** Builds the specialist job intent before the normal hire is approved. */
export function buildPrebuiltJobHireSetAction({
  functionId,
  hireId,
  jobId,
}: {
  functionId: FunctionId;
  hireId: string;
  jobId: string;
}): Extract<CompanyJobActionInput, { action: "hire_set" }> {
  return {
    action: "hire_set",
    functionId,
    jobId,
    hireId,
    expectedHeadEventId: null,
  };
}

/** Builds the owner approval command for a pre-built hire. */
export function buildPrebuiltHireApproveAction({
  expectedHeadEventId,
  hireId,
}: {
  expectedHeadEventId: string;
  hireId: string;
}): CompanyHireAction {
  return {
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId,
    action: "approve",
    expectedHeadEventId,
  };
}

/** Builds the durable employee attachment command for a pre-built hire. */
export function buildPrebuiltHireAttachEmployeeAction({
  employeePubkey,
  expectedHeadEventId,
  hireId,
}: {
  employeePubkey: string;
  expectedHeadEventId: string;
  hireId: string;
}): CompanyHireAction {
  return {
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId,
    action: "attach_employee",
    expectedHeadEventId,
    employeePubkey,
  };
}

/** Builds the completion command after the first owner-visible message exists. */
export function buildPrebuiltHireCompleteAction({
  employeePubkey,
  expectedHeadEventId,
  hireId,
  introductionEventId,
}: {
  employeePubkey: string;
  expectedHeadEventId: string;
  hireId: string;
  introductionEventId: string;
}): CompanyHireAction {
  return {
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId,
    action: "complete",
    expectedHeadEventId,
    employeePubkey,
    introductionEventId,
  };
}

/** Builds the cancellation command while an unapproved pre-built hire is recoverable. */
export function buildPrebuiltHireDenyAction({
  expectedHeadEventId,
  hireId,
  reason,
}: {
  expectedHeadEventId: string;
  hireId: string;
  reason: string;
}): CompanyHireAction {
  return {
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId,
    action: "deny",
    expectedHeadEventId,
    reason,
  };
}

function ownerFirstName(ownerName: string) {
  return ownerName.trim().split(/\s+/)[0] || "there";
}

/** Keeps prompt-only instructions separate from the owner's approved greeting. */
export function prebuiltFirstMessageText(
  agent: PrebuiltAgent,
  ownerName: string,
): string {
  return `Hi ${ownerFirstName(ownerName)}. ${agent.firstMessage}`;
}

/** Names the new employee in the proposal's introduction channel before hire completion. */
export function prebuiltIntroductionText(
  agent: PrebuiltAgent,
  ownerName: string,
): string {
  const partName = FUNCTION_DETAILS[agent.part].name;
  const assignment = agent.job
    ? `do ${agent.job} in ${partName}`
    : `lead ${partName}`;
  return `${agent.name} here. I have joined to ${assignment}. ${ownerFirstName(ownerName)}, I sent you a message to get started.`;
}

export function prebuiltHireIntroductionMarker(hireId: string): string {
  return `company-prebuilt-hire:${hireId}:introduction`;
}

export function prebuiltHireFirstMessageMarker(hireId: string): string {
  return `company-prebuilt-hire:${hireId}:first-message`;
}
