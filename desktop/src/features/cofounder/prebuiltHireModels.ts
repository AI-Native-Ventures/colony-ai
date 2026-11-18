import type { HireProposal } from "@/features/company-asks/askRecords";

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
    title: agent.name,
    ...(managerPubkey ? { managerPubkey } : {}),
    introductionChannelId,
    runtimeId: choice.runtimeId,
    ...(choice.providerId ? { providerId: choice.providerId } : {}),
    modelId: choice.modelId,
  };
}

/** Keep the persisted first move and the delivery text in the approved source. */
export function prebuiltFirstMoveText(
  agent: PrebuiltAgent,
  ownerName: string,
): string {
  const firstName = ownerName.trim().split(/\s+/)[0] || "there";
  return `Hi ${firstName}. ${agent.firstMove}`;
}

export function prebuiltHireMarker(hireId: string): string {
  return `company-prebuilt-hire:${hireId}:first-move`;
}
