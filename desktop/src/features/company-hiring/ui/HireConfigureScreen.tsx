import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useAvailableAcpRuntimes,
  usePersonasQuery,
} from "@/features/agents/hooks";
import { useAgentDialogDefaults } from "@/features/agents/ui/useAgentDialogDefaults";
import { usePersonaModelDiscovery } from "@/features/agents/ui/usePersonaModelDiscovery";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import type {
  AcpRuntimeCatalogEntry,
  AgentPersona,
  RespondToMode,
} from "@/shared/api/types";
import { readConfiguredFreeAiModels } from "@/features/credits/creditsGateway";
import { getProviderEffortConfig } from "@/features/agents/ui/buzzAgentConfig";
import {
  simpleModelLabel,
  simpleProviderLabel,
} from "@/features/agents/ui/simpleAgentAi";
import {
  agentAntAvatarDataUrl,
  agentFunctionFromRole,
} from "@/features/agents/ui/agentAntAvatar";
import { AgentAntPicturePicker } from "@/features/agents/ui/AgentAntPicturePicker";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useCompanyHireHeadQuery } from "../hireRelay";
import {
  companyHireRolePackFromPersona,
  COMPANY_HIRE_SCHEMA_VERSION,
  parseCompanyHireAction,
} from "../companyHireModels";
import type { CompanyHireHeadRecord } from "../companyHireModels";
import { readHireDraft, writeHireDraft } from "../hireDraft";
import {
  HIRE_CONFIGURE_TIMEOUT_MS,
  hireConfigureStatus,
} from "../hireConfigureStatus";
import type { HireConfigureStatus } from "../hireConfigureStatus";
import type { HireProposal } from "@/features/company-asks/askRecords";
import { ArrowGlyph } from "./hireTools";
import {
  HireButton,
  HireField,
  HirePage,
  HireRecovery,
  HireSteps,
  HireTitle,
} from "./HirePresentation";

type HireFormValues = {
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

type ModelChoice = {
  value: string;
  runtimeId: string;
  providerId: string;
  modelId: string;
  label: string;
};

function formFromProposal(proposal: HireProposal): HireFormValues {
  return {
    displayName: proposal.displayName,
    title: proposal.title,
    managerPubkey: proposal.managerPubkey ?? "",
    introductionChannelId: proposal.introductionChannelId,
    channelIds: proposal.channelIds ?? [proposal.introductionChannelId],
    respondTo: proposal.respondTo === "anyone" ? "anyone" : "owner-only",
    weeklyAllowance: proposal.weeklyAllowance ?? "",
    runtimeId: proposal.runtimeId,
    providerId: proposal.providerId ?? "",
    modelId: proposal.modelId ?? "",
    effortLevel: proposal.effortLevel ?? "",
  };
}

function buildHireProposal(
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
    ...(values.channelIds.length > 0
      ? { channelIds: [...values.channelIds] }
      : {}),
    respondTo: values.respondTo,
    runtimeId: values.runtimeId,
    ...(values.providerId ? { providerId: values.providerId } : {}),
    ...(values.modelId ? { modelId: values.modelId } : {}),
    ...(values.effortLevel ? { effortLevel: values.effortLevel } : {}),
    ...(values.weeklyAllowance.trim()
      ? { weeklyAllowance: values.weeklyAllowance.trim() }
      : {}),
  };
}

function modelChoiceValue(
  runtimeId: string,
  providerId: string,
  modelId: string,
) {
  return JSON.stringify([runtimeId, providerId, modelId]);
}

function modelChoicesForRuntime(
  runtimeId: string,
  providerId: string,
  options: readonly { id: string; label: string }[] | null | undefined,
): ModelChoice[] {
  return (options ?? []).map((option) => ({
    value: modelChoiceValue(runtimeId, providerId, option.id),
    runtimeId,
    providerId,
    modelId: option.id,
    label: option.id ? simpleModelLabel(option.id, providerId) : option.label,
  }));
}

function effortOptionsFor(
  runtime: AcpRuntimeCatalogEntry | undefined,
  providerId: string,
  modelId: string,
): readonly string[] {
  if (runtime?.effortCanonicalValues?.length) {
    return runtime.effortCanonicalValues;
  }
  if (runtime?.id === "buzz-agent") {
    return getProviderEffortConfig(providerId, modelId).validValues;
  }
  return [];
}

function defaultEffortFor(
  runtime: AcpRuntimeCatalogEntry | undefined,
  providerId: string,
  modelId: string,
) {
  if (runtime?.id === "buzz-agent") {
    return getProviderEffortConfig(providerId, modelId).defaultValue ?? "";
  }
  return runtime?.effortCanonicalValues?.[0] ?? "";
}

function WorkerModelProbe({
  envVars,
  onOptions,
  providerId,
  runtime,
}: {
  envVars: Record<string, string>;
  onOptions: (
    runtimeId: string,
    providerId: string,
    options: readonly { id: string; label: string }[] | null,
  ) => void;
  providerId: string;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const { discoveredModelOptions } = usePersonaModelDiscovery({
    envVars,
    isCustomProviderEditing: false,
    modelFieldVisible: true,
    open: true,
    provider: providerId,
    selectedRuntime: runtime,
  });
  React.useEffect(() => {
    onOptions(runtime.id, providerId, discoveredModelOptions);
  }, [discoveredModelOptions, onOptions, providerId, runtime.id]);
  return null;
}

function initialValues(
  rolePack: HireProposal["rolePack"],
  persona: AgentPersona | undefined,
  channelId: string,
  availableRuntimeIds: ReadonlySet<string>,
): HireFormValues {
  // A role may run on several harnesses: start on the persona's own, else the
  // first one this Mac has.
  const runtimeId = rolePack.workerMenu.includes(persona?.runtime ?? "")
    ? (persona?.runtime ?? "")
    : (rolePack.workerMenu.find((id) => availableRuntimeIds.has(id)) ??
      rolePack.workerMenu[0] ??
      "");
  return {
    displayName: "",
    title: rolePack.title,
    managerPubkey: "",
    introductionChannelId: channelId,
    channelIds: channelId ? [channelId] : [],
    respondTo: "owner-only",
    weeklyAllowance: "",
    runtimeId,
    providerId: persona?.runtime === runtimeId ? (persona.provider ?? "") : "",
    modelId: persona?.runtime === runtimeId ? (persona.model ?? "") : "",
    effortLevel: "",
  };
}

function currentRecordProposal(record: CompanyHireHeadRecord | undefined) {
  return record?.head.proposal;
}

function HireConfigureState({
  onBack,
  onRetry,
  status,
  timedOut,
}: {
  onBack: () => void;
  onRetry: () => void;
  status: Exclude<HireConfigureStatus, "ready">;
  timedOut: boolean;
}) {
  const actions = (
    <div className="colony-hire-state-actions">
      {status === "role-missing" ? null : (
        <HireButton onClick={onRetry} size="md">
          Try again
        </HireButton>
      )}
      <HireButton onClick={onBack} size="md" variant="outline">
        Back to roles
      </HireButton>
    </div>
  );
  return (
    <HirePage testId="hire-configure">
      <HireTitle
        subtitle="Name the new employee and choose how they work."
        title="Configure employee"
      />
      <HireSteps current={2} onSelect={onBack} />
      <div data-testid="hire-configure-state">
        {status === "loading" && !timedOut ? (
          <section
            aria-label="Loading the employee form"
            className="colony-hire-loading"
          >
            <div className="colony-hire-banner" role="status">
              Loading the employee form. Actions become available after the
              shared source responds.
            </div>
            <div aria-hidden="true" className="colony-hire-skeleton" />
          </section>
        ) : status === "loading" ? (
          <HireRecovery
            action={actions}
            title="This is taking longer than expected"
          >
            The shared source has not answered yet. Try again, or go back to the
            roles and pick up later. Your draft is kept.
          </HireRecovery>
        ) : status === "error" ? (
          <HireRecovery
            action={actions}
            title="This information could not load"
          >
            A connection failure is not an empty record. Your draft is kept.
          </HireRecovery>
        ) : (
          <HireRecovery action={actions} title="This role could not be loaded">
            The role is no longer in your catalog. Go back to the roles and
            choose it again.
          </HireRecovery>
        )}
      </div>
    </HirePage>
  );
}

export function HireConfigureScreen({
  hireId,
  personaId,
  source,
}: {
  hireId: string;
  personaId?: string;
  source?: { channelId?: string; askId?: string; nameTaken?: boolean };
}) {
  const personasQuery = usePersonasQuery();
  const runtimesQuery = useAvailableAcpRuntimes();
  const channelsQuery = useChannelsQuery();
  const teamQuery = useCompanyTeamQuery();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const headQuery = useCompanyHireHeadQuery(hireId);
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  const freeModelsQuery = useQuery({
    queryKey: ["credits-gateway-free-models", relayUrl],
    queryFn: () => readConfiguredFreeAiModels(),
    enabled: Boolean(relayUrl),
    retry: false,
    staleTime: 30_000,
  });
  const freeModels = freeModelsQuery.data ?? [];
  const { goHireReview, goHireRoles } = useAppNavigation();
  const persona = personasQuery.data?.find((item) => item.id === personaId);
  const remoteProposal = currentRecordProposal(headQuery.data ?? undefined);
  const rolePack = React.useMemo(
    () =>
      remoteProposal?.rolePack ??
      (persona ? companyHireRolePackFromPersona(persona) : null),
    [persona, remoteProposal?.rolePack],
  );
  const inheritedDefaults = useAgentDialogDefaults({
    inheritedEnvVars: persona?.envVars ?? {},
    open: true,
  });
  const workerMenu = rolePack?.workerMenu ?? [];
  const runtimesById = React.useMemo(
    () =>
      new Map(
        (runtimesQuery.data ?? []).map((runtime) => [runtime.id, runtime]),
      ),
    [runtimesQuery.data],
  );
  const [choicesByRuntime, setChoicesByRuntime] = React.useState<
    Record<string, ModelChoice[]>
  >({});
  const [form, setForm] = React.useState<HireFormValues | null>(() => {
    const stored = readHireDraft(relayUrl, hireId);
    return stored ? formFromProposal(stored.proposal) : null;
  });
  const [avatarUrl, setAvatarUrl] = React.useState(
    () => readHireDraft(relayUrl, hireId)?.avatarUrl ?? "",
  );
  const [avatarUploadPending, setAvatarUploadPending] = React.useState(false);
  const [draftSaveError, setDraftSaveError] = React.useState(false);
  const [nameTaken, setNameTaken] = React.useState(source?.nameTaken === true);
  const initialized = React.useRef(form !== null);

  React.useEffect(() => {
    if (initialized.current) return;
    const stored = readHireDraft(relayUrl, hireId);
    if (stored) {
      setForm(formFromProposal(stored.proposal));
      if (stored.avatarUrl) setAvatarUrl(stored.avatarUrl);
      initialized.current = true;
      return;
    }
    if (remoteProposal) {
      setForm(formFromProposal(remoteProposal));
      initialized.current = true;
      return;
    }
    if (rolePack && !runtimesQuery.isPending) {
      const channels = (channelsQuery.data ?? []).filter(
        (channel) =>
          channel.channelType === "stream" &&
          channel.archivedAt === null &&
          channel.isMember,
      );
      setForm(
        initialValues(
          rolePack,
          persona,
          channels[0]?.id ?? "",
          new Set(runtimesById.keys()),
        ),
      );
      initialized.current = true;
    }
  }, [
    channelsQuery.data,
    hireId,
    persona,
    relayUrl,
    remoteProposal,
    rolePack,
    runtimesById,
    runtimesQuery.isPending,
  ]);

  const providerForRuntime = React.useCallback(
    (runtime: AcpRuntimeCatalogEntry) => {
      if (!runtime.providerEnvVar) return "";
      if (form?.runtimeId === runtime.id && form.providerId) {
        return form.providerId;
      }
      if (persona?.runtime === runtime.id && persona.provider) {
        return persona.provider;
      }
      return inheritedDefaults.inheritedDefaults.provider.value;
    },
    [
      form?.providerId,
      form?.runtimeId,
      inheritedDefaults.inheritedDefaults.provider.value,
      persona?.provider,
      persona?.runtime,
    ],
  );
  React.useEffect(() => {
    if (!form || form.providerId || !form.runtimeId) return;
    const runtime = runtimesById.get(form.runtimeId);
    if (!runtime?.providerEnvVar) return;
    const inheritedProvider =
      inheritedDefaults.inheritedDefaults.provider.value;
    if (inheritedProvider) {
      setForm((current) =>
        current && !current.providerId
          ? { ...current, providerId: inheritedProvider }
          : current,
      );
    }
  }, [form, inheritedDefaults.inheritedDefaults.provider.value, runtimesById]);
  React.useEffect(() => {
    if (avatarUrl || !rolePack) return;
    setAvatarUrl(agentAntAvatarDataUrl(rolePack.job));
  }, [avatarUrl, rolePack]);
  const receiveModelOptions = React.useCallback(
    (
      runtimeId: string,
      providerId: string,
      options: readonly { id: string; label: string }[] | null,
    ) => {
      const key = JSON.stringify([runtimeId, providerId]);
      const choices = modelChoicesForRuntime(runtimeId, providerId, options);
      setChoicesByRuntime((previous) => {
        const current = previous[key] ?? [];
        if (
          current.length === choices.length &&
          current.every(
            (choice, index) =>
              choice.value === choices[index]?.value &&
              choice.label === choices[index]?.label,
          )
        ) {
          return previous;
        }
        return { ...previous, [key]: choices };
      });
    },
    [],
  );
  const modelChoices = workerMenu.flatMap((runtimeId) => {
    const runtime = runtimesById.get(runtimeId);
    if (!runtime) return [];
    const providerId = providerForRuntime(runtime);
    const freeChoices =
      runtime.id === "buzz-agent"
        ? freeModels.map((modelId) => ({
            value: modelChoiceValue(runtime.id, "colony-credits", modelId),
            runtimeId: runtime.id,
            providerId: "colony-credits",
            modelId,
            label: simpleModelLabel(modelId, "colony-credits"),
          }))
        : [];
    if (runtime.id === "buzz-agent" && providerId === "colony-credits") {
      return freeChoices;
    }
    const discoveredChoices =
      choicesByRuntime[JSON.stringify([runtimeId, providerId])] ?? [];
    return [...freeChoices, ...discoveredChoices];
  });
  const currentChoice = modelChoices.find(
    (choice) =>
      choice.runtimeId === form?.runtimeId &&
      choice.providerId === form?.providerId &&
      choice.modelId === form?.modelId,
  );
  // No model chosen yet (a built-in role has none of its own): start on the
  // first one the chosen worker offers.
  React.useEffect(() => {
    if (!form?.runtimeId) return;
    if (
      modelChoices.some(
        (choice) =>
          choice.runtimeId === form.runtimeId &&
          choice.providerId === form.providerId &&
          choice.modelId === form.modelId,
      )
    )
      return;
    const first = modelChoices.find(
      (choice) =>
        choice.runtimeId === form.runtimeId &&
        (!form.providerId || choice.providerId === form.providerId),
    );
    if (!first) return;
    setForm((current) =>
      current
        ? {
            ...current,
            runtimeId: first.runtimeId,
            providerId: first.providerId,
            modelId: first.modelId,
            effortLevel: "",
          }
        : null,
    );
  }, [form, modelChoices]);
  const validChannels = (channelsQuery.data ?? []).filter(
    (channel) =>
      channel.channelType === "stream" &&
      channel.archivedAt === null &&
      channel.isMember,
  );
  const status = hireConfigureStatus({
    personas: personasQuery,
    runtimes: runtimesQuery,
    channels: channelsQuery,
    team: teamQuery,
    identity: identityQuery,
    membership: membershipQuery,
    head: headQuery,
    hasRolePack: rolePack !== null,
    hasForm: form !== null,
  });
  const [attempt, setAttempt] = React.useState(0);
  const [timedOut, setTimedOut] = React.useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt restarts the wait when the person taps Try again
  React.useEffect(() => {
    setTimedOut(false);
    if (status !== "loading") return;
    const timer = window.setTimeout(
      () => setTimedOut(true),
      HIRE_CONFIGURE_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [attempt, status]);
  const retry = () => {
    setAttempt((count) => count + 1);
    void Promise.all([
      personasQuery.refetch(),
      runtimesQuery.refetch(),
      channelsQuery.refetch(),
      teamQuery.refetch(),
      identityQuery.refetch(),
      membershipQuery.refetch(),
      headQuery.refetch(),
    ]);
  };
  const selectedRuntime = form ? runtimesById.get(form.runtimeId) : undefined;
  const effortOptions = form
    ? effortOptionsFor(selectedRuntime, form.providerId, form.modelId)
    : [];
  const effortDefault = form
    ? defaultEffortFor(selectedRuntime, form.providerId, form.modelId)
    : "";
  const selectedProviderLabel = form
    ? simpleProviderLabel({
        runtimeId: form.runtimeId,
        provider: form.providerId,
        envVars: inheritedDefaults.inheritedEnvVars,
      })
    : null;
  React.useEffect(() => {
    if (!form) return;
    if (effortOptions.includes(form.effortLevel)) return;
    const nextEffort =
      (effortDefault && effortOptions.includes(effortDefault)
        ? effortDefault
        : effortOptions[0]) ?? "";
    if (nextEffort === form.effortLevel) return;
    setForm((current) =>
      current ? { ...current, effortLevel: nextEffort } : current,
    );
  }, [effortDefault, effortOptions, form]);
  const candidateProposal = React.useMemo(
    () => (form && rolePack ? buildHireProposal(hireId, rolePack, form) : null),
    [form, hireId, rolePack],
  );
  const candidateCreateAction = React.useMemo(
    () =>
      candidateProposal
        ? parseCompanyHireAction({
            schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
            hireId,
            action: "create",
            proposal: candidateProposal,
          })
        : null,
    [candidateProposal, hireId],
  );
  const previousDraft = readHireDraft(relayUrl, hireId);
  React.useEffect(() => {
    if (!candidateCreateAction?.proposal) return;
    writeHireDraft(relayUrl, {
      proposal: candidateCreateAction.proposal,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(previousDraft?.employeePubkey
        ? { employeePubkey: previousDraft.employeePubkey }
        : {}),
      ...(source?.askId && headQuery.data?.event.id
        ? {
            baseHeadEventId:
              previousDraft?.baseHeadEventId ?? headQuery.data.event.id,
          }
        : {}),
    });
  }, [
    avatarUrl,
    candidateCreateAction,
    headQuery.data?.event.id,
    previousDraft?.baseHeadEventId,
    previousDraft?.employeePubkey,
    relayUrl,
    source?.askId,
  ]);

  if (status !== "ready" || !form || !rolePack) {
    return (
      <HireConfigureState
        onBack={() => void goHireRoles()}
        onRetry={retry}
        status={status === "ready" ? "loading" : status}
        timedOut={timedOut}
      />
    );
  }

  const updateForm = (field: keyof HireFormValues, value: string) => {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  };
  const proposal = buildHireProposal(hireId, rolePack, form);
  const createAction = parseCompanyHireAction({
    schemaVersion: COMPANY_HIRE_SCHEMA_VERSION,
    hireId,
    action: "create",
    proposal,
  });
  const storedDraft = previousDraft;

  const saveDraftAndReview = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDraftSaveError(false);
    if (
      !createAction ||
      !form.displayName.trim() ||
      avatarUploadPending ||
      form.channelIds.length === 0
    )
      return;
    const saved = writeHireDraft(relayUrl, {
      proposal,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(storedDraft?.employeePubkey
        ? { employeePubkey: storedDraft.employeePubkey }
        : {}),
      ...(source?.askId && headQuery.data?.event.id
        ? { baseHeadEventId: headQuery.data.event.id }
        : {}),
    });
    if (!saved) {
      setDraftSaveError(true);
      return;
    }
    void goHireReview(hireId, source);
  };

  const previewName = form.displayName.trim() || "New employee";
  const chooseChannel = (channelId: string, checked: boolean) => {
    const selected = new Set(
      form.channelIds.length > 0
        ? form.channelIds
        : form.introductionChannelId
          ? [form.introductionChannelId]
          : [],
    );
    if (checked) selected.add(channelId);
    else selected.delete(channelId);
    const channelIds = validChannels
      .filter((channel) => selected.has(channel.id))
      .map((channel) => channel.id);
    const introductionChannelId = channelIds.includes(
      form.introductionChannelId,
    )
      ? form.introductionChannelId
      : (channelIds[0] ?? "");
    setForm((current) =>
      current ? { ...current, channelIds, introductionChannelId } : current,
    );
  };
  const modelGroups = modelChoices.reduce<
    { label: string; choices: ModelChoice[]; isFree: boolean }[]
  >((groups, choice) => {
    const runtime = runtimesById.get(choice.runtimeId);
    const providerLabel = simpleProviderLabel({
      runtimeId: choice.runtimeId,
      provider: choice.providerId,
      envVars: inheritedDefaults.inheritedEnvVars,
    });
    const isFree = choice.providerId === "colony-credits";
    const label = isFree
      ? "Colony"
      : choice.runtimeId === "claude" && !providerLabel
        ? "Your Claude plan"
        : choice.runtimeId === "codex" && !providerLabel
          ? "Your ChatGPT plan"
          : providerLabel
            ? "Your own key"
            : (runtime?.label ?? choice.runtimeId);
    const group = groups.find((candidate) => candidate.label === label);
    if (group) group.choices.push(choice);
    else groups.push({ label, choices: [choice], isFree });
    return groups;
  }, []);
  const canContinue = Boolean(
    createAction &&
      currentChoice &&
      form.displayName.trim() &&
      form.channelIds.length > 0 &&
      !avatarUploadPending,
  );

  return (
    <HirePage testId="hire-configure">
      <HireTitle
        subtitle="Its name, picture, AI and channels."
        title={`Set up your ${rolePack.title}`}
      />
      <HireSteps current={2} onSelect={() => void goHireRoles()} />
      {workerMenu.map((runtimeId) => {
        const runtime = runtimesById.get(runtimeId);
        if (
          !runtime ||
          (runtime.id === "buzz-agent" &&
            providerForRuntime(runtime) === "colony-credits")
        )
          return null;
        return (
          <WorkerModelProbe
            envVars={inheritedDefaults.inheritedEnvVars}
            key={`${runtimeId}:${providerForRuntime(runtime)}`}
            onOptions={receiveModelOptions}
            providerId={providerForRuntime(runtime)}
            runtime={runtime}
          />
        );
      })}
      <form
        aria-label="Configure employee"
        className="colony-hire-simple-form"
        data-testid="hire-configure-form"
        onSubmit={saveDraftAndReview}
      >
        <div className="colony-hire-simple-columns">
          <section className="colony-hire-card colony-hire-simple-card">
            <div className="colony-hire-simple-picture">
              <EmployeeAvatar
                className="colony-hire-simple-avatar"
                instance={avatarUrl}
                name={previewName}
                role={rolePack.job}
                testId="hire-preview-avatar"
              />
              <div className="colony-hire-simple-picture-copy">
                <strong>Picture</strong>
                <span>
                  A Colony ant picked for{" "}
                  {agentFunctionFromRole(rolePack.job).toLowerCase()}. Choose a
                  colour or use a photo.
                </span>
              </div>
              <AgentAntPicturePicker
                avatarUrl={avatarUrl || agentAntAvatarDataUrl(rolePack.job)}
                functionName={agentFunctionFromRole(rolePack.job)}
                onSelect={setAvatarUrl}
                onUploadPendingChange={setAvatarUploadPending}
              />
            </div>
            <div className="colony-hire-simple-fields">
              <HireField
                hint={
                  <>
                    <small>Each name is used once in your team.</small>
                    {nameTaken ? (
                      <small data-tone="error" role="alert">
                        That name is already in the team. Choose a distinct
                        name.
                      </small>
                    ) : null}
                  </>
                }
                htmlFor="hire-employee-name"
                label="Name"
              >
                <input
                  autoComplete="off"
                  className="colony-hire-input"
                  data-testid="hire-employee-name"
                  id="hire-employee-name"
                  maxLength={180}
                  onChange={(event) => {
                    setNameTaken(false);
                    updateForm("displayName", event.target.value);
                  }}
                  required
                  value={form.displayName}
                />
              </HireField>
              <HireField htmlFor="hire-title" label="Role">
                <input
                  className="colony-hire-input"
                  data-testid="hire-title"
                  id="hire-title"
                  maxLength={180}
                  onChange={(event) => updateForm("title", event.target.value)}
                  required
                  value={form.title}
                />
              </HireField>
              <HireField
                htmlFor="hire-respond-to"
                label="Who can give instructions"
              >
                <select
                  className="colony-hire-select"
                  data-testid="hire-respond-to"
                  id="hire-respond-to"
                  onChange={(event) =>
                    updateForm("respondTo", event.target.value as RespondToMode)
                  }
                  value={form.respondTo}
                >
                  <option value="owner-only">You and admins</option>
                  <option value="anyone">Anyone in this space</option>
                </select>
              </HireField>
            </div>
            <fieldset className="colony-hire-simple-channel-fieldset">
              <legend>Add it to channels</legend>
              <div className="colony-hire-simple-channel-list">
                {validChannels.map((channel) => {
                  const checked = form.channelIds.includes(channel.id);
                  return (
                    <label
                      className="colony-hire-simple-channel"
                      data-checked={checked}
                      key={channel.id}
                    >
                      <input
                        checked={checked}
                        data-testid={`hire-channel-${channel.id}`}
                        onChange={(event) =>
                          chooseChannel(channel.id, event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span># {channel.name}</span>
                    </label>
                  );
                })}
              </div>
              <small>
                {validChannels.length === 0
                  ? "Join a channel before hiring this employee."
                  : "Tag it in any other channel to add it there."}
              </small>
            </fieldset>
          </section>
          <section
            aria-labelledby="hire-ai-heading"
            className="colony-hire-card colony-hire-simple-card colony-hire-simple-ai"
          >
            <h2 id="hire-ai-heading">AI</h2>
            <dl
              aria-label="Selected AI"
              className="colony-hire-simple-ai-summary"
            >
              <div>
                <dt>Model</dt>
                <dd>{currentChoice?.label ?? "Choose a model"}</dd>
              </div>
              <div>
                <dt>Harness</dt>
                <dd>{selectedRuntime?.label ?? form.runtimeId}</dd>
              </div>
              {form.effortLevel ? (
                <div>
                  <dt>Effort</dt>
                  <dd>{form.effortLevel}</dd>
                </div>
              ) : null}
              {selectedProviderLabel ? (
                <div className="colony-hire-simple-ai-provider">
                  <dt>Provider</dt>
                  <dd>{selectedProviderLabel}</dd>
                </div>
              ) : null}
            </dl>
            <fieldset
              aria-label="Available AI models"
              className="colony-hire-simple-models"
            >
              {form.providerId === "colony-credits" &&
              freeModelsQuery.isPending ? (
                <p role="status">Checking the relay's free models…</p>
              ) : null}
              {form.providerId === "colony-credits" &&
              freeModelsQuery.isError ? (
                <p data-tone="error" role="alert">
                  Free models could not be checked. Retry or choose another
                  harness.
                  <button
                    className="colony-hire-inline-link"
                    onClick={() => void freeModelsQuery.refetch()}
                    type="button"
                  >
                    Retry
                  </button>
                </p>
              ) : null}
              {modelGroups.map((group) => (
                <section
                  aria-label={group.label}
                  className="colony-hire-simple-model-group"
                  key={group.label}
                >
                  <h3>{group.label}</h3>
                  {group.choices.map((choice) => {
                    const runtime = runtimesById.get(choice.runtimeId);
                    const providerLabel = simpleProviderLabel({
                      runtimeId: choice.runtimeId,
                      provider: choice.providerId,
                      envVars: inheritedDefaults.inheritedEnvVars,
                    });
                    const checked = currentChoice?.value === choice.value;
                    return (
                      <label
                        className="colony-hire-simple-model-option"
                        data-checked={checked}
                        key={choice.value}
                      >
                        <input
                          aria-label={
                            choice.label +
                            ", " +
                            (runtime?.label ?? choice.runtimeId)
                          }
                          checked={checked}
                          data-testid="hire-ai-model-option"
                          name="hire-ai-model"
                          onChange={() => {
                            setForm((current) =>
                              current
                                ? {
                                    ...current,
                                    runtimeId: choice.runtimeId,
                                    providerId: choice.providerId,
                                    modelId: choice.modelId,
                                    effortLevel: "",
                                  }
                                : current,
                            );
                          }}
                          type="radio"
                          value={choice.value}
                        />
                        <span>
                          <strong>{choice.label}</strong>
                          <small>
                            Harness: {runtime?.label ?? choice.runtimeId}
                            {providerLabel
                              ? ` · Provider: ${providerLabel}`
                              : ""}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                  {group.isFree ? (
                    <p className="colony-hire-simple-free-note">
                      If it is busy, Colony uses the next free model
                      automatically.
                    </p>
                  ) : null}
                </section>
              ))}
              {modelChoices.length === 0 &&
              !(
                form.providerId === "colony-credits" &&
                freeModelsQuery.isPending
              ) ? (
                <p role="status">
                  No model choices were reported by the available harnesses.
                  Check the harness sign-in and model settings before
                  continuing.
                </p>
              ) : null}
            </fieldset>
            {effortOptions.length > 0 ? (
              <fieldset className="colony-hire-simple-effort">
                <legend>Effort</legend>
                <div role="radiogroup" aria-label="Effort">
                  {effortOptions.map((effort) => (
                    <label
                      data-checked={form.effortLevel === effort}
                      key={effort}
                    >
                      <input
                        checked={form.effortLevel === effort}
                        data-testid={`hire-effort-${effort}`}
                        name="hire-effort"
                        onChange={() => updateForm("effortLevel", effort)}
                        type="radio"
                        value={effort}
                      />
                      {effort}
                    </label>
                  ))}
                </div>
                <small>
                  Effort levels as {selectedRuntime?.label ?? "this harness"}{" "}
                  names them.
                </small>
              </fieldset>
            ) : null}
          </section>
        </div>
        {draftSaveError ? (
          <p data-tone="error" role="alert">
            Your setup could not be saved. Keep this page open and try again.
          </p>
        ) : null}
        {avatarUploadPending ? (
          <p aria-live="polite" role="status">
            Uploading picture…
          </p>
        ) : null}
        <div className="colony-hire-simple-footer">
          <HireButton onClick={() => void goHireRoles()} variant="outline">
            Back
          </HireButton>
          <HireButton
            disabled={!canContinue}
            testId="hire-review"
            type="submit"
          >
            Continue to review
            <ArrowGlyph size={16} />
          </HireButton>
        </div>
      </form>
    </HirePage>
  );
}
