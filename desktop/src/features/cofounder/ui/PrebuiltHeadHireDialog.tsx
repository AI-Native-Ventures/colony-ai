import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import {
  useAvailableAcpRuntimes,
  useCreateManagedAgentMutation,
  useCreatePersonaMutation,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { simpleModelLabel } from "@/features/agents/ui/simpleAgentAi";
import { useAgentDialogDefaults } from "@/features/agents/ui/useAgentDialogDefaults";
import {
  AgentDropdownSelect,
  type AgentDropdownOption,
} from "@/features/agents/ui/agentConfigControls";
import { attachManagedAgentToChannel } from "@/features/agents/channelAgents";
import {
  useChannelsQuery,
  channelsQueryKey,
  useOpenDmMutation,
} from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { companyTeamQueryKey } from "@/features/company-team/teamRelay";
import {
  companyAccessQueryKey,
  useCompanyAccessQuery,
  usePublishAccessAction,
} from "@/features/cofounder/accessHooks";
import { companyFunctionHeadsQueryKey } from "@/features/cofounder/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { sendManagedAgentChannelMessage } from "@/shared/api/tauriManagedAgentMessages";
import type { ManagedAgent } from "@/shared/api/types";
import { Dialog, DialogContent } from "@/shared/ui/dialog";

import {
  defaultHireLocalConfiguration,
  removeHireDraft,
  writeHireDraft,
} from "@/features/company-hiring/hireDraft";
import {
  fetchCurrentCompanyHireHead,
  useCompanyHireActionMutation,
  useCompanyHireHeadQuery,
} from "@/features/company-hiring/hireRelay";
import { parseCompanyHireAction } from "@/features/company-hiring/companyHireModels";
import type {
  CompanyHireAction,
  CompanyHireHeadRecord,
} from "@/features/company-hiring/companyHireModels";
import {
  defaultEffortFor,
  effortOptionsFor,
  WorkerModelProbe,
} from "@/features/company-hiring/ui/hireConfigureModels";

import type { FunctionId } from "../cofounderRecords";
import { FUNCTION_DETAILS } from "../functions";
import {
  materializePrebuiltAgent,
  prebuiltHeadForFunction,
} from "../prebuiltAgents";
import type { PrebuiltAgent } from "../prebuiltAgents";
import {
  buildPrebuiltHireApproveAction,
  buildPrebuiltHireAttachEmployeeAction,
  buildPrebuiltHireCompleteAction,
  buildPrebuiltHireCreateAction,
  buildPrebuiltHireDenyAction,
  buildPrebuiltHireProposal,
  buildPrebuiltJobHireSetAction,
  buildPrebuiltSlotHireSetAction,
  prebuiltFirstMessageText,
  prebuiltHireIntroductionMarker,
  prebuiltHireFirstMessageMarker,
  prebuiltIntroductionText,
} from "../prebuiltHireModels";
import { prebuiltAgentAvatarDataUrl } from "../prebuiltAgentAvatar";
import {
  clearPrebuiltHireProgress,
  readPrebuiltHireChoice,
  readPrebuiltHireProgress,
  writePrebuiltHireCompletion,
  writePrebuiltHireChoice,
  writePrebuiltHireProgress,
} from "../prebuiltHireStorage";
import {
  companyJobHeadsQueryKey,
  fetchCompanyJobHireIntent,
  useJobAssignmentCapability,
  usePublishCompanyJobAction,
} from "../jobAssignments";
import type {
  PrebuiltHireChoice,
  PrebuiltHireCompletion,
  PrebuiltHireProgress,
} from "../prebuiltHireStorage";
import { PrebuiltHireAgentSummary } from "./PrebuiltHireAgentSummary";
import {
  EMPTY_CHOICE,
  choiceKey,
  errorText,
  prebuiltChoiceFieldClassName,
  providerForRuntime,
  sameProposal,
  storedChoice,
  type ChoiceDraft,
  type HireRecoveryState,
  type ModelChoice,
} from "./prebuiltHireDialogHelpers";

export function PrebuiltHeadHireDialog({
  agent: agentOverride = null,
  defaultChannelId,
  functionId,
  jobId = null,
  managerName = null,
  managerPubkey,
  onCompleted,
  onOpenChange,
  open,
  ownerName,
}: {
  /** A specialist override reuses this S1 flow without a second hire path. */
  agent?: PrebuiltAgent | null;
  defaultChannelId?: string | null;
  functionId: FunctionId | null;
  jobId?: string | null;
  managerName?: string | null;
  managerPubkey?: string | null;
  onCompleted: (completion: PrebuiltHireCompletion | null) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  ownerName: string;
}) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const communityId = activeCommunity?.id ?? null;
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const personasQuery = usePersonasQuery({ enabled: open });
  const createPersona = useCreatePersonaMutation();
  const runtimesQuery = useAvailableAcpRuntimes({ enabled: open });
  const managedAgentsQuery = useManagedAgentsQuery({ enabled: open });
  const createManagedAgent = useCreateManagedAgentMutation();
  const channelsQuery = useChannelsQuery({ enabled: open });
  const openDm = useOpenDmMutation();
  const accessQuery = useCompanyAccessQuery(communityId);
  const publishAccessAction = usePublishAccessAction();
  const jobAssignmentCapability = useJobAssignmentCapability();
  const publishJobAction = usePublishCompanyJobAction();
  const hireAction = useCompanyHireActionMutation();
  const [choice, setChoice] = React.useState<ChoiceDraft>(EMPTY_CHOICE);
  const [channelId, setChannelId] = React.useState("");
  const [hasSavedChoice, setHasSavedChoice] = React.useState(false);
  const [progress, setProgress] = React.useState<PrebuiltHireProgress | null>(
    null,
  );
  const [recoveryState, setRecoveryState] =
    React.useState<HireRecoveryState>("idle");
  const [recoveryHireId, setRecoveryHireId] = React.useState<string | null>(
    null,
  );
  const [failure, setFailure] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const agent =
    agentOverride ?? (functionId ? prebuiltHeadForFunction(functionId) : null);
  const isSpecialistHire = Boolean(agentOverride?.job && jobId);
  const headQuery = useCompanyHireHeadQuery(progress?.hireId ?? recoveryHireId);
  const agentDefaults = useAgentDialogDefaults({
    open,
  });
  const inheritedProvider = agentDefaults.inheritedDefaults.provider.value;
  const inheritedEnvVars = agentDefaults.inheritedEnvVars;
  const runtimes = runtimesQuery.data ?? [];
  const validChannels = (channelsQuery.data ?? []).filter(
    (channel) =>
      channel.channelType === "stream" &&
      channel.archivedAt === null &&
      channel.isMember,
  );
  const [modelOptions, setModelOptions] = React.useState<
    Record<string, readonly { id: string; label: string }[]>
  >({});
  const receiveModelOptions = React.useCallback(
    (
      runtimeId: string,
      providerId: string,
      options: readonly { id: string; label: string }[] | null,
    ) => {
      const key = choiceKey(runtimeId, providerId);
      const next = (options ?? []).filter(
        (option) => option.id.trim().length > 0,
      );
      setModelOptions((current) => {
        const previous = current[key] ?? [];
        if (
          previous.length === next.length &&
          previous.every(
            (value, index) =>
              value.id === next[index]?.id &&
              value.label === next[index]?.label,
          )
        ) {
          return current;
        }
        return { ...current, [key]: next };
      });
    },
    [],
  );
  const modelChoices = React.useMemo<ModelChoice[]>(
    () =>
      runtimes.flatMap((runtime) => {
        const providerId = providerForRuntime(runtime, inheritedProvider);
        return (modelOptions[choiceKey(runtime.id, providerId)] ?? []).map(
          (option) => ({
            runtimeId: runtime.id,
            providerId,
            modelId: option.id,
            label: option.id
              ? simpleModelLabel(option.id, providerId)
              : option.label,
          }),
        );
      }),
    [inheritedProvider, modelOptions, runtimes],
  );
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.id === choice.runtimeId,
  );
  const selectedModel = modelChoices.find(
    (model) =>
      model.runtimeId === choice.runtimeId &&
      model.providerId === choice.providerId &&
      model.modelId === choice.modelId,
  );
  const effortOptions = effortOptionsFor(
    selectedRuntime,
    choice.providerId,
    choice.modelId,
  );
  const effortDefault = defaultEffortFor(
    selectedRuntime,
    choice.providerId,
    choice.modelId,
  );
  const requiresEffort = effortOptions.length > 0;
  const modelRequired = Boolean(selectedRuntime);
  const effortRequired = Boolean(selectedModel && requiresEffort);
  const isOwner = membershipQuery.data?.role === "owner";
  const selectionReady = Boolean(
    selectedRuntime &&
      selectedModel &&
      recoveryState === "ready" &&
      (!requiresEffort || effortOptions.includes(choice.effortLevel)) &&
      validChannels.some((channel) => channel.id === channelId),
  );
  const runtimeOptions = React.useMemo<AgentDropdownOption[]>(
    () =>
      runtimes.map((runtime) => ({
        label: runtime.label,
        value: runtime.id,
      })),
    [runtimes],
  );
  const selectedModelOptions = React.useMemo<AgentDropdownOption[]>(
    () =>
      modelChoices
        .filter(
          (model) =>
            model.runtimeId === choice.runtimeId &&
            model.providerId === choice.providerId,
        )
        .map((model) => ({ label: model.label, value: model.modelId })),
    [choice.providerId, choice.runtimeId, modelChoices],
  );
  const effortChoiceOptions = React.useMemo<AgentDropdownOption[]>(
    () => effortOptions.map((effort) => ({ label: effort, value: effort })),
    [effortOptions],
  );

  React.useEffect(() => {
    if (!open || !communityId || !functionId) return;
    const savedProgress = readPrebuiltHireProgress(
      communityId,
      functionId,
      jobId,
    );
    const savedChoice = readPrebuiltHireChoice(communityId) ?? null;
    const preferredChoice = savedProgress?.choice ?? savedChoice;
    setProgress(savedProgress);
    setRecoveryHireId(null);
    setRecoveryState(savedProgress ? "ready" : "checking");
    setHasSavedChoice(savedChoice !== null);
    setChoice(
      preferredChoice
        ? {
            runtimeId: preferredChoice.runtimeId,
            providerId: preferredChoice.providerId,
            modelId: preferredChoice.modelId,
            effortLevel: preferredChoice.effortLevel ?? "",
          }
        : EMPTY_CHOICE,
    );
    setChannelId(
      savedProgress?.introductionChannelId ?? defaultChannelId ?? "",
    );
    setFailure(null);
  }, [communityId, defaultChannelId, functionId, jobId, open]);

  React.useEffect(() => {
    if (
      !open ||
      !communityId ||
      !functionId ||
      progress ||
      recoveryState !== "checking" ||
      recoveryHireId !== null
    ) {
      return;
    }
    if (accessQuery.isPending) return;
    if (accessQuery.isError) {
      setRecoveryState("failed");
      setFailure(
        "Colony could not check for an unfinished hire, so it will not start another one. Close this and try again.",
      );
      return;
    }
    const slotHire = accessQuery.data?.slotHires.find(
      (entry) => entry.functionId === functionId,
    );
    if (!slotHire) {
      setRecoveryState("ready");
      return;
    }
    setRecoveryHireId(slotHire.hireId);
  }, [
    accessQuery.data?.slotHires,
    accessQuery.isError,
    accessQuery.isPending,
    communityId,
    functionId,
    open,
    progress,
    recoveryHireId,
    recoveryState,
  ]);

  React.useEffect(() => {
    if (
      !open ||
      !communityId ||
      !functionId ||
      !agent ||
      progress ||
      recoveryState !== "checking" ||
      !recoveryHireId
    ) {
      return;
    }
    if (headQuery.isPending) return;
    if (headQuery.isError || !headQuery.data) {
      setRecoveryState("failed");
      setFailure(
        "Colony found an unfinished hire but could not read it, so it will not start another one. Close this and try again.",
      );
      return;
    }
    const recoveredHead = headQuery.data;
    if (
      !sameProposal(recoveredHead, recoveryHireId, agent) ||
      recoveredHead.head.status === "denied" ||
      recoveredHead.head.status === "hired"
    ) {
      setRecoveryHireId(null);
      setRecoveryState("ready");
      return;
    }
    const proposal = recoveredHead.head.proposal;
    if (!proposal.modelId) {
      setRecoveryState("failed");
      setFailure(
        "This unfinished hire has no model selected. Choose a model before hiring. Colony will not create another agent without one.",
      );
      return;
    }
    const recoveredChoice: PrebuiltHireChoice = {
      runtimeId: proposal.runtimeId,
      providerId: proposal.providerId ?? "",
      modelId: proposal.modelId,
    };
    const recoveredProgress: PrebuiltHireProgress = {
      hireId: proposal.hireId,
      functionId,
      ...(jobId ? { jobId } : {}),
      agentId: agent.id,
      introductionChannelId: proposal.introductionChannelId,
      choice: recoveredChoice,
      ...(recoveredHead.head.employeePubkey
        ? { employeePubkey: recoveredHead.head.employeePubkey }
        : {}),
    };
    writePrebuiltHireChoice(communityId, recoveredChoice);
    writePrebuiltHireProgress(communityId, recoveredProgress);
    setChoice({ ...recoveredChoice, effortLevel: "" });
    setChannelId(proposal.introductionChannelId);
    setHasSavedChoice(true);
    setProgress(recoveredProgress);
    setRecoveryState("ready");
  }, [
    agent,
    communityId,
    functionId,
    jobId,
    headQuery.data,
    headQuery.isError,
    headQuery.isPending,
    open,
    progress,
    recoveryHireId,
    recoveryState,
  ]);

  React.useEffect(() => {
    if (!open) return;
    const preferredIds = [progress?.introductionChannelId, defaultChannelId];
    const selected = preferredIds.find((id) =>
      validChannels.some((channel) => channel.id === id),
    );
    const nextChannelId = selected ?? validChannels[0]?.id ?? "";
    setChannelId((current) =>
      current === nextChannelId ? current : nextChannelId,
    );
  }, [defaultChannelId, open, progress?.introductionChannelId, validChannels]);

  React.useEffect(() => {
    if (!selectedRuntime || !selectedModel || !requiresEffort) return;
    if (effortOptions.includes(choice.effortLevel)) return;
    const next =
      (effortDefault && effortOptions.includes(effortDefault)
        ? effortDefault
        : effortOptions[0]) ?? "";
    setChoice((current) =>
      current.effortLevel === next
        ? current
        : { ...current, effortLevel: next },
    );
  }, [
    choice.effortLevel,
    effortDefault,
    effortOptions,
    requiresEffort,
    selectedModel,
    selectedRuntime,
  ]);

  const publishAndConfirm = React.useCallback(
    async (
      input: CompanyHireAction,
      matches: (record: CompanyHireHeadRecord | null) => boolean,
    ) => {
      const action = parseCompanyHireAction(input);
      if (!action)
        throw new Error("The prebuilt hire does not match the relay schema.");
      try {
        await hireAction.mutateAsync(action as CompanyHireAction);
      } catch (error) {
        const observed = await fetchCurrentCompanyHireHead(action.hireId);
        if (observed && matches(observed)) return observed;
        throw error;
      }
      const observed = await fetchCurrentCompanyHireHead(action.hireId);
      if (!observed || !matches(observed)) {
        throw new Error("The relay did not confirm this hire step. Try again.");
      }
      return observed;
    },
    [hireAction],
  );

  const ensureSlotIntent = React.useCallback(
    async (hireId: string, selectedFunctionId: FunctionId) => {
      const access = (await accessQuery.refetch()).data;
      const current = access?.slotHires.find(
        (entry) => entry.hireId.toLowerCase() === hireId.toLowerCase(),
      );
      if (current?.functionId === selectedFunctionId) return;
      if (current) {
        throw new Error("This saved hire belongs to a different company part.");
      }
      try {
        await publishAccessAction.mutateAsync(
          buildPrebuiltSlotHireSetAction({
            hireId,
            functionId: selectedFunctionId,
          }),
        );
      } catch (error) {
        const recovered = (await accessQuery.refetch()).data?.slotHires.find(
          (entry) => entry.hireId.toLowerCase() === hireId.toLowerCase(),
        );
        if (recovered?.functionId === selectedFunctionId) return;
        throw error;
      }
      const confirmed = (await accessQuery.refetch()).data?.slotHires.find(
        (entry) => entry.hireId.toLowerCase() === hireId.toLowerCase(),
      );
      if (confirmed?.functionId !== selectedFunctionId) {
        throw new Error(
          "The relay did not reserve this company part. Try again.",
        );
      }
    },
    [accessQuery, publishAccessAction],
  );

  const ensureJobIntent = React.useCallback(
    async (
      hireId: string,
      selectedFunctionId: FunctionId,
      selectedJobId: string,
    ) => {
      const current = await fetchCompanyJobHireIntent(hireId);
      if (
        current?.functionId === selectedFunctionId &&
        current.jobId === selectedJobId
      ) {
        return;
      }
      if (current) {
        throw new Error("This saved hire belongs to a different company job.");
      }
      await publishJobAction.mutateAsync(
        buildPrebuiltJobHireSetAction({
          functionId: selectedFunctionId,
          hireId,
          jobId: selectedJobId,
        }),
      );
      const confirmed = await fetchCompanyJobHireIntent(hireId);
      if (
        confirmed?.functionId !== selectedFunctionId ||
        confirmed.jobId !== selectedJobId
      ) {
        throw new Error("The relay did not reserve this job. Try again.");
      }
    },
    [publishJobAction],
  );

  const finishHire = async () => {
    if (
      submittingRef.current ||
      !agent ||
      !functionId ||
      !communityId ||
      !relayUrl ||
      !identityQuery.data?.pubkey ||
      !isOwner ||
      (isSpecialistHire && !jobAssignmentCapability.data)
    ) {
      return;
    }
    if (selectedRuntime && !selectedModel) {
      setFailure(
        "Choose a model before hiring. Colony will not create an agent without one.",
      );
      return;
    }
    if (!selectionReady) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const selectedChoice = storedChoice(choice);
      const hireId = progress?.hireId ?? globalThis.crypto.randomUUID();
      let flow: PrebuiltHireProgress = {
        hireId,
        functionId,
        ...(jobId ? { jobId } : {}),
        agentId: agent.id,
        introductionChannelId: channelId,
        choice: selectedChoice,
        ...(progress?.employeePubkey
          ? { employeePubkey: progress.employeePubkey }
          : {}),
        ...(progress?.introductionEventId
          ? { introductionEventId: progress.introductionEventId }
          : {}),
        ...(progress?.directChannelId
          ? { directChannelId: progress.directChannelId }
          : {}),
        ...(progress?.firstMessageEventId
          ? { firstMessageEventId: progress.firstMessageEventId }
          : {}),
      };
      writePrebuiltHireChoice(communityId, selectedChoice);
      writePrebuiltHireProgress(communityId, flow);
      setProgress(flow);

      const personaId = await materializePrebuiltAgent(
        agent,
        selectedChoice.runtimeId,
        {
          scope: communityId,
          listPersonas: async () => (await personasQuery.refetch()).data ?? [],
          createPersona: createPersona.mutateAsync,
        },
      );
      const proposal = buildPrebuiltHireProposal({
        agent,
        choice: selectedChoice,
        hireId,
        introductionChannelId: channelId,
        managerPubkey,
        personaId,
      });
      const localConfiguration = {
        ...defaultHireLocalConfiguration(proposal),
        ...(selectedChoice.effortLevel
          ? { effortLevel: selectedChoice.effortLevel }
          : {}),
      };
      writeHireDraft(relayUrl, {
        proposal,
        localConfiguration,
        ...(flow.employeePubkey ? { employeePubkey: flow.employeePubkey } : {}),
      });

      let current = await fetchCurrentCompanyHireHead(hireId);
      if (!current) {
        current = await publishAndConfirm(
          buildPrebuiltHireCreateAction(proposal),
          (record) => sameProposal(record, hireId, agent),
        );
      }
      if (!sameProposal(current, hireId, agent)) {
        throw new Error(
          "A different hire already uses this saved recovery record.",
        );
      }
      if (current.head.status === "denied") {
        throw new Error(
          "This hire was cancelled. Start a new hire from the company map.",
        );
      }
      if (
        current.head.status === "proposed" ||
        current.head.status === "awaiting_founder"
      ) {
        if (isSpecialistHire && jobId) {
          await ensureJobIntent(hireId, functionId, jobId);
        } else {
          await ensureSlotIntent(hireId, functionId);
        }
        current = await publishAndConfirm(
          buildPrebuiltHireApproveAction({
            hireId,
            expectedHeadEventId: current.event.id,
          }),
          (record) =>
            record?.head.status === "approved" ||
            record?.head.status === "hired",
        );
      }
      if (current.head.status === "approved") {
        let employeePubkey =
          current.head.employeePubkey ?? flow.employeePubkey ?? null;
        let managedAgent: ManagedAgent | undefined;
        if (employeePubkey) {
          managedAgent = managedAgentsQuery.data?.find(
            (candidate) =>
              candidate.pubkey.toLowerCase() === employeePubkey?.toLowerCase(),
          );
          if (!managedAgent) {
            managedAgent = (await managedAgentsQuery.refetch()).data?.find(
              (candidate) =>
                candidate.pubkey.toLowerCase() ===
                employeePubkey?.toLowerCase(),
            );
          }
        }
        if (!employeePubkey) {
          const runtime = runtimes.find(
            (candidate) => candidate.id === selectedChoice.runtimeId,
          );
          if (!runtime?.command) {
            throw new Error(
              "That harness is no longer ready. Pick another AI and retry.",
            );
          }
          const created = await createManagedAgent.mutateAsync({
            name: agent.name,
            personaId,
            acpCommand: "buzz-acp",
            agentCommand: runtime.command,
            harnessOverride: true,
            agentArgs: [],
            mcpCommand: runtime.mcpCommand ?? "",
            model: selectedChoice.modelId,
            modelOverride: selectedChoice.modelId,
            provider: selectedChoice.providerId || undefined,
            effortLevel: selectedChoice.effortLevel,
            avatarUrl: prebuiltAgentAvatarDataUrl(agent),
            respondTo: "owner-only",
            spawnAfterCreate: false,
            startOnAppLaunch: false,
            backend: { type: "local" },
          });
          managedAgent = created.agent;
          employeePubkey = created.agent.pubkey;
          flow = { ...flow, employeePubkey };
          writePrebuiltHireProgress(communityId, flow);
          setProgress(flow);
          writeHireDraft(relayUrl, {
            proposal,
            localConfiguration,
            employeePubkey,
          });
        }
        if (!managedAgent || !employeePubkey) {
          throw new Error(
            "The employee record could not be recovered. Retry this hire.",
          );
        }
        current = await fetchCurrentCompanyHireHead(hireId);
        if (current?.head.status !== "approved") {
          throw new Error(
            "The hire changed before the employee could join. Retry it.",
          );
        }
        if (!current.head.employeePubkey) {
          current = await publishAndConfirm(
            buildPrebuiltHireAttachEmployeeAction({
              hireId,
              expectedHeadEventId: current.event.id,
              employeePubkey,
            }),
            (record) =>
              record?.head.employeePubkey?.toLowerCase() ===
              employeePubkey?.toLowerCase(),
          );
        }
        const introductionChannelId =
          current.head.proposal.introductionChannelId;
        if (flow.introductionChannelId !== introductionChannelId) {
          flow = { ...flow, introductionChannelId };
          writePrebuiltHireProgress(communityId, flow);
          setProgress(flow);
        }
        await attachManagedAgentToChannel(introductionChannelId, {
          agent: managedAgent,
          role: "bot",
          ensureRunning: true,
        });
        if (!flow.introductionEventId) {
          const introduction = await sendManagedAgentChannelMessage({
            agentPubkey: employeePubkey,
            channelId: introductionChannelId,
            content: prebuiltIntroductionText(agent, ownerName),
            marker: prebuiltHireIntroductionMarker(hireId),
            markerScope: "agent",
          });
          flow = { ...flow, introductionEventId: introduction.eventId };
          writePrebuiltHireProgress(communityId, flow);
          setProgress(flow);
        }
        current = await fetchCurrentCompanyHireHead(hireId);
        if (!current)
          throw new Error("The relay could not find the saved hire. Retry it.");
        if (current.head.status !== "hired") {
          const introductionEventId = flow.introductionEventId;
          if (!introductionEventId) {
            throw new Error(
              "The channel introduction was not saved. Retry this hire.",
            );
          }
          current = await publishAndConfirm(
            buildPrebuiltHireCompleteAction({
              hireId,
              expectedHeadEventId: current.event.id,
              employeePubkey,
              introductionEventId,
            }),
            (record) =>
              record?.head.status === "hired" &&
              record.head.employeePubkey?.toLowerCase() ===
                employeePubkey?.toLowerCase() &&
              record.head.introductionEventId === introductionEventId,
          );
        }
      }
      current = await fetchCurrentCompanyHireHead(hireId);
      if (current?.head.status !== "hired") {
        throw new Error("The relay did not complete this hire. Retry it.");
      }
      const employeePubkey = current.head.employeePubkey ?? flow.employeePubkey;
      if (!employeePubkey) {
        throw new Error("The completed hire has no employee. Retry it.");
      }
      if (flow.employeePubkey !== employeePubkey) {
        flow = { ...flow, employeePubkey };
        writePrebuiltHireProgress(communityId, flow);
        setProgress(flow);
      }
      if (!flow.directChannelId) {
        const directChat = await openDm.mutateAsync({
          pubkeys: [employeePubkey],
          expectedRelayUrl: relayUrl,
          expectedSignerPubkey: identityQuery.data.pubkey,
        });
        flow = { ...flow, directChannelId: directChat.id };
        writePrebuiltHireProgress(communityId, flow);
        setProgress(flow);
      }
      const directChannelId = flow.directChannelId;
      if (!directChannelId) {
        throw new Error("The direct chat could not be recovered. Retry it.");
      }
      if (!flow.firstMessageEventId) {
        const firstMessage = await sendManagedAgentChannelMessage({
          agentPubkey: employeePubkey,
          channelId: directChannelId,
          content: prebuiltFirstMessageText(agent, ownerName),
          marker: prebuiltHireFirstMessageMarker(hireId),
          markerScope: "agent",
        });
        flow = { ...flow, firstMessageEventId: firstMessage.eventId };
        writePrebuiltHireProgress(communityId, flow);
        setProgress(flow);
      }
      const completedEventId = flow.firstMessageEventId;
      const completion =
        flow.employeePubkey && flow.directChannelId && completedEventId
          ? {
              hireId: flow.hireId,
              functionId: flow.functionId,
              ...(flow.jobId ? { jobId: flow.jobId } : {}),
              agentId: flow.agentId,
              employeePubkey: flow.employeePubkey,
              directChannelId: flow.directChannelId,
              firstMessageEventId: completedEventId,
              firstMessage: prebuiltFirstMessageText(agent, ownerName),
            }
          : null;
      if (completion) writePrebuiltHireCompletion(communityId, completion);
      clearPrebuiltHireProgress(communityId, functionId, jobId);
      removeHireDraft(relayUrl, hireId);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: companyFunctionHeadsQueryKey(communityId, relayUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: companyTeamQueryKey(relayUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: companyAccessQueryKey(communityId, relayUrl),
        }),
        queryClient.invalidateQueries({
          queryKey: companyJobHeadsQueryKey(communityId, relayUrl),
        }),
        queryClient.invalidateQueries({ queryKey: channelsQueryKey }),
      ]);
      onCompleted(completion);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const undoUnapprovedHire = async () => {
    if (!progress || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const current = await fetchCurrentCompanyHireHead(progress.hireId);
      if (!current || current.head.status === "denied") {
        clearPrebuiltHireProgress(
          communityId,
          progress.functionId,
          progress.jobId,
        );
        removeHireDraft(relayUrl, progress.hireId);
        setProgress(null);
        onOpenChange(false);
        return;
      }
      if (current.head.status !== "proposed") {
        throw new Error(
          "This hire is already approved. Finish it instead of cancelling it.",
        );
      }
      await publishAndConfirm(
        buildPrebuiltHireDenyAction({
          hireId: progress.hireId,
          expectedHeadEventId: current.event.id,
          reason: "Cancelled from the company map",
        }),
        (record) => record?.head.status === "denied",
      );
      clearPrebuiltHireProgress(
        communityId,
        progress.functionId,
        progress.jobId,
      );
      removeHireDraft(relayUrl, progress.hireId);
      setProgress(null);
      onOpenChange(false);
    } catch (error) {
      setFailure(errorText(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const close = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) onOpenChange(false);
  };

  if (!open || !agent || !functionId) return null;
  const managerCopy = isSpecialistHire
    ? managerName
      ? `${managerName} keeps the rest of ${FUNCTION_DETAILS[functionId].name} and leads this specialist.`
      : `Scout leads this specialist until you hire a Head of ${FUNCTION_DETAILS[functionId].name}.`
    : `Scout hands ${FUNCTION_DETAILS[functionId].name} over the moment you hire.`;

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogContent
        aria-describedby="prebuilt-hire-description"
        className="max-w-[37.5rem]"
        data-testid="prebuilt-head-hire-dialog"
      >
        <PrebuiltHireAgentSummary
          agent={agent}
          functionId={functionId}
          managerCopy={managerCopy}
        />

        {runtimes.map((runtime) => (
          <WorkerModelProbe
            envVars={inheritedEnvVars}
            key={choiceKey(
              runtime.id,
              providerForRuntime(runtime, inheritedProvider),
            )}
            onOptions={receiveModelOptions}
            providerId={providerForRuntime(runtime, inheritedProvider)}
            runtime={runtime}
          />
        ))}

        <div className="grid gap-4 sm:grid-cols-3">
          <label
            className="grid min-w-0 gap-1.5 text-sm font-bold"
            htmlFor="prebuilt-hire-harness"
          >
            Harness
            <AgentDropdownSelect
              className={prebuiltChoiceFieldClassName({
                required: runtimes.length > 0,
                value: choice.runtimeId,
              })}
              disabled={submitting || runtimes.length === 0}
              id="prebuilt-hire-harness"
              onValueChange={(runtimeId) => {
                const runtime = runtimes.find(
                  (candidate) => candidate.id === runtimeId,
                );
                setChoice({
                  ...EMPTY_CHOICE,
                  runtimeId: runtime?.id ?? "",
                  providerId: runtime
                    ? providerForRuntime(runtime, inheritedProvider)
                    : "",
                });
              }}
              options={runtimeOptions}
              placeholder="Choose a harness"
              placeholderValue=""
              testId="prebuilt-hire-harness"
              value={choice.runtimeId}
            />
          </label>
          <label
            className="grid min-w-0 gap-1.5 text-sm font-bold"
            htmlFor="prebuilt-hire-model"
          >
            Model
            <AgentDropdownSelect
              className={prebuiltChoiceFieldClassName({
                required: modelRequired,
                value: choice.modelId,
              })}
              disabled={submitting || !selectedRuntime}
              id="prebuilt-hire-model"
              onValueChange={(modelId) =>
                setChoice((current) => ({
                  ...current,
                  modelId,
                  effortLevel: "",
                }))
              }
              options={selectedModelOptions}
              placeholder="Choose a model"
              placeholderValue=""
              selectedLabel={
                selectedModel ? (
                  <span className="block truncate" title={selectedModel.label}>
                    {selectedModel.label}
                  </span>
                ) : undefined
              }
              testId="prebuilt-hire-model"
              value={choice.modelId}
            />
          </label>
          <label
            className="grid min-w-0 gap-1.5 text-sm font-bold"
            htmlFor="prebuilt-hire-effort"
          >
            Effort
            <AgentDropdownSelect
              className={prebuiltChoiceFieldClassName({
                required: effortRequired,
                value: choice.effortLevel,
              })}
              disabled={submitting || !selectedModel || !requiresEffort}
              id="prebuilt-hire-effort"
              onValueChange={(effortLevel) =>
                setChoice((current) => ({ ...current, effortLevel }))
              }
              options={effortChoiceOptions}
              placeholder={
                requiresEffort ? "Choose effort" : "Set by this harness"
              }
              placeholderValue=""
              testId="prebuilt-hire-effort"
              value={choice.effortLevel}
            />
          </label>
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="prebuilt-hire-choice-helper"
        >
          {hasSavedChoice
            ? "Same as your last hire. Change any of them."
            : "This is your first hire, so pick all three. Next time Colony shows what you picked here."}
        </p>
        {runtimesQuery.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Checking which AI is ready on this Mac.
          </p>
        ) : null}
        {recoveryState === "checking" ? (
          <p className="text-sm text-muted-foreground" role="status">
            Checking for an unfinished hire before starting a new one.
          </p>
        ) : null}
        {!runtimesQuery.isPending && runtimes.length === 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            No AI is ready on this Mac.{" "}
            <Link className="underline" to="/settings">
              Open Settings
            </Link>{" "}
            to connect a harness.
          </p>
        ) : null}
        {selectedRuntime &&
        !modelChoices.some(
          (model) => model.runtimeId === selectedRuntime.id,
        ) ? (
          <p className="text-sm text-muted-foreground" role="status">
            This harness has not reported a model yet. Check its sign-in and
            model settings, then choose again.
          </p>
        ) : null}

        {validChannels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There is no company chat to start this hire in. Join one first.
          </p>
        ) : null}

        {failure ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm"
            role="alert"
          >
            <p>{failure}</p>
            {progress && headQuery.data?.head.status === "proposed" ? (
              <button
                className="mt-2 font-bold underline"
                disabled={submitting}
                onClick={() => void undoUnapprovedHire()}
                type="button"
              >
                Undo unapproved hire
              </button>
            ) : null}
          </div>
        ) : null}
        {!isOwner ? (
          <p className="text-sm text-muted-foreground">
            Only the company owner can finish this hire.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {!selectionReady ? (
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              {recoveryState === "checking"
                ? "Checking for an unfinished hire."
                : selectedRuntime && !selectedModel
                  ? "Choose a model before hiring. Colony will not create an agent without one."
                  : "Pick all three to hire."}
            </p>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <button
              className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted disabled:opacity-50"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-xl bg-[var(--colony-ink-button)] px-4 py-2 text-sm font-bold text-[hsl(var(--colony-canvas))] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="prebuilt-hire-finish"
              disabled={
                !selectionReady ||
                !isOwner ||
                submitting ||
                (isSpecialistHire && !jobAssignmentCapability.data)
              }
              onClick={() => void finishHire()}
              type="button"
            >
              {submitting ? `Hiring ${agent.name}` : `Hire ${agent.name}`}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
