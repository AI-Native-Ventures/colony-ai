import * as React from "react";

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
import type { TeamMember } from "@/features/company-team/teamModels";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { AcpRuntimeCatalogEntry, AgentPersona } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useCompanyHireHeadQuery } from "../hireRelay";
import {
  companyHireRolePackFromPersona,
  COMPANY_HIRE_SCHEMA_VERSION,
  parseCompanyHireAction,
} from "../companyHireModels";
import type { CompanyHireHeadRecord } from "../companyHireModels";
import { readHireDraft, writeHireDraft } from "../hireDraft";
import type { HireProposal } from "@/features/company-asks/askRecords";
import {
  HireBackButton,
  HireField,
  HirePageContent,
  HirePageHeader,
  hirePrimaryButtonClass,
} from "./HirePresentation";

type HireFormValues = {
  displayName: string;
  title: string;
  managerPubkey: string;
  introductionChannelId: string;
  weeklyAllowance: string;
  runtimeId: string;
  providerId: string;
  modelId: string;
};

type ModelChoice = {
  value: string;
  runtimeId: string;
  providerId: string;
  modelId: string;
  label: string;
};

const SELECT_CLASS =
  "h-10 w-full rounded-[7px] border border-input/40 bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function formFromProposal(proposal: HireProposal): HireFormValues {
  return {
    displayName: proposal.displayName,
    title: proposal.title,
    managerPubkey: proposal.managerPubkey ?? "",
    introductionChannelId: proposal.introductionChannelId,
    weeklyAllowance: proposal.weeklyAllowance ?? "",
    runtimeId: proposal.runtimeId,
    providerId: proposal.providerId ?? "",
    modelId: proposal.modelId ?? "",
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
    runtimeId: values.runtimeId,
    ...(values.providerId ? { providerId: values.providerId } : {}),
    ...(values.modelId ? { modelId: values.modelId } : {}),
    ...(values.weeklyAllowance.trim()
      ? { weeklyAllowance: values.weeklyAllowance.trim() }
      : {}),
  };
}

function activeMembers(members: readonly TeamMember[]) {
  return members.filter(
    (member) => (member.position?.head.status ?? "active") === "active",
  );
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
    label: option.label,
  }));
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
  members: readonly TeamMember[],
  identityPubkey: string | undefined,
  channelId: string,
): HireFormValues {
  const managers = activeMembers(members);
  const managerPubkey =
    managers.find(
      (member) => member.pubkey.toLowerCase() === identityPubkey?.toLowerCase(),
    )?.pubkey ??
    managers.find((member) => member.role === "owner")?.pubkey ??
    "";
  const runtimeId = rolePack.workerMenu.includes(persona?.runtime ?? "")
    ? (persona?.runtime ?? "")
    : (rolePack.workerMenu[0] ?? "");
  return {
    displayName: "",
    title: rolePack.title,
    managerPubkey,
    introductionChannelId: channelId,
    weeklyAllowance: "",
    runtimeId,
    providerId: persona?.runtime === runtimeId ? (persona.provider ?? "") : "",
    modelId: persona?.runtime === runtimeId ? (persona.model ?? "") : "",
  };
}

function currentRecordProposal(record: CompanyHireHeadRecord | undefined) {
  return record?.head.proposal;
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
  const { goHireReview, goTeam } = useAppNavigation();
  const persona = personasQuery.data?.find((item) => item.id === personaId);
  const remoteProposal = currentRecordProposal(headQuery.data ?? undefined);
  const rolePack = React.useMemo(
    () =>
      remoteProposal?.rolePack ??
      (persona ? companyHireRolePackFromPersona(persona) : null),
    [persona, remoteProposal?.rolePack],
  );
  const members = React.useMemo(
    () => activeMembers(teamQuery.data?.members ?? []),
    [teamQuery.data?.members],
  );
  const memberPubkeys = React.useMemo(
    () => members.map((member) => member.pubkey),
    [members],
  );
  const profilesQuery = useUsersBatchQuery(memberPubkeys, {
    enabled: memberPubkeys.length > 0,
  });
  const profiles = profilesQuery.data?.profiles ?? {};
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
  const [nameTaken, setNameTaken] = React.useState(source?.nameTaken === true);
  const initialized = React.useRef(form !== null);

  React.useEffect(() => {
    if (initialized.current) return;
    const stored = readHireDraft(relayUrl, hireId);
    if (stored) {
      setForm(formFromProposal(stored.proposal));
      initialized.current = true;
      return;
    }
    if (remoteProposal) {
      setForm(formFromProposal(remoteProposal));
      initialized.current = true;
      return;
    }
    if (rolePack) {
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
          members,
          identityQuery.data?.pubkey,
          channels[0]?.id ?? "",
        ),
      );
      initialized.current = true;
    }
  }, [
    channelsQuery.data,
    hireId,
    identityQuery.data?.pubkey,
    members,
    persona,
    relayUrl,
    remoteProposal,
    rolePack,
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
    return (
      choicesByRuntime[
        JSON.stringify([runtimeId, providerForRuntime(runtime)])
      ] ?? []
    );
  });
  const currentChoice = modelChoices.find(
    (choice) =>
      choice.runtimeId === form?.runtimeId &&
      choice.providerId === form?.providerId &&
      choice.modelId === form?.modelId,
  );
  const validChannels = (channelsQuery.data ?? []).filter(
    (channel) =>
      channel.channelType === "stream" &&
      channel.archivedAt === null &&
      channel.isMember,
  );
  const ready =
    form !== null &&
    rolePack !== null &&
    !personasQuery.isPending &&
    !runtimesQuery.isPending &&
    !channelsQuery.isPending &&
    !teamQuery.isPending &&
    !identityQuery.isPending &&
    !membershipQuery.isPending;
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
    candidateCreateAction,
    headQuery.data?.event.id,
    previousDraft?.baseHeadEventId,
    previousDraft?.employeePubkey,
    relayUrl,
    source?.askId,
  ]);

  if (personasQuery.isError) throw personasQuery.error;
  if (runtimesQuery.isError) throw runtimesQuery.error;
  if (channelsQuery.isError) throw channelsQuery.error;
  if (teamQuery.isError) throw teamQuery.error;
  if (headQuery.isError) throw headQuery.error;
  if (!ready || !form || !rolePack) return null;

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
    if (!createAction || !form.displayName.trim()) return;
    writeHireDraft(relayUrl, {
      proposal,
      ...(storedDraft?.employeePubkey
        ? { employeePubkey: storedDraft.employeePubkey }
        : {}),
      ...(source?.askId && headQuery.data?.event.id
        ? { baseHeadEventId: headQuery.data.event.id }
        : {}),
    });
    void goHireReview(hireId, source);
  };

  return (
    <>
      <HirePageHeader title="Configure employee" />
      <HirePageContent>
        <HireBackButton onClick={() => void goHireReview(hireId, source)} />
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
          Configure employee
        </h1>
        <section className="mb-6 border-l-2 border-border bg-muted p-[15px]">
          <h2 className="text-base font-semibold text-foreground">
            {rolePack.title}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{rolePack.job}</p>
        </section>
        {workerMenu.map((runtimeId) => {
          const runtime = runtimesById.get(runtimeId);
          if (!runtime) return null;
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
          className="grid max-w-[46.25rem] gap-5"
          onSubmit={saveDraftAndReview}
        >
          <HireField htmlFor="hire-employee-name" label="Employee name">
            <Input
              autoComplete="off"
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
            {nameTaken ? (
              <span
                className="text-sm text-destructive"
                data-testid="hire-name-taken"
                role="alert"
              >
                That name is already in the team. Choose a distinct name.
              </span>
            ) : null}
          </HireField>
          <HireField htmlFor="hire-title" label="Title">
            <Input
              data-testid="hire-title"
              id="hire-title"
              maxLength={180}
              onChange={(event) => updateForm("title", event.target.value)}
              required
              value={form.title}
            />
          </HireField>
          <HireField htmlFor="hire-manager" label="Reports to">
            <select
              className={SELECT_CLASS}
              data-testid="hire-manager"
              id="hire-manager"
              onChange={(event) =>
                updateForm("managerPubkey", event.target.value)
              }
              value={form.managerPubkey}
            >
              <option value="">Company owner</option>
              {members.map((member) => (
                <option key={member.pubkey} value={member.pubkey.toLowerCase()}>
                  {resolveUserLabel({
                    pubkey: member.pubkey,
                    currentPubkey: identityQuery.data?.pubkey,
                    profiles,
                  })}
                </option>
              ))}
            </select>
          </HireField>
          <HireField htmlFor="hire-channel" label="Home channel">
            <select
              className={SELECT_CLASS}
              data-testid="hire-channel"
              id="hire-channel"
              onChange={(event) =>
                updateForm("introductionChannelId", event.target.value)
              }
              required
              value={form.introductionChannelId}
            >
              {validChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </HireField>
          <HireField
            htmlFor="hire-weekly-allowance"
            label="Weekly allowance (USD API-equivalent)"
          >
            <Input
              data-testid="hire-weekly-allowance"
              id="hire-weekly-allowance"
              min="0.01"
              onChange={(event) =>
                updateForm("weeklyAllowance", event.target.value)
              }
              required
              step="0.01"
              type="number"
              value={form.weeklyAllowance}
            />
          </HireField>
          <HireField htmlFor="hire-worker-model" label="Worker model">
            <select
              className={SELECT_CLASS}
              data-testid="hire-worker-model"
              id="hire-worker-model"
              onChange={(event) => {
                const selected = modelChoices.find(
                  (choice) => choice.value === event.target.value,
                );
                if (!selected) return;
                setForm((current) =>
                  current
                    ? {
                        ...current,
                        runtimeId: selected.runtimeId,
                        providerId: selected.providerId,
                        modelId: selected.modelId,
                      }
                    : current,
                );
              }}
              required
              value={currentChoice?.value ?? ""}
            >
              <option value="">Select a model</option>
              {modelChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </HireField>
          <section className="grid gap-2 border-l-2 border-border bg-muted p-[15px]">
            <h2 className="text-sm font-semibold text-foreground">
              Included tool scope
            </h2>
            <p className="text-sm text-muted-foreground">
              {rolePack.tools
                .map((tool) => `${tool.name} · ${tool.risk}`)
                .join(" · ")}
            </p>
          </section>
          <div className="flex gap-3">
            <Button
              className={hirePrimaryButtonClass}
              data-testid="hire-review"
              disabled={!createAction || !currentChoice}
              type="submit"
            >
              Review hire
            </Button>
            <Button
              onClick={() => void goTeam()}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </form>
      </HirePageContent>
    </>
  );
}
