import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useAvailableAcpRuntimes,
  useCreateManagedAgentMutation,
  useCreatePersonaMutation,
  useManagedAgentsQuery,
  usePersonasQuery,
} from "@/features/agents/hooks";
import type { AgentDropdownOption } from "@/features/agents/ui/agentConfigControls";
import { simpleModelLabel } from "@/features/agents/ui/simpleAgentAi";
import { useAgentDialogDefaults } from "@/features/agents/ui/useAgentDialogDefaults";
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
import type { AcpRuntimeCatalogEntry, ManagedAgent } from "@/shared/api/types";

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
} from "@/features/company-hiring/ui/hireConfigureModels";

import type { FunctionId } from "../cofounderRecords";
import {
  materializePrebuiltAgent,
  prebuiltHeadForFunction,
} from "../prebuiltAgents";
import {
  findRecoverablePrebuiltHire,
  isPrebuiltHeadHireForFunction,
} from "../prebuiltHireRecovery";
import {
  claimPrebuiltHireRun,
  ownsPrebuiltHireRun,
  releasePrebuiltHireRun,
} from "../prebuiltHireRunFence";
import {
  buildPrebuiltHireApproveAction,
  buildPrebuiltHireAttachEmployeeAction,
  buildPrebuiltHireCompleteAction,
  buildPrebuiltHireCreateAction,
  buildPrebuiltHireDenyAction,
  buildPrebuiltHireProposal,
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
import type {
  PrebuiltHireChoice,
  PrebuiltHireCompletion,
  PrebuiltHireProgress,
} from "../prebuiltHireStorage";
import { PrebuiltHeadHireDialogForm } from "./PrebuiltHeadHireDialogForm";

type ModelChoice = {
  runtimeId: string;
  providerId: string;
  modelId: string;
  label: string;
};

type ChoiceDraft = {
  runtimeId: string;
  providerId: string;
  modelId: string;
  effortLevel: string;
};

type HireRecoveryState =
  | "idle"
  | "checking"
  | "ready"
  | "employee_removed"
  | "failed";

const EMPTY_CHOICE: ChoiceDraft = {
  runtimeId: "",
  providerId: "",
  modelId: "",
  effortLevel: "",
};

function choiceKey(runtimeId: string, providerId: string) {
  return JSON.stringify([runtimeId, providerId]);
}

function providerForRuntime(
  runtime: AcpRuntimeCatalogEntry,
  inheritedProvider: string,
) {
  return runtime.providerEnvVar ? inheritedProvider : "";
}

function storedChoice(draft: ChoiceDraft): PrebuiltHireChoice {
  return {
    runtimeId: draft.runtimeId,
    providerId: draft.providerId,
    modelId: draft.modelId,
    ...(draft.effortLevel ? { effortLevel: draft.effortLevel } : {}),
  };
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The hire paused before it finished. Retry to continue from the saved step.";
}

export function PrebuiltHeadHireDialog({
  autoFinishHireId = null,
  defaultChannelId,
  functionId,
  managerPubkey,
  onCompleted,
  onOpenChange,
  open,
  ownerName,
}: {
  autoFinishHireId?: string | null;
  defaultChannelId?: string | null;
  functionId: FunctionId | null;
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
  const hireAction = useCompanyHireActionMutation();
  const [choice, setChoice] = React.useState<ChoiceDraft>(EMPTY_CHOICE);
  const [channelId, setChannelId] = React.useState("");
  const [hasSavedChoice, setHasSavedChoice] = React.useState(false);
  const [progress, setProgress] = React.useState<PrebuiltHireProgress | null>(
    null,
  );
  const [recoveryState, setRecoveryState] =
    React.useState<HireRecoveryState>("idle");
  const [failure, setFailure] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const autoFinishAttemptedRef = React.useRef<string | null>(null);
  const finishHireRef = React.useRef<(() => void) | null>(null);
  const agent = functionId ? prebuiltHeadForFunction(functionId) : null;
  const headQuery = useCompanyHireHeadQuery(progress?.hireId ?? null);
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
      (recoveryState === "ready" || recoveryState === "employee_removed") &&
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
    const savedProgress = readPrebuiltHireProgress(communityId, functionId);
    const savedChoice = readPrebuiltHireChoice(communityId) ?? null;
    const preferredChoice = savedProgress?.choice ?? savedChoice;
    setProgress(savedProgress);
    // Saved browser state is only a recovery hint. Keep the action disabled
    // until its current relay head and local employee state are checked.
    setRecoveryState("checking");
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
  }, [communityId, defaultChannelId, functionId, open]);

  React.useEffect(() => {
    if (
      !open ||
      !communityId ||
      !functionId ||
      !agent ||
      progress ||
      recoveryState !== "checking"
    ) {
      return;
    }
    if (accessQuery.isPending || managedAgentsQuery.isPending) return;
    if (accessQuery.isError || managedAgentsQuery.isError) {
      setRecoveryState("failed");
      setFailure(
        "Colony could not check for an unfinished hire, so it will not start another one. Close this and try again.",
      );
      return;
    }
    let cancelled = false;
    const recover = async () => {
      try {
        const recovered = await findRecoverablePrebuiltHire(
          accessQuery.data?.slotHires ?? [],
          functionId,
          fetchCurrentCompanyHireHead,
        );
        if (cancelled) return;
        if (!recovered) {
          setRecoveryState("ready");
          return;
        }
        const proposal = recovered.head.head.proposal;
        if (!proposal.modelId) {
          setRecoveryState("failed");
          setFailure(
            "This unfinished hire has no model selected. Choose a model before hiring. Colony will not create another agent without one.",
          );
          return;
        }
        const savedChoice = readPrebuiltHireChoice(communityId);
        const preservedEffort =
          savedChoice?.runtimeId === proposal.runtimeId &&
          savedChoice.providerId === (proposal.providerId ?? "") &&
          savedChoice.modelId === proposal.modelId
            ? savedChoice.effortLevel
            : undefined;
        const recoveredChoice: PrebuiltHireChoice = {
          runtimeId: proposal.runtimeId,
          providerId: proposal.providerId ?? "",
          modelId: proposal.modelId,
          ...(preservedEffort ? { effortLevel: preservedEffort } : {}),
        };
        const recoveredProgress: PrebuiltHireProgress = {
          hireId: proposal.hireId,
          functionId,
          agentId: agent.id,
          introductionChannelId: proposal.introductionChannelId,
          choice: recoveredChoice,
          ...(recovered.head.head.employeePubkey
            ? { employeePubkey: recovered.head.head.employeePubkey }
            : {}),
        };
        writePrebuiltHireChoice(communityId, recoveredChoice);
        writePrebuiltHireProgress(communityId, recoveredProgress);
        setChoice({
          ...recoveredChoice,
          effortLevel: recoveredChoice.effortLevel ?? "",
        });
        setChannelId(proposal.introductionChannelId);
        setHasSavedChoice(true);
        setProgress(recoveredProgress);
        const attachedEmployee = recovered.head.head.employeePubkey;
        const hasLocalEmployee = Boolean(
          attachedEmployee &&
            managedAgentsQuery.data?.some(
              (candidate) =>
                candidate.pubkey.toLowerCase() ===
                attachedEmployee.toLowerCase(),
            ),
        );
        setRecoveryState(
          recovered.head.head.status === "approved" &&
            attachedEmployee &&
            !hasLocalEmployee
            ? "employee_removed"
            : "ready",
        );
      } catch {
        if (cancelled) return;
        setRecoveryState("failed");
        setFailure(
          "Colony found an unfinished hire but could not read it, so it will not start another one. Close this and try again.",
        );
      }
    };
    void recover();
    return () => {
      cancelled = true;
    };
  }, [
    agent,
    accessQuery.data?.slotHires,
    accessQuery.isError,
    accessQuery.isPending,
    communityId,
    functionId,
    managedAgentsQuery.data,
    managedAgentsQuery.isError,
    managedAgentsQuery.isPending,
    open,
    progress,
    recoveryState,
  ]);

  React.useEffect(() => {
    if (!open || !progress || submitting) return;
    if (headQuery.isPending || managedAgentsQuery.isPending) return;
    if (headQuery.isError) {
      if (recoveryState === "checking") {
        setRecoveryState("failed");
        setFailure(
          "Colony found an unfinished hire but could not read it, so it will not start another one. Close this and try again.",
        );
      }
      return;
    }
    if (!headQuery.data) {
      // A previous window can stop after writing its local progress but before
      // its first relay create. That is still resumable, including the
      // Operations persona-only interruption.
      if (recoveryState === "checking") setRecoveryState("ready");
      return;
    }
    if (managedAgentsQuery.isError) {
      setRecoveryState("failed");
      setFailure(
        "Colony could not check this employee on this Mac. Close this and try again.",
      );
      return;
    }
    const attachedEmployee = headQuery.data.head.employeePubkey;
    const hasLocalEmployee = Boolean(
      attachedEmployee &&
        managedAgentsQuery.data?.some(
          (candidate) =>
            candidate.pubkey.toLowerCase() === attachedEmployee.toLowerCase(),
        ),
    );
    if (
      headQuery.data.head.status === "approved" &&
      attachedEmployee &&
      !hasLocalEmployee
    ) {
      setRecoveryState("employee_removed");
    } else if (
      recoveryState === "checking" ||
      recoveryState === "employee_removed"
    ) {
      setRecoveryState("ready");
    }
  }, [
    headQuery.data,
    headQuery.isError,
    headQuery.isPending,
    managedAgentsQuery.data,
    managedAgentsQuery.isError,
    managedAgentsQuery.isPending,
    open,
    progress,
    recoveryState,
    submitting,
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

  const finishHire = async () => {
    if (
      submittingRef.current ||
      !agent ||
      !functionId ||
      !communityId ||
      !relayUrl ||
      !identityQuery.data?.pubkey ||
      !isOwner
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
    const replacesRemovedEmployee =
      recoveryState === "employee_removed" && progress !== null;
    const runHireId = progress?.hireId ?? globalThis.crypto.randomUUID();
    const runLease = claimPrebuiltHireRun(communityId, runHireId);
    if (!runLease) return;
    const assertCurrentRun = () => {
      if (!ownsPrebuiltHireRun(runLease)) {
        throw new Error("This hire is continuing in another company session.");
      }
    };
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const selectedChoice = storedChoice(choice);
      const resumedProgress = replacesRemovedEmployee ? null : progress;
      if (replacesRemovedEmployee && progress) {
        const stranded = await fetchCurrentCompanyHireHead(progress.hireId);
        assertCurrentRun();
        if (!stranded) {
          throw new Error(
            "Colony could not read the earlier hire, so it will not start another one.",
          );
        }
        if (stranded.head.status === "approved") {
          const strandedEmployee = stranded.head.employeePubkey;
          if (!strandedEmployee) {
            throw new Error(
              "The earlier hire changed before Colony could replace it. Close this and try again.",
            );
          }
          const localAgents = (await managedAgentsQuery.refetch()).data ?? [];
          assertCurrentRun();
          if (
            localAgents.some(
              (candidate) =>
                candidate.pubkey.toLowerCase() ===
                strandedEmployee.toLowerCase(),
            )
          ) {
            setRecoveryState("ready");
            throw new Error(
              "The earlier employee is available on this Mac. Retry to finish that hire.",
            );
          }
          await publishAndConfirm(
            buildPrebuiltHireDenyAction({
              hireId: progress.hireId,
              expectedHeadEventId: stranded.event.id,
              reason:
                "The attached employee was removed from this Mac before the hire finished.",
            }),
            (record) =>
              record?.head.status === "denied" &&
              record.head.employeePubkey === undefined &&
              record.head.introductionEventId === undefined,
          );
          assertCurrentRun();
        } else if (stranded.head.status !== "denied") {
          throw new Error(
            "The earlier hire changed before Colony could replace it. Close this and try again.",
          );
        }
        clearPrebuiltHireProgress(communityId, progress.functionId);
        removeHireDraft(relayUrl, progress.hireId);
        setProgress(null);
        setRecoveryState("ready");
      }
      const hireId = replacesRemovedEmployee
        ? globalThis.crypto.randomUUID()
        : runHireId;
      let flow: PrebuiltHireProgress = {
        hireId,
        functionId,
        agentId: agent.id,
        introductionChannelId: channelId,
        choice: selectedChoice,
        ...(resumedProgress?.employeePubkey
          ? { employeePubkey: resumedProgress.employeePubkey }
          : {}),
        ...(resumedProgress?.introductionEventId
          ? { introductionEventId: resumedProgress.introductionEventId }
          : {}),
        ...(resumedProgress?.directChannelId
          ? { directChannelId: resumedProgress.directChannelId }
          : {}),
        ...(resumedProgress?.firstMessageEventId
          ? { firstMessageEventId: resumedProgress.firstMessageEventId }
          : {}),
      };
      assertCurrentRun();
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
      assertCurrentRun();
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
      assertCurrentRun();
      if (!current) {
        current = await publishAndConfirm(
          buildPrebuiltHireCreateAction(proposal),
          (record) => isPrebuiltHeadHireForFunction(record, hireId, functionId),
        );
      }
      assertCurrentRun();
      if (!isPrebuiltHeadHireForFunction(current, hireId, functionId)) {
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
        assertCurrentRun();
        await ensureSlotIntent(hireId, functionId);
        assertCurrentRun();
        current = await publishAndConfirm(
          buildPrebuiltHireApproveAction({
            hireId,
            expectedHeadEventId: current.event.id,
          }),
          (record) =>
            record?.head.status === "approved" ||
            record?.head.status === "hired",
        );
        assertCurrentRun();
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
            assertCurrentRun();
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
          assertCurrentRun();
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
          assertCurrentRun();
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
        assertCurrentRun();
        if (current?.head.status !== "approved") {
          throw new Error(
            "The hire changed before the employee could join. Retry it.",
          );
        }
        if (!current.head.employeePubkey) {
          assertCurrentRun();
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
          assertCurrentRun();
        }
        const introductionChannelId =
          current.head.proposal.introductionChannelId;
        if (flow.introductionChannelId !== introductionChannelId) {
          flow = { ...flow, introductionChannelId };
          writePrebuiltHireProgress(communityId, flow);
          setProgress(flow);
        }
        assertCurrentRun();
        await attachManagedAgentToChannel(introductionChannelId, {
          agent: managedAgent,
          role: "bot",
          ensureRunning: true,
        });
        assertCurrentRun();
        if (!flow.introductionEventId) {
          assertCurrentRun();
          const introduction = await sendManagedAgentChannelMessage({
            agentPubkey: employeePubkey,
            channelId: introductionChannelId,
            content: prebuiltIntroductionText(agent, ownerName),
            marker: prebuiltHireIntroductionMarker(hireId),
            markerScope: "agent",
          });
          assertCurrentRun();
          flow = { ...flow, introductionEventId: introduction.eventId };
          writePrebuiltHireProgress(communityId, flow);
          setProgress(flow);
        }
        current = await fetchCurrentCompanyHireHead(hireId);
        assertCurrentRun();
        if (!current)
          throw new Error("The relay could not find the saved hire. Retry it.");
        if (current.head.status !== "hired") {
          const introductionEventId = flow.introductionEventId;
          if (!introductionEventId) {
            throw new Error(
              "The channel introduction was not saved. Retry this hire.",
            );
          }
          assertCurrentRun();
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
          assertCurrentRun();
        }
      }
      current = await fetchCurrentCompanyHireHead(hireId);
      assertCurrentRun();
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
        assertCurrentRun();
        const directChat = await openDm.mutateAsync({
          pubkeys: [employeePubkey],
          expectedRelayUrl: relayUrl,
          expectedSignerPubkey: identityQuery.data.pubkey,
        });
        assertCurrentRun();
        flow = { ...flow, directChannelId: directChat.id };
        writePrebuiltHireProgress(communityId, flow);
        setProgress(flow);
      }
      const directChannelId = flow.directChannelId;
      if (!directChannelId) {
        throw new Error("The direct chat could not be recovered. Retry it.");
      }
      if (!flow.firstMessageEventId) {
        assertCurrentRun();
        const firstMessage = await sendManagedAgentChannelMessage({
          agentPubkey: employeePubkey,
          channelId: directChannelId,
          content: prebuiltFirstMessageText(agent, ownerName),
          marker: prebuiltHireFirstMessageMarker(hireId),
          markerScope: "agent",
        });
        assertCurrentRun();
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
              agentId: flow.agentId,
              employeePubkey: flow.employeePubkey,
              directChannelId: flow.directChannelId,
              firstMessageEventId: completedEventId,
              firstMessage: prebuiltFirstMessageText(agent, ownerName),
            }
          : null;
      assertCurrentRun();
      if (completion) writePrebuiltHireCompletion(communityId, completion);
      clearPrebuiltHireProgress(communityId, functionId);
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
        queryClient.invalidateQueries({ queryKey: channelsQueryKey }),
      ]);
      assertCurrentRun();
      onCompleted(completion);
    } catch (error) {
      if (ownsPrebuiltHireRun(runLease)) setFailure(errorText(error));
    } finally {
      submittingRef.current = false;
      if (ownsPrebuiltHireRun(runLease)) setSubmitting(false);
      releasePrebuiltHireRun(runLease);
    }
  };

  React.useEffect(() => {
    finishHireRef.current = () => void finishHire();
  });

  React.useEffect(() => {
    if (
      !autoFinishHireId ||
      autoFinishAttemptedRef.current === autoFinishHireId ||
      !progress ||
      progress.hireId.toLowerCase() !== autoFinishHireId.toLowerCase() ||
      recoveryState !== "ready" ||
      submitting ||
      !selectionReady ||
      headQuery.data?.head.status !== "approved"
    ) {
      return;
    }
    const employeePubkey = headQuery.data.head.employeePubkey;
    if (
      !employeePubkey ||
      !managedAgentsQuery.data?.some(
        (candidate) =>
          candidate.pubkey.toLowerCase() === employeePubkey.toLowerCase(),
      )
    ) {
      return;
    }
    autoFinishAttemptedRef.current = autoFinishHireId;
    finishHireRef.current?.();
  }, [
    autoFinishHireId,
    headQuery.data,
    managedAgentsQuery.data,
    progress,
    recoveryState,
    selectionReady,
    submitting,
  ]);

  const undoUnapprovedHire = async () => {
    if (!progress || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const current = await fetchCurrentCompanyHireHead(progress.hireId);
      if (!current || current.head.status === "denied") {
        clearPrebuiltHireProgress(communityId, progress.functionId);
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
      clearPrebuiltHireProgress(communityId, progress.functionId);
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

  return (
    <PrebuiltHeadHireDialogForm
      agent={agent}
      canUndoUnapprovedHire={Boolean(
        progress && headQuery.data?.head.status === "proposed",
      )}
      choice={choice}
      effortChoiceOptions={effortChoiceOptions}
      effortRequired={effortRequired}
      failure={failure}
      functionId={functionId}
      hasModelChoicesForSelectedRuntime={modelChoices.some(
        (model) => model.runtimeId === selectedRuntime?.id,
      )}
      hasSavedChoice={hasSavedChoice}
      hasSelectedModel={Boolean(selectedModel)}
      hasValidChannels={validChannels.length > 0}
      inheritedEnvVars={inheritedEnvVars}
      inheritedProvider={inheritedProvider}
      isOwner={Boolean(isOwner)}
      modelRequired={modelRequired}
      onEffortChange={(effortLevel) =>
        setChoice((current) => ({ ...current, effortLevel }))
      }
      onModelChange={(modelId) =>
        setChoice((current) => ({
          ...current,
          modelId,
          effortLevel: "",
        }))
      }
      onOpenChange={close}
      onOptions={receiveModelOptions}
      onRetry={() => void finishHire()}
      onRuntimeChange={(runtimeId) => {
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
      onUndoUnapprovedHire={() => void undoUnapprovedHire()}
      recoveryState={recoveryState}
      requiresEffort={requiresEffort}
      retryingAutoFinish={Boolean(
        failure && autoFinishHireId === progress?.hireId,
      )}
      runtimeOptions={runtimeOptions}
      runtimes={runtimes}
      runtimesQueryIsPending={runtimesQuery.isPending}
      selectedModelLabel={selectedModel?.label}
      selectedModelOptions={selectedModelOptions}
      selectedRuntime={selectedRuntime}
      selectionReady={selectionReady}
      submitting={submitting}
    />
  );
}
