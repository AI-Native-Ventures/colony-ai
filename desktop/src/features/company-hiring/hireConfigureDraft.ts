import type { HireProposal } from "@/features/company-asks/askRecords";
import type { RespondToMode } from "@/shared/api/types";
import {
  defaultHireLocalConfiguration,
  type HireLocalConfiguration,
} from "./hireDraft";

export type HireFormValues = {
  displayName: string;
  title: string;
  managerPubkey: string;
  introductionChannelId: string;
  channelIds: string[];
  respondTo: RespondToMode;
  weeklyAllowance: string;
  runtimeId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
};

export function formFromProposal(
  proposal: HireProposal,
  localConfiguration = defaultHireLocalConfiguration(proposal),
): HireFormValues {
  return {
    displayName: proposal.displayName,
    title: proposal.title,
    managerPubkey: proposal.managerPubkey ?? "",
    introductionChannelId: proposal.introductionChannelId,
    channelIds: localConfiguration.channelIds,
    respondTo: localConfiguration.respondTo,
    weeklyAllowance: proposal.weeklyAllowance ?? "",
    runtimeId: proposal.runtimeId,
    providerId: proposal.providerId ?? "",
    modelId: proposal.modelId ?? "",
    effortLevel: localConfiguration.effortLevel ?? "",
  };
}

export function buildHireProposal(
  hireId: string,
  rolePack: HireProposal["rolePack"],
  values: HireFormValues,
): HireProposal {
  return {
    hireId,
    rolePack: {
      personaId: rolePack.personaId,
      title: rolePack.title,
      job: rolePack.job,
      skills: [...rolePack.skills],
      tools: rolePack.tools.map((tool) => ({ ...tool })),
      workerMenu: [...rolePack.workerMenu],
    },
    displayName: values.displayName.trim(),
    title: values.title.trim(),
    ...(values.managerPubkey ? { managerPubkey: values.managerPubkey } : {}),
    introductionChannelId: values.introductionChannelId,
    runtimeId: values.runtimeId,
    ...(values.providerId ? { providerId: values.providerId } : {}),
    ...(values.modelId ? { modelId: values.modelId } : {}),
    ...(values.weeklyAllowance.trim()
      ? { weeklyAllowance: values.weeklyAllowance.trim() }
      : {}),
  };
}

export function localConfigurationFromForm(
  values: HireFormValues,
): HireLocalConfiguration {
  return {
    channelIds: [...values.channelIds],
    respondTo: values.respondTo,
    ...(values.effortLevel ? { effortLevel: values.effortLevel } : {}),
  };
}
