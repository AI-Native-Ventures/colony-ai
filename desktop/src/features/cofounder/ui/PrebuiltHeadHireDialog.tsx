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
import { agentAntAvatarDataUrl } from "@/features/agents/ui/agentAntAvatar";
import {
  simpleModelLabel,
  simpleProviderLabel,
} from "@/features/agents/ui/simpleAgentAi";
import { useAgentDialogDefaults } from "@/features/agents/ui/useAgentDialogDefaults";
import { attachManagedAgentToChannel } from "@/features/agents/channelAgents";
import {
  useChannelsQuery,
  channelsQueryKey,
  useOpenDmMutation,
} from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";

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
import {
  COMPANY_HIRE_SCHEMA_VERSION,
  parseCompanyHireAction,
} from "@/features/company-hiring/companyHireModels";
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
import {
  buildPrebuiltHireProposal,
  prebuiltFirstMoveText,
  prebuiltHireMarker,
} from "../prebuiltHireModels";
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

function sameProposal(
  record: CompanyHireHeadRecord | null,
  hireId: string,
  functionId: FunctionId,
) {
  return (
    record?.head.proposal.hireId === hireId &&
    record.head.proposal.title === prebuiltHeadForFunction(functionId)?.name
  );
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The hire paused before it finished. Retry to continue from the saved step.";
}

export function PrebuiltHeadHireDialog({
  defaultChannelId,
  functionId,
  managerPubkey,
  onCompleted,
  onOpenChange,
  open,
  ownerName,
}: {
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
  const [progress, setProgress] = React.useState<PrebuiltHireProgress | null>(
    null,
  );
  const [failure, setFailure] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
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
  const providerLabel = simpleProviderLabel({
    runtimeId: choice.runtimeId,
    provider: choice.providerId,
    envVars: inheritedEnvVars,
  });
  const isOwner = membershipQuery.data?.role === "owner";
  const selectionReady = Boolean(
    selectedRuntime &&
      selectedModel &&
      (!requiresEffort || effortOptions.includes(choice.effortLevel)) &&
      channelId,
  );

  React.useEffect(() => {
    if (!open || !communityId || !functionId) return;
    const savedProgress = readPrebuiltHireProgress(communityId, functionId);
    const savedChoice =
      savedProgress?.choice ?? readPrebuiltHireChoice(communityId) ?? null;
    setProgress(savedProgress);
    setChoice(
      savedChoice
        ? {
            runtimeId: savedChoice.runtimeId,
            providerId: savedChoice.providerId,
            modelId: savedChoice.modelId,
            effortLevel: savedChoice.effortLevel ?? "",
          }
        : EMPTY_CHOICE,
    );
    setChannelId(
      savedProgress?.introductionChannelId ?? defaultChannelId ?? "",
    );
    setFailure(null);
  }, [communityId, defaultChannelId, functionId, open]);

  React.useEffect(() => {
    if (!open || channelId || validChannels.length === 0) return;
    const preferred = validChannels.find(
      (channel) => channel.id === defaultChannelId,
    );
    setChannelId(preferred?.id ?? validChannels[0]?.id ?? "");
  }, [channelId, defaultChannelId, open, validChannels]);

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
      input: unknown,
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
        await publishAccessAction.mutateAsync({
          op: "slot_hire_set",
          hireId,
          functionId: selectedFunctionId,
          expectedHeadEventId: null,
        });
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
      !isOwner ||
      !selectionReady
    ) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      const selectedChoice = storedChoice(choice);
      const hireId = progress?.hireId ?? globalThis.crypto.randomUUID();
      let flow: PrebuiltHireProgress = {
        hireId,
        functionId,
        agentId: agent.id,
        introductionChannelId: channelId,
        choice: selectedChoice,
        ...(progress?.employeePubkey
          ? { employeePubkey: progress.employeePubkey }
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
          {
            schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
            hireId,
            action: "create",
            proposal,
          },
          (record) => sameProposal(record, hireId, functionId),
        );
      }
      if (!sameProposal(current, hireId, functionId)) {
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
        await ensureSlotIntent(hireId, functionId);
        current = await publishAndConfirm(
          {
            schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
            hireId,
            action: "approve",
            expectedHeadEventId: current.event.id,
          },
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
            provider: selectedChoice.providerId || undefined,
            effortLevel: selectedChoice.effortLevel,
            avatarUrl: agentAntAvatarDataUrl(agent.name),
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
            {
              schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
              hireId,
              action: "attach_employee",
              expectedHeadEventId: current.event.id,
              employeePubkey,
            },
            (record) =>
              record?.head.employeePubkey?.toLowerCase() ===
              employeePubkey?.toLowerCase(),
          );
        }
        await attachManagedAgentToChannel(channelId, {
          agent: managedAgent,
          role: "bot",
          ensureRunning: true,
        });
        const directChat = await openDm.mutateAsync({
          pubkeys: [employeePubkey],
          expectedRelayUrl: relayUrl,
          expectedSignerPubkey: identityQuery.data.pubkey,
        });
        flow = { ...flow, directChannelId: directChat.id };
        writePrebuiltHireProgress(communityId, flow);
        setProgress(flow);
        const firstMove = await sendManagedAgentChannelMessage({
          agentPubkey: employeePubkey,
          channelId: directChat.id,
          content: prebuiltFirstMoveText(agent, ownerName),
          marker: prebuiltHireMarker(hireId),
          markerScope: "agent",
        });
        flow = { ...flow, firstMoveEventId: firstMove.eventId };
        writePrebuiltHireProgress(communityId, flow);
        setProgress(flow);
        current = await fetchCurrentCompanyHireHead(hireId);
        if (!current)
          throw new Error("The relay could not find the saved hire. Retry it.");
        if (current.head.status !== "hired") {
          current = await publishAndConfirm(
            {
              schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
              hireId,
              action: "complete",
              expectedHeadEventId: current.event.id,
              employeePubkey,
              introductionEventId: firstMove.eventId,
            },
            (record) =>
              record?.head.status === "hired" &&
              record.head.employeePubkey?.toLowerCase() ===
                employeePubkey?.toLowerCase() &&
              record.head.introductionEventId === firstMove.eventId,
          );
        }
      }
      const completedEventId =
        flow.firstMoveEventId ?? current?.head.introductionEventId ?? undefined;
      const completion =
        flow.employeePubkey && flow.directChannelId && completedEventId
          ? {
              hireId: flow.hireId,
              functionId: flow.functionId,
              agentId: flow.agentId,
              employeePubkey: flow.employeePubkey,
              directChannelId: flow.directChannelId,
              firstMoveEventId: completedEventId,
              firstMove: prebuiltFirstMoveText(agent, ownerName),
            }
          : null;
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
        {
          schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
          hireId: progress.hireId,
          action: "deny",
          expectedHeadEventId: current.event.id,
          reason: "Cancelled from the company map",
        },
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
    <Dialog onOpenChange={close} open={open}>
      <DialogContent
        aria-describedby="prebuilt-hire-description"
        className="max-w-2xl"
        data-testid="prebuilt-head-hire-dialog"
      >
        <div className="flex items-start gap-4 pr-8">
          <EmployeeAvatar
            className="size-14 rounded-full"
            instance={agentAntAvatarDataUrl(agent.name)}
            name={agent.name}
            role={`Head of ${FUNCTION_DETAILS[functionId].name}`}
          />
          <div>
            <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
              Pre-built agent
            </p>
            <DialogTitle>Hire {agent.name}</DialogTitle>
            <DialogDescription id="prebuilt-hire-description">
              {agent.does.join(" ")}
            </DialogDescription>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-xl border border-border bg-muted/20 p-3">
            <h2 className="text-sm font-bold">What it does</h2>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
              {agent.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-muted/20 p-3">
            <h2 className="text-sm font-bold">What it asks of you</h2>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
              {agent.asks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>

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
          <label className="grid gap-1 text-sm font-bold">
            Harness
            <select
              data-testid="prebuilt-hire-harness"
              disabled={submitting || runtimes.length === 0}
              onChange={(event) => {
                const runtime = runtimes.find(
                  (candidate) => candidate.id === event.target.value,
                );
                setChoice({
                  ...EMPTY_CHOICE,
                  runtimeId: runtime?.id ?? "",
                  providerId: runtime
                    ? providerForRuntime(runtime, inheritedProvider)
                    : "",
                });
              }}
              value={choice.runtimeId}
            >
              <option value="">Choose a harness</option>
              {runtimes.map((runtime) => (
                <option key={runtime.id} value={runtime.id}>
                  {runtime.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-bold">
            Model
            <select
              data-testid="prebuilt-hire-model"
              disabled={submitting || !selectedRuntime}
              onChange={(event) => {
                const model = modelChoices.find(
                  (candidate) =>
                    candidate.runtimeId === choice.runtimeId &&
                    candidate.providerId === choice.providerId &&
                    candidate.modelId === event.target.value,
                );
                setChoice((current) => ({
                  ...current,
                  modelId: model?.modelId ?? "",
                  effortLevel: "",
                }));
              }}
              value={choice.modelId}
            >
              <option value="">Choose a model</option>
              {modelChoices
                .filter(
                  (model) =>
                    model.runtimeId === choice.runtimeId &&
                    model.providerId === choice.providerId,
                )
                .map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-bold">
            Effort
            <select
              data-testid="prebuilt-hire-effort"
              disabled={submitting || !selectedModel || !requiresEffort}
              onChange={(event) =>
                setChoice((current) => ({
                  ...current,
                  effortLevel: event.target.value,
                }))
              }
              value={choice.effortLevel}
            >
              <option value="">Choose effort</option>
              {effortOptions.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedRuntime && selectedModel && !requiresEffort ? (
          <p className="text-sm text-muted-foreground">
            This harness chooses effort itself. There is no effort setting to
            pick here.
          </p>
        ) : null}
        {providerLabel ? (
          <p className="text-sm text-muted-foreground">
            Provider: {providerLabel}
          </p>
        ) : null}
        {runtimesQuery.isPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Checking which AI is ready on this Mac.
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

        <label className="grid gap-1 text-sm font-bold">
          Home chat
          <select
            data-testid="prebuilt-hire-channel"
            disabled={submitting || validChannels.length === 0}
            onChange={(event) => setChannelId(event.target.value)}
            value={channelId}
          >
            <option value="">Choose a chat</option>
            {validChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                # {channel.name}
              </option>
            ))}
          </select>
        </label>
        {validChannels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Join a chat before hiring this head.
          </p>
        ) : null}

        <section className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            First move
          </p>
          <p className="mt-1 text-sm">
            {prebuiltFirstMoveText(agent, ownerName)}
          </p>
        </section>

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

        <div className="flex flex-wrap justify-end gap-3">
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted disabled:opacity-50"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
            type="button"
          >
            Not yet
          </button>
          <button
            className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="prebuilt-hire-finish"
            disabled={!selectionReady || !isOwner || submitting}
            onClick={() => void finishHire()}
            type="button"
          >
            {submitting
              ? "Finishing hire"
              : selectionReady
                ? "Finish hire"
                : "Pick all three"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
