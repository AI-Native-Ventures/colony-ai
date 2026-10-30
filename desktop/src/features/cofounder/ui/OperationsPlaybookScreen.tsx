import { useMemo } from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { Channel } from "@/shared/api/types";

import { FUNCTION_DETAILS } from "../functions";
import type { FunctionId } from "../cofounderRecords";
import {
  jobProgress,
  jobsOfPlaybook,
  lastApprovedChange,
} from "../playbookRecords";
import type {
  JobView,
  PlaybookStepView,
  PlaybookView,
} from "../playbookRecords";
import { playbookActions, playbookJobActions } from "../playbookActions";
import {
  usePlaybookAction,
  usePlaybookJobAction,
  usePlaybooksQuery,
} from "../playbookHooks";
import type {
  PlaybookJobModel,
  PlaybookScreenModel,
  PlaybookStepModel,
} from "../playbookModels";
import { TeamPage, TeamPageTitle } from "../../company-team/ui/TeamPage";
import { PlaybookScreen } from "./PlaybookScreen";

type ProfileLookup = Record<string, { displayName: string | null }>;

function scoutChannel(
  channels: readonly Channel[],
  scoutPubkey: string | undefined,
): Channel | null {
  if (!scoutPubkey) return null;
  const key = scoutPubkey.toLowerCase();
  return (
    channels
      .filter(
        (channel) =>
          channel.isMember &&
          channel.channelType === "stream" &&
          channel.memberPubkeys.some((pubkey) => pubkey.toLowerCase() === key),
      )
      .sort((first, second) => {
        const firstIsGeneral = first.name.trim().toLowerCase() === "general";
        const secondIsGeneral = second.name.trim().toLowerCase() === "general";
        return Number(secondIsGeneral) - Number(firstIsGeneral);
      })[0] ?? null
  );
}

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1_000));
}

function titleCaseIdentifier(value: string): string {
  return value
    .replaceAll(/[_-]+/gu, " ")
    .replaceAll(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function personLabel(
  pubkey: string | null,
  profiles: ProfileLookup,
  agents: ReadonlyArray<{ pubkey: string; name: string }>,
  selfPubkey: string | undefined,
): string {
  if (!pubkey) return "Company agent";
  if (selfPubkey?.toLowerCase() === pubkey.toLowerCase()) return "you";
  const profileName = profiles[pubkey.toLowerCase()]?.displayName?.trim();
  const agentName = agents.find(
    (agent) => agent.pubkey.toLowerCase() === pubkey.toLowerCase(),
  )?.name;
  return profileName || agentName?.trim() || "Company agent";
}

function stepModel(
  step: PlaybookStepView,
  profiles: ProfileLookup,
  agents: ReadonlyArray<{ pubkey: string; name: string }>,
  selfPubkey: string | undefined,
): PlaybookStepModel {
  const owner = step.owner;
  if (owner.kind === "owner") {
    return {
      id: step.stepId,
      title: step.title,
      owner: { kind: "owner", label: "You" },
      detail: step.detail,
      inputs: step.inputs,
      outputs: step.outputs,
      tools: step.tools,
      approvalPrompt: step.approvalPoint?.prompt ?? null,
      isApprovalPoint: step.approvalPoint !== null,
    };
  }

  if (owner.kind === "worker") {
    const workerName = owner.workerType
      ? `${titleCaseIdentifier(owner.workerType)} worker`
      : "Worker";
    return {
      id: step.stepId,
      title: step.title,
      owner: { kind: "worker", label: workerName },
      detail: step.detail,
      inputs: step.inputs,
      outputs: step.outputs,
      tools: step.tools,
      approvalPrompt: step.approvalPoint?.prompt ?? null,
      isApprovalPoint: step.approvalPoint !== null,
    };
  }

  if (owner.kind === "function") {
    const functionName = owner.functionId
      ? FUNCTION_DETAILS[owner.functionId].name
      : "Company function";
    return {
      id: step.stepId,
      title: step.title,
      owner: { kind: "function", label: functionName },
      detail: step.detail,
      inputs: step.inputs,
      outputs: step.outputs,
      tools: step.tools,
      approvalPrompt: step.approvalPoint?.prompt ?? null,
      isApprovalPoint: step.approvalPoint !== null,
    };
  }

  const label = personLabel(owner.agentPubkey, profiles, agents, selfPubkey);
  return {
    id: step.stepId,
    title: step.title,
    owner: { kind: "agent", label, avatarName: label },
    detail: step.detail,
    inputs: step.inputs,
    outputs: step.outputs,
    tools: step.tools,
    approvalPrompt: step.approvalPoint?.prompt ?? null,
    isApprovalPoint: step.approvalPoint !== null,
  };
}

function jobModel(
  job: JobView,
  profiles: ProfileLookup,
  agents: ReadonlyArray<{ pubkey: string; name: string }>,
  selfPubkey: string | undefined,
): PlaybookJobModel {
  const progress = jobProgress(job);
  return {
    id: job.jobId,
    clientName: job.title,
    version: job.playbookVersion,
    status: job.status,
    startedAtLabel: formatDate(job.startedAt),
    currentStepId: job.currentStepId ?? "",
    roundLabel: progress.currentStep?.progressLabel ?? null,
    steps: job.steps.map((step) => ({
      ...stepModel(step, profiles, agents, selfPubkey),
      status: step.status,
    })),
  };
}

function screenModel(
  playbook: PlaybookView,
  jobs: readonly JobView[],
  profiles: ProfileLookup,
  agents: ReadonlyArray<{ pubkey: string; name: string }>,
  selfPubkey: string | undefined,
): PlaybookScreenModel | null {
  const content = playbook.current ?? playbook.pending?.content ?? null;
  if (!content) return null;

  const lastApproved = lastApprovedChange(playbook);
  const versions = playbook.records
    .filter(
      (record) =>
        record.decision === "approved" || record.decision === "published",
    )
    .map((record) => ({ record, index: record.version }))
    .sort(
      (first, second) =>
        first.index - second.index || first.record.at - second.record.at,
    )
    .map(({ record }) => ({
      version: record.version,
      summary:
        record.changeSummary ??
        (record.version === 1 ? "Initial playbook" : "Playbook updated"),
      approvedByLabel: personLabel(
        record.actorPubkey,
        profiles,
        agents,
        selfPubkey,
      ),
      approvedAtLabel: formatDate(record.at),
    }));

  return {
    id: playbook.playbookId,
    title: content.title,
    summary: content.summary,
    version: playbook.version,
    versions,
    lastApprovedByLabel: lastApproved
      ? personLabel(lastApproved.actorPubkey, profiles, agents, selfPubkey)
      : "not yet",
    lastApprovedAtLabel: lastApproved ? formatDate(lastApproved.at) : "not yet",
    steps: content.steps.map((step) =>
      stepModel(step, profiles, agents, selfPubkey),
    ),
    pendingChange: playbook.pending
      ? {
          id: playbook.playbookId,
          summary:
            playbook.pending.changeSummary ??
            "A new playbook is waiting for review.",
          proposedByLabel: personLabel(
            playbook.pending.proposedByPubkey,
            profiles,
            agents,
            selfPubkey,
          ),
          proposedAtLabel: formatDate(playbook.pending.proposedAt),
          version: playbook.pending.revision,
        }
      : null,
    jobs: jobs.map((job) => jobModel(job, profiles, agents, selfPubkey)),
  };
}

function isOperationsPlaybook(playbook: PlaybookView): boolean {
  if (playbook.status !== "active" && playbook.status !== "proposed")
    return false;
  return (
    playbook.current?.functionId === ("operations" satisfies FunctionId) ||
    playbook.pending?.content.functionId === "operations"
  );
}

function EmptyOperationsPlaybook({
  onTalkToScout,
  available,
}: {
  onTalkToScout: () => void;
  available: boolean;
}) {
  return (
    <TeamPage testId="cofounder-playbook-screen" title="Operations">
      <section className="team-card space-y-3 p-5 sm:p-6">
        <TeamPageTitle>Operations</TeamPageTitle>
        <h2 className="text-base font-extrabold">
          Design your first Operations playbook with Scout
        </h2>
        <p className="text-sm text-muted-foreground">
          Turn your delivery routine into clear steps, owners, tools and
          approval points.
        </p>
        <button
          className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          disabled={!available}
          onClick={onTalkToScout}
          type="button"
        >
          Talk with Scout
        </button>
      </section>
    </TeamPage>
  );
}

export function OperationsPlaybookScreen() {
  const navigation = useAppNavigation();
  const membership = useMyRelayMembershipQuery();
  const channelsQuery = useChannelsQuery();
  const agentsQuery = useManagedAgentsQuery();
  const { activeCommunity } = useCommunities();
  const playbooksQuery = usePlaybooksQuery(Boolean(activeCommunity));
  const playbookAction = usePlaybookAction();
  const jobAction = usePlaybookJobAction();
  const agents = (agentsQuery.data ?? []).map((agent) => ({
    pubkey: agent.pubkey,
    name: agent.name,
  }));
  const scout = (agentsQuery.data ?? []).find(
    (agent) =>
      agent.personaId === "builtin:fizz" ||
      agent.name.trim().toLowerCase() === "scout",
  );
  const scoutConversation = scoutChannel(
    channelsQuery.data ?? [],
    scout?.pubkey,
  );
  const canApprove =
    membership.data?.role === "owner" || membership.data?.role === "admin";
  const playbook = (playbooksQuery.data?.playbooks ?? []).find(
    isOperationsPlaybook,
  );
  const jobs = useMemo(
    () =>
      playbook
        ? jobsOfPlaybook(playbooksQuery.data?.jobs ?? [], playbook.playbookId)
        : [],
    [playbook, playbooksQuery.data?.jobs],
  );
  const profilePubkeys = useMemo(() => {
    if (!playbook) return [];
    const keys = [
      playbook.createdByPubkey,
      playbook.updatedByPubkey,
      ...(playbook.pending ? [playbook.pending.proposedByPubkey] : []),
      ...playbook.records.map((record) => record.actorPubkey),
      ...(playbook.current?.steps ?? [])
        .map((step) => step.owner.agentPubkey)
        .filter((pubkey): pubkey is string => pubkey !== null),
    ];
    return [...new Set(keys.map((pubkey) => pubkey.toLowerCase()))].slice(
      0,
      200,
    );
  }, [playbook]);
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: profilePubkeys.length > 0,
  });
  const profiles: ProfileLookup = profilesQuery.data?.profiles ?? {};
  const model = useMemo(
    () =>
      playbook
        ? screenModel(playbook, jobs, profiles, agents, membership.data?.pubkey)
        : null,
    [agents, jobs, membership.data?.pubkey, playbook, profiles],
  );

  if (playbooksQuery.isPending) {
    return (
      <TeamPage testId="cofounder-playbook-screen" title="Operations">
        <p
          aria-live="polite"
          className="text-sm text-muted-foreground"
          role="status"
        >
          Loading Operations playbooks.
        </p>
      </TeamPage>
    );
  }

  if (playbooksQuery.isError) {
    return (
      <TeamPage testId="cofounder-playbook-screen" title="Operations">
        <section className="space-y-3" role="alert">
          <TeamPageTitle>Operations</TeamPageTitle>
          <p className="text-sm text-destructive">
            Operations playbooks could not be loaded.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => void playbooksQuery.refetch()}
            type="button"
          >
            Try again
          </button>
        </section>
      </TeamPage>
    );
  }

  if (!playbook || !model) {
    return (
      <EmptyOperationsPlaybook
        available={Boolean(scoutConversation)}
        onTalkToScout={() => {
          if (scoutConversation)
            void navigation.goChannel(scoutConversation.id);
        }}
      />
    );
  }

  const activePlaybook = playbook;

  async function approveChange(changeId: string) {
    if (!canApprove) throw new Error("Only an owner or admin can approve.");
    if (changeId !== activePlaybook.playbookId || !activePlaybook.pending) {
      throw new Error("This playbook changed. Refresh and try again.");
    }
    await playbookAction.mutateAsync(playbookActions.approve(activePlaybook));
  }

  async function dismissChange(changeId: string) {
    if (!canApprove) throw new Error("Only an owner or admin can reject.");
    if (changeId !== activePlaybook.playbookId || !activePlaybook.pending) {
      throw new Error("This playbook changed. Refresh and try again.");
    }
    await playbookAction.mutateAsync(
      playbookActions.reject(activePlaybook, "Not now"),
    );
  }

  function getCurrentJob(jobId: string, stepId: string): JobView {
    if (!canApprove)
      throw new Error("Only an owner or admin can update this job.");
    const job = jobs.find((candidate) => candidate.jobId === jobId);
    if (!job || job.currentStepId !== stepId) {
      throw new Error("This client job changed. Refresh and try again.");
    }
    return job;
  }

  async function approveJobStep(jobId: string, stepId: string) {
    const job = getCurrentJob(jobId, stepId);
    await jobAction.mutateAsync(playbookJobActions.approveStep(job, stepId));
  }

  async function startJobStep(jobId: string, stepId: string) {
    const job = getCurrentJob(jobId, stepId);
    await jobAction.mutateAsync({
      kind: "update_step",
      jobId: job.jobId,
      stepId,
      stepStatus: "in_progress",
      expectedHeadEventId: job.eventId,
    });
  }

  async function markJobStepDone(jobId: string, stepId: string) {
    const job = getCurrentJob(jobId, stepId);
    await jobAction.mutateAsync(playbookJobActions.markDone(job, stepId));
  }

  return (
    <PlaybookScreen
      canApprove={canApprove}
      canProposeChange={Boolean(scoutConversation)}
      model={model}
      onApproveChange={approveChange}
      onApproveJobStep={approveJobStep}
      onDismissChange={dismissChange}
      onMarkJobStepDone={markJobStepDone}
      onProposeChange={() => {
        if (scoutConversation) void navigation.goChannel(scoutConversation.id);
      }}
      onStartJobStep={startJobStep}
    />
  );
}
