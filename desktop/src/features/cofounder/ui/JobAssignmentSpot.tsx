import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import type { TeamMember } from "@/features/company-team/teamModels";
import { TerminateEmployeeDialog } from "@/features/company-team/ui/TeamDialogs";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useCommunities } from "@/features/communities/useCommunities";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useProfileQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";

import {
  companyMapScoutChannelId,
  companyMapScoutPubkey,
} from "../companyMapScout";
import { companyMapJobDoer } from "../companyMapAssignments";
import type { FunctionId, FunctionSlotView } from "../cofounderRecords";
import { FUNCTION_DETAILS } from "../functions";
import { prebuiltAgentAvatarDataUrl } from "../prebuiltAgentAvatar";
import {
  prebuiltJobId,
  prebuiltHeadForFunction,
  prebuiltSpecialistForJobName,
} from "../prebuiltAgents";
import type { PrebuiltAgent } from "../prebuiltAgents";
import { readPrebuiltHireCompletion } from "../prebuiltHireStorage";
import type { PrebuiltHireCompletion } from "../prebuiltHireStorage";
import {
  useCompanyJobHeadsQuery,
  useJobAssignmentCapability,
} from "../jobAssignments";
import { useFunctionSlotsQuery } from "../hooks";

import { PrebuiltHeadHireDialog } from "./PrebuiltHeadHireDialog";

type JobAssignmentSpotPresentation = "pill" | "inline";

function memberName(member: TeamMember | null): string {
  return (
    member?.managedAgent?.name?.trim() ||
    member?.fallbackName?.trim() ||
    "Company agent"
  );
}

function memberByPubkey(members: readonly TeamMember[], pubkey: string | null) {
  if (!pubkey) return null;
  return (
    members.find(
      (member) => member.pubkey.toLowerCase() === pubkey.toLowerCase(),
    ) ?? null
  );
}

function slotFor(
  slots: readonly FunctionSlotView[],
  functionId: FunctionId,
): FunctionSlotView {
  return (
    slots.find((slot) => slot.functionId === functionId) ?? {
      functionId,
      state: "empty",
      leadPubkey: null,
    }
  );
}

function JobAssigneeAvatar({
  agent,
  member,
  name,
}: {
  agent: ReturnType<typeof prebuiltSpecialistForJobName>;
  member: TeamMember | null;
  name: string;
}) {
  return (
    <EmployeeAvatar
      className="size-8 rounded-full"
      instance={
        agent
          ? prebuiltAgentAvatarDataUrl(agent)
          : member?.managedAgent?.avatarUrl
      }
      name={name}
      personaId={member?.managedAgent?.personaId}
      pubkey={member?.pubkey}
    />
  );
}

function SpecialistCardBox({
  agent,
  label,
  member = null,
}: {
  agent: PrebuiltAgent;
  label: "Not available yet" | "Pre-built" | "Works here";
  member?: TeamMember | null;
}) {
  const name = member ? memberName(member) : agent.name;
  return (
    <div
      className="map-job-assignment-specialist-box"
      data-testid="job-assignment-specialist-box"
    >
      <JobAssigneeAvatar agent={agent} member={member} name={name} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-extrabold">{name}</p>
          <span className="map-job-assignment-chip">{label}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{agent.does[0]}</p>
      </div>
    </div>
  );
}

/** The real assignee avatar used by job circles in every map layout. */
export function JobAssignmentAvatar({
  className,
  functionId,
  jobName,
}: {
  className: string;
  functionId: FunctionId;
  jobName: string;
}) {
  const { activeCommunity } = useCommunities();
  const teamQuery = useCompanyTeamQuery(Boolean(activeCommunity));
  const slots = useFunctionSlotsQuery(activeCommunity?.id ?? null);
  const capabilityQuery = useJobAssignmentCapability();
  const jobHeadsQuery = useCompanyJobHeadsQuery(
    activeCommunity?.id ?? null,
    capabilityQuery.data === true,
  );
  const agent = prebuiltSpecialistForJobName(functionId, jobName);
  const jobId = agent ? prebuiltJobId(agent) : null;
  const members = teamQuery.data?.members ?? [];
  const slot = slotFor(slots, functionId);
  const jobHead = jobId
    ? (jobHeadsQuery.data?.find(
        (candidate) =>
          candidate.functionId === functionId && candidate.jobId === jobId,
      ) ?? null)
    : null;
  const assigned = companyMapJobDoer(
    slot,
    jobHead?.state === "filled" ? jobHead.assigneePubkey : null,
  );
  if (assigned.kind === "scout") {
    return <EmployeeAvatar className={className} name="Scout" />;
  }
  const member = memberByPubkey(members, assigned.pubkey);
  const name = memberName(member);
  const prebuiltHead = prebuiltHeadForFunction(functionId);
  const usesPrebuiltSpecialist =
    assigned.kind === "specialist" && agent?.name === name;
  const usesPrebuiltHead =
    assigned.kind === "head" && prebuiltHead?.name === name;
  return (
    <EmployeeAvatar
      className={className}
      instance={
        usesPrebuiltSpecialist && agent
          ? prebuiltAgentAvatarDataUrl(agent)
          : usesPrebuiltHead && prebuiltHead
            ? prebuiltAgentAvatarDataUrl(prebuiltHead)
            : member?.managedAgent?.avatarUrl
      }
      name={name}
      personaId={member?.managedAgent?.personaId}
      pubkey={member?.pubkey}
    />
  );
}

/**
 * The one reusable job spot: a map-window pill or the same information inside
 * a no-screen card. It consumes relay assignment heads, so every visual surface
 * asks the same specialist, then head, then Scout rule.
 */
export function JobAssignmentSpot({
  functionId,
  jobName,
  onOpenJob,
  presentation,
}: {
  functionId: FunctionId;
  jobName: string;
  onOpenJob?: () => void;
  presentation: JobAssignmentSpotPresentation;
}) {
  const { activeCommunity } = useCommunities();
  const membershipQuery = useMyRelayMembershipQuery();
  const identityQuery = useIdentityQuery();
  const ownerProfile = useProfileQuery(Boolean(activeCommunity));
  const channelsQuery = useChannelsQuery({ enabled: Boolean(activeCommunity) });
  const teamQuery = useCompanyTeamQuery(Boolean(activeCommunity));
  const slots = useFunctionSlotsQuery(activeCommunity?.id ?? null);
  const capabilityQuery = useJobAssignmentCapability();
  const jobHeadsQuery = useCompanyJobHeadsQuery(
    activeCommunity?.id ?? null,
    capabilityQuery.data === true,
  );
  const openDm = useOpenDmMutation();
  const { goChannel } = useAppNavigation();
  const [cardOpen, setCardOpen] = React.useState(false);
  const [hireOpen, setHireOpen] = React.useState(false);
  const [terminateOpen, setTerminateOpen] = React.useState(false);
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [recentHire, setRecentHire] =
    React.useState<PrebuiltHireCompletion | null>(null);

  const agent = prebuiltSpecialistForJobName(functionId, jobName);
  const jobId = agent ? prebuiltJobId(agent) : null;
  const members = teamQuery.data?.members ?? [];
  const slot = slotFor(slots, functionId);
  const headMember = memberByPubkey(members, slot.leadPubkey);
  const scoutPubkey = React.useMemo(
    () => companyMapScoutPubkey(members, {}),
    [members],
  );
  const scoutMember = memberByPubkey(members, scoutPubkey);
  const scoutChannelId = React.useMemo(
    () => companyMapScoutChannelId(channelsQuery.data, scoutPubkey),
    [channelsQuery.data, scoutPubkey],
  );
  const head = jobId
    ? (jobHeadsQuery.data?.find(
        (candidate) =>
          candidate.functionId === functionId && candidate.jobId === jobId,
      ) ?? null)
    : null;
  const specialistMember =
    head?.state === "filled"
      ? memberByPubkey(members, head.assigneePubkey)
      : null;
  const hasSpecialist = head?.state === "filled";
  const doer = companyMapJobDoer(
    slot,
    head?.state === "filled" ? head.assigneePubkey : null,
  );
  const isOwner = membershipQuery.data?.role === "owner";
  const relayReady = capabilityQuery.data === true;
  const specialistName = specialistMember
    ? memberName(specialistMember)
    : (agent?.name ?? "Specialist");
  const headName = headMember ? memberName(headMember) : "the head";
  const managerName = headMember ? memberName(headMember) : null;
  const managerPubkey = headMember?.pubkey ?? scoutMember?.pubkey ?? null;
  const doerName =
    doer.kind === "specialist"
      ? specialistName
      : doer.kind === "head"
        ? headName
        : "Scout";
  const doerDescription =
    doer.kind === "specialist"
      ? `${specialistName} works here`
      : doer.kind === "head"
        ? `${headName}, Head of ${FUNCTION_DETAILS[functionId].name}, does this`
        : "Scout does this";
  const unavailableReason =
    agent?.unavailableReason || "This job is not available yet.";
  const canOfferHire = Boolean(
    isOwner &&
      agent?.available &&
      relayReady &&
      !hasSpecialist &&
      managerPubkey,
  );

  if (!agent || !jobId) return null;

  const visibleRecentHire =
    recentHire?.agentId === agent.id && recentHire.jobId === jobId
      ? recentHire
      : readPrebuiltHireCompletion(
          activeCommunity?.id ?? "",
          functionId,
          jobId,
        );

  const closeCard =
    presentation === "pill" ? (
      <button
        className="map-job-assignment-close"
        data-testid={`job-assignment-close-${functionId}-${jobId}`}
        onClick={() => setCardOpen(false)}
        type="button"
      >
        Close
      </button>
    ) : null;

  const openMessage = async () => {
    if (!specialistMember) return;
    setMessageError(null);
    try {
      const dm = await openDm.mutateAsync({
        pubkeys: [specialistMember.pubkey],
        expectedRelayUrl: activeCommunity?.relayUrl,
        expectedSignerPubkey: identityQuery.data?.pubkey,
      });
      await goChannel(dm.id);
    } catch (error) {
      setMessageError(
        error instanceof Error ? error.message : "Could not open the message.",
      );
    }
  };

  const card = (
    <section
      aria-label={`${jobName} specialist`}
      className="map-job-assignment-card"
      data-testid={`job-assignment-card-${functionId}-${jobId}`}
    >
      <p className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
        Job in {FUNCTION_DETAILS[functionId].name}
      </p>
      {presentation === "inline" ? (
        <p className="mt-0.5 text-lg font-extrabold">{jobName}</p>
      ) : (
        <h2 className="mt-0.5 text-lg font-extrabold">{jobName}</h2>
      )}
      {hasSpecialist ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {headMember
              ? `${headName} leads this specialist.`
              : `Scout leads this specialist until you hire a Head of ${FUNCTION_DETAILS[functionId].name}.`}
          </p>
          <SpecialistCardBox
            agent={agent}
            label="Works here"
            member={specialistMember}
          />
          {visibleRecentHire?.agentId === agent.id ? (
            <div className="map-job-assignment-just-hired" role="status">
              <span>Just hired</span>
              <p>{visibleRecentHire.firstMessage}</p>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {onOpenJob ? (
              <button
                className="map-job-assignment-primary"
                onClick={onOpenJob}
                type="button"
              >
                Open {jobName}
              </button>
            ) : null}
            <button
              className="map-job-assignment-secondary"
              disabled={openDm.isPending}
              onClick={() => void openMessage()}
              type="button"
            >
              Message
            </button>
            {isOwner && specialistMember?.kind === "employee" ? (
              <button
                className="map-job-assignment-secondary"
                onClick={() => setTerminateOpen(true)}
                type="button"
              >
                Remove
              </button>
            ) : null}
          </div>
          {isOwner ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Remove hands {jobName} back to {headMember ? headName : "Scout"}.
            </p>
          ) : null}
        </>
      ) : agent.available ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {headMember
              ? `${headName} does ${jobName} as Head of ${FUNCTION_DETAILS[functionId].name}. Hire a specialist and ${headName} keeps the rest of ${FUNCTION_DETAILS[functionId].name}.`
              : `Scout does ${jobName} for now. Nobody leads ${FUNCTION_DETAILS[functionId].name} yet.`}
          </p>
          <SpecialistCardBox agent={agent} label="Pre-built" />
          {isOwner ? (
            relayReady ? (
              <button
                className="map-job-assignment-primary mt-3"
                disabled={!canOfferHire}
                onClick={() => setHireOpen(true)}
                type="button"
              >
                Hire {agent.name}
              </button>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                Not available yet. Update this company relay to hire a
                specialist.
              </p>
            )
          ) : null}
        </>
      ) : (
        <>
          <SpecialistCardBox agent={agent} label="Not available yet" />
          <p className="mt-2 text-sm text-muted-foreground">
            {unavailableReason}
          </p>
        </>
      )}
      {messageError ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {messageError}
        </p>
      ) : null}
      {closeCard ? (
        <div className="mt-3 flex flex-wrap gap-2">{closeCard}</div>
      ) : null}
    </section>
  );

  return (
    <>
      <div
        className={
          presentation === "pill"
            ? "map-job-assignment-pill-wrap"
            : "map-job-assignment-inline"
        }
        data-testid={`job-assignment-spot-${functionId}-${jobId}`}
      >
        {presentation === "pill" ? (
          <button
            aria-expanded={cardOpen}
            className="map-job-assignment-pill"
            onClick={() => setCardOpen((open) => !open)}
            type="button"
          >
            <JobAssigneeAvatar
              agent={doer.kind === "specialist" ? agent : null}
              member={
                doer.kind === "specialist" ? specialistMember : headMember
              }
              name={doerName}
            />
            <span>{doerDescription}</span>
            {isOwner && relayReady && !hasSpecialist && agent.available ? (
              <span className="map-job-assignment-pill-action">
                Hire a specialist
              </span>
            ) : null}
          </button>
        ) : null}
        {presentation === "inline" || cardOpen ? card : null}
      </div>
      <PrebuiltHeadHireDialog
        agent={agent}
        defaultChannelId={scoutChannelId}
        functionId={functionId}
        jobId={jobId}
        managerName={managerName}
        managerPubkey={managerPubkey}
        onCompleted={(completion) => {
          setRecentHire(completion);
          setHireOpen(false);
          setCardOpen(true);
          void jobHeadsQuery.refetch();
        }}
        onOpenChange={(open) => setHireOpen(open)}
        open={hireOpen}
        ownerName={ownerProfile.data?.displayName?.trim() || "Owner"}
      />
      {specialistMember?.kind === "employee" ? (
        <TerminateEmployeeDialog
          member={specialistMember}
          onOpenChange={(open) => {
            setTerminateOpen(open);
            if (!open) void jobHeadsQuery.refetch();
          }}
          open={terminateOpen}
        />
      ) : null}
    </>
  );
}
